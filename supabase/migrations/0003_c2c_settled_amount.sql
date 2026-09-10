-- สัญญา C2C ใหม่: body ของ callback เท่ากับ body ของ GET /v1/core/c2c/{reference} ทุก field
-- ยอดที่นับจริงคือ settledAmount (ไม่ใช่ amount) และมี unfilledAmount/awaitingManualReview เพิ่มเข้ามา
-- ส่วน occurredAt / event ถูกถอดออกจากสัญญาไปแล้ว จึงต้องเลิกเก็บ ไม่ใช่ปล่อยให้เป็น NULL ค้างไว้

ALTER TABLE celox_c2c_transactions
  ADD COLUMN IF NOT EXISTS unfilled_amount_satang bigint
    CHECK (unfilled_amount_satang IS NULL OR unfilled_amount_satang >= 0);

ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS settled_amount_satang bigint NOT NULL DEFAULT 0
    CHECK (settled_amount_satang >= 0),
  ADD COLUMN IF NOT EXISTS unfilled_amount_satang bigint
    CHECK (unfilled_amount_satang IS NULL OR unfilled_amount_satang >= 0),
  ADD COLUMN IF NOT EXISTS awaiting_manual_review boolean NOT NULL DEFAULT false,
  -- คำนวณจาก parts[] ตอนรับเข้า inbox เพราะ parts เองไม่ถูกเก็บต่อ และ transactionStatus
  -- ที่หัว body เป็น roll-up ที่บอกไม่ได้ว่าคำขอปิดจบแล้วหรือยัง
  ADD COLUMN IF NOT EXISTS all_parts_terminal boolean NOT NULL DEFAULT false;

ALTER TABLE celox_c2c_callback_events
  DROP COLUMN IF EXISTS occurred_at,
  DROP COLUMN IF EXISTS provider_event;
