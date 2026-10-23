// PROŚBY O OSOBNĄ ZGODĘ NA POMIAR (I9d-Y2; I9d-Y2b - decyzje właściciela
// 2026-10-23: D1 wariant (b) - każda zgoda ma osobne pole, D2 - pomiar tylko
// dla skrzynki potwierdzonej przez jej właściciela) - JEDNO źródło stałych po
// stronie TS: treść maila, okna wysyłki, limit próśb po zapisie, etykieta
// kolejki i ważność linku.
//
// Dwa pochodzenia prośby (`newsletter_measurement_requests.origin`):
//   * `panel` - „Poproś o zgodę na pomiar" (decyzja 2026-10-20 pkt 3,
//     opcjonalne, ręcznie): jednorazowy mail do subskrybentów BEZ zgody na
//     pomiar (np. zapisanych przed osobnym polem). Admin widzi liczbę
//     kandydatów (`admin_newsletter_measurement_preview`) i potwierdza start
//     z tą liczbą (`admin_newsletter_measurement_request`). Treść domyślna
//     w tonie NES + nadpisania z panelu; okno 08:00-17:59 i dzienny limit
//     WSPÓLNY z prośbami wygaszania Y1 (reputacja tej samej domeny);
//   * `signup` - zapis BEZ double opt-in (albo adres już zapisany)
//     z zaznaczonym osobnym polem pomiaru: prośbę zakłada
//     `newsletter_measurement_request_signup`. Treść STAŁA
//     (`NEWSLETTER_MEASUREMENT_SIGNUP_COPY`, bez nadpisań z panelu - osoba
//     sama zaznaczyła pole i dostaje dokładnie tę informację), wysyłka bez
//     okna dziennego (co 10 minut przez całą dobę - prośba ma przyjść zaraz
//     po zapisie) i z WŁASNYM dziennym limitem
//     (`NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP`), niezależnym od panelu i Y1.
// Baza pilnuje JEDNEJ prośby na (subskrybent, wersja treści pomiaru) ->
// krok `jobs-tick` (`measurementReconfirmMail.server.ts`) wysyła mail PL/EN
// w języku subskrybenta z bramką listy wyłączeń -> klik w przycisk (strona
// `/newsletter/measurement`, POST) zapisuje OSOBNĄ zgodę na pomiar (treść
// i wersja pola pomiaru) - wyłącznie przez `_email_measurement_grant`.
// BRAK REAKCJI = BEZ ZMIAN: newsletter przychodzi dalej, bez pomiaru.
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

/** Pochodzenie prośby (`newsletter_measurement_requests.origin`). */
export const NEWSLETTER_MEASUREMENT_ORIGINS = ["panel", "signup"] as const;
export type NewsletterMeasurementOrigin = (typeof NEWSLETTER_MEASUREMENT_ORIGINS)[number];

/** Pochodzenie z wiersza zajęcia: brak pola albo obca wartość = `panel`. */
export function newsletterMeasurementOriginOf(raw: unknown): NewsletterMeasurementOrigin {
  return raw === "signup" ? "signup" : "panel";
}

/**
 * Dzienny limit próśb `origin = 'signup'` na najemcę (24 h kroczące) -
 * WŁASNY, niezależny od wspólnego limitu panelu i wygaszania Y1: fala
 * wygaszania albo start z panelu nie może wstrzymać prośby osoby, która
 * właśnie zaznaczyła pole. Lustro stałej `c_signup_daily_cap`
 * w `newsletter_measurement_claim` (SQL liczy limit przy zajęciu porcji).
 */
export const NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP = 500;

/** Minuta ticku próśb (co 10 minut): inna niż prośby wygaszania (minuta 9). */
function isNewsletterMeasurementMailMinute(now: Date): boolean {
  return now.getUTCMinutes() % 10 === 4;
}

/**
 * Okno wysyłki próśb z PANELU: 08:00-17:59 czasu polskiego, co 10 minut
 * (minuta 4). Prośba o decyzję ma trafić do skrzynki w ciągu dnia pracy.
 * Minuta 4 - inna niż prośby wygaszania (minuta 9): oba kroki dzielą dzienny
 * limit najemcy (`_newsletter_oneoff_mail_used`), ale nie termin jednego
 * ticku. Prośby po zapisie (`signup`) okna nie mają
 * (`newsletterMeasurementMailScope`).
 */
export function isNewsletterMeasurementMailWindow(now: Date = new Date()): boolean {
  if (!isNewsletterMeasurementMailMinute(now)) return false;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Warsaw",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 8 && hour <= 17;
}

/**
 * Zakres kroku próśb w danym ticku:
 *   * `all` - okno dzienne: prośby z panelu i po zapisie (po zapisie
 *     najpierw - kolejność zajęcia w SQL);
 *   * `signup` - minuta 4 poza oknem: WYŁĄCZNIE prośby po zapisie;
 *   * `null` - krok nie rusza.
 */
