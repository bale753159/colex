import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";

let mod: typeof import("./db");

beforeAll(async () => {
  await setupTestDatabase();
  mod = await import("./db");
});
beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await teardownTestDatabase(); });

async function seedCustomer(id: string, name: string, balance: number, withdrawable: number) {
  await db.run(`
    INSERT INTO customers (id, name, account, initials, color, phone, email, balance_satang, withdrawable_satang, created_at)
    VALUES (?, ?, ?, 'ท', 'violet', '081-000-0000', 'a@b.co', ?, ?, ?)
  `, [id, name, `ACC-${id}`, balance, withdrawable, "2026-01-01T00:00:00+07:00"]);
}

describe("lib/db.ts on Postgres", () => {
  it("createTransaction: account deposit then withdraw, with guard", async () => {
    await seedCustomer("C-1", "ก", 0, 0);
    const dep = await mod.createTransaction({ customerId: "C-1", kind: "deposit_account", amount: 100 });
    expect(dep.transactions).toHaveLength(1);
    expect(dep.transactions[0].amount).toBe(100);
    expect(dep.summary.depositTotal).toBe(100);
    expect(dep.summary.balanceTotal).toBe(100);

    const wd = await mod.createTransaction({ customerId: "C-1", kind: "withdraw_account", amount: 40 });
    expect(wd.transactions[0].amount).toBe(40);
    const row = await db.first("SELECT balance_satang, withdrawable_satang FROM customers WHERE id = ?", ["C-1"]);
    expect(row).toEqual({ balance_satang: 6_000, withdrawable_satang: 6_000 });

    await expect(mod.createTransaction({ customerId: "C-1", kind: "withdraw_account", amount: 999 }))
      .rejects.toThrow("ยอดเงินที่ถอนได้ไม่เพียงพอ");
    await expect(mod.createTransaction({ customerId: "MISSING", kind: "deposit_account", amount: 1 }))
      .rejects.toThrow("ไม่พบข้อมูลลูกค้าที่เลือก");
  });

  it("createTransaction: c2c transfer moves money both ways and returns two rows", async () => {
    await seedCustomer("C-A", "เอ", 50_000, 50_000);
    await seedCustomer("C-B", "บี", 0, 0);
    const res = await mod.createTransaction({
      customerId: "C-B", counterpartyCustomerId: "C-A", kind: "deposit_c2c", amount: 100,
    });
    expect(res.transactions).toHaveLength(2);
    expect(res.transactions.map((t) => t.type)).toEqual(["withdraw", "deposit"]);
    expect(await db.first("SELECT balance_satang, withdrawable_satang FROM customers WHERE id = ?", ["C-A"]))
      .toEqual({ balance_satang: 40_000, withdrawable_satang: 40_000 });
    expect(await db.first("SELECT balance_satang, withdrawable_satang FROM customers WHERE id = ?", ["C-B"]))
      .toEqual({ balance_satang: 10_000, withdrawable_satang: 10_000 });

    await expect(mod.createTransaction({
      customerId: "C-B", counterpartyCustomerId: "C-A", kind: "withdraw_c2c", amount: 9_999,
    })).rejects.toThrow("ยอดเงินที่ถอนได้ของ บี ไม่เพียงพอ");
    await expect(mod.createTransaction({ customerId: "C-B", kind: "deposit_c2c", amount: 1 }))
      .rejects.toThrow("กรุณาเลือกลูกค้าคู่รายการ C2C");
    await expect(mod.createTransaction({
      customerId: "C-B", counterpartyCustomerId: "C-B", kind: "deposit_c2c", amount: 1,
    })).rejects.toThrow("บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน");
  });

  it("listCustomers/getSummary filter by Asia/Bangkok calendar day", async () => {
    await seedCustomer("C-1", "ก", 100_000, 100_000);
    // 2026-03-02T00:30:00+07:00 == 2026-03-01T17:30:00Z -> Bangkok day is 2026-03-02
    await db.run(`
      INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
      VALUES ('T-1', 'C-1', 'deposit', 'account', 1000, '', 'success', '2026-03-01T17:30:00Z')
    `);
    // 2026-03-01T23:30:00+07:00 == 2026-03-01T16:30:00Z -> Bangkok day is 2026-03-01
    await db.run(`
      INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
      VALUES ('T-2', 'C-1', 'deposit', 'account', 2000, '', 'success', '2026-03-01T16:30:00Z')
    `);

    const onlySecond = await mod.listCustomers({ from: "2026-03-02", to: "2026-03-02" });
    expect(onlySecond.summary.transactionCount).toBe(1);
    expect(onlySecond.summary.depositTotal).toBe(10);
    expect(onlySecond.customers[0].depositTotal).toBe(10);

    const onlyFirst = await mod.listCustomers({ from: "2026-03-01", to: "2026-03-01" });
    expect(onlyFirst.summary.transactionCount).toBe(1);
    expect(onlyFirst.summary.depositTotal).toBe(20);

    const both = await mod.listCustomers({});
    expect(both.summary.transactionCount).toBe(2);
    expect(both.summary.depositTotal).toBe(30);
    expect(both.summary.customerCount).toBe(1);
    expect(both.summary.balanceTotal).toBe(1000);
    expect(typeof both.summary.balanceTotal).toBe("number");
  });

  it("listCustomers sorts customers with no activity last (SQLite DESC NULL order)", async () => {
    await seedCustomer("C-QUIET", "เงียบ", 0, 0);
    await seedCustomer("C-BUSY", "ยุ่ง", 0, 0);
    await db.run(`
      INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
      VALUES ('T-1', 'C-BUSY', 'deposit', 'account', 1000, '', 'success', '2026-03-01T00:00:00Z')
    `);
    const { customers } = await mod.listCustomers({});
    expect(customers.map((c) => c.id)).toEqual(["C-BUSY", "C-QUIET"]);
  });

  it("listTransactions search + limit works", async () => {
    await seedCustomer("C-1", "ก", 0, 0);
    await mod.createTransaction({ customerId: "C-1", kind: "deposit_account", amount: 5 });
    const all = await mod.listTransactions({ limit: 10 });
    expect(all.transactions).toHaveLength(1);
    expect(all.customers).toHaveLength(1);
    const filtered = await mod.listTransactions({ direction: "withdraw" });
    expect(filtered.transactions).toHaveLength(0);
    const searched = await mod.listTransactions({ search: "ก" });
    expect(searched.transactions).toHaveLength(1);
  });

  it("deposit slip claim insert-select honours ON CONFLICT DO NOTHING", async () => {
    await seedCustomer("C-1", "ก", 0, 0);
    await db.run(`
      INSERT INTO celox_deposits (transaction_id, order_id, reference_id, customer_id, amount_satang,
        transaction_status, local_transaction_id, created_at, updated_at)
      VALUES ('X-1', 'O-1', NULL, 'C-1', 1000, 'PENDING_TRANSFER', NULL, ?, ?)
    `, ["2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    expect(await mod.claimCeloxDepositSlipSubmission("X-1")).toBe(true);
    expect(await mod.claimCeloxDepositSlipSubmission("X-1")).toBe(false);
    expect(await mod.claimCeloxDepositSlipSubmission("NOPE")).toBe(false);
    await mod.releaseCeloxDepositSlipSubmission("X-1");
    expect(await mod.claimCeloxDepositSlipSubmission("X-1")).toBe(true);
  });

  it("withdrawal holds list reads boolean funds_reserved", async () => {
    await seedCustomer("C-1", "ก", 100_000, 100_000);
    const reservationId = await mod.reserveCeloxWithdrawalFunds({
      customerId: "C-1",
      request: {
        amount: 100, destinationBankCode: "004", destinationAccountName: "ก",
        destinationAccountNo: "1234567890", referenceId: "REF-1",
      },
    });
    let holds = await mod.listCustomerCeloxWithdrawalHolds("C-1");
    expect(holds).toHaveLength(1);
    expect(holds[0].kind).toBe("creation");
    expect(holds[0].amount).toBe(100);
    expect(holds[0].canResolve).toBe(false);
    await mod.markCeloxWithdrawalReservationUncertain(reservationId);
    holds = await mod.listCustomerCeloxWithdrawalHolds("C-1");
    expect(holds[0].state).toBe("uncertain");
    expect(holds[0].canResolve).toBe(true);
    await mod.resolveCeloxWithdrawalHold({ customerId: "C-1", key: reservationId, action: "release-reservation" });
    expect(await mod.listCustomerCeloxWithdrawalHolds("C-1")).toHaveLength(0);
    expect(await db.first("SELECT withdrawable_satang FROM customers WHERE id = ?", ["C-1"]))
      .toEqual({ withdrawable_satang: 100_000 });
  });

  it("customerExists and callback listing", async () => {
    await seedCustomer("C-1", "ก", 0, 0);
    expect(await mod.customerExists("C-1")).toBe(true);
    expect(await mod.customerExists("nope")).toBe(false);
    const queued = await mod.enqueueCeloxCallbackEvent({
      transactionId: "TX-1", orderId: "O-1", referenceId: null, status: "SUCCESS",
      amount: 10, occurredAt: "2026-03-01T10:00:00.000Z",
    });
    expect(queued.duplicate).toBe(false);
    expect(typeof queued.eventId).toBe("number");
    const again = await mod.enqueueCeloxCallbackEvent({
      transactionId: "TX-1", orderId: "O-1", referenceId: null, status: "SUCCESS",
      amount: 10, occurredAt: "2026-03-01T10:00:00.000Z",
    });
    expect(again.duplicate).toBe(true);
    expect(again.conflict).toBe(false);
    const processed = await mod.processCeloxCallbackEvent(queued.eventId);
    expect(processed.processingState).toBe("unmatched");
    const fetched = await mod.getCeloxCallbackEvent(queued.eventId);
    expect(fetched?.receivedCount).toBe(2);
    await mod.markCeloxCallbackEventFailed(queued.eventId, "พัง");
    expect((await mod.getCeloxCallbackEvent(queued.eventId))?.lastError).toBe("พัง");
  });
});
