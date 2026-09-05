import "server-only";

import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CeloxC2CCallbackRequest } from "./types";
import { CeloxError } from "./client.server";
import {
  markCeloxC2CCallbackEventFailed,
  processCeloxC2CCallbackEvent,
} from "../db";

const MAX_PROCESSING_ATTEMPTS = 3;
const RETRY_JITTER_CAPS_MS = [500, 1_000] as const;

function callbackSecret() {
  const secret = process.env.CELOX_C2C_CALLBACK_SECRET?.trim()
    || process.env.CELOX_CALLBACK_SECRET?.trim()
    || process.env.CELOX_CLIENT_SECRET?.trim();
  if (!secret) {
    throw new CeloxError({
      code: "configuration_error",
      message: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า CELOX_C2C_CALLBACK_SECRET, CELOX_CALLBACK_SECRET หรือ CELOX_CLIENT_SECRET",
      httpStatus: 500,
    });
  }
  return secret;
}

/**
 * C2C signs six fields in this exact order. `event` is deliberately excluded;
 * `transferTo`, `parts` and `unfilledAmount` are appended, in that order,
 * only when the incoming body actually contains that key.
 */
export function canonicalizeCeloxC2CCallback(payload: CeloxC2CCallbackRequest) {
  const signedPayload: Record<string, unknown> = {
    transactionId: payload.transactionId,
    orderId: payload.orderId,
    referenceId: payload.referenceId,
    status: payload.status,
    amount: payload.amount,
    occurredAt: payload.occurredAt,
  };
  if (Object.hasOwn(payload, "transferTo")) {
    const transferTo = payload.transferTo;
    signedPayload.transferTo = {
      bankCode: transferTo?.bankCode ?? null,
      bankName: transferTo?.bankName ?? null,
      accountName: transferTo?.accountName ?? null,
      accountNo: transferTo?.accountNo ?? null,
    };
  }
  if (Object.hasOwn(payload, "parts")) {
    signedPayload.parts = payload.parts.map((part) => ({
      transactionId: part.transactionId,
      orderId: part.orderId,
      amount: part.amount,
      status: part.status,
    }));
  }
  if (Object.hasOwn(payload, "unfilledAmount")) {
    signedPayload.unfilledAmount = payload.unfilledAmount;
  }
  return JSON.stringify(signedPayload);
}

export function hashCeloxC2CCallbackPayload(payload: CeloxC2CCallbackRequest) {
  return createHash("sha256").update(canonicalizeCeloxC2CCallback(payload), "utf8").digest("hex");
}

export function verifyCeloxC2CCallbackSignature(
  payload: CeloxC2CCallbackRequest,
  headerValue: string | null,
) {
  const supplied = headerValue?.trim().toLowerCase().replace(/^sha256=/, "") ?? "";
  if (!/^[0-9a-f]{64}$/.test(supplied)) {
    throw new CeloxError({
      code: "unauthenticated",
      message: "X-Celox-Signature หายไปหรือมีรูปแบบไม่ถูกต้อง",
      httpStatus: 401,
    });
  }

  const expected = createHmac("sha256", callbackSecret())
    .update(canonicalizeCeloxC2CCallback(payload), "utf8")
    .digest();
  const received = Buffer.from(supplied, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new CeloxError({
      code: "unauthenticated",
      message: "ลายเซ็น Callback C2C จาก Celox ไม่ถูกต้อง",
      httpStatus: 401,
    });
  }
}

function isRetryableSqliteError(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "ประมวลผล Callback C2C ไม่สำเร็จ";
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function processCeloxC2CCallbackEventWithRetry(eventId: number) {
  for (let attempt = 0; attempt < MAX_PROCESSING_ATTEMPTS; attempt += 1) {
    try {
      return await processCeloxC2CCallbackEvent(eventId);
    } catch (error) {
      const canRetry = isRetryableSqliteError(error) && attempt < MAX_PROCESSING_ATTEMPTS - 1;
      if (canRetry) {
        const cap = RETRY_JITTER_CAPS_MS[attempt] ?? RETRY_JITTER_CAPS_MS.at(-1) ?? 1_000;
        await sleep(Math.floor(Math.random() * (cap + 1)));
        continue;
      }
      try {
        await markCeloxC2CCallbackEventFailed(eventId, errorMessage(error), attempt + 1);
      } catch (markError) {
        console.error("บันทึกสถานะ Callback C2C ที่ประมวลผลไม่สำเร็จไม่ได้", markError);
      }
      return null;
    }
  }
  return null;
}
