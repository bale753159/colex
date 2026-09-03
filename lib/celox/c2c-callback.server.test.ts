import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeCeloxC2CCallback } from "./c2c-callback.server";
import type { CeloxC2CCallbackRequest } from "./types";

function basePayload(overrides: Partial<CeloxC2CCallbackRequest> = {}): CeloxC2CCallbackRequest {
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

describe("canonicalizeCeloxC2CCallback", () => {
  it("appends parts after the six base fields when transferTo is absent", () => {
    const payload = basePayload();
    const canonical = JSON.parse(canonicalizeCeloxC2CCallback(payload));
    expect(Object.keys(canonical)).toEqual([
      "transactionId", "orderId", "referenceId", "status", "amount", "occurredAt", "parts",
    ]);
  });

  it("orders transferTo before parts before unfilledAmount when all are present", () => {
    const payload = basePayload({
      transferTo: { bankCode: "002", bankName: "ธนาคารกรุงเทพ", accountName: "สมชาย ใจดี", accountNo: "1234567890" },
      unfilledAmount: 0,
    });
    const canonical = JSON.parse(canonicalizeCeloxC2CCallback(payload));
    expect(Object.keys(canonical)).toEqual([
      "transactionId", "orderId", "referenceId", "status", "amount", "occurredAt",
      "transferTo", "parts", "unfilledAmount",
    ]);
  });

  it("signs unfilledAmount as a bare number, including zero", () => {
    const payload = basePayload({ unfilledAmount: 0 });
    const canonical = JSON.parse(canonicalizeCeloxC2CCallback(payload));
    expect(canonical.unfilledAmount).toBe(0);
  });

  it("rebuilds each parts element in fixed key order regardless of input order", () => {
    const part = { status: "PENDING_TRANSFER", amount: 500, orderId: "TXN-2608-00994-1", transactionId: randomUUID() };
    const payload = basePayload({ parts: [part] });
    const canonical = canonicalizeCeloxC2CCallback(payload);
    expect(canonical).toContain(
      `"parts":[{"transactionId":"${part.transactionId}","orderId":"${part.orderId}","amount":${part.amount},"status":"${part.status}"}]`,
    );
  });
});
