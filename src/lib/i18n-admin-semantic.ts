/**
 * Zasoby i18n warstwy semantycznej analityki (`adminAnalytics.semantic`).
 *
 * Osobny bundel, nie sekcja w `i18n-admin-analytics.ts`, z dwóch powodów:
 *   1. WŁASNOŚĆ - warstwa semantyczna trzyma swoje ciągi razem ze swoim kodem,
 *      więc dodanie werdyktu, powodu czy zastrzeżenia jest jedną zmianą w jednym
 *      module, a nie edycją wspólnego pliku analityki,
 *   2. PODZIAŁ BUNDLA - te ciągi są potrzebne WYŁĄCZNIE na zakładce uzgodnienia
 *      i w nagłówku dashboardu GA4, więc trafiają do własnego chunku
 *      (`i18n-admin-semantic`) rozliczanego jako kod wyłącznie adminowy, zamiast
 *      dopisywać się do bundla, który ładują wszystkie pozostałe dashboardy.
 *
 * Klucze werdyktów, powodów, zastrzeżeń okna, bramek zgody, ziaren tożsamości i
 * trybów deduplikacji są składane DYNAMICZNIE z kodów rejestru
 * (`src/lib/analytics/semantic`), więc brak tłumaczenia nie wywala builda -
 * użytkownik zobaczyłby surowy kod. Kompletność pokrycia pilnuje
 * `src/lib/__tests__/i18nSemanticAnalytics.test.ts`.
 */
import i18n from "@/lib/i18n";

