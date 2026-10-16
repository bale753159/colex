import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isC2CTransactionResponse, isCeloxC2CCallbackRequest } from "./c2c-callback-validation";

// contract ใหม่: body ของ callback C2C เหมือน body ของ GET /v1/core/c2c/{reference}
// แบบ field ต่อ field จึง validate ด้วยฟังก์ชันตัวเดียวกันทั้งสองทาง
function part(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "TXN-2608-00993-1",
    amount: 2500,
    feeAmount: 37.5,
    transactionStatus: "PENDING_TRANSFER",
    matchDeadline: null,
    matchedAt: null,
    cancelReason: null,
    ...overrides,
  };
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: randomUUID(),
    orderId: "TXN-2608-00993",
    referenceId: "ORDER-4471",
    direction: "withdraw",
    transactionStatus: "PENDING_TRANSFER",
    amount: 2500,
    feeAmount: 37.5,
    settledAmount: 0,
    heldAmount: 37.5,
    unfilledAmount: 0,
    awaitingManualReview: false,
    matchDeadline: null,
    transferTo: null,
    parts: [part()],
    ...overrides,
  };
}

function depositPayload(overrides: Record<string, unknown> = {}) {
  return basePayload({
    direction: "deposit",
    unfilledAmount: null,
    transferTo: {
      bankCode: "014",
      bankName: "ธนาคารกสิกรไทย",
      accountName: "Wipada C***o",
      accountNo: "1234567890",
    },
    ...overrides,
  });
}

