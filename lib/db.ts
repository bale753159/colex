import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  C2CDepositSlipResponse,
  C2CTransactionResponse,
  C2CTransactionStatus,
  CancelC2CTransactionResponse,
  CeloxC2CCallbackRequest,
  CeloxCallbackEvent,
  CeloxCallbackProcessingState,
  CeloxCallbackRequest,
  CeloxWithdrawalHold,
  ConfirmWithdrawalRequest,
  ConfirmWithdrawalResponse,
  CreateDepositResponse,
  CreateC2CDepositResponse,
  CreateC2CWithdrawalRequest,
  CreateC2CWithdrawalResponse,
  CreateWithdrawalRequest,
  CreateWithdrawalResponse,
  DepositSlipResponse,
  DepositTransactionStatus,
} from "./celox/types";
import type {
  CreateTransactionInput,
  Customer,
  CustomerWithStats,
  FinanceSummary,
  Transaction,
  TransactionChannel,
  TransactionDirection,
  TransactionStatus,
} from "./types";

type SqliteDatabase = InstanceType<typeof Database>;

declare global {
  var __klangFinanceDb: SqliteDatabase | undefined;
}

type CustomerRow = {
  id: string;
  name: string;
  account: string;
  initials: string;
  color: string;
  phone: string;
  email: string;
  balance_satang: number;
  withdrawable_satang: number;
  created_at: string;
};

type TransactionRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_account: string;
  customer_initials: string;
  customer_color: string;
  customer_phone: string;
  customer_email: string;
  customer_balance_satang: number;
  customer_withdrawable_satang: number;
  customer_created_at: string;
  counterparty_id: string | null;
  counterparty_name: string | null;
  counterparty_account: string | null;
  direction: TransactionDirection;
  channel: TransactionChannel;
  amount_satang: number;
  note: string;
  status: TransactionStatus;
  transfer_group_id: string | null;
  created_at: string;
};

type CeloxDepositRow = {
  transaction_id: string;
  order_id: string;
  reference_id: string | null;
  customer_id: string;
  amount_satang: number;
  transaction_status: DepositTransactionStatus;
  local_transaction_id: string | null;
  created_at: string;
  updated_at: string;
};

type CeloxWithdrawalRow = {
  transaction_id: string;
  order_id: string;
  reference_id: string | null;
  customer_id: string;
  amount_satang: number;
  destination_bank_code: string;
  destination_account_name: string;
  destination_account_no: string;
  transaction_status: "PENDING" | "SUCCESS";
  confirmation_state: "ready" | "confirming" | "uncertain" | "success";
  funds_reserved: 0 | 1;
  occurred_at: string | null;
  local_transaction_id: string | null;
  created_at: string;
  updated_at: string;
};

type CeloxWithdrawalReservationRow = {
  reservation_id: string;
  customer_id: string;
  amount_satang: number;
  reference_id: string | null;
  destination_bank_code: string;
  destination_account_name: string;
  destination_account_no: string;
  reservation_state: "creating" | "uncertain";
  created_at: string;
  updated_at: string;
};

type CeloxCallbackRow = {
  id: number;
  transaction_id: string;
  order_id: string;
  reference_id: string | null;
  provider_status: string;
  amount_satang: number;
  occurred_at: string | null;
  customer_id: string | null;
  transaction_kind: "deposit" | "withdraw" | null;
  processing_state: CeloxCallbackProcessingState;
  local_transaction_id: string | null;
  attempt_count: number;
  received_count: number;
  last_error: string | null;
  received_at: string;
  last_received_at: string;
  processed_at: string | null;
};

type CeloxC2CRow = {
  transaction_id: string;
  order_id: string;
  reference_id: string | null;
  customer_id: string;
  direction: "deposit" | "withdraw";
  transaction_status: C2CTransactionStatus;
  amount_satang: number;
  fee_amount_satang: number;
  settled_amount_satang: number;
  held_amount_satang: number;
  awaiting_manual_review: 0 | 1;
  match_deadline: string | null;
  funds_reserved: 0 | 1;
  local_transaction_id: string;
  created_at: string;
  updated_at: string;
};

type CeloxC2CWithdrawalReservationRow = {
  reservation_id: string;
  customer_id: string;
  amount_satang: number;
  reference_id: string;
  reservation_state: "creating" | "uncertain";
  created_at: string;
  updated_at: string;
};

type CeloxC2CCallbackRow = {
  id: number;
  transaction_id: string;
  order_id: string;
  reference_id: string | null;
  provider_status: string;
  amount_satang: number;
  occurred_at: string | null;
  provider_event: string | null;
  signed_payload_hash: string;
  has_transfer_to: 0 | 1;
  customer_id: string | null;
  direction: "deposit" | "withdraw" | null;
  processing_state: CeloxCallbackProcessingState;
  local_transaction_id: string | null;
  attempt_count: number;
  received_count: number;
  last_error: string | null;
  received_at: string;
  last_received_at: string;
  processed_at: string | null;
};

const databasePath = process.env.KLANG_DB_PATH ?? join(process.cwd(), "data", "finance.sqlite");

function toMoney(satang: number) {
  return satang / 100;
}

function toSatang(amount: number) {
  return Math.round(amount * 100);
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    account: row.account,
    initials: row.initials,
    color: row.color,
    phone: row.phone,
    email: row.email,
    balance: toMoney(row.balance_satang),
    withdrawableBalance: toMoney(row.withdrawable_satang),
    createdAt: row.created_at,
  };
}

function mapCeloxCallback(row: CeloxCallbackRow): CeloxCallbackEvent {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    orderId: row.order_id,
    referenceId: row.reference_id,
    status: row.provider_status,
    amount: toMoney(row.amount_satang),
    occurredAt: row.occurred_at,
    customerId: row.customer_id,
    direction: row.transaction_kind,
    processingState: row.processing_state,
    localTransactionId: row.local_transaction_id,
    attemptCount: row.attempt_count,
    receivedCount: row.received_count,
    lastError: row.last_error,
    receivedAt: row.received_at,
    lastReceivedAt: row.last_received_at,
    processedAt: row.processed_at,
  };
}

function thaiDateTime(isoDate: string) {
  const date = new Date(isoDate);
  return {
    date: new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }).format(date),
    time: new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(date),
  };
}

function mapTransaction(row: TransactionRow): Transaction {
  const display = thaiDateTime(row.created_at);
  return {
    id: row.id,
    customer: mapCustomer({
      id: row.customer_id,
      name: row.customer_name,
      account: row.customer_account,
      initials: row.customer_initials,
      color: row.customer_color,
      phone: row.customer_phone,
      email: row.customer_email,
      balance_satang: row.customer_balance_satang,
      withdrawable_satang: row.customer_withdrawable_satang,
      created_at: row.customer_created_at,
    }),
    counterparty: row.counterparty_id && row.counterparty_name && row.counterparty_account
      ? { id: row.counterparty_id, name: row.counterparty_name, account: row.counterparty_account }
      : null,
    type: row.direction,
    channel: row.channel,
    amount: toMoney(row.amount_satang),
    date: display.date,
    time: display.time,
    createdAt: row.created_at,
    note: row.note,
    status: row.status,
    transferGroupId: row.transfer_group_id,
  };
}

function seedDatabase(db: SqliteDatabase) {
  const customerCount = db.prepare("SELECT COUNT(*) AS count FROM customers").get() as { count: number };
  if (customerCount.count > 0) return;

  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, name, account, initials, color, phone, email, balance_satang, withdrawable_satang, created_at)
    VALUES (@id, @name, @account, @initials, @color, @phone, @email, @balance_satang, @withdrawable_satang, @created_at)
  `);
  const insertTransaction = db.prepare(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
    VALUES (@id, @customer_id, @direction, 'account', @amount_satang, @note, 'success', @created_at)
  `);

  const seed = db.transaction(() => {
    const customerRows = [
      { id: "C-1024", name: "วรพงษ์ มณีสอน", account: "ACC-90241", initials: "ว", color: "violet", phone: "081-234-5678", email: "nattawut@example.com", balance_satang: 0, withdrawable_satang: 0, created_at: "2026-07-12T09:15:00+07:00" },
      { id: "C-1081", name: "พิมพ์ชนก วงศ์คำ", account: "ACC-79126", initials: "พ", color: "cyan", phone: "089-118-2046", email: "pimchanok@example.com", balance_satang: 465000, withdrawable_satang: 430000, created_at: "2026-07-18T11:30:00+07:00" },
      { id: "C-1093", name: "บริษัท สยามเน็กซ์ จำกัด", account: "ACC-68403", initials: "ส", color: "amber", phone: "02-118-2900", email: "finance@siamnext.co.th", balance_satang: 1250000, withdrawable_satang: 1150000, created_at: "2026-07-22T14:10:00+07:00" },
      { id: "C-1137", name: "ธนกฤต มั่นคง", account: "ACC-55718", initials: "ธ", color: "blue", phone: "086-425-7710", email: "thanakrit@example.com", balance_satang: 310000, withdrawable_satang: 310000, created_at: "2026-08-02T10:00:00+07:00" },
      { id: "C-1162", name: "จิราพร แสงทอง", account: "ACC-43092", initials: "จ", color: "rose", phone: "095-662-9184", email: "jiraporn@example.com", balance_satang: 580000, withdrawable_satang: 520000, created_at: "2026-08-08T15:45:00+07:00" },
    ];
    customerRows.forEach((row) => insertCustomer.run(row));

    const transactionRows = [
      { id: "TXN-240830-500", customer_id: "C-1081", direction: "withdraw", amount_satang: 85000, note: "ถอนเข้าบัญชีธนาคาร", created_at: "2026-08-30T09:18:00+07:00" },
      { id: "TXN-240829-498", customer_id: "C-1093", direction: "deposit", amount_satang: 600000, note: "เงินทุนหมุนเวียน", created_at: "2026-08-29T16:05:00+07:00" },
      { id: "TXN-240829-492", customer_id: "C-1137", direction: "withdraw", amount_satang: 120000, note: "ถอนเงินสด", created_at: "2026-08-29T13:37:00+07:00" },
      { id: "TXN-240828-487", customer_id: "C-1162", direction: "deposit", amount_satang: 340000, note: "ฝากเงินเข้ากระเป๋าหลัก", created_at: "2026-08-28T11:20:00+07:00" },
    ];
    transactionRows.forEach((row) => insertTransaction.run(row));
  });

  seed();
}

const CURRENT_SCHEMA_VERSION = 7;

function transactionsSupportProcessingStatuses(db: SqliteDatabase) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")
    .get() as { sql: string | null } | undefined;
  return Boolean(row?.sql?.includes("'pending'") && row.sql.includes("'failed'"));
}

function migrateTransactionsToProcessingStatuses(db: SqliteDatabase) {
  if (transactionsSupportProcessingStatuses(db)) return;

  const leftover = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'transactions_legacy_v6'")
    .get() as { found: 1 } | undefined;
  if (leftover) {
    throw new Error("พบตาราง transactions_legacy_v6 จาก migration ที่ไม่สมบูรณ์");
  }

  // ปิด FK ชั่วคราวและใช้ legacy rename เพื่อไม่ให้ SQLite เปลี่ยน FK ของตาราง
  // Celox ให้ชี้ไปยังชื่อตารางชั่วคราวระหว่างสร้าง transactions ใหม่
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    const migrate = db.transaction(() => {
      db.exec(`
        ALTER TABLE transactions RENAME TO transactions_legacy_v6;
        CREATE TABLE transactions (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL REFERENCES customers(id),
          counterparty_customer_id TEXT REFERENCES customers(id),
          direction TEXT NOT NULL CHECK (direction IN ('deposit', 'withdraw')),
          channel TEXT NOT NULL CHECK (channel IN ('account', 'c2c')),
          amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
          note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('pending', 'success', 'failed')),
          transfer_group_id TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO transactions (
          id, customer_id, counterparty_customer_id, direction, channel,
          amount_satang, note, status, transfer_group_id, created_at
        )
        SELECT
          id, customer_id, counterparty_customer_id, direction, channel,
          amount_satang, note, status, transfer_group_id, created_at
        FROM transactions_legacy_v6;
        DROP TABLE transactions_legacy_v6;
        CREATE INDEX idx_transactions_customer ON transactions(customer_id);
        CREATE INDEX idx_transactions_created ON transactions(created_at DESC);
        CREATE INDEX idx_transactions_group ON transactions(transfer_group_id);
      `);
    });
    migrate();
  } finally {
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }

  const foreignKeyViolations = db.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error("migration สถานะ transaction ทำให้ foreign key ไม่สมบูรณ์");
  }
}

