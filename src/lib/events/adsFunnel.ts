// Czysty model raportu "Lejek Google Ads": parsery odpowiedzi `jsonb`
// i wskazniki liczone NULL-bezpiecznie.
//
// PARSER, NIE RZUTOWANIE. `admin_event_ads_funnel` i `..._conversions_export`
// zwracaja `jsonb`; zamiast recznego typu za `as unknown as` kazde pole
// przechodzi przez mala funkcje, ktora zna swoj ksztalt (liczba albo 0, napis
// albo null). Zmiana ksztaltu w SQL daje w raporcie zera i kreski - nie wyjatek
// w srodku renderu.
//
// "NIE WIEM" TO NIE ZERO. Wskazniki (konwersja, CPA, ROAS) wracaja `null`, gdy
// nie ma z czego ich policzyc: zerowy mianownik, brak kosztu, WIELE walut
// kosztu albo przychod w innej walucie niz koszt - nigdy nie sumujemy zlotych
// z euro. Ekran pokazuje wtedy kreske.
//
// POPULACJE SIE NIE MIESZAJA. Wizyty licza wylacznie przegladarki ze zgoda
// analytics, a zgloszenia bez atrybucji (brak zgody, import, zaproszenie) sa
// osobnym wierszem - wskaznik "wizyta -> zapis" liczymy tylko wewnatrz grupy
// kampanii, nigdy z sumy wszystkich zapisow podzielonej przez wizyty.
import type { Json } from "@/integrations/supabase/types";
import { resolveWindow } from "@/lib/analytics/semantic/window";
import type { ClickIdType } from "@/lib/analytics/adAttribution";

export interface MoneyAmount {
  currency: string;
  /** Jednostki drobne (grosze). */
  cents: number;
}

export interface CostAmount {
  currency: string;
  /** Mikro-jednostki (1 PLN = 1 000 000), jak w Google Ads. */
  micros: number;
}

export interface FunnelCounts {
  visits: number;
  registrationStarts: number;
  checkoutStarts: number;
  registrations: number;
  paid: number;
}

export interface AdsFunnelChannel extends FunnelCounts {
  source: string;
  medium: string;
  revenue: MoneyAmount[];
}

// `other` - kampanie UTM i identyfikatory Google Ads spoza 50 najliczniejszych
// w oknie, zwiniete przez baze w jeden wiersz (`groups_folded` mowi, ile).
// Kazda wartosc utm_campaign z publicznego beaconu byla wlasna grupa, wiec
// obcy mogl rozdmuchac raport dowolnie.
export const ADS_FUNNEL_GROUP_KINDS = [
  "campaign",
  "utm_campaign",
  "gad_campaign",
  "other",
  "none",
] as const;
export type AdsFunnelGroupKind = (typeof ADS_FUNNEL_GROUP_KINDS)[number];

export interface AdsFunnelGroup extends FunnelCounts {
  key: string;
  kind: AdsFunnelGroupKind;
  campaignId: string | null;
  label: string | null;
  utmCampaign: string | null;
  gadCampaignId: string | null;
  revenue: MoneyAmount[];
  cost: CostAmount[];
  channels: AdsFunnelChannel[];
}

export interface AdsFunnelReport {
  timezone: string;
  groups: AdsFunnelGroup[];
  /** Ile grup UTM / Google Ads zwinieto w grupe `other`. */
  groupsFolded: number;
  unattributed: { registrations: number; paid: number; revenue: MoneyAmount[] };
  totals: FunnelCounts & {
    attributedRegistrations: number;
    revenue: MoneyAmount[];
    cost: CostAmount[];
  };
}

export interface AdsConversionRow {
  /** Zamowienie platnosci albo - dla pakietu grupowego - zamowienie pakietu. */
  orderId: string;
  /** Pusty napis dla zakupu pakietu (konwersja bez zgloszenia). */
  registrationId: string;
  clickType: ClickIdType;
  clickId: string;
  conversionActionName: string | null;
  /** Instant ISO (UTC). */
  conversionTime: string;
  /** `yyyy-MM-dd HH:mm:ss` w strefie wydarzenia (policzone w bazie). */
  conversionTimeLocal: string;
  valueCents: number;
  currency: string;
  adUserData: boolean;
  adPersonalization: boolean;
}

