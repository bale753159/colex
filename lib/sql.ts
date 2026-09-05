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
 *
 * หมายเหตุ: ไม่รองรับ dollar-quoted string (`$tag$...$tag$`) เพราะโปรเจกต์นี้
 * ไม่ใช้ plpgsql function และ migration ที่ตัวแปลงนี้ต้องประมวลผลเป็น DDL ล้วน
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

const OID_INT8 = 20;
const OID_NUMERIC = 1700;
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
  /**
   * รัน SQL หลายคำสั่งในสตริงเดียว (เช่นไฟล์ migration) ผ่าน simple-query protocol
   * ของแต่ละ driver แทน exec() ซึ่งใช้ extended-query protocol และไม่รองรับ
   * หลายคำสั่งในคำขอเดียวเมื่อมี parameter (แม้ params จะว่างเปล่าก็ตาม)
   */
  script(sql: string): Promise<void>;
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
  // NUMERIC เกิดขึ้นเมื่อ SUM()/AVG() ทำงานกับคอลัมน์ bigint (เช่นยอดรวมเงิน) — โค้ดเบสนี้
  // ไม่มีคอลัมน์ numeric ที่เป็นเศษส่วนจริง ทุกค่าเงินเป็นจำนวนเต็มสตางค์ ดังนั้นถ้าค่าที่ได้
  // มีเศษส่วนจริงๆ ให้ toSafeInt โยน error แทนที่จะปัดเงียบๆ
  pgTypes.setTypeParser(OID_NUMERIC, toSafeInt as (value: string) => number);
  pgTypes.setTypeParser(OID_TIMESTAMPTZ, toIsoString as (value: string) => string);
  pgTypes.setTypeParser(OID_TIMESTAMP, toIsoString as (value: string) => string);
  const pool = new Pool({ connectionString, max: 10 });

  const exec: Exec = async (sql, params) => {
    const result = await pool.query(toPositional(sql), params);
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
  };

  return {
    exec,
    // pool.query(text) แบบไม่มี values argument ใช้ simple-query protocol ของ Postgres
    // ซึ่งรองรับหลายคำสั่งในสตริงเดียว (ต่างจาก exec() ที่ส่ง params เสมอ)
    script: async (sql) => {
      await pool.query(sql);
    },
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
  const { PGlite } = await import("@electric-sql/pglite");
  const client = new PGlite({
    parsers: {
      [OID_INT8]: toSafeInt,
      [OID_NUMERIC]: toSafeInt,
      [OID_TIMESTAMPTZ]: toIsoString,
      [OID_TIMESTAMP]: toIsoString,
    },
    serializers: {
      [OID_TIMESTAMPTZ]: (value: unknown) => String(value),
      [OID_TIMESTAMP]: (value: unknown) => String(value),
    },
  });

  const execWith = (target: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Exec =>
    async (sql, params) => {
      const result = await target.query(toPositional(sql), params);
      return { rows: result.rows as Row[], rowCount: result.affectedRows ?? result.rows.length };
    };

  return {
    exec: execWith(client),
    // client.exec() ของ PGlite รองรับหลายคำสั่งในสตริงเดียวโดยตรง (ต่างจาก query()
    // ซึ่งใช้ extended-query protocol เหมือน pg)
    script: async (sql) => {
      await client.exec(sql);
    },
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

export const db: Queryable & { script(sql: string): Promise<void> } = {
  query: async (sql, params) => wrap((await getDriver()).exec).query(sql, params),
  first: async (sql, params) => wrap((await getDriver()).exec).first(sql, params),
  run: async (sql, params) => wrap((await getDriver()).exec).run(sql, params),
  // ใช้สำหรับรัน SQL หลายคำสั่งเป็นก้อนเดียว (เช่นไฟล์ migration) — ดูคอมเมนต์ที่ Driver.script
  script: async (sql) => {
    await (await getDriver()).script(sql);
  },
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
