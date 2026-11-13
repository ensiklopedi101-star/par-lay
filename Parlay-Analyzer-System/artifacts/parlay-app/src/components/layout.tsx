import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Activity,
  CalendarDays,
  BarChart2,
  Trophy,
  Settings,
  BrainCircuit,
  BookOpen,
  Eye,
  Layers3,
} from "lucide-react";
import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

const navGroups = [
  {
    label: "Ringkasan",
    items: [
      { title: "Dashboard", url: "/", icon: Activity, hint: "Status dan tindakan utama" },
      { title: "Transparansi Sistem", url: "/transparency", icon: Eye, hint: "Audit sync, analisis, settlement" },
    ],
  },
  {
    label: "Data Pertandingan",
    items: [
      { title: "Fixtures", url: "/fixtures", icon: CalendarDays, hint: "Jadwal dan odds" },
      { title: "Team Stats", url: "/teams", icon: BarChart2, hint: "Statistik per musim" },
      { title: "Standings", url: "/standings", icon: Trophy, hint: "Klasemen liga" },
    ],
  },
  {
    label: "Keputusan AI",
    items: [
      { title: "Prediksi & Parlay AI", url: "/ai-center", icon: Layers3, hint: "Prediksi tunggal → tiket parlay" },
      { title: "AI Learning", url: "/ai-learning", icon: BookOpen, hint: "Evaluasi dan evolusi terkontrol" },
    ],
  },
  {
    label: "Administrasi",
    items: [
      { title: "Settings", url: "/settings", icon: Settings, hint: "Persona, liga, dan scheduler" },
    ],
  },
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Dashboard", subtitle: "Ringkasan operasional Parlay Intelligence" },
  "/transparency": { title: "Transparansi Sistem", subtitle: "Bukti proses di balik setiap keputusan" },
  "/fixtures": { title: "Fixtures", subtitle: "Jadwal pertandingan dan ketersediaan odds" },
  "/teams": { title: "Team Stats", subtitle: "Kelengkapan statistik tim berdasarkan musim" },
  "/standings": { title: "Standings", subtitle: "Klasemen dan performa terkini" },
  "/ai-center": { title: "Prediksi & Parlay AI", subtitle: "Dari analisis satu laga menjadi tiket parlay" },
  "/risk-center": { title: "Prediksi & Parlay AI", subtitle: "Dari analisis satu laga menjadi tiket parlay" },
  "/parlays": { title: "Prediksi & Parlay AI", subtitle: "Dari analisis satu laga menjadi tiket parlay" },
  "/ai-learning": { title: "AI Learning", subtitle: "Belajar dari hasil tanpa mengubah sistem secara liar" },
  "/settings": { title: "Settings", subtitle: "Konfigurasi persona, data, dan otomasi" },
};

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const current = pageTitles[location] ?? { title: "Parlay Intelligence", subtitle: "Sistem analisis sepak bola berbasis data" };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background font-sans text-foreground">
        <Sidebar className="border-r border-sidebar-border bg-sidebar shadow-sm">
          <SidebarHeader className="border-b border-sidebar-border p-5">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <BrainCircuit className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-base font-bold leading-tight tracking-tight text-foreground">Parlay Intelligence</span>
                <span className="block text-xs text-muted-foreground">Analisis sepak bola berbasis data</span>
              </span>
            </Link>
          </SidebarHeader>
          <SidebarContent className="px-2 py-3">
            {navGroups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel className="px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const isActive = location === item.url
                        || (item.url === "/ai-center" && (location === "/parlays" || location === "/risk-center"))
                        || (item.url !== "/" && location.startsWith(item.url));
                      return (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton asChild isActive={isActive} className="h-auto rounded-lg px-3 py-2.5">
                            <Link href={item.url} className="flex items-center gap-3">
                              <item.icon className="h-4.5 w-4.5 shrink-0" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{item.title}</span>
                                <span className="block truncate text-[11px] font-normal text-muted-foreground">{item.hint}</span>
                              </span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <div className="mt-auto border-t border-sidebar-border p-4 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Prinsip sistem:</span> probabilitas, EV, dan stake dihitung kode — AI hanya memberi konteks dan bukti.
          </div>
        </Sidebar>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur-md sm:px-6">
            <SidebarTrigger className="shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold sm:text-base">{current.title}</div>
              <div className="hidden truncate text-xs text-muted-foreground sm:block">{current.subtitle}</div>
            </div>
            <div className="ml-auto hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Tema terang profesional
            </div>
          </header>
          <div className="flex-1 overflow-auto px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
