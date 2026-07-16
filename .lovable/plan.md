## Cel

Nowa strona admina `/admin/analytics` z 4 zakładkami: **Przegląd**, **Google Analytics 4**, **Google Search Console**, **Wydajność (Web Vitals)** — z realnym podłączeniem kluczy Google.

## Architektura podłączeń

| Źródło | Metoda podłączenia | Uwagi |
|---|---|---|
| Google Search Console | Lovable Connector `google_search_console` (OAuth, gateway) | 1 klik "Połącz" — brak ręcznych kluczy |
| Google Analytics 4 (odczyt) | Service Account JSON + `GA4_PROPERTY_ID` (secrets) | GA4 Data API v1beta; brak connectora, więc BYOK |
| GA4 (tracking na froncie) | `VITE_GA4_MEASUREMENT_ID` w site_settings | już częściowo istnieje — dodać UI |
| Web Vitals | Lokalna tabela `web_vitals` (już jest) | agregacja p75 LCP/CLS/INP z ostatnich 7/28 dni |

## Zakres UI (`/admin/analytics`)

```text
┌──────────────────────────────────────────────────┐
│ Analityka i wydajność                            │
│ [Przegląd] [GA4] [Search Console] [Web Vitals]   │
├──────────────────────────────────────────────────┤
│ Karty statusu połączeń (GSC / GA4 / Vitals)     │
│  - stan: połączone / brak                        │
│  - przycisk "Połącz" lub "Rozłącz"               │
├──────────────────────────────────────────────────┤
│ Zakładka aktywna → wykresy + tabele              │
└──────────────────────────────────────────────────┘
```

**Przegląd**: 6 kafelków KPI (sesje 28d, użytkownicy, kliknięcia GSC, wyświetlenia GSC, CTR, śr. pozycja) + sparklines.

**GA4**: wybór zakresu dat, wykres sesji/dzień, top strony, top źródła, urządzenia (donut), kraje (tabela).

**Search Console**: wybór właściwości (`/webmasters/v3/sites`), wykres kliknięć+wyświetleń, top zapytania, top strony, URL Inspection dla wpisanego URL.

**Web Vitals**: p75 LCP/CLS/INP, rozkład per ścieżka, sygnalizacja "good/needs-improvement/poor" wg progów Google.

## Backend (TanStack server functions)

Nowe pliki w `src/lib/analytics/`:
- `gsc.functions.ts` — `listGscSites`, `queryGscAnalytics`, `inspectGscUrl` — przez connector gateway (`X-Connection-Api-Key: $GOOGLE_SEARCH_CONSOLE_API_KEY`).
- `ga4.functions.ts` — `runGa4Report`, `runGa4Realtime` — Google Analytics Data API v1beta, auth Service Account JWT (jose), secret `GA4_SERVICE_ACCOUNT_JSON` + `GA4_PROPERTY_ID`.
- `webvitals.functions.ts` — agregacja z `web_vitals` (SQL: percentyle, group by route, day).
- `analytics-status.functions.ts` — zwraca stan każdego źródła (klucze obecne / brak).

Wszystkie chronione `requireSupabaseAuth` + sprawdzenie roli admin przez `has_role`.

## Sekrety

- `GOOGLE_SEARCH_CONSOLE_API_KEY` — auto po `standard_connectors--connect`
- `GA4_SERVICE_ACCOUNT_JSON` — user paste (add_secret) po instrukcji jak wygenerować w GCP
- `GA4_PROPERTY_ID` — user paste
- `LOVABLE_API_KEY` — już jest

## Menu admina

Dodać do `AdminShell.tsx` w sekcji "Wydajność / SEO" pozycję:
`Analityka` → `/admin/analytics` z ikoną `BarChart3`.

## Bezpieczeństwo / i18n / atomic

- Wszystkie server fns z auth-middleware + kontrola roli admin
- PL/EN w plikach lokalizacji `src/i18n/locales/*/admin.json`
- Komponenty atomic: `src/components/admin/analytics/atoms|molecules|organisms`
- Zero `any`, semantic tokens z `styles.css`
- Odstępy ikon (jak przed chwilą) — spójne z resztą admina

## Kroki wdrożenia

1. Migracja: `analytics_connections_status` view (opcjonalne, może wystarczyć fetch_secrets)
2. Connector `google_search_console` — link
3. Server functions (4 pliki) + typed Zod inputy
4. Route `src/routes/admin.analytics.tsx` + `admin.analytics.$tab.tsx` (tabs jako parametr)
5. Komponenty: `ConnectionStatusCards`, `Ga4Panel`, `GscPanel`, `WebVitalsPanel`, `OverviewPanel`
6. Wpięcie w menu `AdminShell`
7. Tłumaczenia PL/EN
8. Testy: unit dla parserów GA4 response + integracyjny smoke test server fn (mock fetch)

## Poza zakresem (świadome pominięcia)

- Google Ads / Tag Manager (osobny etap)
- Custom eventów GA4 z builderа (kolejny etap)
- Bing/Yandex Webmaster (kolejny etap)

Potwierdź, aby wdrożyć — zacznę od connectora GSC + szkieletu strony, potem GA4 (poproszę o secret) i Web Vitals.