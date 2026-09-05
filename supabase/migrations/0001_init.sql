-- Migration 0001: schema เริ่มต้น พอร์ตจาก SQLite (lib/db.ts) มาเป็น Postgres
--
-- แปลงตามกฎ:
--   INTEGER PRIMARY KEY AUTOINCREMENT      -> bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
--   INTEGER NOT NULL CHECK (x IN (0, 1))   -> boolean NOT NULL (ค่า default 0/1 -> false/true)
--   INTEGER ที่เป็นจำนวนเงินหรือตัวนับ      -> bigint
--   TEXT ที่เก็บ ISO 8601 (เวลา)            -> timestamptz
--   TEXT อื่นๆ                              -> text
--
-- ห้ามลบ CHECK (balance_satang >= 0) และ CHECK (withdrawable_satang >= 0 AND
-- withdrawable_satang <= balance_satang) — เป็นตาข่ายกันยอดเพี้ยนชั้นสุดท้าย

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  account text NOT NULL UNIQUE,
  initials text NOT NULL,
  color text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  balance_satang bigint NOT NULL DEFAULT 0 CHECK (balance_satang >= 0),
  withdrawable_satang bigint NOT NULL DEFAULT 0 CHECK (withdrawable_satang >= 0 AND withdrawable_satang <= balance_satang),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  counterparty_customer_id text REFERENCES customers(id),
  direction text NOT NULL CHECK (direction IN ('deposit', 'withdraw')),
  channel text NOT NULL CHECK (channel IN ('account', 'c2c')),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('pending', 'success', 'failed')),
  transfer_group_id text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS celox_deposits (
  transaction_id text PRIMARY KEY,
  order_id text NOT NULL,
  reference_id text,
  customer_id text NOT NULL REFERENCES customers(id),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  transaction_status text NOT NULL CHECK (transaction_status IN ('SUCCESS', 'PENDING_APPROVE', 'PENDING_TRANSFER', 'EXPIRED')),
  local_transaction_id text UNIQUE REFERENCES transactions(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS celox_deposit_slip_claims (
  transaction_id text PRIMARY KEY REFERENCES celox_deposits(transaction_id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS celox_withdrawals (
  transaction_id text PRIMARY KEY,
  order_id text NOT NULL,
  reference_id text,
  customer_id text NOT NULL REFERENCES customers(id),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  destination_bank_code text NOT NULL,
  destination_account_name text NOT NULL,
  destination_account_no text NOT NULL,
  transaction_status text NOT NULL CHECK (transaction_status IN ('PENDING', 'SUCCESS')),
  confirmation_state text NOT NULL DEFAULT 'ready'
    CHECK (confirmation_state IN ('ready', 'confirming', 'uncertain', 'success')),
  funds_reserved boolean NOT NULL DEFAULT false,
  occurred_at timestamptz,
  local_transaction_id text UNIQUE REFERENCES transactions(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS celox_withdrawal_reservations (
  reservation_id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  reference_id text UNIQUE,
  destination_bank_code text NOT NULL,
  destination_account_name text NOT NULL,
  destination_account_no text NOT NULL,
  reservation_state text NOT NULL DEFAULT 'creating'
    CHECK (reservation_state IN ('creating', 'uncertain')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS celox_callback_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id text NOT NULL,
  order_id text NOT NULL,
  reference_id text,
  provider_status text NOT NULL,
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  occurred_at timestamptz,
  customer_id text REFERENCES customers(id),
  transaction_kind text CHECK (transaction_kind IN ('deposit', 'withdraw')),
  processing_state text NOT NULL DEFAULT 'pending'
    CHECK (processing_state IN ('pending', 'applied', 'recorded', 'unmatched', 'failed')),
  local_transaction_id text REFERENCES transactions(id),
  attempt_count bigint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  received_count bigint NOT NULL DEFAULT 1 CHECK (received_count > 0),
  last_error text,
  received_at timestamptz NOT NULL,
  last_received_at timestamptz NOT NULL,
  processed_at timestamptz,
  UNIQUE (transaction_id, provider_status)
);

CREATE TABLE IF NOT EXISTS celox_c2c_transactions (
  transaction_id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE,
  reference_id text UNIQUE,
  customer_id text NOT NULL REFERENCES customers(id),
  direction text NOT NULL CHECK (direction IN ('deposit', 'withdraw')),
  transaction_status text NOT NULL,
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  fee_amount_satang bigint NOT NULL DEFAULT 0 CHECK (fee_amount_satang >= 0),
  settled_amount_satang bigint NOT NULL DEFAULT 0 CHECK (settled_amount_satang >= 0),
  held_amount_satang bigint NOT NULL DEFAULT 0 CHECK (held_amount_satang >= 0),
  awaiting_manual_review boolean NOT NULL DEFAULT false,
  match_deadline timestamptz,
  funds_reserved boolean NOT NULL DEFAULT false,
  local_transaction_id text NOT NULL UNIQUE REFERENCES transactions(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS celox_c2c_withdrawal_reservations (
  reservation_id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  reference_id text NOT NULL UNIQUE,
  reservation_state text NOT NULL DEFAULT 'creating'
    CHECK (reservation_state IN ('creating', 'uncertain')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS celox_c2c_callback_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id text NOT NULL,
  order_id text NOT NULL,
  reference_id text,
  provider_status text NOT NULL,
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  occurred_at timestamptz,
  provider_event text,
  signed_payload_hash text NOT NULL CHECK (length(signed_payload_hash) = 64),
  has_transfer_to boolean NOT NULL DEFAULT false,
  customer_id text REFERENCES customers(id),
  direction text CHECK (direction IN ('deposit', 'withdraw')),
  processing_state text NOT NULL DEFAULT 'pending'
    CHECK (processing_state IN ('pending', 'applied', 'recorded', 'unmatched', 'failed')),
  local_transaction_id text REFERENCES transactions(id),
  attempt_count bigint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  received_count bigint NOT NULL DEFAULT 1 CHECK (received_count > 0),
  last_error text,
  received_at timestamptz NOT NULL,
  last_received_at timestamptz NOT NULL,
  processed_at timestamptz,
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