describe("isCeloxC2CCallbackRequest", () => {
  it("เป็นฟังก์ชันเดียวกับ isC2CTransactionResponse เพราะ body เหมือนกันเป๊ะ", () => {
    expect(isCeloxC2CCallbackRequest).toBe(isC2CTransactionResponse);
  });

  it("accepts a valid withdrawal callback", () => {
    expect(isCeloxC2CCallbackRequest(basePayload())).toBe(true);
  });

  it("accepts a valid deposit callback carrying transferTo and a null unfilledAmount", () => {
    expect(isCeloxC2CCallbackRequest(depositPayload())).toBe(true);
  });

  it("rejects a callback missing parts", () => {
    const withoutParts: Record<string, unknown> = basePayload();
    delete withoutParts.parts;
    expect(isCeloxC2CCallbackRequest(withoutParts)).toBe(false);
  });

  it("rejects a callback whose parts array is empty", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ parts: [] }))).toBe(false);
  });

  it("ปฏิเสธ parts[] ที่ยังใช้ชื่อ status เดิมแทน transactionStatus", () => {
    const legacy: Record<string, unknown> = part();
    delete legacy.transactionStatus;
    expect(isCeloxC2CCallbackRequest(basePayload({
      parts: [{ ...legacy, status: "SUCCESS" }],
    }))).toBe(false);
  });

  it("ปฏิเสธหัว body ที่ยังใช้ชื่อ status เดิมแทน transactionStatus", () => {
    const legacy: Record<string, unknown> = basePayload();
    delete legacy.transactionStatus;
    expect(isCeloxC2CCallbackRequest({ ...legacy, status: "SUCCESS" })).toBe(false);
  });

  it("ยอมรับ parts[] ที่ไม่มี transactionId (contract ใหม่ถอด id ระดับก้อนออกแล้ว)", () => {
    expect(isCeloxC2CCallbackRequest(basePayload())).toBe(true);
  });

  it("rejects a parts element with an invalid transactionStatus", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({
      parts: [part({ transactionStatus: "not-a-status" })],
    }))).toBe(false);
  });

  it("ยอมรับ parts[] ที่ถูกยกเลิกพร้อม cancelReason และ matchedAt", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({
      transactionStatus: "CANCELLED",
      settledAmount: 0,
      unfilledAmount: 2500,
      heldAmount: 0,
      parts: [part({
        transactionStatus: "CANCELLED",
        matchedAt: "2026-08-31T10:15:00.000Z",
        cancelReason: "หมดเวลาโอน",
      })],
    }))).toBe(true);
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

  it("ปฏิเสธ callback ถอนที่ unfilledAmount เป็น null (ฝั่งถอนเป็นตัวเลขเสมอ รวม 0)", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ unfilledAmount: null }))).toBe(false);
  });

  it("ปฏิเสธ callback ฝากที่ unfilledAmount เป็นตัวเลข (ฝั่งฝากเป็น null เสมอ)", () => {
    expect(isCeloxC2CCallbackRequest(depositPayload({ unfilledAmount: 0 }))).toBe(false);
  });

  it("ปฏิเสธ callback ที่ไม่มีคีย์ unfilledAmount เลย", () => {
    const withoutUnfilled: Record<string, unknown> = basePayload();
    delete withoutUnfilled.unfilledAmount;
    expect(isCeloxC2CCallbackRequest(withoutUnfilled)).toBe(false);
  });

  it("ปฏิเสธ callback ที่ไม่มี settledAmount (field ที่ใช้ตัดเงินทั้งสองขา)", () => {
    const withoutSettled: Record<string, unknown> = basePayload();
    delete withoutSettled.settledAmount;
    expect(isCeloxC2CCallbackRequest(withoutSettled)).toBe(false);
  });

  it("ปฏิเสธ realWithdrawAmount ที่ส่งมาแทน settledAmount (field นั้นถูกลบไปแล้ว)", () => {
    const legacy: Record<string, unknown> = basePayload();
    delete legacy.settledAmount;
    expect(isCeloxC2CCallbackRequest({ ...legacy, realWithdrawAmount: 0 })).toBe(false);
  });

  it("ปฏิเสธ settledAmount ติดลบ", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ settledAmount: -1 }))).toBe(false);
  });

  it("ปฏิเสธ awaitingManualReview ที่ไม่ใช่ boolean", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ awaitingManualReview: "false" }))).toBe(false);
  });

  it("ปฏิเสธ direction ที่ไม่ใช่ deposit หรือ withdraw", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ direction: "transfer" }))).toBe(false);
  });

  it("ปฏิเสธรายการถอนที่ส่ง transferTo มาเป็น object (ฝั่งถอนเป็น null เสมอ)", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({
      transferTo: { bankCode: "002", bankName: "ธนาคารกรุงเทพ", accountName: "สมชาย ใ***ดี", accountNo: "1234567890" },
    }))).toBe(false);
  });

  it("ยอมรับ callback ฝากที่ไม่มีคีย์ transferTo เลย (conditional field)", () => {
    const withoutTransferTo: Record<string, unknown> = depositPayload();
    delete withoutTransferTo.transferTo;
    expect(isCeloxC2CCallbackRequest(withoutTransferTo)).toBe(true);
  });

  it("ปฏิเสธ matchDeadline ที่ไม่ใช่เวลา ISO 8601", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ matchDeadline: "2026-08-31" }))).toBe(false);
  });

  it("ยอมรับ field แปลกปลอมที่ยังไม่รู้จัก แทนที่จะ reject ทั้ง request (raw body ถูกเซ็นทั้งก้อนอยู่แล้ว)", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({ notARealField: "x" }))).toBe(true);
  });

  it("ยอมรับ occurredAt กับ event ที่หลุดมาแม้ contract ใหม่ถอดออกแล้ว (เป็นแค่ field ที่ไม่ได้ใช้)", () => {
    expect(isCeloxC2CCallbackRequest(basePayload({
      occurredAt: "2026-08-31T10:15:00.000Z",
      event: "matched",
    }))).toBe(true);
  });

  it("ยอมรับ body ที่ไม่มี occurredAt และ event เลย (รูปแบบปกติของ contract ใหม่)", () => {
    const payload: Record<string, unknown> = basePayload();
    expect(Object.hasOwn(payload, "occurredAt")).toBe(false);
    expect(isCeloxC2CCallbackRequest(payload)).toBe(true);
  });

  it("ยอมรับ field แปลกปลอมที่ซ้อนอยู่ใน transferTo และ parts[] ด้วย", () => {
    expect(isCeloxC2CCallbackRequest(depositPayload({
      transferTo: {
        bankCode: "002", bankName: "ธนาคารกรุงเทพ", accountName: "สมชาย ใจดี", accountNo: "1234567890",
        unknownField: "x",
      },
      parts: [part({ unknownField: "x" })],
    }))).toBe(true);
  });
});
