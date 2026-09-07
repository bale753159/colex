-- Migration 0003: log ดิบของ callback C2C ขาเข้าจาก Celox
--
-- ที่มา: celox_c2c_callback_events เก็บเฉพาะ field ที่ parse แล้วสำหรับ business
-- logic เจ้าหน้าที่ที่ตรวจปัญหา callback ต้องเห็น request/response ดิบจริงๆ
-- (url, เวลา, body) ซึ่งไม่มีอยู่ในตาราง event เดิม จึงแยกตารางนี้ไว้บันทึกทุก
-- request ที่เข้ามาที่ /api/celox/c2c/callback โดยไม่สนว่าจะผ่านการตรวจลายเซ็น
-- หรือ validate สำเร็จหรือไม่

CREATE TABLE IF NOT EXISTS celox_c2c_callback_raw_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at timestamptz NOT NULL,
  request_url text NOT NULL,
  request_body text,
  response_status bigint NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body text
);

CREATE INDEX IF NOT EXISTS idx_celox_c2c_callback_raw_logs_received ON celox_c2c_callback_raw_logs(received_at DESC);
