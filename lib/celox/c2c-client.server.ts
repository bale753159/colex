import "server-only";

import { createHash, createHmac } from "node:crypto";
import { CeloxError } from "./client.server";
import { isValidC2CUploadToken } from "./c2c-validation";
import type {
  C2CAttachSlipOptions,
  C2CDepositSlipResponse,
  C2CTransactionPart,
  C2CTransactionResponse,
  C2CTransactionStatus,
  C2CTransferTo,
  CancelC2CTransactionResponse,
  CeloxErrorCode,
  CeloxFieldError,
  CreateC2CDepositRequest,
  CreateC2CDepositResponse,
  CreateC2CWithdrawalRequest,
  CreateC2CWithdrawalResponse,
} from "./types";

const DEFAULT_BASE_URL = "https://api-stg.celox.app/api/celox";
const C2C_DEPOSIT_PATH = "/v1/core/c2c/deposits";
const C2C_WITHDRAWAL_PATH = "/v1/core/c2c/withdrawals";
const C2C_PATH = "/v1/core/c2c";
const REQUEST_TIMEOUT_MS = 15_000;
// อัปโหลดรูปสลิปกินเวลามากกว่า JSON ปกติ ใช้เพดานเดียวกับ proxy สลิปฝากปกติ
const SLIP_UPLOAD_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4_000;
const MAX_AUTOMATIC_RETRY_AFTER_MS = 10_000;
const EMPTY_BODY_HASH = createHash("sha256").update("", "utf8").digest("hex");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type C2CConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type C2COperation =
  | "create_deposit"
  | "attach_slip"
  | "cancel"
  | "check"
  | "create_withdrawal";

function getConfig(): C2CConfig {
  const clientId = process.env.CELOX_CLIENT_ID?.trim();
  const clientSecret = process.env.CELOX_CLIENT_SECRET?.trim();
  const configuredBaseUrl = process.env.CELOX_BASE_URL?.trim() || DEFAULT_BASE_URL;

  if (!clientId || !clientSecret) {
    throw new CeloxError({
      code: "configuration_error",
      message: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการเชื่อมต่อ Celox",
      httpStatus: 500,
    });
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredBaseUrl);
  } catch (cause) {
    throw new CeloxError({
      code: "configuration_error",
      message: "ค่า CELOX_BASE_URL ไม่ถูกต้อง",
      httpStatus: 500,
      cause,
    });
  }

  if (
    baseUrl.protocol !== "https:"
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash
  ) {
    throw new CeloxError({
      code: "configuration_error",
      message: "ค่า CELOX_BASE_URL ต้องเป็น HTTPS URL ที่ไม่มี credential, query หรือ fragment",
      httpStatus: 500,
    });
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    clientId,
    clientSecret,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableIsoDate(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string"
    && Number.isFinite(Date.parse(value))
  );
}

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readErrorCode(body: unknown) {
  if (!isRecord(body)) return undefined;
  const rawCode = typeof body.code === "string"
    ? body.code
    : typeof body.error === "string"
      ? body.error
      : isRecord(body.error) && typeof body.error.code === "string"
        ? body.error.code
        : undefined;
  if (rawCode) return rawCode.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return undefined;
}

function readFieldErrors(body: unknown): CeloxFieldError[] {
  if (!isRecord(body) || !Array.isArray(body.errors)) return [];
  const acceptedFields = new Set([
    "amount",
    "sourceBankCode",
    "sourceAccountName",
    "sourceAccountNo",
    "destinationBankCode",
    "destinationAccountName",
    "destinationAccountNo",
    "matchTtlSeconds",
    "referenceId",
    "splitMode",
    "splitPartAmount",
    "splitPartCount",
    "file",
  ]);
  const acceptedCodes = new Set([
    "required",
    "invalid",
    "invalid_bank_code",
    "mismatch",
    "not_supported",
    // Celox ส่ง out_of_range เมื่อ amount อยู่นอกช่วงที่อนุญาต ถ้าไม่รับไว้
    // 422 ที่ระบุ field ชัดเจนจะกลายเป็น upstream_error 502 ที่ debug ไม่ได้
    "out_of_range",
  ]);

  return body.errors.flatMap((item) => {
    if (!isRecord(item)) return [];
    const field = typeof item.field === "string" ? item.field : "";
    const code = typeof item.code === "string" ? item.code : "";
    if (!acceptedFields.has(field) || !acceptedCodes.has(code)) return [];
    return [{ field, code } as CeloxFieldError];
  });
}

