import { CeloxError, createWithdrawal } from "@/lib/celox/client.server";
import { randomUUID } from "node:crypto";
import type { CeloxErrorResponse } from "@/lib/celox/types";
import { validateWithdrawalRequest } from "@/lib/celox/withdrawal-validation";
import {
  customerExists,
  markCeloxWithdrawalReservationUncertain,
  recordCeloxWithdrawalIntent,
  releaseCeloxWithdrawalReservation,
  reserveCeloxWithdrawalFunds,
} from "@/lib/db";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 16_384;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReservationReferenceConflict(error: unknown) {
  return error instanceof Error
    && "code" in error
    && error.code === "SQLITE_CONSTRAINT_UNIQUE"
    && error.message.includes("celox_withdrawal_reservations.reference_id");
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
    case "reference_id_conflict":
      return 409;
    case "validation_failed":
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
  const customerId = isRecord(body) && typeof body.customerId === "string"
    ? body.customerId.trim()
    : "";
  if (!validation.input || !customerId || customerId.length > 100) {
    return errorResponse(422, {
      error: "ข้อมูลรายการถอนหรือลูกค้าในระบบไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
      code: "validation_failed",
      retryable: false,
      fieldErrors: validation.fieldErrors,
    });
  }
  const providerInput = validation.input.referenceId
    ? validation.input
    : { ...validation.input, referenceId: `KLANG-WD-${randomUUID()}` };

  try {
    if (!await customerExists(customerId)) {
      return errorResponse(422, {
        error: "ไม่พบข้อมูลลูกค้าที่เลือกรายการถอน",
        code: "validation_failed",
        retryable: false,
      });
    }
  } catch {
    return errorResponse(500, {
      error: "ตรวจสอบยอดลูกค้าไม่สำเร็จ จึงยังไม่ได้สร้างรายการถอนกับ Celox",
      code: "persistence_error",
      retryable: false,
    });
  }

  let reservationId: string;
  try {
    reservationId = await reserveCeloxWithdrawalFunds({
      customerId,
      request: providerInput,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ยอดเงินที่ถอนได้ไม่เพียงพอสำหรับกันยอดรายการถอน Celox") {
      return errorResponse(422, {
        error: error.message,
        code: "insufficient_balance",
        retryable: false,
      });
    }
    if (isReservationReferenceConflict(error)) {
      return errorResponse(409, {
        error: "referenceId นี้มีรายการถอนที่กำลังประมวลผลอยู่",
        code: "reference_id_conflict",
        retryable: false,
      });
    }
    return errorResponse(500, {
      error: "กันยอดรายการถอนในระบบไม่สำเร็จ จึงยังไม่ได้ส่งคำขอไป Celox",
      code: "persistence_error",
      retryable: false,
    });
  }

  try {
    const withdrawal = await createWithdrawal(providerInput);
    try {
      await recordCeloxWithdrawalIntent({
        reservationId,
        customerId,
        request: providerInput,
        withdrawal,
      });
    } catch {
      try {
        await markCeloxWithdrawalReservationUncertain(reservationId);
      } catch {
        // The reservation remains held even if its diagnostic state cannot be updated.
      }
      return errorResponse(500, {
        error: "Celox สร้างรายการถอนแล้ว แต่ระบบบันทึกการผูกกับลูกค้าไม่สำเร็จ ห้ามสร้างรายการซ้ำจนกว่าจะตรวจสอบ",
        code: "persistence_error",
        retryable: false,
      });
    }
    return Response.json(withdrawal, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof CeloxError) {
      const uncertain = [
        "network_error",
        "request_timeout",
        "upstream_error",
        "invalid_response",
      ].includes(error.code);
      try {
        if (uncertain) await markCeloxWithdrawalReservationUncertain(reservationId);
        else await releaseCeloxWithdrawalReservation(reservationId);
      } catch {
        return errorResponse(500, {
          error: "จัดการยอดที่กันไว้หลัง Celox ตอบกลับไม่สำเร็จ กรุณาตรวจสอบก่อนสร้างรายการซ้ำ",
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
      await markCeloxWithdrawalReservationUncertain(reservationId);
    } catch {
      // Keep the original error response; the reserved funds remain unavailable.
    }

    return errorResponse(500, {
      error: "เกิดข้อผิดพลาดภายในระบบขณะสร้างรายการถอน",
      code: "upstream_error",
      retryable: false,
    });
  }
}
