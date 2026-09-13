# ZLECENIE: MODUŁ 20 - Platforma / backend / infrastruktura / SSR

> **HEAD pomiaru: `967cec9`.** Każda liczba statyczna w tym dokumencie została zmierzona na tym commicie.
> Jeżeli pracujesz na nowszym `main`, **przemierz przed startem** - i jeśli któraś liczba się rozjechała,
> napisz o tym w opisie PR-a zamiast dopasowywać się do nieaktualnego zlecenia. Ta uwaga stoi tu,
> bo w wydaniu 10 trzy z siedmiu pozycji erraty wykonawcy wzięły się z czytania zlecenia na innym HEAD,
> niż powstało (rozdz. 8.5 audytu, pozycja 16).
>
> **TO ZLECENIE JEST NA TĘ UWAGĘ SZCZEGÓLNIE WRAŻLIWE.** W odróżnieniu od dwóch pozostałych zleceń
> tej serii, ta powierzchnia **ruszyła się** między `7a780b1` (origin/main) a `967cec9`: zmieniły się
> trzy pliki produkcyjne, w tym **`src/routes/$.tsx` i `src/routes/__root.tsx`, których dotyczą
> pozycje A1 i A3**. Zanim zaczniesz, wykonaj:
>
> ```bash
> git diff --name-only 967cec9..HEAD -- src/routes/ src/lib/server/ src/lib/http/ src/lib/ssr/ src/lib/queries/ src/start.ts
> ```
>
> Jeżeli wypisze `$.tsx` albo `__root.tsx`, **przeczytaj te pliki od nowa przed pracą nad A1 i A3**.

---

## OSTRZEŻENIE O ZAKRESIE DOWODU - przeczytaj przed rozdziałem 0

**Procenty pokrycia w tym zleceniu NIE zostały zmierzone. Zostały przepisane z wydania 10 audytu
i są opatrzone HEAD-em, na którym powstały.** Sesja, w której powstało to zlecenie, **nie mogła
zainstalować zależności**: `bun.lock` przypina 384 rozstrzygnięcia do lustra `europe-west1-npm.pkg.dev`
i `europe-west4-npm.pkg.dev` (`lovable-core-prod`), a polityka egresu organizacji odrzuca ten host
odpowiedzią **403 na CONNECT**. Bez `node_modules` nie ma `vitest run --coverage`.

**Pierwszą czynnością tego zlecenia jest pomiar**, nie kodowanie: `bun install && bun run test:coverage`,
potem `node scripts/taxonomy/report.mjs --module 20`.

**Liczby statyczne rozdz. 0 oraz wszystkie sześć defektów rozdz. 1-2 są zweryfikowane czytaniem
kodu na `967cec9`** i nie zależą od instalacji zależności. Każdy defekt przeszedł **niezależną próbę
obalenia przez osobnego agenta**, a A1, A2, A3, A5 i A6 sprawdziłem dodatkowo ręcznie przy redakcji.

**Żaden z sześciu defektów nie został obalony, ale próba obalenia zmieniła treść czterech z nich** -
w A2 obaliła główny argument pierwszej redakcji, w A1 i A5 zawęziła zasięg szkody, w A6 osłabiła
narrację o ścieżce użytkownika. Te sprostowania stoją w treści pozycji, opisane wprost. Czytaj je:
to jest różnica między defektem, który da się naprawić, a defektem, którego opis wyśle Cię w złą stronę.

---

## 0. Stan wyjściowy

### 0.1. Zmierzone na `967cec9` - obowiązuje

| Metryka                               | Wartość                  |
| ------------------------------------- | ------------------------ |
| Pliki produkcyjne                     | **242** (47 161 wierszy) |
| Pliki testowe                         | 422                      |
| Trasy                                 | 32                       |
| Pliki bez importu w korpusie testowym | 8 (372 wiersze, 0,8%)    |

**Ten moduł trzeba czytać w dwóch częściach, bo bez tego rozdzielenia każda liczba o nim wprowadza
w błąd.** Taksonomia wrzuca do modułu 20 zarówno powierzchnię produktową, jak i narzędzia kontrolne
CI (`src/lib/ci/**`), które są kodem budującym bramki, a nie kodem, który widzi użytkownik:

| Część                                    | Pliki | Wiersze |
| ---------------------------------------- | ----: | ------: |
| Powierzchnia produktowa                  |   202 |  31 845 |
| Narzędzia kontrolne CI (`src/lib/ci/**`) |    40 |  15 316 |

**Wszystkie sześć defektów tego zlecenia leży w powierzchni produktowej.** Narzędzia CI są w tym
zleceniu wyłącznie przedmiotem rozdz. 3 i 4.

### 0.2. Przepisane z wydania 10 audytu (HEAD `5fd13461c`) - do przemierzenia

