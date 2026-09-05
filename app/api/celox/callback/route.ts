import { after } from "next/server";
import {
  processCeloxCallbackEventWithRetry,
  verifyCeloxCallbackSignature,
} from "@/lib/celox/callback.server";
import {
  acceptCeloxC2CCallbackPayload,
  looksLikeCeloxC2CCallback,
} from "@/lib/celox/c2c-callback-handler.server";
import { isCeloxCallbackRequest } from "@/lib/celox/callback-validation";
import { CeloxError } from "@/lib/celox/client.server";
import type { CeloxCallbackResponse } from "@/lib/celox/types";
import { enqueueCeloxCallbackEvent } from "@/lib/db";
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
    return errorResponse(415, "Callback ต้องใช้ Content-Type: application/json", "invalid_request");
  }

  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CALLBACK_BYTES) {
    return errorResponse(413, "Callback มีขนาดใหญ่เกินกำหนด", "invalid_request");
  }

  let rawBody: Awaited<ReturnType<typeof readLimitedBody>>;
  try {
    rawBody = await readLimitedBody(request, MAX_CALLBACK_BYTES);
  } catch {
    return errorResponse(400, "อ่าน Callback ไม่สำเร็จ", "invalid_request");
  }
  if (rawBody === null) {
    return errorResponse(413, "Callback มีขนาดใหญ่เกินกำหนด", "invalid_request");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return errorResponse(400, "รูปแบบ JSON ของ Callback ไม่ถูกต้อง", "invalid_request");
  }
  if (looksLikeCeloxC2CCallback(payload)) {
    return acceptCeloxC2CCallbackPayload(payload, request.headers.get("X-Celox-Signature"));
  }

  try {
    verifyCeloxCallbackSignature(rawBody, request.headers.get("X-Celox-Signature"));
  } catch (error) {
    if (error instanceof CeloxError) {
      return errorResponse(error.httpStatus, error.message, error.code);
    }
    return errorResponse(401, "ตรวจลายเซ็น Callback ไม่สำเร็จ", "unauthenticated");
  }
  if (!isCeloxCallbackRequest(payload)) {
    return errorResponse(422, "ข้อมูล Callback ไม่ครบหรือมีรูปแบบไม่ถูกต้อง", "validation_failed");
  }

  let queued: Awaited<ReturnType<typeof enqueueCeloxCallbackEvent>>;
  try {
    queued = await enqueueCeloxCallbackEvent(payload);
  } catch {
    return errorResponse(503, "บันทึก Callback ลงระบบไม่สำเร็จ", "persistence_error");
  }
  if (queued.conflict) {
    return errorResponse(409, "Callback key เดิมมีข้อมูลต่างจาก event ที่บันทึกไว้", "callback_conflict");
  }

  if (queued.shouldProcess) {
    after(() => processCeloxCallbackEventWithRetry(queued.eventId));
  }

  const responseBody = {
    received: true,
    duplicate: queued.duplicate,
  } satisfies CeloxCallbackResponse;
  return Response.json(responseBody, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
