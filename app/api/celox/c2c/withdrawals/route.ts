import { randomUUID } from "node:crypto";
import { createC2CWithdrawal } from "@/lib/celox/c2c-client.server";
import { celoxErrorResponse, jsonError } from "@/lib/celox/c2c-route.server";
import { validateCreateC2CWithdrawal } from "@/lib/celox/c2c-validation";
import { CeloxError } from "@/lib/celox/client.server";
import {
  markCeloxC2CWithdrawalReservationUncertain,
  recordCeloxC2CWithdrawalIntent,
  releaseCeloxC2CWithdrawalReservation,
  reserveCeloxC2CWithdrawalFunds,
} from "@/lib/db";
import { readLimitedBody } from "@/lib/read-limited-body";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 16_384;

export async function POST(request: Request) {
  const contentType = request.headers.get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return jsonError(415, {
      error: "คำขอต้องใช้ Content-Type: application/json",
      code: "invalid_request",
      retryable: false,
    });
  }

  let body: unknown;
  try {
    const rawBody = await readLimitedBody(request, MAX_REQUEST_BYTES);
    if (rawBody === null) {
      return jsonError(413, {
        error: "คำขอมีขนาดใหญ่เกินกำหนด",
        code: "invalid_request",
        retryable: false,
      });
    }
    body = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return jsonError(400, {
      error: "รูปแบบ JSON ไม่ถูกต้อง",
      code: "invalid_request",
      retryable: false,
    });
  }

  const validation = validateCreateC2CWithdrawal(body);
  if (!validation.input || !validation.customerId) {
    return jsonError(422, {
      error: "ข้อมูลรายการถอน C2C หรือลูกค้าไม่ถูกต้อง",
      code: validation.fieldErrors.some((item) => item.code === "not_supported")
        ? "split_not_supported"
        : "validation_failed",
      retryable: false,
      fieldErrors: validation.fieldErrors,
    });
  }

  const providerRequest = {
    ...validation.input,
    referenceId: validation.input.referenceId || `KLANG-C2C-WD-${randomUUID()}`,
  };
  let reservationId: string;
  try {
    reservationId = reserveCeloxC2CWithdrawalFunds({
      customerId: validation.customerId,
      request: providerRequest,
    });
  } catch {
    return jsonError(422, {
      error: "ยอดเงินที่ถอนได้ของลูกค้าไม่เพียงพอสำหรับกันยอดถอน C2C",
      code: "c2c_insufficient_balance",
      retryable: false,
    });
  }

  try {
    const withdrawal = await createC2CWithdrawal(providerRequest);
    try {
      recordCeloxC2CWithdrawalIntent({
        reservationId,
        customerId: validation.customerId,
        request: providerRequest,
        withdrawal,
      });
    } catch {
      markCeloxC2CWithdrawalReservationUncertain(reservationId);
      return jsonError(500, {
        error: "Celox สร้างรายการถอน C2C แล้ว แต่ระบบบันทึกการผูกลูกค้าไม่สำเร็จ ห้ามสร้างซ้ำ",
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
      const uncertain = ["request_timeout", "network_error", "invalid_response", "upstream_error"]
        .includes(error.code);
      try {
        if (uncertain) markCeloxC2CWithdrawalReservationUncertain(reservationId);
        else releaseCeloxC2CWithdrawalReservation(reservationId);
      } catch {
        return jsonError(500, {
          error: "ปรับยอดที่กันไว้หลัง Celox ตอบกลับไม่สำเร็จ ต้องตรวจสอบก่อนทำรายการใหม่",
          code: "persistence_error",
          retryable: false,
        });
      }
      return celoxErrorResponse(error);
    }
    try {
      markCeloxC2CWithdrawalReservationUncertain(reservationId);
    } catch {
      // คง error หลักไว้ และไม่คืนยอดเพราะไม่ทราบว่าฝั่ง Celox สร้างรายการแล้วหรือไม่
    }
    return jsonError(500, {
      error: "ผลสร้างรายการถอน C2C ไม่แน่นอน กรุณาอย่าส่งซ้ำและตรวจด้วย referenceId",
      code: "upstream_error",
      retryable: false,
    });
  }
}
