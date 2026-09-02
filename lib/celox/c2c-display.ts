import type { C2CTransactionStatus } from "./types";

export function c2cStatusLabel(status: C2CTransactionStatus | string) {
  switch (status) {
    case "PENDING":
      return "รอจับคู่";
    case "PENDING_TRANSFER":
      return "รอโอนเงิน";
    case "PENDING_MANUAL_C2C":
      return "รอเจ้าหน้าที่ดำเนินการ";
    case "PENDING_APPROVE":
      return "รอตรวจสลิป";
    case "PENDING_REFUND_C2C":
      return "รอเจ้าหน้าที่คืนเงิน";
    case "PENDING_REVIEW":
      return "รอเจ้าหน้าที่ตรวจสอบ";
    case "PENDING_TOPUP_C2C":
      return "รอโอนส่วนที่ขาด";
    case "SUCCESS":
      return "สำเร็จ";
    case "CANCELLED":
      return "ยกเลิกแล้ว";
    case "EXPIRED":
      return "หมดเวลา";
    default:
      return status.replaceAll("_", " ");
  }
}

export function c2cStatusDescription(status: C2CTransactionStatus | string) {
  switch (status) {
    case "PENDING":
      return "Celox กำลังหารายการยอดเท่ากันเพื่อจับคู่";
    case "PENDING_TRANSFER":
      return "จับคู่แล้วและกำลังรอผู้ฝากโอนเงิน";
    case "PENDING_MANUAL_C2C":
      return "Celox พักรายการไว้ให้เจ้าหน้าที่ตรวจสอบ ยอดที่กันไว้ยังไม่ถูกปล่อยจนกว่าจะมีผลตัดสิน";
    case "PENDING_APPROVE":
      return "สลิปตรงบางส่วนและกำลังรอเจ้าหน้าที่ตรวจสอบ";
    case "PENDING_REFUND_C2C":
    case "PENDING_REVIEW":
      return "รายการถูกพักไว้โดยไม่มีเวลาปลดอัตโนมัติ ต้องรอเจ้าหน้าที่จัดการ";
    case "PENDING_TOPUP_C2C":
      return "ยังอยู่ในเวลารายการและสามารถโอนยอดส่วนที่ขาดได้";
    case "SUCCESS":
      return "ทั้งสองฝั่งจบรายการพร้อมกันแล้ว";
    case "CANCELLED":
      return "รายการที่ยังไม่จับคู่ถูกยกเลิกแล้ว";
    case "EXPIRED":
      return "รายการหรือขั้นตอนเดิมหมดเวลาแล้ว";
    default:
      return "ตรวจสถานะล่าสุดจาก Celox แล้ว";
  }
}

export function c2cStatusTone(status: C2CTransactionStatus | string) {
  if (status === "SUCCESS") return "success";
  if (status === "CANCELLED" || status === "EXPIRED") return "neutral";
  if (
    status === "PENDING_APPROVE"
    || status.includes("MANUAL")
    || status.includes("REVIEW")
    || status.includes("REFUND")
  ) {
    return "warning";
  }
  if (status === "PENDING_TRANSFER" || status === "PENDING_TOPUP_C2C") return "action";
  return "pending";
}

export function isC2CTerminal(status: C2CTransactionStatus | string) {
  return status === "SUCCESS" || status === "CANCELLED";
}