| Metryka            | Wartość wg audytu              |
| ------------------ | ------------------------------ |
| **Linie**          | **86,18%**                     |
| Funkcje            | 80,77%                         |
| Plików na zerze    | 21                             |
| Niepokrytych linii | **1 380** (26,93% całego repo) |

**Moduł 20 jest największą masą niepokrytego kodu w repozytorium** - ponad jedna czwarta wszystkich
niepokrytych linii. Audyt wskazuje jako największe zera `admin.paywall.tsx` (153 linie),
`admin.super.mobile-drawer.tsx` (83), `ai-gateway.server.ts` (71), `admin.authors.tsx` (60),
`admin.monetization.tsx` (56).

**Uwaga o jednej z tych nazw:** na `967cec9` **nie istnieje** plik `src/lib/server/ai-gateway.server.ts`.
Sprawdź, czy został przeniesiony, czy usunięty, zanim potraktujesz tę pozycję audytu jako zadanie.

### 0.3. Czego dziś NIE pilnuje żaden próg

Na `967cec9` `vitest.config.ts` ma **694 unikalne klucze progów per-ścieżka**. Rozkład w tym module:

| Część                   | Plików bez progu | Wierszy bez progu | Udział wierszy |
| ----------------------- | ---------------: | ----------------: | -------------: |
| Powierzchnia produktowa |        129 z 202 |   17 310 z 31 845 |      **54,4%** |
| Narzędzia kontrolne CI  |          38 z 40 |   14 203 z 15 316 |      **92,7%** |

Najgrubsze pliki powierzchni produktowej bez żadnej bramki:

| Plik                                         | Wiersze |
| -------------------------------------------- | ------: |
| `src/routes/admin.paywall.tsx`               |   1 150 |
| `src/lib/http/documentCache.server.ts`       |     915 |
| `src/start.ts`                               |     469 |
| `src/routes/admin.super.mobile-drawer.tsx`   |     466 |
| `src/utils/payments.functions.ts`            |     443 |
| `src/lib/http/documentStreamGuard.server.ts` |     424 |
| `src/routes/admin.monetization.tsx`          |     420 |
| `src/routes/admin.authors.tsx`               |     350 |
| `src/lib/server/tenant.server.ts`            |     344 |

**Dwie pozycje z tej listy zasługują na osobne zdanie.** `documentCache.server.ts` (915 wierszy)
jest warstwą, której dotyczy defekt A3 z tego zlecenia, a `tenant.server.ts` (344 wiersze) to
warstwa izolacji najemcy. Obie stoją dziś wyłącznie pod progiem globalnym.

---

## 1. Pozycje BLOKUJĄCE

### A1. Uniwersalny resolwer treści `/$` zamienia błąd odczytu w HTTP 404 dla istniejącej, opublikowanej strony

**Gdzie:** `src/routes/$.tsx:242-247` (rozgrzewka i test istnienia), `:285` (rzut `notFound()`),
`:171` (stała `PRIMARY_CONTENT_BUDGET_MS`). Rzut błędu w warstwie zapytań:
`src/lib/queries/public.ts` (m.in. `if (error) throw error`).

**Co jest:**

```ts
await withBudget(
  context.queryClient.ensureQueryData(contentOptions).catch(() => undefined),
  PRIMARY_CONTENT_BUDGET_MS,
);
const data = context.queryClient.getQueryData(contentOptions.queryKey) ?? null;
if (!data) {
  ...
  throw notFound();
}
```

`.catch(() => undefined)` **gasi błąd**, a jedynym testem istnienia treści jest brak danych
w pamięci podręcznej zapytań. `resolveContentForSegments` rzuca przy każdym błędzie PostgREST,
więc **błąd bazy i brak wiersza są dla tego loadera nierozróżnialne**: oba dają `data === null`
i oba kończą się `notFound()`.

Ta sama ścieżka wystrzeliwuje przy odczycie **wolnym**: po wyczerpaniu budżetu w pamięci
podręcznej także nie ma danych, więc loader znów rzuca `notFound()`.

**Dwa uściślenia, bo pierwsza redakcja tej pozycji zawyżyła jej zasięg.** Niezależna próba
obalenia wskazała oba i sprawdziłem je ręcznie:

1. **Fałszywy 404 NIE jest cache'owany.** Loader ustawia `setCacheControlHeader(NO_STORE)` przed
   każdym rzutem `notFound()` (`$.tsx:277`, stała w `:173`), a `src/lib/http/documentCache.ts`
   odrzuca zapis czegokolwiek o statusie innym niż 200 (`if (status !== 200) return NO_STORE`).
   Fałszywy 404 nie trafia więc ani do cache brzegowego, ani do CDN: **kosztuje jedno żądanie,
   a nie okno świeżości**. To istotnie zawęża szkodę wobec tego, co twierdziła pierwsza redakcja.
