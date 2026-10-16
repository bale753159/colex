# Prompt: อัปเดต Celox C2C ให้ตรง contract ใหม่ (Check transaction + Callback)

> เอกสารนี้เขียนเพื่อใช้เป็น **prompt** ให้ agent ในโปรเจกต์อื่นที่ integrate Celox C2C
> ทำงานชิ้นเดียวกันซ้ำได้ วางทั้งไฟล์เป็น prompt ได้เลย ส่วน "คำถามที่ต้องถามก่อน"
> ด้านล่างคือจุดที่ **ห้ามเดา** ต้องถามเจ้าของโปรเจกต์นั้นก่อนลงมือ
>
> อ้างอิงการ implement จริง: repo `itstore-finance` commit `da1f763..c171514`,
> migration `supabase/migrations/0004_c2c_settled_amount.sql`

---

## งานที่ต้องทำ

โปรเจกต์นี้ integrate กับ Celox payment platform อยู่แล้ว Celox เปลี่ยน contract ของ C2C
แบบ breaking ต้องแก้โค้ดสองฝั่งให้ตรง contract ใหม่:

1. **Check a C2C transaction** — client ที่เรียก `GET /api/celox/v1/core/c2c/{reference}`
2. **Callback C2C** — webhook ที่เรารับ (เราเป็น server, Celox เป็นคนยิง `POST` มา)

ใช้ภาษา, HTTP client, error type และรูปแบบคอมเมนต์เดิมของโปรเจกต์ ถ้าดูไม่ออกว่าใช้ตัวไหน
ให้ถามก่อน ห้ามใส่ credential ลง source ต้องอ่านจาก configuration/env เท่านั้น

**หลักการที่คุมทั้งงาน:** body ของ `GET /v1/core/c2c/{reference}` กับ body ของ Callback C2C
**เหมือนกันเป๊ะ field ต่อ field** → ประกาศ type เดียว และ validate ด้วยฟังก์ชันเดียวทั้งสองทาง
(ในรีโพต้นทางคือ `C2CTransactionResponse` + `isC2CTransactionResponse` แล้ว
`CeloxC2CCallbackRequest`/`isCeloxC2CCallbackRequest` เป็น alias ของตัวเดียวกันจริงๆ)

---

## Body ทั้งหมด (authoritative — โน้ตภาษาไทยคือสัญญา)

