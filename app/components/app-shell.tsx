"use client";

import {
  ArrowLeftRight,
  Bell,
  ChevronDown,
  LayoutDashboard,
  Menu,
  ReceiptText,
  Search,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import logo from "@/app/logo-it.png";
import { useEffect, useRef, useState, type ReactNode } from "react";

type AppShellProps = {
  active: "overview" | "transactions" | "c2c" | "customers";
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  children: ReactNode;
};

const navItems = [
  { id: "overview", label: "ภาพรวม", href: "/", icon: LayoutDashboard },
  { id: "transactions", label: "ธุรกรรม", href: "/#transactions", icon: ReceiptText },
  { id: "c2c", label: "รายการ C2C", href: "/c2c-transactions", icon: ArrowLeftRight },
  { id: "customers", label: "ลูกค้า", href: "/customers", icon: Users },
] as const;

export default function AppShell({ active, searchValue, onSearchChange, searchPlaceholder = "ค้นหาลูกค้า เลขที่บัญชี หรือธุรกรรม", children }: AppShellProps) {
  const [mobileNav, setMobileNav] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setMobileNav(false);
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <Image className="brand-mark" src={logo} alt="" width={40} height={40} priority />
          <span><strong>ITStore</strong><small>TECH FOR A BETTER YOU</small></span>
          <button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="ปิดเมนู"><X size={20} /></button>
        </div>

        <nav className="primary-nav" aria-label="เมนูหลัก">
          {navItems.map((item) => {
            const Icon = item.icon;
            return <Link key={item.id} className={active === item.id ? "active" : ""} href={item.href} onClick={() => setMobileNav(false)}><Icon size={19} />{item.label}</Link>;
          })}
        </nav>

        <div className="sidebar-status">
          <span className="status-dot" />
          <span><strong>Supabase พร้อมใช้งาน</strong><small>บันทึกข้อมูลบน Supabase</small></span>
        </div>
      </aside>

      {mobileNav && <button className="nav-backdrop" aria-label="ปิดเมนู" onClick={() => setMobileNav(false)} />}

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand-wrap">
            <button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="เปิดเมนู"><Menu size={21} /></button>
            <Image className="brand-mark small" src={logo} alt="ITStore" width={32} height={32} priority />
          </div>
          <label className="global-search">
            <Search size={18} />
            <input ref={searchRef} value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} aria-label="ค้นหา" />
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
        {children}
      </main>
    </div>
  );
}
