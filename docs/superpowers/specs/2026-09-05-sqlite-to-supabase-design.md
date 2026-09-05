# ย้ายชั้นข้อมูลจาก SQLite ไป Supabase (Postgres)

วันที่: 2026-09-05
สถานะ: อนุมัติ design แล้ว รอ implementation plan

## เป้าหมาย

เปลี่ยน persistence layer ของ klang-finance-dashboard จาก better-sqlite3
ไปเป็น Postgres ที่โฮสต์บน Supabase ทั้งหมด โดยรักษาพฤติกรรมของระบบเงิน
ให้เหมือนเดิมทุกประการ

การพอร์ตครั้งนี้ต้องอ่านได้ว่าเป็น "แปลง dialect" ไม่ใช่ "เขียน business
logic ใหม่" ข้อยกเว้นเดียวคือ TOCTOU ใน `createTransaction` (ดูหัวข้อ
"ความถูกต้องเรื่องเงิน")

## สถานะปัจจุบัน

- `lib/db.ts` — 2,758 บรรทัด, export 40 ฟังก์ชัน synchronous, มีบล็อก
  `db.transaction()` 24 บล็อก ซึ่งเกือบทั้งหมดจัดการยอดเงิน
- ผู้เรียก: 16 API route ใต้ `app/api/` และ 3 ไฟล์ใต้ `lib/celox/`
  (`c2c-callback.server.ts`, `callback.server.ts`,
  `c2c-callback-handler.server.ts`)
- หน้าเว็บทุกหน้าคุยผ่าน `fetch("/api/...")` ไม่ import `lib/db` ตรง
- เทสต์ 6 ไฟล์ โดย 2 ไฟล์ใช้ DB จริงผ่าน env `KLANG_DB_PATH`
- ตาราง 10 ตาราง: `customers`, `transactions`, `celox_deposits`,
  `celox_deposit_slip_claims`, `celox_withdrawals`,
  `celox_withdrawal_reservations`, `celox_callback_events`,
  `celox_c2c_transactions`, `celox_c2c_withdrawal_reservations`,
  `celox_c2c_callback_events`

## การตัดสินใจหลัก

| หัวข้อ | เลือก | เหตุผล |
|---|---|---|
| วิธีเข้าถึง | `pg` (node-postgres) ต่อ Postgres ตรง | ต้องคง atomicity ของ 24 transaction ที่จัดการเงิน; PostgREST ไม่มี transaction |
| ข้อมูลเดิม | ทิ้ง เริ่มใหม่ | `data/*.sqlite` อยู่ใน `.gitignore` เป็น dev data ล้วน |
| เทสต์ | PGlite (`@electric-sql/pglite`) | Postgres จริง ไม่ต้องพึ่ง Docker รันใน CI ได้ |
| Schema | ไฟล์ migration แยก | ตัด DDL ออกจาก runtime; เทสต์ใช้ไฟล์เดียวกับ deploy |
| ไม่ใช้ `supabase-js` | — | ทุก query อยู่ฝั่ง server ผ่าน API route อยู่แล้ว ไม่ต้องใช้ RLS/PostgREST |

## สถาปัตยกรรม

### `lib/sql.ts` (ใหม่)

ชั้นบางๆ ปิด driver ไว้ข้างหลัง เปิด API สี่ตัว:

```ts
query<T>(sql: string, params?: unknown[]): Promise<T[]>          // แทน .all()
first<T>(sql: string, params?: unknown[]): Promise<T | undefined> // แทน .get()
run(sql: string, params?: unknown[]): Promise<{ rowCount: number }> // แทน .run().changes
tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>                      // BEGIN/COMMIT/ROLLBACK
```

`Tx` เปิดเมธอด `query`/`first`/`run` ชุดเดียวกัน แต่ผูกกับ client เดียว
ตลอดทั้ง transaction

หน้าที่สำคัญที่สุดของชั้นนี้คือ **แปลง placeholder `?` เป็น `$1..$n`
อัตโนมัติ** ทำให้ SQL literal เดิมย้ายมาได้โดยไม่ต้องแก้ตำแหน่ง
ตัวแปรทีละจุด ซึ่งเป็นงานที่พลาดง่ายที่สุดในโค้ดที่จัดการเงิน

ตัวแปลงต้องข้าม `?` ที่อยู่ในสตริงลิเทอรัล (`'...'`) และใน identifier
ที่ครอบด้วย `"..."` และต้องไม่ไปยุ่งกับ operator ของ Postgres ที่มี `?`
(`?`, `?|`, `?&` ของ jsonb) — โค้ดเบสนี้ไม่ได้ใช้ jsonb operator แต่
ตัวแปลงควรกันไว้และมี unit test ครอบ

### การเลือก driver