export function newsletterMeasurementMailScope(now: Date = new Date()): "all" | "signup" | null {
  if (isNewsletterMeasurementMailWindow(now)) return "all";
  return isNewsletterMeasurementMailMinute(now) ? "signup" : null;
}

/** Klucz w `site_settings` (wiersz najemcy) z nadpisaniami treści z panelu. */
export const NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY = "newsletter_measurement_email";

/** Zmienne treści jako `{nazwa}`: imię subskrybenta (puste, gdy nieznane). */
export const NEWSLETTER_MEASUREMENT_TOKENS = ["firstName"] as const;
export type NewsletterMeasurementToken = (typeof NEWSLETTER_MEASUREMENT_TOKENS)[number];
export type NewsletterMeasurementTokenValues = Readonly<Record<NewsletterMeasurementToken, string>>;

/**
 * Treść domyślna prośby z PANELU w tonie NES: rzeczowo, bez presji - zgoda na
 * pomiar jest dobrowolna, a jej brak niczego nie zmienia w subskrypcji
 * (art. 7 ust. 4 RODO). JEDYNE źródło - wysyłka, podgląd w panelu
 * i placeholder edytora.
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
 * Treść prośby PO ZAPISIE (`origin = 'signup'`): STAŁA, bez nadpisań
 * z panelu i bez zmiennych - osoba zaznaczyła pole pomiaru w formularzu
 * i dostaje dokładnie tę informację: pomiar włączy dopiero jej kliknięcie,
 * a jeśli pola nie zaznaczyła ona, wystarczy zignorować wiadomość. Mail niesie
 * ramkę z treścią zgody na pomiar (`measurementConsentPlain`), którą zapisze
 * kliknięcie.
 */
export const NEWSLETTER_MEASUREMENT_SIGNUP_COPY: Readonly<
  Record<NewsletterMeasurementLang, NewsletterMeasurementCopy>
> = {
  pl: {
    subject: "Potwierdź zgodę na pomiar otwarć i kliknięć",
    preview: "Zaznaczono w formularzu zgodę na pomiar - potwierdź ją jednym kliknięciem.",
    eyebrow: "Newsletter",
    heading: "Potwierdź zgodę na pomiar",
    intro:
      "Przy zapisie na newsletter zaznaczono pole zgody na pomiar otwarć i kliknięć w naszych wiadomościach. Pomiar włączymy dopiero wtedy, gdy potwierdzisz tę zgodę przyciskiem poniżej.\n\nZgodę możesz wycofać w każdej chwili linkiem „Nie mierz moich otwarć i kliknięć” w stopce każdej wiadomości - bez rezygnacji z newslettera.",
    cta: "Potwierdzam zgodę na pomiar",
    note: "Jeśli to nie Ty zaznaczyłeś to pole albo zmieniłeś zdanie, zignoruj tę wiadomość - pomiar nie zostanie włączony, a newsletter będzie przychodził jak dotąd.",
  },
  en: {
    subject: "Confirm your consent to measuring opens and clicks",
    preview: "The measurement box was ticked in the form - confirm it with one click.",
    eyebrow: "Newsletter",
    heading: "Confirm consent to measurement",
    intro:
      "When you signed up for the newsletter, the box for consent to measuring opens and clicks in our emails was ticked. We switch measurement on only once you confirm this consent with the button below.\n\nYou can withdraw it at any time with the “Don't measure my opens and clicks” link at the bottom of every email - without unsubscribing.",
    cta: "I confirm consent to measurement",
    note: "If you did not tick this box or have changed your mind, ignore this email - measurement stays off and the newsletter keeps coming as before.",
  },
};

/**
 * Napisy stałe maila (nie do edycji - prawo wyboru odbiorcy): wypis
 * i nagłówek ramki z treścią zgody na pomiar, którą zapisze kliknięcie.
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

/**
 * Treść maila prośby według pochodzenia: po zapisie - stała
 * (`NEWSLETTER_MEASUREMENT_SIGNUP_COPY`, nadpisania z panelu IGNOROWANE),
 * z panelu - nadpisania albo treść domyślna (`resolveNewsletterMeasurementCopy`).
 */
export function resolveNewsletterMeasurementMailCopy(
  origin: NewsletterMeasurementOrigin,
  overrides: NewsletterMeasurementCopyOverrides,
  lang: NewsletterMeasurementLang,
  values: NewsletterMeasurementTokenValues,
): NewsletterMeasurementCopy {
  return origin === "signup"
    ? NEWSLETTER_MEASUREMENT_SIGNUP_COPY[lang]
    : resolveNewsletterMeasurementCopy(overrides, lang, values);
}
