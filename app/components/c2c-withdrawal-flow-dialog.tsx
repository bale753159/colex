"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Hourglass,
  LoaderCircle,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BANK_NAME_MAP, BANK_OPTIONS } from "@/lib/celox/banks";
import { c2cStatusDescription, c2cStatusLabel, c2cStatusTone } from "@/lib/celox/c2c-display";
import type {
  C2CMatchTtlSeconds,
  CancelC2CTransactionResponse,
  CeloxErrorResponse,
  CeloxFieldError,
  CreateC2CWithdrawalRequest,
  CreateC2CWithdrawalResponse,
} from "@/lib/celox/types";
import type { Customer } from "@/lib/types";

type Phase = "form" | "review" | "creating" | "result" | "cancelled" | "error" | "uncertain";
type FormState = {
  amount: string;
  destinationBankCode: string;
  destinationAccountName: string;
  destinationAccountNo: string;
  matchTtlSeconds: C2CMatchTtlSeconds;
  referenceId: string;
};
type Props = {
  customer: Customer;
  customers: Customer[];
  onCustomerChange: (customerId: string) => void;
  onClose: () => void;
  onChanged: () => void;
};

const currency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
});
const dateTime = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

function makeReference() {
  return `KLANG-C2C-WD-${Date.now().toString(36).toUpperCase()}`;
}

function fieldMessage(error: CeloxFieldError) {
  if (error.code === "required") return "กรุณากรอกข้อมูลช่องนี้";
  if (error.code === "invalid_bank_code") return "รหัสธนาคารไม่รองรับ";
  return "ข้อมูลช่องนี้ไม่ถูกต้อง";
}