- `transactionId` (string uuid, always) — รหัสของคำขอ ใช้เป็นกุญแจกันทำซ้ำฝั่งเรา
- `orderId` (string, always) — เลขอ้างอิงที่ระบบออกให้
- `referenceId` (string | null, present, may be null) — เลขอ้างอิงของเราเอง ส่งมาเป็น null เสมอเมื่อไม่ได้ตั้งไว้ ไม่เคยหายไปทั้งคีย์
- `direction` (string, always) — `deposit` หรือ `withdraw`
- `transactionStatus` (string, always) — **เปลี่ยนชื่อมาจาก `status`** และเปลี่ยนความหมาย: เป็นสถานะรวมของ **ทั้งคำขอ** แบบ roll-up (ส่วนที่ต้องการความสนใจมากที่สุดชนะ ไม่ใช่ค่าเฉลี่ย และไม่ใช่สถานะของก้อนที่เพิ่งยิง callback มา) **ห้ามตัดเงินจากค่านี้**
- `amount` (number, always) — **ยอดตั้งต้นที่ลูกค้าขอเสมอ** ไม่ใช่ยอดที่จบจริง (ขอถอน 250 จบจริง 190 ก็ยังตอบ 250) เดิม Celox เขียนทับค่านี้เป็นยอดที่จบจริงเมื่อคู่โอนมาไม่ครบ — เลิกทำแล้ว **ห้ามใช้ตัดเงิน**
- `feeAmount` (number, always) — ค่าธรรมเนียมรวมทุกส่วน
- `settledAmount` (number, always) — **ยอดที่จบจริง = ผลรวมของก้อนที่สถานะ SUCCESS** เป็นยอดจริงทั้งขาฝากและขาถอน **นี่คือ field เดียวที่ใช้ตัดเงิน/เครดิตลูกค้า**
- `heldAmount` (number, always) — ยอดที่ยังถูกกันไว้กับคำขอนี้ ขาถอนนับเฉพาะค่าธรรมเนียม (เงินต้น C2C ไม่ผ่านกระเป๋าปฏิบัติการ) ขาฝากนับเงินต้น+ค่าธรรมเนียม · ไม่เป็นศูนย์พร้อมกับ `awaitingManualReview = true` คือเงินค้างรอเจ้าหน้าที่
- `unfilledAmount` (number | null, present, may be null) — ขาถอน: ยอดที่ไม่สำเร็จและต้องคืนลูกค้า **นับทุกบาทที่ไม่สำเร็จ** รวมก้อนที่ถูกยกเลิก/หมดเวลาเต็มยอด (เดิมนับเฉพาะส่วนที่ขาดตอนคู่โอนมาไม่ครบ คำขอที่ถูกยกเลิกทั้งก้อนจึงเคยตอบ 0) · เป็น `0` เมื่อไม่มีอะไรต้องคืน ไม่ใช่ null · **ขาฝากเป็น `null` เสมอ** (ไม่ใช่หายไปทั้งคีย์) · มีเฉพาะระดับคำขอรวม ไม่มี `parts[].unfilledAmount`
- `awaitingManualReview` (boolean, always) — `true` เมื่อมีก้อนใดค้างรอเจ้าหน้าที่โดยไม่มีนาฬิกาปลดเอง (`PENDING_REFUND_C2C` / `PENDING_REVIEW`) · **`PENDING_MANUAL_C2C` ถูกถอดออกจากเงื่อนไขนี้แล้ว** เพราะคิวถูกจับคู่ด้วยเครื่องเองทุกไม่กี่วินาที · `PENDING_TOPUP_C2C` ไม่นับ เพราะยังเดินนาฬิกาเดิมและปิดเองได้ด้วยการโอนส่วนที่ขาด
- `matchDeadline` (string ISO 8601 | null, present, may be null) — เส้นตายที่ใกล้ที่สุดที่ยังเดินอยู่ · null เมื่อไม่มีก้อนไหนรอแล้ว
- `transferTo` (object | null, conditional) — เฉพาะรายการฝากที่ยังโอนได้ · **ขาถอนเป็น `null` เสมอ** · บน callback คีย์นี้อาจไม่ถูกส่งมาเลย · อยู่ในลายเซ็นเหมือน field อื่น (แก้เลขบัญชีระหว่างทางแล้วลายเซ็นไม่ตรงทันที)
  - `transferTo.bankCode` / `bankName` / `accountName` / `accountNo` (string | null) · `accountName` ถูกปิดนามสกุลไว้ (ตัวแรก + `***` + ตัวสุดท้าย, นามสกุลยาว 1–2 ตัวเป็น `***` ทั้งคำ) **ให้ยืนยันปลายทางด้วยเลขบัญชี ไม่ใช่ชื่อนี้**
- `parts` (array, always) — **เป็น array เสมอทั้งขาฝากและขาถอน อย่างน้อย 1 สมาชิก** รายการที่ไม่ถูก split ก็ยังได้ array หนึ่งตัว ไม่ใช่ object เดี่ยว · **เป็นที่เดียวที่บอกว่าแต่ละก้อนสำเร็จหรือไม่** · **แต่ละก้อนไม่มี `transactionId` แล้ว** (ยกเลิก/สอบถามใช้ id ของทั้งคำขอเสมอ)
  - `parts[].orderId` (string, always) — เลขอ้างอิงของก้อนนี้ **ค่านี้คือสิ่งที่ปรากฏใน statement ธนาคาร**
  - `parts[].amount` (number, always) · `parts[].feeAmount` (number, always)
  - `parts[].transactionStatus` (string, always) — **เปลี่ยนชื่อมาจาก `parts[].status`** (ความหมายเดิม: สถานะของก้อนนี้ก้อนเดียว)
  - `parts[].matchDeadline` (ISO | null) · `parts[].matchedAt` (ISO | null) · `parts[].cancelReason` (string | null)

### Field ที่ถูกลบและต้องไม่มีในโค้ดอีก

| ชื่อเก่า | ต้องเป็น |
|---|---|
| `status` (หัว body และใน `parts[]`) | `transactionStatus` |
| `parts[].transactionId` | ไม่มีแล้ว |
| `settledTotal`, `unfilledTotal` | ไม่มีแล้ว — ยอดที่จบจริงคือ `settledAmount` ซึ่งส่งมาทุกครั้งที่ยิง ไม่ใช่แค่ครั้งสุดท้ายของกลุ่ม |
| `occurredAt`, `event` | ไม่มีแล้ว |
| `realWithdrawAmount` | **ไม่มีและไม่เคยมีจริง** — ถ้าเอกสาร/งานรอบก่อนของโปรเจกต์คุณเคยใช้ชื่อนี้ (รวมถึงคอลัมน์ `real_withdraw_amount_satang`) ให้เปลี่ยนกลับเป็น `settledAmount` / `settled_amount_satang` |

