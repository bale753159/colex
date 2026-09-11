"use client";

import { AlertTriangle, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { startC2CCallbackPolling } from "@/lib/celox/c2c-callback-poll";
import { c2cStatusDescription, c2cStatusLabel, c2cStatusTone } from "@/lib/celox/c2c-display";
import type { CeloxC2CCallbackStep, CeloxC2CCallbackTimeline } from "@/lib/celox/types";

type Props = {
  reference: string;
  active?: boolean;
  onSteps?: (steps: CeloxC2CCallbackStep[]) => void;
};

const currency = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Bangkok" });

function processingText(step: CeloxC2CCallbackStep) {
  if (step.processingState === "applied") return step.settledAmount > 0
    ? `ปรับยอดในระบบแล้ว · ยอดที่ปิดได้จริง ${currency.format(step.settledAmount)}`
    : "ปิดรายการในระบบแล้ว โดยไม่มียอดที่ปิดได้จริง";
  if (step.processingState === "recorded") return step.allPartsTerminal
    ? "บันทึกสถานะแล้ว ยังไม่ถึงขั้นที่ต้องขยับยอด"
    : "บันทึกสถานะแล้ว · ยังมีก้อนย่อยที่ยังไม่จบ จึงยังไม่ขยับยอด";
  if (step.processingState === "pending") return "รับเข้าระบบแล้ว กำลังประมวลผล";
  if (step.processingState === "unmatched") return "รับเข้าระบบแล้ว แต่ยังหารายการที่ผูกกับ callback นี้ไม่เจอ";
  return `ประมวลผลไม่สำเร็จ${step.lastError ? ` · ${step.lastError}` : ""}`;
}

export default function C2CCallbackFeed({ reference, active = false, onSteps }: Props) {
  const [timeline, setTimeline] = useState<CeloxC2CCallbackTimeline | null>(null);
  const [error, setError] = useState("");
  const onStepsRef = useRef(onSteps);

  useEffect(() => { onStepsRef.current = onSteps; }, [onSteps]);

  useEffect(() => startC2CCallbackPolling({
    reference,
    active,
    onTimeline(result) {
      setTimeline(result);
      setError("");
      onStepsRef.current?.(result.steps);
    },
    onError() {
      setError("ยังอ่านประวัติ callback ไม่สำเร็จ ระบบจะลองใหม่เมื่อเปิดการเฝ้าสถานะ");
    },
  }), [active, reference]);

  return <section className="c2c-callback-feed" aria-live="polite" aria-label="ลำดับ callback จาก Celox">
    <header><div><h3>ขั้นตอน Callback จาก Celox</h3><p>อ่านจาก inbox ในระบบเรา เพื่อยืนยันว่า callback มาถึงและระบบจัดการอย่างไร</p></div><Clock3 size={18} /></header>
    {error && <p className="c2c-callback-error" role="status"><AlertTriangle size={15} />{error}</p>}
    {!timeline && !error && <p className="c2c-callback-empty">กำลังอ่าน callback ที่ระบบได้รับ…</p>}
    {timeline?.found === false && <p className="c2c-callback-empty">ยังไม่พบรายการหรือ callback ที่ผูกกับรหัสนี้ในระบบ</p>}
    {timeline?.found && timeline.steps.length === 0 && <p className="c2c-callback-empty">Celox จะยิง callback เมื่อสถานะเปลี่ยน ระหว่างนี้ระบบยังตรวจสถานะจาก Celox ควบคู่อยู่</p>}
    {timeline?.steps.map((step) => <article key={`${step.status}-${step.receivedAt}`} className="c2c-callback-step">
      <div className="c2c-callback-step-head"><span className={`c2c-status ${c2cStatusTone(step.status)}`}>{c2cStatusLabel(step.status)}</span><time dateTime={step.lastReceivedAt}>{dateTime.format(new Date(step.lastReceivedAt))}</time></div>
      <p>{c2cStatusDescription(step.status)}</p>
      <strong><CheckCircle2 size={15} />{processingText(step)}</strong>
      {(step.awaitingManualReview || step.receivedCount > 1) && <div className="c2c-callback-flags">
        {step.awaitingManualReview && <span><ShieldAlert size={14} />รอเจ้าหน้าที่ Celox ตรวจสอบ</span>}
        {step.receivedCount > 1 && <span>Celox ส่งซ้ำ {step.receivedCount} ครั้ง</span>}
      </div>}
    </article>)}
  </section>;
}
