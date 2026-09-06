-- Seed data พอร์ตจาก seedDatabase() ใน lib/db.ts (บรรทัด 280-315)
-- ทุก INSERT ปิดท้ายด้วย ON CONFLICT DO NOTHING เพื่อให้รันซ้ำได้อย่างปลอดภัย
--
-- หมายเหตุ: ต้นฉบับ seedDatabase() มีลูกค้าตัวอย่าง 5 คน (ไม่ใช่ 7) — คัดลอกมาตามจริง

INSERT INTO customers (id, name, account, initials, color, phone, email, bank_code, bank_account_no, balance_satang, withdrawable_satang, created_at)
VALUES
  ('C-1024', 'วรพงษ์ มณีสอน', 'ACC-90241', 'ว', 'violet', '081-234-5678', 'nattawut@example.com', '014', '1234567890', 0, 0, '2026-07-12T09:15:00+07:00'),
  ('C-1081', 'พิมพ์ชนก วงศ์คำ', 'ACC-79126', 'พ', 'cyan', '089-118-2046', 'pimchanok@example.com', '004', '2345678901', 465000, 430000, '2026-07-18T11:30:00+07:00'),
  ('C-1093', 'บริษัท สยามเน็กซ์ จำกัด', 'ACC-68403', 'ส', 'amber', '02-118-2900', 'finance@siamnext.co.th', '002', '3456789012', 1250000, 1150000, '2026-07-22T14:10:00+07:00'),
  ('C-1137', 'ธนกฤต มั่นคง', 'ACC-55718', 'ธ', 'blue', '086-425-7710', 'thanakrit@example.com', '006', '4567890123', 310000, 310000, '2026-08-02T10:00:00+07:00'),
  ('C-1162', 'จิราพร แสงทอง', 'ACC-43092', 'จ', 'rose', '095-662-9184', 'jiraporn@example.com', '025', '5678901234', 580000, 520000, '2026-08-08T15:45:00+07:00')
ON CONFLICT DO NOTHING;

INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, note, status, created_at)
VALUES
  ('TXN-240830-500', 'C-1081', 'withdraw', 'account', 85000, 'ถอนเข้าบัญชีธนาคาร', 'success', '2026-08-30T09:18:00+07:00'),
  ('TXN-240829-498', 'C-1093', 'deposit', 'account', 600000, 'เงินทุนหมุนเวียน', 'success', '2026-08-29T16:05:00+07:00'),
  ('TXN-240829-492', 'C-1137', 'withdraw', 'account', 120000, 'ถอนเงินสด', 'success', '2026-08-29T13:37:00+07:00'),
  ('TXN-240828-487', 'C-1162', 'deposit', 'account', 340000, 'ฝากเงินเข้ากระเป๋าหลัก', 'success', '2026-08-28T11:20:00+07:00')
ON CONFLICT DO NOTHING;