> `occurredAt`/`event` ที่หลุดมาต้อง **ไม่** ทำให้ request ถูก reject (ดูกฎ field แปลกปลอมด้านล่าง)
> แต่ห้ามมีโค้ดที่ *ต้องพึ่ง* สอง field นี้ เช่นเงื่อนไข "SUCCESS ต้องมี occurredAt ไม่งั้น fail"

---

## กฎเรื่องเงิน (ผิดตรงนี้คือหักเงินลูกค้าผิด)

1. **อ่านยอดที่จบจริงจาก `settledAmount` เท่านั้น** ทั้งขาฝากและขาถอน ห้ามใช้ `amount`
   ซึ่งเป็นยอดตั้งต้นเสมอ · โค้ดเดิมที่หักจาก `amount` ของ callback ได้เพราะ Celox เขียนทับ
   ค่านั้นให้ — ตอนนี้จะ **หักเกินทุกครั้งที่ปิดคู่ได้ไม่ครบยอด**
2. **ขาถอนต้องคืน `unfilledAmount` ให้ลูกค้า** และตรวจ invariant
   `settledAmount + unfilledAmount = amount` เมื่อทุกก้อนจบแล้ว ถ้าไม่ตรงให้บันทึกว่าไม่สำเร็จ
   **โดยไม่ขยับเงินสักบาท** (ไม่ใช่ throw ให้ retry วนไปเรื่อยๆ)
3. **ตรวจ `settledAmount <= amount` ด้วย** — ขาฝากไม่มี invariant ข้อ 2 มาช่วยจับ
4. **เงินขยับได้เมื่อ "ทุกก้อนใน `parts` terminal" เท่านั้น** (terminal = `SUCCESS`/`EXPIRED`/`CANCELLED`)
   ห้ามใช้ `transactionStatus` ที่หัว body เป็นสัญญาณว่าคำขอจบ เพราะเป็น roll-up ที่กลายเป็น
   `SUCCESS` ทันทีที่ก้อนใดก้อนหนึ่งจบ ทั้งที่ก้อนอื่นยังวิ่งอยู่ (เจอบ่อยตอน poll GET)
   ระหว่างที่ยังไม่จบ ผลต่างของ `settledAmount` กับ `amount` คือส่วนที่ยังค้าง (ดู `heldAmount`)
   **ไม่ใช่** ส่วนที่ต้องคืนลูกค้า
5. **ห้ามเขียนสถานะ terminal ลงเรคคอร์ดของเราขณะที่ยังมีก้อนวิ่งอยู่** ไม่งั้น callback/การ poll
   ที่ปิดคำขอจริงทีหลังจะถูกมองว่า "ชนกับสถานะปิดที่บันทึกไว้ก่อน" แล้วถูกปฏิเสธถาวร
   (เก็บสถานะเดิมไว้ก่อน แล้วเขียนสถานะจริงตอนทุกก้อนจบ)
6. **`awaitingManualReview` อ่านจาก body ตรงๆ** เลิกเดาจากสถานะ และอย่านับ `PENDING_MANUAL_C2C`
7. เมื่อปิดคำขอแล้ว บันทึกสถานะที่ Celox รายงานมาจริง **ไม่ใช่ hardcode `SUCCESS`** — คำขอที่จบแบบ
   `CANCELLED`/`EXPIRED` ยังมีบางก้อนโอนสำเร็จได้ เงินจึงขยับแต่สถานะรวมไม่ใช่ SUCCESS
   (แยกทาง "สำเร็จ/ไม่สำเร็จ" ด้วย `settledAmount > 0` ไม่ใช่ด้วยสถานะรวม)

---

## Callback C2C — ฝั่งที่เราเป็น server

### จังหวะการยิง (พลาดง่ายที่สุด)

- **คำขอถอน C2C ที่ถูกแบ่งเป็นก้อนย่อยยิง callback ครั้งเดียว** หลังทุกก้อนจบและคำขอสิ้นสุดแล้ว
  ไม่มีการยิงระหว่างจับคู่/ปิดทีละก้อน/ดึงเงินคืน (การแบ่งเป็นการตัดสินใจของ Celox เอง
  ตามยอด ผู้เรียกเลือกหรือมองเห็นล่วงหน้าไม่ได้) → **อย่ารอ callback กลางทางของขาถอน**
  ให้อ่าน `parts` จากการยิงครั้งเดียวที่ได้ และถ้าต้องเฝ้ารายการที่ยังวิ่งอยู่ให้ **poll
  `GET /v1/core/c2c/{reference}`** ซึ่งเป็นสถานะที่เชื่อถือได้ของ C2C
