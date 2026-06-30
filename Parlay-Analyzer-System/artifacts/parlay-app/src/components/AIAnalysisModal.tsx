import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

interface AnalysisResult {
  fixture_id: string;
  home_team?: string;
  away_team?: string;
  prediction_text: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  result: AnalysisResult;
  homeTeam: string;
  awayTeam: string;
}

function detectVerdict(text: string): "AMBIL" | "NO BET" | null {
  if (/\bAMBIL\b/i.test(text)) return "AMBIL";
  if (/\bNO\s*BET\b/i.test(text)) return "NO BET";
  return null;
}

function HighlightedMarkdown({ text }: { text: string }) {
  const highlighted = text
    .replace(/\bAMBIL\b/g, "**🟢 AMBIL**")
    .replace(/\bNO\s*BET\b/g, "**🔴 NO BET**");

  return (
    <div className="prose prose-sm prose-invert max-w-none
      prose-headings:text-primary prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2
      prose-p:text-foreground prose-p:leading-relaxed prose-p:my-2
      prose-strong:text-primary prose-strong:font-semibold
      prose-ul:text-foreground prose-li:my-0.5
      prose-code:text-primary prose-code:bg-secondary prose-code:px-1 prose-code:rounded
      prose-hr:border-border">
      <ReactMarkdown>{highlighted}</ReactMarkdown>
    </div>
  );
}

export function AIAnalysisModal({ open, onOpenChange, result, homeTeam, awayTeam }: Props) {
  const verdict = detectVerdict(result.prediction_text);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] bg-card border-border flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                Quant Sniper Analysis
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1 font-mono">
                {homeTeam} <span className="text-primary">vs</span> {awayTeam}
              </p>
            </div>
            {verdict && (
              <Badge
                className={`text-sm px-3 py-1 font-bold flex-shrink-0 ${
                  verdict === "AMBIL"
                    ? "bg-green-500/20 text-green-400 border border-green-500/40"
                    : "bg-red-500/20 text-red-400 border border-red-500/40"
                }`}
              >
                {verdict === "AMBIL" ? (
                  <TrendingUp className="w-4 h-4 mr-1.5" />
                ) : (
                  <XCircle className="w-4 h-4 mr-1.5" />
                )}
                {verdict}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
            <Clock className="w-3 h-3" />
            Dianalisis: {format(new Date(result.created_at), "dd MMM yyyy, HH:mm")}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto mt-4 pr-1 border-t border-border pt-4">
          <HighlightedMarkdown text={result.prediction_text} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