2. **Równość budżetu z watchdogiem nie jest przyczyną tego defektu.** `PRIMARY_CONTENT_BUDGET_MS`
   wynosi `5_000` i jest równe `SSR_QUERY_TIMEOUT_MS` (`src/lib/ssr/queryTimeout.ts:25`), co łamie
   doktrynę repozytorium, ale **nie zmienia wyniku**: odrzucenie obietnicy jest już połknięte przez
   `.catch(() => undefined)`, więc niezależnie od tego, który zegar wygra wyścig, `getQueryData`
   oddaje `undefined` i trasa rzuca 404. Traktuj to jako **osobną pozycję porządkową i problem
   czasu odpowiedzi**, nie jako część mechanizmu fałszywego 404. Sednem defektu jest wyłącznie
   zlanie „błąd" z „brak wiersza".

**Polecenie dowodu:**

```bash
sed -n '242,247p;285p' 'src/routes/$.tsx'
grep -n "PRIMARY_CONTENT_BUDGET_MS" 'src/routes/$.tsx'
grep -n "SSR_QUERY_TIMEOUT_MS" src/lib/ssr/queryTimeout.ts
```

**Dlaczego to jest blokujące:** `/$` jest **jedyną** ścieżką renderującą wszystkie strony CMS
i wpisy pod adresami `<rodzic>/<slug>`, czyli całą redakcyjną powierzchnię serwisu. Czytelnik,
który wejdzie na istniejący artykuł w chwili czkawki bazy albo przy odczycie dłuższym niż 5 s,
dostaje stronę „nie znaleziono". **Odpowiedź ma status 404**, co potwierdza `seo404Middleware`
w `src/start.ts` logujący `response.status === 404` do `seo_404_hits`. Googlebot dostaje więc
twardy sygnał „tego adresu nie ma" dla żywego, opublikowanego tekstu, i to na najsilniejszych
linkowo trasach serwisu. Skutek jest trwały: wyindeksowanie jest tanie, powrót do indeksu drogi.

**Co zrobić:** rozróżnić dwa przypadki zamiast zlewać je w jeden. Użyj `loadResilient`
z `src/lib/ssr/resilientLoad.ts` i potraktuj stan zdegradowany inaczej niż brak treści:

- **odczyt zdegradowany** (błąd albo wyczerpany budżet): **nie** rzucaj `notFound()`; ustaw
  `setCacheControlHeader(resilientCacheControl(true))` i pozwól wyrenderować stan odtwarzalny;
- **czysty odczyt bez wiersza**: `notFound()` jak dotąd.

Osobno obniż `PRIMARY_CONTENT_BUDGET_MS` poniżej `SSR_QUERY_TIMEOUT_MS` i **zapisz w komentarzu,
skąd wzięła się nowa liczba**.

**Czego NIE robić:** nie usuwaj `notFound()` w ogóle - trasa musi nadal zwracać 404 dla adresów,
których naprawdę nie ma, bo inaczej zrobisz z serwisu maszynę do produkcji miękkich 404.

**Kryterium odbioru:** test loadera `/$`, w którym `queryFn` odrzuca błędem PostgREST i loader
**nie** rzuca `notFound()`, a ustawiony `Cache-Control` zawiera `no-store`; oraz drugi test,
w którym `queryFn` zwraca `null` i loader **nadal** rzuca `notFound()`. Trzeci test: budżet
jest ostro mniejszy od `SSR_QUERY_TIMEOUT_MS`.

### A2. Panel paska dolnego zapisuje dziesięć parametrów, z których produkcja nie czyta ani jednego, a tekst przy przełączniku obiecuje w dwóch językach, że jeden z nich działa

**Gdzie:** `src/routes/admin.settings.mobile-bottom-bar.tsx:117-192` (sekcja pól globalnych;
przełącznik `enabled` w 119-125), `:383-390` (podgląd),
`src/components/dock/WorkspaceDock.tsx:167-171` (jedyny produkcyjny czytelnik klucza),
`src/components/mobile/bottomBar/MobileBottomBarView.tsx` (komponent podglądu),
`src/lib/i18n-mobile-bottom-bar.ts:37` (PL) i `:103` (EN).

**Co jest:** trasa panelu edytuje pełny obiekt `MobileBottomBarConfig` i zapisuje go do
`site_settings[key="mobile_bottom_bar"]`. **Jedynym produkcyjnym czytelnikiem tego klucza** jest
`WorkspaceDock.tsx`, który natychmiast redukuje konfigurację do samej tablicy pozycji:

```tsx
const rawConfig = useSiteSetting<MobileBottomBarConfig>(MOBILE_BOTTOM_BAR_SETTINGS_KEY, ...);
const shortcuts = useMemo(() => visibleBottomBarItems(rawConfig), [rawConfig]);
```

