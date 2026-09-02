import "@fontsource-variable/noto-sans-thai";
import "./globals.css";

export const metadata = {
  title: "KLANG — ภาพรวมการเงิน",
  description: "ระบบจัดการฝาก ถอน และรายการธุรกรรมสำหรับแอดมิน",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
