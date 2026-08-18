# Warstwa semantyczna analityki

**Status:** wdrożone (2026-07-25). Kontrakt kodu: `src/lib/analytics/semantic/`.

## 1. Problem, który to rozwiązuje

Platforma zbierała dane w **sześciu niezależnych strumieniach**:

| #   | Strumień              | Składowanie                                                     | Producent                                              |
| --- | --------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | GA4                   | GA4 Data API                                                    | `src/lib/analytics/ga4.functions.ts`                   |
| 2   | Zdarzenia first-party | `public.analytics_events`                                       | `src/lib/analytics/track.ts` → `/api/public/track`     |
| 3   | Web Vitals (RUM)      | `public.web_vitals`                                             | `src/lib/webVitals.ts` → `/api/public/vitals`          |
| 4   | Zdarzenia reklam      | `public.ad_events`                                              | `src/lib/analytics/events.ts` → `/api/public/ad-event` |
| 5   | Newsletter            | `public.newsletter_campaign_events`                             | `src/lib/newsletter/trackingEvents.server.ts`          |
| 6   | Odsłony treści        | `public.post_views`, `related_post_clicks`, `user_read_history` | `useRecordPostView`, `relatedClickBeacon`              |

Silnik insightów istniał (`InsightSection` + generatory per dashboard), ale **nie
było warstwy uzgadniającej definicje**. Skutek: ta sama nazwa metryki oznaczała
różne liczby na różnych zakładkach, a raport zarządczy nie miał jak stwierdzić,
która jest właściwa. Najostrzejsze przykłady, potwierdzone w kodzie:

- **„Odsłony” to trzy różne metryki.** GA4 `screenPageViews` (filtrowanie botów
  po stronie Google), `analytics_events.event_type = 'page_view'` (surowe, bez
  filtrowania) i wiersze `post_views` (dopiero po **1,5 s** obecności na stronie,
  z **deduplikacją 5 minut** na parę `(wpis, przeglądarka)` i **bez odsłon
  autora**). Trzy liczby, jedna etykieta.
- **Sesje first-party są sesjami PER KARTA.** `session_id` żyje w
  `sessionStorage`, więc jeden odwiedzający z trzema kartami generuje trzy sesje.
  Migracja opisywała tę kolumnę jako „anon session (24h)", co było nieprawdą w
  dwie strony (TTL to 30 min bezczynności, a zasięg to karta, nie przeglądarka).
- **Różne bramki zgody, jeden mianownik.** `ad_events` powstają po zgodzie
  **marketingowej**, odsłony po zgodzie **analitycznej**. Dzielenie jednych przez
  drugie (naturalny odruch przy liczeniu CTR) daje wskaźnik na dwóch różnych
  populacjach.
- **`user_read_history` to STAN, nie zdarzenie.** UPSERT na `(user_id, post_id)`
  oznacza, że `read_at` to _ostatnie_ przeczytanie pary. Liczba wierszy w oknie
  odpowiada na pytanie „ile par ostatnio czytano w tym oknie", a nie „ile było
  przeczytań" - dłuższe okno kończące się dziś może zwrócić MNIEJ wierszy niż
  krótsze.
- **Trzy różne „28 dni".** Web Vitals liczył `now - days * 86 400 000`
  (kroczące milisekundy UTC), GA4 dostawał `"28daysAgo"`/`"today"` (dni w strefie
  czasowej _property_, z niedomkniętym dniem bieżącym), a
  `related_posts_signals` używał `now() - make_interval(days => N)`.
- **Podwójnie liczony dzień graniczny.** GA4 dostawał okno bieżące
  `[28daysAgo, today]` i poprzednie `[56daysAgo, 28daysAgo]`. Oba przedziały są w
  GA4 **domknięte**, więc dzień „28 dni temu" wpadał do obu: baza porównawcza
  rosła o jeden dzień, a każda delta procentowa na kafelkach KPI była
  systematycznie zaniżona.