function backfillCeloxDepositTransactions(db: SqliteDatabase) {
  const deposits = db.prepare(`
    SELECT * FROM celox_deposits
    WHERE local_transaction_id IS NULL
    ORDER BY created_at, transaction_id
  `).all() as CeloxDepositRow[];
  if (deposits.length === 0) return;

  const insertTransaction = db.prepare(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
    VALUES (?, ?, 'deposit', 'account', ?, ?, ?, ?)
  `);
  const linkDeposit = db.prepare(`
    UPDATE celox_deposits
    SET local_transaction_id = ?, updated_at = ?
    WHERE transaction_id = ? AND local_transaction_id IS NULL
  `);
  const creditCustomer = db.prepare(`
    UPDATE customers
    SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ?
    WHERE id = ?
  `);

  const backfill = db.transaction(() => {
    for (const deposit of deposits) {
      const localTransactionId = createId("TXN");
      const status: TransactionStatus = deposit.transaction_status === "SUCCESS"
        ? "success"
        : deposit.transaction_status === "EXPIRED"
          ? "failed"
          : "pending";
      insertTransaction.run(
        localTransactionId,
        deposit.customer_id,
        deposit.amount_satang,
        `ฝากผ่าน Celox · ${deposit.order_id}`,
        status,
        deposit.created_at,
      );
      if (status === "success") {
        const credited = creditCustomer.run(
          deposit.amount_satang,
          deposit.amount_satang,
          deposit.customer_id,
        );
        if (credited.changes !== 1) throw new Error("ย้ายรายการฝาก Celox สำเร็จเข้าตาราง transaction ไม่ครบถ้วน");
      }
      const linked = linkDeposit.run(localTransactionId, new Date().toISOString(), deposit.transaction_id);
      if (linked.changes !== 1) throw new Error("เชื่อมรายการฝาก Celox เดิมกับ transaction ไม่สำเร็จ");
    }
  });
  backfill();
}

function migrateDatabase(db: SqliteDatabase) {
  const schemaVersion = db.pragma("user_version", { simple: true }) as number;
  if (schemaVersion >= CURRENT_SCHEMA_VERSION && transactionsSupportProcessingStatuses(db)) return;
  migrateTransactionsToProcessingStatuses(db);
  backfillCeloxDepositTransactions(db);
  db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
}

export function getDatabase() {
  if (globalThis.__klangFinanceDb) {
    migrateDatabase(globalThis.__klangFinanceDb);
    return globalThis.__klangFinanceDb;
  }
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath, { timeout: 1_000 });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account TEXT NOT NULL UNIQUE,
      initials TEXT NOT NULL,
      color TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      balance_satang INTEGER NOT NULL DEFAULT 0 CHECK (balance_satang >= 0),
      withdrawable_satang INTEGER NOT NULL DEFAULT 0 CHECK (withdrawable_satang >= 0 AND withdrawable_satang <= balance_satang),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      counterparty_customer_id TEXT REFERENCES customers(id),
      direction TEXT NOT NULL CHECK (direction IN ('deposit', 'withdraw')),
      channel TEXT NOT NULL CHECK (channel IN ('account', 'c2c')),
      amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('pending', 'success', 'failed')),
      transfer_group_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS celox_deposits (
      transaction_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      reference_id TEXT,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
      transaction_status TEXT NOT NULL CHECK (transaction_status IN ('SUCCESS', 'PENDING_APPROVE', 'PENDING_TRANSFER', 'EXPIRED')),
      local_transaction_id TEXT UNIQUE REFERENCES transactions(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS celox_deposit_slip_claims (
      transaction_id TEXT PRIMARY KEY REFERENCES celox_deposits(transaction_id) ON DELETE CASCADE,
      claimed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS celox_withdrawals (
      transaction_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      reference_id TEXT,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
      destination_bank_code TEXT NOT NULL,
      destination_account_name TEXT NOT NULL,
      destination_account_no TEXT NOT NULL,
      transaction_status TEXT NOT NULL CHECK (transaction_status IN ('PENDING', 'SUCCESS')),
      confirmation_state TEXT NOT NULL DEFAULT 'ready'
        CHECK (confirmation_state IN ('ready', 'confirming', 'uncertain', 'success')),
      funds_reserved INTEGER NOT NULL DEFAULT 0 CHECK (funds_reserved IN (0, 1)),
      occurred_at TEXT,
      local_transaction_id TEXT UNIQUE REFERENCES transactions(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS celox_withdrawal_reservations (
      reservation_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
      reference_id TEXT UNIQUE,
      destination_bank_code TEXT NOT NULL,
      destination_account_name TEXT NOT NULL,
      destination_account_no TEXT NOT NULL,
      reservation_state TEXT NOT NULL DEFAULT 'creating'
        CHECK (reservation_state IN ('creating', 'uncertain')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS celox_callback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      reference_id TEXT,
      provider_status TEXT NOT NULL,
      amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
      occurred_at TEXT,
      customer_id TEXT REFERENCES customers(id),
      transaction_kind TEXT CHECK (transaction_kind IN ('deposit', 'withdraw')),
      processing_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (processing_state IN ('pending', 'applied', 'recorded', 'unmatched', 'failed')),
      local_transaction_id TEXT REFERENCES transactions(id),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      received_count INTEGER NOT NULL DEFAULT 1 CHECK (received_count > 0),
      last_error TEXT,
      received_at TEXT NOT NULL,
      last_received_at TEXT NOT NULL,
      processed_at TEXT,
      UNIQUE (transaction_id, provider_status)
    );
    CREATE TABLE IF NOT EXISTS celox_c2c_transactions (
      transaction_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      reference_id TEXT UNIQUE,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      direction TEXT NOT NULL CHECK (direction IN ('deposit', 'withdraw')),
      transaction_status TEXT NOT NULL,
      amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
      fee_amount_satang INTEGER NOT NULL DEFAULT 0 CHECK (fee_amount_satang >= 0),
      settled_amount_satang INTEGER NOT NULL DEFAULT 0 CHECK (settled_amount_satang >= 0),
      held_amount_satang INTEGER NOT NULL DEFAULT 0 CHECK (held_amount_satang >= 0),
      awaiting_manual_review INTEGER NOT NULL DEFAULT 0 CHECK (awaiting_manual_review IN (0, 1)),
      match_deadline TEXT,
      funds_reserved INTEGER NOT NULL DEFAULT 0 CHECK (funds_reserved IN (0, 1)),
      local_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS celox_c2c_withdrawal_reservations (
      reservation_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
      reference_id TEXT NOT NULL UNIQUE,
      reservation_state TEXT NOT NULL DEFAULT 'creating'
        CHECK (reservation_state IN ('creating', 'uncertain')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS celox_c2c_callback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      reference_id TEXT,
      provider_status TEXT NOT NULL,
      amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
      occurred_at TEXT,
      provider_event TEXT,
      signed_payload_hash TEXT NOT NULL CHECK (length(signed_payload_hash) = 64),
      has_transfer_to INTEGER NOT NULL DEFAULT 0 CHECK (has_transfer_to IN (0, 1)),
      customer_id TEXT REFERENCES customers(id),
      direction TEXT CHECK (direction IN ('deposit', 'withdraw')),
      processing_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (processing_state IN ('pending', 'applied', 'recorded', 'unmatched', 'failed')),
      local_transaction_id TEXT REFERENCES transactions(id),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      received_count INTEGER NOT NULL DEFAULT 1 CHECK (received_count > 0),
      last_error TEXT,
      received_at TEXT NOT NULL,
      last_received_at TEXT NOT NULL,
      processed_at TEXT,
      UNIQUE (transaction_id, provider_status)
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_group ON transactions(transfer_group_id);
    CREATE INDEX IF NOT EXISTS idx_celox_deposits_customer ON celox_deposits(customer_id);
    CREATE INDEX IF NOT EXISTS idx_celox_deposits_status ON celox_deposits(transaction_status);
    CREATE INDEX IF NOT EXISTS idx_celox_withdrawals_customer ON celox_withdrawals(customer_id);
    CREATE INDEX IF NOT EXISTS idx_celox_withdrawals_status ON celox_withdrawals(transaction_status);
    CREATE INDEX IF NOT EXISTS idx_celox_withdrawal_reservations_customer ON celox_withdrawal_reservations(customer_id);
    CREATE INDEX IF NOT EXISTS idx_celox_withdrawal_reservations_state ON celox_withdrawal_reservations(reservation_state, created_at);
    CREATE INDEX IF NOT EXISTS idx_celox_callbacks_transaction ON celox_callback_events(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_celox_callbacks_customer ON celox_callback_events(customer_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_celox_callbacks_state ON celox_callback_events(processing_state, received_at);
    CREATE INDEX IF NOT EXISTS idx_celox_c2c_customer ON celox_c2c_transactions(customer_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_celox_c2c_status ON celox_c2c_transactions(transaction_status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_celox_c2c_reservations_customer ON celox_c2c_withdrawal_reservations(customer_id);
    CREATE INDEX IF NOT EXISTS idx_celox_c2c_callbacks_transaction ON celox_c2c_callback_events(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_celox_c2c_callbacks_customer ON celox_c2c_callback_events(customer_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_celox_c2c_callbacks_state ON celox_c2c_callback_events(processing_state, received_at);
  `);
  const callbackColumns = db.pragma("table_info(celox_callback_events)") as Array<{ name: string }>;
  if (!callbackColumns.some((column) => column.name === "transaction_kind")) {
    db.exec("ALTER TABLE celox_callback_events ADD COLUMN transaction_kind TEXT CHECK (transaction_kind IN ('deposit', 'withdraw'))");
  }
  const withdrawalColumns = db.pragma("table_info(celox_withdrawals)") as Array<{ name: string }>;
  if (!withdrawalColumns.some((column) => column.name === "confirmation_state")) {
    db.exec("ALTER TABLE celox_withdrawals ADD COLUMN confirmation_state TEXT NOT NULL DEFAULT 'ready' CHECK (confirmation_state IN ('ready', 'confirming', 'uncertain', 'success'))");
  }
  if (!withdrawalColumns.some((column) => column.name === "funds_reserved")) {
    db.exec("ALTER TABLE celox_withdrawals ADD COLUMN funds_reserved INTEGER NOT NULL DEFAULT 0 CHECK (funds_reserved IN (0, 1))");
  }
  migrateDatabase(db);
  seedDatabase(db);
  globalThis.__klangFinanceDb = db;
  return db;
}

