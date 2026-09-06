import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// ยังไม่ผูก incremental cache (R2/KV) เพราะหน้าที่มีข้อมูลจริงเป็น dynamic ทั้งหมด
// ถ้าเพิ่มหน้า ISR ในอนาคตค่อยใส่ r2IncrementalCache แล้วสร้าง bucket
export default defineCloudflareConfig({});
