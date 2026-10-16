# แสดงขั้นตอน Callback C2C ใน dialog ฝาก/ถอน

> เอกสารนี้เขียนเพื่อส่งต่อให้ทีมอื่นทำแบบเดียวกันในโปรเจกต์ของตัวเอง
> อธิบาย "อะไร + ทำไม" ไม่ใช่ diff — ชื่อไฟล์/คลาส/สไตล์ให้ปรับตามโค้ดเบสของแต่ละทีม
> อ้างอิงการทำงานจริง: repo `itstore-finance` · endpoint `GET /api/celox/c2c/{id}/events`

---

## โจทย์

dialog ฝากเงินแบบ C2C และถอนเงินแบบ C2C เดิมบอกได้แค่สถานะล่าสุดที่ได้จาก
`GET /v1/core/c2c/{reference}` เจ้าหน้าที่จึงไม่รู้ว่า **Celox ยิง callback มาหรือยัง**
และ **ระบบเราทำอะไรกับ callback ก้อนนั้นไปแล้ว**

ต้องการ: เมื่อได้รับ callback จาก Celox ให้ขึ้นข้อความในโมดัลว่ารายการเดินมาถึงขั้นตอนไหน

---

## หลักการที่ต้องยึด (อ่านก่อนเขียนโค้ด)

1. **อ่านจากฐานข้อมูลของเรา ไม่ใช่จาก Celox**
   ฟีดนี้ต้องตอบคำถามว่า "webhook ลงถึงเราหรือยัง" ซึ่ง Celox ตอบให้ไม่ได้อยู่แล้ว
   และการ poll Celox ถี่ ๆ จะโดน `429 rate_limited` — อ่าน inbox ของตัวเองจึง poll ทุก 4 วินาทีได้
2. **แยกสองชั้นให้ชัดในทุกบรรทัดที่แสดง**
   - *สถานะที่ Celox รายงาน* (`transactionStatus` ของ callback ก้อนนั้น)
   - *สิ่งที่ระบบเราทำกับมันแล้ว* (`processing_state` ใน inbox ของเรา)
   สองอย่างนี้ไม่เท่ากัน — callback ที่รับเข้ามาสำเร็จ (ตอบ 2xx ให้ Celox แล้ว) ยังประมวลผล
   ต่อไม่สำเร็จได้ ถ้าแสดงชั้นเดียวเจ้าหน้าที่จะเข้าใจผิดว่าเงินขยับแล้ว
3. **ห้ามปิดโมดัลเองเมื่อสถานะเปลี่ยน** ถ้าปิดเอง เจ้าหน้าที่จะไม่ทันเห็นขั้นที่ไปถึง
   ให้รีเฟรชหน้ารายการเบื้องหลังได้ แต่ปล่อยให้คนกดปิด
4. **ดึงครั้งแรกเสมอ แม้รายการจบไปแล้ว** แล้วค่อยหยุด poll — ไม่งั้นรายการที่ปิดแล้วจะขึ้นว่า
   "ยังไม่ได้รับ callback" ทั้งที่ได้รับไปแล้ว
5. **นิยาม terminal ของฝั่งถอนกับฝั่งฝากไม่เหมือนกัน** ดูหัวข้อ "กับดัก" ข้อ 3

---

## ส่วนที่ 1 — Endpoint อ่าน callback ที่ inbox ได้รับจริง

`GET /api/celox/c2c/{id}/events`

`{id}` รับได้ทั้ง `orderId`, `referenceId` และ `transactionId` — dialog ถือคนละตัวกันในแต่ละ
ขั้นตอน จึงต้องหาให้ครบทั้งสามแบบ ไม่งั้นฟีดจะว่างเปล่าโดยไม่มีเหตุผลที่อธิบายได้

**Response**

```ts
type CeloxC2CCallbackStep = {
  status: C2CTransactionStatus;            // สถานะที่ Celox รายงานใน callback ก้อนนั้น
  processingState:                          // สิ่งที่ระบบเราทำกับก้อนนั้นแล้ว
    | "pending"      // รับเข้า inbox แล้ว กำลังประมวลผล
    | "applied"      // ปรับยอดในระบบแล้ว
    | "recorded"     // บันทึกสถานะแล้ว แต่ยังไม่ถึงขั้นที่ต้องขยับยอด
    | "unmatched"    // ยังหารายการที่ผูกกับ callback นี้ไม่เจอ
    | "failed";      // ประมวลผลไม่สำเร็จ (ดู lastError)
  settledAmount: number;                    // ยอดที่ปิดได้จริง — ยอดเดียวที่ใช้ตัดสินใจเรื่องเงิน
  unfilledAmount: number | null;            // ขาถอนเป็นตัวเลขเสมอ ขาฝากเป็น null เสมอ
  awaitingManualReview: boolean;
  allPartsTerminal: boolean;                // ทุกก้อนใน parts ถึง terminal แล้วหรือยัง
  receivedCount: number;                    // Celox ส่งซ้ำกี่ครั้ง
  receivedAt: string;
  lastReceivedAt: string;
  lastError: string | null;
};

type CeloxC2CCallbackTimeline = {
  found: boolean;
  transactionId: string | null;
  transactionStatus: C2CTransactionStatus | null;  // สถานะปัจจุบันของแถวในระบบเรา
  updatedAt: string | null;
  steps: CeloxC2CCallbackStep[];                   // เรียงตามเวลาที่รับเข้ามา
};
```

