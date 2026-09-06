"use client";

import { ChevronDown, LoaderCircle, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BANK_OPTIONS } from "@/lib/celox/banks";
import type { Customer } from "@/lib/types";

type Props = {
  onClose: () => void;
  onCreated: (customer: Customer) => void;
};

type FormState = {
  name: string;
  bankCode: string;
  bankAccountNo: string;
  balance: string;
  withdrawableBalance: string;
  phone: string;
  email: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  bankCode: "",
  bankAccountNo: "",
  balance: "",
  withdrawableBalance: "",
  phone: "",
  email: "",
};

function toAmount(value: string) {
  return Number(value.replaceAll(",", ""));
}

export default function CustomerCreateDialog({ onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setGlobalError("");
  }

  // ตรวจซ้ำกับ createCustomer ฝั่งเซิร์ฟเวอร์ ที่นี่แค่บอกผู้ใช้ก่อนยิงคำขอ
  function validate() {
    const next: Record<string, string> = {};
    const accountNo = form.bankAccountNo.replace(/[\s-]/g, "");
    const balance = toAmount(form.balance);
    const withdrawable = toAmount(form.withdrawableBalance);

    if (!form.name.trim()) next.name = "กรุณากรอกชื่อ-นามสกุลลูกค้า";
    if (!form.bankCode) next.bankCode = "กรุณาเลือกธนาคาร";
    if (!/^\d{10,15}$/.test(accountNo)) next.bankAccountNo = "เลขที่บัญชีต้องเป็นตัวเลข 10–15 หลัก";
    if (!form.balance.trim() || !Number.isFinite(balance) || balance < 0) next.balance = "กรุณากรอกยอดคงเหลือ (0 ขึ้นไป)";
    if (!form.withdrawableBalance.trim() || !Number.isFinite(withdrawable) || withdrawable < 0) {
      next.withdrawableBalance = "กรุณากรอกยอดที่ถอนได้ (0 ขึ้นไป)";
    } else if (Number.isFinite(balance) && withdrawable > balance) {
      next.withdrawableBalance = "ยอดที่ถอนได้ต้องไม่เกินยอดคงเหลือ";
    }

    setFieldErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      name: form.name.trim(),
      bankCode: form.bankCode,
      bankAccountNo: accountNo,
      balance,
      withdrawableBalance: withdrawable,
      phone: form.phone.trim(),
      email: form.email.trim(),
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = validate();
    if (!input) return;
    setSubmitting(true);
    setGlobalError("");
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json() as { customer?: Customer; error?: string };
      if (!response.ok || !result.customer) throw new Error(result.error || "สร้างลูกค้าไม่สำเร็จ");
      onCreated(result.customer);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "สร้างลูกค้าไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  function requestClose() {
    if (submitting) return;
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="deposit-dialog-layer"
      aria-labelledby="customer-create-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section className="transaction-dialog customer-create-dialog" aria-busy={submitting}>
        <header className="dialog-header deposit-dialog-header">
          <div><span className="dialog-icon brand"><UserPlus size={20} /></span><div><h2 id="customer-create-title">เพิ่มลูกค้าใหม่</h2><p>เลขที่ลูกค้า เลขบัญชีในระบบ และสี avatar ระบบสร้างให้อัตโนมัติ</p></div></div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="ปิด" disabled={submitting}><X size={20} /></button>
        </header>

        <form className="transaction-form deposit-form" onSubmit={submit} noValidate>
          <label htmlFor="customer-name"><span>ชื่อ-นามสกุล</span><input id="customer-name" autoFocus value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="เช่น สมชาย ใจดี" aria-invalid={Boolean(fieldErrors.name)} /><small className={fieldErrors.name ? "field-error" : ""}>{fieldErrors.name || "ใช้เป็นชื่อบัญชีต้นทาง/ปลายทางของรายการ C2C ด้วย"}</small></label>

          <div className="deposit-field-grid">
            <label htmlFor="customer-bank"><span>ธนาคาร</span><div className={`select-wrap ${fieldErrors.bankCode ? "invalid" : ""}`}><select id="customer-bank" value={form.bankCode} onChange={(event) => updateField("bankCode", event.target.value)} aria-invalid={Boolean(fieldErrors.bankCode)}><option value="" disabled>เลือกธนาคาร</option>{BANK_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}</select><ChevronDown size={17} /></div><small className={fieldErrors.bankCode ? "field-error" : ""}>{fieldErrors.bankCode || "ต้องเป็นธนาคารที่ Celox รองรับ"}</small></label>
            <label htmlFor="customer-account-no"><span>เลขที่บัญชี</span><input id="customer-account-no" inputMode="numeric" value={form.bankAccountNo} onChange={(event) => updateField("bankAccountNo", event.target.value.replace(/[^0-9\s-]/g, ""))} placeholder="123-4-56789-0" aria-invalid={Boolean(fieldErrors.bankAccountNo)} /><small className={fieldErrors.bankAccountNo ? "field-error" : ""}>{fieldErrors.bankAccountNo || "ตัวเลข 10–15 หลัก"}</small></label>
          </div>

          <div className="deposit-field-grid">
            <label htmlFor="customer-balance"><span>ยอดคงเหลือ</span><div className={`money-input ${fieldErrors.balance ? "invalid" : ""}`}><span>฿</span><input id="customer-balance" inputMode="decimal" value={form.balance} onChange={(event) => updateField("balance", event.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" aria-invalid={Boolean(fieldErrors.balance)} /></div><small className={fieldErrors.balance ? "field-error" : ""}>{fieldErrors.balance || "ยอดตั้งต้น ไม่สร้างรายการในหน้าธุรกรรม"}</small></label>
            <label htmlFor="customer-withdrawable"><span>ยอดที่ถอนได้</span><div className={`money-input ${fieldErrors.withdrawableBalance ? "invalid" : ""}`}><span>฿</span><input id="customer-withdrawable" inputMode="decimal" value={form.withdrawableBalance} onChange={(event) => updateField("withdrawableBalance", event.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" aria-invalid={Boolean(fieldErrors.withdrawableBalance)} /></div><small className={fieldErrors.withdrawableBalance ? "field-error" : ""}>{fieldErrors.withdrawableBalance || "ต้องไม่เกินยอดคงเหลือ"}</small></label>
          </div>

          <div className="deposit-field-grid">
            <label htmlFor="customer-phone"><span>เบอร์โทร <em>(ไม่บังคับ)</em></span><input id="customer-phone" inputMode="tel" value={form.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="081-234-5678" /><small>ใช้ค้นหาลูกค้าในตารางได้</small></label>
            <label htmlFor="customer-email"><span>อีเมล <em>(ไม่บังคับ)</em></span><input id="customer-email" inputMode="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="name@example.com" /><small>เว้นว่างได้</small></label>
          </div>

          {globalError && <div className="form-error" role="alert">{globalError}</div>}

          <div className="dialog-actions deposit-actions">
            <button type="button" className="button secondary-button" onClick={requestClose} disabled={submitting}>ยกเลิก</button>
            <button type="submit" className="button deposit-button" disabled={submitting}>{submitting ? <><LoaderCircle className="spin" size={17} />กำลังบันทึก…</> : "สร้างลูกค้า"}</button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
