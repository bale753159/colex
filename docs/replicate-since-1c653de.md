# สรุปงานที่ต้อง port: `1c653de` → `0133363`

> ใช้ไฟล์นี้เป็นแผนที่ตอนแก้อีก branch/อีกเว็บให้เหมือน repo นี้
> ช่วงที่ครอบคลุม: `1c653de` (fix redirect "error") ถึง `0133363` (HEAD ตอนเขียน) — 11 commit
>
> **ไฟล์ประกอบที่ต้องพกไปด้วย** (มีรายละเอียดเต็มอยู่แล้ว ไฟล์นี้จะไม่เขียนซ้ำ):
> - `docs/superpowers/specs/2026-09-10-celox-c2c-settled-amount-prompt.md` — contract C2C ใหม่ + กฎเรื่องเงิน + ลายเซ็น v2 (วางเป็น prompt ให้ agent ได้ทั้งไฟล์)
> - `docs/c2c-callback-feed.md` — ฟีด callback ใน dialog ฝาก/ถอน
> - `docs/superpowers/specs/2026-09-08-celox-c2c-callback-v2-design.md` — **อ่านเฉพาะส่วนลายเซ็น v2** ส่วน body fields ตกยุคแล้ว

---

## อ่านก่อน: port "สถานะสุดท้าย" ไม่ใช่ไล่ทีละ commit

หลาย commit ในช่วงนี้แก้ทับกันเอง ถ้า cherry-pick ตามลำดับจะได้สถานะกลางทางที่ผิด:

| commit กลางทาง | ถูกแทนที่ด้วย | สถานะสุดท้ายที่ต้องได้ |
|---|---|---|
| `13efe27` — ไม่นับ `amount` ต่างเป็น conflict เมื่อสถานะยังไม่ terminal | `70937ce` | `amount` **กลับมาเป็น identity field** (contract ใหม่ตอบยอดตั้งต้นเสมอ) · terminal ซ้ำต้อง sha256(raw body) ตรงกัน |
| `70937ce` — ใช้ชื่อ `realWithdrawAmount` / migration `0004_c2c_real_withdraw_amount.sql` | `c171514` | ชื่อจริงคือ `settledAmount` / `settled_amount_satang` · migration ชื่อ `0004_c2c_settled_amount.sql` |
| `0eb78ca` — `acceptCeloxC2CCallbackPayload(payload, signatureHeader)` | `2579938` | `(payload, rawBody, timestampHeader, signatureHeader)` |
| `da1f763` — แยก C2C ด้วย `parts` | `70937ce` เพิ่ม | แยกด้วย `parts` (array) **หรือ** มีคีย์ `transactionStatus` |

---

## ภาพรวม commit

| # | commit | เรื่อง | ต้อง port? |
|---|---|---|---|
| 1 | `1c653de` | เลิกใช้ `redirect: "error"` ฝั่ง server (workerd) | ✅ ถ้า deploy บน Cloudflare Workers |
| 2 | `5b5b3e6` | `wrangler.jsonc` เพิ่ม env `main` / `tom-mobile` + custom domain | ⚠️ เฉพาะโครง ชื่อ/โดเมนเป็นของโปรเจกต์นี้ |
| 3 | `0eb78ca` | ตาราง + หน้า log ดิบของ callback C2C | ✅ |
| 4 | `2579938` | ลายเซ็น callback C2C v2 (raw body + timestamp) | ✅ |
| 5 | `13efe27` | callback ซ้ำที่สถานะยังไม่ terminal ไม่ใช่ conflict | ↪ ดูตารางด้านบน |
| 6 | `da1f763` | endpoint กลางแยก C2C ด้วย `parts` (แก้ 401) | ✅ |
| 7 | `70937ce` | contract ใหม่ `transactionStatus` / `settledAmount` ฯลฯ | ✅ (สถานะสุดท้ายตาม `c171514`) |
| 8 | `c171514` | rename `realWithdrawAmount` → `settledAmount` | ✅ |
| 9 | `78c8f10` | docs prompt สำหรับ replicate contract | 📄 เอกสาร |
| 10 | `491e608` | ฟีด callback ใน dialog + delta polling หน้า C2C | ✅ |
| 11 | `0133363` | ฝากเงิน C2C ผ่าน `payUrl` ใน iframe | ✅ |

---

## ลำดับที่แนะนำให้ทำในอีก branch