- **Dwie metody percentyla dla jednej metryki.** `web_vitals_daily_p75`
  używał `percentile_cont(0.75)` (interpolacja), a agregator w pamięci
  (`src/lib/observability/aggregate.ts`) - **nearest rank**. Komentarz w migracji
  twierdził, że jedno „mirrors" drugie. Nie mirrorowało: dla próbek
  1000/2000/3000/4000 interpolacja daje 3250 (wartość, której nikt nie zmierzył),
  a nearest rank 3000.
- **Otwarcia newslettera z DWÓCH producentów naraz.** `newsletter_campaign_events`
  nie miała żadnego indeksu unikalnego, a pisały do niej i własny piksel, i
  webhook dostawcy poczty - oba mierzące to samo tym samym mechanizmem. Otwarcie
  liczyło się dwa razy, więc wskaźnik otwarć potrafił przekroczyć **100%**.
  Domknięte 2026-08-14 (migracja `20260814150000`): strumień ma dziś
  `dedupe: "utc_day"` - jeden wiersz na `(kampania, subskrybent, rodzaj, doba
UTC)` egzekwowany indeksem unikalnym - i dokładnie jednego producenta
  (`NEWSLETTER_ENGAGEMENT_SOURCE`). Konsekwencja dla czytania liczb: wiersz to
  **dobo-odbiorca**, nie interakcja, więc o LUDZIACH mówi wyłącznie
  `COUNT(DISTINCT subscriber_id)`. Szczegóły: `docs/ARCHITECTURE.md` §11.6.

## 2. Architektura rozwiązania

```
src/lib/analytics/semantic/
├── streams.ts       # CO mierzy każdy strumień: bramka zgody, tożsamość,
│                    # deduplikacja, zegar, opóźnienie, limity, zastrzeżenia
├── metrics.ts       # słownik metryk kanonicznych; JEDNO źródło autorytatywne
│                    # na metrykę + reguły porównywalności + strażniki
├── window.ts        # JEDEN resolwer okna + tłumaczenie na format każdego
│                    # strumienia + rozłączne okno poprzednie
├── reconcile.ts     # uzgodnienie liczb i KLASYFIKACJA rozjazdu
├── format.ts        # formatowanie sterowane jednostką ze słownika
├── snapshot.functions.ts  # serwerowa migawka wszystkich strumieni dla 1 okna
└── index.ts         # kontrakt publiczny modułu
```

Warstwa prezentacji (atomic design, lokalnie w folderze funkcji - jak
`admin/builder/ui/`):

```
src/components/admin/analytics/semantic/
├── atoms/       VerdictBadge, StreamChip
├── molecules/   MetricDefinitionPopover, WindowProvenance,
│                ReconciliationRow, StreamHealthGrid
├── organisms/   SemanticReconciliationPanel, MetricDictionary
└── semanticInsights.ts   # generator wpisów dla istniejącej InsightSection
```

### 2.1. Trzy poziomy porównywalności

`comparabilityOf(a, b)` rozstrzyga, czy dwie liczby wolno w ogóle zestawiać:

| Poziom         | Warunek                                      | Znaczenie                                                           |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `equivalent`   | ta sama bramka zgody, ziarno i deduplikacja  | liczby POWINNY się zgadzać (wąska tolerancja)                       |
| `analogous`    | ta sama bramka, inne ziarno lub deduplikacja | przesunięcie jest OCZEKIWANE - sprawdzamy rząd wielkości i kierunek |
| `incomparable` | różne bramki zgody                           | różne populacje, żadna arytmetyka między nimi nie ma sensu          |

### 2.2. Werdykty uzgodnienia

`reconcileMetric` zwraca jedną wartość kanoniczną (ze strumienia
autorytatywnego - **nigdy średnią**) plus werdykt:

| Werdykt          | Kiedy                                                 | Czy wymaga reakcji |
| ---------------- | ----------------------------------------------------- | ------------------ |
| `aligned`        | powiązania równoważne, w tolerancji                   | nie                |
| `expected_drift` | powiązania analogiczne, w tolerancji                  | nie                |
| `single_source`  | metrykę liczy tylko jeden strumień                    | nie                |
| `incomparable`   | różne bramki zgody albo okno niezdatne do porównań    | nie                |
| `divergent`      | odchylenie poza pasmem tolerancji metryki             | **tak**            |
| `order_inverted` | kolejność wielkości sprzeczna z konstrukcją strumieni | **tak**            |
| `unavailable`    | strumień autorytatywny nie zwrócił liczby             | informacyjnie      |

