# อัปเดต Celox C2C Callback Webhook เป็น Signature Scheme v2

วันที่: 2026-09-08
สถานะ: implement แล้ว เสร็จสมบูรณ์ ในรีโพนี้ (commit ยังไม่ได้ทำ — ผู้ใช้ยังไม่ได้สั่ง commit)
เอกสารนี้เขียนไว้ให้เครื่อง/เซสชันอื่นที่มีโค้ดเบสเดียวกันทำตามเพื่อรีพลิเคตงานชิ้นเดียวกัน

## เป้าหมาย

Celox อัปเดต contract ของ webhook "Callback C2C" (ผลของธุรกรรม C2C ที่ Celox
ยิงกลับมาหาเรา) ต้องอัปเดตโค้ดฝั่งเรารับ callback นี้ให้ตรงกับ contract ใหม่
โดยเฉพาะ **signature verification scheme เปลี่ยนทั้งหมด** จากเซ็น
canonical-JSON ของ field ที่เลือกมา (ไม่มี timestamp) เป็นเซ็น **raw request
body ทั้งก้อน + timestamp** (v2)

โปรเจกต์นี้ไม่มี ORM/migration framework, ใช้ Postgres ผ่าน `pg` ตรงๆ, เขียน
Next.js App Router (Route Handler), test ด้วย Vitest + PGlite แบบ
in-memory — งานนี้ไม่แตะ schema ฐานข้อมูลเลย และไม่แตะ business logic การ
หักเงินจริงเลย (ดูหัวข้อ "ทำไมไม่ต้องแก้ business logic" ด้านล่าง)

## Contract ใหม่ (Authoritative Source — ต้นทางจาก Celox)

**Endpoint**: เราเป็น server, Celox เป็นคนยิง `POST` เข้ามาเอง เราไม่ได้เรียก
อะไรออกไปเพื่อรับ callback นี้

**Headers ที่ Celox ส่งมา**:
- `Content-Type: application/json`
- `X-Celox-Timestamp`: เวลา unix หน่วยวินาที ตอนที่ Celox ยิง
- `X-Celox-Signature`: `hmac-sha256(client secret, "v2\n" + X-Celox-Timestamp + "\n" + sha256hex(raw body))`

**กติกาการตรวจลายเซ็น (สำคัญที่สุด)**:
1. ทั้ง raw body ถูก hash เป็นก้อนเดียว **ไม่มี field list ไม่มี canonical
   JSON ไม่มีการเรียง key ใหม่** — field ใหม่ที่ Celox เพิ่มเข้ามาวันหน้า
   verify ผ่านได้ทันทีโดยไม่ต้องแก้โค้ดฝั่งเรา
2. ต้องอ่าน body เป็น raw bytes/string **ก่อน** parse JSON เสมอ — ถ้า parse
   ก่อนแล้วค่อย `JSON.stringify` กลับมา hash จะได้ byte ที่ต่างจากที่ Celox
   เซ็นจริง (key order/whitespace/เลขทศนิยมเปลี่ยน) ทำให้ callback ของจริง
   verify ไม่ผ่าน — กับดักคลาสสิกของทุก framework ที่มี body parser
   middleware แบบ global (เช่น Express `express.json()` จะ parse แล้วทิ้ง
   raw bytes ไปเลย ต้องสลับไปใช้ `express.raw({ type: 'application/json' })`
   เฉพาะ route นี้)
3. `bodyHash = lowercase hex sha256(rawBodyBytes)`
4. `material = "v2" + "\n" + X-Celox-Timestamp (ตัวเดิมเป๊ะ) + "\n" + bodyHash`
5. `expectedSignature = lowercase hex HMAC-SHA256(material, client secret ของเราเอง)`
6. เทียบกับ `X-Celox-Signature` ด้วย constant-time compare
   (`crypto.timingSafeEqual`) ห้ามใช้ `===`
7. ปฏิเสธถ้า `X-Celox-Timestamp` ห่างจากนาฬิกาเราเกิน 300 วินาที (ทั้งสอง
   ทิศทาง) — กัน replay ต้องเช็คแม้ signature จะตรงก็ตาม
