"use client";

import { AlertTriangle, CheckCircle2, Clock3, RadioTower, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { c2cStatusDescription, c2cStatusLabel } from "@/lib/celox/c2c-display";
import type {
  CeloxC2CCallbackStep,
  CeloxC2CCallbackTimeline,
  CeloxErrorResponse,
} from "@/lib/celox/types";

const POLL_INTERVAL_MS = 4_000;

const currency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
});
const clockTime = new Intl.DateTimeFormat("th-TH", {
  timeStyle: "medium",
  timeZone: "Asia/Bangkok",
});

type Props = {
  // orderId, referenceId หรือ transactionId ก็ได้ — ฝั่งเซิร์ฟเวอร์หาให้ทั้งสามแบบ
  reference: string;
  // false = ดึงครั้งเดียวแล้วหยุด (รายการจบแล้ว) · true = เฝ้าต่อเป็นรอบ
  active?: boolean;
  onSteps?: (steps: CeloxC2CCallbackStep[]) => void;
};

/** สิ่งที่ระบบเราทำกับ callback ก้อนนั้นแล้ว — แยกจากสถานะที่ Celox รายงาน */
function processingNote(step: CeloxC2CCallbackStep) {
  switch (step.processingState) {
    case "applied":
      return step.settledAmount > 0
        ? `ปรับยอดในระบบแล้ว · ยอดที่ปิดได้จริง ${currency.format(step.settledAmount)}`
        : "ปิดรายการในระบบแล้ว โดยไม่มียอดที่ปิดได้จริง";
    case "recorded":
      return step.allPartsTerminal
        ? "บันทึกสถานะแล้ว ยังไม่ถึงขั้นที่ต้องขยับยอด"
        : "บันทึกสถานะแล้ว · ยังมีก้อนย่อยที่ยังไม่จบ จึงยังไม่ขยับยอด";
    case "pending":
      return "รับเข้าระบบแล้ว กำลังประมวลผล";
    case "unmatched":
      return "รับเข้าระบบแล้ว แต่ยังหารายการที่ผูกกับ callback นี้ไม่เจอ";
    case "failed":
      return step.lastError
        ? `ประมวลผลไม่สำเร็จ · ${step.lastError}`
        : "ประมวลผลไม่สำเร็จ";
    default:
      return "รับเข้าระบบแล้ว";
  }
}

function StepIcon({ state }: { state: CeloxC2CCallbackStep["processingState"] }) {
  if (state === "applied") return <CheckCircle2 size={15} />;
  if (state === "failed") return <AlertTriangle size={15} />;
  if (state === "unmatched") return <ShieldAlert size={15} />;
  return <Clock3 size={15} />;
}

export default function C2CCallbackFeed({ reference, active = true, onSteps }: Props) {
  const [steps, setSteps] = useState<CeloxC2CCallbackStep[]>([]);
  const [error, setError] = useState("");
  const onStepsRef = useRef(onSteps);

  useEffect(() => {
    onStepsRef.current = onSteps;
  }, [onSteps]);

  useEffect(() => {
    if (!reference) return;
    const controller = new AbortController();
    let timer = 0;
    let stopped = false;

    async function check() {
      try {
        const response = await fetch(`/api/celox/c2c/${encodeURIComponent(reference)}/events`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json() as CeloxC2CCallbackTimeline & CeloxErrorResponse;
        if (stopped) return;
        if (!response.ok) {
          setError(result.error || "อ่านสถานะ Callback ไม่สำเร็จ");
        } else {
          setError("");
          setSteps(result.steps);
          onStepsRef.current?.(result.steps);
        }
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        if (!stopped) setError("การเชื่อมต่อสะดุด ระบบจะตรวจใหม่");
      }
      // ดึงครั้งแรกเสมอ ต่อให้รายการจบไปแล้ว จะได้เห็นย้อนหลังว่ามี callback อะไรเข้ามาบ้าง
      if (!stopped && active) timer = window.setTimeout(() => void check(), POLL_INTERVAL_MS);
    }

    void check();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, reference]);

  return (
    <section className="c2c-callback-feed" aria-live="polite">
      <header>
        <RadioTower size={16} />
        <strong>Callback จาก Celox</strong>
        <span>{steps.length > 0 ? `ได้รับแล้ว ${steps.length} สถานะ` : "ยังไม่ได้รับ"}</span>
      </header>

      {steps.length === 0 ? (
        <p className="c2c-callback-empty">
          {error || "Celox จะยิง callback เมื่อสถานะของรายการเปลี่ยน ระหว่างนี้ระบบยังตรวจสถานะจาก Celox ควบคู่ไปด้วย"}
        </p>
      ) : (
        <ol className="c2c-callback-steps">
          {steps.map((step) => (
            <li key={`${step.status}-${step.receivedAt}`} className={`state-${step.processingState}`}>
              <span className="c2c-callback-mark"><StepIcon state={step.processingState} /></span>
              <div>
                <strong>
                  {c2cStatusLabel(step.status)}
                  <time dateTime={step.lastReceivedAt}>{clockTime.format(new Date(step.lastReceivedAt))}</time>
                </strong>
                <p>{c2cStatusDescription(step.status)}</p>
                <small>{processingNote(step)}</small>
                {step.awaitingManualReview && <small className="c2c-callback-flag">รอเจ้าหน้าที่ Celox ตรวจสอบ</small>}
                {step.receivedCount > 1 && <small className="c2c-callback-flag">Celox ส่งซ้ำ {step.receivedCount} ครั้ง</small>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {error && steps.length > 0 && <p className="c2c-callback-empty">{error}</p>}
    </section>
  );
}