- **ขาฝากยังยิงทุกครั้งที่สถานะเปลี่ยน** เหมือนเดิม
- `PENDING_TOPUP_C2C` **ไม่มี callback** ตอนเข้าสถานะนี้ ต้องดูจาก GET
- `PENDING_REVIEW` มี callback หนึ่งครั้ง **เฉพาะรายการถอนที่ไม่ถูกแบ่งเป็นก้อนย่อย**
  (คำขอที่ถูกแบ่งเก็บไว้ยิงครั้งเดียวตอนจบทั้งคำขอ) แล้วยิงอีกครั้งเมื่อตัดสินแล้ว
- **Celox ไม่ยิงซ้ำเลย** ตอบ 2xx = สำเร็จ, อย่างอื่น = บันทึกว่าไม่สำเร็จและจบ
  → ตอบ 2xx ให้เร็วหลัง commit inbox แล้วทำงานจริงทีหลัง

### สถานะที่มาได้ (branch ด้วย `parts[].transactionStatus` เวลาตัดเงิน)

`PENDING_TRANSFER` (จับคู่แล้ว รอโอน+แนบสลิป · ขาฝากได้ `transferTo` มาใน body นี้เลย) ·
`SUCCESS` (สำเร็จทั้งคู่พร้อมกัน ยิงทั้งขาฝากและขาถอน) · `PENDING_TOPUP_C2C` (ขาฝากแนบสลิปแล้ว
แต่โอนมาไม่ครบ คู่ยังอยู่ นาฬิกาเดิมยังเดิน ปิดได้เมื่อโอนส่วนที่ขาดครบและเจ้าหน้าที่ยืนยัน
จบเป็น SUCCESS หรือหมดเวลาเป็น EXPIRED) · `EXPIRED` · `CANCELLED` ·
`PENDING_REVIEW` (ค้างรอเจ้าหน้าที่ ไม่ใช่ผลสุดท้าย จบที่ SUCCESS หรือ EXPIRED)

### Header + การตรวจลายเซ็น (v2)

Celox ส่ง `Content-Type: application/json`, `X-Celox-Timestamp` (unix วินาที),
`X-Celox-Signature` = `hmac-sha256(client secret, "v2\n" + X-Celox-Timestamp + "\n" + sha256hex(raw body))`

1. **อ่าน raw body เป็น bytes/string ก่อน parse JSON เสมอ** — verify ก่อน parse ทีหลัง
2. `bodyHash` = sha256 hex ตัวพิมพ์เล็กของ **bytes ที่ส่งมาจริง**
3. `material` = `"v2" + "\n" + ค่า header X-Celox-Timestamp ดิบๆ + "\n" + bodyHash`
4. `expected` = hex ตัวพิมพ์เล็กของ HMAC-SHA256(material) โดยใช้ **client secret ของเราเอง** เป็นกุญแจ
5. เทียบกับ `X-Celox-Signature` แบบ **constant-time** (`crypto.timingSafeEqual`) ห้ามใช้ `===`
6. **ปฏิเสธถ้า `X-Celox-Timestamp` ห่างจากนาฬิกาเราเกิน 300 วินาทีทั้งสองทิศทาง** — ต้องเช็คแม้ลายเซ็นตรง
   นี่คือสิ่งที่กัน callback ที่ถูกดักไว้มายิงซ้ำทีหลัง
7. **ห้าม reject เพราะเจอ field ที่ไม่รู้จักใน body** — raw body ถูก hash เป็น opaque bytes
   ทั้งก้อน field ใหม่จึงไม่มีทางทำให้ลายเซ็นพัง และไม่มี field list ให้ sync ตาม
   (422 เพราะ field แปลกปลอม = รายงานปัญหาของ reader ตัวเอง ไม่ใช่ปัญหาของ transaction)

