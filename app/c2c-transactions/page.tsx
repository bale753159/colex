"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Eye,
  Hourglass,
  LoaderCircle,
  RefreshCcw,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/app/components/app-shell";
import { c2cStatusDescription, c2cStatusLabel, c2cStatusTone, isC2CTerminal } from "@/lib/celox/c2c-display";
import type {
  C2CTransactionResponse,
  CancelC2CTransactionResponse,
  CeloxC2CListItem,
  CeloxC2CListResponse,
  CeloxErrorResponse,
} from "@/lib/celox/types";

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

function referenceOf(item: CeloxC2CListItem) {
  return item.referenceId || item.orderId;
}

export default function C2CTransactionsPage() {
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [search, setSearch] = useState("");
  const [lookup, setLookup] = useState("");
  const [items, setItems] = useState<CeloxC2CListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedReference, setSelectedReference] = useState("");
  const [detail, setDetail] = useState<C2CTransactionResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const loadList = useCallback(async (query = search) => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setLoading(true);
    setLoadError("");
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("search", query.trim());
    try {
      const response = await fetch(`/api/celox/c2c?${params}`, { cache: "no-store" });
      const result = await response.json() as CeloxC2CListResponse & CeloxErrorResponse;
      if (!response.ok) throw new Error(result.error || "โหลดรายการ C2C ไม่สำเร็จ");
      if (listRequestRef.current !== requestId) return;
      setItems(result.transactions);
      if (result.transactions[0]) {
        setSelectedReference((current) => current || referenceOf(result.transactions[0]));
      }
    } catch (error) {
      if (listRequestRef.current === requestId) {
        setLoadError(error instanceof Error ? error.message : "โหลดรายการ C2C ไม่สำเร็จ");
      }
    } finally {
      if (listRequestRef.current === requestId) setLoading(false);
    }
  }, [search]);

  const checkReference = useCallback(async (reference: string, quiet = false) => {
    const normalized = reference.trim();
    if (!normalized) return;
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    if (!quiet) setDetailLoading(true);
    setDetailError("");
    try {
      const response = await fetch(`/api/celox/c2c/${encodeURIComponent(normalized)}`, {
        cache: "no-store",
      });
      const result = await response.json() as C2CTransactionResponse & CeloxErrorResponse;
      if (!response.ok) throw new Error(result.error || "ตรวจสถานะ C2C ไม่สำเร็จ");
      if (detailRequestRef.current !== requestId) return;
      setDetail(result);
      setSelectedReference(result.referenceId || result.orderId);
      setLookup(result.referenceId || result.orderId);
      await loadList(search);
    } catch (error) {
      if (detailRequestRef.current === requestId) {
        setDetailError(error instanceof Error ? error.message : "ตรวจสถานะ C2C ไม่สำเร็จ");
      }
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  }, [loadList, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(), 220);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  useEffect(() => {
    if (!selectedReference) return;
    const timer = window.setTimeout(() => void checkReference(selectedReference), 0);
    return () => window.clearTimeout(timer);
  }, [checkReference, selectedReference]);

  useEffect(() => {
    if (!detail || isC2CTerminal(detail.transactionStatus)) return;
    const timer = window.setTimeout(() => {
      void checkReference(detail.referenceId || detail.orderId, true);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [checkReference, detail]);

  function handleLookup(event: FormEvent) {
    event.preventDefault();
    if (!lookup.trim()) return;
    const reference = lookup.trim();
    if (reference === selectedReference) void checkReference(reference);
    else setSelectedReference(reference);
  }

  async function cancelSelected() {
    if (!detail || detail.transactionStatus !== "PENDING") return;
    if (!window.confirm(`ยืนยันยกเลิกรายการ ${detail.orderId} ที่ยังไม่ถูกจับคู่หรือไม่?`)) return;
    setCancelling(true);
    setDetailError("");
    try {
      const response = await fetch(`/api/celox/c2c/${encodeURIComponent(detail.transactionId)}/cancel`, {
        method: "POST",
      });
      const result = await response.json() as CancelC2CTransactionResponse & CeloxErrorResponse;
      if (!response.ok) throw new Error(result.error || "ยกเลิกรายการ C2C ไม่สำเร็จ");
      await Promise.all([
        checkReference(result.referenceId || result.orderId),
        loadList(search),
      ]);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "ยกเลิกรายการ C2C ไม่สำเร็จ");
    } finally {
      setCancelling(false);
    }
  }

  const summary = useMemo(() => items.reduce((current, item) => {
    current.total += 1;
    if (item.direction === "deposit") current.deposit += item.amount;
    else current.withdraw += item.amount;
    if (!isC2CTerminal(item.transactionStatus)) current.active += 1;
    if (item.awaitingManualReview) current.review += 1;
    return current;
  }, { total: 0, deposit: 0, withdraw: 0, active: 0, review: 0 }), [items]);

  return (
    <AppShell active="c2c" searchValue={search} onSearchChange={setSearch} searchPlaceholder="ค้นหาลูกค้า Order ID หรือ Reference ID">
      <div className="page-wrap c2c-page">
        <section className="page-heading c2c-page-heading">
          <div><h1>รายการ C2C</h1><p>ติดตามสถานะฝาก–ถอนจาก Celox โดยใช้ GET เป็นข้อมูลอ้างอิงล่าสุด</p></div>
          <form className="c2c-lookup" onSubmit={handleLookup} role="search"><label htmlFor="c2c-reference-lookup">ตรวจรายการด้วย Order ID หรือ Reference ID</label><div><Search size={17} /><input id="c2c-reference-lookup" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="เช่น ORDER-9001" /><button className="button deposit-button" type="submit" disabled={!lookup.trim() || detailLoading}>{detailLoading ? <LoaderCircle className="spin" size={16} /> : <Eye size={16} />}ตรวจสถานะ</button></div></form>
        </section>

        <section className="c2c-summary" aria-label="ภาพรวมรายการ C2C">
          <div><span>รายการทั้งหมด</span><strong>{summary.total}</strong><small>รายการที่รู้จักในระบบ</small></div>
          <div><span>ยอดฝาก</span><strong>{currency.format(summary.deposit)}</strong><small>รวมทุกสถานะ</small></div>
          <div><span>ยอดถอน</span><strong>{currency.format(summary.withdraw)}</strong><small>รวมทุกสถานะ</small></div>
          <div><span>กำลังดำเนินการ</span><strong>{summary.active}</strong><small>{summary.review ? `${summary.review} รายการรอเจ้าหน้าที่` : "ไม่มีรายการรอตรวจด้วยคน"}</small></div>
        </section>

        {loadError && <div className="load-error" role="alert"><AlertTriangle size={20} /><span>{loadError}</span><button className="button secondary-button" onClick={() => void loadList()}>ลองใหม่</button></div>}

        <div className="c2c-workspace">
          <section className="c2c-list-panel" aria-labelledby="c2c-list-title">
            <header><div><h2 id="c2c-list-title">รายการล่าสุด</h2><p>เลือกแถวเพื่ออ่านสถานะจริงจาก Celox</p></div><button className="icon-button" onClick={() => void loadList()} aria-label="โหลดรายการใหม่" disabled={loading}><RefreshCcw className={loading ? "spin" : ""} size={18} /></button></header>
            {loading && items.length === 0 ? (
              <div className="c2c-list-skeleton" aria-label="กำลังโหลด"><span /><span /><span /></div>
            ) : items.length === 0 ? (
              <div className="c2c-empty"><Hourglass size={25} /><h3>ยังไม่มีรายการ C2C ในระบบ</h3><p>สร้างรายการจากหน้า Customers หรือใช้ช่องตรวจ reference ด้านบนสำหรับผลที่ไม่แน่นอน</p></div>
            ) : (
              <div className="c2c-rows">
                {items.map((item) => {
                  const reference = referenceOf(item);
                  const DirectionIcon = item.direction === "deposit" ? ArrowDownLeft : ArrowUpRight;
                  return <button key={item.transactionId} className={selectedReference === reference ? "selected" : ""} onClick={() => setSelectedReference(reference)}><span className={`c2c-direction ${item.direction}`}><DirectionIcon size={17} /></span><span className="c2c-row-main"><strong>{item.customerName}</strong><small>{item.orderId} · {item.customerAccount}</small></span><span className="c2c-row-meta"><strong>{currency.format(item.amount)}</strong><small className={`c2c-status ${c2cStatusTone(item.transactionStatus)}`}>{c2cStatusLabel(item.transactionStatus)}</small></span></button>;
                })}
              </div>
            )}
          </section>

          <section className="c2c-detail-panel" aria-labelledby="c2c-detail-title" aria-busy={detailLoading}>
            {!detail && !detailError ? (
              <div className="c2c-empty"><Eye size={25} /><h3>เลือกรายการเพื่อดูรายละเอียด</h3><p>ระบบจะตรวจสถานะรายการนั้นกับ Celox โดยตรง และอัปเดตยอดภายในแบบครั้งเดียว</p></div>
            ) : detailError ? (
              <div className="c2c-detail-error" role="alert"><AlertTriangle size={28} /><h3>ตรวจสถานะไม่สำเร็จ</h3><p>{detailError}</p>{selectedReference && <button className="button secondary-button" onClick={() => void checkReference(selectedReference)}><RefreshCcw size={16} />ลองตรวจอีกครั้ง</button>}</div>
            ) : detail && (
              <>
                <header className="c2c-detail-header"><div><span className={`c2c-direction ${detail.direction}`}>{detail.direction === "deposit" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span><div><h2 id="c2c-detail-title">{detail.orderId}</h2><p>{detail.referenceId || "ไม่มี Reference ID"}</p></div></div><span className={`c2c-status large ${c2cStatusTone(detail.transactionStatus)}`}>{detailLoading && <LoaderCircle className="spin" size={14} />}{c2cStatusLabel(detail.transactionStatus)}</span></header>
                <div className="c2c-detail-amount"><span>{detail.direction === "deposit" ? "ยอดฝาก" : "ยอดถอน"}</span><strong>{currency.format(detail.amount)}</strong><p>{c2cStatusDescription(detail.transactionStatus)}</p></div>
                {detail.awaitingManualReview && <div className="c2c-manual-alert"><ShieldAlert size={19} /><span><strong>รายการนี้รอเจ้าหน้าที่โดยไม่มีเวลาปลดอัตโนมัติ</strong> ยอดที่ค้างยังถูกกันไว้ {currency.format(detail.heldAmount)}</span></div>}
                <dl className="c2c-detail-facts"><div><dt>ค่าธรรมเนียมรวม</dt><dd>{currency.format(detail.feeAmount)}</dd></div><div><dt>ยอดที่สำเร็จแล้ว</dt><dd>{currency.format(detail.settledAmount)}</dd></div><div><dt>ยอดที่ยังถูกกัน</dt><dd>{currency.format(detail.heldAmount)}</dd></div><div><dt>เส้นตายที่ยังเดิน</dt><dd>{detail.matchDeadline ? dateTime.format(new Date(detail.matchDeadline)) : "ไม่มี"}</dd></div><div><dt>บัญชีปลายทาง</dt><dd>{detail.direction === "withdraw" ? "ไม่เปิดเผยสำหรับฝั่งถอน" : detail.transferTo ? "พร้อมสำหรับผู้โอนรายการนี้" : "ยังไม่จับคู่"}</dd></div><div><dt>Transaction ID</dt><dd>{detail.transactionId}</dd></div></dl>
                <section className="c2c-parts" aria-labelledby="c2c-parts-title"><header><h3 id="c2c-parts-title">ส่วนของรายการ</h3><span>{detail.parts.length} ส่วน</span></header><div className="c2c-parts-table" role="table"><div className="c2c-parts-head" role="row"><span>Order ID</span><span>ยอด / ค่าธรรมเนียม</span><span>สถานะ</span></div>{detail.parts.map((part) => <div className="c2c-part-row" role="row" key={part.orderId}><span><strong>{part.orderId}</strong><small>{part.matchedAt ? `จับคู่ ${dateTime.format(new Date(part.matchedAt))}` : part.matchDeadline ? `รอถึง ${dateTime.format(new Date(part.matchDeadline))}` : part.cancelReason || "ไม่มีเวลาที่เดินอยู่"}</small></span><span><strong>{currency.format(part.amount)}</strong><small>ค่าธรรมเนียม {currency.format(part.feeAmount)}</small></span><span className={`c2c-status ${c2cStatusTone(part.transactionStatus)}`}>{c2cStatusLabel(part.transactionStatus)}</span></div>)}</div></section>
                <div className="c2c-detail-actions"><button className="button secondary-button" onClick={() => void checkReference(detail.referenceId || detail.orderId)} disabled={detailLoading}><RefreshCcw className={detailLoading ? "spin" : ""} size={16} />ตรวจสถานะล่าสุด</button>{detail.transactionStatus === "PENDING" && <button className="button danger-outline-button" onClick={() => void cancelSelected()} disabled={cancelling}>{cancelling ? <LoaderCircle className="spin" size={16} /> : <XCircle size={16} />}ยกเลิกรายการ</button>}</div>
              </>
            )}
          </section>
        </div>

        <div className="c2c-authority-note"><CheckCircle2 size={18} /><span><strong>สถานะจาก GET คือข้อมูลอ้างอิงหลัก</strong> ระบบ poll เฉพาะรายการที่กำลังเปิดดูทุก 10 วินาที เพื่อลดการชน rate limit และไม่พึ่ง callback เพียงครั้งเดียว</span></div>
      </div>
    </AppShell>
  );
}
