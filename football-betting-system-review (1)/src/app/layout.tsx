import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Par-Lay Audit & Quant Lab",
  description:
    "Review sistem analisis sepakbola par-lay: kelemahan, keunggulan, perbaikan, dan implementasi mesin probabilitas yang terkalibrasi.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-slate-950 text-slate-200 antialiased">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs text-slate-500">
          Review berbasis pembacaan kode repo <code>ensiklopedi101-star/par-lay</code>. Tidak ada sistem taruhan yang
          menjamin keuntungan; tujuan sistem ini adalah probabilitas yang terkalibrasi dan klaim edge yang terukur.
        </footer>
      </body>
    </html>
  );
}
