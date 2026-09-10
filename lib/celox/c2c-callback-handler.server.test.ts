import { randomUUID, createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDatabase, teardownTestDatabase } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest } from "./types";

const TEST_SECRET = "test-c2c-callback-secret";
let acceptCeloxC2CCallbackPayload: typeof import("./c2c-callback-handler.server")["acceptCeloxC2CCallbackPayload"];

/** สูตร v2 ที่เขียนขึ้นเองจากเอกสาร ไม่ import ตัวเซ็นของ production มาใช้ */
function signV2(rawBody: string, timestamp: string) {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return createHmac("sha256", TEST_SECRET).update(`v2\n${timestamp}\n${bodyHash}`, "utf8").digest("hex");
}

function withdrawalCallback(overrides: Partial<CeloxC2CCallbackRequest> = {}): CeloxC2CCallbackRequest {
  return {
    transactionId: randomUUID(),
    orderId: "TXN-2608-00993",
    referenceId: "ORDER-4471",
    direction: "withdraw",
    transactionStatus: "SUCCESS",
    amount: 250,
    feeAmount: 5,
    settledAmount: 100,
    heldAmount: 0,
    unfilledAmount: 150,
    awaitingManualReview: false,
    matchDeadline: null,
    transferTo: null,
    parts: [{
      orderId: "TXN-2608-00993-1",
      amount: 100,
      feeAmount: 5,
      transactionStatus: "SUCCESS",
      matchDeadline: null,
      matchedAt: "2026-08-30T10:05:12.000Z",
      cancelReason: null,
    }],
    ...overrides,
  };
}

/** จำลองสิ่งที่ route ทำ: อ่าน raw body ครั้งเดียว แล้วส่งสตริงเดิมนั้นไปทั้ง verify และ parse */
function deliver(rawBody: string, options: { timestamp?: string; signature?: string } = {}) {
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = options.signature ?? signV2(rawBody, timestamp);
  return acceptCeloxC2CCallbackPayload(JSON.parse(rawBody) as unknown, rawBody, timestamp, signature);
}

beforeAll(async () => {
  await setupTestDatabase();
  process.env.CELOX_C2C_CALLBACK_SECRET = TEST_SECRET;
  ({ acceptCeloxC2CCallbackPayload } = await import("./c2c-callback-handler.server"));
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe("acceptCeloxC2CCallbackPayload", () => {
  it("accepts a validly signed withdrawal callback in the new contract shape", async () => {
    const response = await deliver(JSON.stringify(withdrawalCallback()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
  });

  it("rejects a body whose signature was made over a re-serialised payload", async () => {
    const payload = withdrawalCallback();
    const rawBody = JSON.stringify(payload);
    // key order ต่างกันแค่ตำแหน่งเดียวก็พอให้ลายเซ็นไม่ตรง
    const { orderId, ...rest } = payload;
    const reordered = JSON.stringify({ orderId, ...rest });
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(reordered).not.toBe(rawBody);
    const response = await deliver(rawBody, { timestamp, signature: signV2(reordered, timestamp) });
    expect(response.status).toBe(401);
  });

  it("rejects a timestamp outside the 300 second replay window", async () => {
    const rawBody = JSON.stringify(withdrawalCallback());
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    const response = await deliver(rawBody, { timestamp: stale, signature: signV2(rawBody, stale) });
    expect(response.status).toBe(401);
  });

  it("answers 422 for the old contract shape and 401 for the new shape with a bad signature", async () => {
    // ทั้งคู่คือ probe ตอน deploy: 422 = ยังเป็นโค้ดเก่า, 401 = โค้ดใหม่ขึ้นแล้ว
    const legacy: Record<string, unknown> = { ...withdrawalCallback() };
    legacy.status = legacy.transactionStatus;
    delete legacy.transactionStatus;
    const legacyBody = JSON.stringify(legacy);
    const badSignature = "a".repeat(64);

    expect((await deliver(legacyBody, { signature: badSignature })).status).toBe(422);
    expect((await deliver(JSON.stringify(withdrawalCallback()), { signature: badSignature })).status).toBe(401);
  });

  it("is idempotent when the same transactionId + transactionStatus is delivered twice", async () => {
    const rawBody = JSON.stringify(withdrawalCallback());
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signV2(rawBody, timestamp);
    const first = await deliver(rawBody, { timestamp, signature });
    const second = await deliver(rawBody, { timestamp, signature });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
  });

  it("conflicts when the same key is redelivered with a different body", async () => {
    const payload = withdrawalCallback();
    expect((await deliver(JSON.stringify(payload))).status).toBe(200);
    const conflicting = await deliver(JSON.stringify({ ...payload, amount: 260, unfilledAmount: 160 }));
    expect(conflicting.status).toBe(409);
  });
});
