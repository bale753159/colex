import "server-only";

import { createHash, createHmac } from "node:crypto";
import type {
  CeloxErrorCode,
  CeloxFieldError,
  ConfirmWithdrawalRequest,
  ConfirmWithdrawalResponse,
  CreateDepositRequest,
  CreateDepositResponse,
  CreateWithdrawalRequest,
  CreateWithdrawalResponse,
} from "./types";

const DEFAULT_BASE_URL = "https://api-stg.celox.app/api/celox";
const CREATE_DEPOSIT_PATH = "/v1/core/deposits";
const CREATE_WITHDRAWAL_PATH = "/v1/core/withdrawals";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4_000;
const MAX_AUTOMATIC_RETRY_AFTER_MS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CeloxConfig = {
  baseUrl: string;
  uploadOrigin: string;
  clientId: string;
  clientSecret: string;
};

type CeloxErrorOptions = {
  code: CeloxErrorCode;
  message: string;
  httpStatus: number;
  retryable?: boolean;
  fieldErrors?: CeloxFieldError[];
  retryAfterSeconds?: number;
  details?: {
    limit?: number;
    current?: number;
  };
  cause?: unknown;
};

export class CeloxError extends Error {
  readonly code: CeloxErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly fieldErrors?: CeloxFieldError[];
  readonly retryAfterSeconds?: number;
  readonly details?: {
    limit?: number;
    current?: number;
  };

