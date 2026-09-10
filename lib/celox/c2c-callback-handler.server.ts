import "server-only";

import { after } from "next/server";
import {
  hashRawC2CCallbackBody,
  processCeloxC2CCallbackEventWithRetry,
  verifyCeloxC2CCallbackSignatureV2,
} from "./c2c-callback.server";
import { isCeloxC2CCallbackRequest } from "./c2c-callback-validation";
import { CeloxError } from "./client.server";
import type { CeloxC2CCallbackResponse } from "./types";
import { enqueueCeloxC2CCallbackEvent } from "../db";

function errorResponse(status: number, error: string, code: string) {
  return Response.json({ error, code, retryable: false }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * แยก C2C ออกจาก callback ขาบัญชีปกติที่ endpoint รวม: C2C คือ body ที่มี `parts` เป็น array
 * หรือมีคีย์ `transactionStatus` — ห้ามใช้ `event`/`transferTo` อีกต่อไป `event` ถูกถอดออกจาก
 * สัญญาใหม่ และ `transferTo` เป็นแค่ field แบบมีเงื่อนไขของขาฝากที่ยังรอโอน
 */
export function looksLikeCeloxC2CCallback(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Array.isArray((value as { parts?: unknown }).parts)
    || Object.hasOwn(value, "transactionStatus");
}

/**
 * ลำดับคือ validate ก่อนแล้วค่อย verify ลายเซ็น: body รูปแบบใหม่ที่ลายเซ็นไม่ผ่านจึงตอบ 401
 * ส่วน body รูปแบบเก่าตอบ 422 — ใช้เป็น probe ตอน deploy ว่าโค้ดใหม่ขึ้นแล้วโดยไม่ต้องรู้ secret
 */
export async function acceptCeloxC2CCallbackPayload(
  payload: unknown,
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
) {
  if (!isCeloxC2CCallbackRequest(payload)) {
    return errorResponse(422, "ข้อมูล Callback C2C ไม่ครบหรือมีรูปแบบไม่ถูกต้อง", "validation_failed");
  }

  try {
    verifyCeloxC2CCallbackSignatureV2(rawBody, timestampHeader, signatureHeader);
  } catch (error) {
    if (error instanceof CeloxError) {
      return errorResponse(error.httpStatus, error.message, error.code);
    }
    return errorResponse(401, "ตรวจลายเซ็น Callback C2C ไม่สำเร็จ", "unauthenticated");
  }

  let queued: Awaited<ReturnType<typeof enqueueCeloxC2CCallbackEvent>>;
  try {
    queued = await enqueueCeloxC2CCallbackEvent(payload, hashRawC2CCallbackBody(rawBody));
  } catch {
    return errorResponse(503, "บันทึก Callback C2C ลงระบบไม่สำเร็จ", "persistence_error");
  }
  if (queued.conflict) {
    return errorResponse(409, "Callback C2C key เดิมมี body ต่างจาก event ที่บันทึกไว้", "callback_conflict");
  }

  if (queued.shouldProcess) {
    after(() => processCeloxC2CCallbackEventWithRetry(queued.eventId));
  }

  const responseBody = {
    received: true,
    duplicate: queued.duplicate,
  } satisfies CeloxC2CCallbackResponse;
  return Response.json(responseBody, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
