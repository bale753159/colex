import { createC2CDeposit } from "@/lib/celox/c2c-client.server";
import { celoxErrorResponse, jsonError } from "@/lib/celox/c2c-route.server";
import { validateCreateC2CDeposit } from "@/lib/celox/c2c-validation";
import { CeloxError } from "@/lib/celox/client.server";
import { customerExists, recordCeloxC2CDepositIntent } from "@/lib/db";
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

  const validation = validateCreateC2CDeposit(body);
  if (!validation.input || !validation.customerId) {
    return jsonError(422, {
      error: "ข้อมูลรายการฝาก C2C หรือลูกค้าไม่ถูกต้อง",
      code: validation.fieldErrors.some((item) => item.code === "not_supported")
        ? "split_not_supported"
        : "validation_failed",
      retryable: false,
      fieldErrors: validation.fieldErrors,
    });
  }

  try {
    if (!customerExists(validation.customerId)) {
      return jsonError(422, {
        error: "ไม่พบลูกค้าที่เลือกรับยอดฝาก C2C",
        code: "validation_failed",
        retryable: false,
      });
    }
  } catch {
    return jsonError(500, {
      error: "ตรวจสอบข้อมูลลูกค้าไม่สำเร็จ จึงยังไม่ได้สร้างรายการกับ Celox",
      code: "persistence_error",
      retryable: false,
    });
  }

  try {
    const deposit = await createC2CDeposit(validation.input);
    try {
      recordCeloxC2CDepositIntent({ customerId: validation.customerId, deposit });
    } catch {
      return jsonError(500, {
        error: "Celox สร้างรายการฝาก C2C แล้ว แต่ระบบบันทึกการผูกลูกค้าไม่สำเร็จ ห้ามสร้างซ้ำ",
        code: "persistence_error",
        retryable: false,
      });
    }
    return Response.json(deposit, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof CeloxError) return celoxErrorResponse(error);
    return jsonError(500, {
      error: "เกิดข้อผิดพลาดภายในระบบขณะสร้างรายการฝาก C2C",
      code: "upstream_error",
      retryable: false,
    });
  }
}
