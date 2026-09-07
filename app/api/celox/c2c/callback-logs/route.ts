import { listC2CCallbackRawLogs } from "@/lib/db";
import type { CeloxC2CCallbackRawLogsResponse } from "@/lib/celox/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const logs = await listC2CCallbackRawLogs(requestedLimit);
  const body = { logs } satisfies CeloxC2CCallbackRawLogsResponse;
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
