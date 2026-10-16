import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDatabase, teardownTestDatabase, truncateAll } from "@/test/pg-harness";

let insertC2CCallbackRawLog: typeof import("./db")["insertC2CCallbackRawLog"];
let listC2CCallbackRawLogs: typeof import("./db")["listC2CCallbackRawLogs"];

beforeAll(async () => {
  await setupTestDatabase();
  ({ insertC2CCallbackRawLog, listC2CCallbackRawLogs } = await import("./db"));
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe("insertC2CCallbackRawLog / listC2CCallbackRawLogs", () => {
  it("บันทึกแถวพร้อม url, request body และ response ที่ระบุ", async () => {
    await insertC2CCallbackRawLog({
      requestUrl: "https://app.example.com/api/celox/c2c/callback",
      requestBody: '{"transactionId":"TX-1"}',
      responseStatus: 200,
      responseBody: '{"received":true,"duplicate":false}',
    });

    const [log] = await listC2CCallbackRawLogs();
    expect(log.requestUrl).toBe("https://app.example.com/api/celox/c2c/callback");
    expect(log.requestBody).toBe('{"transactionId":"TX-1"}');
    expect(log.responseStatus).toBe(200);
    expect(log.responseBody).toBe('{"received":true,"duplicate":false}');
    expect(Number.isNaN(Date.parse(log.receivedAt))).toBe(false);
  });

  it("ยอมรับ request body เป็น null เมื่ออ่าน body ไม่สำเร็จ", async () => {
    await insertC2CCallbackRawLog({
      requestUrl: "https://app.example.com/api/celox/c2c/callback",
      requestBody: null,
      responseStatus: 413,
      responseBody: '{"error":"too large"}',
    });

    const [log] = await listC2CCallbackRawLogs();
    expect(log.requestBody).toBeNull();
  });

  it("คืนรายการเรียงจากใหม่ไปเก่า", async () => {
    await insertC2CCallbackRawLog({
      requestUrl: "https://app.example.com/callback", requestBody: "first",
      responseStatus: 200, responseBody: "ok",
    });
    await insertC2CCallbackRawLog({
      requestUrl: "https://app.example.com/callback", requestBody: "second",
      responseStatus: 200, responseBody: "ok",
    });
    await insertC2CCallbackRawLog({
      requestUrl: "https://app.example.com/callback", requestBody: "third",
      responseStatus: 200, responseBody: "ok",
    });

    const logs = await listC2CCallbackRawLogs();
    expect(logs.map((l) => l.requestBody)).toEqual(["third", "second", "first"]);
  });

  it("จำกัดจำนวนรายการตาม limit ที่ขอ", async () => {
    for (let i = 0; i < 3; i += 1) {
      await insertC2CCallbackRawLog({
        requestUrl: "https://app.example.com/callback", requestBody: `body-${i}`,
        responseStatus: 200, responseBody: "ok",
      });
    }

    const logs = await listC2CCallbackRawLogs(2);
    expect(logs.length).toBe(2);
  });
});
