import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, resetPoolForTests, toPositional, tx } from "./sql";

describe("toPositional", () => {
  it("แปลง ? เรียงเป็น $1 $2 ตามลำดับ", () => {
    expect(toPositional("SELECT * FROM t WHERE a = ? AND b = ?"))
      .toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
  });

  it("ไม่แตะ ? ที่อยู่ในสตริงลิเทอรัล", () => {
    expect(toPositional("SELECT 'มี ? อยู่' WHERE a = ?"))
      .toBe("SELECT 'มี ? อยู่' WHERE a = $1");
  });

  it("รองรับ single quote ที่ escape ด้วย ''", () => {
    expect(toPositional("SELECT 'it''s ? here' , ?"))
      .toBe("SELECT 'it''s ? here' , $1");
  });

  it("ไม่แตะ ? ที่อยู่ใน quoted identifier", () => {
    expect(toPositional('SELECT "weird?col" FROM t WHERE a = ?'))
      .toBe('SELECT "weird?col" FROM t WHERE a = $1');
  });

  it("ไม่แตะ ? ใน line comment", () => {
    expect(toPositional("-- ถาม? ตอบ\nSELECT ?"))
      .toBe("-- ถาม? ตอบ\nSELECT $1");
  });

  it("ไม่แตะ ? ใน block comment", () => {
    expect(toPositional("/* ? */ SELECT ?"))
      .toBe("/* ? */ SELECT $1");
  });

  it("นับต่อเนื่องข้ามหลายบรรทัด", () => {
    const sql = `
      INSERT INTO t (a, b, c)
      VALUES (?, ?, ?)
    `;
    expect(toPositional(sql)).toContain("VALUES ($1, $2, $3)");
  });
});

describe("driver", () => {
  beforeAll(async () => {
    process.env.KLANG_TEST_PG = "pglite";
    await db.run(`
      CREATE TABLE IF NOT EXISTS sql_probe (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        amount_satang bigint NOT NULL CHECK (amount_satang >= 0),
        flag boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL
      )
    `);
  });

  afterAll(async () => {
    await resetPoolForTests();
  });

  it("คืน bigint เป็น number ไม่ใช่ string", async () => {
    await db.run("INSERT INTO sql_probe (amount_satang, created_at) VALUES (?, ?)",
      [12345, new Date().toISOString()]);
    const row = await db.first<{ amount_satang: number }>(
      "SELECT amount_satang FROM sql_probe ORDER BY id DESC LIMIT 1");
    expect(typeof row!.amount_satang).toBe("number");
    expect(row!.amount_satang).toBe(12345);
  });

  it("คืน timestamptz เป็น ISO string ไม่ใช่ Date", async () => {
    const stamp = "2026-09-05T03:04:05.000Z";
    await db.run("INSERT INTO sql_probe (amount_satang, created_at) VALUES (?, ?)", [1, stamp]);
    const row = await db.first<{ created_at: string }>(
      "SELECT created_at FROM sql_probe ORDER BY id DESC LIMIT 1");
    expect(row!.created_at).toBe(stamp);
  });

  it("คืน boolean เป็น boolean", async () => {
    await db.run("INSERT INTO sql_probe (amount_satang, flag, created_at) VALUES (?, true, ?)",
      [1, new Date().toISOString()]);
    const row = await db.first<{ flag: boolean }>(
      "SELECT flag FROM sql_probe ORDER BY id DESC LIMIT 1");
    expect(row!.flag).toBe(true);
  });

  it("run คืน rowCount ตามจำนวนแถวที่เปลี่ยนจริง", async () => {
    const hit = await db.run("UPDATE sql_probe SET flag = true WHERE amount_satang = ?", [12345]);
    expect(hit.rowCount).toBe(1);
    const miss = await db.run("UPDATE sql_probe SET flag = true WHERE amount_satang = ?", [-1]);
    expect(miss.rowCount).toBe(0);
  });

  it("tx rollback ทั้งก้อนเมื่อโยน error", async () => {
    const before = await db.first<{ n: number }>("SELECT COUNT(*)::bigint AS n FROM sql_probe");
    await expect(tx(async (t) => {
      await t.run("INSERT INTO sql_probe (amount_satang, created_at) VALUES (?, ?)",
        [999, new Date().toISOString()]);
      throw new Error("จงใจล้ม");
    })).rejects.toThrow("จงใจล้ม");
    const after = await db.first<{ n: number }>("SELECT COUNT(*)::bigint AS n FROM sql_probe");
    expect(after!.n).toBe(before!.n);
  });

  it("tx commit เมื่อสำเร็จ", async () => {
    const id = await tx(async (t) => {
      const row = await t.first<{ id: number }>(
        "INSERT INTO sql_probe (amount_satang, created_at) VALUES (?, ?) RETURNING id",
        [777, new Date().toISOString()]);
      return row!.id;
    });
    const row = await db.first<{ amount_satang: number }>(
      "SELECT amount_satang FROM sql_probe WHERE id = ?", [id]);
    expect(row!.amount_satang).toBe(777);
  });

  it("โยน error เมื่อ bigint เกินช่วงที่ number เก็บได้อย่างปลอดภัย", async () => {
    await expect(
      db.first("SELECT 9007199254740993::bigint AS n")
    ).rejects.toThrow(/เกินช่วงที่ปลอดภัย/);
  });
});