8. Celox เอกสารบอกว่า verify เป็น **optional** และอาจไม่ส่ง header ทั้งคู่มา
   เลยเมื่อ credential ของ org เก่าเกินไป (ไม่ควรถือว่า header หายไปคือ
   หลักฐานว่าเป็นของปลอม) — **แต่โปรเจกต์นี้เลือกปฏิเสธเสมอถ้า header ใด
   หายไป** เพราะ callback นี้เกี่ยวกับการหักเงินจริง (ดูตารางตัดสินใจด้านล่าง)
9. ห้าม reject request เพราะเจอ field ที่ไม่รู้จักใน body เด็ดขาด — raw body
   ถูก hash เป็น opaque bytes ทั้งก้อนอยู่แล้ว field แปลกปลอมไม่มีทางทำให้
   ลายเซ็นพัง แค่เป็น field ที่โค้ดยังไม่ได้สอนให้ใช้เท่านั้น

**Body fields ทั้งหมด** (`transactionId`, `orderId`, `referenceId`,
`status`, `amount`, `occurredAt` เหมือนเดิมทุกประการ):
- `event` (conditional, enum: matched/settled/parked/expired/cancelled/failed)
  — เป็นแค่คำประกอบ **ต้องแยกทางด้วย `status` เสมอ ห้ามแยกทางด้วย `event`
  เพียงอย่างเดียว**
- `transferTo` (conditional: bankCode/bankName/accountName/accountNo,
  ทุกตัว nullable)
- `parts[]` (always present, array อย่างน้อย 1 ตัวเสมอแม้ไม่ได้ split)
- `unfilledAmount` (conditional, เฉพาะ callback ถอน C2C)
- **`settledTotal`** (conditional, ใหม่ในเวอร์ชันนี้) — เฉพาะ callback ถอน
  C2C ที่ทำให้กลุ่มจบแบบ terminal เท่านั้น
- **`unfilledTotal`** (conditional, ใหม่ในเวอร์ชันนี้) — เหมือน
  `settledTotal` แต่เป็นยอดที่ไม่สำเร็จ

**Response ที่เราต้องตอบ**: HTTP 2xx = สำเร็จ, body ไม่ถูกอ่านเลย

## ทำไมไม่ต้องแก้ business logic

`lib/db.ts` (`finalizeC2CSuccess`/`settleC2CWithdrawal`) ใช้แค่ field
`amount` ระดับบนสุดของ callback ในการคำนวณยอดหักเงินจริง **ไม่เคยแตะ**
`parts[]`/`unfilledAmount`/`settledTotal`/`unfilledTotal` เลย — สอง field
ใหม่จึงเป็นแค่ข้อมูลประกอบ (informational) ไม่ต้องแก้ schema DB หรือ
business logic ใดๆ ถ้าโค้ดเบสอื่นมี business logic ที่อิงกับ field พวกนี้
จริง ให้ตรวจสอบจุดนั้นเพิ่มเองก่อน merge

## การตัดสินใจหลัก (ต้องถามผู้ใช้ก่อนทุกครั้งที่ replicate งานนี้)

| หัวข้อ | ที่เลือกในโปรเจกต์นี้ | เหตุผล |
|---|---|---|
| Header หายไปทั้งคู่ (`X-Celox-Timestamp`+`X-Celox-Signature`) | **ปฏิเสธเสมอ** (401) แม้ Celox บอกว่าเป็นพฤติกรรมปกติสำหรับ credential เก่า | ผู้ใช้ยอมรับความเสี่ยงที่ integration อาจพังสำหรับ org ที่ credential เก่าเกิน แลกกับไม่มีทาง process callback ที่ไม่ยืนยันตัวตนได้เลย เพราะเกี่ยวกับการหักเงินจริง |
| Scheme เดิม (v1: canonical-JSON, ไม่มี timestamp) | **ลบทิ้งทั้งหมด ไม่ fallback** | contract ใหม่ที่ผู้ใช้ให้มาไม่มีพูดถึง v1 เลย ถือว่าเป็น contract เดียวที่ใช้งานจริงตอนนี้ |
| `settledTotal`/`unfilledTotal` | เพิ่ม type + validate (non-negative amount) แต่ **ไม่เก็บลง DB คอลัมน์ใหม่** | ไม่มี business logic ใดต้องใช้ ข้อมูลนี้ดูได้จาก raw callback log อยู่แล้วถ้าโปรเจกต์มีฟีเจอร์ log |
| Fingerprint กันข้อมูลซ้ำ (`signed_payload_hash` หรือเทียบเท่า) | เปลี่ยนจาก hash(canonical-JSON) เป็น **hash(raw body ดิบ)** | ง่ายกว่า, ไม่มีวันตกยุค, ไม่ต้องแก้ schema (ยังเป็น sha256 hex 64 ตัวอักษรเหมือนเดิม) |

