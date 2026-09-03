"use client";

import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  FileImage,
  LoaderCircle,
  RefreshCcw,
  ShieldAlert,
  UploadCloud,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { c2cStatusDescription, c2cStatusLabel, c2cStatusTone } from "@/lib/celox/c2c-display";
import type {
  C2CDepositSlipResponse,
  C2CTransactionResponse,
  CeloxErrorResponse,
} from "@/lib/celox/types";

type Phase = "ready" | "uploading" | "result" | "uncertain";

type Props = {
  // ใช้ผลจาก GET เป็นข้อมูลอ้างอิง จึงแนบสลิปให้รายการเดิมได้แม้ปิด dialog ตอนสร้างรายการไปแล้ว
  transaction: C2CTransactionResponse;
  onClose: () => void;
  onUploaded: () => void;
};

const currency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
});
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_SLIP_BYTES = 10 * 1024 * 1024;
// ผลที่ยังแนบสลิปใหม่กับ transactionId เดิมได้ ไม่ใช่ข้อผิดพลาดของการส่ง
const REATTACHABLE_RESULTS = new Set(["PENDING_TRANSFER", "EXPIRED"]);
// รหัสที่แก้ที่ไฟล์แล้วลองใหม่ได้ทันที ส่วนรหัสอื่นเป็นความผิดถาวรของรายการนี้
const REATTACHABLE_ERROR_CODES = new Set(["file_required", "file_invalid", "rate_limited"]);
const UNCERTAIN_ERROR_CODES = new Set([
  "request_timeout",
  "network_error",
  "invalid_response",
  "persistence_error",
  "upstream_error",
]);

