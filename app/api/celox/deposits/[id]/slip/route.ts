import { CeloxError, getCeloxUploadPolicy } from "@/lib/celox/client.server";
import { isDepositSlipResponse } from "@/lib/celox/deposit-validation";
import type { CeloxErrorCode } from "@/lib/celox/types";
import {
  claimCeloxDepositSlipSubmission,
  getCeloxDepositIntent,
  recordCeloxDepositResult,
  releaseCeloxDepositSlipSubmission,
} from "@/lib/db";
import { readLimitedBody } from "@/lib/read-limited-body";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const configuredMaxSlipBytes = Number(process.env.CELOX_MAX_SLIP_BYTES);
const MAX_SLIP_BYTES = Number.isSafeInteger(configuredMaxSlipBytes) && configuredMaxSlipBytes > 0
  ? configuredMaxSlipBytes
  : 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_SLIP_BYTES + 64 * 1024;
const UPLOAD_TIMEOUT_MS = 60_000;
const MAX_SLIP_LABEL = `${Math.ceil(MAX_SLIP_BYTES / (1024 * 1024))} MB`;

const PROVIDER_SLIP_ERROR_CODES = new Set<CeloxErrorCode>([
  "unauthenticated",
  "not_found",
  "file_required",
  "file_invalid",
  "deposit_expired",
  "deposit_not_awaiting_transfer",
  "slip_already_submitted",
  "slip_verification_failed",
  "rate_limited",
]);

const PROVIDER_SLIP_ERROR_MESSAGES: Partial<Record<CeloxErrorCode, string>> = {
  unauthenticated: "Celox ปฏิเสธลิงก์อัปโหลดสลิป",
  not_found: "Celox ไม่พบรายการฝากนี้",
  file_required: "Celox ไม่ได้รับไฟล์สลิป",
  file_invalid: "Celox ปฏิเสธรูปแบบหรือขนาดไฟล์สลิป",
  deposit_expired: "รายการฝากหมดอายุแล้ว ไม่สามารถแนบสลิปได้",
  deposit_not_awaiting_transfer: "รายการฝากไม่ได้อยู่ในสถานะรอแนบสลิป",
  slip_already_submitted: "Celox ระบุว่ารายการนี้เคยแนบสลิปแล้ว",
  slip_verification_failed: "Celox ตรวจสอบสลิปไม่สำเร็จ",
  rate_limited: "ส่งคำขอไปยัง Celox ถี่เกินไป กรุณารอแล้วลองใหม่",
};

type ProxyError = {
  error: string;
  code: CeloxErrorCode;
  retryable: boolean;
};

function errorResponse(status: number, body: ProxyError, retryAfter?: string | null) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return Response.json(body, { status, headers });
}

function isValidUploadToken(value: string) {
  return value.length > 0
    && value.length <= 2_048
    && !/[\u0000-\u0020\u007f]/.test(value);
}

function fallbackCode(status: number): CeloxErrorCode {
  if (status === 401) return "unauthenticated";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 422) return "slip_verification_failed";
  return "upstream_error";
}

