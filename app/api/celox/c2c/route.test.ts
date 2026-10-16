import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest, CeloxC2CListResponse } from "@/lib/celox/types";

const TEST_SECRET = "test-c2c-callback-secret";
let GET: typeof import("./route")["GET"];
let postCallback: typeof import("./callback/route")["POST"];

beforeAll(async () => {
  await setupTestDatabase();
  process.env.CELOX_C2C_CALLBACK_SECRET = TEST_SECRET;
  ({ GET } = await import("./route"));
  ({ POST: postCallback } = await import("./callback/route"));
});

function signV2(rawBody: string, timestamp: string) {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return createHmac("sha256", TEST_SECRET).update(`v2\n${timestamp}\n${bodyHash}`, "utf8").digest("hex");
}

async function sendSignedCallback(payload: CeloxC2CCallbackRequest) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return await postCallback(new Request("https://app.example.com/api/celox/c2c/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Celox-Timestamp": timestamp,
      "X-Celox-Signature": signV2(body, timestamp),
    },
    body,
  }));
}

// after() ใน test stub ยิง processor แบบ fire-and-forget จึงต้องรอให้ DB เปลี่ยนจริง
async function waitForStatus(transactionId: string, status: string) {
  for (let i = 0; i < 50; i += 1) {
    const row = await db.first<{ transaction_status: string }>(
      "SELECT transaction_status FROM celox_c2c_transactions WHERE transaction_id = ?", [transactionId],
    );
    if (row?.transaction_status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const events = await db.query("SELECT processing_state, last_error FROM celox_c2c_callback_events WHERE transaction_id = ?", [transactionId]);
  throw new Error(`รายการ ${transactionId} ไม่เปลี่ยนเป็น ${status}: ${JSON.stringify(events)}`);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

async function seedDeposit(updatedAt: string, amountSatang = 10000) {
  const now = new Date().toISOString();
  const customerId = `C-${randomUUID()}`;
  const localTransactionId = `TXN-${randomUUID()}`;
  const transactionId = randomUUID();
  const orderId = `DEP-${randomUUID()}`;
  const referenceId = `REF-${randomUUID()}`;

  await db.run(`
    INSERT INTO customers (id, name, account, initials, color, balance_satang, withdrawable_satang, created_at)
    VALUES (?, 'ทดสอบ', ?, 'ท', '#000000', 0, 0, ?)
  `, [customerId, `ACC-${randomUUID()}`, now]);
  await db.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, status, created_at)
    VALUES (?, ?, 'deposit', 'c2c', ?, 'pending', ?)
  `, [localTransactionId, customerId, amountSatang, now]);
  await db.run(`
    INSERT INTO celox_c2c_transactions (
      transaction_id, order_id, reference_id, customer_id, direction,
      transaction_status, amount_satang, fee_amount_satang,
      settled_amount_satang, held_amount_satang, awaiting_manual_review,
      match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'deposit', 'PENDING', ?, 0, 0, 0, false, NULL, false, ?, ?, ?)
  `, [transactionId, orderId, referenceId, customerId, amountSatang, localTransactionId, now, updatedAt]);

  return { transactionId, orderId, referenceId };
}

describe("GET /api/celox/c2c", () => {
  it("กรองด้วย updatedAfter ให้เหลือเฉพาะรายการที่เพิ่งอัปเดต", async () => {
    await seedDeposit("2026-09-11T00:00:00.000Z");
    const { transactionId: fresh } = await seedDeposit("2026-09-11T00:00:09.000Z");

    const response = await GET(new Request(
      "https://app.example.com/api/celox/c2c?updatedAfter=2026-09-11T00:00:05.000Z",
    ));
    expect(response.status).toBe(200);
    const body = await response.json() as CeloxC2CListResponse;
    expect(body.transactions.map((row) => row.transactionId)).toEqual([fresh]);
  });

  it("callback ที่เซ็นถูกต้องทำให้ delta poll เห็นสถานะใหม่โดยไม่ต้องยิง GET ไป Celox", async () => {
    const { transactionId, orderId, referenceId } = await seedDeposit("2026-09-11T00:00:00.000Z", 25_000);
    const beforeCallback = new Date().toISOString();

    const ack = await sendSignedCallback({
      transactionId,
      orderId,
      referenceId,
      direction: "deposit",
      transactionStatus: "SUCCESS",
      amount: 250,
      feeAmount: 0,
      settledAmount: 250,
      heldAmount: 0,
      unfilledAmount: null,
      awaitingManualReview: false,
      matchDeadline: null,
      transferTo: null,
      parts: [{
        orderId: `${orderId}-1`, amount: 250, feeAmount: 0, transactionStatus: "SUCCESS",
        matchDeadline: null, matchedAt: "2026-09-11T00:00:01.000Z", cancelReason: null,
      }],
    });
    expect(ack.status).toBe(200);
    await waitForStatus(transactionId, "SUCCESS");

    const response = await GET(new Request(
      `https://app.example.com/api/celox/c2c?updatedAfter=${encodeURIComponent(beforeCallback)}`,
    ));
    const body = await response.json() as CeloxC2CListResponse;
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]).toMatchObject({ transactionId, transactionStatus: "SUCCESS", settledAmount: 250 });
  });
});
