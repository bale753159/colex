import { acceptCeloxC2CCallbackPayload } from "@/lib/celox/c2c-callback-handler.server";
import { readLimitedBody } from "@/lib/read-limited-body";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_CALLBACK_BYTES = 16_384;

function errorResponse(status: number, error: string, code: string) {
  return Response.json({ error, code, retryable: false }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse(415, "Callback C2C ต้องใช้ Content-Type: application/json", "invalid_request");
  }

  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CALLBACK_BYTES) {
    return errorResponse(413, "Callback C2C มีขนาดใหญ่เกินกำหนด", "invalid_request");
  }

  let rawBody: Awaited<ReturnType<typeof readLimitedBody>>;
  try {
    rawBody = await readLimitedBody(request, MAX_CALLBACK_BYTES);
  } catch {
    return errorResponse(400, "อ่าน Callback C2C ไม่สำเร็จ", "invalid_request");
  }
  if (rawBody === null) {
    return errorResponse(413, "Callback C2C มีขนาดใหญ่เกินกำหนด", "invalid_request");
  }

  // ลายเซ็น v2 คุ้ม bytes ที่ส่งมาจริง จึงต้องเก็บ raw body ไว้ทั้งก้อนก่อน parse
  // แล้วส่งสตริงเดิมนั้นไปตรวจ ห้าม re-serialise payload ที่ parse แล้วมา hash ซ้ำ
  const rawText = rawBody.toString("utf8");
  let payload: unknown;
  try {
    payload = JSON.parse(rawText) as unknown;
  } catch {
    return errorResponse(400, "รูปแบบ JSON ของ Callback C2C ไม่ถูกต้อง", "invalid_request");
  }
  return acceptCeloxC2CCallbackPayload(
    payload,
    rawText,
    request.headers.get("X-Celox-Timestamp"),
    request.headers.get("X-Celox-Signature"),
  );
}