ถ้า replicate งานนี้กับผู้ใช้คนอื่น/โปรเจกต์อื่น **ต้องถามคำถามในตารางนี้
ใหม่ทุกครั้ง** อย่าเดาเอาเองว่าคำตอบจะเหมือนกัน โดยเฉพาะแถวแรก (missing
header policy) เพราะเป็น security/business trade-off ที่ขึ้นกับความเสี่ยง
ที่แต่ละทีมรับได้ไม่เท่ากัน

## Implementation (ไฟล์ที่ต้องแก้ ในโค้ดเบสนี้)

### 1. `lib/celox/types.ts`
เพิ่มใน `CeloxC2CCallbackRequest`:
```ts
settledTotal?: number;
unfilledTotal?: number;
```

### 2. `lib/celox/c2c-callback-validation.ts`
ลบเงื่อนไข "reject ถ้ามี key แปลกปลอม" ทั้งหมด (top-level, `transferTo`,
`parts[]`) — ก่อนหน้านี้มี `CALLBACK_KEYS`/`PART_KEYS`/`TRANSFER_TO_KEYS`
ใช้เช็ค `Object.keys(value).some((key) => !KNOWN_KEYS.has(key))` แล้ว
return false ต้องลบเงื่อนไขนี้ออกทุกจุด (เหลือแค่เช็ครูปร่างของ field ที่
รู้จัก) แล้วเพิ่ม validate `settledTotal`/`unfilledTotal` เป็น non-negative
amount แบบเดียวกับ `unfilledAmount` เดิม

### 3. `lib/celox/c2c-callback.server.ts` — จุดเปลี่ยนใหญ่สุด
ลบ `canonicalizeCeloxC2CCallback`, `hashCeloxC2CCallbackPayload`,
`verifyCeloxC2CCallbackSignature` (v1) ทั้งหมด แทนด้วย:

```ts
const REPLAY_WINDOW_SECONDS = 300;

export function hashRawC2CCallbackBody(rawBody: string) {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function verifyCeloxC2CCallbackSignatureV2(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
) {
  if (!timestampHeader) unauthenticated("X-Celox-Timestamp หายไป");
  if (!signatureHeader) unauthenticated("X-Celox-Signature หายไป");
  if (!/^\d+$/.test(timestampHeader)) unauthenticated("รูปแบบ timestamp ไม่ถูกต้อง");

  const skewSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestampHeader));
  if (skewSeconds > REPLAY_WINDOW_SECONDS) unauthenticated("timestamp ห่างเกินกำหนด");

  const supplied = signatureHeader.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(supplied)) unauthenticated("รูปแบบ signature ไม่ถูกต้อง");

  const material = `v2\n${timestampHeader}\n${hashRawC2CCallbackBody(rawBody)}`;
  const expected = createHmac("sha256", callbackSecret()).update(material, "utf8").digest();
  const received = Buffer.from(supplied, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    unauthenticated("ลายเซ็นไม่ถูกต้อง");
  }
}
```
(`callbackSecret()`, `isRetryablePostgresError`,
`processCeloxC2CCallbackEventWithRetry` เดิมไม่ต้องแก้)

### 4. `lib/celox/c2c-callback-handler.server.ts`
`acceptCeloxC2CCallbackPayload` เปลี่ยน signature จาก
`(payload, signatureHeader)` เป็น
`(payload, rawBody, timestampHeader, signatureHeader)` — เรียก
`verifyCeloxC2CCallbackSignatureV2(rawBody, timestampHeader, signatureHeader)`
และ `enqueueCeloxC2CCallbackEvent(payload, hashRawC2CCallbackBody(rawBody))`
แทนของเดิม ส่วน orchestration/response ที่เหลือไม่เปลี่ยน

