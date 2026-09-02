import type { CustomerCeloxCallbacksResponse } from "@/lib/celox/types";
import {
  customerExists,
  listCustomerCeloxCallbacks,
  listCustomerCeloxWithdrawalHolds,
  resolveCeloxWithdrawalHold,
} from "@/lib/db";
import { readLimitedBody } from "@/lib/read-limited-body";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 2_048;

type ResolveAction = "release-reservation" | "reset-confirmation";

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

function isResolveAction(value: unknown): value is ResolveAction {
  return value === "release-reservation" || value === "reset-confirmation";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: "ไม่อนุญาตให้แก้ยอดพักถอนข้าม origin" }, { status: 403 });
  }

  const { id, key } = await params;
  if (!id || id.length > 100 || !key || key.length > 100 || !customerExists(id)) {
    return Response.json({ error: "ไม่พบยอดพักถอนของลูกค้ารายนี้" }, { status: 404 });
  }

  const contentType = request.headers.get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "คำขอต้องใช้ Content-Type: application/json" }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "คำขอมีขนาดใหญ่เกินกำหนด" }, { status: 413 });
  }

  let input: unknown;
  try {
    const rawBody = await readLimitedBody(request, MAX_REQUEST_BYTES);
    if (rawBody === null) {
      return Response.json({ error: "คำขอมีขนาดใหญ่เกินกำหนด" }, { status: 413 });
    }
    input = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return Response.json({ error: "ข้อมูลคำขอไม่ใช่ JSON ที่ถูกต้อง" }, { status: 400 });
  }
  const action = input && typeof input === "object" && "action" in input
    ? (input as { action?: unknown }).action
    : undefined;
  if (!isResolveAction(action)) {
    return Response.json({ error: "คำสั่งแก้ยอดพักถอนไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    resolveCeloxWithdrawalHold({ customerId: id, key, action });
  } catch (error) {
    const message = error instanceof Error ? error.message : "แก้ยอดพักถอนไม่สำเร็จ";
    return Response.json({ error: message }, { status: 409 });
  }

  const body = {
    customerId: id,
    callbacks: listCustomerCeloxCallbacks(id, 10),
    withdrawalHolds: listCustomerCeloxWithdrawalHolds(id),
  } satisfies CustomerCeloxCallbacksResponse;
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
