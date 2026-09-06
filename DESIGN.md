# Design System

## Direction

ภาพของโต๊ะปฏิบัติการการเงินไทยช่วงสายภายใต้แสงสำนักงานที่สว่าง: ข้อมูลนิ่ง ชัด แม่นยำ และสงบ มีสีทองอ่อนเป็นลายเซ็นที่ให้ความอบอุ่น น่าเชื่อถือ และไม่ล้าตาเมื่อมองนาน

## Color Strategy

Minimal restrained product palette. ขาว เทาที่เจือ hue ของแบรนด์เล็กน้อย และดำเป็นสัดส่วนหลัก สีทองใช้กับ brand mark, primary action, current selection และ data highlight เท่านั้น

สีทองคุม chroma ไว้ต่ำ (~0.115) เพื่อไม่ให้แสบตา และแยกเป็นสองระดับ: `--primary` ทองสว่างสำหรับ accent และพื้นผิว (ใช้คู่กับ `--on-primary` เพราะตัวอักษรขาวบนทองสว่าง contrast ไม่ผ่าน) ส่วน `--primary-strong` ทองบรอนซ์เข้มสำหรับตัวอักษรและปุ่มทึบที่ใช้ตัวอักษรสีขาว

สีเขียวและแดงยังสงวนให้ความหมายฝาก–ถอน ส่วนโทน warning/pending ย้ายไปที่ hue ~58 (ส้มอำพัน) เพื่อไม่ให้ชนกับสีทองของแบรนด์

```css
--color-bg: oklch(0.985 0.004 88);
--color-surface: oklch(0.97 0.007 88);
--color-ink: oklch(0.19 0.009 88);
--color-muted: oklch(0.5 0.012 88);
--color-primary: oklch(0.75 0.115 90);
--color-primary-strong: oklch(0.455 0.08 84);
--color-on-primary: oklch(0.24 0.045 84);
```

## Typography

ใช้ Noto Sans Thai Variable ทั้งระบบ ตัวเลขใช้ tabular numerals เพื่อให้ตารางและยอดเงินเทียบกันได้ง่าย ขนาดหัวเรื่องคงที่ตามรูปแบบ product UI และไม่มี display typography ที่รบกวนงาน

## Layout

Desktop ใช้ sidebar 232px และพื้นที่ทำงานที่กว้างสูงสุด 1440px ภายใน ส่วนมือถือเปลี่ยนเป็น top navigation แถวเดียว สรุปยอดเลื่อนแนวนอนได้ และตารางซ่อนข้อมูลรองตามลำดับความสำคัญ

## Components

- Summary metrics: กลุ่มเดียวมีเส้นแบ่ง ไม่แยกเป็นการ์ดลอยจำนวนมาก
- Balance panel: พื้นเข้มเพื่อเป็น anchor ของหน้า พร้อม quick actions ฝากและถอน
- Transaction table: แถวสูง 72px, สถานะชัด, จำนวนเงินจัดชิดขวา, มี action ต่อแถว
- Transaction dialog: เลือกลูกค้า กรอกจำนวนและบันทึก แล้วตรวจสอบสรุปก่อนยืนยัน
- Customer directory: ตารางเต็มบน desktop และ compact account rows บนมือถือ เห็นยอดคงเหลือกับยอดที่ถอนได้ทันที
- C2C picker: เริ่มจากเลือก 1 ใน 4 รูปแบบ แล้วเปิดเฉพาะข้อมูลต้นทาง/ปลายทางที่เกี่ยวข้องเพื่อลดความผิดพลาด
- C2C transactions: หน้าแยกแบบ master-detail สำหรับค้นหา poll สถานะ ดู parts และยกเลิกรายการที่ยัง PENDING โดยไม่แสดงรายละเอียดบัญชีบุคคลที่สามในรายการรวม
- Toast: ยืนยันผลแบบสั้นและไม่บังเนื้อหา

## Motion

ใช้ 160–220ms เพื่อแสดง hover, dialog และ feedback เท่านั้น ปิด transform และ transition ที่ไม่จำเป็นเมื่อ prefers-reduced-motion
