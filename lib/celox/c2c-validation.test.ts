import { describe, expect, it } from "vitest";
import { validateCreateC2CDeposit, validateCreateC2CWithdrawal } from "./c2c-validation";

function withdrawalPayload(overrides: Record<string, unknown> = {}) {
  return {
    customerId: "CUS-001",
    amount: 2500,
    destinationBankCode: "004",
    destinationAccountName: "สมชาย ใจดี",
    destinationAccountNo: "1234567890",
    referenceId: "ORDER-4471",
    ...overrides,
  };
}

describe("validateCreateC2CWithdrawal destinationAccountNo", () => {
  it("รับเลขบัญชี 9 หลัก", () => {
    const result = validateCreateC2CWithdrawal(withdrawalPayload({ destinationAccountNo: "123456789" }));
    expect(result.fieldErrors).toEqual([]);
    expect(result.input?.destinationAccountNo).toBe("123456789");
  });

  it("รับเลขบัญชีสั้นกว่านั้นและยาวกว่า 15 หลัก", () => {
    for (const accountNo of ["1234", "1234567890123456789"]) {
      const result = validateCreateC2CWithdrawal(withdrawalPayload({ destinationAccountNo: accountNo }));
      expect(result.fieldErrors).toEqual([]);
      expect(result.input?.destinationAccountNo).toBe(accountNo);
    }
  });

  it("ยังตัดขีดและช่องว่างก่อนส่ง", () => {
    const result = validateCreateC2CWithdrawal(withdrawalPayload({ destinationAccountNo: "123-4-5678 9" }));
    expect(result.input?.destinationAccountNo).toBe("123456789");
  });

  it("ยังปฏิเสธเมื่อไม่ใช่ตัวเลขหรือเว้นว่าง", () => {
    for (const accountNo of ["12ab567890", "-"]) {
      const result = validateCreateC2CWithdrawal(withdrawalPayload({ destinationAccountNo: accountNo }));
      expect(result.fieldErrors).toContainEqual({ field: "destinationAccountNo", code: "invalid" });
      expect(result.input).toBeUndefined();
    }
  });
});

describe("validateCreateC2CDeposit sourceAccountNo", () => {
  it("ฝั่งฝากยังคุมความยาว 10–15 หลักตามเดิม", () => {
    const result = validateCreateC2CDeposit({
      customerId: "CUS-001",
      amount: 2500,
      sourceBankCode: "004",
      sourceAccountName: "สมชาย ใจดี",
      sourceAccountNo: "123456789",
    });
    expect(result.fieldErrors).toContainEqual({ field: "sourceAccountNo", code: "invalid" });
  });
});

function depositPayload(overrides: Record<string, unknown> = {}) {
  return {
    customerId: "CUS-001",
    amount: 2500,
    sourceBankCode: "004",
    sourceAccountName: "สมชาย ใจดี",
    sourceAccountNo: "1234567890",
    ...overrides,
  };
}

describe("matchTtlSeconds", () => {
  it("รับ 60 และ 120 วินาทีทั้งฝั่งถอนและฝั่งฝาก", () => {
    for (const matchTtlSeconds of [60, 120]) {
      const withdrawal = validateCreateC2CWithdrawal(withdrawalPayload({ matchTtlSeconds }));
      expect(withdrawal.fieldErrors).toEqual([]);
      expect(withdrawal.input?.matchTtlSeconds).toBe(matchTtlSeconds);

      const deposit = validateCreateC2CDeposit(depositPayload({ matchTtlSeconds }));
      expect(deposit.fieldErrors).toEqual([]);
      expect(deposit.input?.matchTtlSeconds).toBe(matchTtlSeconds);
    }
  });

  it("ยังรับชุดเดิม 300–1200 วินาที", () => {
    for (const matchTtlSeconds of [300, 600, 900, 1200]) {
      const result = validateCreateC2CWithdrawal(withdrawalPayload({ matchTtlSeconds }));
      expect(result.fieldErrors).toEqual([]);
      expect(result.input?.matchTtlSeconds).toBe(matchTtlSeconds);
    }
  });

  it("ยังปฏิเสธค่านอกชุดที่อนุญาต", () => {
    for (const matchTtlSeconds of [30, 90, 150, 1800, "60"]) {
      const withdrawal = validateCreateC2CWithdrawal(withdrawalPayload({ matchTtlSeconds }));
      expect(withdrawal.fieldErrors).toContainEqual({ field: "matchTtlSeconds", code: "invalid" });
      expect(withdrawal.input).toBeUndefined();

      const deposit = validateCreateC2CDeposit(depositPayload({ matchTtlSeconds }));
      expect(deposit.fieldErrors).toContainEqual({ field: "matchTtlSeconds", code: "invalid" });
      expect(deposit.input).toBeUndefined();
    }
  });
});
