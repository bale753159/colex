import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryablePostgresError, verifyCeloxC2CCallbackSignatureV2 } from "./c2c-callback.server";
import { CeloxError } from "./client.server";

const TEST_SECRET = "test-c2c-callback-secret";
const RAW_BODY = '{"transactionId":"01a08782-95ee-7293-afd1-a8453081de20","transactionStatus":"SUCCESS"}';

/**
 * เขียนขึ้นใหม่จากสูตรในเอกสารตรง ๆ ไม่ import ตัวเซ็นของ production มาใช้
 * เพื่อไม่ให้เทสต์ผ่านเพราะทั้งสองฝั่งพลาดเหมือนกัน
 */
function signV2(rawBody: string, timestamp: string, secret = TEST_SECRET) {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return createHmac("sha256", secret)
    .update(`v2\n${timestamp}\n${bodyHash}`, "utf8")
    .digest("hex");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

beforeEach(() => {
  process.env.CELOX_C2C_CALLBACK_SECRET = TEST_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyCeloxC2CCallbackSignatureV2", () => {
  it("accepts a signature over the exact bytes that were sent", () => {
    const timestamp = String(nowSeconds());
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, timestamp, signV2(RAW_BODY, timestamp)))
      .not.toThrow();
  });

  it("accepts an uppercase or sha256-prefixed signature header", () => {
    const timestamp = String(nowSeconds());
    const signature = signV2(RAW_BODY, timestamp);
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, timestamp, signature.toUpperCase()))
      .not.toThrow();
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, timestamp, `sha256=${signature}`))
      .not.toThrow();
  });

  it("rejects a signature made with a different secret", () => {
    const timestamp = String(nowSeconds());
    expect(() => verifyCeloxC2CCallbackSignatureV2(
      RAW_BODY, timestamp, signV2(RAW_BODY, timestamp, "someone-elses-secret"),
    )).toThrow(CeloxError);
  });

  it("rejects a signature that was made for a different timestamp", () => {
    const timestamp = String(nowSeconds());
    const otherTimestamp = String(nowSeconds() - 60);
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, timestamp, signV2(RAW_BODY, otherTimestamp)))
      .toThrow(CeloxError);
  });

  it("rejects a missing timestamp header, a missing signature header, and both missing", () => {
    const timestamp = String(nowSeconds());
    const signature = signV2(RAW_BODY, timestamp);
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, null, signature)).toThrow(CeloxError);
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, timestamp, null)).toThrow(CeloxError);
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, null, null)).toThrow(CeloxError);
  });

  it("rejects a timestamp that is not an integer", () => {
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, "not-a-timestamp", "a".repeat(64)))
      .toThrow(CeloxError);
  });

  it("accepts a timestamp exactly 300 seconds old and rejects one past the window", () => {
    const past = nowSeconds() - 300;
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, String(past), signV2(RAW_BODY, String(past))))
      .not.toThrow();

    const tooOld = nowSeconds() - 301;
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, String(tooOld), signV2(RAW_BODY, String(tooOld))))
      .toThrow(CeloxError);
  });

  it("rejects a timestamp more than 300 seconds in the future", () => {
    const ahead = nowSeconds() + 301;
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, String(ahead), signV2(RAW_BODY, String(ahead))))
      .toThrow(CeloxError);
  });

  /**
   * กับดักที่ integrator พลาดบ่อยที่สุด: parse แล้ว stringify กลับมาใหม่เพื่อ hash
   * key order/ช่องว่างเปลี่ยนไปเพียงนิดเดียวลายเซ็นก็ไม่ตรงแล้ว — ต้อง hash bytes ที่ส่งมาจริงเท่านั้น
   */
  it("fails to verify when the payload is re-serialised instead of hashed as sent", () => {
    const timestamp = String(nowSeconds());
    const signature = signV2(RAW_BODY, timestamp);
    const reserialised = JSON.stringify({
      transactionStatus: "SUCCESS",
      transactionId: "01a08782-95ee-7293-afd1-a8453081de20",
    });

    expect(reserialised).not.toBe(RAW_BODY);
    expect(() => verifyCeloxC2CCallbackSignatureV2(reserialised, timestamp, signature)).toThrow(CeloxError);
    expect(() => verifyCeloxC2CCallbackSignatureV2(RAW_BODY, timestamp, signature)).not.toThrow();
  });

  it("rejects a body whose bytes changed by a single character", () => {
    const timestamp = String(nowSeconds());
    const signature = signV2(RAW_BODY, timestamp);
    expect(() => verifyCeloxC2CCallbackSignatureV2(`${RAW_BODY} `, timestamp, signature)).toThrow(CeloxError);
  });
});

describe("isRetryablePostgresError", () => {
  it("retries on 40001 (serialization_failure)", () => {
    expect(isRetryablePostgresError({ code: "40001" })).toBe(true);
  });

  it("retries on 40P01 (deadlock_detected)", () => {
    expect(isRetryablePostgresError({ code: "40P01" })).toBe(true);
  });

  it("does not retry on an unrelated SQLSTATE", () => {
    expect(isRetryablePostgresError({ code: "23505" })).toBe(false);
  });

  it("does not retry on the old SQLite error codes", () => {
    expect(isRetryablePostgresError({ code: "SQLITE_BUSY" })).toBe(false);
    expect(isRetryablePostgresError({ code: "SQLITE_LOCKED" })).toBe(false);
  });

  it("is tolerant of error shapes it does not recognise, returning false rather than throwing", () => {
    expect(isRetryablePostgresError(null)).toBe(false);
    expect(isRetryablePostgresError(undefined)).toBe(false);
    expect(isRetryablePostgresError("boom")).toBe(false);
    expect(isRetryablePostgresError(new Error("plain error, no code"))).toBe(false);
    expect(isRetryablePostgresError({})).toBe(false);
  });
});
