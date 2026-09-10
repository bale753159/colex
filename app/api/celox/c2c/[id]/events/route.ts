import { jsonError } from "@/lib/celox/c2c-route.server";
import { getCeloxC2CCallbackTimeline } from "@/lib/db";

export const runtime = "nodejs";

/**
 * รายการ callback ที่ระบบเราได้รับจาก Celox สำหรับรายการ C2C หนึ่ง
 *
 * ต่างจาก `GET /api/celox/c2c/{id}` ตรงที่ตัวนี้ไม่เรียก Celox เลย อ่านจาก inbox ของเราอย่างเดียว
 * dialog จึง poll ถี่ได้โดยไม่ชน rate limit ของ Celox และได้เห็นทันทีว่า webhook ลงถึงแล้วหรือยัง
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id.trim() || id.length > 200) {
    return jsonError(400, {
      error: "orderId หรือ referenceId ของรายการ C2C ไม่ถูกต้อง",
      code: "invalid_request",
      retryable: false,
    });
  }

  try {
    const timeline = await getCeloxC2CCallbackTimeline(id);
    return Response.json(timeline, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError(503, {
      error: "อ่านสถานะ Callback C2C จากระบบไม่สำเร็จ",
      code: "persistence_error",
      retryable: true,
    });
  }
}
