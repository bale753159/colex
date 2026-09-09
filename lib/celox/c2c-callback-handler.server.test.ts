import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDatabase, teardownTestDatabase } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest } from "./types";

const TEST_SECRET = "test-c2c-callback-secret";
let acceptCeloxC2CCallbackPayload: typeof import("./c2c-callback-handler.server")["acceptCeloxC2CCallbackPayload"];

// Built independently from the production signer, straight from the v2
// material formula in the Celox manual, so the test can't pass just because
// both sides share a bug.
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
    realWithdrawAmount: 2500,
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
  ({ acceptCeloxC2CCallbackPayload } = await import("./c2c-callback-handler.server"));
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe("acceptCeloxC2CCallbackPayload", () => {
  it("accepts a validly signed withdrawal callback carrying parts and unfilledAmount", async () => {
    const payload = withdrawalCallback();
    const rawBody = JSON.stringify(payload);
    const timestamp = currentTimestamp();
    const response = await acceptCeloxC2CCallbackPayload(payload, rawBody, timestamp, signV2(rawBody, timestamp));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
  });

  it("accepts a body carrying a brand-new field it does not recognise (raw bytes hashed as opaque)", async () => {
    const payload = withdrawalCallback();
    const rawBody = JSON.stringify({ ...payload, aBrandNewFieldFromCelox: "anything" });
    const timestamp = currentTimestamp();
    const parsedWithExtraField = JSON.parse(rawBody) as unknown;
    const response = await acceptCeloxC2CCallbackPayload(
      parsedWithExtraField, rawBody, timestamp, signV2(rawBody, timestamp),
    );
    expect(response.status).toBe(200);
  });

  it("rejects when the raw body delivered differs from what was actually signed (re-serialisation trap)", async () => {
    const payload = withdrawalCallback();
    const signedRawBody = JSON.stringify(payload);
    const timestamp = currentTimestamp();
    const signature = signV2(signedRawBody, timestamp);
    // Same logical payload, re-serialised with different key order/spacing —
    // exactly what `JSON.stringify(JSON.parse(rawBody))` would produce if a
    // framework's body parser discarded the original bytes.
    const reSerialisedRawBody = JSON.stringify(payload, Object.keys(payload).sort());
    const response = await acceptCeloxC2CCallbackPayload(payload, reSerialisedRawBody, timestamp, signature);
    expect(response.status).toBe(401);
  });

  it("rejects when X-Celox-Timestamp or X-Celox-Signature is missing", async () => {
    const payload = withdrawalCallback();
    const rawBody = JSON.stringify(payload);
    const timestamp = currentTimestamp();
    const signature = signV2(rawBody, timestamp);
    const missingTimestamp = await acceptCeloxC2CCallbackPayload(payload, rawBody, null, signature);
    const missingSignature = await acceptCeloxC2CCallbackPayload(payload, rawBody, timestamp, null);
    expect(missingTimestamp.status).toBe(401);
    expect(missingSignature.status).toBe(401);
  });

  it("is idempotent when the same transactionId + status is delivered twice", async () => {
    const payload = withdrawalCallback();
    const rawBody = JSON.stringify(payload);
    const timestamp = currentTimestamp();
    const signature = signV2(rawBody, timestamp);
    const first = await acceptCeloxC2CCallbackPayload(payload, rawBody, timestamp, signature);
    const second = await acceptCeloxC2CCallbackPayload(payload, rawBody, timestamp, signature);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
  });
});
