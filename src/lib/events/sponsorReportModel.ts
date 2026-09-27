// MODEL RAPORTU DLA SPONSORÓW - czyste funkcje wspólne dla studia i strony
// dla sponsora: sumy do kafli, CTR, szereg dzienny z dniami bez pomiaru,
// rozbicie na miejsca i konfiguracja wykresu.
//
// „NIE WIEM" TO NIE ZERO. CTR przy zerze wyświetleń jest nieokreślony (`null`,
// kreska w kaflu), a nie „0%" - zero procent mówiłoby sponsorowi, że logo było
// widziane i nikt nie kliknął. Ta sama doktryna, co w `EventAnalyticsPanel`.
//
// GENERATOR TYPÓW KŁAMIE O NULLACH. Pola RETURNS TABLE są w `Database`
// niepuste, a średnia ocena bez ocen to NULL. Dlatego liczby czytamy przez
// `reportNumber()` / `reportRating()`, a nie wprost.
//
// DZIEŃ TO DZIEŃ W STREFIE WYDARZENIA (baza liczy go przy zapisie), więc tu
// nie ma już żadnej strefy - dni są napisami YYYY-MM-DD, a luki wypełniamy
// arytmetyką UTC na datach, bez zegara przeglądarki.
import { defaultChartConfig } from "@/lib/charts/parse";
import { slotForSeries } from "@/lib/charts/palette";
import type { ChartConfig } from "@/lib/charts/types";
import { formatNumber } from "@/lib/i18n/format";
import {
  SPONSOR_PLACEMENTS,
  isSponsorPlacement,
  type SponsorPlacement,
} from "@/lib/events/sponsorExposure";
import type {
  SponsorReportLeadsSeriesRow,
  SponsorReportSeriesRow,
  SponsorReportSummaryRow,
} from "@/lib/events/sponsorReportApi";

