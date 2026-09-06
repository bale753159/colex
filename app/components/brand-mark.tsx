"use client";

import { useId } from "react";

// ตราวงกลม mobile-store — อักษร M ทองไล่เฉดบนพื้นเอสเปรสโซ ล้อกับ --primary/--sidebar
// วาดเป็น inline SVG แทน next/image เพื่อให้คมทุก DPI และไม่ต้องยิงรีเควสต์เพิ่ม
export default function BrandMark({ size = 40, className = "brand-mark" }: { size?: number; className?: string }) {
  // เรนเดอร์สองที่ (sidebar กับ topbar มือถือ) จึงต้องกัน id ของ gradient ชนกัน
  const gradientId = useId();

  return (
    <svg className={className} width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="24" y1="16" x2="72" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#efdda6" />
          <stop offset=".38" stopColor="#c3a047" />
          <stop offset=".72" stopColor="#a88738" />
          <stop offset="1" stopColor="#8a6b26" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="48" fill="#261f14" />
      <circle cx="48" cy="48" r="40" fill="none" stroke={`url(#${gradientId})`} strokeWidth="2.25" opacity=".62" />
      <path
        d="M26 69V27l22 25 22-25v42"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="10.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
