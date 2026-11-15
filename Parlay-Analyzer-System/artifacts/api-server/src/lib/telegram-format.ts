/**
 * Format pesan Telegram untuk tiket pasar-dulu.
 *
 * Teks polos (tanpa Markdown) agar nama tim dan karakter khusus tidak
 * pernah merusak pemformatan. Isinya meniru panel: leg + harga terbaik,
 * peluang jujur, odds wajar vs bandar, dan peringatan leg rapuh.
 */
import type { MarketFirstTicket } from "./quant/market-first";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatTicketMessage(ticket: MarketFirstTicket, generatedAt = new Date()): string {
  const lines: string[] = [];
  lines.push(`🎯 TIKET PASAR-DULU — ${ticket.legs.length} leg`);
  lines.push(`Peluang tiket (dari pasar): ${pct(ticket.pCombined)}`);
  lines.push(
    `Odds bandar: ${ticket.combinedOdds.toFixed(2)} · odds wajar: ${ticket.fairOdds.toFixed(2)}` +
    (ticket.priceImpact && ticket.priceImpact.uplift > 0.001
      ? ` · dengan harga terbaik: ${ticket.priceImpact.bestCombined.toFixed(2)}`
      : ""),
  );
  lines.push("");
  ticket.legs.forEach((leg, i) => {
    const hunt = leg.priceHunt;
    const best = hunt && hunt.uplift > 0.001
      ? ` → terbaik @${hunt.bestOdds.toFixed(2)} (${hunt.bestBookmaker})`
      : "";
    lines.push(
      `${i + 1}. ${leg.selection.label} @${leg.selection.odds.toFixed(2)}${best}` +
      `\n   ${leg.league} · pasar ${pct(leg.pUsed)} · ${leg.character}` +
      (leg.contextRisk && leg.contextRisk.level !== "tidak-diketahui"
        ? ` · konteks ${leg.contextRisk.level}`
        : "") +
      (hunt?.drift === "menjauh" ? " · ⚠️ harga menjauh" : ""),
    );
  });
  const warnings = ticket.notes.filter((n) => n.includes("rapuh") || n.includes("TINGGI") || n.includes("tidak tercapai"));
  if (warnings.length > 0) {
    lines.push("");
    for (const w of warnings) lines.push(`⚠️ ${w}`);
  }
  lines.push("");
  lines.push("Peluang dihitung dari probabilitas fair pasar, bukan janji. EV vs bandar wajar negatif karena margin menumpuk per leg.");
  lines.push(`Dibuat ${generatedAt.toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA`);
  return lines.join("\n");
}
