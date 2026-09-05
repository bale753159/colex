import { describe, expect, it } from "vitest";
import { isRetryablePostgresError } from "./callback.server";

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
