// ETYKIETY OSI I KLUCZY TECHNICZNYCH.
//
// Funkcje bazy oddają kubełek jako czas ŚCIENNY w postaci "YYYY-MM-DD HH:MM"
// (przesunięcie strefy zostało już doliczone po stronie SQL - patrz nagłówek
// migracji). Klient nie ma więc czego konwertować i NIE WOLNO mu tego zrobić:
// `new Date("2026-03-12 00:00")` przeczytałoby ten napis jako czas lokalny
// i doliczyło przesunięcie DRUGI RAZ.
import { uiLocale, type UiLang } from "@/lib/i18n/format";
import type { DashboardBucket } from "./period";

/**
 * Krótka etykieta kubełka pod oś wykresu.
 *
 * Oś ma być czytelna, a nie kompletna: pełny znacznik niesie dymek i tabela
 * danych silnika, więc etykieta może zostawić tylko to, co ROZRÓŻNIA sąsiednie
 * punkty - godzinę w dobie, dzień w miesiącu, miesiąc w roku.
 */
export function bucketLabel(bucket: string, kind: DashboardBucket): string {
  // "YYYY-MM-DD HH:MM" -> części, bez parsowania do Date.
  const [date = "", time = ""] = bucket.split(" ");
  const [year = "", month = "", day = ""] = date.split("-");

  switch (kind) {
    case "minute":
    case "hour":
      return time;
    case "month":
      return `${year}-${month}`;
    case "day":
    case "week":
    default:
      return `${month}-${day}`;
  }
}

/**
 * Nazwa kraju z kodu ISO w języku panelu, z odwrotem do samego kodu.
 *
 * `Intl.DisplayNames` daje nazwy bez ładowania własnego słownika krajów - ta
 * sama tablica, której przeglądarka używa do własnego interfejsu. Konstruktor
 * jest opakowany, bo w środowisku bez pełnych danych ICU rzuca, a lista krajów
 * na pulpicie nie jest warta wywrócenia strony.
 */
export function countryNamer(lang: UiLang): (code: string) => string {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([uiLocale(lang)], { type: "region" });
  } catch {
    display = null;
  }
  return (code: string) => {
    if (!display) return code;
    try {
      return display.of(code) ?? code;
    } catch {
      return code;
    }
  };
}

/**
 * Etykieta klucza technicznego (etap lejka, źródło, rola, poziom) ze słownika,
 * z odwrotem do surowego klucza.
 *
 * ODWRÓT JEST TU OBOWIĄZKOWY, nie defensywny: `crm_stage`, `app_role` i klucze
 * poziomów członkostwa mieszkają w bazie i przybywa ich migracją, a słownik
 * panelu jest osobnym plikiem. Gdyby brak tłumaczenia dawał pusty napis, nowy
 * etap zniknąłby z lejka zamiast pokazać się pod technicznym kluczem - a
 * zniknięcie wiersza jest gorsze od brzydkiego wiersza.
 */
export function labelOrKey(translated: string, fullKey: string, raw: string): string {
  return translated === fullKey ? raw : translated;
}
