import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pg เลือก socket implementation ตาม export condition: บน workerd จะ require
  // "pg-cloudflare/dist/index.js" แต่ file tracing ของ Next แก้เป็น condition
  // "default" (dist/empty.js) จึงคัดลอกไฟล์จริงไม่ครบและ esbuild ของ OpenNext
  // bundle ไม่ผ่าน — บังคับให้ trace ทั้งแพ็กเกจไว้
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pg-cloudflare/dist/**/*", "./node_modules/pg-cloudflare/esm/**/*"],
  },
};

export default nextConfig;
