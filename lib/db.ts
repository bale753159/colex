import { db, tx, type Queryable, type Tx } from "./sql";
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
  funds_reserved: boolean;
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
  awaiting_manual_review: boolean;
  match_deadline: string | null;
  funds_reserved: boolean;
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
  has_transfer_to: boolean;
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

// รูปแบบวันที่ที่ Postgres ยอมรับก่อนแคสต์ `?::date` เท่านั้น — ตรวจแค่รูปร่างสตริง
// ไม่ตรวจว่าเป็นวันที่จริงหรือไม่ (เช่น "2026-13-45" ผ่านรูปร่างนี้แต่แคสต์ไม่ผ่าน)
const DATE_ONLY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function dateClause(from?: string, to?: string, column = "t.created_at") {
  const clauses: string[] = [];
  const values: string[] = [];
  if (from) {
    if (DATE_ONLY_SHAPE.test(from)) {
      clauses.push(`(${column} AT TIME ZONE 'Asia/Bangkok')::date >= ?::date`);
      values.push(from);
    } else {
      // ใต้ SQLite เดิม date('ค่าที่ผิดรูปแบบ') คืน NULL ทำให้เงื่อนไขเป็นเท็จและได้ผลลัพธ์
      // ว่างเปล่า ใต้ Postgres '...'::date ที่ผิดรูปแบบจะ throw SQLSTATE 22007 แทน คงพฤติกรรม
      // เดิมไว้ด้วยเงื่อนไขเท็จเสมอ แทนที่จะปล่อยให้ query พัง
      clauses.push("false");
    }
  }
  if (to) {
    if (DATE_ONLY_SHAPE.test(to)) {
      clauses.push(`(${column} AT TIME ZONE 'Asia/Bangkok')::date <= ?::date`);
      values.push(to);
    } else {
      clauses.push("false");
    }
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

async function getSummary(t: Queryable, from?: string, to?: string): Promise<FinanceSummary> {
  const period = dateClause(from, to, "created_at");
  const transactionTotals = await t.first(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'success' AND direction = 'deposit' THEN amount_satang ELSE 0 END), 0)::bigint AS deposit_satang,
      COALESCE(SUM(CASE WHEN status = 'success' AND direction = 'withdraw' THEN amount_satang ELSE 0 END), 0)::bigint AS withdraw_satang,
      COUNT(*)::bigint AS transaction_count
    FROM transactions
    WHERE 1 = 1${period.sql}
  `, period.values) as { deposit_satang: number; withdraw_satang: number; transaction_count: number };
  const customerTotals = await t.first(`
    SELECT COALESCE(SUM(balance_satang), 0)::bigint AS balance_satang,
      COALESCE(SUM(withdrawable_satang), 0)::bigint AS withdrawable_satang,
      COUNT(*)::bigint AS customer_count
    FROM customers
  `) as { balance_satang: number; withdrawable_satang: number; customer_count: number };
  return {
    depositTotal: toMoney(transactionTotals.deposit_satang),
    withdrawTotal: toMoney(transactionTotals.withdraw_satang),
    balanceTotal: toMoney(customerTotals.balance_satang),
    withdrawableTotal: toMoney(customerTotals.withdrawable_satang),
    customerCount: customerTotals.customer_count,
    transactionCount: transactionTotals.transaction_count,
  };
}

/**
 * ช่องค้นหาทุกช่องในไฟล์นี้ใช้ `ILIKE` ไม่ใช่ `LIKE`
 *
 * `LIKE` ของ SQLite ไม่สนตัวพิมพ์เล็กใหญ่สำหรับ ASCII อยู่แล้วโดยค่าเริ่มต้น เจ้าหน้าที่จึงพิมพ์
 * `acc-90241` แล้วเจอ `ACC-90241` ได้ ส่วน `LIKE` ของ Postgres สนตัวพิมพ์ ถ้าแปลงตรงตัว
 * การค้นหาเลขบัญชี เบอร์โทร อีเมล และรหัสรายการ (ASCII ทั้งหมด) จะพังทันที `ILIKE` จึงตรงกับ
 * พฤติกรรมเดิมมากกว่า
 *
 * ข้อต่างที่ยังเหลือ (พิจารณาแล้วและยอมรับ): SQLite พับตัวพิมพ์เฉพาะ ASCII แต่ `ILIKE` พับตาม
 * locale ของฐานข้อมูลซึ่งครอบ Unicode ทั้งหมด ข้อมูลที่ค้นในโปรเจกต์นี้เป็น ASCII หรือภาษาไทย
 * (ไทยไม่มีตัวพิมพ์เล็กใหญ่) ช่องว่างนี้จึงไม่ส่งผลกับข้อมูลชุดนี้
 */
export async function listCustomers(options: { search?: string; from?: string; to?: string } = {}) {
  const period = dateClause(options.from, options.to);
  const search = `%${options.search?.trim() ?? ""}%`;
  const rows = await db.query(`
    SELECT c.*,
      COALESCE(SUM(CASE WHEN t.direction = 'deposit' THEN t.amount_satang ELSE 0 END), 0)::bigint AS deposit_satang,
      COALESCE(SUM(CASE WHEN t.direction = 'withdraw' THEN t.amount_satang ELSE 0 END), 0)::bigint AS withdraw_satang,
      COALESCE(SUM(CASE WHEN t.direction = 'deposit' AND t.channel = 'c2c' THEN t.amount_satang ELSE 0 END), 0)::bigint AS c2c_deposit_satang,
      COALESCE(SUM(CASE WHEN t.direction = 'withdraw' AND t.channel = 'c2c' THEN t.amount_satang ELSE 0 END), 0)::bigint AS c2c_withdraw_satang,
      (SELECT MAX(all_t.created_at) FROM transactions all_t WHERE all_t.customer_id = c.id) AS last_activity
    FROM customers c
    LEFT JOIN transactions t ON t.customer_id = c.id AND t.status = 'success'${period.sql}
    WHERE c.name ILIKE ? OR c.account ILIKE ? OR c.phone ILIKE ?
    GROUP BY c.id
    ORDER BY last_activity DESC NULLS LAST, c.created_at DESC
  `, [...period.values, search, search, search]) as Array<CustomerRow & {
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
  const allCustomerRows = await db.query<CustomerRow>("SELECT * FROM customers ORDER BY name");
  return { customers, allCustomers: allCustomerRows.map(mapCustomer), summary: await getSummary(db, options.from, options.to) };
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

export async function listTransactions(options: { search?: string; direction?: TransactionDirection; limit?: number } = {}) {
  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (options.search?.trim()) {
    // ILIKE ไม่ใช่ LIKE — เหตุผลอยู่ที่คอมเมนต์เหนือ listCustomers
    conditions.push("(c.name ILIKE ? OR c.account ILIKE ? OR t.id ILIKE ?)");
    const search = `%${options.search.trim()}%`;
    values.push(search, search, search);
  }
  if (options.direction) {
    conditions.push("t.direction = ?");
    values.push(options.direction);
  }
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  values.push(limit);
  const rows = await db.query<TransactionRow>(`${transactionSelect}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY t.created_at DESC LIMIT ?`, values);
  const customerRows = await db.query<CustomerRow>("SELECT * FROM customers ORDER BY name");
  return {
    transactions: rows.map(mapTransaction),
    customers: customerRows.map(mapCustomer),
    summary: await getSummary(db),
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

async function insertPendingCeloxDepositTransaction(
  t: Tx,
  input: { customerId: string; orderId: string; amountSatang: number; createdAt: string },
) {
  const localTransactionId = createId("TXN");
  await t.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
    VALUES (?, ?, 'deposit', 'account', ?, ?, 'pending', ?)
  `, [
    localTransactionId,
    input.customerId,
    input.amountSatang,
    `ฝากผ่าน Celox · ${input.orderId}`,
    input.createdAt,
  ]);
  return localTransactionId;
}