function dateClause(from?: string, to?: string, column = "t.created_at") {
  const clauses: string[] = [];
  const values: string[] = [];
  if (from) {
    clauses.push(`date(${column}, '+7 hours') >= date(?)`);
    values.push(from);
  }
  if (to) {
    clauses.push(`date(${column}, '+7 hours') <= date(?)`);
    values.push(to);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

function getSummary(db: SqliteDatabase, from?: string, to?: string): FinanceSummary {
  const period = dateClause(from, to, "created_at");
  const transactionTotals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'success' AND direction = 'deposit' THEN amount_satang ELSE 0 END), 0) AS deposit_satang,
      COALESCE(SUM(CASE WHEN status = 'success' AND direction = 'withdraw' THEN amount_satang ELSE 0 END), 0) AS withdraw_satang,
      COUNT(*) AS transaction_count
    FROM transactions
    WHERE 1 = 1${period.sql}
  `).get(...period.values) as { deposit_satang: number; withdraw_satang: number; transaction_count: number };
  const customerTotals = db.prepare(`
    SELECT COALESCE(SUM(balance_satang), 0) AS balance_satang,
      COALESCE(SUM(withdrawable_satang), 0) AS withdrawable_satang,
      COUNT(*) AS customer_count
    FROM customers
  `).get() as { balance_satang: number; withdrawable_satang: number; customer_count: number };
  return {
    depositTotal: toMoney(transactionTotals.deposit_satang),
    withdrawTotal: toMoney(transactionTotals.withdraw_satang),
    balanceTotal: toMoney(customerTotals.balance_satang),
    withdrawableTotal: toMoney(customerTotals.withdrawable_satang),
    customerCount: customerTotals.customer_count,
    transactionCount: transactionTotals.transaction_count,
  };
}

export function listCustomers(options: { search?: string; from?: string; to?: string } = {}) {
  const db = getDatabase();
  const period = dateClause(options.from, options.to);
  const search = `%${options.search?.trim() ?? ""}%`;
  const rows = db.prepare(`
    SELECT c.*,
      COALESCE(SUM(CASE WHEN t.direction = 'deposit' THEN t.amount_satang ELSE 0 END), 0) AS deposit_satang,
      COALESCE(SUM(CASE WHEN t.direction = 'withdraw' THEN t.amount_satang ELSE 0 END), 0) AS withdraw_satang,
      COALESCE(SUM(CASE WHEN t.direction = 'deposit' AND t.channel = 'c2c' THEN t.amount_satang ELSE 0 END), 0) AS c2c_deposit_satang,
      COALESCE(SUM(CASE WHEN t.direction = 'withdraw' AND t.channel = 'c2c' THEN t.amount_satang ELSE 0 END), 0) AS c2c_withdraw_satang,
      (SELECT MAX(all_t.created_at) FROM transactions all_t WHERE all_t.customer_id = c.id) AS last_activity
    FROM customers c
    LEFT JOIN transactions t ON t.customer_id = c.id AND t.status = 'success'${period.sql}
    WHERE c.name LIKE ? OR c.account LIKE ? OR c.phone LIKE ?
    GROUP BY c.id
    ORDER BY last_activity DESC, c.created_at DESC
  `).all(...period.values, search, search, search) as Array<CustomerRow & {
    deposit_satang: number;
    withdraw_satang: number;
    c2c_deposit_satang: number;
    c2c_withdraw_satang: number;
    last_activity: string | null;
  }>;

  const customers: CustomerWithStats[] = rows.map((row) => ({
    ...mapCustomer(row),
    depositTotal: toMoney(row.deposit_satang),
    withdrawTotal: toMoney(row.withdraw_satang),
    c2cDepositTotal: toMoney(row.c2c_deposit_satang),
    c2cWithdrawTotal: toMoney(row.c2c_withdraw_satang),
    lastActivity: row.last_activity,
  }));
  const allCustomerRows = db.prepare("SELECT * FROM customers ORDER BY name").all() as CustomerRow[];
  return { customers, allCustomers: allCustomerRows.map(mapCustomer), summary: getSummary(db, options.from, options.to) };
}

const transactionSelect = `
  SELECT t.*,
    c.name AS customer_name, c.account AS customer_account, c.initials AS customer_initials,
    c.color AS customer_color, c.phone AS customer_phone, c.email AS customer_email,
    c.balance_satang AS customer_balance_satang, c.withdrawable_satang AS customer_withdrawable_satang,
    c.created_at AS customer_created_at,
    cp.id AS counterparty_id, cp.name AS counterparty_name, cp.account AS counterparty_account
  FROM transactions t
  JOIN customers c ON c.id = t.customer_id
  LEFT JOIN customers cp ON cp.id = t.counterparty_customer_id
`;

export function listTransactions(options: { search?: string; direction?: TransactionDirection; limit?: number } = {}) {
  const db = getDatabase();
  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (options.search?.trim()) {
    conditions.push("(c.name LIKE ? OR c.account LIKE ? OR t.id LIKE ?)");
    const search = `%${options.search.trim()}%`;
    values.push(search, search, search);
  }
  if (options.direction) {
    conditions.push("t.direction = ?");
    values.push(options.direction);
  }
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  values.push(limit);
  const rows = db.prepare(`${transactionSelect}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY t.created_at DESC LIMIT ?`).all(...values) as TransactionRow[];
  const customerRows = db.prepare("SELECT * FROM customers ORDER BY name").all() as CustomerRow[];
  return {
    transactions: rows.map(mapTransaction),
    customers: customerRows.map(mapCustomer),
    summary: getSummary(db),
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString().slice(-9)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function validMoneySatang(amount: number) {
  const amountSatang = toSatang(amount);
  if (
    !Number.isFinite(amount)
    || !Number.isSafeInteger(amountSatang)
    || amountSatang <= 0
    || Math.abs((amount * 100) - amountSatang) > 1e-8
  ) {
    throw new Error("จำนวนเงิน Celox ไม่ถูกต้อง");
  }
  return amountSatang;
}

function assertMatchingCeloxIntent(
  row: CeloxDepositRow,
  input: { customerId: string; deposit: CreateDepositResponse },
) {
  const amountSatang = validMoneySatang(input.deposit.amount);
  if (
    row.customer_id !== input.customerId
    || row.order_id !== input.deposit.orderId
    || row.reference_id !== input.deposit.referenceId
    || row.amount_satang !== amountSatang
  ) {
    throw new Error("รหัสรายการ Celox นี้ถูกผูกกับข้อมูลฝากชุดอื่นแล้ว");
  }
}

type CeloxDepositTransactionRow = {
  customer_id: string;
  direction: TransactionDirection;
  channel: TransactionChannel;
  amount_satang: number;
  status: TransactionStatus;
};

function insertPendingCeloxDepositTransaction(
  db: SqliteDatabase,
  input: { customerId: string; orderId: string; amountSatang: number; createdAt: string },
) {
  const localTransactionId = createId("TXN");
  db.prepare(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
    VALUES (?, ?, 'deposit', 'account', ?, ?, 'pending', ?)
  `).run(
    localTransactionId,
    input.customerId,
    input.amountSatang,
    `ฝากผ่าน Celox · ${input.orderId}`,
    input.createdAt,
  );
  return localTransactionId;
}

function getMatchingCeloxDepositTransaction(
  db: SqliteDatabase,
  localTransactionId: string,
  input: { customerId: string; amountSatang: number },
) {
  const transaction = db.prepare(`
    SELECT customer_id, direction, channel, amount_satang, status
    FROM transactions
    WHERE id = ?
  `).get(localTransactionId) as CeloxDepositTransactionRow | undefined;
  if (
    !transaction
    || transaction.customer_id !== input.customerId
    || transaction.direction !== "deposit"
    || transaction.channel !== "account"
    || transaction.amount_satang !== input.amountSatang
  ) {
    throw new Error("รายการ Celox นี้ชนกับ transaction ที่มีข้อมูลต่างกัน");
  }
  return transaction;
}

export function customerExists(customerId: string) {
  const row = getDatabase().prepare("SELECT 1 AS found FROM customers WHERE id = ?").get(customerId) as { found: 1 } | undefined;
  return Boolean(row);
}

export function recordCeloxDepositIntent(input: {
  customerId: string;
  deposit: CreateDepositResponse;
}) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(input.deposit.amount);
  const now = new Date().toISOString();

  const perform = db.transaction(() => {
    const customer = db.prepare("SELECT 1 AS found FROM customers WHERE id = ?").get(input.customerId) as { found: 1 } | undefined;
    if (!customer) throw new Error("ไม่พบข้อมูลลูกค้าที่เลือกรับยอดฝาก Celox");

    const existing = db.prepare("SELECT * FROM celox_deposits WHERE transaction_id = ?")
      .get(input.deposit.transactionId) as CeloxDepositRow | undefined;
    if (existing) {
      assertMatchingCeloxIntent(existing, input);
      if (existing.local_transaction_id) {
        getMatchingCeloxDepositTransaction(db, existing.local_transaction_id, {
          customerId: existing.customer_id,
          amountSatang: existing.amount_satang,
        });
        return;
      }
      const localTransactionId = insertPendingCeloxDepositTransaction(db, {
        customerId: existing.customer_id,
        orderId: existing.order_id,
        amountSatang: existing.amount_satang,
        createdAt: existing.created_at,
      });
      db.prepare(`
        UPDATE celox_deposits
        SET local_transaction_id = ?, updated_at = ?
        WHERE transaction_id = ?
      `).run(localTransactionId, now, existing.transaction_id);
      return;
    }

    const localTransactionId = insertPendingCeloxDepositTransaction(db, {
      customerId: input.customerId,
      orderId: input.deposit.orderId,
      amountSatang,
      createdAt: now,
    });
    db.prepare(`
      INSERT INTO celox_deposits (
        transaction_id, order_id, reference_id, customer_id, amount_satang,
        transaction_status, local_transaction_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING_TRANSFER', ?, ?, ?)
    `).run(
      input.deposit.transactionId,
      input.deposit.orderId,
      input.deposit.referenceId,
      input.customerId,
      amountSatang,
      localTransactionId,
      now,
      now,
    );
  });

  perform();
}

export function getCeloxDepositIntent(transactionId: string) {
  const row = getDatabase().prepare("SELECT * FROM celox_deposits WHERE transaction_id = ?")
    .get(transactionId) as CeloxDepositRow | undefined;
  if (!row) return null;
  return {
    transactionId: row.transaction_id,
    orderId: row.order_id,
    customerId: row.customer_id,
    amount: toMoney(row.amount_satang),
    transactionStatus: row.transaction_status,
    localTransactionId: row.local_transaction_id,
  };
}

export function claimCeloxDepositSlipSubmission(transactionId: string) {
  const result = getDatabase().prepare(`
    INSERT OR IGNORE INTO celox_deposit_slip_claims (transaction_id, claimed_at)
    SELECT transaction_id, ?
    FROM celox_deposits
    WHERE transaction_id = ? AND transaction_status = 'PENDING_TRANSFER'
  `).run(new Date().toISOString(), transactionId);
  return result.changes === 1;
}

export function releaseCeloxDepositSlipSubmission(transactionId: string) {
  getDatabase().prepare("DELETE FROM celox_deposit_slip_claims WHERE transaction_id = ?")
    .run(transactionId);
}

const allowedCeloxDepositTransitions: Record<
  Exclude<DepositTransactionStatus, "SUCCESS">,
  ReadonlySet<DepositTransactionStatus>
> = {
  PENDING_TRANSFER: new Set(["PENDING_TRANSFER", "PENDING_APPROVE", "EXPIRED"]),
  PENDING_APPROVE: new Set(["PENDING_APPROVE", "EXPIRED"]),
  EXPIRED: new Set(["EXPIRED"]),
};

function isDepositTransactionStatus(value: string): value is DepositTransactionStatus {
  return ["SUCCESS", "PENDING_APPROVE", "PENDING_TRANSFER", "EXPIRED"].includes(value);
}

function canTransitionCeloxDepositStatus(
  current: DepositTransactionStatus,
  next: DepositTransactionStatus,
) {
  return current === "SUCCESS"
    ? next === "SUCCESS"
    : allowedCeloxDepositTransitions[current].has(next);
}

const terminalCeloxFailureStatuses = new Set([
  "FAILED",
  "FAILURE",
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "CANCELED",
]);

function isTerminalCeloxFailureStatus(value: string) {
  return terminalCeloxFailureStatuses.has(value.toUpperCase());
}

function finalizeCeloxDepositSuccess(
  db: SqliteDatabase,
  intent: CeloxDepositRow,
  input: {
    transactionId: string;
    orderId: string;
    amountSatang: number;
    occurredAt: string;
  },
  now: string,
) {
  if (
    intent.transaction_id !== input.transactionId
    || intent.order_id !== input.orderId
    || intent.amount_satang !== input.amountSatang
  ) {
    throw new Error("ผลสำเร็จของ Celox ไม่ตรงกับรายการฝากที่สร้างไว้");
  }

  const localTransactionId = intent.local_transaction_id
    ?? insertPendingCeloxDepositTransaction(db, {
      customerId: intent.customer_id,
      orderId: intent.order_id,
      amountSatang: intent.amount_satang,
      createdAt: intent.created_at,
    });
  const existing = getMatchingCeloxDepositTransaction(db, localTransactionId, {
    customerId: intent.customer_id,
    amountSatang: input.amountSatang,
  });

  if (existing.status === "success") {
    db.prepare(`
      UPDATE celox_deposits
      SET transaction_status = 'SUCCESS', local_transaction_id = ?, updated_at = ?
      WHERE transaction_id = ?
    `).run(localTransactionId, now, input.transactionId);
    db.prepare("DELETE FROM celox_deposit_slip_claims WHERE transaction_id = ?")
      .run(input.transactionId);
    return { created: false, transactionId: localTransactionId };
  }

  const balanceUpdate = db.prepare(`
    UPDATE customers
    SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ?
    WHERE id = ?
  `).run(input.amountSatang, input.amountSatang, intent.customer_id);
  if (balanceUpdate.changes !== 1) throw new Error("ไม่พบลูกค้าที่ต้องรับยอดฝาก Celox");
  const transactionUpdate = db.prepare(`
    UPDATE transactions
    SET status = 'success'
    WHERE id = ? AND status <> 'success'
  `).run(localTransactionId);
  if (transactionUpdate.changes !== 1) throw new Error("อัปเดตสถานะ transaction ของรายการฝาก Celox ไม่สำเร็จ");
  db.prepare(`
    UPDATE celox_deposits
    SET transaction_status = 'SUCCESS', local_transaction_id = ?, updated_at = ?
    WHERE transaction_id = ?
  `).run(localTransactionId, now, input.transactionId);
  db.prepare("DELETE FROM celox_deposit_slip_claims WHERE transaction_id = ?")
    .run(input.transactionId);
  return { created: true, transactionId: localTransactionId };
}

export function recordCeloxDepositResult(result: DepositSlipResponse) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(result.amount);
  const now = new Date().toISOString();

  const perform = db.transaction(() => {
    const intent = db.prepare("SELECT * FROM celox_deposits WHERE transaction_id = ?")
      .get(result.transactionId) as CeloxDepositRow | undefined;
    if (!intent) throw new Error("ไม่พบรายการฝาก Celox ที่ผูกกับลูกค้าในระบบ");
    if (intent.order_id !== result.orderId || intent.amount_satang !== amountSatang) {
      throw new Error("ผลตรวจสลิปไม่ตรงกับรายการฝาก Celox ที่สร้างไว้");
    }

    if (result.transactionStatus !== "SUCCESS") {
      if (intent.transaction_status === "SUCCESS") {
        throw new Error("รายการฝาก Celox ที่บันทึกสำเร็จแล้วไม่สามารถย้อนกลับเป็นสถานะอื่นได้");
      }
      if (!canTransitionCeloxDepositStatus(intent.transaction_status, result.transactionStatus)) {
        throw new Error("สถานะรายการฝาก Celox ย้อนกลับจากลำดับที่บันทึกไว้");
      }
      db.prepare(`
        UPDATE celox_deposits
        SET transaction_status = ?, updated_at = ?
        WHERE transaction_id = ?
      `).run(result.transactionStatus, now, result.transactionId);
      return { created: false, transactionId: intent.local_transaction_id };
    }

    if (!result.occurredAt || result.slipVerification.outcome !== "match") {
      throw new Error("Celox ระบุ SUCCESS แต่ผลตรวจสลิปหรือเวลาสำเร็จไม่ครบถ้วน");
    }
    return finalizeCeloxDepositSuccess(db, intent, {
      transactionId: result.transactionId,
      orderId: result.orderId,
      amountSatang,
      occurredAt: result.occurredAt,
    }, now);
  });

  return perform();
}