function normalizedProviderErrorCode(payload: unknown, status: number) {
  let candidate = "";
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    candidate = typeof record.code === "string"
      ? record.code
      : typeof record.error === "string"
        ? record.error
        : typeof record.error === "object" && record.error !== null && !Array.isArray(record.error)
          && typeof (record.error as Record<string, unknown>).code === "string"
          ? (record.error as Record<string, unknown>).code as string
          : "";
  }
  const normalized = candidate.trim().toLowerCase().replace(/[\s-]+/g, "_") as CeloxErrorCode;
  return PROVIDER_SLIP_ERROR_CODES.has(normalized) ? normalized : fallbackCode(status);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return errorResponse(400, {
      error: "รหัสรายการฝากไม่ถูกต้อง",
      code: "invalid_request",
      retryable: false,
    });
  }

  const requestUrl = new URL(request.url);
  const uploadToken = request.headers.get("X-Celox-Upload-Token")?.trim() ?? "";
  if (requestUrl.searchParams.size !== 0 || !isValidUploadToken(uploadToken)) {
    return errorResponse(401, {
      error: "ลิงก์อัปโหลดไม่ถูกต้องหรือหมดอายุแล้ว",
      code: "unauthenticated",
      retryable: false,
    });
  }

  let intent: Awaited<ReturnType<typeof getCeloxDepositIntent>>;
  try {
    intent = await getCeloxDepositIntent(id);
  } catch {
    return errorResponse(500, {
      error: "อ่านข้อมูลรายการฝากในระบบไม่สำเร็จ จึงยังไม่ได้ส่งสลิปไป Celox",
      code: "persistence_error",
      retryable: false,
    });
  }
  if (!intent) {
    return errorResponse(404, {
      error: "ไม่พบรายการฝาก Celox ที่ผูกกับลูกค้าในระบบ",
      code: "not_found",
      retryable: false,
    });
  }
  if (intent.transactionStatus === "SUCCESS" || intent.transactionStatus === "PENDING_APPROVE") {
    return errorResponse(409, {
      error: "รายการนี้เคยส่งสลิปแล้ว ระบบจะไม่ส่งไฟล์ซ้ำ",
      code: "slip_already_submitted",
      retryable: false,
    });
  }
  if (intent.transactionStatus === "EXPIRED") {
    return errorResponse(422, {
      error: "รายการฝากหมดอายุแล้ว ไม่สามารถแนบสลิปได้",
      code: "deposit_expired",
      retryable: false,
    });
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse(415, {
      error: "คำขอแนบสลิปต้องใช้ multipart/form-data",
      code: "file_invalid",
      retryable: false,
    });
  }

  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    return errorResponse(413, {
      error: `ไฟล์สลิปมีขนาดใหญ่เกิน ${MAX_SLIP_LABEL}`,
      code: "file_invalid",
      retryable: false,
    });
  }

  let incomingForm: FormData;
  try {
    const rawMultipartBody = await readLimitedBody(request, MAX_MULTIPART_BYTES);
    if (rawMultipartBody === null) {
      return errorResponse(413, {
        error: `ไฟล์สลิปมีขนาดใหญ่เกิน ${MAX_SLIP_LABEL}`,
        code: "file_invalid",
        retryable: false,
      });
    }
    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: new Uint8Array(rawMultipartBody),
    });
    incomingForm = await boundedRequest.formData();
  } catch {
    return errorResponse(422, {
      error: "อ่านไฟล์สลิปไม่สำเร็จ กรุณาเลือกไฟล์ใหม่",
      code: "file_invalid",
      retryable: false,
    });
  }

  const entries = Array.from(incomingForm.entries());
  const file = incomingForm.get("file");
  if (entries.length !== 1 || entries[0]?.[0] !== "file" || !(file instanceof File)) {
    return errorResponse(422, {
      error: "กรุณาแนบไฟล์รูปสลิปเพียงหนึ่งไฟล์ในช่อง file",
      code: "file_required",
      retryable: false,
    });
  }

  if (!file.type.startsWith("image/") || file.size === 0 || file.size > MAX_SLIP_BYTES) {
    return errorResponse(422, {
      error: file.size > MAX_SLIP_BYTES
        ? `ไฟล์สลิปมีขนาดใหญ่เกิน ${MAX_SLIP_LABEL}`
        : "ไฟล์สลิปต้องเป็นรูปภาพที่มีข้อมูล",
      code: "file_invalid",
      retryable: false,
    });
  }

  let uploadPolicy: ReturnType<typeof getCeloxUploadPolicy>;
  try {
    uploadPolicy = getCeloxUploadPolicy();
  } catch (error) {
    return errorResponse(500, {
      error: error instanceof CeloxError
        ? error.message
        : "ยังไม่ได้ตั้งค่าปลายทางอัปโหลดสลิป Celox",
      code: "configuration_error",
      retryable: false,
    });
  }

  try {
    if (!await claimCeloxDepositSlipSubmission(id)) {
      return errorResponse(409, {
        error: "รายการนี้กำลังส่งหรือเคยส่งสลิปแล้ว ระบบจะไม่ส่งไฟล์ซ้ำ",
        code: "slip_already_submitted",
        retryable: false,
      });
    }
  } catch {
    return errorResponse(500, {
      error: "ล็อกรายการก่อนส่งสลิปไม่สำเร็จ จึงยังไม่ได้ส่งไฟล์ไป Celox",
      code: "persistence_error",
      retryable: false,
    });
  }

  const upstreamUrl = new URL(`${uploadPolicy.origin}${uploadPolicy.pathPrefix}/${id}/slip`);
  upstreamUrl.searchParams.set("uploadToken", uploadToken);

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name || "slip");

  let response: Response;
  try {
    response = await fetch(upstreamUrl, {
      method: "POST",
      body: upstreamForm,
      cache: "no-store",
      // workerd ไม่รับ redirect: "error" (โยน TypeError ก่อนเปิด socket) จึงใช้ "manual"
      // แล้วปฏิเสธ 3xx เองด้านล่าง เพื่อไม่ส่งสลิปต่อไปยังปลายทางอื่นที่ Celox ชี้ไป
      redirect: "manual",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException
      && (cause.name === "TimeoutError" || cause.name === "AbortError");
    return errorResponse(timedOut ? 504 : 502, {
      error: timedOut
        ? "Celox ไม่ตอบกลับภายในเวลาที่กำหนด จึงยังยืนยันผลการส่งสลิปไม่ได้"
        : "เชื่อมต่อ Celox ไม่สำเร็จ จึงยังยืนยันผลการส่งสลิปไม่ได้",
      code: timedOut ? "request_timeout" : "network_error",
      retryable: false,
    });
  }

  if (response.status >= 300 && response.status < 400) {
    return errorResponse(502, {
      error: "Celox ตอบกลับด้วย redirect ระหว่างส่งสลิป ซึ่งระบบไม่เดินตาม จึงยังยืนยันผลไม่ได้",
      code: "invalid_response",
      retryable: false,
    });
  }

  const retryAfter = response.headers.get("Retry-After");
  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = responseText ? JSON.parse(responseText) as unknown : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    try {
      await releaseCeloxDepositSlipSubmission(id);
    } catch {
      return errorResponse(500, {
        error: "Celox ปฏิเสธสลิปแล้ว แต่ระบบปลดล็อกรายการไม่สำเร็จ ต้องตรวจสอบก่อนลองใหม่",
        code: "persistence_error",
        retryable: false,
      });
    }
  }

  if (response.ok && payload !== null) {
    if (!isDepositSlipResponse(payload, intent)) {
      return errorResponse(502, {
        error: "Celox รับสลิปแล้วแต่ส่งผลตอบกลับไม่ตรงกับรายการฝาก ห้ามอัปโหลดซ้ำจนกว่าจะตรวจสอบสถานะ",
        code: "invalid_response",
        retryable: false,
      });
    }
    try {
      await recordCeloxDepositResult(payload);
    } catch {
      return errorResponse(500, {
        error: payload.transactionStatus === "SUCCESS"
          ? "Celox ยืนยันยอดฝากแล้ว แต่ระบบบันทึก transaction ไม่สำเร็จ ต้องตรวจสอบก่อนทำรายการต่อ"
          : "Celox ตอบผลตรวจสลิปแล้ว แต่ระบบบันทึกสถานะรายการไม่สำเร็จ",
        code: "persistence_error",
        retryable: false,
      });
    }
    return Response.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (response.ok) {
    return errorResponse(502, {
      error: "Celox รับสลิปแล้วแต่ส่งผลตอบกลับที่อ่านไม่ได้ ห้ามอัปโหลดซ้ำจนกว่าจะตรวจสอบสถานะ",
      code: "invalid_response",
      retryable: false,
    });
  }

  const code = normalizedProviderErrorCode(payload, response.status);
  return errorResponse(response.status, {
    error: PROVIDER_SLIP_ERROR_MESSAGES[code] ?? "Celox ปฏิเสธการแนบสลิป",
    code,
    retryable: code === "rate_limited",
  }, retryAfter);
}
