"use client";

import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/app/components/app-shell";
import C2CDepositFlowDialog from "@/app/components/c2c-deposit-flow-dialog";
import C2CWithdrawalFlowDialog from "@/app/components/c2c-withdrawal-flow-dialog";
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

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogCustomerId, setDialogCustomerId] = useState<string | null>(null);
  const [kind, setKind] = useState<TransactionKind | null>(null);

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

  function openTransaction(customerId?: string) {
    setDialogCustomerId(customerId ?? data?.customers[0]?.id ?? null);
    setKind(null);
  }

  function closeDialog() {
    setDialogCustomerId(null);
    setKind(null);
  }

  function chooseKind(nextKind: TransactionKind) {
    setKind(nextKind);
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
                  <tr key={customer.id}>
                    <td><div className="customer-cell"><span className={`avatar ${customer.color}`}>{customer.initials}</span><span><strong>{customer.name}</strong><small>{customer.account} · {customer.phone}</small></span></div></td>
                    <td className="customer-money"><strong>{currency.format(customer.balance)}</strong><small>ยอดรวม</small></td>
                    <td className="customer-money available"><strong>{currency.format(customer.withdrawableBalance)}</strong><small>{customer.withdrawableBalance < customer.balance ? `พักยอด ${currency.format(customer.balance - customer.withdrawableBalance)}` : "ถอนได้ทั้งหมด"}</small></td>
                    <td className="customer-money deposit"><strong>{customer.depositTotal > 0 ? `+${currency.format(customer.depositTotal).replace("฿", "")}` : currency.format(0)}</strong><small>C2C {currency.format(customer.c2cDepositTotal)}</small></td>
                    <td className="customer-money withdraw"><strong>{customer.withdrawTotal > 0 ? `−${currency.format(customer.withdrawTotal).replace("฿", "")}` : currency.format(0)}</strong><small>C2C {currency.format(customer.c2cWithdrawTotal)}</small></td>
                    <td><div className="last-activity"><Clock3 size={15} /><span>{formatActivity(customer.lastActivity)}</span></div></td>
                    <td>
                      <div className="customer-row-actions">
                        <button type="button" className="button row-transaction-button" onClick={() => openTransaction(customer.id)}>ทำรายการ</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {loading && <div className="customer-loading" aria-label="กำลังโหลดข้อมูล"><i /><i /><i /><i /></div>}
            {!loading && loadError && <div className="customer-empty error"><Search size={24} /><strong>{loadError}</strong><button onClick={() => loadCustomers()}>ลองอีกครั้ง</button></div>}
            {!loading && !loadError && !data?.customers.length && <div className="customer-empty"><UserRound size={25} /><strong>ไม่พบลูกค้าที่ค้นหา</strong><span>ลองเปลี่ยนคำค้นหาหรือช่วงวันที่</span></div>}
          </div>
          <div className="table-footer"><span>แสดง {data?.customers.length ?? 0} รายการ</span><span>ข้อมูลยอดเงินมาจาก Supabase</span></div>
        </section>
      </div>

      {dialogCustomerId && selectedCustomer && kind === "deposit_c2c" && (
        <C2CDepositFlowDialog
          customer={selectedCustomer}
          onClose={() => closeDialog()}
          onChanged={() => void loadCustomers()}
        />
      )}

      {dialogCustomerId && selectedCustomer && kind === "withdraw_c2c" && (
        <C2CWithdrawalFlowDialog
          customer={selectedCustomer}
          onClose={() => closeDialog()}
          onChanged={() => void loadCustomers()}
        />
      )}

      {dialogCustomerId && selectedCustomer && !kind && (
        <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
          <section className="transaction-dialog customer-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
            <div className="dialog-header">
              <div><span className="dialog-icon brand"><CircleDollarSign size={20} /></span><div><h2 id="customer-dialog-title">เลือกรูปแบบรายการ</h2><p>{selectedCustomer.name} · {selectedCustomer.account}</p></div></div>
              <button className="icon-button" onClick={() => closeDialog()} aria-label="ปิด"><X size={20} /></button>
            </div>

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
          </section>
        </div>
      )}

    </AppShell>
  );
}
