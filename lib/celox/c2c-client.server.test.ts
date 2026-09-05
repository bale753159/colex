import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkC2CTransaction, createC2CWithdrawal } from "./c2c-client.server";
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
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
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
});