Poza `items` nie sięga po **żadne** pole.

**Martwe pola dzielą się na dwie różne kategorie i to rozróżnienie zmienia naprawę.**
Pierwsza redakcja tego zlecenia wrzuciła je do jednego worka; niezależna próba obalenia
to sprostowała i sprawdziłem każdy przypadek ręcznie:

| Kategoria                                               | Pola                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Bez ani jednego czytelnika w całym `src/`**       | `enabled`, `hide_on_scroll`, `offset_bottom`                                                                                        |
| **(b) Czytane WYŁĄCZNIE przez podgląd w panelu admina** | `show_labels`, `radius`, `background_light`, `background_dark`, `icon_light`, `icon_dark`, `use_item_color` oraz kolory per pozycja |

Pola kategorii (a) występują w `src/` wyłącznie w typie i wartościach domyślnych
(`src/lib/mobileBottomBar/config.ts`) oraz w formularzu panelu. Pola kategorii (b) czyta
`MobileBottomBarView`, który jest importowany **tylko przez samą trasę panelu** i służy tam
za podgląd; w produkcji nie montuje go nikt.

**Sprostowanie, które odbiera temu defektowi jeden z zarzutów.** Pierwsza redakcja twierdziła,
że administrator „widzi w podglądzie, że pasek znika". **To nieprawda.** `MobileBottomBarView`
nie czyta `enabled` ani razu, a podgląd jest warunkowany wyłącznie przez `previewItems.length > 0`
(wiersz 383). Podgląd nie kłamie o tym polu; on go po prostu nie dotyka.

**Kłamie natomiast tekst przy przełączniku, w obu wersjach językowych:**

> PL (`i18n-mobile-bottom-bar.ts:37`): „Wyłączenie ukrywa pasek na całym serwisie."
> EN (`:103`): „Turning this off hides the bar across the whole site."

**Polecenie dowodu:**

```bash
grep -rn "mobile_bottom_bar\|MOBILE_BOTTOM_BAR_SETTINGS_KEY" src --include="*.ts" --include="*.tsx" | grep -v __tests__
grep -rn "MobileBottomBarView" src --include="*.tsx" | grep -v __tests__
grep -c "enabled\|hide_on_scroll\|offset_bottom" src/components/mobile/bottomBar/MobileBottomBarView.tsx   # ma zwrócić 0
grep -n "enabledHint" src/lib/i18n-mobile-bottom-bar.ts
```

**Dlaczego to jest blokujące:** administrator odznacza „Pasek aktywny" przy jawnej, dwujęzycznej
obietnicy, że wyłączenie ukryje pasek na całym serwisie, zapisuje, dostaje potwierdzenie zapisu -
i pasek dalej jest na serwisie dla każdego zalogowanego użytkownika. To jest ta sama klasa defektu,
którą zlecenie modułu 1 nazwało A1: **narzędzie, które kłamie o swoim działaniu**. Dziewięć
pozostałych pól to dług towarzyszący, nie sedno.

**Co zrobić - wybierz JEDNĄ z dwóch dróg i uzasadnij wybór w opisie PR-a:**

- **(a) doprowadzić odczyt do końca:** uwzględnić `enabled` w warunku montowania paska
  w `src/components/SiteChrome.tsx` i przekazać z `WorkspaceDock.tsx` pozostałe pola do renderu.
  Wtedy podgląd i produkcja zaczynają mówić to samo.
- **(b) usunąć martwą konfigurację:** wyciąć pola, których produkcja nie czyta, **razem z ich
  kluczami i18n**, i zostawić wyłącznie zarządzanie pozycjami. Przy tej drodze `MobileBottomBarView`
  albo znika, albo staje się komponentem produkcyjnym.

**Czego NIE robić:** nie zostawiaj podglądu, który renderuje inny komponent niż produkcja,
niezależnie od wybranej drogi. I nie usuwaj samego przełącznika bez usunięcia jego tekstu i18n -
osierocona obietnica w słowniku jest gorsza od pola, które przynajmniej widać.

**Kryterium odbioru:** przy drodze (a) test, w którym `enabled: false` powoduje, że pasek nie jest
renderowany w powłoce serwisu. Przy drodze (b) test, że zbiór pól zapisywanych przez panel równa się
zbiorowi pól czytanych przez `WorkspaceDock`, oraz że `grep -n "enabledHint" src/lib/i18n-mobile-bottom-bar.ts`
nie zwraca nic.

---

## 2. Pozycje zwykłe

### A3. Zdegradowana powłoka trafia do współdzielonego cache jako dokument bez nagłówka serwisu

**Gdzie:** `src/routes/__root.tsx:355-368` (bramka `homeDeadline !== undefined`), `:381-385`
(zasiew pustego fallbacku), `:241` (powstanie `homeDeadline`); skutek w `src/components/Header.tsx:141-142`.

