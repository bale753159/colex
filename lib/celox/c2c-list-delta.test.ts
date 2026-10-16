import { describe, expect, it } from "vitest";
import { mergeC2CListDelta, nextC2CListCursor, patchC2CDetailFromListItem } from "./c2c-list-delta";
import type { C2CTransactionResponse, CeloxC2CListItem } from "./types";

function item(overrides: Partial<CeloxC2CListItem>): CeloxC2CListItem {
  return {
    transactionId: "tx-1",
    orderId: "ORD-1",
    referenceId: null,
    customerId: "C-1",
    customerName: "ลูกค้า",
    customerAccount: "ACC-1",
    direction: "deposit",
    transactionStatus: "PENDING",
    amount: 100,
    feeAmount: 0,
    settledAmount: 0,
    heldAmount: 0,
    unfilledAmount: null,
    awaitingManualReview: false,
    matchDeadline: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeC2CListDelta", () => {
  it("แทนที่แถวเดิมด้วยแถวที่อัปเดต และรายงาน id ที่สถานะเปลี่ยน", () => {
    const current = [item({ transactionId: "tx-1" }), item({ transactionId: "tx-2", orderId: "ORD-2" })];
    const delta = [item({ transactionId: "tx-2", orderId: "ORD-2", transactionStatus: "SUCCESS", updatedAt: "2026-09-11T00:00:09.000Z" })];

    const result = mergeC2CListDelta(current, delta);

    expect(result.items.map((row) => row.transactionId)).toEqual(["tx-1", "tx-2"]);
    expect(result.items[1].transactionStatus).toBe("SUCCESS");
    expect(result.changedIds).toEqual(["tx-2"]);
  });

  it("เติมรายการใหม่ไว้บนสุด", () => {
    const current = [item({ transactionId: "tx-1" })];
    const delta = [item({ transactionId: "tx-9", orderId: "ORD-9", createdAt: "2026-09-11T00:00:09.000Z" })];

    const result = mergeC2CListDelta(current, delta);

    expect(result.items.map((row) => row.transactionId)).toEqual(["tx-9", "tx-1"]);
    expect(result.changedIds).toEqual(["tx-9"]);
  });

  it("แถวเดิมที่ยิงซ้ำโดยไม่มีอะไรเปลี่ยน ไม่นับว่าเปลี่ยน", () => {
    const current = [item({ transactionId: "tx-1" })];
    const result = mergeC2CListDelta(current, [item({ transactionId: "tx-1" })]);

    expect(result.changedIds).toEqual([]);
  });

  it("ไม่สร้าง array ใหม่เมื่อ delta ว่าง เพื่อไม่ให้ React re-render", () => {
    const current = [item({ transactionId: "tx-1" })];
    expect(mergeC2CListDelta(current, []).items).toBe(current);
  });
});

describe("nextC2CListCursor", () => {
  it("คืน updatedAt ที่ใหม่ที่สุดในรายการ", () => {
    const items = [
      item({ updatedAt: "2026-09-11T00:00:03.000Z" }),
      item({ updatedAt: "2026-09-11T00:00:09.000Z" }),
      item({ updatedAt: "2026-09-11T00:00:05.000Z" }),
    ];
    expect(nextC2CListCursor(items)).toBe("2026-09-11T00:00:09.000Z");
  });

  it("คืน null เมื่อรายการว่าง", () => {
    expect(nextC2CListCursor([])).toBeNull();
  });
});

describe("patchC2CDetailFromListItem", () => {
  const detail: C2CTransactionResponse = {
    transactionId: "tx-1",
    orderId: "ORD-1",
    referenceId: null,
    direction: "withdraw",
    transactionStatus: "PENDING_TRANSFER",
    amount: 250,
    feeAmount: 5,
    settledAmount: 0,
    heldAmount: 5,
    unfilledAmount: 0,
    awaitingManualReview: false,
    matchDeadline: "2026-09-11T00:10:00.000Z",
    transferTo: null,
    parts: [{ orderId: "P-1", amount: 250, feeAmount: 5, transactionStatus: "PENDING_TRANSFER", matchedAt: null, matchDeadline: null, cancelReason: null }],
  };

  it("อัปเดตสถานะและยอดจาก DB row แต่คง parts/transferTo จาก GET ครั้งล่าสุด", () => {
    const patched = patchC2CDetailFromListItem(detail, item({
      transactionId: "tx-1", direction: "withdraw", transactionStatus: "SUCCESS",
      settledAmount: 190, unfilledAmount: 60, heldAmount: 0, feeAmount: 5, matchDeadline: null,
    }));

    expect(patched.transactionStatus).toBe("SUCCESS");
    expect(patched.settledAmount).toBe(190);
    expect(patched.unfilledAmount).toBe(60);
    expect(patched.heldAmount).toBe(0);
    expect(patched.matchDeadline).toBeNull();
    expect(patched.parts).toBe(detail.parts);
  });

  it("ไม่แตะ detail ของรายการอื่น", () => {
    expect(patchC2CDetailFromListItem(detail, item({ transactionId: "tx-2", transactionStatus: "SUCCESS" }))).toBe(detail);
  });
});