/** Liczba z wiersza bazy; wszystko, co nie jest skończoną liczbą, to 0. */
export function reportNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Średnia ocena albo `null`, gdy nikt nie ocenił (NULL z bazy). */
export function reportRating(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** CTR jako ułamek albo `null`, gdy nie było wyświetleń. */
export function sponsorCtr(clicks: number, views: number): number | null {
  return views > 0 ? clicks / views : null;
}

/** CTR do wyświetlenia („3,4%") albo `null` (kreska). */
export function formatCtr(ctr: number | null, lang: string): string | null {
  if (ctr === null) return null;
  return formatNumber(ctr, lang, { style: "percent", maximumFractionDigits: 1 });
}

/** CTR w procentach z jedną cyfrą po przecinku - do plików eksportu. */
export function ctrPercent(ctr: number | null): number | null {
  return ctr === null ? null : Math.round(ctr * 1000) / 10;
}

export interface SponsorReportTotals {
  viewsUnique: number;
  viewsTotal: number;
  clicksUnique: number;
  clicksTotal: number;
  materialOpens: number;
  leadsTotal: number;
  leadsConsented: number;
  /**
   * Spotkania UMÓWIONE (`meetings_accepted`: przyjęte, odbyte i nieobecność
   * po przyjęciu) - nie zaproszenia bez odpowiedzi, odmowy, odwołania ani
   * stary wiersz przełożonego spotkania.
   */
  meetingsScheduled: number;
  meetingsHeld: number;
}

/** Sumy do kafli - wszystkich sponsorów albo jednego (`sponsorId`). */
export function sponsorReportTotals(
  rows: readonly SponsorReportSummaryRow[],
  sponsorId: string | null,
): SponsorReportTotals {
  const totals: SponsorReportTotals = {
    viewsUnique: 0,
    viewsTotal: 0,
    clicksUnique: 0,
    clicksTotal: 0,
    materialOpens: 0,
    leadsTotal: 0,
    leadsConsented: 0,
    meetingsScheduled: 0,
    meetingsHeld: 0,
  };
  for (const row of rows) {
    if (sponsorId !== null && row.sponsor_id !== sponsorId) continue;
    totals.viewsUnique += reportNumber(row.views_unique);
    totals.viewsTotal += reportNumber(row.views_total);
    totals.clicksUnique += reportNumber(row.clicks_unique);
    totals.clicksTotal += reportNumber(row.clicks_total);
    totals.materialOpens += reportNumber(row.material_opens);
    totals.leadsTotal += reportNumber(row.leads_total);
    totals.leadsConsented += reportNumber(row.leads_consented);
    totals.meetingsScheduled += reportNumber(row.meetings_accepted);
    totals.meetingsHeld += reportNumber(row.meetings_held);
  }
  return totals;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** Najdłuższy szereg z wypełnionymi lukami (rok z zapasem) - dalej bez luk. */
const MAX_FILLED_DAYS = 400;

/** Kolejne dni od `from` do `to` włącznie (arytmetyka UTC na datach). */
export function eachDay(from: string, to: string): string[] {
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) return [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const out: string[] = [];
  for (let ms = start; ms <= end && out.length < MAX_FILLED_DAYS; ms += DAY_MS) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

export interface SponsorDailyPoint {
  day: string;
  viewsUnique: number;
  clicksUnique: number;
  materialOpens: number;
  leadsNew: number;
}

function emptyPoint(day: string): SponsorDailyPoint {
  return { day, viewsUnique: 0, clicksUnique: 0, materialOpens: 0, leadsNew: 0 };
}

/**
 * Szereg dzienny z dniami BEZ pomiaru wstawionymi jako zera. Oś kategorii
 * bez luk jest uczciwa: dzień bez wyświetleń to zero na wykresie, a nie brak
 * punktu, który rysuje linię prosto z poniedziałku do czwartku.
 */
export function fillDailyGaps(points: readonly SponsorDailyPoint[]): SponsorDailyPoint[] {
  const byDay = new Map<string, SponsorDailyPoint>();
  for (const point of points) {
    if (DAY_PATTERN.test(point.day)) byDay.set(point.day, point);
  }
  const days = [...byDay.keys()].sort();
  if (days.length === 0) return [];
  const filled = eachDay(days[0], days[days.length - 1]);
  const allDays = filled.length < MAX_FILLED_DAYS ? filled : days;
  return allDays.map((day) => byDay.get(day) ?? emptyPoint(day));
}

/** Szereg ekspozycji i szereg kontaktów -> jeden szereg dzienny. */
export function sponsorReportDaily(
  series: readonly SponsorReportSeriesRow[],
  leadsSeries: readonly SponsorReportLeadsSeriesRow[],
): SponsorDailyPoint[] {
  const byDay = new Map<string, SponsorDailyPoint>();
  const at = (day: string): SponsorDailyPoint => {
    const found = byDay.get(day);
    if (found !== undefined) return found;
    const fresh = emptyPoint(day);
    byDay.set(day, fresh);
    return fresh;
  };
  for (const row of series) {
    const point = at(row.day);
    point.viewsUnique += reportNumber(row.views_unique);
    point.clicksUnique += reportNumber(row.clicks_unique);
    point.materialOpens += reportNumber(row.material_opens);
  }
  for (const row of leadsSeries) {
    at(row.day).leadsNew += reportNumber(row.leads_new);
  }
  return fillDailyGaps([...byDay.values()]);
}

export interface SponsorPlacementRow {
  sponsorId: string;
  placement: SponsorPlacement;
  viewsUnique: number;
  viewsTotal: number;
  clicksUnique: number;
  clicksTotal: number;
  materialOpens: number;
}

/** Szereg dzienny -> sumy per sponsor x miejsce (kolejność: sponsor, miejsce). */
export function sponsorPlacementRows(
  series: readonly SponsorReportSeriesRow[],
  sponsorOrder: readonly string[],
): SponsorPlacementRow[] {
  const byKey = new Map<string, SponsorPlacementRow>();
  for (const row of series) {
    if (!isSponsorPlacement(row.placement)) continue;
    const key = `${row.sponsor_id}|${row.placement}`;
    const current = byKey.get(key) ?? {
      sponsorId: row.sponsor_id,
      placement: row.placement,
      viewsUnique: 0,
      viewsTotal: 0,
      clicksUnique: 0,
      clicksTotal: 0,
      materialOpens: 0,
    };
    current.viewsUnique += reportNumber(row.views_unique);
    current.viewsTotal += reportNumber(row.views_total);
    current.clicksUnique += reportNumber(row.clicks_unique);
    current.clicksTotal += reportNumber(row.clicks_total);
    current.materialOpens += reportNumber(row.material_opens);
    byKey.set(key, current);
  }
  const rank = (sponsorId: string): number => {
    const index = sponsorOrder.indexOf(sponsorId);
    return index === -1 ? sponsorOrder.length : index;
  };
  return [...byKey.values()].sort(
    (a, b) =>
      rank(a.sponsorId) - rank(b.sponsorId) ||
      SPONSOR_PLACEMENTS.indexOf(a.placement) - SPONSOR_PLACEMENTS.indexOf(b.placement),
  );
}

export interface SponsorChartSeries {
  name: string;
  values: readonly number[];
}

/**
 * Konfiguracja wykresu liniowego dla silnika `<Chart>` - bez `ChartCard`
 * z panelu, żeby strona dla sponsora nie wciągała modułu analityki panelu.
 * Łamana (bez wygładzania): szereg dzienny z zerami czyta się uczciwiej.
 */
export function sponsorReportChartConfig(
  categories: readonly string[],
  series: readonly SponsorChartSeries[],
): ChartConfig {
  const base = defaultChartConfig();
  return {
    ...base,
    kind: "line",
    title: "",
    description: "",
    categories: [...categories],
    series: series.map((item, index) => ({
      name: item.name,
      values: [...item.values],
      colorSlot: slotForSeries(index),
    })),
    showLegend: series.length > 1,
    showGrid: true,
    smoothing: 0,
    animate: false,
  };
}
