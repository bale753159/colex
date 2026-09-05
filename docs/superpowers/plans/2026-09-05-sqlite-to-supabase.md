# SQLite → Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ย้าย persistence layer ของ klang-finance-dashboard จาก better-sqlite3 ไปเป็น Postgres บน Supabase โดยรักษาพฤติกรรมของระบบเงินไว้ทุกประการ

**Architecture:** ชั้นบางๆ `lib/sql.ts` ปิด driver ไว้ข้างหลังและแปลง placeholder `?` → `$n` อัตโนมัติ ทำให้ SQL literal เดิมกว่า 200 ก้อนใน `lib/db.ts` ย้ายมาได้โดยไม่ต้องไล่แก้ตำแหน่งตัวแปร schema ย้ายออกจาก runtime ไปเป็นไฟล์ `supabase/migrations/0001_init.sql` ซึ่งทั้ง Supabase จริงและ PGlite ในเทสต์อ่านไฟล์เดียวกัน

**Tech Stack:** Next.js 16.3.3, TypeScript 5.9, `pg` (node-postgres), `@electric-sql/pglite` (เทสต์), Vitest 4

**Spec:** `docs/superpowers/specs/2026-09-05-sqlite-to-supabase-design.md`

## Global Constraints

- ห้ามเปลี่ยนตรรกะเงิน ยกเว้น TOCTOU ใน `createTransaction` (Task 3 Step 12) เท่านั้น การพอร์ตนี้ต้องอ่านได้ว่าเป็น "แปลง dialect"
- ห้ามใช้ `supabase-js`, PostgREST, Realtime, Auth, Storage และห้ามเปิด RLS
- ห้ามแตะ UI, component หรือ `app/**/page.tsx` — ไม่มีหน้าไหน import `lib/db` ตรง
- จำนวนเงินทุกคอลัมน์เป็น `bigint` และต้องกลับมาเป็น JavaScript `number` เสมอ ห้ามเป็น `string`
- ข้อความ error ที่ผู้ใช้เห็นทั้งหมดเป็นภาษาไทย คงข้อความเดิมทุกตัวอักษร
- ไทม์โซนสำหรับตัดวันคือ `Asia/Bangkok`
- `npm test` และ `npm run build` ต้องผ่านทั้งคู่ก่อนปิดทุก task

---

### Task 1: `lib/sql.ts` — ชั้นเข้าถึงฐานข้อมูล

ชั้นนี้เป็นรากของทุกอย่างที่ตามมา และมีกับดักสองอย่างที่ถ้าพลาดจะทำให้เลขเงินผิดแบบเงียบๆ: `pg` คืน `bigint` เป็น string (`"100" + 50` = `"10050"`) และคืน `timestamptz` เป็น `Date` ไม่ใช่ ISO string แบบที่โค้ดเดิมคาดไว้ ทั้งสองอย่างแก้ที่นี่ที่เดียว

**Files:**
- Create: `lib/sql.ts`
- Create: `lib/sql.test.ts`
- Modify: `package.json` (เพิ่ม `pg`, `@types/pg`, `@electric-sql/pglite`)

**Interfaces:**
- Consumes: ไม่มี (งานชิ้นแรก)
- Produces:
  ```ts
  export type Row = Record<string, unknown>;
  export interface Queryable {
    query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
    first<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
    run(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
  }
  export type Tx = Queryable;
  export const db: Queryable;
  export function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>;
  export function toPositional(sql: string): string;
  export function resetPoolForTests(): Promise<void>;
  ```

- [ ] **Step 1: ติดตั้ง dependency**

```bash
npm install pg
npm install --save-dev @types/pg @electric-sql/pglite
```

- [ ] **Step 2: เขียนเทสต์ที่ล้มเหลวสำหรับตัวแปลง placeholder**

สร้าง `lib/sql.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toPositional } from "./sql";

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
```

- [ ] **Step 3: รันเทสต์เพื่อยืนยันว่าล้มเหลว**

Run: `npx vitest run lib/sql.test.ts`
Expected: FAIL — `Failed to resolve import "./sql"`

- [ ] **Step 4: เขียน `toPositional` และโครง driver**

สร้าง `lib/sql.ts`:

```ts
import { Pool, types as pgTypes } from "pg";

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

export type Tx = Queryable;

/**
 * แปลง placeholder สไตล์ SQLite (`?`) เป็นสไตล์ Postgres (`$1`, `$2`, ...)
 * ข้าม `?` ที่อยู่ในสตริงลิเทอรัล quoted identifier และคอมเมนต์
 *
 * โค้ดเบสนี้ไม่ได้ใช้ jsonb operator (`?`, `?|`, `?&`) ถ้าวันหนึ่งต้องใช้
 * ให้เขียน SQL ก้อนนั้นด้วย `$n` เองแล้วข้ามตัวแปลงนี้
 */
export function toPositional(sql: string): string {
  let out = "";
  let index = 0;
  let position = 0;

  while (position < sql.length) {
    const char = sql[position];
    const next = sql[position + 1];

    if (char === "'" || char === '"') {
      const quote = char;
      out += char;
      position += 1;
      while (position < sql.length) {
        if (sql[position] === quote && sql[position + 1] === quote) {
          out += quote + quote;
          position += 2;
          continue;
        }
        if (sql[position] === quote) {
          out += quote;
          position += 1;
          break;
        }
        out += sql[position];
        position += 1;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", position);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(position, stop);
      position = stop;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", position + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(position, stop);
      position = stop;
      continue;
    }

    if (char === "?") {
      index += 1;
      out += `$${index}`;
      position += 1;
      continue;
    }

    out += char;
    position += 1;
  }

  return out;
}
```

- [ ] **Step 5: รันเทสต์เพื่อยืนยันว่าผ่าน**

Run: `npx vitest run lib/sql.test.ts`
Expected: PASS ทั้ง 7 เคส

- [ ] **Step 6: Commit**

```bash
git add lib/sql.ts lib/sql.test.ts package.json package-lock.json
git commit -m "feat: add SQL placeholder converter for Postgres"
```

- [ ] **Step 7: เขียนเทสต์ที่ล้มเหลวสำหรับ type parser และ transaction**

เพิ่มใน `lib/sql.test.ts`:

```ts
import { beforeAll, afterAll } from "vitest";
import { db, tx, resetPoolForTests } from "./sql";

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
```

- [ ] **Step 8: รันเทสต์เพื่อยืนยันว่าล้มเหลว**

Run: `npx vitest run lib/sql.test.ts`
Expected: FAIL — `db`, `tx`, `resetPoolForTests` ยังไม่ถูก export

- [ ] **Step 9: เขียน driver, type parser และ `tx`**

เพิ่มท้าย `lib/sql.ts`:

```ts
const OID_INT8 = 20;
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;

function toSafeInt(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`ค่าจำนวนเต็มจากฐานข้อมูลเกินช่วงที่ปลอดภัย: ${value}`);
  }
  return parsed;
}

function toIsoString(value: string | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString();
}

type Exec = (sql: string, params: unknown[]) => Promise<{ rows: Row[]; rowCount: number }>;

interface Driver {
  exec: Exec;
  transaction<T>(fn: (exec: Exec) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let driverPromise: Promise<Driver> | undefined;

async function createPgDriver(): Promise<Driver> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("ไม่พบ DATABASE_URL กรุณาตั้งค่าการเชื่อมต่อ Supabase ใน .env.local");
  }
  pgTypes.setTypeParser(OID_INT8, toSafeInt as (value: string) => number);
  pgTypes.setTypeParser(OID_TIMESTAMPTZ, toIsoString as (value: string) => string);
  pgTypes.setTypeParser(OID_TIMESTAMP, toIsoString as (value: string) => string);
  const pool = new Pool({ connectionString, max: 10 });

  const exec: Exec = async (sql, params) => {
    const result = await pool.query(toPositional(sql), params);
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
  };

  return {
    exec,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        // BEGIN เปล่าคือ READ COMMITTED ซึ่งเป็นค่าปกติของ Postgres และเป็นสิ่งที่ spec เลือกไว้
        // guard predicate บวก row lock เพียงพอแล้ว ไม่ต้องใช้ SERIALIZABLE ซึ่งจะบังคับให้เขียน retry loop ทุกจุด
        await client.query("BEGIN");
        const scoped: Exec = async (sql, params) => {
          const result = await client.query(toPositional(sql), params);
          return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
        };
        const value = await fn(scoped);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPgliteDriver(): Promise<Driver> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const client = new PGlite({
    parsers: {
      [OID_INT8]: toSafeInt,
      [OID_TIMESTAMPTZ]: toIsoString,
      [OID_TIMESTAMP]: toIsoString,
    },
    serializers: {
      [OID_TIMESTAMPTZ]: (value: unknown) => String(value),
      [OID_TIMESTAMP]: (value: unknown) => String(value),
    },
  });
  void types;

  const execWith = (target: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Exec =>
    async (sql, params) => {
      const result = await target.query(toPositional(sql), params);
      return { rows: result.rows as Row[], rowCount: result.affectedRows ?? result.rows.length };
    };

  return {
    exec: execWith(client),
    async transaction(fn) {
      return client.transaction(async (t) => fn(execWith(t))) as Promise<never>;
    },
    close: () => client.close(),
  };
}

function getDriver(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise = process.env.KLANG_TEST_PG === "pglite"
      ? createPgliteDriver()
      : createPgDriver();
  }
  return driverPromise;
}

function wrap(exec: Exec): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await exec(sql, params);
      return result.rows as T[];
    },
    async first<T>(sql: string, params: unknown[] = []) {
      const result = await exec(sql, params);
      return result.rows[0] as T | undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      const result = await exec(sql, params);
      return { rowCount: result.rowCount };
    },
  };
}

export const db: Queryable = {
  query: async (sql, params) => wrap((await getDriver()).exec).query(sql, params),
  first: async (sql, params) => wrap((await getDriver()).exec).first(sql, params),
  run: async (sql, params) => wrap((await getDriver()).exec).run(sql, params),
};

export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  const driver = await getDriver();
  return driver.transaction((exec) => fn(wrap(exec)));
}

/** ใช้ในเทสต์เท่านั้น: ปิด connection แล้วบังคับให้สร้าง driver ใหม่ครั้งถัดไป */
export async function resetPoolForTests(): Promise<void> {
  if (!driverPromise) return;
  const driver = await driverPromise;
  driverPromise = undefined;
  await driver.close();
}
```

