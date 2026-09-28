"use client";

// หน้าชั่วคราวสำหรับหา root cause ว่าทำไม iframe payUrl กดไม่ได้เมื่ออยู่ใน modal — ลบทิ้งหลังจบการทดสอบ
import { useEffect, useRef, useState, type CSSProperties } from "react";

type Variant = {
  id: string;
  label: string;
  modal: boolean;
  appCss: boolean;
  layerStyle?: CSSProperties;
  sectionStyle?: CSSProperties;
};

const VARIANTS: Variant[] = [
  { id: "A", label: "A · iframe ในหน้าปกติ ไม่มี dialog", modal: false, appCss: false },
  { id: "B", label: "B · <dialog> showModal เปล่าๆ ไม่ใช้ CSS ของแอป", modal: true, appCss: false },
  { id: "C", label: "C · เหมือน dialog จริงทุกอย่าง", modal: true, appCss: true },
  { id: "D", label: "D · C แต่ไม่มี overflow:hidden / border-radius", modal: true, appCss: true, layerStyle: { overflow: "visible" }, sectionStyle: { overflow: "visible", borderRadius: 0 } },
  { id: "E", label: "E · C แต่ไม่มี animation", modal: true, appCss: true, sectionStyle: { animation: "none" } },
  { id: "F", label: "F · C แต่เปิดด้วย show() (non-modal)", modal: false, appCss: true },
];

function DebugDialog({ variant, src, onClose }: { variant: Variant; src: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (variant.modal) dialog.showModal();
    else dialog.show();
    return () => dialog.close();
  }, [variant]);

  if (!variant.appCss) {
    return (
      <dialog ref={ref} style={{ width: "min(100%, 420px)", height: "90dvh", padding: 12 }}>
        <button type="button" onClick={onClose}>ปิด ({variant.id})</button>
        <iframe src={src} title="payUrl" style={{ width: "100%", height: "calc(100% - 40px)", border: "1px solid #ccc" }} />
      </dialog>
    );
  }

  return (
    <dialog ref={ref} className="deposit-dialog-layer" style={variant.layerStyle}>
      <section className="transaction-dialog celox-deposit-dialog c2c-dialog paying" style={variant.sectionStyle}>
        <header className="dialog-header deposit-dialog-header"><div><div><h2>ทดสอบ {variant.id}</h2><p>{variant.label}</p></div></div></header>
        <div className="c2c-pay-panel">
          <iframe className="c2c-pay-frame" src={src} title="payUrl" allow="clipboard-write" referrerPolicy="no-referrer" />
          <div className="dialog-actions deposit-actions"><button className="button secondary-button" type="button" onClick={onClose}>ปิด</button></div>
        </div>
      </section>
    </dialog>
  );
}

export default function IframeDebugPage() {
  const [src, setSrc] = useState("");
  const [active, setActive] = useState<Variant | null>(null);

  return (
    <main style={{ padding: 16, display: "grid", gap: 12, fontSize: 14 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>ทดสอบ iframe payUrl</h1>
      <label style={{ display: "grid", gap: 4 }}>
        payUrl
        <input value={src} onChange={(event) => setSrc(event.target.value.trim())} placeholder="https://pay-stg.celox.app/pay/c2c?id=…&t=…" style={{ padding: 8, border: "1px solid #ccc" }} />
      </label>
      {VARIANTS.map((variant) => (
        <button key={variant.id} type="button" disabled={!src} onClick={() => setActive(variant)} style={{ padding: 10, textAlign: "left" }}>{variant.label}</button>
      ))}
      {active?.id === "A" && (
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" onClick={() => setActive(null)}>ปิด (A)</button>
          <iframe src={src} title="payUrl" style={{ width: "100%", height: 900, border: "1px solid #ccc" }} />
        </div>
      )}
      {active && active.id !== "A" && <DebugDialog key={active.id} variant={active} src={src} onClose={() => setActive(null)} />}
    </main>
  );
}