**Co jest:** loader korzenia rozgrzewa `site_settings`, `designTokens` i `globalColors` pod budżetem.
Gdy rozgrzewka nie dowiezie danych, rezygnacja ze współdzielonego cache
(`setCacheControlHeader(resilientCacheControl(true))`) wykonuje się **wyłącznie wewnątrz**
`if (homeDeadline !== undefined)`, a `homeDeadline` powstaje **tylko dla strony głównej**.
Dla każdej innej trasy kod idzie prosto do zasiewu pustego obiektu i nie zapala żadnej flagi
degradacji.

Drugi mechanizm degradacji też nie zadziała: przy pustej mapie ustawień `header.builder_data`
jest `undefined`, więc nagłówek uznawany jest za niewidoczny i `readChromeWarmup` wraca bez
wywołania `markDegraded`.

**Przeczytaj komentarz nad tą bramką, zanim ją ruszysz, bo broni ona czegoś realnego:**

```
// Only homepage SSR opts into early cancellation. Another route may be
// awaiting this same settings promise and retains its existing contract.
```

Komentarz uzasadnia zawężenie **anulowania zapytań** (`cancelQueries`) do strony głównej i to
uzasadnienie jest trafne: inna trasa może czekać na tę samą obietnicę. **Nie uzasadnia natomiast
zawężenia rezygnacji z cache**, która stoi w tym samym bloku wyłącznie dlatego, że tam ją napisano.
To są dwie różne decyzje sklejone jedną instrukcją warunkową, i na tym polega ten defekt.

**Dlaczego to jest defekt:** jedna czkawka bazy przy zimnym chybieniu cache produkuje dokument
**bez nagłówka i bez nawigacji**, który zamiast być `no-store` zostaje wpisem współdzielonym
i jest podawany kolejnym czytelnikom przez pełne okno świeżości (180 s), a w oknie nieświeżym
dłużej. Crawler, który trafi w to okno, indeksuje stronę bez linkowania wewnętrznego.

**Co zrobić:** wyprowadzić rezygnację z cache poza bramkę `homeDeadline` i sprawdzać obecność
danych ustawień **bezwarunkowo**, dla każdej trasy.

**Kryterium odbioru:** rozszerzenie `src/lib/ssr/__tests__/platformChromeWarmup.test.tsx`:
dla ścieżki innej niż `/` i `/en`, gdy rozgrzewka ustawień odrzuca, dyrektywa cache zawiera
`no-store`.

### A4. Sitemapa wydarzeń reklamuje crawlerom wydarzenia bramkowane, których RLS nie oddaje anonimowemu czytelnikowi

**Gdzie:** `src/lib/server/sitemapEntries.server.ts:268-287`. Polityka odniesienia:
`supabase/migrations/20260812103500_community_events_anon_visibility.sql`.

**Co jest:** kolektor sekcji `events` czyta tabelę rolą serwisową (omija RLS) i za kryterium
publiczności bierze **wyłącznie** `status = 'published'`:

```ts
.from("events")
.select("slug, updated_at, created_at", { count: "exact" })
.eq("tenant_id", tenantId)
.eq("status", "published")
```

Tymczasem polityka anonimowego odczytu, ustanowiona wprost po to, żeby zamknąć wydarzenia
członkowskie, wymaga jeszcze dwóch warunków: `visibility = 'public'` **oraz**
`COALESCE(min_tier_rank, 0) = 0`. Ten sam próg egzekwują `rsvp_event` i `get_event_access`,
a loader trasy potwierdza to w komentarzu (`src/routes/events.$slug.tsx:154-156`).

**Dlaczego to jest defekt:** `/sitemap-events.xml` jest publiczny i wydaje kompletną listę adresów
wydarzeń zamkniętych, których ta sama platforma świadomie nie pokazuje gościowi na `/events`.
To odwrócenie decyzji produktowej zapisanej w migracji: benefit członkowski przestaje być ukryty,
bo jego katalog można przeczytać bez konta. Dodatkowo crawler dostaje pod tymi adresami ekran
zachęty zamiast treści, więc budżet indeksowania idzie na strony bramkowane.

**Co zrobić:** dołożyć w kolektorze te same dwa warunki, które egzekwuje polityka. Docelowo
wyciągnąć ten predykat do jednego miejsca używanego przez kolektor sitemapy i przez odczyty
publiczne, żeby nie rozjechał się po raz drugi.

**Kryterium odbioru:** rozszerzenie `src/lib/server/__tests__/sitemapEntries.server.test.ts`:
dla zestawu zawierającego wydarzenie `status='published', visibility='members'` oraz
`status='published', visibility='public', min_tier_rank=2` kolektor zwraca **wyłącznie** adres
wydarzenia faktycznie publicznego.

