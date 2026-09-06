import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachC2CDepositSlip, checkC2CTransaction, createC2CWithdrawal } from "./c2c-client.server";
import type { CreateC2CWithdrawalRequest } from "./types";

function transactionFixture(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: randomUUID(),
    orderId: "TXN-2608-00994",
    referenceId: "ORDER-4472",
    direction: "withdraw",
    transactionStatus: "PENDING_TRANSFER",
    amount: 1000,
    feeAmount: 15,
    settledAmount: 0,
    heldAmount: 1015,
    awaitingManualReview: false,
    matchDeadline: null,
    transferTo: null,
    unfilledAmount: 0,
    parts: [{
      orderId: "TXN-2608-00994",
      amount: 1000,
      feeAmount: 15,
      transactionStatus: "PENDING_TRANSFER",
      matchDeadline: null,
      matchedAt: null,
      cancelReason: null,
    }],
    ...overrides,
  };
}

function stubFetchJson(body: unknown, status = 200) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  process.env.CELOX_CLIENT_ID = "test-client-id";
  process.env.CELOX_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CELOX_CLIENT_ID;
  delete process.env.CELOX_CLIENT_SECRET;
});

describe("checkC2CTransaction", () => {
  it("accepts a withdrawal transaction with unfilledAmount 0", async () => {
    stubFetchJson(transactionFixture());
    const result = await checkC2CTransaction("TXN-2608-00994");
    expect(result.unfilledAmount).toBe(0);
  });

  it("accepts a deposit transaction with unfilledAmount null", async () => {
    stubFetchJson(transactionFixture({ direction: "deposit", unfilledAmount: null }));
    const result = await checkC2CTransaction("TXN-2608-00994");
    expect(result.unfilledAmount).toBeNull();
  });

  it("rejects a withdrawal transaction with unfilledAmount null", async () => {
    stubFetchJson(transactionFixture({ unfilledAmount: null }));
    await expect(checkC2CTransaction("TXN-2608-00994")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects a deposit transaction with a non-null unfilledAmount", async () => {
    stubFetchJson(transactionFixture({ direction: "deposit", unfilledAmount: 0 }));
    await expect(checkC2CTransaction("TXN-2608-00994")).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("createC2CWithdrawal", () => {
  // body จริงจาก staging เมื่อส่ง amount 50: 422 พร้อม errors[].code = "out_of_range"
  const OUT_OF_RANGE_BODY = {
    errors: [{ field: "amount", code: "out_of_range", message: "ค่าที่กรอกอยู่นอกช่วงที่กำหนด" }],
  };

  function withdrawalInput(): CreateC2CWithdrawalRequest {
    return {
      amount: 50,
      destinationBankCode: "004" as const,
      destinationAccountName: "วรพงษ์ มณีสอน",
      destinationAccountNo: "1203967744",
      matchTtlSeconds: 900,
      referenceId: "KLANG-C2C-WD-TEST",
    };
  }

  it("maps a 422 amount/out_of_range response to validation_failed with field errors", async () => {
    stubFetchJson(OUT_OF_RANGE_BODY, 422);
    await expect(createC2CWithdrawal(withdrawalInput())).rejects.toMatchObject({
      code: "validation_failed",
      httpStatus: 422,
      fieldErrors: [{ field: "amount", code: "out_of_range" }],
    });
  });

  // body จริงจาก staging เมื่อส่ง amount 100: Celox กันเฉพาะค่าธรรมเนียม ไม่ได้กันเงินต้น
  // ยืนยันซ้ำจาก GET รายการเดียวกันที่รายงาน heldAmount: 2 เท่ากับ reservedAmount ตรงนี้
  function createdFixture(overrides: Record<string, unknown> = {}) {
    return {
      transactionId: "01a07093-e092-7dd8-9d5c-0493347cafa7",
      orderId: "WTH-C2C-1788595134605-bo4t9",
      referenceId: "KLANG-C2C-WD-TEST",
      transactionStatus: "PENDING",
      amount: 100,
      feeAmount: 2,
      reservedAmount: 2,
      awaitingManualReview: false,
      matchDeadline: "2026-09-05T08:03:54.593Z",
      ...overrides,
    };
  }

  it("accepts a response whose reservedAmount covers the fee only", async () => {
    stubFetchJson(createdFixture());
    const result = await createC2CWithdrawal({ ...withdrawalInput(), amount: 100 });
    expect(result.reservedAmount).toBe(2);
    expect(result.amount).toBe(100);
  });

  it("accepts a response whose reservedAmount covers principal plus fee", async () => {
    stubFetchJson(createdFixture({ reservedAmount: 102 }));
    const result = await createC2CWithdrawal({ ...withdrawalInput(), amount: 100 });
    expect(result.reservedAmount).toBe(102);
  });

  it("still rejects a response with no usable reservedAmount", async () => {
    for (const reservedAmount of [undefined, null, -1, "2"]) {
      stubFetchJson(createdFixture({ reservedAmount }));
      await expect(createC2CWithdrawal({ ...withdrawalInput(), amount: 100 }))
        .rejects.toMatchObject({ code: "invalid_response" });
    }
  });
});

// workerd ปฏิเสธ redirect: "error" ด้วย TypeError ตั้งแต่ก่อนเปิด socket ("won't be implemented
// since it does not make sense at the edge") ทำให้ทุกคำขอที่ยิงหา Celox จาก Worker ตายที่ catch
// ของ fetch แล้วถูกรายงานเป็น network_error / 502 ทั้งที่ยังไม่มีอะไรถูกส่งออกไปเลย
// เทสต์นี้ล็อก init ที่ต้องใช้ได้ทั้งบน Node และ workerd ไว้
describe("fetch init ต้องรันได้บน workerd", () => {
  const VALID_REDIRECT = ["follow", "manual", undefined];

  function initOf(spy: ReturnType<typeof vi.fn>) {
    return spy.mock.calls[0]?.[1] as RequestInit | undefined;
  }

  it("createC2CWithdrawal ไม่ใช้ redirect: \"error\"", async () => {
    const spy = stubFetchJson({
      transactionId: "01a07093-e092-7dd8-9d5c-0493347cafa7",
      orderId: "WTH-C2C-1",
      referenceId: "KLANG-C2C-WD-TEST",
      transactionStatus: "PENDING",
      amount: 100,
      feeAmount: 2,
      reservedAmount: 2,
      awaitingManualReview: false,
      matchDeadline: "2026-09-05T08:03:54.593Z",
    });
    await createC2CWithdrawal({
      amount: 100,
      destinationBankCode: "004" as const,
      destinationAccountName: "วรพงษ์ มณีสอน",
      destinationAccountNo: "1203967744",
      matchTtlSeconds: 900,
      referenceId: "KLANG-C2C-WD-TEST",
    });
    expect(VALID_REDIRECT).toContain(initOf(spy)?.redirect);
  });

  it("attachC2CDepositSlip ไม่ใช้ redirect: \"error\"", async () => {
    const spy = stubFetchJson({
      transactionId: "01a07093-e092-7dd8-9d5c-0493347cafa7",
      orderId: "DEP-1",
      transactionStatus: "SUCCESS",
      slipVerification: { outcome: "verified" },
      counterparty: null,
    });
    await attachC2CDepositSlip(
      "01a07093-e092-7dd8-9d5c-0493347cafa7",
      new File([new Uint8Array([1, 2, 3])], "slip.jpg", { type: "image/jpeg" }),
    );
    expect(VALID_REDIRECT).toContain(initOf(spy)?.redirect);
  });

  // redirect: "manual" คืน response 3xx มาแทนที่จะโยน จึงต้องปฏิเสธเองให้ได้ผลเท่าเดิม:
  // ห้ามเดินตาม redirect ของคำขอที่ลงลายเซ็นไว้ และห้ามอ่าน body ของมันเป็นคำตอบที่ใช้ได้
  it("ปฏิเสธ 3xx จาก Celox แทนที่จะเดินตามหรืออ่านเป็นคำตอบ", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://attacker.example/" },
    })));
    await expect(checkC2CTransaction("TXN-2608-00994"))
      .rejects.toMatchObject({ code: "invalid_response" });
  });
});
