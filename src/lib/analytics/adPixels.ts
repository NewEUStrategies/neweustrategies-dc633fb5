// Pomiar pikseli reklamowych (Meta Pixel, Google Ads, LinkedIn Insight) PO
// zgodzie marketingowej - czysta logika współdzielona przez klienta (lustro
// zdarzeń) i serwer (agregacja do panelu /admin/analytics -> „Piksele Ads").
//
// ŹRÓDŁO LICZB. Piksele wysyłają dane bezpośrednio do Meta/Google/LinkedIn,
// a ich raporty nie wracają do nas. Panel liczy więc WŁASNE lustro: w chwili,
// gdy skrypt platformy rusza po zgodzie, zapisujemy w `analytics_events`
// zdarzenie `ad_pixel_visit` z listą aktywnych platform; konwersja (formularz,
// rejestracja, klik w strategię) zapisuje `ad_pixel_conversion`. Lustro
// jedzie przez `track()`, więc wymaga też zgody analitycznej - odwiedzający
// z samą zgodą marketingową nie jest liczony (zaniżenie jawne w panelu).

export const AD_PLATFORMS = ["meta", "google_ads", "linkedin"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const AD_PIXEL_VISIT_EVENT = "ad_pixel_visit";
export const AD_PIXEL_CONVERSION_EVENT = "ad_pixel_conversion";
export const AD_PIXEL_EVENTS = [AD_PIXEL_VISIT_EVENT, AD_PIXEL_CONVERSION_EVENT] as const;

const PLATFORM_SET: ReadonlySet<string> = new Set(AD_PLATFORMS);

/** Lista platform -> napis do `meta.platforms` (kolejność kanoniczna, bez duplikatów). */
export function encodePlatforms(platforms: readonly AdPlatform[]): string {
  return AD_PLATFORMS.filter((p) => platforms.includes(p)).join(",");
}

/** Napis z `meta.platforms` -> lista znanych platform; śmieci odpadają. */
export function decodePlatforms(raw: unknown): AdPlatform[] {
  if (typeof raw !== "string") return [];
  const parts = new Set(raw.split(",").map((s) => s.trim()));
  return AD_PLATFORMS.filter((p) => parts.has(p) && PLATFORM_SET.has(p));
}

export interface AdPixelRawRow {
  event_name: string;
  created_at: string;
  meta: Record<string, unknown> | null;
}

export interface PlatformTotals {
  visits: number;
  conversions: number;
}

export interface AdPixelDay {
  date: string;
  visits: Record<AdPlatform, number>;
  conversions: Record<AdPlatform, number>;
}

export interface AdPixelSummary {
  windowDays: number;
  totals: Record<AdPlatform, PlatformTotals>;
  /** Wizyty z co najmniej jedną aktywną platformą (bez podwójnego liczenia). */
  consentedVisits: number;
  conversions: number;
  /** Rozbicie konwersji po rodzaju (form_submit, registration, strategy_click…). */
  conversionKinds: Array<{ kind: string; count: number }>;
  daily: AdPixelDay[];
}

function zeroRecord(): Record<AdPlatform, number> {
  return { meta: 0, google_ads: 0, linkedin: 0 };
}

/** Kolejne dni UTC (YYYY-MM-DD) kończące się na `now`, łącznie `days`. */
export function dayKeys(days: number, now: Date): string[] {
  const out: string[] = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export function aggregateAdPixelRows(
  rows: readonly AdPixelRawRow[],
  days: number,
  now: Date = new Date(),
): AdPixelSummary {
  const keys = dayKeys(days, now);
  const byDay = new Map<string, AdPixelDay>(
    keys.map((date) => [date, { date, visits: zeroRecord(), conversions: zeroRecord() }]),
  );
  const totals: Record<AdPlatform, PlatformTotals> = {
    meta: { visits: 0, conversions: 0 },
    google_ads: { visits: 0, conversions: 0 },
    linkedin: { visits: 0, conversions: 0 },
  };
  const kinds = new Map<string, number>();
  let consentedVisits = 0;
  let conversions = 0;

  for (const row of rows) {
    const platforms = decodePlatforms(row.meta?.["platforms"]);
    if (platforms.length === 0) continue;
    const day = byDay.get(row.created_at.slice(0, 10));
    const isVisit = row.event_name === AD_PIXEL_VISIT_EVENT;
    const isConversion = row.event_name === AD_PIXEL_CONVERSION_EVENT;
    if (!isVisit && !isConversion) continue;
    if (isVisit) consentedVisits += 1;
    if (isConversion) {
      conversions += 1;
      const rawKind = row.meta?.["conversion"];
      const kind = typeof rawKind === "string" && rawKind ? rawKind : "other";
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    for (const p of platforms) {
      if (isVisit) {
        totals[p].visits += 1;
        if (day) day.visits[p] += 1;
      } else {
        totals[p].conversions += 1;
        if (day) day.conversions[p] += 1;
      }
    }
  }

  return {
    windowDays: days,
    totals,
    consentedVisits,
    conversions,
    conversionKinds: [...kinds.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    daily: keys.map((k) => byDay.get(k) ?? { date: k, visits: zeroRecord(), conversions: zeroRecord() }),
  };
}

/** Współczynnik konwersji w procentach (1 miejsce), 0 przy braku wizyt. */
export function conversionRate(visits: number, conversions: number): number {
  if (visits <= 0) return 0;
  return Math.round((conversions / visits) * 1000) / 10;
}
