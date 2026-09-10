import type {
  C2CTransactionPart,
  C2CTransactionResponse,
  C2CTransferTo,
  CeloxC2CCallbackRequest,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isNullableBoundedText(value: unknown, maxLength: number) {
  return value === null || isBoundedText(value, maxLength);
}

function isStatus(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && STATUS_PATTERN.test(value);
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

function isNullableIsoDate(value: unknown): value is string | null {
  return value === null || isIsoDate(value);
}

function isCentAmount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isSafeInteger(Math.round(value * 100))
    && Math.abs((value * 100) - Math.round(value * 100)) <= 1e-8;
}

function isPositiveCentAmount(value: unknown): value is number {
  return isCentAmount(value) && value > 0;
}

function isNonNegativeCentAmount(value: unknown): value is number {
  return isCentAmount(value) && value >= 0;
}

/**
 * `parts[]` ในสัญญาใหม่ไม่มี `transactionId` แล้ว (ทุกก้อนอยู่ใต้คำขอเดียวกัน จึงใช้ id ของหัวคำขอ)
 * และเปลี่ยนชื่อ `status` เป็น `transactionStatus` เหมือนหัว body
 */
function isC2CTransactionPart(value: unknown): value is C2CTransactionPart {
  return isRecord(value)
    && isBoundedText(value.orderId, 200)
    && isNonNegativeCentAmount(value.amount)
    && isNonNegativeCentAmount(value.feeAmount)
    && isStatus(value.transactionStatus)
    && Object.hasOwn(value, "matchDeadline")
    && isNullableIsoDate(value.matchDeadline)
    && Object.hasOwn(value, "matchedAt")
    && isNullableIsoDate(value.matchedAt)
    && Object.hasOwn(value, "cancelReason")
    && isNullableBoundedText(value.cancelReason, 500);
}

function isTransferTo(value: unknown): value is C2CTransferTo {
  return isRecord(value)
    && isNullableBoundedText(value.bankCode, 20)
    && isNullableBoundedText(value.bankName, 200)
    && isNullableBoundedText(value.accountName, 200)
    && isNullableBoundedText(value.accountNo, 30);
}

/**
 * ตัวตัดสินเดียวของสองฝั่ง: body ของ `GET /v1/core/c2c/{reference}` กับ body ของ Callback C2C
 * เป็นรูปแบบเดียวกันทุก field ตั้งแต่สัญญาใหม่
 *
 * ห้าม reject เพราะเจอ field ที่ไม่รู้จัก — ลายเซ็นคุ้ม raw body ทั้งก้อนอยู่แล้ว field ใหม่ที่
 * Celox เพิ่มภายหลังจึงต้องไหลผ่านได้ ไม่ใช่กลายเป็น 422 ที่ Celox จะยิงซ้ำไปเรื่อย ๆ
 */
export function isC2CTransactionResponse(value: unknown): value is C2CTransactionResponse {
  if (!isRecord(value)) return false;

  const direction = value.direction;
  if (direction !== "deposit" && direction !== "withdraw") return false;

  // `transferTo` เป็น field แบบมีเงื่อนไข — ขาถอนเป็น null เสมอ ขาฝากที่ยังไม่ถูกจับคู่อาจไม่ส่งมาเลย
  const validTransferTo = !Object.hasOwn(value, "transferTo")
    || value.transferTo === null
    || (direction === "deposit" && isTransferTo(value.transferTo));

  // ขาถอนต้องมีตัวเลขเสมอ (0 เมื่อไม่มีอะไรค้างคืน) ขาฝากเป็น null เสมอ — ทั้งสองกรณีต้องมีคีย์
  const validUnfilledAmount = Object.hasOwn(value, "unfilledAmount")
    && (direction === "withdraw"
      ? isNonNegativeCentAmount(value.unfilledAmount)
      : value.unfilledAmount === null);

  return typeof value.transactionId === "string"
    && UUID_PATTERN.test(value.transactionId)
    && isBoundedText(value.orderId, 200)
    && Object.hasOwn(value, "referenceId")
    && isNullableBoundedText(value.referenceId, 200)
    && isStatus(value.transactionStatus)
    && isPositiveCentAmount(value.amount)
    && isNonNegativeCentAmount(value.feeAmount)
    && isNonNegativeCentAmount(value.settledAmount)
    && isNonNegativeCentAmount(value.heldAmount)
    && validUnfilledAmount
    && typeof value.awaitingManualReview === "boolean"
    && Object.hasOwn(value, "matchDeadline")
    && isNullableIsoDate(value.matchDeadline)
    && validTransferTo
    && Array.isArray(value.parts)
    && value.parts.length > 0
    && value.parts.every(isC2CTransactionPart);
}

/** Callback C2C ใช้ body รูปแบบเดียวกับ GET ทุกประการ — ตัวนี้เป็นเพียงชื่อเรียกตามบริบท */
export const isCeloxC2CCallbackRequest =
  isC2CTransactionResponse as (value: unknown) => value is CeloxC2CCallbackRequest;

const TERMINAL_STATUSES = new Set(["SUCCESS", "EXPIRED", "CANCELLED"]);

export function isC2CTerminalStatus(status: string) {
  return TERMINAL_STATUSES.has(status);
}

/**
 * สัญญาณเดียวที่บอกว่าคำขอปิดจริงคือ "ทุกก้อนใน parts ถึง terminal แล้ว"
 * `transactionStatus` ที่หัว body เป็น roll-up ที่กลายเป็น SUCCESS ตั้งแต่ก้อนแรกสำเร็จ
 * จึงห้ามใช้เป็นสัญญาณขยับเงิน
 */
export function areAllC2CPartsTerminal(parts: readonly { transactionStatus: string }[]) {
  return parts.length > 0 && parts.every((part) => isC2CTerminalStatus(part.transactionStatus));
}
