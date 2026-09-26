// Plik importu konwersji offline Google Ads ("konwersje z klikniec").
//
// FORMAT (Google Ads -> Cele -> Konwersje -> Przeslane pliki, szablon CSV):
//   Parameters:TimeZone=Europe/Warsaw
//   Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Ad User Data,Ad Personalization
//   Cj0KCQjw...,Bilet Kongres,2026-09-26 14:05:00,499.00,PLN,GRANTED,GRANTED
// Czas w strefie z naglowka (`yyyy-MM-dd HH:mm:ss`, liczony w bazie w strefie
// wydarzenia), wartosc w jednostkach waluty z kropka. Klikniecia z iOS
// (gbraid/wbraid) nie maja gclid - gdy w pliku sa takie wiersze, dochodza
// kolumny `GBRAID` i `WBRAID`, a w kazdym wierszu wypelniona jest dokladnie
// jedna z trzech. Kolumny zgody (EU user consent policy) sa zawsze GRANTED,
// bo baza oddaje wylacznie klikniecia zebrane przy zgodzie reklamowej.
// Szablon moze sie roznic miedzy kontami - naglowki trzeba porownac
// z szablonem pobranym z docelowego konta (ekran mowi to wprost).
//
// DLACZEGO NIE `csvCell`. Wspolny serializator (`src/lib/crm/csv.ts`) dokleja
// apostrof przed znakiem formuly - w pliku importu taki apostrof psuje wartosc
// (np. identyfikator zaczynajacy sie od `-`). Tu KAZDA komorka przechodzi
// biala liste (regex), wiec wstrzykniecie formuly jest niemozliwe z konstrukcji:
// wiersz, ktorego komorka nie pasuje, NIE trafia do pliku (liczy sie jako
// odrzucony), zamiast byc "naprawiony". Bez BOM - import Google Ads go nie chce.
import type { AdsConversionRow, AdsConversionsExport } from "@/lib/events/adsFunnel";

export const OFFLINE_CONVERSIONS_MIME = "text/csv;charset=utf-8";

const CLICK_ID_RE = /^[A-Za-z0-9_-]{10,512}$/;
// Bez przecinka, cudzyslowu i znakow sterujacych; nie zaczyna sie od znaku formuly.
// eslint-disable-next-line no-control-regex -- celowo: znaki sterujace poza biala lista
const CONVERSION_NAME_RE = /^[^,"=+@\-\u0000-\u001f\u007f][^,"\u0000-\u001f\u007f]{0,99}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const VALUE_RE = /^\d{1,13}\.\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const TIMEZONE_RE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const FALLBACK_TIMEZONE = "Europe/Warsaw";

/** Czy nazwa konwersji przejdzie biala liste pliku (i CHECK w bazie). */
export function isValidConversionName(value: string): boolean {
  return CONVERSION_NAME_RE.test(value);
}

/** Grosze -> "499.00" (bez separatora tysiecy, kropka dziesietna). */
export function centsToDecimal(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${whole}.${rest < 10 ? "0" : ""}${rest}`;
}

export interface OfflineConversionsCsv {
  csv: string;
  /** Wiersze w pliku. */
  included: number;
  /** Bez nazwy konwersji (ani w kampanii, ani domyslnej). */
  missingName: number;
  /** Komorka poza biala lista - wiersz pominiety. */
  rejected: number;
}

function cellsOf(
  row: AdsConversionRow,
  name: string,
  withBraid: boolean,
): readonly string[] | null {
  const value = centsToDecimal(row.valueCents);
  const consent = (granted: boolean): string => (granted ? "GRANTED" : "DENIED");
  const ok =
    CLICK_ID_RE.test(row.clickId) &&
    CONVERSION_NAME_RE.test(name) &&
    TIME_RE.test(row.conversionTimeLocal) &&
    VALUE_RE.test(value) &&
    CURRENCY_RE.test(row.currency);
  if (!ok) return null;
  const click = withBraid
    ? [
        row.clickType === "gclid" ? row.clickId : "",
        row.clickType === "gbraid" ? row.clickId : "",
        row.clickType === "wbraid" ? row.clickId : "",
      ]
    : [row.clickId];
  return [
    ...click,
    name,
    row.conversionTimeLocal,
    value,
    row.currency,
    consent(row.adUserData),
    consent(row.adPersonalization),
  ];
}

/**
 * Plik importu z wierszy eksportu. `defaultConversionName` uzupelnia wiersze,
 * ktorych kampania nie ma wlasnej nazwy konwersji (`null` = bez uzupelnienia).
 */
export function buildOfflineConversionsCsv(
  data: AdsConversionsExport,
  defaultConversionName: string | null,
): OfflineConversionsCsv {
  const fallback = defaultConversionName?.trim() || null;
  const withBraid = data.rows.some((row) => row.clickType !== "gclid");
  const timezone = TIMEZONE_RE.test(data.timezone) ? data.timezone : FALLBACK_TIMEZONE;
  const lines = [
    `Parameters:TimeZone=${timezone}`,
    [
      ...(withBraid ? ["Google Click ID", "GBRAID", "WBRAID"] : ["Google Click ID"]),
      "Conversion Name",
      "Conversion Time",
      "Conversion Value",
      "Conversion Currency",
      "Ad User Data",
      "Ad Personalization",
    ].join(","),
  ];
  let missingName = 0;
  let rejected = 0;
  for (const row of data.rows) {
    const name = row.conversionActionName ?? fallback;
    if (name === null) {
      missingName += 1;
      continue;
    }
    const cells = cellsOf(row, name, withBraid);
    if (cells === null) {
      rejected += 1;
      continue;
    }
    lines.push(cells.join(","));
  }
  return {
    csv: `${lines.join("\n")}\n`,
    included: lines.length - 2,
    missingName,
    rejected,
  };
}

/** Nazwa pliku: `google-ads-conversions-<slug>-<dzien>.csv`. */
export function offlineConversionsFileName(eventSlug: string, nowIso: string): string {
  const slug = eventSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `google-ads-conversions-${slug === "" ? "event" : slug}-${nowIso.slice(0, 10)}.csv`;
}
