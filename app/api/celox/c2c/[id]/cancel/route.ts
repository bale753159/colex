import { cancelC2CTransaction } from "@/lib/celox/c2c-client.server";
import { celoxErrorResponse, jsonError } from "@/lib/celox/c2c-route.server";
import { CeloxError } from "@/lib/celox/client.server";
import { recordCeloxC2CCancelResult } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const result = await cancelC2CTransaction(id);
    try {
      recordCeloxC2CCancelResult(result);
    } catch {
      return jsonError(500, {
        error: "Celox ยกเลิกรายการแล้ว แต่ระบบปรับยอดที่กันไว้ไม่สำเร็จ กรุณาตรวจสอบก่อนทำรายการใหม่",
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
      error: "เกิดข้อผิดพลาดภายในระบบขณะยกเลิกรายการ C2C",
      code: "upstream_error",
      retryable: false,
    });
  }
}
