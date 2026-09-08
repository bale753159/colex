import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { CeloxError } from "./client.server";
import { hashRawC2CCallbackBody, isRetryablePostgresError, verifyCeloxC2CCallbackSignatureV2 } from "./c2c-callback.server";

const TEST_SECRET = "test-c2c-callback-secret";

// Built independently from the production signer — computed straight from the
// v2 material formula in the Celox manual — so the test can't pass just
// because both sides share a bug.
function signV2(rawBody: string, timestamp: string, secret = TEST_SECRET) {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const material = `v2\n${timestamp}\n${bodyHash}`;
  return createHmac("sha256", secret).update(material, "utf8").digest("hex");
}

describe("hashRawC2CCallbackBody", () => {
  it("returns the lowercase sha256 hex digest of the exact raw bytes given", () => {
    const rawBody = '{"transactionId":"5c1f9a2e"}';
    expect(hashRawC2CCallbackBody(rawBody)).toBe(
      createHash("sha256").update(rawBody, "utf8").digest("hex"),
    );
  });

  it("produces a different hash when even a single byte of the body differs", () => {
    const a = hashRawC2CCallbackBody('{"amount":2500}');
    const b = hashRawC2CCallbackBody('{"amount":2501}');
    expect(a).not.toBe(b);
  });
});

describe("verifyCeloxC2CCallbackSignatureV2", () => {
  afterEach(() => {
    delete process.env.CELOX_C2C_CALLBACK_SECRET;
  });

  function setSecret() {
    process.env.CELOX_C2C_CALLBACK_SECRET = TEST_SECRET;
  }

  it("accepts a validly signed body regardless of key order or added fields (raw bytes are hashed as opaque)", () => {
    setSecret();
    const rawBody = '{"transactionId":"5c1f9a2e-...","status":"SUCCESS","aBrandNewField":"anything"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(() => verifyCeloxC2CCallbackSignatureV2(rawBody, timestamp, signV2(rawBody, timestamp))).not.toThrow();
  });

  it("rejects when the signature does not match the raw body", () => {
    setSecret();
    const rawBody = '{"transactionId":"5c1f9a2e-..."}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(() => verifyCeloxC2CCallbackSignatureV2(rawBody, timestamp, signV2('{"tampered":true}', timestamp)))
      .toThrow(CeloxError);
  });

  it("rejects when X-Celox-Timestamp is missing even if the signature header is present", () => {
    setSecret();
    const rawBody = '{"transactionId":"5c1f9a2e-..."}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(() => verifyCeloxC2CCallbackSignatureV2(rawBody, null, signV2(rawBody, timestamp))).toThrow(CeloxError);
  });

  it("rejects when X-Celox-Signature is missing even if the timestamp header is present", () => {
    setSecret();
    const rawBody = '{"transactionId":"5c1f9a2e-..."}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(() => verifyCeloxC2CCallbackSignatureV2(rawBody, timestamp, null)).toThrow(CeloxError);
  });

  it("rejects when both headers are missing (org policy: never trust an unsigned callback)", () => {
    setSecret();
    expect(() => verifyCeloxC2CCallbackSignatureV2('{"transactionId":"5c1f9a2e-..."}', null, null)).toThrow(CeloxError);
  });

  it("rejects a timestamp more than 300 seconds in the past", () => {
    setSecret();
    const rawBody = '{"transactionId":"5c1f9a2e-..."}';
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    expect(() => verifyCeloxC2CCallbackSignatureV2(rawBody, timestamp, signV2(rawBody, timestamp))).toThrow(CeloxError);
  });

  it("rejects a timestamp more than 300 seconds in the future", () => {
    setSecret();
    const rawBody = '{"transactionId":"5c1f9a2e-..."}';
    const timestamp = String(Math.floor(Date.now() / 1000) + 301);
    expect(() => verifyCeloxC2CCallbackSignatureV2(rawBody, timestamp, signV2(rawBody, timestamp))).toThrow(CeloxError);
  });

  it("accepts a timestamp exactly at the 300 second boundary", () => {
    setSecret();
    const rawBody = '{"transactionId":"5c1f9a2e-..."}';
    const timestamp = String(Math.floor(Date.now() / 1000) - 300);
    expect(() => verifyCeloxC2CCallbackSignatureV2(rawBody, timestamp, signV2(rawBody, timestamp))).not.toThrow();
  });

  it("rejects a non-numeric timestamp header", () => {
    setSecret();
    const rawBody = '{"transactionId":"5c1f9a2e-..."}';
    expect(() => verifyCeloxC2CCallbackSignatureV2(rawBody, "not-a-number", signV2(rawBody, "not-a-number")))
      .toThrow(CeloxError);
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
