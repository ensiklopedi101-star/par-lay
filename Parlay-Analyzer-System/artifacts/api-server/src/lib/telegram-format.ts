/**
 * Format pesan Telegram untuk tiket pasar-dulu.
 *
 * Teks polos (tanpa Markdown) agar nama tim dan karakter khusus tidak
 * pernah merusak pemformatan. Isinya meniru panel: leg + harga terbaik,
 * peluang jujur, odds wajar vs bandar, dan peringatan leg rapuh.
 */
import type { MarketFirstTicket } from "./quant/market-first";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatTicketMessage(
  ticket: MarketFirstTicket & { variant?: string; boosterMarketKey?: string },
  generatedAt = new Date(),
): string {
  const lines: string[] = [];
  const title = ticket.variant === "booster"
    ? "🚀 PARLAY BOOSTER"
    : ticket.variant === "jackpot"
      ? "💎 PARLAY JACKPOT"
      : "🎯 PARLAY UTAMA";
  lines.push(`${title} — ${ticket.legs.length} leg`);
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
    const match = leg.homeTeam && leg.awayTeam ? `${leg.homeTeam} vs ${leg.awayTeam}` : leg.league;
    const isBoosterLeg = ticket.boosterMarketKey != null && leg.marketKey === ticket.boosterMarketKey && leg.fixtureId === ticket.legs.find((l) => l.marketKey === ticket.boosterMarketKey)?.fixtureId;
    lines.push(
      `${i + 1}. ${match}${isBoosterLeg ? " ⭐ PENGUAT" : ""}` +
      `\n   ${leg.displayLabel} @${leg.selection.odds.toFixed(2)}${best}` +
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


/** Pesan gabungan tiga varian; varian yang tidak terbentuk disebut alasannya. */
export function formatVariantsMessage(
  variants: {
    utama: (MarketFirstTicket & { variant?: string }) | null;
    booster: (MarketFirstTicket & { variant?: string; boosterMarketKey?: string }) | null;
    jackpot: (MarketFirstTicket & { variant?: string }) | null;
    variantNotes: Record<string, string | null>;
  },
  generatedAt = new Date(),
): string {
  const parts: string[] = [];
  if (variants.utama) parts.push(formatTicketMessage(variants.utama, generatedAt));
  if (variants.booster) parts.push(formatTicketMessage(variants.booster, generatedAt));
  else if (variants.variantNotes["booster"]) parts.push(`🚀 PARLAY BOOSTER — tidak disusun: ${variants.variantNotes["booster"]}`);
  if (variants.jackpot) parts.push(formatTicketMessage(variants.jackpot, generatedAt));
  else if (variants.variantNotes["jackpot"]) parts.push(`💎 PARLAY JACKPOT — tidak disusun: ${variants.variantNotes["jackpot"]}`);
  return parts.join("\n\n————————————\n\n");
}
