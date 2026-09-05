import { describe, expect, it } from "vitest";
import { toPositional } from "./sql";

describe("toPositional", () => {
  it("แปลง ? เรียงเป็น $1 $2 ตามลำดับ", () => {
    expect(toPositional("SELECT * FROM t WHERE a = ? AND b = ?"))
      .toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
  });

  it("ไม่แตะ ? ที่อยู่ในสตริงลิเทอรัล", () => {
    expect(toPositional("SELECT 'มี ? อยู่' WHERE a = ?"))
      .toBe("SELECT 'มี ? อยู่' WHERE a = $1");
  });

  it("รองรับ single quote ที่ escape ด้วย ''", () => {
    expect(toPositional("SELECT 'it''s ? here' , ?"))
      .toBe("SELECT 'it''s ? here' , $1");
  });

  it("ไม่แตะ ? ที่อยู่ใน quoted identifier", () => {
    expect(toPositional('SELECT "weird?col" FROM t WHERE a = ?'))
      .toBe('SELECT "weird?col" FROM t WHERE a = $1');
  });

  it("ไม่แตะ ? ใน line comment", () => {
    expect(toPositional("-- ถาม? ตอบ\nSELECT ?"))
      .toBe("-- ถาม? ตอบ\nSELECT $1");
  });

  it("ไม่แตะ ? ใน block comment", () => {
    expect(toPositional("/* ? */ SELECT ?"))
      .toBe("/* ? */ SELECT $1");
  });

  it("นับต่อเนื่องข้ามหลายบรรทัด", () => {
    const sql = `
      INSERT INTO t (a, b, c)
      VALUES (?, ?, ?)
    `;
    expect(toPositional(sql)).toContain("VALUES ($1, $2, $3)");
  });
});