  constructor(options: CeloxErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "CeloxError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? false;
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

function getConfig(): CeloxConfig {
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

  const configuredUploadOrigin = process.env.CELOX_UPLOAD_ORIGIN?.trim() || baseUrl.origin;
  let uploadOrigin: URL;
  try {
    uploadOrigin = new URL(configuredUploadOrigin);
  } catch (cause) {
    throw new CeloxError({
      code: "configuration_error",
      message: "ค่า CELOX_UPLOAD_ORIGIN ไม่ถูกต้อง",
      httpStatus: 500,
      cause,
    });
  }

  if (
    uploadOrigin.protocol !== "https:"
    || uploadOrigin.username
    || uploadOrigin.password
    || uploadOrigin.pathname !== "/"
    || uploadOrigin.search
    || uploadOrigin.hash
  ) {
    throw new CeloxError({
      code: "configuration_error",
      message: "ค่า CELOX_UPLOAD_ORIGIN ต้องเป็น HTTPS origin ที่ไม่มี path, credential, query หรือ fragment",
      httpStatus: 500,
    });
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    uploadOrigin: uploadOrigin.origin,
    clientId,
    clientSecret,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorCode(body: unknown) {
  if (!isRecord(body)) return undefined;
  if (typeof body.code === "string") return body.code;
  if (typeof body.error === "string") return body.error;
  if (isRecord(body.error) && typeof body.error.code === "string") return body.error.code;
  return undefined;
}

function readFieldErrors(body: unknown): CeloxFieldError[] {
  if (!isRecord(body) || !Array.isArray(body.errors)) return [];

  const acceptedFields = new Set([
    "amount",
    "sourceBankCode",
    "sourceAccountName",
    "sourceAccountNo",
  ]);
  const acceptedCodes = new Set(["required", "invalid", "invalid_bank_code"]);

  return body.errors.flatMap((item) => {
    if (
      !isRecord(item)
      || typeof item.field !== "string"
      || typeof item.code !== "string"
      || !acceptedFields.has(item.field)
      || !acceptedCodes.has(item.code)
    ) {
      return [];
    }
    return [{ field: item.field, code: item.code } as CeloxFieldError];
  });
}

function readWithdrawalFieldErrors(
  body: unknown,
  acceptedCodes: ReadonlySet<string>,
): CeloxFieldError[] {
  if (!isRecord(body) || !Array.isArray(body.errors)) return [];

  const acceptedFields = new Set([
    "amount",
    "destinationBankCode",
    "destinationAccountName",
    "destinationAccountNo",
    "referenceId",
  ]);

  return body.errors.flatMap((item) => {
    if (
      !isRecord(item)
      || typeof item.field !== "string"
      || typeof item.code !== "string"
      || !acceptedFields.has(item.field)
      || !acceptedCodes.has(item.code)
    ) {
      return [];
    }
    return [{ field: item.field, code: item.code } as CeloxFieldError];
  });
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

function rateLimitedError(retryAfterSeconds?: number) {
  return new CeloxError({
    code: "rate_limited",
    message: "ส่งคำขอไปยัง Celox ถี่เกินไป กรุณารอแล้วลองใหม่",
    httpStatus: 429,
    retryable: true,
    retryAfterSeconds,
  });
}

function errorFromResponse(response: Response, body: unknown): CeloxError {
  const errorCode = readErrorCode(body);

  if (response.status === 401) {
    return new CeloxError({
      code: "unauthenticated",
      message: "Celox ปฏิเสธการยืนยันตัวตน กรุณาตรวจสอบ API key ลายเซ็น และเวลาของเซิร์ฟเวอร์",
      httpStatus: 401,
    });
  }

  if (response.status === 409 && (!errorCode || errorCode === "reference_id_conflict")) {
    return new CeloxError({
      code: "reference_id_conflict",
      message: "referenceId นี้ถูกใช้สร้างรายการฝากแล้ว",
      httpStatus: 409,
    });
  }

  if (response.status === 422) {
    const fieldErrors = readFieldErrors(body);
    if (fieldErrors.length > 0) {
      return new CeloxError({
        code: "validation_failed",
        message: "ข้อมูลรายการฝากไม่ถูกต้อง กรุณาตรวจสอบช่องที่ระบุ",
        httpStatus: 422,
        fieldErrors,
      });
    }

    if (errorCode === "no_active_system_bank_account") {
      return new CeloxError({
        code: "no_active_system_bank_account",
        message: "ขณะนี้ Celox ไม่มีบัญชีรับเงินที่พร้อมใช้งาน",
        httpStatus: 422,
      });
    }
  }

  return new CeloxError({
    code: "upstream_error",
    message: "Celox ตอบกลับด้วยสถานะที่ระบบไม่รองรับ",
    httpStatus: response.status,
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isCreateDepositResponse(
  value: unknown,
  input: CreateDepositRequest,
  createUrl: URL,
  expectedUploadOrigin: string,
): value is CreateDepositResponse {
  if (!isRecord(value) || !isRecord(value.receivingAccount) || !isRecord(value.slipUpload)) {
    return false;
  }

  const receivingAccount = value.receivingAccount;
  const slipUpload = value.slipUpload;
  if (!UUID_PATTERN.test(String(value.transactionId)) || !isNonEmptyString(slipUpload.uploadUrl)) {
    return false;
  }

  let uploadUrl: URL;
  try {
    uploadUrl = new URL(slipUpload.uploadUrl);
  } catch {
    return false;
  }

  const expectedReferenceId = input.referenceId ?? null;
  return uploadUrl.protocol === "https:"
    && uploadUrl.origin === expectedUploadOrigin
    && !uploadUrl.username
    && !uploadUrl.password
    && uploadUrl.pathname === `${createUrl.pathname}/${value.transactionId}/slip`
    && Boolean(uploadUrl.searchParams.get("uploadToken")?.trim())
    && uploadUrl.searchParams.size === 1
    && !uploadUrl.hash
    && isNonEmptyString(value.orderId)
    && value.referenceId === expectedReferenceId
    && value.transactionStatus === "PENDING_TRANSFER"
    && value.amount === input.amount
    && isNonEmptyString(receivingAccount.bankCode)
    && isNonEmptyString(receivingAccount.bankName)
    && isNonEmptyString(receivingAccount.accountName)
    && isNonEmptyString(receivingAccount.accountNo)
    && isIsoDate(value.expiresAt)
    && isIsoDate(slipUpload.expiresAt)
    && value.expiresAt === slipUpload.expiresAt;
}

export function getCeloxUploadPolicy() {
  const config = getConfig();
  const createUrl = new URL(`${config.baseUrl}${CREATE_DEPOSIT_PATH}`);
  return {
    origin: config.uploadOrigin,
    pathPrefix: createUrl.pathname,
  };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function jitteredBackoff(attempt: number) {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** attempt));
  return Math.floor(Math.random() * (ceiling + 1));
}

/**
 * workerd ไม่รับ `redirect: "error"` — มันโยน TypeError ตั้งแต่ก่อนเปิด socket
 * ("won't be implemented since it does not make sense at the edge") ทำให้ทุกคำขอที่ยิงหา Celox
 * จาก Cloudflare Worker ตกลง catch ของ fetch แล้วถูกรายงานเป็น network_error / 502 ทั้งที่
 * ยังไม่มีอะไรถูกส่งออกไป จึงต้องใช้ `redirect: "manual"` ซึ่งรองรับทั้งบน Node และ workerd
 * แล้วปฏิเสธ 3xx เองให้ได้ผลเท่าเดิม: คำขอที่ลงลายเซ็นไว้ต้องไม่ถูกส่งต่อไปยังปลายทางอื่น
 * และ body ของ redirect ต้องไม่ถูกอ่านเป็นคำตอบที่ใช้ได้
 */
const NO_FOLLOW_REDIRECT = "manual" as const;

function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

export async function createDeposit(input: CreateDepositRequest): Promise<CreateDepositResponse> {
  const config = getConfig();
  const url = new URL(`${config.baseUrl}${CREATE_DEPOSIT_PATH}`);
  const rawBody = JSON.stringify(input);
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const canonical = ["v1", "POST", url.pathname, timestamp, bodyHash].join("\n");
    const signature = createHmac("sha256", config.clientSecret)
      .update(canonical, "utf8")
      .digest("hex");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": config.clientId,
          "X-Timestamp": timestamp,
          "X-Signature": signature,
        },
        body: rawBody,
        cache: "no-store",
        redirect: NO_FOLLOW_REDIRECT,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      if (cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new CeloxError({
          code: "request_timeout",
          message: "Celox ไม่ตอบกลับภายในเวลาที่กำหนด ผลการสร้างรายการอาจไม่แน่นอน กรุณาอย่าสร้างซ้ำ",
          httpStatus: 504,
          cause,
        });
      }
      throw new CeloxError({
        code: "network_error",
        message: "เชื่อมต่อ Celox ไม่สำเร็จ ผลการสร้างรายการอาจไม่แน่นอน กรุณาอย่าสร้างซ้ำ",
        httpStatus: 502,
        cause,
      });
    }

    if (isRedirect(response)) {
      throw new CeloxError({
        code: "invalid_response",
        message: "Celox ตอบกลับด้วย redirect ระหว่างสร้างรายการฝาก ซึ่งระบบไม่เดินตาม กรุณาอย่าสร้างซ้ำ",
        httpStatus: 502,
      });
    }

    const body = await readJson(response);
    if (response.ok) {
      if (!isCreateDepositResponse(body, input, url, config.uploadOrigin)) {
        throw new CeloxError({
          code: "invalid_response",
          message: "Celox ตอบกลับข้อมูลรายการฝากไม่ครบถ้วน",
          httpStatus: 502,
        });
      }
      return body;
    }

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response);
      const delay = retryAfterSeconds === undefined
        ? jitteredBackoff(attempt)
        : retryAfterSeconds * 1_000;
      const canRetry = attempt < MAX_ATTEMPTS - 1
        && delay <= MAX_AUTOMATIC_RETRY_AFTER_MS;

      if (!canRetry) throw rateLimitedError(retryAfterSeconds);
      await sleep(delay);
      continue;
    }

    throw errorFromResponse(response, body);
  }

  throw rateLimitedError();
}

function isValidCallback(value: unknown) {
  if (!isRecord(value)) return false;
  const validHttpStatus = value.httpStatus === null
    || (typeof value.httpStatus === "number"
      && Number.isInteger(value.httpStatus)
      && value.httpStatus >= 100
      && value.httpStatus <= 599);
  return ["SUCCESS", "FAILED", "PENDING"].includes(String(value.callbackStatus))
    && validHttpStatus;
}

function isCreateWithdrawalResponse(
  value: unknown,
  input: CreateWithdrawalRequest,
): value is CreateWithdrawalResponse {
  if (!isRecord(value) || !isRecord(value.destinationAccount)) return false;
  const destination = value.destinationAccount;
  return typeof value.transactionId === "string"
    && UUID_PATTERN.test(value.transactionId)
    && isNonEmptyString(value.orderId)
    && value.referenceId === (input.referenceId ?? null)
    && value.transactionStatus === "PENDING"
    && value.amount === input.amount
    && isNonEmptyString(destination.bankCode)
    && isNonEmptyString(destination.bankName)
    && isNonEmptyString(destination.accountName)
    && isNonEmptyString(destination.accountNo);
}

function isConfirmWithdrawalResponse(
  value: unknown,
  input: ConfirmWithdrawalRequest,
  transactionId: string,
): value is ConfirmWithdrawalResponse {
  return isRecord(value)
    && value.transactionId === transactionId
    && isNonEmptyString(value.orderId)
    && value.transactionStatus === "SUCCESS"
    && value.amount === input.amount
    && (value.occurredAt === null || isIsoDate(value.occurredAt))
    && isValidCallback(value.callback);
}

function createWithdrawalErrorFromResponse(response: Response, body: unknown) {
  const errorCode = readErrorCode(body);

  if (response.status === 401) {
    return new CeloxError({
      code: "unauthenticated",
      message: "Celox ปฏิเสธการยืนยันตัวตน กรุณาตรวจสอบ API key ลายเซ็น และเวลาของเซิร์ฟเวอร์",
      httpStatus: 401,
    });
  }
  if (response.status === 409 && (!errorCode || errorCode === "reference_id_conflict")) {
    return new CeloxError({
      code: "reference_id_conflict",
      message: "referenceId นี้ถูกใช้สร้างรายการถอนแล้ว",
      httpStatus: 409,
    });
  }
  if (response.status === 422) {
    const fieldErrors = readWithdrawalFieldErrors(
      body,
      new Set(["required", "invalid", "invalid_bank_code"]),
    );
    if (fieldErrors.length > 0) {
      return new CeloxError({
        code: "validation_failed",
        message: "ข้อมูลรายการถอนไม่ถูกต้อง กรุณาตรวจสอบช่องที่ระบุ",
        httpStatus: 422,
        fieldErrors,
      });
    }
  }
  return new CeloxError({
    code: "upstream_error",
    message: "Celox ตอบกลับด้วยสถานะที่ระบบไม่รองรับขณะสร้างรายการถอน",
    httpStatus: response.status,
  });
}

function confirmWithdrawalErrorFromResponse(response: Response, body: unknown) {
  const errorCode = readErrorCode(body);

  if (response.status === 401) {
    return new CeloxError({
      code: "unauthenticated",
      message: "Celox ปฏิเสธการยืนยันตัวตน กรุณาตรวจสอบ API key ลายเซ็น และเวลาของเซิร์ฟเวอร์",
      httpStatus: 401,
    });
  }
  if (response.status === 404 && (!errorCode || errorCode === "not_found")) {
    return new CeloxError({
      code: "not_found",
      message: "ไม่พบรายการถอนนี้ หรือรายการไม่ได้อยู่ในองค์กรของคุณ",
      httpStatus: 404,
    });
  }
  if (response.status === 422) {
    const fieldErrors = readWithdrawalFieldErrors(body, new Set(["mismatch"]));
    if (fieldErrors.length > 0 || errorCode === "mismatch") {
      return new CeloxError({
        code: "withdrawal_payload_mismatch",
        message: "ข้อมูลยืนยันไม่ตรงกับรายการถอนที่สร้างไว้",
        httpStatus: 422,
        fieldErrors,
      });
    }
    if (errorCode === "invalid_transaction_state") {
      return new CeloxError({
        code: "invalid_transaction_state",
        message: "รายการถอนนี้ไม่ได้อยู่ในสถานะ PENDING แล้ว",
        httpStatus: 422,
      });
    }
    if (errorCode === "insufficient_balance") {
      return new CeloxError({
        code: "insufficient_balance",
        message: "ยอดที่ถอนได้ในกระเป๋า Celox ไม่เพียงพอสำหรับยืนยันรายการ",
        httpStatus: 422,
      });
    }
  }
  return new CeloxError({
    code: "upstream_error",
    message: "Celox ตอบกลับด้วยสถานะที่ระบบไม่รองรับขณะยืนยันรายการถอน",
    httpStatus: response.status,
  });
}

type WithdrawalOperation = "create" | "confirm";

async function callWithdrawalEndpoint<T>(options: {
  path: string;
  input: CreateWithdrawalRequest | ConfirmWithdrawalRequest;
  operation: WithdrawalOperation;
  validate: (body: unknown) => body is T;
}): Promise<T> {
  const config = getConfig();
  const url = new URL(`${config.baseUrl}${options.path}`);
  const rawBody = JSON.stringify(options.input);
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const canonical = ["v1", "POST", url.pathname, timestamp, bodyHash].join("\n");
    const signature = createHmac("sha256", config.clientSecret)
      .update(canonical, "utf8")
      .digest("hex");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": config.clientId,
          "X-Timestamp": timestamp,
          "X-Signature": signature,
        },
        body: rawBody,
        cache: "no-store",
        redirect: NO_FOLLOW_REDIRECT,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      const timedOut = cause instanceof DOMException
        && (cause.name === "TimeoutError" || cause.name === "AbortError");
      const action = options.operation === "create" ? "สร้าง" : "ยืนยัน";
      throw new CeloxError({
        code: timedOut ? "request_timeout" : "network_error",
        message: timedOut
          ? `Celox ไม่ตอบกลับภายในเวลาที่กำหนด ผลการ${action}รายการถอนอาจไม่แน่นอน กรุณาอย่าส่งซ้ำ`
          : `เชื่อมต่อ Celox ไม่สำเร็จ ผลการ${action}รายการถอนอาจไม่แน่นอน กรุณาอย่าส่งซ้ำ`,
        httpStatus: timedOut ? 504 : 502,
        cause,
      });
    }

