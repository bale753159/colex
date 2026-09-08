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

  it("ยอมรับ field แปลกปลอมที่ยังไม่รู้จัก แทนที่จะ reject ทั้ง request (raw body ถูกเซ็นทั้งก้อนอยู่แล้ว)", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ notARealField: "x" }))).toBe(true);
  });

  it("ยอมรับ settledTotal และ unfilledTotal บน callback ถอน C2C ที่ปิดกลุ่มแบบ terminal", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ settledTotal: 5000, unfilledTotal: 0 }))).toBe(true);
  });

  it("รับ settledTotal เป็น 0 ได้ (ปิดกลุ่มโดยไม่มีส่วนไหนสำเร็จเลย)", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ settledTotal: 0, unfilledTotal: 5000 }))).toBe(true);
  });

  it("rejects settledTotal ติดลบ", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ settledTotal: -1 }))).toBe(false);
  });

  it("rejects unfilledTotal ติดลบ", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ unfilledTotal: -1 }))).toBe(false);
  });

  it("ยอมรับ field แปลกปลอมที่ซ้อนอยู่ใน transferTo และ parts[] ด้วย", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({
      transferTo: {
        bankCode: "002", bankName: "ธนาคารกรุงเทพ", accountName: "สมชาย ใจดี", accountNo: "1234567890",
        unknownField: "x",
      },
      parts: [
        { transactionId: randomUUID(), orderId: "TXN-1", amount: 2500, status: "PENDING_TRANSFER", unknownField: "x" },
      ],
    }))).toBe(true);
  });
});
