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
      held_amount_satang: number;
      funds_reserved: boolean;
    };
}

async function readLocalTransaction(localTransactionId: string) {
  return await db.first("SELECT status FROM transactions WHERE id = ?",
    [localTransactionId]) as { status: string };
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
      amount: 40,
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

    await expect(syncCeloxC2CTransaction(result)).resolves.not.toThrow();

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
      status: "SUCCESS",
      amount: 40,
      occurredAt: new Date().toISOString(),
      unfilledAmount: 60,
      parts: [{ transactionId: seed.transactionId, orderId: seed.orderId, amount: 40, status: "SUCCESS" }],
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
