import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Race Upshot — Precision Race Timing",
  description: "RFID race timing, live results, athlete tracking, and event technology for endurance events.",
  icons: {
    icon: [{ url: "/favicon 2.png", type: "image/png", sizes: "118x118" }],
    shortcut: "/favicon 2.png",
    apple: "/favicon 2.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
