/**
 * SŁOWNIK METRYK KANONICZNYCH - druga połowa warstwy semantycznej.
 *
 * Jedna metryka = jedna definicja = jeden strumień AUTORYTATYWNY. Raport
 * zarządczy cytuje wyłącznie liczbę ze strumienia autorytatywnego; pozostałe
 * strumienie są POTWIERDZAJĄCE (corroborating) - służą do wykrycia, że coś się
 * rozjechało, a nie do „uśrednienia” wyniku.
 *
 * Dlaczego to musi być kod, a nie dokument: dashboardy same wyliczały „odsłony”
 * i „sesje” z tego, co miały pod ręką (`screenPageViews`, `hits` z
 * `analytics_events_daily`, wiersze `post_views`), przez co ta sama nazwa
 * oznaczała trzy różne liczby na trzech zakładkach. Tutaj każde powiązanie
 * (`MetricBinding`) deklaruje pole źródłowe, wzór i ziarno tożsamości, więc
 * `reconcile.ts` może POLICZYĆ rozjazd i zakwalifikować go jako oczekiwany
 * albo jako błąd konfiguracji.
 *
 * Trzy poziomy porównywalności (patrz `comparabilityOf`):
 *  - `equivalent`   - ta sama bramka zgody, to samo ziarno, ta sama deduplikacja
 *                     -> liczby POWINNY się zgadzać (wąska tolerancja),
 *  - `analogous`    - ta sama bramka zgody, inne ziarno lub inna deduplikacja
 *                     -> systematyczne przesunięcie jest OCZEKIWANE, sprawdzamy
 *                        rząd wielkości i KIERUNEK relacji,
 *  - `incomparable` - różne bramki zgody -> różne populacje, nie porównujemy.
 *
 * Plik jest czysty (bez I/O), więc te same reguły obowiązują na serwerze, w
 * panelu admina i w testach.
 */
import { type IdentityGrain, type StreamId, streamById } from "./streams";

/** Metryki, które mogą trafić do raportu zarządczego. */
export type MetricId =
  | "sessions"
  | "visitors"
  | "page_views"
  | "content_views"
  | "engagement_rate"
  | "cta_clicks"
  | "internal_searches"
  | "lcp_p75"
  | "inp_p75"
  | "cls_p75"
  | "ad_impressions"
  | "ad_clicks"
  | "ad_ctr"
  | "email_opens"
  | "email_clicks"
  | "email_ctr"
  | "related_clicks"
  | "reads";

export type MetricUnit = "count" | "ratio" | "milliseconds" | "score";

export type MetricAggregation = "sum" | "distinct_count" | "ratio" | "percentile_75";

/** Rola strumienia dla danej metryki. Dokładnie jeden musi być autorytatywny. */
export type BindingRole = "authoritative" | "corroborating";

export interface MetricBinding {
  readonly streamId: StreamId;
  /** Pole/wyrażenie źródłowe - dokładnie to, co czyta zapytanie. */
  readonly field: string;
  /** Wzór po ludzku - trafia do popovera „definicja metryki” w adminie. */
  readonly formula: string;
  /**
   * Ziarno tożsamości TEGO powiązania. Bywa inne niż główne ziarno strumienia:
   * `analytics_events` obsługuje i sesje per karta, i wizytujących per przeglądarka.
   */
  readonly grain: IdentityGrain;
  readonly role: BindingRole;
}

export interface MetricDefinition {
  readonly id: MetricId;
  readonly labelPl: string;
  readonly labelEn: string;
  readonly unit: MetricUnit;
  readonly aggregation: MetricAggregation;
  /** Zdanie kanoniczne - JEDYNA obowiązująca definicja tej metryki. */
  readonly definitionPl: string;
  readonly definitionEn: string;
  readonly bindings: readonly MetricBinding[];
  /**
   * Dopuszczalny rozjazd między strumieniami POTWIERDZAJĄCYMI a autorytatywnym,
   * jako ułamek wartości autorytatywnej. Powyżej tego progu rozbieżność jest
   * raportowana jako wymagająca wyjaśnienia, a nie jako naturalny dryf.
   */
  readonly driftTolerance: number;
  /**
   * Oczekiwany porządek malejący wartości. `["first_party", "ga4"]` czyta się:
   * liczba first-party jest strukturalnie >= liczby z GA4 (brak filtrowania botów,
   * sesje per karta). Odwrócenie tej relacji to sygnał błędnej konfiguracji, nie dryfu.
   */
  readonly expectedOrder?: readonly StreamId[];
  /** Zakazane operacje - dosłowne ostrzeżenia dla autorów raportów. */
  readonly guards: readonly string[];
}

