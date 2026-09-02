"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import DepositFlowDialog from "@/app/components/deposit-flow-dialog";
import WithdrawalFlowDialog from "@/app/components/withdrawal-flow-dialog";
import type { Customer, FinanceSummary, Transaction, TransactionsResponse } from "@/lib/types";

type TransactionType = "deposit" | "withdraw";
type FilterType = "all" | TransactionType;

const currency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  notation: "compact",
  maximumFractionDigits: 1,
});

function FinanceIcon({ type }: { type: TransactionType }) {
  return (
    <span className={`transaction-icon ${type}`} aria-hidden="true">
      {type === "deposit" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
    </span>
  );
}

function TransactionStatusBadge({ status }: Pick<Transaction, "status">) {
  if (status === "pending") {
    return <span className="status-badge pending"><Clock3 size={13} />รอ Callback</span>;
  }
  if (status === "failed") {
    return <span className="status-badge failed"><AlertTriangle size={13} />FAILED</span>;
  }
  return <span className="status-badge success"><Check size={13} />SUCCESS</span>;
}

export default function FinanceDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<TransactionType | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  const loadData = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setDataError("");
    try {
      const response = await fetch("/api/transactions?limit=50", { cache: "no-store" });
      if (!response.ok) throw new Error("โหลดข้อมูลธุรกรรมไม่สำเร็จ");
      const result = await response.json() as TransactionsResponse;
      setTransactions(result.transactions);
      setCustomers(result.customers);
      setSummary(result.summary);
      setSelectedCustomer((current) => current || result.customers[0]?.id || "");
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "โหลดข้อมูลธุรกรรมไม่สำเร็จ");
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (!transactions.some((transaction) => transaction.status === "pending")) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadData(true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [loadData, transactions]);

  const visibleTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter((item) => {
      const matchesFilter = filter === "all" || item.type === filter;
      const matchesSearch = !query || `${item.customer.name} ${item.customer.account} ${item.id}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [filter, search, transactions]);

  const activeCustomer = customers.find((customer) => customer.id === selectedCustomer) ?? customers[0];

  function openTransaction(type: TransactionType, customerId = customers[0]?.id ?? "") {
    if (!customerId) return;
    setDataError("");
    setDialog(type);
    setSelectedCustomer(customerId);
  }

  function closeDialog() {
    setDialog(null);
    setDataError("");
  }

  function completeDeposit() {
    closeDialog();
    void loadData();
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">K</span>
          <span><strong>KLANG</strong><small>FINANCE OPS</small></span>
          <button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="ปิดเมนู"><X size={20} /></button>
        </div>

        <nav className="primary-nav" aria-label="เมนูหลัก">
          <a className="active" href="#overview"><LayoutDashboard size={19} />ภาพรวม</a>
          <a href="#transactions"><ReceiptText size={19} />ธุรกรรม</a>
          <a href="/customers"><Users size={19} />ลูกค้า</a>
          <a href="#accounts"><WalletCards size={19} />บัญชีและกระเป๋า</a>
        </nav>

        <div className="nav-section-label">ระบบ</div>
        <nav className="primary-nav secondary" aria-label="เมนูระบบ">
          <a href="#security"><ShieldCheck size={19} />ความปลอดภัย</a>
          <a href="#settings"><Settings size={19} />ตั้งค่า</a>
          <a href="#help"><CircleHelp size={19} />ศูนย์ช่วยเหลือ</a>
        </nav>

        <div className="sidebar-status">
          <span className="status-dot" />
          <span><strong>SQLite พร้อมใช้งาน</strong><small>บันทึกข้อมูลในเครื่อง</small></span>
        </div>
      </aside>

      {mobileNav && <button className="nav-backdrop" aria-label="ปิดเมนู" onClick={() => setMobileNav(false)} />}

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand-wrap">
            <button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="เปิดเมนู"><Menu size={21} /></button>
            <span className="brand-mark small">K</span>
          </div>
          <label className="global-search">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาลูกค้า เลขที่บัญชี หรือธุรกรรม" aria-label="ค้นหา" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar-actions">
            <button className="icon-button notification-button" aria-label="การแจ้งเตือน"><Bell size={19} /><span /></button>
            <div className="user-divider" />
            <button className="profile-button" aria-label="เมนูผู้ใช้">
              <span className="avatar admin">ก</span>
              <span className="profile-copy"><strong>กนกวรรณ</strong><small>Finance Admin</small></span>
              <ChevronDown size={16} />
            </button>
          </div>
        </header>

        <div className="page-wrap" id="overview">
          <section className="page-heading">
            <div>
              <h1>ภาพรวมการเงิน</h1>
              <p>ติดตามยอดและจัดการธุรกรรมทั้งหมดจากที่เดียว</p>
            </div>
            <div className="heading-actions">
              <button className="button secondary-button"><Download size={17} />ส่งออกรายงาน</button>
              <button className="button deposit-button" onClick={() => openTransaction("deposit")} disabled={!customers.length}><ArrowDownLeft size={18} />ฝากเงิน</button>
              <button className="button withdraw-button" onClick={() => openTransaction("withdraw")} disabled={!customers.length}><ArrowUpRight size={18} />ถอนเงิน</button>
            </div>
          </section>

          <section className="overview-grid" aria-label="สรุปการเงิน">
            <div className="balance-panel">
              <div className="balance-heading">
                <span>ยอดคงเหลือรวม</span>
                <button aria-label="ตัวเลือกยอดคงเหลือ"><MoreHorizontal size={20} /></button>
              </div>
              <strong className="balance-amount">{summary ? currency.format(summary.balanceTotal) : "—"}</strong>
              <div className="balance-context"><span><ArrowUpRight size={14} />8.4%</span> เทียบกับเดือนที่แล้ว</div>
              <div className="sparkline" aria-label="แนวโน้มยอดคงเหลือเพิ่มขึ้น 8.4 เปอร์เซ็นต์">
                {[22, 30, 26, 42, 38, 54, 49, 66, 62, 79, 72, 88].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
              </div>
              <div className="balance-footer"><span>อัปเดตล่าสุด</span><strong>วันนี้, 10:42 น.</strong></div>
            </div>

            <div className="metrics-panel">
              <article className="metric-item">
                <div className="metric-top"><span className="metric-icon deposit"><ArrowDownLeft size={18} /></span><span className="trend up">+12.6%</span></div>
                <span className="metric-label">ยอดฝากทั้งหมด</span>
                <strong>{summary ? compactCurrency.format(summary.depositTotal) : "—"}</strong>
                <small>{transactions.filter((item) => item.type === "deposit" && item.status === "success").length} รายการสำเร็จ</small>
              </article>
              <article className="metric-item">
                <div className="metric-top"><span className="metric-icon withdraw"><ArrowUpRight size={18} /></span><span className="trend down">−3.2%</span></div>
                <span className="metric-label">ยอดถอนทั้งหมด</span>
                <strong>{summary ? compactCurrency.format(summary.withdrawTotal) : "—"}</strong>
                <small>{transactions.filter((item) => item.type === "withdraw" && item.status === "success").length} รายการสำเร็จ</small>
              </article>
              <article className="metric-item">
                <div className="metric-top"><span className="metric-icon customer"><Users size={18} /></span><span className="trend up">+4.1%</span></div>
                <span className="metric-label">ลูกค้าที่ทำรายการ</span>
                <strong>{summary?.customerCount ?? "—"}</strong>
                <small>{summary?.transactionCount ?? 0} รายการทั้งหมด</small>
              </article>
            </div>
          </section>

          <section className="transaction-section" id="transactions">
            <div className="section-heading">
              <div><h2>รายการธุรกรรม</h2><p>รายการฝากและถอนล่าสุดของลูกค้า</p></div>
              <div className="filter-tabs" role="group" aria-label="กรองประเภทธุรกรรม">
                {(["all", "deposit", "withdraw"] as FilterType[]).map((item) => (
                  <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                    {item === "all" ? "ทั้งหมด" : item === "deposit" ? "ฝากเงิน" : "ถอนเงิน"}
                  </button>
                ))}
              </div>
            </div>

            {!loading && dataError && (
              <div className="data-error-banner" role="alert">
                <span>{dataError} ข้อมูลเดิมยังคงแสดงอยู่</span>
                <button type="button" onClick={() => { void loadData(); }}>ลองอีกครั้ง</button>
              </div>
            )}

            <div className="table-wrap">
              <table>
                <thead><tr><th>ลูกค้า</th><th>รายการ</th><th>วันและเวลา</th><th>สถานะ</th><th className="align-right">จำนวนเงิน</th><th><span className="sr-only">จัดการ</span></th></tr></thead>
                <tbody>
                  {visibleTransactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td><div className="customer-cell"><span className={`avatar ${transaction.customer.color}`}>{transaction.customer.initials}</span><span><strong>{transaction.customer.name}</strong><small>{transaction.customer.account}</small></span></div></td>
                      <td><div className="type-cell"><FinanceIcon type={transaction.type} /><span><strong>{transaction.channel === "c2c" ? (transaction.type === "deposit" ? "รับโอน C2C" : "ส่งโอน C2C") : (transaction.type === "deposit" ? "ฝากเข้าบัญชี" : "ถอนจากบัญชี")}</strong><small>{transaction.id}</small></span></div></td>
                      <td><div className="date-cell"><strong>{transaction.date}</strong><small>{transaction.time} น.</small></div></td>
                      <td className="status-cell"><TransactionStatusBadge status={transaction.status} /></td>
                      <td className={`amount-cell ${transaction.type} status-${transaction.status}`}>{transaction.type === "deposit" ? "+" : "−"}{currency.format(transaction.amount).replace("฿", "")} <span>฿</span></td>
                      <td><div className="row-actions"><button className="mini-action deposit" onClick={() => openTransaction("deposit", transaction.customer.id)} title="ฝากเงินให้ลูกค้ารายนี้"><ArrowDownLeft size={16} /><span>ฝาก</span></button><button className="mini-action withdraw" onClick={() => openTransaction("withdraw", transaction.customer.id)} title="ถอนเงินให้ลูกค้ารายนี้"><ArrowUpRight size={16} /><span>ถอน</span></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading && <div className="transaction-loading"><i /><i /><i /><i /></div>}
              {!loading && !dataError && visibleTransactions.length === 0 && <div className="empty-state"><Search size={24} /><strong>ไม่พบรายการที่ค้นหา</strong><span>ลองเปลี่ยนคำค้นหาหรือตัวกรองอีกครั้ง</span></div>}
            </div>
            <div className="table-footer"><span>แสดง {visibleTransactions.length} จาก {transactions.length} รายการ</span><button>ดูธุรกรรมทั้งหมด <ArrowUpRight size={15} /></button></div>
          </section>
        </div>
      </main>

      {dialog === "deposit" && activeCustomer && (
        <DepositFlowDialog
          customer={activeCustomer}
          customers={customers}
          onCustomerChange={setSelectedCustomer}
          onClose={closeDialog}
          onChanged={() => { void loadData(true); }}
          onCompleted={completeDeposit}
        />
      )}

      {dialog === "withdraw" && activeCustomer && (
        <WithdrawalFlowDialog
          customer={activeCustomer}
          customers={customers}
          onCustomerChange={setSelectedCustomer}
          onClose={closeDialog}
          onCompleted={() => void loadData()}
        />
      )}
    </div>
  );
}
