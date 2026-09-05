import { processCeloxCallbackEventWithRetry } from "@/lib/celox/callback.server";
import { getCeloxCallbackEvent, queueCeloxCallbackRetry } from "@/lib/db";

export const runtime = "nodejs";

function isSameOriginMutation(request: Request) {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite !== "same-origin") return false;
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    const requestHost = request.headers.get("Host") ?? new URL(request.url).host;
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: "ไม่อนุญาตให้ประมวลผล Callback ข้าม origin" }, { status: 403 });
  }
  const { id, eventId: rawEventId } = await params;
  const eventId = Number(rawEventId);
  if (!id || id.length > 100 || !Number.isSafeInteger(eventId) || eventId <= 0) {
    return Response.json({ error: "รหัส Callback ไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    await queueCeloxCallbackRetry(eventId, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ไม่พบ Callback ของลูกค้ารายนี้";
    return Response.json({ error: message }, { status: 404 });
  }

  await processCeloxCallbackEventWithRetry(eventId);
  const callback = await getCeloxCallbackEvent(eventId);
  if (!callback) {
    return Response.json({ error: "ไม่พบ Callback หลังประมวลผล" }, { status: 404 });
  }
  if (callback.processingState !== "applied" && callback.processingState !== "recorded") {
    return Response.json({
      error: callback.lastError || "Callback ยังประมวลผลไม่สำเร็จ",
      callback,
    }, {
      status: callback.processingState === "pending" ? 503 : 422,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json({ callback }, {
    headers: { "Cache-Control": "no-store" },
  });
}