const METRIC_LIST: readonly MetricDefinition[] = [
  {
    id: "sessions",
    labelPl: "Sesje",
    labelEn: "Sessions",
    unit: "count",
    aggregation: "distinct_count",
    definitionPl:
      "Liczba wizyt zakończonych 30 minutami bezczynności. Autorytatywne jest GA4, bo sesjonizuje po użytkowniku; nasz licznik first-party liczy sesje PER KARTA i z definicji zawyża.",
    definitionEn:
      "Visits terminated by 30 minutes of inactivity. GA4 is authoritative because it sessionizes per user; the first-party counter sessionizes per tab and therefore over-counts by construction.",
    bindings: [
      {
        streamId: "ga4",
        field: "sessions",
        formula: "GA4 metric `sessions` (30-min inactivity, resets at property-timezone midnight)",
        grain: "ga4_session",
        role: "authoritative",
      },
      {
        streamId: "first_party",
        field: "count(distinct analytics_events.session_id)",
        formula: "COUNT(DISTINCT session_id) over the window",
        grain: "tab_session",
        role: "corroborating",
      },
    ],
    driftTolerance: 0.4,
    expectedOrder: ["first_party", "ga4"],
    guards: [
      "Never add GA4 sessions to first-party sessions - the same visit is present in both.",
      "Never use first-party sessions as a conversion denominator: multi-tab browsing inflates it.",
    ],
  },
  {
    id: "visitors",
    labelPl: "Użytkownicy",
    labelEn: "Users",
    unit: "count",
    aggregation: "distinct_count",
    definitionPl:
      "Liczba rozpoznanych przeglądarek w oknie. GA4 (`activeUsers`) jest autorytatywne; `anon_id` z localStorage jest odporniejszy na czyszczenie cookies, więc bywa wyższy.",
    definitionEn:
      "Distinct browsers recognised in the window. GA4 `activeUsers` is authoritative; the localStorage `anon_id` survives cookie clearing and therefore tends to run higher.",
    bindings: [
      {
        streamId: "ga4",
        field: "activeUsers",
        formula: "GA4 metric `activeUsers` (cookie `_ga`, per browser)",
        grain: "ga4_user",
        role: "authoritative",
      },
      {
        streamId: "first_party",
        field: "count(distinct analytics_events.anon_id)",
        formula: "COUNT(DISTINCT anon_id) over the window, NULLs excluded",
        grain: "browser_visitor",
        role: "corroborating",
      },
    ],
    driftTolerance: 0.35,
    expectedOrder: ["first_party", "ga4"],
    guards: [
      "A browser is not a person - do not present either number as 'people reached'.",
      "anon_id is empty when localStorage is unavailable (private mode), so its distinct count silently omits those visitors.",
    ],
  },
  {
    id: "page_views",
    labelPl: "Odsłony stron",
    labelEn: "Page views",
    unit: "count",
    aggregation: "sum",
    definitionPl:
      "Każde wyświetlenie strony, bez progu czasu i bez deduplikacji. Autorytatywne jest GA4 (filtruje boty); first-party jest surowe i wyższe.",
    definitionEn:
      "Every page render, with no dwell threshold and no deduplication. GA4 is authoritative because it filters bots; the first-party count is raw and higher.",
    bindings: [
      {
        streamId: "ga4",
        field: "screenPageViews",
        formula: "GA4 metric `screenPageViews`",
        grain: "ga4_session",
        role: "authoritative",
      },
      {
        streamId: "first_party",
        field: "count(*) where event_type = 'page_view'",
        formula: "COUNT(*) of analytics_events rows with event_type = 'page_view'",
        grain: "tab_session",
        role: "corroborating",
      },
    ],
    driftTolerance: 0.3,
    expectedOrder: ["first_party", "ga4"],
    guards: [
      "This is NOT the same metric as 'content views' - post_views requires 1.5 s of dwell and deduplicates a 5-minute window.",
      "Do not divide ad impressions by page views: the two sit behind different consent gates.",
    ],
  },
  {
    id: "content_views",
    labelPl: "Odsłony treści",
    labelEn: "Content views",
    unit: "count",
    aggregation: "sum",
    definitionPl:
      "Odsłona artykułu policzona po 1,5 s obecności na stronie, zdeduplikowana w oknie 5 minut na (wpis, przeglądarka), bez odsłon autora. To metryka REDAKCYJNA - z definicji niższa niż odsłony stron.",
    definitionEn:
      "An article view counted after 1.5 s of dwell, deduplicated per (post, browser) within a 5-minute window, excluding the author's own views. This is the EDITORIAL metric and is lower than page views by construction.",
    bindings: [
      {
        streamId: "content_views",
        field: "count(post_views.id)",
        formula: "COUNT(*) of post_views rows in the window (5-min dedupe applied at write time)",
        grain: "viewer_hash",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Never label this 'page views' in a report - the dwell threshold and dedupe window make it a different metric.",
      "Author views are excluded, so editorial QA traffic will not show up here even though GA4 sees it.",
    ],
  },
  {
    id: "engagement_rate",
    labelPl: "Współczynnik zaangażowania",
    labelEn: "Engagement rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Udział sesji zaangażowanych (>10 s, >=2 odsłony lub konwersja) w sesjach ogółem - definicja Google. Nie da się jej odtworzyć z naszych zdarzeń, więc GA4 jest jedynym źródłem.",
    definitionEn:
      "Share of engaged sessions (>10 s, >=2 views, or a conversion) among all sessions - Google's definition. It cannot be reproduced from our own events, so GA4 is the only source.",
    bindings: [
      {
        streamId: "ga4",
        field: "engagementRate",
        formula: "GA4 metric `engagementRate` (engaged sessions / sessions)",
        grain: "ga4_session",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Do not approximate this from first-party events: we do not record session duration, so any local rebuild would be a different metric wearing the same name.",
    ],
  },
  {
    id: "cta_clicks",
    labelPl: "Kliknięcia CTA",
    labelEn: "CTA clicks",
    unit: "count",
    aggregation: "sum",
    definitionPl:
      "Kliknięcia elementów wezwania do działania rejestrowane pierwszą stroną. GA4 ich nie widzi, dopóki nie skonfigurowano zdarzeń w GTM - dlatego first-party jest autorytatywne.",
    definitionEn:
      "Clicks on call-to-action elements recorded first-party. GA4 does not see them unless GTM events are configured, so the first-party stream is authoritative.",
    bindings: [
      {
        streamId: "first_party",
        field: "count(*) where event_type = 'cta_click'",
        formula: "COUNT(*) of analytics_events rows with event_type = 'cta_click'",
        grain: "tab_session",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Consent-gated: visitors who declined analytics click CTAs that are never recorded, so this is a lower bound.",
    ],
  },
  {
    id: "internal_searches",
    labelPl: "Wyszukiwania wewnętrzne",
    labelEn: "Internal searches",
    unit: "count",
    aggregation: "sum",
    definitionPl:
      "Zapytania wpisane w wyszukiwarkę serwisu (min. 2 znaki). Wyłącznie first-party - GA4 zbiera site search tylko przy zapytaniu w URL.",
    definitionEn:
      "Queries typed into the site search (minimum 2 characters). First-party only - GA4 site search requires the query to appear in the URL.",
    bindings: [
      {
        streamId: "first_party",
        field: "count(*) where event_type = 'search'",
        formula: "COUNT(*) of analytics_events rows with event_type = 'search'",
        grain: "tab_session",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Queries shorter than 2 characters are dropped client-side and can never appear here.",
    ],
  },
  {
    id: "lcp_p75",
    labelPl: "LCP (p75)",
    labelEn: "LCP (p75)",
    unit: "milliseconds",
    aggregation: "percentile_75",
    definitionPl:
      "75. percentyl LCP metodą NEAREST-RANK (wartość faktycznie zmierzona, nie interpolowana) na próbkach RUM w oknie.",
    definitionEn:
      "75th percentile of LCP by NEAREST RANK (an actually measured value, never interpolated) over the RUM samples in the window.",
    bindings: [
      {
        streamId: "web_vitals",
        field: "percentile_disc(0.75) over web_vitals.value where metric = 'LCP'",
        formula: "nearest-rank p75: value at index ceil(0.75 * n) of the ascending sample list",
        grain: "anonymous_event",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Nearest rank, not linear interpolation: percentile_cont would invent a value that no visitor experienced and would disagree with the in-memory aggregate.",
      "Not weighted by traffic - a rarely visited but slow path counts the same as the home page.",
    ],
  },
  {
    id: "inp_p75",
    labelPl: "INP (p75)",
    labelEn: "INP (p75)",
    unit: "milliseconds",
    aggregation: "percentile_75",
    definitionPl:
      "75. percentyl INP metodą nearest-rank na próbkach RUM w oknie. Uwaga: starsze Safari nie raportuje INP, więc próbka jest przesunięta w stronę Chromium.",
    definitionEn:
      "75th percentile of INP by nearest rank over the RUM samples in the window. Note: older Safari does not report INP, so the sample skews towards Chromium.",
    bindings: [
      {
        streamId: "web_vitals",
        field: "percentile_disc(0.75) over web_vitals.value where metric = 'INP'",
        formula: "nearest-rank p75: value at index ceil(0.75 * n) of the ascending sample list",
        grain: "anonymous_event",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "The browser mix of INP samples differs from the browser mix of your traffic - do not read it as a whole-audience figure.",
    ],
  },
  {
    id: "cls_p75",
    labelPl: "CLS (p75)",
    labelEn: "CLS (p75)",
    unit: "score",
    aggregation: "percentile_75",
    definitionPl:
      "75. percentyl CLS metodą nearest-rank na próbkach RUM w oknie. Bezwymiarowy - nie formatuj go w milisekundach.",
    definitionEn:
      "75th percentile of CLS by nearest rank over the RUM samples in the window. Unitless - never format it as milliseconds.",
    bindings: [
      {
        streamId: "web_vitals",
        field: "percentile_disc(0.75) over web_vitals.value where metric = 'CLS'",
        formula: "nearest-rank p75: value at index ceil(0.75 * n) of the ascending sample list",
        grain: "anonymous_event",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Unitless score rounded to 3 decimals; the 'ms' suffix used by other vitals is wrong.",
    ],
  },
  {
    id: "ad_impressions",
    labelPl: "Emisje reklam",
    labelEn: "Ad impressions",
    unit: "count",
    aggregation: "sum",
    definitionPl:
      "Wyemitowane slot-y reklamowe za zgodą MARKETINGOWĄ. Populacja jest inna niż przy odsłonach stron (zgoda analityczna) - to nie są ułamki tej samej całości.",
    definitionEn:
      "Ad slots rendered under MARKETING consent. The population differs from page views (analytics consent), so the two are not fractions of the same whole.",
    bindings: [
      {
        streamId: "ad_events",
        field: "count(*) where kind = 'impression'",
        formula: "COUNT(*) of ad_events rows with kind = 'impression'",
        grain: "anonymous_event",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Never divide by page views or sessions - different consent gate, different population.",
      "Ad blockers remove the slot and the beacon together, so this is a lower bound on eligible inventory.",
    ],
  },
  {
    id: "ad_clicks",
    labelPl: "Kliknięcia reklam",
    labelEn: "Ad clicks",
    unit: "count",
    aggregation: "sum",
    definitionPl: "Kliknięcia w wyemitowane slot-y reklamowe, za zgodą marketingową.",
    definitionEn: "Clicks on rendered ad slots, under marketing consent.",
    bindings: [
      {
        streamId: "ad_events",
        field: "count(*) where kind = 'click'",
        formula: "COUNT(*) of ad_events rows with kind = 'click'",
        grain: "anonymous_event",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: ["Only comparable with ad_impressions - the single denominator behind the same gate."],
  },
  {
    id: "ad_ctr",
    labelPl: "CTR reklam",
    labelEn: "Ad CTR",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Kliknięcia reklam / emisje reklam. Licznik i mianownik MUSZĄ pochodzić z tego samego strumienia - to jedyny sposób, żeby bramka zgody się skróciła.",
    definitionEn:
      "Ad clicks / ad impressions. Numerator and denominator MUST come from the same stream - that is the only way the consent gate cancels out.",
    bindings: [
      {
        streamId: "ad_events",
        field: "count(click) / count(impression)",
        formula: "ad_clicks / ad_impressions, both from ad_events in the same window",
        grain: "anonymous_event",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Undefined when there are no impressions - report '-' rather than 0 %, which reads as 'nobody clicked'.",
    ],
  },
  {
    id: "email_opens",
    labelPl: "Otwarcia newslettera",
    labelEn: "Newsletter opens",
    unit: "count",
    aggregation: "sum",
    definitionPl:
      "Wczytania pikselu otwarcia, ZDEDUPLIKOWANE do jednego na odbiorcę i dobę UTC. Metryka NAJMNIEJ wiarygodna z całego zestawu: proxy prywatności pobierają piksel bez udziału człowieka, a klienci blokujący obrazy nie pobierają go nigdy.",
    definitionEn:
      "Open-pixel loads, DEDUPLICATED to one per recipient per UTC day. The least trustworthy metric in the set: privacy proxies fetch the pixel with no human involved, while image-blocking clients never fetch it at all.",
    bindings: [
      {
        streamId: "newsletter",
        field: "count(*) where kind = 'open'",
        formula: "COUNT(*) of newsletter_campaign_events rows with kind = 'open'",
        grain: "email_recipient",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Do not present as 'people who read the email'; quote clicks when the claim matters.",
      "A row is one recipient-DAY, not one interaction: five opens today count once, and tomorrow counts again. Quote COUNT(DISTINCT subscriber_id) whenever the claim is about PEOPLE - it is also the only numerator that cannot exceed the delivered count.",
    ],
  },
  {
    id: "email_clicks",
    labelPl: "Kliknięcia w newsletterze",
    labelEn: "Newsletter clicks",
    unit: "count",
    aggregation: "sum",
    definitionPl:
      "Przejścia przez przekierowanie `nl-click` z podpisanym tokenem. Wiarygodny sygnał zaangażowania odbiorcy.",
    definitionEn:
      "Redirects through `nl-click` with a signed token. The reliable recipient-engagement signal.",
    bindings: [
      {
        streamId: "newsletter",
        field: "count(*) where kind = 'click'",
        formula: "COUNT(*) of newsletter_campaign_events rows with kind = 'click'",
        grain: "email_recipient",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "A newsletter click that lands on the site is ALSO a first-party page view - counting both as 'traffic' double-counts the same visit.",
    ],
  },
  {
    id: "email_ctr",
    labelPl: "CTR newslettera",
    labelEn: "Newsletter CTR",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Kliknięcia / otwarcia w tym samym oknie (CTOR). Mianownik dziedziczy niepewność otwarć - raportuj z tym zastrzeżeniem.",
    definitionEn:
      "Clicks / opens in the same window (CTOR). The denominator inherits the unreliability of opens - report it with that caveat.",
    bindings: [
      {
        streamId: "newsletter",
        field: "count(click) / count(open)",
        formula: "email_clicks / email_opens, both from newsletter_campaign_events",
        grain: "email_recipient",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Privacy-proxy pre-fetches inflate the denominator, so CTOR trends down for reasons unrelated to your content.",
      "Numerator and denominator are both deduplicated per recipient-day, so the ratio is well defined - before that dedup a second producer could push it, and the open rate, above 100 %.",
    ],
  },
  {
    id: "related_clicks",
    labelPl: "Kliknięcia rekomendacji",
    labelEn: "Related-post clicks",
    unit: "count",
    aggregation: "sum",
    definitionPl:
      "Kliknięcia w bloku powiązanych wpisów. Porównuj wyłącznie z odsłonami TREŚCI (`content_views`) - obie liczby siedzą za tą samą bramką i tym samym ziarnem.",
    definitionEn:
      "Clicks inside the related-posts block. Compare only against CONTENT views (`content_views`) - both sit behind the same gate with the same grain.",
    bindings: [
      {
        streamId: "content_views",
        field: "count(related_post_clicks.*)",
        formula: "COUNT(*) of related_post_clicks rows in the window",
        grain: "viewer_hash",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "The denominator for a related-CTR is content_views, never page_views: only content_views shares the dwell threshold and dedupe rule.",
    ],
  },
  {
    id: "reads",
    labelPl: "Przeczytane (pary użytkownik-wpis)",
    labelEn: "Reads (user-post pairs)",
    unit: "count",
    aggregation: "distinct_count",
    definitionPl:
      "Liczba par (użytkownik, wpis), których OSTATNIE przeczytanie wypadło w oknie. `user_read_history` jest UPSERT-owane, więc wiersz to stan, nie zdarzenie - ta metryka NIE jest liczbą przeczytań.",
    definitionEn:
      "Number of (user, post) pairs whose LAST read falls in the window. `user_read_history` is UPSERTed, so a row is state, not an event - this metric is NOT a count of reads.",
    bindings: [
      {
        streamId: "content_views",
        field: "count(user_read_history.*) where read_at in window",
        formula: "COUNT(*) of user_read_history rows whose read_at falls in the window",
        grain: "viewer_hash",
        role: "authoritative",
      },
    ],
    driftTolerance: 0,
    guards: [
      "Re-reading a post moves the existing row's read_at instead of adding one, so a longer window can return FEWER rows than a shorter one that ends today.",
      "Signed-in users only - anonymous reading is invisible here.",
    ],
  },
];

export const METRICS: readonly MetricDefinition[] = METRIC_LIST;

const BY_ID = new Map<MetricId, MetricDefinition>(METRIC_LIST.map((m) => [m.id, m]));

/** Definicja metryki kanonicznej. Rzuca dla nieznanego id - słownik jest zamknięty. */
export function metricById(id: MetricId): MetricDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown canonical metric: ${id}`);
  return found;
}

/** Powiązanie autorytatywne - liczba, którą wolno zacytować w raporcie. */
export function authoritativeBinding(id: MetricId): MetricBinding {
  const def = metricById(id);
  const found = def.bindings.find((b) => b.role === "authoritative");
  if (!found) throw new Error(`Metric ${id} has no authoritative binding`);
  return found;
}

/** Powiązanie metryki z konkretnym strumieniem (jeśli ten strumień ją obsługuje). */
export function bindingFor(id: MetricId, streamId: StreamId): MetricBinding | undefined {
  return metricById(id).bindings.find((b) => b.streamId === streamId);
}

/** Metryki, które dany strumień potrafi obsłużyć. */
export function metricsForStream(streamId: StreamId): readonly MetricDefinition[] {
  return METRIC_LIST.filter((m) => m.bindings.some((b) => b.streamId === streamId));
}

export type Comparability = "equivalent" | "analogous" | "incomparable";

/**
 * Poziom porównywalności dwóch powiązań tej samej metryki.
 *
 * Różna bramka zgody => `incomparable` (różne populacje - żadna arytmetyka
 * między nimi nie ma sensu). Ta sama bramka, ale inne ziarno tożsamości lub inny
 * tryb deduplikacji => `analogous` (przesunięcie jest oczekiwane; sprawdzamy rząd
 * wielkości i kierunek). Wszystko identyczne => `equivalent`.
 */
export function comparabilityOf(a: MetricBinding, b: MetricBinding): Comparability {
  const sa = streamById(a.streamId);
  const sb = streamById(b.streamId);
  if (sa.consentGate !== sb.consentGate) return "incomparable";
  if (a.grain !== b.grain) return "analogous";
  if (sa.dedupe !== sb.dedupe) return "analogous";
  return "equivalent";
}

/**
 * Strażnik metryk złożonych: licznik i mianownik MUSZĄ pochodzić z tego samego
 * strumienia. Inaczej bramka zgody się nie skraca i wychodzi „CTR” liczony na
 * dwóch różnych populacjach - klasyczne źródło niemożliwych do obrony liczb
 * (np. emisje reklam / odsłony stron).
 */
export function assertSameStreamRatio(
  numerator: MetricId,
  denominator: MetricId,
): { ok: true } | { ok: false; reason: string } {
  const n = authoritativeBinding(numerator);
  const d = authoritativeBinding(denominator);
  if (n.streamId === d.streamId) return { ok: true };
  const gateN = streamById(n.streamId).consentGate;
  const gateD = streamById(d.streamId).consentGate;
  return {
    ok: false,
    reason:
      `${numerator} comes from ${n.streamId} (consent: ${gateN}) while ${denominator} comes from ` +
      `${d.streamId} (consent: ${gateD}); the gates do not cancel out, so the ratio is not defined.`,
  };
}
