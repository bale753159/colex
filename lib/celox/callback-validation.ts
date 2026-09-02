import type { CeloxCallbackRequest } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
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

export function isCeloxCallbackRequest(value: unknown): value is CeloxCallbackRequest {
  if (!isRecord(value)) return false;
  if (!Object.hasOwn(value, "referenceId") || !Object.hasOwn(value, "occurredAt")) return false;

  const validOccurredAt = value.occurredAt === null || isIsoDate(value.occurredAt);
  return typeof value.transactionId === "string"
    && UUID_PATTERN.test(value.transactionId)
    && isBoundedText(value.orderId, 200)
    && (value.referenceId === null || isBoundedText(value.referenceId, 200))
    && typeof value.status === "string"
    && value.status.length <= 64
    && STATUS_PATTERN.test(value.status)
    && isPositiveCentAmount(value.amount)
    && validOccurredAt
    && (value.status !== "SUCCESS" || isIsoDate(value.occurredAt));
}