**กับดักที่ integrator พลาดกันทุกราย:** body parser แบบ global จะ parse แล้วทิ้ง bytes เดิม
การ `JSON.stringify(parsedBody)` กลับมา hash ได้ bytes ต่างออกไป (key order/ช่องว่าง/รูปแบบเลข)
callback ของจริงจะ verify ไม่ผ่าน
- Express: mount `express.raw({ type: 'application/json' })` เฉพาะ route นี้ (หรือก่อน `express.json()` แบบ scope ที่ path นี้) ให้ `req.body` เป็น `Buffer` ของ bytes จริง
- Next.js App Router: อ่านจาก `await request.text()` / `request.arrayBuffer()` **ครั้งเดียว** แล้วส่ง string เดิมไปทั้ง verify และ parse
- ทดสอบด้วยเทสต์ที่ re-serialise payload ด้วย key order ต่างกันแล้วยืนยันว่า verify **ไม่ผ่าน**

### Idempotency + การกันข้อมูลซ้ำ

- **กุญแจกันซ้ำ = `transactionId` + `transactionStatus`** (callback ปกติที่ไม่ใช่ C2C ใช้
  `transactionId` + `status`) — กลุ่มที่ถูกแบ่งยิงครั้งเดียวตอนจบ และเคสเดียวที่ยังยิงเกินหนึ่งครั้ง
  ต่อคำขอ (ขาฝาก: ตอนจับคู่ แล้วตอนปิด) มี `transactionStatus` ต่างกันทุกครั้ง
- `amount` **กลับมาเป็น identity field ได้แล้ว** เพราะ contract ใหม่ตอบยอดตั้งต้นเสมอ
  → การยิงซ้ำของ `transactionId` + `transactionStatus` เดิมด้วย `amount` ต่างกันคือ conflict (409)
- ยอดที่เปลี่ยนได้ระหว่างการยิงซ้ำของสถานะเดิมคือ `settledAmount`/`heldAmount` → เก็บในคอลัมน์
  ของตัวเองและอัปเดตทับได้ ไม่ใช่ตัวชี้ว่าเป็นข้อมูลคนละชุด
- สถานะ **terminal** ที่ยิงซ้ำต้องมี body เดิมเป๊ะ (เทียบ sha256 ของ raw body) ถ้าต่าง = conflict
- ถ้ามี endpoint กลางที่รับทั้ง callback ปกติและ C2C: **แยก C2C ด้วยการมี `parts` (array)
  หรือมีคีย์ `transactionStatus`** — ห้ามแยกด้วย `event`/`transferTo` เพราะ `event` ถูกถอดออกแล้ว
  และ `transferTo` มีเฉพาะขาฝากที่ยังโอนได้ (callback ถอนที่ยังไม่จับคู่จะไม่มีทั้งสองตัว
  แล้วหลุดไปเข้า verifier ของ callback ปกติ → 401 ทุกครั้ง)

### สิ่งที่ endpoint เราต้องตอบ

2xx = สำเร็จ (body ไม่ถูกอ่านเลย ตอบว่างได้) · อย่างอื่น = Celox บันทึกว่าไม่สำเร็จและไม่ยิงซ้ำ

---

## Check a C2C transaction — ฝั่งที่เราเป็น client

`GET https://api-stg.celox.app/api/celox/v1/core/c2c/{reference}`
โดย `reference` (path, required) ใส่ `orderId` ที่ระบบออกให้ หรือ `referenceId` ของเราก็ได้

Header ที่ต้องส่ง:
- `X-Api-Key: <clientId>`
- `X-Timestamp: <unix วินาที>`
- `X-Signature: hmac-sha256` hex โดยใช้ **client secret แบบ plaintext เป็นกุญแจ** เซ็นสตริง
  `"v1\n<METHOD>\n<path>\n<X-Timestamp>\n<sha256 hex ของ raw body>"`

กฎ authentication:
- `X-Api-Key` คือ clientId · **client secret ไม่เคยถูกส่ง** เป็นแค่กุญแจ HMAC
- `<path>` คือ url path เท่านั้น ไม่มี base url ไม่มี query string
  (ในรีโพต้นทางใช้ `url.pathname` เต็มของ staging เช่น `/api/celox/v1/core/c2c/...`
  จากการตรวจจริง: เซ็นเฉพาะ `/v1/core/c2c/...` ได้ 401 — ให้ยืนยันกับ staging ของโปรเจกต์คุณเอง)
- hash ของ body คิดจาก **bytes ที่ส่งจริง** serialise ครั้งเดียว เซ็น bytes นั้น ส่ง bytes นั้น
- body ว่าง = hash ของสตริงว่าง (GET/cancel ใช้ตัวนี้)
- `X-Timestamp` เป็นวินาที และถูกปฏิเสธถ้าห่างเวลาเซิร์ฟเวอร์เกิน 300 วินาที
- **ส่ง header `X-Client-Secret` มาคือถูกปฏิเสธทันที** ห้ามส่ง
- multipart: ลายเซ็นไม่คลุมไฟล์ ผูกแค่ผู้เรียก/method/path/timestamp

