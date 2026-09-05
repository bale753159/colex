import "server-only";

import { after } from "next/server";
import {
  hashCeloxC2CCallbackPayload,
  processCeloxC2CCallbackEventWithRetry,
  verifyCeloxC2CCallbackSignature,
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

export function looksLikeCeloxC2CCallback(value: unknown) {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.hasOwn(value, "event") || Object.hasOwn(value, "transferTo"));
}

export async function acceptCeloxC2CCallbackPayload(
  payload: unknown,
  signatureHeader: string | null,
) {
  if (!isCeloxC2CCallbackRequest(payload)) {
    return errorResponse(422, "ข้อมูล Callback C2C ไม่ครบหรือมีรูปแบบไม่ถูกต้อง", "validation_failed");
  }

  try {
    verifyCeloxC2CCallbackSignature(payload, signatureHeader);
  } catch (error) {
    if (error instanceof CeloxError) {
      return errorResponse(error.httpStatus, error.message, error.code);
    }
    return errorResponse(401, "ตรวจลายเซ็น Callback C2C ไม่สำเร็จ", "unauthenticated");
  }

  let queued: Awaited<ReturnType<typeof enqueueCeloxC2CCallbackEvent>>;
  try {
    queued = await enqueueCeloxC2CCallbackEvent(payload, hashCeloxC2CCallbackPayload(payload));
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
