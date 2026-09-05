import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase } from "./pg-harness";

beforeAll(async () => { await setupTestDatabase(); });
afterAll(async () => { await teardownTestDatabase(); });

describe("schema", () => {
  it("สร้างตารางครบทั้ง 10 ตาราง", async () => {
    const rows = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    const tableNames = rows.map((r) => r.table_name).sort();
    expect(tableNames).toEqual([
      "celox_c2c_callback_events",
      "celox_c2c_transactions",
      "celox_c2c_withdrawal_reservations",
      "celox_callback_events",
      "celox_deposit_slip_claims",
      "celox_deposits",
      "celox_withdrawal_reservations",
      "celox_withdrawals",
      "customers",
      "transactions",
    ].sort());
  });

  it("จำนวนเงินเป็น bigint ไม่ใช่ integer", async () => {
    const row = await db.first<{ data_type: string }>(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'customers' AND column_name = 'balance_satang'`);
    expect(row!.data_type).toBe("bigint");
  });

  it("คอลัมน์เวลาเป็น timestamptz", async () => {
    const row = await db.first<{ data_type: string }>(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'created_at'`);
    expect(row!.data_type).toBe("timestamp with time zone");
  });

  it("funds_reserved เป็น boolean", async () => {
    const row = await db.first<{ data_type: string }>(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'celox_withdrawals' AND column_name = 'funds_reserved'`);
    expect(row!.data_type).toBe("boolean");
  });

  it("กันยอดคงเหลือติดลบ", async () => {
    await db.run(`
      INSERT INTO customers (id, name, account, initials, color, balance_satang, withdrawable_satang, created_at)
      VALUES ('C-NEG', 'ทดสอบ', 'ACC-NEG', 'ท', '#000000', 100, 100, now())`);
    await expect(
      db.run("UPDATE customers SET balance_satang = -1 WHERE id = 'C-NEG'")
    ).rejects.toThrow();
  });

  it("กันยอดถอนได้เกินยอดคงเหลือ", async () => {
    await expect(
      db.run("UPDATE customers SET withdrawable_satang = 999 WHERE id = 'C-NEG'")
    ).rejects.toThrow();
  });

  it("กัน callback ซ้ำด้วย UNIQUE (transaction_id, provider_status)", async () => {
    const insert = `
      INSERT INTO celox_callback_events
        (transaction_id, order_id, provider_status, amount_satang, received_at, last_received_at)
      VALUES ('TX-1', 'OD-1', 'SUCCESS', 100, now(), now())`;
    await db.run(insert);
    await expect(db.run(insert)).rejects.toThrow();
  });

  it("ตัดวันตามเวลาไทย ไม่ใช่ UTC", async () => {
    // 2026-09-05T18:30:00Z = 2026-09-06 01:30 ตามเวลาไทย จึงต้องนับเป็นวันที่ 6
    const row = await db.first<{ thai_date: string }>(`
      SELECT (timestamptz '2026-09-05T18:30:00Z' AT TIME ZONE 'Asia/Bangkok')::date::text AS thai_date`);
    expect(row!.thai_date).toBe("2026-09-06");
  });
});
