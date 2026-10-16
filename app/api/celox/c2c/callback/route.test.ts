import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest } from "@/lib/celox/types";

const TEST_SECRET = "test-c2c-callback-secret";
const CALLBACK_URL = "https://app.example.com/api/celox/c2c/callback";
let POST: typeof import("./route")["POST"];

// Built independently from the production signer, straight from the v2
// material formula in the Celox manual, so a shared bug can't hide.
function signV2(rawBody: string, timestamp: string, secret = TEST_SECRET) {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const material = `v2\n${timestamp}\n${bodyHash}`;
  return createHmac("sha256", secret).update(material, "utf8").digest("hex");
}

function currentTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}

function withdrawalCallback(overrides: Partial<CeloxC2CCallbackRequest> = {}): CeloxC2CCallbackRequest {
  return {
    transactionId: randomUUID(),
    orderId: "TXN-2608-00993",
    referenceId: "ORDER-4471",
    direction: "withdraw",
    transactionStatus: "SUCCESS",
    amount: 2500,
    feeAmount: 37.5,
    settledAmount: 2500,
    heldAmount: 0,
    unfilledAmount: 0,
    awaitingManualReview: false,
    matchDeadline: null,
    transferTo: null,
    parts: [{
      orderId: "TXN-2608-00993-1",
      amount: 2500,
      feeAmount: 37.5,
      transactionStatus: "SUCCESS",
      matchDeadline: null,
      matchedAt: "2026-08-30T10:05:12.000Z",
      cancelReason: null,
    }],
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
    const timestamp = currentTimestamp();
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Celox-Timestamp": timestamp,
        "X-Celox-Signature": signV2(body, timestamp),
      },
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
    const timestamp = currentTimestamp();
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Celox-Timestamp": timestamp,
        "X-Celox-Signature": "0".repeat(64),
      },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(401);

    const logs = await rawLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].request_body).toBe(body);
    expect(logs[0].response_status).toBe(401);
  });

  it("บันทึก response 401 เมื่อไม่มี X-Celox-Timestamp มาเลย (นโยบายบังคับต้องมี signature เสมอ)", async () => {
    const payload = withdrawalCallback();
    const body = JSON.stringify(payload);
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Celox-Signature": signV2(body, currentTimestamp()),
      },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("บันทึก response 401 เมื่อ X-Celox-Timestamp เก่าเกิน 300 วินาที (ป้องกัน replay)", async () => {
    const payload = withdrawalCallback();
    const body = JSON.stringify(payload);
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Celox-Timestamp": staleTimestamp,
        "X-Celox-Signature": signV2(body, staleTimestamp),
      },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
