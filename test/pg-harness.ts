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
  await db.script(sql);
}

export async function truncateAll(): Promise<void> {
  await db.run(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function teardownTestDatabase(): Promise<void> {
  await resetPoolForTests();
}