Error ที่ต้อง handle แยกทีละตัว และ **ห้าม retry 4xx ที่เป็นถาวร**:
- **401 `unauthenticated`** — ลายเซ็นไม่ตรง / `X-Timestamp` ห่างเกิน 300 วินาที / api key ผิดหรือถูกปิด / ส่ง `X-Client-Secret` มา
- **404 `not_found`** — เลขอ้างอิงที่ไม่มีใครออก, ขององค์กรอื่น หรือไม่ใช่รายการ C2C → ตอบเหมือนกันหมด แยกไม่ได้
- **429 `rate_limited`** — ยิงถี่เกินโควตาต่อ credential/ต่อ IP → รอแล้วลองใหม่

Retry/backoff ที่แนะนำ (ตรงกับที่ใช้จริง):
- GET เป็น read-only → retry ได้เฉพาะ **network error/timeout** สูงสุด 3 attempts
  full-jitter exponential 0–500 ms → 0–1,000 ms เพดาน 4 วินาที, timeout 15 วินาทีต่อ request
- 429 ใช้ `Retry-After` เฉพาะเมื่อไม่เกิน 10 วินาที
- 401/404 และ 4xx ถาวรอื่นๆ **ไม่ retry เด็ดขาด**
- งานประมวลผลหลังตอบ callback: retry เฉพาะความขัดแย้งชั่วคราวของ DB
  (Postgres SQLSTATE `40001` serialization_failure / `40P01` deadlock_detected) สูงสุด 3 attempts
  ส่วนลายเซ็น/timestamp/validation/ยอดไม่ลงรอย = permanent ไม่ retry

---

## Schema / persistence ที่ต้องแก้

ปรับตามชื่อจริงของโปรเจกต์คุณ แต่ต้องมีของพวกนี้ครบ:

1. คอลัมน์ยอดที่จบจริงชื่อสื่อถึง `settledAmount` (ต้นทางใช้ `settled_amount_satang` เก็บเป็น
   จำนวนเต็มหน่วยสตางค์) **ถ้างานรอบก่อนเคย rename เป็น `real_withdraw_amount_satang`
   ให้ rename กลับ**
2. คอลัมน์ `unfilled_amount_satang` (nullable — ขาฝากและรายการที่ยังไม่จบเป็น null)
3. ตาราง inbox ของ callback ต้องเก็บยอดของตัวเอง ไม่ใช่อ่านจากคอลัมน์ `amount`:
   `settled_amount_satang` (NOT NULL DEFAULT 0), `unfilled_amount_satang` (nullable),
   `awaiting_manual_review` (boolean)
4. คอลัมน์สรุปจาก `parts[]` ที่คำนวณตอนรับเข้า inbox: `all_parts_terminal` (boolean)
   — จำเป็นเพราะตอนประมวลผลทีหลังเราไม่มี `parts` อยู่ในมือ และ `transactionStatus` ที่หัว body
   ใช้บอกว่าคำขอจบไม่ได้ (`parts` เต็มก้อนยังดูย้อนหลังได้จาก raw callback log ถ้ามีฟีเจอร์นี้)
5. **drop คอลัมน์ `occurred_at` / `provider_event` ของ inbox C2C** เพราะ contract ใหม่ไม่มี
   `occurredAt`/`event` แล้ว
6. unique constraint ของ inbox = `(transaction_id, provider_status)`
7. ถ้ามีตาราง log raw body ของ callback ให้คงไว้ — มีประโยชน์มากตอนไล่ปัญหาเพราะเก็บ body ดิบ
   ที่แม้แต่ request ที่ถูกปฏิเสธก็ถูกบันทึก

---

## ลำดับการ deploy (สำคัญ — ผิดลำดับแล้ว callback หาย)

**รัน migration ให้เสร็จก่อน deploy โค้ดใหม่** ถ้า deploy โค้ดก่อน โค้ดใหม่จะเขียนคอลัมน์ที่ยัง
ไม่มีในตาราง → ตอบ 5xx `persistence_error` และ **Celox ไม่ยิงซ้ำ callback ก้อนนั้นหายถาวร**
(ทางกลับกัน migration ก่อนแล้วโค้ดเก่ายังรับ traffic อยู่ แค่ทำให้ C2C callback ตอบ error
ต่อไปเหมือนเดิม ซึ่งพังอยู่แล้วก่อนแก้)

