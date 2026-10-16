import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { CeloxC2CCallbackRawLogsResponse } from "@/lib/celox/types";

let GET: typeof import("./route")["GET"];
let insertC2CCallbackRawLog: typeof import("@/lib/db")["insertC2CCallbackRawLog"];

beforeAll(async () => {
  await setupTestDatabase();
  ({ GET } = await import("./route"));
  ({ insertC2CCallbackRawLog } = await import("@/lib/db"));
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe("GET /api/celox/c2c/callback-logs", () => {
  it("คืนรายการ log ที่บันทึกไว้ เรียงจากใหม่ไปเก่า", async () => {
    await insertC2CCallbackRawLog({
      requestUrl: "https://app.example.com/callback", requestBody: "first",
      responseStatus: 200, responseBody: "ok",
    });
    await insertC2CCallbackRawLog({
      requestUrl: "https://app.example.com/callback", requestBody: "second",
      responseStatus: 401, responseBody: "unauthenticated",
    });

    const response = await GET(new Request("https://app.example.com/api/celox/c2c/callback-logs"));
    expect(response.status).toBe(200);
    const body = await response.json() as CeloxC2CCallbackRawLogsResponse;
    expect(body.logs.map((l) => l.requestBody)).toEqual(["second", "first"]);
    expect(body.logs[0].responseStatus).toBe(401);
  });

  it("จำกัดจำนวนรายการตาม query param limit", async () => {
    for (let i = 0; i < 3; i += 1) {
      await insertC2CCallbackRawLog({
        requestUrl: "https://app.example.com/callback", requestBody: `body-${i}`,
        responseStatus: 200, responseBody: "ok",
      });
    }

    const response = await GET(new Request("https://app.example.com/api/celox/c2c/callback-logs?limit=1"));
    const body = await response.json() as CeloxC2CCallbackRawLogsResponse;
    expect(body.logs.length).toBe(1);
  });
});
