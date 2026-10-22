// „POPROŚ O ZGODĘ NA POMIAR" (I9d-Y2, decyzja właściciela 2026-10-20 pkt 3 -
// opcjonalne, ręcznie z panelu newslettera) - JEDNO źródło stałych po stronie
// TS: treść jednorazowego maila do subskrybentów ze zgodą sprzed treści
// z pomiarem (domyślna w tonie NES + nadpisania z panelu), okno wysyłki,
// etykieta kolejki i ważność linku.
//
// Przebieg: admin w panelu widzi liczbę kandydatów (`admin_newsletter_
// measurement_preview`) i potwierdza start z tą liczbą (`admin_newsletter_
// measurement_request`) -> baza zakłada jedną prośbę na (subskrybent, wersja
// treści) -> krok `jobs-tick` (`measurementReconfirmMail.server.ts`) wysyła
// mail PL/EN w języku subskrybenta, w dziennym limicie WSPÓLNYM z prośbami
// wygaszania Y1 i z bramką listy wyłączeń -> klik „Zgadzam się na pomiar"
// (strona `/newsletter/measurement`, POST) zapisuje zgodę w bieżącej wersji
// treści. BRAK REAKCJI = BEZ ZMIAN: newsletter przychodzi dalej, bez pomiaru.
//
// Kształt nadpisań (pola, limity, ścisły schemat zapisu i tolerancyjny
// odczyt) jest TEN SAM co treści prośby wygaszania (`newsletterSunset.ts`) -
// panel używa jednego edytora treści maila; różnią się wyłącznie treść
// domyślna i zmienne.
//
// MODUŁ CZYSTY: bez I/O i bez Reacta - czyta go panel, serwer (wysyłka,
// podgląd) i `jobs-tick` (okno).
import {
  NEWSLETTER_SUNSET_COPY_FIELDS,
  type NewsletterSunsetCopy,
  type NewsletterSunsetCopyField,
  type NewsletterSunsetCopyOverrides,
} from "./newsletterSunset";

export {
  NewsletterSunsetCopyOverridesSchema as NewsletterMeasurementCopyOverridesSchema,
  parseNewsletterSunsetOverrides as parseNewsletterMeasurementOverrides,
  NEWSLETTER_SUNSET_EMPTY_OVERRIDES as NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES,
  NEWSLETTER_SUNSET_COPY_LIMITS as NEWSLETTER_MEASUREMENT_COPY_LIMITS,
} from "./newsletterSunset";

export type NewsletterMeasurementLang = "pl" | "en";
export type NewsletterMeasurementCopy = NewsletterSunsetCopy;
export type NewsletterMeasurementCopyOverrides = NewsletterSunsetCopyOverrides;
export const NEWSLETTER_MEASUREMENT_COPY_FIELDS = NEWSLETTER_SUNSET_COPY_FIELDS;

/**
 * Etykieta wysyłki w kolejce i dzienniku dostarczalności; kategoria listy
 * wyłączeń `bulk` (jak prośba wygaszania): adres po wypisie, odbiciu albo
 * skardze prośby NIE dostaje (bramka przy kolejkowaniu i w drenie).
 */
export const NEWSLETTER_MEASUREMENT_MAIL_LABEL = "newsletter_measurement";

/** Prośby na jeden przebieg kroku `jobs-tick` (sufit RPC `newsletter_measurement_claim`: 500). */
export const NEWSLETTER_MEASUREMENT_MAIL_BATCH = 50;

/** Ważność linku „Zgadzam się na pomiar" (dni) - jedno źródło w `measurement.ts`. */
export { MEASUREMENT_CONFIRM_LINK_DAYS as NEWSLETTER_MEASUREMENT_LINK_DAYS } from "./measurement";

/**
 * Okno wysyłki próśb: 08:00-17:59 czasu polskiego, co 10 minut (minuta 4).
 * Prośba o decyzję ma trafić do skrzynki w ciągu dnia pracy. Minuta 4 - inna
 * niż prośby wygaszania (minuta 9): oba kroki dzielą dzienny limit najemcy
 * (`_newsletter_oneoff_mail_used`), ale nie termin jednego ticku.
 */
export function isNewsletterMeasurementMailWindow(now: Date = new Date()): boolean {
  if (now.getUTCMinutes() % 10 !== 4) return false;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Warsaw",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 8 && hour <= 17;
}

/** Klucz w `site_settings` (wiersz najemcy) z nadpisaniami treści z panelu. */
export const NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY = "newsletter_measurement_email";

/** Zmienne treści jako `{nazwa}`: imię subskrybenta (puste, gdy nieznane). */
export const NEWSLETTER_MEASUREMENT_TOKENS = ["firstName"] as const;
export type NewsletterMeasurementToken = (typeof NEWSLETTER_MEASUREMENT_TOKENS)[number];
export type NewsletterMeasurementTokenValues = Readonly<Record<NewsletterMeasurementToken, string>>;