หลัง deploy เช็คว่าโค้ดใหม่ขึ้นจริงได้โดย **ไม่ต้องใช้ secret และไม่ขยับเงิน**: ยิง body รูปแบบใหม่
พร้อมลายเซ็นปลอม — โค้ดเก่า validate ก่อนตรวจลายเซ็นจึงตอบ **422**, โค้ดใหม่ validate ผ่าน
แล้วไปตกลายเซ็นจึงตอบ **401**

```bash
curl -i -X POST https://YOUR_DOMAIN/api/celox/c2c/callback \
  -H 'Content-Type: application/json' \
  -H "X-Celox-Timestamp: $(date +%s)" \
  -H "X-Celox-Signature: $(printf 'a%.0s' {1..64})" \
  --data-binary '{"transactionId":"01a08782-95ee-7293-afd1-a8453081de20","orderId":"PROBE","referenceId":null,"direction":"withdraw","transactionStatus":"EXPIRED","amount":1,"feeAmount":0,"settledAmount":0,"heldAmount":0,"unfilledAmount":1,"awaitingManualReview":false,"matchDeadline":null,"transferTo":null,"parts":[{"orderId":"PROBE","amount":1,"feeAmount":0,"transactionStatus":"EXPIRED","matchDeadline":null,"matchedAt":null,"cancelReason":null}]}'
```

ถ้ามีหลาย environment/worker (เช่น หลายโดเมนคนละ deployment) ให้เช็คว่า **Celox Console ชี้
callback URL ไปที่ตัวไหน** แล้ว deploy + รัน migration ให้ครบทุกตัวที่รับ callback รวมถึง DB
ของแต่ละ environment ด้วย

---

## Test plan (TDD — RED ก่อนแก้ implementation ทุกไฟล์)

เขียน helper `signV2(rawBody, timestamp)` **ในไฟล์เทสต์เท่านั้น** implement จากสูตร material
ตรงๆ ห้าม import ตัวเซ็นของ production มาใช้เซ็นเอง (จะพลาด bug ร่วมกัน)

เทสต์ที่ต้องมี:

**Validator (ใช้ตัวเดียวทั้ง GET และ callback)**
- ยอมรับ callback ขาถอนที่ถูกต้อง และขาฝากที่มี `transferTo` + `unfilledAmount: null`
- ปฏิเสธหัว body ที่ยังใช้ `status`, ปฏิเสธ `parts[]` ที่ยังใช้ `status`
- ปฏิเสธ `realWithdrawAmount` ที่ส่งมาแทน `settledAmount`, ปฏิเสธ body ที่ไม่มี `settledAmount`
- ปฏิเสธขาถอนที่ `unfilledAmount: null` และขาฝากที่ `unfilledAmount` เป็นตัวเลข, ปฏิเสธเมื่อไม่มีคีย์นี้
- ปฏิเสธ `parts: []`, ปฏิเสธเมื่อไม่มีคีย์ `parts`, ยอมรับ `parts[]` ที่ไม่มี `transactionId`
- ปฏิเสธรายการถอนที่ส่ง `transferTo` เป็น object, ยอมรับขาฝากที่ไม่มีคีย์ `transferTo`
- **ยอมรับ field แปลกปลอมที่ไม่รู้จัก** ทั้งระดับบนสุด, ใน `transferTo` และใน `parts[]`
- ยอมรับ body ที่ไม่มี `occurredAt`/`event` (รูปแบบปกติ) และยอมรับเมื่อสองตัวนี้หลุดมาด้วย

**ลายเซ็น v2**
- ลายเซ็นถูก / ผิด / ถูกแก้ระหว่างทาง, timestamp header หาย, signature header หาย, หายทั้งคู่
- timestamp เก่าเกิน 300 วิ, ใหม่เกิน 300 วิ (อนาคต), boundary พอดี 300 วิ, timestamp ไม่ใช่ตัวเลข
- **regression ของกับดัก re-serialisation**: เอา payload เดิมมา stringify ใหม่ด้วย key order
  ต่างกัน แล้วยืนยันว่า verify ไม่ผ่าน

**เงิน (สำคัญที่สุด)**
- คำขอถอน 250 แบ่ง 100/100/50 สำเร็จก้อนเดียว (`settledAmount: 100`, `unfilledAmount: 150`,
  head `amount: 250`) → **หักลูกค้า 100 คืน 150** ไม่ใช่หัก 250
