import "@fontsource-variable/noto-sans-thai";
import "./globals.css";

export const metadata = {
  title: "mobile-store — ระบบการเงินร้านไอที",
  description: "ระบบจัดการยอดคงเหลือ ฝาก–ถอน และรายการ C2C ของบัญชีลูกค้าและตัวแทนจำหน่าย mobile-store",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
