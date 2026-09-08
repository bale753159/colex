import "server-only";

import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CeloxError } from "./client.server";
import {
  markCeloxC2CCallbackEventFailed,
  processCeloxC2CCallbackEvent,
} from "../db";

const MAX_PROCESSING_ATTEMPTS = 3;
const RETRY_JITTER_CAPS_MS = [500, 1_000] as const;
// กันการ replay callback ที่ดักจับไว้ก่อนหน้ามายิงซ้ำทีหลัง — ต้องเช็คแม้ลายเซ็นจะตรง
const REPLAY_WINDOW_SECONDS = 300;

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

function unauthenticated(message: string): never {
  throw new CeloxError({ code: "unauthenticated", message, httpStatus: 401 });
}

// ใช้เป็น fingerprint กันข้อมูลซ้ำเวลาบันทึกลง inbox เท่านั้น ไม่เกี่ยวกับการยืนยันตัวตน
// เซ็น raw bytes ทั้งก้อนตรงๆ จึงไม่มีวันตกยุคเมื่อ Celox เพิ่ม field ใหม่ในอนาคต
export function hashRawC2CCallbackBody(rawBody: string) {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * v2: material = "v2" + "\n" + X-Celox-Timestamp (verbatim) + "\n" + sha256hex(raw body)
 * เซ็น raw body ทั้งก้อนเป็น opaque bytes — ไม่มี field list ให้ sync ตามเมื่อ Celox เพิ่ม
 * field ใหม่ ต่างจาก scheme เดิมที่เซ็นเฉพาะ field ที่เลือกมา
 *
 * นโยบายของโปรเจกต์นี้: บังคับต้องมีทั้ง X-Celox-Timestamp และ X-Celox-Signature เสมอ
 * แม้ Celox เอกสารจะระบุว่า verification เป็น optional และอาจไม่ส่ง header ทั้งคู่มาเมื่อ
 * credential เก่าเกินไป — เรายอมรับความเสี่ยงนั้นไม่ได้เพราะ callback นี้เกี่ยวกับการหักเงินจริง
 */
export function verifyCeloxC2CCallbackSignatureV2(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
) {
  if (!timestampHeader) unauthenticated("X-Celox-Timestamp หายไป");
  if (!signatureHeader) unauthenticated("X-Celox-Signature หายไป");

  if (!/^\d+$/.test(timestampHeader)) {
    unauthenticated("X-Celox-Timestamp มีรูปแบบไม่ถูกต้อง");
  }
  const timestampSeconds = Number(timestampHeader);
  const skewSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (skewSeconds > REPLAY_WINDOW_SECONDS) {
    unauthenticated("X-Celox-Timestamp ห่างจากเวลาปัจจุบันเกินกำหนด (ป้องกัน replay)");
  }

  const supplied = signatureHeader.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(supplied)) {
    unauthenticated("X-Celox-Signature มีรูปแบบไม่ถูกต้อง");
  }

  const bodyHash = hashRawC2CCallbackBody(rawBody);
  const material = `v2\n${timestampHeader}\n${bodyHash}`;
  const expected = createHmac("sha256", callbackSecret()).update(material, "utf8").digest();
  const received = Buffer.from(supplied, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    unauthenticated("ลายเซ็น Callback C2C จาก Celox ไม่ถูกต้อง");
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
      const canRetry = isRetryablePostgresError(error) && attempt < MAX_PROCESSING_ATTEMPTS - 1;
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
