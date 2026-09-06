"use client";

import Image from "next/image";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  Clipboard,
  Clock3,
  FileImage,
  Hourglass,
  ImageUp,
  LoaderCircle,
  RefreshCcw,
  ShieldAlert,
  UploadCloud,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Customer } from "@/lib/types";
import { BANK_NAME_MAP, BANK_OPTIONS, isCeloxBankCode } from "@/lib/celox/banks";
import { isDepositSlipResponse } from "@/lib/celox/deposit-validation";
import type {
  CeloxErrorCode,
  CeloxErrorResponse,
  CeloxFieldError,
  CreateDepositRequest,
  CreateDepositResponse,
} from "@/lib/celox/types";

type DepositPhase =
  | "form"
  | "review"
  | "creating"
  | "create-error"
  | "awaiting-slip"
  | "uploading"
  | "create-uncertain"
  | "slip-error";

type DepositForm = {
  amount: string;
  sourceBankCode: string;
  sourceAccountName: string;
  sourceAccountNo: string;
  referenceId: string;
};

type FieldName = keyof DepositForm | "file";
type FieldErrors = Partial<Record<FieldName, string>>;

type SlipError = {
  code: CeloxErrorCode;
  message: string;
  canRetry: boolean;
  retryAt: number | null;
};

type CreateFailure = {
  code: CeloxErrorCode;
  message: string;
  canRetry: boolean;
  retryAt: number | null;
};

type DepositFlowDialogProps = {
  customer: Pick<Customer, "id" | "name" | "account">;
  customers: Array<Pick<Customer, "id" | "name" | "account">>;
  onCustomerChange: (customerId: string) => void;
  onClose: () => void;
  onChanged?: () => void;
  onCompleted: () => void;
};

const currency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
});

const fieldLabels: Record<Exclude<FieldName, "file">, string> = {
  amount: "จำนวนเงิน",
  sourceBankCode: "รหัสธนาคารต้นทาง",
  sourceAccountName: "ชื่อบัญชีต้นทาง",
  sourceAccountNo: "เลขบัญชีต้นทาง",
  referenceId: "เลขอ้างอิง",
};

const fieldErrorMessages: Record<string, string> = {
  required: "กรุณากรอกข้อมูลช่องนี้",
  invalid: "รูปแบบข้อมูลไม่ถูกต้อง",
  invalid_bank_code: "ไม่พบรหัสธนาคารนี้ในระบบ Celox",
};

const slipErrorMessages: Partial<Record<CeloxErrorCode, string>> = {
  unauthenticated: "ลิงก์อัปโหลดไม่ถูกต้องหรือหมดอายุแล้ว กรุณาสร้างรายการฝากใหม่",
  not_found: "ไม่พบรายการฝากนี้ในบัญชี Celox",
  file_required: "กรุณาเลือกไฟล์รูปสลิป",
  file_invalid: "ไฟล์นี้ไม่ใช่รูปสลิปที่ Celox รองรับ กรุณาเลือกไฟล์ใหม่",
  deposit_expired: "รายการฝากหมดอายุแล้ว ไม่สามารถแนบสลิปได้",
  deposit_not_awaiting_transfer: "รายการนี้ไม่ได้อยู่ในสถานะรอแนบสลิป จึงไม่สามารถอัปโหลดได้",
  slip_already_submitted: "รายการนี้เคยแนบสลิปแล้ว ระบบจะไม่ส่งไฟล์ซ้ำ",
  slip_verification_failed: "ผู้ให้บริการตรวจสลิปไม่สำเร็จ กรุณาตรวจสอบสถานะรายการก่อนดำเนินการต่อ",
  rate_limited: "มีการอัปโหลดถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง",
  request_timeout: "Celox ไม่ตอบกลับภายในเวลาที่กำหนด จึงยังยืนยันผลการส่งสลิปไม่ได้",
  network_error: "เชื่อมต่อ Celox ไม่สำเร็จ จึงยังยืนยันผลการส่งสลิปไม่ได้",
  persistence_error: "Celox ตอบผลแล้ว แต่ระบบบันทึก transaction ไม่สำเร็จ ต้องตรวจสอบก่อนทำรายการต่อ",
  upstream_error: "Celox ไม่สามารถรับสลิปได้ในขณะนี้",
  invalid_response: "Celox รับสลิปแล้วแต่ส่งผลตอบกลับที่อ่านไม่ได้ กรุณาตรวจสอบสถานะก่อนส่งซ้ำ",
};