### A5. Przegląd SEO nie odróżnia awarii odczytu od braku problemów, a stan ładowania wygląda w nim tak samo jak sukces

**Gdzie:** `src/routes/admin.seo.tsx:70-100` (zapytania), `:212` (kolor liczby w kafelku),
`:316-322` (stopka tabeli). Ta sama wada w siostrzanej trasie
`src/routes/admin.seo.search-console.tsx`.

**Co jest:** oba zapytania poprawnie rzucają błędem, ale komponent **nigdy nie czyta `isError`
ani `error`**. Sprawdzenie jest jednoznaczne:

```bash
grep -c "isError" src/routes/admin.seo.tsx                 # 0
grep -c "isError" src/routes/admin.seo.search-console.tsx   # 0
```

Przy odrzuconym zapytaniu dane domykają się na pustą tablicę, więc podsumowanie daje same zera,
a kafelki „Brak opisu" i „Domyślny obrazek" mają ton warunkowany wartością: zero maluje liczbę
na zielono. Stopka tabeli wybiera komunikat po liczbie wierszy, więc dla pustych danych pokazuje
napis o ładowaniu.

**Trzy uściślenia, bo pierwsza redakcja tej pozycji przesadziła, a w jednym miejscu przeoczyła
coś istotnego.** Niezależna próba obalenia wskazała pierwsze dwa; trzecie jest sprostowaniem
do niej samej:

1. **„Zostaje na napisie Ładowanie na zawsze" jest nieprawdą.** `src/router.tsx:41-49` ustawia
   globalnie `retry: 1` z wykładniczym opóźnieniem, `refetchOnReconnect: "always"` i pięciominutowy
   `staleTime`. Zapytanie ponawia się raz automatycznie, a po odzyskaniu łączności albo po
   ponownym wejściu na trasę próbuje znowu. Stan trwały utrzymuje się wyłącznie przy trwałej
   awarii, na przykład przy odebranym grancie.
2. **Zielona jest sama liczba, nie cały kafelek**, i **zielone są dwa z pięciu**. Ton dotyczy
   wyłącznie wartości (`:212`), etykieta zostaje wyszarzona, a kafelek zbiorczy pokazuje zero
   w kolorze zwykłym. **Ważniejsze:** ten sam fałszywie zielony obraz występuje w **normalnym
   stanie ładowania**, zanim dane dojdą. Wada nie polega więc na tym, że awaria wygląda jak sukces,
   tylko na tym, że **awaria, ładowanie i brak problemów wyglądają identycznie**. To jest szerszy
   defekt niż zgłoszony, nie węższy.
3. **Próba obalenia twierdziła, że siostrzana trasa `/admin/seo/search-console` robi to poprawnie.
   Sprawdziłem: nie robi.** `grep -c "isError"` zwraca tam również zero. Defekt obejmuje obie trasy.

**Dlaczego to jest defekt:** ten ekran ma krzyczeć, gdy brakuje opisów i grafik społecznościowych.
Redaktor, który patrzy na niego w chwili awarii odczytu, widzi obraz nieodróżnialny od „nie masz
żadnych braków SEO" i odchodzi od ekranu w przekonaniu, że nie ma pracy do wykonania.

**Co zrobić:** wyciągnąć `isError` z obu zapytań na obu trasach i rozdzielić trzy stany:
ładowanie, błąd (komunikat `role="alert"`), wynik. Kafelki i tabelę renderować wyłącznie dla stanu
wyniku. Dopóki dane nie dojdą, kafelki nie mają prawa pokazywać zer w tonie sukcesu.

**Czego NIE robić:** nie naprawiaj samego `admin.seo.tsx`. Ta sama wada stoi w trasie obok
i naprawa jednej z nich zostawi dokładnie ten sam błąd pod sąsiednim adresem.

**Kryterium odbioru:** test dla każdej z dwóch tras, w którym zapytania odrzucają i ekran pokazuje
komunikat o błędzie zamiast kafelków z zerami; oraz test stanu ładowania, w którym kafelki nie
pokazują zer w tonie sukcesu, zanim dane dojdą.

### A6. Dashboardy BI zamieniają błąd i trwające ładowanie w twierdzenie „integracja nie jest skonfigurowana"

**Gdzie:** `src/routes/admin.analytics.bi.tsx:90` (klucz zapytania) i `:121-130` (przekazanie propa);
`src/components/admin/analytics/Ga4BiDashboard.tsx:561` oraz `GscBiDashboard.tsx:663`
(gałąź `if (!configured)`); `src/lib/analytics/status.functions.ts:43`
(rzut `Forbidden: admin role required`). Wzorzec poprawny: `src/routes/admin.settings.analytics.tsx`.

