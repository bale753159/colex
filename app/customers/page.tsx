"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserRound,
  Webhook,
  X,
} from "lucide-react";
import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/app/components/app-shell";
import C2CDepositFlowDialog from "@/app/components/c2c-deposit-flow-dialog";
import C2CWithdrawalFlowDialog from "@/app/components/c2c-withdrawal-flow-dialog";
import DepositFlowDialog from "@/app/components/deposit-flow-dialog";
import WithdrawalFlowDialog from "@/app/components/withdrawal-flow-dialog";
import type {
  CeloxCallbackEvent,
  CeloxWithdrawalHold,
  CustomerCeloxCallbacksResponse,
} from "@/lib/celox/types";
import type { CustomersResponse, TransactionKind } from "@/lib/types";

const currency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
});

const transactionOptions: Array<{
  kind: TransactionKind;
  title: string;
  description: string;
  icon: typeof ArrowDownLeft;
  tone: "deposit" | "withdraw" | "c2c";
}> = [
  { kind: "deposit_account", title: "ฝากผ่าน Celox", description: "รับบัญชีปลายทางและแนบสลิปเพื่อตรวจรายการ", icon: ArrowDownLeft, tone: "deposit" },
  { kind: "withdraw_account", title: "ถอนผ่าน Celox", description: "สร้างรายการ ตรวจบัญชีผู้รับ และยืนยันจ่ายเงิน", icon: ArrowUpRight, tone: "withdraw" },
  { kind: "deposit_c2c", title: "ฝากแบบ C2C", description: "จับคู่บัญชีรับเงินและแนบสลิปผ่าน Celox", icon: ArrowLeftRight, tone: "c2c" },
  { kind: "withdraw_c2c", title: "ถอนแบบ C2C", description: "กันยอดแล้วรอผู้ฝากที่มียอดเท่ากัน", icon: ArrowLeftRight, tone: "c2c" },
];

