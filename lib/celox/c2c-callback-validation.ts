import type {
  C2CTransactionPart,
  C2CTransactionResponse,
  C2CTransferTo,
} from "./types";

// ยอมรับ UUID ทุกเวอร์ชัน/variant ที่ Celox ออกให้ (ของจริงเป็น v7 ตามตัวอย่างในคู่มือ)
// ความเข้มงวดของรูปร่าง id ไม่ใช่ชั้นความปลอดภัย — ลายเซ็น v2 เป็นตัวยืนยันตัวตน
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
// raw body ทั้งก้อนถูกเซ็นเป็น opaque bytes อยู่แล้ว (verifyCeloxC2CCallbackSignatureV2)
// ดังนั้น field ที่ไม่รู้จักไม่มีทางทำให้ลายเซ็นพัง — ห้าม reject request เพราะเจอ field แปลกปลอม
// ที่นี่จึงตรวจแค่ว่า field ที่รู้จักมีรูปร่างถูกต้อง ไม่เช็คว่ามี field อื่นปนมาหรือไม่
// (`occurredAt`/`event` ที่ contract ใหม่ถอดออกก็ผ่านทางนี้ ถ้ายังหลุดมาก็เป็นแค่ field ที่ไม่ได้ใช้)
const TRANSFER_TO_KEYS = ["bankCode", "bankName", "accountName", "accountNo"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isNullableBoundedText(value: unknown, maxLength: number) {
  return value === null || isBoundedText(value, maxLength);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;

  return day >= 1
    && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 14
    && offsetMinute <= 59
    && (offsetHour < 14 || offsetMinute === 0)
    && Number.isFinite(Date.parse(value));
}

function isNullableIsoDate(value: unknown) {
  return value === null || isIsoDate(value);
}

function isPositiveCentAmount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && Number.isSafeInteger(Math.round(value * 100))
    && Math.abs((value * 100) - Math.round(value * 100)) <= 1e-8;
}

function isNonNegativeCentAmount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && Number.isSafeInteger(Math.round(value * 100))
    && Math.abs((value * 100) - Math.round(value * 100)) <= 1e-8;
}

function isStatus(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && STATUS_PATTERN.test(value);
}

/**
 * หนึ่งก้อนย่อยของคำขอ — contract ใหม่ถอด `transactionId` ระดับก้อนออก (ยกเลิก/สอบถาม
 * ใช้ id ของทั้งคำขอเสมอ) และเปลี่ยน `status` เป็น `transactionStatus`
 */
function isC2CTransactionPart(value: unknown): value is C2CTransactionPart {
  if (!isRecord(value)) return false;
  return isBoundedText(value.orderId, 200)
    && isPositiveCentAmount(value.amount)
    && isNonNegativeCentAmount(value.feeAmount)
    && isStatus(value.transactionStatus)
    && isNullableIsoDate(value.matchDeadline)
    && isNullableIsoDate(value.matchedAt)
    && isNullableBoundedText(value.cancelReason, 500);
}

function isTransferTo(value: unknown): value is C2CTransferTo {
  if (!isRecord(value)) return false;
  return TRANSFER_TO_KEYS.every((key) => Object.hasOwn(value, key))
    && isNullableBoundedText(value.bankCode, 20)
    && isNullableBoundedText(value.bankName, 200)
    && isNullableBoundedText(value.accountName, 200)
    && isNullableBoundedText(value.accountNo, 30);
}

/**
 * validator ตัวเดียวสำหรับทั้ง body ของ GET /v1/core/c2c/{reference} และ body ของ
 * Callback C2C — Celox ยืนยันว่าสองอย่างนี้เหมือนกัน field ต่อ field
 */
export function isC2CTransactionResponse(value: unknown): value is C2CTransactionResponse {
  if (!isRecord(value)) return false;
  // field ที่คู่มือระบุว่า "present, may be null" ต้องมีคีย์เสมอ ห้ามหายไปทั้งคีย์
  if (!Object.hasOwn(value, "referenceId")) return false;
  if (!Object.hasOwn(value, "unfilledAmount")) return false;
  if (!Object.hasOwn(value, "matchDeadline")) return false;
  if (!Object.hasOwn(value, "parts")) return false;

  const isWithdraw = value.direction === "withdraw";
  // ฝั่งถอนตอบ null ไม่ได้ (0 คือ "ไม่มีอะไรต้องคืน") ฝั่งฝากตอบตัวเลขไม่ได้
  const validUnfilledAmount = isWithdraw
    ? isNonNegativeCentAmount(value.unfilledAmount)
    : value.unfilledAmount === null;
  // transferTo เป็น conditional field: ฝั่งฝากที่ยังโอนได้เท่านั้นที่มี object จริง
  // ฝั่งถอนต้องเป็น null เสมอ และคีย์อาจไม่ถูกส่งมาเลยก็ได้
  const validTransferTo = !Object.hasOwn(value, "transferTo")
    || value.transferTo === null
    || (!isWithdraw && isTransferTo(value.transferTo));
  const validParts = Array.isArray(value.parts)
    && value.parts.length > 0
    && value.parts.every(isC2CTransactionPart);

  return typeof value.transactionId === "string"
    && UUID_PATTERN.test(value.transactionId)
    && isBoundedText(value.orderId, 200)
    && isNullableBoundedText(value.referenceId, 200)
    && (value.direction === "deposit" || isWithdraw)
    && isStatus(value.transactionStatus)
    && isPositiveCentAmount(value.amount)
    && isNonNegativeCentAmount(value.feeAmount)
    && isNonNegativeCentAmount(value.settledAmount)
    && isNonNegativeCentAmount(value.heldAmount)
    && validUnfilledAmount
    && typeof value.awaitingManualReview === "boolean"
    && isNullableIsoDate(value.matchDeadline)
    && validTransferTo
    && validParts;
}

// body ของ callback เหมือน body ของ GET เป๊ะ จึงเป็นฟังก์ชันเดียวกันจริงๆ ไม่ใช่แค่ชื่อพ้อง
export const isCeloxC2CCallbackRequest = isC2CTransactionResponse;
