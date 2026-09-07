import { randomUUID, createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest } from "@/lib/celox/types";

const TEST_SECRET = "test-c2c-callback-secret";
const CALLBACK_URL = "https://app.example.com/api/celox/c2c/callback";
let POST: typeof import("./route")["POST"];

// Built independently from the production canonicalizer (same fixture as
// lib/celox/c2c-callback-handler.server.test.ts) so a shared bug can't hide.
function canonicalFixture(payload: CeloxC2CCallbackRequest) {
  const signed: Record<string, unknown> = {
    transactionId: payload.transactionId,
    orderId: payload.orderId,
    referenceId: payload.referenceId,
    status: payload.status,
    amount: payload.amount,
    occurredAt: payload.occurredAt,
  };
  if (payload.transferTo) signed.transferTo = payload.transferTo;
  signed.parts = payload.parts.map((p) => ({
    transactionId: p.transactionId, orderId: p.orderId, amount: p.amount, status: p.status,
  }));
  if (payload.unfilledAmount !== undefined) signed.unfilledAmount = payload.unfilledAmount;
  return JSON.stringify(signed);
}

function sign(payload: CeloxC2CCallbackRequest) {
  return createHmac("sha256", TEST_SECRET).update(canonicalFixture(payload), "utf8").digest("hex");
}

function withdrawalCallback(overrides: Partial<CeloxC2CCallbackRequest> = {}): CeloxC2CCallbackRequest {
  return {
    transactionId: randomUUID(),
    orderId: "TXN-2608-00993",
    referenceId: "ORDER-4471",
    status: "SUCCESS",
    amount: 2500,
    occurredAt: "2026-08-30T10:05:12.000Z",
    parts: [
      { transactionId: randomUUID(), orderId: "TXN-2608-00993", amount: 2500, status: "SUCCESS" },
    ],
    unfilledAmount: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  process.env.CELOX_C2C_CALLBACK_SECRET = TEST_SECRET;
  ({ POST } = await import("./route"));
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

async function rawLogs() {
  return await db.query<{
    request_url: string;
    request_body: string | null;
    response_status: number;
    response_body: string | null;
  }>("SELECT request_url, request_body, response_status, response_body FROM celox_c2c_callback_raw_logs");
}

describe("POST /api/celox/c2c/callback — raw log", () => {
  it("บันทึก url, request body และ response ที่ถูกต้องเมื่อ callback ผ่านการตรวจ", async () => {
    const payload = withdrawalCallback();
    const body = JSON.stringify(payload);
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Celox-Signature": sign(payload) },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const logs = await rawLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].request_url).toBe(CALLBACK_URL);
    expect(logs[0].request_body).toBe(body);
    expect(logs[0].response_status).toBe(200);
    expect(JSON.parse(logs[0].response_body!)).toEqual({ received: true, duplicate: false });
  });

  it("บันทึก response 415 โดยไม่มี request body เมื่อ Content-Type ไม่ถูกต้อง", async () => {
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });

    const response = await POST(request);
    expect(response.status).toBe(415);

    const logs = await rawLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].request_url).toBe(CALLBACK_URL);
    expect(logs[0].request_body).toBeNull();
    expect(logs[0].response_status).toBe(415);
  });

  it("บันทึก response 401 พร้อม request body ดิบเมื่อลายเซ็นไม่ถูกต้อง", async () => {
    const payload = withdrawalCallback();
    const body = JSON.stringify(payload);
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Celox-Signature": "0".repeat(64) },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(401);

    const logs = await rawLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].request_body).toBe(body);
    expect(logs[0].response_status).toBe(401);
  });
});