/**
 * Treść domyślna w tonie NES: rzeczowo, bez presji - zgoda na pomiar jest
 * dobrowolna, a jej brak niczego nie zmienia w subskrypcji (art. 7 ust. 4
 * RODO). JEDYNE źródło - wysyłka, podgląd w panelu i placeholder edytora.
 */
export const NEWSLETTER_MEASUREMENT_DEFAULT_COPY: Readonly<
  Record<NewsletterMeasurementLang, NewsletterMeasurementCopy>
> = {
  pl: {
    subject: "Czy możemy mierzyć otwarcia i kliknięcia w naszym newsletterze?",
    preview:
      "Jedno kliknięcie pomoże nam dopasować treść i częstotliwość newslettera New European Strategies.",
    eyebrow: "Newsletter",
    heading: "Pomóż nam dopasować newsletter do Ciebie",
    intro:
      "Chcemy wiedzieć, które analizy są dla Ciebie naprawdę przydatne. Dlatego pytamy o zgodę na pomiar otwarć i kliknięć w naszych wiadomościach - dzięki niemu dopasujemy treść i częstotliwość wysyłki oraz poprowadzimy statystykę.\n\nPomiar włączymy wyłącznie, jeśli się zgodzisz. Zgodę możesz wycofać w każdej chwili linkiem w stopce każdej wiadomości - bez rezygnacji z newslettera.",
    cta: "Zgadzam się na pomiar",
    note: "Jeśli nie klikniesz, nic się nie zmieni: newsletter będzie przychodził jak dotąd, bez pomiaru otwarć i kliknięć. To jedyna wiadomość w tej sprawie.",
  },
  en: {
    subject: "May we measure opens and clicks in our newsletter?",
    preview:
      "One click helps us tailor the content and frequency of the New European Strategies newsletter.",
    eyebrow: "Newsletter",
    heading: "Help us tailor the newsletter to you",
    intro:
      "We want to know which analysis is genuinely useful to you. That is why we are asking for your consent to measure opens and clicks in our emails - it helps us tailor the content and sending frequency and keep statistics.\n\nWe will switch the measurement on only if you agree. You can withdraw your consent at any time using the link at the bottom of every email - without unsubscribing.",
    cta: "I agree to the measurement",
    note: "If you do not click, nothing changes: the newsletter keeps coming as before, without measuring opens and clicks. This is the only message about it.",
  },
};

/**
 * Napisy stałe maila (nie do edycji - prawo wyboru odbiorcy): wypis
 * i nagłówek ramki z treścią zgody, którą zapisze kliknięcie.
 */
export const NEWSLETTER_MEASUREMENT_FIXED_COPY: Readonly<
  Record<
    NewsletterMeasurementLang,
    { consentLead: string; unsubscribeLead: string; unsubscribeLink: string }
  >
> = {
  pl: {
    consentLead: "Treść zgody, którą zapiszemy po kliknięciu:",
    unsubscribeLead: "Nie chcesz już otrzymywać newslettera?",
    unsubscribeLink: "Wypisz się",
  },
  en: {
    consentLead: "The consent wording we will record when you click:",
    unsubscribeLead: "No longer interested in the newsletter?",
    unsubscribeLink: "Unsubscribe",
  },
};

/** Podstawia `{zmienna}`; nieznane znikają, podwójne spacje po pustych też. */
export function interpolateMeasurementCopy(
  input: string,
  values: NewsletterMeasurementTokenValues,
): string {
  return input
    .replace(/\{(\w+)\}/g, (_match, key: string) =>
      (NEWSLETTER_MEASUREMENT_TOKENS as readonly string[]).includes(key)
        ? values[key as NewsletterMeasurementToken]
        : "",
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Treść maila w języku subskrybenta: pole z panelu (po obcięciu brzegów),
 * a gdy puste - domyślne; potem zmienne. Pole puste po podstawieniu wraca do
 * domyślnego - mail bez tematu albo bez przycisku jest bezużyteczny.
 */
export function resolveNewsletterMeasurementCopy(
  overrides: NewsletterMeasurementCopyOverrides,
  lang: NewsletterMeasurementLang,
  values: NewsletterMeasurementTokenValues,
): NewsletterMeasurementCopy {
  const defaults = NEWSLETTER_MEASUREMENT_DEFAULT_COPY[lang];
  const resolved = {} as Record<NewsletterSunsetCopyField, string>;
  for (const field of NEWSLETTER_MEASUREMENT_COPY_FIELDS) {
    const custom = overrides[lang][field].trim();
    const value = custom ? interpolateMeasurementCopy(custom, values) : "";
    resolved[field] = value || interpolateMeasurementCopy(defaults[field], values);
  }
  return resolved;
}
