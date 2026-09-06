import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgPool, createRequestScopedPgDriver, db, resetPoolForTests, runPgTransaction, toPositional, tx } from "./sql";

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

describe("createPgPool", () => {
  it("ติด listener บน event error ของ pool ไว้ตั้งแต่สร้าง (กัน process ล่มเมื่อ idle client หลุดการเชื่อมต่อ)", () => {
    // ไม่มี Postgres จริงในสภาพแวดล้อมนี้ แต่ pg.Pool ไม่เชื่อมต่อจริงจนกว่าจะมี query/connect()
    // แรก ดังนั้นสร้าง pool เปล่าๆ แล้วเช็ค listener ได้โดยไม่ต้องมี network หรือ server จริง
    const pool = createPgPool("postgres://user:pass@127.0.0.1:1/nonexistent");
    try {
      expect(pool.listenerCount("error")).toBeGreaterThan(0);
    } finally {
      void pool.end().catch(() => {});
    }
  });
});

describe("createRequestScopedPgDriver", () => {
  // บน Cloudflare Workers ห้ามใช้ I/O object ที่สร้างในบริบทของ request หนึ่งจากอีก request
  // pg.Pool ที่แคช socket ไว้ข้าม request จึงทำให้ request ที่สอง hang ตลอดกาลจน runtime
  // ยกเลิกทิ้ง (error 1101) driver ตัวนี้จึงต้องเปิด connection ใหม่ทุกครั้งและปิดทุกครั้ง
  function fakeClient() {
    const calls: string[] = [];
    return {
      calls,
      ended: 0,
      query: async (sql: string) => { calls.push(sql); return { rows: [], rowCount: 0 }; },
      end: async function (this: { ended: number }) { this.ended += 1; },
    };
  }

  it("เปิด client ใหม่ทุกครั้งที่ exec ไม่ reuse ของเดิมข้าม request", async () => {
    const made: ReturnType<typeof fakeClient>[] = [];
    const driver = createRequestScopedPgDriver(async () => {
      const c = fakeClient();
      made.push(c);
      return c as never;
    });

    await driver.exec("SELECT 1", []);
    await driver.exec("SELECT 2", []);

    expect(made).toHaveLength(2);
    expect(made[0]).not.toBe(made[1]);
  });

  it("ปิด client ทุกครั้งหลังใช้เสร็จ ไม่ทิ้ง connection ค้างไว้ให้ Supabase", async () => {
    const made: ReturnType<typeof fakeClient>[] = [];
    const driver = createRequestScopedPgDriver(async () => {
      const c = fakeClient();
      made.push(c);
      return c as never;
    });

    await driver.exec("SELECT 1", []);

    expect(made[0]!.ended).toBe(1);
  });

  it("ปิด client แม้ query จะโยน error", async () => {
    const client = fakeClient();
    client.query = async () => { throw new Error("query พัง"); };
    const driver = createRequestScopedPgDriver(async () => client as never);

    await expect(driver.exec("SELECT 1", [])).rejects.toThrow("query พัง");
    expect(client.ended).toBe(1);
  });

  it("ใช้ client ตัวเดียวตลอด transaction แล้วค่อยปิด", async () => {
    const made: ReturnType<typeof fakeClient>[] = [];
    const driver = createRequestScopedPgDriver(async () => {
      const c = fakeClient();
      made.push(c);
      return c as never;
    });

    await driver.transaction(async (exec) => {
      await exec("INSERT INTO t VALUES (?)", [1]);
      await exec("INSERT INTO t VALUES (?)", [2]);
      return null as never;
    });

    expect(made).toHaveLength(1);
    expect(made[0]!.calls).toEqual([
      "BEGIN",
      // toPositional นับ placeholder ใหม่ทุกคำสั่ง ทั้งสองบรรทัดจึงเป็น $1
      "INSERT INTO t VALUES ($1)",
      "INSERT INTO t VALUES ($1)",
      "COMMIT",
    ]);
    expect(made[0]!.ended).toBe(1);
  });
});

describe("runPgTransaction", () => {
  it("รักษา error เดิมไว้เมื่อ ROLLBACK สำเร็จ", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql === "ROLLBACK") return { rows: [], rowCount: 0 };
        if (sql === "BEGIN") return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    };
    await expect(
      runPgTransaction(client, async () => {
        throw new Error("จงใจล้มใน transaction");
      }),
    ).rejects.toThrow("จงใจล้มใน transaction");
    expect(queries).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("ไม่กลืน error เดิมทิ้งเมื่อ ROLLBACK ล้มเหลวด้วย — ต้องเก็บทั้งสอง error ไว้", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql === "BEGIN") return { rows: [], rowCount: 0 };
        if (sql === "ROLLBACK") throw new Error("ROLLBACK พัง เพราะ connection หลุดไปแล้ว");
        return { rows: [], rowCount: 0 };
      },
    };

    let caught: unknown;
    try {
      await runPgTransaction(client, async () => {
        throw new Error("สาเหตุจริงที่ transaction ล้ม");
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect((aggregate.errors[0] as Error).message).toBe("สาเหตุจริงที่ transaction ล้ม");
    expect((aggregate.errors[1] as Error).message).toBe("ROLLBACK พัง เพราะ connection หลุดไปแล้ว");
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

  it("SUM(bigint) คืน number ไม่ใช่ string แม้ไม่มี ::bigint cast", async () => {
    // ใช้ค่าที่ไม่ซ้ำกับเทสต์อื่นในไฟล์นี้ แล้วกรองด้วย WHERE เพื่อไม่ให้แถวจากเทสต์อื่น
    // (ที่แชร์ตาราง sql_probe เดียวกัน) มากระทบผลรวม
    const a = 543210;
    const b = 111111;
    const stamp = new Date().toISOString();
    await db.run("INSERT INTO sql_probe (amount_satang, created_at) VALUES (?, ?)", [a, stamp]);
    await db.run("INSERT INTO sql_probe (amount_satang, created_at) VALUES (?, ?)", [b, stamp]);
    const row = await db.first<{ total: number }>(
      "SELECT COALESCE(SUM(amount_satang), 0) AS total FROM sql_probe WHERE amount_satang IN (?, ?)",
      [a, b]);
    expect(typeof row!.total).toBe("number");
    expect(row!.total).toBe(a + b);
  });
});