`order_inverted` to najmocniejszy sygnał w całej warstwie. GA4 filtruje boty i
sesjonizuje po użytkowniku, więc **nie może** raportować więcej odsłon niż nasz
surowy licznik first-party. Jeśli raportuje - to nie dryf, to błąd konfiguracji
(np. tag GA4 wstrzyknięty dwukrotnie przez GTM i kod własny, albo zablokowany
beacon first-party).

### 2.3. Kanoniczne okno czasowe

`resolveWindow({ presetId })` zwraca jedno okno wraz z tłumaczeniem na format
każdego strumienia:

- granice **przycięte do pełnych dni UTC**, żeby Postgres i GA4 pytały o te same
  dni kalendarzowe,
- **dzień bieżący domyślnie pominięty** (`excludes_open_day`) - GA4 go nie
  domknęło, więc jego uwzględnienie zawsze pokazywałoby fałszywy deficyt po
  stronie GA4,
- zakres dat dla GA4 wyprowadzony z **tych samych instantów** co granice ISO,
  nigdy z osobnego napisu `NdaysAgo`,
- `previousWindow()` daje okno tej samej długości, **rozłączne** z bieżącym
  (koniec dokładnie milisekundę przed początkiem bieżącego),
- `crossStreamSafe` mówi wprost, czy na tym oknie wolno uzgadniać liczby; preset
  `24h` (kroczący) i okna z dniem otwartym mają `false`, a `reconcile` odmawia
  wtedy orzekania o rozjeździe zamiast raportować fałszywą rozbieżność,
- nieusuwalne różnice są **deklarowane** jako `WindowNote` (np.
  `ga4_property_timezone` - GA4 kubkuje dni w strefie property, nasze granice są
  w UTC) i pokazywane adminowi w `WindowProvenance`.

### 2.4. Strażnik metryk złożonych

`safeRatio` odmawia wyliczenia wskaźnika, gdy licznik i mianownik pochodzą z
różnych strumieni - wtedy bramka zgody się nie skraca. Zwraca też `null`, nie
`0`, przy zerowym mianowniku: „0 %" w raporcie czyta się jako „nikt nie
kliknął", a nie „nie ma podstawy do wyliczenia".

```ts
safeRatio({ metricId: "ad_clicks", ... }, { metricId: "ad_impressions", ... }); // OK
safeRatio({ metricId: "ad_clicks", ... }, { metricId: "page_views", ... });     // null + powód
```

## 3. Strona bazy danych

Migracja `20260725120000_analytics_semantic_layer.sql`:

1. **`analytics_semantic_snapshot(p_since, p_until)`** - jedna migawka wszystkich
   strumieni first-party dla jawnie podanego okna. Tenant pochodzi z
   `assert_admin_tenant()` (profil wywołującego), **nie** z parametru ani z
   nagłówka `x-tenant-host` - podrobienie nagłówka nie daje dostępu do danych
   innego najemcy. Odwrócone granice są błędem, nie cichym zerem.
2. **`web_vitals_daily_p75`: `percentile_cont` → `percentile_disc`.** Teraz trend
   dzienny z bazy i p75 z pamięci to ta sama liczba, a zwracana wartość jest
   wartością, którą ktoś faktycznie zmierzył.
3. **`COMMENT ON`** dla kolumn i tabel wszystkich strumieni: opis w bazie
   przestaje kłamać (`session_id` **nie** jest sesją 24-godzinną) i wskazuje
   rejestr w kodzie, żeby oba miejsca zostały zgodne.

Testy: `supabase/tests/analytics_semantic_layer_test.sql` (bramka roli, izolacja
najemców, granice okna, nearest rank).

## 4. Co zobaczy administrator

`/admin/analytics` → zakładka **Uzgodnienie**:

