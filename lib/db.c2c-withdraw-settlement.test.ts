import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest, C2CTransactionResponse } from "./celox/types";

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

async function seedWithdrawal(options: {
  balanceSatang: number;
  withdrawableSatang: number;
  amountSatang: number;
  feeSatang: number;
}) {
  const now = new Date().toISOString();
  const customerId = `C-${randomUUID()}`;
  const localTransactionId = `TXN-${randomUUID()}`;
  const transactionId = randomUUID();
  const orderId = `WTH-${randomUUID()}`;
  const referenceId = `REF-${randomUUID()}`;

  await db.run(`
    INSERT INTO customers (id, name, account, initials, color, balance_satang, withdrawable_satang, created_at)
    VALUES (?, 'ทดสอบ', ?, 'ท', '#000000', ?, ?, ?)
  `, [customerId, `ACC-${randomUUID()}`, options.balanceSatang, options.withdrawableSatang, now]);

  await db.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, status, created_at)
    VALUES (?, ?, 'withdraw', 'c2c', ?, 'pending', ?)
  `, [localTransactionId, customerId, options.amountSatang, now]);

  await db.run(`
    INSERT INTO celox_c2c_transactions (
      transaction_id, order_id, reference_id, customer_id, direction,
      transaction_status, amount_satang, fee_amount_satang,
      settled_amount_satang, held_amount_satang, awaiting_manual_review,
      match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'withdraw', 'PENDING_TRANSFER', ?, ?, 0, ?, false, NULL, true, ?, ?, ?)
  `, [
    transactionId, orderId, referenceId, customerId,
    options.amountSatang, options.feeSatang, options.amountSatang + options.feeSatang,
    localTransactionId, now, now,
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
      settled_amount_satang: number;
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


async function seedDeposit(options: { amountSatang: number }) {
  const now = new Date().toISOString();
  const customerId = `C-${randomUUID()}`;
  const localTransactionId = `TXN-${randomUUID()}`;
  const transactionId = randomUUID();
  const orderId = `DEP-${randomUUID()}`;
  const referenceId = `REF-${randomUUID()}`;

  await db.run(`
    INSERT INTO customers (id, name, account, initials, color, balance_satang, withdrawable_satang, created_at)
    VALUES (?, 'ทดสอบ', ?, 'ท', '#000000', 0, 0, ?)
  `, [customerId, `ACC-${randomUUID()}`, now]);

  await db.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, status, created_at)
    VALUES (?, ?, 'deposit', 'c2c', ?, 'pending', ?)
  `, [localTransactionId, customerId, options.amountSatang, now]);

  await db.run(`
    INSERT INTO celox_c2c_transactions (
      transaction_id, order_id, reference_id, customer_id, direction,
      transaction_status, amount_satang, fee_amount_satang,
      settled_amount_satang, held_amount_satang, awaiting_manual_review,
      match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'deposit', 'PENDING_TRANSFER', ?, 0, 0, 0, false, NULL, false, ?, ?, ?)
  `, [transactionId, orderId, referenceId, customerId, options.amountSatang, localTransactionId, now, now]);

  return { customerId, localTransactionId, transactionId, orderId, referenceId };
}

type CallbackSeed = { transactionId: string; orderId: string; referenceId: string };

function withdrawalCallback(
  seed: CallbackSeed,
  overrides: Partial<CeloxC2CCallbackRequest> = {},
): CeloxC2CCallbackRequest {
  return {
    transactionId: seed.transactionId,
    orderId: seed.orderId,
    referenceId: seed.referenceId,
    direction: "withdraw",
    transactionStatus: "SUCCESS",
    amount: 100,
    feeAmount: 2,
    settledAmount: 100,
    heldAmount: 0,
    unfilledAmount: 0,
    awaitingManualReview: false,
    matchDeadline: null,
    transferTo: null,
    parts: [{
      orderId: `${seed.orderId}-1`, amount: 100, feeAmount: 2, transactionStatus: "SUCCESS",
      matchDeadline: null, matchedAt: new Date().toISOString(), cancelReason: null,
    }],
    ...overrides,
  };
}