function assertMatchingCeloxWithdrawalIntent(
  row: CeloxWithdrawalRow,
  input: {
    customerId: string;
    request: CreateWithdrawalRequest;
    withdrawal: CreateWithdrawalResponse;
  },
) {
  const amountSatang = validMoneySatang(input.request.amount);
  if (
    row.customer_id !== input.customerId
    || row.order_id !== input.withdrawal.orderId
    || row.reference_id !== (input.request.referenceId ?? null)
    || row.amount_satang !== amountSatang
    || row.destination_bank_code !== input.request.destinationBankCode
    || row.destination_account_name !== input.request.destinationAccountName
    || row.destination_account_no !== input.request.destinationAccountNo
  ) {
    throw new Error("รหัสรายการถอน Celox นี้ถูกผูกกับข้อมูลชุดอื่นแล้ว");
  }
}

export function reserveCeloxWithdrawalFunds(input: {
  customerId: string;
  request: CreateWithdrawalRequest;
}) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(input.request.amount);
  const reservationId = createId("WDR");
  const now = new Date().toISOString();

  const perform = db.transaction(() => {
    db.prepare(`
      INSERT INTO celox_withdrawal_reservations (
        reservation_id, customer_id, amount_satang, reference_id,
        destination_bank_code, destination_account_name, destination_account_no,
        reservation_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?)
    `).run(
      reservationId,
      input.customerId,
      amountSatang,
      input.request.referenceId ?? null,
      input.request.destinationBankCode,
      input.request.destinationAccountName,
      input.request.destinationAccountNo,
      now,
      now,
    );
    const reserved = db.prepare(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang - ?
      WHERE id = ? AND withdrawable_satang >= ?
    `).run(amountSatang, input.customerId, amountSatang);
    if (reserved.changes !== 1) {
      throw new Error("ยอดเงินที่ถอนได้ไม่เพียงพอสำหรับกันยอดรายการถอน Celox");
    }
  });

  perform();
  return reservationId;
}

export function markCeloxWithdrawalReservationUncertain(reservationId: string) {
  getDatabase().prepare(`
    UPDATE celox_withdrawal_reservations
    SET reservation_state = 'uncertain', updated_at = ?
    WHERE reservation_id = ?
  `).run(new Date().toISOString(), reservationId);
}

export function releaseCeloxWithdrawalReservation(reservationId: string) {
  const db = getDatabase();
  const perform = db.transaction(() => {
    const reservation = db.prepare(`
      SELECT * FROM celox_withdrawal_reservations WHERE reservation_id = ?
    `).get(reservationId) as CeloxWithdrawalReservationRow | undefined;
    if (!reservation) return;
    const released = db.prepare(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang + ?
      WHERE id = ? AND withdrawable_satang + ? <= balance_satang
    `).run(
      reservation.amount_satang,
      reservation.customer_id,
      reservation.amount_satang,
    );
    if (released.changes !== 1) {
      throw new Error("คืนยอดที่กันไว้สำหรับรายการถอน Celox ไม่สำเร็จ");
    }
    db.prepare("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?")
      .run(reservationId);
  });
  perform();
}

export function recordCeloxWithdrawalIntent(input: {
  reservationId: string;
  customerId: string;
  request: CreateWithdrawalRequest;
  withdrawal: CreateWithdrawalResponse;
}) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(input.request.amount);
  const now = new Date().toISOString();

  const perform = db.transaction(() => {
    if (
      input.withdrawal.amount !== input.request.amount
      || input.withdrawal.referenceId !== (input.request.referenceId ?? null)
      || input.withdrawal.transactionStatus !== "PENDING"
    ) {
      throw new Error("ผลสร้างรายการถอนจาก Celox ไม่ตรงกับคำขอ");
    }

    const existing = db.prepare("SELECT * FROM celox_withdrawals WHERE transaction_id = ?")
      .get(input.withdrawal.transactionId) as CeloxWithdrawalRow | undefined;
    if (existing) {
      assertMatchingCeloxWithdrawalIntent(existing, input);
      const duplicateReservation = db.prepare(`
        SELECT * FROM celox_withdrawal_reservations WHERE reservation_id = ?
      `).get(input.reservationId) as CeloxWithdrawalReservationRow | undefined;
      if (duplicateReservation) {
        const released = db.prepare(`
          UPDATE customers
          SET withdrawable_satang = withdrawable_satang + ?
          WHERE id = ? AND withdrawable_satang + ? <= balance_satang
        `).run(amountSatang, input.customerId, amountSatang);
        if (released.changes !== 1) throw new Error("คืนยอดจองซ้ำของรายการถอน Celox ไม่สำเร็จ");
        db.prepare("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?")
          .run(input.reservationId);
      }
      return;
    }

    const reservation = db.prepare(`
      SELECT * FROM celox_withdrawal_reservations WHERE reservation_id = ?
    `).get(input.reservationId) as CeloxWithdrawalReservationRow | undefined;
    if (
      !reservation
      || reservation.customer_id !== input.customerId
      || reservation.amount_satang !== amountSatang
      || reservation.reference_id !== (input.request.referenceId ?? null)
      || reservation.destination_bank_code !== input.request.destinationBankCode
      || reservation.destination_account_name !== input.request.destinationAccountName
      || reservation.destination_account_no !== input.request.destinationAccountNo
    ) {
      throw new Error("ไม่พบยอดที่กันไว้ซึ่งตรงกับรายการถอน Celox");
    }

    db.prepare(`
      INSERT INTO celox_withdrawals (
        transaction_id, order_id, reference_id, customer_id, amount_satang,
        destination_bank_code, destination_account_name, destination_account_no,
        transaction_status, confirmation_state, funds_reserved, occurred_at,
        local_transaction_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'ready', 1, NULL, NULL, ?, ?)
    `).run(
      input.withdrawal.transactionId,
      input.withdrawal.orderId,
      input.request.referenceId ?? null,
      input.customerId,
      amountSatang,
      input.request.destinationBankCode,
      input.request.destinationAccountName,
      input.request.destinationAccountNo,
      now,
      now,
    );
    db.prepare("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?")
      .run(input.reservationId);
  });

  perform();
}

export function getCeloxWithdrawalIntent(transactionId: string) {
  const row = getDatabase().prepare("SELECT * FROM celox_withdrawals WHERE transaction_id = ?")
    .get(transactionId) as CeloxWithdrawalRow | undefined;
  if (!row) return null;
  const request: ConfirmWithdrawalRequest = {
    amount: toMoney(row.amount_satang),
    destinationBankCode: row.destination_bank_code as ConfirmWithdrawalRequest["destinationBankCode"],
    destinationAccountName: row.destination_account_name,
    destinationAccountNo: row.destination_account_no,
    ...(row.reference_id === null ? {} : { referenceId: row.reference_id }),
  };
  return {
    transactionId: row.transaction_id,
    orderId: row.order_id,
    referenceId: row.reference_id,
    customerId: row.customer_id,
    amount: toMoney(row.amount_satang),
    transactionStatus: row.transaction_status,
    confirmationState: row.confirmation_state,
    fundsReserved: row.funds_reserved === 1,
    localTransactionId: row.local_transaction_id,
    request,
  };
}

export function claimCeloxWithdrawalConfirmation(transactionId: string) {
  const db = getDatabase();
  const perform = db.transaction(() => {
    const intent = db.prepare("SELECT * FROM celox_withdrawals WHERE transaction_id = ?")
      .get(transactionId) as CeloxWithdrawalRow | undefined;
    if (
      !intent
      || intent.transaction_status !== "PENDING"
      || intent.confirmation_state !== "ready"
    ) {
      return "busy" as const;
    }
    if (intent.funds_reserved === 0) {
      const reserved = db.prepare(`
        UPDATE customers
        SET withdrawable_satang = withdrawable_satang - ?
        WHERE id = ? AND withdrawable_satang >= ?
      `).run(intent.amount_satang, intent.customer_id, intent.amount_satang);
      if (reserved.changes !== 1) return "insufficient" as const;
    }
    db.prepare(`
      UPDATE celox_withdrawals
      SET confirmation_state = 'confirming', funds_reserved = 1, updated_at = ?
      WHERE transaction_id = ?
    `).run(new Date().toISOString(), transactionId);
    return "claimed" as const;
  });
  return perform();
}

export function releaseCeloxWithdrawalConfirmationClaim(transactionId: string) {
  getDatabase().prepare(`
    UPDATE celox_withdrawals
    SET confirmation_state = 'ready', updated_at = ?
    WHERE transaction_id = ?
      AND transaction_status = 'PENDING'
      AND confirmation_state = 'confirming'
  `).run(new Date().toISOString(), transactionId);
}

export function markCeloxWithdrawalConfirmationUncertain(transactionId: string) {
  getDatabase().prepare(`
    UPDATE celox_withdrawals
    SET confirmation_state = 'uncertain', updated_at = ?
    WHERE transaction_id = ? AND transaction_status = 'PENDING'
  `).run(new Date().toISOString(), transactionId);
}

function finalizeCeloxWithdrawalSuccess(
  db: SqliteDatabase,
  intent: CeloxWithdrawalRow,
  input: {
    transactionId: string;
    orderId: string;
    referenceId?: string | null;
    amountSatang: number;
    occurredAt: string;
  },
  now: string,
) {
  if (
    intent.transaction_id !== input.transactionId
    || intent.order_id !== input.orderId
    || intent.amount_satang !== input.amountSatang
    || (input.referenceId !== undefined && intent.reference_id !== input.referenceId)
  ) {
    throw new Error("ผลสำเร็จของรายการถอน Celox ไม่ตรงกับรายการที่สร้างไว้");
  }

  if (intent.local_transaction_id) {
    if (intent.funds_reserved === 1) {
      throw new Error("รายการถอน Celox มี transaction แล้วแต่ยอดจองยังไม่ถูกใช้");
    }
    const existing = db.prepare(`
      SELECT customer_id, direction, channel, amount_satang
      FROM transactions
      WHERE id = ?
    `).get(intent.local_transaction_id) as {
      customer_id: string;
      direction: TransactionDirection;
      channel: TransactionChannel;
      amount_satang: number;
    } | undefined;
    if (
      !existing
      || existing.customer_id !== intent.customer_id
      || existing.direction !== "withdraw"
      || existing.channel !== "account"
      || existing.amount_satang !== input.amountSatang
    ) {
      throw new Error("รายการถอน Celox ชนกับ transaction ที่มีข้อมูลต่างกัน");
    }
    db.prepare(`
      UPDATE celox_withdrawals
      SET transaction_status = 'SUCCESS', confirmation_state = 'success', funds_reserved = 0,
          occurred_at = COALESCE(occurred_at, ?), updated_at = ?
      WHERE transaction_id = ?
    `).run(input.occurredAt, now, input.transactionId);
    return { created: false, transactionId: intent.local_transaction_id };
  }
  if (intent.transaction_status === "SUCCESS") {
    throw new Error("รายการถอน Celox สำเร็จแต่ไม่มี local transaction");
  }

  const balanceUpdate = intent.funds_reserved === 1
    ? db.prepare(`
        UPDATE customers
        SET balance_satang = balance_satang - ?
        WHERE id = ? AND balance_satang >= ?
          AND balance_satang - ? >= withdrawable_satang
      `).run(
        input.amountSatang,
        intent.customer_id,
        input.amountSatang,
        input.amountSatang,
      )
    : db.prepare(`
        UPDATE customers
        SET balance_satang = balance_satang - ?, withdrawable_satang = withdrawable_satang - ?
        WHERE id = ? AND balance_satang >= ? AND withdrawable_satang >= ?
      `).run(
        input.amountSatang,
        input.amountSatang,
        intent.customer_id,
        input.amountSatang,
        input.amountSatang,
      );
  if (balanceUpdate.changes !== 1) {
    throw new Error("ยอดเงินลูกค้าไม่เพียงพอสำหรับบันทึกรายการถอน Celox ที่สำเร็จแล้ว");
  }

  const localTransactionId = createId("TXN");
  db.prepare(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
    VALUES (?, ?, 'withdraw', 'account', ?, ?, 'success', ?)
  `).run(
    localTransactionId,
    intent.customer_id,
    input.amountSatang,
    `ถอนผ่าน Celox · ${input.orderId}`,
    input.occurredAt,
  );
  db.prepare(`
    UPDATE celox_withdrawals
    SET transaction_status = 'SUCCESS', confirmation_state = 'success', funds_reserved = 0,
        occurred_at = ?, local_transaction_id = ?, updated_at = ?
    WHERE transaction_id = ?
  `).run(input.occurredAt, localTransactionId, now, input.transactionId);
  return { created: true, transactionId: localTransactionId };
}

export function recordCeloxWithdrawalResult(result: ConfirmWithdrawalResponse) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(result.amount);
  const now = new Date().toISOString();
  const perform = db.transaction(() => {
    const intent = db.prepare("SELECT * FROM celox_withdrawals WHERE transaction_id = ?")
      .get(result.transactionId) as CeloxWithdrawalRow | undefined;
    if (!intent) throw new Error("ไม่พบรายการถอน Celox ที่ผูกกับลูกค้าในระบบ");
    return finalizeCeloxWithdrawalSuccess(db, intent, {
      transactionId: result.transactionId,
      orderId: result.orderId,
      amountSatang,
      occurredAt: result.occurredAt ?? now,
    }, now);
  });
  return perform();
}

function insertPendingC2CTransaction(
  db: SqliteDatabase,
  input: {
    customerId: string;
    direction: "deposit" | "withdraw";
    amountSatang: number;
    orderId: string;
    createdAt: string;
  },
) {
  const localTransactionId = createId("TXN");
  db.prepare(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
    VALUES (?, ?, ?, 'c2c', ?, ?, 'pending', ?)
  `).run(
    localTransactionId,
    input.customerId,
    input.direction,
    input.amountSatang,
    `${input.direction === "deposit" ? "ฝาก" : "ถอน"}แบบ Celox C2C · ${input.orderId}`,
    input.createdAt,
  );
  return localTransactionId;
}

