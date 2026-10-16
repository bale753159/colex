"use client";

import { AlertTriangle, FileClock, RefreshCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import AppShell from "@/app/components/app-shell";
import type { CeloxC2CCallbackRawLogItem, CeloxC2CCallbackRawLogsResponse } from "@/lib/celox/types";

const dateTime = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Bangkok",
});

function statusTone(status: number) {
  if (status < 300) return "success";
  if (status < 500) return "warning";
  return "pending";
}

function prettyBody(body: string | null) {
  if (!body) return "ไม่มีข้อมูล";
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export default function C2CCallbackLogsPage() {
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState<CeloxC2CCallbackRawLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<CeloxC2CCallbackRawLogItem | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/celox/c2c/callback-logs?limit=100", { cache: "no-store" });
      const result = await response.json() as CeloxC2CCallbackRawLogsResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "โหลด log callback ไม่สำเร็จ");
      setLogs(result.logs);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "โหลด log callback ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLogs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return (
    <AppShell active="callback-logs" searchValue={search} onSearchChange={setSearch} searchPlaceholder="ค้นหาลูกค้า เลขที่บัญชี หรือธุรกรรม">
      <div className="page-wrap">
        <section className="page-heading">
          <div><h1>Log Callback C2C</h1><p>ประวัติ callback ขาเข้าจาก Celox ทั้งหมด รวมรายการที่ไม่ผ่านการตรวจลายเซ็นหรือ validate</p></div>
          <button className="icon-button" onClick={() => void loadLogs()} aria-label="โหลด log ใหม่" disabled={loading}><RefreshCcw className={loading ? "spin" : ""} size={18} /></button>
        </section>

        {loadError && <div className="load-error" role="alert"><AlertTriangle size={20} /><span>{loadError}</span><button className="button secondary-button" onClick={() => void loadLogs()}>ลองใหม่</button></div>}

        <section className="customer-directory">
          <div className="table-wrap customer-table-wrap">
            <table className="customer-table callback-log-table">
              <thead><tr><th>วันที่เวลา</th><th>URL</th><th>Response</th></tr></thead>
              <tbody>
                {!loading && logs.map((log) => (
                  <tr key={log.id} className="callback-log-row" onClick={() => setSelected(log)}>
                    <td>{dateTime.format(new Date(log.receivedAt))}</td>
                    <td className="callback-log-url">{log.requestUrl}</td>
                    <td><span className={`c2c-status ${statusTone(log.responseStatus)}`}>{log.responseStatus}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {loading && <div className="customer-loading" aria-label="กำลังโหลด"><i /><i /><i /><i /></div>}
            {!loading && !loadError && logs.length === 0 && <div className="customer-empty"><FileClock size={25} /><strong>ยังไม่มี log callback</strong><span>เมื่อ Celox ยิง callback C2C เข้ามา รายการจะปรากฏที่นี่</span></div>}
          </div>
          <div className="table-footer"><span>แสดง {logs.length} รายการล่าสุด</span><span>คลิกแถวเพื่อดู request/response แบบเต็ม</span></div>
        </section>
      </div>

      {selected && (
        <div
          className="c2c-detail-drawer"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}
        >
          <section className="c2c-detail-panel" aria-labelledby="callback-log-detail-title">
            <header className="c2c-detail-header">
              <div><h2 id="callback-log-detail-title">{dateTime.format(new Date(selected.receivedAt))}</h2><p>{selected.requestUrl}</p></div>
              <div className="c2c-detail-header-end">
                <span className={`c2c-status large ${statusTone(selected.responseStatus)}`}>{selected.responseStatus}</span>
                <button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="ปิดรายละเอียด"><X size={19} /></button>
              </div>
            </header>
            <div className="callback-log-body"><h3>Request Body</h3><pre>{prettyBody(selected.requestBody)}</pre></div>
            <div className="callback-log-body"><h3>Response Body</h3><pre>{prettyBody(selected.responseBody)}</pre></div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