- คำขอถอนที่ถูกยกเลิก/หมดเวลาทั้งก้อน (`settledAmount: 0`, `unfilledAmount: amount`)
  → คืนเต็มยอด ไม่หักสักบาท ปิดเป็นรายการไม่สำเร็จ
- head `SUCCESS` แต่ยังมีก้อนที่ไม่ terminal → **ไม่ขยับเงิน** และ **ไม่เขียนสถานะ terminal ลงเรคคอร์ด**
- `settledAmount + unfilledAmount !== amount` ตอนทุกก้อนจบ → บันทึก failed ไม่ขยับเงิน
- `settledAmount > amount` → ปฏิเสธ (ทดสอบทั้งขาฝากและขาถอน)
- ขาฝาก `SUCCESS` เครดิตจาก `settledAmount`, ขาฝากที่ `settledAmount: 0` ปิดเป็นไม่สำเร็จและไม่เครดิต
- `PENDING_TOPUP_C2C` ไม่ตั้ง `awaitingManualReview`, `PENDING_REVIEW` ตั้งเป็น true และไม่ขยับเงิน
- idempotent: ยิง `transactionId` + `transactionStatus` เดิมซ้ำ → duplicate ไม่ปรับยอดซ้ำ
- conflict: `amount` ต่างจากเดิม → conflict · terminal เดิมที่ body ต่าง → conflict ·
  terminal เดิม body เดิมเป๊ะ → duplicate ไม่ conflict

**GET client**
- อ่าน `settledAmount` แยกจาก `amount` ได้ถูกและ `settledAmount + unfilledAmount = amount`
- ปฏิเสธ response ที่ใช้ `realWithdrawAmount` หรือ `parts[].status`
- 401/404/429 map เป็น error ของโปรเจกต์และ **ไม่ retry**

---

## Checklist ก่อนถือว่าเสร็จ

```bash
# ปรับเป็นคำสั่งของโปรเจกต์คุณ
npx vitest run      # หรือ test runner ที่ใช้ — ต้องผ่านทุกไฟล์
npx tsc --noEmit    # จับ call site ที่ลืมแก้ (arity/ชื่อ field ไม่ตรง)
npm run lint
grep -rn "realWithdrawAmount\|settledTotal\|unfilledTotal\|occurredAt" --include=*.ts .
grep -rn "body\.status\|payload\.status\|parts\[0\]\.status" --include=*.ts .   # ต้องไม่เหลือ (C2C ใช้ transactionStatus)
```

แล้วรัน migration ก่อน deploy ตามหัวข้อ "ลำดับการ deploy" และยืนยันด้วย probe ลายเซ็นปลอม

---

## คำถามที่ต้องถามเจ้าของโปรเจกต์ก่อนลงมือ (ห้ามเดา)

1. **นโยบายเมื่อ `X-Celox-Signature`/`X-Celox-Timestamp` หายไปทั้งคู่** — Celox ระบุว่าการ verify
   เป็น *optional but recommended* และ Celox จะ **ไม่ส่ง header ทั้งสองตัวมาเลย** เมื่อ credential
   ขององค์กรเก่าเกินกว่าที่แพลตฟอร์มจะกู้ client secret ได้ เอกสารจึงบอกว่า *ห้ามถือว่า header หายไป
   คือหลักฐานว่าปลอม* → **โปรเจกต์ต้นทางเลือกปฏิเสธ 401 เสมอ** เพราะ callback นี้เกี่ยวกับการหักเงินจริง
   และยอมรับความเสี่ยงที่ integration จะพังสำหรับ org ที่ credential เก่า
   **นี่คือ security/business trade-off ที่แต่ละทีมรับได้ไม่เท่ากัน ต้องถามใหม่ทุกครั้ง**
2. **ภาษา/HTTP client/error type และ test runner ของโปรเจกต์** ถ้าดูไม่ออกจากโค้ดเดิม
3. **ขาฝากเครดิตจาก `settledAmount`** ตามข้อตกลงล่าสุด — ถ้า staging ของโปรเจกต์คุณพบว่า
   ขาฝากตอบ `settledAmount: 0` ตอน `SUCCESS` (พฤติกรรมที่เคยเข้าใจกันช่วงหนึ่ง) **ให้หยุดถามก่อน**
   อย่า fallback ไป `amount` เอง
4. **มี environment/โดเมนไหนที่รับ callback บ้าง และแต่ละตัวใช้ DB ตัวเดียวกันหรือไม่**
   เพราะต้อง deploy และรัน migration ให้ครบทุกตัว
