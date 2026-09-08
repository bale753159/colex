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
  const transactionId = randomUUID();
  return {
    transactionId,
    orderId: "WTH-C2C-1",
    referenceId: "KLANG-C2C-WD-1",
    status: "PENDING_MANUAL_C2C",
    amount: 2000,
    occurredAt: "2026-09-08T10:38:06.925Z",
    parts: [{ transactionId, orderId: "WTH-C2C-1", amount: 2000, status: "PENDING_MANUAL_C2C" }],
    ...overrides,
  };
}

async function storedEvent(transactionId: string) {
  return await db.first<{ amount_satang: number; signed_payload_hash: string; received_count: number }>(
    "SELECT amount_satang, signed_payload_hash, received_count FROM celox_c2c_callback_events WHERE transaction_id = ?",
    [transactionId],
  );
}

describe("enqueueCeloxC2CCallbackEvent — redelivery of a non-terminal status with a changed amount", () => {
  it("ไม่ถือว่า conflict เมื่อ PENDING_MANUAL_C2C ถูกส่งซ้ำด้วย amount ต่างจากเดิม (กลุ่มยังเปลี่ยนแปลงได้)", async () => {
    const first = basePayload({ amount: 2000 });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    const second = basePayload({ transactionId: first.transactionId, amount: 1400 });
    const queued = await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    expect(queued.conflict).toBe(false);
    expect(queued.duplicate).toBe(true);
  });

  it("อัปเดต amount_satang และ signed_payload_hash ของแถวเดิมเป็นค่าล่าสุดที่ส่งมา", async () => {
    const first = basePayload({ amount: 2000 });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    const second = basePayload({ transactionId: first.transactionId, amount: 1400 });
    await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    const row = await storedEvent(first.transactionId);
    expect(row?.amount_satang).toBe(140_000);
    expect(row?.signed_payload_hash).toBe(HASH_B);
    expect(row?.received_count).toBe(2);
  });

  it("ยังคง conflict เมื่อสถานะ terminal (SUCCESS) ถูกส่งซ้ำด้วย amount ต่างจากเดิม", async () => {
    const first = basePayload({ status: "SUCCESS", amount: 2000 });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    const second = basePayload({ transactionId: first.transactionId, status: "SUCCESS", amount: 1400 });
    const queued = await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    expect(queued.conflict).toBe(true);
  });

  it("ยังคง conflict เมื่อ orderId ไม่ตรงกัน แม้สถานะจะยังไม่ terminal", async () => {
    const first = basePayload({ orderId: "WTH-C2C-1" });
    await enqueueCeloxC2CCallbackEvent(first, HASH_A);

    const second = basePayload({ transactionId: first.transactionId, orderId: "WTH-C2C-DIFFERENT" });
    const queued = await enqueueCeloxC2CCallbackEvent(second, HASH_B);

    expect(queued.conflict).toBe(true);
  });
});
