import { isCeloxBankCode, type CeloxBankCode } from "./banks";
import type {
  C2CMatchTtlSeconds,
  CeloxFieldError,
  CreateC2CDepositRequest,
  CreateC2CWithdrawalRequest,
} from "./types";

type ParsedRequest<T> = {
  customerId?: string;
  input?: T;
  fieldErrors: CeloxFieldError[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBase(value: unknown) {
  if (!isRecord(value)) {
    return {
      record: null,
      customerId: undefined,
      amount: undefined,
      matchTtlSeconds: undefined,
      referenceId: undefined,
      fieldErrors: [] as CeloxFieldError[],
    };
  }

  const fieldErrors: CeloxFieldError[] = [];
  const amount = value.amount;
  if (!("amount" in value) || amount === null || amount === undefined) {
    fieldErrors.push({ field: "amount", code: "required" });
  } else if (
    typeof amount !== "number"
    || !Number.isFinite(amount)
    || amount <= 0
    || !Number.isSafeInteger(Math.round(amount * 100))
    || Math.abs((amount * 100) - Math.round(amount * 100)) > 1e-8
  ) {
    fieldErrors.push({ field: "amount", code: "invalid" });
  }

  let matchTtlSeconds: C2CMatchTtlSeconds | undefined;
  if ("matchTtlSeconds" in value && value.matchTtlSeconds !== undefined) {
    if (
      typeof value.matchTtlSeconds !== "number"
      || ![300, 600, 900, 1200].includes(value.matchTtlSeconds)
    ) {
      fieldErrors.push({ field: "matchTtlSeconds", code: "invalid" });
    } else {
      matchTtlSeconds = value.matchTtlSeconds as C2CMatchTtlSeconds;
    }
  }

  let referenceId: string | undefined;
  if ("referenceId" in value && value.referenceId !== undefined) {
    if (
      typeof value.referenceId !== "string"
      || value.referenceId.trim().length === 0
      || value.referenceId.trim().length > 200
    ) {
      fieldErrors.push({ field: "referenceId", code: "invalid" });
    } else {
      referenceId = value.referenceId.trim();
    }
  }

  for (const field of ["splitMode", "splitPartAmount", "splitPartCount"] as const) {
    if (field in value) fieldErrors.push({ field, code: "not_supported" });
  }

  const customerId = typeof value.customerId === "string" && value.customerId.trim().length <= 100
    ? value.customerId.trim()
    : undefined;

  return {
    record: value,
    customerId: customerId || undefined,
    amount: typeof amount === "number" ? amount : undefined,
    matchTtlSeconds,
    referenceId,
    fieldErrors,
  };
}

function requiredString(
  record: Record<string, unknown>,
  field: "sourceBankCode" | "sourceAccountName" | "sourceAccountNo"
    | "destinationBankCode" | "destinationAccountName" | "destinationAccountNo",
  fieldErrors: CeloxFieldError[],
) {
  const value = record[field];
  if (!(field in record) || value === null || value === undefined || value === "") {
    fieldErrors.push({ field, code: "required" });
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    fieldErrors.push({ field, code: "invalid" });
    return undefined;
  }
  return value.trim();
}

function accountNumber(
  value: string | undefined,
  field: "sourceAccountNo" | "destinationAccountNo",
  fieldErrors: CeloxFieldError[],
) {
  if (!value) return undefined;
  const normalized = value.replace(/[\s-]/g, "");
  if (!/^\d{10,15}$/.test(normalized)) {
    fieldErrors.push({ field, code: "invalid" });
    return undefined;
  }
  return normalized;
}

function bankCode(
  value: string | undefined,
  field: "sourceBankCode" | "destinationBankCode",
  fieldErrors: CeloxFieldError[],
) {
  if (!value) return undefined;
  if (!isCeloxBankCode(value)) {
    fieldErrors.push({ field, code: "invalid_bank_code" });
    return undefined;
  }
  return value as CeloxBankCode;
}

export function validateCreateC2CDeposit(value: unknown): ParsedRequest<CreateC2CDepositRequest> {
  const base = readBase(value);
  const fieldErrors = [...base.fieldErrors];
  if (!base.record) {
    fieldErrors.push(
      { field: "amount", code: "required" },
      { field: "sourceBankCode", code: "required" },
      { field: "sourceAccountName", code: "required" },
      { field: "sourceAccountNo", code: "required" },
    );
    return { fieldErrors };
  }

  const rawBankCode = requiredString(base.record, "sourceBankCode", fieldErrors);
  const sourceAccountName = requiredString(base.record, "sourceAccountName", fieldErrors);
  const rawAccountNo = requiredString(base.record, "sourceAccountNo", fieldErrors);
  const sourceBankCode = bankCode(rawBankCode, "sourceBankCode", fieldErrors);
  const sourceAccountNo = accountNumber(rawAccountNo, "sourceAccountNo", fieldErrors);
  if (
    fieldErrors.length > 0
    || !base.customerId
    || base.amount === undefined
    || !sourceBankCode
    || !sourceAccountName
    || !sourceAccountNo
  ) {
    return { customerId: base.customerId, fieldErrors };
  }

  return {
    customerId: base.customerId,
    fieldErrors,
    input: {
      amount: base.amount,
      sourceBankCode,
      sourceAccountName,
      sourceAccountNo,
      ...(base.matchTtlSeconds ? { matchTtlSeconds: base.matchTtlSeconds } : {}),
      ...(base.referenceId ? { referenceId: base.referenceId } : {}),
    },
  };
}

export function validateCreateC2CWithdrawal(value: unknown): ParsedRequest<CreateC2CWithdrawalRequest> {
  const base = readBase(value);
  const fieldErrors = [...base.fieldErrors];
  if (!base.record) {
    fieldErrors.push(
      { field: "amount", code: "required" },
      { field: "destinationBankCode", code: "required" },
      { field: "destinationAccountName", code: "required" },
      { field: "destinationAccountNo", code: "required" },
    );
    return { fieldErrors };
  }

  const rawBankCode = requiredString(base.record, "destinationBankCode", fieldErrors);
  const destinationAccountName = requiredString(base.record, "destinationAccountName", fieldErrors);
  const rawAccountNo = requiredString(base.record, "destinationAccountNo", fieldErrors);
  const destinationBankCode = bankCode(rawBankCode, "destinationBankCode", fieldErrors);
  const destinationAccountNo = accountNumber(rawAccountNo, "destinationAccountNo", fieldErrors);
  if (
    fieldErrors.length > 0
    || !base.customerId
    || base.amount === undefined
    || !destinationBankCode
    || !destinationAccountName
    || !destinationAccountNo
  ) {
    return { customerId: base.customerId, fieldErrors };
  }

  return {
    customerId: base.customerId,
    fieldErrors,
    input: {
      amount: base.amount,
      destinationBankCode,
      destinationAccountName,
      destinationAccountNo,
      ...(base.matchTtlSeconds ? { matchTtlSeconds: base.matchTtlSeconds } : {}),
      ...(base.referenceId ? { referenceId: base.referenceId } : {}),
    },
  };
}

// สถานะที่ยังแนบสลิปกับ transactionId เดิมได้: รอจับคู่ รอสลิป หรือสลิปรอบก่อนไม่ผ่าน
// PENDING_APPROVE กับ SUCCESS แนบซ้ำไม่ได้ Celox ตอบ slip_already_submitted
const C2C_SLIP_REATTACHABLE_STATUSES = new Set([
  "PENDING",
  "PENDING_TRANSFER",
  "EXPIRED",
]);

export function canAttachC2CSlip(transactionStatus: string) {
  return C2C_SLIP_REATTACHABLE_STATUSES.has(transactionStatus.trim().toUpperCase());
}

// uploadToken เดินทางใน query string จึงห้ามมีอักขระควบคุมหรือช่องว่างที่ทำให้ URL เพี้ยน
export function isValidC2CUploadToken(value: string) {
  return value.length > 0
    && value.length <= 2_048
    && !/[\u0000-\u0020\u007f]/.test(value);
}
