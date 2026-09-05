import { jsonError } from "@/lib/celox/c2c-route.server";
import { listCeloxC2CTransactions } from "@/lib/db";
import type { CeloxC2CListResponse } from "@/lib/celox/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
  const rawLimit = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
  try {
    const response: CeloxC2CListResponse = {
      transactions: await listCeloxC2CTransactions({ search, limit }),
    };
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return jsonError(500, {
      error: "โหลดรายการ C2C ในระบบไม่สำเร็จ",
      code: "persistence_error",
      retryable: false,
    });
  }
}
