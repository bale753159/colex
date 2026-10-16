import { describe, expect, it, vi } from "vitest";
import { C2C_CALLBACK_POLL_INTERVAL_MS, startC2CCallbackPolling } from "./c2c-callback-poll";
import type { CeloxC2CCallbackTimeline } from "./types";

const timeline: CeloxC2CCallbackTimeline = {
  found: true, transactionId: "tx-1", transactionStatus: "PENDING", updatedAt: null, steps: [],
};

function okResponse() {
  return { ok: true, json: async () => timeline } as unknown as Response;
}

async function flush() {
  // ให้ promise chain ของ load() วิ่งจนถึงจุดตั้ง timer
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("startC2CCallbackPolling", () => {
  it("active: false ยังยิงคำขอแรก แต่ไม่ตั้งรอบถัดไป", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse());
    const setTimeoutImpl = vi.fn();
    const onTimeline = vi.fn();

    startC2CCallbackPolling({
      reference: "ORD/1", active: false, onTimeline, onError: vi.fn(),
      fetchImpl: fetchImpl as unknown as typeof fetch, setTimeoutImpl,
    });
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/celox/c2c/ORD%2F1/events");
    expect(onTimeline).toHaveBeenCalledWith(timeline);
    expect(setTimeoutImpl).not.toHaveBeenCalled();
  });

  it("active: true ตั้งรอบถัดไปหลังคำขอเสร็จ (ไม่ซ้อนกัน) และหยุดเมื่อสั่ง stop", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const setTimeoutImpl = vi.fn<(handler: () => void, ms: number) => ReturnType<typeof setTimeout>>(() => 42 as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutImpl = vi.fn();

    const stop = startC2CCallbackPolling({
      reference: "tx-1", active: true, onTimeline: vi.fn(), onError: vi.fn(),
      fetchImpl: fetchImpl as unknown as typeof fetch, setTimeoutImpl, clearTimeoutImpl,
    });
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(setTimeoutImpl).toHaveBeenCalledTimes(1);
    expect(setTimeoutImpl.mock.calls[0][1]).toBe(C2C_CALLBACK_POLL_INTERVAL_MS);

    stop();
    expect(clearTimeoutImpl).toHaveBeenCalledWith(42);
  });

  it("รายงาน error เมื่อ response ไม่ ok และยังตั้งรอบถัดไปถ้า active", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false } as Response));
    const setTimeoutImpl = vi.fn();
    const onError = vi.fn();

    startC2CCallbackPolling({
      reference: "tx-1", active: true, onTimeline: vi.fn(), onError,
      fetchImpl: fetchImpl as unknown as typeof fetch, setTimeoutImpl,
    });
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(setTimeoutImpl).toHaveBeenCalledTimes(1);
  });

  it("ไม่รายงาน error หลัง stop (unmount ระหว่างรอ fetch)", async () => {
    let reject: (error: Error) => void = () => {};
    const fetchImpl = vi.fn(() => new Promise<Response>((_, r) => { reject = r; }));
    const onError = vi.fn();
    const setTimeoutImpl = vi.fn();

    const stop = startC2CCallbackPolling({
      reference: "tx-1", active: true, onTimeline: vi.fn(), onError,
      fetchImpl: fetchImpl as unknown as typeof fetch, setTimeoutImpl,
    });
    stop();
    reject(new DOMException("aborted", "AbortError"));
    await flush();

    expect(onError).not.toHaveBeenCalled();
    expect(setTimeoutImpl).not.toHaveBeenCalled();
  });
});
