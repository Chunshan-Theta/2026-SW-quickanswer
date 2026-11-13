import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "課堂搶答 | Quickanswer",
  description: "以組別同步進行課堂搶答與 Guided Notes 整理。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