function getC2CLocalTransaction(db: SqliteDatabase, row: CeloxC2CRow) {
  const transaction = db.prepare(`
    SELECT customer_id, direction, channel, amount_satang, status
    FROM transactions WHERE id = ?
  `).get(row.local_transaction_id) as CeloxDepositTransactionRow | undefined;
  if (
    !transaction
    || transaction.customer_id !== row.customer_id
    || transaction.direction !== row.direction
    || transaction.channel !== "c2c"
    || transaction.amount_satang !== row.amount_satang
  ) {
    throw new Error("รายการ C2C ชนกับ transaction ภายในที่มีข้อมูลต่างกัน");
  }
  return transaction;
}

function finalizeC2CSuccess(db: SqliteDatabase, row: CeloxC2CRow, now: string) {
  const local = getC2CLocalTransaction(db, row);
  if (local.status === "success") {
    if (row.funds_reserved === 1) {
      throw new Error("รายการถอน C2C สำเร็จแล้วแต่ยอดภายในยังถูกกันอยู่");
    }
    return;
  }
  if (local.status !== "pending") {
    throw new Error("รายการ C2C ที่จบสำเร็จชนกับสถานะภายในที่ปิดไปแล้ว");
  }

  if (row.direction === "deposit") {
    const credited = db.prepare(`
      UPDATE customers
      SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ?
      WHERE id = ?
    `).run(row.amount_satang, row.amount_satang, row.customer_id);
    if (credited.changes !== 1) throw new Error("เพิ่มยอดฝาก C2C ให้ลูกค้าไม่สำเร็จ");
  } else if (row.funds_reserved === 1) {
    const debited = db.prepare(`
      UPDATE customers
      SET balance_satang = balance_satang - ?
      WHERE id = ? AND balance_satang >= ?
        AND balance_satang - ? >= withdrawable_satang
    `).run(row.amount_satang, row.customer_id, row.amount_satang, row.amount_satang);
    if (debited.changes !== 1) throw new Error("ใช้ยอดที่กันไว้สำหรับถอน C2C ไม่สำเร็จ");
  } else {
    throw new Error("รายการถอน C2C สำเร็จโดยไม่มียอดภายในที่กันไว้");
  }

  db.prepare("UPDATE transactions SET status = 'success' WHERE id = ?")
    .run(row.local_transaction_id);
  db.prepare(`
    UPDATE celox_c2c_transactions
    SET transaction_status = 'SUCCESS', settled_amount_satang = amount_satang,
        held_amount_satang = 0, funds_reserved = 0, updated_at = ?
    WHERE transaction_id = ?
  `).run(now, row.transaction_id);
}

function finalizeC2CFailure(db: SqliteDatabase, row: CeloxC2CRow, now: string) {
  const local = getC2CLocalTransaction(db, row);
  if (local.status === "success") {
    throw new Error("ไม่สามารถปิดรายการ C2C ที่บันทึกสำเร็จแล้วเป็นรายการไม่สำเร็จได้");
  }
  if (row.direction === "withdraw" && row.funds_reserved === 1) {
    const released = db.prepare(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang + ?
      WHERE id = ? AND withdrawable_satang + ? <= balance_satang
    `).run(row.amount_satang, row.customer_id, row.amount_satang);
    if (released.changes !== 1) throw new Error("คืนยอดที่กันไว้สำหรับถอน C2C ไม่สำเร็จ");
  }
  db.prepare("UPDATE transactions SET status = 'failed' WHERE id = ? AND status = 'pending'")
    .run(row.local_transaction_id);
  db.prepare(`
    UPDATE celox_c2c_transactions
    SET funds_reserved = 0, held_amount_satang = 0, updated_at = ?
    WHERE transaction_id = ?
  `).run(now, row.transaction_id);
}

export function recordCeloxC2CDepositIntent(input: {
  customerId: string;
  deposit: CreateC2CDepositResponse;
}) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(input.deposit.amount);
  const now = new Date().toISOString();
  const perform = db.transaction(() => {
    const customer = db.prepare("SELECT 1 AS found FROM customers WHERE id = ?")
      .get(input.customerId) as { found: 1 } | undefined;
    if (!customer) throw new Error("ไม่พบลูกค้าที่เลือกรับยอดฝาก C2C");

    const existing = db.prepare("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?")
      .get(input.deposit.transactionId) as CeloxC2CRow | undefined;
    if (existing) {
      if (
        existing.customer_id !== input.customerId
        || existing.direction !== "deposit"
        || existing.order_id !== input.deposit.orderId
        || existing.reference_id !== input.deposit.referenceId
        || existing.amount_satang !== amountSatang
      ) {
        throw new Error("รหัสรายการฝาก C2C นี้ถูกผูกกับข้อมูลชุดอื่นแล้ว");
      }
      getC2CLocalTransaction(db, existing);
      return;
    }

    const localTransactionId = insertPendingC2CTransaction(db, {
      customerId: input.customerId,
      direction: "deposit",
      amountSatang,
      orderId: input.deposit.orderId,
      createdAt: now,
    });
    db.prepare(`
      INSERT INTO celox_c2c_transactions (
        transaction_id, order_id, reference_id, customer_id, direction,
        transaction_status, amount_satang, fee_amount_satang,
        settled_amount_satang, held_amount_satang, awaiting_manual_review,
        match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'deposit', ?, ?, 0, 0, 0, 0, ?, 0, ?, ?, ?)
    `).run(
      input.deposit.transactionId,
      input.deposit.orderId,
      input.deposit.referenceId,
      input.customerId,
      input.deposit.transactionStatus,
      amountSatang,
      input.deposit.matchDeadline,
      localTransactionId,
      now,
      now,
    );
  });
  perform();
}

export function reserveCeloxC2CWithdrawalFunds(input: {
  customerId: string;
  request: CreateC2CWithdrawalRequest & { referenceId: string };
}) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(input.request.amount);
  const reservationId = createId("C2C-WDR");
  const now = new Date().toISOString();
  const perform = db.transaction(() => {
    db.prepare(`
      INSERT INTO celox_c2c_withdrawal_reservations (
        reservation_id, customer_id, amount_satang, reference_id,
        reservation_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'creating', ?, ?)
    `).run(reservationId, input.customerId, amountSatang, input.request.referenceId, now, now);
    const reserved = db.prepare(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang - ?
      WHERE id = ? AND withdrawable_satang >= ?
    `).run(amountSatang, input.customerId, amountSatang);
    if (reserved.changes !== 1) {
      throw new Error("ยอดเงินที่ถอนได้ไม่เพียงพอสำหรับกันยอดถอน C2C");
    }
  });
  perform();
  return reservationId;
}

export function markCeloxC2CWithdrawalReservationUncertain(reservationId: string) {
  getDatabase().prepare(`
    UPDATE celox_c2c_withdrawal_reservations
    SET reservation_state = 'uncertain', updated_at = ?
    WHERE reservation_id = ?
  `).run(new Date().toISOString(), reservationId);
}

export function releaseCeloxC2CWithdrawalReservation(reservationId: string) {
  const db = getDatabase();
  const perform = db.transaction(() => {
    const reservation = db.prepare(`
      SELECT * FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?
    `).get(reservationId) as CeloxC2CWithdrawalReservationRow | undefined;
    if (!reservation) return;
    const released = db.prepare(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang + ?
      WHERE id = ? AND withdrawable_satang + ? <= balance_satang
    `).run(reservation.amount_satang, reservation.customer_id, reservation.amount_satang);
    if (released.changes !== 1) throw new Error("คืนยอดจองถอน C2C ไม่สำเร็จ");
    db.prepare("DELETE FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?")
      .run(reservationId);
  });
  perform();
}

export function recordCeloxC2CWithdrawalIntent(input: {
  reservationId: string;
  customerId: string;
  request: CreateC2CWithdrawalRequest & { referenceId: string };
  withdrawal: CreateC2CWithdrawalResponse;
}) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(input.request.amount);
  const feeSatang = toSatang(input.withdrawal.feeAmount);
  const heldSatang = toSatang(input.withdrawal.reservedAmount);
  const now = new Date().toISOString();
  const perform = db.transaction(() => {
    const reservation = db.prepare(`
      SELECT * FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?
    `).get(input.reservationId) as CeloxC2CWithdrawalReservationRow | undefined;
    if (
      !reservation
      || reservation.customer_id !== input.customerId
      || reservation.amount_satang !== amountSatang
      || reservation.reference_id !== input.request.referenceId
    ) {
      throw new Error("ไม่พบยอดที่กันไว้สำหรับรายการถอน C2C ชุดนี้");
    }
    if (
      input.withdrawal.amount !== input.request.amount
      || input.withdrawal.referenceId !== input.request.referenceId
    ) {
      throw new Error("ผลสร้างรายการถอน C2C ไม่ตรงกับคำขอ");
    }

    const localTransactionId = insertPendingC2CTransaction(db, {
      customerId: input.customerId,
      direction: "withdraw",
      amountSatang,
      orderId: input.withdrawal.orderId,
      createdAt: now,
    });
    db.prepare(`
      INSERT INTO celox_c2c_transactions (
        transaction_id, order_id, reference_id, customer_id, direction,
        transaction_status, amount_satang, fee_amount_satang,
        settled_amount_satang, held_amount_satang, awaiting_manual_review,
        match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'withdraw', ?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      input.withdrawal.transactionId,
      input.withdrawal.orderId,
      input.withdrawal.referenceId,
      input.customerId,
      input.withdrawal.transactionStatus,
      amountSatang,
      feeSatang,
      heldSatang,
      input.withdrawal.awaitingManualReview || input.withdrawal.transactionStatus === "PENDING_MANUAL_C2C" ? 1 : 0,
      input.withdrawal.matchDeadline,
      localTransactionId,
      now,
      now,
    );
    db.prepare("DELETE FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?")
      .run(input.reservationId);
  });
  perform();
}

export function getCeloxC2CIntent(transactionId: string) {
  const row = getDatabase().prepare("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?")
    .get(transactionId) as CeloxC2CRow | undefined;
  if (!row) return null;
  return {
    transactionId: row.transaction_id,
    orderId: row.order_id,
    referenceId: row.reference_id,
    customerId: row.customer_id,
    direction: row.direction,
    transactionStatus: row.transaction_status,
    amount: toMoney(row.amount_satang),
  };
}

export function recordCeloxC2CSlipResult(result: C2CDepositSlipResponse) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const perform = db.transaction(() => {
    const row = db.prepare("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?")
      .get(result.transactionId) as CeloxC2CRow | undefined;
    if (!row || row.direction !== "deposit" || row.order_id !== result.orderId) {
      throw new Error("ไม่พบรายการฝาก C2C ที่ตรงกับผลตรวจสลิป");
    }
    db.prepare(`
      UPDATE celox_c2c_transactions
      SET transaction_status = ?, awaiting_manual_review = ?, updated_at = ?
      WHERE transaction_id = ?
    `).run(
      result.transactionStatus,
      result.transactionStatus === "PENDING_APPROVE" ? 1 : 0,
      now,
      result.transactionId,
    );
    if (result.transactionStatus === "SUCCESS") {
      finalizeC2CSuccess(db, { ...row, transaction_status: "SUCCESS" }, now);
    }
  });
  perform();
}

export function recordCeloxC2CCancelResult(result: CancelC2CTransactionResponse) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const perform = db.transaction(() => {
    const row = db.prepare("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?")
      .get(result.transactionId) as CeloxC2CRow | undefined;
    if (!row) return false;
    if (
      row.order_id !== result.orderId
      || row.reference_id !== result.referenceId
    ) {
      throw new Error("ผลยกเลิก C2C ไม่ตรงกับรายการในระบบ");
    }
    db.prepare(`
      UPDATE celox_c2c_transactions
      SET transaction_status = ?, match_deadline = NULL, updated_at = ?
      WHERE transaction_id = ?
    `).run(result.transactionStatus, now, result.transactionId);
    if (result.transactionStatus === "CANCELLED") {
      finalizeC2CFailure(db, { ...row, transaction_status: "CANCELLED" }, now);
    }
    return true;
  });
  return perform();
}

