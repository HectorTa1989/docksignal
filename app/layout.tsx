import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "DockSignal — logistics exception commander",
  description: "Calls the people who hold the missing shipment facts through CALL-E and produces a verified recovery plan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-line bg-panel/60">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-signal font-black text-ink">DS</span>
              <span>
                <span className="block text-sm font-semibold leading-tight">DockSignal</span>
                <span className="block text-[11px] text-muted">Logistics exception commander · powered by CALL-E</span>
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-xs text-muted">
              <Link href="/" className="hover:text-white">
                Incidents
              </Link>
              <a href="/api/health" className="hover:text-white" target="_blank" rel="noreferrer">
                Health
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-[11px] text-muted">
          Every call shown here is a real CALL-E call. There is no mock mode. The AI assistant identifies itself on every call and never
          confirms a booking, price, or dock appointment without a human approval.
        </footer>
      </body>
    </html>
  );
}
