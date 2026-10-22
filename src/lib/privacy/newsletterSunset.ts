// WYGASZANIE NIEAKTYWNYCH SUBSKRYBENTÓW NEWSLETTERA (I9d-Y1, Z-I9c-08) -
// JEDNO źródło stałych po stronie TS: treść prośby o potwierdzenie (domyślna
// w tonie NES + nadpisania z panelu), limity pól, okno wysyłki, etykieta
// kolejki i adresy trasy „Chcę dalej otrzymywać".
//
// Przebieg (decyzja właściciela 2026-10-20, „tak, usuwaj"): subskrybent bez
// zaangażowania dłużej niż okres kategorii `newsletter_inactive` dostaje
// JEDNĄ prośbę (PL/EN wg języka subskrybenta) -> klik „Chcę dalej otrzymywać"
// resetuje licznik -> brak reakcji przez `newsletterResponseDays` -> wiersz
// subskrybenta usunięty (SQL 20261020162000). Cykl, kandydatów i usunięcie
// prowadzi baza; TS podpisuje link (sekret HMAC żyje tylko w env serwera)
// i renderuje mail - tego SQL nie zrobi.
//
// MODUŁ CZYSTY: bez I/O i bez Reacta - czyta go panel (edytor treści, liczniki
// znaków), serwer (wysyłka, podgląd) i `jobs-tick` (okno). Zod jest już
// w chunku panelu i serwera.
import { z } from "zod";
import { DATA_RETENTION_RULES } from "./dataRetention";
import { NEWSLETTER_KEEP_API_PATH, NEWSLETTER_KEEP_PAGE_PATH } from "./newsletterKeepPaths";

/**
 * Etykieta wysyłki w kolejce i dzienniku dostarczalności. Kategoria listy
 * wyłączeń: `bulk` (`emailCategoryForLabel` daje `bulk` każdej nieznanej
 * etykiecie, a wysyłka podaje kategorię jawnie) - prośba jest komunikacją
 * newslettera, więc adres po wypisie, odbiciu albo skardze jej NIE dostaje
 * (bramka przy kolejkowaniu i ponownie w drenie w chwili wysyłki).
 */
export const NEWSLETTER_SUNSET_MAIL_LABEL = "newsletter_sunset";

export { NEWSLETTER_KEEP_API_PATH, NEWSLETTER_KEEP_PAGE_PATH };

/**
 * Link w mailu wskazuje ENDPOINT, nie stronę (jak wypis - `unsubscribeUrl.ts`):
 * jeden kontrakt pod testem, a strona może zmienić ścieżkę bez psucia maili
 * już wysłanych. Origin bez końcowego ukośnika - podwójny `//` część klientów
 * pocztowych traktuje jak inny adres. `lang` (język subskrybenta) przechodzi
 * na stronę: ścieżki `/newsletter` nie mają prefiksu języka, a osoba z prośbą
 * po angielsku ma zobaczyć przycisk po angielsku. Język nie jest podpisany -
 * zmienia wyłącznie napisy strony.
 */
export function newsletterKeepUrl(
  origin: string,
  token: string,
  lang?: NewsletterSunsetLang,
): string {
  const base = `${origin.replace(/\/+$/, "")}${NEWSLETTER_KEEP_API_PATH}?token=${encodeURIComponent(token)}`;
  return lang ? `${base}&lang=${lang}` : base;
}

/**
 * Ważność linku: termin reakcji (`newsletterResponseDays`) + najdalsze
 * przesunięcie włączenia usuwania (`postponeMaxDays`). Cykl subskrybenta
 * żyje co najmniej do terminu reakcji, a admin, który po wysyłce przesunie
 * karencję, odsuwa usunięcie o najwyżej tyle dni - link nie może wygasnąć,
 * zanim baza mogłaby jeszcze zrobić to, przed czym chroni. Jednorazowość daje
 * nonce cyklu w bazie (`newsletter_sunset_keep`), termin - podpis tokenu.
 */
export const NEWSLETTER_KEEP_TOKEN_TTL_DAYS =
  DATA_RETENTION_RULES.newsletterResponseDays + DATA_RETENTION_RULES.postponeMaxDays;

/** Prośby na jeden przebieg kroku `jobs-tick` (sufit RPC `newsletter_sunset_claim`: 500). */
export const NEWSLETTER_SUNSET_MAIL_BATCH = 50;

/**
 * Okno wysyłki próśb: 08:00-17:59 czasu polskiego, co 10 minut (minuta 3).
 * Prośba o decyzję ma trafić do skrzynki w ciągu dnia pracy - mail z nocy
 * ląduje pod porannymi i częściej zostaje pominięty, a na pominięciu kończy
 * się subskrypcja. Kandydatów tworzy nocny przebieg retencji (02:07-02:57
 * UTC), więc prośby z danej nocy wychodzą tego samego dnia. Minuta 3 omija
 * pełne dziesiątki, na których stoją inne zadania ticku; 60 szans na dobę
 * po 50 próśb mieści dzienny limit wielu najemców.
 */
