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
 * Rejestr obejmuje też 70 metryk huba „Przychód i lejek” (SPEC §5.5):
 * przychód, retencję, lejek, ekonomikę, e-mail, społeczność i CRM. Wiążą się
 * one ze strumieniami faktów (`billing`, `lifecycle`, `community`) - te same
 * reguły (jeden autorytet, iloraz w obrębie strumienia, `null` zamiast zera)
 * obowiązują liczby z księgi tak samo jak liczby z GA4.
 *
 * Plik jest czysty (bez I/O), więc te same reguły obowiązują na serwerze, w
 * panelu admina i w testach. NIE trafia do grafu publicznego: moduły
 * publiczne importują z niego wyłącznie typy (`import type`).
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
  | "reads"
  // --- hub: przychód (14)
  | "mrr"
  | "arr"
  | "arpa"
  | "arpu"
  | "active_subscriptions"
  | "mrr_growth_mom"
  | "net_new_mrr"
  | "saas_quick_ratio"
  | "expansion_share_new_mrr"
  | "annual_plan_share"
  | "revenue_realized"
  | "price_realization"
  | "average_discount"
  | "coupon_redemption_rate"
  // --- hub: retencja (13)
  | "logo_churn_monthly"
  | "logo_churn_annual"
  | "gross_revenue_churn"
  | "net_revenue_retention"
  | "gross_revenue_retention"
  | "involuntary_churn_share"
  | "dunning_recovery_rate"
  | "cancellation_save_rate"
  | "winback_rate_12m"
  | "returning_subscriber_share"
  | "cohort_retention_m1"
  | "cohort_retention_m3"
  | "cohort_retention_m12"
  // --- hub: lejek (9)
  | "visitor_to_registration_rate"
  | "registered_to_paid_rate"
  | "paywall_conversion_rate"
  | "paywall_hit_rate"
  | "trial_to_paid_rate"
  | "checkout_conversion_rate"
  | "checkout_abandonment_rate"
  | "pricing_page_conversion_rate"
  | "signup_form_conversion_rate"
  // --- hub: ekonomika (7)
  | "ltv"
  | "cac"
  | "new_cac_ratio"
  | "ltv_cac_ratio"
  | "cac_payback_months"
  | "subscription_gross_margin"
  | "rule_of_40"
  // --- hub: e-mail (12)
  | "email_open_rate"
  | "email_ctr_delivered"
  | "email_unsubscribe_rate"
  | "email_hard_bounce_rate"
  | "email_soft_bounce_rate"
  | "email_spam_complaint_rate"
  | "newsletter_list_growth_rate"
  | "doi_confirmation_rate"
  | "email_disaffection_rate"
  | "journey_open_rate"
  | "journey_click_rate"
  | "journey_goal_rate"
  // --- hub: społeczność (10)
  | "event_ticket_revenue"
  | "event_attendance_rate"
  | "no_show_rate"
  | "event_registration_conversion"
  | "club_application_acceptance"
  | "club_decision_time"
  | "club_active_member_rate"
  | "club_contributor_rate"
  | "dau_mau"
  | "wau_mau"
  // --- hub: CRM (5)
  | "lead_to_mql_rate"
  | "mql_to_sql_rate"
  | "win_rate"
  | "lead_response_time"
  | "sales_cycle_length";

/**
 * Jednostka wartości kanonicznej - z niej (a nie z nazwy metryki) wynika
 * formatowanie (`format.ts`).
 *  - `money_minor` - kwota w jednostkach drobnych (grosze); waluta jedzie OSOBNO
 *    w DTO, bo jedna liczba nie niesie waluty, a kwot różnych walut się nie sumuje,
 *  - `months` / `hours` / `days` - czas w jednostce, w której liczy go źródło
 *    (dni: `sales_cycle_length` - benchmarki i CRM mierzą cykl w dniach),
 *  - `multiple` - krotność (Quick Ratio, LTV/CAC) - nie procent i nie kwota.
 */
export type MetricUnit =
  | "count"
  | "ratio"
  | "milliseconds"
  | "score"
  | "money_minor"
  | "months"
  | "multiple"
  | "hours"
  | "days";

/** `median` - czasy (decyzja klubu, reakcja na lead, cykl sprzedaży): średnia zawyżałaby je ogonem. */
export type MetricAggregation = "sum" | "distinct_count" | "ratio" | "percentile_75" | "median";

/**
 * Grupa tematyczna metryki - filtr słownika i zakładek huba. Ruch, Web Vitals,
 * reklamy i treści to `traffic`; e-mail obejmuje też trzy metryki newslettera
 * sprzed huba (otwarcia, kliknięcia, CTOR).
 */
export type MetricGroup =
  "traffic" | "revenue" | "retention" | "funnel" | "economics" | "email" | "community" | "crm";

/**
 * Charakter okna dla metryki:
 *  - `flow`        - zdarzenia W oknie (przepływ),
 *  - `stock`       - stan NA KONIEC okna (okno wyznacza tylko chwilę odczytu),
 *  - `cohort`      - kohorta startująca w oknie, mierzona w swoim horyzoncie,
 *  - `per_journey` - liczone per ścieżka automatyczna (krok, wersja).
 */
export type MetricWindowKind = "flow" | "stock" | "cohort" | "per_journey";

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
  /**
   * Metryka pieniężna: wartość kanoniczna jest kwotą w walucie WIODĄCEJ
   * (pierwsza pozycja listy), a pełne `MoneyByCurrency[]` jedzie obok w DTO.
   * Bez tej flagi konsument nie wie, że liczba bez waluty jest tylko wycinkiem.
   */
  readonly currencyBound?: true;
  readonly windowKind?: MetricWindowKind;
}

