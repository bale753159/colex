import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest, CeloxCallbackRequest } from "./celox/types";

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
  it("listCustomers: ส่งบัญชีธนาคารของลูกค้าออกไปให้หน้าฝาก/ถอน C2C ใช้ init ฟอร์ม", async () => {
    await seedCustomer("C-BANK", "มีบัญชี", 0, 0);
    await seedCustomer("C-NONE", "ไม่มีบัญชี", 0, 0);
    await db.run("UPDATE customers SET bank_code = ?, bank_account_no = ? WHERE id = ?",
      ["014", "1234567890", "C-BANK"]);

    const { allCustomers } = await mod.listCustomers();
    const withBank = allCustomers.find((customer) => customer.id === "C-BANK");
    const withoutBank = allCustomers.find((customer) => customer.id === "C-NONE");
    expect(withBank).toMatchObject({ bankCode: "014", bankAccountNo: "1234567890" });
    // ลูกค้าที่ยังไม่ผูกบัญชีได้ค่าว่าง หน้าเว็บใช้ค่านี้บล็อกไม่ให้เปิดรายการ C2C
    expect(withoutBank).toMatchObject({ bankCode: "", bankAccountNo: "" });
  });

  it("listTransactions: แนบบัญชีธนาคารมากับลูกค้าของแต่ละธุรกรรมด้วย", async () => {
    await seedCustomer("C-TX", "เจ้าของรายการ", 0, 0);
    await db.run("UPDATE customers SET bank_code = ?, bank_account_no = ? WHERE id = ?",
      ["004", "2345678901", "C-TX"]);
    await mod.createTransaction({ customerId: "C-TX", kind: "deposit_account", amount: 100 });

    const { transactions } = await mod.listTransactions();
    expect(transactions[0].customer).toMatchObject({ bankCode: "004", bankAccountNo: "2345678901" });
  });

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

  // SQLite's date('malformed') returns NULL, so the comparison was false and the query
  // returned zero matching rows. Postgres's '...'::date raises SQLSTATE 22007 instead, which
  // without validation turns a malformed from/to into an unhandled rejection (a 500 at the
  // route). dateClause must restore the old "no matching rows" behaviour instead of rejecting.
  it("listCustomers resolves (not rejects) with a malformed from/to instead of raising", async () => {
    await seedCustomer("C-1", "ก", 100_000, 100_000);
    await db.run(`
      INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
      VALUES ('T-1', 'C-1', 'deposit', 'account', 1000, '', 'success', '2026-03-01T00:00:00Z')
    `);

    const badFrom = await mod.listCustomers({ from: "not-a-date", to: "2026-03-02" });
    expect(badFrom.summary.transactionCount).toBe(0);
    expect(badFrom.customers[0].depositTotal).toBe(0);

    const badTo = await mod.listCustomers({ from: "2026-03-01", to: "abc" });
    expect(badTo.summary.transactionCount).toBe(0);

    // valid dates on both ends still match, proving the guard only rejects malformed input
    const valid = await mod.listCustomers({ from: "2026-03-01", to: "2026-03-01" });
    expect(valid.summary.transactionCount).toBe(1);
  });

  // A shape-valid but calendar-impossible date (e.g. month 13, day 45) still matches
  // DATE_ONLY_SHAPE and would still reach `?::date`, raising SQLSTATE 22007 the same way a
  // malformed string does. dateClause must treat it the same as a malformed date.
  it("listCustomers resolves (not rejects) with a shape-valid but impossible calendar date", async () => {
    await seedCustomer("C-1", "ก", 100_000, 100_000);
    await db.run(`
      INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
      VALUES ('T-1', 'C-1', 'deposit', 'account', 1000, '', 'success', '2026-03-01T00:00:00Z')
    `);

    const badMonth = await mod.listCustomers({ from: "2026-13-01", to: "2026-03-02" });
    expect(badMonth.summary.transactionCount).toBe(0);
    expect(badMonth.customers[0].depositTotal).toBe(0);

    const badDay = await mod.listCustomers({ from: "2026-03-01", to: "2026-02-45" });
    expect(badDay.summary.transactionCount).toBe(0);

    // valid dates on both ends still match, proving the guard only rejects impossible calendar dates
    const valid = await mod.listCustomers({ from: "2026-03-01", to: "2026-03-01" });
    expect(valid.summary.transactionCount).toBe(1);
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

  // occurred_at เคยเป็น TEXT ใน SQLite (เก็บสตริงตามที่ Celox ส่งมา) ตอนนี้เป็น timestamptz
  // ที่อ่านกลับมาเป็น UTC ISO เสมอ ถ้าเทียบสตริงตรงตัว payload เดิมที่เขียนเวลาต่างรูปแบบ
  // จะกลายเป็น conflict (HTTP 409) แทน duplicate — ต้องเทียบที่ "ช่วงเวลา" เท่านั้น
  it("treats a redelivered account callback as a duplicate across ISO spellings", async () => {
    const base: Omit<CeloxCallbackRequest, "occurredAt"> = {
      transactionId: "TX-ISO", orderId: "O-ISO", referenceId: null, status: "SUCCESS", amount: 10,
    };
    // ทั้งสามสตริงคือช่วงเวลาเดียวกัน: 2026-08-30T10:05:12Z
    const first = await mod.enqueueCeloxCallbackEvent({ ...base, occurredAt: "2026-08-30T10:05:12.000Z" });
    expect(first.duplicate).toBe(false);
    expect(first.conflict).toBe(false);

    const offsetSpelling = await mod.enqueueCeloxCallbackEvent({ ...base, occurredAt: "2026-08-30T17:05:12+07:00" });
    expect(offsetSpelling.eventId).toBe(first.eventId);
    expect(offsetSpelling.duplicate).toBe(true);
    expect(offsetSpelling.conflict).toBe(false);

    const noMillis = await mod.enqueueCeloxCallbackEvent({ ...base, occurredAt: "2026-08-30T10:05:12Z" });
    expect(noMillis.duplicate).toBe(true);
    expect(noMillis.conflict).toBe(false);

    // เวลาต่างกันจริงยังต้องเป็น conflict เหมือนเดิม
    const realConflict = await mod.enqueueCeloxCallbackEvent({ ...base, occurredAt: "2026-08-30T10:05:13.000Z" });
    expect(realConflict.conflict).toBe(true);
    expect(realConflict.shouldProcess).toBe(false);
  });

  it("treats a redelivered C2C callback as a duplicate across ISO spellings", async () => {
    const hash = "b".repeat(64);
    const base: Omit<CeloxC2CCallbackRequest, "occurredAt"> = {
      transactionId: "TX-C2C-ISO", orderId: "O-C2C-ISO", referenceId: "REF-C2C-ISO",
      status: "SUCCESS", amount: 25,
      parts: [{ transactionId: "TX-C2C-ISO", orderId: "O-C2C-ISO", amount: 25, status: "SUCCESS" }],
      unfilledAmount: 0,
    };
    const first = await mod.enqueueCeloxC2CCallbackEvent({ ...base, occurredAt: "2026-08-30T10:05:12.000Z" }, hash);
    expect(first.duplicate).toBe(false);
    expect(first.conflict).toBe(false);

    const offsetSpelling = await mod.enqueueCeloxC2CCallbackEvent({ ...base, occurredAt: "2026-08-30T17:05:12+07:00" }, hash);
    expect(offsetSpelling.eventId).toBe(first.eventId);
    expect(offsetSpelling.duplicate).toBe(true);
    expect(offsetSpelling.conflict).toBe(false);

    const noMillis = await mod.enqueueCeloxC2CCallbackEvent({ ...base, occurredAt: "2026-08-30T10:05:12Z" }, hash);
    expect(noMillis.duplicate).toBe(true);
    expect(noMillis.conflict).toBe(false);

    const realConflict = await mod.enqueueCeloxC2CCallbackEvent({ ...base, occurredAt: "2026-08-30T10:05:13.000Z" }, hash);
    expect(realConflict.conflict).toBe(true);
    expect(realConflict.shouldProcess).toBe(false);
  });

  it("still treats a null occurredAt as matching only another null", async () => {
    const base: Omit<CeloxCallbackRequest, "occurredAt"> = {
      transactionId: "TX-NULL", orderId: "O-NULL", referenceId: null, status: "PENDING", amount: 10,
    };
    const first = await mod.enqueueCeloxCallbackEvent({ ...base, occurredAt: null });
    expect(first.conflict).toBe(false);
    const sameNull = await mod.enqueueCeloxCallbackEvent({ ...base, occurredAt: null });
    expect(sameNull.duplicate).toBe(true);
    expect(sameNull.conflict).toBe(false);
    const nowDated = await mod.enqueueCeloxCallbackEvent({ ...base, occurredAt: "2026-08-30T10:05:12.000Z" });
    expect(nowDated.conflict).toBe(true);
  });

  it("search matches case-insensitively, as SQLite LIKE did", async () => {
    await seedCustomer("C-1", "วรพงษ์", 0, 0);
    await mod.createTransaction({ customerId: "C-1", kind: "deposit_account", amount: 5 });
    // account เป็น `ACC-C-1` ตัวพิมพ์ใหญ่ — พิมพ์ตัวเล็กต้องยังเจอ
    expect((await mod.listCustomers({ search: "acc-c-1" })).customers).toHaveLength(1);
    expect((await mod.listCustomers({ search: "ACC-C-1" })).customers).toHaveLength(1);
    expect((await mod.listCustomers({ search: "acc-nope" })).customers).toHaveLength(0);
    expect((await mod.listTransactions({ search: "acc-c-1" })).transactions).toHaveLength(1);
    expect((await mod.listTransactions({ search: "txn-" })).transactions).toHaveLength(1);
  });

  it("C2C listing search matches case-insensitively", async () => {
    await seedCustomer("C-1", "ก", 100_000, 100_000);
    await db.run(`
      INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
      VALUES ('TXN-C2C-1', 'C-1', 'withdraw', 'c2c', 1000, '', 'pending', '2026-03-01T00:00:00Z')
    `);
    await db.run(`
      INSERT INTO celox_c2c_transactions (
        transaction_id, order_id, reference_id, customer_id, direction,
        transaction_status, amount_satang, fee_amount_satang, settled_amount_satang,
        held_amount_satang, awaiting_manual_review, match_deadline, funds_reserved,
        local_transaction_id, created_at, updated_at
      ) VALUES ('TX-UP', 'ORD-UPPER', 'REF-UPPER', 'C-1', 'withdraw',
        'PENDING_TRANSFER', 1000, 0, 0, 1000, false, NULL, true, 'TXN-C2C-1', ?, ?)
    `, ["2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z"]);
    expect(await mod.listCeloxC2CTransactions({ search: "ord-upper" })).toHaveLength(1);
    expect(await mod.listCeloxC2CTransactions({ search: "ref-upper" })).toHaveLength(1);
    expect(await mod.listCeloxC2CTransactions({ search: "tx-up" })).toHaveLength(1);
    expect(await mod.listCeloxC2CTransactions({ search: "ord-nope" })).toHaveLength(0);
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
