import { CeloxError, confirmWithdrawal } from "@/lib/celox/client.server";
import type {
  CeloxErrorResponse,
  ConfirmWithdrawalRequest,
} from "@/lib/celox/types";
import { validateWithdrawalRequest } from "@/lib/celox/withdrawal-validation";
import {
  claimCeloxWithdrawalConfirmation,
  getCeloxWithdrawalIntent,
  markCeloxWithdrawalConfirmationUncertain,
  recordCeloxWithdrawalResult,
  releaseCeloxWithdrawalConfirmationClaim,
} from "@/lib/db";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 16_384;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function withdrawalPayloadMatches(
  expected: ConfirmWithdrawalRequest,
  supplied: ConfirmWithdrawalRequest,
) {
  return expected.amount === supplied.amount
    && expected.destinationBankCode === supplied.destinationBankCode
    && expected.destinationAccountName === supplied.destinationAccountName
    && expected.destinationAccountNo === supplied.destinationAccountNo
    && (expected.referenceId ?? null) === (supplied.referenceId ?? null);
}

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

function routeStatus(error: CeloxError) {
  switch (error.code) {
    case "configuration_error":
      return 500;
    case "unauthenticated":
      return 502;
    case "not_found":
      return 404;
    case "withdrawal_payload_mismatch":
    case "invalid_transaction_state":
    case "insufficient_balance":
      return 422;
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return errorResponse(400, {
      error: "รหัสรายการถอนไม่ถูกต้อง",
      code: "invalid_request",
      retryable: false,
    });
  }

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
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      return errorResponse(413, {
        error: "คำขอมีขนาดใหญ่เกินกำหนด",
        code: "invalid_request",
        retryable: false,
      });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return errorResponse(400, {
      error: "รูปแบบ JSON ไม่ถูกต้อง",
      code: "invalid_request",
      retryable: false,
    });
  }

  const validation = validateWithdrawalRequest(body);
  if (!validation.input) {
    return errorResponse(422, {
      error: "ข้อมูลยืนยันรายการถอนไม่ถูกต้อง กรุณาตรวจสอบช่องที่ระบุ",
      code: "validation_failed",
      retryable: false,
      fieldErrors: validation.fieldErrors,
    });
  }

  let intent: Awaited<ReturnType<typeof getCeloxWithdrawalIntent>>;
  try {
    intent = await getCeloxWithdrawalIntent(id);
  } catch {
    return errorResponse(500, {
      error: "อ่านรายการถอนที่ผูกกับลูกค้าไม่สำเร็จ",
      code: "persistence_error",
      retryable: false,
    });
  }
  if (!intent) {
    return errorResponse(404, {
      error: "ไม่พบรายการถอน Celox ที่ผูกกับลูกค้าในระบบ",
      code: "not_found",
      retryable: false,
    });
  }
  if (intent.transactionStatus === "SUCCESS" || intent.localTransactionId) {
    return errorResponse(422, {
      error: "รายการถอนนี้ถูกบันทึกว่าสำเร็จแล้ว",
      code: "invalid_transaction_state",
      retryable: false,
    });
  }
  if (
    intent.confirmationState === "confirming"
    || intent.confirmationState === "uncertain"
  ) {
    return errorResponse(409, {
      error: intent.confirmationState === "uncertain"
        ? "ผลการยืนยันรายการถอนนี้ยังไม่แน่นอน กรุณารอ Callback และห้ามยืนยันซ้ำ"
        : "รายการถอนนี้กำลังถูกยืนยันอยู่",
      code: "invalid_transaction_state",
      retryable: false,
    });
  }
  if (!withdrawalPayloadMatches(intent.request, validation.input)) {
    return errorResponse(422, {
      error: "ข้อมูลยืนยันไม่ตรงกับรายการถอนที่สร้างไว้",
      code: "withdrawal_payload_mismatch",
      retryable: false,
    });
  }
  const claim = await claimCeloxWithdrawalConfirmation(id);
  if (claim !== "claimed") {
    return errorResponse(claim === "insufficient" ? 422 : 409, {
      error: claim === "insufficient"
        ? "ยอดเงินที่ถอนได้ไม่เพียงพอสำหรับกันยอดรายการถอนเดิม"
        : "มีคำขอยืนยันรายการถอนนี้กำลังทำงานอยู่แล้ว",
      code: claim === "insufficient" ? "insufficient_balance" : "invalid_transaction_state",
      retryable: false,
    });
  }

  try {
    const withdrawal = await confirmWithdrawal(id, intent.request);
    try {
      await recordCeloxWithdrawalResult(withdrawal);
    } catch {
      try {
        await markCeloxWithdrawalConfirmationUncertain(id);
      } catch {
        // The confirmation claim remains held if its diagnostic state cannot be updated.
      }
      return errorResponse(500, {
        error: "Celox จ่ายเงินแล้ว แต่ระบบบันทึก transaction และยอดลูกค้าไม่สำเร็จ ห้ามยืนยันซ้ำและให้รอ Callback เพื่อประมวลผลอีกครั้ง",
        code: "persistence_error",
        retryable: false,
      });
    }
    return Response.json(withdrawal, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof CeloxError) {
      const uncertain = [
        "network_error",
        "request_timeout",
        "upstream_error",
        "invalid_response",
        "invalid_transaction_state",
      ].includes(error.code);
      try {
        if (uncertain) await markCeloxWithdrawalConfirmationUncertain(id);
        else await releaseCeloxWithdrawalConfirmationClaim(id);
      } catch {
        return errorResponse(500, {
          error: "บันทึกสถานะการยืนยันรายการถอนไม่สำเร็จ กรุณาตรวจสอบก่อนส่งซ้ำ",
          code: "persistence_error",
          retryable: false,
        });
      }
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

    try {
      await markCeloxWithdrawalConfirmationUncertain(id);
    } catch {
      // Keep the original response; the claim and reserved funds remain held.
    }

    return errorResponse(500, {
      error: "เกิดข้อผิดพลาดภายในระบบขณะยืนยันรายการถอน",
      code: "upstream_error",
      retryable: false,
    });
  }
}
