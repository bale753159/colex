import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";
import type { CeloxC2CCallbackRequest } from "@/lib/celox/types";

const TEST_SECRET = "test-c2c-callback-secret";
const CALLBACK_URL = "https://app.example.com/api/celox/callback";
let POST: typeof import("./route")["POST"];

// Built independently from the production signer, straight from the v2
// material formula in the Celox manual, so a shared bug can't hide.
function signV2(rawBody: string, timestamp: string, secret = TEST_SECRET) {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const material = `v2\n${timestamp}\n${bodyHash}`;
  return createHmac("sha256", secret).update(material, "utf8").digest("hex");
}

function currentTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}

function withdrawalCallback(overrides: Partial<CeloxC2CCallbackRequest> = {}): CeloxC2CCallbackRequest {
  return {
    transactionId: randomUUID(),
    orderId: "TXN-2608-00993",
    referenceId: "ORDER-4471",
    status: "SUCCESS",
    amount: 2500,
    occurredAt: "2026-08-30T10:05:12.000Z",
    event: "settled",
    parts: [
      { transactionId: randomUUID(), orderId: "TXN-2608-00993", amount: 2500, status: "SUCCESS" },
    ],
    unfilledAmount: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  process.env.CELOX_C2C_CALLBACK_SECRET = TEST_SECRET;
  // ตั้ง secret ฝั่ง non-C2C ด้วย เพื่อให้ payload ที่ dispatch พลาดไปเข้า verifier ตัวเก่า
  // ล้มด้วย 401 (ลายเซ็นคนละ scheme) เหมือน production จริง ไม่ใช่ 500 จาก config ที่ขาด
  process.env.CELOX_CALLBACK_SECRET = TEST_SECRET;
  ({ POST } = await import("./route"));
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe("POST /api/celox/callback — dispatch to the C2C handler", () => {
  it("ยอมรับ payload ที่มีรูปร่างเป็น C2C (มี event/transferTo) เมื่อเซ็นด้วย v2 ถูกต้อง", async () => {
    const payload = withdrawalCallback();
    const body = JSON.stringify(payload);
    const timestamp = currentTimestamp();
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Celox-Timestamp": timestamp,
        "X-Celox-Signature": signV2(body, timestamp),
      },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
  });

  it("ยอมรับ callback C2C ฝั่งถอนที่ไม่มีทั้ง event และ transferTo (แยกด้วย parts ที่มีเสมอ)", async () => {
    // payload จริงจาก production ที่โดน 401: PENDING_MANUAL_C2C ฝั่งถอนที่ยังไม่จับคู่
    // ไม่มี event (สเปคระบุว่า conditional) และไม่มี transferTo (มีแต่ฝั่งฝาก)
    // เหลือ parts เป็นตัวเดียวที่ยืนยันว่าเป็น callback C2C — สเปคระบุว่ามีเสมอทุก callback C2C
    const transactionId = randomUUID();
    const body = JSON.stringify({
      transactionId,
      orderId: "WTH-C2C-1788870009481-09yQq",
      referenceId: "KLANG-C2C-WD-MTSN0EOX",
      status: "PENDING_MANUAL_C2C",
      amount: 500,
      occurredAt: "2026-09-08T12:20:09.467Z",
      parts: [{ transactionId, orderId: "WTH-C2C-1788870009481-09yQq", amount: 500, status: "PENDING_MANUAL_C2C" }],
      unfilledAmount: 0,
    });
    const timestamp = currentTimestamp();
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Celox-Timestamp": timestamp,
        "X-Celox-Signature": signV2(body, timestamp),
      },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("ปฏิเสธ payload รูปร่าง C2C ที่ไม่มี X-Celox-Timestamp มาด้วย", async () => {
    const payload = withdrawalCallback();
    const body = JSON.stringify(payload);
    const request = new Request(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Celox-Signature": signV2(body, currentTimestamp()),
      },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