function readLimitDetails(body: unknown) {
  if (!isRecord(body)) return undefined;
  const source = isRecord(body.details) ? body.details : body;
  const limit = typeof source.limit === "number"
    ? source.limit
    : typeof source.ceiling === "number"
      ? source.ceiling
      : typeof source.maxPending === "number" ? source.maxPending : undefined;
  const current = typeof source.current === "number"
    ? source.current
    : typeof source.count === "number"
      ? source.count
      : typeof source.currentPending === "number" ? source.currentPending : undefined;
  return limit === undefined && current === undefined ? undefined : { limit, current };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseRetryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function jitteredBackoff(attempt: number) {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** attempt));
  return Math.floor(Math.random() * (ceiling + 1));
}

function signedHeaders(
  config: C2CConfig,
  method: "GET" | "POST",
  canonicalPath: string,
  bodyHash: string,
) {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  // Staging ตรวจ path เต็มจาก URL จริง รวม prefix /api/celox ด้วย
  // (เหมือน signer ฝาก–ถอนปกติของโปรเจกต์นี้)
  const canonical = ["v1", method, canonicalPath, timestamp, bodyHash].join("\n");
  const signature = createHmac("sha256", config.clientSecret)
    .update(canonical, "utf8")
    .digest("hex");
  return {
    "X-Api-Key": config.clientId,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
}

function operationLabel(operation: C2COperation) {
  switch (operation) {
    case "create_deposit":
      return "สร้างรายการฝาก C2C";
    case "attach_slip":
      return "แนบสลิปฝาก C2C";
    case "cancel":
      return "ยกเลิกรายการ C2C";
    case "check":
      return "ตรวจสอบรายการ C2C";
    case "create_withdrawal":
      return "สร้างรายการถอน C2C";
  }
}

function c2cErrorFromResponse(
  response: Response,
  body: unknown,
  operation: C2COperation,
): CeloxError {
  const errorCode = readErrorCode(body);
  const fieldErrors = readFieldErrors(body);

  if (response.status === 401) {
    return new CeloxError({
      code: "unauthenticated",
      message: operation === "attach_slip"
        ? "Celox ปฏิเสธสิทธิ์แนบสลิป หรือ uploadToken ไม่ตรงกับรายการนี้"
        : "Celox ปฏิเสธการยืนยันตัวตน กรุณาตรวจสอบ API key ลายเซ็น และเวลาของเซิร์ฟเวอร์",
      httpStatus: 401,
    });
  }

  if (response.status === 403 && errorCode === "c2c_not_enabled_for_organisation") {
    return new CeloxError({
      code: "c2c_not_enabled_for_organisation",
      message: "องค์กรยังไม่ได้เปิดสิทธิ์ C2C สำหรับ API key นี้ กรุณาติดต่อเจ้าหน้าที่ Celox",
      httpStatus: 403,
    });
  }

  if (response.status === 404 && (!errorCode || errorCode === "not_found")) {
    return new CeloxError({
      code: "not_found",
      message: "ไม่พบรายการ C2C นี้ หรือรายการไม่ได้อยู่ในองค์กรของคุณ",
      httpStatus: 404,
    });
  }

  if (response.status === 409 && errorCode === "reference_id_conflict") {
    return new CeloxError({
      code: "reference_id_conflict",
      message: "referenceId นี้เคยถูกใช้ในองค์กรแล้ว Celox จะไม่คืนผลรายการเดิม",
      httpStatus: 409,
    });
  }

  if (response.status === 409 && errorCode === "c2c_busy") {
    return new CeloxError({
      code: "c2c_busy",
      message: "รายการ C2C ถูกล็อกโดยงานจับคู่ชั่วคราว กรุณาลองใหม่อีกครั้ง",
      httpStatus: 409,
      retryable: true,
    });
  }

  if (response.status === 409 && errorCode === "c2c_already_matched") {
    return new CeloxError({
      code: "c2c_already_matched",
      message: "รายการนี้จับคู่แล้วและยกเลิกไม่ได้ ให้รอสลิปหรือรอหมดเวลาจับคู่",
      httpStatus: 409,
    });
  }

  if (response.status === 422) {
    const splitFields = new Set(["splitMode", "splitPartAmount", "splitPartCount"]);
    if (fieldErrors.some((item) => splitFields.has(item.field) && item.code === "not_supported")) {
      return new CeloxError({
        code: "split_not_supported",
        message: "C2C ผ่าน API ไม่รองรับ splitMode, splitPartAmount หรือ splitPartCount",
        httpStatus: 422,
        fieldErrors,
      });
    }
    if (fieldErrors.length > 0) {
      return new CeloxError({
        code: "validation_failed",
        message: "ข้อมูลรายการ C2C ไม่ถูกต้อง กรุณาตรวจสอบช่องที่ระบุ",
        httpStatus: 422,
        fieldErrors,
      });
    }

    const knownErrors: Partial<Record<string, { code: CeloxErrorCode; message: string }>> = {
      c2c_disabled: {
        code: "c2c_disabled",
        message: "Celox ปิดบริการ C2C ทั้งแพลตฟอร์มอยู่ในขณะนี้",
      },
      c2c_duplicate_destination: {
        code: "c2c_duplicate_destination",
        message: "มีรายการ C2C ที่ยังไม่จบสำหรับบัญชีนี้อยู่แล้ว",
      },
      c2c_insufficient_balance: {
        code: "c2c_insufficient_balance",
        message: "ยอดในกระเป๋า operating ไม่พอสำหรับกันเงินต้นและค่าธรรมเนียม C2C",
      },
      invalid_transaction_state: {
        code: "invalid_transaction_state",
        message: "รายการ C2C ไม่ได้อยู่ในสถานะที่ดำเนินการนี้ได้",
      },
      file_required: {
        code: "file_required",
        message: "กรุณาแนบรูปสลิปในช่อง file",
      },
      file_invalid: {
        code: "file_invalid",
        message: "ไฟล์สลิปต้องเป็นรูป JPEG, PNG, WEBP หรือ HEIC",
      },
      deposit_expired: {
        code: "deposit_expired",
        message: "เลยเวลาแนบสลิปของรายการฝาก C2C แล้ว",
      },
      deposit_not_awaiting_transfer: {
        code: "deposit_not_awaiting_transfer",
        message: "รายการฝาก C2C นี้ไม่ได้อยู่ในสถานะรอสลิป",
      },
      slip_already_submitted: {
        code: "slip_already_submitted",
        message: "รายการฝาก C2C นี้มีสลิปที่กำลังตรวจหรือผ่านการตรวจแล้ว",
      },
      slip_verification_failed: {
        code: "slip_verification_failed",
        message: "Celox ตรวจสลิปไม่สำเร็จ กรุณาตรวจไฟล์แล้วแนบใหม่",
      },
    };
    const known = errorCode ? knownErrors[errorCode] : undefined;
    if (known) {
      return new CeloxError({ ...known, httpStatus: 422 });
    }
  }

  if (response.status === 429 && errorCode === "c2c_org_limit_reached") {
    return new CeloxError({
      code: "c2c_org_limit_reached",
      message: "องค์กรมีรายการ C2C ที่ยังไม่จบครบเพดานแล้ว กรุณารอรายการเดิมจบก่อน",
      httpStatus: 429,
      details: readLimitDetails(body),
    });
  }

  if (response.status === 429 && (!errorCode || errorCode === "rate_limited")) {
    return new CeloxError({
      code: "rate_limited",
      message: "ส่งคำขอ C2C ไปยัง Celox ถี่เกินไป กรุณารอแล้วลองใหม่",
      httpStatus: 429,
      retryable: true,
      retryAfterSeconds: parseRetryAfterSeconds(response),
    });
  }

  return new CeloxError({
    code: "upstream_error",
    message: `Celox ตอบกลับด้วยสถานะที่ระบบไม่รองรับขณะ${operationLabel(operation)}`,
    httpStatus: response.status,
  });
}

function isC2CTransactionStatus(value: unknown): value is C2CTransactionStatus {
  return isNonEmptyString(value);
}

function isTransferTo(value: unknown): value is C2CTransferTo {
  return isRecord(value)
    && isNullableString(value.bankCode)
    && isNullableString(value.bankName)
    && isNullableString(value.accountName)
    && isNullableString(value.accountNo);
}

function isCreateC2CDepositResponse(
  value: unknown,
  input: CreateC2CDepositRequest,
): value is CreateC2CDepositResponse {
  if (!isRecord(value)) return false;
  const transferToValid = value.transferTo === null || isTransferTo(value.transferTo);
  return UUID_PATTERN.test(String(value.transactionId))
    && isNonEmptyString(value.orderId)
    && value.referenceId === (input.referenceId ?? null)
    && (value.transactionStatus === "PENDING" || value.transactionStatus === "PENDING_TRANSFER")
    && value.amount === input.amount
    && transferToValid
    && isNullableIsoDate(value.matchDeadline)
    && (value.transactionStatus !== "PENDING_TRANSFER" || value.transferTo !== null);
}

function isCreateC2CWithdrawalResponse(
  value: unknown,
  input: CreateC2CWithdrawalRequest,
): value is CreateC2CWithdrawalResponse {
  if (!isRecord(value)) return false;
  return UUID_PATTERN.test(String(value.transactionId))
    && isNonEmptyString(value.orderId)
    && value.referenceId === (input.referenceId ?? null)
    && ["PENDING", "PENDING_TRANSFER", "PENDING_MANUAL_C2C"].includes(String(value.transactionStatus))
    && value.amount === input.amount
    && isMoney(value.feeAmount)
    // Celox กันเฉพาะค่าธรรมเนียม เงินต้นไหลออกทางคู่ขา C2C จึงไม่ถูก hold
    // reservedAmount ที่ได้จริงคือ feeAmount ตรงกับ heldAmount ที่ GET รายการเดียวกันรายงาน
    // ห้ามบังคับว่าต้องเท่ากับ amount + feeAmount เพราะจะทำให้ 201 กลายเป็น invalid_response
    && isMoney(value.reservedAmount)
    && typeof value.awaitingManualReview === "boolean"
    && isNullableIsoDate(value.matchDeadline);
}

function isCancelC2CResponse(value: unknown, transactionId: string): value is CancelC2CTransactionResponse {
  return isRecord(value)
    && value.transactionId === transactionId
    && isNonEmptyString(value.orderId)
    && isNullableString(value.referenceId)
    && isC2CTransactionStatus(value.transactionStatus)
    && isNullableIsoDate(value.cancelledAt);
}

function isC2CPart(value: unknown): value is C2CTransactionPart {
  return isRecord(value)
    && isNonEmptyString(value.orderId)
    && isMoney(value.amount)
    && isMoney(value.feeAmount)
    && isC2CTransactionStatus(value.transactionStatus)
    && isNullableIsoDate(value.matchDeadline)
    && isNullableIsoDate(value.matchedAt)
    && isNullableString(value.cancelReason);
}

function isC2CTransactionResponse(value: unknown): value is C2CTransactionResponse {
  return isRecord(value)
    && UUID_PATTERN.test(String(value.transactionId))
    && isNonEmptyString(value.orderId)
    && isNullableString(value.referenceId)
    && (value.direction === "deposit" || value.direction === "withdraw")
    && isC2CTransactionStatus(value.transactionStatus)
    && isMoney(value.amount)
    && isMoney(value.feeAmount)
    && isMoney(value.settledAmount)
    && isMoney(value.heldAmount)
    && (value.direction === "withdraw" ? isMoney(value.unfilledAmount) : value.unfilledAmount === null)
    && typeof value.awaitingManualReview === "boolean"
    && isNullableIsoDate(value.matchDeadline)
    && (value.transferTo === null || isTransferTo(value.transferTo))
    && Array.isArray(value.parts)
    && value.parts.length > 0
    && value.parts.every(isC2CPart)
    && (value.direction !== "withdraw" || value.transferTo === null);
}

function isC2CDepositSlipResponse(
  value: unknown,
  transactionId: string,
): value is C2CDepositSlipResponse {
  if (!isRecord(value) || !isRecord(value.slipVerification)) return false;
  // counterparty เป็นฟิลด์แบบมีเงื่อนไข: null เมื่อเข้าบัญชีกลาง และอาจไม่มีคีย์เลยเมื่อยังไม่มีคู่
  const counterpartyValid = value.counterparty === null
    || value.counterparty === undefined
    || (
      isRecord(value.counterparty)
      && isNonEmptyString(value.counterparty.transactionStatus)
    );
  return value.transactionId === transactionId
    && isNonEmptyString(value.orderId)
    && ["SUCCESS", "PENDING_APPROVE", "PENDING_TRANSFER", "EXPIRED"].includes(String(value.transactionStatus))
    && isNonEmptyString(value.slipVerification.outcome)
    && counterpartyValid;
}

async function callSignedJson<T>(options: {
  method: "GET" | "POST";
  path: string;
  rawBody: string;
  operation: C2COperation;
  validate: (body: unknown) => body is T;
  retryBusy?: boolean;
  retryNetwork?: boolean;
  contentType?: boolean;
}): Promise<T> {
  const config = getConfig();
  const url = new URL(`${config.baseUrl}${options.path}`);
  const bodyHash = options.rawBody
    ? createHash("sha256").update(options.rawBody, "utf8").digest("hex")
    : EMPTY_BODY_HASH;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers: {
          ...signedHeaders(config, options.method, url.pathname, bodyHash),
          ...(options.contentType ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.rawBody ? { body: options.rawBody } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      const timedOut = cause instanceof DOMException
        && (cause.name === "TimeoutError" || cause.name === "AbortError");
      if (options.retryNetwork && attempt < MAX_ATTEMPTS - 1) {
        await sleep(jitteredBackoff(attempt));
        continue;
      }
      throw new CeloxError({
        code: timedOut ? "request_timeout" : "network_error",
        message: options.operation === "check"
          ? timedOut
            ? "Celox ไม่ตอบกลับภายในเวลาที่กำหนด กรุณาลองตรวจสอบสถานะอีกครั้ง"
            : "เชื่อมต่อ Celox ไม่สำเร็จ กรุณาลองตรวจสอบสถานะอีกครั้ง"
          : timedOut
            ? `Celox ไม่ตอบกลับระหว่าง${operationLabel(options.operation)} ผลอาจไม่แน่นอน กรุณาอย่าส่งซ้ำ`
            : `การเชื่อมต่อขาดระหว่าง${operationLabel(options.operation)} ผลอาจไม่แน่นอน กรุณาอย่าส่งซ้ำ`,
        httpStatus: timedOut ? 504 : 502,
        retryable: options.operation === "check",
        cause,
      });
    }

    const body = await readJson(response);
    if (response.ok) {
      if (!options.validate(body)) {
        throw new CeloxError({
          code: "invalid_response",
          message: `Celox ${operationLabel(options.operation)}แล้วแต่ตอบกลับข้อมูลไม่ครบถ้วน กรุณาอย่าส่งคำขอซ้ำ`,
          httpStatus: 502,
        });
      }
      return body;
    }

    const error = c2cErrorFromResponse(response, body, options.operation);
    const retryAfterMs = error.retryAfterSeconds === undefined
      ? jitteredBackoff(attempt)
      : error.retryAfterSeconds * 1_000;
    const canRetryRateLimit = error.code === "rate_limited"
      && attempt < MAX_ATTEMPTS - 1
      && retryAfterMs <= MAX_AUTOMATIC_RETRY_AFTER_MS;
    const canRetryBusy = options.retryBusy
      && error.code === "c2c_busy"
      && attempt < MAX_ATTEMPTS - 1;

    if (canRetryRateLimit || canRetryBusy) {
      await sleep(retryAfterMs);
      continue;
    }
    throw error;
  }

  throw new CeloxError({
    code: "rate_limited",
    message: "Celox ยังไม่พร้อมรับคำขอ C2C หลังลองตามนโยบายแล้ว",
    httpStatus: 429,
    retryable: true,
  });
}

export function createC2CDeposit(input: CreateC2CDepositRequest) {
  const rawBody = JSON.stringify(input);
  return callSignedJson<CreateC2CDepositResponse>({
    method: "POST",
    path: C2C_DEPOSIT_PATH,
    rawBody,
    operation: "create_deposit",
    contentType: true,
    retryBusy: true,
    validate: (body): body is CreateC2CDepositResponse => isCreateC2CDepositResponse(body, input),
  });
}

export function createC2CWithdrawal(input: CreateC2CWithdrawalRequest) {
  const rawBody = JSON.stringify(input);
  return callSignedJson<CreateC2CWithdrawalResponse>({
    method: "POST",
    path: C2C_WITHDRAWAL_PATH,
    rawBody,
    operation: "create_withdrawal",
    contentType: true,
    retryBusy: true,
    validate: (body): body is CreateC2CWithdrawalResponse => isCreateC2CWithdrawalResponse(body, input),
  });
}

export function checkC2CTransaction(reference: string) {
  const normalized = reference.trim();
  if (!normalized || normalized.length > 200) {
    throw new CeloxError({
      code: "invalid_request",
      message: "orderId หรือ referenceId ของรายการ C2C ไม่ถูกต้อง",
      httpStatus: 400,
    });
  }
  const path = `${C2C_PATH}/${encodeURIComponent(normalized)}`;
  return callSignedJson<C2CTransactionResponse>({
    method: "GET",
    path,
    rawBody: "",
    operation: "check",
    retryNetwork: true,
    validate: isC2CTransactionResponse,
  });
}

export function cancelC2CTransaction(transactionId: string) {
  if (!UUID_PATTERN.test(transactionId)) {
    throw new CeloxError({
      code: "invalid_request",
      message: "transactionId ของรายการ C2C ไม่ถูกต้อง",
      httpStatus: 400,
    });
  }
  const path = `${C2C_PATH}/${transactionId}/cancel`;
  return callSignedJson<CancelC2CTransactionResponse>({
    method: "POST",
    path,
    rawBody: "",
    operation: "cancel",
    contentType: true,
    retryBusy: true,
    validate: (body): body is CancelC2CTransactionResponse => (
      isCancelC2CResponse(body, transactionId)
    ),
  });
}

export async function attachC2CDepositSlip(
  transactionId: string,
  file: File,
  options: C2CAttachSlipOptions = {},
) {
  if (!UUID_PATTERN.test(transactionId)) {
    throw new CeloxError({
      code: "invalid_request",
      message: "transactionId ของรายการฝาก C2C ไม่ถูกต้อง",
      httpStatus: 400,
    });
  }
  const uploadToken = options.uploadToken?.trim() ?? "";
  if (uploadToken && !isValidC2CUploadToken(uploadToken)) {
    throw new CeloxError({
      code: "invalid_request",
      message: "uploadToken ของรายการฝาก C2C ไม่ถูกต้อง",
      httpStatus: 400,
    });
  }

  const config = getConfig();
  const path = `${C2C_DEPOSIT_PATH}/${transactionId}/slip`;
  const url = new URL(`${config.baseUrl}${path}`);
  // ยืนยันตัวตนได้สองทาง เลือกทางเดียว: ถ้ามี uploadToken ให้ส่ง query อย่างเดียว
  // และไม่ส่ง header ของ Celox เลย ถ้าไม่มีก็ลงลายเซ็นสามตัวตามปกติ
  if (uploadToken) url.searchParams.set("uploadToken", uploadToken);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // สร้าง FormData ใหม่ทุกครั้งที่ลองใหม่ เพราะ body เดิมถูกอ่านไปแล้ว
    // ปล่อยให้ fetch กำหนด boundary เอง ค่า boundary ใน header ต้องตรงกับ body จริง
    // และบนเส้นทางนี้ลายเซ็นไม่ครอบคลุมไฟล์ (body hash = hash ของ body ว่าง) จึงไม่มีผลต่อการเซ็น
    const form = new FormData();
    form.append("file", file, file.name || "slip");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: uploadToken
          ? undefined
          // ลายเซ็นครอบคลุมเมธอด path (ไม่รวม query) และเวลา แต่ไม่ครอบคลุมไฟล์
          : signedHeaders(config, "POST", url.pathname, EMPTY_BODY_HASH),
        body: form,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(SLIP_UPLOAD_TIMEOUT_MS),
      });
    } catch (cause) {
      const timedOut = cause instanceof DOMException
        && (cause.name === "TimeoutError" || cause.name === "AbortError");
      throw new CeloxError({
        code: timedOut ? "request_timeout" : "network_error",
        message: timedOut
          ? "Celox ไม่ตอบกลับระหว่างแนบสลิป ผลอาจถูกบันทึกแล้ว กรุณาตรวจสถานะก่อนแนบซ้ำ"
          : "การเชื่อมต่อขาดระหว่างแนบสลิป ผลอาจถูกบันทึกแล้ว กรุณาตรวจสถานะก่อนแนบซ้ำ",
        httpStatus: timedOut ? 504 : 502,
        cause,
      });
    }

    const body = await readJson(response);
    if (response.ok) {
      if (!isC2CDepositSlipResponse(body, transactionId)) {
        throw new CeloxError({
          code: "invalid_response",
          message: "Celox รับสลิปแล้วแต่ตอบกลับข้อมูลไม่ครบถ้วน กรุณาตรวจสถานะก่อนแนบซ้ำ",
          httpStatus: 502,
        });
      }
      return body;
    }

    const error = c2cErrorFromResponse(response, body, "attach_slip");
    const retryAfterMs = error.retryAfterSeconds === undefined
      ? jitteredBackoff(attempt)
      : error.retryAfterSeconds * 1_000;
    // 429 เท่านั้นที่ลองใหม่ได้เอง 401 / 404 / 422 เป็นความผิดถาวรของคำขอนี้ ห้ามยิงซ้ำ
    const canRetry = error.code === "rate_limited"
      && attempt < MAX_ATTEMPTS - 1
      && retryAfterMs <= MAX_AUTOMATIC_RETRY_AFTER_MS;
    if (!canRetry) throw error;
    await sleep(retryAfterMs);
  }

  throw new CeloxError({
    code: "rate_limited",
    message: "Celox ยังไม่พร้อมรับสลิปหลังลองตามนโยบายแล้ว",
    httpStatus: 429,
    retryable: true,
  });
}
