import type { DepositSlipResponse } from "./types";

type ExpectedDeposit = {
  transactionId: string;
  orderId: string;
  amount: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string"
    && ISO_DATE_PATTERN.test(value)
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

export function isDepositSlipResponse(
  value: unknown,
  expected: ExpectedDeposit,
): value is DepositSlipResponse {
  if (!isRecord(value) || !isRecord(value.callback) || !isRecord(value.slipVerification)) return false;

  const verification = value.slipVerification;
  const validVerification = (verification.outcome === "match"
      && (verification.transRef === undefined || typeof verification.transRef === "string"))
    || (verification.outcome === "mismatch"
      && Array.isArray(verification.mismatchedFields)
      && verification.mismatchedFields.every((item) => typeof item === "string"))
    || (verification.outcome === "unverified" && typeof verification.reason === "string");
  const validHttpStatus = value.callback.httpStatus === null
    || (typeof value.callback.httpStatus === "number"
      && Number.isInteger(value.callback.httpStatus)
      && value.callback.httpStatus >= 100
      && value.callback.httpStatus <= 599);
  const validStatusCombination = value.transactionStatus === "SUCCESS"
    ? verification.outcome === "match"
      && isIsoDate(value.occurredAt)
      && isPositiveCentAmount(value.receivedAmount)
      && value.receivedAmount === expected.amount
    : value.transactionStatus === "PENDING_APPROVE"
      ? value.feeAmount === 0 && value.occurredAt === null
      : true;

  return UUID_PATTERN.test(String(value.transactionId))
    && value.transactionId === expected.transactionId
    && value.orderId === expected.orderId
    && ["SUCCESS", "PENDING_APPROVE", "PENDING_TRANSFER", "EXPIRED"].includes(String(value.transactionStatus))
    && value.amount === expected.amount
    && (isNonNegativeCentAmount(value.receivedAmount) || value.receivedAmount === null)
    && isNonNegativeCentAmount(value.feeAmount)
    && isNonNegativeCentAmount(value.walletBalance)
    && validVerification
    && validStatusCombination
    && (isIsoDate(value.occurredAt) || value.occurredAt === null)
    && ["SUCCESS", "FAILED", "PENDING"].includes(String(value.callback.callbackStatus))
    && validHttpStatus;
}
