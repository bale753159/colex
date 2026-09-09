import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/sql";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest } from "./celox/types";

let enqueueCeloxC2CCallbackEvent: typeof import("./db")["enqueueCeloxC2CCallbackEvent"];

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

beforeAll(async () => {
  await setupTestDatabase();
  ({ enqueueCeloxC2CCallbackEvent } = await import("./db"));
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

function basePayload(overrides: Partial<CeloxC2CCallbackRequest> = {}): CeloxC2CCallbackRequest {
  return {
    transactionId: randomUUID(),
    orderId: "WTH-C2C-1",
    referenceId: "KLANG-C2C-WD-1",
    direction: "withdraw",
    transactionStatus: "PENDING_MANUAL_C2C",
    amount: 2000,
    feeAmount: 30,
    realWithdrawAmount: 0,
    heldAmount: 30,
    unfilledAmount: 0,
    awaitingManualReview: false,
    matchDeadline: null,
    transferTo: null,
    parts: [{
      orderId: "WTH-C2C-1-1",
      amount: 2000,
      feeAmount: 30,
      transactionStatus: "PENDING_MANUAL_C2C",
      matchDeadline: null,
      matchedAt: null,
      cancelReason: null,
    }],
    ...overrides,
  };
}

async function storedEvent(transactionId: string) {
  return await db.first<{
    amount_satang: number;
    real_withdraw_amount_satang: number;
    signed_payload_hash: string;
    received_count: number;
  }>(`
    SELECT amount_satang, real_withdraw_amount_satang, signed_payload_hash, received_count
    FROM celox_c2c_callback_events WHERE transaction_id = ?
  `, [transactionId]);
}

describe("enqueueCeloxC2CCallbackEvent — การยิงซ้ำของสถานะเดิม", () => {
  it("ไม่ถือว่า conflict เมื่อสถานะที่ยังไม่ terminal ถูกส่งซ้ำโดยยอดที่ขยับได้เปลี่ยนไป", async () => {
    const first = basePayload({ realWithdrawAmount: 0 });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    // amount ยังเป็นยอดตั้งต้นเดิม เปลี่ยนแค่ยอดที่ถอนสำเร็จจริงระหว่างที่กลุ่มยังวิ่งอยู่
    const second = basePayload({ transactionId: first.transactionId, realWithdrawAmount: 600 });
    const queued = await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    expect(queued.conflict).toBe(false);
    expect(queued.duplicate).toBe(true);
  });

  it("อัปเดต realWithdrawAmount และ signed_payload_hash ของแถวเดิมเป็นค่าล่าสุดที่ส่งมา", async () => {
    const first = basePayload({ realWithdrawAmount: 0 });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    const second = basePayload({ transactionId: first.transactionId, realWithdrawAmount: 600 });
    await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    const row = await storedEvent(first.transactionId);
    expect(row?.amount_satang).toBe(200_000);
    expect(row?.real_withdraw_amount_satang).toBe(60_000);
    expect(row?.signed_payload_hash).toBe(HASH_B);
    expect(row?.received_count).toBe(2);
  });

  it("conflict เมื่อ amount ต่างจากเดิม เพราะ contract ใหม่ตอบยอดตั้งต้นของคำขอเสมอ", async () => {
    const first = basePayload({ amount: 2000 });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    const second = basePayload({ transactionId: first.transactionId, amount: 1400 });
    const queued = await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    expect(queued.conflict).toBe(true);
    expect(queued.shouldProcess).toBe(false);
  });

  it("ยังคง conflict เมื่อสถานะ terminal (SUCCESS) ถูกส่งซ้ำด้วย body ที่ต่างจากเดิม", async () => {
    const first = basePayload({ transactionStatus: "SUCCESS", realWithdrawAmount: 2000, unfilledAmount: 0 });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    const second = basePayload({
      transactionId: first.transactionId,
      transactionStatus: "SUCCESS",
      realWithdrawAmount: 1400,
      unfilledAmount: 600,
    });
    const queued = await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    expect(queued.conflict).toBe(true);
  });

  it("ไม่ conflict เมื่อสถานะ terminal ถูกส่งซ้ำด้วย body เดิมเป๊ะ (redelivery ปกติ)", async () => {
    const payload = basePayload({ transactionStatus: "SUCCESS", realWithdrawAmount: 2000, unfilledAmount: 0 });
    await enqueueCeloxC2CCallbackEvent(payload, HASH_A);
    const queued = await enqueueCeloxC2CCallbackEvent(payload, HASH_A);

    expect(queued.conflict).toBe(false);
    expect(queued.duplicate).toBe(true);
  });

  it("ยังคง conflict เมื่อ orderId ไม่ตรงกัน แม้สถานะจะยังไม่ terminal", async () => {
    const first = basePayload({ orderId: "WTH-C2C-1" });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    const second = basePayload({ transactionId: first.transactionId, orderId: "WTH-C2C-DIFFERENT" });
    const queued = await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    expect(queued.conflict).toBe(true);
  });
});
