"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  FileImage,
  Hourglass,
  LoaderCircle,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { BANK_NAME_MAP, BANK_OPTIONS } from "@/lib/celox/banks";
import { c2cStatusDescription, c2cStatusLabel, c2cStatusTone } from "@/lib/celox/c2c-display";
import type {
  C2CDepositSlipResponse,
  C2CMatchTtlSeconds,
  C2CTransactionResponse,
  CancelC2CTransactionResponse,
  CeloxErrorResponse,
  CeloxFieldError,
  CreateC2CDepositRequest,
  CreateC2CDepositResponse,
} from "@/lib/celox/types";
import type { Customer } from "@/lib/types";

type Phase =
  | "form"
  | "review"
  | "creating"
  | "waiting"
  | "ready"
  | "uploading"
  | "result"
  | "cancelled"
  | "error"
  | "uncertain";

type Props = {
  customer: Customer;
  customers: Customer[];
  onCustomerChange: (customerId: string) => void;
  onClose: () => void;
  onChanged: () => void;
};

type FormState = {
  amount: string;
  sourceBankCode: string;
  sourceAccountName: string;
  sourceAccountNo: string;
  matchTtlSeconds: C2CMatchTtlSeconds;
  referenceId: string;
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
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function makeReference() {
  return `KLANG-C2C-DP-${Date.now().toString(36).toUpperCase()}`;
}

function errorMessage(error: CeloxErrorResponse) {
  if (error.code === "c2c_org_limit_reached" && error.details) {
    const { limit, current } = error.details;
    if (limit !== undefined && current !== undefined) {
      return `${error.error} (ใช้อยู่ ${current} จาก ${limit} รายการ)`;
    }
  }
  return error.error;
}

function fieldMessage(error: CeloxFieldError) {
  if (error.code === "required") return "กรุณากรอกข้อมูลช่องนี้";
  if (error.code === "invalid_bank_code") return "รหัสธนาคารไม่รองรับ";
  if (error.code === "not_supported") return "C2C ผ่าน API ไม่รองรับช่องนี้";
  return "ข้อมูลช่องนี้ไม่ถูกต้อง";
}

export default function C2CDepositFlowDialog({
  customer,
  customers,
  onCustomerChange,
  onClose,
  onChanged,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pollAttemptRef = useRef(0);
  const previewUrlRef = useRef("");
  const onChangedRef = useRef(onChanged);
  const [phase, setPhase] = useState<Phase>("form");
  const [form, setForm] = useState<FormState>({
    amount: "",
    sourceBankCode: "",
    sourceAccountName: "",
    sourceAccountNo: "",
    matchTtlSeconds: 600,
    referenceId: makeReference(),
  });
  const [requestBody, setRequestBody] = useState<CreateC2CDepositRequest | null>(null);
  const [deposit, setDeposit] = useState<CreateC2CDepositResponse | null>(null);
  const [status, setStatus] = useState<C2CTransactionResponse | null>(null);
  const [slipResult, setSlipResult] = useState<C2CDepositSlipResponse | null>(null);
  const [cancelResult, setCancelResult] = useState<CancelC2CTransactionResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState("");
  const [failure, setFailure] = useState<CeloxErrorResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [pollMessage, setPollMessage] = useState("ระบบจะตรวจสถานะกับ Celox อัตโนมัติ");
  const [pollRevision, setPollRevision] = useState(0);
  const [dragging, setDragging] = useState(false);

  const busy = phase === "creating" || phase === "uploading";
  const activeTransferTo = status?.transferTo ?? deposit?.transferTo ?? null;
  const activeStatus = slipResult?.transactionStatus
    ?? status?.transactionStatus
    ?? cancelResult?.transactionStatus
    ?? deposit?.transactionStatus
    ?? "PENDING";
  const activeReference = deposit?.referenceId || deposit?.orderId;
  const amount = requestBody?.amount ?? deposit?.amount ?? 0;

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

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (phase !== "waiting" || !activeReference) return;
    const controller = new AbortController();
    const attempt = pollAttemptRef.current;
    const delay = Math.min(15_000, 5_000 + attempt * 2_500);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/celox/c2c/${encodeURIComponent(activeReference)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json() as C2CTransactionResponse & CeloxErrorResponse;
        if (!response.ok) {
          const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
          setPollMessage(response.status === 429
            ? `Celox จำกัดความถี่ชั่วคราว ระบบจะตรวจใหม่${retryAfter > 0 ? `ใน ${retryAfter} วินาที` : ""}`
            : result.error || "ตรวจสถานะไม่สำเร็จ ระบบจะลองใหม่");
          pollAttemptRef.current += 1;
          setPollRevision((current) => current + 1);
          return;
        }
        setStatus(result);
        pollAttemptRef.current = 0;
        if (result.transactionStatus === "PENDING_TRANSFER" && result.transferTo) {
          setPhase("ready");
          setPollMessage("จับคู่แล้ว พร้อมให้ผู้ใช้โอนเงินและแนบสลิป");
          onChangedRef.current();
          return;
        }
        if (result.transactionStatus === "SUCCESS") {
          setPhase("result");
          onChangedRef.current();
          return;
        }
        if (result.transactionStatus === "CANCELLED") {
          setPhase("cancelled");
          onChangedRef.current();
          return;
        }
        setPollMessage(c2cStatusDescription(result.transactionStatus));
        pollAttemptRef.current += 1;
        setPollRevision((current) => current + 1);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPollMessage("การเชื่อมต่อสะดุด ระบบจะตรวจสถานะใหม่โดยไม่สร้างรายการซ้ำ");
        pollAttemptRef.current += 1;
        setPollRevision((current) => current + 1);
      }
    }, delay);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeReference, phase, pollRevision]);

  function requestClose() {
    if (busy) return;
    if (deposit) onChanged();
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
    const normalizedAmount = Number(form.amount.replaceAll(",", ""));
    const accountNo = form.sourceAccountNo.replace(/[\s-]/g, "");
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) next.amount = "กรุณากรอกจำนวนเงินมากกว่า 0 บาท";
    if (!form.sourceBankCode) next.sourceBankCode = "กรุณาเลือกธนาคารต้นทาง";
    if (!form.sourceAccountName.trim()) next.sourceAccountName = "กรุณากรอกชื่อบัญชีต้นทาง";
    if (!/^\d{10,15}$/.test(accountNo)) next.sourceAccountNo = "เลขบัญชีต้องมี 10–15 หลัก";
    if (!form.referenceId.trim()) next.referenceId = "กรุณาระบุเลขอ้างอิงสำหรับติดตามรายการ";
    setFieldErrors(next);
    if (Object.keys(next).length > 0) return null;
    const input: CreateC2CDepositRequest = {
      amount: normalizedAmount,
      sourceBankCode: form.sourceBankCode as CreateC2CDepositRequest["sourceBankCode"],
      sourceAccountName: form.sourceAccountName.trim(),
      sourceAccountNo: accountNo,
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

  async function createDeposit() {
    if (!requestBody) return;
    setPhase("creating");
    setGlobalError("");
    setFailure(null);
    try {
      const response = await fetch("/api/celox/c2c/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, ...requestBody }),
      });
      const result = await response.json() as CreateC2CDepositResponse & CeloxErrorResponse;
      if (!response.ok) {
        const errors = Object.fromEntries((result.fieldErrors ?? []).map((item) => [item.field, fieldMessage(item)]));
        setFieldErrors(errors);
        setFailure(result);
        setGlobalError(errorMessage(result));
        if (["request_timeout", "network_error", "invalid_response", "persistence_error", "upstream_error"].includes(result.code)) {
          setPhase("uncertain");
        } else if (result.fieldErrors?.length) {
          setPhase("form");
        } else {
          setPhase("error");
        }
        return;
      }
      setDeposit(result);
      setStatus(null);
      pollAttemptRef.current = 0;
      setPhase(result.transferTo ? "ready" : "waiting");
      onChanged();
    } catch {
      setGlobalError("การเชื่อมต่อขาดหลังส่งคำขอ รายการอาจถูกสร้างแล้ว ห้ามกดสร้างซ้ำ");
      setPhase("uncertain");
    }
  }

  function selectFile(nextFile: File | null) {
    setGlobalError("");
    if (!nextFile) {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
      setPreviewUrl("");
      setFile(null);
      return;
    }
    if (!ACCEPTED_TYPES.has(nextFile.type.toLowerCase())) {
      setGlobalError("ไฟล์สลิปต้องเป็น JPEG, PNG, WEBP หรือ HEIC");
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
      setPreviewUrl("");
      setFile(null);
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setGlobalError("ไฟล์สลิปต้องมีขนาดไม่เกิน 10 MB");
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
      setPreviewUrl("");
      setFile(null);
      return;
    }
    setSlipResult(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = URL.createObjectURL(nextFile);
    setPreviewUrl(previewUrlRef.current);
    setFile(nextFile);
  }

  async function uploadSlip() {
    if (!deposit || !file) {
      setGlobalError("กรุณาเลือกรูปสลิปก่อนส่งตรวจ");
      return;
    }
    setPhase("uploading");
    setGlobalError("");
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const response = await fetch(`/api/celox/c2c/deposits/${encodeURIComponent(deposit.transactionId)}/slip`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json() as C2CDepositSlipResponse & CeloxErrorResponse;
      if (!response.ok) {
        setFailure(result);
        setGlobalError(errorMessage(result));
        if (["request_timeout", "network_error", "invalid_response", "persistence_error", "upstream_error"].includes(result.code)) {
          setPhase("uncertain");
        } else {
          setPhase("ready");
        }
        return;
      }
      setSlipResult(result);
      setPhase("result");
      onChanged();
    } catch {
      setGlobalError("การเชื่อมต่อขาดหลังส่งสลิป ผลตรวจอาจถูกบันทึกแล้ว กรุณาตรวจสถานะก่อนแนบซ้ำ");
      setPhase("uncertain");
    }
  }

  async function cancelDeposit() {
    if (!deposit) return;
    setGlobalError("");
    try {
      const response = await fetch(`/api/celox/c2c/${encodeURIComponent(deposit.transactionId)}/cancel`, {
        method: "POST",
      });
      const result = await response.json() as CancelC2CTransactionResponse & CeloxErrorResponse;
      if (!response.ok) {
        setFailure(result);
        setGlobalError(errorMessage(result));
        return;
      }
      setCancelResult(result);
      setPhase(result.transactionStatus === "CANCELLED" ? "cancelled" : "result");
      onChanged();
    } catch {
      setGlobalError("ยืนยันผลยกเลิกไม่ได้ กรุณาตรวจสถานะรายการเดิมก่อนกดซ้ำ");
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`คัดลอก${label}แล้ว`);
      window.setTimeout(() => setCopyStatus(""), 2_000);
    } catch {
      setCopyStatus(`คัดลอก${label}ไม่สำเร็จ`);
    }
  }

  const step = ["form", "review", "creating", "error", "uncertain"].includes(phase)
    ? 1
    : ["waiting", "ready", "uploading"].includes(phase) ? 2 : 3;
  const title = step === 1
    ? phase === "review" || phase === "creating" ? "ตรวจสอบรายการฝาก C2C" : "ฝากเงินแบบ C2C"
    : step === 2 ? phase === "waiting" ? "รอจับคู่ C2C" : "โอนเงินและแนบสลิป"
      : "ผลรายการฝาก C2C";
  const deadline = status?.matchDeadline ?? deposit?.matchDeadline;
  const resultStatus = slipResult?.transactionStatus ?? status?.transactionStatus ?? cancelResult?.transactionStatus;
  const retryableSlip = slipResult?.transactionStatus === "PENDING_TRANSFER" || slipResult?.transactionStatus === "EXPIRED";
  const selectedFileLabel = useMemo(() => file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "", [file]);

  return (
    <dialog
      ref={dialogRef}
      className="deposit-dialog-layer"
      aria-labelledby="c2c-deposit-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section className="transaction-dialog celox-deposit-dialog c2c-dialog" aria-busy={busy}>
        <header className="dialog-header deposit-dialog-header">
          <div><span className="dialog-icon c2c"><ArrowDownLeft size={20} /></span><div><h2 ref={headingRef} id="c2c-deposit-title" tabIndex={-1}>{title}</h2><p>{deposit ? `${deposit.orderId} · ${currency.format(amount)}` : `${customer.name} · ${customer.account}`}</p></div></div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="ปิด" disabled={busy}><X size={20} /></button>
        </header>

        <ol className="deposit-steps c2c-steps" aria-label="ขั้นตอนฝากเงิน C2C">
          {["ข้อมูลต้นทาง", "จับคู่และโอน", "ผลรายการ"].map((label, index) => {
            const itemStep = index + 1;
            return <li key={label} className={itemStep === step ? "active" : itemStep < step ? "complete" : ""} aria-current={itemStep === step ? "step" : undefined}><span>{itemStep < step ? <Check size={13} /> : itemStep}</span>{label}</li>;
          })}
        </ol>

        {phase === "form" && (
          <form className="transaction-form deposit-form" onSubmit={handleReview} noValidate>
            <label htmlFor="c2c-deposit-customer"><span>ลูกค้าในระบบ</span><div className="select-wrap"><select id="c2c-deposit-customer" value={customer.id} onChange={(event) => onCustomerChange(event.target.value)}>{customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.account}</option>)}</select><ChevronDown size={17} /></div><small>ใช้ผูกสถานะ C2C และอัปเดตยอดเมื่อตรวจพบ SUCCESS</small></label>
            <div className="deposit-field-grid">
              <label htmlFor="c2c-deposit-amount"><span>ยอดที่ผู้ใช้จะโอน</span><div className={`money-input ${fieldErrors.amount ? "invalid" : ""}`}><span>฿</span><input id="c2c-deposit-amount" autoFocus inputMode="decimal" value={form.amount} onChange={(event) => updateField("amount", event.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" aria-invalid={Boolean(fieldErrors.amount)} /></div><small className={fieldErrors.amount ? "field-error" : ""}>{fieldErrors.amount || "Celox จะตรวจช่วงยอดต่ำสุดและสูงสุดอีกครั้ง"}</small></label>
              <label htmlFor="c2c-deposit-bank"><span>ธนาคารต้นทาง</span><div className={`select-wrap ${fieldErrors.sourceBankCode ? "invalid" : ""}`}><select id="c2c-deposit-bank" value={form.sourceBankCode} onChange={(event) => updateField("sourceBankCode", event.target.value)} aria-invalid={Boolean(fieldErrors.sourceBankCode)}><option value="" disabled>เลือกธนาคารผู้โอน</option>{BANK_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}</select><ChevronDown size={17} /></div><small className={fieldErrors.sourceBankCode ? "field-error" : ""}>{fieldErrors.sourceBankCode || "ต้องตรงกับธนาคารบนสลิป"}</small></label>
            </div>
            <label htmlFor="c2c-deposit-name"><span>ชื่อบัญชีต้นทาง</span><input id="c2c-deposit-name" value={form.sourceAccountName} onChange={(event) => updateField("sourceAccountName", event.target.value)} placeholder="ชื่อเจ้าของบัญชีผู้โอน" aria-invalid={Boolean(fieldErrors.sourceAccountName)} /><small className={fieldErrors.sourceAccountName ? "field-error" : ""}>{fieldErrors.sourceAccountName || "หากชื่อบนสลิปไม่ตรง รายการอาจถูกพักให้เจ้าหน้าที่ตรวจ"}</small></label>
            <label htmlFor="c2c-deposit-account"><span>เลขบัญชีต้นทาง</span><input id="c2c-deposit-account" inputMode="numeric" value={form.sourceAccountNo} onChange={(event) => updateField("sourceAccountNo", event.target.value.replace(/[^0-9\s-]/g, ""))} placeholder="987-6-54321-0" aria-invalid={Boolean(fieldErrors.sourceAccountNo)} /><small className={fieldErrors.sourceAccountNo ? "field-error" : ""}>{fieldErrors.sourceAccountNo || "เลขบัญชี 10–15 หลัก"}</small></label>
            <div className="deposit-field-grid">
              <label htmlFor="c2c-deposit-ttl"><span>เวลารอจับคู่</span><div className="select-wrap"><select id="c2c-deposit-ttl" value={form.matchTtlSeconds} onChange={(event) => updateField("matchTtlSeconds", Number(event.target.value) as C2CMatchTtlSeconds)}><option value={300}>5 นาที</option><option value={600}>10 นาที</option><option value={900}>15 นาที</option><option value={1200}>20 นาที</option></select><ChevronDown size={17} /></div><small>เมื่อหมดเวลาต้องสร้างรายการใหม่</small></label>
              <label htmlFor="c2c-deposit-reference"><span>Reference ID</span><input id="c2c-deposit-reference" value={form.referenceId} onChange={(event) => updateField("referenceId", event.target.value)} aria-invalid={Boolean(fieldErrors.referenceId)} /><small className={fieldErrors.referenceId ? "field-error" : ""}>{fieldErrors.referenceId || "ห้ามซ้ำ ใช้ตรวจสถานะแทน orderId ได้"}</small></label>
            </div>
            <div className="inline-notice"><ShieldCheck size={18} /><span><strong>หนึ่งคำขอคือหนึ่งรายการ</strong> ระบบจะไม่ส่ง splitMode หรือแบ่งยอด และจะไม่สร้างซ้ำเมื่อกำลังรอคู่</span></div>
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions"><button type="button" className="button secondary-button" onClick={requestClose}>ยกเลิก</button><button type="submit" className="button deposit-button">ตรวจสอบข้อมูล</button></div>
          </form>
        )}

        {(phase === "review" || phase === "creating") && requestBody && (
          <div className="review-content deposit-review">
            <div className="review-amount"><span>ยอดฝาก C2C</span><strong>{currency.format(requestBody.amount)}</strong></div>
            <dl><div><dt>ลูกค้า</dt><dd>{customer.name}<small>{customer.account}</small></dd></div><div><dt>บัญชีต้นทาง</dt><dd>{requestBody.sourceAccountName}<small>{BANK_NAME_MAP[requestBody.sourceBankCode]} · {requestBody.sourceAccountNo}</small></dd></div><div><dt>เวลารอจับคู่</dt><dd>{requestBody.matchTtlSeconds ? `${requestBody.matchTtlSeconds / 60} นาที` : "ค่ากลางของระบบ"}</dd></div><div><dt>Reference ID</dt><dd>{requestBody.referenceId}</dd></div></dl>
            <div className="deposit-clarification"><Clock3 size={18} /><span><strong>การสร้างรายการยังไม่เพิ่มยอด</strong> ระบบจะเพิ่มยอดให้ลูกค้าเมื่อสถานะ C2C เป็น SUCCESS เท่านั้น</span></div>
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={() => setPhase("form")} disabled={phase === "creating"}><ArrowLeft size={16} />แก้ไขข้อมูล</button><button className="button deposit-button" type="button" onClick={() => void createDeposit()} disabled={phase === "creating"}>{phase === "creating" ? <><LoaderCircle className="spin" size={17} />กำลังสร้างรายการ…</> : "สร้างรายการและรอจับคู่"}</button></div>
          </div>
        )}

        {phase === "waiting" && deposit && (
          <div className="c2c-waiting-panel">
            <span className="state-symbol c2c-pending"><Hourglass size={27} /></span><h3>กำลังรอรายการถอนยอดเดียวกัน</h3><p>{pollMessage}</p>
            <div className="c2c-reference-strip"><span>Reference ID</span><strong>{deposit.referenceId || deposit.orderId}</strong></div>
            {deadline && <div className="c2c-deadline"><Clock3 size={16} /><span>รอจับคู่ถึง {dateTime.format(new Date(deadline))}</span></div>}
            <div className="deposit-clarification"><RefreshCcw size={18} /><span><strong>ไม่ต้องสร้างรายการใหม่</strong> หน้านี้ใช้ GET สถานะรายการเดิมซ้ำตามรอบ เพราะ callback ของ C2C จะไม่ถูกส่งซ้ำ</span></div>
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิดไว้ก่อน</button><button className="button danger-outline-button" type="button" onClick={() => void cancelDeposit()}>ยกเลิกรายการ</button></div>
          </div>
        )}

        {(phase === "ready" || phase === "uploading") && deposit && activeTransferTo && (
          <div className="deposit-transfer-content">
            <div className="transfer-status-row"><span className="pending-badge"><Check size={14} />จับคู่แล้ว · รอโอนเงิน</span><span className="withdrawal-order">{deposit.orderId}</span></div>
            <div className="transfer-amount"><span>ยอดที่ต้องโอนให้ตรงกัน</span><strong>{currency.format(deposit.amount)}</strong><button type="button" onClick={() => void copy(deposit.amount.toFixed(2), "ยอดเงิน")}><Copy size={15} />คัดลอกยอด</button></div>
            <section className="receiving-account" aria-label="บัญชีปลายทาง C2C">
              <div className="receiving-bank"><span className="bank-symbol"><Building2 size={21} /></span><div><h3>{activeTransferTo.bankName || "ธนาคารปลายทาง"}</h3><p>รหัสธนาคาร {activeTransferTo.bankCode || "—"}</p></div></div>
              <dl><div><dt>ชื่อบัญชีผู้รับ</dt><dd>{activeTransferTo.accountName || "—"}</dd></div><div><dt>เลขบัญชี</dt><dd><strong>{activeTransferTo.accountNo || "—"}</strong>{activeTransferTo.accountNo && <button type="button" aria-label="คัดลอกเลขบัญชี" onClick={() => void copy(activeTransferTo.accountNo || "", "เลขบัญชี")}><Copy size={15} /></button>}</dd></div></dl>
            </section>
            <div className="privacy-notice"><ShieldAlert size={18} /><span><strong>ข้อมูลบัญชีของบุคคลที่สาม</strong> แสดงเฉพาะในขั้นตอนโอนรายการนี้และไม่ถูกบันทึกลงรายการที่ลูกค้าคนอื่นเห็น</span></div>
            <section className="slip-upload-section"><div className="slip-upload-heading"><div><h3>แนบสลิปหลังโอน</h3><p>หนึ่งไฟล์ และไม่มี field อื่นใน multipart</p></div><UploadCloud size={20} /></div><label className={`slip-dropzone ${dragging ? "dragging" : ""} ${file ? "has-preview" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0] ?? null); }}>{previewUrl ? <><div className="slip-preview-frame"><Image src={previewUrl} alt="ตัวอย่างสลิป C2C ที่เลือก" fill unoptimized /></div><span className="slip-preview-meta"><span className="file-symbol selected"><FileImage size={19} /></span><span><strong>{file?.name}</strong><small>{selectedFileLabel}</small></span></span></> : <><span className="file-symbol"><UploadCloud size={20} /></span><strong>เลือกหรือลากรูปสลิปมาวาง</strong><small>JPEG, PNG, WEBP, HEIC · ไม่เกิน 10 MB</small></>}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /></label></section>
            {copyStatus && <p className="copy-status" role="status">{copyStatus}</p>}
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions sticky"><button className="button secondary-button" type="button" onClick={requestClose} disabled={phase === "uploading"}>ปิดไว้ก่อน</button><button className="button deposit-button" type="button" onClick={() => void uploadSlip()} disabled={!file || phase === "uploading"}>{phase === "uploading" ? <><LoaderCircle className="spin" size={17} />กำลังตรวจสลิป…</> : <><UploadCloud size={17} />ส่งสลิปตรวจ</>}</button></div>
          </div>
        )}

        {phase === "result" && (
          <div className={`deposit-result c2c-result ${c2cStatusTone(resultStatus ?? activeStatus)}`}>
            <div className="result-heading"><span className="state-symbol">{resultStatus === "SUCCESS" ? <CheckCircle2 size={28} /> : <AlertTriangle size={27} />}</span><div><h3>{c2cStatusLabel(resultStatus ?? activeStatus)}</h3><p>{c2cStatusDescription(resultStatus ?? activeStatus)}</p></div></div>
            <div className="result-amount"><span>ยอดรายการ</span><strong>{currency.format(amount)}</strong></div>
            <dl className="result-details"><div><dt>สถานะ</dt><dd>{resultStatus ?? activeStatus}</dd></div><div><dt>Order ID</dt><dd>{slipResult?.orderId ?? deposit?.orderId ?? status?.orderId}</dd></div><div><dt>ผลตรวจสลิป</dt><dd>{slipResult?.slipVerification.outcome ?? "สถานะอัปเดตจาก Celox"}</dd></div><div><dt>ฝั่งคู่รายการ</dt><dd>{slipResult?.counterparty?.transactionStatus ?? (resultStatus === "SUCCESS" ? "SUCCESS" : "ไม่เปิดเผยข้อมูล")}</dd></div></dl>
            {resultStatus === "PENDING_APPROVE" && <div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>ต้องรอเจ้าหน้าที่</strong> ชื่อหรือบัญชีบนสลิปตรงเพียงบางส่วน รายการยังไม่เพิ่มยอดจนกว่าจะสำเร็จ</span></div>}
            {retryableSlip && <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>สลิปไม่ผ่าน แต่รายการเดิมยังใช้ได้</strong> เลือกรูปใหม่แล้วแนบกับ transactionId เดิม ห้ามสร้างรายการฝากใหม่</span></div>}
            <div className="dialog-actions deposit-actions">{retryableSlip && <button className="button secondary-button" type="button" onClick={() => { setFile(null); setGlobalError(""); setPhase("ready"); }}><RefreshCcw size={16} />แนบสลิปใหม่</button>}<button className="button deposit-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div>
          </div>
        )}

        {phase === "cancelled" && (
          <div className="deposit-state-panel c2c-cancelled"><span className="state-symbol"><X size={26} /></span><h3>ยกเลิกรายการแล้ว</h3><p>รายการยังไม่ถูกจับคู่ ระบบยกเลิกแถวเดิมสำเร็จและไม่มีเงินเข้า</p><div className="state-reference"><span>รายการ</span><strong>{cancelResult?.orderId ?? deposit?.orderId}</strong></div><div className="dialog-actions deposit-actions"><button className="button deposit-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div></div>
        )}

        {phase === "error" && failure && (
          <div className="deposit-state-panel warning" role="alert"><span className="state-symbol"><AlertTriangle size={26} /></span><h3>ยังสร้างรายการฝาก C2C ไม่ได้</h3><p>{globalError}</p><div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>{failure.retryable ? "ลองใหม่ได้หลังเว้นช่วง" : "ข้อผิดพลาดนี้ไม่ควรส่งซ้ำทันที"}</strong> {failure.code === "reference_id_conflict" ? "เปลี่ยน Reference ID ก่อนสร้างรายการใหม่" : "ตรวจสาเหตุให้เรียบร้อยก่อนดำเนินการต่อ"}</span></div><div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิด</button>{failure.retryable && <button className="button deposit-button" type="button" onClick={() => void createDeposit()}><RefreshCcw size={16} />ลองรายการเดิมอีกครั้ง</button>}</div></div>
        )}

        {phase === "uncertain" && (
          <div className="deposit-state-panel uncertain" role="alert"><span className="state-symbol"><ShieldAlert size={26} /></span><h3>ผลรายการยังไม่แน่นอน</h3><p>{globalError}</p>{requestBody?.referenceId && <div className="state-reference"><span>ใช้ตรวจสถานะรายการเดิม</span><strong>{requestBody.referenceId}</strong></div>}<div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>ห้ามสร้างหรือแนบซ้ำทันที</strong> เปิดหน้า “รายการ C2C” แล้วตรวจด้วย Reference ID เดิมก่อน</span></div><div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div></div>
        )}
      </section>
    </dialog>
  );
}