export function isNewsletterSunsetMailWindow(now: Date = new Date()): boolean {
  if (now.getUTCMinutes() % 10 !== 3) return false;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Warsaw",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 8 && hour <= 17;
}

// ── Treść prośby ─────────────────────────────────────────────────────────────

export type NewsletterSunsetLang = "pl" | "en";

/** Pola edytowalne w panelu (to samo nazewnictwo co treści maili systemowych). */
export const NEWSLETTER_SUNSET_COPY_FIELDS = [
  "subject",
  "preview",
  "eyebrow",
  "heading",
  "intro",
  "cta",
  "note",
] as const;
export type NewsletterSunsetCopyField = (typeof NEWSLETTER_SUNSET_COPY_FIELDS)[number];
export type NewsletterSunsetCopy = Readonly<Record<NewsletterSunsetCopyField, string>>;

/**
 * Limity pól (znaki = punkty kodowe). Dłuższa wartość jest ODRZUCANA (walidator
 * panelu i serwera, ten sam predykat), nigdy przycinana - licznik w edytorze
 * pokazuje dokładnie to, co trafi do maila. Temat i nagłówek krótkie (skrzynka
 * ucina dłuższe), wstęp i ramka „co dalej" na kilka zdań.
 */
export const NEWSLETTER_SUNSET_COPY_LIMITS: Readonly<Record<NewsletterSunsetCopyField, number>> = {
  subject: 150,
  preview: 200,
  eyebrow: 40,
  heading: 150,
  intro: 1500,
  cta: 40,
  note: 800,
};

/**
 * Zmienne treści jako `{nazwa}`: imię subskrybenta (puste, gdy nieznane), liczba
 * dni na reakcję i data, po której adres zostanie usunięty (w języku maila).
 * Nieznana zmienna znika - literówka w panelu nie trafi do skrzynki jako
 * `{imie}`.
 */
export const NEWSLETTER_SUNSET_TOKENS = ["firstName", "daysLeft", "deleteDate"] as const;
export type NewsletterSunsetToken = (typeof NEWSLETTER_SUNSET_TOKENS)[number];
export type NewsletterSunsetTokenValues = Readonly<Record<NewsletterSunsetToken, string>>;

/**
 * Treść domyślna w tonie NES: rzeczowo, z szacunkiem dla skrzynki i danych,
 * bez presji sprzedażowej. JEDYNE źródło - wysyłka, podgląd w panelu i edytor
 * (placeholder pustego pola) czytają tę stałą.
 */
export const NEWSLETTER_SUNSET_DEFAULT_COPY: Readonly<
  Record<NewsletterSunsetLang, NewsletterSunsetCopy>
> = {
  pl: {
    subject: "📨 Czy nadal chcesz otrzymywać nasz newsletter? | New European Strategies",
    preview:
      "Potwierdź jednym kliknięciem, że chcesz dalej otrzymywać analizy New European Strategies.",
    eyebrow: "Newsletter",
    heading: "Czy nadal chcesz otrzymywać nasze analizy?",
    intro:
      "Od dłuższego czasu nie widzimy Twojej aktywności w naszym newsletterze. Szanujemy Twoją skrzynkę i Twoje dane, dlatego pytamy wprost: jeśli chcesz dalej otrzymywać analizy, dane i komentarze eksperckie New European Strategies, potwierdź to jednym kliknięciem.",
    cta: "Chcę dalej otrzymywać",
    note: "Bez potwierdzenia w ciągu {daysLeft} dni (do {deleteDate}) usuniemy Twój adres z listy newslettera - to jedyna wiadomość w tej sprawie. Zapisać się ponownie możesz w każdej chwili.",
  },
  en: {
    subject: "📨 Do you still want our newsletter? | New European Strategies",
    preview:
      "Confirm with one click that you want to keep receiving analysis from New European Strategies.",
    eyebrow: "Newsletter",
    heading: "Do you still want our analysis?",
    intro:
      "We have not seen any activity from you in our newsletter for a long time. We respect your inbox and your data, so we are asking directly: if you would like to keep receiving analysis, data and expert commentary from New European Strategies, please confirm with one click.",
    cta: "Keep me subscribed",
    note: "Without confirmation within {daysLeft} days (by {deleteDate}) we will remove your address from the newsletter list - this is the only message about it. You can subscribe again at any time.",
  },
};

/**
 * Napisy stałe maila (nie do edycji - prawo wyboru odbiorcy): wyjście bez
 * czekania na usunięcie. Ta sama stała dla wysyłki i podglądu.
 */
export const NEWSLETTER_SUNSET_FIXED_COPY: Readonly<
  Record<NewsletterSunsetLang, { unsubscribeLead: string; unsubscribeLink: string }>
