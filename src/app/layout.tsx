import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PSX Trading Advisor",
  description: "Shariah-compliant BTST and swing trading signals for PSX",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