### 5. ทุก Route Handler ที่เรียก `acceptCeloxC2CCallbackPayload`
ในโค้ดเบสนี้มี **2 จุดเรียก** ต้องแก้ทั้งคู่ (เจอจุดที่สองตอน
`npx tsc --noEmit` — พลาดง่ายถ้าไม่ grep หา call site ทั้งหมดก่อนแก้):
- `app/api/celox/c2c/callback/route.ts`
- `app/api/celox/callback/route.ts` (route กลางที่ dispatch payload
  รูปร่าง C2C ไปให้ handler เดียวกันผ่าน `looksLikeCeloxC2CCallback`)

ทั้งคู่ต้องอ่าน raw body **ก่อน** `JSON.parse` อยู่แล้ว (มีโค้ดเดิมทำแบบนี้
เพื่อจำกัดขนาด body) ให้ส่ง raw text (ไม่ใช่ payload ที่ parse แล้ว) +
`request.headers.get("X-Celox-Timestamp")` เข้า `acceptCeloxC2CCallbackPayload`
เพิ่มจากเดิมที่ส่งแค่ signature header

## Test Plan (TDD บังคับทุกไฟล์ — RED ก่อนแก้ implementation เสมอ)

เขียน `signV2(rawBody, timestamp)` helper ใน**ไฟล์ test เท่านั้น** implement
independent จาก production code (ห้าม import มาจาก production แล้วเรียกมัน
เซ็นเอง — จะพลาด bug ร่วมกันไม่ได้ถ้าทำแบบนั้น)

รายการ test ที่ต้องมี (กระจายตามไฟล์ที่แก้ในหัวข้อก่อนหน้า):
- `hashRawC2CCallbackBody`: deterministic, byte ต่างแม้แค่ 1 ตัวก็ hash ต่าง
- `verifyCeloxC2CCallbackSignatureV2`: signature ถูก, signature ผิด/tamper,
  timestamp header หาย, signature header หาย, ทั้งคู่หาย, timestamp เก่า
  เกิน 300 วิ, timestamp ใหม่เกิน 300 วิ (อนาคต), boundary พอดี 300 วิ,
  timestamp ไม่ใช่ตัวเลข
- `isCeloxC2CCallbackRequest`: field แปลกปลอมต้องผ่าน (พลิก test เดิมที่
  เคยยืนยันว่า reject — นี่คือจุดที่พฤติกรรมเปลี่ยนตรงๆ), field แปลกปลอม
  ที่ซ้อนใน `transferTo`/`parts[]` ก็ต้องผ่าน, `settledTotal`/
  `unfilledTotal` ยอมรับรวมถึงค่า 0, ปฏิเสธค่าติดลบ
- `acceptCeloxC2CCallbackPayload` (handler): accept เมื่อเซ็นถูก, accept
  แม้ body มี field ใหม่ที่ไม่รู้จัก, **reject เมื่อ raw body ที่ส่งมาต่าง
  จากที่เซ็นจริงแม้ payload ที่ parse แล้วจะเหมือนกัน** (regression test
  สำหรับกับดัก re-serialization ข้อ 2 ด้านบน — เอา `payload` เดิมมา
  `JSON.stringify` ใหม่ด้วย key order ต่างกัน แล้วพิสูจน์ว่า verify ไม่
  ผ่าน), missing header ต้อง 401, idempotent เมื่อยิง transactionId+status
  ซ้ำ
- Route test ทั้ง 2 route: raw log (ถ้าโปรเจกต์มีฟีเจอร์นี้) ต้องยังบันทึก
  ถูกต้องหลังแก้, เพิ่ม `X-Celox-Timestamp` header ในทุก request ที่ test
  ยิงเข้า route โดยตรง

## Checklist ก่อนถือว่าเสร็จ

```bash
npx vitest run         # ทุกไฟล์ต้องผ่าน รวมไฟล์ test ใหม่/ที่แก้
npx tsc --noEmit        # เจอ call site ที่ลืมแก้ตรงนี้ได้ (type error จะฟ้อง arity ไม่ตรง)
npm run lint            # eslint .
```

ถ้าจะรันจริงกับ Supabase (ไม่ใช่ PGlite ใน test) ให้เช็คว่า schema/migration
ที่เกี่ยวข้อง (ถ้ามี) ถูก apply แล้ว — งานนี้เองไม่มี migration ใหม่ เพราะ
ไม่แตะ DB schema เลย
