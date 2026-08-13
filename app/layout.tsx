import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LOUTRE Training",
  description: "极简游泳训练记录",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
