-- Migration 0002: เก็บบัญชีธนาคารของลูกค้าไว้ในตาราง customers
--
-- ที่มา: หน้าฝาก/ถอน C2C เดิมให้เจ้าหน้าที่พิมพ์ธนาคารและเลขบัญชีต้นทาง/ปลายทางเอง
-- ทุกครั้ง ซึ่งพิมพ์ผิดได้และไม่ผูกกับลูกค้าที่เลือก ตอนนี้ย้ายมาเก็บกับลูกค้าแล้ว
-- init ให้อัตโนมัติ เจ้าหน้าที่กรอกแค่ยอดเงิน
--
-- bank_code ใช้รหัสธนาคารของ Celox (lib/celox/banks.ts) ส่วน bank_account_no เก็บ
-- เฉพาะตัวเลข 10–15 หลักตามที่ Celox ตรวจ ค่า default '' หมายถึง "ยังไม่ผูกบัญชี"
-- และหน้าเว็บจะบล็อกไม่ให้เปิดรายการ C2C ให้ลูกค้ารายนั้น

ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_code text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_account_no text NOT NULL DEFAULT '';

-- ข้อมูล mock สำหรับลูกค้าตัวอย่างใน supabase/seed.sql (ยังไม่มีระบบผูกบัญชีจริง)
UPDATE customers SET bank_code = '014', bank_account_no = '1234567890' WHERE id = 'C-1024' AND bank_account_no = '';
UPDATE customers SET bank_code = '004', bank_account_no = '2345678901' WHERE id = 'C-1081' AND bank_account_no = '';
UPDATE customers SET bank_code = '002', bank_account_no = '3456789012' WHERE id = 'C-1093' AND bank_account_no = '';
UPDATE customers SET bank_code = '006', bank_account_no = '4567890123' WHERE id = 'C-1137' AND bank_account_no = '';
UPDATE customers SET bank_code = '025', bank_account_no = '5678901234' WHERE id = 'C-1162' AND bank_account_no = '';
