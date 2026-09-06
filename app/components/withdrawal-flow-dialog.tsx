"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Hourglass,
  LoaderCircle,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BANK_NAME_MAP, BANK_OPTIONS, isCeloxBankCode } from "@/lib/celox/banks";
import type {
  CeloxErrorCode,
  CeloxErrorResponse,
  CeloxFieldError,
  ConfirmWithdrawalResponse,
  CreateWithdrawalRequest,
  CreateWithdrawalResponse,
} from "@/lib/celox/types";
import type { Customer } from "@/lib/types";

type WithdrawalPhase =
  | "form"
  | "review"
  | "creating"
  | "create-error"
  | "create-uncertain"
  | "awaiting-confirm"
  | "confirming"
  | "confirm-error"
  | "confirm-uncertain"
  | "result";

type WithdrawalForm = {
  amount: string;
  destinationBankCode: string;
  destinationAccountName: string;
  destinationAccountNo: string;
  referenceId: string;
};

type FieldName = keyof WithdrawalForm;
type FieldErrors = Partial<Record<FieldName, string>>;

type WithdrawalFailure = {
  code: CeloxErrorCode;
  message: string;
  canRetry: boolean;
  retryAt: number | null;
};

type WithdrawalFlowDialogProps = {
  customer: Pick<Customer, "id" | "name" | "account" | "withdrawableBalance">;
  customers: Array<Pick<Customer, "id" | "name" | "account" | "withdrawableBalance">>;
  onCustomerChange: (customerId: string) => void;
  onClose: () => void;
  onCompleted?: () => void;
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

const fieldLabels: Record<FieldName, string> = {
  amount: "จำนวนเงิน",
  destinationBankCode: "ธนาคารปลายทาง",
  destinationAccountName: "ชื่อบัญชีปลายทาง",
  destinationAccountNo: "เลขบัญชีปลายทาง",
  referenceId: "เลขอ้างอิง",
};

const fieldErrorMessages: Record<string, string> = {
  required: "กรุณากรอกข้อมูลช่องนี้",
  invalid: "รูปแบบข้อมูลไม่ถูกต้อง",
  invalid_bank_code: "ไม่พบรหัสธนาคารนี้ในระบบ Celox",
  mismatch: "ข้อมูลช่องนี้ไม่ตรงกับรายการที่สร้างไว้",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseAmount(value: string) {
  const normalized = value.replaceAll(",", "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeAccountNo(value: string) {
  return value.replace(/[\s-]/g, "");
}

function validateForm(form: WithdrawalForm, withdrawableBalance: number): FieldErrors {
  const errors: FieldErrors = {};
  const amount = parseAmount(form.amount);
  if (amount === null) {
    errors.amount = "กรอกยอดมากกว่า 0 บาท และใช้ทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
  } else if (amount > withdrawableBalance) {
    errors.amount = `ลูกค้ารายนี้ถอนได้สูงสุด ${currency.format(withdrawableBalance)}`;
  }
  if (!isCeloxBankCode(form.destinationBankCode.trim())) {
    errors.destinationBankCode = "กรุณาเลือกธนาคารปลายทาง";
  }
  if (!form.destinationAccountName.trim()) {
    errors.destinationAccountName = "กรุณากรอกชื่อเจ้าของบัญชีปลายทาง";
  }
  if (!/^\d{10,15}$/.test(normalizeAccountNo(form.destinationAccountNo))) {
    errors.destinationAccountNo = "กรอกเลขบัญชี 10–15 หลัก โดยใส่ขีดหรือเว้นวรรคได้";
  }
  return errors;
}

function buildRequest(form: WithdrawalForm): CreateWithdrawalRequest | null {
  const amount = parseAmount(form.amount);
  const destinationBankCode = form.destinationBankCode.trim();
  if (amount === null || !isCeloxBankCode(destinationBankCode)) return null;
  return {
    amount,
    destinationBankCode,
    destinationAccountName: form.destinationAccountName.trim(),
    destinationAccountNo: normalizeAccountNo(form.destinationAccountNo),
    ...(form.referenceId.trim() ? { referenceId: form.referenceId.trim() } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isCeloxErrorResponse(value: unknown): value is CeloxErrorResponse {
  return isRecord(value)
    && typeof value.error === "string"
    && typeof value.code === "string"
    && typeof value.retryable === "boolean";
}

function isCreateWithdrawalResponse(
  value: unknown,
  input: CreateWithdrawalRequest,
): value is CreateWithdrawalResponse {
  if (!isRecord(value) || !isRecord(value.destinationAccount)) return false;
  const destination = value.destinationAccount;
  const validReferenceId = input.referenceId
    ? value.referenceId === input.referenceId
    : typeof value.referenceId === "string" && value.referenceId.length > 0;
  return typeof value.transactionId === "string"
    && UUID_PATTERN.test(value.transactionId)
    && typeof value.orderId === "string" && value.orderId.length > 0
    && validReferenceId
    && value.transactionStatus === "PENDING"
    && value.amount === input.amount
    && typeof destination.bankCode === "string"
    && typeof destination.bankName === "string"
    && typeof destination.accountName === "string"
    && typeof destination.accountNo === "string";
}

function isConfirmWithdrawalResponse(
  value: unknown,
  withdrawal: CreateWithdrawalResponse,
): value is ConfirmWithdrawalResponse {
  if (!isRecord(value) || !isRecord(value.callback)) return false;
  const validHttpStatus = value.callback.httpStatus === null
    || (typeof value.callback.httpStatus === "number"
      && Number.isInteger(value.callback.httpStatus)
      && value.callback.httpStatus >= 100
      && value.callback.httpStatus <= 599);
  const validOccurredAt = value.occurredAt === null
    || (typeof value.occurredAt === "string"
      && ISO_DATE_PATTERN.test(value.occurredAt)
      && Number.isFinite(Date.parse(value.occurredAt)));
  return value.transactionId === withdrawal.transactionId
    && value.orderId === withdrawal.orderId
    && value.transactionStatus === "SUCCESS"
    && value.amount === withdrawal.amount
    && validOccurredAt
    && ["SUCCESS", "FAILED", "PENDING"].includes(String(value.callback.callbackStatus))
    && validHttpStatus;
}

function useRetryCountdown(retryAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  return retryAt ? Math.max(0, retryAt - now) : 0;
}

function callbackLabel(result: ConfirmWithdrawalResponse) {
  if (result.callback.callbackStatus === "SUCCESS") {
    return `ส่ง callback สำเร็จ${result.callback.httpStatus ? ` · HTTP ${result.callback.httpStatus}` : ""}`;
  }
  if (result.callback.callbackStatus === "FAILED") {
    return `ส่ง callback ไม่สำเร็จ${result.callback.httpStatus ? ` · HTTP ${result.callback.httpStatus}` : ""}`;
  }
  return "callback กำลังรอส่ง";
}

export default function WithdrawalFlowDialog({
  customer,
  customers,
  onCustomerChange,
  onClose,
  onCompleted,
}: WithdrawalFlowDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const phaseHeadingRef = useRef<HTMLHeadingElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const hasMountedRef = useRef(false);
  const [phase, setPhase] = useState<WithdrawalPhase>("form");
  const [form, setForm] = useState<WithdrawalForm>({
    amount: "",
    destinationBankCode: "",
    destinationAccountName: customer.name,
    destinationAccountNo: "",
    referenceId: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState("");
  const [createdPayload, setCreatedPayload] = useState<CreateWithdrawalRequest | null>(null);
  const [withdrawal, setWithdrawal] = useState<CreateWithdrawalResponse | null>(null);
  const [result, setResult] = useState<ConfirmWithdrawalResponse | null>(null);
  const [failure, setFailure] = useState<WithdrawalFailure | null>(null);
  const [apiToast, setApiToast] = useState("");
  const requestBody = useMemo(() => buildRequest(form), [form]);
  const retryIn = useRetryCountdown(failure?.retryAt ?? null);
  const busy = phase === "creating" || phase === "confirming";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    window.setTimeout(() => phaseHeadingRef.current?.focus(), 0);
  }, [phase]);

  useEffect(() => {
    if (!busy) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [busy]);

  function showApiToast(message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setApiToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setApiToast("");
      toastTimerRef.current = null;
    }, 4_500);
  }

  function updateField(field: FieldName, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setGlobalError("");
  }

  function changeCustomer(customerId: string) {
    const nextCustomer = customers.find((item) => item.id === customerId);
    const shouldSyncName = !form.destinationAccountName.trim()
      || form.destinationAccountName === customer.name;
    onCustomerChange(customerId);
    if (nextCustomer && shouldSyncName) {
      updateField("destinationAccountName", nextCustomer.name);
    }
    setFieldErrors((current) => ({ ...current, amount: undefined }));
  }

  function requestClose() {
    if (busy) return;
    const pending = withdrawal && !result && phase !== "confirm-uncertain";
    if (pending && !window.confirm("รายการถอนถูกสร้างในสถานะ PENDING แล้ว หากปิดตอนนี้ต้องกลับไปตรวจสอบรายการใน Celox ก่อนยืนยัน ต้องการปิดหรือไม่?")) return;
    dialogRef.current?.close();
    onClose();
  }

  function handleReview(event: FormEvent) {
    event.preventDefault();
    const errors = validateForm(form, customer.withdrawableBalance);
    setFieldErrors(errors);
    setGlobalError("");
    if (Object.keys(errors).length > 0) {
      const firstError = Object.keys(errors)[0] as FieldName;
      document.getElementById(`withdrawal-${firstError}`)?.focus();
      return;
    }
    setPhase("review");
  }

  function applyServerFieldErrors(errors?: CeloxFieldError[]) {
    if (!errors?.length) return false;
    const mapped: FieldErrors = {};
    errors.forEach((item) => {
      if (item.field in fieldLabels) {
        const field = item.field as FieldName;
        mapped[field] = fieldErrorMessages[item.code] ?? `${fieldLabels[field]}ไม่ถูกต้อง`;
      }
    });
    if (Object.keys(mapped).length === 0) return false;
    setFieldErrors(mapped);
    setPhase("form");
    window.setTimeout(() => {
      const firstError = Object.keys(mapped)[0];
      if (firstError) document.getElementById(`withdrawal-${firstError}`)?.focus();
    }, 0);
    return true;
  }

  async function createWithdrawal() {
    if (!requestBody || phase === "creating" || retryIn > 0) return;
    setPhase("creating");
    setFailure(null);
    setGlobalError("");
    try {
      const response = await fetch("/api/celox/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, ...requestBody }),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const error = isCeloxErrorResponse(payload)
          ? payload
          : { error: "สร้างรายการถอนไม่สำเร็จ", code: "upstream_error" as CeloxErrorCode, retryable: false };
        showApiToast(error.error);
        if (applyServerFieldErrors(error.fieldErrors)) return;
        if (error.code === "reference_id_conflict") {
          setFieldErrors({ referenceId: error.error });
          setPhase("form");
          window.setTimeout(() => document.getElementById("withdrawal-referenceId")?.focus(), 0);
          return;
        }
        setGlobalError(error.error);
        if (["network_error", "request_timeout", "upstream_error", "invalid_response", "persistence_error"].includes(error.code)) {
          setPhase("create-uncertain");
        } else {
          const canRetry = error.code === "rate_limited" && error.retryable;
          setFailure({
            code: error.code,
            message: error.error,
            canRetry,
            retryAt: canRetry ? Date.now() + Math.max(1, error.retryAfterSeconds ?? 1) * 1_000 : null,
          });
          setPhase("create-error");
        }
        return;
      }
      if (!isCreateWithdrawalResponse(payload, requestBody)) {
        const message = "Celox สร้างรายการถอนแล้ว แต่อ่านผลตอบกลับไม่ได้ ห้ามสร้างซ้ำจนกว่าจะตรวจสอบสถานะ";
        setGlobalError(message);
        showApiToast(message);
        setPhase("create-uncertain");
        return;
      }
      setCreatedPayload({
        ...requestBody,
        ...(payload.referenceId ? { referenceId: payload.referenceId } : {}),
      });
      setWithdrawal(payload);
      setPhase("awaiting-confirm");
      onCompleted?.();
    } catch {
      const message = "การเชื่อมต่อขาดหายและไม่ทราบว่ารายการถอนถูกสร้างหรือไม่ ห้ามกดสร้างซ้ำจนกว่าจะตรวจสอบกับ Celox";
      setGlobalError(message);
      showApiToast(message);
      setPhase("create-uncertain");
    }
  }

  async function confirmCreatedWithdrawal() {
    if (!withdrawal || !createdPayload || phase === "confirming" || retryIn > 0) return;
    setPhase("confirming");
    setFailure(null);
    setGlobalError("");
    try {
      const response = await fetch(`/api/celox/withdrawals/${encodeURIComponent(withdrawal.transactionId)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createdPayload),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const error = isCeloxErrorResponse(payload)
          ? payload
          : { error: "ยืนยันรายการถอนไม่สำเร็จ", code: "upstream_error" as CeloxErrorCode, retryable: false };
        const mismatchFields = error.code === "withdrawal_payload_mismatch"
          ? error.fieldErrors?.map((item) => fieldLabels[item.field as FieldName] ?? item.field).join(", ")
          : "";
        const errorMessage = mismatchFields
          ? `${error.error}: ${mismatchFields}`
          : error.error;
        showApiToast(errorMessage);
        setGlobalError(errorMessage);
        if (["network_error", "request_timeout", "upstream_error", "invalid_response", "persistence_error", "invalid_transaction_state"].includes(error.code)) {
          setPhase("confirm-uncertain");
        } else {
          const canRetry = (error.code === "rate_limited" && error.retryable)
            || error.code === "insufficient_balance";
          setFailure({
            code: error.code,
            message: errorMessage,
            canRetry,
            retryAt: error.code === "rate_limited"
              ? Date.now() + Math.max(1, error.retryAfterSeconds ?? 1) * 1_000
              : null,
          });
          setPhase("confirm-error");
        }
        return;
      }
      if (!isConfirmWithdrawalResponse(payload, withdrawal)) {
        const message = "Celox อาจยืนยันการถอนแล้ว แต่อ่านผลตอบกลับไม่ได้ ห้ามยืนยันซ้ำจนกว่าจะตรวจสอบสถานะหรือ callback";
        setGlobalError(message);
        showApiToast(message);
        setPhase("confirm-uncertain");
        return;
      }
      setResult(payload);
      setPhase("result");
      onCompleted?.();
    } catch {
      const message = "การเชื่อมต่อขาดหายระหว่างยืนยันการถอน จึงไม่ทราบว่าเงินถูกจ่ายแล้วหรือไม่ ห้ามยืนยันซ้ำจนกว่าจะตรวจสอบสถานะหรือ callback";
      setGlobalError(message);
      showApiToast(message);
      setPhase("confirm-uncertain");
    }
  }

  const step = ["form", "review", "creating", "create-error", "create-uncertain"].includes(phase)
    ? 1
    : phase === "result" ? 3 : 2;
  const title = step === 1
    ? phase === "review" || phase === "creating" ? "ตรวจสอบรายการถอน" : "สร้างรายการถอน"
    : step === 2 ? "ยืนยันการจ่ายเงิน" : "ผลรายการถอน";
  const subtitle = withdrawal
    ? `${withdrawal.orderId} · ${currency.format(withdrawal.amount)}`
    : `${customer.name} · ${customer.account}`;
  const phaseAnnouncement = phase === "creating"
    ? "กำลังสร้างรายการถอนกับ Celox"
    : phase === "awaiting-confirm"
      ? "สร้างรายการถอนแล้ว อยู่ในสถานะรอยืนยัน"
      : phase === "confirming"
        ? "กำลังยืนยันรายการถอนและจ่ายเงิน กรุณาอย่าปิดหน้าต่าง"
        : phase === "result"
          ? "ถอนเงินสำเร็จ"
          : phase.includes("uncertain")
            ? "ยังยืนยันผลรายการไม่ได้ ห้ามส่งคำขอซ้ำ"
            : failure?.message ?? "";

  return (
    <dialog
      ref={dialogRef}
      className="deposit-dialog-layer"
      aria-labelledby="withdrawal-dialog-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          requestClose();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{phaseAnnouncement}</p>
      <section className="transaction-dialog celox-deposit-dialog celox-withdrawal-dialog" aria-busy={busy}>
        <header className="dialog-header deposit-dialog-header">
          <div>
            <span className="dialog-icon withdraw"><ArrowUpRight size={20} /></span>
            <div><h2 ref={phaseHeadingRef} id="withdrawal-dialog-title" tabIndex={-1}>{title}</h2><p>{subtitle}</p></div>
          </div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="ปิด" disabled={busy}><X size={20} /></button>
        </header>

        <ol className="deposit-steps withdrawal-steps" aria-label="ขั้นตอนการถอนเงิน">
          {["ข้อมูลปลายทาง", "ยืนยันจ่ายเงิน", "ผลรายการ"].map((label, index) => {
            const itemStep = index + 1;
            return <li key={label} className={itemStep === step ? "active" : itemStep < step ? "complete" : ""} aria-current={itemStep === step ? "step" : undefined}><span>{itemStep < step ? <Check size={13} /> : itemStep}</span>{label}</li>;
          })}
        </ol>

        {phase === "form" && (
          <form className="transaction-form deposit-form" onSubmit={handleReview} noValidate>
            <label htmlFor="withdrawal-customer"><span>ลูกค้าในระบบ</span><div className="select-wrap"><select id="withdrawal-customer" value={customer.id} onChange={(event) => changeCustomer(event.target.value)}>{customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.account} · ถอนได้ {currency.format(item.withdrawableBalance)}</option>)}</select><ChevronDown size={17} /></div><small>ใช้รักษาบริบทในระบบ mobile-store และจะไม่ถูกส่งไปกับคำขอ Celox</small></label>
            <div className="deposit-field-grid">
              <label htmlFor="withdrawal-amount"><span>จำนวนเงิน</span><div className={`money-input ${fieldErrors.amount ? "invalid" : ""}`}><span>฿</span><input ref={firstFieldRef} id="withdrawal-amount" inputMode="decimal" value={form.amount} onChange={(event) => updateField("amount", event.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" aria-invalid={Boolean(fieldErrors.amount)} aria-describedby="withdrawal-amount-help" /></div><small id="withdrawal-amount-help" className={fieldErrors.amount ? "field-error" : ""}>{fieldErrors.amount || `ถอนได้สูงสุด ${currency.format(customer.withdrawableBalance)}`}</small></label>
              <label htmlFor="withdrawal-destinationBankCode"><span>ธนาคารปลายทาง</span><div className={`select-wrap ${fieldErrors.destinationBankCode ? "invalid" : ""}`}><select id="withdrawal-destinationBankCode" value={form.destinationBankCode} onChange={(event) => updateField("destinationBankCode", event.target.value)} aria-invalid={Boolean(fieldErrors.destinationBankCode)} aria-describedby="withdrawal-destinationBankCode-help"><option value="" disabled>เลือกธนาคารปลายทาง</option>{BANK_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}</select><ChevronDown size={17} /></div><small id="withdrawal-destinationBankCode-help" className={fieldErrors.destinationBankCode ? "field-error" : ""}>{fieldErrors.destinationBankCode || "เลือกธนาคารที่จะรับเงิน"}</small></label>
            </div>
            <label htmlFor="withdrawal-destinationAccountName"><span>ชื่อบัญชีปลายทาง</span><input id="withdrawal-destinationAccountName" value={form.destinationAccountName} onChange={(event) => updateField("destinationAccountName", event.target.value)} placeholder="ชื่อเจ้าของบัญชีผู้รับ" autoComplete="name" aria-invalid={Boolean(fieldErrors.destinationAccountName)} aria-describedby="withdrawal-destinationAccountName-help" /><small id="withdrawal-destinationAccountName-help" className={fieldErrors.destinationAccountName ? "field-error" : ""}>{fieldErrors.destinationAccountName || "ตรวจให้ตรงกับชื่อบัญชีธนาคารปลายทาง"}</small></label>
            <label htmlFor="withdrawal-destinationAccountNo"><span>เลขบัญชีปลายทาง</span><input id="withdrawal-destinationAccountNo" inputMode="numeric" value={form.destinationAccountNo} onChange={(event) => updateField("destinationAccountNo", event.target.value.replace(/[^0-9\s-]/g, ""))} placeholder="111-2-23333-4" autoComplete="off" aria-invalid={Boolean(fieldErrors.destinationAccountNo)} aria-describedby="withdrawal-destinationAccountNo-help" /><small id="withdrawal-destinationAccountNo-help" className={fieldErrors.destinationAccountNo ? "field-error" : ""}>{fieldErrors.destinationAccountNo || "เลขบัญชี 10–15 หลัก ระบบจะตัดขีดและช่องว่างก่อนส่ง"}</small></label>
            <label htmlFor="withdrawal-referenceId"><span>เลขอ้างอิงของคุณ <em>(ไม่บังคับ)</em></span><input id="withdrawal-referenceId" value={form.referenceId} onChange={(event) => updateField("referenceId", event.target.value)} placeholder="เช่น PAYOUT-9001" autoComplete="off" aria-invalid={Boolean(fieldErrors.referenceId)} aria-describedby="withdrawal-referenceId-help" /><small id="withdrawal-referenceId-help" className={fieldErrors.referenceId ? "field-error" : ""}>{fieldErrors.referenceId || "ต้องไม่ซ้ำภายในองค์กร และจะถูกส่งซ้ำตอนยืนยันหากระบุ"}</small></label>
            <div className="inline-notice"><ShieldCheck size={18} /><span><strong>ตรวจสอบบัญชีผู้รับให้ครบถ้วน</strong> ขั้นยืนยันจะใช้ข้อมูลชุดเดิมทั้งหมดและจ่ายเงินจริงผ่าน Celox</span></div>
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions"><button type="button" className="button secondary-button" onClick={requestClose}>ยกเลิก</button><button type="submit" className="button withdraw-button">ตรวจสอบข้อมูล</button></div>
          </form>
        )}

        {(phase === "review" || phase === "creating") && requestBody && (
          <div className="review-content deposit-review">
            <div className="review-amount"><span>ยอดถอนที่ต้องการสร้าง</span><strong>{currency.format(requestBody.amount)}</strong></div>
            <dl>
              <div><dt>ลูกค้าในระบบ</dt><dd>{customer.name}<small>{customer.account}</small></dd></div>
              <div><dt>บัญชีปลายทาง</dt><dd>{requestBody.destinationAccountName}<small>{BANK_NAME_MAP[requestBody.destinationBankCode]} ({requestBody.destinationBankCode}) · {requestBody.destinationAccountNo}</small></dd></div>
              <div><dt>เลขอ้างอิง</dt><dd>{requestBody.referenceId || "ไม่ได้ระบุ"}</dd></div>
            </dl>
            <div className="deposit-clarification"><Clock3 size={18} /><span><strong>ขั้นตอนนี้ยังไม่ตัดเงิน</strong> Celox จะสร้างรายการสถานะ PENDING ก่อน และรอการยืนยันอีกครั้ง</span></div>
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={() => setPhase("form")} disabled={phase === "creating"}><ArrowLeft size={16} />แก้ไขข้อมูล</button><button className="button withdraw-button" type="button" onClick={() => void createWithdrawal()} disabled={phase === "creating"}>{phase === "creating" ? <><LoaderCircle className="spin" size={17} />กำลังสร้างรายการ…</> : "สร้างรายการรอยืนยัน"}</button></div>
          </div>
        )}

        {phase === "create-uncertain" && (
          <div className="deposit-state-panel uncertain" role="alert">
            <span className="state-symbol"><ShieldAlert size={26} /></span><h3>ยังยืนยันผลการสร้างรายการไม่ได้</h3><p>{globalError}</p>
            {requestBody?.referenceId && <div className="state-reference"><span>เลขอ้างอิงที่ใช้</span><strong>{requestBody.referenceId}</strong></div>}
            <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>อย่ากดสร้างซ้ำ</strong> คำขออาจสร้างรายการ PENDING ไปแล้ว และ referenceId conflict ไม่คืนผลรายการเดิม</span></div>
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div>
          </div>
        )}

        {phase === "create-error" && failure && (
          <div className={`deposit-state-panel ${failure.canRetry ? "warning" : "uncertain"}`} role="alert">
            <span className="state-symbol">{failure.canRetry ? <Hourglass size={26} /> : <ShieldAlert size={26} />}</span><h3>{failure.canRetry ? "ระบบจำกัดจำนวนคำขอชั่วคราว" : "Celox ยังสร้างรายการให้ไม่ได้"}</h3><p>{failure.message}</p>
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button>{failure.canRetry && <button className="button withdraw-button" type="button" onClick={() => void createWithdrawal()} disabled={retryIn > 0}><RefreshCcw size={16} />{retryIn > 0 ? `ลองใหม่ได้ใน ${Math.ceil(retryIn / 1_000)} วินาที` : "ลองสร้างอีกครั้ง"}</button>}</div>
          </div>
        )}

        {(phase === "awaiting-confirm" || phase === "confirming") && withdrawal && createdPayload && (
          <div className="deposit-transfer-content withdrawal-confirm-content">
            <div className="transfer-status-row"><span className="pending-badge"><Hourglass size={14} />PENDING · กันยอดที่ถอนได้แล้ว</span><span className="withdrawal-order">{withdrawal.orderId}</span></div>
            <div className="transfer-amount"><span>ยอดที่จะจ่ายออกเมื่อยืนยัน</span><strong>{currency.format(withdrawal.amount)}</strong></div>
            <section className="receiving-account" aria-labelledby="withdrawal-destination-title">
              <div className="receiving-bank"><span className="bank-symbol"><Building2 size={21} /></span><div><h3 id="withdrawal-destination-title">{withdrawal.destinationAccount.bankName}</h3><p>รหัสธนาคาร {withdrawal.destinationAccount.bankCode}</p></div></div>
              <dl><div><dt>ชื่อบัญชีผู้รับ</dt><dd>{withdrawal.destinationAccount.accountName}</dd></div><div><dt>เลขบัญชี</dt><dd><strong>{withdrawal.destinationAccount.accountNo}</strong></dd></div><div><dt>Reference ID</dt><dd>{withdrawal.referenceId || "—"}</dd></div><div><dt>Transaction ID</dt><dd>{withdrawal.transactionId}</dd></div></dl>
            </section>
            <div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>การยืนยันนี้จ่ายเงินจริง</strong> ระบบจะส่ง payload ชุดเดิมแบบ field-for-field โดยไม่มีรหัส 2FA หรือ X-Step-Up</span></div>
            <div className="dialog-actions deposit-actions sticky"><button className="button secondary-button" type="button" onClick={requestClose} disabled={phase === "confirming"}>ปิดไว้ก่อน</button><button className="button withdrawal-confirm-button" type="button" onClick={() => void confirmCreatedWithdrawal()} disabled={phase === "confirming"}>{phase === "confirming" ? <><LoaderCircle className="spin" size={17} />กำลังยืนยันและจ่ายเงิน…</> : <><ShieldCheck size={17} />ยืนยันและจ่ายเงิน</>}</button></div>
          </div>
        )}

        {phase === "confirm-error" && withdrawal && failure && (
          <div className={`deposit-state-panel ${failure.canRetry ? "warning" : "uncertain"}`} role="alert">
            <span className="state-symbol">{failure.canRetry ? <AlertTriangle size={26} /> : <ShieldAlert size={26} />}</span><h3>{failure.code === "insufficient_balance" ? "ยอดกระเป๋า Celox ไม่เพียงพอ" : failure.canRetry ? "ยังยืนยันรายการไม่ได้" : "Celox ปฏิเสธการยืนยัน"}</h3><p>{failure.message}</p>
            <div className="state-reference"><span>รายการ</span><strong>{withdrawal.orderId}</strong></div>
            <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>ไม่มีการลองซ้ำอัตโนมัติ</strong> {failure.code === "insufficient_balance" ? "เติมยอดหรือปลดรายการจองอื่นก่อน แล้วจึงกดลองยืนยันรายการเดิมด้วยตัวเอง" : "ตรวจสอบสาเหตุให้เรียบร้อยก่อนดำเนินการต่อ"}</span></div>
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button>{failure.canRetry && <button className="button withdraw-button" type="button" onClick={() => void confirmCreatedWithdrawal()} disabled={retryIn > 0}><RefreshCcw size={16} />{retryIn > 0 ? `ลองใหม่ได้ใน ${Math.ceil(retryIn / 1_000)} วินาที` : "ลองยืนยันรายการเดิม"}</button>}</div>
          </div>
        )}

        {phase === "confirm-uncertain" && withdrawal && (
          <div className="deposit-state-panel uncertain" role="alert">
            <span className="state-symbol"><ShieldAlert size={26} /></span><h3>ยังยืนยันไม่ได้ว่าเงินถูกจ่ายหรือไม่</h3><p>{globalError}</p>
            <div className="state-reference"><span>รายการที่ต้องตรวจสอบ</span><strong>{withdrawal.orderId}</strong></div>
            <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>ห้ามกดยืนยันซ้ำ</strong> ตรวจสอบ callback หรือสถานะรายการใน Celox ก่อน เพราะคำขอเดิมอาจตัดเงินสำเร็จแล้ว</span></div>
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div>
          </div>
        )}

        {phase === "result" && result && withdrawal && (
          <div className="deposit-result success withdrawal-result">
            <div className="result-heading"><span className="state-symbol"><CheckCircle2 size={28} /></span><div><h3>ถอนเงินสำเร็จ</h3><p>Celox ยืนยันรายการและจ่ายเงินออกจากกระเป๋าแล้ว</p></div></div>
            <div className="result-amount"><span>ยอดที่จ่ายจริง</span><strong>{currency.format(result.amount)}</strong></div>
            <dl className="result-details"><div><dt>สถานะรายการ</dt><dd>{result.transactionStatus}</dd></div><div><dt>ธนาคารปลายทาง</dt><dd>{withdrawal.destinationAccount.bankName}</dd></div><div><dt>บัญชีผู้รับ</dt><dd>{withdrawal.destinationAccount.accountName} · {withdrawal.destinationAccount.accountNo}</dd></div><div><dt>เวลาสำเร็จ</dt><dd>{result.occurredAt ? dateTime.format(new Date(result.occurredAt)) : "Celox ไม่ได้ระบุเวลา"}</dd></div><div><dt>Callback</dt><dd className={`callback-${result.callback.callbackStatus.toLowerCase()}`}>{callbackLabel(result)}</dd></div><div><dt>Order ID</dt><dd>{result.orderId}</dd></div></dl>
            {result.callback.callbackStatus === "FAILED" && <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>การถอนกับ callback เป็นคนละสถานะ</strong> เงินถูกจ่ายแล้วแม้ปลายทาง callback ตอบไม่สำเร็จ</span></div>}
            <div className="dialog-actions deposit-actions"><button className="button withdraw-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div>
          </div>
        )}
      </section>
      {apiToast && <div className="toast deposit-api-toast" role="alert"><span><AlertTriangle size={16} /></span>{apiToast}</div>}
    </dialog>
  );
}
