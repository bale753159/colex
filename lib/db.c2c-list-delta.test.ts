import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";

let listCeloxC2CTransactions: typeof import("./db")["listCeloxC2CTransactions"];

beforeAll(async () => {
  await setupTestDatabase();
  ({ listCeloxC2CTransactions } = await import("./db"));
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

async function seedDeposit(updatedAt: string) {
  const now = new Date().toISOString();
  const customerId = `C-${randomUUID()}`;
  const localTransactionId = `TXN-${randomUUID()}`;
  const transactionId = randomUUID();

  await db.run(`
    INSERT INTO customers (id, name, account, initials, color, balance_satang, withdrawable_satang, created_at)
    VALUES (?, 'ทดสอบ', ?, 'ท', '#000000', 0, 0, ?)
  `, [customerId, `ACC-${randomUUID()}`, now]);

  await db.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, status, created_at)
    VALUES (?, ?, 'deposit', 'c2c', 10000, 'pending', ?)
  `, [localTransactionId, customerId, now]);

  await db.run(`
    INSERT INTO celox_c2c_transactions (
      transaction_id, order_id, reference_id, customer_id, direction,
      transaction_status, amount_satang, fee_amount_satang,
      settled_amount_satang, held_amount_satang, awaiting_manual_review,
      match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'deposit', 'PENDING', 10000, 0, 0, 0, false, NULL, false, ?, ?, ?)
  `, [transactionId, `DEP-${randomUUID()}`, `REF-${randomUUID()}`, customerId, localTransactionId, now, updatedAt]);

  return transactionId;
}

describe("listCeloxC2CTransactions({ updatedAfter })", () => {
  it("คืนเฉพาะรายการที่ updated_at อยู่ที่หรือหลัง cursor", async () => {
    const stale = await seedDeposit("2026-09-11T00:00:00.000Z");
    const atCursor = await seedDeposit("2026-09-11T00:00:05.000Z");
    const fresh = await seedDeposit("2026-09-11T00:00:09.000Z");

    const rows = await listCeloxC2CTransactions({ updatedAfter: "2026-09-11T00:00:05.000Z" });
    const ids = rows.map((row) => row.transactionId);

    expect(ids).toContain(atCursor);
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(stale);
  });

  it("ไม่กรองเมื่อไม่ส่ง updatedAfter", async () => {
    await seedDeposit("2026-09-11T00:00:00.000Z");
    await seedDeposit("2026-09-11T00:00:09.000Z");

    const rows = await listCeloxC2CTransactions();
    expect(rows).toHaveLength(2);
  });
});
