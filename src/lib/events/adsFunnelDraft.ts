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

export interface ParsedAmount {
  micros: number;
  /** Waluta z kwoty ("PLN 12.50", "12,50 zl", "€5") albo `null` (brak, "$"). */
  currency: string | null;
}

// Jeden znacznik waluty na poczatku ALBO na koncu kwoty (jak kopiuje go arkusz):
// kod ISO, "zl" (PLN), "€" (EUR), "$" (bez waluty - dolarow jest kilka). Kod
// niezgodny z waluta wiersza to blad waluty, a nie cicha zamiana.
const CURRENCY_TOKEN = "[a-z]{3}|zł|€|\\$";
const LEADING_CURRENCY = new RegExp(`^(${CURRENCY_TOKEN})`, "i");
const TRAILING_CURRENCY = new RegExp(`(${CURRENCY_TOKEN})$`, "i");

function tokenCurrency(token: string): string | null {
  if (token === "$") return null;
  if (token === "€") return "EUR";
  if (token.toLowerCase() === "zł") return "PLN";
  return token.toUpperCase();
}

/** Grupy tysiecy: "1,234,567" / "1.234" - pierwsza grupa 1-3 cyfry, reszta po 3. */
function isGrouped(value: string, separator: string): boolean {
  return (separator === "," ? /^\d{1,3}(,\d{3})+$/ : /^\d{1,3}(\.\d{3})+$/).test(value);
}

/** Czesc calkowita i ulamek bez znacznika waluty albo `null` (zapis niejednoznaczny/zly). */
function splitAmount(body: string): { whole: string; fraction: string } | null {
  if (!/^[\d.,]+$/.test(body)) return null;
  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Oba separatory: pozniejszy jest dziesietny (jeden), wczesniejszy grupuje tysiace.
    const decimal = lastComma > lastDot ? "," : ".";
    const at = Math.max(lastComma, lastDot);
    if (body.indexOf(decimal) !== at) return null;
    const head = body.slice(0, at);
    const fraction = body.slice(at + 1);
    if (fraction === "" || !isGrouped(head, decimal === "," ? "." : ",")) return null;
    return { whole: head.replace(/[.,]/g, ""), fraction };
  }
  const separator = lastComma !== -1 ? "," : lastDot !== -1 ? "." : null;
  if (separator === null) return { whole: body, fraction: "" };
  const at = body.indexOf(separator);
  if (at !== body.lastIndexOf(separator)) {
    // Ten sam separator kilka razy = wylacznie tysiace, bez ulamka.
    return isGrouped(body, separator)
      ? { whole: body.split(separator).join(""), fraction: "" }
      : null;
  }
  const head = body.slice(0, at);
  const tail = body.slice(at + 1);
  // "1,234" / "1.234": tysiac dwiescie trzydziesci cztery czy 1,234? Nie zgadujemy.
  if (tail === "" || (/^\d{3}$/.test(tail) && /^[1-9]\d{0,2}$/.test(head))) return null;
  return { whole: head, fraction: tail };
}

/**
 * Kwota tekstowa -> mikro-jednostki i waluta z kwoty albo `null`. Przyjmuje
 * "1234", "1234.5", "1 234,56", "1,234.56", "1.234,56", "1,234,567", "12,50 zl",
 * "PLN 12.50": przy obu separatorach pozniejszy jest dziesietny (raz), a grupy
 * tysiecy musza byc po trzy cyfry. Pojedynczy separator z DOKLADNIE trzema
 * cyframi po nim ("1,234") jest niejednoznaczny i odrzucany.
 */
export function parseAmount(input: string): ParsedAmount | null {
  let body = input.replace(/\s/g, "");
  let currency: string | null = null;
  const token = LEADING_CURRENCY.exec(body) ?? TRAILING_CURRENCY.exec(body);
  if (token !== null) {
    const found = token[1] as string;
    currency = tokenCurrency(found);
    body = token.index === 0 ? body.slice(found.length) : body.slice(0, token.index);
  }
  const parts = splitAmount(body);
  if (parts === null) return null;
  if (!/^\d{1,12}$/.test(parts.whole) || !/^\d{0,6}$/.test(parts.fraction)) return null;
  return {
    micros: Number(parts.whole) * 1_000_000 + Number(parts.fraction.padEnd(6, "0")),
    currency,
  };
}

/** Sama kwota w mikro (bez waluty) - patrz `parseAmount`. */
export function parseAmountToMicros(input: string): number | null {
  return parseAmount(input)?.micros ?? null;
}

/** Waluta wiersza zgodna z waluta zapisana przy kwocie (brak przy kwocie = zgodna). */
function currencyMatches(amount: ParsedAmount, currency: string): boolean {
  return amount.currency === null || amount.currency === currency;
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
  const amount = parseAmount(draft.amount);
  if (amount === null) return { errorKey: "amountInvalid" };
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || !currencyMatches(amount, currency)) {
    return { errorKey: "currencyInvalid" };
  }
  return { row: { day, costMicros: amount.micros, currency } };
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
    const amount = parseAmount(amountCell);
    if (amount === null) {
      errors.push({ line, errorKey: "amountInvalid" });
      return;
    }
    const currency = (currencyCell === "" ? defaultCurrency : currencyCell).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || !currencyMatches(amount, currency)) {
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
    rows.push({ day, costMicros: amount.micros, currency, clicks, impressions });
  });
  if (rows.length > AD_COST_MAX_ROWS) {
    errors.push({ line: lines.length, errorKey: "tooManyRows" });
  } else if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 1, errorKey: "noRows" });
  }
  return { rows, errors };
}
