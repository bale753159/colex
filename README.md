# KLANG Finance Dashboard

ระบบจำลองงานการเงินสำหรับแอดมิน สร้างด้วย Next.js และ Postgres (Supabase)

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

เปิด `http://localhost:3000`

## หน้าหลัก

- `/` ภาพรวมและรายการธุรกรรม
- `/customers` รายชื่อลูกค้า ยอดคงเหลือ และจุดเริ่ม flow ฝาก–ถอนทั้ง Celox ปกติและ C2C
- `/c2c-transactions` รายการ C2C แยกต่างหาก พร้อมค้นหา ยกเลิก และ poll สถานะจริงจาก Celox

## รูปแบบรายการ

- ฝากเข้าบัญชี: เพิ่มยอดจากช่องทางภายนอก
- ถอนจากบัญชี: นำยอดออกไปยังช่องทางภายนอก
- ฝากแบบ C2C: สร้างรายการรอจับคู่ แสดงบัญชีบุคคลที่สามเฉพาะผู้โอน แล้วแนบสลิปกับรายการเดิม
- ถอนแบบ C2C: กันยอดลูกค้าและยอด operating ของ Celox ตั้งแต่สร้าง แล้วรอผู้ฝากยอดเท่ากัน

C2C ของ Celox บันทึก local ledger เป็น `pending` ก่อน และอัปเดตยอดแบบ exact-once เมื่อ GET สถานะจริงหรือผลแนบสลิปยืนยัน `SUCCESS`

## การตั้งค่าฐานข้อมูล