async function getMatchingCeloxDepositTransaction(
  t: Tx,
  localTransactionId: string,
  input: { customerId: string; amountSatang: number },
) {
  const transaction = await t.first<CeloxDepositTransactionRow>(`
    SELECT customer_id, direction, channel, amount_satang, status
    FROM transactions
    WHERE id = ?
  `, [localTransactionId]);
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

export async function customerExists(customerId: string) {
  const row = await db.first<{ found: 1 }>("SELECT 1 AS found FROM customers WHERE id = ?", [customerId]);
  return Boolean(row);
}

export async function recordCeloxDepositIntent(input: {
  customerId: string;
  deposit: CreateDepositResponse;
}) {
  const amountSatang = validMoneySatang(input.deposit.amount);
  const now = new Date().toISOString();

  return await tx(async (t) => {
    const customer = await t.first<{ found: 1 }>("SELECT 1 AS found FROM customers WHERE id = ?", [input.customerId]);
    if (!customer) throw new Error("ไม่พบข้อมูลลูกค้าที่เลือกรับยอดฝาก Celox");

    const existing = await t.first<CeloxDepositRow>("SELECT * FROM celox_deposits WHERE transaction_id = ?",
      [input.deposit.transactionId]);
    if (existing) {
      assertMatchingCeloxIntent(existing, input);
      if (existing.local_transaction_id) {
        await getMatchingCeloxDepositTransaction(t, existing.local_transaction_id, {
          customerId: existing.customer_id,
          amountSatang: existing.amount_satang,
        });
        return;
      }
      const localTransactionId = await insertPendingCeloxDepositTransaction(t, {
        customerId: existing.customer_id,
        orderId: existing.order_id,
        amountSatang: existing.amount_satang,
        createdAt: existing.created_at,
      });
      await t.run(`
        UPDATE celox_deposits
        SET local_transaction_id = ?, updated_at = ?
        WHERE transaction_id = ?
      `, [localTransactionId, now, existing.transaction_id]);
      return;
    }

    const localTransactionId = await insertPendingCeloxDepositTransaction(t, {
      customerId: input.customerId,
      orderId: input.deposit.orderId,
      amountSatang,
      createdAt: now,
    });
    await t.run(`
      INSERT INTO celox_deposits (
        transaction_id, order_id, reference_id, customer_id, amount_satang,
        transaction_status, local_transaction_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING_TRANSFER', ?, ?, ?)
    `, [
      input.deposit.transactionId,
      input.deposit.orderId,
      input.deposit.referenceId,
      input.customerId,
      amountSatang,
      localTransactionId,
      now,
      now,
    ]);
  });
}

export async function getCeloxDepositIntent(transactionId: string) {
  const row = await db.first<CeloxDepositRow>("SELECT * FROM celox_deposits WHERE transaction_id = ?",
    [transactionId]);
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

export async function claimCeloxDepositSlipSubmission(transactionId: string) {
  const result = await db.run(`
    INSERT INTO celox_deposit_slip_claims (transaction_id, claimed_at)
    SELECT transaction_id, ?::timestamptz
    FROM celox_deposits
    WHERE transaction_id = ? AND transaction_status = 'PENDING_TRANSFER'
    ON CONFLICT DO NOTHING
  `, [new Date().toISOString(), transactionId]);
  return result.rowCount === 1;
}

export async function releaseCeloxDepositSlipSubmission(transactionId: string) {
  await db.run("DELETE FROM celox_deposit_slip_claims WHERE transaction_id = ?",
    [transactionId]);
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

async function finalizeCeloxDepositSuccess(
  t: Tx,
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
    ?? await insertPendingCeloxDepositTransaction(t, {
      customerId: intent.customer_id,
      orderId: intent.order_id,
      amountSatang: intent.amount_satang,
      createdAt: intent.created_at,
    });
  const existing = await getMatchingCeloxDepositTransaction(t, localTransactionId, {
    customerId: intent.customer_id,
    amountSatang: input.amountSatang,
  });

  if (existing.status === "success") {
    await t.run(`
      UPDATE celox_deposits
      SET transaction_status = 'SUCCESS', local_transaction_id = ?, updated_at = ?
      WHERE transaction_id = ?
    `, [localTransactionId, now, input.transactionId]);
    await t.run("DELETE FROM celox_deposit_slip_claims WHERE transaction_id = ?",
      [input.transactionId]);
    return { created: false, transactionId: localTransactionId };
  }

  const balanceUpdate = await t.run(`
    UPDATE customers
    SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ?
    WHERE id = ?
  `, [input.amountSatang, input.amountSatang, intent.customer_id]);
  if (balanceUpdate.rowCount !== 1) throw new Error("ไม่พบลูกค้าที่ต้องรับยอดฝาก Celox");
  const transactionUpdate = await t.run(`
    UPDATE transactions
    SET status = 'success'
    WHERE id = ? AND status <> 'success'
  `, [localTransactionId]);
  if (transactionUpdate.rowCount !== 1) throw new Error("อัปเดตสถานะ transaction ของรายการฝาก Celox ไม่สำเร็จ");
  await t.run(`
    UPDATE celox_deposits
    SET transaction_status = 'SUCCESS', local_transaction_id = ?, updated_at = ?
    WHERE transaction_id = ?
  `, [localTransactionId, now, input.transactionId]);
  await t.run("DELETE FROM celox_deposit_slip_claims WHERE transaction_id = ?",
    [input.transactionId]);
  return { created: true, transactionId: localTransactionId };
}

export async function recordCeloxDepositResult(result: DepositSlipResponse) {
  const amountSatang = validMoneySatang(result.amount);
  const now = new Date().toISOString();

  return await tx(async (t) => {
    const intent = await t.first<CeloxDepositRow>("SELECT * FROM celox_deposits WHERE transaction_id = ?",
      [result.transactionId]);
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
      await t.run(`
        UPDATE celox_deposits
        SET transaction_status = ?, updated_at = ?
        WHERE transaction_id = ?
      `, [result.transactionStatus, now, result.transactionId]);
      return { created: false, transactionId: intent.local_transaction_id };
    }

    if (!result.occurredAt || result.slipVerification.outcome !== "match") {
      throw new Error("Celox ระบุ SUCCESS แต่ผลตรวจสลิปหรือเวลาสำเร็จไม่ครบถ้วน");
    }
    return await finalizeCeloxDepositSuccess(t, intent, {
      transactionId: result.transactionId,
      orderId: result.orderId,
      amountSatang,
      occurredAt: result.occurredAt,
    }, now);
  });
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

export async function reserveCeloxWithdrawalFunds(input: {
  customerId: string;
  request: CreateWithdrawalRequest;
}) {
  const amountSatang = validMoneySatang(input.request.amount);
  const reservationId = createId("WDR");
  const now = new Date().toISOString();

  await tx(async (t) => {
    await t.run(`
      INSERT INTO celox_withdrawal_reservations (
        reservation_id, customer_id, amount_satang, reference_id,
        destination_bank_code, destination_account_name, destination_account_no,
        reservation_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?)
    `, [
      reservationId,
      input.customerId,
      amountSatang,
      input.request.referenceId ?? null,
      input.request.destinationBankCode,
      input.request.destinationAccountName,
      input.request.destinationAccountNo,
      now,
      now,
    ]);
    const reserved = await t.run(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang - ?
      WHERE id = ? AND withdrawable_satang >= ?
    `, [amountSatang, input.customerId, amountSatang]);
    if (reserved.rowCount !== 1) {
      throw new Error("ยอดเงินที่ถอนได้ไม่เพียงพอสำหรับกันยอดรายการถอน Celox");
    }
  });

  return reservationId;
}

export async function markCeloxWithdrawalReservationUncertain(reservationId: string) {
  await db.run(`
    UPDATE celox_withdrawal_reservations
    SET reservation_state = 'uncertain', updated_at = ?
    WHERE reservation_id = ?
  `, [new Date().toISOString(), reservationId]);
}

export async function releaseCeloxWithdrawalReservation(reservationId: string) {
  return await tx(async (t) => {
    const reservation = await t.first<CeloxWithdrawalReservationRow>(`
      SELECT * FROM celox_withdrawal_reservations WHERE reservation_id = ?
    `, [reservationId]);
    if (!reservation) return;
    const released = await t.run(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang + ?
      WHERE id = ? AND withdrawable_satang + ? <= balance_satang
    `, [
      reservation.amount_satang,
      reservation.customer_id,
      reservation.amount_satang,
    ]);
    if (released.rowCount !== 1) {
      throw new Error("คืนยอดที่กันไว้สำหรับรายการถอน Celox ไม่สำเร็จ");
    }
    await t.run("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?",
      [reservationId]);
  });
}

export async function recordCeloxWithdrawalIntent(input: {
  reservationId: string;
  customerId: string;
  request: CreateWithdrawalRequest;
  withdrawal: CreateWithdrawalResponse;
}) {
  const amountSatang = validMoneySatang(input.request.amount);
  const now = new Date().toISOString();

  return await tx(async (t) => {
    if (
      input.withdrawal.amount !== input.request.amount
      || input.withdrawal.referenceId !== (input.request.referenceId ?? null)
      || input.withdrawal.transactionStatus !== "PENDING"
    ) {
      throw new Error("ผลสร้างรายการถอนจาก Celox ไม่ตรงกับคำขอ");
    }

    const existing = await t.first<CeloxWithdrawalRow>("SELECT * FROM celox_withdrawals WHERE transaction_id = ?",
      [input.withdrawal.transactionId]);
    if (existing) {
      assertMatchingCeloxWithdrawalIntent(existing, input);
      const duplicateReservation = await t.first<CeloxWithdrawalReservationRow>(`
        SELECT * FROM celox_withdrawal_reservations WHERE reservation_id = ?
      `, [input.reservationId]);
      if (duplicateReservation) {
        const released = await t.run(`
          UPDATE customers
          SET withdrawable_satang = withdrawable_satang + ?
          WHERE id = ? AND withdrawable_satang + ? <= balance_satang
        `, [amountSatang, input.customerId, amountSatang]);
        if (released.rowCount !== 1) throw new Error("คืนยอดจองซ้ำของรายการถอน Celox ไม่สำเร็จ");
        await t.run("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?",
          [input.reservationId]);
      }
      return;
    }

    const reservation = await t.first<CeloxWithdrawalReservationRow>(`
      SELECT * FROM celox_withdrawal_reservations WHERE reservation_id = ?
    `, [input.reservationId]);
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

    await t.run(`
      INSERT INTO celox_withdrawals (
        transaction_id, order_id, reference_id, customer_id, amount_satang,
        destination_bank_code, destination_account_name, destination_account_no,
        transaction_status, confirmation_state, funds_reserved, occurred_at,
        local_transaction_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'ready', true, NULL, NULL, ?, ?)
    `, [
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
    ]);
    await t.run("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?",
      [input.reservationId]);
  });
}

export async function getCeloxWithdrawalIntent(transactionId: string) {
  const row = await db.first<CeloxWithdrawalRow>("SELECT * FROM celox_withdrawals WHERE transaction_id = ?",
    [transactionId]);
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
    fundsReserved: row.funds_reserved,
    localTransactionId: row.local_transaction_id,
    request,
  };
}

export async function claimCeloxWithdrawalConfirmation(transactionId: string) {
  return await tx(async (t) => {
    const intent = await t.first<CeloxWithdrawalRow>("SELECT * FROM celox_withdrawals WHERE transaction_id = ?",
      [transactionId]);
    if (
      !intent
      || intent.transaction_status !== "PENDING"
      || intent.confirmation_state !== "ready"
    ) {
      return "busy" as const;
    }
    if (!intent.funds_reserved) {
      const reserved = await t.run(`
        UPDATE customers
        SET withdrawable_satang = withdrawable_satang - ?
        WHERE id = ? AND withdrawable_satang >= ?
      `, [intent.amount_satang, intent.customer_id, intent.amount_satang]);
      if (reserved.rowCount !== 1) return "insufficient" as const;
    }
    await t.run(`
      UPDATE celox_withdrawals
      SET confirmation_state = 'confirming', funds_reserved = true, updated_at = ?
      WHERE transaction_id = ?
    `, [new Date().toISOString(), transactionId]);
    return "claimed" as const;
  });
}

export async function releaseCeloxWithdrawalConfirmationClaim(transactionId: string) {
  await db.run(`
    UPDATE celox_withdrawals
    SET confirmation_state = 'ready', updated_at = ?
    WHERE transaction_id = ?
      AND transaction_status = 'PENDING'
      AND confirmation_state = 'confirming'
  `, [new Date().toISOString(), transactionId]);
}

export async function markCeloxWithdrawalConfirmationUncertain(transactionId: string) {
  await db.run(`
    UPDATE celox_withdrawals
    SET confirmation_state = 'uncertain', updated_at = ?
    WHERE transaction_id = ? AND transaction_status = 'PENDING'
  `, [new Date().toISOString(), transactionId]);
}

async function finalizeCeloxWithdrawalSuccess(
  t: Tx,
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
    if (intent.funds_reserved) {
      throw new Error("รายการถอน Celox มี transaction แล้วแต่ยอดจองยังไม่ถูกใช้");
    }
    const existing = await t.first<{
      customer_id: string;
      direction: TransactionDirection;
      channel: TransactionChannel;
      amount_satang: number;
    }>(`
      SELECT customer_id, direction, channel, amount_satang
      FROM transactions
      WHERE id = ?
    `, [intent.local_transaction_id]);
    if (
      !existing
      || existing.customer_id !== intent.customer_id
      || existing.direction !== "withdraw"
      || existing.channel !== "account"
      || existing.amount_satang !== input.amountSatang
    ) {
      throw new Error("รายการถอน Celox ชนกับ transaction ที่มีข้อมูลต่างกัน");
    }
    await t.run(`
      UPDATE celox_withdrawals
      SET transaction_status = 'SUCCESS', confirmation_state = 'success', funds_reserved = false,
          occurred_at = COALESCE(occurred_at, ?), updated_at = ?
      WHERE transaction_id = ?
    `, [input.occurredAt, now, input.transactionId]);
    return { created: false, transactionId: intent.local_transaction_id };
  }
  if (intent.transaction_status === "SUCCESS") {
    throw new Error("รายการถอน Celox สำเร็จแต่ไม่มี local transaction");
  }

  const balanceUpdate = intent.funds_reserved
    ? await t.run(`
        UPDATE customers
        SET balance_satang = balance_satang - ?
        WHERE id = ? AND balance_satang >= ?
          AND balance_satang - ? >= withdrawable_satang
      `, [
        input.amountSatang,
        intent.customer_id,
        input.amountSatang,
        input.amountSatang,
      ])
    : await t.run(`
        UPDATE customers
        SET balance_satang = balance_satang - ?, withdrawable_satang = withdrawable_satang - ?
        WHERE id = ? AND balance_satang >= ? AND withdrawable_satang >= ?
      `, [
        input.amountSatang,
        input.amountSatang,
        intent.customer_id,
        input.amountSatang,
        input.amountSatang,
      ]);
  if (balanceUpdate.rowCount !== 1) {
    throw new Error("ยอดเงินลูกค้าไม่เพียงพอสำหรับบันทึกรายการถอน Celox ที่สำเร็จแล้ว");
  }

  const localTransactionId = createId("TXN");
  await t.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
    VALUES (?, ?, 'withdraw', 'account', ?, ?, 'success', ?)
  `, [
    localTransactionId,
    intent.customer_id,
    input.amountSatang,
    `ถอนผ่าน Celox · ${input.orderId}`,
    input.occurredAt,
  ]);
  await t.run(`
    UPDATE celox_withdrawals
    SET transaction_status = 'SUCCESS', confirmation_state = 'success', funds_reserved = false,
        occurred_at = ?, local_transaction_id = ?, updated_at = ?
    WHERE transaction_id = ?
  `, [input.occurredAt, localTransactionId, now, input.transactionId]);
  return { created: true, transactionId: localTransactionId };
}

export async function recordCeloxWithdrawalResult(result: ConfirmWithdrawalResponse) {
  const amountSatang = validMoneySatang(result.amount);
  const now = new Date().toISOString();
  return await tx(async (t) => {
    const intent = await t.first<CeloxWithdrawalRow>("SELECT * FROM celox_withdrawals WHERE transaction_id = ?",
      [result.transactionId]);
    if (!intent) throw new Error("ไม่พบรายการถอน Celox ที่ผูกกับลูกค้าในระบบ");
    return await finalizeCeloxWithdrawalSuccess(t, intent, {
      transactionId: result.transactionId,
      orderId: result.orderId,
      amountSatang,
      occurredAt: result.occurredAt ?? now,
    }, now);
  });
}

async function insertPendingC2CTransaction(
  t: Tx,
  input: {
    customerId: string;
    direction: "deposit" | "withdraw";
    amountSatang: number;
    orderId: string;
    createdAt: string;
  },
) {
  const localTransactionId = createId("TXN");
  await t.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
    VALUES (?, ?, ?, 'c2c', ?, ?, 'pending', ?)
  `, [
    localTransactionId,
    input.customerId,
    input.direction,
    input.amountSatang,
    `${input.direction === "deposit" ? "ฝาก" : "ถอน"}แบบ Celox C2C · ${input.orderId}`,
    input.createdAt,
  ]);
  return localTransactionId;
}