1. Redirect fix (ข้อ A) — อิสระ ทำก่อนได้เลย
2. Migration `0003` + `0004` (ข้อ B) — **ต้องรันบน DB ก่อน deploy โค้ดใหม่**
3. Contract C2C + ลายเซ็น v2 + การแยก C2C บน endpoint กลาง (ข้อ C)
4. Raw callback log (ข้อ D)
5. Callback timeline endpoint + ฟีดใน dialog (ข้อ E)
6. Delta polling หน้ารายการ C2C (ข้อ F)
7. `payUrl` iframe (ข้อ G)
8. wrangler env (ข้อ H) ถ้าจำเป็น

---

## A. เลิกใช้ `redirect: "error"` ในคำขอฝั่ง server — `1c653de`

**ปัญหา:** workerd โยน `TypeError` ทันทีเมื่อเจอ `redirect: "error"` ("won't be implemented since it
does not make sense at the edge") ก่อนเปิด socket → ทุกคำขอไป Celox จาก Worker ตกลง `catch`
ของ fetch แล้วถูกรายงานเป็น `network_error` / 502 ทั้งที่ยังไม่ได้ส่งอะไรออกไป บน Node ปกติดี
บั๊กจึงโผล่เฉพาะตอน deploy

**แก้:** ใช้ `redirect: "manual"` แล้วปฏิเสธ 3xx เอง เพื่อรักษาเจตนาเดิม (ห้ามส่งคำขอที่เซ็นแล้ว
ต่อไปที่อื่น และห้ามอ่าน body ของ redirect เป็นคำตอบ)

ไฟล์ที่แก้ (ทุกจุดฝั่ง server ที่ยิงหา Celox):
- `lib/celox/c2c-client.server.ts` — `callSignedJson`, `attachC2CDepositSlip`
- `lib/celox/client.server.ts` — `createDeposit`, `callWithdrawalEndpoint`
- `app/api/celox/deposits/[id]/slip/route.ts`

```ts
const NO_FOLLOW_REDIRECT = "manual" as const;

function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

// ใน fetch init
redirect: NO_FOLLOW_REDIRECT,

// หลัง fetch สำเร็จ ก่อน readJson(response)
if (isRedirect(response)) {
  throw new CeloxError({
    code: "invalid_response",
    message: "Celox ตอบกลับด้วย redirect ระหว่าง<การกระทำ> ซึ่งระบบไม่เดินตาม กรุณาอย่าส่งซ้ำ",
    httpStatus: 502,
  });
}
```

ใน route handler ที่คืน `Response` เอง (slip route) ให้คืน `errorResponse(502, { code: "invalid_response", retryable: false, ... })` แทนการ throw

**ไม่ต้องแก้:** โค้ดฝั่งเบราว์เซอร์ (เช่น `c2c-deposit-flow-dialog.tsx`) — `redirect: "error"` ใช้ได้ในเบราว์เซอร์

**ค้นให้ครบ:** `grep -rn 'redirect: "error"' lib app` แล้วแยกว่าตัวไหนรันบน server

**เทสต์:** ล็อกว่า `fetch` ถูกเรียกด้วย `redirect` ∈ `["follow", "manual", undefined]` และ stub `302`
พร้อม `Location` แล้วต้อง reject ด้วย `code: "invalid_response"`

---

## B. Migrations

รันตามลำดับ **ก่อน deploy โค้ด** (ถ้าโค้ดใหม่ขึ้นก่อน callback จะตอบ 5xx `persistence_error`
และ Celox ไม่ยิงซ้ำ → callback ก้อนนั้นหายถาวร) และรันให้ครบ **ทุก DB ของทุก environment ที่รับ callback**

### `supabase/migrations/0003_c2c_callback_raw_logs.sql`

```sql
CREATE TABLE IF NOT EXISTS celox_c2c_callback_raw_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at timestamptz NOT NULL,
  request_url text NOT NULL,
  request_body text,
  response_status bigint NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body text
);
CREATE INDEX IF NOT EXISTS idx_celox_c2c_callback_raw_logs_received
  ON celox_c2c_callback_raw_logs(received_at DESC);
```

### `supabase/migrations/0004_c2c_settled_amount.sql`

```sql
ALTER TABLE celox_c2c_transactions
  ADD COLUMN IF NOT EXISTS unfilled_amount_satang bigint
    CHECK (unfilled_amount_satang IS NULL OR unfilled_amount_satang >= 0);

ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS settled_amount_satang bigint NOT NULL DEFAULT 0
    CHECK (settled_amount_satang >= 0);
ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS unfilled_amount_satang bigint
    CHECK (unfilled_amount_satang IS NULL OR unfilled_amount_satang >= 0);

ALTER TABLE celox_c2c_callback_events DROP COLUMN IF EXISTS occurred_at;
ALTER TABLE celox_c2c_callback_events DROP COLUMN IF EXISTS provider_event;

ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS all_parts_terminal boolean NOT NULL DEFAULT false;
ALTER TABLE celox_c2c_callback_events
  ADD COLUMN IF NOT EXISTS awaiting_manual_review boolean NOT NULL DEFAULT false;
```

> ถ้าอีก branch เคยรัน `0004_c2c_real_withdraw_amount.sql` (สถานะกลางทางของ `70937ce`) ไปแล้ว
> ต้องเขียน migration rename `real_withdraw_amount_satang` → `settled_amount_satang` เพิ่ม

อย่าลืมอัปเดต test harness/schema test ให้รู้จักตารางและคอลัมน์ใหม่
(ใน repo นี้คือ `test/pg-harness.ts`, `test/schema.test.ts`)

---

## C. Contract C2C ใหม่ + ลายเซ็น v2 + การแยก C2C — `2579938`, `da1f763`, `70937ce`, `c171514`

**รายละเอียดเต็มอยู่ใน `2026-09-10-celox-c2c-settled-amount-prompt.md`** สรุปจุดที่ต้องได้:

**Body (ใช้ type + validator ตัวเดียวทั้ง GET `/v1/core/c2c/{reference}` และ callback)**
- `status` → `transactionStatus` ทั้งหัว body และใน `parts[]`
- ยอดที่จบจริง = `settledAmount` (ทั้งฝากและถอน) — `amount` เป็นยอดตั้งต้นเสมอ **ห้ามใช้ตัดเงิน**
- `unfilledAmount`: ขาถอนเป็นตัวเลขเสมอ ขาฝากเป็น `null` เสมอ
- `parts[]` เป็น array ≥ 1 เสมอ ไม่มี `parts[].transactionId`
- ถอด `settledTotal`, `unfilledTotal`, `occurredAt`, `event` ออก (ถ้าหลุดมาต้องไม่ reject)
- **ห้าม reject field ที่ไม่รู้จัก** ทุกระดับ

**กฎเรื่องเงิน**
- ขยับเงินเมื่อ **ทุกก้อนใน `parts` terminal** (`SUCCESS`/`EXPIRED`/`CANCELLED`) เท่านั้น — คำนวณเป็น
  `all_parts_terminal` ตอน enqueue เพราะตอน process ไม่มี `parts` แล้ว
- ห้ามเขียนสถานะ terminal ลงแถวรายการขณะที่ยังมีก้อนวิ่งอยู่
- ขาถอน: หัก `settledAmount` คืน `unfilledAmount` และตรวจ `settled + unfilled = amount` — ไม่ตรง = failed ไม่ขยับเงิน
- ตรวจ `settledAmount <= amount` ทั้งสองขา
- `awaitingManualReview` อ่านจาก body ตรงๆ
- บันทึกสถานะจริงที่ Celox ส่งมา ไม่ hardcode `SUCCESS` (แยกสำเร็จ/ไม่สำเร็จด้วย `settledAmount > 0`)

**ลายเซ็น v2** (`lib/celox/c2c-callback.server.ts`)
- `X-Celox-Signature = hmac-sha256(secret, "v2\n" + X-Celox-Timestamp + "\n" + sha256hex(raw body))`
- อ่าน raw body ก่อน parse, เทียบด้วย `timingSafeEqual`, ปฏิเสธ timestamp ห่างเกิน 300 วินาทีทั้งสองทิศ
- header หายตัวใดตัวหนึ่ง → 401 (นโยบายของ repo นี้ — **ถามเจ้าของอีกโปรเจกต์ก่อน**)
- ลบ v1 (canonical JSON) ทิ้งทั้งหมด ไม่มี fallback
- `signed_payload_hash` ของ inbox = sha256 ของ raw body

**Idempotency / conflict** (`lib/db.ts` → `c2cCallbackPayloadMatches`, `enqueueCeloxC2CCallbackEvent`)

```ts
function c2cCallbackPayloadMatches(row, input, amountSatang, signedPayloadHash) {
  const sameIdentity = row.order_id === input.orderId
    && row.reference_id === input.referenceId
    && row.amount_satang === amountSatang;
  if (!sameIdentity) return false;
  if (!isC2CTerminalStatus(input.transactionStatus)) return true;   // ยังไม่ terminal → ยอดเปลี่ยนได้
  return row.signed_payload_hash === signedPayloadHash;              // terminal → body ต้องเดิมเป๊ะ
}
```

- unique key ของ inbox = `(transaction_id, provider_status)`
- ส่งซ้ำแบบไม่ conflict → อัปเดต `settled_amount_satang` / `unfilled_amount_satang` /
  `awaiting_manual_review` / `all_parts_terminal` / `signed_payload_hash` ของแถวเดิมเป็นค่าล่าสุด

**การแยก C2C บน endpoint กลาง `/api/celox/callback`** (`lib/celox/c2c-callback-handler.server.ts`)

```ts
export function looksLikeCeloxC2CCallback(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Array.isArray((value as Record<string, unknown>).parts)
      || Object.hasOwn(value, "transactionStatus"));
}
```

ห้ามแยกด้วย `event`/`transferTo` แบบเดิม — callback ถอนที่ยังไม่จับคู่ไม่มีทั้งสองตัว จะหลุดไป verifier
ของ callback ปกติแล้วโดน 401 ทุกครั้ง

**Call site ที่ต้องแก้ทั้งคู่** (`acceptCeloxC2CCallbackPayload(payload, rawBody, timestampHeader, signatureHeader)`):
- `app/api/celox/c2c/callback/route.ts`
- `app/api/celox/callback/route.ts`

**อื่นๆ:** หน้า `app/c2c-transactions/page.tsx` แสดง "ยอดที่จบจริง" จาก `settledAmount`
และ "ยอดที่ต้องคืนลูกค้า" จาก `unfilledAmount` (`null` = "ไม่ใช้กับฝั่งฝาก") · README ส่วน
"Callback C2C และ ngrok" เขียนใหม่ตามลายเซ็น v2

---

## D. Raw callback log — `0eb78ca`

เก็บ request/response ดิบของ **ทุก** request ที่เข้า `/api/celox/c2c/callback` ไม่ว่าผ่านลายเซ็น/validate หรือไม่
ใช้ไล่ปัญหา callback (ตาราง event เดิมเก็บแค่ field ที่ parse แล้ว)

**ไฟล์**
- `lib/db.ts` — `insertC2CCallbackRawLog({ requestUrl, requestBody, responseStatus, responseBody })`,
  `listC2CCallbackRawLogs(limit)` (clamp 1–200, default 50, เรียง `received_at DESC, id DESC`)
- `lib/celox/types.ts` — `CeloxC2CCallbackRawLogItem`, `CeloxC2CCallbackRawLogsResponse`
- `app/api/celox/c2c/callback-logs/route.ts` — `GET ?limit=` คืน `{ logs }` พร้อม `Cache-Control: no-store`
- `app/c2c-callback-logs/page.tsx` — หน้า UI ค้นหา/ดูรายละเอียด log
- `app/components/app-shell.tsx` — เมนู "Log Callback C2C" (ไอคอน `FileClock`), เพิ่ม `"callback-logs"` ใน `active`
- `app/globals.css` — สไตล์หน้า log

**การบันทึกใน route** — แยก handler เดิมออกเป็น `handleCallback` แล้วห่อ:

```ts
export async function POST(request: Request): Promise<Response> {
  const requestBody = { current: null as string | null };
  const response = await handleCallback(request, requestBody); // handleCallback set requestBody.current = raw text
  const responseBody = await response.clone().text();
  after(() => {
    void insertC2CCallbackRawLog({
      requestUrl: request.url,
      requestBody: requestBody.current,
      responseStatus: response.status,
      responseBody,
    }).catch(() => undefined);   // log พังต้องไม่กระทบการตอบ Celox
  });
  return response;
}
```

> ⚠️ ใน repo นี้ log ถูกติดไว้ **เฉพาะ** `/api/celox/c2c/callback` — endpoint กลาง `/api/celox/callback`
> ไม่ได้บันทึก ถ้า Celox Console ของอีกเว็บชี้ callback ไปที่ endpoint กลาง ให้ติด wrapper เดียวกันที่นั่นด้วย
> ไม่งั้นหน้า log จะว่าง
>
> ⚠️ หน้า log แสดง raw body ซึ่งมี `transferTo` (ข้อมูลบัญชีบุคคลที่สาม) — ต้องอยู่หลัง auth ของ admin

---

## E. Callback timeline + ฟีดใน dialog — `491e608`

**รายละเอียดเต็มอยู่ใน `docs/c2c-callback-feed.md`** สรุปไฟล์:

- `lib/db.ts` — `getCeloxC2CCallbackTimeline(reference)` หาแถวด้วย `transaction_id OR order_id OR reference_id`
  แล้วดึง inbox ด้วย `transaction_id` เรียง `received_at ASC` (ถ้าไม่เจอแถวแต่ reference เป็น transactionId
  ก็ยังคืน step ที่ค้างใน inbox ได้)
- `lib/celox/types.ts` — `CeloxC2CCallbackStep`, `CeloxC2CCallbackTimeline`
- `app/api/celox/c2c/[id]/events/route.ts` — `GET` (ระวัง: Next รุ่นนี้ `context.params` เป็น `Promise`)
- `lib/celox/c2c-callback-poll.ts` — `startC2CCallbackPolling` + `C2C_CALLBACK_POLL_INTERVAL_MS = 4_000`
  (ดึงครั้งแรกเสมอ, ใช้ `setTimeout` ต่อกันไม่ใช่ `setInterval`, poll ต่อเฉพาะ `active`)
- `app/components/c2c-callback-feed.tsx` — คอมโพเนนต์ฟีด (`aria-live="polite"`)
- `app/components/c2c-deposit-flow-dialog.tsx` — แปะฟีด 3 จุด (รอจับคู่ / รอโอน / หน้าสรุป)
- `app/components/c2c-withdrawal-flow-dialog.tsx` — แปะฟีดหน้าผล + **เลิกปิด dialog เองเมื่อสถานะเปลี่ยน**
  และปุ่มยกเลิกอิงสถานะสดจาก GET
- `app/c2c-transactions/page.tsx` — แปะฟีดใน detail panel (`active = !isC2CTerminal(...)`)
- `app/globals.css` — สไตล์ฟีด

---

## F. Delta polling หน้ารายการ C2C — `491e608`

**เปลี่ยนแนวคิด:** หน้า `c2c-transactions` เดิม poll GET ไป Celox ทุก 10 วินาทีเฉพาะรายการที่เปิดดู
→ เปลี่ยนเป็น **อ่าน DB ของเราทุก 4 วินาที** (สถานะขยับตาม callback ที่เขียนลง DB) ไม่ยิง Celox อัตโนมัติ
ปุ่ม "ตรวจสถานะล่าสุด" ยังยิง GET ไป Celox ได้ตามเดิม

**Server**
- `lib/db.ts` — `listCeloxC2CTransactions({ search, limit, updatedAfter })` เพิ่มเงื่อนไข
  `x.updated_at >= ?` (ใช้ `>=` ไม่ใช่ `>` เพราะหลายแถวอาจมี updated_at ms เดียวกัน — ยอมส่งซ้ำดีกว่าหลุด)
- `app/api/celox/c2c/route.ts` — รับ `?updatedAfter=` (ใช้เฉพาะเมื่อ `Date.parse` ได้)

**Client** — `lib/celox/c2c-list-delta.ts`
- `mergeC2CListDelta(current, delta)` → `{ items, changedIds }` merge ด้วย `transactionId`
  นับว่าเปลี่ยนเมื่อ `updatedAt` หรือ `transactionStatus` ต่าง แถวใหม่ขึ้นบนสุด
- `nextC2CListCursor(items)` → `updatedAt` มากสุด
- `patchC2CDetailFromListItem(detail, row)` ทับ `transactionStatus`, `feeAmount`, `settledAmount`,
  `heldAmount`, `unfilledAmount`, `awaitingManualReview`, `matchDeadline` ลง detail ที่เปิดอยู่
  (**คง `parts`/`transferTo` จาก GET ครั้งล่าสุดไว้** เพราะ DB ไม่เก็บ parts)

**หน้า `app/c2c-transactions/page.tsx`**
- เก็บ `listCursorRef` (อัปเดตทุกครั้งที่โหลดเต็ม) และ `itemsRef`
- effect poll ด้วย `setTimeout` ต่อกัน + `AbortController`, ผูก dependency กับ `search`
- ถ้ามีโหลดเต็มแทรก (`listRequestRef` เปลี่ยน) ให้ทิ้งผล delta รอบนั้น
- แถวที่เปลี่ยนได้ class `updated` (ไฮไลต์ 2.5 วินาที) — CSS ใน `globals.css`
- เปลี่ยนข้อความหัวหน้า + กล่อง authority note ให้บอกว่าหน้าอัปเดตตาม callback

---

## G. ฝากเงิน C2C ผ่าน `payUrl` ใน iframe — `0133363`

Celox อาจตอบ `payUrl` ตอนสร้างรายการฝาก C2C — เป็นหน้าชำระเงินที่จัดการจับคู่ โอน และแนบสลิปเอง

- `lib/celox/types.ts` — `CreateC2CDepositResponse.payUrl?: string | null`
- `lib/celox/c2c-client.server.ts` — `isCreateC2CDepositResponse` ยอมรับ
  `value.payUrl === undefined || isNullableString(value.payUrl)`
- `app/components/c2c-deposit-flow-dialog.tsx`
  - phase ใหม่ `"paying"` (นับเป็น step 2, title "ชำระเงินฝาก C2C")
  - `safePayUrl()` รับเฉพาะ `https:` ไม่ผ่าน → ใช้ flow แนบสลิปเดิม
  - หลังสร้างสำเร็จ: `safePayUrl(result.payUrl) ? "paying" : result.transferTo ? "ready" : "waiting"`
  - poll สถานะทำงานทั้ง `waiting` และ `paying` · การเด้งไป `ready` ตอน `PENDING_TRANSFER` ทำเฉพาะ
    phase `waiting` · ใน `paying` ถ้าได้ `EXPIRED` ให้ไปหน้าผล
  - UI: `<iframe src={payUrl} allow="clipboard-write" referrerPolicy="no-referrer">` + ลิงก์
    "เปิดในแท็บใหม่" (`rel="noopener noreferrer"`) + ปุ่ม "ปิดไว้ก่อน" + ปุ่มยกเลิกเมื่อยัง `PENDING`
  - section ได้ class `paying` เพิ่ม
- `app/globals.css` — `.c2c-dialog.paying`, `.c2c-pay-panel`, `.c2c-pay-frame`, `.c2c-pay-external`
  และ media query มือถือ: iframe สูง 900px แล้ว scroll ที่ panel ชั้นเดียว + ปุ่ม sticky ล่าง
- เทสต์ใน `lib/celox/c2c-client.server.test.ts` — สร้างฝากพร้อม `payUrl`

> **ไม่ต้อง port** `app/iframe-debug/page.tsx` — เป็นหน้าชั่วคราวไว้หาสาเหตุ iframe กดไม่ได้ใน modal
> (คอมเมนต์ในไฟล์บอกให้ลบหลังทดสอบเสร็จ)
>
> ถ้าอีกเว็บมี CSP ให้เพิ่มโดเมนของ `payUrl` ใน `frame-src`

---

## H. `wrangler.jsonc` env — `5b5b3e6`

เพิ่ม `env` แยก Worker ต่อโดเมน (custom domain):

```jsonc
"env": {
  "main":       { "name": "itstore-finance",     "routes": [{ "pattern": "it-store.celox.app",     "custom_domain": true }] },
  "tom-mobile": { "name": "itstore-finance-tom", "routes": [{ "pattern": "mobile-store.celox.app", "custom_domain": true }] }
}
```

ชื่อ Worker/โดเมนเป็นของโปรเจกต์นี้ — อีกเว็บให้ใช้ชื่อของตัวเอง แต่ละ env ต้องตั้ง secret/vars และ
Hyperdrive ให้ครบ และ **แต่ละ env ที่รับ callback ต้องรัน migration ใน DB ของตัวเอง**

---

## Checklist ก่อนปิดงาน

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build

# ต้องไม่เหลือ
grep -rn 'redirect: "error"' lib app/api                      # ฝั่ง server
grep -rn "realWithdrawAmount\|settledTotal\|unfilledTotal\|occurredAt\|provider_event" lib app
grep -rn "looksLikeCeloxC2CCallback" lib app                  # ต้องเช็ค parts/transactionStatus ไม่ใช่ event/transferTo
```

**Deploy**
1. รัน migration `0003` + `0004` ในทุก DB ที่รับ callback
2. deploy โค้ด (ทุก env/worker)
3. ยืนยันว่าโค้ดใหม่ขึ้นแล้วด้วย probe ลายเซ็นปลอม (ไม่ขยับเงิน): โค้ดเก่าตอบ **422** โค้ดใหม่ตอบ **401**
   — คำสั่ง curl อยู่ในหัวข้อ "ลำดับการ deploy" ของ `2026-09-10-celox-c2c-settled-amount-prompt.md`
4. เปิดหน้า `/c2c-callback-logs` ดูว่า probe ถูกบันทึก (ยืนยันว่า log ทำงานบน URL ที่ Celox ชี้มา)
