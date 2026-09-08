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
 * แยก callback C2C ออกจาก callback ปกติบน endpoint กลาง `/api/celox/callback`
 *
 * `parts` เป็นตัวชี้ขาด เพราะสเปคระบุว่ามีอยู่ในทุก callback C2C เสมอทั้งฝั่งฝากและถอน
 * (แม้รายการไม่เคยถูก split ก็ยังได้ array หนึ่งสมาชิก) ส่วน callback ปกติมีแค่หก field
 * (`CeloxCallbackRequest`) ไม่มี `parts` เลย
 *
 * เดิมดูแค่ `event`/`transferTo` ซึ่งพลาดของจริง: `event` เป็น conditional ตามสเปค และ
 * `transferTo` มีเฉพาะฝั่งฝากที่ยังโอนได้ ทำให้ callback ถอน C2C สถานะ PENDING_MANUAL_C2C
 * ที่ยังไม่จับคู่ (ไม่มีทั้งสอง field) ตกไปเข้า verifier ของ callback ปกติ ซึ่งเซ็น raw body
 * เปล่าๆ ไม่มี material "v2\n<timestamp>\n<bodyHash>" จึงถูกปฏิเสธด้วย 401 ทุกครั้ง
 */
export function looksLikeCeloxC2CCallback(value: unknown) {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Array.isArray((value as Record<string, unknown>).parts)
      || Object.hasOwn(value, "event")
      || Object.hasOwn(value, "transferTo"));
}

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
    return errorResponse(409, "Callback C2C key เดิมมี signed payload ต่างจาก event ที่บันทึกไว้", "callback_conflict");
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