async function getC2CLocalTransaction(t: Tx, row: CeloxC2CRow) {
  const transaction = await t.first<CeloxDepositTransactionRow>(`
    SELECT customer_id, direction, channel, amount_satang, status
    FROM transactions WHERE id = ?
  `, [row.local_transaction_id]);
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

// C2C ฝั่งถอนปิดคู่แบบได้ไม่ครบยอดได้ (unfilledAmount > 0) — ต้องหักลูกค้าแค่ยอดที่โอนจริง
// แล้วคืนส่วนที่ไม่เคยจับคู่กลับเข้า withdrawable แทนที่จะหักเต็มยอดที่กันไว้ตอนสร้างรายการ
async function settleC2CWithdrawal(t: Tx, row: CeloxC2CRow, settledAmountSatang: number) {
  if (
    !Number.isInteger(settledAmountSatang)
    || settledAmountSatang < 0
    || settledAmountSatang > row.amount_satang
  ) {
    throw new Error("ยอดที่ Celox ยืนยันว่าโอนจริงไม่สอดคล้องกับยอดที่กันไว้เดิมของรายการถอน C2C");
  }
  const unfilledSatang = row.amount_satang - settledAmountSatang;
  const updated = await t.run(`
    UPDATE customers
    SET balance_satang = balance_satang - ?, withdrawable_satang = withdrawable_satang + ?
    WHERE id = ? AND balance_satang >= ?
      AND balance_satang - ? >= withdrawable_satang
  `, [settledAmountSatang, unfilledSatang, row.customer_id, row.amount_satang, row.amount_satang]);
  return updated.rowCount === 1;
}

async function finalizeC2CSuccess(
  t: Tx,
  row: CeloxC2CRow,
  now: string,
  settledAmountSatang: number,
) {
  const local = await getC2CLocalTransaction(t, row);
  if (local.status === "success") {
    if (row.funds_reserved) {
      throw new Error("รายการถอน C2C สำเร็จแล้วแต่ยอดภายในยังถูกกันอยู่");
    }
    return;
  }
  if (local.status !== "pending") {
    throw new Error("รายการ C2C ที่จบสำเร็จชนกับสถานะภายในที่ปิดไปแล้ว");
  }

  if (row.direction === "deposit") {
    const credited = await t.run(`
      UPDATE customers
      SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ?
      WHERE id = ?
    `, [settledAmountSatang, settledAmountSatang, row.customer_id]);
    if (credited.rowCount !== 1) throw new Error("เพิ่มยอดฝาก C2C ให้ลูกค้าไม่สำเร็จ");
  } else if (row.funds_reserved) {
    if (!await settleC2CWithdrawal(t, row, settledAmountSatang)) {
      throw new Error("ใช้ยอดที่กันไว้สำหรับถอน C2C ไม่สำเร็จ");
    }
  } else {
    throw new Error("รายการถอน C2C สำเร็จโดยไม่มียอดภายในที่กันไว้");
  }

  await t.run("UPDATE transactions SET status = 'success' WHERE id = ?",
    [row.local_transaction_id]);
  await t.run(`
    UPDATE celox_c2c_transactions
    SET transaction_status = 'SUCCESS', settled_amount_satang = ?,
        held_amount_satang = 0, funds_reserved = false, updated_at = ?
    WHERE transaction_id = ?
  `, [settledAmountSatang, now, row.transaction_id]);
}

async function finalizeC2CFailure(
  t: Tx,
  row: CeloxC2CRow,
  now: string,
  settledAmountSatang: number,
) {
  const local = await getC2CLocalTransaction(t, row);
  if (local.status === "success") {
    throw new Error("ไม่สามารถปิดรายการ C2C ที่บันทึกสำเร็จแล้วเป็นรายการไม่สำเร็จได้");
  }
  // ปิดคู่แบบ EXPIRED/CANCELLED ก็อาจมีบางส่วนโอนไปแล้วก่อนหน้าได้ (settledAmountSatang > 0)
  // จึงต้องหักส่วนที่โอนจริงเหมือนกรณีสำเร็จ แล้วคืนเฉพาะส่วนที่ไม่เคยจับคู่กลับเข้า withdrawable
  if (row.direction === "withdraw" && row.funds_reserved) {
    if (!await settleC2CWithdrawal(t, row, settledAmountSatang)) {
      throw new Error("คืนยอดที่กันไว้สำหรับถอน C2C ไม่สำเร็จ");
    }
  }
  await t.run("UPDATE transactions SET status = 'failed' WHERE id = ? AND status = 'pending'",
    [row.local_transaction_id]);
  await t.run(`
    UPDATE celox_c2c_transactions
    SET settled_amount_satang = ?, funds_reserved = false, held_amount_satang = 0, updated_at = ?
    WHERE transaction_id = ?
  `, [settledAmountSatang, now, row.transaction_id]);
}

export async function recordCeloxC2CDepositIntent(input: {
  customerId: string;
  deposit: CreateC2CDepositResponse;
}) {
  const amountSatang = validMoneySatang(input.deposit.amount);
  const now = new Date().toISOString();
  return await tx(async (t) => {
    const customer = await t.first<{ found: 1 }>("SELECT 1 AS found FROM customers WHERE id = ?",
      [input.customerId]);
    if (!customer) throw new Error("ไม่พบลูกค้าที่เลือกรับยอดฝาก C2C");

    const existing = await t.first<CeloxC2CRow>("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?",
      [input.deposit.transactionId]);
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
      await getC2CLocalTransaction(t, existing);
      return;
    }

    const localTransactionId = await insertPendingC2CTransaction(t, {
      customerId: input.customerId,
      direction: "deposit",
      amountSatang,
      orderId: input.deposit.orderId,
      createdAt: now,
    });
    await t.run(`
      INSERT INTO celox_c2c_transactions (
        transaction_id, order_id, reference_id, customer_id, direction,
        transaction_status, amount_satang, fee_amount_satang,
        settled_amount_satang, held_amount_satang, awaiting_manual_review,
        match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'deposit', ?, ?, 0, 0, 0, false, ?, false, ?, ?, ?)
    `, [
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
    ]);
  });
}