describe("syncCeloxC2CTransaction settling a partially-filled withdrawal", () => {
  it("debits only the settled amount and releases the unfilled remainder", async () => {
    const seed = await seedWithdrawal({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const result: C2CTransactionResponse = {
      transactionId: seed.transactionId,
      orderId: seed.orderId,
      referenceId: seed.referenceId,
      direction: "withdraw",
      transactionStatus: "SUCCESS",
      amount: 100,
      feeAmount: 0.8,
      settledAmount: 40,
      heldAmount: 0,
      unfilledAmount: 60,
      awaitingManualReview: false,
      matchDeadline: null,
      transferTo: null,
      parts: [{
        orderId: seed.orderId, amount: 40, feeAmount: 0.8, transactionStatus: "SUCCESS",
        matchDeadline: null, matchedAt: new Date().toISOString(), cancelReason: null,
      }],
    };

    await syncCeloxC2CTransaction(result);

    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 16_000, withdrawable_satang: 16_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.transaction_status).toBe("SUCCESS");
    expect(row.settled_amount_satang).toBe(4_000);
    expect(row.held_amount_satang).toBe(0);
    expect(row.funds_reserved).toBe(false);
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("success");
  });

  it("rejects a settledAmount larger than the originally reserved amount", async () => {
    const seed = await seedWithdrawal({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const result: C2CTransactionResponse = {
      transactionId: seed.transactionId,
      orderId: seed.orderId,
      referenceId: seed.referenceId,
      direction: "withdraw",
      transactionStatus: "SUCCESS",
      amount: 150,
      feeAmount: 3,
      settledAmount: 150,
      heldAmount: 0,
      unfilledAmount: 0,
      awaitingManualReview: false,
      matchDeadline: null,
      transferTo: null,
      parts: [{
        orderId: seed.orderId, amount: 150, feeAmount: 3, transactionStatus: "SUCCESS",
        matchDeadline: null, matchedAt: new Date().toISOString(), cancelReason: null,
      }],
    };

    await expect(syncCeloxC2CTransaction(result)).rejects.toThrow();
  });
});

describe("processCeloxC2CCallbackEvent settling a partially-filled withdrawal via webhook", () => {
  it("debits only the callback's amount and releases the unfilled remainder", async () => {
    const seed = await seedWithdrawal({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const payload: CeloxC2CCallbackRequest = {
      transactionId: seed.transactionId,
      orderId: seed.orderId,
      referenceId: seed.referenceId,
      direction: "withdraw",
      transactionStatus: "SUCCESS",
      amount: 100,
      feeAmount: 0.8,
      settledAmount: 40,
      heldAmount: 0,
      unfilledAmount: 60,
      awaitingManualReview: false,
      matchDeadline: null,
      transferTo: null,
      parts: [{
        orderId: seed.orderId, amount: 40, feeAmount: 0.8, transactionStatus: "SUCCESS",
        matchDeadline: null, matchedAt: new Date().toISOString(), cancelReason: null,
      }],
    };
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("applied");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 16_000, withdrawable_satang: 16_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.settled_amount_satang).toBe(4_000);
    expect(row.funds_reserved).toBe(false);
  });
});


describe("processCeloxC2CCallbackEvent money rules", () => {
  it("splits a 250 withdrawal into a settled 100 and a returned 150, never debiting the full 250", async () => {
    const seed = await seedWithdrawal({ balanceSatang: 40_000, withdrawableSatang: 15_000, amountSatang: 25_000, feeSatang: 500 });
    const payload = withdrawalCallback(seed, {
      amount: 250, feeAmount: 5, settledAmount: 100, unfilledAmount: 150,
      parts: [
        { orderId: `${seed.orderId}-1`, amount: 100, feeAmount: 5, transactionStatus: "SUCCESS", matchDeadline: null, matchedAt: new Date().toISOString(), cancelReason: null },
        { orderId: `${seed.orderId}-2`, amount: 100, feeAmount: 0, transactionStatus: "EXPIRED", matchDeadline: null, matchedAt: null, cancelReason: "no match" },
        { orderId: `${seed.orderId}-3`, amount: 50, feeAmount: 0, transactionStatus: "CANCELLED", matchDeadline: null, matchedAt: null, cancelReason: "cancelled" },
      ],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("applied");
    // หัก 10,000 สตางค์ (100 บาท) คืน 15,000 เข้า withdrawable — ไม่ใช่หักเต็ม 25,000
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 30_000, withdrawable_satang: 30_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.settled_amount_satang).toBe(10_000);
    expect(row.unfilled_amount_satang).toBe(15_000);
  });

  it("returns the whole amount and debits nothing when the withdrawal settled nothing", async () => {
    const seed = await seedWithdrawal({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const payload = withdrawalCallback(seed, {
      transactionStatus: "EXPIRED", settledAmount: 0, unfilledAmount: 100,
      parts: [{ orderId: `${seed.orderId}-1`, amount: 100, feeAmount: 0, transactionStatus: "EXPIRED", matchDeadline: null, matchedAt: null, cancelReason: "expired" }],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("applied");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 20_000, withdrawable_satang: 20_000 });
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("failed");
  });

  it("moves no money and writes no terminal status while any part is still running", async () => {
    const seed = await seedWithdrawal({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const payload = withdrawalCallback(seed, {
      amount: 100, settledAmount: 60, unfilledAmount: 40,
      parts: [
        { orderId: `${seed.orderId}-1`, amount: 60, feeAmount: 2, transactionStatus: "SUCCESS", matchDeadline: null, matchedAt: new Date().toISOString(), cancelReason: null },
        { orderId: `${seed.orderId}-2`, amount: 40, feeAmount: 0, transactionStatus: "PENDING_TRANSFER", matchDeadline: null, matchedAt: null, cancelReason: null },
      ],
    });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("recorded");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 20_000, withdrawable_satang: 10_000 });
    const row = await readC2CRow(seed.transactionId);
    expect(row.transaction_status).toBe("PENDING_TRANSFER");
    expect(row.funds_reserved).toBe(true);
    expect((await readLocalTransaction(seed.localTransactionId)).status).toBe("pending");
  });

  it("fails the event without moving money when settledAmount + unfilledAmount does not equal amount", async () => {
    const seed = await seedWithdrawal({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const payload = withdrawalCallback(seed, { amount: 100, settledAmount: 60, unfilledAmount: 30 });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("failed");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 20_000, withdrawable_satang: 10_000 });
  });

  it("fails the event when settledAmount is larger than the requested amount", async () => {
    const seed = await seedWithdrawal({ balanceSatang: 40_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const payload = withdrawalCallback(seed, { amount: 150, settledAmount: 150, unfilledAmount: 0 });
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("failed");
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 40_000, withdrawable_satang: 10_000 });
  });

  it("credits a deposit by settledAmount, and treats a SUCCESS with settledAmount 0 as unsuccessful", async () => {
    const credited = await seedDeposit({ amountSatang: 10_000 });
    const creditedPayload: CeloxC2CCallbackRequest = {
      ...withdrawalCallback(credited, { amount: 100, settledAmount: 100 }),
      direction: "deposit",
      unfilledAmount: null,
    };
    const queuedCredit = await enqueueCeloxC2CCallbackEvent(creditedPayload, FAKE_HASH);
    expect((await processCeloxC2CCallbackEvent(queuedCredit.eventId)).processing_state).toBe("applied");
    expect(await readCustomer(credited.customerId)).toEqual({ balance_satang: 10_000, withdrawable_satang: 10_000 });

    const empty = await seedDeposit({ amountSatang: 10_000 });
    const emptyPayload: CeloxC2CCallbackRequest = {
      ...withdrawalCallback(empty, { amount: 100, settledAmount: 0 }),
      direction: "deposit",
      unfilledAmount: null,
    };
    const queuedEmpty = await enqueueCeloxC2CCallbackEvent(emptyPayload, FAKE_HASH);
    expect((await processCeloxC2CCallbackEvent(queuedEmpty.eventId)).processing_state).toBe("applied");
    expect(await readCustomer(empty.customerId)).toEqual({ balance_satang: 0, withdrawable_satang: 0 });
    expect((await readLocalTransaction(empty.localTransactionId)).status).toBe("failed");
  });

  it("records a deposit callback that is still running, keeping its null unfilledAmount", async () => {
    const seed = await seedDeposit({ amountSatang: 10_000 });
    const payload: CeloxC2CCallbackRequest = {
      ...withdrawalCallback(seed, {
        transactionStatus: "PENDING_TRANSFER", amount: 100, settledAmount: 0,
        parts: [{ orderId: `${seed.orderId}-1`, amount: 100, feeAmount: 2, transactionStatus: "PENDING_TRANSFER", matchDeadline: null, matchedAt: null, cancelReason: null }],
      }),
      direction: "deposit",
      unfilledAmount: null,
    };
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    const processed = await processCeloxC2CCallbackEvent(queued.eventId);

    expect(processed.processing_state).toBe("recorded");
    const row = await readC2CRow(seed.transactionId);
    expect(row.transaction_status).toBe("PENDING_TRANSFER");
    expect(row.unfilled_amount_satang).toBeNull();
    expect(await readCustomer(seed.customerId)).toEqual({ balance_satang: 0, withdrawable_satang: 0 });
  });

  it("takes awaitingManualReview straight from the body: false for topup, true for review", async () => {
    const topup = await seedWithdrawal({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const topupPayload = withdrawalCallback(topup, {
      transactionStatus: "PENDING_TOPUP_C2C", settledAmount: 0, unfilledAmount: 100, awaitingManualReview: false,
      parts: [{ orderId: `${topup.orderId}-1`, amount: 100, feeAmount: 0, transactionStatus: "PENDING_TOPUP_C2C", matchDeadline: null, matchedAt: null, cancelReason: null }],
    });
    const queuedTopup = await enqueueCeloxC2CCallbackEvent(topupPayload, FAKE_HASH);
    expect((await processCeloxC2CCallbackEvent(queuedTopup.eventId)).processing_state).toBe("recorded");
    expect((await readC2CRow(topup.transactionId)).awaiting_manual_review).toBe(false);
    expect(await readCustomer(topup.customerId)).toEqual({ balance_satang: 20_000, withdrawable_satang: 10_000 });

    const review = await seedWithdrawal({ balanceSatang: 20_000, withdrawableSatang: 10_000, amountSatang: 10_000, feeSatang: 200 });
    const reviewPayload = withdrawalCallback(review, {
      transactionStatus: "PENDING_REVIEW", settledAmount: 0, unfilledAmount: 100, awaitingManualReview: true,
      parts: [{ orderId: `${review.orderId}-1`, amount: 100, feeAmount: 0, transactionStatus: "PENDING_REVIEW", matchDeadline: null, matchedAt: null, cancelReason: null }],
    });
    const queuedReview = await enqueueCeloxC2CCallbackEvent(reviewPayload, FAKE_HASH);
    expect((await processCeloxC2CCallbackEvent(queuedReview.eventId)).processing_state).toBe("recorded");
    expect((await readC2CRow(review.transactionId)).awaiting_manual_review).toBe(true);
    expect(await readCustomer(review.customerId)).toEqual({ balance_satang: 20_000, withdrawable_satang: 10_000 });
  });
});