**Co jest:** zapytanie o status nie ma żadnej obsługi `isError`, a jego wynik jest domykany
operatorem `??`:

```tsx
<GscBiDashboard configured={statusQ.data?.gsc.configured ?? false} />
<Ga4BiDashboard configured={statusQ.data?.ga4.configured ?? false} />
```

Przy odrzuconym zapytaniu **i w każdej chwili przed jego rozwiązaniem** oba dashboardy dostają
`false`, co znaczy w nich jedną konkretną, twierdzącą diagnozę: kartę „integracja nie jest
podłączona". **Trzy różne stany świata - awaria, ładowanie i faktyczny brak konfiguracji -
dają jeden komunikat, i to komunikat orzekający.**

**Trzy uściślenia, bo pierwsza redakcja tej pozycji zbudowała zbyt mocną narrację.** Niezależna
próba obalenia wskazała je, a ja sprawdziłem każde:

1. **Redaktor nie ma do tej trasy pozycji w menu.** `src/lib/admin/adminNav.ts:363` wypycha całą
   grupę „analytics" warunkiem `if (isAdmin)`. Redaktor dociera tam adresem wpisanym ręcznie,
   linkiem sekcji „ruch" na pulpicie (`AdminDashboard.tsx:81`, renderowanym bezwarunkowo)
   albo przez `AdminBiStrip.tsx:125`. Ścieżka jest realna, ale nie jest ścieżką domyślną.
2. **Redaktor nie dostaje spójnego fałszu.** Pozostałe źródła tej strony też są admin-only,
   więc reszta panelu pokaże mu własne błędy i puste stany. Para kart GSC/GA4 psuje diagnostykę
   na tle strony, która i tak jest dla niego zepsuta; nie tworzy wiarygodnego obrazu
   „wszystko działa, tylko integracje odpięte".
3. **Karta nie miga przy każdym wejściu.** Klucz `["analytics-status"]` jest współdzielony
   z `admin.analytics.index.tsx:625` i `admin.settings.analytics.tsx:272` i ma trzydziestosekundowy
   `staleTime`, więc przejście z przeglądu renderuje się z cache. Oba dashboardy stoją za leniwym
   ładowaniem, więc karta pojawi się tylko wtedy, gdy pakiet rozwiąże się szybciej niż zapytanie
   o status. To jest wyścig, nie pewnik.

**Dlaczego mimo to jest to defekt:** różnica między „integracja nie jest podłączona" a „nie mogłem
sprawdzić" to różnica między dwoma zupełnie innymi działaniami operatora. Pierwszy komunikat
odsyła do zakładki ustawień, żeby podłączyć coś, co jest podłączone. Wzorzec poprawny stoi
w tym samym repozytorium, w `admin.settings.analytics.tsx`, który rozróżnia te stany.

**Co zrobić:** rozróżnić trzy stany zapytania. W trakcie ładowania renderować stan pośredni
zamiast przekazywać `configured={false}`; przy błędzie renderować komunikat `role="alert"`
nad dashboardami. Prop `configured` ma znaczyć „sprawdziłem i nie jest skonfigurowane",
a nie „nie wiem".

**Czego NIE robić:** nie rozwiązuj tego przez `?? true` ani przez ukrycie karty. Operator
ma się dowiedzieć, że odczyt statusu się nie powiódł, a nie zobaczyć pustkę.

**Kryterium odbioru:** test trasy, w którym zapytanie o status odrzuca błędem uprawnień i ekran
**nie** pokazuje karty „nie skonfigurowano", tylko komunikat o nieudanym odczycie; oraz test,
w którym zapytanie jeszcze trwa i karta „nie skonfigurowano" również się **nie** pojawia.

---

## 3. Pozycje pokryciowe - dług, który nie jest defektem

**B1. Powierzchnia produktowa modułu musi dostać progi per-ścieżka.** 129 plików i 17 310 wierszy,
czyli 54,4% powierzchni produktowej, nie ma dziś żadnej bramki. Zacznij od plików, których dotyczą
defekty tego zlecenia (`$.tsx`, `__root.tsx`, `documentCache.server.ts`, `sitemapEntries.server.ts`,
`admin.seo.tsx`, `admin.analytics.bi.tsx`), bo tam i tak piszesz testy.

**B2. `src/lib/server/tenant.server.ts` (344 wiersze) nie ma progu.** To jest warstwa izolacji
najemcy. Niezależnie od reszty pracy ten jeden plik powinien dostać bramkę.

**B3. Osiem plików bez importu w korpusie testowym** (372 wiersze): `lib/server/sitemapRequest.server.ts` (84),
`lib/cart/useCart.ts` (75), `lib/ssr/pruneUnresolvedQueries.ts` (51), `routes/admin.i18n.tsx` (51),
`lib/dock/queryPolicy.ts` (41), `lib/time/useNowMs.ts` (39), `routes/admin.monetization-ledger.tsx` (22),
`routes/admin.members.tsx` (9).