export interface AdsConversionsExport {
  timezone: string;
  rows: AdsConversionRow[];
  skipped: {
    unattributed: number;
    noClick: number;
    expired: number;
    beforeClick: number;
    /** Platnik albo posiadacz biletu cofnal zgode na cookies marketingowe. */
    consentWithdrawn: number;
    /** Oplacone, ale jeszcze nieprzyjete (akceptacja organizatora, lista rezerwowa). */
    awaitingAdmission: number;
  };
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function list(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function money(value: unknown): MoneyAmount[] {
  return list(value)
    .map((item) => ({ currency: text(item.currency) ?? "", cents: count(item.cents) }))
    .filter((item) => item.currency !== "");
}

function costs(value: unknown): CostAmount[] {
  return list(value)
    .map((item) => ({ currency: text(item.currency) ?? "", micros: count(item.micros) }))
    .filter((item) => item.currency !== "");
}

function counts(item: JsonRecord): FunnelCounts {
  return {
    visits: count(item.visits),
    registrationStarts: count(item.registration_starts),
    checkoutStarts: count(item.checkout_starts),
    registrations: count(item.registrations),
    paid: count(item.paid),
  };
}

function groupKind(value: unknown): AdsFunnelGroupKind {
  return ADS_FUNNEL_GROUP_KINDS.find((kind) => kind === value) ?? "none";
}

export function parseAdsFunnelReport(raw: Json | null): AdsFunnelReport {
  const root = record(raw);
  const unattributed = record(root.unattributed);
  const totals = record(root.totals);
  return {
    timezone: text(record(root.window).timezone) ?? "Europe/Warsaw",
    groupsFolded: count(root.groups_folded),
    groups: list(root.groups).map((item) => ({
      ...counts(item),
      key: text(item.key) ?? "none",
      kind: groupKind(item.kind),
      campaignId: text(item.campaign_id),
      label: text(item.label),
      utmCampaign: text(item.utm_campaign),
      gadCampaignId: text(item.gad_campaign_id),
      revenue: money(item.revenue),
      cost: costs(item.cost),
      channels: list(item.channels).map((channel) => ({
        ...counts(channel),
        source: text(channel.source) ?? "(not set)",
        medium: text(channel.medium) ?? "(not set)",
        revenue: money(channel.revenue),
      })),
    })),
    unattributed: {
      registrations: count(unattributed.registrations),
      paid: count(unattributed.paid),
      revenue: money(unattributed.revenue),
    },
    totals: {
      ...counts(totals),
      attributedRegistrations: count(totals.attributed_registrations),
      revenue: money(totals.revenue),
      cost: costs(totals.cost),
    },
  };
}

function clickType(value: unknown): ClickIdType | null {
  return value === "gclid" || value === "gbraid" || value === "wbraid" ? value : null;
}

export function parseAdsConversionsExport(raw: Json | null): AdsConversionsExport {
  const root = record(raw);
  const skipped = record(root.skipped);
  const rows: AdsConversionRow[] = [];
  for (const item of list(root.rows)) {
    const type = clickType(item.click_id_type);
    const clickId = text(item.click_id);
    const currency = text(item.currency);
    const local = text(item.conversion_time_local);
    if (type === null || clickId === null || currency === null || local === null) continue;
    rows.push({
      orderId: text(item.order_id) ?? "",
      registrationId: text(item.registration_id) ?? "",
      clickType: type,
      clickId,
      conversionActionName: text(item.conversion_action_name),
      conversionTime: text(item.conversion_time) ?? "",
      conversionTimeLocal: local,
      valueCents: count(item.value_cents),
      currency,
      adUserData: item.ad_user_data === true,
      adPersonalization: item.ad_personalization === true,
    });
  }
  return {
    timezone: text(root.timezone) ?? "Europe/Warsaw",
    rows,
    skipped: {
      unattributed: count(skipped.unattributed),
      noClick: count(skipped.no_click),
      expired: count(skipped.expired),
      beforeClick: count(skipped.before_click),
      consentWithdrawn: count(skipped.consent_withdrawn),
      awaitingAdmission: count(skipped.awaiting_admission),
    },
  };
}

// ---------------------------------------------------------------------------
// WSKAZNIKI
// ---------------------------------------------------------------------------

/** Udzial kroku w poprzednim (0..1) albo `null` przy zerowym mianowniku. */
export function stepRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Koszt na oplacone zgloszenie - tylko przy JEDNEJ walucie kosztu. */
export function costPerAcquisition(cost: readonly CostAmount[], paid: number): CostAmount | null {
  if (cost.length !== 1 || paid <= 0) return null;
  const only = cost[0] as CostAmount;
  return { currency: only.currency, micros: only.micros / paid };
}

/**
 * Zwrot z wydatkow reklamowych (przychod / koszt) - tylko gdy koszt ma jedna
 * walute, jest niezerowy i caly przychod jest w TEJ samej walucie.
 */
export function returnOnAdSpend(
  revenue: readonly MoneyAmount[],
  cost: readonly CostAmount[],
): number | null {
  if (cost.length !== 1) return null;
  const only = cost[0] as CostAmount;
  if (only.micros <= 0 || revenue.some((item) => item.currency !== only.currency)) return null;
  const cents = revenue.reduce((sum, item) => sum + item.cents, 0);
  // 1 jednostka waluty = 100 groszy = 1 000 000 mikro.
  return (cents * 10_000) / only.micros;
}

/**
 * ROAS kafla podsumowania: przychod / koszt kampanii zmapowanych - ale TYLKO
 * tych, ktore maja koszt. Kampania bez wpisanego kosztu doliczala przychod do
 * licznika bez niczego w mianowniku (600 zl / 100 zl i 200 zl bez kosztu dawaly
 * 8,00x zamiast 6,00x). Brak kosztu w ogole = `null` (kreska).
 */
export function mappedCampaignsRoas(groups: readonly AdsFunnelGroup[]): number | null {
  const withCost = groups.filter(
    (group) => group.kind === "campaign" && group.cost.some((item) => item.micros > 0),
  );
  const cost = new Map<string, number>();
  for (const group of withCost) {
    for (const item of group.cost) {
      cost.set(item.currency, (cost.get(item.currency) ?? 0) + item.micros);
    }
  }
  return returnOnAdSpend(
    withCost.flatMap((group) => group.revenue),
    [...cost].map(([currency, micros]) => ({ currency, micros })),
  );
}

/** Mikro-jednostki -> jednostki drobne (grosze), zaokraglone. */
export function microsToCents(micros: number): number {
  return Math.round(micros / 10_000);
}

// ---------------------------------------------------------------------------
// OKNO CZASU
// ---------------------------------------------------------------------------

export const ADS_FUNNEL_WINDOW_PRESETS = ["7d", "28d", "90d", "all"] as const;
export type AdsFunnelWindowPreset = (typeof ADS_FUNNEL_WINDOW_PRESETS)[number];

/**
 * Granice okna raportu. Okna dzienne biora kanoniczny resolwer warstwy
 * semantycznej (pelne dni UTC) Z dniem biezacym - organizator patrzy na
 * kampanie, ktora trwa - a gorna granica jest otwarta (`null` = "do teraz").
 */
export function adsFunnelWindow(
  preset: AdsFunnelWindowPreset,
  nowMs: number,
): { from: string | null; to: string | null } {
  if (preset === "all") return { from: null, to: null };
  const window = resolveWindow({ presetId: preset, nowMs, includeOpenDay: true });
  return { from: window.sinceIso, to: null };
}