- [ ] **Step 10: รันเทสต์ และแก้จนผ่าน**

Run: `npx vitest run lib/sql.test.ts`
Expected: PASS ทั้งหมด

หมายเหตุสำหรับผู้ทำ: PGlite อาจตั้งชื่อ option ของ parser/serializer ต่างจากที่เขียนไว้ ให้เช็ก `node_modules/@electric-sql/pglite/dist/index.d.ts` แล้วปรับให้ตรง **สิ่งที่ห้ามยอมคือผลลัพธ์**: เทสต์สามข้อแรกต้องผ่าน (bigint เป็น number, timestamptz เป็น ISO string, boolean เป็น boolean) ถ้า PGlite ไม่เปิดให้ตั้ง parser ให้ทำ normalize ในฟังก์ชัน `execWith` แทน

- [ ] **Step 11: Commit**

```bash
git add lib/sql.ts lib/sql.test.ts
git commit -m "feat: add Postgres driver layer with bigint and timestamp parsers"
```

---

### Task 2: Schema migration และ test harness

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `supabase/seed.sql`
- Create: `test/pg-harness.ts`
- Create: `test/schema.test.ts`
- Read เพื่ออ้างอิง: `lib/db.ts:449-627` (DDL เดิม), `lib/db.ts:280-315` (seed เดิม)

**Interfaces:**
- Consumes: `db`, `tx`, `resetPoolForTests` จาก `lib/sql.ts`
- Produces:
  ```ts
  // test/pg-harness.ts
  export async function setupTestDatabase(): Promise<void>;  // ตั้ง env + apply migration
  export async function teardownTestDatabase(): Promise<void>;
  export async function truncateAll(): Promise<void>;
  ```

- [ ] **Step 1: เขียน `supabase/migrations/0001_init.sql`**

คัดลอกบล็อก DDL ทั้งก้อนจาก `lib/db.ts:449-627` ออกมาก่อนแบบคำต่อคำ แล้วค่อยไล่แปลงทีละบรรทัด
ตามตารางข้างล่าง ห้ามพิมพ์ schema ขึ้นใหม่จากความจำ เพราะจะทำให้ constraint หล่นโดยไม่รู้ตัว
เทสต์ใน Step 4 เป็นตัวตัดสินว่าแปลงครบหรือยัง:

| SQLite เดิม | Postgres ใหม่ |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `INTEGER NOT NULL CHECK (x IN (0, 1))` | `boolean NOT NULL` |
| `INTEGER` ที่เป็นจำนวนเงินหรือตัวนับ | `bigint` |
| `TEXT` ที่เก็บ ISO 8601 (`created_at`, `updated_at`, `received_at`, `last_received_at`, `processed_at`, `occurred_at`, `claimed_at`, `match_deadline`) | `timestamptz` |
| `TEXT` อื่นๆ | `text` |
| `CREATE TABLE IF NOT EXISTS` | `CREATE TABLE IF NOT EXISTS` (คงเดิม) |

ค่า default ของ boolean: `funds_reserved INTEGER NOT NULL DEFAULT 0` → `funds_reserved boolean NOT NULL DEFAULT false`

`CHECK` constraint ทุกตัวคงไว้ตามเดิม ยกเว้นตัวที่บังคับ `IN (0, 1)` ซึ่งหายไปเพราะ type เป็น boolean แล้ว **ห้ามลบสองตัวนี้เด็ดขาด** เพราะเป็นตาข่ายกันยอดเพี้ยนชั้นสุดท้าย:

```sql
CHECK (balance_satang >= 0)
CHECK (withdrawable_satang >= 0 AND withdrawable_satang <= balance_satang)
```

`UNIQUE (transaction_id, provider_status)` ของทั้ง `celox_callback_events` และ `celox_c2c_callback_events` ต้องมี เพราะโค้ดพึ่งมันในการตรวจ callback ซ้ำ

index ทั้ง 18 ตัวจาก `lib/db.ts:606-625` คัดลอกมาครบ (ไวยากรณ์เหมือนกันทั้งสอง engine)

