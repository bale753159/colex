import { checkC2CTransaction } from "@/lib/celox/c2c-client.server";
import { celoxErrorResponse, jsonError } from "@/lib/celox/c2c-route.server";
import { CeloxError } from "@/lib/celox/client.server";
import { syncCeloxC2CTransaction } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const transaction = await checkC2CTransaction(id);
    try {
      await syncCeloxC2CTransaction(transaction);
    } catch {
      return jsonError(500, {
        error: "อ่านสถานะ C2C จาก Celox ได้แล้ว แต่ปรับยอดและบันทึกสถานะในระบบไม่สำเร็จ",
        code: "persistence_error",
        retryable: false,
      });
    }
    return Response.json(transaction, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof CeloxError) return celoxErrorResponse(error);
    return jsonError(500, {
      error: "เกิดข้อผิดพลาดภายในระบบขณะตรวจสอบรายการ C2C",
      code: "upstream_error",
      retryable: false,
    });
  }
}
