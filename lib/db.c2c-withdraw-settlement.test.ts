import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { C2CTransactionPart, C2CTransactionResponse, CeloxC2CCallbackRequest } from "./celox/types";

let syncCeloxC2CTransaction: typeof import("./db")["syncCeloxC2CTransaction"];
let enqueueCeloxC2CCallbackEvent: typeof import("./db")["enqueueCeloxC2CCallbackEvent"];
let processCeloxC2CCallbackEvent: typeof import("./db")["processCeloxC2CCallbackEvent"];

const FAKE_HASH = "a".repeat(64);

beforeAll(async () => {
  await setupTestDatabase();
  ({ syncCeloxC2CTransaction, enqueueCeloxC2CCallbackEvent, processCeloxC2CCallbackEvent } = await import("./db"));
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

async function seedC2C(options: {
  direction?: "deposit" | "withdraw";
  balanceSatang: number;
  withdrawableSatang: number;
  amountSatang: number;
  feeSatang: number;
}) {
  const direction = options.direction ?? "withdraw";
  const now = new Date().toISOString();
  const customerId = `C-${randomUUID()}`;
  const localTransactionId = `TXN-${randomUUID()}`;
  const transactionId = randomUUID();
  const orderId = `${direction === "withdraw" ? "WTH" : "DEP"}-${randomUUID()}`;
  const referenceId = `REF-${randomUUID()}`;

  await db.run(`
    INSERT INTO customers (id, name, account, initials, color, balance_satang, withdrawable_satang, created_at)
    VALUES (?, 'ทดสอบ', ?, 'ท', '#000000', ?, ?, ?)
  `, [customerId, `ACC-${randomUUID()}`, options.balanceSatang, options.withdrawableSatang, now]);

  await db.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, status, created_at)
    VALUES (?, ?, ?, 'c2c', ?, 'pending', ?)
  `, [localTransactionId, customerId, direction, options.amountSatang, now]);

  // ฝั่งถอนกันเงินไว้ตอนสร้างรายการ (funds_reserved) ฝั่งฝากไม่มีอะไรให้กัน
  await db.run(`
    INSERT INTO celox_c2c_transactions (
      transaction_id, order_id, reference_id, customer_id, direction,
      transaction_status, amount_satang, fee_amount_satang,
      real_withdraw_amount_satang, held_amount_satang, awaiting_manual_review,
      match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'PENDING_TRANSFER', ?, ?, 0, ?, false, NULL, ?, ?, ?, ?)
  `, [
    transactionId, orderId, referenceId, customerId, direction,
    options.amountSatang, options.feeSatang, options.amountSatang + options.feeSatang,
    direction === "withdraw", localTransactionId, now, now,
  ]);

  return { customerId, localTransactionId, transactionId, orderId, referenceId };
}

async function readCustomer(customerId: string) {
  return await db.first("SELECT balance_satang, withdrawable_satang FROM customers WHERE id = ?",
    [customerId]) as { balance_satang: number; withdrawable_satang: number };
}

async function readC2CRow(transactionId: string) {
  return await db.first("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?",
    [transactionId]) as {
      transaction_status: string;
      real_withdraw_amount_satang: number;
      unfilled_amount_satang: number | null;
      held_amount_satang: number;
      awaiting_manual_review: boolean;
      funds_reserved: boolean;
    };
}

async function readLocalTransaction(localTransactionId: string) {
  return await db.first("SELECT status FROM transactions WHERE id = ?",
    [localTransactionId]) as { status: string };
}

function part(overrides: Partial<C2CTransactionPart> = {}): C2CTransactionPart {
  return {
    orderId: "PART-1",
    amount: 100,
    feeAmount: 1.5,
    transactionStatus: "SUCCESS",
    matchDeadline: null,
    matchedAt: "2026-09-08T10:00:00.000Z",
    cancelReason: null,
    ...overrides,
  };
}

type Seed = Awaited<ReturnType<typeof seedC2C>>;

function body(seed: Seed, overrides: Partial<C2CTransactionResponse> = {}): C2CTransactionResponse {
  return {
    transactionId: seed.transactionId,
    orderId: seed.orderId,
    referenceId: seed.referenceId,
    direction: "withdraw",
    transactionStatus: "SUCCESS",
    amount: 100,
    feeAmount: 1.5,
    realWithdrawAmount: 100,
    heldAmount: 0,
    unfilledAmount: 0,
    awaitingManualReview: false,
    matchDeadline: null,
    transferTo: null,
    parts: [part({ orderId: `${seed.orderId}-1` })],
    ...overrides,
  };
}

describe("syncCeloxC2CTransaction — ตัดเงินจาก realWithdrawAmount ไม่ใช่ amount", () => {
  it("หักลูกค้าแค่ยอดที่ถอนสำเร็จจริง และคืนส่วนที่ไม่สำเร็จ ทั้งที่ amount ยังเป็นยอดตั้งต้น", async () => {
    const seed = await seedC2C({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    await syncCeloxC2CTransaction(body(seed, {
      amount: 100,
      realWithdrawAmount: 40,
      unfilledAmount: 60,
      parts: [
        part({ orderId: `${seed.orderId}-1`, amount: 40, transactionStatus: "SUCCESS" }),
        part({ orderId: `${seed.orderId}-2`, amount: 60, transactionStatus: "CANCELLED", matchedAt: null, cancelReason: "หมดเวลาโอน" }),
      ],
    }));

    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 16_000, withdrawable_satang: 16_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.transaction_status).toBe("SUCCESS");
    expect(row.real_withdraw_amount_satang).toBe(4_000);
    expect(row.unfilled_amount_satang).toBe(6_000);
    expect(row.held_amount_satang).toBe(0);
    expect(row.funds_reserved).toBe(false);
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("success");
  });

  it("ไม่ขยับเงินเลยเมื่อ head เป็น SUCCESS แต่ยังมีก้อนที่ไม่ terminal (roll-up ไม่ใช่สัญญาณว่าจบ)", async () => {
    const seed = await seedC2C({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    await syncCeloxC2CTransaction(body(seed, {
      transactionStatus: "SUCCESS",
      amount: 100,
      realWithdrawAmount: 40,
      unfilledAmount: 0,
      heldAmount: 0.9,
      parts: [
        part({ orderId: `${seed.orderId}-1`, amount: 40, transactionStatus: "SUCCESS" }),
        part({ orderId: `${seed.orderId}-2`, amount: 60, transactionStatus: "PENDING", matchedAt: null }),
      ],
    }));

    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 20_000, withdrawable_satang: 10_000 });
    const row = await readC2CRow(seed.transactionId);
    // ห้ามเขียนสถานะ terminal ลงแถวขณะที่ยังมีก้อนวิ่งอยู่ ไม่งั้น callback ที่ปิดคำขอจริงจะชนกับมัน
    expect(row.transaction_status).toBe("PENDING_TRANSFER");
    expect(row.real_withdraw_amount_satang).toBe(4_000);
    expect(row.funds_reserved).toBe(true);
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("pending");
  });

  it("ปฏิเสธเมื่อ realWithdrawAmount + unfilledAmount ไม่เท่ากับ amount ตอนทุกก้อนจบแล้ว", async () => {
    const seed = await seedC2C({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    await expect(syncCeloxC2CTransaction(body(seed, {
      amount: 100,
      realWithdrawAmount: 40,
      unfilledAmount: 30,
      parts: [part({ orderId: `${seed.orderId}-1`, amount: 40, transactionStatus: "SUCCESS" })],
    }))).rejects.toThrow();

    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 20_000, withdrawable_satang: 10_000 });
  });

  it("ปฏิเสธ realWithdrawAmount ที่มากกว่ายอดที่กันไว้เดิม", async () => {
    const seed = await seedC2C({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    await expect(syncCeloxC2CTransaction(body(seed, {
      amount: 150,
      realWithdrawAmount: 150,
      unfilledAmount: 0,
      parts: [part({ orderId: `${seed.orderId}-1`, amount: 150, transactionStatus: "SUCCESS" })],
    }))).rejects.toThrow();
  });
});

describe("processCeloxC2CCallbackEvent — ยิงครั้งเดียวตอนจบพร้อม parts ทั้งหมด", () => {
  it("คำขอ 250 ที่แบ่งเป็น 100/100/50 แล้วสำเร็จก้อนเดียว หักลูกค้า 100 คืน 150", async () => {
    const seed = await seedC2C({ balanceSatang: 50_000, withdrawableSatang: 25_000, amountSatang: 25_000, feeSatang: 375 });
    const payload: CeloxC2CCallbackRequest = body(seed, {
      transactionStatus: "SUCCESS",
      amount: 250,
      feeAmount: 3.75,
      realWithdrawAmount: 100,
      unfilledAmount: 150,
      parts: [
        part({ orderId: `${seed.orderId}-1`, amount: 100, transactionStatus: "SUCCESS" }),
        part({ orderId: `${seed.orderId}-2`, amount: 100, transactionStatus: "CANCELLED", matchedAt: null, cancelReason: "หมดเวลาโอน" }),
        part({ orderId: `${seed.orderId}-3`, amount: 50, transactionStatus: "CANCELLED", matchedAt: null, cancelReason: "ผู้ใช้ยกเลิก" }),
      ],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("applied");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 40_000, withdrawable_satang: 40_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.real_withdraw_amount_satang).toBe(10_000);
    expect(row.unfilled_amount_satang).toBe(15_000);
    expect(row.funds_reserved).toBe(false);
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("success");
  });

  it("คำขอที่ถูกยกเลิกทั้งก้อน คืนเงินเต็มยอดและไม่หักลูกค้าเลย (unfilledAmount = amount)", async () => {
    const seed = await seedC2C({ balanceSatang: 50_000, withdrawableSatang: 25_000, amountSatang: 25_000, feeSatang: 375 });
    const payload: CeloxC2CCallbackRequest = body(seed, {
      transactionStatus: "CANCELLED",
      amount: 250,
      feeAmount: 3.75,
      realWithdrawAmount: 0,
      unfilledAmount: 250,
      parts: [
        part({ orderId: `${seed.orderId}-1`, amount: 100, transactionStatus: "CANCELLED", matchedAt: null, cancelReason: "หมดเวลาโอน" }),
        part({ orderId: `${seed.orderId}-2`, amount: 150, transactionStatus: "EXPIRED", matchedAt: null, cancelReason: null }),
      ],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("applied");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 50_000, withdrawable_satang: 50_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.transaction_status).toBe("CANCELLED");
    expect(row.real_withdraw_amount_satang).toBe(0);
    expect(row.unfilled_amount_satang).toBe(25_000);
    expect(row.funds_reserved).toBe(false);
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("failed");
  });

  it("บันทึกสถานะแต่ไม่ขยับเงินเมื่อยังมีก้อนที่ไม่ terminal", async () => {
    const seed = await seedC2C({ balanceSatang: 50_000, withdrawableSatang: 25_000, amountSatang: 25_000, feeSatang: 375 });
    const payload: CeloxC2CCallbackRequest = body(seed, {
      transactionStatus: "PENDING_REVIEW",
      amount: 250,
      realWithdrawAmount: 0,
      unfilledAmount: 0,
      heldAmount: 3.75,
      awaitingManualReview: true,
      parts: [part({ orderId: `${seed.orderId}-1`, amount: 250, transactionStatus: "PENDING_REVIEW", matchedAt: null })],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("recorded");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 50_000, withdrawable_satang: 25_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.transaction_status).toBe("PENDING_REVIEW");
    expect(row.awaiting_manual_review).toBe(true);
    expect(row.funds_reserved).toBe(true);
  });

  it("PENDING_TOPUP_C2C ไม่ตั้ง awaiting_manual_review (ยังเดินนาฬิกาเดิมและปิดเองได้)", async () => {
    const seed = await seedC2C({ balanceSatang: 50_000, withdrawableSatang: 25_000, amountSatang: 25_000, feeSatang: 375 });
    const payload: CeloxC2CCallbackRequest = body(seed, {
      transactionStatus: "PENDING_TOPUP_C2C",
      amount: 250,
      realWithdrawAmount: 0,
      unfilledAmount: 0,
      awaitingManualReview: false,
      parts: [part({ orderId: `${seed.orderId}-1`, amount: 250, transactionStatus: "PENDING_TOPUP_C2C", matchedAt: null })],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    await processCeloxC2CCallbackEvent(queued.eventId);

    expect((await readC2CRow(seed.transactionId)).awaiting_manual_review).toBe(false);
  });

  it("ไม่ขยับเงินและ mark failed เมื่อยอดสามตัวไม่ลงรอยกันตอนทุกก้อนจบแล้ว", async () => {
    const seed = await seedC2C({ balanceSatang: 50_000, withdrawableSatang: 25_000, amountSatang: 25_000, feeSatang: 375 });
    const payload: CeloxC2CCallbackRequest = body(seed, {
      transactionStatus: "SUCCESS",
      amount: 250,
      realWithdrawAmount: 100,
      unfilledAmount: 100,
      parts: [
        part({ orderId: `${seed.orderId}-1`, amount: 100, transactionStatus: "SUCCESS" }),
        part({ orderId: `${seed.orderId}-2`, amount: 150, transactionStatus: "CANCELLED", matchedAt: null, cancelReason: "หมดเวลาโอน" }),
      ],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("failed");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 50_000, withdrawable_satang: 25_000 });
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("pending");
  });

  it("ฝั่งฝากเครดิตจาก amount ของคำขอ ทั้งที่ realWithdrawAmount เป็น 0 (field ของฝั่งถอน)", async () => {
    const seed = await seedC2C({
      direction: "deposit", balanceSatang: 0, withdrawableSatang: 0, amountSatang: 500_000, feeSatang: 0,
    });
    const payload: CeloxC2CCallbackRequest = body(seed, {
      direction: "deposit",
      transactionStatus: "SUCCESS",
      amount: 5000,
      feeAmount: 0,
      realWithdrawAmount: 0,
      unfilledAmount: null,
      heldAmount: 0,
      parts: [part({ orderId: seed.orderId, amount: 5000, feeAmount: 0, transactionStatus: "SUCCESS" })],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("applied");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 500_000, withdrawable_satang: 500_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.unfilled_amount_satang).toBeNull();
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("success");
  });
});
