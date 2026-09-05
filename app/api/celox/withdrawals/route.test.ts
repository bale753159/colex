import { describe, expect, it } from "vitest";
import { isReservationReferenceConflict } from "./route";

describe("isReservationReferenceConflict", () => {
  it("recognises a Postgres unique_violation on the reference_id constraint", () => {
    expect(isReservationReferenceConflict({
      code: "23505",
      constraint: "celox_withdrawal_reservations_reference_id_key",
    })).toBe(true);
  });

  it("does not match a unique_violation on an unrelated constraint", () => {
    expect(isReservationReferenceConflict({
      code: "23505",
      constraint: "customers_pkey",
    })).toBe(false);
  });

  it("does not match an unrelated SQLSTATE", () => {
    expect(isReservationReferenceConflict({
      code: "23502",
      constraint: "celox_withdrawal_reservations_reference_id_key",
    })).toBe(false);
  });

  it("does not match the old SQLite error code", () => {
    expect(isReservationReferenceConflict({
      code: "SQLITE_CONSTRAINT_UNIQUE",
      constraint: "celox_withdrawal_reservations_reference_id_key",
    })).toBe(false);
  });

  it("is tolerant of error shapes it does not recognise, returning false rather than throwing", () => {
    expect(isReservationReferenceConflict(null)).toBe(false);
    expect(isReservationReferenceConflict(undefined)).toBe(false);
    expect(isReservationReferenceConflict("boom")).toBe(false);
    expect(isReservationReferenceConflict(new Error("plain error, no code"))).toBe(false);
    expect(isReservationReferenceConflict({})).toBe(false);
    expect(isReservationReferenceConflict({ code: "23505" })).toBe(false);
  });
});
