// Czysty stan formularzy ekranu "Lejek Google Ads": kampania, wiersz kosztu
// i wklejony raport kosztow (CSV z Google Ads albo z arkusza).
//
// WALIDACJA TU I W BAZIE. Reguly sa lustrem CHECK-ow i RAISE-ow migracji
// 20260927000300 - formularz podpowiada przed zapisem, baza i tak odrzuci to
// samo (`adminAdsFunnelErrors.ts` tlumaczy jej odmowy).
//
// KWOTY W MIKRO. Google Ads raportuje koszt w jednostkach waluty (albo
// w mikro-jednostkach w API); w bazie trzymamy mikro (1 PLN = 1 000 000), wiec
// kwota z formularza jest zamieniana na liczbe calkowita bez arytmetyki
// zmiennoprzecinkowej (inaczej 0,1 + 0,2 dawaloby grosze obok).
import type {
  AdCampaign,
  AdCampaignInput,
  AdCampaignMatchKind,
  AdCostRowInput,
} from "@/lib/events/adsFunnelApi";
import { cleanUtm } from "@/lib/analytics/adAttribution";
import { isValidConversionName } from "@/lib/events/adsOfflineConversions";

// ---------------------------------------------------------------------------
// KAMPANIA
// ---------------------------------------------------------------------------

export interface AdCampaignDraft {
  id: string | null;
  matchKind: AdCampaignMatchKind;
  matchValue: string;
  label: string;
  conversionActionName: string;
}

export type AdCampaignDraftField = "matchValue" | "label" | "conversionActionName";

export type AdCampaignDraftErrorKey =
  | "matchValueRequired"
  | "matchValueDigits"
  | "matchValueInvalid"
  | "labelRequired"
  | "labelTooLong"
  | "conversionNameInvalid";

export interface AdCampaignDraftError {
  field: AdCampaignDraftField;
  errorKey: AdCampaignDraftErrorKey;
}

export function emptyAdCampaignDraft(): AdCampaignDraft {
  return {
    id: null,
    matchKind: "utm_campaign",
    matchValue: "",
    label: "",
    conversionActionName: "",
  };
}

export function adCampaignDraftFrom(campaign: AdCampaign): AdCampaignDraft {
  return {
    id: campaign.id,
    matchKind: campaign.matchKind,
    matchValue: campaign.matchValue,
    label: campaign.label,
    conversionActionName: campaign.conversionActionName ?? "",
  };
}

const LABEL_MAX = 120;

export function validateAdCampaignDraft(draft: AdCampaignDraft): AdCampaignDraftError[] {
  const errors: AdCampaignDraftError[] = [];
  const value = draft.matchValue.trim();
  if (value === "") {
    errors.push({ field: "matchValue", errorKey: "matchValueRequired" });
  } else if (draft.matchKind === "google_ads_campaign_id" && !/^\d{1,20}$/.test(value)) {
    errors.push({ field: "matchValue", errorKey: "matchValueDigits" });
  } else if (draft.matchKind === "utm_campaign" && cleanUtm(value) === null) {
    errors.push({ field: "matchValue", errorKey: "matchValueInvalid" });
  }
  const label = draft.label.trim();
  if (label === "") errors.push({ field: "label", errorKey: "labelRequired" });
  else if (label.length > LABEL_MAX) errors.push({ field: "label", errorKey: "labelTooLong" });
  const conversion = draft.conversionActionName.trim();
  if (conversion !== "" && !isValidConversionName(conversion)) {
    errors.push({ field: "conversionActionName", errorKey: "conversionNameInvalid" });
  }
  return errors;
}

/** Ladunek zapisu - nowa kampania niesie wydarzenie, zmiana niesie `id`. */
export function adCampaignDraftToInput(draft: AdCampaignDraft, eventId: string): AdCampaignInput {
  const conversion = draft.conversionActionName.trim();
  return {
    ...(draft.id === null ? { eventId } : { id: draft.id }),
    matchKind: draft.matchKind,
    matchValue: draft.matchValue.trim(),
    label: draft.label.trim(),
    conversionActionName: conversion === "" ? null : conversion,
  };
}

// ---------------------------------------------------------------------------
// KOSZT
// ---------------------------------------------------------------------------

export const AD_COST_MAX_ROWS = 500;

/**
 * Kwota tekstowa -> mikro-jednostki albo `null`. Przyjmuje "1234", "1234.5",
 * "1 234,56", "1,234.56", "1.234,56": ostatni z separatorow (kropka/przecinek)
 * jest dziesietny, pozostale sa separatorami tysiecy.
 */
