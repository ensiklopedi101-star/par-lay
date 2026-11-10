"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Ringkasan" },
  { href: "/temuan", label: "Temuan" },
  { href: "/lab", label: "Quant Lab" },
  { href: "/ledger", label: "Ledger & Bukti" },
  { href: "/patch", label: "Patch & Rencana" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
          Par-Lay Audit
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 transition ${
                  active ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