1. **Okno pomiaru** - dokładne granice, ziarno, zakres wysłany do GA4, okno
   poprzednie i lista zastrzeżeń. Bez tego admin porównujący nasz panel z
   interfejsem Google (który domyślnie dolicza dzień bieżący) widziałby różnicę
   bez wyjaśnienia.
2. **Metryki kanoniczne** - jedna liczba do zacytowania, chip strumienia
   autorytatywnego, werdykt, rozjazd i obserwacje potwierdzające z odchyleniem.
   Przy każdej liczbie ikona z definicją kanoniczną, wzorem i listą „czego nie
   wolno".
3. **Metryki złożone** - CTR reklam i newslettera, każdy liczony wewnątrz
   jednego strumienia.
4. **Strumienie w oknie** - dostępność sześciu źródeł z rozróżnieniem „nie
   skonfigurowane" / „odczyt nieudany" / „brak danych" (dotąd wszystkie trzy
   wyglądały identycznie: jako zero).
5. **Interpretacja i rekomendacje** - w tym samym prymitywie `InsightSection`, co
   pozostałe dashboardy.
6. **Słownik metryk** (zwinięty) - renderowany z rejestru w kodzie, więc nie może
   rozjechać się z definicjami używanymi do liczenia.

Zakładka GA4 pokazuje dodatkowo zwięzłą linię `WindowProvenance` i korzysta z
tego samego resolwera okna, więc „28 dni" znaczy tam dokładnie to samo.

## 5. Jak dodać metrykę albo strumień

1. **Nowy strumień** → wpis w `STREAM_LIST` (`streams.ts`). Wymagane: bramka
   zgody, ziarno tożsamości, zegar, tryb deduplikacji, opóźnienie i **co najmniej
   jedno zastrzeżenie** (test inwariantów wymusza to ostatnie - strumień bez
   zastrzeżeń znaczy, że ktoś dodał źródło, nie opisawszy jego semantyki).
2. **Nowa metryka** → wpis w `METRIC_LIST` (`metrics.ts`) z **dokładnie jednym**
   powiązaniem autorytatywnym, definicją PL i EN oraz co najmniej jednym
   strażnikiem. Przy wielu powiązaniach ustaw `driftTolerance` i - jeśli relacja
   wielkości jest przewidywalna - `expectedOrder`.
3. **Obserwacje** → dopisz metrykę do `buildObservations` w
   `snapshot.functions.ts` (i do zapytania w RPC, jeśli potrzebuje nowego pola).
4. **i18n** → jednostka metryki i wszelkie nowe kody muszą mieć klucze PL i EN;
   `src/lib/__tests__/i18nSemanticAnalytics.test.ts` sprawdza pokrycie
   **każdego** kodu z unii typów w obu językach (klucze są składane dynamicznie,
   więc brak tłumaczenia nie wywala builda - użytkownik zobaczyłby surowy kod).

Testy inwariantów rejestru (`registry.test.ts`) pilnują reszty: unikalności id,
jednego źródła autorytatywnego na metrykę, spójności `expectedOrder` z
powiązaniami i tego, że tolerancja jest niezerowa tylko przy wielu strumieniach.

## 6. Co zostało świadomie NIE zrobione

- **Strefa czasowa property GA4** nie jest odczytywana z Admin API, więc
  różnica między dniem UTC a dniem property pozostaje - jest zadeklarowana jako
  `ga4_property_timezone`, nie ukryta.
- **`related_posts_signals`** nadal przyjmuje `_since_days` i liczy okno jako
  `now() - N dni`; `legacyRpcWindow()` dokłada wtedy notę
  `legacy_rpc_window_ends_now`. Przepisanie tego RPC na jawne granice to osobna
  zmiana.
- **Brak bramki zgody dla `post_views`** (kod nie sprawdza zgody, a `/cookies`
  deklaruje `post_views` w kategorii analitycznej) jest zadeklarowany jako
  zastrzeżenie strumienia. Uzgodnienie deklaracji z implementacją to decyzja
  prawna, nie techniczna, więc warstwa semantyczna raportuje rozbieżność, zamiast
  ją rozstrzygać.