const BASE_METRIC_LIST: readonly MetricDefinition[] = [
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
      "Since I9d-Y2 the pixel goes only to recipients whose consent covers measuring opens and clicks - a drop after that release means fewer measured people, not less reading.",
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
      "Since I9d-Y2 only recipients whose consent covers measurement get links with a recipient token - everyone else reaches the site without a click recorded here.",
    ],
  },
  {
    id: "email_ctr",
    // CTOR, nie CTR: mianownikiem są OTWARCIA (definicja niżej bez zmian). Stara
    // etykieta „CTR” kazała porównywać tę liczbę z benchmarkami CTR liczonymi od
    // doręczeń - kilkukrotnie niższymi. CTR od doręczonych to `email_ctr_delivered`.
    labelPl: "CTOR newslettera",
    labelEn: "Newsletter CTOR",
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

// ---------------------------------------------------------------------------
// METRYKI HUBA „PRZYCHÓD I LEJEK” (SPEC §5.5) - 70 pozycji w kolejności grup
// specyfikacji: przychód 14, retencja 13, lejek 9, ekonomika 7, e-mail 12,
// społeczność 10, CRM 5.
//
// ZASADY WSPÓLNE (sprawdza `registry.test.ts`):
//  - dokładnie JEDEN binding autorytatywny; potwierdzający tylko tam, gdzie
//    inny strumień naprawdę mierzy to samo (`revenue_realized`: księga
//    dokumentów vs zamówienia z kasy);
//  - iloraz liczony WYŁĄCZNIE w obrębie jednego strumienia - licznik i
//    mianownik z dwóch strumieni stoją za różnymi populacjami (zgoda
//    analityczna vs umowa), więc taki „wskaźnik” nie jest ułamkiem niczego;
//  - definicja mówi: co liczy, mianownik, okno i KIEDY wartości nie ma
//    (`null`, nigdy zero w zastępstwie);
//  - guardy po angielsku (jak wyżej), unikalne w całym rejestrze: słownik
//    renderuje je jako osobne wiersze, a test organizmu szuka każdego po
//    treści - duplikat byłby niejednoznaczny dla czytelnika i dla testu.
//
// Pole `field` wskazuje klucz jsonb RPC huba (kontrakt `*_KEYS` w
// `revenueRaw.ts`) albo wyrażenie źródłowe dla metryk liczonych poza
// migawką przychodu (ekonomika, ścieżki, CRM) - żeby audytor wiedział, SKĄD
// pochodzi liczba, zanim zapyta, CO znaczy.
// ---------------------------------------------------------------------------

/** Binding autorytatywny - jedyny skrót, bo rola jest tu zawsze ta sama. */
function authoritative(
  streamId: StreamId,
  grain: IdentityGrain,
  field: string,
  formula: string,
): MetricBinding {
  return { streamId, field, formula, grain, role: "authoritative" };
}

const HUB_METRIC_LIST: readonly MetricDefinition[] = [
  // --- PRZYCHÓD (14) --------------------------------------------------------
  {
    id: "mrr",
    labelPl: "MRR",
    labelEn: "MRR",
    unit: "money_minor",
    aggregation: "sum",
    definitionPl:
      "Miesięczny przychód powtarzalny (MRR): suma znormalizowanych do miesiąca kwot netto aktywnych płatnych subskrypcji na koniec okna (plan roczny 600 zł = 50 zł), bez opłat jednorazowych i okresów próbnych. Osobna kwota dla każdej waluty. Brak wartości, gdy księga MRR nie sięga końca okna.",
    definitionEn:
      "Monthly Recurring Revenue (MRR): the month-normalised net amount of all active paid subscriptions at the end of the window (a 600 PLN annual plan = 50 PLN), excluding one-off charges and trials. One amount per currency. Undefined when the MRR ledger does not reach the window end.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.mrr",
        "Σ mrr_after of each live subscription's last state before p_until (subscription_state_history), per currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Never add MRR across currencies - 10 000 PLN plus 2 400 EUR is not an amount; quote each currency separately.",
      "Event tickets, sponsorships and commissioned reports are not recurring revenue - keep them out of MRR.",
    ],
    currencyBound: true,
    windowKind: "stock",
  },
  {
    id: "arr",
    labelPl: "ARR",
    labelEn: "ARR",
    unit: "money_minor",
    aggregation: "sum",
    definitionPl:
      "Roczny przychód powtarzalny (ARR): MRR na koniec okna pomnożony przez 12, osobno dla każdej waluty. To przeliczenie stanu, a nie prognoza ani suma faktur z ostatnich 12 miesięcy. Brak wartości dokładnie wtedy, gdy brak MRR.",
    definitionEn:
      "Annual Recurring Revenue (ARR): end-of-window MRR multiplied by 12, per currency. It restates a level; it is neither a forecast nor the sum of the last twelve months of invoices. Undefined exactly when MRR is undefined.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.arr",
        "mrr × 12 at p_until, per currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Do not present ARR as booked or invoiced annual revenue - it annualises the current MRR level.",
    ],
    currencyBound: true,
    windowKind: "stock",
  },
  {
    id: "arpa",
    labelPl: "ARPA",
    labelEn: "ARPA",
    unit: "money_minor",
    aggregation: "ratio",
    definitionPl:
      "Średni przychód na konto (ARPA): MRR na koniec okna podzielony przez liczbę aktywnych płacących kont (instytucja z wieloma licencjami = jedno konto), osobno dla każdej waluty. Brak wartości, gdy nie ma żadnego płacącego konta.",
    definitionEn:
      "Average Revenue Per Account (ARPA): end-of-window MRR divided by the number of active paying accounts (an institution with many seats = one account), per currency. Undefined when there is no paying account.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.arpa",
        "mrr ÷ active_customers at p_until, per currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "ARPA divides by accounts and ARPU by paying users - one institutional seat licence moves them in opposite directions, so never swap them.",
    ],
    currencyBound: true,
    windowKind: "stock",
  },
  {
    id: "arpu",
    labelPl: "ARPU",
    labelEn: "ARPU",
    unit: "money_minor",
    aggregation: "ratio",
    definitionPl:
      "Średni przychód na płacącego użytkownika (ARPU): przychód powtarzalny z subskrypcji w oknie (netto, po rabatach) podzielony przez średnią liczbę płacących użytkowników w oknie, osobno dla każdej waluty. Brak wartości, gdy średnia liczba płacących wynosi zero.",
    definitionEn:
      "Average Revenue Per paying User (ARPU): recurring subscription revenue in the window (net, after discounts) divided by the average number of paying users in the window, per currency. Undefined when the average paying base is zero.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.arpu",
        "recurring net revenue in [p_since, p_until) ÷ average paying users over the window, per currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Benchmarks are quoted net of VAT - compare a gross ARPU only after removing VAT, never as it stands.",
    ],
    currencyBound: true,
    windowKind: "flow",
  },
  {
    id: "active_subscriptions",
    labelPl: "Aktywne subskrypcje",
    labelEn: "Active subscriptions",
    unit: "count",
    aggregation: "distinct_count",
    definitionPl:
      "Liczba płatnych subskrypcji w stanie aktywnym na koniec okna (środowisko live), bez okresów próbnych i subskrypcji wstrzymanych. To stan, nie przepływ - okno wyznacza tylko chwilę odczytu. Brak wartości, gdy historia stanów nie sięga końca okna.",
    definitionEn:
      "Number of paid subscriptions in an active state at the end of the window (live environment), excluding trials and paused subscriptions. It is a level, not a flow - the window only fixes the reading instant. Undefined when the state history does not reach the window end.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.active_subscriptions",
        "COUNT of live subscriptions whose last state before p_until is active and paid",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A subscription is not a customer: one institution can hold several subscriptions, so divide MRR by accounts (ARPA), not by this count.",
    ],
    windowKind: "stock",
  },
  {
    id: "mrr_growth_mom",
    labelPl: "Wzrost MRR m/m",
    labelEn: "MRR growth (MoM)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Miesięczna dynamika MRR: (MRR na końcu okna − MRR na jego początku) ÷ MRR na początku, w walucie wiodącej; dla okien dłuższych niż miesiąc przeliczana na średni wzrost miesięczny (CMGR). Brak wartości, gdy MRR na początku okna wynosi zero.",
    definitionEn:
      "Month-over-month MRR growth: (MRR at window end − MRR at window start) ÷ MRR at window start, in the leading currency; for windows longer than a month it is restated as the compound monthly growth rate (CMGR). Undefined when start MRR is zero.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.mrr_growth_mom",
        "(mrr_end − mrr_start) ÷ mrr_start, compounded to a monthly rate when the window spans several months",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Growth from a near-zero base is noise - read it together with Net New MRR in currency, never as a percentage alone.",
    ],
    windowKind: "flow",
  },
  {
    id: "net_new_mrr",
    labelPl: "Net New MRR",
    labelEn: "Net New MRR",
    unit: "money_minor",
    aggregation: "sum",
    definitionPl:
      "Saldo ruchów MRR w oknie: nowe + ekspansja + reaktywacja − kontrakcja − utracone (churn), osobno dla każdej waluty. Równa się różnicy MRR między końcem a początkiem okna (suma kontrolna mostu). Brak wartości, gdy księga ruchów nie obejmuje całego okna.",
    definitionEn:
      "Balance of MRR movements in the window: new + expansion + reactivation − contraction − churned, per currency. It equals end MRR minus start MRR (the bridge checksum). Undefined when the movement ledger does not cover the whole window.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.net_new_mrr",
        "Σ movements.new + expansion + reactivation − contraction − churn over [p_since, p_until), per currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "If net new MRR differs from end minus start MRR beyond rounding, a movement is missing from the ledger - report the gap instead of the balance.",
    ],
    currencyBound: true,
    windowKind: "flow",
  },
  {
    id: "saas_quick_ratio",
    labelPl: "Quick Ratio SaaS",
    labelEn: "SaaS Quick Ratio",
    unit: "multiple",
    aggregation: "ratio",
    definitionPl:
      "Quick Ratio SaaS: (nowy MRR + ekspansja + reaktywacja) ÷ (utracony MRR + kontrakcja) w oknie, w walucie wiodącej. Mówi, ile MRR przybywa na każdą jednostkę MRR utraconą. Brak wartości, gdy w oknie nie było żadnego ubytku MRR.",
    definitionEn:
      "SaaS Quick Ratio: (new + expansion + reactivation MRR) ÷ (churned + contraction MRR) in the window, in the leading currency. It tells how much MRR is gained per unit lost. Undefined when the window has no MRR loss at all.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.saas_quick_ratio",
        "(movements.new + expansion + reactivation) ÷ (movements.churn + contraction), leading currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A zero-loss window has no Quick Ratio - never display it as infinite or as a perfect score.",
    ],
    windowKind: "flow",
  },
  {
    id: "expansion_share_new_mrr",
    labelPl: "Udział ekspansji w nowym MRR",
    labelEn: "Expansion share of new MRR",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Udział ekspansji: MRR z rozszerzeń (wyższy plan, więcej licencji) ÷ (nowy MRR + ekspansja + reaktywacja) w oknie, w walucie wiodącej. Brak wartości, gdy w oknie nie powstał żaden przyrost MRR.",
    definitionEn:
      "Expansion share: MRR from expansions (plan upgrades, extra seats) ÷ (new + expansion + reactivation MRR) in the window, in the leading currency. Undefined when the window added no MRR at all.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.expansion_share_new_mrr",
        "movements.expansion ÷ (movements.new + expansion + reactivation), leading currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A rising share with flat new MRR means acquisition stalled, not that expansion improved - read both components.",
    ],
    windowKind: "flow",
  },
  {
    id: "annual_plan_share",
    labelPl: "Udział planów rocznych",
    labelEn: "Annual plan share",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Udział planów rocznych: aktywne płatne subskrypcje z okresem rozliczeniowym co najmniej 12 miesięcy ÷ wszystkie aktywne płatne subskrypcje na koniec okna. Brak wartości, gdy nie ma aktywnych płatnych subskrypcji.",
    definitionEn:
      "Annual plan share: active paid subscriptions billed every 12 months or longer ÷ all active paid subscriptions at the end of the window. Undefined when there are no active paid subscriptions.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.annual_plan_share",
        "COUNT(active, billing interval ≥ 12 months) ÷ COUNT(active) at p_until",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Annual plans lower visible monthly churn by deferring it to the renewal - compare churn only within one billing interval.",
    ],
    windowKind: "stock",
  },
  {
    id: "revenue_realized",
    labelPl: "Przychód zrealizowany",
    labelEn: "Realised revenue",
    unit: "money_minor",
    aggregation: "sum",
    definitionPl:
      "Przychód zrealizowany: kwoty netto opłaconych dokumentów rozliczeniowych w oknie (subskrypcje, plany jednorazowe, bilety, pakiety, darowizny) minus korekty i zwroty, osobno dla każdej waluty, tylko środowisko live. Brak wartości, gdy księga dokumentów jest niedostępna.",
    definitionEn:
      "Realised revenue: net amounts of paid billing documents in the window (subscriptions, one-off plans, tickets, packages, donations) minus credit notes and refunds, per currency, live environment only. Undefined when the document ledger is unavailable.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.revenue_realized",
        "Σ net of paid billing_documents issued in [p_since, p_until) minus credit notes and refunds, per currency",
      ),
      {
        streamId: "lifecycle",
        field: "admin_revenue_semantic_snapshot.revenue_realized_orders",
        formula:
          "Σ (amount_cents − refunded_amount_cents) of paid live payment_orders with paid_at in the window, same currency",
        grain: "account",
        role: "corroborating",
      },
    ],
    // ROZJAZD NIE MA STAŁEJ WIELKOŚCI, MA KIERUNEK. Zamówienie z kasy powstaje
    // tylko przy zakupie; raty odnowień mają dokument, a nie mają zamówienia
    // (`billingDocuments.server.ts`). Księga jest więc STRUKTURALNIE >=
    // zamówieniom, a różnica to udział odnowień - zależny od miksu najemcy,
    // nie od jakości danych. Tolerancja 1 (cały poziom) wyłącza ocenę
    // wielkości; zostaje jedyna obroniona reguła: zamówienia POWYŻEJ księgi
    // (`order_inverted`) znaczą zgubione dokumenty.
    driftTolerance: 1,
    expectedOrder: ["billing", "lifecycle"],
    guards: [
      "Checkout orders exclude renewal instalments, so the orders total sits below the ledger by the renewal share; an orders total ABOVE the ledger means invoices are missing.",
      "Revenue is realised when a document is paid, not when MRR changes - never reconcile it against MRR movements.",
    ],
    currencyBound: true,
    windowKind: "flow",
  },
  {
    id: "price_realization",
    labelPl: "Realizacja ceny",
    labelEn: "Price realisation",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Realizacja ceny: suma kwot zafakturowanych netto (po rabatach, kuponach i promocjach) ÷ suma tych samych pozycji według cennika katalogowego, w oknie. Brak wartości, gdy w oknie nie ma pozycji z ceną katalogową.",
    definitionEn:
      "Price realisation: net invoiced amounts (after discounts, coupons and promotions) ÷ the same line items at catalogue list price, in the window. Undefined when no line item in the window has a catalogue price.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.price_realization",
        "Σ invoiced net ÷ Σ catalogue list price of the same line items in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Catalogue prices change over time - use the list price valid at the invoice date, never today's price list.",
    ],
    windowKind: "flow",
  },
  {
    id: "average_discount",
    labelPl: "Średni rabat",
    labelEn: "Average discount",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Średni rabat: suma (cena katalogowa − cena zapłacona) ÷ suma cen katalogowych, wyłącznie dla transakcji z rabatem lub kuponem w oknie. Brak wartości, gdy w oknie nie było transakcji z rabatem.",
    definitionEn:
      "Average discount depth: Σ (list price − price paid) ÷ Σ list price, over discounted or couponed transactions in the window only. Undefined when the window has no discounted transaction.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.average_discount",
        "Σ (list − paid) ÷ Σ list over transactions with a discount or coupon",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "The denominator holds discounted transactions only - weight it by their share of all sales before quoting a revenue impact.",
    ],
    windowKind: "flow",
  },
  {
    id: "coupon_redemption_rate",
    labelPl: "Wykorzystanie kuponów",
    labelEn: "Coupon redemption rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wykorzystanie kuponów: kody użyte w opłaconym zamówieniu ÷ kody wydane (doręczone) w kampaniach, których okres ważności przecina okno. Brak wartości, gdy w oknie nie wydano żadnego kodu.",
    definitionEn:
      "Coupon redemption rate: codes used on a paid order ÷ codes issued (delivered) in campaigns whose validity overlaps the window. Undefined when no code was issued in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "account",
        "admin_revenue_funnel.coupon_redemption_rate",
        "COUNT(codes redeemed on paid live orders) ÷ COUNT(codes issued), per campaign validity",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A redeemed code is a discounted sale, not necessarily an extra one - pair this rate with average discount and price realisation.",
    ],
    windowKind: "flow",
  },

  // --- RETENCJA (13) ----------------------------------------------------------
  {
    id: "logo_churn_monthly",
    labelPl: "Churn klientów (miesięczny)",
    labelEn: "Logo churn (monthly)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Miesięczny churn klientów (logo churn): płacące konta aktywne na początku okna, które w oknie odeszły (anulowanie, wygaśnięcie, nieodzyskana płatność) ÷ płacące konta aktywne na początku okna, przeliczone geometrycznie na miesiąc. Brak wartości, gdy na początku okna nie było płacących kont.",
    definitionEn:
      "Monthly logo churn: paying accounts active at window start that left during the window (cancellation, expiry, unrecovered payment) ÷ paying accounts active at window start, restated geometrically to one month. Undefined when there were no paying accounts at window start.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.customers_churned ÷ customers_start",
        "1 − (1 − customers_churned ÷ customers_start)^(30.4375 ÷ window days)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Never turn monthly churn into an annual figure by multiplying by 12 - compound it: 1 − (1 − m)^12.",
    ],
    windowKind: "flow",
  },
  {
    id: "logo_churn_annual",
    labelPl: "Churn klientów (roczny)",
    labelEn: "Logo churn (annual)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Roczny churn klientów: płacące konta aktywne na początku 12-miesięcznego okresu, które nie są aktywne na jego końcu ÷ płacące konta aktywne na początku okresu. Liczony wyłącznie na 12 pełnych miesiącach (LTM). Brak wartości dla innych okien i gdy księga nie obejmuje pełnych 12 miesięcy.",
    definitionEn:
      "Annual logo churn: paying accounts active at the start of a twelve-month period that are not active at its end ÷ paying accounts active at the period start. Computed on twelve full months (LTM) only. Undefined for any other window and when the ledger does not span twelve full months.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.customers_churned ÷ customers_start (LTM window)",
        "customers_churned ÷ customers_start over twelve full calendar months",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Customers who left and returned within the year still count as retained here - quote the winback rate separately rather than netting it in.",
    ],
    windowKind: "flow",
  },
  {
    id: "gross_revenue_churn",
    labelPl: "Churn przychodu brutto",
    labelEn: "Gross revenue churn",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Churn przychodu brutto (GRC): MRR utracony przez anulowania i kontrakcje (niższy plan, nowe rabaty) w oknie ÷ MRR na początku okna, w walucie wiodącej, bez odliczania ekspansji. Brak wartości, gdy MRR na początku okna wynosi zero.",
    definitionEn:
      "Gross revenue churn (GRC): MRR lost to cancellations and contractions (downgrades, new discounts) in the window ÷ MRR at window start, in the leading currency, with no expansion offset. Undefined when start MRR is zero.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.gross_revenue_churn",
        "(movements.churn + movements.contraction) ÷ mrr_start, leading currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Gross means expansion is never netted in - a negative value is a bug, not an excellent month.",
    ],
    windowKind: "flow",
  },
  {
    id: "net_revenue_retention",
    labelPl: "Retencja przychodu netto (NRR)",
    labelEn: "Net revenue retention (NRR)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Retencja przychodu netto (NRR): dzisiejszy MRR klientów, którzy płacili 12 miesięcy temu (z ekspansją, kontrakcją i odejściami) ÷ MRR tej kohorty sprzed 12 miesięcy, bez nowych klientów, w walucie wiodącej. Brak wartości, gdy księga MRR nie sięga 12 miesięcy przed końcem okna.",
    definitionEn:
      "Net revenue retention (NRR): today's MRR of the customers who were paying twelve months ago (with expansion, contraction and churn) ÷ that cohort's MRR twelve months ago, excluding new customers, in the leading currency. Undefined when the MRR ledger does not reach twelve months before the window end.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.net_revenue_retention",
        "MRR at p_until of the cohort paying at p_until − 12 months ÷ that cohort's MRR then, leading currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "NRR above 100 % can hide heavy logo churn behind a few large expansions - always show it next to GRR.",
    ],
    windowKind: "cohort",
  },
  {
    id: "gross_revenue_retention",
    labelPl: "Retencja przychodu brutto (GRR)",
    labelEn: "Gross revenue retention (GRR)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Retencja przychodu brutto (GRR): dzisiejszy MRR klientów, którzy płacili 12 miesięcy temu, liczony bez ekspansji (tylko kontrakcje i odejścia) ÷ MRR tej kohorty sprzed 12 miesięcy; z definicji nie przekracza 100 %. Brak wartości, gdy księga nie sięga 12 miesięcy wstecz.",
    definitionEn:
      "Gross revenue retention (GRR): today's MRR of the customers paying twelve months ago, counting contractions and churn but no expansion ÷ that cohort's MRR twelve months ago; it cannot exceed 100 % by construction. Undefined when the ledger does not reach twelve months back.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.gross_revenue_retention",
        "min(MRR now, MRR then) per customer of the cohort paying at p_until − 12 months ÷ cohort MRR then",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A GRR above 100 % means expansion leaked into the numerator - treat the figure as invalid.",
    ],
    windowKind: "cohort",
  },
  {
    id: "involuntary_churn_share",
    labelPl: "Udział churnu mimowolnego",
    labelEn: "Involuntary churn share",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Udział churnu mimowolnego: subskrypcje zakończone w oknie z powodu nieodzyskanej płatności ÷ wszystkie subskrypcje zakończone w oknie. Brak wartości, gdy w oknie żadna subskrypcja się nie zakończyła.",
    definitionEn:
      "Involuntary churn share: subscriptions ended in the window because a payment was never recovered ÷ all subscriptions ended in the window. Undefined when no subscription ended in the window.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.involuntary_churn_share",
        "COUNT(ended after a lost dunning cycle) ÷ COUNT(ended) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A cancellation filed during an open dunning cycle is voluntary - classify by the reason recorded at the end, not by the last failed charge.",
    ],
    windowKind: "flow",
  },
  {
    id: "dunning_recovery_rate",
    labelPl: "Odzysk płatności (windykacja)",
    labelEn: "Dunning recovery rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Odzysk płatności: cykle windykacji (nieudane płatności cykliczne) zamknięte w oknie odzyskaniem płatności ÷ wszystkie cykle windykacji zamknięte w oknie. Brak wartości, gdy w oknie nie zamknięto żadnego cyklu.",
    definitionEn:
      "Dunning recovery rate: dunning cycles (failed recurring payments) closed in the window by a recovered payment ÷ all dunning cycles closed in the window. Undefined when no cycle closed in the window.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.dunning_recovery_rate",
        "COUNT(dunning_cycles recovered) ÷ COUNT(dunning_cycles closed) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Open cycles are excluded from both sides - counting them as lost would understate recovery at every window end.",
    ],
    windowKind: "flow",
  },
  {
    id: "cancellation_save_rate",
    labelPl: "Skuteczność ratowania anulowań",
    labelEn: "Cancellation save rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Skuteczność ratowania anulowań (save rate): sesje anulowania zakończone przyjęciem oferty, po których klient jest nadal aktywny po 30 dniach ÷ wszystkie sesje anulowania rozpoczęte w oknie. Brak wartości, gdy w oknie nie rozpoczęto żadnej sesji anulowania.",
    definitionEn:
      "Cancellation save rate: cancellation sessions ending with an accepted offer whose customer is still active 30 days later ÷ all cancellation sessions started in the window. Undefined when no cancellation session started in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "account",
        "retention_feedback (started → saved, active 30 days later)",
        "COUNT(retention_feedback saved and still active after 30 days) ÷ COUNT(retention_feedback started) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A save that churns within 30 days is not a save - and making cancellation harder to complete is never a lever (DSA art. 25).",
    ],
    windowKind: "flow",
  },
  {
    id: "winback_rate_12m",
    labelPl: "Odzyskani klienci (12 mies.)",
    labelEn: "Winback rate (12 months)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Odzyskani klienci: byli subskrybenci z kohorty odejść, którzy ponownie wykupili płatną subskrypcję w ciągu 12 miesięcy od odejścia ÷ liczebność tej kohorty. Brak wartości, gdy kohorta jest pusta albo nie minęło jeszcze 12 miesięcy.",
    definitionEn:
      "Winback rate: former subscribers from a churn cohort who bought a paid subscription again within twelve months of leaving ÷ the cohort size. Undefined when the cohort is empty or twelve months have not passed yet.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.winback_rate_12m",
        "COUNT(reactivated within 12 months of churn) ÷ COUNT(churn cohort)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Reactivations within the same billing period are payment retries, not winbacks - count only returns after the subscription had ended.",
    ],
    windowKind: "cohort",
  },
  {
    id: "returning_subscriber_share",
    labelPl: "Udział powracających subskrybentów",
    labelEn: "Returning subscriber share",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Udział powracających: nowe płatne aktywacje w oknie od osób, które wcześniej miały płatną subskrypcję ÷ wszystkie nowe płatne aktywacje w oknie. Brak wartości, gdy w oknie nie było nowych aktywacji.",
    definitionEn:
      "Returning subscriber share: new paid activations in the window from people who held a paid subscription before ÷ all new paid activations in the window. Undefined when the window has no new activation.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.returning_subscriber_share",
        "COUNT(activations with an earlier paid subscription) ÷ COUNT(activations) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A high share with flat new MRR signals churn-and-return cycling (often promo-driven), not healthy acquisition.",
    ],
    windowKind: "flow",
  },
  {
    id: "cohort_retention_m1",
    labelPl: "Retencja kohorty (M1)",
    labelEn: "Cohort retention (M1)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Retencja kohorty po 1 miesiącu: subskrybenci z kohorty startu (miesiąc pierwszej płatności) nadal aktywni i płacący po pierwszym miesiącu ÷ liczebność kohorty. Brak wartości, gdy kohorta jest pusta albo nie minął jeszcze miesiąc.",
    definitionEn:
      "Cohort retention after month 1: subscribers from a start cohort (month of first payment) still active and paying after their first month ÷ cohort size. Undefined when the cohort is empty or a month has not passed yet.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.cohort_retention_m1",
        "COUNT(cohort members paying at month 1) ÷ COUNT(cohort), cohorts starting in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Month-1 retention is dominated by trial and promo expiry - compare cohorts of the same offer, never a promo cohort with a full-price one.",
    ],
    windowKind: "cohort",
  },
  {
    id: "cohort_retention_m3",
    labelPl: "Retencja kohorty (M3)",
    labelEn: "Cohort retention (M3)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Retencja kohorty po 3 miesiącach (ok. 90. dnia): subskrybenci z kohorty startu nadal aktywni i płacący po trzech miesiącach ÷ liczebność kohorty. Brak wartości, gdy kohorta jest pusta albo jest młodsza niż trzy miesiące.",
    definitionEn:
      "Cohort retention after month 3 (around day 90): subscribers from a start cohort still active and paying after three months ÷ cohort size. Undefined when the cohort is empty or younger than three months.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.cohort_retention_m3",
        "COUNT(cohort members paying at month 3) ÷ COUNT(cohort), cohorts at least three months old",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Read M3 only for cohorts at least three months old; younger cohorts must stay empty, never zero.",
    ],
    windowKind: "cohort",
  },
  {
    id: "cohort_retention_m12",
    labelPl: "Retencja kohorty (M12)",
    labelEn: "Cohort retention (M12)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Retencja kohorty po 12 miesiącach: subskrybenci z kohorty startu nadal aktywni i płacący po roku ÷ liczebność kohorty. Brak wartości, gdy kohorta jest pusta albo jest młodsza niż 12 miesięcy.",
    definitionEn:
      "Cohort retention after month 12: subscribers from a start cohort still active and paying after a year ÷ cohort size. Undefined when the cohort is empty or younger than twelve months.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.cohort_retention_m12",
        "COUNT(cohort members paying at month 12) ÷ COUNT(cohort), cohorts at least twelve months old",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Twelve-month retention includes the first annual renewal - annual-plan cohorts show a cliff at month 12 that monthly cohorts spread out.",
    ],
    windowKind: "cohort",
  },

  // --- LEJEK (9) --------------------------------------------------------------
  {
    id: "visitor_to_registration_rate",
    labelPl: "Konwersja wizyt na rejestracje",
    labelEn: "Visitor-to-registration rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja odwiedzających na rejestracje (V2R): przeglądarki, które w oknie ukończyły rejestrację konta (zdarzenie signup_completed) ÷ unikalne przeglądarki odwiedzające serwis w oknie, w populacji ze zgodą analityczną. Brak wartości, gdy w oknie nie było odwiedzających.",
    definitionEn:
      "Visitor-to-registration rate (V2R): browsers that completed an account registration in the window (signup_completed event) ÷ distinct browsers visiting in the window, within the analytics-consent population. Undefined when the window has no visitors.",
    bindings: [
      authoritative(
        "first_party",
        "browser_visitor",
        "count(distinct anon_id) where event_type = 'signup_completed' / count(distinct anon_id)",
        "COUNT(DISTINCT anon_id) with signup_completed ÷ COUNT(DISTINCT anon_id), same window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Both sides sit behind analytics consent - never divide server-side registrations (lifecycle) by first-party visitors.",
    ],
    windowKind: "flow",
  },
  {
    id: "registered_to_paid_rate",
    labelPl: "Konwersja rejestracji na płatność",
    labelEn: "Registered-to-paid rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja zarejestrowanych na płacących (R2P): konta zarejestrowane w oknie, które dokonały pierwszej płatności (subskrypcja albo plan jednorazowy) ÷ wszystkie konta zarejestrowane w oknie. Brak wartości, gdy w oknie nikt się nie zarejestrował.",
    definitionEn:
      "Registered-to-paid rate (R2P): accounts registered in the window that made a first payment (subscription or one-off plan) ÷ all accounts registered in the window. Undefined when nobody registered in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "account",
        "admin_revenue_funnel.registered_to_paid_rate",
        "COUNT(accounts registered in the window with a first paid live order) ÷ COUNT(accounts registered in the window)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Young cohorts have had little time to pay - compare R2P only between windows of equal age, or use the twelve-month cohort figure.",
    ],
    windowKind: "cohort",
  },
  {
    id: "paywall_conversion_rate",
    labelPl: "Konwersja paywalla",
    labelEn: "Paywall conversion rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja paywalla (PSCR): konta, które po trafieniu na paywall kupiły płatny dostęp w oknie ÷ konta, które w oknie trafiły na paywall. Brak wartości, gdy w oknie nikt nie trafił na paywall.",
    definitionEn:
      "Paywall conversion rate (PSCR): accounts that bought paid access after hitting the paywall in the window ÷ accounts that hit the paywall in the window. Undefined when nobody hit the paywall in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "account",
        "admin_revenue_funnel.paywall_conversion_rate",
        "COUNT(paywall_hit_accounts followed by a paid live order) ÷ COUNT(paywall_hit_accounts)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Anonymous paywall views are outside this population - pair PSCR with the paywall hit rate, never with first-party paywall impressions.",
    ],
    windowKind: "flow",
  },
  {
    id: "paywall_hit_rate",
    labelPl: "Zasięg paywalla",
    labelEn: "Paywall hit rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Zasięg paywalla (PHR): konta, które w oknie co najmniej raz trafiły na paywall albo płatną ofertę ÷ wszystkie aktywne konta w oknie. Brak wartości, gdy w oknie nie było aktywnych kont.",
    definitionEn:
      "Paywall hit rate (PHR): accounts that met the paywall or a paid offer at least once in the window ÷ all active accounts in the window. Undefined when the window has no active account.",
    bindings: [
      authoritative(
        "lifecycle",
        "account",
        "admin_revenue_funnel.paywall_hit_rate",
        "COUNT(DISTINCT paywall_hits.user_id) ÷ COUNT(active accounts) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Higher is not better: too few hits starve conversion and too many push readers away - read it as a range, against PSCR.",
    ],
    windowKind: "flow",
  },
  {
    id: "trial_to_paid_rate",
    labelPl: "Konwersja okresu próbnego",
    labelEn: "Trial-to-paid rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja okresu próbnego (T2P): okresy próbne zakończone w oknie pierwszą płatnością ÷ wszystkie okresy próbne zakończone w oknie. Brak wartości, gdy w oknie nie zakończył się żaden okres próbny.",
    definitionEn:
      "Trial-to-paid rate (T2P): trials ending in the window with a first payment ÷ all trials ending in the window. Undefined when no trial ended in the window.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_semantic_snapshot.trial_to_paid_rate",
        "COUNT(trialing → active with a paid invoice) ÷ COUNT(trials ended) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Card-required and card-free trials convert on different scales - never pool them into one rate.",
    ],
    windowKind: "flow",
  },
  {
    id: "checkout_conversion_rate",
    labelPl: "Konwersja kasy",
    labelEn: "Checkout conversion rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja kasy (CCR): płatności rozpoczęte w oknie i zakończone sukcesem ÷ wszystkie płatności rozpoczęte w oknie (zamówienia z kasy, środowisko live). Brak wartości, gdy w oknie nie rozpoczęto żadnej płatności.",
    definitionEn:
      "Checkout conversion rate (CCR): checkouts started in the window that ended in a successful payment ÷ all checkouts started in the window (live checkout orders). Undefined when no checkout started in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "account",
        "admin_revenue_funnel.checkout_conversion_rate",
        "checkout_paid ÷ checkout_started (live payment_orders created in the window)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "CCR and checkout abandonment must sum to 100 % on the same window - if they do not, one side counts a different population.",
    ],
    windowKind: "flow",
  },
  {
    id: "checkout_abandonment_rate",
    labelPl: "Porzucenie kasy",
    labelEn: "Checkout abandonment rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Porzucenie kasy (CAR): płatności rozpoczęte w oknie, które nie zakończyły się sukcesem ÷ wszystkie płatności rozpoczęte w oknie; dopełnienie konwersji kasy do 100 %. Brak wartości, gdy w oknie nie rozpoczęto żadnej płatności.",
    definitionEn:
      "Checkout abandonment rate (CAR): checkouts started in the window that did not end in a successful payment ÷ all checkouts started in the window; the complement of checkout conversion. Undefined when no checkout started in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "account",
        "admin_revenue_funnel.checkout_abandonment_rate",
        "1 − checkout_paid ÷ checkout_started (live payment_orders created in the window)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Event and e-commerce abandonment benchmarks measure a basket, not a subscription checkout - pick the subscription context before judging.",
    ],
    windowKind: "flow",
  },
  {
    id: "pricing_page_conversion_rate",
    labelPl: "Konwersja strony cennika",
    labelEn: "Pricing page conversion rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja strony cennika (PPCR): sesje z wyświetleniem cennika (pricing_view), w których wysłano formularz kasy (checkout_submit) ÷ wszystkie sesje z wyświetleniem cennika, w populacji ze zgodą analityczną. Brak wartości, gdy w oknie nikt nie oglądał cennika.",
    definitionEn:
      "Pricing page conversion rate (PPCR): sessions with a pricing view (pricing_view) that went on to submit the checkout form (checkout_submit) ÷ all sessions with a pricing view, within the analytics-consent population. Undefined when nobody viewed pricing in the window.",
    bindings: [
      authoritative(
        "first_party",
        "tab_session",
        "count(distinct session_id) with pricing_view then checkout_submit / count(distinct session_id) with pricing_view",
        "COUNT(DISTINCT session_id) with pricing_view followed by checkout_submit ÷ COUNT(DISTINCT session_id) with pricing_view",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "This is checkout intent inside one consented session, not a paid conversion - payments live in the lifecycle stream and never share this denominator.",
    ],
    windowKind: "flow",
  },
  {
    id: "signup_form_conversion_rate",
    labelPl: "Konwersja formularza zapisu",
    labelEn: "Signup form conversion rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja formularza zapisu (SFCR): zapisy na newsletter wysłane z formularzy i okienek ÷ wyświetlenia tych formularzy w oknie. Brak wartości, gdy w oknie żaden formularz się nie wyświetlił.",
    definitionEn:
      "Signup form conversion rate (SFCR): newsletter signups submitted from forms and popups ÷ views of those forms in the window. Undefined when no form was shown in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "anonymous_event",
        "admin_revenue_funnel.signup_form_submits / signup_form_views",
        "COUNT(newsletter_popup_events submit) ÷ COUNT(newsletter_popup_events view) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A submitted form is not a confirmed subscriber - double opt-in losses belong to the DOI confirmation rate, not here.",
    ],
    windowKind: "flow",
  },

  // --- EKONOMIKA (7) ----------------------------------------------------------
  {
    id: "ltv",
    labelPl: "LTV",
    labelEn: "LTV",
    unit: "money_minor",
    aggregation: "ratio",
    definitionPl:
      "Wartość życiowa klienta (LTV): miesięczne ARPU netto × marża brutto subskrypcji ÷ miesięczny churn klientów, osobno dla każdej waluty. Brak wartości, gdy w danych wejściowych brakuje marży albo churn wynosi zero.",
    definitionEn:
      "Customer lifetime value (LTV): monthly net ARPU × subscription gross margin ÷ monthly logo churn, per currency. Undefined when the gross margin input is missing or churn is zero.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_economics.ltv",
        "arpu × subscription_gross_margin ÷ logo_churn_monthly, per month and currency (margin from revenue_manual_inputs)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Zero churn makes LTV infinite - never display it; a young base with no churn yet has no LTV.",
    ],
    currencyBound: true,
    windowKind: "flow",
  },
  {
    id: "cac",
    labelPl: "CAC",
    labelEn: "CAC",
    unit: "money_minor",
    aggregation: "ratio",
    definitionPl:
      "Koszt pozyskania klienta (CAC): koszty marketingu i sprzedaży przypisane do pozyskania w oknie (z danych wejściowych) ÷ nowi płacący klienci w oknie, osobno dla każdej waluty kosztów. Brak wartości, gdy brakuje kosztów albo nie pozyskano żadnego klienta.",
    definitionEn:
      "Customer acquisition cost (CAC): acquisition-attributed marketing and sales costs in the window (from manual inputs) ÷ new paying customers in the window, per cost currency. Undefined when costs are missing or no customer was acquired.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_economics.cac",
        "acquisition costs (revenue_manual_inputs) ÷ COUNT(new paying accounts) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A missing cost input is not a zero cost - an empty month must show no CAC rather than a perfect one.",
    ],
    currencyBound: true,
    windowKind: "flow",
  },
  {
    id: "new_cac_ratio",
    labelPl: "New CAC Ratio",
    labelEn: "New CAC Ratio",
    unit: "multiple",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik New CAC Ratio: koszty sprzedaży i marketingu w oknie ÷ nowy ARR od nowych klientów w tym oknie (ile wydano na jednostkę nowego ARR). Brak wartości, gdy brakuje kosztów albo nowy ARR wynosi zero.",
    definitionEn:
      "New CAC Ratio: sales and marketing costs in the window ÷ new ARR from new customers in that window (spend per unit of new ARR). Undefined when costs are missing or new ARR is zero.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_economics.new_cac_ratio",
        "S&M costs (revenue_manual_inputs) ÷ (movements.new × 12) in the window, same currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Costs and new ARR must be in the same currency - a ratio across currencies is meaningless without a dated exchange rate.",
    ],
    windowKind: "flow",
  },
  {
    id: "ltv_cac_ratio",
    labelPl: "Relacja LTV do CAC",
    labelEn: "LTV to CAC ratio",
    unit: "multiple",
    aggregation: "ratio",
    definitionPl:
      "Relacja LTV do CAC: wartość życiowa klienta (na marży brutto) ÷ koszt jego pozyskania, w tej samej walucie i tym samym oknie. Brak wartości, gdy brakuje LTV albo CAC.",
    definitionEn:
      "LTV to CAC ratio: customer lifetime value (on gross margin) ÷ the cost of acquiring that customer, in one currency and one window. Undefined when LTV or CAC is undefined.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_economics.ltv_cac_ratio",
        "ltv ÷ cac, same currency and month",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Very high LTV/CAC usually means under-investment in growth, not efficiency - read it as a range, not as higher-is-better.",
    ],
    windowKind: "flow",
  },
  {
    id: "cac_payback_months",
    labelPl: "Zwrot CAC (miesiące)",
    labelEn: "CAC payback (months)",
    unit: "months",
    aggregation: "ratio",
    definitionPl:
      "Okres zwrotu CAC: koszt pozyskania klienta ÷ (miesięczne ARPU × marża brutto), czyli liczba miesięcy marży potrzebna do odzyskania kosztu pozyskania. Brak wartości, gdy brakuje CAC albo marży.",
    definitionEn:
      "CAC payback period: customer acquisition cost ÷ (monthly ARPU × gross margin), i.e. the months of margin needed to earn back the acquisition cost. Undefined when CAC or margin is missing.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_economics.cac_payback_months",
        "cac ÷ (arpu × subscription_gross_margin), same currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Payback longer than the typical customer lifetime means acquisition never pays back - check it against monthly churn.",
    ],
    windowKind: "flow",
  },
  {
    id: "subscription_gross_margin",
    labelPl: "Marża brutto subskrypcji",
    labelEn: "Subscription gross margin",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Marża brutto subskrypcji: (przychód z subskrypcji netto − koszty bezpośrednie obsługi: opłaty płatnicze, infrastruktura, dostarczanie treści) ÷ przychód z subskrypcji netto w oknie. Brak wartości, gdy w danych wejściowych brakuje kosztów bezpośrednich.",
    definitionEn:
      "Subscription gross margin: (net subscription revenue − direct service costs: payment fees, infrastructure, content delivery) ÷ net subscription revenue in the window. Undefined when direct costs are missing from the manual inputs.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_economics.subscription_gross_margin",
        "(recurring net revenue − direct costs from revenue_manual_inputs) ÷ recurring net revenue",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Editorial salaries are an operating cost, not a direct service cost - including them understates gross margin against every benchmark.",
    ],
    windowKind: "flow",
  },
  {
    id: "rule_of_40",
    labelPl: "Reguła 40",
    labelEn: "Rule of 40",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Reguła 40 (R40): roczna dynamika ARR (%) plus marża EBITDA (%) za te same 12 miesięcy; suma co najmniej 40 punktów oznacza zdrowy kompromis wzrostu i rentowności. Brak wartości, gdy brakuje marży EBITDA albo ARR sprzed roku.",
    definitionEn:
      "Rule of 40 (R40): year-over-year ARR growth (%) plus EBITDA margin (%) over the same twelve months; a sum of 40 points or more marks a healthy balance of growth and profitability. Undefined when the EBITDA margin or last year's ARR is missing.",
    bindings: [
      authoritative(
        "billing",
        "account",
        "admin_revenue_economics.rule_of_40",
        "ARR growth YoY + EBITDA margin (revenue_manual_inputs), both as fractions",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Both terms must cover the same twelve months - mixing a quarterly growth rate with an annual margin breaks the rule.",
    ],
    windowKind: "flow",
  },

  // --- E-MAIL (12) ------------------------------------------------------------
  {
    id: "email_open_rate",
    labelPl: "Wskaźnik otwarć newslettera",
    labelEn: "Newsletter open rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik otwarć (OR): unikalni odbiorcy, którzy otworzyli kampanię wysłaną w oknie ÷ wiadomości doręczone (wysłane minus odbicia). Brak wartości, gdy w oknie nie doręczono żadnej wiadomości.",
    definitionEn:
      "Open rate (OR): unique recipients who opened a campaign sent in the window ÷ delivered messages (sent minus bounces). Undefined when no message was delivered in the window.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.unique_opens / delivered",
        "COUNT(DISTINCT subscriber_id) opening ÷ delivered, campaigns sent in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Apple Mail Privacy Protection opens every message it downloads - open rates overstate human reading, so prefer the click rate for decisions.",
      "Since I9d-Y2 opens are recorded only for recipients with measurement consent while delivered counts everyone, so the rate understates reading - compare it only with periods after that release.",
    ],
    windowKind: "flow",
  },
  {
    id: "email_ctr_delivered",
    labelPl: "CTR newslettera (od doręczonych)",
    labelEn: "Newsletter CTR (delivered)",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Współczynnik klikalności od doręczonych (CTR): unikalni odbiorcy, którzy kliknęli link w kampanii wysłanej w oknie ÷ wiadomości doręczone. W odróżnieniu od CTOR mianownikiem są doręczenia, nie otwarcia. Brak wartości, gdy nic nie doręczono.",
    definitionEn:
      "Click-through rate on delivered (CTR): unique recipients who clicked a link in a campaign sent in the window ÷ delivered messages. Unlike CTOR the denominator is deliveries, not opens. Undefined when nothing was delivered.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.unique_clicks / delivered",
        "COUNT(DISTINCT subscriber_id) clicking ÷ delivered, campaigns sent in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Security scanners click links on delivery - remove bot clicks before comparing CTR with industry figures.",
      "Since I9d-Y2 clicks are recorded only for recipients with measurement consent while the denominator still counts every delivery, so the rate is a lower bound.",
    ],
    windowKind: "flow",
  },
  {
    id: "email_unsubscribe_rate",
    labelPl: "Wskaźnik wypisów",
    labelEn: "Unsubscribe rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik wypisów (UR): wypisy z listy przypisane do kampanii wysłanych w oknie ÷ wiadomości doręczone w tych kampaniach. Brak wartości, gdy nic nie doręczono.",
    definitionEn:
      "Unsubscribe rate (UR): list unsubscribes attributed to campaigns sent in the window ÷ messages delivered by those campaigns. Undefined when nothing was delivered.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.unsubscribes / delivered",
        "COUNT(unsubscribes attributed to campaigns sent in the window) ÷ delivered",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Unsubscribes made through the mailbox provider's list-unsubscribe header count too - omitting them understates the rate.",
    ],
    windowKind: "flow",
  },
  {
    id: "email_hard_bounce_rate",
    labelPl: "Odbicia twarde",
    labelEn: "Hard bounce rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik odbić twardych (HBR): wiadomości odrzucone trwale (adres nie istnieje, domena nie przyjmuje poczty) ÷ wiadomości wysłane w kampaniach z okna. Brak wartości, gdy w oknie nic nie wysłano.",
    definitionEn:
      "Hard bounce rate (HBR): messages rejected permanently (address does not exist, domain accepts no mail) ÷ messages sent by campaigns in the window. Undefined when nothing was sent in the window.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.hard_bounces / (delivered + hard_bounces + soft_bounces)",
        "hard_bounces ÷ sent, where sent = delivered + hard_bounces + soft_bounces",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A hard-bounced address must be suppressed after the first bounce - a rate that does not fall after cleaning means suppression is broken.",
    ],
    windowKind: "flow",
  },
  {
    id: "email_soft_bounce_rate",
    labelPl: "Odbicia miękkie",
    labelEn: "Soft bounce rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik odbić miękkich (SBR): wiadomości odrzucone przejściowo (pełna skrzynka, chwilowa awaria serwera odbiorcy) ÷ wiadomości wysłane w kampaniach z okna. Brak wartości, gdy w oknie nic nie wysłano.",
    definitionEn:
      "Soft bounce rate (SBR): messages rejected temporarily (full mailbox, transient receiving-server failure) ÷ messages sent by campaigns in the window. Undefined when nothing was sent in the window.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.soft_bounces / (delivered + hard_bounces + soft_bounces)",
        "soft_bounces ÷ sent, where sent = delivered + hard_bounces + soft_bounces",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Repeated soft bounces to one address are a hard bounce in disguise - escalate after several consecutive failures rather than retrying forever.",
    ],
    windowKind: "flow",
  },
  {
    id: "email_spam_complaint_rate",
    labelPl: "Zgłoszenia spamu",
    labelEn: "Spam complaint rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik zgłoszeń spamu (SCR): zgłoszenia „to jest spam” od odbiorców kampanii z okna ÷ wiadomości doręczone do skrzynki odbiorczej. Brak wartości, gdy nic nie doręczono.",
    definitionEn:
      "Spam complaint rate (SCR): 'this is spam' reports from recipients of campaigns in the window ÷ messages delivered to the inbox. Undefined when nothing was delivered.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.complaints / delivered",
        "complaints (feedback loops) ÷ delivered",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Mailbox providers throttle bulk senders whose complaint rate crosses their ceiling - one bad campaign then delays delivery of every later one.",
    ],
    windowKind: "flow",
  },
  {
    id: "newsletter_list_growth_rate",
    labelPl: "Wzrost listy newslettera",
    labelEn: "Newsletter list growth rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wzrost listy netto (LGR): (nowe potwierdzone zapisy − wypisy − adresy usunięte po odbiciach i skargach) w oknie ÷ aktywni subskrybenci na początku okna. Brak wartości, gdy lista na początku okna była pusta.",
    definitionEn:
      "Net list growth rate (LGR): (new confirmed signups − unsubscribes − addresses removed after bounces and complaints) in the window ÷ active subscribers at window start. Undefined when the list was empty at window start.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.list_net_growth / list_base",
        "list_net_growth ÷ list_base (active subscribers at p_since)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Imported contacts are not growth - list imports without fresh consent must stay out of new signups.",
    ],
    windowKind: "flow",
  },
  {
    id: "doi_confirmation_rate",
    labelPl: "Potwierdzenia double opt-in",
    labelEn: "Double opt-in confirmation rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja potwierdzenia zapisu (DOI): zapisy rozpoczęte w oknie i potwierdzone kliknięciem w link w ciągu 7 dni ÷ wszystkie zapisy rozpoczęte w oknie, które wymagały potwierdzenia. Brak wartości, gdy w oknie nie rozpoczęto żadnego zapisu.",
    definitionEn:
      "Double opt-in confirmation rate (DOI): signups started in the window and confirmed by clicking the link within 7 days ÷ all signups started in the window that required confirmation. Undefined when no signup started in the window.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.doi_confirmed / doi_started",
        "COUNT(confirmed within 7 days) ÷ COUNT(signups requiring confirmation started in the window)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Signups from the last 7 days of the window are still pending - read the rate one week after the window closes.",
    ],
    windowKind: "cohort",
  },
  {
    id: "email_disaffection_rate",
    labelPl: "Wskaźnik zniechęcenia",
    labelEn: "Disaffection rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik zniechęcenia (DR): (wypisy + zgłoszenia spamu + odbicia) ÷ unikalne kliknięcia w kampaniach z okna, czyli ile reakcji negatywnych przypada na jedną pozytywną. Brak wartości, gdy w oknie nie było kliknięć.",
    definitionEn:
      "Disaffection rate (DR): (unsubscribes + spam complaints + bounces) ÷ unique clicks in campaigns of the window - negative reactions per positive one. Undefined when the window has no clicks.",
    bindings: [
      authoritative(
        "newsletter",
        "email_recipient",
        "admin_revenue_email_health.(unsubscribes + complaints + hard_bounces + soft_bounces) / unique_clicks",
        "(unsubscribes + complaints + hard_bounces + soft_bounces) ÷ unique_clicks",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "The denominator is clicks, so a campaign without links has no disaffection rate at all - compare only campaigns that carry a call to action.",
    ],
    windowKind: "flow",
  },
  {
    id: "journey_open_rate",
    labelPl: "Otwarcia e-maili ścieżek",
    labelEn: "Journey email open rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik otwarć e-maili ścieżek automatycznych (powitalna, porzucona kasa i podobne): unikalne otwarcia ÷ doręczone e-maile kroków ścieżek wysłane w oknie. Brak wartości, gdy w oknie żadna ścieżka niczego nie doręczyła.",
    definitionEn:
      "Open rate of automated journey emails (welcome, abandoned checkout and similar): unique opens ÷ delivered journey-step emails sent in the window. Undefined when no journey delivered anything in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "crm_contact",
        "journey_message_events (open) / delivered journey-step emails",
        "COUNT(DISTINCT enrolment) opening ÷ COUNT(delivered journey emails) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Journey emails are triggered by intent, so they open far above campaigns - never benchmark a journey against campaign open rates.",
      "Since I9d-Y2 journey emails carry the pixel only for contacts with measurement consent, yet the denominator counts every delivered step email - read the rate as a lower bound.",
    ],
    windowKind: "per_journey",
  },
  {
    id: "journey_click_rate",
    labelPl: "Kliknięcia e-maili ścieżek",
    labelEn: "Journey email click rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik kliknięć e-maili ścieżek automatycznych: unikalne kliknięcia ÷ doręczone e-maile kroków ścieżek wysłane w oknie. Brak wartości, gdy w oknie żadna ścieżka niczego nie doręczyła.",
    definitionEn:
      "Click rate of automated journey emails: unique clicks ÷ delivered journey-step emails sent in the window. Undefined when no journey delivered anything in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "crm_contact",
        "journey_message_events (click) / delivered journey-step emails",
        "COUNT(DISTINCT enrolment) clicking ÷ COUNT(delivered journey emails) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Compare each journey step with the same step of earlier versions - a pooled rate hides a weak step behind a strong welcome email.",
      "Since I9d-Y2 journey links carry a message token only for contacts with measurement consent; unmeasured clicks are missing from the numerator but present in the denominator.",
    ],
    windowKind: "per_journey",
  },
  {
    id: "journey_goal_rate",
    labelPl: "Cel ścieżek osiągnięty",
    labelEn: "Journey goal rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja ścieżek: uczestnicy ścieżek, którzy w oknie osiągnęli cel ścieżki (np. pierwsza płatność, rejestracja na wydarzenie) ÷ wszyscy uczestnicy, którym w oknie doręczono co najmniej jeden e-mail ścieżki. Brak wartości, gdy w oknie nie było takich uczestników.",
    definitionEn:
      "Journey goal rate: journey enrolments that reached the journey goal in the window (e.g. first payment, event registration) ÷ all enrolments that received at least one journey email in the window. Undefined when there were no such enrolments.",
    bindings: [
      authoritative(
        "lifecycle",
        "crm_contact",
        "journey_enrollments (goal reached) / enrolments with a delivered email",
        "COUNT(enrolments reaching the goal) ÷ COUNT(enrolments with a delivered email) in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "A goal reached is attributed, not caused - pair the rate with a holdout group before crediting the journey with the revenue.",
    ],
    windowKind: "per_journey",
  },

  // --- SPOŁECZNOŚĆ (10) -------------------------------------------------------
  {
    id: "event_ticket_revenue",
    labelPl: "Przychód z biletów",
    labelEn: "Ticket revenue",
    unit: "money_minor",
    aggregation: "sum",
    definitionPl:
      "Przychód z biletów: kwoty netto opłaconych biletów i pakietów na wydarzenia w oknie minus zwroty, osobno dla każdej waluty, tylko środowisko live. Brak wartości, gdy podsumowanie wydarzeń jest niedostępne albo rola nie widzi kwot.",
    definitionEn:
      "Ticket revenue: net amounts of paid event tickets and packages in the window minus refunds, per currency, live environment only. Undefined when the events summary is unavailable or the role cannot see amounts.",
    bindings: [
      authoritative(
        "community",
        "account",
        "admin_revenue_events_summary.by_currency[].ticket_revenue_net_minor",
        "Σ _event_revenue_net over events in the window, per currency",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Plan-included tickets (claims from a membership) carry no price - count them as attendance, never as zero-price revenue.",
    ],
    currencyBound: true,
    windowKind: "flow",
  },
  {
    id: "event_attendance_rate",
    labelPl: "Frekwencja na wydarzeniach",
    labelEn: "Event attendance rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Frekwencja (EAR): uczestnicy obecni na wydarzeniach w oknie (odprawa na miejscu albo dołączenie do transmisji) ÷ ważne rejestracje na te wydarzenia, bez anulowanych. Brak wartości, gdy w oknie nie było ważnych rejestracji.",
    definitionEn:
      "Event attendance rate (EAR): attendees present at events in the window (on-site check-in or joining the live stream) ÷ valid registrations for those events, excluding cancellations. Undefined when the window has no valid registration.",
    bindings: [
      authoritative(
        "community",
        "account",
        "admin_revenue_events_summary.attended / registrations",
        "attended ÷ registrations (event_registrations not cancelled) for events in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Attendance without check-in data is unknown, not zero - events that never recorded attendance must be left out of the rate.",
    ],
    windowKind: "flow",
  },
  {
    id: "no_show_rate",
    labelPl: "Nieobecności na wydarzeniach",
    labelEn: "No-show rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Wskaźnik nieobecności (NSR): ważne rejestracje na wydarzenia w oknie, których uczestnik się nie pojawił ÷ wszystkie ważne rejestracje na te wydarzenia; dopełnienie frekwencji. Brak wartości, gdy w oknie nie było ważnych rejestracji.",
    definitionEn:
      "No-show rate (NSR): valid registrations for events in the window whose holder never showed up ÷ all valid registrations for those events; the complement of attendance. Undefined when the window has no valid registration.",
    bindings: [
      authoritative(
        "community",
        "account",
        "admin_revenue_events_summary.no_show / registrations",
        "no_show ÷ registrations (event_registrations not cancelled) for events in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Free events run a structurally higher no-show than paid ones - compare like with like before calling a rate high.",
    ],
    windowKind: "flow",
  },
  {
    id: "event_registration_conversion",
    labelPl: "Konwersja strony wydarzenia",
    labelEn: "Event registration conversion",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja rejestracji na wydarzenie (RCR): sesje, które w oknie wysłały formularz rejestracji na wydarzenie ÷ sesje, które obejrzały stronę wydarzenia, w populacji ze zgodą analityczną. Brak wartości, gdy w oknie nikt nie oglądał stron wydarzeń.",
    definitionEn:
      "Event registration conversion (RCR): sessions that submitted an event registration form in the window ÷ sessions that viewed an event page, within the analytics-consent population. Undefined when nobody viewed an event page in the window.",
    bindings: [
      authoritative(
        "first_party",
        "tab_session",
        "count(distinct session_id) with an event registration submit / count(distinct session_id) with an event page view",
        "COUNT(DISTINCT session_id) submitting an event registration ÷ COUNT(DISTINCT session_id) viewing an event page",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Registrations themselves live in the community stream - dividing them by first-party page views mixes a contract population with a consented one.",
    ],
    windowKind: "flow",
  },
  {
    id: "club_application_acceptance",
    labelPl: "Akceptacja zgłoszeń do klubów",
    labelEn: "Club application acceptance",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Akceptacja zgłoszeń do klubów: zgłoszenia rozpatrzone w oknie z decyzją pozytywną ÷ wszystkie zgłoszenia rozpatrzone w oknie (przyjęte i odrzucone); oczekujące nie wchodzą do mianownika. Brak wartości, gdy w oknie nie rozpatrzono żadnego zgłoszenia.",
    definitionEn:
      "Club application acceptance: applications decided in the window with a positive decision ÷ all applications decided in the window (accepted plus rejected); pending ones stay out of the denominator. Undefined when no application was decided in the window.",
    bindings: [
      authoritative(
        "community",
        "account",
        "admin_revenue_clubs_summary.applications.accepted / (accepted + rejected)",
        "applications.accepted ÷ (applications.accepted + applications.rejected) decided in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Acceptance has no external benchmark - a club's admission policy sets it, so compare a club only with its own history.",
    ],
    windowKind: "flow",
  },
  {
    id: "club_decision_time",
    labelPl: "Czas decyzji o zgłoszeniu",
    labelEn: "Club decision time",
    unit: "hours",
    aggregation: "median",
    definitionPl:
      "Czas decyzji klubu: mediana godzin od złożenia zgłoszenia do decyzji (przyjęcie albo odrzucenie) dla zgłoszeń rozpatrzonych w oknie. Brak wartości, gdy w oknie nie rozpatrzono żadnego zgłoszenia.",
    definitionEn:
      "Club decision time: median hours from application to decision (acceptance or rejection) for applications decided in the window. Undefined when no application was decided in the window.",
    bindings: [
      authoritative(
        "community",
        "account",
        "admin_revenue_clubs_summary.decision_hours_median",
        "percentile_disc(0.5) of (decided_at − created_at) in hours over applications decided in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Applications still pending at the window end are excluded, so a backlog makes this median look faster than the wait applicants actually face.",
    ],
    windowKind: "flow",
  },
  {
    id: "club_active_member_rate",
    labelPl: "Aktywni członkowie klubów",
    labelEn: "Active club member rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Udział aktywnych członków (AMR): członkowie klubów, którzy w oknie wykonali co najmniej jedną aktywność (wpis, komentarz, udział w spotkaniu) ÷ wszyscy członkowie z aktywnym członkostwem na koniec okna. Brak wartości, gdy kluby nie mają członków.",
    definitionEn:
      "Active member rate (AMR): club members with at least one activity in the window (post, comment, meeting attendance) ÷ all members holding an active membership at the window end. Undefined when the clubs have no members.",
    bindings: [
      authoritative(
        "community",
        "account",
        "admin_revenue_clubs_summary.active_members / members",
        "active_members ÷ members (active memberships at p_until)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Reading a thread is not activity here - the rate counts contributions and attendance, so compare it only with benchmarks that exclude lurking.",
    ],
    windowKind: "flow",
  },
  {
    id: "club_contributor_rate",
    labelPl: "Współtwórcy w klubach",
    labelEn: "Club contributor rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Udział współtwórców (zasada 90-9-1): członkowie, którzy w oknie utworzyli wątek, odpowiedź albo komentarz lub wystąpili na spotkaniu ÷ aktywni członkowie klubów w oknie. Brak wartości, gdy w oknie nie było aktywnych członków.",
    definitionEn:
      "Contributor rate (the 90-9-1 rule): members who created a thread, reply or comment, or spoke at a meeting, in the window ÷ active club members in the window. Undefined when the window has no active member.",
    bindings: [
      authoritative(
        "community",
        "account",
        "admin_revenue_clubs_summary.contributors / active_members",
        "contributors ÷ active_members in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "The denominator is active members, not all members - dividing by the full roster mixes two different benchmarks.",
    ],
    windowKind: "flow",
  },
  {
    id: "dau_mau",
    labelPl: "DAU/MAU",
    labelEn: "DAU/MAU",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Lepkość dzienna (DAU/MAU): średnia dzienna liczba zalogowanych kont z co najmniej jednym odczytem treści ÷ liczba kont z odczytem w kroczących 30 dniach. Brak wartości, gdy w 30 dniach żadne zalogowane konto niczego nie przeczytało.",
    definitionEn:
      "Daily stickiness (DAU/MAU): average daily number of signed-in accounts with at least one content read ÷ accounts with a read over the trailing 30 days. Undefined when no signed-in account read anything in 30 days.",
    bindings: [
      authoritative(
        "content_views",
        "account",
        "avg daily count(distinct user_id) of signed-in post views / count(distinct user_id) over 30 days",
        "mean over days of COUNT(DISTINCT user_id) reading ÷ COUNT(DISTINCT user_id) reading in the trailing 30 days",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Anonymous readers have no account and cannot enter either side - this is stickiness of the signed-in audience only.",
    ],
    windowKind: "flow",
  },
  {
    id: "wau_mau",
    labelPl: "WAU/MAU",
    labelEn: "WAU/MAU",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Lepkość tygodniowa (WAU/MAU): średnia tygodniowa liczba zalogowanych kont z odczytem treści ÷ liczba kont z odczytem w kroczących 30 dniach. Brak wartości, gdy w 30 dniach żadne zalogowane konto niczego nie przeczytało.",
    definitionEn:
      "Weekly stickiness (WAU/MAU): average weekly number of signed-in accounts with a content read ÷ accounts with a read over the trailing 30 days. Undefined when no signed-in account read anything in 30 days.",
    bindings: [
      authoritative(
        "content_views",
        "account",
        "avg weekly count(distinct user_id) of signed-in post views / count(distinct user_id) over 30 days",
        "mean over weeks of COUNT(DISTINCT user_id) reading ÷ COUNT(DISTINCT user_id) reading in the trailing 30 days",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "user_read_history keeps only the last read of each pair, so active days and weeks must be counted from view events, never from that state relation.",
    ],
    windowKind: "flow",
  },

  // --- CRM (5) ----------------------------------------------------------------
  {
    id: "lead_to_mql_rate",
    labelPl: "Konwersja lead → MQL",
    labelEn: "Lead-to-MQL rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja leadów na MQL: leady utworzone w oknie, które w ciągu 90 dni osiągnęły etap leada kwalifikowanego marketingowo (MQL) ÷ wszystkie leady utworzone w oknie. Brak wartości, gdy w oknie nie powstał żaden lead.",
    definitionEn:
      "Lead-to-MQL rate: leads created in the window that reached the marketing-qualified (MQL) stage within 90 days ÷ all leads created in the window. Undefined when no lead was created in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "crm_contact",
        "crm_lead_stage_history (stage mql reached within 90 days)",
        "COUNT(leads created in the window reaching mql within 90 days) ÷ COUNT(leads created in the window)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "MQL criteria are tenant-specific - a rate is comparable only while the qualification rule stays unchanged.",
    ],
    windowKind: "cohort",
  },
  {
    id: "mql_to_sql_rate",
    labelPl: "Konwersja MQL → SQL",
    labelEn: "MQL-to-SQL rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Konwersja MQL na SQL: leady, które w oknie osiągnęły etap MQL i w ciągu 90 dni zostały przyjęte przez sprzedaż jako SQL ÷ wszystkie leady, które w oknie osiągnęły etap MQL. Brak wartości, gdy w oknie żaden lead nie osiągnął etapu MQL.",
    definitionEn:
      "MQL-to-SQL rate: leads that reached MQL in the window and were accepted by sales as SQL within 90 days ÷ all leads that reached MQL in the window. Undefined when no lead reached MQL in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "crm_contact",
        "crm_lead_stage_history (mql → sql within 90 days)",
        "COUNT(leads reaching mql in the window, then sql within 90 days) ÷ COUNT(leads reaching mql in the window)",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Leads that skip MQL (direct sales intake) must not enter the numerator - otherwise the rate exceeds what qualification delivers.",
    ],
    windowKind: "cohort",
  },
  {
    id: "win_rate",
    labelPl: "Skuteczność zamknięć (win rate)",
    labelEn: "Win rate",
    unit: "ratio",
    aggregation: "ratio",
    definitionPl:
      "Skuteczność zamknięć: szanse wygrane ÷ szanse zamknięte w oknie (wygrane + przegrane, w tym „brak decyzji”). Szanse otwarte nie wchodzą do mianownika. Brak wartości, gdy w oknie nie zamknięto żadnej szansy.",
    definitionEn:
      "Win rate: opportunities won ÷ opportunities closed in the window (won + lost, including 'no decision'). Open opportunities stay out of the denominator. Undefined when no opportunity closed in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "crm_contact",
        "crm_lead_stage_history (won / closed in the window)",
        "COUNT(won) ÷ COUNT(won + lost + no decision) closed in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Leaving 'no decision' outcomes out of the denominator inflates the win rate - count every closed opportunity.",
    ],
    windowKind: "flow",
  },
  {
    id: "lead_response_time",
    labelPl: "Czas pierwszej reakcji na lead",
    labelEn: "Lead response time",
    unit: "hours",
    aggregation: "median",
    definitionPl:
      "Czas reakcji na lead (STL): mediana czasu od utworzenia leada do pierwszego kontaktu sprzedaży, w godzinach, dla leadów utworzonych w oknie. Brak wartości, gdy żaden lead z okna nie dostał jeszcze kontaktu.",
    definitionEn:
      "Lead response time (STL): median time from lead creation to the first sales contact, in hours, for leads created in the window. Undefined when no lead from the window has been contacted yet.",
    bindings: [
      authoritative(
        "lifecycle",
        "crm_contact",
        "crm_lead_stage_history first contact − crm_leads.created_at",
        "percentile_disc(0.5) of (first contact − created_at) in hours over leads created in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Uncontacted leads are excluded from the median, so a growing backlog makes response time look better - report the share still waiting next to it.",
    ],
    windowKind: "cohort",
  },
  {
    id: "sales_cycle_length",
    labelPl: "Długość cyklu sprzedaży",
    labelEn: "Sales cycle length",
    unit: "days",
    aggregation: "median",
    definitionPl:
      "Długość cyklu sprzedaży (SCL): mediana dni od utworzenia szansy do jej wygrania, dla szans wygranych w oknie. Brak wartości, gdy w oknie nie wygrano żadnej szansy.",
    definitionEn:
      "Sales cycle length (SCL): median days from opportunity creation to win, for opportunities won in the window. Undefined when no opportunity was won in the window.",
    bindings: [
      authoritative(
        "lifecycle",
        "crm_contact",
        "crm_lead_stage_history won_at − opportunity created_at",
        "percentile_disc(0.5) of (won_at − created_at) in days over opportunities won in the window",
      ),
    ],
    driftTolerance: 0,
    guards: [
      "Lost deals are excluded by definition - a shorter cycle can simply mean slow deals were dropped, so read it with the win rate.",
    ],
    windowKind: "flow",
  },
];

const METRIC_LIST: readonly MetricDefinition[] = [...BASE_METRIC_LIST, ...HUB_METRIC_LIST];

export const METRICS: readonly MetricDefinition[] = METRIC_LIST;

/**
 * 70 metryk huba w kolejności SPEC §5.5 (kolejność grup i pozycji w grupie).
 * Testy i słownik iterują po tej liście; reszta rejestru to metryki ruchu.
 */
export const HUB_METRIC_IDS: readonly MetricId[] = HUB_METRIC_LIST.map((m) => m.id);

/**
 * Grupa każdej metryki. Jawny literał `Record<MetricId, …>`, nie pole
 * definicji: nowa metryka bez grupy nie skompiluje się, a filtr słownika nie
 * może po cichu zgubić wiersza.
 */
export const METRIC_GROUP: Readonly<Record<MetricId, MetricGroup>> = {
  sessions: "traffic",
  visitors: "traffic",
  page_views: "traffic",
  content_views: "traffic",
  engagement_rate: "traffic",
  cta_clicks: "traffic",
  internal_searches: "traffic",
  lcp_p75: "traffic",
  inp_p75: "traffic",
  cls_p75: "traffic",
  ad_impressions: "traffic",
  ad_clicks: "traffic",
  ad_ctr: "traffic",
  email_opens: "email",
  email_clicks: "email",
  email_ctr: "email",
  related_clicks: "traffic",
  reads: "traffic",
  mrr: "revenue",
  arr: "revenue",
  arpa: "revenue",
  arpu: "revenue",
  active_subscriptions: "revenue",
  mrr_growth_mom: "revenue",
  net_new_mrr: "revenue",
  saas_quick_ratio: "revenue",
  expansion_share_new_mrr: "revenue",
  annual_plan_share: "revenue",
  revenue_realized: "revenue",
  price_realization: "revenue",
  average_discount: "revenue",
  coupon_redemption_rate: "revenue",
  logo_churn_monthly: "retention",
  logo_churn_annual: "retention",
  gross_revenue_churn: "retention",
  net_revenue_retention: "retention",
  gross_revenue_retention: "retention",
  involuntary_churn_share: "retention",
  dunning_recovery_rate: "retention",
  cancellation_save_rate: "retention",
  winback_rate_12m: "retention",
  returning_subscriber_share: "retention",
  cohort_retention_m1: "retention",
  cohort_retention_m3: "retention",
  cohort_retention_m12: "retention",
  visitor_to_registration_rate: "funnel",
  registered_to_paid_rate: "funnel",
  paywall_conversion_rate: "funnel",
  paywall_hit_rate: "funnel",
  trial_to_paid_rate: "funnel",
  checkout_conversion_rate: "funnel",
  checkout_abandonment_rate: "funnel",
  pricing_page_conversion_rate: "funnel",
  signup_form_conversion_rate: "funnel",
  ltv: "economics",
  cac: "economics",
  new_cac_ratio: "economics",
  ltv_cac_ratio: "economics",
  cac_payback_months: "economics",
  subscription_gross_margin: "economics",
  rule_of_40: "economics",
  email_open_rate: "email",
  email_ctr_delivered: "email",
  email_unsubscribe_rate: "email",
  email_hard_bounce_rate: "email",
  email_soft_bounce_rate: "email",
  email_spam_complaint_rate: "email",
  newsletter_list_growth_rate: "email",
  doi_confirmation_rate: "email",
  email_disaffection_rate: "email",
  journey_open_rate: "email",
  journey_click_rate: "email",
  journey_goal_rate: "email",
  event_ticket_revenue: "community",
  event_attendance_rate: "community",
  no_show_rate: "community",
  event_registration_conversion: "community",
  club_application_acceptance: "community",
  club_decision_time: "community",
  club_active_member_rate: "community",
  club_contributor_rate: "community",
  dau_mau: "community",
  wau_mau: "community",
  lead_to_mql_rate: "crm",
  mql_to_sql_rate: "crm",
  win_rate: "crm",
  lead_response_time: "crm",
  sales_cycle_length: "crm",
};

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
