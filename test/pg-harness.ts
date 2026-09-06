import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db, resetPoolForTests } from "@/lib/sql";

// ต้องตั้งค่านี้ตอน import โมดูลนี้ (ไม่ใช่ตอนเรียก setupTestDatabase) เพราะ lib/sql.ts
// เลือก driver แบบ lazy ตั้งแต่ query แรกที่ถูกเรียก — ถ้าไฟล์เทสต์อื่นที่ import
// harness นี้ดันแตะ db ตอน import (ก่อน beforeAll ทำงาน) driver จะถูกเลือกเป็น pg
// (ของจริง) ไปแล้วโดยไม่มี DATABASE_URL แล้วพัง การ hoist มาไว้ตรงนี้ทำให้ "import
// harness" คือจุดที่เลือก driver แทน
process.env.KLANG_TEST_PG = "pglite";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../supabase/migrations/", import.meta.url),
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
  // รันทุกไฟล์ใน supabase/migrations เรียงตามชื่อ เพื่อให้ schema ของเทสต์ตรงกับ
  // ลำดับที่ README สั่งให้รันใน SQL Editor ของ Supabase
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    await db.script(await readFile(`${MIGRATIONS_DIR}${name}`, "utf8"));
  }
}

export async function truncateAll(): Promise<void> {
  await db.run(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function teardownTestDatabase(): Promise<void> {
  await resetPoolForTests();
}
