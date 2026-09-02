# Design System

## Direction

ภาพของโต๊ะปฏิบัติการการเงินไทยช่วงสายภายใต้แสงสำนักงานที่สว่าง: ข้อมูลนิ่ง ชัด แม่นยำ และสงบ มีสีส้มเทอร์ราคอตตาแบบ Claude เป็นลายเซ็นที่ให้ความอบอุ่นและความมั่นใจ

## Color Strategy

Minimal restrained product palette. ขาว เทาที่เจือ hue ของแบรนด์เล็กน้อย และดำเป็นสัดส่วนหลัก สีส้มเทอร์ราคอตตาใช้กับ brand mark, primary action, current selection และ data highlight เท่านั้น สีเขียวและแดงยังสงวนให้ความหมายฝาก–ถอน

```css
--color-bg: oklch(0.985 0.003 40);
--color-surface: oklch(0.97 0.005 40);
--color-ink: oklch(0.18 0.008 40);
--color-muted: oklch(0.5 0.01 40);
--color-primary: oklch(0.67 0.13 40);
--color-primary-strong: oklch(0.49 0.12 35);
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
