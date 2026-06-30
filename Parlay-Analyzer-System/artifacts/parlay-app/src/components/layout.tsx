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
  SidebarTrigger
} from "@/components/ui/sidebar";
import { Activity, CalendarDays, BarChart2, Trophy, Upload, Settings, BrainCircuit } from "lucide-react";
import { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { title: "Dashboard", url: "/", icon: Activity },
  { title: "Fixtures", url: "/fixtures", icon: CalendarDays },
  { title: "Team Stats", url: "/teams", icon: BarChart2 },
  { title: "Standings", url: "/standings", icon: Trophy },
  { title: "AI Parlays", url: "/parlays", icon: BrainCircuit },
  { title: "CSV Upload", url: "/upload", icon: Upload },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground font-mono">
        <Sidebar className="border-r border-border">
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-2 px-2 text-primary font-bold text-lg tracking-tight">
              <Activity className="h-5 w-5" />
              <span>TERMINAL.BET</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Navigation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <Link href={item.url} className="flex items-center gap-3 px-3 py-2 transition-colors">
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center px-4 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
            <SidebarTrigger />
          </header>
          <div className="flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}