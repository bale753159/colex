import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "./pg-harness";

beforeAll(async () => { await setupTestDatabase(); });
afterAll(async () => { await teardownTestDatabase(); });

// จำนวนตาราง/index/FK ด้านล่างมาจากการนับจริงกับ catalog ของ migration ที่โหลดแล้ว
// (ไม่ใช่นับด้วยตาเปล่า) ดูคำสั่งและผลลัพธ์ที่ใช้ยืนยันตัวเลขเหล่านี้ใน task-2-report.md
const EXPECTED_TABLE_COUNT = 10;
const EXPECTED_EXPLICIT_INDEX_COUNT = 18; // เฉพาะ CREATE INDEX ที่ตั้งชื่อ idx_* เอง ไม่รวม index ที่ Postgres สร้างอัตโนมัติให้ PRIMARY KEY/UNIQUE
const EXPECTED_FOREIGN_KEY_COUNT = 15;

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
    expect(tableNames.length).toBe(EXPECTED_TABLE_COUNT);
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

  it("ไม่มีคอลัมน์ไหนเหลือเป็น integer (ต้องเป็น bigint ทั้งหมด)", async () => {
    const rows = await db.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'integer'`);
    expect(rows).toEqual([]);
  });

  it("คอลัมน์เวลาทั้ง 8 ชื่อเป็น timestamptz ในทุกตารางที่มี", async () => {
    const timestampColumnNames = [
      "created_at", "updated_at", "received_at", "last_received_at",
      "processed_at", "occurred_at", "claimed_at", "match_deadline",
    ];
    const rows = await db.query<{ table_name: string; column_name: string; data_type: string }>(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = ANY($1)`,
      [timestampColumnNames]);
    // ต้องเจออย่างน้อยหนึ่งคอลัมน์ (กันเทสต์ที่ query พลาดจน pass ลอยๆ เพราะไม่เจอแถวเลย)
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.data_type).toBe("timestamp with time zone");
    }
  });

  it("คอลัมน์ boolean ทั้ง 4 ตัวเป็น boolean และ default เป็น false", async () => {
    const booleanColumns = [
      { table_name: "celox_withdrawals", column_name: "funds_reserved" },
      { table_name: "celox_c2c_transactions", column_name: "funds_reserved" },
      { table_name: "celox_c2c_transactions", column_name: "awaiting_manual_review" },
      { table_name: "celox_c2c_callback_events", column_name: "has_transfer_to" },
    ];
    const rows = await db.query<{ table_name: string; column_name: string; data_type: string; column_default: string | null }>(`
      SELECT table_name, column_name, data_type, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'boolean'
      ORDER BY table_name, column_name`);
    expect(rows.length).toBe(booleanColumns.length);
    for (const expected of booleanColumns) {
      const found = rows.find((r) => r.table_name === expected.table_name && r.column_name === expected.column_name);
      expect(found, `หา ${expected.table_name}.${expected.column_name} ไม่เจอ`).toBeDefined();
      expect(found!.data_type).toBe("boolean");
      expect(found!.column_default).toBe("false");
    }
  });

  it(`มี index ที่สร้างเองครบ ${EXPECTED_EXPLICIT_INDEX_COUNT} ตัว`, async () => {
    // ใช้ index ที่ตั้งชื่อ idx_* เท่านั้น เพื่อไม่ให้ปนกับ index ที่ Postgres
    // สร้างอัตโนมัติให้ PRIMARY KEY/UNIQUE (ซึ่งไม่ได้อยู่ใน "18 index" ที่ brief นับ)
    const row = await db.first<{ n: number }>(`
      SELECT COUNT(*)::bigint AS n FROM pg_indexes
      WHERE schemaname = 'public' AND indexname LIKE 'idx\\_%'`);
    expect(row!.n).toBe(EXPECTED_EXPLICIT_INDEX_COUNT);
  });

  it(`มี FOREIGN KEY ครบ ${EXPECTED_FOREIGN_KEY_COUNT} ตัว`, async () => {
    const row = await db.first<{ n: number }>(`
      SELECT COUNT(*)::bigint AS n FROM information_schema.table_constraints
      WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY'`);
    expect(row!.n).toBe(EXPECTED_FOREIGN_KEY_COUNT);
  });

  it("มี CHECK (balance_satang >= 0) บนตาราง customers (ตรวจผ่าน catalog เพราะพิสูจน์ด้วยพฤติกรรมไม่ได้)", async () => {
    // หมายเหตุ: ทดสอบด้วยการยิง UPDATE balance_satang = -1 ตรงๆ ไม่ได้ผล เพราะแถวไหนที่
    // balance_satang < 0 ก็จะละเมิด CHECK (withdrawable_satang >= 0 AND withdrawable_satang
    // <= balance_satang) เสมอด้วย (withdrawable_satang ไม่มีทางน้อยกว่า 0 อยู่แล้ว) ทำให้
    // UPDATE โยน error จาก guard ตัวที่สองเสมอ ไม่ว่า CHECK (balance_satang >= 0) จะมีอยู่จริง
    // หรือถูกลบไปก็ตาม — จึงต้องพิสูจน์การมีอยู่ของ constraint นี้ผ่าน catalog โดยตรง
    const rows = await db.query<{ def: string }>(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'customers'::regclass AND contype = 'c'`);
    const defs = rows.map((r) => r.def);
    expect(defs.some((def) => /balance_satang\s*>=\s*0/.test(def))).toBe(true);
  });

  it("กันยอดถอนได้เกินยอดคงเหลือ", async () => {
    await db.run(`
      INSERT INTO customers (id, name, account, initials, color, balance_satang, withdrawable_satang, created_at)
      VALUES ('C-NEG', 'ทดสอบ', 'ACC-NEG', 'ท', '#000000', 100, 100, now())`);
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

  // ต้องอยู่ท้ายสุดของไฟล์เสมอ: truncateAll() ล้างข้อมูลทั้ง 10 ตาราง จึงลบ fixture
  // (เช่นแถว C-NEG และแถวใน celox_callback_events) ที่เทสต์ก่อนหน้าพึ่งพาอยู่
  it("truncateAll ล้างข้อมูลและรีเซ็ต identity sequence", async () => {
    await db.run(`
      INSERT INTO celox_callback_events
        (transaction_id, order_id, provider_status, amount_satang, received_at, last_received_at)
      VALUES ('TX-TRUNC', 'OD-TRUNC', 'SUCCESS', 100, now(), now())`);
    const before = await db.first<{ n: number }>(
      "SELECT COUNT(*)::bigint AS n FROM celox_callback_events");
    expect(before!.n).toBeGreaterThan(0);

    await truncateAll();

    const after = await db.first<{ n: number }>(
      "SELECT COUNT(*)::bigint AS n FROM celox_callback_events");
    expect(after!.n).toBe(0);

    // ถ้า identity sequence ถูกรีเซ็ตจริง (RESTART IDENTITY) แถวถัดไปต้องได้ id = 1
    // ไม่ใช่เลขต่อจากก่อนหน้า (ซึ่งก่อน truncate เดินไปหลายค่าแล้วจากเทสต์ก่อนๆ ในไฟล์นี้)
    const inserted = await db.first<{ id: number }>(`
      INSERT INTO celox_callback_events
        (transaction_id, order_id, provider_status, amount_satang, received_at, last_received_at)
      VALUES ('TX-TRUNC-2', 'OD-TRUNC-2', 'SUCCESS', 100, now(), now())
      RETURNING id`);
    expect(inserted!.id).toBe(1);
  });
});
