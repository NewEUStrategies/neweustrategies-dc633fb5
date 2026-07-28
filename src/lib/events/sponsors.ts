// Czysta logika widgetu event-sponsors: parsowanie tresci widgetu (poziomy
// sponsorskie -> sponsorzy) do typowanego modelu. Zero React/IO - modul
// wspoldzielony przez widok (lazy chunk), edytor (chunk admina) i testy,
// wiec zadna strona nie przeciaga cudzego kodu przez granice chunkow.
import type { WidgetContent } from "@/lib/builder/types";

export type SponsorTierSize = "lg" | "md" | "sm";

export interface SponsorEntry {
  id: string;
  name: string;
  logo: string;
  url: string;
  description_pl: string;
  description_en: string;
}

export interface SponsorTier {
  id: string;
  name_pl: string;
  name_en: string;
  size: SponsorTierSize;
  sponsors: SponsorEntry[];
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parsuje `content.tiers` do typowanego modelu; odporne na braki/smieci
 *  (uszkodzone wpisy sa pomijane; sponsor bez nazwy i logo odpada). */
export function parseSponsorTiers(c: WidgetContent): SponsorTier[] {
  const raw = Array.isArray(c.tiers) ? c.tiers : [];
  const out: SponsorTier[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const tier = raw[i];
    if (!isRecord(tier)) continue;
    const sizeRaw = strOf(tier.size);
    const sponsorsRaw = Array.isArray(tier.sponsors) ? tier.sponsors : [];
    out.push({
      id: strOf(tier.id) || `tier-${i + 1}`,
      name_pl: strOf(tier.name_pl),
      name_en: strOf(tier.name_en),
      size: sizeRaw === "lg" || sizeRaw === "sm" ? sizeRaw : "md",
      sponsors: sponsorsRaw
        .map((s, j) => {
          if (!isRecord(s)) return null;
          const entry: SponsorEntry = {
            id: strOf(s.id) || `spo-${j + 1}`,
            name: strOf(s.name),
            logo: strOf(s.logo),
            url: strOf(s.url),
            description_pl: strOf(s.description_pl),
            description_en: strOf(s.description_en),
          };
          return entry.name || entry.logo ? entry : null;
        })
        .filter((s): s is SponsorEntry => s !== null),
    });
  }
  return out;
}