    if (isRedirect(response)) {
      const action = options.operation === "create" ? "สร้าง" : "ยืนยัน";
      throw new CeloxError({
        code: "invalid_response",
        message: `Celox ตอบกลับด้วย redirect ระหว่าง${action}รายการถอน ซึ่งระบบไม่เดินตาม กรุณาอย่าส่งซ้ำ`,
        httpStatus: 502,
      });
    }

    const body = await readJson(response);
    if (response.ok) {
      if (!options.validate(body)) {
        const action = options.operation === "create" ? "สร้าง" : "ยืนยัน";
        throw new CeloxError({
          code: "invalid_response",
          message: `Celox ${action}รายการถอนแล้วแต่ตอบกลับข้อมูลไม่ครบถ้วน กรุณาอย่าส่งซ้ำ`,
          httpStatus: 502,
        });
      }
      return body;
    }

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response);
      const delay = retryAfterSeconds === undefined
        ? jitteredBackoff(attempt)
        : retryAfterSeconds * 1_000;
      const canRetry = attempt < MAX_ATTEMPTS - 1
        && delay <= MAX_AUTOMATIC_RETRY_AFTER_MS;
      if (!canRetry) throw rateLimitedError(retryAfterSeconds);
      await sleep(delay);
      continue;
    }

    throw options.operation === "create"
      ? createWithdrawalErrorFromResponse(response, body)
      : confirmWithdrawalErrorFromResponse(response, body);
  }

  throw rateLimitedError();
}

export function createWithdrawal(input: CreateWithdrawalRequest) {
  return callWithdrawalEndpoint<CreateWithdrawalResponse>({
    path: CREATE_WITHDRAWAL_PATH,
    input,
    operation: "create",
    validate: (body): body is CreateWithdrawalResponse => isCreateWithdrawalResponse(body, input),
  });
}

export function confirmWithdrawal(
  transactionId: string,
  input: ConfirmWithdrawalRequest,
) {
  if (!UUID_PATTERN.test(transactionId)) {
    throw new CeloxError({
      code: "invalid_request",
      message: "รหัสรายการถอนไม่ถูกต้อง",
      httpStatus: 400,
    });
  }

  return callWithdrawalEndpoint<ConfirmWithdrawalResponse>({
    path: `${CREATE_WITHDRAWAL_PATH}/${transactionId}/confirm`,
    input,
    operation: "confirm",
    validate: (body): body is ConfirmWithdrawalResponse => (
      isConfirmWithdrawalResponse(body, input, transactionId)
    ),
  });
}