**ฝั่ง DB**

```
1. หาแถวรายการ C2C ด้วย transaction_id OR order_id OR reference_id (LIMIT 1)
2. ดึง callback ทุกก้อนจาก inbox ด้วย transaction_id ที่ได้ ORDER BY received_at
3. ถ้าไม่เจอแถวรายการ แต่ key ที่ส่งมาเป็น transactionId ตรง ๆ ก็ยังตอบ callback ที่ค้างใน inbox ได้
   (เคสนี้เกิดจริงตอน callback มาถึงก่อนที่ flow สร้างรายการจะ commit)
```

`found: false` = ไม่มีทั้งแถวรายการและ callback — ต่างจาก `found: true, steps: []`
ที่แปลว่า "มีรายการแล้วแต่ Celox ยังไม่ยิงอะไรมา" หน้าจอต้องแยกสองเคสนี้ได้

**ไม่ต้องมี auth เพิ่ม** ถ้า endpoint สถานะเดิมของโปรเจกต์ป้องกันอยู่แล้ว ให้ใช้ชั้นเดียวกัน
และ **ห้ามคืน raw body ของ callback ออกไปหน้าเว็บ** ในนั้นมีข้อมูลบัญชีบุคคลที่สาม

---

## ส่วนที่ 2 — คอมโพเนนต์ฟีด

คอมโพเนนต์ตัวเดียวใช้ร่วมกันทั้ง dialog ฝากและถอน

```ts
type Props = {
  reference: string;      // orderId | referenceId | transactionId
  active?: boolean;       // true = เฝ้าต่อเป็นรอบ · false = ดึงครั้งเดียวแล้วหยุด
  onSteps?: (steps: CeloxC2CCallbackStep[]) => void;
};
```

**พฤติกรรม**

- ดึงครั้งแรกทันทีเสมอ ต่อให้ `active === false`
- ตั้ง `setTimeout` รอบถัดไป **เฉพาะเมื่อ `active === true`** (ไม่ใช้ `setInterval` — กันคำขอซ้อน
  เวลาเครือข่ายช้า) ยกเลิกด้วย `AbortController` ตอน unmount
- `active` ควรผูกกับ "รายการยังไม่ถึง terminal" ไม่ใช่แค่ "โมดัลเปิดอยู่"

**สิ่งที่แสดงต่อหนึ่งก้อน**

| ส่วน | มาจาก |
|---|---|
| ป้ายสถานะภาษาไทย + เวลาที่รับ | `status` → ตารางแปลสถานะที่มีอยู่แล้ว, `lastReceivedAt` |
| คำอธิบายว่าสถานะนี้แปลว่าอะไร | ตารางคำอธิบายสถานะที่มีอยู่แล้ว |
| ระบบเราทำอะไรไปแล้ว | `processingState` (+ `settledAmount`, `allPartsTerminal`, `lastError`) |
| ธง "รอเจ้าหน้าที่ Celox ตรวจสอบ" | `awaitingManualReview === true` |
| ธง "Celox ส่งซ้ำ N ครั้ง" | `receivedCount > 1` |

ข้อความของ `processingState` ที่ใช้จริง:

| state | ข้อความ |
|---|---|
| `applied` + `settledAmount > 0` | ปรับยอดในระบบแล้ว · ยอดที่ปิดได้จริง ฿X |
| `applied` + `settledAmount === 0` | ปิดรายการในระบบแล้ว โดยไม่มียอดที่ปิดได้จริง |
| `recorded` + `allPartsTerminal` | บันทึกสถานะแล้ว ยังไม่ถึงขั้นที่ต้องขยับยอด |
| `recorded` + ยังไม่ terminal ทุกก้อน | บันทึกสถานะแล้ว · ยังมีก้อนย่อยที่ยังไม่จบ จึงยังไม่ขยับยอด |
| `pending` | รับเข้าระบบแล้ว กำลังประมวลผล |
| `unmatched` | รับเข้าระบบแล้ว แต่ยังหารายการที่ผูกกับ callback นี้ไม่เจอ |
| `failed` | ประมวลผลไม่สำเร็จ · {lastError} |

**ตอนยังไม่มี callback** อย่าปล่อยว่าง ให้บอกว่า Celox ยิงเมื่อสถานะเปลี่ยน และระหว่างนี้ระบบ
ยังตรวจสถานะจาก Celox ควบคู่อยู่ — ไม่งั้นเจ้าหน้าที่จะคิดว่าหน้าจอค้าง

ครอบด้วย `aria-live="polite"` เพราะเนื้อหาอัปเดตเองโดยผู้ใช้ไม่ได้กดอะไร

---

