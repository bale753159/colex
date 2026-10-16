import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { C2CTransactionPart, CeloxC2CCallbackRequest } from "./celox/types";

let getCeloxC2CCallbackTimeline: typeof import("./db")["getCeloxC2CCallbackTimeline"];
let enqueueCeloxC2CCallbackEvent: typeof import("./db")["enqueueCeloxC2CCallbackEvent"];
let processCeloxC2CCallbackEvent: typeof import("./db")["processCeloxC2CCallbackEvent"];

const FAKE_HASH = "b".repeat(64);

beforeAll(async () => {
  await setupTestDatabase();
  ({ getCeloxC2CCallbackTimeline, enqueueCeloxC2CCallbackEvent, processCeloxC2CCallbackEvent } = await import("./db"));
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

async function seedWithdrawal(amountSatang: number, feeSatang: number) {
  const now = new Date().toISOString();
  const customerId = `C-${randomUUID()}`;
  const localTransactionId = `TXN-${randomUUID()}`;
  const transactionId = randomUUID();
  const orderId = `WTH-${randomUUID()}`;
  const referenceId = `REF-${randomUUID()}`;

  await db.run(`
    INSERT INTO customers (id, name, account, initials, color, balance_satang, withdrawable_satang, created_at)
    VALUES (?, 'ทดสอบ', ?, 'ท', '#000000', ?, ?, ?)
  `, [customerId, `ACC-${randomUUID()}`, amountSatang * 2, amountSatang, now]);

  await db.run(`
    INSERT INTO transactions (id, customer_id, direction, channel, amount_satang, status, created_at)
    VALUES (?, ?, 'withdraw', 'c2c', ?, 'pending', ?)
  `, [localTransactionId, customerId, amountSatang, now]);

  await db.run(`
    INSERT INTO celox_c2c_transactions (
      transaction_id, order_id, reference_id, customer_id, direction,
      transaction_status, amount_satang, fee_amount_satang,
      settled_amount_satang, held_amount_satang, awaiting_manual_review,
      match_deadline, funds_reserved, local_transaction_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'withdraw', 'PENDING_TRANSFER', ?, ?, 0, ?, false, NULL, true, ?, ?, ?)
  `, [transactionId, orderId, referenceId, customerId, amountSatang, feeSatang, amountSatang + feeSatang, localTransactionId, now, now]);

  return { transactionId, orderId, referenceId };
}

function part(overrides: Partial<C2CTransactionPart> = {}): C2CTransactionPart {
  return {
    orderId: "PART-1",
    amount: 100,
    feeAmount: 1.5,
    transactionStatus: "SUCCESS",
    matchDeadline: null,
    matchedAt: "2026-09-08T10:00:00.000Z",
    cancelReason: null,
    ...overrides,
  };
}

describe("getCeloxC2CCallbackTimeline — อ่านจาก inbox ของเราเท่านั้น", () => {
  it("หาเจอด้วย orderId, referenceId และ transactionId และคืนค่าที่บันทึกตอนรับ callback", async () => {
    const seed = await seedWithdrawal(25_000, 375);
    const payload: CeloxC2CCallbackRequest = {
      transactionId: seed.transactionId,
      orderId: seed.orderId,
      referenceId: seed.referenceId,
      direction: "withdraw",
      transactionStatus: "SUCCESS",
      amount: 250,
      feeAmount: 3.75,
      settledAmount: 100,
      heldAmount: 0,
      unfilledAmount: 150,
      awaitingManualReview: false,
      matchDeadline: null,
      transferTo: null,
      parts: [
        part({ orderId: `${seed.orderId}-1`, amount: 100, transactionStatus: "SUCCESS" }),
        part({ orderId: `${seed.orderId}-2`, amount: 150, transactionStatus: "CANCELLED", matchedAt: null, cancelReason: "หมดเวลาโอน" }),
      ],
    };
    const queued = await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);
    await processCeloxC2CCallbackEvent(queued.eventId);
    // Celox ส่งซ้ำ → ต้องนับได้ ไม่ใช่เพิ่มก้อนใหม่
    await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);

    for (const reference of [seed.orderId, seed.referenceId, seed.transactionId]) {
      const timeline = await getCeloxC2CCallbackTimeline(reference);
      expect(timeline.found).toBe(true);
      expect(timeline.transactionId).toBe(seed.transactionId);
      expect(timeline.transactionStatus).toBe("SUCCESS");
      expect(timeline.updatedAt).not.toBeNull();
      expect(timeline.steps).toHaveLength(1);
      const [step] = timeline.steps;
      expect(step.status).toBe("SUCCESS");
      expect(step.processingState).toBe("applied");
      expect(step.settledAmount).toBe(100);
      expect(step.unfilledAmount).toBe(150);
      expect(step.allPartsTerminal).toBe(true);
      expect(step.awaitingManualReview).toBe(false);
      expect(step.receivedCount).toBe(2);
      expect(step.lastError).toBeNull();
      expect(new Date(step.lastReceivedAt).getTime()).toBeGreaterThanOrEqual(new Date(step.receivedAt).getTime());
    }
  });

  it("รายการที่ยังไม่มี callback → found แต่ steps ว่าง และบอกสถานะปัจจุบันของแถว", async () => {
    const seed = await seedWithdrawal(25_000, 375);
    const timeline = await getCeloxC2CCallbackTimeline(seed.orderId);
    expect(timeline).toMatchObject({
      found: true,
      transactionId: seed.transactionId,
      transactionStatus: "PENDING_TRANSFER",
      steps: [],
    });
    expect(timeline.updatedAt).not.toBeNull();
  });

  it("reference ที่ไม่มีอะไรผูก → found: false", async () => {
    expect(await getCeloxC2CCallbackTimeline(`REF-${randomUUID()}`)).toEqual({
      found: false,
      transactionId: null,
      transactionStatus: null,
      updatedAt: null,
      steps: [],
    });
  });

  it("callback ที่มาถึงก่อนแถวรายการยังอ่านได้ด้วย transactionId ตรง ๆ", async () => {
    const transactionId = randomUUID();
    const payload: CeloxC2CCallbackRequest = {
      transactionId,
      orderId: `WTH-${randomUUID()}`,
      referenceId: `REF-${randomUUID()}`,
      direction: "withdraw",
      transactionStatus: "PENDING_TRANSFER",
      amount: 250,
      feeAmount: 3.75,
      settledAmount: 0,
      heldAmount: 3.75,
      unfilledAmount: 0,
      awaitingManualReview: false,
      matchDeadline: null,
      transferTo: null,
      parts: [part({ orderId: "PART-1", amount: 250, transactionStatus: "PENDING_TRANSFER", matchedAt: null })],
    };
    await enqueueCeloxC2CCallbackEvent(payload, FAKE_HASH);

    const timeline = await getCeloxC2CCallbackTimeline(transactionId);
    expect(timeline.found).toBe(true);
    expect(timeline.transactionId).toBe(transactionId);
    expect(timeline.transactionStatus).toBeNull();
    expect(timeline.steps).toHaveLength(1);
    expect(timeline.steps[0].processingState).toBe("pending");
    expect(timeline.steps[0].allPartsTerminal).toBe(false);
    // orderId ไม่ใช่คีย์ของ inbox จึงหาไม่เจอจนกว่าแถวรายการจะถูกสร้าง
    expect((await getCeloxC2CCallbackTimeline(payload.orderId)).found).toBe(false);
  });
});
