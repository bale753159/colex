import type { CustomerCeloxCallbacksResponse } from "@/lib/celox/types";
import {
  customerExists,
  listCustomerCeloxCallbacks,
  listCustomerCeloxWithdrawalHolds,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || id.length > 100 || !await customerExists(id)) {
    return Response.json({ error: "ไม่พบข้อมูลลูกค้า" }, { status: 404 });
  }

  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 10);
  const callbacks = await listCustomerCeloxCallbacks(id, requestedLimit);
  const withdrawalHolds = await listCustomerCeloxWithdrawalHolds(id);
  const body = { customerId: id, callbacks, withdrawalHolds } satisfies CustomerCeloxCallbacksResponse;
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
