/**
 * Rejestr STRUMIENI analitycznych - pierwsza połowa warstwy semantycznej.
 *
 * PROBLEM, KTÓRY TO ROZWIĄZUJE: platforma zbiera dane w sześciu niezależnych
 * strumieniach (GA4, `analytics_events`, `web_vitals`, `ad_events`,
 * `newsletter_campaign_events`, `related_post_clicks`/`post_views`). Każdy z nich
 * ma INNĄ definicję "odsłony", INNĄ tożsamość ("kto"), INNĄ bramkę zgody, INNĄ
 * podstawę czasu i INNY tryb deduplikacji. Dopóki te różnice żyły wyłącznie w
 * komentarzach przy zapytaniach, dwa dashboardy mogły w dobrej wierze pokazać
 * dwie różne liczby dla tej samej metryki, a raport zarządczy nie miał
 * ŻADNEGO sposobu, żeby stwierdzić, która jest właściwa.
 *
 * Ten plik deklaruje te własności JAWNIE i w jednym miejscu. `metrics.ts`
 * odwzorowuje metryki kanoniczne na strumienie, a `reconcile.ts` używa
 * poniższych atrybutów (`consentGate`, `identityGrain`, `dedupe`, `timeBasis`)
 * do rozstrzygnięcia, czy dwie liczby są w ogóle porównywalne - zamiast
 * porównywać je na słowo.
 *
 * Plik jest CZYSTY (bez importów runtime'owych, bez I/O): służy zarówno
 * serwerowym funkcjom, komponentom admina, jak i testom.
 */

/** Sześć strumieni, z których platforma czyta liczby. */
export type StreamId =
  "ga4" | "first_party" | "web_vitals" | "ad_events" | "newsletter" | "content_views";

/**
 * Bramka zgody (RODO) wymagana, żeby zdarzenie w ogóle powstało. To NAJWAŻNIEJSZY
 * wymiar porównywalności: dwa strumienie za różnymi bramkami mierzą różne
 * populacje, więc ich liczby nie są ułamkami tej samej całości.
 */
export type ConsentGate =
  /** Wymaga zgody kategorii „analityka” (`hasAnalyticsConsent`). */
  | "analytics"
  /** Wymaga zgody kategorii „marketing” (`hasCategoryConsent("marketing")`). */
  | "marketing"
  /** Bez bramki cookie - odbiorca wyraził zgodę zapisując się na newsletter. */
  | "email_optin"
  /** Zapis serwerowy bez bramki zgody w kodzie klienta. */
  | "none";

/**
 * Ziarno tożsamości - do CZEGO strumień potrafi przypisać zdarzenie. Decyduje,
 * czy „unikalni” z dwóch strumieni znaczą to samo.
 */
export type IdentityGrain =
  /** Sesjonizacja Google (30 min bezczynności, reset o północy w TZ property). */
  | "ga4_session"
  /** `activeUsers` GA4 - użytkownik rozpoznany po cookie `_ga`, per przeglądarka. */
  | "ga4_user"
  /** `session_id` z `sessionStorage` - PER KARTA, 30 min bezczynności. */
  | "tab_session"
  /** `anon_id` z `localStorage` - per przeglądarka, bez wygaśnięcia. */
  | "browser_visitor"
  /** `viewer_hash` z `localStorage` - per przeglądarka, niezależny od `anon_id`. */
  | "viewer_hash"
  /** `subscriber_id` z podpisanego HMAC-em tokenu - konkretna osoba. */
  | "email_recipient"
  /** Brak jakiejkolwiek tożsamości - liczymy wyłącznie zdarzenia. */
  | "anonymous_event";

/** Zegar, po którym strumień kubkuje dni. */
export type TimeBasis =
  /** Dzień w strefie czasowej property GA4 (konfigurowana po stronie Google). */
  | "ga4_property_day"
  /** `created_at`/`viewed_at` w UTC - nasz Postgres. */
  | "utc_timestamp";

/** Tryb deduplikacji zdarzeń wewnątrz strumienia. */
export type DedupeMode =
  /** Każde zdarzenie to osobny wiersz - brak deduplikacji. */
  | "none"
  /** Okno deduplikacji per (encja, tożsamość) - patrz `dedupeWindowMinutes`. */
  | "window"
  /**
   * Jeden wiersz na (encja, tożsamość, DOBA UTC) - egzekwowane indeksem
   * unikalnym w bazie, nie oknem czasowym. Różnica wobec `window` jest
   * merytoryczna: granica biegnie po kalendarzu, więc dwa zdarzenia oddalone
   * o minutę mogą trafić do RÓŻNYCH kubełków, jeśli dzieli je północ UTC.
   */
  | "utc_day"
  /** UPSERT na (użytkownik, encja) - wiersz jest STANEM, nie zdarzeniem. */
  | "upsert_last_wins"
  /** Sesjonizacja dostawcy (GA4 scala odsłony w sesje po swojej stronie). */
  | "vendor_sessionized";