`lib/sql.ts` เลือก driver จาก env ครั้งเดียว:

- ปกติ: `pg.Pool` อ่านจาก `DATABASE_URL`
- เทสต์ (`KLANG_TEST_PG=pglite`): PGlite in-memory

นี่เป็นสวิตช์ driver จุดเดียวในโค้ดเบสทั้งหมด

### การเชื่อมต่อ Supabase

ใช้ **Session pooler** (IPv4, port 5432):

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Session pooler รองรับ multi-statement transaction บน connection เดียว
ซึ่งจำเป็นสำหรับ `tx()` ถ้าอนาคตย้ายไป serverless ค่อยพิจารณา
transaction pooler (port 6543) พร้อมปิด prepared statement

## Schema และ migration

### `supabase/migrations/0001_init.sql`

พอร์ต DDL ทั้งหมดจาก `getDatabase()` ปัจจุบัน รวม index ทุกตัว
โดยแปลง dialect ตามตารางนี้:

| SQLite | Postgres |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `INTEGER NOT NULL CHECK (x IN (0, 1))` | `boolean NOT NULL` |
| `amount_satang INTEGER` | `amount_satang bigint` |
| `created_at TEXT` (ISO 8601 string) | `created_at timestamptz` |
| `TEXT` ทั่วไป | `text` |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `date(col, '+7 hours') >= date(?)` | `(col AT TIME ZONE 'Asia/Bangkok')::date >= ?::date` |

`CHECK` constraint ทุกตัวคงไว้ตามเดิม โดยเฉพาะสองตัวนี้ที่เป็นตาข่าย
กันยอดเพี้ยนชั้นสุดท้าย:

```sql
CHECK (balance_satang >= 0)
CHECK (withdrawable_satang >= 0 AND withdrawable_satang <= balance_satang)
```

### `supabase/seed.sql`

ย้ายเนื้อหาจาก `seedDatabase()` (ลูกค้าตัวอย่าง 7 คน) มาเป็น SQL
ล้วน ใช้ `ON CONFLICT DO NOTHING` เพื่อให้รันซ้ำได้

### โค้ดที่ลบทิ้ง

เพราะเริ่ม DB ใหม่ หนี้ migration ต่อไปนี้ไม่มีเหตุผลให้อยู่ต่อ:

- `getDatabase()`
- `migrateDatabase()`
- `migrateTransactionsToProcessingStatuses()`
- `transactionsSupportProcessingStatuses()`
- `backfillCeloxDepositTransactions()`
- `seedDatabase()` (ย้ายเป็น `seed.sql`)
- บล็อก `ALTER TABLE ... ADD COLUMN` เฉพาะกิจสำหรับ `transaction_kind`,
  `confirmation_state`, `funds_reserved`
- `declare global { var __klangFinanceDb }` และ type `SqliteDatabase`

รวมประมาณ 250 บรรทัด

## ความถูกต้องเรื่องเงิน

### สิ่งที่ปลอดภัยอยู่แล้ว

mutation ของ `customers` ส่วนใหญ่เขียนเป็น conditional UPDATE พร้อม
guard predicate แล้วเช็กจำนวนแถวที่เปลี่ยน เช่น

```sql
UPDATE customers SET withdrawable_satang = withdrawable_satang - ?
WHERE id = ? AND withdrawable_satang >= ?
```

รูปแบบนี้ atomic ใน Postgres เช่นเดียวกับ SQLite (UPDATE เดียวจับ row
lock เอง) ย้ายมาได้โดยไม่ต้องเพิ่ม lock ต้องแปลงแค่ `.changes` เป็น
`.rowCount`

### จุดที่ต้องแก้: TOCTOU ใน `createTransaction`

`lib/db.ts:2703` อ่านแถวลูกค้า **นอก** transaction แล้วเอา snapshot นั้น
ไปตัดสินใจข้างใน และ UPDATE ที่ตามมาไม่มี guard predicate:

```ts
const selected = db.prepare("SELECT * FROM customers WHERE id = ?").get(...)
const perform = db.transaction(() => {
  if (selected.withdrawable_satang < amountSatang) throw new Error("...")
  db.prepare("UPDATE customers SET balance_satang = balance_satang - ? ...")
```

ใต้ SQLite แทบไม่เกิดเพราะ write serialize ทีละราย ใต้ Postgres สอง
request สอดกันได้จริง ผลที่ตามมาคือ `CHECK` ดีด transaction ทิ้ง —
ยอดไม่เพี้ยน แต่ผู้ใช้จะได้ error ดิบแทนข้อความ
"ยอดเงินที่ถอนได้ไม่เพียงพอ"

แก้โดย:

1. ย้าย `SELECT` เข้าไปใน transaction และใช้ `SELECT ... FOR UPDATE`
2. ใส่ guard predicate ใน UPDATE ให้ครบเหมือนจุดอื่น
3. ขา C2C ที่ต้องล็อกสองแถว (source และ target) ให้ล็อกเรียงตาม `id`
   เสมอ เพื่อกัน deadlock เมื่อมีสองรายการโอนสวนทางกัน

### Isolation level

ใช้ `READ COMMITTED` (ค่าปกติของ Postgres) ไม่ใช้ `SERIALIZABLE`
เพราะ guard predicate บวก row lock เพียงพอแล้ว และ `SERIALIZABLE`
จะบังคับให้ต้องเขียน retry loop ทุกจุดเรียก ซึ่งเพิ่มความซับซ้อน
เกินประโยชน์ที่ได้

## การแปลง async

ทั้ง 40 export กลายเป็น `async` ผลกระทบสามชั้น:

1. **16 API route** — ทุกตัวเป็น `async function` อยู่แล้ว เติม `await`
   ที่ call site
2. **3 ไฟล์ใต้ `lib/celox/`** ที่ import `../db` — เติม `await` ตามจริง
3. **helper ภายใน `lib/db.ts`** ที่รับพารามิเตอร์ `db: SqliteDatabase`
   (เช่น `finishCeloxC2CCallback`, `getSummary`,
   `adoptCeloxC2CWithdrawalReservationFromCallback`) เปลี่ยนไปรับ `t: Tx`
   และ `await` ข้างใน — จำเป็นเพราะทุก statement ในหนึ่ง transaction
   ต้องวิ่งบน client เดียวกัน

หน้าเว็บ (`app/page.tsx`, `app/customers/page.tsx`,
`app/c2c-transactions/page.tsx`) และ component ทุกตัวไม่ต้องแก้

## เทสต์

- `test/pg-harness.ts` (ใหม่) — สร้าง PGlite instance ต่อไฟล์เทสต์ แล้ว
  อ่าน `supabase/migrations/0001_init.sql` มา apply ทำให้ schema ที่
  เทสต์กับที่ deploy เป็นไฟล์เดียวกัน หลุดจากกันไม่ได้
- `lib/db.c2c-withdraw-settlement.test.ts` และ
  `lib/celox/c2c-callback-handler.server.test.ts` — เปลี่ยนจาก
  `KLANG_DB_PATH` + temp dir ไปใช้ harness และเติม `await` ใน
  helper ที่ setup ข้อมูล
- อีก 4 ไฟล์ (`c2c-validation`, `c2c-callback-validation`,
  `c2c-client.server`, `c2c-callback.server`) เป็น pure logic ไม่แตะ DB
  → ไม่ต้องแก้
- เพิ่ม unit test ให้ตัวแปลง `?` → `$n` ใน `lib/sql.ts` ครอบเคส
  สตริงลิเทอรัลที่มี `?` และ identifier ที่ครอบด้วย `"`

**เกณฑ์เสร็จ:** `npm test` ผ่านครบ และ `npm run build` ผ่าน

## การตั้งค่า

`.env.example` เพิ่ม:

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

`KLANG_DB_PATH` ถูกถอดออก

`package.json`:

- ถอด `better-sqlite3`, `@types/better-sqlite3`
- เพิ่ม `pg`, `@types/pg`, `@electric-sql/pglite` (dev)

`.gitignore` — ลบสามบรรทัดที่เกี่ยวกับ `data/*.sqlite*` และลบไดเรกทอรี
`data/`

## ลำดับงาน

1. `lib/sql.ts` + unit test ของตัวแปลง placeholder
2. `supabase/migrations/0001_init.sql` + `supabase/seed.sql`
3. `test/pg-harness.ts`
4. พอร์ต `lib/db.ts` ทีละกลุ่มฟังก์ชัน (customers/transactions →
   deposits → withdrawals → c2c → callbacks) ให้เทสต์ผ่านระหว่างทาง
5. แก้ TOCTOU ใน `createTransaction`
6. เติม `await` ใน 16 route และ 3 ไฟล์ celox
7. `npm test` + `npm run build`
8. ถอด better-sqlite3 และลบ `data/`

## ขอบเขตที่ไม่ทำ

- ไม่ย้ายข้อมูลเดิมจาก SQLite
- ไม่ใช้ `supabase-js`, PostgREST, Realtime, Auth หรือ Storage
- ไม่เปิด RLS (ไม่มี client ที่ต่อ DB ตรง)
- ไม่แตะ UI, component หรือ design system
- ไม่แก้ตรรกะเงินอื่นนอกจาก TOCTOU ข้างต้น ถ้าเจอ bug เชิงตรรกะ
  ระหว่างพอร์ต จะรายงานแยก ไม่แก้ปนไปกับ migration
