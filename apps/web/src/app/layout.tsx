import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PacketForge",
  description: "CCNA training simulator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav
          style={{
            display: "flex",
            gap: "1.5rem",
            padding: "0.75rem 1.5rem",
            borderBottom: "1px solid #e5e5e5",
            alignItems: "center",
          }}
        >
          <Link href="/">Home</Link>
          <Link href="/labs">Labs</Link>
          <Link href="/profiles">Profiles</Link>
        </nav>
        <main style={{ padding: "2rem 1.5rem" }}>{children}</main>
      </body>
    </html>
  );
}