export function syncCeloxC2CTransaction(result: C2CTransactionResponse) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(result.amount);
  const now = new Date().toISOString();
  const perform = db.transaction(() => {
    let row = db.prepare(`
      SELECT * FROM celox_c2c_transactions
      WHERE transaction_id = ? OR order_id = ? OR reference_id = ?
      LIMIT 1
    `).get(result.transactionId, result.orderId, result.referenceId) as CeloxC2CRow | undefined;
    if (!row && result.direction === "withdraw" && result.referenceId) {
      const reservation = db.prepare(`
        SELECT * FROM celox_c2c_withdrawal_reservations WHERE reference_id = ?
      `).get(result.referenceId) as CeloxC2CWithdrawalReservationRow | undefined;
      if (reservation && reservation.amount_satang === amountSatang) {
        const localTransactionId = insertPendingC2CTransaction(db, {
          customerId: reservation.customer_id,
          direction: "withdraw",
          amountSatang,
          orderId: result.orderId,
          createdAt: reservation.created_at,
        });
        db.prepare(`
          INSERT INTO celox_c2c_transactions (
            transaction_id, order_id, reference_id, customer_id, direction,
            transaction_status, amount_satang, fee_amount_satang,
            settled_amount_satang, held_amount_satang, awaiting_manual_review,
            match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'withdraw', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).run(
          result.transactionId,
          result.orderId,
          result.referenceId,
          reservation.customer_id,
          result.transactionStatus,
          amountSatang,
          toSatang(result.feeAmount),
          toSatang(result.settledAmount),
          toSatang(result.heldAmount),
          result.awaitingManualReview ? 1 : 0,
          result.matchDeadline,
          localTransactionId,
          reservation.created_at,
          now,
        );
        db.prepare("DELETE FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?")
          .run(reservation.reservation_id);
        row = db.prepare("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?")
          .get(result.transactionId) as CeloxC2CRow;
      }
    }
    if (!row) return false;
    if (
      row.transaction_id !== result.transactionId
      || row.order_id !== result.orderId
      || row.reference_id !== result.referenceId
      || row.direction !== result.direction
      || row.amount_satang !== amountSatang
    ) {
      throw new Error("สถานะ C2C จาก Celox ไม่ตรงกับรายการที่ผูกไว้ในระบบ");
    }

    db.prepare(`
      UPDATE celox_c2c_transactions
      SET transaction_status = ?, fee_amount_satang = ?, settled_amount_satang = ?,
          held_amount_satang = ?, awaiting_manual_review = ?, match_deadline = ?, updated_at = ?
      WHERE transaction_id = ?
    `).run(
      result.transactionStatus,
      toSatang(result.feeAmount),
      toSatang(result.settledAmount),
      toSatang(result.heldAmount),
      result.awaitingManualReview ? 1 : 0,
      result.matchDeadline,
      now,
      result.transactionId,
    );

    const current = { ...row, transaction_status: result.transactionStatus };
    if (result.transactionStatus === "SUCCESS") {
      finalizeC2CSuccess(db, current, now);
    } else if (
      result.transactionStatus === "CANCELLED"
      || (row.direction === "withdraw" && result.transactionStatus === "EXPIRED" && result.heldAmount === 0)
    ) {
      finalizeC2CFailure(db, current, now);
    }
    return true;
  });
  return perform();
}

export function listCeloxC2CTransactions(options: { search?: string; limit?: number } = {}) {
  const db = getDatabase();
  const values: Array<string | number> = [];
  const conditions: string[] = [];
  if (options.search?.trim()) {
    const search = `%${options.search.trim()}%`;
    conditions.push(`(
      c.name LIKE ? OR c.account LIKE ? OR x.order_id LIKE ?
      OR x.reference_id LIKE ? OR x.transaction_id LIKE ?
    )`);
    values.push(search, search, search, search, search);
  }
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  values.push(limit);
  const rows = db.prepare(`
    SELECT x.*, c.name AS customer_name, c.account AS customer_account
    FROM celox_c2c_transactions x
    JOIN customers c ON c.id = x.customer_id
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY x.created_at DESC
    LIMIT ?
  `).all(...values) as Array<CeloxC2CRow & { customer_name: string; customer_account: string }>;
  return rows.map((row) => ({
    transactionId: row.transaction_id,
    orderId: row.order_id,
    referenceId: row.reference_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerAccount: row.customer_account,
    direction: row.direction,
    transactionStatus: row.transaction_status,
    amount: toMoney(row.amount_satang),
    feeAmount: toMoney(row.fee_amount_satang),
    settledAmount: toMoney(row.settled_amount_satang),
    heldAmount: toMoney(row.held_amount_satang),
    awaitingManualReview: row.awaiting_manual_review === 1,
    matchDeadline: row.match_deadline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function c2cCallbackPayloadMatches(
  row: CeloxC2CCallbackRow,
  input: CeloxC2CCallbackRequest,
  amountSatang: number,
  signedPayloadHash: string,
) {
  return row.order_id === input.orderId
    && row.reference_id === input.referenceId
    && row.amount_satang === amountSatang
    && row.occurred_at === input.occurredAt
    && row.signed_payload_hash === signedPayloadHash;
}

export function enqueueCeloxC2CCallbackEvent(
  input: CeloxC2CCallbackRequest,
  signedPayloadHash: string,
) {
  if (!/^[0-9a-f]{64}$/.test(signedPayloadHash)) {
    throw new Error("hash ของ signed payload C2C ไม่ถูกต้อง");
  }
  const db = getDatabase();
  const amountSatang = validMoneySatang(input.amount);
  const now = new Date().toISOString();

  const perform = db.transaction(() => {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO celox_c2c_callback_events (
        transaction_id, order_id, reference_id, provider_status, amount_satang,
        occurred_at, provider_event, signed_payload_hash, has_transfer_to,
        processing_state, received_at, last_received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      input.transactionId,
      input.orderId,
      input.referenceId,
      input.status,
      amountSatang,
      input.occurredAt,
      input.event ?? null,
      signedPayloadHash,
      Object.hasOwn(input, "transferTo") ? 1 : 0,
      now,
      now,
    );

    const event = db.prepare(`
      SELECT * FROM celox_c2c_callback_events
      WHERE transaction_id = ? AND provider_status = ?
    `).get(input.transactionId, input.status) as CeloxC2CCallbackRow | undefined;
    if (!event) throw new Error("บันทึก Callback C2C ลง inbox ไม่สำเร็จ");

    if (inserted.changes === 1) {
      return { eventId: event.id, duplicate: false, conflict: false, shouldProcess: true };
    }
    if (!c2cCallbackPayloadMatches(event, input, amountSatang, signedPayloadHash)) {
      return { eventId: event.id, duplicate: true, conflict: true, shouldProcess: false };
    }

    const shouldProcess = ["pending", "failed", "unmatched"].includes(event.processing_state);
    db.prepare(`
      UPDATE celox_c2c_callback_events
      SET received_count = received_count + 1,
          last_received_at = ?,
          processing_state = CASE WHEN processing_state IN ('failed', 'unmatched') THEN 'pending' ELSE processing_state END,
          last_error = CASE WHEN processing_state IN ('failed', 'unmatched') THEN NULL ELSE last_error END,
          processed_at = CASE WHEN processing_state IN ('failed', 'unmatched') THEN NULL ELSE processed_at END
      WHERE id = ?
    `).run(now, event.id);
    return { eventId: event.id, duplicate: true, conflict: false, shouldProcess };
  });

  return perform();
}

function finishCeloxC2CCallback(
  db: SqliteDatabase,
  event: CeloxC2CCallbackRow,
  state: CeloxCallbackProcessingState,
  now: string,
  options: {
    customerId?: string;
    direction?: "deposit" | "withdraw";
    localTransactionId?: string;
    error?: string;
  } = {},
) {
  db.prepare(`
    UPDATE celox_c2c_callback_events
    SET processing_state = ?, customer_id = COALESCE(?, customer_id),
        direction = COALESCE(?, direction),
        local_transaction_id = COALESCE(?, local_transaction_id),
        attempt_count = attempt_count + 1, last_error = ?, processed_at = ?
    WHERE id = ?
  `).run(
    state,
    options.customerId ?? null,
    options.direction ?? null,
    options.localTransactionId ?? null,
    options.error ?? null,
    now,
    event.id,
  );
}

function adoptCeloxC2CWithdrawalReservationFromCallback(
  db: SqliteDatabase,
  event: CeloxC2CCallbackRow,
  now: string,
) {
  if (event.reference_id === null) return undefined;
  const reservation = db.prepare(`
    SELECT * FROM celox_c2c_withdrawal_reservations
    WHERE reference_id = ? AND amount_satang = ?
  `).get(event.reference_id, event.amount_satang) as CeloxC2CWithdrawalReservationRow | undefined;
  if (!reservation) return undefined;

  const localTransactionId = insertPendingC2CTransaction(db, {
    customerId: reservation.customer_id,
    direction: "withdraw",
    amountSatang: event.amount_satang,
    orderId: event.order_id,
    createdAt: reservation.created_at,
  });
  db.prepare(`
    INSERT INTO celox_c2c_transactions (
      transaction_id, order_id, reference_id, customer_id, direction,
      transaction_status, amount_satang, fee_amount_satang,
      settled_amount_satang, held_amount_satang, awaiting_manual_review,
      match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'withdraw', ?, ?, 0, 0, ?, 0, NULL, 1, ?, ?, ?)
  `).run(
    event.transaction_id,
    event.order_id,
    event.reference_id,
    reservation.customer_id,
    event.provider_status,
    event.amount_satang,
    event.amount_satang,
    localTransactionId,
    reservation.created_at,
    now,
  );
  db.prepare("DELETE FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?")
    .run(reservation.reservation_id);
  return db.prepare("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?")
    .get(event.transaction_id) as CeloxC2CRow;
}

function isC2CTerminalStatus(status: string) {
  return status === "SUCCESS" || status === "EXPIRED" || status === "CANCELLED";
}

function isSupportedC2CCallbackStatus(status: string) {
  return isC2CTerminalStatus(status)
    || status === "PENDING_TRANSFER"
    || status === "PENDING_MANUAL_C2C"
    || status === "PENDING_TOPUP_C2C"
    || status === "PENDING_REFUND_C2C"
    || status === "PENDING_REVIEW";
}

export function processCeloxC2CCallbackEvent(eventId: number) {
  const db = getDatabase();
  const now = new Date().toISOString();

  const perform = db.transaction(() => {
    const event = db.prepare("SELECT * FROM celox_c2c_callback_events WHERE id = ?")
      .get(eventId) as CeloxC2CCallbackRow | undefined;
    if (!event) throw new Error("ไม่พบ Callback C2C ที่ต้องประมวลผล");
    if (event.processing_state === "applied" || event.processing_state === "recorded") {
      return event;
    }

    let row = db.prepare("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?")
      .get(event.transaction_id) as CeloxC2CRow | undefined;
    if (!row && isSupportedC2CCallbackStatus(event.provider_status)) {
      row = adoptCeloxC2CWithdrawalReservationFromCallback(db, event, now);
    }

    if (!row) {
      finishCeloxC2CCallback(db, event, "unmatched", now, {
        error: "ยังไม่พบรายการ Celox C2C ที่ผูกกับ Callback นี้",
      });
      return db.prepare("SELECT * FROM celox_c2c_callback_events WHERE id = ?")
        .get(eventId) as CeloxC2CCallbackRow;
    }

    if (
      row.order_id !== event.order_id
      || row.reference_id !== event.reference_id
      || row.amount_satang !== event.amount_satang
    ) {
      finishCeloxC2CCallback(db, event, "failed", now, {
        customerId: row.customer_id,
        direction: row.direction,
        error: "ข้อมูล orderId, referenceId หรือยอดเงินใน Callback C2C ไม่ตรงกับรายการที่ผูกไว้",
      });
      return db.prepare("SELECT * FROM celox_c2c_callback_events WHERE id = ?")
        .get(eventId) as CeloxC2CCallbackRow;
    }

    const linked = {
      customerId: row.customer_id,
      direction: row.direction,
      localTransactionId: row.local_transaction_id,
    };

    if (event.provider_status === "PENDING_TRANSFER") {
      // A delayed matched callback must never regress a row that already moved
      // to slip review or a terminal state.
      if (row.transaction_status === "PENDING" || row.transaction_status === "PENDING_TRANSFER") {
        db.prepare(`
          UPDATE celox_c2c_transactions
          SET transaction_status = 'PENDING_TRANSFER', match_deadline = NULL,
              awaiting_manual_review = 0, updated_at = ?
          WHERE transaction_id = ?
        `).run(now, row.transaction_id);
      }
      finishCeloxC2CCallback(db, event, "recorded", now, linked);
    } else if (event.provider_status === "SUCCESS") {
      if (!event.occurred_at) {
        finishCeloxC2CCallback(db, event, "failed", now, {
          ...linked,
          error: "Callback C2C สถานะ SUCCESS ไม่มี occurredAt",
        });
      } else if (row.transaction_status === "EXPIRED" || row.transaction_status === "CANCELLED") {
        finishCeloxC2CCallback(db, event, "failed", now, {
          ...linked,
          error: `Callback C2C สถานะ SUCCESS ชนกับสถานะปิด ${row.transaction_status}`,
        });
      } else {
        finalizeC2CSuccess(db, { ...row, transaction_status: "SUCCESS" }, now);
        finishCeloxC2CCallback(db, event, "applied", now, linked);
      }
    } else if (event.provider_status === "EXPIRED" || event.provider_status === "CANCELLED") {
      if (row.transaction_status === "SUCCESS") {
        finishCeloxC2CCallback(db, event, "failed", now, {
          ...linked,
          error: `Callback C2C สถานะ ${event.provider_status} ชนกับรายการที่สำเร็จแล้ว`,
        });
      } else if (isC2CTerminalStatus(row.transaction_status) && row.transaction_status !== event.provider_status) {
        finishCeloxC2CCallback(db, event, "failed", now, {
          ...linked,
          error: `Callback C2C สถานะ ${event.provider_status} ชนกับสถานะปิด ${row.transaction_status}`,
        });
      } else {
        db.prepare(`
          UPDATE celox_c2c_transactions
          SET transaction_status = ?, match_deadline = NULL,
              awaiting_manual_review = 0, updated_at = ?
          WHERE transaction_id = ?
        `).run(event.provider_status, now, row.transaction_id);
        finalizeC2CFailure(db, { ...row, transaction_status: event.provider_status }, now);
        finishCeloxC2CCallback(db, event, "applied", now, linked);
      }
    } else if (
      event.provider_status === "PENDING_TOPUP_C2C"
      || event.provider_status === "PENDING_MANUAL_C2C"
      || event.provider_status === "PENDING_REFUND_C2C"
      || event.provider_status === "PENDING_REVIEW"
    ) {
      // The manual says Celox does not emit these intermediate callbacks. If a
      // valid signed event arrives, record the real status without using event.
      if (!isC2CTerminalStatus(row.transaction_status)) {
        db.prepare(`
          UPDATE celox_c2c_transactions
          SET transaction_status = ?, awaiting_manual_review = ?, updated_at = ?
          WHERE transaction_id = ?
        `).run(
          event.provider_status,
          event.provider_status === "PENDING_TOPUP_C2C" ? 0 : 1,
          now,
          row.transaction_id,
        );
      }
      finishCeloxC2CCallback(db, event, "recorded", now, linked);
    } else {
      finishCeloxC2CCallback(db, event, "failed", now, {
        ...linked,
        error: `ยังไม่รองรับสถานะ Callback C2C: ${event.provider_status}`,
      });
    }

    return db.prepare("SELECT * FROM celox_c2c_callback_events WHERE id = ?")
      .get(eventId) as CeloxC2CCallbackRow;
  });

  return perform();
}

export function markCeloxC2CCallbackEventFailed(eventId: number, error: string, attempts = 1) {
  const message = error.trim().slice(0, 500) || "ประมวลผล Callback C2C ไม่สำเร็จ";
  getDatabase().prepare(`
    UPDATE celox_c2c_callback_events
    SET processing_state = 'failed', attempt_count = attempt_count + ?,
        last_error = ?, processed_at = ?
    WHERE id = ? AND processing_state NOT IN ('applied', 'recorded')
  `).run(Math.max(1, attempts), message, new Date().toISOString(), eventId);
}

function callbackPayloadMatches(row: CeloxCallbackRow, input: CeloxCallbackRequest, amountSatang: number) {
  return row.order_id === input.orderId
    && row.reference_id === input.referenceId
    && row.amount_satang === amountSatang
    && row.occurred_at === input.occurredAt;
}

export function enqueueCeloxCallbackEvent(input: CeloxCallbackRequest) {
  const db = getDatabase();
  const amountSatang = validMoneySatang(input.amount);
  const now = new Date().toISOString();

  const perform = db.transaction(() => {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO celox_callback_events (
        transaction_id, order_id, reference_id, provider_status, amount_satang,
        occurred_at, processing_state, received_at, last_received_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      input.transactionId,
      input.orderId,
      input.referenceId,
      input.status,
      amountSatang,
      input.occurredAt,
      now,
      now,
    );

    const event = db.prepare(`
      SELECT * FROM celox_callback_events
      WHERE transaction_id = ? AND provider_status = ?
    `).get(input.transactionId, input.status) as CeloxCallbackRow | undefined;
    if (!event) throw new Error("บันทึก callback ลง inbox ไม่สำเร็จ");

    if (inserted.changes === 1) {
      return { eventId: event.id, duplicate: false, conflict: false, shouldProcess: true };
    }
    if (!callbackPayloadMatches(event, input, amountSatang)) {
      return { eventId: event.id, duplicate: true, conflict: true, shouldProcess: false };
    }

    const shouldProcess = ["pending", "failed", "unmatched"].includes(event.processing_state);
    db.prepare(`
      UPDATE celox_callback_events
      SET received_count = received_count + 1,
          last_received_at = ?,
          processing_state = CASE WHEN processing_state IN ('failed', 'unmatched') THEN 'pending' ELSE processing_state END,
          last_error = CASE WHEN processing_state IN ('failed', 'unmatched') THEN NULL ELSE last_error END,
          processed_at = CASE WHEN processing_state IN ('failed', 'unmatched') THEN NULL ELSE processed_at END
      WHERE id = ?
    `).run(now, event.id);
    return { eventId: event.id, duplicate: true, conflict: false, shouldProcess };
  });

  return perform();
}

export function getCeloxCallbackEvent(eventId: number) {
  const row = getDatabase().prepare(`
    SELECT e.id, e.transaction_id, e.order_id, e.reference_id, e.provider_status,
      e.amount_satang, e.occurred_at,
      COALESCE(e.customer_id, d.customer_id, w.customer_id, r.customer_id) AS customer_id,
      COALESCE(
        e.transaction_kind,
        CASE WHEN d.transaction_id IS NOT NULL THEN 'deposit'
             WHEN w.transaction_id IS NOT NULL OR r.reservation_id IS NOT NULL THEN 'withdraw' END
      ) AS transaction_kind,
      e.processing_state, e.local_transaction_id, e.attempt_count, e.received_count,
      e.last_error, e.received_at, e.last_received_at, e.processed_at
    FROM celox_callback_events e
    LEFT JOIN celox_deposits d ON d.transaction_id = e.transaction_id
    LEFT JOIN celox_withdrawals w ON w.transaction_id = e.transaction_id
    LEFT JOIN celox_withdrawal_reservations r
      ON e.reference_id IS NOT NULL
      AND r.reference_id = e.reference_id
      AND r.amount_satang = e.amount_satang
    WHERE e.id = ?
  `)
    .get(eventId) as CeloxCallbackRow | undefined;
  return row ? mapCeloxCallback(row) : null;
}

function finishCeloxCallbackWithoutCredit(
  db: SqliteDatabase,
  event: CeloxCallbackRow,
  state: "recorded" | "unmatched" | "failed",
  now: string,
  options: {
    customerId?: string;
    direction?: "deposit" | "withdraw";
    error?: string;
  } = {},
) {
  db.prepare(`
    UPDATE celox_callback_events
    SET processing_state = ?, customer_id = COALESCE(?, customer_id),
        transaction_kind = COALESCE(?, transaction_kind),
        attempt_count = attempt_count + 1, last_error = ?, processed_at = ?
    WHERE id = ?
  `).run(
    state,
    options.customerId ?? null,
    options.direction ?? null,
    options.error ?? null,
    now,
    event.id,
  );
}

function adoptCeloxWithdrawalReservationFromCallback(
  db: SqliteDatabase,
  event: CeloxCallbackRow,
  now: string,
) {
  if (event.reference_id === null) return undefined;
  const reservation = db.prepare(`
    SELECT * FROM celox_withdrawal_reservations
    WHERE reference_id = ? AND amount_satang = ?
  `).get(event.reference_id, event.amount_satang) as CeloxWithdrawalReservationRow | undefined;
  if (!reservation) return undefined;

  db.prepare(`
    INSERT INTO celox_withdrawals (
      transaction_id, order_id, reference_id, customer_id, amount_satang,
      destination_bank_code, destination_account_name, destination_account_no,
      transaction_status, confirmation_state, funds_reserved, occurred_at,
      local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 1, NULL, NULL, ?, ?)
  `).run(
    event.transaction_id,
    event.order_id,
    event.reference_id,
    reservation.customer_id,
    event.amount_satang,
    reservation.destination_bank_code,
    reservation.destination_account_name,
    reservation.destination_account_no,
    event.provider_status === "PENDING" ? "ready" : "uncertain",
    reservation.created_at,
    now,
  );
  db.prepare("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?")
    .run(reservation.reservation_id);
  return db.prepare("SELECT * FROM celox_withdrawals WHERE transaction_id = ?")
    .get(event.transaction_id) as CeloxWithdrawalRow;
}

export function processCeloxCallbackEvent(eventId: number) {
  const db = getDatabase();
  const now = new Date().toISOString();

  const perform = db.transaction(() => {
    const event = db.prepare("SELECT * FROM celox_callback_events WHERE id = ?")
      .get(eventId) as CeloxCallbackRow | undefined;
    if (!event) throw new Error("ไม่พบ callback ที่ต้องประมวลผล");
    if (event.processing_state === "applied" || event.processing_state === "recorded") {
      return mapCeloxCallback(event);
    }

    const depositIntent = db.prepare("SELECT * FROM celox_deposits WHERE transaction_id = ?")
      .get(event.transaction_id) as CeloxDepositRow | undefined;
    let withdrawalIntent = db.prepare("SELECT * FROM celox_withdrawals WHERE transaction_id = ?")
      .get(event.transaction_id) as CeloxWithdrawalRow | undefined;
    if (!depositIntent && !withdrawalIntent) {
      withdrawalIntent = adoptCeloxWithdrawalReservationFromCallback(db, event, now);
    }

    if (depositIntent && withdrawalIntent) {
      finishCeloxCallbackWithoutCredit(db, event, "failed", now, {
        error: "transactionId ของ callback ชนกันระหว่างรายการฝากและถอน Celox",
      });
      const failed = db.prepare("SELECT * FROM celox_callback_events WHERE id = ?")
        .get(eventId) as CeloxCallbackRow;
      return mapCeloxCallback(failed);
    }

    if (!depositIntent && !withdrawalIntent) {
      finishCeloxCallbackWithoutCredit(db, event, "unmatched", now, {
        error: "ยังไม่พบรายการ Celox ที่ผูกกับ callback นี้",
      });
      const unmatched = db.prepare("SELECT * FROM celox_callback_events WHERE id = ?")
        .get(eventId) as CeloxCallbackRow;
      return mapCeloxCallback(unmatched);
    }

    const direction = depositIntent ? "deposit" : "withdraw";
    const customerId = depositIntent?.customer_id ?? withdrawalIntent?.customer_id;
    const payloadMatches = depositIntent
      ? depositIntent.order_id === event.order_id
        && depositIntent.reference_id === event.reference_id
        && depositIntent.amount_satang === event.amount_satang
      : withdrawalIntent?.order_id === event.order_id
        && withdrawalIntent.reference_id === event.reference_id
        && withdrawalIntent.amount_satang === event.amount_satang;

    if (!payloadMatches || !customerId) {
      finishCeloxCallbackWithoutCredit(db, event, "failed", now, {
        customerId,
        direction,
        error: `ข้อมูล orderId, referenceId หรือยอดเงินใน callback ไม่ตรงกับรายการ${direction === "deposit" ? "ฝาก" : "ถอน"}`,
      });
      const failed = db.prepare("SELECT * FROM celox_callback_events WHERE id = ?")
        .get(eventId) as CeloxCallbackRow;
      return mapCeloxCallback(failed);
    }

    if (event.provider_status === "SUCCESS") {
      if (!event.occurred_at) {
        finishCeloxCallbackWithoutCredit(db, event, "failed", now, {
          customerId,
          direction,
          error: "callback สถานะ SUCCESS ไม่มี occurredAt",
        });
        const failed = db.prepare("SELECT * FROM celox_callback_events WHERE id = ?")
          .get(eventId) as CeloxCallbackRow;
        return mapCeloxCallback(failed);
      }
      const finalized = depositIntent
        ? finalizeCeloxDepositSuccess(db, depositIntent, {
            transactionId: event.transaction_id,
            orderId: event.order_id,
            amountSatang: event.amount_satang,
            occurredAt: event.occurred_at,
          }, now)
        : finalizeCeloxWithdrawalSuccess(db, withdrawalIntent as CeloxWithdrawalRow, {
            transactionId: event.transaction_id,
            orderId: event.order_id,
            referenceId: event.reference_id,
            amountSatang: event.amount_satang,
            occurredAt: event.occurred_at,
          }, now);
      db.prepare(`
        UPDATE celox_callback_events
        SET processing_state = 'applied', customer_id = ?, transaction_kind = ?,
            local_transaction_id = ?,
            attempt_count = attempt_count + 1, last_error = NULL, processed_at = ?
        WHERE id = ?
      `).run(customerId, direction, finalized.transactionId, now, event.id);
    } else {
      if (depositIntent) {
        if (
          isDepositTransactionStatus(event.provider_status)
          && event.provider_status !== "SUCCESS"
          && depositIntent.transaction_status !== "SUCCESS"
          && canTransitionCeloxDepositStatus(depositIntent.transaction_status, event.provider_status)
        ) {
          db.prepare(`
            UPDATE celox_deposits
            SET transaction_status = ?, updated_at = ?
            WHERE transaction_id = ?
          `).run(event.provider_status, now, event.transaction_id);
          if (event.provider_status === "EXPIRED") {
            db.prepare("DELETE FROM celox_deposit_slip_claims WHERE transaction_id = ?")
              .run(event.transaction_id);
          }
        }
        if (depositIntent.local_transaction_id && isTerminalCeloxFailureStatus(event.provider_status)) {
          // ผลจาก Create/Slip ที่ยังไม่ใช่ SUCCESS จะคง pending; เฉพาะ Callback
          // terminal เท่านั้นที่ปิดรายการเป็น failed และไม่แตะยอดเงินลูกค้า
          db.prepare(`
            UPDATE transactions
            SET status = 'failed'
            WHERE id = ? AND status = 'pending'
          `).run(depositIntent.local_transaction_id);
        }
      }
      finishCeloxCallbackWithoutCredit(db, event, "recorded", now, {
        customerId,
        direction,
      });
    }

    const processed = db.prepare("SELECT * FROM celox_callback_events WHERE id = ?")
      .get(eventId) as CeloxCallbackRow;
    return mapCeloxCallback(processed);
  });

  return perform();
}

export function markCeloxCallbackEventFailed(eventId: number, error: string, attempts = 1) {
  const message = error.trim().slice(0, 500) || "ประมวลผล callback ไม่สำเร็จ";
  getDatabase().prepare(`
    UPDATE celox_callback_events
    SET processing_state = 'failed', attempt_count = attempt_count + ?,
        last_error = ?, processed_at = ?
    WHERE id = ? AND processing_state NOT IN ('applied', 'recorded')
  `).run(Math.max(1, attempts), message, new Date().toISOString(), eventId);
}

export function listCustomerCeloxCallbacks(customerId: string, limit = 10) {
  const db = getDatabase();
  if (!customerExists(customerId)) throw new Error("ไม่พบข้อมูลลูกค้า");
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
  const rows = db.prepare(`
    SELECT e.id, e.transaction_id, e.order_id, e.reference_id, e.provider_status,
      e.amount_satang, e.occurred_at,
      COALESCE(e.customer_id, d.customer_id, w.customer_id, r.customer_id) AS customer_id,
      COALESCE(
        e.transaction_kind,
        CASE WHEN d.transaction_id IS NOT NULL THEN 'deposit'
             WHEN w.transaction_id IS NOT NULL OR r.reservation_id IS NOT NULL THEN 'withdraw' END
      ) AS transaction_kind,
      e.processing_state, e.local_transaction_id, e.attempt_count, e.received_count,
      e.last_error, e.received_at, e.last_received_at, e.processed_at
    FROM celox_callback_events e
    LEFT JOIN celox_deposits d ON d.transaction_id = e.transaction_id
    LEFT JOIN celox_withdrawals w ON w.transaction_id = e.transaction_id
    LEFT JOIN celox_withdrawal_reservations r
      ON e.reference_id IS NOT NULL
      AND r.reference_id = e.reference_id
      AND r.amount_satang = e.amount_satang
    WHERE COALESCE(e.customer_id, d.customer_id, w.customer_id, r.customer_id) = ?
    ORDER BY e.received_at DESC, e.id DESC
    LIMIT ?
  `).all(customerId, safeLimit) as CeloxCallbackRow[];
  return rows.map(mapCeloxCallback);
}

const STALE_CELOX_OPERATION_MS = 5 * 60 * 1_000;

function isStaleCeloxOperation(updatedAt: string) {
  const updatedTime = Date.parse(updatedAt);
  return Number.isFinite(updatedTime)
    && Date.now() - updatedTime >= STALE_CELOX_OPERATION_MS;
}

export function listCustomerCeloxWithdrawalHolds(customerId: string) {
  const db = getDatabase();
  const reservations = db.prepare(`
    SELECT reservation_id, reference_id, amount_satang, reservation_state, updated_at
    FROM celox_withdrawal_reservations
    WHERE customer_id = ?
    ORDER BY updated_at DESC
  `).all(customerId) as Array<Pick<
    CeloxWithdrawalReservationRow,
    "reservation_id" | "reference_id" | "amount_satang" | "reservation_state" | "updated_at"
  >>;
  const confirmations = db.prepare(`
    SELECT transaction_id, order_id, reference_id, amount_satang, confirmation_state, updated_at
    FROM celox_withdrawals
    WHERE customer_id = ? AND transaction_status = 'PENDING' AND funds_reserved = 1
    ORDER BY updated_at DESC
  `).all(customerId) as Array<Pick<
    CeloxWithdrawalRow,
    "transaction_id" | "order_id" | "reference_id" | "amount_satang" | "confirmation_state" | "updated_at"
  >>;

  const holds: CeloxWithdrawalHold[] = [
    ...reservations.map((row) => ({
      key: row.reservation_id,
      kind: "creation" as const,
      orderId: null,
      referenceId: row.reference_id,
      amount: toMoney(row.amount_satang),
      state: row.reservation_state,
      updatedAt: row.updated_at,
      canResolve: row.reservation_state === "uncertain" || isStaleCeloxOperation(row.updated_at),
    })),
    ...confirmations.map((row) => {
      // A PENDING withdrawal cannot legitimately have confirmation_state=success.
      // Treat legacy/inconsistent data as ready rather than exposing an impossible UI state.
      const state: CeloxWithdrawalHold["state"] = row.confirmation_state === "success"
        ? "ready"
        : row.confirmation_state;
      return {
        key: row.transaction_id,
        kind: "confirmation" as const,
        orderId: row.order_id,
        referenceId: row.reference_id,
        amount: toMoney(row.amount_satang),
        state,
        updatedAt: row.updated_at,
        canResolve: state === "uncertain"
          || (state === "confirming" && isStaleCeloxOperation(row.updated_at)),
      };
    }),
  ];
  return holds.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function resolveCeloxWithdrawalHold(input: {
  customerId: string;
  key: string;
  action: "release-reservation" | "reset-confirmation";
}) {
  const db = getDatabase();
  const perform = db.transaction(() => {
    if (input.action === "release-reservation") {
      const reservation = db.prepare(`
        SELECT * FROM celox_withdrawal_reservations
        WHERE reservation_id = ? AND customer_id = ?
      `).get(input.key, input.customerId) as CeloxWithdrawalReservationRow | undefined;
      if (!reservation) throw new Error("ไม่พบยอดจอง Create ของลูกค้ารายนี้");
      const canRelease = reservation.reservation_state === "uncertain"
        || isStaleCeloxOperation(reservation.updated_at);
      if (!canRelease) throw new Error("รายการ Create ยังไม่พ้นช่วงประมวลผล ห้ามปลดยอดจองตอนนี้");
      const released = db.prepare(`
        UPDATE customers
        SET withdrawable_satang = withdrawable_satang + ?
        WHERE id = ? AND withdrawable_satang + ? <= balance_satang
      `).run(
        reservation.amount_satang,
        reservation.customer_id,
        reservation.amount_satang,
      );
      if (released.changes !== 1) throw new Error("คืนยอดจอง Create ไม่สำเร็จ");
      db.prepare("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?")
        .run(reservation.reservation_id);
      return;
    }

    const intent = db.prepare(`
      SELECT * FROM celox_withdrawals
      WHERE transaction_id = ? AND customer_id = ?
    `).get(input.key, input.customerId) as CeloxWithdrawalRow | undefined;
    if (!intent || intent.transaction_status !== "PENDING" || intent.funds_reserved !== 1) {
      throw new Error("ไม่พบรายการ Confirm ที่ยังกันยอดไว้ของลูกค้ารายนี้");
    }
    const canReset = intent.confirmation_state === "uncertain"
      || (intent.confirmation_state === "confirming" && isStaleCeloxOperation(intent.updated_at));
    if (!canReset) throw new Error("รายการ Confirm ยังไม่พร้อมให้ปลด claim");
    db.prepare(`
      UPDATE celox_withdrawals
      SET confirmation_state = 'ready', updated_at = ?
      WHERE transaction_id = ?
    `).run(new Date().toISOString(), intent.transaction_id);
  });
  perform();
}

export function queueCeloxCallbackRetry(eventId: number, customerId: string) {
  const db = getDatabase();
  const perform = db.transaction(() => {
    const event = db.prepare(`
      SELECT e.*, COALESCE(e.customer_id, d.customer_id, w.customer_id, r.customer_id) AS linked_customer_id
      FROM celox_callback_events e
      LEFT JOIN celox_deposits d ON d.transaction_id = e.transaction_id
      LEFT JOIN celox_withdrawals w ON w.transaction_id = e.transaction_id
      LEFT JOIN celox_withdrawal_reservations r
        ON e.reference_id IS NOT NULL
        AND r.reference_id = e.reference_id
        AND r.amount_satang = e.amount_satang
      WHERE e.id = ?
    `).get(eventId) as (CeloxCallbackRow & { linked_customer_id: string | null }) | undefined;
    if (!event || event.linked_customer_id !== customerId) {
      throw new Error("ไม่พบ callback ของลูกค้ารายนี้");
    }
    if (event.processing_state === "applied" || event.processing_state === "recorded") return;
    db.prepare(`
      UPDATE celox_callback_events
      SET processing_state = 'pending', last_error = NULL, processed_at = NULL
      WHERE id = ?
    `).run(eventId);
  });
  perform();
}

export function createTransaction(input: CreateTransactionInput) {
  const db = getDatabase();
  const amountSatang = toSatang(input.amount);
  if (!Number.isFinite(input.amount) || amountSatang <= 0) throw new Error("จำนวนเงินต้องมากกว่า 0 บาท");

  const selected = db.prepare("SELECT * FROM customers WHERE id = ?").get(input.customerId) as CustomerRow | undefined;
  if (!selected) throw new Error("ไม่พบข้อมูลลูกค้าที่เลือก");

  const [direction, channel] = input.kind.split("_") as [TransactionDirection, TransactionChannel];
  const now = new Date().toISOString();
  const ids: string[] = [];

  const perform = db.transaction(() => {
    if (channel === "account") {
      if (direction === "withdraw" && selected.withdrawable_satang < amountSatang) throw new Error("ยอดเงินที่ถอนได้ไม่เพียงพอ");
      const delta = direction === "deposit" ? amountSatang : -amountSatang;
      db.prepare("UPDATE customers SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ? WHERE id = ?").run(delta, delta, selected.id);
      const id = createId("TXN");
      db.prepare(`
        INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
        VALUES (?, ?, ?, 'account', ?, ?, 'success', ?)
      `).run(id, selected.id, direction, amountSatang, input.note?.trim() || (direction === "deposit" ? "ฝากเข้าบัญชี" : "ถอนจากบัญชี"), now);
      ids.push(id);
      return;
    }

    if (!input.counterpartyCustomerId) throw new Error("กรุณาเลือกลูกค้าคู่รายการ C2C");
    if (input.counterpartyCustomerId === selected.id) throw new Error("บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน");
    const counterparty = db.prepare("SELECT * FROM customers WHERE id = ?").get(input.counterpartyCustomerId) as CustomerRow | undefined;
    if (!counterparty) throw new Error("ไม่พบลูกค้าคู่รายการ C2C");

    const source = direction === "deposit" ? counterparty : selected;
    const target = direction === "deposit" ? selected : counterparty;
    if (source.withdrawable_satang < amountSatang) throw new Error(`ยอดเงินที่ถอนได้ของ ${source.name} ไม่เพียงพอ`);

    db.prepare("UPDATE customers SET balance_satang = balance_satang - ?, withdrawable_satang = withdrawable_satang - ? WHERE id = ?").run(amountSatang, amountSatang, source.id);
    db.prepare("UPDATE customers SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ? WHERE id = ?").run(amountSatang, amountSatang, target.id);

    const groupId = createId("C2C");
    const sourceId = createId("TXN");
    const targetId = createId("TXN");
    const note = input.note?.trim() || `โอน C2C จาก ${source.name} ไป ${target.name}`;
    const insert = db.prepare(`
      INSERT INTO transactions (id, customer_id, counterparty_customer_id, direction, channel, amount_satang, note, status, transfer_group_id, created_at)
      VALUES (?, ?, ?, ?, 'c2c', ?, ?, 'success', ?, ?)
    `);
    insert.run(sourceId, source.id, target.id, "withdraw", amountSatang, note, groupId, now);
    insert.run(targetId, target.id, source.id, "deposit", amountSatang, note, groupId, now);
    ids.push(sourceId, targetId);
  });

  perform();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`${transactionSelect} WHERE t.id IN (${placeholders}) ORDER BY t.direction DESC`).all(...ids) as TransactionRow[];
  return { transactions: rows.map(mapTransaction), summary: getSummary(db) };
}