export default function C2CWithdrawalFlowDialog({
  customer,
  customers,
  onCustomerChange,
  onClose,
  onChanged,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [form, setForm] = useState<FormState>({
    amount: "",
    destinationBankCode: "",
    destinationAccountName: "",
    destinationAccountNo: "",
    matchTtlSeconds: 900,
    referenceId: makeReference(),
  });
  const [requestBody, setRequestBody] = useState<CreateC2CWithdrawalRequest | null>(null);
  const [withdrawal, setWithdrawal] = useState<CreateC2CWithdrawalResponse | null>(null);
  const [cancelResult, setCancelResult] = useState<CancelC2CTransactionResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState("");
  const [failure, setFailure] = useState<CeloxErrorResponse | null>(null);
  const busy = phase === "creating";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  function requestClose() {
    if (busy) return;
    if (withdrawal) onChanged();
    onClose();
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setGlobalError("");
  }

  function validateForm() {
    const next: Record<string, string> = {};
    const amount = Number(form.amount.replaceAll(",", ""));
    const accountNo = form.destinationAccountNo.replace(/[\s-]/g, "");
    if (!Number.isFinite(amount) || amount <= 0) next.amount = "กรุณากรอกจำนวนเงินมากกว่า 0 บาท";
    else if (amount > customer.withdrawableBalance) next.amount = "ยอดที่ถอนได้ของลูกค้าไม่เพียงพอ";
    if (!form.destinationBankCode) next.destinationBankCode = "กรุณาเลือกธนาคารปลายทาง";
    if (!form.destinationAccountName.trim()) next.destinationAccountName = "กรุณากรอกชื่อบัญชีปลายทาง";
    if (!/^\d+$/.test(accountNo)) next.destinationAccountNo = "กรุณากรอกเลขบัญชีเป็นตัวเลข";
    if (!form.referenceId.trim()) next.referenceId = "กรุณาระบุ Reference ID สำหรับติดตามรายการ";
    setFieldErrors(next);
    if (Object.keys(next).length > 0) return null;
    const input: CreateC2CWithdrawalRequest = {
      amount,
      destinationBankCode: form.destinationBankCode as CreateC2CWithdrawalRequest["destinationBankCode"],
      destinationAccountName: form.destinationAccountName.trim(),
      destinationAccountNo: accountNo,
      matchTtlSeconds: form.matchTtlSeconds,
      referenceId: form.referenceId.trim(),
    };
    return input;
  }

  function handleReview(event: FormEvent) {
    event.preventDefault();
    const input = validateForm();
    if (!input) return;
    setRequestBody(input);
    setPhase("review");
  }

  async function createWithdrawal() {
    if (!requestBody) return;
    setPhase("creating");
    setGlobalError("");
    setFailure(null);
    try {
      const response = await fetch("/api/celox/c2c/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, ...requestBody }),
      });
      const result = await response.json() as CreateC2CWithdrawalResponse & CeloxErrorResponse;
      if (!response.ok) {
        setFailure(result);
        setGlobalError(result.error);
        setFieldErrors(Object.fromEntries((result.fieldErrors ?? []).map((item) => [item.field, fieldMessage(item)])));
        if (["request_timeout", "network_error", "invalid_response", "persistence_error", "upstream_error"].includes(result.code)) {
          setPhase("uncertain");
        } else if (result.fieldErrors?.length) {
          setPhase("form");
        } else {
          setPhase("error");
        }
        return;
      }
      setWithdrawal(result);
      setPhase("result");
      onChanged();
    } catch {
      setGlobalError("การเชื่อมต่อขาดหลังส่งคำขอ รายการอาจถูกสร้างและกันเงินแล้ว ห้ามกดสร้างซ้ำ");
      setPhase("uncertain");
    }
  }

  async function cancelWithdrawal() {
    if (!withdrawal) return;
    setGlobalError("");
    try {
      const response = await fetch(`/api/celox/c2c/${encodeURIComponent(withdrawal.transactionId)}/cancel`, {
        method: "POST",
      });
      const result = await response.json() as CancelC2CTransactionResponse & CeloxErrorResponse;
      if (!response.ok) {
        setFailure(result);
        setGlobalError(result.error);
        return;
      }
      setCancelResult(result);
      setPhase(result.transactionStatus === "CANCELLED" ? "cancelled" : "result");
      onChanged();
    } catch {
      setGlobalError("ยืนยันผลยกเลิกไม่ได้ กรุณาตรวจสถานะเดิมก่อนกดซ้ำ");
    }
  }

  const title = phase === "form"
    ? "ถอนเงินแบบ C2C"
    : phase === "review" || phase === "creating"
      ? "ตรวจสอบรายการถอน C2C"
      : phase === "cancelled" ? "ยกเลิกรายการถอน C2C" : "ผลรายการถอน C2C";
  const resultStatus = cancelResult?.transactionStatus ?? withdrawal?.transactionStatus;

  return (
    <dialog
      ref={dialogRef}
      className="deposit-dialog-layer"
      aria-labelledby="c2c-withdrawal-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section className="transaction-dialog celox-deposit-dialog c2c-dialog c2c-withdrawal-dialog" aria-busy={busy}>
        <header className="dialog-header deposit-dialog-header">
          <div><span className="dialog-icon c2c withdraw"><ArrowUpRight size={20} /></span><div><h2 ref={headingRef} id="c2c-withdrawal-title" tabIndex={-1}>{title}</h2><p>{withdrawal ? `${withdrawal.orderId} · ${currency.format(withdrawal.amount)}` : `${customer.name} · ${customer.account}`}</p></div></div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="ปิด" disabled={busy}><X size={20} /></button>
        </header>

        <ol className="deposit-steps c2c-steps" aria-label="ขั้นตอนถอนเงิน C2C">
          {["ข้อมูลปลายทาง", "ตรวจสอบ", "รอจับคู่"].map((label, index) => {
            const step = phase === "form" ? 1 : phase === "review" || phase === "creating" ? 2 : 3;
            const itemStep = index + 1;
            return <li key={label} className={itemStep === step ? "active" : itemStep < step ? "complete" : ""} aria-current={itemStep === step ? "step" : undefined}><span>{itemStep < step ? <Check size={13} /> : itemStep}</span>{label}</li>;
          })}
        </ol>

        {phase === "form" && (
          <form className="transaction-form deposit-form" onSubmit={handleReview} noValidate>
            <label htmlFor="c2c-withdrawal-customer"><span>ลูกค้าในระบบ</span><div className="select-wrap"><select id="c2c-withdrawal-customer" value={customer.id} onChange={(event) => onCustomerChange(event.target.value)}>{customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.account} · ถอนได้ {currency.format(item.withdrawableBalance)}</option>)}</select><ChevronDown size={17} /></div><small>ระบบจะกันยอดที่ถอนได้ทันทีเมื่อ Celox สร้างรายการสำเร็จ</small></label>
            <div className="deposit-field-grid">
              <label htmlFor="c2c-withdrawal-amount"><span>ยอดที่ต้องการถอน</span><div className={`money-input ${fieldErrors.amount ? "invalid" : ""}`}><span>฿</span><input id="c2c-withdrawal-amount" autoFocus inputMode="decimal" value={form.amount} onChange={(event) => updateField("amount", event.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" aria-invalid={Boolean(fieldErrors.amount)} /></div><small className={fieldErrors.amount ? "field-error" : ""}>{fieldErrors.amount || `ยอดที่ถอนได้ ${currency.format(customer.withdrawableBalance)}`}</small></label>
              <label htmlFor="c2c-withdrawal-bank"><span>ธนาคารปลายทาง</span><div className={`select-wrap ${fieldErrors.destinationBankCode ? "invalid" : ""}`}><select id="c2c-withdrawal-bank" value={form.destinationBankCode} onChange={(event) => updateField("destinationBankCode", event.target.value)} aria-invalid={Boolean(fieldErrors.destinationBankCode)}><option value="" disabled>เลือกธนาคารผู้รับ</option>{BANK_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}</select><ChevronDown size={17} /></div><small className={fieldErrors.destinationBankCode ? "field-error" : ""}>{fieldErrors.destinationBankCode || "Celox จะตรวจบัญชีปลายทางกับ blacklist"}</small></label>
            </div>
            <label htmlFor="c2c-withdrawal-name"><span>ชื่อบัญชีปลายทาง</span><input id="c2c-withdrawal-name" value={form.destinationAccountName} onChange={(event) => updateField("destinationAccountName", event.target.value)} placeholder="ชื่อเจ้าของบัญชีผู้รับ" aria-invalid={Boolean(fieldErrors.destinationAccountName)} /><small className={fieldErrors.destinationAccountName ? "field-error" : ""}>{fieldErrors.destinationAccountName || "ฝั่งถอนจะไม่เห็นข้อมูลของคู่ที่จับได้"}</small></label>
            <label htmlFor="c2c-withdrawal-account"><span>เลขบัญชีปลายทาง</span><input id="c2c-withdrawal-account" inputMode="numeric" value={form.destinationAccountNo} onChange={(event) => updateField("destinationAccountNo", event.target.value.replace(/[^0-9\s-]/g, ""))} placeholder="123-4-56789-0" aria-invalid={Boolean(fieldErrors.destinationAccountNo)} /><small className={fieldErrors.destinationAccountNo ? "field-error" : ""}>{fieldErrors.destinationAccountNo || "ใส่เลขบัญชีตามสมุด ระบบไม่จำกัดจำนวนหลัก"}</small></label>
            <div className="deposit-field-grid">
              <label htmlFor="c2c-withdrawal-ttl"><span>เวลารอจับคู่</span><div className="select-wrap"><select id="c2c-withdrawal-ttl" value={form.matchTtlSeconds} onChange={(event) => updateField("matchTtlSeconds", Number(event.target.value) as C2CMatchTtlSeconds)}><option value={60}>1 นาที</option><option value={120}>2 นาที</option><option value={300}>5 นาที</option><option value={600}>10 นาที</option><option value={900}>15 นาที</option><option value={1200}>20 นาที</option></select><ChevronDown size={17} /></div><small>เมื่อหมดเวลา Celox จะคืนยอดที่กันไว้</small></label>
              <label htmlFor="c2c-withdrawal-reference"><span>Reference ID</span><input id="c2c-withdrawal-reference" value={form.referenceId} onChange={(event) => updateField("referenceId", event.target.value)} aria-invalid={Boolean(fieldErrors.referenceId)} /><small className={fieldErrors.referenceId ? "field-error" : ""}>{fieldErrors.referenceId || "ใช้ค้นหารายการเดิมเมื่อผลเครือข่ายไม่แน่นอน"}</small></label>
            </div>
            <div className="inline-notice"><ShieldCheck size={18} /><span><strong>เงินถูกกันตั้งแต่สร้างรายการ</strong> reservedAmount ของ Celox รวมเงินต้นและค่าธรรมเนียม และถือว่าใช้ไม่ได้จนกว่ารายการจะจบ</span></div>
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions"><button type="button" className="button secondary-button" onClick={requestClose}>ยกเลิก</button><button type="submit" className="button deposit-button">ตรวจสอบข้อมูล</button></div>
          </form>
        )}

        {(phase === "review" || phase === "creating") && requestBody && (
          <div className="review-content deposit-review">
            <div className="review-amount"><span>ยอดถอน C2C</span><strong>{currency.format(requestBody.amount)}</strong></div>
            <dl><div><dt>ลูกค้า</dt><dd>{customer.name}<small>{customer.account}</small></dd></div><div><dt>บัญชีปลายทาง</dt><dd>{requestBody.destinationAccountName}<small>{BANK_NAME_MAP[requestBody.destinationBankCode]} · {requestBody.destinationAccountNo}</small></dd></div><div><dt>เวลารอจับคู่</dt><dd>{requestBody.matchTtlSeconds ? `${requestBody.matchTtlSeconds / 60} นาที` : "ค่ากลางของระบบ"}</dd></div><div><dt>Reference ID</dt><dd>{requestBody.referenceId}</dd></div></dl>
            <div className="deposit-clarification warning"><WalletCards size={18} /><span><strong>Celox จะกันเงินต้นและค่าธรรมเนียมทันที</strong> KLANG จะกันยอดเงินต้นของลูกค้าเพื่อป้องกันการใช้ซ้ำระหว่างรอ</span></div>
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={() => setPhase("form")} disabled={phase === "creating"}><ArrowLeft size={16} />แก้ไขข้อมูล</button><button className="button deposit-button" type="button" onClick={() => void createWithdrawal()} disabled={phase === "creating"}>{phase === "creating" ? <><LoaderCircle className="spin" size={17} />กำลังกันยอดและสร้าง…</> : "ยืนยันสร้างรายการ"}</button></div>
          </div>
        )}

        {phase === "result" && withdrawal && (
          <div className={`deposit-result c2c-result ${c2cStatusTone(resultStatus ?? withdrawal.transactionStatus)}`}>
            <div className="result-heading"><span className="state-symbol"><Hourglass size={27} /></span><div><h3>{c2cStatusLabel(resultStatus ?? withdrawal.transactionStatus)}</h3><p>{c2cStatusDescription(resultStatus ?? withdrawal.transactionStatus)}</p></div></div>
            <div className="result-amount"><span>ยอดถอน</span><strong>{currency.format(withdrawal.amount)}</strong></div>
            <dl className="result-details"><div><dt>ค่าธรรมเนียม Celox</dt><dd>{currency.format(withdrawal.feeAmount)}</dd></div><div><dt>ยอดที่กันใน operating</dt><dd>{currency.format(withdrawal.reservedAmount)}</dd></div><div><dt>Order ID</dt><dd>{withdrawal.orderId}</dd></div><div><dt>Reference ID</dt><dd>{withdrawal.referenceId}</dd></div><div><dt>เส้นตายจับคู่</dt><dd>{withdrawal.matchDeadline ? dateTime.format(new Date(withdrawal.matchDeadline)) : "จับคู่แล้ว"}</dd></div></dl>
            {withdrawal.transactionStatus === "PENDING_MANUAL_C2C" && <div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>รายการถูกส่งให้เจ้าหน้าที่ Celox ตรวจสอบ</strong> ยอดที่กันไว้ยังใช้งานไม่ได้ และรายการนี้ยกเลิกเองไม่ได้จนกว่าจะมีผลสถานะใหม่</span></div>}
            <div className="privacy-notice"><ShieldAlert size={18} /><span><strong>ฝั่งถอนไม่ได้รับข้อมูลคู่รายการ</strong> สถานะเปลี่ยนเป็น PENDING_TRANSFER คือข้อมูลทั้งหมดที่ Celox เปิดเผยเมื่อจับคู่แล้ว</span></div>
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions">{withdrawal.transactionStatus === "PENDING" && <button className="button danger-outline-button" type="button" onClick={() => void cancelWithdrawal()}>ยกเลิกรายการ</button>}<button className="button deposit-button" type="button" onClick={requestClose}>ปิดและดูในรายการ C2C</button></div>
          </div>
        )}

        {phase === "cancelled" && (
          <div className="deposit-state-panel c2c-cancelled"><span className="state-symbol"><CheckCircle2 size={27} /></span><h3>ยกเลิกรายการและคืนยอดที่กันไว้แล้ว</h3><p>ยกเลิกได้เพราะรายการยังเป็น PENDING และยังไม่ถูกจับคู่</p><div className="state-reference"><span>รายการ</span><strong>{cancelResult?.orderId ?? withdrawal?.orderId}</strong></div><div className="dialog-actions deposit-actions"><button className="button deposit-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div></div>
        )}

        {phase === "error" && failure && (
          <div className="deposit-state-panel warning" role="alert"><span className="state-symbol"><AlertTriangle size={26} /></span><h3>ยังสร้างรายการถอน C2C ไม่ได้</h3><p>{globalError}</p><div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>{failure.retryable ? "เว้นช่วงก่อนลองคำขอเดิม" : "ไม่ควรส่งข้อผิดพลาดนี้ซ้ำ"}</strong> {failure.code === "c2c_insufficient_balance" ? "ตรวจทั้งยอดลูกค้าและยอด operating ที่ต้องรวมค่าธรรมเนียม" : "ตรวจสาเหตุแล้วค่อยดำเนินการต่อ"}</span></div><div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิด</button>{failure.retryable && <button className="button deposit-button" type="button" onClick={() => void createWithdrawal()}><RefreshCcw size={16} />ลองอีกครั้ง</button>}</div></div>
        )}

        {phase === "uncertain" && (
          <div className="deposit-state-panel uncertain" role="alert"><span className="state-symbol"><ShieldAlert size={26} /></span><h3>ยังยืนยันไม่ได้ว่าเงินถูกกันหรือไม่</h3><p>{globalError}</p>{requestBody?.referenceId && <div className="state-reference"><span>ใช้ตรวจรายการเดิม</span><strong>{requestBody.referenceId}</strong></div>}<div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>ห้ามสร้างซ้ำ</strong> เปิดหน้า “รายการ C2C” แล้วค้น Reference ID นี้ ระบบสามารถผูกยอดที่ค้างกลับเมื่อ GET พบรายการจริง</span></div><div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div></div>
        )}
      </section>
    </dialog>
  );
}