function formatActivity(value: string | null) {
  if (!value) return "ยังไม่มีรายการ";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function callbackStateLabel(callback: CeloxCallbackEvent) {
  switch (callback.processingState) {
    case "applied":
      return "อัปเดตยอดแล้ว";
    case "recorded":
      return "บันทึกสถานะแล้ว";
    case "unmatched":
      return "ยังไม่พบรายการ Celox";
    case "failed":
      return "ประมวลผลไม่สำเร็จ";
    default:
      return "รอประมวลผล";
  }
}

function withdrawalHoldStateLabel(hold: CeloxWithdrawalHold) {
  switch (hold.state) {
    case "creating":
      return "กำลังสร้างรายการ";
    case "ready":
      return "รอยืนยันถอน";
    case "confirming":
      return "กำลังยืนยันถอน";
    default:
      return "ต้องตรวจสอบ";
  }
}

export default function CustomersPage() {
  const callbackRequestRef = useRef(0);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogCustomerId, setDialogCustomerId] = useState<string | null>(null);
  const [kind, setKind] = useState<TransactionKind | null>(null);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [callbackCustomerId, setCallbackCustomerId] = useState<string | null>(null);
  const [callbackData, setCallbackData] = useState<CustomerCeloxCallbacksResponse | null>(null);
  const [callbackLoading, setCallbackLoading] = useState(false);
  const [callbackError, setCallbackError] = useState("");
  const [retryingCallbackId, setRetryingCallbackId] = useState<number | null>(null);
  const [resolvingWithdrawalHoldKey, setResolvingWithdrawalHoldKey] = useState<string | null>(null);

  const loadCustomers = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    try {
      const response = await fetch(`/api/customers?${params}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("โหลดข้อมูลลูกค้าไม่สำเร็จ");
      setData(await response.json() as CustomersResponse);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : "โหลดข้อมูลลูกค้าไม่สำเร็จ");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [fromDate, search, toDate]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => loadCustomers(controller.signal), 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadCustomers]);

  const selectedCustomer = useMemo(
    () => data?.allCustomers.find((customer) => customer.id === dialogCustomerId) ?? null,
    [data?.allCustomers, dialogCustomerId],
  );
  const otherCustomers = useMemo(
    () => data?.allCustomers.filter((customer) => customer.id !== dialogCustomerId) ?? [],
    [data?.allCustomers, dialogCustomerId],
  );
  const selectedOption = transactionOptions.find((option) => option.kind === kind) ?? null;
  const numericAmount = Number(amount.replaceAll(",", "")) || 0;
  const isC2C = kind?.endsWith("_c2c") ?? false;
  const isWithdraw = kind?.startsWith("withdraw") ?? false;
  const counterpart = otherCustomers.find((customer) => customer.id === counterpartyId) ?? null;

  function openTransaction(customerId?: string) {
    const initialCustomerId = customerId ?? data?.customers[0]?.id ?? null;
    setDialogCustomerId(initialCustomerId);
    setKind(null);
    setCounterpartyId("");
    setAmount("");
    setNote("");
    setReviewing(false);
    setFormError("");
  }

  function closeDialog(force = false) {
    if (submitting && !force) return;
    setDialogCustomerId(null);
    setReviewing(false);
    setFormError("");
  }

  function completeDeposit() {
    closeDialog(true);
    void loadCustomers();
  }

  async function loadCallbacks(customerId: string) {
    const requestId = callbackRequestRef.current + 1;
    callbackRequestRef.current = requestId;
    setCallbackLoading(true);
    setCallbackError("");
    try {
      const response = await fetch(`/api/customers/${encodeURIComponent(customerId)}/celox-callbacks?limit=10`, {
        cache: "no-store",
      });
      const result = await response.json() as CustomerCeloxCallbacksResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "โหลด Callback ไม่สำเร็จ");
      if (callbackRequestRef.current === requestId) setCallbackData(result);
    } catch (error) {
      if (callbackRequestRef.current === requestId) {
        setCallbackError(error instanceof Error ? error.message : "โหลด Callback ไม่สำเร็จ");
      }
    } finally {
      if (callbackRequestRef.current === requestId) setCallbackLoading(false);
    }
  }

  function toggleCallbacks(customerId: string) {
    if (callbackCustomerId === customerId) {
      callbackRequestRef.current += 1;
      setCallbackCustomerId(null);
      setCallbackData(null);
      setCallbackError("");
      return;
    }
    setCallbackCustomerId(customerId);
    setCallbackData(null);
    void loadCallbacks(customerId);
  }

  async function retryCallback(customerId: string, eventId: number) {
    setRetryingCallbackId(eventId);
    setCallbackError("");
    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(customerId)}/celox-callbacks/${eventId}/retry`,
        { method: "POST" },
      );
      const result = await response.json() as { callback?: CeloxCallbackEvent; error?: string };
      if (!response.ok || !result.callback) {
        throw new Error(result.error || "ประมวลผล Callback ไม่สำเร็จ");
      }
      setToast(result.callback.processingState === "applied"
        ? `อัปเดตยอดจาก Callback แล้ว · ${result.callback.orderId}`
        : `ประมวลผล Callback แล้ว · ${callbackStateLabel(result.callback)}`);
      await Promise.all([loadCallbacks(customerId), loadCustomers()]);
      window.setTimeout(() => setToast(""), 3_600);
    } catch (error) {
      setCallbackError(error instanceof Error ? error.message : "ประมวลผล Callback ไม่สำเร็จ");
    } finally {
      setRetryingCallbackId(null);
    }
  }

  async function resolveWithdrawalHold(customerId: string, hold: CeloxWithdrawalHold) {
    const action = hold.kind === "creation" ? "release-reservation" : "reset-confirmation";
    const warning = hold.kind === "creation"
      ? `ยืนยันว่าตรวจใน Celox Console แล้วว่าไม่มีรายการถอนนี้และยังไม่มีการจ่ายเงินใช่หรือไม่?\n\nระบบจะคืนยอดที่พักไว้ ${currency.format(hold.amount)} ให้ลูกค้า หาก Celox จ่ายเงินแล้ว ห้ามกดปุ่มนี้`
      : "ยืนยันว่าตรวจใน Celox Console แล้วว่ารายการนี้ยังไม่จ่ายสำเร็จใช่หรือไม่?\n\nระบบจะเปิดให้ยืนยันรายการเดิมอีกครั้งและยังคงพักยอดเงินไว้ หาก Celox จ่ายเงินแล้ว ห้ามกดปุ่มนี้";
    if (!window.confirm(warning)) return;

    setResolvingWithdrawalHoldKey(hold.key);
    setCallbackError("");
    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(customerId)}/celox-withdrawal-holds/${encodeURIComponent(hold.key)}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const result = await response.json() as CustomerCeloxCallbacksResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "แก้ยอดพักถอนไม่สำเร็จ");
      setCallbackData(result);
      setToast(hold.kind === "creation"
        ? `คืนยอดพักถอน ${currency.format(hold.amount)} แล้ว`
        : "เปิดให้ยืนยันรายการถอนเดิมอีกครั้งแล้ว");
      await loadCustomers();
      window.setTimeout(() => setToast(""), 3_600);
    } catch (error) {
      setCallbackError(error instanceof Error ? error.message : "แก้ยอดพักถอนไม่สำเร็จ");
    } finally {
      setResolvingWithdrawalHoldKey(null);
    }
  }

  function chooseKind(nextKind: TransactionKind) {
    setKind(nextKind);
    setReviewing(false);
    setFormError("");
    const firstCounterparty = otherCustomers[0]?.id ?? "";
    if (nextKind.endsWith("_c2c") && !counterpartyId) setCounterpartyId(firstCounterparty);
  }

  function reviewTransaction(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    if (!selectedCustomer || !kind) return;
    if (numericAmount <= 0) return setFormError("กรุณากรอกจำนวนเงินมากกว่า 0 บาท");
    if (isC2C && !counterpartyId) return setFormError("กรุณาเลือกลูกค้าคู่รายการ C2C");
    const sourceBalance = kind === "deposit_c2c" ? counterpart?.withdrawableBalance : selectedCustomer.withdrawableBalance;
    if ((isWithdraw || kind === "deposit_c2c") && sourceBalance !== undefined && numericAmount > sourceBalance) {
      return setFormError("ยอดเงินที่ถอนได้ของบัญชีต้นทางไม่เพียงพอ");
    }
    setReviewing(true);
  }

  async function confirmTransaction() {
    if (!selectedCustomer || !kind || numericAmount <= 0) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          kind,
          amount: numericAmount,
          counterpartyCustomerId: isC2C ? counterpartyId : undefined,
          note,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "บันทึกรายการไม่สำเร็จ");
      setToast(`${selectedOption?.title ?? "ทำรายการ"} ${currency.format(numericAmount)} สำเร็จ`);
      setSubmitting(false);
      closeDialog(true);
      await loadCustomers();
      window.setTimeout(() => setToast(""), 3600);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "บันทึกรายการไม่สำเร็จ");
      setReviewing(false);
    } finally {
      setSubmitting(false);
    }
  }

  const summary = data?.summary;

  return (
    <AppShell active="customers" searchValue={search} onSearchChange={setSearch} searchPlaceholder="ค้นหาชื่อ บัญชี หรือเบอร์โทรลูกค้า">
      <div className="page-wrap customers-page">
        <section className="page-heading customer-heading">
          <div>
            <div className="heading-with-count"><h1>รายชื่อลูกค้า</h1>{summary && <span>{summary.customerCount} บัญชี</span>}</div>
            <p>ตรวจสอบยอดคงเหลือและจัดการเงินของลูกค้าแต่ละราย</p>
          </div>
          <button className="button deposit-button" onClick={() => openTransaction()} disabled={!data?.customers.length}><CircleDollarSign size={18} />ทำรายการใหม่</button>
        </section>

        <section className="customer-summary" aria-label="ภาพรวมลูกค้า">
          <article>
            <span className="summary-symbol deposit"><ArrowDownLeft size={18} /></span>
            <div><span>ยอดฝากทั้งหมด</span><strong>{summary ? currency.format(summary.depositTotal) : "—"}</strong><small>ตามช่วงวันที่ที่เลือก</small></div>
          </article>
          <article>
            <span className="summary-symbol withdraw"><ArrowUpRight size={18} /></span>
            <div><span>ยอดถอนทั้งหมด</span><strong>{summary ? currency.format(summary.withdrawTotal) : "—"}</strong><small>ตามช่วงวันที่ที่เลือก</small></div>
          </article>
          <article className="available-summary">
            <span className="summary-symbol available"><ShieldCheck size={18} /></span>
            <div><span>ยอดเงินที่ถอนได้</span><strong>{summary ? currency.format(summary.withdrawableTotal) : "—"}</strong><small>รวมทุกบัญชี ณ ปัจจุบัน</small></div>
          </article>
        </section>

        <section className="customer-directory">
          <div className="customer-toolbar">
            <div>
              <h2>บัญชีลูกค้า</h2>
              <p>ยอดฝาก–ถอนในตารางจะเปลี่ยนตามช่วงวันที่</p>
            </div>
            <div className="date-filters">
              <label><span>ตั้งแต่</span><div><CalendarDays size={16} /><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></div></label>
              <span className="date-separator">ถึง</span>
              <label><span>จนถึง</span><div><CalendarDays size={16} /><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></div></label>
              {(fromDate || toDate) && <button className="clear-filter" onClick={() => { setFromDate(""); setToDate(""); }}><RefreshCcw size={15} />ล้างวันที่</button>}
            </div>
          </div>

          <div className="table-wrap customer-table-wrap">
            <table className="customer-table">
              <thead><tr><th>ลูกค้า</th><th className="align-right">ยอดคงเหลือ</th><th className="align-right">ถอนได้</th><th className="align-right">ยอดฝาก</th><th className="align-right">ยอดถอน</th><th>รายการล่าสุด</th><th><span className="sr-only">จัดการ</span></th></tr></thead>
              <tbody>
                {!loading && data?.customers.map((customer) => (
                  <Fragment key={customer.id}>
                    <tr>
                      <td><div className="customer-cell"><span className={`avatar ${customer.color}`}>{customer.initials}</span><span><strong>{customer.name}</strong><small>{customer.account} · {customer.phone}</small></span></div></td>
                      <td className="customer-money"><strong>{currency.format(customer.balance)}</strong><small>ยอดรวม</small></td>
                      <td className="customer-money available"><strong>{currency.format(customer.withdrawableBalance)}</strong><small>{customer.withdrawableBalance < customer.balance ? `พักยอด ${currency.format(customer.balance - customer.withdrawableBalance)}` : "ถอนได้ทั้งหมด"}</small></td>
                      <td className="customer-money deposit"><strong>{customer.depositTotal > 0 ? `+${currency.format(customer.depositTotal).replace("฿", "")}` : currency.format(0)}</strong><small>C2C {currency.format(customer.c2cDepositTotal)}</small></td>
                      <td className="customer-money withdraw"><strong>{customer.withdrawTotal > 0 ? `−${currency.format(customer.withdrawTotal).replace("฿", "")}` : currency.format(0)}</strong><small>C2C {currency.format(customer.c2cWithdrawTotal)}</small></td>
                      <td><div className="last-activity"><Clock3 size={15} /><span>{formatActivity(customer.lastActivity)}</span></div></td>
                      <td>
                        <div className="customer-row-actions">
                          <button
                            type="button"
                            className="button callback-row-button"
                            onClick={() => toggleCallbacks(customer.id)}
                            aria-label={`ดู Callback จาก Celox ของ ${customer.name}`}
                            aria-expanded={callbackCustomerId === customer.id}
                            aria-controls={`customer-callback-${customer.id}`}
                          ><Webhook size={14} />Callback</button>
                          <button type="button" className="button row-transaction-button" onClick={() => openTransaction(customer.id)}>ทำรายการ</button>
                        </div>
                      </td>
                    </tr>
                    {callbackCustomerId === customer.id && (
                      <tr className="customer-callback-row">
                        <td colSpan={7}>
                          <section
                            id={`customer-callback-${customer.id}`}
                            className="customer-callback-panel"
                            aria-live="polite"
                            aria-busy={callbackLoading}
                          >
                            <header>
                              <div><span className="callback-panel-icon"><Webhook size={18} /></span><span><strong>Callback ที่ได้รับจาก Celox</strong><small>ระบบรับอัตโนมัติ ปุ่มนี้ใช้ดูข้อมูลและประมวลผลงานที่ค้าง ไม่ได้ส่งคำขอไป Celox</small></span></div>
                              <button type="button" onClick={() => void loadCallbacks(customer.id)} disabled={callbackLoading}><RefreshCcw className={callbackLoading ? "spin" : ""} size={15} />รีเฟรช</button>
                            </header>

                            {callbackLoading && <div className="callback-panel-state"><RefreshCcw className="spin" size={18} />กำลังโหลด Callback…</div>}
                            {!callbackLoading && callbackError && <div className="callback-panel-state error" role="alert"><AlertTriangle size={18} /><span>{callbackError}</span><button type="button" onClick={() => void loadCallbacks(customer.id)}>ลองโหลดใหม่</button></div>}
                            {!callbackLoading && !callbackError && callbackData?.customerId === customer.id && callbackData.callbacks.length === 0 && callbackData.withdrawalHolds.length === 0 && (
                              <div className="callback-panel-state empty"><Webhook size={19} /><span><strong>ยังไม่ได้รับ Callback จาก Celox</strong><small>เมื่อธุรกรรมจบ Celox จะ POST มาที่ endpoint ที่ตั้งไว้ใน Console โดยอัตโนมัติ</small></span></div>
                            )}
                            {!callbackLoading && !callbackError && callbackData?.customerId === customer.id && callbackData.withdrawalHolds.length > 0 && (
                              <section className="withdrawal-hold-section" aria-labelledby={`withdrawal-hold-title-${customer.id}`}>
                                <header>
                                  <span><AlertTriangle size={17} /></span>
                                  <div>
                                    <strong id={`withdrawal-hold-title-${customer.id}`}>ยอดถอนที่ระบบพักไว้</strong>
                                    <small>ตรวจใน Celox Console ก่อนทุกครั้ง หากพบรายการหรือ SUCCESS ให้ส่ง signed Callback ซ้ำและห้ามคืนยอด</small>
                                  </div>
                                </header>
                                <ul>
                                  {callbackData.withdrawalHolds.map((hold) => (
                                    <li key={`${hold.kind}-${hold.key}`}>
                                      <div className="withdrawal-hold-heading">
                                        <span>
                                          <strong>{hold.kind === "creation" ? "ช่วงสร้างรายการ" : "ช่วงยืนยันรายการ"}</strong>
                                          <small className={`withdrawal-hold-state ${hold.state}`}>{withdrawalHoldStateLabel(hold)}</small>
                                        </span>
                                        <strong>{currency.format(hold.amount)}</strong>
                                      </div>
                                      <dl>
                                        <div><dt>Order ID</dt><dd>{hold.orderId ?? "ยังไม่ได้รับจาก Celox"}</dd></div>
                                        <div><dt>Reference ID</dt><dd>{hold.referenceId ?? "—"}</dd></div>
                                        <div><dt>อัปเดตล่าสุด</dt><dd>{formatActivity(hold.updatedAt)}</dd></div>
                                      </dl>
                                      <div className="withdrawal-hold-result">
                                        <span>{hold.state === "uncertain"
                                          ? "ผลจาก Celox ไม่แน่นอน จึงยังพักยอดไว้และรอ Callback หรือการตรวจสอบจากผู้ดูแล"
                                          : hold.state === "ready"
                                            ? "สร้างรายการแล้วและพักยอดไว้ รอการยืนยันถอน"
                                            : "คำขอกำลังดำเนินการ หากค้างเกิน 5 นาทีระบบจะเปิดทางให้ผู้ดูแลแก้สถานะ"}</span>
                                        {hold.canResolve && (
                                          <button
                                            type="button"
                                            onClick={() => void resolveWithdrawalHold(customer.id, hold)}
                                            disabled={resolvingWithdrawalHoldKey !== null}
                                          >
                                            <AlertTriangle size={14} />
                                            {resolvingWithdrawalHoldKey === hold.key
                                              ? "กำลังแก้สถานะ…"
                                              : hold.kind === "creation"
                                                ? "ตรวจแล้ว คืนยอดที่พักไว้"
                                                : "ตรวจแล้ว เปิดให้ยืนยันอีกครั้ง"}
                                          </button>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            )}
                            {!callbackLoading && !callbackError && callbackData?.customerId === customer.id && callbackData.callbacks.length > 0 && (
                              <ul className="callback-event-list">
                                {callbackData.callbacks.map((callback) => (
                                  <li key={callback.id}>
                                    <div className="callback-event-heading">
                                      <div><span className={`callback-state ${callback.processingState}`}>{callback.processingState === "applied" ? <Check size={13} /> : callback.processingState === "failed" || callback.processingState === "unmatched" ? <AlertTriangle size={13} /> : <Clock3 size={13} />}{callbackStateLabel(callback)}</span>{callback.direction && <span className={`callback-direction ${callback.direction}`}>{callback.direction === "deposit" ? "ฝาก" : "ถอน"}</span>}<strong>{callback.status}</strong>{callback.receivedCount > 1 && <small>รับซ้ำ {callback.receivedCount} ครั้ง · ไม่เพิ่มยอดซ้ำ</small>}</div>
                                      <span><strong>{currency.format(callback.amount)}</strong><time dateTime={callback.receivedAt}>รับเมื่อ {formatActivity(callback.receivedAt)}</time></span>
                                    </div>
                                    <dl className="callback-event-details">
                                      <div><dt>Order ID</dt><dd>{callback.orderId}</dd></div>
                                      <div><dt>Transaction ID</dt><dd>{callback.transactionId}</dd></div>
                                      <div><dt>Reference ID</dt><dd>{callback.referenceId ?? "—"}</dd></div>
                                      <div><dt>เวลาที่รายการจบ</dt><dd>{callback.occurredAt ? formatActivity(callback.occurredAt) : "ยังไม่จบรายการ"}</dd></div>
                                    </dl>
                                    <div className={`callback-event-result ${callback.processingState}`}>
                                      <span>{callback.localTransactionId
                                        ? `อัปเดตยอดแล้ว · ${callback.localTransactionId}`
                                        : callback.lastError || (callback.status === "SUCCESS" ? "ยังไม่อัปเดตยอด" : "สถานะนี้ยังไม่เปลี่ยนยอดเงิน")}</span>
                                      {(callback.processingState === "pending" || callback.processingState === "failed" || callback.processingState === "unmatched") && <button type="button" onClick={() => void retryCallback(customer.id, callback.id)} disabled={retryingCallbackId !== null}><RefreshCcw className={retryingCallbackId === callback.id ? "spin" : ""} size={14} />{retryingCallbackId === callback.id ? "กำลังประมวลผล…" : "ประมวลผลอีกครั้ง"}</button>}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>

            {loading && <div className="customer-loading" aria-label="กำลังโหลดข้อมูล"><i /><i /><i /><i /></div>}
            {!loading && loadError && <div className="customer-empty error"><Search size={24} /><strong>{loadError}</strong><button onClick={() => loadCustomers()}>ลองอีกครั้ง</button></div>}
            {!loading && !loadError && !data?.customers.length && <div className="customer-empty"><UserRound size={25} /><strong>ไม่พบลูกค้าที่ค้นหา</strong><span>ลองเปลี่ยนคำค้นหาหรือช่วงวันที่</span></div>}
          </div>
          <div className="table-footer"><span>แสดง {data?.customers.length ?? 0} รายการ</span><span>ข้อมูลยอดเงินมาจาก SQLite</span></div>
        </section>
      </div>

      {dialogCustomerId && selectedCustomer && kind === "deposit_account" && (
        <DepositFlowDialog
          customer={selectedCustomer}
          customers={data?.allCustomers ?? []}
          onCustomerChange={setDialogCustomerId}
          onClose={() => closeDialog(true)}
          onCompleted={completeDeposit}
        />
      )}

      {dialogCustomerId && selectedCustomer && kind === "withdraw_account" && (
        <WithdrawalFlowDialog
          customer={selectedCustomer}
          customers={data?.allCustomers ?? []}
          onCustomerChange={setDialogCustomerId}
          onClose={() => closeDialog(true)}
          onCompleted={() => void loadCustomers()}
        />
      )}

      {dialogCustomerId && selectedCustomer && kind === "deposit_c2c" && (
        <C2CDepositFlowDialog
          customer={selectedCustomer}
          customers={data?.allCustomers ?? []}
          onCustomerChange={setDialogCustomerId}
          onClose={() => closeDialog(true)}
          onChanged={() => void loadCustomers()}
        />
      )}

      {dialogCustomerId && selectedCustomer && kind === "withdraw_c2c" && (
        <C2CWithdrawalFlowDialog
          customer={selectedCustomer}
          customers={data?.allCustomers ?? []}
          onCustomerChange={setDialogCustomerId}
          onClose={() => closeDialog(true)}
          onChanged={() => void loadCustomers()}
        />
      )}

      {dialogCustomerId && selectedCustomer && kind !== "deposit_account" && kind !== "withdraw_account" && kind !== "deposit_c2c" && kind !== "withdraw_c2c" && (
        <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
          <section className="transaction-dialog customer-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
            <div className="dialog-header">
              <div><span className="dialog-icon brand"><CircleDollarSign size={20} /></span><div><h2 id="customer-dialog-title">{reviewing ? "ตรวจสอบรายการ" : kind ? selectedOption?.title : "เลือกรูปแบบรายการ"}</h2><p>{selectedCustomer.name} · {selectedCustomer.account}</p></div></div>
              <button className="icon-button" onClick={() => closeDialog()} aria-label="ปิด"><X size={20} /></button>
            </div>

            {!kind ? (
              <div className="transaction-kind-picker">
                <p>เลือกวิธีจัดการยอดเงินสำหรับลูกค้ารายนี้</p>
                <div className="kind-grid">
                  {transactionOptions.map((option) => {
                    const Icon = option.icon;
                    return <button key={option.kind} onClick={() => chooseKind(option.kind)}><span className={`kind-icon ${option.tone}`}><Icon size={19} /></span><span><strong>{option.title}</strong><small>{option.description}</small></span><ArrowUpRight size={15} /></button>;
                  })}
                </div>
                <div className="c2c-explainer"><ArrowLeftRight size={17} /><span><strong>Celox C2C ทำงานอย่างไร?</strong> ระบบจับคู่ฝาก–ถอนที่ยอดเท่ากัน ฝั่งฝากเห็นบัญชีปลายทางเฉพาะตอนโอน ส่วนฝั่งถอนไม่เห็นข้อมูลคู่รายการ</span></div>
              </div>
            ) : !reviewing ? (
              <form className="transaction-form" onSubmit={reviewTransaction}>
                <button type="button" className="change-kind" onClick={() => setKind(null)}>เปลี่ยนรูปแบบรายการ</button>
                <label><span>ลูกค้า</span><div className="select-wrap"><select value={dialogCustomerId} onChange={(event) => { const nextId = event.target.value; setDialogCustomerId(nextId); setCounterpartyId(data?.allCustomers.find((customer) => customer.id !== nextId)?.id ?? ""); }}>{data?.allCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.account}</option>)}</select><ChevronDown size={17} /></div></label>
                {isC2C && <label><span>{kind === "deposit_c2c" ? "รับเงินจากลูกค้า" : "ส่งเงินให้ลูกค้า"}</span><div className="select-wrap"><select value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>{otherCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.account} · ถอนได้ {currency.format(customer.withdrawableBalance)}</option>)}</select><ChevronDown size={17} /></div></label>}
                <label><span>จำนวนเงิน</span><div className="money-input"><span>฿</span><input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" /></div><small>ยอดที่ถอนได้ของ {kind === "deposit_c2c" ? (counterpart?.name ?? "บัญชีต้นทาง") : selectedCustomer.name}: {currency.format(kind === "deposit_c2c" ? (counterpart?.withdrawableBalance ?? 0) : selectedCustomer.withdrawableBalance)}</small></label>
                <label><span>บันทึกช่วยจำ <em>(ไม่บังคับ)</em></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={isC2C ? "เช่น โอนยอดระหว่างบัญชีลูกค้า" : "เช่น ฝากเงินผ่านเคาน์เตอร์"} rows={3} maxLength={100} /></label>
                {formError && <div className="form-error" role="alert">{formError}</div>}
                <div className="dialog-actions"><button type="button" className="button secondary-button" onClick={() => closeDialog()}>ยกเลิก</button><button type="submit" className="button deposit-button">ตรวจสอบรายการ</button></div>
              </form>
            ) : (
              <div className="review-content customer-review">
                <div className="review-amount"><span>{selectedOption?.title}</span><strong>{currency.format(numericAmount)}</strong></div>
                <dl>
                  <div><dt>ลูกค้า</dt><dd>{selectedCustomer.name}<small>{selectedCustomer.account}</small></dd></div>
                  {isC2C && <div><dt>{kind === "deposit_c2c" ? "ผู้โอน" : "ผู้รับ"}</dt><dd>{counterpart?.name}<small>{counterpart?.account}</small></dd></div>}
                  <div><dt>การเปลี่ยนแปลง</dt><dd>{isC2C ? "ปรับยอดทั้งสองบัญชี" : isWithdraw ? "ลดยอดคงเหลือ" : "เพิ่มยอดคงเหลือ"}</dd></div>
                  <div><dt>บันทึก</dt><dd>{note || "—"}</dd></div>
                </dl>
                <div className="confirm-note"><Check size={17} /><span>{isC2C ? "ระบบจะบันทึก ledger ต้นทางและปลายทางในครั้งเดียว" : "รายการจะปรากฏในหน้าธุรกรรมทันที"}</span></div>
                {formError && <div className="form-error" role="alert">{formError}</div>}
                <div className="dialog-actions"><button className="button secondary-button" onClick={() => setReviewing(false)} disabled={submitting}>ย้อนกลับ</button><button className="button deposit-button" onClick={confirmTransaction} disabled={submitting}>{submitting ? "กำลังบันทึก…" : "ยืนยันรายการ"}</button></div>
              </div>
            )}
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span><Check size={16} /></span>{toast}</div>}
    </AppShell>
  );
}
