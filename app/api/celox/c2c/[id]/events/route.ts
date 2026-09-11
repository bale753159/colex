import { getCeloxC2CCallbackTimeline } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const reference = id.trim();
  if (!reference) return Response.json({ error: "ต้องระบุ reference ของรายการ C2C" }, { status: 400 });

  try {
    return Response.json(await getCeloxC2CCallbackTimeline(reference), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "อ่านประวัติ callback C2C ไม่สำเร็จ" }, { status: 500 });
  }
}
