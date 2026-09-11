import type { C2CTransactionResponse, CeloxC2CListItem } from "./types";

type MergeResult = {
  items: CeloxC2CListItem[];
  /** transactionId ของแถวที่สถานะเปลี่ยนหรือเพิ่งโผล่ ใช้ทำ highlight บนหน้าจอ */
  changedIds: string[];
};

// รวมผล GET /api/celox/c2c?updatedAfter=… เข้ากับรายการที่มีอยู่
// delta อาจมีแถวเดิมที่ไม่เปลี่ยนติดมาด้วย (server ใช้ >=) จึงเทียบ updatedAt ก่อนนับว่าเปลี่ยน
export function mergeC2CListDelta(current: CeloxC2CListItem[], delta: CeloxC2CListItem[]): MergeResult {
  if (delta.length === 0) return { items: current, changedIds: [] };

  const byId = new Map(current.map((row) => [row.transactionId, row]));
  const changedIds: string[] = [];
  const added: CeloxC2CListItem[] = [];

  for (const row of delta) {
    const existing = byId.get(row.transactionId);
    if (!existing) {
      byId.set(row.transactionId, row);
      added.push(row);
      changedIds.push(row.transactionId);
      continue;
    }
    if (existing.updatedAt === row.updatedAt && existing.transactionStatus === row.transactionStatus) continue;
    byId.set(row.transactionId, row);
    changedIds.push(row.transactionId);
  }

  if (changedIds.length === 0) return { items: current, changedIds };
  const kept = current.map((row) => byId.get(row.transactionId) ?? row);
  return { items: [...added, ...kept], changedIds };
}

export function nextC2CListCursor(items: readonly CeloxC2CListItem[]): string | null {
  let cursor: string | null = null;
  for (const row of items) {
    if (cursor === null || row.updatedAt > cursor) cursor = row.updatedAt;
  }
  return cursor;
}

// เอาสถานะ/ยอดที่ callback เพิ่งเขียนลง DB มาทับ detail ที่เปิดอยู่ โดยไม่ยิง GET ไป Celox
// DB เก็บแค่ roll-up ไม่เก็บ parts จึงคง parts/transferTo จาก GET ครั้งล่าสุดไว้
export function patchC2CDetailFromListItem(
  detail: C2CTransactionResponse,
  row: CeloxC2CListItem,
): C2CTransactionResponse {
  if (row.transactionId !== detail.transactionId) return detail;
  return {
    ...detail,
    transactionStatus: row.transactionStatus,
    feeAmount: row.feeAmount,
    settledAmount: row.settledAmount,
    heldAmount: row.heldAmount,
    unfilledAmount: row.unfilledAmount,
    awaitingManualReview: row.awaitingManualReview,
    matchDeadline: row.matchDeadline,
  };
}