**Uwaga metodologiczna:** dla tego modułu liczba 0,8% jest **myląca jako miara długu**. Trasy są
importowane pośrednio przez drzewo tras, więc kryterium „brak importu w testach" wykrywa tu znacznie
mniej niż w design systemie. Audyt mówi o 1 380 niepokrytych liniach i 21 plikach na zerze; te dwie
liczby są tu właściwą miarą, a nie 0,8%. Zmierz je sam przed startem.

---

## 4. Czego dowód nie obejmuje - do rozstrzygnięcia, nie do wykonania

1. **Procenty pokrycia modułu na `967cec9`.** Nie zmierzone (patrz ostrzeżenie na górze).
2. **`admin.paywall.tsx` (1 150 wierszy, największe zero wg audytu) NIE został w tym przebiegu
   przeszukany pod kątem defektów** - wszedł do zlecenia wyłącznie jako pozycja rozdz. 0.3 i B1.
   To samo dotyczy `admin.super.mobile-drawer.tsx`, `admin.authors.tsx` i `admin.monetization.tsx`.
   Nieobecność defektu w tym zleceniu **nie jest** dowodem, że go tam nie ma.
3. **`src/lib/ci/**` (40 plików, 15 316 wierszy, 92,7% bez progu) nie był przedmiotem rozpoznania.\*\*
   Do rozstrzygnięcia osobną decyzją: czy narzędzia kontrolne mają podlegać tym samym progom,
   co kod produktowy, czy stanowić osobną jednostkę pomiarową.
4. **Rozstrzygnięcie 41 tras między modułem 20 a modułami treści** (rozdz. 14.9 audytu, pozycja 6)
   pozostaje otwarte i zmieni mianownik tego modułu. Nie rozstrzygaj go przy okazji tego zlecenia.
5. **Brak pliku `ai-gateway.server.ts`** wskazanego przez audyt jako 71 linii na zerze.

---

## 5. Zasady, których nie wolno złamać

1. **Nie obniżaj żadnego progu w `vitest.config.ts`.** Progi są zapadką: wolno je wyłącznie podnosić.
2. **Nie pomijaj, nie wyłączaj i nie kwarantannuj testu**, żeby uzyskać zieleń.
3. **Nie dopisuj `as any` ani `: any`.**
4. **Nie zamrażaj zegara przez `vi.setSystemTime` w bloku `describe`** bez odmrożenia.
5. **Nie licz na to, że test renderujący bez asercji coś mierzy.**
6. **Zmiana w SQL idzie nową migracją**, nie edycją migracji już zastosowanej.
7. **Nie rozszerzaj zakresu PR-a poza moduł 20.** Jeżeli A4 wymaga ruszenia predykatu wspólnego
   z odczytami publicznymi wydarzeń, opisz to w PR-ze jako świadome przekroczenie granicy modułu.
8. **Nie używaj znaku U+2014 (długiej kreski) w plikach tego repozytorium.** Sprawdzisz siebie
   poleceniem `LC_ALL=C.UTF-8 grep -nP "\x{2014}" <plik>` - ma nie wypisać nic.

---

## 6. Standard kodu

- Test loadera SSR sprawdza **rozróżnienie stanów** (sukces, degradacja, brak treści), a nie tylko
  ścieżkę sukcesu.
- Test polityki cache sprawdza **wartość nagłówka**, nie obecność wywołania.
- Test kolektora sitemapy sprawdza, że wiersz bramkowany **nie wychodzi**, a nie że publiczny wychodzi.
- Nazwy testów po polsku, w trybie orzekającym, opisujące zachowanie.
- `prettier --check .` i `eslint .` mają przechodzić przed wysłaniem PR-a.

---

## 7. Kryterium odbioru całości

1. **A1 i A2 zamknięte** (blokujące), każdy z uzasadnieniem wybranej drogi w opisie PR-a.
2. **A3, A4, A5 i A6 zamknięte** albo świadomie odłożone z uzasadnieniem w PR-ze.
3. **Progi per-ścieżka dla plików dotkniętych tą pracą** (B1) oraz dla `tenant.server.ts` (B2).
4. **Pokrycie linii modułu nie niższe niż 90%** i **funkcji nie niższe niż 88%**, zmierzone
   poleceniem z rozdz. 0. Progi są niższe niż w dwóch pozostałych zleceniach tej serii świadomie:
   ten moduł ma 31 845 wierszy powierzchni produktowej i 1 380 niepokrytych linii, więc skok
   do 92% w jednym PR-ze byłby obietnicą bez pokrycia w czasie.
5. **`bun run verify:blocking` przechodzi.**
