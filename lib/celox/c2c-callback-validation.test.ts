import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { areAllC2CPartsTerminal, isCeloxC2CCallbackRequest } from "./c2c-callback-validation";

function withdrawalBody(overrides: Record<string, unknown> = {}) {
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

function depositBody(overrides: Record<string, unknown> = {}) {
  return withdrawalBody({
    direction: "deposit",
    transactionStatus: "PENDING_TRANSFER",
    settledAmount: 0,
    unfilledAmount: null,
    transferTo: {
      bankCode: "002",
      bankName: "ธนาคารกรุงเทพ",
      accountName: "ส***ย",
      accountNo: "1234567890",
    },
    parts: [{
      orderId: "TXN-2608-00993-1",
      amount: 250,
      feeAmount: 5,
      transactionStatus: "PENDING_TRANSFER",
      matchDeadline: "2026-08-30T10:20:00.000Z",
      matchedAt: null,
      cancelReason: null,
    }],
    ...overrides,
  });
}

describe("isCeloxC2CCallbackRequest", () => {
  it("accepts a withdrawal body", () => {
    expect(isCeloxC2CCallbackRequest(withdrawalBody())).toBe(true);
  });

  it("accepts a deposit body carrying transferTo and a null unfilledAmount", () => {
    expect(isCeloxC2CCallbackRequest(depositBody())).toBe(true);
  });

  it("rejects a head that still uses the old `status` field", () => {
    const legacy: Record<string, unknown> = withdrawalBody();
    legacy.status = legacy.transactionStatus;
    delete legacy.transactionStatus;
    expect(isCeloxC2CCallbackRequest(legacy)).toBe(false);
  });

  it("rejects a parts element that still uses the old `status` field", () => {
    expect(isCeloxC2CCallbackRequest(withdrawalBody({
      parts: [{
        orderId: "TXN-2608-00993-1", amount: 100, feeAmount: 5, status: "SUCCESS",
        matchDeadline: null, matchedAt: null, cancelReason: null,
      }],
    }))).toBe(false);
  });

  it("rejects realWithdrawAmount sent in place of settledAmount", () => {
    const legacy: Record<string, unknown> = withdrawalBody();
    legacy.realWithdrawAmount = legacy.settledAmount;
    delete legacy.settledAmount;
    expect(isCeloxC2CCallbackRequest(legacy)).toBe(false);
  });

  it("rejects a body with no settledAmount at all", () => {
    const body: Record<string, unknown> = withdrawalBody();
    delete body.settledAmount;
    expect(isCeloxC2CCallbackRequest(body)).toBe(false);
  });

  it("rejects a null unfilledAmount on a withdrawal and a numeric one on a deposit", () => {
    expect(isCeloxC2CCallbackRequest(withdrawalBody({ unfilledAmount: null }))).toBe(false);
    expect(isCeloxC2CCallbackRequest(depositBody({ unfilledAmount: 0 }))).toBe(false);
  });

  it("rejects a body that omits the unfilledAmount key entirely", () => {
    const body: Record<string, unknown> = withdrawalBody();
    delete body.unfilledAmount;
    expect(isCeloxC2CCallbackRequest(body)).toBe(false);
  });

  it("accepts unfilledAmount of 0 when nothing is left to return", () => {
    expect(isCeloxC2CCallbackRequest(withdrawalBody({ settledAmount: 250, unfilledAmount: 0 }))).toBe(true);
  });

  it("rejects an empty parts array and a body with no parts key", () => {
    expect(isCeloxC2CCallbackRequest(withdrawalBody({ parts: [] }))).toBe(false);
    const body: Record<string, unknown> = withdrawalBody();
    delete body.parts;
    expect(isCeloxC2CCallbackRequest(body)).toBe(false);
  });

  it("accepts parts that no longer carry a transactionId", () => {
    // parts[].transactionId ถูกถอดออกจากสัญญาใหม่ — body ที่ไม่มีต้องผ่าน
    const body = withdrawalBody();
    expect(Object.hasOwn(body.parts[0], "transactionId")).toBe(false);
    expect(isCeloxC2CCallbackRequest(body)).toBe(true);
  });

  it("rejects a deposit whose transferTo is not an object", () => {
    expect(isCeloxC2CCallbackRequest(depositBody({ transferTo: "ธนาคารกรุงเทพ" }))).toBe(false);
  });

  it("accepts a deposit with no transferTo key at all", () => {
    const body: Record<string, unknown> = depositBody();
    delete body.transferTo;
    expect(isCeloxC2CCallbackRequest(body)).toBe(true);
  });

  it("accepts unknown fields at every level", () => {
    // raw body ถูก hash ทั้งก้อนอยู่แล้ว field ใหม่ที่ Celox เพิ่มจึงต้องไหลผ่านได้
    // ไม่ใช่กลายเป็น 422 ที่ทำให้ Celox ยิงซ้ำไปเรื่อย ๆ
    expect(isCeloxC2CCallbackRequest(depositBody({
      notARealField: "x",
      transferTo: {
        bankCode: "002", bankName: "ธนาคารกรุงเทพ", accountName: "ส***ย",
        accountNo: "1234567890", promptPayId: "0812345678",
      },
      parts: [{
        orderId: "TXN-2608-00993-1", amount: 250, feeAmount: 5,
        transactionStatus: "PENDING_TRANSFER", matchDeadline: null, matchedAt: null,
        cancelReason: null, someNewThing: 1,
      }],
    }))).toBe(true);
  });

  it("accepts a body with no occurredAt/event, and one that still carries them", () => {
    const body: Record<string, unknown> = withdrawalBody();
    expect(isCeloxC2CCallbackRequest(body)).toBe(true);
    // ทั้งสองถูกถอดออกจากสัญญาแล้ว แต่ถ้ายังหลุดมาก็ไม่ใช่เหตุให้ปฏิเสธทั้ง body
    expect(isCeloxC2CCallbackRequest(withdrawalBody({
      occurredAt: "2026-08-30T10:05:12.000Z",
      event: "settled",
    }))).toBe(true);
  });

  it("rejects a negative settledAmount", () => {
    expect(isCeloxC2CCallbackRequest(withdrawalBody({ settledAmount: -1 }))).toBe(false);
  });
});

describe("areAllC2CPartsTerminal", () => {
  it("is true only when every part reached a terminal status", () => {
    expect(areAllC2CPartsTerminal([
      { transactionStatus: "SUCCESS" },
      { transactionStatus: "EXPIRED" },
      { transactionStatus: "CANCELLED" },
    ])).toBe(true);
  });

  it("is false while any part is still running, even if the head says SUCCESS", () => {
    expect(areAllC2CPartsTerminal([
      { transactionStatus: "SUCCESS" },
      { transactionStatus: "PENDING_TRANSFER" },
    ])).toBe(false);
  });
});