export default function C2CSlipUploadDialog({ transaction, onClose, onUploaded }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previewUrlRef = useRef("");
  const [phase, setPhase] = useState<Phase>("ready");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [slipResult, setSlipResult] = useState<C2CDepositSlipResponse | null>(null);
  const [failure, setFailure] = useState<CeloxErrorResponse | null>(null);
  const [globalError, setGlobalError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [dragging, setDragging] = useState(false);

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

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const selectedFileLabel = useMemo(
    () => file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "",
    [file],
  );
  const resultStatus = slipResult?.transactionStatus ?? transaction.transactionStatus;
  const retryableSlip = Boolean(slipResult && REATTACHABLE_RESULTS.has(slipResult.transactionStatus));

  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
    setFile(null);
  }

  function selectFile(nextFile: File | null) {
    if (!nextFile) return;
    if (!ACCEPTED_TYPES.has(nextFile.type.toLowerCase())) {
      setGlobalError("ไฟล์สลิปต้องเป็น JPEG, PNG, WEBP หรือ HEIC");
      clearPreview();
      return;
    }
    if (nextFile.size <= 0 || nextFile.size > MAX_SLIP_BYTES) {
      setGlobalError("ไฟล์สลิปต้องมีข้อมูลและขนาดไม่เกิน 10 MB");
      clearPreview();
      return;
    }
    setGlobalError("");
    setSlipResult(null);
    setFailure(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = URL.createObjectURL(nextFile);
    setPreviewUrl(previewUrlRef.current);
    setFile(nextFile);
  }

  async function uploadSlip() {
    if (!file) {
      setGlobalError("กรุณาเลือกรูปสลิปก่อนส่งตรวจ");
      return;
    }
    setPhase("uploading");
    setGlobalError("");
    try {
      const formData = new FormData();
      // หนึ่ง part ชื่อ file เท่านั้น ห้ามมี field อื่นใน multipart
      formData.append("file", file, file.name);
      const response = await fetch(
        `/api/celox/c2c/deposits/${encodeURIComponent(transaction.transactionId)}/slip`,
        { method: "POST", body: formData },
      );
      const result = await response.json() as C2CDepositSlipResponse & CeloxErrorResponse;
      if (!response.ok) {
        setFailure(result);
        setGlobalError(result.error || "แนบสลิปไม่สำเร็จ");
        // timeout หรือเน็ตขาด ผลอาจถูกบันทึกแล้ว ห้ามส่งซ้ำจนกว่าจะตรวจสถานะ
        setPhase(UNCERTAIN_ERROR_CODES.has(result.code) ? "uncertain" : "ready");
        return;
      }
      setSlipResult(result);
      setPhase("result");
      onUploaded();
    } catch {
      setGlobalError("การเชื่อมต่อขาดหลังส่งสลิป ผลตรวจอาจถูกบันทึกแล้ว กรุณาตรวจสถานะก่อนแนบซ้ำ");
      setPhase("uncertain");
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

  function requestClose() {
    if (phase === "uploading") return;
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="deposit-dialog-layer"
      aria-labelledby="c2c-slip-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section className="transaction-dialog celox-deposit-dialog c2c-dialog" aria-busy={phase === "uploading"}>
        <header className="dialog-header deposit-dialog-header">
          <div><span className="dialog-icon c2c"><UploadCloud size={20} /></span><div><h2 ref={headingRef} id="c2c-slip-title" tabIndex={-1}>แนบสลิปรายการเดิม</h2><p>{transaction.orderId} · {currency.format(transaction.amount)}</p></div></div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="ปิด" disabled={phase === "uploading"}><X size={20} /></button>
        </header>

        {(phase === "ready" || phase === "uploading") && (
          <div className="deposit-transfer-content">
            <div className="transfer-status-row"><span className="pending-badge"><Check size={14} />{c2cStatusLabel(transaction.transactionStatus)}</span><span className="withdrawal-order">{transaction.orderId}</span></div>
            <div className="transfer-amount"><span>ยอดที่ต้องโอนให้ตรงกัน</span><strong>{currency.format(transaction.amount)}</strong><button type="button" onClick={() => void copy(transaction.amount.toFixed(2), "ยอดเงิน")}><Copy size={15} />คัดลอกยอด</button></div>

            {transaction.transferTo ? (
              <section className="receiving-account" aria-label="บัญชีปลายทาง C2C">
                <div className="receiving-bank"><span className="bank-symbol"><Building2 size={21} /></span><div><h3>{transaction.transferTo.bankName || "ธนาคารปลายทาง"}</h3><p>รหัสธนาคาร {transaction.transferTo.bankCode || "—"}</p></div></div>
                <dl><div><dt>ชื่อบัญชีผู้รับ</dt><dd>{transaction.transferTo.accountName || "—"}</dd></div><div><dt>เลขบัญชี</dt><dd><strong>{transaction.transferTo.accountNo || "—"}</strong>{transaction.transferTo.accountNo && <button type="button" aria-label="คัดลอกเลขบัญชี" onClick={() => void copy(transaction.transferTo?.accountNo || "", "เลขบัญชี")}><Copy size={15} /></button>}</dd></div></dl>
              </section>
            ) : (
              <div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>Celox ไม่ได้คืนบัญชีปลายทางของรายการนี้</strong> ถ้าผู้ใช้โอนไปแล้วยังแนบสลิปได้ตามปกติ แต่ถ้ายังไม่โอน ต้องตรวจสถานะให้ได้บัญชีปลายทางก่อน</span></div>
            )}

            <section className="slip-upload-section"><div className="slip-upload-heading"><div><h3>แนบสลิปหลังโอน</h3><p>หนึ่งไฟล์ และไม่มี field อื่นใน multipart</p></div><UploadCloud size={20} /></div><label className={`slip-dropzone ${dragging ? "dragging" : ""} ${file ? "has-preview" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0] ?? null); }}>{previewUrl ? <><div className="slip-preview-frame"><Image src={previewUrl} alt="ตัวอย่างสลิป C2C ที่เลือก" fill unoptimized /></div><span className="slip-preview-meta"><span className="file-symbol selected"><FileImage size={19} /></span><span><strong>{file?.name}</strong><small>{selectedFileLabel}</small></span></span></> : <><span className="file-symbol"><UploadCloud size={20} /></span><strong>เลือกหรือลากรูปสลิปมาวาง</strong><small>JPEG, PNG, WEBP, HEIC · ไม่เกิน 10 MB</small></>}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /></label></section>

            {copyStatus && <p className="copy-status" role="status">{copyStatus}</p>}
            {globalError && <div className="form-error" role="alert">{globalError}{failure && !REATTACHABLE_ERROR_CODES.has(failure.code) && " · ข้อผิดพลาดนี้ไม่ควรส่งไฟล์เดิมซ้ำ"}</div>}
            <div className="dialog-actions deposit-actions sticky"><button className="button secondary-button" type="button" onClick={requestClose} disabled={phase === "uploading"}>ปิดไว้ก่อน</button><button className="button deposit-button" type="button" onClick={() => void uploadSlip()} disabled={!file || phase === "uploading"}>{phase === "uploading" ? <><LoaderCircle className="spin" size={17} />กำลังตรวจสลิป…</> : <><UploadCloud size={17} />ส่งสลิปตรวจ</>}</button></div>
          </div>
        )}

        {phase === "result" && slipResult && (
          <div className={`deposit-result c2c-result ${c2cStatusTone(resultStatus)}`}>
            <div className="result-heading"><span className="state-symbol">{resultStatus === "SUCCESS" ? <CheckCircle2 size={28} /> : <AlertTriangle size={27} />}</span><div><h3>{c2cStatusLabel(resultStatus)}</h3><p>{c2cStatusDescription(resultStatus)}</p></div></div>
            <div className="result-amount"><span>ยอดรายการ</span><strong>{currency.format(transaction.amount)}</strong></div>
            <dl className="result-details"><div><dt>สถานะ</dt><dd>{resultStatus}</dd></div><div><dt>Order ID</dt><dd>{slipResult.orderId}</dd></div><div><dt>ผลตรวจสลิป</dt><dd>{slipResult.slipVerification.outcome}</dd></div><div><dt>ฝั่งคู่รายการ</dt><dd>{slipResult.counterparty?.transactionStatus ?? (resultStatus === "SUCCESS" ? "SUCCESS" : "ไม่เปิดเผยข้อมูล")}</dd></div></dl>
            {resultStatus === "SUCCESS" && <div className="deposit-clarification"><CheckCircle2 size={18} /><span><strong>สำเร็จทั้งคู่พร้อมกัน</strong> Celox ปิดรายการทั้งสองฝั่งในทรานแซกชันเดียว และระบบเพิ่มยอดให้ลูกค้าแล้ว</span></div>}
            {resultStatus === "PENDING_APPROVE" && <div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>ต้องรอเจ้าหน้าที่</strong> ชื่อหรือบัญชีบนสลิปตรงเพียงบางส่วน แนบสลิปซ้ำไม่ได้จนกว่าจะมีผลตัดสิน</span></div>}
            {retryableSlip && <div className="deposit-clarification warning"><AlertTriangle size={18} /><span><strong>สลิปไม่ผ่าน แต่รายการเดิมยังใช้ได้</strong> เลือกรูปใหม่แล้วแนบกับ transactionId เดิม ห้ามสร้างรายการฝากใหม่</span></div>}
            <div className="dialog-actions deposit-actions">{retryableSlip && <button className="button secondary-button" type="button" onClick={() => { clearPreview(); setSlipResult(null); setGlobalError(""); setPhase("ready"); }}><RefreshCcw size={16} />แนบสลิปใหม่</button>}<button className="button deposit-button" type="button" onClick={requestClose}>ปิดหน้าต่าง</button></div>
          </div>
        )}

        {phase === "uncertain" && (
          <div className="deposit-state-panel warning" role="alert">
            <span className="state-symbol"><AlertTriangle size={26} /></span><h3>ยังยืนยันผลการส่งสลิปไม่ได้</h3><p>{globalError}</p>
            <div className="deposit-clarification warning"><ShieldAlert size={18} /><span><strong>ห้ามส่งไฟล์ซ้ำทันที</strong> Celox อาจรับสลิปและปิดรายการทั้งสองฝั่งไปแล้ว ให้ตรวจสถานะรายการเดิมก่อนตัดสินใจ</span></div>
            <div className="state-reference"><span>รายการ</span><strong>{transaction.orderId}</strong></div>
            <div className="dialog-actions deposit-actions"><button className="button deposit-button" type="button" onClick={() => { onUploaded(); onClose(); }}><RefreshCcw size={16} />ปิดแล้วตรวจสถานะ</button></div>
          </div>
        )}
      </section>
    </dialog>
  );
}
