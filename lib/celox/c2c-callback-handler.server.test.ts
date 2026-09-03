import { randomUUID, createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CeloxC2CCallbackRequest } from "./types";

const TEST_SECRET = "test-c2c-callback-secret";
let tempDir: string;
let acceptCeloxC2CCallbackPayload: typeof import("./c2c-callback-handler.server")["acceptCeloxC2CCallbackPayload"];

function canonicalFixture(payload: CeloxC2CCallbackRequest) {
  // Built independently from the production canonicalizer, straight from the
  // field order documented in the Celox manual, so the test can't pass just
  // because both sides share a bug.
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
  tempDir = mkdtempSync(join(tmpdir(), "c2c-callback-test-"));
  process.env.KLANG_DB_PATH = join(tempDir, "finance.sqlite");
  process.env.CELOX_C2C_CALLBACK_SECRET = TEST_SECRET;
  ({ acceptCeloxC2CCallbackPayload } = await import("./c2c-callback-handler.server"));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("acceptCeloxC2CCallbackPayload", () => {
  it("accepts a validly signed withdrawal callback carrying parts and unfilledAmount", async () => {
    const payload = withdrawalCallback();
    const response = await acceptCeloxC2CCallbackPayload(payload, sign(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
  });

  it("rejects a callback whose signature does not cover unfilledAmount", async () => {
    const payload = withdrawalCallback();
    // Sign as if unfilledAmount didn't exist (the pre-fix behavior) to prove
    // the new field is load-bearing in the signature, not just accepted.
    const withoutUnfilled: Partial<CeloxC2CCallbackRequest> = { ...payload };
    delete withoutUnfilled.unfilledAmount;
    const staleSignature = sign(withoutUnfilled as CeloxC2CCallbackRequest);
    const response = await acceptCeloxC2CCallbackPayload(payload, staleSignature);
    expect(response.status).toBe(401);
  });

  it("is idempotent when the same transactionId + status is delivered twice", async () => {
    const payload = withdrawalCallback();
    const signature = sign(payload);
    const first = await acceptCeloxC2CCallbackPayload(payload, signature);
    const second = await acceptCeloxC2CCallbackPayload(payload, signature);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
  });
});