แอปนี้เก็บข้อมูลบน Postgres ผ่าน [Supabase](https://supabase.com) ไม่ใช้ `supabase-js`, PostgREST, Realtime, Auth หรือ Storage — เชื่อมต่อด้วย connection string ตรงผ่าน `pg` เท่านั้น

1. สร้างโปรเจกต์ใหม่ใน Supabase
2. ไปที่ Project Settings → Database → Connect แล้วคัดลอก connection string ของ **Session pooler** (พอร์ต 5432) — **ห้ามใช้ Transaction pooler** เพราะแอปพึ่ง multi-statement transaction บน connection เดียว (ดู `lib/sql.ts`) ซึ่ง Transaction pooler ไม่รองรับ นำ connection string ไปใส่เป็น `DATABASE_URL` ใน `.env.local`
3. เปิด SQL Editor ของโปรเจกต์ แล้วรันไฟล์ใน `supabase/migrations/` เรียงตามเลขหน้าไฟล์ (`0001_init.sql`, `0002_customer_bank_account.sql`) ตามด้วย `supabase/seed.sql` เพื่อสร้างตารางและข้อมูลตัวอย่าง

   > ฐานข้อมูลที่สร้างไว้ก่อนหน้านี้รัน `0002_customer_bank_account.sql` ทับได้เลย — ไฟล์ใช้ `ADD COLUMN IF NOT EXISTS` และ `UPDATE` เฉพาะแถวที่ยังไม่ผูกบัญชี

ระหว่างพัฒนา ทดสอบ (`npm test`) รันบน [PGlite](https://pglite.dev) ในหน่วยความจำโดยไม่ต้องมี `DATABASE_URL` จริง

## API ที่เตรียมไว้

- `GET /api/customers?search=&from=&to=`
- `GET /api/transactions?search=&direction=&limit=`
- `POST /api/transactions`
- `POST /api/celox/deposits` สร้างรายการฝาก Celox โดยเซ็น HMAC ฝั่ง server
- `POST /api/celox/deposits/{id}/slip` รับไฟล์จาก browser และส่งต่อไป Celox ฝั่ง server เพื่อหลีกเลี่ยง CORS
- `POST /api/celox/callback` รับ Callback ที่ Celox ยิงเข้ามา ตรวจ HMAC และตอบรับหลังเก็บลง durable inbox
- `GET /api/customers/{id}/celox-callbacks` อ่าน Callback ของลูกค้าสำหรับหน้า Customers
- `POST /api/customers/{id}/celox-callbacks/{eventId}/retry` ประมวลผล event ที่ค้างในระบบอีกครั้ง โดยไม่เรียก Celox
- `POST /api/customers/{id}/celox-withdrawal-holds/{key}/resolve` แก้ reservation/confirmation ที่ค้าง หลังผู้ดูแลตรวจสถานะจริงใน Celox Console แล้ว
- `POST /api/celox/withdrawals` สร้างรายการถอน Celox สถานะ `PENDING`
- `POST /api/celox/withdrawals/{id}/confirm` ยืนยันรายการด้วย payload ชุดเดิมและจ่ายเงินจริง
- `GET /api/celox/c2c` รายการ C2C ที่ผูกกับลูกค้าใน Postgres
- `POST /api/celox/c2c/deposits` สร้างรายการฝาก C2C
- `POST /api/celox/c2c/deposits/{id}/slip` แนบสลิป C2C ด้วย signed multipart ฝั่ง server
- `POST /api/celox/c2c/withdrawals` สร้างรายการถอน C2C และกันยอดลูกค้า
- `GET /api/celox/c2c/{reference}` อ่านสถานะ authoritative ด้วย orderId หรือ referenceId
- `POST /api/celox/c2c/{id}/cancel` ยกเลิกรายการที่ยัง PENDING และยังไม่จับคู่

จำนวนเงินถูกจัดเก็บเป็นจำนวนเต็มหน่วยสตางค์เพื่อหลีกเลี่ยง floating-point error และ query ทุกจุดใช้ prepared statement

## Celox deposit

ตั้งค่า credential ใน `.env.local` เท่านั้น ห้ามใช้ชื่อที่ขึ้นต้นด้วย `NEXT_PUBLIC_` เพราะ `CELOX_CLIENT_SECRET` ต้องไม่เข้า browser bundle:

```bash
cp .env.example .env.local
```

```dotenv
CELOX_BASE_URL=https://api-stg.celox.app/api/celox
CELOX_UPLOAD_ORIGIN=https://api-stg.celox.app
CELOX_MAX_SLIP_BYTES=10485760
CELOX_CLIENT_ID=your-client-id
CELOX_CLIENT_SECRET=your-plaintext-client-secret
CELOX_CALLBACK_SECRET=your-plaintext-client-secret
```

เปิดหน้า `/` แล้วกด “ฝากเงิน” หรือเปิด `/customers` → “ทำรายการใหม่” → “ฝากผ่าน Celox” ระบบจะทำงานตามลำดับนี้:

1. ส่งข้อมูลผู้โอนและ `customerId` ภายในระบบไปที่ BFF `/api/celox/deposits`; BFF จะตัด `customerId` ออกก่อนส่ง payload ไป Celox และเก็บการผูกลูกค้าไว้ใน Postgres
2. ฝั่ง server serialize JSON หนึ่งครั้ง ใช้ bytes เดียวกันสำหรับ SHA-256, HMAC และ request body
3. เมื่อ Create สำเร็จ ระบบสร้างแถวใน `transactions` เป็น `pending` ทันทีโดยยังไม่เพิ่มยอด แล้วแสดงบัญชีรับเงินจาก response สถานะ `PENDING_TRANSFER`
4. browser แสดง preview แล้วส่ง `FormData` เข้า BFF ภายใน `/api/celox/deposits/{id}/slip` เพื่อหลีกเลี่ยง CORS
5. BFF ตรวจ id/token/ไฟล์ แล้วส่ง multipart ที่มี part ชื่อ `file` เพียงรายการเดียวต่อไปยัง `slipUpload.uploadUrl` โดยไม่ใส่ Celox headers และไม่กำหนด `Content-Type` เอง
6. อ่าน `transactionStatus` จากผลแนบสลิปเสมอ; HTTP 200 ไม่ได้แปลว่า `SUCCESS`
7. BFF บันทึกผลตรวจสลิปก่อนตอบ browser แล้วหน้าเว็บปิด modal และโหลดตารางใหม่ทันทีสำหรับผล 2xx ที่ตรวจสอบรูปแบบแล้ว; ถ้าสถานะเป็น `SUCCESS` จะเปลี่ยนแถวเดิมเป็น `success` และเพิ่มยอดครั้งเดียว ส่วนผลอื่นคงเป็น `pending` เพื่อรอ Callback

ตัวอย่างที่รันได้เมื่อ dev server เปิดอยู่:

```bash
curl --fail-with-body \
  --request POST http://localhost:3000/api/celox/deposits \
  --header 'Content-Type: application/json' \
  --data '{
    "customerId": "C-1024",
    "amount": 1500,
    "sourceBankCode": "014",
    "sourceAccountName": "สมชาย ใจดี",
    "sourceAccountNo": "1112233334",
    "referenceId": "ORDER-20260820-0001"
  }'
```

แยก `transactionId` และ `uploadToken` จาก `slipUpload.uploadUrl` แล้วเรียก BFF ภายในเพียงครั้งเดียว:

```bash
TRANSACTION_ID='uuid-from-create-response'
UPLOAD_TOKEN='token-from-slip-upload-url'

curl --fail-with-body \
  --request POST \
  --header "X-Celox-Upload-Token: $UPLOAD_TOKEN" \
  --form 'file=@/absolute/path/to/slip.jpg' \
  "http://localhost:3000/api/celox/deposits/$TRANSACTION_ID/slip"
```

`X-Celox-Upload-Token` ใช้เฉพาะระหว่าง browser กับ BFF ภายใน ส่วนคำขอจาก BFF ไป Celox ไม่มี `X-Api-Key`, `X-Timestamp`, `X-Signature` และไม่มี field อื่นใน multipart form

### Retry และ error policy

- Create deposit retry อัตโนมัติเฉพาะเมื่อ Celox ตอบ `429 rate_limited` ชัดเจน สูงสุด 3 attempts โดยใช้ `Retry-After` ที่ไม่เกิน 10 วินาที หรือ full-jitter exponential backoff 0–500ms แล้ว 0–1,000ms (เพดาน backoff 4 วินาที)
- Create deposit จะไม่ retry เมื่อ timeout, network error หรือ 5xx เพราะคำขออาจถูกบันทึกแล้ว และ `referenceId` conflict ไม่ใช่ idempotent replay
- Slip upload ไม่ retry อัตโนมัติทุกกรณี; เมื่อได้รับ 429 ชัดเจน UI จะรอตาม `Retry-After` ก่อนเปิดให้ผู้ใช้กดลองเอง
- 401, 409, validation 422 และ 4xx ถาวรทุกชนิดถูกแยก code และไม่ retry
- หากการเชื่อมต่อขาดหลังส่ง create หรือ slip UI จะระบุว่า “ผลไม่แน่นอน” และปิดการส่งซ้ำจนกว่าจะตรวจสอบ callback/สถานะ

### ข้อควรทราบ

- Contract field list ใช้ `referenceId`; ตัวอย่างบางส่วนในคู่มือใช้ `reference` แต่ client นี้ยึด field list
- Signer ยึดโค้ดตัวอย่างที่ให้มาและเซ็น `url.pathname` ซึ่งสำหรับ staging คือ `/api/celox/v1/core/deposits`
- Server ตรวจ `slipUpload.uploadUrl` กับ `CELOX_UPLOAD_ORIGIN` และ path ของรายการ แล้วส่ง policy เดียวกันผ่าน response header ให้ browser ตรวจซ้ำก่อนส่งไฟล์ หาก Celox แยก upload host ใน environment อื่น ให้ตั้ง `CELOX_UPLOAD_ORIGIN` เป็น origin ที่ Celox ระบุ
- `celox_deposits` เก็บการผูก provider transaction กับลูกค้า สถานะล่าสุด และ local transaction ID ส่วน `transactions` เก็บรายการฝาก Celox ตั้งแต่ `pending` แล้วอัปเดตแถวเดิมเป็น `success` หรือ `failed`; เฉพาะ `success` เท่านั้นที่นับรวมยอดเงิน และ `celox_deposit_slip_claims` ล็อกการส่งสลิปแบบ atomic เพื่อป้องกันการเพิ่มยอดซ้ำ
- `celox_withdrawal_reservations` กันยอดที่ถอนได้ก่อนเรียก Create และ `celox_withdrawals` เก็บ payload/claim ของรายการถอน เพื่อให้ Confirm กับ Callback ใช้ ledger finalizer เดียวกันและหักยอดครั้งเดียว
- Route Handler เป็น public endpoint ตามพฤติกรรมของ Next.js ควรเพิ่ม admin authentication, authorization และ rate limit ของแอปก่อน deploy production

## Celox Callback webhook

ตั้ง Callback URL ใน Celox Console เป็น HTTPS endpoint นี้หนึ่งครั้งต่อองค์กรและโหมด:

```text
https://YOUR_DOMAIN/api/celox/callback
```

Celox เป็นฝ่าย `POST` เข้ามา ระบบนี้ไม่เรียก endpoint ดังกล่าวเอง ลำดับการทำงานคือ:

1. อ่าน raw body แบบจำกัดขนาด แยกชนิด callback แล้วตรวจ `X-Celox-Signature` ด้วย HMAC-SHA256 ก่อนบันทึกข้อมูล
2. ตรวจ required fields ทั้งหมด รวม `referenceId` และ `occurredAt` ที่ต้องมี key แม้ค่าเป็น `null`
3. บันทึก event ลง `celox_callback_events` ก่อนตอบ `200` โดยใช้ `(transactionId, status)` เป็น idempotency key
4. ตอบ `{ "received": true, "duplicate": false }` ทันที แล้วใช้ `after()` ของ Next.js ประมวลผล ledger ภายหลัง
5. Callback `SUCCESS` จะจับคู่ `transactionId` แล้วอัปเดต transaction ฝากแถวเดิมเป็น `success` พร้อมเพิ่มยอดใน Postgres transaction เดียว หากผลสลิปบันทึกสำเร็จไปแล้วจะไม่เปลี่ยนยอดซ้ำ
6. Callback สถานะจบแบบไม่สำเร็จ เช่น `FAILED` หรือ `EXPIRED` จะเปลี่ยน transaction ฝากที่ยังรอเป็น `failed` โดยไม่เพิ่มยอด; Callback ที่ยังไม่พบรายการ ข้อมูลไม่ตรง หรือประมวลผลไม่สำเร็จจะคงอยู่ใน inbox เพื่อดูและ retry จากปุ่ม “Callback” ในหน้า `/customers`

`CELOX_CALLBACK_SECRET` ใช้ตรวจลายเซ็น หากเว้นว่างระบบจะ fallback ไป `CELOX_CLIENT_SECRET` แต่ production ควรกำหนดให้ชัดเจน การตรวจลายเซ็นถูกบังคับเพราะ Callback `SUCCESS` สามารถเพิ่มยอดเงินจริงได้

ตัวอย่างที่รันได้ โดยใช้ `transactionId`, `orderId`, `referenceId` และ `amount` จากรายการฝากจริงหากต้องการให้ event อัปเดตยอด:

```bash
export CELOX_CALLBACK_SECRET='your-plaintext-client-secret'

CALLBACK_BODY='{"transactionId":"3e0e2b8e-1111-4444-8888-123456789abc","orderId":"TXN-2608-00417","referenceId":"ORDER-9001","status":"SUCCESS","amount":1500.00,"occurredAt":"2026-08-20T09:12:44Z"}'
CALLBACK_SIGNATURE="$(printf '%s' "$CALLBACK_BODY" | openssl dgst -sha256 -hmac "$CELOX_CALLBACK_SECRET" -binary | xxd -p -c 256)"

curl --fail-with-body \
  --request POST http://localhost:3000/api/celox/callback \
  --header 'Content-Type: application/json' \
  --header "X-Celox-Signature: $CALLBACK_SIGNATURE" \
  --data-binary "$CALLBACK_BODY"
```

Response ที่ระบบตอบมี type `{ received: true; duplicate: boolean }` และ HTTP 200; Celox ไม่อ่าน body

### Callback retry/backoff policy

- Celox ระบุว่าไม่มีการยิง webhook ซ้ำอัตโนมัติ ไม่ว่าจะตอบ 2xx หรือ non-2xx ดังนั้นระบบจะ commit durable inbox ก่อนตอบรับเสมอ
- งานหลัง response retry เฉพาะ Postgres SQLSTATE `40001` (serialization_failure)/`40P01` (deadlock_detected) สูงสุด 3 attempts: ครั้งแรกทันที แล้ว full-jitter 0–500 ms และ 0–1,000 ms
- signature/validation/mapping mismatch เป็น permanent error และไม่ retry อัตโนมัติ
- งานที่ยัง `pending`, `failed` หรือ `unmatched` สามารถกด “ประมวลผลอีกครั้ง” ในหน้า Customers ได้ ปุ่มนี้ทำงานกับ inbox ภายในเท่านั้น ไม่ได้ยิงหา Celox
- ถ้า Celox Console แสดงว่ารายการมีอยู่หรือ `SUCCESS` แต่ระบบไม่เคยได้รับ event ห้ามเดาสถานะหรือปรับ ledger จากหน้าเว็บ ให้สั่ง Celox ส่ง signed Callback ซ้ำ หรือเชื่อม status/replay API ที่ Celox ระบุเพิ่มเติม เพราะ contract webhook นี้ไม่มี API สำหรับให้ระบบถามสถานะกลับ

## Celox withdrawal

เปิดหน้า `/` แล้วกด “ถอนเงิน” หรือเปิด `/customers` → “ทำรายการใหม่” → “ถอนผ่าน Celox” ระบบจะทำงานตามลำดับนี้:

1. ตรวจจำนวนเงิน ธนาคาร และบัญชีปลายทางใน browser และ BFF
2. BFF serialize payload ครั้งเดียว แล้วเซ็น SHA-256/HMAC ก่อนเรียก `POST /v1/core/withdrawals`
3. แสดงรายการสถานะ `PENDING` ซึ่งยังไม่หักยอดคงเหลือ แต่พักยอดที่ถอนได้ไว้ พร้อมให้แอดมินตรวจบัญชีผู้รับอีกครั้ง
4. ก่อนเรียก Create ระบบกัน `withdrawableBalance` แบบ atomic และเก็บ reservation ไว้ก่อน เพื่อไม่ให้รายการ `PENDING` หลายรายการใช้ยอดก้อนเดียวกัน; เมื่อ Celox ตอบแบบปฏิเสธชัดเจนจึงคืน hold แต่ถ้าผลเครือข่ายไม่แน่นอนจะคง hold ไว้รอ reconciliation
5. ระบบเก็บรายการ `PENDING` และการผูกกับลูกค้าไว้ใน `celox_withdrawals`; เมื่อแอดมินกดยืนยัน ระบบ claim รายการแบบ atomic แล้วอ่าน payload ชุดเดิมจาก server เพื่อส่งแบบ field-for-field ไปยัง `POST /v1/core/withdrawals/{id}/confirm`
6. เมื่อ Confirm หรือ Callback แจ้ง `SUCCESS` ก่อน ระบบจะใช้ยอดที่กันไว้ หักยอดคงเหลือ และสร้าง transaction แบบ exact-once อีกทางจะเชื่อมรายการเดิมโดยไม่หักซ้ำ
7. หากไม่ได้ส่ง `referenceId` ระบบจะสร้างค่า `KLANG-WD-{uuid}` ให้ก่อนเรียก Celox เสมอ เพื่อให้ signed Callback ตามหา reservation ที่ผลไม่แน่นอนได้
8. ถ้า Create ตอบไม่แน่นอนแต่ภายหลังมี signed Callback ที่ `referenceId` และยอดตรงกับ reservation ระบบจะผูก transaction และ reconcile hold ให้อัตโนมัติ
9. แสดงผล `SUCCESS`, เวลาที่สำเร็จ และผล callback แยกกัน โดยไม่ส่ง `code` หรือ `X-Step-Up`

ตัวอย่างที่รันได้เมื่อ dev server เปิดอยู่ โดยใช้ `referenceId` ใหม่ทุกครั้ง:

```bash
curl --fail-with-body \
  --request POST http://localhost:3000/api/celox/withdrawals \
  --header 'Content-Type: application/json' \
  --data '{
    "customerId": "C-1081",
    "amount": 2000,
    "destinationBankCode": "014",
    "destinationAccountName": "สมชาย ใจดี",
    "destinationAccountNo": "1112233334",
    "referenceId": "PAYOUT-20260820-0007"
  }'
```

เก็บ `transactionId` และ JSON payload ด้านบนไว้โดยไม่แก้ค่า แล้วจึงยืนยัน:

```bash
TRANSACTION_ID='uuid-from-create-response'

curl --fail-with-body \
  --request POST "http://localhost:3000/api/celox/withdrawals/$TRANSACTION_ID/confirm" \
  --header 'Content-Type: application/json' \
  --data '{
    "amount": 2000,
    "destinationBankCode": "014",
    "destinationAccountName": "สมชาย ใจดี",
    "destinationAccountNo": "1112233334",
    "referenceId": "PAYOUT-20260820-0007"
  }'
```

คำสั่ง Confirm มีผลจ่ายเงินจริง ห้ามใช้กับข้อมูล production เพื่อทดสอบเฉย ๆ

### Retry และ error policy สำหรับถอนเงิน

- ทั้ง Create และ Confirm retry อัตโนมัติเฉพาะ `429 rate_limited` ที่ Celox ปฏิเสธชัดเจน สูงสุด 3 attempts โดยใช้ `Retry-After` หรือ full-jitter exponential backoff 0–500ms แล้ว 0–1,000ms
- ไม่ retry อัตโนมัติเมื่อ timeout, network error, 5xx หรือ response อ่านไม่ได้ เพราะคำขออาจสำเร็จไปแล้ว UI จะแสดงสถานะไม่แน่นอนและห้ามกดซ้ำ
- ผล Create/Confirm ที่ไม่แน่นอนจะคงยอดที่กันไว้และ claim เดิมไว้จน signed Callback ยืนยันผล เพื่อป้องกันการใช้ยอดซ้ำระหว่าง reconciliation
- หาก process หยุดหลังกันยอดหรือ claim รายการ สถานะ `creating`/`confirming` ที่ค้างเกิน 5 นาทีจะเปิดปุ่มแก้สถานะในแผง “Callback”; สถานะ `uncertain` เปิดปุ่มทันที แต่ผู้ดูแลต้องตรวจใน Celox Console ก่อนทุกครั้ง เพราะการปลดผิดรายการอาจทำให้ถอนซ้ำได้
- การแก้ Create ที่ค้างจะคืนยอดที่พักไว้ ส่วนการแก้ Confirm ที่ค้างจะเปิดให้ยืนยันรายการเดิมอีกครั้งโดยยังพักยอดไว้ ทั้งสองปุ่มไม่เรียก Celox
- route แก้ยอดพักบังคับ same-origin `Origin`/`Sec-Fetch-Site` และจำกัด JSON body เพื่อกัน browser CSRF ขั้นพื้นฐาน แต่ไม่ใช่ authentication; ต้องครอบทั้งหน้าแอดมินและ mutation routes ด้วย session, role authorization และ rate limit ก่อนเปิดใช้งานผ่านเครือข่าย production
- `invalid_transaction_state` จาก Confirm ถือว่าผลไม่แน่นอนเหมือน timeout จึงคง claim ไว้รอ Callback/การตรวจสอบ ส่วน `401`, `404`, validation/mismatch `422` และข้อผิดพลาดถาวรอื่นไม่มี automatic retry
- `insufficient_balance` ไม่ retry อัตโนมัติ แต่อนุญาตให้ผู้ใช้กดยืนยันรายการ `PENDING` เดิมอีกครั้งหลังแก้ยอดกระเป๋าแล้ว
- UI แสดง error จากทุกกรณีเป็น toast และข้อความในขั้นตอนเดียวกันเพื่อไม่ให้บริบทหาย

## Celox C2C

เปิด `/customers` → “ทำรายการใหม่” → “ฝากแบบ C2C” หรือ “ถอนแบบ C2C” และติดตามรายการทั้งหมดที่ `/c2c-transactions`

Client อยู่ที่ `lib/celox/c2c-client.server.ts` และใช้ `fetch` + `CeloxError` ชุดเดียวกับ integration เดิม Credential อ่านจาก `CELOX_CLIENT_ID` และ `CELOX_CLIENT_SECRET` ฝั่ง server เท่านั้น ไม่เคยส่ง `X-Client-Secret` และไม่ใช้ตัวแปร `NEXT_PUBLIC_*`

ข้อสำคัญของ signer C2C:

- JSON ถูก `JSON.stringify` ครั้งเดียว แล้วใช้ string เดียวกันสำหรับ SHA-256 และ request body
- canonical path ใช้ `url.pathname` เต็มของ staging เช่น `/api/celox/v1/core/c2c/deposits` จากการตรวจจริง: เซ็นเฉพาะ `/v1/core/c2c/...` จะได้ 401 แต่ path เต็มผ่าน authentication
- GET, cancel และ multipart ใช้ SHA-256 ของ body ว่าง; multipart ไม่เอา bytes ของไฟล์เข้า signature
- ฝั่งฝากบันทึก `transferTo` ไว้เฉพาะ state ของ dialog ขณะโอน ไม่เก็บบัญชีบุคคลที่สามลง Postgres และหน้า C2C แสดงเพียงว่าบัญชีพร้อมหรือไม่

### ตัวอย่างที่รันได้

ใช้ `referenceId` ใหม่ทุกครั้ง คำสั่งเหล่านี้เรียก BFF ภายในเมื่อ dev server เปิดอยู่:

```bash
curl --fail-with-body \
  --request POST http://localhost:3000/api/celox/c2c/deposits \
  --header 'Content-Type: application/json' \
  --data '{
    "customerId": "C-1024",
    "amount": 5000,
    "sourceBankCode": "004",
    "sourceAccountName": "Somchai Jaidee",
    "sourceAccountNo": "9876543210",
    "matchTtlSeconds": 600,
    "referenceId": "ORDER-20260830-0001"
  }'
```

เมื่อ response มี `transferTo` แล้ว ใช้ `transactionId` เดิมแนบสลิปหนึ่งไฟล์:

```bash
TRANSACTION_ID='uuid-from-create-response'

curl --fail-with-body \
  --request POST \
  --form 'file=@/absolute/path/to/slip.jpg' \
  "http://localhost:3000/api/celox/c2c/deposits/$TRANSACTION_ID/slip"
```

ตรวจสถานะด้วย `orderId` หรือ `referenceId` และยกเลิกได้เฉพาะตอนยัง `PENDING`:

```bash
REFERENCE_ID='ORDER-20260830-0001'

curl --fail-with-body \
  "http://localhost:3000/api/celox/c2c/$REFERENCE_ID"

curl --fail-with-body \
  --request POST \
  "http://localhost:3000/api/celox/c2c/$TRANSACTION_ID/cancel"
```

ตัวอย่างสร้างรายการถอน C2C:

```bash
curl --fail-with-body \
  --request POST http://localhost:3000/api/celox/c2c/withdrawals \
  --header 'Content-Type: application/json' \
  --data '{
    "customerId": "C-1081",
    "amount": 1000,
    "destinationBankCode": "004",
    "destinationAccountName": "Wipada Chaiyo",
    "destinationAccountNo": "1234567890",
    "matchTtlSeconds": 900,
    "referenceId": "PAYOUT-20260830-0001"
  }'
```

### Callback C2C และ ngrok

ใช้ Callback URL เดียวกับฝาก–ถอน Celox ปกติใน Celox Console ได้เลย:

```text
https://YOUR_NGROK_DOMAIN/api/celox/callback
```

ระหว่างพัฒนาให้เปิดแอปที่ port 3000 แล้วรัน `ngrok http 3000` จากนั้นนำ HTTPS forwarding URL มาแทน `YOUR_NGROK_DOMAIN` route กลางจะแยก C2C จาก key `event`/`transferTo` แล้วส่งเข้า inbox C2C โดยไม่ปะปนกับ callback ปกติ หาก Console แยก URL สำหรับ C2C โดยเฉพาะก็ใช้ alias `https://YOUR_NGROK_DOMAIN/api/celox/c2c/callback` ได้ ตัว webhook จะทำงานดังนี้:

1. อ่าน JSON แบบจำกัดขนาดและตรวจ required/nullable fields
2. สร้าง canonical JSON จากหก field ที่ถูกเซ็นตามลำดับ `transactionId`, `orderId`, `referenceId`, `status`, `amount`, `occurredAt` โดยไม่รวม `event`; ถ้ามี key `transferTo` จึงต่อ object นี้ท้ายสุด
3. ตรวจ `X-Celox-Signature` ด้วย HMAC-SHA256 และ `CELOX_C2C_CALLBACK_SECRET` ซึ่ง fallback ไป `CELOX_CALLBACK_SECRET` หรือ `CELOX_CLIENT_SECRET`
4. commit ลง durable inbox `celox_c2c_callback_events` ด้วย idempotency key `(transactionId, status)` ก่อนตอบ HTTP 200
5. ประมวลผล ledger หลัง response ผ่าน `after()`: `PENDING_TRANSFER` อัปเดตสถานะ, `SUCCESS` ปิดยอด exact-once, `EXPIRED`/`CANCELLED` ปิดรายการและคืนยอดถอนที่พักไว้

`event` ใช้เก็บประกอบการตรวจสอบเท่านั้น การตัดสินใจทุกเส้นทางยึด `status` ข้อมูล `transferTo` ไม่ถูกเก็บลง Postgres หรือ log; inbox เก็บเฉพาะ SHA-256 ของ canonical signed payload เพื่อจับ payload conflict โดยไม่เปิดเผยบัญชีบุคคลที่สาม

ตัวอย่าง Callback ที่รันได้เมื่อ dev server เปิดอยู่ (เปลี่ยน ID ให้ตรงกับรายการ C2C จริงหากต้องการให้ ledger ถูกอัปเดต):

```bash
export CELOX_C2C_CALLBACK_SECRET='your-plaintext-client-secret'

SIGNED_C2C_BODY='{"transactionId":"018f2e2a-0000-7000-8000-000000000010","orderId":"DEP-C2C-20260830-0001","referenceId":"ORDER-20260830-0001","status":"PENDING_TRANSFER","amount":5000,"occurredAt":null,"transferTo":{"bankCode":"014","bankName":"ธนาคารกสิกรไทย","accountName":"Wipada Chaiyo","accountNo":"1234567890"}}'
C2C_CALLBACK_BODY='{"transactionId":"018f2e2a-0000-7000-8000-000000000010","orderId":"DEP-C2C-20260830-0001","referenceId":"ORDER-20260830-0001","status":"PENDING_TRANSFER","amount":5000,"occurredAt":null,"event":"matched","transferTo":{"bankCode":"014","bankName":"ธนาคารกสิกรไทย","accountName":"Wipada Chaiyo","accountNo":"1234567890"}}'
C2C_SIGNATURE="$(printf '%s' "$SIGNED_C2C_BODY" | openssl dgst -sha256 -hmac "$CELOX_C2C_CALLBACK_SECRET" -binary | xxd -p -c 256)"

curl --fail-with-body \
  --request POST http://localhost:3000/api/celox/callback \
  --header 'Content-Type: application/json' \
  --header "X-Celox-Signature: $C2C_SIGNATURE" \
  --data-binary "$C2C_CALLBACK_BODY"
```

Response คือ `{ "received": true, "duplicate": false }`; เมื่อส่ง signed payload เดิมซ้ำจะได้ `duplicate: true` และไม่มีการปรับยอดซ้ำ

Callback C2C ไม่มี retry จาก Celox ระบบจึงตอบ 200 หลัง commit inbox เท่านั้น งานหลัง response retry เฉพาะ Postgres SQLSTATE `40001` (serialization_failure)/`40P01` (deadlock_detected) สูงสุด 3 attempts: ครั้งแรกทันที แล้ว full-jitter 0–500 ms และ 0–1,000 ms ส่วน signature, validation, payload mismatch และสถานะที่ไม่รองรับเป็น permanent error ไม่ retry อัตโนมัติ สถานะจริงยังตรวจซ้ำได้จาก `GET /api/celox/c2c/{reference}` ซึ่งเป็นแหล่งข้อมูลหลักของ C2C

### Retry และ backoff policy สำหรับ C2C

- Create deposit, create withdrawal และ cancel retry อัตโนมัติเฉพาะ `409 c2c_busy` หรือ `429 rate_limited` ที่เป็นการปฏิเสธชัดเจน สูงสุด 3 attempts
- ใช้ full-jitter exponential backoff ช่วง 0–500 ms, 0–1,000 ms และเพดาน 4 วินาที; หากมี `Retry-After` จะใช้ค่านั้นเฉพาะเมื่อไม่เกิน 10 วินาที
- GET สถานะ retry network/timeout ได้สูงสุด 3 attempts เพราะเป็น read-only และหน้า C2C poll เฉพาะรายการที่กำลังเปิดดูทุก 10 วินาที
- Slip retry อัตโนมัติเฉพาะ `429 rate_limited`; timeout/network/response ไม่ครบถือว่าผลไม่แน่นอนและต้อง GET สถานะก่อนแนบซ้ำ
- ไม่ retry 4xx ถาวรทุกกรณี ได้แก่ 401, 403, `reference_id_conflict`, `c2c_already_matched`, validation/split 422, C2C disabled, duplicate destination, insufficient balance, invalid state, file/deposit/slip errors และ `c2c_org_limit_reached`
- Create/Slip/Cancel ที่ timeout, network error, 5xx หรือ response ไม่ครบจะไม่ถูกส่งซ้ำ เพราะ Celox อาจ commit ไปแล้ว UI จะคง Reference ID ให้ใช้ตรวจรายการเดิม
- ถอน C2C กันยอดลูกค้าก่อนเรียก Celox หากผลไม่แน่นอนจะคง reservation ไว้; เมื่อ GET ด้วย Reference ID พบรายการจริง ระบบจะผูก reservation และ reconcile แบบ exact-once
- Create withdrawal รองรับ `PENDING_MANUAL_C2C`; ระบบคงยอดที่กันไว้ แสดงสถานะรอเจ้าหน้าที่ และไม่เปิดปุ่มยกเลิกเหมือนรายการ `PENDING`