export interface StreamDescriptor {
  readonly id: StreamId;
  /** Nazwa dla UI (PL). */
  readonly labelPl: string;
  /** Nazwa dla UI (EN). */
  readonly labelEn: string;
  /** Czy dane są u nas, czy u zewnętrznego dostawcy. */
  readonly ownership: "first_party" | "vendor";
  /** Fizyczne miejsce składowania - tabela/RPC albo API dostawcy. */
  readonly store: string;
  /** Kod, który produkuje zdarzenia (ścieżka repo) - do audytu. */
  readonly producer: string;
  readonly consentGate: ConsentGate;
  readonly identityGrain: IdentityGrain;
  readonly timeBasis: TimeBasis;
  readonly dedupe: DedupeMode;
  /** Rozmiar okna deduplikacji, gdy `dedupe === "window"`. */
  readonly dedupeWindowMinutes?: number;
  /**
   * Typowe opóźnienie danych w godzinach. GA4 Data API domyka dobę z opóźnieniem,
   * nasze beacony lądują w sekundach - liczba z GA4 za „dziś” jest ZAWSZE niepełna.
   */
  readonly latencyHours: number;
  /** Twarde limity, które mogą uciąć liczbę (cap agregacji, rate limit). */
  readonly caps: readonly string[];
  /**
   * Zastrzeżenia strukturalne - powody, dla których liczba z tego strumienia
   * NIE MUSI zgadzać się z inną, mimo że obie są poprawne. Klucze i18n
   * (`adminAnalytics.semantic.caveats.*`) trzymamy w UI; tu zostaje treść po
   * angielsku jako opis techniczny dla audytu i logów.
   */
  readonly caveats: readonly string[];
}