const retryableSlipCodes = new Set<CeloxErrorCode>(["file_required", "file_invalid", "rate_limited"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAmount(value: string) {
  const normalized = value.replaceAll(",", "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount)
    && amount > 0
    && Number.isSafeInteger(Math.round(amount * 100))
    ? amount
    : null;
}

function normalizeAccountNo(value: string) {
  return value.replace(/[\s-]/g, "");
}

function validateForm(form: DepositForm): FieldErrors {
  const errors: FieldErrors = {};
  const amount = parseAmount(form.amount);
  if (amount === null) errors.amount = "กรอกยอดมากกว่า 0 บาท และใช้ทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
  if (!isCeloxBankCode(form.sourceBankCode.trim())) {
    errors.sourceBankCode = "กรุณาเลือกธนาคารต้นทาง";
  }
  if (!form.sourceAccountName.trim()) errors.sourceAccountName = "กรุณากรอกชื่อเจ้าของบัญชีต้นทาง";
  if (!/^\d+$/.test(normalizeAccountNo(form.sourceAccountNo))) {
    errors.sourceAccountNo = "กรอกเลขบัญชีเป็นตัวเลข โดยใส่ขีดหรือเว้นวรรคได้";
  }
  return errors;
}

function buildRequest(form: DepositForm): CreateDepositRequest | null {
  const amount = parseAmount(form.amount);
  const sourceBankCode = form.sourceBankCode.trim();
  if (amount === null || !isCeloxBankCode(sourceBankCode)) return null;
  return {
    amount,
    sourceBankCode,
    sourceAccountName: form.sourceAccountName.trim(),
    sourceAccountNo: normalizeAccountNo(form.sourceAccountNo),
    ...(form.referenceId.trim() ? { referenceId: form.referenceId.trim() } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function normalizeErrorCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function parseSlipError(response: Response, payload: unknown): SlipError {
  let code = "";
  if (isRecord(payload)) {
    code = normalizeErrorCode(payload.code)
      || normalizeErrorCode(payload.error)
      || (isRecord(payload.error) ? normalizeErrorCode(payload.error.code) : "");
    if (!code && Array.isArray(payload.errors)) {
      const first = payload.errors.find(isRecord);
      const field = first ? normalizeErrorCode(first.field) : "";
      const fieldCode = first ? normalizeErrorCode(first.code) : "";
      if (field === "file" && fieldCode) code = `file_${fieldCode}`;
    }
  }

  if (response.status === 401) code = "unauthenticated";
  else if (response.status === 404) code = "not_found";
  else if (response.status === 429) code = "rate_limited";
  else if (response.status === 422 && !code) code = "slip_verification_failed";

  const typedCode = (code || "upstream_error") as CeloxErrorCode;
  const retryAfterHeader = response.headers.get("retry-after")?.trim() ?? "";
  const retryAfterNumber = Number(retryAfterHeader);
  const retryAfterDate = Date.parse(retryAfterHeader);
  const retrySeconds = Number.isFinite(retryAfterNumber) && retryAfterNumber > 0
    ? retryAfterNumber
    : Number.isFinite(retryAfterDate)
      ? Math.max(1, Math.ceil((retryAfterDate - Date.now()) / 1000))
      : 1;
  return {
    code: typedCode,
    message: slipErrorMessages[typedCode] ?? "Celox ไม่สามารถรับสลิปได้ กรุณาตรวจสอบสถานะก่อนลองอีกครั้ง",
    canRetry: retryableSlipCodes.has(typedCode),
    retryAt: typedCode === "rate_limited" ? Date.now() + retrySeconds * 1000 : null,
  };
}

function validateUploadUrl(
  uploadUrl: string,
  transactionId: string,
  allowedOrigin: string,
  allowedPathPrefix: string,
) {
  try {
    const url = new URL(uploadUrl);
    return UUID_PATTERN.test(transactionId)
      && url.origin === allowedOrigin
      && !url.username
      && !url.password
      && url.pathname === `${allowedPathPrefix}/${transactionId}/slip`
      && Boolean(url.searchParams.get("uploadToken")?.trim())
      && url.searchParams.size === 1
      && !url.hash;
  } catch {
    return false;
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useRemainingTime(expiresAt?: string, retryAt?: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt && !retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, retryAt]);

  const expiresIn = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - now) : 0;
  const retryIn = retryAt ? Math.max(0, retryAt - now) : 0;
  return { expiresIn, retryIn };
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`
    : `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export default function DepositFlowDialog({ customer, customers, onCustomerChange, onClose, onChanged, onCompleted }: DepositFlowDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const phaseHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasMountedRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const filePreviewUrlRef = useRef("");
  const [phase, setPhase] = useState<DepositPhase>("form");
  const [form, setForm] = useState<DepositForm>({
    amount: "",
    sourceBankCode: "",
    sourceAccountName: customer.name,
    sourceAccountNo: "",
    referenceId: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState("");
  const [deposit, setDeposit] = useState<CreateDepositResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [createFailure, setCreateFailure] = useState<CreateFailure | null>(null);
  const [slipError, setSlipError] = useState<SlipError | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [apiToast, setApiToast] = useState("");
  const { expiresIn, retryIn } = useRemainingTime(deposit?.expiresAt, slipError?.retryAt ?? createFailure?.retryAt);
  const requestBody = useMemo(() => buildRequest(form), [form]);
  const depositExpired = Boolean(deposit && expiresIn === 0);

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
      if (filePreviewUrlRef.current) URL.revokeObjectURL(filePreviewUrlRef.current);
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

  function showApiToast(message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setApiToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setApiToast("");
      toastTimerRef.current = null;
    }, 4_500);
  }

  useEffect(() => {
    if (phase !== "creating" && phase !== "uploading") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [phase]);

  function updateField(field: keyof DepositForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setGlobalError("");
  }

  function changeCustomer(customerId: string) {
    const nextCustomer = customers.find((item) => item.id === customerId);
    const shouldSyncAccountName = !form.sourceAccountName.trim() || form.sourceAccountName === customer.name;
    onCustomerChange(customerId);
    if (nextCustomer && shouldSyncAccountName) updateField("sourceAccountName", nextCustomer.name);
  }

  function requestClose() {
    if (phase === "creating" || phase === "uploading") return;
    const unfinished = deposit && phase !== "create-uncertain";
    if (unfinished && !window.confirm("รายการฝากถูกสร้างแล้ว หากปิดตอนนี้ลิงก์แนบสลิปจะหายจากหน้าจอ ต้องการปิดหรือไม่?")) return;
    dialogRef.current?.close();
    onClose();
  }

  function handleReview(event: FormEvent) {
    event.preventDefault();
    const errors = validateForm(form);
    setFieldErrors(errors);
    setGlobalError("");
    if (Object.keys(errors).length) {
      const firstError = Object.keys(errors)[0] as keyof DepositForm;
      document.getElementById(`deposit-${firstError}`)?.focus();
      return;
    }
    setPhase("review");
  }

  function applyServerFieldErrors(errors?: CeloxFieldError[]) {
    if (!errors?.length) return false;
    const mapped: FieldErrors = {};
    errors.forEach((item) => {
      if (item.field in fieldLabels) {
        mapped[item.field as keyof DepositForm] = fieldErrorMessages[item.code] ?? `${fieldLabels[item.field as keyof DepositForm]}ไม่ถูกต้อง`;
      }
    });
    setFieldErrors(mapped);
    setPhase("form");
    window.setTimeout(() => {
      const firstError = Object.keys(mapped)[0];
      if (firstError) document.getElementById(`deposit-${firstError}`)?.focus();
    }, 0);
    return Object.keys(mapped).length > 0;
  }

  async function createDeposit() {
    if (!requestBody || phase === "creating") return;
    setPhase("creating");
    setCreateFailure(null);
    setGlobalError("");
    try {
      const response = await fetch("/api/celox/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody, customerId: customer.id }),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const error = isCeloxErrorResponse(payload)
          ? payload
          : { error: "สร้างรายการฝากไม่สำเร็จ", code: "upstream_error" as CeloxErrorCode, retryable: false };
        showApiToast(error.error);
        if (applyServerFieldErrors(error.fieldErrors)) return;
        if (error.code === "reference_id_conflict") {
          setFieldErrors({ referenceId: error.error });
          setPhase("form");
          window.setTimeout(() => document.getElementById("deposit-referenceId")?.focus(), 0);
          return;
        }
        setGlobalError(error.error);
        if (["network_error", "request_timeout", "persistence_error", "upstream_error", "invalid_response"].includes(error.code)) {
          setPhase("create-uncertain");
        } else {
          const canRetry = error.code === "rate_limited" && error.retryable;
          setCreateFailure({
            code: error.code,
            message: error.error,
            canRetry,
            retryAt: canRetry ? Date.now() + Math.max(1, error.retryAfterSeconds ?? 1) * 1_000 : null,
          });
          setPhase("create-error");
        }
        return;
      }
      if (!isRecord(payload) || typeof payload.transactionId !== "string" || !isRecord(payload.slipUpload)) {
        const message = "Celox สร้างรายการแล้ว แต่อ่านผลตอบกลับไม่ได้ ห้ามสร้างซ้ำจนกว่าจะตรวจสอบสถานะ";
        setGlobalError(message);
        showApiToast(message);
        setPhase("create-uncertain");
        return;
      }
      const created = payload as unknown as CreateDepositResponse;
      const allowedUploadOrigin = response.headers.get("X-Celox-Upload-Origin") ?? "";
      const allowedUploadPathPrefix = response.headers.get("X-Celox-Upload-Path-Prefix") ?? "";
      if (!validateUploadUrl(created.slipUpload.uploadUrl, created.transactionId, allowedUploadOrigin, allowedUploadPathPrefix)) {
        const message = "Celox ส่งลิงก์แนบสลิปที่ตรวจสอบไม่ได้ กรุณาตรวจสถานะรายการก่อนดำเนินการต่อ";
        setGlobalError(message);
        showApiToast(message);
        setPhase("create-uncertain");
        return;
      }
      setDeposit(created);
      setPhase("awaiting-slip");
      onChanged?.();
    } catch {
      const message = "การเชื่อมต่อขาดหายและไม่ทราบว่ารายการถูกสร้างหรือไม่ ห้ามกดสร้างซ้ำจนกว่าจะตรวจสอบกับ Celox";
      setGlobalError(message);
      showApiToast(message);
      setPhase("create-uncertain");
    }
  }

  function updateSelectedFile(nextFile: File | null) {
    if (filePreviewUrlRef.current) URL.revokeObjectURL(filePreviewUrlRef.current);
    const previewUrl = nextFile ? URL.createObjectURL(nextFile) : "";
    filePreviewUrlRef.current = previewUrl;
    setFilePreviewUrl(previewUrl);
    setFile(nextFile);
  }

  function selectFile(nextFile: File | null) {
    setSlipError(null);
    setGlobalError("");
    setFieldErrors((current) => ({ ...current, file: undefined }));
    if (!nextFile) {
      updateSelectedFile(null);
      return;
    }
    if (!nextFile.type.startsWith("image/")) {
      updateSelectedFile(null);
      setFieldErrors((current) => ({ ...current, file: "เลือกไฟล์รูปภาพเท่านั้น" }));
      return;
    }
    if (nextFile.size === 0) {
      updateSelectedFile(null);
      setFieldErrors((current) => ({ ...current, file: "ไฟล์นี้ไม่มีข้อมูล กรุณาเลือกไฟล์ใหม่" }));
      return;
    }
    updateSelectedFile(nextFile);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function uploadSlip() {
    if (!deposit || phase === "uploading" || retryIn > 0) return;
    if (depositExpired) {
      setSlipError({ code: "deposit_expired", message: slipErrorMessages.deposit_expired!, canRetry: false, retryAt: null });
      setPhase("slip-error");
      return;
    }
    if (!file) {
      setFieldErrors((current) => ({ ...current, file: "กรุณาเลือกไฟล์รูปสลิป" }));
      fileInputRef.current?.focus();
      return;
    }

    setPhase("uploading");
    setSlipError(null);
    setGlobalError("");
    const multipart = new FormData();
    multipart.append("file", file, file.name);

    try {
      const uploadToken = new URL(deposit.slipUpload.uploadUrl).searchParams.get("uploadToken");
      if (!uploadToken) throw new Error("missing upload token");
      const response = await fetch(`/api/celox/deposits/${encodeURIComponent(deposit.transactionId)}/slip`, {
        method: "POST",
        headers: { "X-Celox-Upload-Token": uploadToken },
        body: multipart,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const parsedError = parseSlipError(response, payload);
        setSlipError(parsedError);
        showApiToast(parsedError.message);
        setPhase("slip-error");
        return;
      }
      if (!isDepositSlipResponse(payload, deposit)) {
        const invalidResponseError: SlipError = {
          code: "invalid_response",
          message: "Celox รับสลิปแล้ว แต่อ่านผลตอบกลับไม่ได้ ห้ามส่งสลิปซ้ำจนกว่าจะตรวจสอบสถานะ",
          canRetry: false,
          retryAt: null,
        };
        setSlipError(invalidResponseError);
        showApiToast(invalidResponseError.message);
        setPhase("slip-error");
        return;
      }
      dialogRef.current?.close();
      onCompleted();
    } catch {
      const networkError: SlipError = {
        code: "network_error",
        message: "การเชื่อมต่อขาดหายระหว่างส่งสลิป จึงไม่ทราบผล ห้ามอัปโหลดซ้ำจนกว่าจะตรวจสอบสถานะหรือ callback",
        canRetry: false,
        retryAt: null,
      };
      setSlipError(networkError);
      showApiToast(networkError.message);
      setPhase("slip-error");
    }
  }

  function retrySlip() {
    if (!slipError?.canRetry || retryIn > 0) return;
    setSlipError(null);
    if (slipError.code !== "rate_limited") {
      updateSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    setPhase("awaiting-slip");
  }

  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`คัดลอก${label}แล้ว`);
      window.setTimeout(() => setCopyStatus(""), 1800);
    } catch {
      setCopyStatus(`คัดลอก${label}ไม่สำเร็จ`);
    }
  }

  const step = phase === "form" || phase === "review" || phase === "creating" || phase === "create-error" || phase === "create-uncertain" ? 1 : 2;
  const title = step === 1
    ? phase === "review" || phase === "creating"
      ? "ตรวจสอบรายการฝาก"
      : phase === "create-error"
        ? "สร้างรายการฝากไม่สำเร็จ"
        : "สร้างรายการฝาก"
    : "โอนเงินและแนบสลิป";
  const subtitle = step === 1
    ? `${customer.name} · ${customer.account}`
    : deposit
      ? `${deposit.orderId} · ${currency.format(deposit.amount)}`
      : `${customer.name} · ${customer.account}`;
  const phaseAnnouncement = phase === "creating"
    ? "กำลังสร้างรายการฝากกับ Celox"
    : phase === "awaiting-slip"
      ? "สร้างรายการฝากแล้ว กรุณาโอนเงินเข้าบัญชีที่แสดงและแนบสลิป"
      : phase === "uploading"
        ? "กำลังส่งและตรวจสลิปกับ Celox กรุณาอย่าปิดหน้าต่าง"
        : phase === "create-error" && createFailure
            ? createFailure.message
            : phase === "create-uncertain"
              ? "ยังยืนยันผลการสร้างรายการไม่ได้ ห้ามสร้างซ้ำ"
              : phase === "slip-error" && slipError
                ? slipError.message
                : "";

  return (
    <dialog
      ref={dialogRef}
      className="deposit-dialog-layer"
      aria-labelledby="deposit-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
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
      <section className="transaction-dialog celox-deposit-dialog" aria-busy={phase === "creating" || phase === "uploading"}>
        <header className="dialog-header deposit-dialog-header">
          <div>
            <span className="dialog-icon deposit"><Building2 size={20} /></span>
            <div><h2 ref={phaseHeadingRef} id="deposit-dialog-title" tabIndex={-1}>{title}</h2><p>{subtitle}</p></div>
          </div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="ปิด" disabled={phase === "creating" || phase === "uploading"}><X size={20} /></button>
        </header>

        <ol className="deposit-steps" aria-label="ขั้นตอนการฝากเงิน">
          {["ข้อมูลผู้โอน", "โอนและตรวจสลิป"].map((label, index) => {
            const itemStep = index + 1;
            return (
              <li key={label} className={itemStep === step ? "active" : itemStep < step ? "complete" : ""} aria-current={itemStep === step ? "step" : undefined}>
                <span>{itemStep < step ? <Check size={13} /> : itemStep}</span>{label}
              </li>
            );
          })}
        </ol>

        {phase === "form" && (
          <form className="transaction-form deposit-form" onSubmit={handleReview} noValidate>
            <label htmlFor="deposit-customer"><span>ลูกค้าในระบบ</span><div className="select-wrap"><select id="deposit-customer" value={customer.id} onChange={(event) => changeCustomer(event.target.value)}>{customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.account}</option>)}</select><ChevronDown size={17} /></div><small>ใช้รักษาบริบทในระบบ ITStore และจะไม่ถูกส่งไปกับคำขอ Celox</small></label>

            <div className="deposit-field-grid">
              <label htmlFor="deposit-amount">
                <span>จำนวนเงิน</span>
                <div className={`money-input ${fieldErrors.amount ? "invalid" : ""}`}><span>฿</span><input ref={firstFieldRef} id="deposit-amount" inputMode="decimal" value={form.amount} onChange={(event) => updateField("amount", event.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" aria-invalid={Boolean(fieldErrors.amount)} aria-describedby="deposit-amount-help" /></div>
                <small id="deposit-amount-help" className={fieldErrors.amount ? "field-error" : ""}>{fieldErrors.amount || "ยอดที่ผู้ใช้โอน หน่วยบาท ทศนิยมไม่เกิน 2 ตำแหน่ง"}</small>
              </label>
              <label htmlFor="deposit-sourceBankCode">
                <span>ธนาคารต้นทาง</span>
                <div className={`select-wrap ${fieldErrors.sourceBankCode ? "invalid" : ""}`}>
                  <select id="deposit-sourceBankCode" value={form.sourceBankCode} onChange={(event) => updateField("sourceBankCode", event.target.value)} aria-invalid={Boolean(fieldErrors.sourceBankCode)} aria-describedby="deposit-sourceBankCode-help">
                    <option value="" disabled>เลือกธนาคารต้นทาง</option>
                    {BANK_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}
                  </select>
                  <ChevronDown size={17} />
                </div>
                <small id="deposit-sourceBankCode-help" className={fieldErrors.sourceBankCode ? "field-error" : ""}>{fieldErrors.sourceBankCode || "เลือกรหัสธนาคารที่ตรงกับบัญชีผู้โอน"}</small>
              </label>
            </div>

            <label htmlFor="deposit-sourceAccountName"><span>ชื่อบัญชีต้นทาง</span><input id="deposit-sourceAccountName" value={form.sourceAccountName} onChange={(event) => updateField("sourceAccountName", event.target.value)} placeholder="ชื่อเดียวกับผู้โอนบนสลิป" autoComplete="name" aria-invalid={Boolean(fieldErrors.sourceAccountName)} aria-describedby="deposit-sourceAccountName-help" /><small id="deposit-sourceAccountName-help" className={fieldErrors.sourceAccountName ? "field-error" : ""}>{fieldErrors.sourceAccountName || "Celox ใช้ชื่อนี้เทียบกับชื่อผู้โอนบนสลิป"}</small></label>
            <label htmlFor="deposit-sourceAccountNo"><span>เลขบัญชีต้นทาง</span><input id="deposit-sourceAccountNo" inputMode="numeric" value={form.sourceAccountNo} onChange={(event) => updateField("sourceAccountNo", event.target.value.replace(/[^0-9\s-]/g, ""))} placeholder="111-2-23333-4" autoComplete="off" aria-invalid={Boolean(fieldErrors.sourceAccountNo)} aria-describedby="deposit-sourceAccountNo-help" /><small id="deposit-sourceAccountNo-help" className={fieldErrors.sourceAccountNo ? "field-error" : ""}>{fieldErrors.sourceAccountNo || "ระบบจะตัดขีดและช่องว่างก่อนส่ง"}</small></label>
            <label htmlFor="deposit-referenceId"><span>เลขอ้างอิงของคุณ <em>(ไม่บังคับ)</em></span><input id="deposit-referenceId" value={form.referenceId} onChange={(event) => updateField("referenceId", event.target.value)} placeholder="เช่น ORDER-9001" autoComplete="off" aria-invalid={Boolean(fieldErrors.referenceId)} aria-describedby="deposit-referenceId-help" /><small id="deposit-referenceId-help" className={fieldErrors.referenceId ? "field-error" : ""}>{fieldErrors.referenceId || "ต้องไม่ซ้ำภายในองค์กร และช่วยใช้ตรวจสอบรายการภายหลัง"}</small></label>
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions"><button type="button" className="button secondary-button" onClick={requestClose}>ยกเลิก</button><button type="submit" className="button deposit-button">ตรวจสอบข้อมูล</button></div>
          </form>
        )}

        {(phase === "review" || phase === "creating") && requestBody && (
          <div className="review-content deposit-review">
            <div className="review-amount"><span>ยอดฝากที่ต้องการสร้าง</span><strong>{currency.format(requestBody.amount)}</strong></div>
            <dl>
              <div><dt>ลูกค้าในระบบ</dt><dd>{customer.name}<small>{customer.account}</small></dd></div>
              <div><dt>บัญชีต้นทาง</dt><dd>{requestBody.sourceAccountName}<small>{BANK_NAME_MAP[requestBody.sourceBankCode]} ({requestBody.sourceBankCode}) · {requestBody.sourceAccountNo}</small></dd></div>
              <div><dt>เลขอ้างอิง</dt><dd>{requestBody.referenceId || "ไม่ได้ระบุ"}</dd></div>
            </dl>
            <div className="deposit-clarification"><Clock3 size={18} /><span><strong>ขั้นตอนนี้ยังไม่เพิ่มยอดเงิน</strong> Celox จะออกบัญชีรับเงินและรอให้แนบสลิปก่อนตรวจรายการ</span></div>
            {globalError && <div className="form-error" role="alert">{globalError}</div>}
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={() => setPhase("form")} disabled={phase === "creating"}><ArrowLeft size={16} />แก้ไขข้อมูล</button><button className="button deposit-button" type="button" onClick={() => void createDeposit()} disabled={phase === "creating"}>{phase === "creating" ? <><LoaderCircle className="spin" size={17} />กำลังสร้างรายการ…</> : "สร้างรายการฝาก"}</button></div>
          </div>
        )}

        {phase === "create-uncertain" && (
          <div className="deposit-state-panel uncertain" role="alert">
            <span className="state-symbol"><ShieldAlert size={26} /></span>
            <h3>ยังยืนยันผลการสร้างรายการไม่ได้</h3>
            <p>{globalError}</p>
            {requestBody?.referenceId && <div className="state-reference"><span>เลขอ้างอิงที่ใช้</span><strong>{requestBody.referenceId}</strong></div>}
            <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>อย่ากดสร้างซ้ำ</strong> คำขออาจสำเร็จไปแล้วและ endpoint นี้ไม่มี replay result</span></div>
            <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div>
          </div>
        )}

        {phase === "create-error" && createFailure && (
          <div className={`deposit-state-panel ${createFailure.canRetry ? "warning" : "uncertain"}`} role="alert">
            <span className="state-symbol">{createFailure.canRetry ? <Hourglass size={26} /> : <ShieldAlert size={26} />}</span>
            <h3>{createFailure.canRetry ? "ระบบจำกัดจำนวนคำขอชั่วคราว" : "Celox ยังสร้างรายการให้ไม่ได้"}</h3>
            <p>{createFailure.message}</p>
            <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>ระบบจะไม่ลองซ้ำเอง</strong> {createFailure.canRetry ? "รอครบเวลาที่กำหนดแล้วให้ผู้ใช้กดลองใหม่ด้วยตัวเอง" : "ข้อผิดพลาดนี้ไม่ควรส่งคำขอเดิมซ้ำ โปรดตรวจสอบการตั้งค่าหรือสถานะ Celox"}</span></div>
            <div className="dialog-actions deposit-actions">
              <button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button>
              {createFailure.canRetry && <button className="button deposit-button" type="button" onClick={() => void createDeposit()} disabled={retryIn > 0}><RefreshCcw size={16} />{retryIn > 0 ? `ลองใหม่ได้ใน ${Math.ceil(retryIn / 1_000)} วินาที` : "ลองสร้างอีกครั้ง"}</button>}
            </div>
          </div>
        )}

        {(phase === "awaiting-slip" || phase === "uploading") && deposit && (
          <div className="deposit-transfer-content">
            <div className="transfer-status-row">
              <span className="pending-badge"><Hourglass size={14} />รอโอนและแนบสลิป</span>
              <time dateTime={deposit.expiresAt}>{depositExpired ? "หมดเวลาแล้ว" : `เหลือ ${formatCountdown(expiresIn)}`}</time>
            </div>
            <div className="transfer-amount"><span>โอนเงินเข้าบัญชีนี้</span><strong>{currency.format(deposit.amount)}</strong><button type="button" onClick={() => void copyValue(deposit.amount.toFixed(2), "ยอดเงิน")}><Clipboard size={15} />คัดลอกยอด</button></div>
            <section className="receiving-account" aria-labelledby="receiving-account-title">
              <div className="receiving-bank"><span className="bank-symbol"><Building2 size={21} /></span><div><h3 id="receiving-account-title">{deposit.receivingAccount.bankName}</h3><p>รหัสธนาคาร {deposit.receivingAccount.bankCode}</p></div></div>
              <dl><div><dt>ชื่อบัญชี</dt><dd>{deposit.receivingAccount.accountName}</dd></div><div><dt>เลขบัญชี</dt><dd><strong>{deposit.receivingAccount.accountNo}</strong><button type="button" onClick={() => void copyValue(deposit.receivingAccount.accountNo, "เลขบัญชี")} aria-label="คัดลอกเลขบัญชี"><Clipboard size={15} /></button></dd></div><div><dt>Order ID</dt><dd>{deposit.orderId}</dd></div><div><dt>Reference ID</dt><dd>{deposit.referenceId || "—"}</dd></div></dl>
            </section>

            <div className="slip-upload-section">
              <div className="slip-upload-heading"><div><h3>แนบรูปสลิป</h3><p>ส่งไฟล์เดียวเพื่อยืนยันรายการ ไม่ต้องกดยืนยันซ้ำ</p></div><ImageUp size={20} /></div>
              <label
                className={`slip-dropzone ${filePreviewUrl ? "has-preview" : ""} ${dragging ? "dragging" : ""} ${fieldErrors.file ? "invalid" : ""}`}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} disabled={phase === "uploading" || depositExpired} aria-invalid={Boolean(fieldErrors.file)} aria-describedby="deposit-file-help" />
                {file && filePreviewUrl ? <>
                  <div className="slip-preview-frame"><Image src={filePreviewUrl} alt={`ตัวอย่างสลิป ${file.name}`} fill sizes="(max-width: 640px) 100vw, 590px" unoptimized /></div>
                  <div className="slip-preview-meta"><span className="file-symbol selected"><FileImage size={20} /></span><span><strong>{file.name}</strong><small>{formatFileSize(file.size)} · กดเพื่อเปลี่ยนไฟล์</small></span></div>
                </> : <><span className="file-symbol"><UploadCloud size={23} /></span><strong>เลือกไฟล์หรือลากรูปสลิปมาวาง</strong><small>รองรับไฟล์รูปภาพตามขนาดที่ระบบกำหนด</small></>}
              </label>
              <p id="deposit-file-help" className={fieldErrors.file ? "file-help field-error" : "file-help"}>{fieldErrors.file || "ระบบจะส่งเฉพาะไฟล์นี้ผ่านเซิร์ฟเวอร์ไปยัง Celox โดยไม่มี field อื่น"}</p>
            </div>
            <div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>ตรวจไฟล์ก่อนส่ง</strong> เมื่อ Celox รับสลิปแล้ว ห้ามอัปโหลดซ้ำโดยยังไม่อ่านผลสถานะ</span></div>
            {copyStatus && <div className="copy-status" role="status">{copyStatus}</div>}
            <div className="dialog-actions deposit-actions sticky"><button className="button secondary-button" type="button" onClick={requestClose} disabled={phase === "uploading"}>ปิดหน้าต่าง</button><button className="button deposit-button" type="button" onClick={() => void uploadSlip()} disabled={!file || phase === "uploading" || depositExpired}>{phase === "uploading" ? <><LoaderCircle className="spin" size={17} />กำลังตรวจสลิป…</> : <><UploadCloud size={17} />ส่งสลิปและตรวจรายการ</>}</button></div>
          </div>
        )}

        {phase === "slip-error" && deposit && slipError && (
          <div className={`deposit-state-panel ${slipError.canRetry ? "warning" : "uncertain"}`} role="alert">
            <span className="state-symbol">{slipError.canRetry ? <AlertTriangle size={26} /> : <ShieldAlert size={26} />}</span>
            <h3>{slipError.code === "deposit_expired" ? "รายการหมดอายุ" : slipError.canRetry ? "Celox ยังไม่รับสลิป" : "ต้องตรวจสอบสถานะก่อนดำเนินการต่อ"}</h3>
            <p>{slipError.message}</p>
            <div className="state-reference"><span>รายการ</span><strong>{deposit.orderId}</strong></div>
            {!slipError.canRetry && <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>ระบบจะไม่ส่งไฟล์ซ้ำอัตโนมัติ</strong> ตรวจสอบ callback หรือสถานะใน Celox ก่อนเสมอ</span></div>}
            <div className="dialog-actions deposit-actions">
              <button className="button secondary-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button>
              {slipError.canRetry && <button className="button deposit-button" type="button" onClick={retrySlip} disabled={retryIn > 0}><RefreshCcw size={16} />{retryIn > 0 ? `ลองใหม่ได้ใน ${Math.ceil(retryIn / 1000)} วินาที` : slipError.code === "rate_limited" ? "ลองส่งอีกครั้ง" : "เลือกไฟล์ใหม่"}</button>}
            </div>
          </div>
        )}

      </section>
      {apiToast && <div className="toast deposit-api-toast" role="alert"><span><AlertTriangle size={16} /></span>{apiToast}</div>}
    </dialog>
  );
}
