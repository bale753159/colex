import { attachC2CDepositSlip } from "@/lib/celox/c2c-client.server";
import { celoxErrorResponse, jsonError } from "@/lib/celox/c2c-route.server";
import { CeloxError } from "@/lib/celox/client.server";
import { getCeloxC2CIntent, recordCeloxC2CSlipResult } from "@/lib/db";

export const runtime = "nodejs";
const configuredMaxSlipBytes = Number(process.env.CELOX_MAX_SLIP_BYTES);
const MAX_SLIP_BYTES = Number.isFinite(configuredMaxSlipBytes) && configuredMaxSlipBytes > 0
  ? Math.floor(configuredMaxSlipBytes)
  : 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data;")) {
    return jsonError(415, {
      error: "คำขอต้องใช้ multipart/form-data และมี part ชื่อ file เพียงช่องเดียว",
      code: "invalid_request",
      retryable: false,
    });
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SLIP_BYTES + 64 * 1024) {
    return jsonError(413, {
      error: "ไฟล์สลิปมีขนาดใหญ่เกินกำหนด",
      code: "file_invalid",
      retryable: false,
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(422, {
      error: "อ่านไฟล์สลิปไม่สำเร็จ",
      code: "file_invalid",
      retryable: false,
    });
  }
  const entries = [...formData.entries()];
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError(422, {
      error: "กรุณาแนบรูปสลิปในช่อง file",
      code: "file_required",
      retryable: false,
      fieldErrors: [{ field: "file", code: "required" }],
    });
  }
  if (
    entries.length !== 1
    || entries[0]?.[0] !== "file"
    || file.size <= 0
    || file.size > MAX_SLIP_BYTES
    || !ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())
  ) {
    return jsonError(422, {
      error: "แนบได้เฉพาะรูปสลิป JPEG, PNG, WEBP หรือ HEIC หนึ่งไฟล์เท่านั้น",
      code: "file_invalid",
      retryable: false,
      fieldErrors: [{ field: "file", code: "invalid" }],
    });
  }

  try {
    const intent = getCeloxC2CIntent(id);
    if (!intent || intent.direction !== "deposit") {
      return jsonError(404, {
        error: "ไม่พบรายการฝาก C2C นี้ในระบบ",
        code: "not_found",
        retryable: false,
      });
    }
  } catch {
    return jsonError(500, {
      error: "ตรวจสอบรายการฝาก C2C ในระบบไม่สำเร็จ",
      code: "persistence_error",
      retryable: false,
    });
  }

  try {
    const result = await attachC2CDepositSlip(id, file);
    try {
      recordCeloxC2CSlipResult(result);
    } catch {
      return jsonError(500, {
        error: "Celox ตรวจสลิปแล้ว แต่ระบบบันทึกผลและปรับยอดไม่สำเร็จ กรุณาตรวจสถานะก่อนแนบซ้ำ",
        code: "persistence_error",
        retryable: false,
      });
    }
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof CeloxError) return celoxErrorResponse(error);
    return jsonError(500, {
      error: "เกิดข้อผิดพลาดภายในระบบขณะแนบสลิป C2C",
      code: "upstream_error",
      retryable: false,
    });
  }
}