export const semanticAnalyticsPl = {
  adminAnalytics: {
    semantic: {
      tabLabel: "Uzgodnienie",
      panelTitle: "Uzgodnienie liczb (warstwa semantyczna)",
      panelSubtitle:
        "Jedna definicja metryki, jedno okno, jedna liczba do raportu. Pozostałe strumienie potwierdzają lub sygnalizują rozjazd.",
      empty: "Brak danych w oknie - nie ma czego uzgadniać.",
      canonicalLabel: "Wartość kanoniczna",
      authoritative: "Źródło autorytatywne",
      corroborating: "Potwierdzające",
      spreadLabel: "Rozjazd",
      spreadNone: "brak porównania",
      deltaVsPrevious: "vs poprzednie okno",
      showDefinition: "Pokaż definicję",
      hideDefinition: "Ukryj definicję",
      noValue: "brak danych",
      samples: "{{count}} próbek",
      verdict: {
        aligned: "Zgodne",
        expected_drift: "Dryf oczekiwany",
        divergent: "Rozbieżność",
        order_inverted: "Relacja odwrócona",
        incomparable: "Nieporównywalne",
        single_source: "Jedno źródło",
        unavailable: "Brak wartości",
      },
      verdictHint: {
        aligned: "Strumienie o identycznej semantyce podają tę samą liczbę w granicach tolerancji.",
        expected_drift:
          "Przesunięcie wynika z konstrukcji strumieni (inne ziarno tożsamości lub deduplikacja) - nie ma czego naprawiać.",
        divergent:
          "Rozjazd przekracza pasmo tolerancji tej metryki. Sprawdź konfigurację jednego ze strumieni przed użyciem liczby w raporcie.",
        order_inverted:
          "Wielkości są odwrócone wobec konstrukcji strumieni. To sygnał błędnej konfiguracji, nie naturalnego dryfu.",
        incomparable:
          "Strumienie mierzą różne populacje albo okno nie pozwala na uczciwe porównanie.",
        single_source:
          "Tę metrykę potrafi policzyć tylko jeden strumień - nie ma z czym jej zderzyć.",
        unavailable:
          "Strumień autorytatywny nie zwrócił wartości - nie podstawiamy liczby zastępczej.",
      },
      reason: {
        consent_gate_mismatch:
          "Różne bramki zgody (analityka vs marketing) - to inne populacje odwiedzających.",
        grain_mismatch:
          "Różne ziarno tożsamości (np. sesja per karta vs sesja GA4) - przesunięcie jest systematyczne.",
        dedupe_mismatch: "Różny tryb deduplikacji zdarzeń między strumieniami.",
        window_not_cross_stream_safe:
          "Okno zawiera dzień, którego GA4 jeszcze nie domknęło - porównanie pokazałoby fałszywy deficyt.",
        beyond_tolerance: "Odchylenie przekracza pasmo tolerancji zapisane w definicji metryki.",
        expected_order_inverted: "Kolejność wielkości jest sprzeczna z konstrukcją strumieni.",
        missing_authoritative: "Strumień autorytatywny nie dostarczył liczby.",
        single_binding: "Metryka ma tylko jedno powiązanie w słowniku.",
        sample_too_small: "Za mały wolumen, żeby orzekać - szum przewyższa efekt strukturalny.",
      },
      window: {
        title: "Okno pomiaru",
        range: "{{since}} do {{until}}",
        previous: "Okno poprzednie",
        days: "{{count}} dni",
        grainDay: "pełne dni UTC",
        grainInstant: "okno kroczące",
        safe: "Porównywalne między strumieniami",
        unsafe: "Nieporównywalne między strumieniami",
        ga4Range: "Zakres GA4: {{start}} do {{end}}",
      },
      windowNotes: {
        ga4_property_timezone:
          "GA4 kubkuje dni w strefie czasowej property, nasze granice są w UTC - skrajne dni mogą być częściowe.",
        ga4_open_day:
          "Okno zawiera dzień bieżący, którego GA4 jeszcze nie domknęło - ostatni dzień zaniża.",
        instant_grain_not_available_in_ga4:
          "Okno godzinowe: GA4 nie ma takiej rozdzielczości, więc raportu z niego nie uzgadniamy.",
        excludes_open_day:
          "Dzień bieżący jest świadomie pominięty, żeby wszystkie strumienie liczyły pełne dni.",
        legacy_rpc_window_ends_now:
          "Starsze RPC liczą okno jako „teraz minus N dni”, więc ich granica różni się o część doby.",
      },
      streams: {
        title: "Strumienie w oknie",
        subtitle: "Czego w liczbach NIE MA - dostępność każdego z sześciu źródeł.",
        available: "Zbiera dane",
        not_configured: "Nie skonfigurowane",
        read_failed: "Odczyt nieudany",
        no_data: "Brak danych w oknie",
        gated: "Brak zdarzeń - możliwy brak zgody analitycznej",
        consentGate: "Bramka zgody",
        identityGrain: "Tożsamość",
        dedupe: "Deduplikacja",
        latency: "Opóźnienie",
        latencyRealtime: "czas rzeczywisty",
        latencyHours: "do {{count}} godz.",
        caveats: "Zastrzeżenia",
      },
      consentGate: {
        analytics: "analityka",
        marketing: "marketing",
        email_optin: "opt-in mailowy",
        none: "bez bramki",
      },
      identityGrain: {
        ga4_session: "sesja GA4",
        ga4_user: "użytkownik GA4",
        tab_session: "sesja per karta",
        browser_visitor: "przeglądarka",
        viewer_hash: "hash czytelnika",
        email_recipient: "odbiorca maila",
        anonymous_event: "zdarzenie anonimowe",
      },
      dedupe: {
        none: "brak",
        window: "okno {{minutes}} min",
        utc_day: "doba UTC (indeks unikalny)",
        upsert_last_wins: "UPSERT (stan)",
        vendor_sessionized: "sesjonizacja dostawcy",
      },
      dictionary: {
        title: "Słownik metryk kanonicznych",
        subtitle:
          "Jedna obowiązująca definicja na metrykę. Raport zarządczy cytuje wyłącznie źródło autorytatywne.",
        colMetric: "Metryka",
        colDefinition: "Definicja",
        colSource: "Źródło",
        colFormula: "Wzór",
        colGuards: "Czego nie wolno",
        unit: {
          count: "liczba",
          ratio: "wskaźnik",
          milliseconds: "ms",
          score: "wynik",
        },
      },
      ratios: {
        title: "Metryki złożone",
        subtitle:
          "Licznik i mianownik zawsze z tego samego strumienia - inaczej bramka zgody się nie skraca.",
        undefinedValue: "nieokreślone",
      },
      insights: {
        element: "Warstwa semantyczna",
        divergentTitle: "{{metric}}: rozjazd {{spread}} % między strumieniami",
        divergentDetail:
          "Wartość autorytatywna ({{stream}}) to {{value}}, ale strumień potwierdzający odbiega o {{spread}} %, czyli poza pasmo {{tolerance}} % zapisane w definicji metryki.",
        divergentFixes: [
          "Sprawdź, czy oba strumienie mierzą to samo okno - dashboardy pobierają je teraz z jednego resolwera, ale zewnętrzna konfiguracja GA4 (strefa property, filtry) może je jeszcze rozjeżdżać.",
          "Zweryfikuj filtry botów i wykluczenia ruchu wewnętrznego w GA4 - nadmiarowe wykluczenie zaniża liczbę autorytatywną.",
          "Do czasu wyjaśnienia cytuj w raporcie wyłącznie wartość autorytatywną i dołącz notę o rozjeździe.",
        ],
        invertedTitle: "{{metric}}: relacja strumieni odwrócona",
        invertedDetail:
          "GA4 filtruje boty i sesjonizuje po użytkowniku, więc nie może raportować WIĘCEJ niż nasz surowy licznik first-party. Odwrócona kolejność oznacza błąd konfiguracji jednego z nich.",
        invertedFixes: [
          "Sprawdź, czy beacon first-party nie jest blokowany (zgoda analityczna, rate limit ingestu, blokery treści).",
          "Sprawdź, czy tag GA4 nie jest wstrzyknięty dwukrotnie (GTM + kod własny) - podwaja odsłony.",
          "Porównaj liczbę zdarzeń w `analytics_events` z liczbą odsłon GA4 dla jednego dnia, żeby zlokalizować stronę różnicy.",
        ],
        windowTitle: "Okno nie pozwala na uczciwe porównanie strumieni",
        windowDetail:
          "Wybrane okno zawiera dzień jeszcze niedomknięty przez GA4 albo ma ziarno godzinowe. Liczby są poprawne osobno, ale ich zderzenie pokazałoby fałszywy deficyt po stronie GA4.",
        windowFixes: [
          "Do raportu zarządczego wybierz preset dobowy bez dnia bieżącego - warstwa semantyczna ustawia go domyślnie.",
          "Okno z dniem bieżącym traktuj jako podgląd operacyjny, nie jako źródło liczb do prezentacji.",
        ],
        ga4MissingTitle: "Brak strumienia autorytatywnego dla ruchu",
        ga4MissingDetail:
          "GA4 jest źródłem autorytatywnym dla sesji, użytkowników i odsłon. Bez niego raport może podać tylko liczby first-party, które z konstrukcji zawyżają (sesje per karta, brak filtrowania botów).",
        ga4MissingFixes: [
          "Podłącz GA4 (Service Account lub OAuth refresh) i ustaw GA4_PROPERTY_ID.",
          "Do tego czasu opisuj liczby first-party jako górne ograniczenie, nie jako ruch faktyczny.",
        ],
        alignedTitle: "Strumienie uzgodnione w tym oknie",
        alignedDetail:
          "Każda metryka kanoniczna ma jedno źródło autorytatywne, a strumienie potwierdzające mieszczą się w pasmach tolerancji. Liczby są gotowe do raportu.",
        alignedFixes: [
          "Cytując liczbę w raporcie, podaj obok nazwę strumienia autorytatywnego i granice okna.",
        ],
        gapTitle: "{{metric}}: brak liczby w tym oknie",
        gapDetail:
          "Strumień autorytatywny ({{stream}}) nie zwrócił wartości, więc metryka nie ma liczby. Wartość zastępcza nie jest podstawiana świadomie.",
        gapFixes: [
          "Sprawdź dostępność strumienia na liście powyżej - kod przyczyny wskazuje, czy to brak konfiguracji, błąd odczytu, czy pusty zbiór.",
        ],
      },
    },
  },
};

