import { Pool, types as pgTypes } from "pg";

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

export type Tx = Queryable;

/**
 * แปลง placeholder สไตล์ SQLite (`?`) เป็นสไตล์ Postgres (`$1`, `$2`, ...)
 * ข้าม `?` ที่อยู่ในสตริงลิเทอรัล quoted identifier และคอมเมนต์
 *
 * โค้ดเบสนี้ไม่ได้ใช้ jsonb operator (`?`, `?|`, `?&`) ถ้าวันหนึ่งต้องใช้
 * ให้เขียน SQL ก้อนนั้นด้วย `$n` เองแล้วข้ามตัวแปลงนี้
 *
 * หมายเหตุ: ไม่รองรับ dollar-quoted string (`$tag$...$tag$`) เพราะโปรเจกต์นี้
 * ไม่ใช้ plpgsql function และ migration ที่ตัวแปลงนี้ต้องประมวลผลเป็น DDL ล้วน
 */
export function toPositional(sql: string): string {
  let out = "";
  let index = 0;
  let position = 0;

  while (position < sql.length) {
    const char = sql[position];
    const next = sql[position + 1];

    if (char === "'" || char === '"') {
      const quote = char;
      out += char;
      position += 1;
      while (position < sql.length) {
        if (sql[position] === quote && sql[position + 1] === quote) {
          out += quote + quote;
          position += 2;
          continue;
        }
        if (sql[position] === quote) {
          out += quote;
          position += 1;
          break;
        }
        out += sql[position];
        position += 1;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", position);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(position, stop);
      position = stop;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", position + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(position, stop);
      position = stop;
      continue;
    }

    if (char === "?") {
      index += 1;
      out += `$${index}`;
      position += 1;
      continue;
    }

    out += char;
    position += 1;
  }

  return out;
}
