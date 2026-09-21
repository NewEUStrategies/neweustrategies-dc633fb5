// Konwersje przeniesione z WordPressa do tagu Google.
//
// W WordPressie konwersje siedziały w dwóch wtyczkach: wysłanie formularza
// (lead) oraz kliknięcie w konkretną strategię/analizę. Tutaj obie jadą jedną
// ścieżką:
//   1. nasz silnik `track()` -> `analytics_events` (raporty admina),
//   2. mostek `ga4EventMap` -> zdarzenie rekomendowane GA4 (`generate_lead`,
//      `select_content`) - z tego GA4 robi kluczowe zdarzenie i eksportuje je
//      do Google Ads przez połączenie kont,
//   3. opcjonalnie natychmiastowa konwersja Google Ads (`send_to
//      AW-…/<etykieta>`), gdy etykieta konwersji jest skonfigurowana.
//
// Etykiet konwersji Ads NIE zgadujemy: bez nich pomiar działa przez import z
// GA4, a po wpisaniu etykiety do zmiennych środowiskowych ten sam klik zgłasza
// konwersję również bezpośrednio do Ads (Ads deduplikuje po `transaction_id`).

import { ga4Event } from "./ga4Client";
import { GOOGLE_ADS_ID } from "./tagIds";
import { track } from "./track";

/** Etykieta konwersji Ads dla leada z formularza (np. `abCdEfGhIj`). */
const ADS_LEAD_LABEL = String(import.meta.env.VITE_GOOGLE_ADS_LEAD_LABEL ?? "").trim();
/** Etykieta konwersji Ads dla kliknięcia w strategię. */
const ADS_CONTENT_LABEL = String(import.meta.env.VITE_GOOGLE_ADS_CONTENT_LABEL ?? "").trim();

/** Etykieta konwersji: litery, cyfry, `-` i `_`; nic więcej nie trafia do `send_to`. */
const LABEL_RE = /^[A-Za-z0-9_-]{4,40}$/;

export function adsSendTo(label: string): string {
  const clean = label.trim();
  return LABEL_RE.test(clean) ? `${GOOGLE_ADS_ID}/${clean}` : "";
}

/** Natychmiastowa konwersja Google Ads. No-op bez poprawnej etykiety. */
export function adsConversion(
  label: string,
  params: { value?: number; currency?: string; transaction_id?: string } = {},
): void {
  const sendTo = adsSendTo(label);
  if (!sendTo) return;
  ga4Event("conversion", { send_to: sendTo, ...params });
}

export interface FormConversionInput {
  /** Identyfikator formularza (blok/embed) - rozróżnia formularze w raportach. */
  formId: string;
  /** Nazwa czytelna dla człowieka (tytuł bloku). */
  formName?: string;
  lang?: string;
  /** Ścieżka, na której formularz stał (domyślnie bieżąca). */
  path?: string;
}

/**
 * Wysłanie formularza = lead. Woła się PO potwierdzeniu zapisu przez serwer,
 * nigdy na kliknięcie „wyślij" - inaczej Ads liczyłby też odrzucone próby.
 */
export function trackFormConversion(input: FormConversionInput): void {
  track({
    type: "conversion",
    name: "form_submit",
    entityType: "form",
    entityId: input.formId,
    path: input.path,
    meta: {
      form_name: input.formName ?? "",
      form_lang: input.lang ?? "",
    },
  });
  adsConversion(ADS_LEAD_LABEL, { transaction_id: `lead_${input.formId}_${Date.now()}` });
}

export interface StrategyConversionInput {
  /** Id wpisu, a gdy go nie ma - jego ścieżka. Klucz „konkretnej strategii". */
  strategyId: string;
  /** Docelowy adres (do zestawień w GA4). */
  href?: string;
  title?: string;
  /** Miejsce kliknięcia: lista archiwum, powiązane, strona główna, wyszukiwarka. */
  placement?: string;
  lang?: string;
}

/** Kliknięcie w konkretną strategię/analizę - przepływ widoczny per materiał. */
export function trackStrategyConversion(input: StrategyConversionInput): void {
  track({
    type: "conversion",
    name: "strategy_click",
    entityType: "strategy",
    entityId: input.strategyId,
    meta: {
      item_name: input.title ?? "",
      link_url: input.href ?? "",
      placement: input.placement ?? "unknown",
      content_lang: input.lang ?? "",
    },
  });
  adsConversion(ADS_CONTENT_LABEL, {
    transaction_id: `strategy_${input.strategyId}_${Date.now()}`,
  });
}
