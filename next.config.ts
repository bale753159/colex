import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pg เรียก require("pg-cloudflare") ตอนรันบน Workers แต่ file tracing ของ Next
  // resolve ด้วย condition "default" เลยคัดลอกมาแค่ dist/empty.js ทำให้ esbuild
  // ของ open-next (ซึ่ง resolve ด้วย condition "workerd") หา entry ไม่เจอ
  // จึงบังคับให้ลากทั้งแพ็กเกจติดไปด้วย
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pg-cloudflare/**/*"],
  },
};

export default nextConfig;
