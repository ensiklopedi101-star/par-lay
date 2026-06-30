import { useState, useRef } from "react";
import { getListTeamStatsQueryKey } from "@/api/parlay-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload as UploadIcon, FileText, CheckCircle, XCircle, AlertCircle } from "lucide-react";

interface UploadResult {
  inserted: number;
  skipped: number;
  errors: number;
  teams: string[];
  csvType: string;
}

const CSV_TYPES = [
  { value: "stats_xg", label: "xG / xGA / xGD" },
  { value: "stats_fts", label: "FTS (Failed to Score)" },
  { value: "stats_btts", label: "BTTS (Both Teams To Score)" },
  { value: "stats_goals_conceded", label: "Goals Conceded" },
  { value: "stats_goals_scored", label: "Goals Scored" },
  { value: "stats_shots", label: "Shots" },
  { value: "stats_over_25", label: "Over 2.5 Goals" },
  { value: "stats_over_35", label: "Over 3.5 Goals" },
  { value: "stats_under", label: "Under Goals" },
  { value: "stats_team_form", label: "Team Form" },
  { value: "stats_ht", label: "Half-Time Stats" },
];

export default function Upload() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [leagueSlug, setLeagueSlug] = useState("");
  const [season, setSeason] = useState("");
  const [password, setPassword] = useState("");
  const [csvType, setCsvType] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setErrorMsg(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !leagueSlug || !season || !password || !csvType) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("password", password);
    formData.append("leagueSlug", leagueSlug);
    formData.append("season", season);
    formData.append("csvType", csvType);

    setIsPending(true);
    setResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/csv/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        if (res.status === 401) {
          setErrorMsg("Unauthorized — wrong password.");
        } else {
          setErrorMsg((json.error as string) ?? `Upload failed (${res.status}).`);
        }
        return;
      }

      setResult(json as unknown as UploadResult);
      queryClient.invalidateQueries({ queryKey: getListTeamStatsQueryKey() });
    } catch {
      setErrorMsg("Network error — could not reach the server.");
    } finally {
      setIsPending(false);
    }
  }

  const isValid = !!file && !!leagueSlug.trim() && !!season.trim() && !!password.trim() && !!csvType;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">CSV Upload</h1>
        <p className="text-muted-foreground text-sm">Upload a FootyStats CSV to populate team stats into a JSONB column.</p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Upload FootyStats CSV</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Select CSV type, then upload the league table. Data is stored as raw JSON in the matching column.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="csv-type">CSV Type</Label>
              <Select value={csvType} onValueChange={setCsvType}>
                <SelectTrigger id="csv-type" data-testid="select-csv-type">
                  <SelectValue placeholder="Select stat category…" />
                </SelectTrigger>
                <SelectContent>
                  {CSV_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="csv-file">CSV File</Label>
              <div
                className="border-2 border-dashed border-border rounded-md p-6 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileInputRef.current?.click()}
                data-testid="drop-csv-file"
              >
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-foreground">
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <UploadIcon className="w-8 h-8" />
                    <span className="text-sm">Click to select a .csv file</span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-csv-file"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="league-slug">League Slug</Label>
                <Input
                  id="league-slug"
                  data-testid="input-league-slug"
                  placeholder="england-premier-league"
                  value={leagueSlug}
                  onChange={(e) => setLeagueSlug(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="season">Season</Label>
                <Input
                  id="season"
                  data-testid="input-season"
                  placeholder="2024-25"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Upload Password</Label>
              <Input
                id="password"
                type="password"
                data-testid="input-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              disabled={!isValid || isPending}
              className="w-full"
              data-testid="button-submit-upload"
            >
              {isPending ? "Uploading…" : "Upload CSV"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Alert className="border-emerald-800 bg-emerald-950/40" data-testid="alert-upload-success">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <AlertDescription className="space-y-3 mt-1">
            <div className="flex gap-6 text-sm font-mono">
              <span><span className="text-emerald-400 font-bold">{result.inserted}</span> inserted</span>
              <span><span className="text-amber-400 font-bold">{result.skipped}</span> skipped</span>
              <span><span className="text-red-400 font-bold">{result.errors}</span> errors</span>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Type:</span>{" "}
              <span className="text-primary font-mono">{result.csvType}</span>
            </div>
            {result.teams.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Teams:</span>{" "}
                {result.teams.join(", ")}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {errorMsg && (
        <Alert className="border-red-800 bg-red-950/40" data-testid="alert-upload-error">
          <XCircle className="w-4 h-4 text-red-400" />
          <AlertDescription className="text-sm mt-1">{errorMsg}</AlertDescription>
        </Alert>
      )}

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            League Slug Reference
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs font-mono text-muted-foreground">
            {[
              ["england-premier-league", "EPL"],
              ["italy-serie-a", "Serie A"],
              ["germany-bundesliga", "Bundesliga"],
              ["spain-la-liga", "La Liga"],
              ["france-ligue-1", "Ligue 1"],
              ["south-korea-k-league-1", "K-League 1"],
            ].map(([slug, name]) => (
              <div key={slug} className="flex gap-2">
                <span className="text-primary">{slug}</span>
                <span>— {name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
