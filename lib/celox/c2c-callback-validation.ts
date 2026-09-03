import type {
  C2CCallbackPart,
  CeloxC2CCallbackEventName,
  CeloxC2CCallbackRequest,
  C2CTransferTo,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const CALLBACK_KEYS = new Set([
  "transactionId",
  "orderId",
  "referenceId",
  "status",
  "amount",
  "occurredAt",
  "event",
  "transferTo",
  "parts",
  "unfilledAmount",
]);
const TRANSFER_TO_KEYS = ["bankCode", "bankName", "accountName", "accountNo"] as const;
const PART_KEYS = new Set(["transactionId", "orderId", "amount", "status"]);
const EVENT_NAMES = new Set<CeloxC2CCallbackEventName>([
  "matched",
  "settled",
  "parked",
  "expired",
  "cancelled",
  "failed",
]);

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

function isC2CCallbackPart(value: unknown): value is C2CCallbackPart {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !PART_KEYS.has(key))) return false;
  return typeof value.transactionId === "string"
    && UUID_PATTERN.test(value.transactionId)
    && isBoundedText(value.orderId, 200)
    && isPositiveCentAmount(value.amount)
    && typeof value.status === "string"
    && value.status.length <= 64
    && STATUS_PATTERN.test(value.status);
}

function isTransferTo(value: unknown): value is C2CTransferTo {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !TRANSFER_TO_KEYS.includes(key as typeof TRANSFER_TO_KEYS[number]))) {
    return false;
  }
  return TRANSFER_TO_KEYS.every((key) => Object.hasOwn(value, key))
    && isNullableBoundedText(value.bankCode, 20)
    && isNullableBoundedText(value.bankName, 200)
    && isNullableBoundedText(value.accountName, 200)
    && isNullableBoundedText(value.accountNo, 30);
}

export function isCeloxC2CCallbackRequest(value: unknown): value is CeloxC2CCallbackRequest {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !CALLBACK_KEYS.has(key))) return false;
  if (!Object.hasOwn(value, "referenceId") || !Object.hasOwn(value, "occurredAt")) return false;
  if (!Object.hasOwn(value, "parts")) return false;

  const validEvent = !Object.hasOwn(value, "event")
    || (typeof value.event === "string" && EVENT_NAMES.has(value.event as CeloxC2CCallbackEventName));
  const validTransferTo = !Object.hasOwn(value, "transferTo") || isTransferTo(value.transferTo);
  const validParts = Array.isArray(value.parts)
    && value.parts.length > 0
    && value.parts.every(isC2CCallbackPart);
  const validUnfilledAmount = !Object.hasOwn(value, "unfilledAmount")
    || isNonNegativeCentAmount(value.unfilledAmount);

  return typeof value.transactionId === "string"
    && UUID_PATTERN.test(value.transactionId)
    && isBoundedText(value.orderId, 200)
    && (value.referenceId === null || isBoundedText(value.referenceId, 200))
    && typeof value.status === "string"
    && value.status.length <= 64
    && STATUS_PATTERN.test(value.status)
    && isPositiveCentAmount(value.amount)
    && (value.occurredAt === null || isIsoDate(value.occurredAt))
    && validEvent
    && validTransferTo
    && validParts
    && validUnfilledAmount;
}
