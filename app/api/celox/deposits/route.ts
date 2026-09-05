import { CeloxError, createDeposit, getCeloxUploadPolicy } from "@/lib/celox/client.server";
import { isCeloxBankCode, type CeloxBankCode } from "@/lib/celox/banks";
import { customerExists, recordCeloxDepositIntent } from "@/lib/db";
import { readLimitedBody } from "@/lib/read-limited-body";
import type {
  CeloxErrorResponse,
  CeloxFieldError,
  CreateDepositRequest,
} from "@/lib/celox/types";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 16_384;

function errorResponse(
  status: number,
  body: CeloxErrorResponse,
  retryAfterSeconds?: number,
) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfterSeconds !== undefined) {
    headers.set("Retry-After", retryAfterSeconds.toString());
  }
  return Response.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRequest(value: unknown): {
  input?: CreateDepositRequest;
  customerId?: string;
  fieldErrors: CeloxFieldError[];
} {
  if (!isRecord(value)) {
    return {
      fieldErrors: [
        { field: "amount", code: "required" },
        { field: "sourceBankCode", code: "required" },
        { field: "sourceAccountName", code: "required" },
        { field: "sourceAccountNo", code: "required" },
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
    || !Number.isSafeInteger(Math.round(amount * 100))
    || Math.abs((amount * 100) - Math.round(amount * 100)) > 1e-8
  ) {
    fieldErrors.push({ field: "amount", code: "invalid" });
  }

  const requiredStringFields = [
    "sourceBankCode",
    "sourceAccountName",
    "sourceAccountNo",
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
    typeof value.sourceBankCode === "string"
    && value.sourceBankCode.trim()
    && !isCeloxBankCode(value.sourceBankCode.trim())
  ) {
    fieldErrors.push({ field: "sourceBankCode", code: "invalid_bank_code" });
  }

  if (
    typeof value.sourceAccountNo === "string"
    && value.sourceAccountNo.trim()
    && !/^\d+$/.test(value.sourceAccountNo.replace(/[\s-]/g, ""))
  ) {
    fieldErrors.push({ field: "sourceAccountNo", code: "invalid" });
  }

  if (
    "referenceId" in value
    && value.referenceId !== undefined
    && (typeof value.referenceId !== "string" || value.referenceId.trim().length === 0)
  ) {
    fieldErrors.push({ field: "referenceId", code: "invalid" });
  }

  if (fieldErrors.length > 0) return { fieldErrors };

  const customerId = typeof value.customerId === "string"
    ? value.customerId.trim()
    : "";
  if (!customerId || customerId.length > 100) return { fieldErrors };

  return {
    fieldErrors,
    customerId,
    input: {
      amount: amount as number,
      sourceBankCode: (value.sourceBankCode as string).trim() as CeloxBankCode,
      sourceAccountName: (value.sourceAccountName as string).trim(),
      sourceAccountNo: (value.sourceAccountNo as string).replace(/[\s-]/g, ""),
      ...(typeof value.referenceId === "string"
        ? { referenceId: value.referenceId.trim() }
        : {}),
    },
  };
}

function routeStatus(error: CeloxError) {
  switch (error.code) {
    case "configuration_error":
      return 500;
    case "unauthenticated":
      return 502;
    case "reference_id_conflict":
      return 409;
    case "validation_failed":
      return 422;
    case "no_active_system_bank_account":
      return 503;
    case "rate_limited":
      return 429;
    case "request_timeout":
      return 504;
    case "network_error":
    case "invalid_response":
    case "upstream_error":
      return 502;
    default:
      return 502;
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse(415, {
      error: "คำขอต้องใช้ Content-Type: application/json",
      code: "invalid_request",
      retryable: false,
    });
  }

  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return errorResponse(413, {
      error: "คำขอมีขนาดใหญ่เกินกำหนด",
      code: "invalid_request",
      retryable: false,
    });
  }

  let body: unknown;
  try {
    const rawBody = await readLimitedBody(request, MAX_REQUEST_BYTES);
    if (rawBody === null) {
      return errorResponse(413, {
        error: "คำขอมีขนาดใหญ่เกินกำหนด",
        code: "invalid_request",
        retryable: false,
      });
    }
    body = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return errorResponse(400, {
      error: "รูปแบบ JSON ไม่ถูกต้อง",
      code: "invalid_request",
      retryable: false,
    });
  }

  const validation = validateRequest(body);
  if (!validation.input || !validation.customerId) {
    return errorResponse(422, {
      error: "ข้อมูลรายการฝากหรือลูกค้าในระบบไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
      code: "validation_failed",
      retryable: false,
      fieldErrors: validation.fieldErrors,
    });
  }

  try {
    if (!await customerExists(validation.customerId)) {
      return errorResponse(422, {
        error: "ไม่พบข้อมูลลูกค้าที่เลือกรับยอดฝาก",
        code: "validation_failed",
        retryable: false,
      });
    }
  } catch {
    return errorResponse(500, {
      error: "ตรวจสอบข้อมูลลูกค้าในระบบไม่สำเร็จ จึงยังไม่ได้สร้างรายการกับ Celox",
      code: "persistence_error",
      retryable: false,
    });
  }

  try {
    const deposit = await createDeposit(validation.input);
    try {
      await recordCeloxDepositIntent({
        customerId: validation.customerId,
        deposit,
      });
    } catch {
      return errorResponse(500, {
        error: "Celox สร้างรายการแล้ว แต่ระบบบันทึกการผูกกับลูกค้าไม่สำเร็จ ห้ามสร้างรายการซ้ำจนกว่าจะตรวจสอบ",
        code: "persistence_error",
        retryable: false,
      });
    }
    const uploadPolicy = getCeloxUploadPolicy();
    return Response.json(deposit, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        "X-Celox-Upload-Origin": uploadPolicy.origin,
        "X-Celox-Upload-Path-Prefix": uploadPolicy.pathPrefix,
      },
    });
  } catch (error) {
    if (error instanceof CeloxError) {
      return errorResponse(routeStatus(error), {
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      }, error.retryAfterSeconds);
    }

    return errorResponse(500, {
      error: "เกิดข้อผิดพลาดภายในระบบขณะสร้างรายการฝาก",
      code: "upstream_error",
      retryable: false,
    });
  }
}
