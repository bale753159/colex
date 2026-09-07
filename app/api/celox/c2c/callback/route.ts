import { after } from "next/server";
import { acceptCeloxC2CCallbackPayload } from "@/lib/celox/c2c-callback-handler.server";
import { insertC2CCallbackRawLog } from "@/lib/db";
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

async function handleCallback(request: Request, requestBody: { current: string | null }): Promise<Response> {
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
  requestBody.current = rawBody.toString("utf8");

  let payload: unknown;
  try {
    payload = JSON.parse(requestBody.current) as unknown;
  } catch {
    return errorResponse(400, "รูปแบบ JSON ของ Callback C2C ไม่ถูกต้อง", "invalid_request");
  }
  return acceptCeloxC2CCallbackPayload(payload, request.headers.get("X-Celox-Signature"));
}

export async function POST(request: Request): Promise<Response> {
  const requestBody = { current: null as string | null };
  const response = await handleCallback(request, requestBody);
  const responseBody = await response.clone().text();
  after(() => {
    void insertC2CCallbackRawLog({
      requestUrl: request.url,
      requestBody: requestBody.current,
      responseStatus: response.status,
      responseBody,
    }).catch(() => undefined);
  });
  return response;
}
