import { useState, useEffect } from "react";
import {
  useGetConfig,
  useSaveConfig,
  useTriggerSync,
  useTriggerSettlement,
  useGetSyncStatus,
  useGetCatalog,
  getGetConfigQueryKey,
  getGetSyncStatusQueryKey,
  type SettlementResult,
} from "@/api/parlay-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCw, Save, Plus, X, Bot, Gavel, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function TagList({
  label,
  items,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  testId: string;
}) {
  const [newItem, setNewItem] = useState("");

  function add() {
    const val = newItem.trim();
    if (val && !items.includes(val)) {
      onChange([...items, val]);
      setNewItem("");
    }
  }

  function remove(item: string) {
    onChange(items.filter((i) => i !== item));
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2 min-h-8">
        {items.map((item) => (
          <Badge
            key={item}
            variant="secondary"
            className="flex items-center gap-1 font-mono text-xs"
            data-testid={`badge-${testId}-${item}`}
          >
            {item}
            <button
              type="button"
              onClick={() => remove(item)}
              className="ml-1 hover:text-destructive"
              data-testid={`button-remove-${testId}-${item}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="text-sm font-mono h-8"
          data-testid={`input-add-${testId}`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          data-testid={`button-add-${testId}`}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function CheckboxGrid<T extends { slug?: string; key?: string; name?: string; label?: string; country?: string; description?: string }>({
  sectionLabel,
  items,
  selected,
  onToggle,
  getId,
  getLabel,
  getMeta,
}: {
  sectionLabel: string;
  items: T[];
  selected: string[];
  onToggle: (id: string) => void;
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  getMeta?: (item: T) => string | undefined;
}) {
  const selectedCount = selected.length;
  const total = items.length;

  function toggleAll() {
    if (selectedCount === total) {
      items.forEach((item) => {
        if (selected.includes(getId(item))) onToggle(getId(item));
      });
    } else {
      items.forEach((item) => {
        if (!selected.includes(getId(item))) onToggle(getId(item));
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{sectionLabel}</Label>
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          {selectedCount === total ? "Hapus semua" : "Pilih semua"}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((item) => {
          const id = getId(item);
          const isChecked = selected.includes(id);
          const meta = getMeta?.(item);
          return (
            <label
              key={id}
              className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                isChecked
                  ? "border-primary/60 bg-primary/5"
                  : "border-border bg-card hover:border-border/80 hover:bg-muted/30"
              }`}
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => onToggle(id)}
                className="mt-0.5 shrink-0"
                data-testid={`checkbox-${sectionLabel.toLowerCase().replace(/\s/g, "-")}-${id}`}
              />
              <div className="min-w-0">
                <span className="text-sm font-medium leading-tight block">{getLabel(item)}</span>
                {meta && (
                  <span className="text-xs text-muted-foreground font-mono leading-tight block mt-0.5">
                    {meta}
                  </span>
                )}
              </div>
            </label>
          );
        })}
      </div>
      {selectedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {selectedCount} dari {total} dipilih
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: config, isLoading: configLoading } = useGetConfig();
  const { data: catalog, isLoading: catalogLoading } = useGetCatalog();
  const { data: syncStatus } = useGetSyncStatus();
  const saveConfig = useSaveConfig();
  const triggerSync = useTriggerSync();
  const triggerSettlement = useTriggerSettlement();

  const [leagues, setLeagues] = useState<string[]>([]);
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [cronExpression, setCronExpression] = useState("0 */3 * * *");
  const [aiPersona, setAiPersona] = useState("");
  const [agentInstructions, setAgentInstructions] = useState("");
  const [personaExpanded, setPersonaExpanded] = useState(false);

  const isLoading = configLoading || catalogLoading;

  useEffect(() => {
    if (config) {
      setLeagues(config.leagues ?? []);
      setBookmakers(config.bookmakers ?? []);
      setMarkets(config.markets ?? []);
      setCronExpression(config.cronExpression ?? "0 */3 * * *");
      setAiPersona(config.aiPersona ?? "");
      setAgentInstructions(config.agentInstructions ?? "");
    }
  }, [config]);

  function toggleLeague(slug: string) {
    setLeagues((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  function toggleMarket(key: string) {
    setMarkets((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveConfig.mutate(
      { data: { leagues, bookmakers, markets, cronExpression, aiPersona: aiPersona || null, agentInstructions: agentInstructions || null } },
      {
        onSuccess: () => {
          toast({ title: "Config tersimpan", description: "Konfigurasi scheduler dan persona AI berhasil diperbarui." });
          queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
        },
        onError: () => {
          toast({ title: "Gagal menyimpan", variant: "destructive" });
        },
      }
    );
  }

  function handleTriggerSync() {
    triggerSync.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Sync dimulai", description: "Manual odds sync berhasil ditrigger." });
        queryClient.invalidateQueries({ queryKey: getGetSyncStatusQueryKey() });
      },
      onError: () => {
        toast({ title: "Sync gagal", variant: "destructive" });
      },
    });
  }

  function handleTriggerSettlement() {
    triggerSettlement.mutate(undefined, {
      onSuccess: (data: SettlementResult) => {
        toast({
          title: "Settlement selesai",
          description: `${data.settled ?? 0} prediksi diselesaikan, ${data.lessons ?? 0} pelajaran baru.`,
        });
      },
      onError: () => {
        toast({ title: "Settlement gagal", variant: "destructive" });
      },
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm">Konfigurasi scheduler, persona AI, dan kontrol manual.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTriggerSettlement}
            disabled={triggerSettlement.isPending}
            title="Settlement manual — cek hasil pertandingan yang sudah selesai"
          >
            <Gavel className={`w-4 h-4 mr-2 ${triggerSettlement.isPending ? "animate-pulse" : ""}`} />
            {triggerSettlement.isPending ? "Settling..." : "Run Settlement"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTriggerSync}
            disabled={triggerSync.isPending || syncStatus?.isRunning}
            data-testid="button-trigger-sync"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${
                triggerSync.isPending || syncStatus?.isRunning ? "animate-spin" : ""
              }`}
            />
            {syncStatus?.isRunning ? "Syncing..." : "Trigger Sync"}
          </Button>
        </div>
      </div>

      {syncStatus && (
        <Card className="bg-card border-border">
          <CardContent className="pt-4 flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">Status </span>
              <span
                className={`font-medium ${
                  syncStatus.isRunning ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {syncStatus.isRunning ? "Running" : "Idle"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Total events </span>
              <span className="font-mono font-bold">{syncStatus.totalEvents}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Last sync </span>
              <span className="font-mono text-xs">
                {syncStatus.lastSyncAt
                  ? new Date(syncStatus.lastSyncAt).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Scheduler Config</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Centang liga dan market yang ingin di-fetch setiap cron run. Slug sudah terverifikasi — tidak perlu mengetik manual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-32" />
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 13 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
              <Skeleton className="h-8 w-32 mt-4" />
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-8">
              {catalog && (
                <>
                  <CheckboxGrid
                    sectionLabel="Leagues"
                    items={catalog.leagues}
                    selected={leagues}
                    onToggle={toggleLeague}
                    getId={(l) => l.slug!}
                    getLabel={(l) => `${l.name} · ${l.country}`}
                    getMeta={(l) => l.slug}
                  />

                  <CheckboxGrid
                    sectionLabel="Markets"
                    items={catalog.markets}
                    selected={markets}
                    onToggle={toggleMarket}
                    getId={(m) => m.key!}
                    getLabel={(m) => m.label!}
                    getMeta={(m) => m.description}
                  />
                </>
              )}

              <TagList
                label="Bookmakers"
                items={bookmakers}
                onChange={setBookmakers}
                placeholder="Bet365"
                testId="bookmakers"
              />

              <div className="space-y-1.5">
                <Label htmlFor="cron">Cron Expression</Label>
                <Input
                  id="cron"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="0 */3 * * *"
                  className="font-mono"
                  data-testid="input-cron"
                />
                <p className="text-xs text-muted-foreground">
                  Default:{" "}
                  <code className="text-primary">0 */3 * * *</code> — setiap 3 jam
                </p>
              </div>

              <Button
                type="submit"
                disabled={saveConfig.isPending}
                data-testid="button-save-config"
              >
                <Save className="w-4 h-4 mr-2" />
                {saveConfig.isPending ? "Menyimpan..." : "Save Config"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* ── AI Persona & Instruksi ── */}
      <Card className="bg-card border-border">
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setPersonaExpanded((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              <CardTitle className="text-base font-semibold">Persona & Instruksi Gemini</CardTitle>
            </div>
            {personaExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Ubah cara Gemini berpikir dan apa yang harus diperhatikannya. Kosongkan untuk pakai default (Quant Sniper v3).
          </CardDescription>
        </CardHeader>

        {personaExpanded && (
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="ai-persona" className="flex items-center gap-1.5">
                Persona Gemini
                <span className="text-xs font-normal text-muted-foreground">(System Instruction)</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Ini adalah "kepribadian" dan aturan analisis yang dipakai Gemini setiap kali Anda klik <strong>Analisis Sekarang (AI)</strong>.
                Jika dikosongkan, sistem akan memakai default Quant Sniper v3.
              </p>
              <Textarea
                id="ai-persona"
                value={aiPersona}
                onChange={(e) => setAiPersona(e.target.value)}
                placeholder={`Anda adalah Quant Sniper, AI Analis Kuantitatif level elit...\n\n(Kosongkan untuk pakai default)`}
                rows={10}
                className="font-mono text-xs resize-y"
              />
              <p className="text-xs text-muted-foreground">
                {aiPersona.length > 0
                  ? `${aiPersona.length} karakter — persona kustom aktif`
                  : "Menggunakan persona default (Quant Sniper v3)"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-instructions" className="flex items-center gap-1.5">
                Instruksi Tambahan untuk AI
                <span className="text-xs font-normal text-muted-foreground">(Append ke persona)</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Tambahan khusus yang selalu disertakan setelah persona — misalnya: "Fokus pada liga Asia", "Selalu analisis handicap terlebih dahulu", atau "Jangan rekomendasikan jika EV di bawah 5%".
              </p>
              <Textarea
                id="agent-instructions"
                value={agentInstructions}
                onChange={(e) => setAgentInstructions(e.target.value)}
                placeholder="Contoh: Fokus pada pasar Over/Under. Tolak bet bila ada keraguan. Selalu cek form 5 pertandingan terakhir."
                rows={4}
                className="text-sm resize-y"
              />
            </div>

            <Button
              onClick={() => {
                saveConfig.mutate(
                  { data: { aiPersona: aiPersona || null, agentInstructions: agentInstructions || null } },
                  {
                    onSuccess: () => toast({ title: "Persona tersimpan", description: "Gemini akan menggunakan persona baru pada analisis berikutnya." }),
                    onError: () => toast({ title: "Gagal menyimpan persona", variant: "destructive" }),
                  }
                );
              }}
              disabled={saveConfig.isPending}
              variant="outline"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveConfig.isPending ? "Menyimpan..." : "Simpan Persona"}
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
