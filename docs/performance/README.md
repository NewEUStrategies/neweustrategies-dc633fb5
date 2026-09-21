# Pomiar wydajności: RUM i Lighthouse

Ten katalog trzymał dotąd wyłącznie **wyniki** pomiarów (`2026-09-06-first-visit.md`,
`2026-09-14-first-interaction.md` i ich pliki `*-results.json`). Brakowało opisu
samych **instrumentów** - a to one decydują, co te wyniki w ogóle znaczą. Ten plik
jest tym opisem: co mierzymy, czym, czego nadal nie widzimy i co musi zrobić
człowiek, żeby zaczęło być widać.

Diagnoza źródłowa: [`docs/AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md`](../AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md)
(wada **F40 - luka pomiarowa**, wiersze **0.2** i **0.3** „Fali 0").

---

## 1. RUM - Core Web Vitals z przeglądarek czytelników

| Warstwa   | Plik                                                                                       |
| --------- | ------------------------------------------------------------------------------------------ |
| Zbieranie | `src/lib/webVitals.ts` (PerformanceObserver, bez zewnętrznych zależności)                  |
| Transport | `src/lib/observability/report.ts` (`navigator.sendBeacon`, jeden beacon na granicę zrzutu) |
| Ingest    | `src/routes/api/public/vitals.ts` (publiczny, niepodpisany; zawsze 204)                    |
| Tabela    | `public.web_vitals` (migracje `20260626210000`, `20260708150000`, `20260920121000`)        |
| Agregacja | `public.web_vitals_daily_p75(timestamptz, uuid)`, `src/lib/observability/aggregate.ts`     |

Mierzone metryki: **LCP, CLS, INP, FCP, TTFB**. CLS to maksimum z okien sesyjnych,
INP to wysoki percentyl opóźnień interakcji - **te same definicje, co w bramce
Lighthouse**; uzasadnienie w nagłówku `src/lib/webVitals.ts`.

### 1.1. Kontekst nawigacji (wiersz 0.3 „Fali 0", wdrożony 2026-09-20)

**Problem, który to rozwiązuje.** p75 liczone po surowych wierszach `web_vitals`
mieszało dwie populacje, których nic w tabeli nie rozdzielało: zimne pierwsze
wejście (pusty cache HTTP, zimny izolat Workera, telefon na 3G) i czwartą miękką
nawigację tego samego czytelnika. Mediana „poprawiała się" wraz z długością sesji,
a ogon rozkładu - ten, dla którego p75 w ogóle się liczy - znikał w uśrednieniu.

Każda próbka niesie teraz pięć pól **opisowych**:

| Pole klienta     | Kolumna           | Wartości                                                | Brak pomiaru |
| ---------------- | ----------------- | ------------------------------------------------------- | ------------ |
| `sinceNav`       | `since_nav_ms`    | całkowite 0 … 86 400 000 (doba)                         | `NULL`       |
| `navigationType` | `navigation_type` | `navigate` \| `reload` \| `back_forward` \| `prerender` | `NULL`       |
| `deviceMemory`   | `device_memory`   | `1` \| `2` \| `4` \| `8` (kubełek **w dół**)            | `NULL`       |
| `effectiveType`  | `effective_type`  | `slow-2g` \| `2g` \| `3g` \| `4g`                       | `NULL`       |
| `coldStart`      | `cold_start`      | `true` \| `false`                                       | `NULL`       |

**Zero nowych identyfikatorów - to jest granica, nie styl.** Żadne z tych pól nie
wyróżnia osoby ani urządzenia: cztery wartości, cztery progi, cztery klasy łącza,
dwie wartości logiczne, a `sinceNav` jest czasem **względem startu tej jednej
nawigacji**, więc nie sklei dwóch odsłon. Tabela nadal nie ma kolumny zdolnej
powiązać wiersze jednego czytelnika - ingest nie zapisuje nawet `id` metryki.
`coldStart` opiera się o znacznik `sessionStorage` o treści `"1"`, który umiera
razem z kartą.

**Zgoda.** Reporter startuje wyłącznie zza bramki zgody analitycznej
(`initObservability` w `src/lib/observability/index.ts`), a jej cofnięcie rozłącza
obserwery, kasuje bufor i zwalnia flagę inicjalizacji. Rozszerzenie ładunku
niczego w tym nie zmienia - nowe pola jadą tą samą, zgodową drogą.
**Wysyłka anonimowych metryk czasowych bez zgody nie jest zaimplementowana**
(patrz §3.2).

**Znane obciążenie `coldStart`.** Znacznik w `sessionStorage` stawiamy dopiero po
zgodzie, więc czytelnik, który zgodził się dopiero na trzeciej podstronie, zostanie
policzony jako zimne wejście. Alternatywa - zapis do magazynu przed zgodą - jest
gorsza: magazyn nieistotny dla działania serwisu wymaga zgody tak samo jak beacon.

**Walidacja jest „miękka" i to jest decyzja.** Ingest sprowadza pole spoza
kontraktu (nieznany enum, `sinceNav` poza dobą, `deviceMemory` poza progami,
`coldStart` inny niż boolean) do `NULL`, ale **próbki nie odrzuca**: kontekst jest
dodatkiem do pomiaru, więc jego odrzucenie nie może kosztować samej metryki.
Wiersz jest składany pole po polu z jawnej białej listy, więc nieznane klucze
z ciała żądania (`tenant_id`, `id`, `created_at`, cokolwiek innego) nie mają jak
dojechać do `insert`.

**Okno między wdrożeniem kodu a migracją.** `check:migration-ledger` jest bramką
**powdrożeniową**, więc kolejność „kod przed migracją" jest realna. Gdyby kolumny
jeszcze nie istniały, `insert` zwraca `PGRST204` / `42703`, a ingest ponawia zapis
**bez kontekstu** - inaczej jedna brakująca kolumna kasowałaby cały RUM w ciszy
(każdy beacon dostaje 204, w bazie zero wierszy, żadnego nieudanego żądania).

### 1.2. Przykładowe zapytania

```sql
-- p75 LCP OSOBNO dla zimnego wejścia i dla reszty ruchu.
SELECT cold_start,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
       count(*) AS samples
  FROM public.web_vitals
 WHERE metric = 'LCP'
   AND tenant_id = $1
   AND created_at >= now() - interval '7 days'
 GROUP BY cold_start;

-- Rozkład po klasie łącza - czy ogon to telefony, czy desktop.
SELECT effective_type, device_memory,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
  FROM public.web_vitals
 WHERE metric = 'INP' AND tenant_id = $1
 GROUP BY 1, 2 ORDER BY 3 DESC;
```

---

## 2. Lighthouse - dwa uczciwe tryby

Pełne uzasadnienie każdej liczby żyje w kluczach `_comment` plików konfiguracyjnych
i w nagłówku `.github/workflows/lighthouse.yml`. **To jest miejsce do przeczytania
przed ruszeniem czegokolwiek** - progi w tym repo wolno wyłącznie zacieśniać
(reguła ratchetu, ta sama co `FROZEN_BUDGET_KB` w `scripts/check-bundle-size.ts`).

| Tryb | Warunek             | Co mierzy                         | Konfiguracja                                                       |
| ---- | ------------------- | --------------------------------- | ------------------------------------------------------------------ |
| A    | `vars.LHCI_URL` ≠ ∅ | wdrożoną aplikację SSR            | `lighthouserc.deployed.json` + `lighthouserc.deployed.mobile.json` |
| C    | `vars.LHCI_URL` = ∅ | artefakt produkcyjny na 127.0.0.1 | `lighthouserc.json`                                                |

**Tryb A nie uruchomił się dotąd ani razu** i nie da się tego zamknąć z repo:
`LHCI_URL` jest zmienną repozytorium, więc z konstrukcji nie żyje w drzewie.

### 2.1. Lista URL-i (wiersz 0.2 „Fali 0")

Powstaje w kroku **„Build the mode A URL list"** (`lhci-urls.txt`), raz dla obu
profili - profil nie może zmieniać powierzchni pomiaru. Strona główna to samo
`vars.LHCI_URL`; ścieżki relatywne dokłada zmienna `LHCI_EXTRA_PATHS`, a gdy jest
pusta - lista domyślna `/blog,/events,/club` (wyłącznie ścieżki, które **nie mogą
dać 404**).

Audyt wymaga pięciu powierzchni: **strony głównej, wpisu, wydarzenia, klubu
i kategorii**. Trzy z nich wymagają prawdziwych slugów z produkcji i **celowo nie
są zgadywane w repo** - wymyślony slug dałby stronę błędu, a bramka mierzyłaby 404
zamiast wpisu. Slugi wpisuje człowiek (patrz §3.1).

### 2.2. Profil mobile

`lighthouserc.deployed.mobile.json`, drugi przebieg trybu A. W Lighthouse **nie ma
presetu `mobile`** (`--preset` przyjmuje `perf`, `experimental`, `desktop`) -
konfiguracja domyślna **jest** mobilna, więc plik deklaruje jawnie
`formFactor: mobile`, a throttling (4× CPU, ~1,6 Mb/s) przychodzi z domyślnych
stałych Lighthouse'a.

- **Asercje kategorii**: identyczne z desktopowymi, na `error`.
- **Asercje metryczne**: na `warn`, bo żadna z tych liczb nie została zmierzona na
  mobile - są przepisane z krzywych **desktopowych**. Pierwszy przebieg trybu A
  ustala podłogę; wtedy wpisuje się zmierzoną medianę do `_comment` i podnosi
  asercje na `error`. Dalej wyłącznie zacieśnianie.

Raporty desktopowe lądują w `.lighthouseci/`, mobilne w `.lighthouseci-mobile/`;
oba idą do artefaktu joba (log z runnera jest jedyną podstawą ratchetu).

---

## 3. Co musi zrobić człowiek

### 3.1. Ustawić `vars.LHCI_URL` (i opcjonalnie `LHCI_EXTRA_PATHS`)

Settings → Secrets and variables → Actions → **Variables**.

- `LHCI_URL` - URL preview albo produkcji (HTTPS, bez końcowego `/`).
  Dopóki jest pusty, tryb A nie rusza i **wszystkie liczby w
  `lighthouserc.deployed*.json` są kontraktem, nie pomiarem**.
- `LHCI_EXTRA_PATHS` - ścieżki po przecinku; **zastępuje listę domyślną w całości**.
  Wzorzec do uzupełnienia prawdziwymi slugami:

  ```text
  /blog,/events,/club,/post/<slug-wpisu>,/category/<slug-kategorii>,/events/<slug-wydarzenia>,/club/<slug-klubu>
  ```

  Kształty ścieżek pochodzą z tras: `post.$slug`, `category.$slug`,
  `events.$slug.index`, `club.$clubSlug.index`.

### 3.2. Decyzja DPO: anonimowe metryki czasowe bez zgody

Audyt (rozdz. 8, poz. 10) stawia to jako **warunek organizacyjny**: RUM startuje
dziś dopiero po zgodzie analitycznej, więc populacja pierwszego wejścia jest
systematycznie niedoreprezentowana - odpada dokładnie ten czytelnik, który zamyka
kartę przed kliknięciem w baner. Zbieranie samych metryk czasowych bez
identyfikatorów i bez cookies **wymaga potwierdzenia podstawy prawnej przez DPO**
i dopóki go nie ma, kod tego nie robi i nie powinien. Decyzja dotyczy też
znacznika `coldStart` w `sessionStorage` (§1.1).

### 3.3. ~~Domknąć `check:types-freshness` po migracji `20260920121000`~~ ZROBIONE 2026-09-21

`src/integrations/supabase/types.ts` jest **generowany**
(`supabase gen types typescript --linked`), a generator wymaga dostępu do projektu
Supabase - nie da się go uruchomić z gałęzi funkcjonalnej. Bramka
`check:types-freshness` porównuje `ADD COLUMN` z migracji z zawartością tego pliku,
więc po tej migracji zgłosiła **pięć** kolumn poza typami, a tymczasowym
domknięciem był wpis do `BASELINE` w `scripts/check-generated-types-freshness.ts`.

Typy zostały **przegenerowane** i wszystkie pięć kolumn (`since_nav_ms`,
`navigation_type`, `device_memory`, `effective_type`, `cold_start`) jest
w `types.ts`. Wraz z regeneracją zniknęły:

- pięć wpisów `web_vitals.*` z `BASELINE` (31 -> 26 pozycji zamrożonego długu),
- przecięcie `TablesInsert<"web_vitals"> & { … }` w `src/routes/api/public/vitals.ts`
  i podstawienie ładunku pod szerszy typ tuż przed `insert()`,
- dwa rzutowania `as unknown as` w `src/lib/observability/vitals.functions.ts`
  (kształt wiersza i wynik RPC `web_vitals_daily_p75`).

Wiersz ingestu jest dziś typowany wprost `TablesInsert<"web_vitals">`, więc
`RejectExcessProperties` w supabase-js znów pilnuje kształtu na publicznej,
niepodpisanej ścieżce zapisu.

### 3.4. Przy pierwszym przebiegu trybu A

Zapisać zmierzone mediany (wartość, URL, data, numer przebiegu) w `_comment`
odpowiedniego pliku i dopiero od tego zaciskać. Jeśli mobilne
`categories:performance >= 0,8` nie przejdzie, decyzja należy do człowieka: zejść
z tym plikiem na `warn` na czas napraw (ze śladem w `_comment`) albo utrzymać
blokadę. Czego robić nie wolno: obniżyć progu i zostawić to bez śladu.
