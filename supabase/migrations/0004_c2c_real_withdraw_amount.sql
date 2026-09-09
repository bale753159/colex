-- Celox เปลี่ยน contract ของ C2C (ทั้ง GET /v1/core/c2c/{reference} และ Callback C2C)
--
-- 1. `settledAmount` ถูกเปลี่ยนชื่อเป็น `realWithdrawAmount` และไม่มีชื่อเดิมอีกแล้ว
-- 2. `amount` กลับมาเป็น "ยอดตั้งต้นที่ลูกค้าขอ" เสมอ ไม่ถูกเขียนทับด้วยยอดที่จบจริง
--    อีกต่อไป — เดิมโค้ดหักเงินลูกค้าจาก amount ของ callback ได้เพราะ Celox เขียนทับ
--    ค่านั้นให้ ตอนนี้ทำแบบนั้นจะหักเกินทุกครั้งที่ปิดคู่ได้ไม่ครบยอด
-- 3. `unfilledAmount` นับทุกบาทที่ไม่สำเร็จ (รวมก้อนที่ถูกยกเลิก/หมดเวลาเต็มยอด)
--    เป็นตัวเลขเสมอบนฝั่งถอน และ null เสมอบนฝั่งฝาก
--
-- ตาราง callback events จึงต้องมีที่เก็บยอดที่ใช้ตัดเงินจริงของตัวเอง แทนการอ่าน
-- จาก amount_satang และ `occurred_at`/`provider_event` ถูกถอดออกเพราะ contract
-- ใหม่ไม่มี field `occurredAt`/`event` ใน body แล้ว

ALTER TABLE celox_c2c_transactions
  RENAME COLUMN settled_amount_satang TO real_withdraw_amount_satang;

ALTER TABLE celox_c2c_transactions
  ADD COLUMN IF NOT EXISTS unfilled_amount_satang bigint
    CHECK (unfilled_amount_satang IS NULL OR unfilled_amount_satang >= 0);

ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS real_withdraw_amount_satang bigint NOT NULL DEFAULT 0
    CHECK (real_withdraw_amount_satang >= 0);

ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS unfilled_amount_satang bigint
    CHECK (unfilled_amount_satang IS NULL OR unfilled_amount_satang >= 0);

ALTER TABLE celox_c2c_callback_events DROP COLUMN IF EXISTS occurred_at;
ALTER TABLE celox_c2c_callback_events DROP COLUMN IF EXISTS provider_event;

-- head `transactionStatus` เป็น roll-up ที่เป็น SUCCESS ได้ทั้งที่ยังมีก้อนวิ่งอยู่ จึงใช้
-- เป็นสัญญาณว่า "คำขอจบแล้ว" ไม่ได้ — ความจริงข้อนั้นอยู่ใน parts[].transactionStatus
-- อย่างเดียว เก็บผลสรุปสองข้อที่ใช้ตัดสินใจตอน process ไว้ตอน enqueue (parts เต็มก้อน
-- ยังดูย้อนหลังได้จาก celox_c2c_callback_raw_logs)
ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS all_parts_terminal boolean NOT NULL DEFAULT false;

ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS any_part_succeeded boolean NOT NULL DEFAULT false;

-- awaitingManualReview มาจาก body ตรงๆ ไม่เดาจากสถานะอีกต่อไป (contract ใหม่ถอด
-- PENDING_MANUAL_C2C ออกจากเงื่อนไขนี้ เพราะคิวถูกจับคู่ด้วยเครื่องเองทุกไม่กี่วินาที)
ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS awaiting_manual_review boolean NOT NULL DEFAULT false;