export function parseAmountToMicros(input: string): number | null {
  const compact = input.replace(/[\s\u00a0]/g, "");
  const lastSep = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
  const whole = lastSep === -1 ? compact : compact.slice(0, lastSep).replace(/[.,]/g, "");
  const fraction = lastSep === -1 ? "" : compact.slice(lastSep + 1);
  if (!/^\d{1,12}$/.test(whole) || !/^\d{0,6}$/.test(fraction)) return null;
  if (lastSep !== -1 && fraction === "") return null;
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
}

/** Mikro -> kwota do pola formularza ("123.45"). */
export function microsToAmountText(micros: number): string {
  const whole = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction === ""
    ? String(whole)
    : `${whole}.${fraction.length < 2 ? `${fraction}0` : fraction}`;
}

/** `YYYY-MM-DD` albo `DD.MM.YYYY` -> `YYYY-MM-DD` istniejacego dnia, inaczej `null`. */
export function parseCostDay(input: string): string | null {
  const value = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  const parts = iso ? [iso[1], iso[2], iso[3]] : dotted ? [dotted[3], dotted[2], dotted[1]] : null;
  if (parts === null) return null;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
}

function parseCount(input: string | undefined): number | null | "invalid" {
  const value = (input ?? "").replace(/[\s\u00a0]/g, "");
  if (value === "") return null;
  return /^\d{1,9}$/.test(value) ? Number(value) : "invalid";
}

export interface AdCostRowDraft {
  day: string;
  amount: string;
  currency: string;
}

export type AdCostErrorKey =
  | "dayInvalid"
  | "amountInvalid"
  | "currencyInvalid"
  | "countInvalid"
  | "dayDuplicate"
  | "tooManyRows"
  | "noRows";

/** Pojedynczy wiersz z formularza recznego -> wiersz wsadu albo klucz bledu. */
export function adCostRowFromDraft(
  draft: AdCostRowDraft,
): { row: AdCostRowInput } | { errorKey: AdCostErrorKey } {
  const day = parseCostDay(draft.day);
  if (day === null) return { errorKey: "dayInvalid" };
  const micros = parseAmountToMicros(draft.amount);
  if (micros === null) return { errorKey: "amountInvalid" };
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { errorKey: "currencyInvalid" };
  return { row: { day, costMicros: micros, currency } };
}

export interface AdCostPasteResult {
  rows: AdCostRowInput[];
  errors: { line: number; errorKey: AdCostErrorKey }[];
}

/** Komorki wiersza - `split` zawsze oddaje co najmniej jedna (stad krotka). */
function splitLine(line: string): [string, ...string[]] {
  const separator = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  return line.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")) as [
    string,
    ...string[],
  ];
}

/**
 * Wklejony raport kosztow: dzien, koszt, [waluta], [klikniecia], [wyswietlenia]
 * - tabulator (kopia z arkusza), srednik (CSV z polskim Excelem) albo przecinek
 * (wtedy kwota z kropka). Pierwsza linia, ktora nie zaczyna sie od daty, jest
 * naglowkiem i jest pomijana; kolejna taka linia to blad.
 */
export function parseCostsPaste(text: string, defaultCurrency: string): AdCostPasteResult {
  const rows: AdCostRowInput[] = [];
  const errors: AdCostPasteResult["errors"] = [];
  const days = new Set<string>();
  let headerSeen = false;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    const [dayCell, amountCell = "", currencyCell = "", clicksCell, impressionsCell] =
      splitLine(raw);
    const day = parseCostDay(dayCell);
    if (day === null) {
      if (!headerSeen && rows.length === 0 && errors.length === 0) {
        headerSeen = true;
        return;
      }
      errors.push({ line, errorKey: "dayInvalid" });
      return;
    }
    const micros = parseAmountToMicros(amountCell);
    if (micros === null) {
      errors.push({ line, errorKey: "amountInvalid" });
      return;
    }
    const currency = (currencyCell === "" ? defaultCurrency : currencyCell).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push({ line, errorKey: "currencyInvalid" });
      return;
    }
    const clicks = parseCount(clicksCell);
    const impressions = parseCount(impressionsCell);
    if (clicks === "invalid" || impressions === "invalid") {
      errors.push({ line, errorKey: "countInvalid" });
      return;
    }
    if (days.has(day)) {
      errors.push({ line, errorKey: "dayDuplicate" });
      return;
    }
    days.add(day);
    rows.push({ day, costMicros: micros, currency, clicks, impressions });
  });
  if (rows.length > AD_COST_MAX_ROWS) {
    errors.push({ line: lines.length, errorKey: "tooManyRows" });
  } else if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 1, errorKey: "noRows" });
  }
  return { rows, errors };
}