## ส่วนที่ 3 — จุดที่เอาไปแปะในแต่ละ dialog

**dialog ฝาก** — แปะ 3 ที่
- ขั้นรอจับคู่ (`active` = อยู่ในขั้นนี้)
- ขั้นรอโอนเงิน/แนบสลิป (`active` = อยู่ในขั้นนี้) — callback ที่ทำให้รายการจบมาในขั้นนี้
- หน้าสรุปผล (`active` = ผลยังไม่ใช่ `SUCCESS`)

**dialog ถอน** — แปะที่หน้าผลรายการ (`active` = ยังไม่ถึง terminal)

**สิ่งที่ต้องแก้ควบคู่ในโมดัลถอน:** ของเดิมพอ poll เห็น `PENDING_TRANSFER`/`SUCCESS`/`CANCELLED`
แล้ว **ปิดหน้าต่างเอง** ต้องเลิกทำ เปลี่ยนเป็นเก็บผล GET ลง state แล้วอัปเดตสถานะในหน้าต่างแทน
พร้อมเรียก callback รีเฟรชหน้ารายการเบื้องหลัง · ปุ่ม "ยกเลิกรายการ" ต้องดูสถานะสดจาก GET
ไม่ใช่สถานะตอนสร้างรายการที่ค้างอยู่ใน state

---

## กับดักที่ต้องระวัง

1. **อย่า poll Celox เพื่อทำฟีดนี้** ฟีดตอบคำถามคนละข้อกับ GET สถานะ และจะกิน rate limit
   จนการ poll สถานะจริงพัง — สอง endpoint นี้อยู่ด้วยกันได้ เพราะตัวหนึ่งอ่าน DB ตัวเองอย่างเดียว
2. **`settledAmount` เท่านั้นคือยอดที่ปิดได้จริง** ห้ามเอา `amount` มาแสดงว่าเป็นยอดที่เข้า/ออก
   คำขอถอน 250 ที่ปิดได้ 100 จะมี `amount: 250, settledAmount: 100, unfilledAmount: 150`
3. **นิยาม terminal มีสองชุด อย่าใช้ปนกัน**
   - ตามสัญญา C2C: `SUCCESS` / `EXPIRED` / `CANCELLED` — ใช้กับ **ฝั่งถอน** และตรรกะเรื่องเงิน
   - ของ UI ฝั่งฝาก: ไม่นับ `EXPIRED` เพราะ `EXPIRED` ของขาฝากแปลว่า "สลิปไม่ผ่าน แนบใหม่ได้"
     ยังไม่จบรายการ
   ถ้าใช้ตัวของ UI กับฝั่งถอน รายการที่ `EXPIRED` จะ poll ค้างไปตลอด
4. **`allPartsTerminal` มาจาก `parts[]` ตอนรับเข้า inbox** ไม่ใช่จาก `transactionStatus` ที่หัว body
   หัว body เป็น roll-up ที่กลายเป็น `SUCCESS` ตั้งแต่ก้อนแรกสำเร็จ ถ้าใช้ตัวนั้นหน้าจอจะบอกว่า
   "จบแล้ว" ทั้งที่ยังมีก้อนวิ่งอยู่ (ต้องเก็บค่านี้เป็นคอลัมน์ตอน enqueue เพราะ `parts` ไม่ได้ถูกเก็บต่อ)
5. **`key` ของแต่ละก้อนใน list** ใช้ `status + receivedAt` ไม่ใช่ index — inbox คีย์ด้วย
   `transactionId + transactionStatus` อยู่แล้ว จึงไม่ซ้ำ และ index จะทำให้ React reuse ผิดแถว
   เวลามีก้อนใหม่แทรก

---

## เทสต์ที่ควรมี

ฝั่ง DB (ต้องมีของจริง 3 เคส):
- ยิง callback หนึ่งก้อนแล้วประมวลผล → timeline หาเจอด้วยทั้ง `orderId`, `referenceId`
  และ `transactionId` และคืน `processingState`, `settledAmount`, `unfilledAmount`,
  `allPartsTerminal`, `receivedCount` ตรงกับที่บันทึก
- รายการที่ยังไม่มี callback → `found: true`, `steps: []`, `transactionStatus` เป็นสถานะปัจจุบัน
- reference ที่ไม่มีอะไรผูก → `found: false`, `transactionId: null`, `steps: []`

ฝั่ง UI: ตรวจว่า `active: false` ยังยิงคำขอแรก และไม่ตั้งรอบถัดไป

---

## เช็กลิสต์ก่อนปิดงาน

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build          # ยืนยันว่า route ใหม่ถูก register จริง
```

ถ้าโปรเจกต์ยังไม่มีคอลัมน์ `settled_amount_satang` / `unfilled_amount_satang` /
`awaiting_manual_review` / `all_parts_terminal` ใน inbox ของ callback C2C
**ต้องรัน migration ให้เสร็จก่อน deploy** ไม่งั้น callback จะตอบ 5xx และ Celox ไม่ยิงซ้ำ
— callback ก้อนนั้นหายถาวร
