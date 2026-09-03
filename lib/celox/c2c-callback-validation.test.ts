import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isCeloxC2CCallbackRequest } from "./c2c-callback-validation";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: randomUUID(),
    orderId: "TXN-2608-00993",
    referenceId: "ORDER-4471",
    status: "PENDING_TRANSFER",
    amount: 2500,
    occurredAt: null,
    parts: [
      { transactionId: randomUUID(), orderId: "TXN-2608-00993", amount: 2500, status: "PENDING_TRANSFER" },
    ],
    ...overrides,
  };
}

describe("isCeloxC2CCallbackRequest", () => {
  it("accepts a valid callback that includes parts", () => {
    expect(isCeloxC2CCallbackRequest(basePayload())).toBe(true);
  });

  it("rejects a callback missing parts", () => {
    const withoutParts: Record<string, unknown> = basePayload();
    delete withoutParts.parts;
    expect(isCeloxC2CCallbackRequest(withoutParts)).toBe(false);
  });

  it("rejects a callback whose parts array is empty", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ parts: [] }))).toBe(false);
  });

  it("rejects a parts element with an invalid status", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({
      parts: [{ transactionId: randomUUID(), orderId: "o", amount: 100, status: "not-a-status" }],
    }))).toBe(false);
  });

  it("accepts unfilledAmount of 0 on a withdrawal callback", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ unfilledAmount: 0 }))).toBe(true);
  });

  it("accepts a withdrawal callback with a positive unfilledAmount", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ unfilledAmount: 500 }))).toBe(true);
  });

  it("rejects a negative unfilledAmount", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ unfilledAmount: -1 }))).toBe(false);
  });

  it("still rejects unknown top-level keys", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ notARealField: "x" }))).toBe(false);
  });
});
