import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { CeloxError } from "./client.server";
import { markCeloxCallbackEventFailed, processCeloxCallbackEvent } from "../db";

const MAX_PROCESSING_ATTEMPTS = 3;
const RETRY_JITTER_CAPS_MS = [500, 1_000] as const;

function callbackSecret() {
  const secret = process.env.CELOX_CALLBACK_SECRET?.trim()
    || process.env.CELOX_CLIENT_SECRET?.trim();
  if (!secret) {
    throw new CeloxError({
      code: "configuration_error",
      message: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า CELOX_CALLBACK_SECRET หรือ CELOX_CLIENT_SECRET",
      httpStatus: 500,
    });
  }
  return secret;
}

export function verifyCeloxCallbackSignature(rawBody: Uint8Array, headerValue: string | null) {
  const supplied = headerValue?.trim().toLowerCase().replace(/^sha256=/, "") ?? "";
  if (!/^[0-9a-f]{64}$/.test(supplied)) {
    throw new CeloxError({
      code: "unauthenticated",
      message: "X-Celox-Signature หายไปหรือมีรูปแบบไม่ถูกต้อง",
      httpStatus: 401,
    });
  }

  const expected = createHmac("sha256", callbackSecret()).update(rawBody).digest();
  const received = Buffer.from(supplied, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new CeloxError({
      code: "unauthenticated",
      message: "ลายเซ็น callback จาก Celox ไม่ถูกต้อง",
      httpStatus: 401,
    });
  }
}

// Postgres ใส่ SQLSTATE ไว้ที่ property `code` ของ error (ยืนยันแล้วทั้งจาก `pg` และ PGlite)
// 40001 = serialization_failure, 40P01 = deadlock_detected — สองรหัสนี้เท่านั้นที่ควรลองใหม่
// เพราะเป็นความขัดแย้งชั่วคราวจาก concurrency ไม่ใช่ error ถาวร ถ้า error ไม่มีรูปร่างที่รู้จัก
// ให้ถือว่าลองใหม่ไม่ได้ ไม่ throw ซ้ำ
export function isRetryablePostgresError(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "40001" || error.code === "40P01";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "ประมวลผล callback ไม่สำเร็จ";
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function processCeloxCallbackEventWithRetry(eventId: number) {
  for (let attempt = 0; attempt < MAX_PROCESSING_ATTEMPTS; attempt += 1) {
    try {
      return await processCeloxCallbackEvent(eventId);
    } catch (error) {
      const canRetry = isRetryablePostgresError(error) && attempt < MAX_PROCESSING_ATTEMPTS - 1;
      if (canRetry) {
        const cap = RETRY_JITTER_CAPS_MS[attempt] ?? RETRY_JITTER_CAPS_MS.at(-1) ?? 1_000;
        await sleep(Math.floor(Math.random() * (cap + 1)));
        continue;
      }
      try {
        await markCeloxCallbackEventFailed(eventId, errorMessage(error), attempt + 1);
      } catch (markError) {
        console.error("บันทึกสถานะ callback ที่ประมวลผลไม่สำเร็จไม่ได้", markError);
      }
      return null;
    }
  }
  return null;
}