> = {
  pl: {
    unsubscribeLead: "Nie chcesz już otrzymywać newslettera?",
    unsubscribeLink: "Wypisz się od razu",
  },
  en: {
    unsubscribeLead: "No longer interested in the newsletter?",
    unsubscribeLink: "Unsubscribe now",
  },
};

/** Klucz w `site_settings` (wiersz najemcy) z nadpisaniami treści z panelu. */
export const NEWSLETTER_SUNSET_COPY_SETTING_KEY = "newsletter_sunset_email";

/** Długość jak `char_length` w SQL (punkty kodowe, nie jednostki UTF-16). */
export function copyLength(value: string): number {
  return [...value].length;
}

const copyFieldSchema = (field: NewsletterSunsetCopyField) =>
  z
    .string()
    .refine((value) => copyLength(value) <= NEWSLETTER_SUNSET_COPY_LIMITS[field], {
      message: `${field}_too_long`,
    });

const langCopySchema = z
  .object(
    Object.fromEntries(
      NEWSLETTER_SUNSET_COPY_FIELDS.map((field) => [field, copyFieldSchema(field)]),
    ) as Record<NewsletterSunsetCopyField, ReturnType<typeof copyFieldSchema>>,
  )
  .strict();

/**
 * Nadpisania z panelu: pełny kształt PL i EN. PUSTE pole = treść domyślna
 * (edycja addytywna i zawsze odwracalna, jak treści maili systemowych).
 */
export const NewsletterSunsetCopyOverridesSchema = z
  .object({ pl: langCopySchema, en: langCopySchema })
  .strict();
export type NewsletterSunsetCopyOverrides = z.infer<typeof NewsletterSunsetCopyOverridesSchema>;

const EMPTY_LANG: NewsletterSunsetCopy = {
  subject: "",
  preview: "",
  eyebrow: "",
  heading: "",
  intro: "",
  cta: "",
  note: "",
};

/** Brak nadpisań (pierwszy zapis najemcy, zły kształt w bazie). */
export const NEWSLETTER_SUNSET_EMPTY_OVERRIDES: NewsletterSunsetCopyOverrides = {
  pl: { ...EMPTY_LANG },
  en: { ...EMPTY_LANG },
};

/**
 * Wartość z bazy -> nadpisania. Zły albo przestarzały kształt nigdy nie może
 * wywrócić wysyłki: brakujące pole = puste (domyślne), nadmiarowe znika,
 * pole ponad limit (np. limit zmniejszony po zapisie) = domyślne. Zapis idzie
 * przez ścisły schemat - to tolerancja wyłącznie dla ODCZYTU.
 */
export function parseNewsletterSunsetOverrides(raw: unknown): NewsletterSunsetCopyOverrides {
  const out: { pl: Record<string, string>; en: Record<string, string> } = {
    pl: { ...EMPTY_LANG },
    en: { ...EMPTY_LANG },
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return out as NewsletterSunsetCopyOverrides;
  }
  for (const lang of ["pl", "en"] as const) {
    const source = (raw as Record<string, unknown>)[lang];
    if (source === null || typeof source !== "object" || Array.isArray(source)) continue;
    for (const field of NEWSLETTER_SUNSET_COPY_FIELDS) {
      const value = (source as Record<string, unknown>)[field];
      if (typeof value === "string" && copyLength(value) <= NEWSLETTER_SUNSET_COPY_LIMITS[field]) {
        out[lang][field] = value;
      }
    }
  }
  return out as NewsletterSunsetCopyOverrides;
}

/** Podstawia `{zmienna}`; nieznane znikają, podwójne spacje po pustych też. */
export function interpolateSunsetCopy(input: string, values: NewsletterSunsetTokenValues): string {
  return input
    .replace(/\{(\w+)\}/g, (_match, key: string) =>
      (NEWSLETTER_SUNSET_TOKENS as readonly string[]).includes(key)
        ? values[key as NewsletterSunsetToken]
        : "",
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Treść maila w języku subskrybenta: pole z panelu (po obcięciu brzegów),
 * a gdy puste - domyślne; potem zmienne. Pole, które po podstawieniu jest
 * puste (np. sam `{firstName}` u osoby bez imienia), też wraca do domyślnego -
 * mail bez tematu albo bez przycisku to mail, którego nie da się użyć.
 */
export function resolveNewsletterSunsetCopy(
  overrides: NewsletterSunsetCopyOverrides,
  lang: NewsletterSunsetLang,
  values: NewsletterSunsetTokenValues,
): NewsletterSunsetCopy {
  const defaults = NEWSLETTER_SUNSET_DEFAULT_COPY[lang];
  const resolved = {} as Record<NewsletterSunsetCopyField, string>;
  for (const field of NEWSLETTER_SUNSET_COPY_FIELDS) {
    const custom = overrides[lang][field].trim();
    const value = custom ? interpolateSunsetCopy(custom, values) : "";
    resolved[field] = value || interpolateSunsetCopy(defaults[field], values);
  }
  return resolved;
}
