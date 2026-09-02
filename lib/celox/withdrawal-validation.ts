import { isCeloxBankCode } from "./banks";
import type {
  CeloxFieldError,
  ConfirmWithdrawalRequest,
  CreateWithdrawalRequest,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateWithdrawalRequest(value: unknown): {
  input?: CreateWithdrawalRequest | ConfirmWithdrawalRequest;
  fieldErrors: CeloxFieldError[];
} {
  if (!isRecord(value)) {
    return {
      fieldErrors: [
        { field: "amount", code: "required" },
        { field: "destinationBankCode", code: "required" },
        { field: "destinationAccountName", code: "required" },
        { field: "destinationAccountNo", code: "required" },
      ],
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
    || Math.abs((amount * 100) - Math.round(amount * 100)) > 1e-8
  ) {
    fieldErrors.push({ field: "amount", code: "invalid" });
  }

  const requiredStringFields = [
    "destinationBankCode",
    "destinationAccountName",
    "destinationAccountNo",
  ] as const;
  for (const field of requiredStringFields) {
    const candidate = value[field];
    if (!(field in value) || candidate === null || candidate === undefined || candidate === "") {
      fieldErrors.push({ field, code: "required" });
    } else if (typeof candidate !== "string" || candidate.trim().length === 0) {
      fieldErrors.push({ field, code: "invalid" });
    }
  }

  if (
    typeof value.destinationBankCode === "string"
    && value.destinationBankCode.trim()
    && !isCeloxBankCode(value.destinationBankCode.trim())
  ) {
    fieldErrors.push({ field: "destinationBankCode", code: "invalid_bank_code" });
  }

  const accountNo = typeof value.destinationAccountNo === "string"
    ? value.destinationAccountNo.replace(/[\s-]/g, "")
    : "";
  if (accountNo && !/^\d{10,15}$/.test(accountNo)) {
    fieldErrors.push({ field: "destinationAccountNo", code: "invalid" });
  }

  if (
    "referenceId" in value
    && value.referenceId !== undefined
    && (typeof value.referenceId !== "string" || value.referenceId.trim().length === 0)
  ) {
    fieldErrors.push({ field: "referenceId", code: "invalid" });
  }

  if (fieldErrors.length > 0) return { fieldErrors };

  return {
    fieldErrors,
    input: {
      amount: amount as number,
      destinationBankCode: (value.destinationBankCode as string).trim() as CreateWithdrawalRequest["destinationBankCode"],
      destinationAccountName: (value.destinationAccountName as string).trim(),
      destinationAccountNo: accountNo,
      ...(typeof value.referenceId === "string"
        ? { referenceId: value.referenceId.trim() }
        : {}),
    } as CreateWithdrawalRequest,
  };
}