const STREAM_LIST: readonly StreamDescriptor[] = [
  {
    id: "ga4",
    labelPl: "Google Analytics 4",
    labelEn: "Google Analytics 4",
    ownership: "vendor",
    store: "GA4 Data API (properties/{id}:runReport)",
    producer: "src/lib/analytics/ga4.functions.ts",
    consentGate: "analytics",
    identityGrain: "ga4_session",
    timeBasis: "ga4_property_day",
    dedupe: "vendor_sessionized",
    latencyHours: 24,
    caps: [
      "Data API sampling on large properties",
      "cardinality thresholding hides small dimension buckets",
    ],
    caveats: [
      "Google applies its own bot/spider filtering, so GA4 is structurally lower than an unfiltered first-party count.",
      "Days are bucketed in the GA4 property timezone, not UTC - the first and last day of any UTC-derived range can be partial.",
      "The current day is never complete: the Data API closes a day only after the ingestion delay.",
    ],
  },
  {
    id: "first_party",
    labelPl: "Zdarzenia first-party",
    labelEn: "First-party events",
    ownership: "first_party",
    store: "public.analytics_events (+ view analytics_events_daily)",
    producer: "src/lib/analytics/track.ts -> /api/public/track",
    consentGate: "analytics",
    identityGrain: "tab_session",
    timeBasis: "utc_timestamp",
    dedupe: "none",
    latencyHours: 0,
    caps: [
      "ingest rate limiter: 120 burst / 2 events per second per IP",
      "40 events per batch, 32 kB per request",
    ],
    caveats: [
      "session_id lives in sessionStorage, which is PER TAB: one visitor browsing in three tabs produces three sessions, so first-party sessions are structurally >= GA4 sessions.",
      "No bot filtering at all - every request that passes the rate limiter is stored.",
      "Beacons are batched (5 s / 20 events) and flushed on pagehide; a hard process kill loses the tail of the buffer.",
    ],
  },
  {
    id: "web_vitals",
    labelPl: "Web Vitals (RUM)",
    labelEn: "Web Vitals (RUM)",
    ownership: "first_party",
    store: "public.web_vitals (+ RPC web_vitals_daily_p75)",
    producer: "src/lib/webVitals.ts -> /api/public/vitals",
    consentGate: "analytics",
    identityGrain: "anonymous_event",
    timeBasis: "utc_timestamp",
    dedupe: "none",
    latencyHours: 0,
    caps: ["in-memory aggregation capped at the newest 20 000 samples per window"],
    caveats: [
      "Samples carry no session or visitor id, so RUM can never be expressed per session or per user - only per sample.",
      "Metric availability is browser-dependent (INP is absent on older Safari), so the sample mix differs from the traffic mix.",
      "A page load reports at most one sample per metric, and only if the metric fires before the page is discarded.",
    ],
  },
  {
    id: "ad_events",
    labelPl: "Zdarzenia reklam",
    labelEn: "Ad events",
    ownership: "first_party",
    store: "public.ad_events",
    producer: "src/lib/analytics/events.ts -> /api/public/ad-event",
    consentGate: "marketing",
    identityGrain: "anonymous_event",
    timeBasis: "utc_timestamp",
    dedupe: "none",
    latencyHours: 0,
    caps: [],
    caveats: [
      "Gated on MARKETING consent while page views are gated on ANALYTICS consent: the two populations differ, so an ad rate must never be divided by a first-party or GA4 view count.",
      "Ad blockers suppress the slot and the beacon together, so both numerator and denominator shrink - but not by the same factor.",
    ],
  },
  {
    id: "newsletter",
    labelPl: "Newsletter",
    labelEn: "Newsletter",
    ownership: "first_party",
    store: "public.newsletter_campaign_events",
    producer: "src/lib/newsletter/trackingEvents.server.ts (nl-open / nl-click)",
    consentGate: "email_optin",
    identityGrain: "email_recipient",
    timeBasis: "utc_timestamp",
    dedupe: "utc_day",
    latencyHours: 0,
    caps: [],
    caveats: [
      "Opens depend on remote image loading: privacy proxies pre-fetch the pixel (inflating opens) while image-blocking clients never fire it (deflating opens). Clicks are the reliable signal.",
      "Exactly ONE producer writes this stream (the first-party pixel and redirect). The mail provider's own open/click webhook measures the same thing by the same mechanism, so it is disabled by default - enabling both double-counted every open and pushed the open rate above 100 %.",
      "A row is one recipient-day, not one interaction: a recipient who opens the same campaign five times today counts once, and counts again tomorrow. Row counts therefore measure DAILY REACH, and only COUNT(DISTINCT subscriber_id) measures people.",
      "The audience is the mailing list, not site traffic - newsletter rates share no denominator with on-site metrics.",
    ],
  },
  {
    id: "content_views",
    labelPl: "Odsłony treści i kliknięcia rekomendacji",
    labelEn: "Content views and related clicks",
    ownership: "first_party",
    store: "public.post_views, public.related_post_clicks, public.user_read_history",
    producer: "src/hooks/useRecordPostView.ts, src/lib/relatedClickBeacon.ts",
    consentGate: "none",
    identityGrain: "viewer_hash",
    timeBasis: "utc_timestamp",
    dedupe: "window",
    dedupeWindowMinutes: 5,
    latencyHours: 0,
    caps: ["related_posts_signals returns top 40 posts / 60 pairs / 20 hubs per window"],
    caveats: [
      "A view is recorded only after 1.5 s of dwell (and never while a page is speculatively prerendered), so bounces are excluded by construction - unlike a GA4 or first-party page view.",
      "record_post_view deduplicates a (post, viewer_hash) pair inside a 5-minute window, so this count is lower than any raw hit count on the same traffic.",
      "Views by a post's own author are dropped on purpose, so editorial traffic is invisible here but visible in GA4.",
      "user_read_history is UPSERTed on (user_id, post_id): a row is the LAST read of a pair, not a read event, so counting rows in a window answers 'distinct pairs last read in the window'.",
      "This stream has no consent gate in code, while /cookies declares post_views under the analytics category - the declaration and the implementation disagree.",
    ],
  },
];

/** Wszystkie strumienie w deterministycznej kolejności prezentacji. */
export const STREAMS: readonly StreamDescriptor[] = STREAM_LIST;

const BY_ID = new Map<StreamId, StreamDescriptor>(STREAM_LIST.map((s) => [s.id, s]));

/** Deskryptor strumienia. Rzuca dla nieznanego id - rejestr jest kompletny z definicji. */
export function streamById(id: StreamId): StreamDescriptor {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown analytics stream: ${id}`);
  return found;
}

/** Czy dwa strumienie mierzą tę samą populację (ta sama bramka zgody). */
export function sharesConsentPopulation(a: StreamId, b: StreamId): boolean {
  return streamById(a).consentGate === streamById(b).consentGate;
}

/**
 * Czy „unikalni” z dwóch strumieni znaczą to samo. Sesja per karta
 * (`tab_session`) i sesja GA4 to RÓŻNE jednostki, więc ta funkcja zwraca false -
 * porównanie jest dopuszczalne wyłącznie jako sanity-check rzędu wielkości,
 * nigdy jako uzgodnienie liczby.
 */
export function sharesIdentityGrain(a: StreamId, b: StreamId): boolean {
  return streamById(a).identityGrain === streamById(b).identityGrain;
}