export async function reserveCeloxC2CWithdrawalFunds(input: {
  customerId: string;
  request: CreateC2CWithdrawalRequest & { referenceId: string };
}) {
  const amountSatang = validMoneySatang(input.request.amount);
  const reservationId = createId("C2C-WDR");
  const now = new Date().toISOString();
  await tx(async (t) => {
    await t.run(`
      INSERT INTO celox_c2c_withdrawal_reservations (
        reservation_id, customer_id, amount_satang, reference_id,
        reservation_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'creating', ?, ?)
    `, [reservationId, input.customerId, amountSatang, input.request.referenceId, now, now]);
    const reserved = await t.run(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang - ?
      WHERE id = ? AND withdrawable_satang >= ?
    `, [amountSatang, input.customerId, amountSatang]);
    if (reserved.rowCount !== 1) {
      throw new Error("ยอดเงินที่ถอนได้ไม่เพียงพอสำหรับกันยอดถอน C2C");
    }
  });
  return reservationId;
}

export async function markCeloxC2CWithdrawalReservationUncertain(reservationId: string) {
  await db.run(`
    UPDATE celox_c2c_withdrawal_reservations
    SET reservation_state = 'uncertain', updated_at = ?
    WHERE reservation_id = ?
  `, [new Date().toISOString(), reservationId]);
}

export async function releaseCeloxC2CWithdrawalReservation(reservationId: string) {
  return await tx(async (t) => {
    const reservation = await t.first<CeloxC2CWithdrawalReservationRow>(`
      SELECT * FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?
    `, [reservationId]);
    if (!reservation) return;
    const released = await t.run(`
      UPDATE customers
      SET withdrawable_satang = withdrawable_satang + ?
      WHERE id = ? AND withdrawable_satang + ? <= balance_satang
    `, [reservation.amount_satang, reservation.customer_id, reservation.amount_satang]);
    if (released.rowCount !== 1) throw new Error("คืนยอดจองถอน C2C ไม่สำเร็จ");
    await t.run("DELETE FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?",
      [reservationId]);
  });
}

export async function recordCeloxC2CWithdrawalIntent(input: {
  reservationId: string;
  customerId: string;
  request: CreateC2CWithdrawalRequest & { referenceId: string };
  withdrawal: CreateC2CWithdrawalResponse;
}) {
  const amountSatang = validMoneySatang(input.request.amount);
  const feeSatang = toSatang(input.withdrawal.feeAmount);
  const heldSatang = toSatang(input.withdrawal.reservedAmount);
  const now = new Date().toISOString();
  return await tx(async (t) => {
    const reservation = await t.first<CeloxC2CWithdrawalReservationRow>(`
      SELECT * FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?
    `, [input.reservationId]);
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

    const localTransactionId = await insertPendingC2CTransaction(t, {
      customerId: input.customerId,
      direction: "withdraw",
      amountSatang,
      orderId: input.withdrawal.orderId,
      createdAt: now,
    });
    await t.run(`
      INSERT INTO celox_c2c_transactions (
        transaction_id, order_id, reference_id, customer_id, direction,
        transaction_status, amount_satang, fee_amount_satang,
        settled_amount_satang, held_amount_satang, awaiting_manual_review,
        match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'withdraw', ?, ?, ?, 0, ?, ?, ?, true, ?, ?, ?)
    `, [
      input.withdrawal.transactionId,
      input.withdrawal.orderId,
      input.withdrawal.referenceId,
      input.customerId,
      input.withdrawal.transactionStatus,
      amountSatang,
      feeSatang,
      heldSatang,
      input.withdrawal.awaitingManualReview || input.withdrawal.transactionStatus === "PENDING_MANUAL_C2C" ? true : false,
      input.withdrawal.matchDeadline,
      localTransactionId,
      now,
      now,
    ]);
    await t.run("DELETE FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?",
      [input.reservationId]);
  });
}

export async function getCeloxC2CIntent(transactionId: string) {
  const row = await db.first<CeloxC2CRow>("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?",
    [transactionId]);
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

export async function recordCeloxC2CSlipResult(result: C2CDepositSlipResponse) {
  const now = new Date().toISOString();
  return await tx(async (t) => {
    const row = await t.first<CeloxC2CRow>("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?",
      [result.transactionId]);
    if (!row || row.direction !== "deposit" || row.order_id !== result.orderId) {
      throw new Error("ไม่พบรายการฝาก C2C ที่ตรงกับผลตรวจสลิป");
    }
    await t.run(`
      UPDATE celox_c2c_transactions
      SET transaction_status = ?, awaiting_manual_review = ?, updated_at = ?
      WHERE transaction_id = ?
    `, [
      result.transactionStatus,
      result.transactionStatus === "PENDING_APPROVE" ? true : false,
      now,
      result.transactionId,
    ]);
    if (result.transactionStatus === "SUCCESS") {
      // ฝั่งฝากไม่มีแนวคิดปิดคู่แบบได้ไม่ครบยอด ยอดที่จบจริงเท่ากับยอดเต็มเสมอ
      await finalizeC2CSuccess(t, { ...row, transaction_status: "SUCCESS" }, now, row.amount_satang);
    }
  });
}

export async function recordCeloxC2CCancelResult(result: CancelC2CTransactionResponse) {
  const now = new Date().toISOString();
  return await tx(async (t) => {
    const row = await t.first<CeloxC2CRow>("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?",
      [result.transactionId]);
    if (!row) return false;
    if (
      row.order_id !== result.orderId
      || row.reference_id !== result.referenceId
    ) {
      throw new Error("ผลยกเลิก C2C ไม่ตรงกับรายการในระบบ");
    }
    await t.run(`
      UPDATE celox_c2c_transactions
      SET transaction_status = ?, match_deadline = NULL, updated_at = ?
      WHERE transaction_id = ?
    `, [result.transactionStatus, now, result.transactionId]);
    if (result.transactionStatus === "CANCELLED") {
      // ยกเลิกเองด้วยมือทำได้เฉพาะตอนยังไม่จับคู่ ไม่มีส่วนไหนโอนไปแล้ว
      await finalizeC2CFailure(t, { ...row, transaction_status: "CANCELLED" }, now, 0);
    }
    return true;
  });
}

export async function syncCeloxC2CTransaction(result: C2CTransactionResponse) {
  const amountSatang = validMoneySatang(result.amount);
  const now = new Date().toISOString();
  return await tx(async (t) => {
    let row = await t.first<CeloxC2CRow>(`
      SELECT * FROM celox_c2c_transactions
      WHERE transaction_id = ? OR order_id = ? OR reference_id = ?
      LIMIT 1
    `, [result.transactionId, result.orderId, result.referenceId]);
    if (!row && result.direction === "withdraw" && result.referenceId) {
      const reservation = await t.first<CeloxC2CWithdrawalReservationRow>(`
        SELECT * FROM celox_c2c_withdrawal_reservations WHERE reference_id = ?
      `, [result.referenceId]);
      if (reservation && reservation.amount_satang === amountSatang) {
        const localTransactionId = await insertPendingC2CTransaction(t, {
          customerId: reservation.customer_id,
          direction: "withdraw",
          amountSatang,
          orderId: result.orderId,
          createdAt: reservation.created_at,
        });
        await t.run(`
          INSERT INTO celox_c2c_transactions (
            transaction_id, order_id, reference_id, customer_id, direction,
            transaction_status, amount_satang, fee_amount_satang,
            settled_amount_satang, held_amount_satang, awaiting_manual_review,
            match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'withdraw', ?, ?, ?, ?, ?, ?, ?, true, ?, ?, ?)
        `, [
          result.transactionId,
          result.orderId,
          result.referenceId,
          reservation.customer_id,
          result.transactionStatus,
          amountSatang,
          toSatang(result.feeAmount),
          toSatang(result.settledAmount),
          toSatang(result.heldAmount),
          result.awaitingManualReview ? true : false,
          result.matchDeadline,
          localTransactionId,
          reservation.created_at,
          now,
        ]);
        await t.run("DELETE FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?",
          [reservation.reservation_id]);
        row = await t.first<CeloxC2CRow>("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?",
          [result.transactionId]) as CeloxC2CRow;
      }
    }
    if (!row) return false;
    // `amount` ไม่ใช่ identity field: ฝั่งถอนที่ปิดคู่แบบได้ไม่ครบยอด Celox จะเขียนทับ
    // `amount` เป็นยอดที่จบจริง ไม่ใช่ยอดคำขอเดิมอีกต่อไป ห้ามเอามาเทียบว่าเป็นรายการเดียวกันหรือไม่
    if (
      row.transaction_id !== result.transactionId
      || row.order_id !== result.orderId
      || row.reference_id !== result.referenceId
      || row.direction !== result.direction
    ) {
      throw new Error("สถานะ C2C จาก Celox ไม่ตรงกับรายการที่ผูกไว้ในระบบ");
    }

    await t.run(`
      UPDATE celox_c2c_transactions
      SET transaction_status = ?, fee_amount_satang = ?, settled_amount_satang = ?,
          held_amount_satang = ?, awaiting_manual_review = ?, match_deadline = ?, updated_at = ?
      WHERE transaction_id = ?
    `, [
      result.transactionStatus,
      toSatang(result.feeAmount),
      toSatang(result.settledAmount),
      toSatang(result.heldAmount),
      result.awaitingManualReview ? true : false,
      result.matchDeadline,
      now,
      result.transactionId,
    ]);

    const current = { ...row, transaction_status: result.transactionStatus };
    const settledAmountSatang = toSatang(result.settledAmount);
    if (result.transactionStatus === "SUCCESS") {
      await finalizeC2CSuccess(t, current, now, settledAmountSatang);
    } else if (
      result.transactionStatus === "CANCELLED"
      || (row.direction === "withdraw" && result.transactionStatus === "EXPIRED" && result.heldAmount === 0)
    ) {
      await finalizeC2CFailure(t, current, now, settledAmountSatang);
    }
    return true;
  });
}

export async function listCeloxC2CTransactions(options: { search?: string; limit?: number } = {}) {
  const values: Array<string | number> = [];
  const conditions: string[] = [];
  if (options.search?.trim()) {
    const search = `%${options.search.trim()}%`;
    // ILIKE ไม่ใช่ LIKE — เหตุผลอยู่ที่คอมเมนต์เหนือ listCustomers
    conditions.push(`(
      c.name ILIKE ? OR c.account ILIKE ? OR x.order_id ILIKE ?
      OR x.reference_id ILIKE ? OR x.transaction_id ILIKE ?
    )`);
    values.push(search, search, search, search, search);
  }
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  values.push(limit);
  const rows = await db.query<CeloxC2CRow & { customer_name: string; customer_account: string }>(`
    SELECT x.*, c.name AS customer_name, c.account AS customer_account
    FROM celox_c2c_transactions x
    JOIN customers c ON c.id = x.customer_id
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY x.created_at DESC
    LIMIT ?
  `, values);
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
    awaitingManualReview: row.awaiting_manual_review,
    matchDeadline: row.match_deadline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * เทียบเวลาที่เก็บไว้กับเวลาที่มาใน payload โดยดูที่ "ช่วงเวลาเดียวกันหรือไม่" ไม่ใช่สตริงตรงกันหรือไม่
 *
 * สมัยที่ยังเป็น SQLite คอลัมน์ `occurred_at` เป็น TEXT จึงเก็บสตริงตามที่ Celox ส่งมาแบบตรงตัว
 * การเทียบสตริงจึงตรงกันเสมอเมื่อ Celox ส่ง payload เดิมซ้ำ ตอนนี้คอลัมน์เป็น `timestamptz`
 * และ `lib/sql.ts` แปลงค่าที่อ่านกลับมาเป็น ISO 8601 แบบ UTC เสมอ ถ้ายังเทียบสตริงอยู่
 * payload เดิมที่เขียนเวลาในรูปแบบ ISO อื่น (เช่น offset `+07:00` หรือไม่มีมิลลิวินาที)
 * จะถูกตัดสินว่าเป็น conflict แล้วตอบ HTTP 409 แทนที่จะเป็น duplicate ที่ไม่มีปัญหา
 *
 * ทั้งสองฝั่งจึงถูก parse ด้วยวิธีเดียวกันก่อนเทียบ ถ้าฝั่งใดฝั่งหนึ่ง parse ไม่ได้
 * ให้ถอยไปเทียบสตริงตรงตัวแบบเดิม เพื่อไม่ให้ค่าที่อ่านไม่ออกกลายเป็น "ตรงกัน" โดยไม่ตั้งใจ
 */
function sameInstant(stored: string | null, incoming: string | null) {
  if (stored === null || incoming === null) return stored === incoming;
  const storedTime = Date.parse(stored);
  const incomingTime = Date.parse(incoming);
  if (Number.isNaN(storedTime) || Number.isNaN(incomingTime)) return stored === incoming;
  return storedTime === incomingTime;
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
    && sameInstant(row.occurred_at, input.occurredAt)
    && row.signed_payload_hash === signedPayloadHash;
}

export async function enqueueCeloxC2CCallbackEvent(
  input: CeloxC2CCallbackRequest,
  signedPayloadHash: string,
) {
  if (!/^[0-9a-f]{64}$/.test(signedPayloadHash)) {
    throw new Error("hash ของ signed payload C2C ไม่ถูกต้อง");
  }
  const amountSatang = validMoneySatang(input.amount);
  const now = new Date().toISOString();

  return await tx(async (t) => {
    const inserted = await t.run(`
      INSERT INTO celox_c2c_callback_events (
        transaction_id, order_id, reference_id, provider_status, amount_satang,
        occurred_at, provider_event, signed_payload_hash, has_transfer_to,
        processing_state, received_at, last_received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT DO NOTHING
    `, [
      input.transactionId,
      input.orderId,
      input.referenceId,
      input.status,
      amountSatang,
      input.occurredAt,
      input.event ?? null,
      signedPayloadHash,
      Object.hasOwn(input, "transferTo") ? true : false,
      now,
      now,
    ]);

    const event = await t.first<CeloxC2CCallbackRow>(`
      SELECT * FROM celox_c2c_callback_events
      WHERE transaction_id = ? AND provider_status = ?
    `, [input.transactionId, input.status]);
    if (!event) throw new Error("บันทึก Callback C2C ลง inbox ไม่สำเร็จ");

    if (inserted.rowCount === 1) {
      return { eventId: event.id, duplicate: false, conflict: false, shouldProcess: true };
    }
    if (!c2cCallbackPayloadMatches(event, input, amountSatang, signedPayloadHash)) {
      return { eventId: event.id, duplicate: true, conflict: true, shouldProcess: false };
    }

    const shouldProcess = ["pending", "failed", "unmatched"].includes(event.processing_state);
    await t.run(`
      UPDATE celox_c2c_callback_events
      SET received_count = received_count + 1,
          last_received_at = ?,
          processing_state = CASE WHEN processing_state IN ('failed', 'unmatched') THEN 'pending' ELSE processing_state END,
          last_error = CASE WHEN processing_state IN ('failed', 'unmatched') THEN NULL ELSE last_error END,
          processed_at = CASE WHEN processing_state IN ('failed', 'unmatched') THEN NULL ELSE processed_at END
      WHERE id = ?
    `, [now, event.id]);
    return { eventId: event.id, duplicate: true, conflict: false, shouldProcess };
  });
}

async function finishCeloxC2CCallback(
  t: Tx,
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
  await t.run(`
    UPDATE celox_c2c_callback_events
    SET processing_state = ?, customer_id = COALESCE(?, customer_id),
        direction = COALESCE(?, direction),
        local_transaction_id = COALESCE(?, local_transaction_id),
        attempt_count = attempt_count + 1, last_error = ?, processed_at = ?
    WHERE id = ?
  `, [
    state,
    options.customerId ?? null,
    options.direction ?? null,
    options.localTransactionId ?? null,
    options.error ?? null,
    now,
    event.id,
  ]);
}

async function adoptCeloxC2CWithdrawalReservationFromCallback(
  t: Tx,
  event: CeloxC2CCallbackRow,
  now: string,
) {
  if (event.reference_id === null) return undefined;
  const reservation = await t.first<CeloxC2CWithdrawalReservationRow>(`
    SELECT * FROM celox_c2c_withdrawal_reservations
    WHERE reference_id = ? AND amount_satang = ?
  `, [event.reference_id, event.amount_satang]);
  if (!reservation) return undefined;

  const localTransactionId = await insertPendingC2CTransaction(t, {
    customerId: reservation.customer_id,
    direction: "withdraw",
    amountSatang: event.amount_satang,
    orderId: event.order_id,
    createdAt: reservation.created_at,
  });
  await t.run(`
    INSERT INTO celox_c2c_transactions (
      transaction_id, order_id, reference_id, customer_id, direction,
      transaction_status, amount_satang, fee_amount_satang,
      settled_amount_satang, held_amount_satang, awaiting_manual_review,
      match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'withdraw', ?, ?, 0, 0, ?, false, NULL, true, ?, ?, ?)
  `, [
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
  ]);
  await t.run("DELETE FROM celox_c2c_withdrawal_reservations WHERE reservation_id = ?",
    [reservation.reservation_id]);
  return await t.first<CeloxC2CRow>("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?",
    [event.transaction_id]) as CeloxC2CRow;
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

export async function processCeloxC2CCallbackEvent(eventId: number) {
  const now = new Date().toISOString();

  return await tx(async (t) => {
    const event = await t.first<CeloxC2CCallbackRow>("SELECT * FROM celox_c2c_callback_events WHERE id = ?",
      [eventId]);
    if (!event) throw new Error("ไม่พบ Callback C2C ที่ต้องประมวลผล");
    if (event.processing_state === "applied" || event.processing_state === "recorded") {
      return event;
    }

    let row = await t.first<CeloxC2CRow>("SELECT * FROM celox_c2c_transactions WHERE transaction_id = ?",
      [event.transaction_id]);
    if (!row && isSupportedC2CCallbackStatus(event.provider_status)) {
      row = await adoptCeloxC2CWithdrawalReservationFromCallback(t, event, now);
    }

    if (!row) {
      await finishCeloxC2CCallback(t, event, "unmatched", now, {
        error: "ยังไม่พบรายการ Celox C2C ที่ผูกกับ Callback นี้",
      });
      return await t.first<CeloxC2CCallbackRow>("SELECT * FROM celox_c2c_callback_events WHERE id = ?",
        [eventId]) as CeloxC2CCallbackRow;
    }

    // `amount` ไม่ใช่ identity field: ฝั่งถอนที่ปิดคู่แบบได้ไม่ครบยอด Celox จะเขียนทับ
    // `amount` เป็นยอดที่จบจริง ไม่ใช่ยอดคำขอเดิมอีกต่อไป ห้ามเอามาเทียบว่าเป็นรายการเดียวกันหรือไม่
    if (
      row.order_id !== event.order_id
      || row.reference_id !== event.reference_id
    ) {
      await finishCeloxC2CCallback(t, event, "failed", now, {
        customerId: row.customer_id,
        direction: row.direction,
        error: "ข้อมูล orderId หรือ referenceId ใน Callback C2C ไม่ตรงกับรายการที่ผูกไว้",
      });
      return await t.first<CeloxC2CCallbackRow>("SELECT * FROM celox_c2c_callback_events WHERE id = ?",
        [eventId]) as CeloxC2CCallbackRow;
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
        await t.run(`
          UPDATE celox_c2c_transactions
          SET transaction_status = 'PENDING_TRANSFER', match_deadline = NULL,
              awaiting_manual_review = false, updated_at = ?
          WHERE transaction_id = ?
        `, [now, row.transaction_id]);
      }
      await finishCeloxC2CCallback(t, event, "recorded", now, linked);
    } else if (event.provider_status === "SUCCESS") {
      if (!event.occurred_at) {
        await finishCeloxC2CCallback(t, event, "failed", now, {
          ...linked,
          error: "Callback C2C สถานะ SUCCESS ไม่มี occurredAt",
        });
      } else if (row.transaction_status === "EXPIRED" || row.transaction_status === "CANCELLED") {
        await finishCeloxC2CCallback(t, event, "failed", now, {
          ...linked,
          error: `Callback C2C สถานะ SUCCESS ชนกับสถานะปิด ${row.transaction_status}`,
        });
      } else {
        // event.amount_satang คือยอดที่จบจริง (Celox เขียนทับ amount เดิมเมื่อปิดคู่แบบได้ไม่ครบยอด)
        await finalizeC2CSuccess(t, { ...row, transaction_status: "SUCCESS" }, now, event.amount_satang);
        await finishCeloxC2CCallback(t, event, "applied", now, linked);
      }
    } else if (event.provider_status === "EXPIRED" || event.provider_status === "CANCELLED") {
      if (row.transaction_status === "SUCCESS") {
        await finishCeloxC2CCallback(t, event, "failed", now, {
          ...linked,
          error: `Callback C2C สถานะ ${event.provider_status} ชนกับรายการที่สำเร็จแล้ว`,
        });
      } else if (isC2CTerminalStatus(row.transaction_status) && row.transaction_status !== event.provider_status) {
        await finishCeloxC2CCallback(t, event, "failed", now, {
          ...linked,
          error: `Callback C2C สถานะ ${event.provider_status} ชนกับสถานะปิด ${row.transaction_status}`,
        });
      } else {
        await t.run(`
          UPDATE celox_c2c_transactions
          SET transaction_status = ?, match_deadline = NULL,
              awaiting_manual_review = false, updated_at = ?
          WHERE transaction_id = ?
        `, [event.provider_status, now, row.transaction_id]);
        await finalizeC2CFailure(t, { ...row, transaction_status: event.provider_status }, now, event.amount_satang);
        await finishCeloxC2CCallback(t, event, "applied", now, linked);
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
        await t.run(`
          UPDATE celox_c2c_transactions
          SET transaction_status = ?, awaiting_manual_review = ?, updated_at = ?
          WHERE transaction_id = ?
        `, [
          event.provider_status,
          event.provider_status === "PENDING_TOPUP_C2C" ? false : true,
          now,
          row.transaction_id,
        ]);
      }
      await finishCeloxC2CCallback(t, event, "recorded", now, linked);
    } else {
      await finishCeloxC2CCallback(t, event, "failed", now, {
        ...linked,
        error: `ยังไม่รองรับสถานะ Callback C2C: ${event.provider_status}`,
      });
    }

    return await t.first<CeloxC2CCallbackRow>("SELECT * FROM celox_c2c_callback_events WHERE id = ?",
      [eventId]) as CeloxC2CCallbackRow;
  });
}

export async function markCeloxC2CCallbackEventFailed(eventId: number, error: string, attempts = 1) {
  const message = error.trim().slice(0, 500) || "ประมวลผล Callback C2C ไม่สำเร็จ";
  await db.run(`
    UPDATE celox_c2c_callback_events
    SET processing_state = 'failed', attempt_count = attempt_count + ?,
        last_error = ?, processed_at = ?
    WHERE id = ? AND processing_state NOT IN ('applied', 'recorded')
  `, [Math.max(1, attempts), message, new Date().toISOString(), eventId]);
}

function callbackPayloadMatches(row: CeloxCallbackRow, input: CeloxCallbackRequest, amountSatang: number) {
  return row.order_id === input.orderId
    && row.reference_id === input.referenceId
    && row.amount_satang === amountSatang
    && sameInstant(row.occurred_at, input.occurredAt);
}

export async function enqueueCeloxCallbackEvent(input: CeloxCallbackRequest) {
  const amountSatang = validMoneySatang(input.amount);
  const now = new Date().toISOString();

  return await tx(async (t) => {
    const inserted = await t.run(`
      INSERT INTO celox_callback_events (
        transaction_id, order_id, reference_id, provider_status, amount_satang,
        occurred_at, processing_state, received_at, last_received_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT DO NOTHING
    `, [
      input.transactionId,
      input.orderId,
      input.referenceId,
      input.status,
      amountSatang,
      input.occurredAt,
      now,
      now,
    ]);

    const event = await t.first<CeloxCallbackRow>(`
      SELECT * FROM celox_callback_events
      WHERE transaction_id = ? AND provider_status = ?
    `, [input.transactionId, input.status]);
    if (!event) throw new Error("บันทึก callback ลง inbox ไม่สำเร็จ");

    if (inserted.rowCount === 1) {
      return { eventId: event.id, duplicate: false, conflict: false, shouldProcess: true };
    }
    if (!callbackPayloadMatches(event, input, amountSatang)) {
      return { eventId: event.id, duplicate: true, conflict: true, shouldProcess: false };
    }

    const shouldProcess = ["pending", "failed", "unmatched"].includes(event.processing_state);
    await t.run(`
      UPDATE celox_callback_events
      SET received_count = received_count + 1,
          last_received_at = ?,
          processing_state = CASE WHEN processing_state IN ('failed', 'unmatched') THEN 'pending' ELSE processing_state END,
          last_error = CASE WHEN processing_state IN ('failed', 'unmatched') THEN NULL ELSE last_error END,
          processed_at = CASE WHEN processing_state IN ('failed', 'unmatched') THEN NULL ELSE processed_at END
      WHERE id = ?
    `, [now, event.id]);
    return { eventId: event.id, duplicate: true, conflict: false, shouldProcess };
  });
}

export async function getCeloxCallbackEvent(eventId: number) {
  const row = await db.first<CeloxCallbackRow>(`
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
  `, [eventId]);
  return row ? mapCeloxCallback(row) : null;
}

async function finishCeloxCallbackWithoutCredit(
  t: Tx,
  event: CeloxCallbackRow,
  state: "recorded" | "unmatched" | "failed",
  now: string,
  options: {
    customerId?: string;
    direction?: "deposit" | "withdraw";
    error?: string;
  } = {},
) {
  await t.run(`
    UPDATE celox_callback_events
    SET processing_state = ?, customer_id = COALESCE(?, customer_id),
        transaction_kind = COALESCE(?, transaction_kind),
        attempt_count = attempt_count + 1, last_error = ?, processed_at = ?
    WHERE id = ?
  `, [
    state,
    options.customerId ?? null,
    options.direction ?? null,
    options.error ?? null,
    now,
    event.id,
  ]);
}

async function adoptCeloxWithdrawalReservationFromCallback(
  t: Tx,
  event: CeloxCallbackRow,
  now: string,
) {
  if (event.reference_id === null) return undefined;
  const reservation = await t.first<CeloxWithdrawalReservationRow>(`
    SELECT * FROM celox_withdrawal_reservations
    WHERE reference_id = ? AND amount_satang = ?
  `, [event.reference_id, event.amount_satang]);
  if (!reservation) return undefined;

  await t.run(`
    INSERT INTO celox_withdrawals (
      transaction_id, order_id, reference_id, customer_id, amount_satang,
      destination_bank_code, destination_account_name, destination_account_no,
      transaction_status, confirmation_state, funds_reserved, occurred_at,
      local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, true, NULL, NULL, ?, ?)
  `, [
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
  ]);
  await t.run("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?",
    [reservation.reservation_id]);
  return await t.first<CeloxWithdrawalRow>("SELECT * FROM celox_withdrawals WHERE transaction_id = ?",
    [event.transaction_id]) as CeloxWithdrawalRow;
}

export async function processCeloxCallbackEvent(eventId: number) {
  const now = new Date().toISOString();

  return await tx(async (t) => {
    const event = await t.first<CeloxCallbackRow>("SELECT * FROM celox_callback_events WHERE id = ?",
      [eventId]);
    if (!event) throw new Error("ไม่พบ callback ที่ต้องประมวลผล");
    if (event.processing_state === "applied" || event.processing_state === "recorded") {
      return mapCeloxCallback(event);
    }

    const depositIntent = await t.first<CeloxDepositRow>("SELECT * FROM celox_deposits WHERE transaction_id = ?",
      [event.transaction_id]);
    let withdrawalIntent = await t.first<CeloxWithdrawalRow>("SELECT * FROM celox_withdrawals WHERE transaction_id = ?",
      [event.transaction_id]);
    if (!depositIntent && !withdrawalIntent) {
      withdrawalIntent = await adoptCeloxWithdrawalReservationFromCallback(t, event, now);
    }

    if (depositIntent && withdrawalIntent) {
      await finishCeloxCallbackWithoutCredit(t, event, "failed", now, {
        error: "transactionId ของ callback ชนกันระหว่างรายการฝากและถอน Celox",
      });
      const failed = await t.first<CeloxCallbackRow>("SELECT * FROM celox_callback_events WHERE id = ?",
        [eventId]) as CeloxCallbackRow;
      return mapCeloxCallback(failed);
    }

    if (!depositIntent && !withdrawalIntent) {
      await finishCeloxCallbackWithoutCredit(t, event, "unmatched", now, {
        error: "ยังไม่พบรายการ Celox ที่ผูกกับ callback นี้",
      });
      const unmatched = await t.first<CeloxCallbackRow>("SELECT * FROM celox_callback_events WHERE id = ?",
        [eventId]) as CeloxCallbackRow;
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
      await finishCeloxCallbackWithoutCredit(t, event, "failed", now, {
        customerId,
        direction,
        error: `ข้อมูล orderId, referenceId หรือยอดเงินใน callback ไม่ตรงกับรายการ${direction === "deposit" ? "ฝาก" : "ถอน"}`,
      });
      const failed = await t.first<CeloxCallbackRow>("SELECT * FROM celox_callback_events WHERE id = ?",
        [eventId]) as CeloxCallbackRow;
      return mapCeloxCallback(failed);
    }

    if (event.provider_status === "SUCCESS") {
      if (!event.occurred_at) {
        await finishCeloxCallbackWithoutCredit(t, event, "failed", now, {
          customerId,
          direction,
          error: "callback สถานะ SUCCESS ไม่มี occurredAt",
        });
        const failed = await t.first<CeloxCallbackRow>("SELECT * FROM celox_callback_events WHERE id = ?",
          [eventId]) as CeloxCallbackRow;
        return mapCeloxCallback(failed);
      }
      const finalized = depositIntent
        ? await finalizeCeloxDepositSuccess(t, depositIntent, {
            transactionId: event.transaction_id,
            orderId: event.order_id,
            amountSatang: event.amount_satang,
            occurredAt: event.occurred_at,
          }, now)
        : await finalizeCeloxWithdrawalSuccess(t, withdrawalIntent as CeloxWithdrawalRow, {
            transactionId: event.transaction_id,
            orderId: event.order_id,
            referenceId: event.reference_id,
            amountSatang: event.amount_satang,
            occurredAt: event.occurred_at,
          }, now);
      await t.run(`
        UPDATE celox_callback_events
        SET processing_state = 'applied', customer_id = ?, transaction_kind = ?,
            local_transaction_id = ?,
            attempt_count = attempt_count + 1, last_error = NULL, processed_at = ?
        WHERE id = ?
      `, [customerId, direction, finalized.transactionId, now, event.id]);
    } else {
      if (depositIntent) {
        if (
          isDepositTransactionStatus(event.provider_status)
          && event.provider_status !== "SUCCESS"
          && depositIntent.transaction_status !== "SUCCESS"
          && canTransitionCeloxDepositStatus(depositIntent.transaction_status, event.provider_status)
        ) {
          await t.run(`
            UPDATE celox_deposits
            SET transaction_status = ?, updated_at = ?
            WHERE transaction_id = ?
          `, [event.provider_status, now, event.transaction_id]);
          if (event.provider_status === "EXPIRED") {
            await t.run("DELETE FROM celox_deposit_slip_claims WHERE transaction_id = ?",
              [event.transaction_id]);
          }
        }
        if (depositIntent.local_transaction_id && isTerminalCeloxFailureStatus(event.provider_status)) {
          // ผลจาก Create/Slip ที่ยังไม่ใช่ SUCCESS จะคง pending; เฉพาะ Callback
          // terminal เท่านั้นที่ปิดรายการเป็น failed และไม่แตะยอดเงินลูกค้า
          await t.run(`
            UPDATE transactions
            SET status = 'failed'
            WHERE id = ? AND status = 'pending'
          `, [depositIntent.local_transaction_id]);
        }
      }
      await finishCeloxCallbackWithoutCredit(t, event, "recorded", now, {
        customerId,
        direction,
      });
    }

    const processed = await t.first<CeloxCallbackRow>("SELECT * FROM celox_callback_events WHERE id = ?",
      [eventId]) as CeloxCallbackRow;
    return mapCeloxCallback(processed);
  });
}

export async function markCeloxCallbackEventFailed(eventId: number, error: string, attempts = 1) {
  const message = error.trim().slice(0, 500) || "ประมวลผล callback ไม่สำเร็จ";
  await db.run(`
    UPDATE celox_callback_events
    SET processing_state = 'failed', attempt_count = attempt_count + ?,
        last_error = ?, processed_at = ?
    WHERE id = ? AND processing_state NOT IN ('applied', 'recorded')
  `, [Math.max(1, attempts), message, new Date().toISOString(), eventId]);
}

export async function listCustomerCeloxCallbacks(customerId: string, limit = 10) {
  if (!await customerExists(customerId)) throw new Error("ไม่พบข้อมูลลูกค้า");
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
  const rows = await db.query<CeloxCallbackRow>(`
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
  `, [customerId, safeLimit]);
  return rows.map(mapCeloxCallback);
}

const STALE_CELOX_OPERATION_MS = 5 * 60 * 1_000;

function isStaleCeloxOperation(updatedAt: string) {
  const updatedTime = Date.parse(updatedAt);
  return Number.isFinite(updatedTime)
    && Date.now() - updatedTime >= STALE_CELOX_OPERATION_MS;
}

export async function listCustomerCeloxWithdrawalHolds(customerId: string) {
  const reservations = await db.query<Pick<
    CeloxWithdrawalReservationRow,
    "reservation_id" | "reference_id" | "amount_satang" | "reservation_state" | "updated_at"
  >>(`
    SELECT reservation_id, reference_id, amount_satang, reservation_state, updated_at
    FROM celox_withdrawal_reservations
    WHERE customer_id = ?
    ORDER BY updated_at DESC
  `, [customerId]);
  const confirmations = await db.query<Pick<
    CeloxWithdrawalRow,
    "transaction_id" | "order_id" | "reference_id" | "amount_satang" | "confirmation_state" | "updated_at"
  >>(`
    SELECT transaction_id, order_id, reference_id, amount_satang, confirmation_state, updated_at
    FROM celox_withdrawals
    WHERE customer_id = ? AND transaction_status = 'PENDING' AND funds_reserved = true
    ORDER BY updated_at DESC
  `, [customerId]);

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

export async function resolveCeloxWithdrawalHold(input: {
  customerId: string;
  key: string;
  action: "release-reservation" | "reset-confirmation";
}) {
  return await tx(async (t) => {
    if (input.action === "release-reservation") {
      const reservation = await t.first<CeloxWithdrawalReservationRow>(`
        SELECT * FROM celox_withdrawal_reservations
        WHERE reservation_id = ? AND customer_id = ?
      `, [input.key, input.customerId]);
      if (!reservation) throw new Error("ไม่พบยอดจอง Create ของลูกค้ารายนี้");
      const canRelease = reservation.reservation_state === "uncertain"
        || isStaleCeloxOperation(reservation.updated_at);
      if (!canRelease) throw new Error("รายการ Create ยังไม่พ้นช่วงประมวลผล ห้ามปลดยอดจองตอนนี้");
      const released = await t.run(`
        UPDATE customers
        SET withdrawable_satang = withdrawable_satang + ?
        WHERE id = ? AND withdrawable_satang + ? <= balance_satang
      `, [
        reservation.amount_satang,
        reservation.customer_id,
        reservation.amount_satang,
      ]);
      if (released.rowCount !== 1) throw new Error("คืนยอดจอง Create ไม่สำเร็จ");
      await t.run("DELETE FROM celox_withdrawal_reservations WHERE reservation_id = ?",
        [reservation.reservation_id]);
      return;
    }

    const intent = await t.first<CeloxWithdrawalRow>(`
      SELECT * FROM celox_withdrawals
      WHERE transaction_id = ? AND customer_id = ?
    `, [input.key, input.customerId]);
    if (!intent || intent.transaction_status !== "PENDING" || !intent.funds_reserved) {
      throw new Error("ไม่พบรายการ Confirm ที่ยังกันยอดไว้ของลูกค้ารายนี้");
    }
    const canReset = intent.confirmation_state === "uncertain"
      || (intent.confirmation_state === "confirming" && isStaleCeloxOperation(intent.updated_at));
    if (!canReset) throw new Error("รายการ Confirm ยังไม่พร้อมให้ปลด claim");
    await t.run(`
      UPDATE celox_withdrawals
      SET confirmation_state = 'ready', updated_at = ?
      WHERE transaction_id = ?
    `, [new Date().toISOString(), intent.transaction_id]);
  });
}

export async function queueCeloxCallbackRetry(eventId: number, customerId: string) {
  return await tx(async (t) => {
    const event = await t.first<CeloxCallbackRow & { linked_customer_id: string | null }>(`
      SELECT e.*, COALESCE(e.customer_id, d.customer_id, w.customer_id, r.customer_id) AS linked_customer_id
      FROM celox_callback_events e
      LEFT JOIN celox_deposits d ON d.transaction_id = e.transaction_id
      LEFT JOIN celox_withdrawals w ON w.transaction_id = e.transaction_id
      LEFT JOIN celox_withdrawal_reservations r
        ON e.reference_id IS NOT NULL
        AND r.reference_id = e.reference_id
        AND r.amount_satang = e.amount_satang
      WHERE e.id = ?
    `, [eventId]);
    if (!event || event.linked_customer_id !== customerId) {
      throw new Error("ไม่พบ callback ของลูกค้ารายนี้");
    }
    if (event.processing_state === "applied" || event.processing_state === "recorded") return;
    await t.run(`
      UPDATE celox_callback_events
      SET processing_state = 'pending', last_error = NULL, processed_at = NULL
      WHERE id = ?
    `, [eventId]);
  });
}

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

    // เดิม (ก่อนพอร์ตไป Postgres) เช็ค "ไม่พบข้อมูลลูกค้าที่เลือก" นอก transaction ทั้งหมด
    // ก่อนเช็คคู่รายการ C2C ใดๆ คงลำดับข้อความนั้นไว้ด้วยการอ่านแบบไม่ล็อกก่อน — การล็อกจริง
    // เพื่อกัน TOCTOU เกิดขึ้นทีหลังตอนอ่านแบบเรียง id ข้างล่าง
    const customerFound = await t.first<{ id: string }>(
      "SELECT id FROM customers WHERE id = ?", [input.customerId]);
    if (!customerFound) throw new Error("ไม่พบข้อมูลลูกค้าที่เลือก");

    if (!input.counterpartyCustomerId) throw new Error("กรุณาเลือกลูกค้าคู่รายการ C2C");
    if (input.counterpartyCustomerId === input.customerId) {
      throw new Error("บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน");
    }

    // ล็อกทีละแถวเรียงตาม id จากน้อยไปมาก เพื่อกัน deadlock เมื่อมีสองรายการโอน
    // สวนทางกันระหว่างลูกค้าคู่เดียวกัน (Postgres ไม่รับประกันลำดับล็อกของ ORDER BY
    // ในคำสั่งเดียว จึงต้องยิงทีละคำสั่งตามลำดับที่กำหนดเอง)
    const locked: CustomerRow[] = [];
    for (const id of [input.customerId, input.counterpartyCustomerId].sort()) {
      const row = await t.first<CustomerRow>(
        "SELECT * FROM customers WHERE id = ? FOR UPDATE", [id]);
      if (row) locked.push(row);
    }

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

    const credited = await t.run(`
      UPDATE customers
      SET balance_satang = balance_satang + ?, withdrawable_satang = withdrawable_satang + ?
      WHERE id = ?
    `, [amountSatang, amountSatang, target.id]);
    // แถวนี้ถูกล็อกด้วย FOR UPDATE และพิสูจน์แล้วว่ามีอยู่จริงข้างบน จึงไม่ควรเกิดขึ้นวันนี้ แต่ทุก
    // UPDATE เงินอื่นในไฟล์นี้มีการ์ด rowCount กำกับ — ถ้ามีคนย้ายหรือถอด FOR UPDATE ออกในอนาคต
    // การ์ดนี้จะยังจับความล้มเหลวได้แทนที่จะปล่อยให้เงินหายเงียบๆ
    if (credited.rowCount !== 1) {
      throw new Error(target.id === selected.id ? "ไม่พบข้อมูลลูกค้าที่เลือก" : "ไม่พบลูกค้าคู่รายการ C2C");
    }

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
