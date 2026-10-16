import { jsonError } from "@/lib/celox/c2c-route.server";
import { listCeloxC2CTransactions } from "@/lib/db";
import type { CeloxC2CListResponse } from "@/lib/celox/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
  const rawLimit = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
  // หน้าจอส่ง updated_at ล่าสุดที่เคยเห็นมา เพื่อขอเฉพาะแถวที่ callback เพิ่งแก้ (delta poll)
  const rawUpdatedAfter = url.searchParams.get("updatedAfter");
  const updatedAfter = rawUpdatedAfter && Number.isFinite(Date.parse(rawUpdatedAfter)) ? rawUpdatedAfter : undefined;
  try {
    const response: CeloxC2CListResponse = {
      transactions: await listCeloxC2CTransactions({ search, limit, updatedAfter }),
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