export const semanticAnalyticsEn = {
  adminAnalytics: {
    semantic: {
      tabLabel: "Reconciliation",
      panelTitle: "Reconciled figures (semantic layer)",
      panelSubtitle:
        "One definition per metric, one window, one number for the report. The remaining streams either confirm it or flag a divergence.",
      empty: "No data in this window - nothing to reconcile.",
      canonicalLabel: "Canonical value",
      authoritative: "Authoritative source",
      corroborating: "Corroborating",
      spreadLabel: "Spread",
      spreadNone: "no comparison",
      deltaVsPrevious: "vs previous window",
      showDefinition: "Show definition",
      hideDefinition: "Hide definition",
      noValue: "no data",
      samples: "{{count}} samples",
      verdict: {
        aligned: "Aligned",
        expected_drift: "Expected drift",
        divergent: "Divergent",
        order_inverted: "Order inverted",
        incomparable: "Not comparable",
        single_source: "Single source",
        unavailable: "No value",
      },
      verdictHint: {
        aligned: "Streams with identical semantics report the same number within tolerance.",
        expected_drift:
          "The offset follows from how the streams are built (different identity grain or deduplication) - nothing to fix.",
        divergent:
          "The spread exceeds this metric's tolerance band. Check one of the stream configurations before quoting the number.",
        order_inverted:
          "The magnitudes are inverted relative to how the streams are built. That signals a misconfiguration, not natural drift.",
        incomparable:
          "The streams measure different populations, or the window does not allow a fair comparison.",
        single_source:
          "Only one stream can produce this metric - there is nothing to cross-check it against.",
        unavailable: "The authoritative stream returned no value, and no substitute is filled in.",
      },
      reason: {
        consent_gate_mismatch:
          "Different consent gates (analytics vs marketing) - these are different visitor populations.",
        grain_mismatch:
          "Different identity grain (e.g. per-tab session vs GA4 session) - the offset is systematic.",
        dedupe_mismatch: "The streams deduplicate events differently.",
        window_not_cross_stream_safe:
          "The window includes a day GA4 has not closed yet - a comparison would show a false shortfall.",
        beyond_tolerance:
          "The deviation exceeds the tolerance band recorded in the metric definition.",
        expected_order_inverted: "The magnitude ordering contradicts how the streams are built.",
        missing_authoritative: "The authoritative stream produced no number.",
        single_binding: "The metric has only one binding in the dictionary.",
        sample_too_small: "Volume is too low to judge - noise outweighs any structural effect.",
      },
      window: {
        title: "Measurement window",
        range: "{{since}} to {{until}}",
        previous: "Previous window",
        days: "{{count}} days",
        grainDay: "whole UTC days",
        grainInstant: "rolling window",
        safe: "Comparable across streams",
        unsafe: "Not comparable across streams",
        ga4Range: "GA4 range: {{start}} to {{end}}",
      },
      windowNotes: {
        ga4_property_timezone:
          "GA4 buckets days in the property timezone while our bounds are UTC - the edge days can be partial.",
        ga4_open_day:
          "The window includes the current day, which GA4 has not closed yet - the last day understates.",
        instant_grain_not_available_in_ga4:
          "Hourly window: GA4 has no such resolution, so its report is not reconciled here.",
        excludes_open_day:
          "The current day is deliberately excluded so every stream counts whole days.",
        legacy_rpc_window_ends_now:
          "Legacy RPCs compute the window as 'now minus N days', so their bound differs by a fraction of a day.",
      },
      streams: {
        title: "Streams in this window",
        subtitle: "What the numbers do NOT contain - availability of each of the six sources.",
        available: "Collecting",
        not_configured: "Not configured",
        read_failed: "Read failed",
        no_data: "No data in window",
        gated: "No events - analytics consent may be missing",
        consentGate: "Consent gate",
        identityGrain: "Identity",
        dedupe: "Deduplication",
        latency: "Latency",
        latencyRealtime: "real time",
        latencyHours: "up to {{count}} h",
        caveats: "Caveats",
      },
      consentGate: {
        analytics: "analytics",
        marketing: "marketing",
        email_optin: "email opt-in",
        none: "no gate",
      },
      identityGrain: {
        ga4_session: "GA4 session",
        ga4_user: "GA4 user",
        tab_session: "per-tab session",
        browser_visitor: "browser",
        viewer_hash: "reader hash",
        email_recipient: "email recipient",
        anonymous_event: "anonymous event",
      },
      dedupe: {
        none: "none",
        window: "{{minutes}} min window",
        utc_day: "UTC day (unique index)",
        upsert_last_wins: "UPSERT (state)",
        vendor_sessionized: "vendor sessionization",
      },
      dictionary: {
        title: "Canonical metric dictionary",
        subtitle:
          "One binding definition per metric. A management report quotes the authoritative source only.",
        colMetric: "Metric",
        colDefinition: "Definition",
        colSource: "Source",
        colFormula: "Formula",
        colGuards: "Do not",
        unit: {
          count: "count",
          ratio: "ratio",
          milliseconds: "ms",
          score: "score",
        },
      },
      ratios: {
        title: "Composite metrics",
        subtitle:
          "Numerator and denominator always come from the same stream - otherwise the consent gate does not cancel out.",
        undefinedValue: "undefined",
      },
      insights: {
        element: "Semantic layer",
        divergentTitle: "{{metric}}: {{spread}} % spread between streams",
        divergentDetail:
          "The authoritative value ({{stream}}) is {{value}}, but the corroborating stream deviates by {{spread}} %, outside the {{tolerance}} % band recorded in the metric definition.",
        divergentFixes: [
          "Confirm both streams cover the same window - the dashboards now take it from one resolver, but external GA4 configuration (property timezone, filters) can still pull them apart.",
          "Review GA4 bot filtering and internal-traffic exclusions - an over-broad exclusion depresses the authoritative number.",
          "Until it is explained, quote only the authoritative value in the report and attach a note about the spread.",
        ],
        invertedTitle: "{{metric}}: stream order inverted",
        invertedDetail:
          "GA4 filters bots and sessionizes per user, so it cannot report MORE than our raw first-party counter. An inverted order means one of them is misconfigured.",
        invertedFixes: [
          "Check whether the first-party beacon is being blocked (analytics consent, ingest rate limit, content blockers).",
          "Check whether the GA4 tag is injected twice (GTM plus hand-rolled snippet) - that doubles page views.",
          "Compare the `analytics_events` count with GA4 page views for a single day to localise which side is off.",
        ],
        windowTitle: "This window does not allow a fair cross-stream comparison",
        windowDetail:
          "The selected window includes a day GA4 has not closed yet, or it uses hourly grain. The numbers are each correct, but comparing them would show a false GA4 shortfall.",
        windowFixes: [
          "For a management report pick a day-grain preset that excludes today - the semantic layer selects one by default.",
          "Treat a window that includes today as an operational preview, not as a source of figures for a presentation.",
        ],
        ga4MissingTitle: "No authoritative stream for traffic",
        ga4MissingDetail:
          "GA4 is the authoritative source for sessions, users and page views. Without it a report can only quote first-party numbers, which over-count by construction (per-tab sessions, no bot filtering).",
        ga4MissingFixes: [
          "Connect GA4 (service account or OAuth refresh) and set GA4_PROPERTY_ID.",
          "Until then, describe first-party numbers as an upper bound rather than actual traffic.",
        ],
        alignedTitle: "Streams reconciled in this window",
        alignedDetail:
          "Every canonical metric has a single authoritative source, and the corroborating streams sit inside their tolerance bands. The figures are report-ready.",
        alignedFixes: [
          "When quoting a number, state the authoritative stream and the window bounds next to it.",
        ],
        gapTitle: "{{metric}}: no number in this window",
        gapDetail:
          "The authoritative stream ({{stream}}) returned no value, so the metric has no number. A substitute is deliberately not filled in.",
        gapFixes: [
          "Check stream availability in the list above - the reason code tells you whether it is missing configuration, a failed read, or an empty set.",
        ],
      },
    },
  },
};

i18n.addResourceBundle("pl", "translation", semanticAnalyticsPl, true, true);
i18n.addResourceBundle("en", "translation", semanticAnalyticsEn, true, true);