- [ ] **Step 2: เขียน `supabase/seed.sql`**

แปลง `seedDatabase()` (`lib/db.ts:280-315`) เป็น SQL ล้วน อ่านค่าลูกค้าตัวอย่างทั้ง 7 คนจากโค้ดเดิม ปิดท้ายทุก INSERT ด้วย `ON CONFLICT DO NOTHING` เพื่อให้รันซ้ำได้

- [ ] **Step 3: เขียน `test/pg-harness.ts`**

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db, resetPoolForTests } from "@/lib/sql";

const MIGRATION = fileURLToPath(
  new URL("../supabase/migrations/0001_init.sql", import.meta.url),
);

const TABLES = [
  "celox_c2c_callback_events",
  "celox_callback_events",
  "celox_c2c_withdrawal_reservations",
  "celox_withdrawal_reservations",
  "celox_deposit_slip_claims",
  "celox_c2c_transactions",
  "celox_withdrawals",
  "celox_deposits",
  "transactions",
  "customers",
];

export async function setupTestDatabase(): Promise<void> {
  process.env.KLANG_TEST_PG = "pglite";
  const sql = await readFile(MIGRATION, "utf8");
  await db.run(sql);
}

export async function truncateAll(): Promise<void> {
  await db.run(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function teardownTestDatabase(): Promise<void> {
  await resetPoolForTests();
}
```

หมายเหตุ: `setupTestDatabase` ต้องตั้ง `KLANG_TEST_PG` **ก่อน** ที่ `lib/sql.ts` จะสร้าง driver ครั้งแรก ในไฟล์เทสต์ให้เรียกใน `beforeAll` และ import `lib/db` แบบ dynamic (`await import("./db")`) หลังจากนั้น — แบบเดียวกับที่เทสต์เดิมทำกับ `KLANG_DB_PATH`

- [ ] **Step 4: เขียนเทสต์ schema ที่ล้มเหลว**

สร้าง `test/schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase } from "./pg-harness";

beforeAll(async () => { await setupTestDatabase(); });
afterAll(async () => { await teardownTestDatabase(); });

describe("schema", () => {
  it("สร้างตารางครบทั้ง 10 ตาราง", async () => {
    const rows = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    expect(rows.map((r) => r.table_name)).toEqual([
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
    ]);
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
```

- [ ] **Step 5: รันเทสต์เพื่อยืนยันว่าล้มเหลว**

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL — ยังไม่มีไฟล์ migration หรือตารางยังไม่ครบ

- [ ] **Step 6: แก้ migration จนเทสต์ผ่าน**

Run: `npx vitest run test/schema.test.ts`
Expected: PASS ทั้ง 8 เคส

- [ ] **Step 7: Commit**

```bash
git add supabase/ test/pg-harness.ts test/schema.test.ts
git commit -m "feat: add Postgres schema migration and PGlite test harness"
```

---

### Task 3: พอร์ต `lib/db.ts` ทั้งไฟล์

งานชิ้นนี้ใหญ่และ **จงใจไม่แตกย่อย** เพราะการแตกจะทำให้เกิดสถานะกลางที่ครึ่งหนึ่งของแอปเขียนลง Postgres และอีกครึ่งยังอ่านจาก SQLite ซึ่งอันตรายกว่างานก้อนใหญ่ที่ตรวจครั้งเดียว ให้ทำตามลำดับกลุ่มฟังก์ชันข้างล่างและรันเทสต์ระหว่างทาง แต่ commit ครั้งเดียวตอนจบ

**Files:**
- Modify: `lib/db.ts` (ทั้งไฟล์ 2,758 บรรทัด)
- Modify: `lib/db.c2c-withdraw-settlement.test.ts`
- Modify: `lib/celox/c2c-callback-handler.server.test.ts`
- Modify: 16 route ใต้ `app/api/` และ 3 ไฟล์ใต้ `lib/celox/` (รายชื่อใน Step 13)

**Interfaces:**
- Consumes: `db`, `tx`, `Tx`, `Queryable` จาก `lib/sql.ts`; `setupTestDatabase`, `truncateAll`, `teardownTestDatabase` จาก `test/pg-harness.ts`
- Produces: export ทั้ง 39 ตัวของ `lib/db.ts` โดยชื่อและพารามิเตอร์เดิมทุกตัว แต่คืน `Promise<T>` แทน `T` (`getDatabase` ถูกลบ ไม่นับ)

- [ ] **Step 1: ลบโค้ดที่ตายแล้ว**

ลบทิ้งทั้งหมด — เริ่ม DB ใหม่จึงไม่มีอะไรให้ migrate:

- `import Database from "better-sqlite3"` และ `import { mkdirSync } from "node:fs"`, `import { dirname, join } from "node:path"`
- `type SqliteDatabase` (บรรทัด 36)
- `declare global { var __klangFinanceDb }` (บรรทัด 38-40)
- `const databasePath` (บรรทัด 194)
- `seedDatabase()` (280-315) — ย้ายไป `supabase/seed.sql` แล้วใน Task 2
- `transactionsSupportProcessingStatuses()` (317-321)
- `migrateTransactionsToProcessingStatuses()` (323-376)
- `backfillCeloxDepositTransactions()` (378-430)
- `migrateDatabase()` (432-438)
- `getDatabase()` (440-627) — DDL ย้ายไป `supabase/migrations/0001_init.sql` แล้ว

- [ ] **Step 2: แก้ row type ที่เป็น boolean**

```ts
// lib/db.ts:102, 153, 155, 181
funds_reserved: 0 | 1;            →  funds_reserved: boolean;
awaiting_manual_review: 0 | 1;    →  awaiting_manual_review: boolean;
has_transfer_to: 0 | 1;           →  has_transfer_to: boolean;
```

- [ ] **Step 3: ใช้กฎแปลงเชิงกลกับทั้งไฟล์**

| เดิม | ใหม่ |
|---|---|
| `const db = getDatabase();` | ลบทิ้ง (ใช้ `db` ที่ import มาจาก `lib/sql.ts`) |
| `db.prepare(SQL).get(...args)` | `await db.first<RowType>(SQL, [...args])` |
| `db.prepare(SQL).all(...args)` | `await db.query<RowType>(SQL, [...args])` |
| `db.prepare(SQL).run(...args)` | `await db.run(SQL, [...args])` |
| `result.changes` | `result.rowCount` |
| `const perform = db.transaction(() => { ... }); perform();` | `return await tx(async (t) => { ... });` |
| ข้างใน `tx` ทุก `db.xxx` | `t.xxx` |
| `INSERT OR IGNORE INTO x (...) VALUES (...)` | `INSERT INTO x (...) VALUES (...) ON CONFLICT DO NOTHING` |
| `date(col, '+7 hours') >= date(?)` | `(col AT TIME ZONE 'Asia/Bangkok')::date >= ?::date` |
| `? 1 : 0` สำหรับคอลัมน์ boolean | `true`/`false` ตรงๆ |
| `row.funds_reserved === 1` | `row.funds_reserved` |
| `row.funds_reserved === 0` | `!row.funds_reserved` |
| `SET funds_reserved = 1` | `SET funds_reserved = true` |
| `COUNT(*) AS count` | `COUNT(*)::bigint AS count` |
| `COALESCE(SUM(x), 0) AS y` | `COALESCE(SUM(x), 0)::bigint AS y` |

**เหตุผลของสองแถวสุดท้าย:** `SUM()` บน `bigint` คืน `numeric` ซึ่ง `pg` แปลงเป็น string ไม่ใช่ number การ cast กลับเป็น `bigint` ทำให้ type parser จาก Task 1 ทำงาน

**ห้ามพลาด:** `?` ทุกตัวใน SQL literal ปล่อยไว้เหมือนเดิม `lib/sql.ts` แปลงเป็น `$n` ให้เอง

- [ ] **Step 4: ทุก export กลายเป็น `async`**

`export function foo(...)` → `export async function foo(...)` ทั้ง 39 ตัว

- [ ] **Step 5: helper ภายในที่รับ `db` เปลี่ยนไปรับ `t: Tx`**

ฟังก์ชันเหล่านี้ถูกเรียกจากข้างในบล็อก transaction จึงต้องใช้ client เดียวกัน เปลี่ยนพารามิเตอร์แรกจาก `db: SqliteDatabase` เป็น `t: Tx` และเติม `await` ทุก statement ข้างใน:

`getSummary` (643) — ตัวนี้รับ `Queryable` เพราะถูกเรียกทั้งในและนอก transaction (`Tx` เป็น alias ของ `Queryable` จึงส่งได้ทั้งคู่) — `insertPendingCeloxDepositTransaction` (781), `getMatchingCeloxDepositTransaction` (799), `finalizeCeloxDepositSuccess` (953), `finalizeCeloxWithdrawalSuccess` (1308), `insertPendingC2CTransaction` (1429), `getC2CLocalTransaction` (1454), `settleC2CWithdrawal` (1473), `finalizeC2CSuccess` (1491), `finalizeC2CFailure` (1533), `finishCeloxC2CCallback` (2016), `adoptCeloxC2CWithdrawalReservationFromCallback` (2046), `finishCeloxCallbackWithoutCredit` (2327), `adoptCeloxWithdrawalReservationFromCallback` (2354)

ฟังก์ชันบริสุทธิ์ที่ **ไม่ต้องแตะ**: `toMoney`, `toSatang`, `mapCustomer`, `mapCeloxCallback`, `thaiDateTime`, `mapTransaction`, `dateClause`, `createId`, `validMoneySatang`, `assertMatchingCeloxIntent`, `isDepositTransactionStatus`, `canTransitionCeloxDepositStatus`, `isTerminalCeloxFailureStatus`, `assertMatchingCeloxWithdrawalIntent`, `c2cCallbackPayloadMatches`, `callbackPayloadMatches`, `isC2CTerminalStatus`, `isSupportedC2CCallbackStatus`, `isStaleCeloxOperation`

- [ ] **Step 6: พอร์ตกลุ่มที่ 1 — ลูกค้าและธุรกรรม**

`dateClause` (629), `getSummary` (643), `listCustomers` (669), `listTransactions` (717), `customerExists` (821)

- [ ] **Step 7: พอร์ตกลุ่มที่ 2 — Celox deposits**

บรรทัด 773-1057: `insertPendingCeloxDepositTransaction` ถึง `recordCeloxDepositResult`

- [ ] **Step 8: พอร์ตกลุ่มที่ 3 — Celox withdrawals**

บรรทัด 1059-1427: `assertMatchingCeloxWithdrawalIntent` ถึง `recordCeloxWithdrawalResult`

- [ ] **Step 9: พอร์ตกลุ่มที่ 4 — C2C transactions**

บรรทัด 1429-1940: `insertPendingC2CTransaction` ถึง `listCeloxC2CTransactions`

- [ ] **Step 10: พอร์ตกลุ่มที่ 5 — C2C callbacks**

บรรทัด 1942-2242: `c2cCallbackPayloadMatches` ถึง `markCeloxC2CCallbackEventFailed`

- [ ] **Step 11: พอร์ตกลุ่มที่ 6 — account callbacks และ holds**

บรรทัด 2244-2701: `callbackPayloadMatches` ถึง `queueCeloxCallbackRetry`

- [ ] **Step 12: พอร์ต `createTransaction` พร้อมแก้ TOCTOU**

นี่คือ **จุดเดียวในแผนที่เปลี่ยนพฤติกรรม** โค้ดเดิม (`lib/db.ts:2703`) อ่านแถวลูกค้านอก transaction แล้วเอา snapshot นั้นไปตัดสินใจข้างใน และ UPDATE ที่ตามมาไม่มี guard predicate ใต้ SQLite ไม่ค่อยเกิดเพราะ write serialize ทีละราย ใต้ Postgres สอง request สอดกันได้จริง

เขียนใหม่ทั้งฟังก์ชันเป็น:

```ts
export async function createTransaction(input: CreateTransactionInput) {
  const amountSatang = toSatang(input.amount);
  if (!Number.isFinite(input.amount) || amountSatang <= 0) throw new Error("จำนวนเงินต้องมากกว่า 0 บาท");

  const [direction, channel] = input.kind.split("_") as [TransactionDirection, TransactionChannel];
  const now = new Date().toISOString();

  const ids = await tx(async (t) => {
    if (channel === "account") {
      // ล็อกแถวลูกค้าไว้ก่อนอ่านยอด เพื่อไม่ให้ request อื่นแทรกระหว่างเช็กกับหักยอด
      const selected = await t.first<CustomerRow>(
        "SELECT * FROM customers WHERE id = ? FOR UPDATE", [input.customerId]);
      if (!selected) throw new Error("ไม่พบข้อมูลลูกค้าที่เลือก");
      if (direction === "withdraw" && selected.withdrawable_satang < amountSatang) {
        throw new Error("ยอดเงินที่ถอนได้ไม่เพียงพอ");
      }

      const delta = direction === "deposit" ? amountSatang : -amountSatang;
      const updated = await t.run(`
        UPDATE customers
        SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ?
        WHERE id = ?
          AND balance_satang + ? >= 0
          AND withdrawable_satang + ? >= 0
      `, [delta, delta, selected.id, delta, delta]);
      if (updated.rowCount !== 1) throw new Error("ยอดเงินที่ถอนได้ไม่เพียงพอ");

      const id = createId("TXN");
      await t.run(`
        INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
        VALUES (?, ?, ?, 'account', ?, ?, 'success', ?)
      `, [id, selected.id, direction, amountSatang,
          input.note?.trim() || (direction === "deposit" ? "ฝากเข้าบัญชี" : "ถอนจากบัญชี"), now]);
      return [id];
    }

    if (!input.counterpartyCustomerId) throw new Error("กรุณาเลือกลูกค้าคู่รายการ C2C");
    if (input.counterpartyCustomerId === input.customerId) {
      throw new Error("บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน");
    }

    // ล็อกทั้งสองแถวในคำสั่งเดียว เรียงตาม id เสมอ เพื่อกัน deadlock
    // เมื่อมีสองรายการโอนสวนทางกันระหว่างลูกค้าคู่เดียวกัน
    const locked = await t.query<CustomerRow>(
      "SELECT * FROM customers WHERE id IN (?, ?) ORDER BY id FOR UPDATE",
      [input.customerId, input.counterpartyCustomerId]);

    const selected = locked.find((row) => row.id === input.customerId);
    if (!selected) throw new Error("ไม่พบข้อมูลลูกค้าที่เลือก");
    const counterparty = locked.find((row) => row.id === input.counterpartyCustomerId);
    if (!counterparty) throw new Error("ไม่พบลูกค้าคู่รายการ C2C");

    const source = direction === "deposit" ? counterparty : selected;
    const target = direction === "deposit" ? selected : counterparty;
    if (source.withdrawable_satang < amountSatang) {
      throw new Error(`ยอดเงินที่ถอนได้ของ ${source.name} ไม่เพียงพอ`);
    }

    const debited = await t.run(`
      UPDATE customers
      SET balance_satang = balance_satang - ?, withdrawable_satang = withdrawable_satang - ?
      WHERE id = ? AND withdrawable_satang >= ?
    `, [amountSatang, amountSatang, source.id, amountSatang]);
    if (debited.rowCount !== 1) throw new Error(`ยอดเงินที่ถอนได้ของ ${source.name} ไม่เพียงพอ`);

    await t.run(`
      UPDATE customers
      SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ?
      WHERE id = ?
    `, [amountSatang, amountSatang, target.id]);

    const groupId = createId("C2C");
    const sourceId = createId("TXN");
    const targetId = createId("TXN");
    const note = input.note?.trim() || `โอน C2C จาก ${source.name} ไป ${target.name}`;
    const insert = `
      INSERT INTO transactions (id, customer_id, counterparty_customer_id, direction, channel, amount_satang, note, status, transfer_group_id, created_at)
      VALUES (?, ?, ?, ?, 'c2c', ?, ?, 'success', ?, ?)
    `;
    await t.run(insert, [sourceId, source.id, target.id, "withdraw", amountSatang, note, groupId, now]);
    await t.run(insert, [targetId, target.id, source.id, "deposit", amountSatang, note, groupId, now]);
    return [sourceId, targetId];
  });

  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.query<TransactionRow>(
    `${transactionSelect} WHERE t.id IN (${placeholders}) ORDER BY t.direction DESC`, ids);
  return { transactions: rows.map(mapTransaction), summary: await getSummary(db) };
}
```

หมายเหตุ: `getSummary` เปลี่ยนไปรับ `Queryable` จึงส่ง `db` (นอก transaction) ได้ตามเดิม

- [ ] **Step 13: เติม `await` ที่ call site ทั้ง 19 ไฟล์**

ทุกไฟล์นี้เรียกฟังก์ชันจาก `@/lib/db` หรือ `../db` ให้เติม `await` หน้าทุกการเรียก:

```
app/api/customers/route.ts
app/api/customers/[id]/celox-callbacks/route.ts
app/api/customers/[id]/celox-callbacks/[eventId]/retry/route.ts
app/api/customers/[id]/celox-withdrawal-holds/[key]/resolve/route.ts
app/api/transactions/route.ts
app/api/celox/callback/route.ts
app/api/celox/deposits/route.ts
app/api/celox/deposits/[id]/slip/route.ts
app/api/celox/withdrawals/route.ts
app/api/celox/withdrawals/[id]/confirm/route.ts
app/api/celox/c2c/route.ts
app/api/celox/c2c/[id]/route.ts
app/api/celox/c2c/[id]/cancel/route.ts
app/api/celox/c2c/deposits/route.ts
app/api/celox/c2c/deposits/[id]/slip/route.ts
app/api/celox/c2c/withdrawals/route.ts
lib/celox/callback.server.ts
lib/celox/c2c-callback.server.ts
lib/celox/c2c-callback-handler.server.ts
```

ทุก route เป็น `async function` อยู่แล้ว ส่วนสามไฟล์ใต้ `lib/celox/` ให้เช็กว่าฟังก์ชันที่ครอบอยู่เป็น `async` ด้วย ถ้ายังไม่ใช่ให้เปลี่ยนเป็น `async` แล้วไล่เติม `await` ที่ผู้เรียกต่อไปจนสุดสาย

- [ ] **Step 14: แปลงเทสต์ที่ใช้ DB จริงสองไฟล์**

ใน `lib/db.c2c-withdraw-settlement.test.ts` และ `lib/celox/c2c-callback-handler.server.test.ts`:

```ts
// เดิม
tempDir = mkdtempSync(join(tmpdir(), "c2c-settlement-test-"));
process.env.KLANG_DB_PATH = join(tempDir, "finance.sqlite");
({ getDatabase, syncCeloxC2CTransaction, ... } = await import("./db"));

// ใหม่
await setupTestDatabase();
({ syncCeloxC2CTransaction, ... } = await import("./db"));
```

- ถอด `import { mkdtempSync, rmSync }`, `tmpdir`, `join` และตัวแปร `tempDir` ออก
- `afterAll` เรียก `teardownTestDatabase()` แทน `rmSync`
- ถอดการใช้ `getDatabase` ออก — helper ที่ seed ข้อมูล (`seedWithdrawal` และเพื่อน) ให้เปลี่ยนไปใช้ `db.run(...)` จาก `@/lib/sql` และกลายเป็น `async`
- ผู้เรียก `seedWithdrawal` ทุกจุดเติม `await`
- `INSERT ... VALUES (?, 'ทดสอบ', ?, ...)` ที่ seed ข้อมูล: ค่าที่เคยส่ง `1`/`0` ให้คอลัมน์ boolean เปลี่ยนเป็น `true`/`false`
- ถ้าไฟล์มีหลาย `describe` ที่ต้องการข้อมูลสะอาด ให้เรียก `truncateAll()` ใน `beforeEach`

- [ ] **Step 15: รันเทสต์ทั้งชุด**

Run: `npm test`
Expected: PASS ทุกไฟล์ ทั้ง 6 ไฟล์เดิมบวก `lib/sql.test.ts` และ `test/schema.test.ts`

- [ ] **Step 16: รัน build เพื่อจับ type error ที่หลงเหลือ**

Run: `npm run build`
Expected: สำเร็จ ไม่มี type error

อาการที่พบบ่อยตอนนี้: `Property 'rowCount' does not exist` (ลืมแปลง `.changes`), `Type 'Promise<X>' is not assignable to 'X'` (ลืม `await` ที่ call site) และ `This comparison appears unintentional` (ลืมแปลง `=== 1` ของคอลัมน์ boolean)

- [ ] **Step 17: รัน lint**

Run: `npm run lint`
Expected: ผ่าน ไม่มี error

- [ ] **Step 18: Commit**

```bash
git add lib/db.ts lib/db.c2c-withdraw-settlement.test.ts lib/celox/ app/api/
git commit -m "refactor: port database layer from SQLite to Postgres"
```

---

### Task 4: ถอด better-sqlite3 และเก็บกวาด

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `README.md`
- Delete: `data/`

**Interfaces:**
- Consumes: โค้ดที่พอร์ตเสร็จแล้วจาก Task 3
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: ยืนยันว่าไม่มีใครอ้างถึง better-sqlite3 แล้ว**

Run: `grep -rn "better-sqlite3\|KLANG_DB_PATH\|getDatabase" --include='*.ts' --include='*.tsx' app lib test`
Expected: ไม่มีผลลัพธ์ ถ้ายังเจอ แปลว่า Task 3 ยังไม่ครบ — กลับไปแก้ก่อน

- [ ] **Step 2: ถอด dependency**

```bash
npm uninstall better-sqlite3 @types/better-sqlite3
```

- [ ] **Step 3: ลบไฟล์ฐานข้อมูลเดิมและบรรทัดใน .gitignore**

```bash
rm -rf data/
```

ลบสามบรรทัดนี้ออกจาก `.gitignore`:

```
data/*.sqlite
data/*.sqlite-shm
data/*.sqlite-wal
```

- [ ] **Step 4: อัปเดต `.env.example`**

เพิ่มบรรทัดบนสุด:

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

- [ ] **Step 5: เพิ่มคำแนะนำ setup ใน README.md**

เพิ่มหัวข้อ "การตั้งค่าฐานข้อมูล" อธิบายสามขั้น: สร้างโปรเจกต์ Supabase, คัดลอก connection string ของ **Session pooler** (port 5432) ไปใส่ `DATABASE_URL` ใน `.env.local`, แล้วรัน `supabase/migrations/0001_init.sql` ตามด้วย `supabase/seed.sql` ใน SQL Editor ของ Supabase

ระบุให้ชัดว่าต้องใช้ **Session pooler** ไม่ใช่ Transaction pooler เพราะแอปพึ่ง multi-statement transaction บน connection เดียว

- [ ] **Step 6: ยืนยันว่าทุกอย่างยังผ่าน**

Run: `npm test && npm run build && npm run lint`
Expected: ผ่านทั้งสามคำสั่ง

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove better-sqlite3 and document Supabase setup"
```

---

## หมายเหตุสำหรับผู้ตรวจ

- Task 1 Step 10 มีจุดที่อาจต้องปรับตามของจริง: ชื่อ option ของ parser ใน PGlite ให้ยึด **ผลลัพธ์ของเทสต์** เป็นเกณฑ์ ไม่ใช่โค้ดในแผน
- Task 3 เป็นก้อนใหญ่โดยตั้งใจ เหตุผลอยู่ในหัวข้อของ task
- `DATABASE_URL` จริงยังไม่มีในเครื่อง ทุก task ในแผนนี้ยืนยันด้วย PGlite ได้ครบ การรันกับ Supabase จริงเป็นขั้นตอนของผู้ใช้หลัง Task 4
