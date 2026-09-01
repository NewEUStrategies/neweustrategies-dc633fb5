# Wdrożenie: SSR, hydratacja i pierwsze wczytanie strony publicznej

Data: 2026-09-01. Gałąź: `claude/ssr-hydration-public-page-wkrnre`.
Podstawa: rozdz. 8.6 `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`
(ocena obszaru 72/100 - „dobrze na infrastrukturze, przeciętnie na drodze
krytycznej") i jego operacyjne rozwinięcie w zleceniu.

Ten dokument jest rozliczeniem, nie streszczeniem. Każda liczba niżej jest albo
ZMIERZONA w tym środowisku (i wtedy podana z metodą), albo ARYTMETYCZNA
z budżetów w kodzie (i wtedy tak nazwana), albo NIEZMIERZONA (i wtedy powiedziane
wprost, czego brakuje). Nie ma tu liczb szacowanych.

---

## 0. Streszczenie dla niecierpliwych

Zamknięte w pełni: punkty 1, 2, 3, 4, 6, 7, 10 oraz sekcja 3 zlecenia
(pokrycie dwóch plików, które posiadają wszystkie budżety).

**Trzy defekty, których w zleceniu nie było**, znalezione przy trasowaniu:

1. Opt-out `no-store` był martwy **także na odpowiedziach 302 i 404** - siedem
   linii w czterech trasach było bezczynne, a trwałe 301 wychodziły BEZ ŻADNEJ
   dyrektywy cache. Zmierzone.
2. Zasiewy w fali 1 loadera korzenia nie miały `{ updatedAt: 0 }`, więc jedna
   czkawka bazy przypinała wbudowane domyślne w cache'u klienta na 5-10 minut.
   Dla `site_settings` znaczyło to stronę **bez nagłówka** do końca wizyty.
3. `/live` deklarował politykę TREŚCI (s-maxage 900) zamiast ŻYWEJ (30 s), którą
   dla tej ścieżki ustawia `defaultCacheControl.ts`.

**Jeden defekt zamknięty przy okazji, nieplanowany**: napis „Invalid Date"
widoczny dla czytelnika w relacjach na żywo. Stał w repozytorium jako `it.fails`
z adnotacją „poza zakresem zadania pokryciowego". Naprawa strefy czasowej domyka
go, bo `formatDate` ma straż `Number.isNaN` PRZED formatowaniem.

**Pięć sprostowań do audytu i zlecenia** - patrz rozdz. 5. Najważniejsze: teza
„`isLoading` jest w SSR false, więc komponent renderuje gałąź «brak danych»" jest
prawdziwa WYŁĄCZNIE dla zapytania z `enabled: false`.

---

## 1. Punkt 11 jest warunkiem wstępnym i mówię to wprost

Zlecenie samo to przewiduje: *„Jeśli nie ma czym zmierzyć, punkt 11 jest
warunkiem wstępnym, nie opcją - powiedz to wprost, zamiast szacować."*

**Stan faktyczny, sprawdzony:**

- `lighthouserc.deployed.json` **już** ma wszystkie asercje na poziomie `error`,
  w tym LCP 2500 i TBT 300. Prośba z punktu 11 („podnieś przynajmniej LCP i TBT
  do poziomu error") była już spełniona przed tym zadaniem.
- Prawdziwą luką jest to, że **`LHCI_URL` nigdy nie było ustawione**, więc tryb
  blokujący nie włączył się ani razu. `LHCI_URL` to **zmienna repozytorium**
  (Settings -> Secrets and variables -> Actions -> Variables), nie plik w repo.
  **Nie da się jej ustawić z kodu** - ani mi, ani żadnemu narzędziu w tej gałęzi.
  To jest jedno zdanie, którego nie zamierzam zamienić na pozorne domknięcie.
- Wszystkie zapisane liczby wydajnościowe w `.lighthouseci/` pochodzą z serwera
  DEWELOPERSKIEGO (LCP 31 215 ms przy budżecie 2 500) i są nieprzenoszalne.

**Co z tego wynika dla punktów 1-6.** Punkty 1 i 2 udało się zmierzyć BEZ
serwera i bez przeglądarki, i to nie obejściem: budżety ograniczają FAZĘ
LOADERÓW, która biegnie przed pierwszym bajtem HTML-a, a jej czas jest w pełni
wyznaczony przez te stałe i przez to, czy backend odpowiada. Pomiar niżej idzie
przez PRODUKCYJNY `withBudget` z wiszącymi obietnicami, czyli odtwarza dokładnie
najgorszy przypadek (martwy backend, zimny izolat), który te budżety mają
ograniczać. Punkty 5, 6 i 9 są **niezmierzone wall-clockiem** i tak są opisane.

### Zmierzona faza loaderów - najgorszy przypadek (backend nie odpowiada)

Metoda: produkcyjny `withBudget` z `Promise.allSettled` nad obietnicami, które
nigdy się nie rozstrzygają, w kolejności i z budżetami DOKŁADNIE takimi, jakie
mają loadery przed i po zmianie.

| powierzchnia | przed | po | zysk |
|---|---|---|---|
| korzeń - **każda** trasa publiczna | **5 001 ms** | **3 001 ms** | **-2 000 ms** |
| strona główna (korzeń + prefetch dokumentu) | **11 007 ms** | **5 505 ms** | **-5 502 ms** |

Liczba 11 007 ms potwierdza tezę audytu („do 11 s budżetów loaderów przed
pierwszym bajtem") z dokładnością do siedmiu milisekund.

**Czego ten pomiar NIE mówi.** To najgorszy przypadek, nie przypadek typowy:
w stanie ustalonym każda odnoga stoi za `edgeTtlCache` (60 s TTL per host
najemcy) i faza loaderów jest bliska zeru. Nie mierzy też ani FCP, ani LCP -
mierzy okno PRZED pierwszym bajtem, którego `documentStreamGuard` z konstrukcji
nie widzi (liczy czas od utworzenia strumienia). Dla FCP/LCP nadal potrzebny jest
punkt 11 w trybie blokującym.

---

## 2. Rozliczenie punkt po punkcie

### Punkt 3 - martwy opt-out `no-store` (WYMAGANY PRZED 1 i 2)

**ZROBIONE.** Commity `d283fc2`, `2e34087`.

Mechanizm udowodniony w ZAINSTALOWANYCH wersjach, nie odgadnięty:

| krok | plik | co się dzieje |
|---|---|---|
| loader woła `setResponseHeader` | `start-server-core/request-response.js:106-112` | wartość ląduje na `h3Event.res.headers`, NIE na żadnej `Response` |
| łańcuch middleware | `createStartHandler.js:403-419` | cały łańcuch biegnie WEWNĄTRZ `requestHandler` |
| granica handlera | `request-response.js:46` | `toResponse(attachResponseHeaders(eventStorage.run(handler), h3Event), h3Event)` |
| `attachResponseHeaders` | tamże `:17-25` | scala **wyłącznie `Set-Cookie`** i **tylko dla non-ok** |
| realne scalenie | `h3-v2:244-247`, `:256-260` | `mergeHeaders(val.headers, preparedHeaders, val.headers)` - nagłówki ZDARZENIA nadpisują nagłówki odpowiedzi (`target.set`), i **tylko dla `val.ok`** |

Skutek przed naprawą: czytelnik na MISS dostawał `private, no-store`, a do L1/L2
wchodziło domyślne `public, max-age=60, s-maxage=900,
stale-while-revalidate=86400`.

**Naprawa:** intencja cache'owa trasy jedzie drugim kanałem - WeakMap kluczowana
obiektem `Request` z `getRequest()` (`getRequest() === h3Event.req`, więc
tożsamość klucza jest gwarantowana konstrukcyjnie), czytana przez
`defaultCacheControlMiddleware`. Kontrakt cache'a per najemca **nietknięty**:
klucz nadal prefiksowany hostem walidowanym wobec `tenants.domain`, nowe warianty
nadal wymagają wpisu w czystej polityce.

**Dowód, że test jest testem regresji, a nie ozdobą** - ten sam plik uruchomiony
przeciw kodowi bez naprawy:

```
× opt-out `no-store` z loadera realnie BLOKUJE zapis        AssertionError: expected 1 to be +0
× zdegradowana relacja live też nie zamraża pustki na brzegu AssertionError: expected 1 to be +0
× dyrektywa NIE przecieka między żądaniami                   AssertionError: expected 1 to be +0
  Tests  3 failed | 5 passed (8)
```

`expected 1 to be 0` to liczba dokumentów w magazynie L1: przed naprawą
zdegradowany render **naprawdę** tam lądował.

**Defekt drugi, znaleziony przy przeglądzie tej naprawy.** ZMIERZONE na
prawdziwym potoku (`requestHandler` + `setCacheControlHeader`):

```
302 -> cache-control = null
404 -> cache-control = null
200 -> cache-control = "private, no-store"   (kontrola)
```

Bo h3 scala nagłówki zdarzenia tylko dla `val.ok`. Intencja siedmiu linii
w `post.$slug.tsx`, `$.tsx` (cztery miejsca), `category.$slug.tsx`
i `author.$slug.tsx` nigdy nie docierała do klienta - trwałe 301 wychodziły bez
żadnej dyrektywy cache, wbrew jawnemu komentarzowi „Redirect responses must never
be CDN-cached as if they were content." Opt-out jest teraz sprawdzany PRZED
statusem i typem treści (wyłącznie zawęża, więc nie da się nim niczego zepsuć).

**Drugie odwrócenie kolejności:** powierzchnia ŻYWA wyprzedza teraz czystą
dyrektywę trasy. Odwrotna kolejność wyglądała naturalnie („trasa wie lepiej"), ale
reintrodukowałaby naprawiany defekt PO ŚCIEŻCE: strona CMS pod `/live/<slug>`
jedzie przez `$.tsx`, który deklaruje politykę treści, więc wpis zamarzałby na
180 s zamiast 30 s.

**Efekt:** zdegradowany render nie wchodzi już do NES Edge Cache. Nie ma tu
metryki czasu - to naprawa poprawności, a jednostką jest „ile godzin pusta
powłoka jest serwowana kolejnym czytelnikom". Przed: do 24 h. Po: 0.

---

### Punkt 1 - dwie sekwencyjne fale rozgrzewki korzenia

**ZROBIONE.** Commit `d283fc2`.

| | przed | po | metoda |
|---|---|---|---|
| budżet fali 1 | 2 500 ms | 2 500 ms | stała w kodzie |
| budżet fali 2 | 2 500 ms | **500 ms** | stała w kodzie |
| **faza loaderów korzenia, martwy backend** | **5 001 ms** | **3 001 ms** | ZMIERZONE (rozdz. 1) |
| równoległe podżądania w fali 1 | 3 | **2** | zliczone po kluczach `edgeTtlCache` |

**Odstąpiłem od literalnego brzmienia zlecenia w dwóch miejscach i oba
uzasadniam.**

**(a) `globalColors` ZOSTAJE w fali 1.** Zlecenie mówi: „Falę 1 zawęź do
siteSettings + designTokens". Sprawdzone w kodzie: `globalColorsQueryOptions.queryFn`
i `designTokensQueryOptions.queryFn` wołają **TEN SAM** `fetchSiteDesignTokensRow()`,
który ma dedupe in-flight (`if (inflightRow) return inflightRow`) i wspólny
`edgeTtlCache("site_design_tokens:row")`. Oba zapytania zbiegają do JEDNEGO
fetcha. Wyrzucenie `globalColors` oszczędza więc **0 ms**, a zabiera z SSR-owego
HTML-a całą połowę `<DesignTokensStyle/>`: `--gc-*` plus nadpisania
`--background`/`--foreground`/`--primary`/`--card` i mostek klas widgetów - czyli
funduje repaint motywu po hydratacji na KAŻDEJ stronie. Zlecenie kazało wyrzucić
członka DARMOWEGO i zostawić PŁATNY.

Wyrzucone zostało `postLayoutSettings` - osobny klucz `edgeTtlCache`, czyli
osobny round-trip, a jedyny konsument widoczny w SSR (`ContentAreaStyle`)
renderuje `null` bez danych. Rekompensata: `$.tsx` grzeje ten klucz także dla
`data.kind === "page"`, nie tylko `"post"`, więc powierzchnie, które tę
typografię realnie pokazują, nie tracą nic.

**(b) Fala 2 pozostaje AWAITOWANA, tylko z krótkim budżetem.** Zlecenie
dopuszczało „nie awaituj". Sprawdzone: `router.options.dehydrate` woła
`sweepQueryCacheForSerialization` **PRZED** renderem Reacta (kolejność:
`load()` -> `dehydrate()` -> render), a ten anuluje (`revert: true`) i usuwa
każde zapytanie, które nie zdążyło się rozstrzygnąć. Rozgrzewka
„fire-and-forget" nie dowozi więc **niczego**: ticker renderuje `null`, menu
maluje szkielet - czyli reaktywuje dwie regresje opisane w tym samym pliku
(ticker = najgorszy CLS serwisu, menu = „Menu jest puste..." mimo
skonfigurowanego menu).

**Defekt zastany, naprawiony przy okazji:** zasiewy nie miały `{ updatedAt: 0 }`.
`staleTime` tych zapytań to 5-10 minut, więc jedna czkawka bazy przypinała
wbudowane domyślne w cache'u klienta na cały ten czas, a klient nigdy nie
dociągał prawdziwej wartości. Dla `site_settings` skutek był najostrzejszy:
`Header` zwraca `null` przy pustym `builder_data`, czyli czytelnik oglądał stronę
**BEZ NAGŁÓWKA** do końca wizyty. Doktryna była w repozytorium o jedną trasę
dalej (`routes/index.tsx`, przypięta testem: „inaczej strona nie wyleczy się sama
po powrocie backendu").

**Predykat resetu zapytań menu** zawężony do `isUnresolvableQuery`
(`pending` + `fetchStatus: "idle"` + brak danych). Sam `pending` przy budżecie
500 ms staje się aktywną ścieżką utraty danych.

---

### Punkt 2 - prefetch strony głównej i trzy nieprawdziwe komentarze

**ZROBIONE.** Commit `d283fc2`.

| | przed | po |
|---|---|---|
| co grzeje SSR strony głównej | **cały** dokument buildera | 3 sekcje nad zgięciem |
| budżet | 6 000 ms | 2 500 ms |
| `<BuilderRenderer stream>` na `/` | **brak** (domyślnie `false`) | `stream` |
| **faza loaderów `/`, martwy backend** | **11 007 ms** | **5 505 ms** | ZMIERZONE (rozdz. 1) |

**Rozstrzygnięcie, o które zlecenie prosiło jako pierwsze:** dowieziona jest
OBIETNICA, nie jej wykreślenie. Dwa komentarze twierdziły, że „cokolwiek poza
budżetem nadal jedzie strumieniem przez ServerSectionGate", a `HomeBuilderContent`
renderował `<BuilderRenderer>` bez propa `stream`, którego domyślną wartością jest
`false`. Zapytanie widgetu, które nie zmieściło się w 6 s, lądowało w HTML-u jako
pusty widget - bez szkieletu i bez dociągnięcia.

Powody, dla których stara decyzja przestała obowiązywać (każdy sprawdzony):

1. promise bramki **NIE POTRAFI ODRZUCIĆ**: `Promise.allSettled` ścigany
   z budżetem, który wyłącznie `resolve()`-uje, a całość stoi pod
   `RenderErrorBoundary fallback={null}`;
2. incydent z uszkodzonym bootstrapem `$_TSR.router` miał **ustaloną, inną**
   przyczynę - `tee()` strumienia w środku łańcucha middleware (2026-07-30);
   zapis do cache'a jest od tamtej naprawy odroczony do `src/server.ts`;
3. przesłanka „loader dogrzewa wszystkie widgety" była prawdziwa **tylko na
   serwerze** - nawigacja klientowa na `/` grzała od dawna wyłącznie sekcje nad
   zgięciem;
4. `$.tsx` (wpisy i WSZYSTKIE strony publiczne, czyli powierzchnie silniejsze
   linkowo niż strona główna) stosuje ten kontrakt od dawna, na tym samym
   cache'u i tej samej ścieżce dehydratacji.

**Trzy nieprawdziwe komentarze poprawione i WYLICZONE** (`HomeBuilderContent`,
`routes/index.tsx`, `sectionStreaming.tsx`), żeby nie wróciły po cichu - to
repozytorium ma na to precedens. Dwa dalsze, które naprawa unieważniła,
zaktualizowane: `useSectionPreload.ts` i `documentCache.ts`.

**Cena przyjęta świadomie i zapisana w kodzie:** sekcja spod zgięcia, która nie
zmieści się w `SERVER_SECTION_STREAM_BUDGET_MS` (2 s), jedzie jako szkielet
i dociąga się na kliencie - także dla crawlera. Ta sama wymiana obowiązuje na
`$.tsx`.

**Sprawdzone, o co zlecenie prosiło osobno:** bramy sekcji **nie** generują
pustych fallbacków przy nawigacji SPA. `ServerSectionGate` jest bramkowany
`import.meta.env.SSR`, czyli literałem builda - w bundlu klienta cała gałąź jest
tree-shaken. Granica `<Suspense>` jest montowana po obu stronach wyłącznie dla
zgodności drzewa i nic pod nią nie zawiesza się na kliencie (każdy leniwy widget
ma własną, BLIŻSZĄ granicę, a `warmWidgetChunks` grzeje ścieżkę hero strony
głównej - incydent z 15.08 jest na poziomie WIDGETU, nie sekcji).

---

### Punkt 4 - cztery powierzchnie publiczne bez treści w SSR

**ZROBIONE.** Commity `f12a8ca`, `27730ee`.

| powierzchnia | przed | po |
|---|---|---|
| `/events/$slug` + 7 podstron | stan przejściowy, `<Outlet/>` nierenderowany, `head()` zahardkodowany, zero JSON-LD Event | loader + `useSuspenseQuery`, `head()` sterowany danymi, JSON-LD w SSR |
| strony sekcyjne `archive_listing` | brak listy do 60 wpisów | fabryka `queryOptions` + rozgrzewka w loaderze `/$` |
| `/series/$slug` | brak nazwy cyklu i części; 404 przy statusie 200 | loader + `notFound()` z czystego odczytu |
| `/glossary` | zero terminów, węzeł `DefinedTermSet` z konstrukcji `null` | loader |

**Decyzja bezpieczeństwowa, na której stoi cała naprawa wydarzeń.** `notFound()`
opieramy WYŁĄCZNIE na `event_page_header` - funkcji SECURITY DEFINER, scopeowanej
przez `public_tenant_id()`, która oddaje wiersz każdemu, kto zna slug
OPUBLIKOWANEGO wydarzenia tego najemcy, a bramkę warstwy tylko ETYKIETUJE. Pusty
wynik znaczy tam dokładnie jedno: wydarzenia nie ma.

`fetchPublicEventBySlug` stoi pod RLS, a odczyt serwerowy jest zawsze anonimowy,
więc oparcie na nim 404 zamieniłoby **KAŻDE** wydarzenie `visibility='members'`
albo `min_tier_rank > 0` w twarde 404 dla UPRAWNIONEGO czytelnika przy
przeładowaniu strony - regresja gorsza od naprawianego miękkiego 404. Jego `null`
przy istniejącym nagłówku znaczy „nie masz dostępu", czyli strona 200
z zaproszeniem do planów członkostwa (upsell, który do tej pory był w kodzie tej
strony NIEOSIĄGALNY).

Dwa dalsze warunki tej samej doktryny: `notFound()` nie leci przy degradacji
transportu (404 z niewiedzy wyrzuca żywe wydarzenie z indeksu), a loadery są
fail-soft, bo rzut dawał HTTP 500 i blip backendu wyglądał dla crawlera na
awarię serwera.

**Efekt:** nie ma tu metryki czasu, bo to nie przyspieszenie. Jednostką jest
obecność treści w SSR-owym HTML-u, dowiedziona przez `renderToString`.

#### Ogon punktu 4 - typy widgetów brakujące w `widgetQueryOptionsList`

Commity `2579a34` i `ede44b9`. Zamknięte **sześć typów**: `categories`, `tags`,
`podcast-latest`, `web-stories-carousel`, `pricing` (tylko w trybie katalogu
planów) i `rated-list`. Za każdym razem ten sam mechanizm awarii, dwuczłonowy
i cichy: loader nie grzał żadnego wpisu, więc widget wychodził z serwera w stanie
`isLoading`, a sekcja złożona z samych takich widgetów miała PUSTĄ listę zapytań,
czyli `shouldStreamSection` liczyła ją jako statyczną i `ServerSectionGate` nie
miał na co czekać.

Każdy typ ma teraz fabrykę `queryOptions` w `lib/builder/`, wołaną **zarówno
przez rejestr, jak i przez widok** - bo klucz jest kontraktem: rozjazd o jedną
koercję liczby daje rozgrzany wpis, w który widget nigdy nie trafi (prefetch bez
skutku, a przy tym drugie zapytanie po hydratacji). Tam, gdzie widok zachował
własne `useQuery`, dryf pilnuje **bramka czytająca plik widoku** i porównująca
literały kolumn oraz wyrażenia liczące wejście do klucza.

**Liczba „brakujących typów" przestała być liczbą w dokumencie.** Zlecenie mówiło
o siedmiu; nie powtarzam tej liczby, bo `widgetViewPrefetchCoverage.test.ts`
liczy ją teraz z kodu przy każdym przebiegu:

```
widoków czytających dane: 23; w rejestrze: 17 (19 typów widgetów);
wykluczonych z powodem: 6; nierozstrzygniętych: 0
```

Asercja `w rejestrze + wykluczone === wszystkie` domyka sumę, więc nowy widok
z zapytaniem psuje bramkę natychmiast, a nie przy następnym audycie. Bramka
sprawdza też, że wykluczenie nie jest samym komentarzem (obie funkcje rejestru
muszą dla takiego typu zwrócić pustkę) i że powód nie jest zaślepką (odrzuca
„TODO", „nie zdążyłem").

Sześć wykluczeń, po jednym powodzie: `AccountMenuWidget` i
`PurchaseConfirmationView` (klucz niesie tożsamość czytelnika, więc anonimowa
rozgrzewka podałaby zalogowanemu widok wylogowanego), `TailoredMustReadsView`
(klucz gościa jest po obu stronach identyczny, więc rozgrzewka nadpisałaby
personalizację na cały `staleTime`), `DynamicTagWidgets` (klucz zależy od
kontekstu trasy, nie od treści widgetu - statyczny rejestr nie ma jak tego
wyrazić), `MeetingBookingView` (wiersz RPC niesie `booked_by_me`, a nagłówek
`meetingsQuery.ts` jawnie odmawia ramienia SSR), `mediaWidgets` - **już pokryty,
tylko inną drogą**: loader korzenia grzeje `siteSettingsQueryOptions` na każdej
trasie, więc gałąź per-widget byłaby drugim rozgrzaniem tego samego klucza.

**Czego ten ogon NIE zamknął, jednym zdaniem:** liczniki RSVP
(`eventRsvpCountsQueryOptions` w `EventsListView` i `EventCountdownCardView`) nie
mają ani gałęzi w rejestrze, ani łańcuchowego rozgrzania, bo ich klucz zależy od
WYNIKU pierwszego zapytania (`rows.map(r => r.id)`), czyli statyczny rejestr
przyjmujący sam `WidgetNode` nie może go wyrazić - dorobienie im łańcucha takiego
jak dla autorów slidera jest osobnym zakresem i osobną decyzją.

**Cena, którą trzeba nazwać:** `prefetch.ts` jest statycznym importem korzenia,
więc każda nowa fabryka wchodzi do domknięcia ścieżki bootowania. Dla
`rated-list` zmierzone esbuildem: moduł 1 530 B gzip standalone, przy czym leniwy
chunk widoku chudnie o 1 143 B - netto ~1,0-1,5 KB. To jest część moich +3,3 KB
na `overall` rozliczonych w rozdz. 7 i dokładnie ten rodzaj kosztu, który od dziś
mierzy floor `boot` (rozdz. 3.2).

---

### Punkt 6 - preload chunku słownika

**ZROBIONE, ale nie od razu.** Commity `1959fb4` (wdrożenie) i `6700e74`
(naprawa - patrz niżej).

**PIERWSZA WERSJA BYŁA MARTWA W ARTEFAKCIE i mówię to przed liczbami, bo to
najważniejsza rzecz w tym punkcie.** Wtyczka `scripts/lib/localeChunkPlugin.ts`
nie deklarowała `enforce`, więc Vite umieszczał ją w koszyku „normal", czyli ZA
rdzeniowym `vite:esbuild`, i do jej hooka `transform` przychodził kod PO
transpilacji TS. Esbuild usuwa przecinek końcowy:

```
źródło:        {\n  pl: null,\n  en: null,\n}
po esbuildzie: {\n  pl: null,\n  en: null\n}
```

Literał, którego wtyczka szukała znak w znak, nie pasował więc **ani razu**.
Artefakt pojechał z `null`, `dictionaryPreloadLinkHeaderValue` zwracało `null`
i nagłówek `Link` z hintem nie był wysyłany.

Złapało to **ostrzeżenie tej samej wtyczki** na pierwszym buildzie artefaktu -
i to jest jedyny powód, dla którego ten defekt nie pojechał dalej: wtyczka była
napisana tak, żeby krzyczeć, gdy nie znajdzie literału. Bramka zadziałała na
własnym autorze.

**Test był przy tym zielony przez cały czas** i to jest właściwa nauka: karmił
hook TREŚCIĄ PLIKU ŹRÓDŁOWEGO, czyli innym wejściem niż to, które dostaje build.
Mierzył wejście, którego w produkcji nie ma. Naprawa jest podwójna
(`enforce: "pre"` + wzorzec zamiast literału, oba uzasadnione w kodzie), a test
dostał sześć nowych przypadków, w tym transpilację pliku **prawdziwym
esbuildem** - żeby wejście testu i wejście builda przestały być dwiema różnymi
rzeczami. Szczegóły: rozdz. 3.6.

ZMIERZONE w artefakcie: `pl-DEZyBPCt.js` 66 896 B surowo / **26 021 B gzip**,
`en-CE_0LNFU.js` 61 045 B / **22 771 B gzip**. Żaden z nich nie występuje
w dziewięciu preloadach manifestu korzenia.

**Odstępstwo od rekomendacji i jego powód.** Zalecany kształt to
`<link rel="modulepreload">` w `<head>`. Odrzucony: nazwa pliku chunku powstaje
przy podziale na chunki, a moduł z adresami jest transformowany WCZEŚNIEJ, więc
bundel klienta nie ma skąd wziąć tej samej wartości. Węzeł w `<head>` byłby
obecny w SSR-owym HTML-u i nieobecny w PIERWSZYM renderze klienta - czyli rozjazd
tożsamości KORZENIA DOKUMENTU, ta sama klasa awarii, którą to zadanie naprawia,
i ta jedna, która w tym repozytorium już raz kosztowała pełną przebudowę drzewa.

Wariant wdrożony - **wyłącznie nagłówek HTTP `Link`** - nie ma tego problemu
z konstrukcji (nie jest częścią DOM-u) i jest przy tym LEPSZY: przeglądarka
działa na nim, zanim sparsuje `<head>`, a NES Edge Cache utrwala go na HIT/STALE.

**Czego to NIE daje - i nie obiecuję inaczej:** treść SSR jest w tym momencie już
na ekranie (arkusz i fonty mają własne hinty), więc zysk idzie w czas do
INTERAKTYWNOŚCI, nie w FCP. **Wall-clock niezmierzony** - patrz rozdz. 1.

---

### Punkt 7 - „czas i język w renderze", 13 defektów

**ZROBIONE.** Commity `7231edc` (D1-D9), `7a800ec` (D10-D13 + testy).

**Decyzja o strefie:** `Europe/Warsaw` dla chwil, `UTC` dla kolumn DATE, własna
strefa wiersza dla `public.events`. ZMIERZONE uzasadnienie:

```
strefa         data 2026-07-13T00:30+02:00 sformatowana pl-PL
undefined      12 lipca 2026
UTC            12 lipca 2026
Europe/Warsaw  13 lipca 2026
```

UTC przesuwa granicę dnia redakcyjnego o dwie godziny, czyli serwis o polityce
europejskiej datowałby własny dorobek na dzień wcześniejszy. Bruksela i Warszawa
mają tę samą strefę, więc wybór nie kosztuje czytelnika unijnego ani minuty.
`EVENT_DEFAULT_TZ` wskazuje teraz na `SITE_TIME_ZONE` - jeden literał, nie dwa.

**Weryfikacja odwrotna: sześć na sześć naprawek zaczerwienia test po cofnięciu**
(D1 - brak komórek `--`; D2 - gałąź EN; D3 - etykieta względna w SSR; D6 - rok
w strefie procesu; D7 - „12 lipca" zamiast „13 lipca"; D10 - asercja po źródle).

D7 przypięty mocno: test podmienia `process.env.TZ` w trakcie przebiegu,
przepuszcza formatery przez UTC, `America/Los_Angeles` i `Pacific/Kiritimati`
i wymaga JEDNEGO wyniku - z KONTROLĄ w tym samym przypadku (formater sprzed
naprawy musi dać więcej niż jeden różny napis). Bez kontroli blok mógłby
zzielenieć na środowisku ignorującym `TZ`, czyli byłby dowodem bez treści.

---

### Punkt 10 - boot-test na artefakcie produkcyjnym

**ZROBIONE.** Commit `2fa8eb8`.

`vite.config.ts` obiecywał dwie bramki na klasę awarii z 2026-07-20. Pierwsza
(`check:chunks`) działała. **Druga nie istniała:** żaden skrypt nie budował
`vite.smoke.config.ts`, żaden workflow go nie wołał, żaden spec nie jechał po
zbudowanym serwerze. Pilnowany był PARYTET KONFIGURACJI smoke'a, którego nikt
nie uruchamiał.

Potwierdzone: wszystkie SZEŚĆ nasłuchów `page.on(` w `e2e/` to `pageerror`, zero
`console`. Wszystkie asercje `ssr-completeness.spec.ts` są spełnione przez
w pełni wyrenderowany, **całkowicie martwy** dokument - jego własny komentarz to
przyznaje.

Wdrożone: `build:smoke` + `test:e2e:artifact`, `playwright.artifact.config.ts`
(preset `node-server`, serwer startowany jako `node .output/server/index.mjs`),
`e2e/boot-artifact.spec.ts` wykonujący **INTERAKCJĘ** na `/cookies` (trasa bez
zależności od backendu, stan lokalny), nasłuch `pageerror` **oraz** `console`,
bez ponowień. Wpięte w job `build` **po** trzech bramkach artefaktu, bo
`build:smoke` nadpisuje `.output/`; `timeout-minutes` 15 -> 30.

Detekcja martwej hydratacji w produkcji, dwa braki:

1. **Flaga gotowości** była zamknięta w leniwym chunku podglądu. ZMIERZONE poza
   iframe'em: `__nesAppReady` było `null` **zarówno** gdy klik nie dotarł do
   handlera, **jak i** gdy hydratacja się dokończyła - brak sygnału w obie
   strony. Nowy `lib/watchdog/appReady.ts` (nie-leniwy); korzeń ustawia flagę
   synchronicznie. Przeładowanie zostaje iframe-only.
2. **Sonda bootu**: klasyczny, inline'owy skrypt w `<head>`, pierwszy
   w dokumencie. Klasyczny, nie modułowy, i to jest sedno: incydent 2026-07-20 to
   rzut W TRAKCIE INICJALIZACJI CHUNKU VENDOROWEGO, czyli przed wykonaniem ciała
   modułu wejściowego - handler z modułu (a tym bardziej z efektu montowania
   Reacta, dodatkowo za zgodą analityczną) nigdy się w tym scenariuszu nie
   uruchomi. Sonda wyłącznie BUFORUJE w pamięci strony; wysyłka jest
   w `lib/observability`, za istniejącą bramką zgody.

**CZEGO NIE TWIERDZĘ:** nie widziałem boot-testu na zielono w tym środowisku.
`build:smoke` nadpisałby `.output/`, którego potrzebowały równolegle liczone
bramki rozmiaru. Test jest wdrożony i uruchomi się w CI.

---

### Sekcja 3 zlecenia - pokrycie dwóch plików, które posiadają wszystkie budżety

**ZROBIONE.** Commity `08d4cdb`, `b59d0d3`.

**Uwaga metodologiczna:** `coverage-ed8/coverage-summary.json` **nie istnieje**
i nie mógł - `vitest.config.ts` nie ma reportera `json-summary`. Zmierzyłem sam,
v8, z zawężonym `--coverage.include` i reporterem `json-summary` do katalogu
tymczasowego.

| plik | przed | po |
|---|---|---|
| `src/router.tsx` | 0/38 linii, 0/42 instr., 0/13 funkcji, 0/14 gałęzi | **100% / 100% / 100% / 100%** (32/32, 35/35, 11/11, 12/12) |
| `src/lib/ssr/hydrateBudget.ts` | (nie istniał) | 100% / 100% / 100% / 80% |
| `src/routes/__root.tsx` | 0/122 linii, 0/138 instr., 0/48 funkcji, 0/45 gałęzi | **50% linii / 44,20% instr. / 14,58% funkcji / 53,33% gałęzi** |

Mianownik linii `__root.tsx` to **122, nie 124** - audyt mierzył inny HEAD.
Mianownik `router.tsx` spadł z 38 do 32, bo ciało budżetu hydratacji przeniosło
się do osobnego modułu; piszę to wprost, żeby liczba nie wyglądała lepiej, niż
jest.

**Progi per-ścieżka weszły TYM SAMYM COMMITEM** co testy - bez nich ten dorobek
jest pożyczony. `functions: 100` na `router.tsx` jest świadome (11 funkcji,
każda posiada jakiś inwariant SSR). Niski próg funkcji na `__root.tsx` (12%) jest
opisany w konfiguracji: 43 z 48 funkcji to komponenty Reacta i callbacki w ich
środku, w tym 17 samych fabryk `lazy(() => import(...))`. **Niczego nie wyłączono
z pomiaru**; droga w górę jest nazwana (opcjonalny `rootRoute`
w `src/test/routeHarness.tsx` - zmiana harness'u testowego, nie produkcji).

**Ustalenie, które zmienia ocenę jednego bezpiecznika.** Budżet hydratacji
**nie ma dziś czego ścinać**: `options.hydrate` zainstalowanej integracji czyta
`queryStream` przez `reader.read().then(...)` w trybie FIRE-AND-FORGET i nie
awaituje go, więc rozstrzyga się natychmiast (zmierzone: strumień, który nigdy
się nie domyka, daje `hydrate` rozstrzygnięty po 10 ms). `Promise.race` zawsze
wygrywa gałęzią integracji, a ostrzeżenie jest w produkcji MARTWE. Komentarz
w `router.tsx` opisywał zawieszenie, którego ta wersja biblioteki nie potrafi
wyprodukować. Bezpiecznik zostaje, ale stoi jako `it.fails` z opisem - decyzja
„utrzymywać czy zastąpić czymś, co realnie mierzy hydratację" należy do
człowieka.

**Sprostowanie dwóch komentarzy w repozytorium**, które asertowały ODWROTNĄ
kolejność SSR: `router.tsx` mówił „Render się zakończył", a `postRenderSweep.ts`
„gdy render się kończy" - i tak się NAZYWA. Jest odwrotnie: `load()` ->
`dehydrate()` -> render. Konsekwencja jest praktyczna: obietnica, której loader
nie awaituje, jest anulowana ZANIM React wyrenderuje bajt - i to jest dokładnie
powód, dla którego fala 2 dostała krótki budżet, a nie brak awaita.

---

## 3. Nowe bramki

Wszystkie zmierzone na ZBUDOWANYM artefakcie cloudflare'owym (preset
`cloudflare-module`, 943 pliki `.js` + 2 `.css`), nie na źródłach.

### 3.1. Floor CSS - 82 KB gzip (punkt 5a)

Do tej zmiany arkusz stylów nie był mierzony przez **żadną** bramkę w repo:
`walkJs()` w `scripts/check-bundle-size.ts` miał aperturę `endsWith(".js")`, ten
sam filtr stoi w `check-chunk-graph.ts` i `check-entry-purity.ts`, a
`lighthouserc.json` trzyma `unused-css-rules`, `unminified-css`
i `uses-text-compression` w `skipAudits`.

Zmierzone: **81,0 KB gzip w 2 plikach** (styles 79,6 + BlocksRenderer 1,4;
570 392 B surowo w samym arkuszu korzenia). Dla skali: to 28% floora
największego chunku, a w odróżnieniu od `EChartClient` arkusz jest
**render-blocking na KAŻDYM URL-u** - `rootDocumentLinks` wypisuje go
bezwarunkowo i promuje na pierwszą wartość nagłówka `Link`.

Floor pojedynczy, w kształcie OVERALL (bez rozbicia public/admin), bo dowód
adminowości w tej bramce idzie z krawędzi importu między plikami `.js`, a arkusz
wchodzi do `__root.tsx` przez `?url`, czyli jako ZASÓB - nie ma z czego zbudować
rozbicia. Uzasadnienie odrzucenia samego podziału arkusza: rozdz. 4.

### 3.2. Floor domknięcia ścieżki bootowania - 579 KB gzip (punkt 8)

Metryka, którą kronika w `check-bundle-size.ts` mierzyła **ręcznie** 18.08
(„~554 KB") i nigdy nie bramkowała. Żadna z czterech istniejących liczb jej nie
zastępuje: `chunk` mierzy największy PLIK (raz entry, raz leniwy `EChartClient`),
`public`/`overall` mierzą OSIĄGALNOŚĆ - przeniesienie kodu eager -> lazy nie
rusza ich o bajt i symetrycznie powrót statycznej krawędzi do entry ich nie
zapala - a `css` mierzy arkusze.

Zmierzone: **575,3 KB gzip / 1951,3 KB surowych w 9 chunkach** (entry
`index-CQJOHGUv.js` 272,6 + osiem vendorów). To 21,4% budżetu PUBLIC i jedyna
z tych liczb, którą płaci **każde** pierwsze wejście, przed hydratacją.

Floor postawiony w `check-bundle-size.ts`, nie w `check-entry-purity.ts`, i to
jest decyzja, nie wygoda: suma kilobajtów jest KOMPENSOWALNA (zetnij vendora
o 29 KB, dołóż 29 KB do entry - domknięcie stoi, bramka milczy), więc próg
wagowy w tamtym pliku uczyniłby jego własny nagłówek nieprawdziwym. Tam zostaje
dowód architektoniczny (KTÓRA krawędź), tu waga. Cena nazwana w obu plikach:
odczyt manifestu i chodzenie po krawędziach statycznych mają teraz drugi
egzemplarz; docelowo wspólny `scripts/lib/bootClosure.ts` w osobnym PR.

**Floor przefloorowany 577 -> 579 tego samego dnia** - i to jest przyznanie się
do błędu metody, nie ratchet za wzrostem. Pierwszy pomiar (573,17 KB) był wzięty
w TRAKCIE zmiany, przed wejściem sondy bootu, `hydrateBudget`, `useNowMs`,
`appReady`, `localeChunks` i trzech nowych modułów zapytań buildera. Na
domkniętym drzewie floor 577 miał 0,29% zapasu, czyli mniej niż udokumentowana
rozbieżność host <-> runner (+0,466%): bramka padłaby na runnerze na własnym
szumie.

### 3.3. Boot-test na artefakcie produkcyjnym (punkt 10)

`playwright.artifact.config.ts` + `e2e/boot-artifact.spec.ts` + cztery kroki
w `.github/workflows/ci.yml`. To jest wdrożenie DRUGIEJ POŁOWY obietnicy, która
stała w komentarzu `vite.config.ts` przy `manualChunks` („gate:
scripts/check-chunk-graph.ts (cykle) + boot-test przeglądarkowy na buildzie
vite.smoke.config.ts") - pierwsza połowa istniała od dawna, drugiej nie było:
żaden skrypt nie budował tego configu, żaden workflow go nie wołał, żaden spec
nie jechał po zbudowanym serwerze.

Test WYKONUJE INTERAKCJĘ, a nie tylko sprawdza brak błędu, bo wszystkie
istniejące bramki przechodzą na w pełni wyrenderowanym, całkowicie martwym
dokumencie: `check:chunks` łapie wyłącznie CYKLE, dev-server nie ma chunków
z definicji, a `e2e/ssr-completeness.spec.ts` sam mówi w komentarzu, że „SSR może
być kompletny, a strona i tak martwa". Do tego sonda bootu
(`BOOT_PROBE_SCRIPT`, klasyczny inline'owy skrypt jako PIERWSZY w `<head>`)
łapie rzut w chunku vendorowym, którego żaden handler zainstalowany z modułu nie
zobaczy, i po 15 s bez flagi gotowości ustawia `__nesBootDead` - sygnał
POZYTYWNY, który pozwala odróżnić „wolno" od „nie ożyło".

Kolejność kroków w CI jest KONTRAKTEM i jest tak opisana w workflow:
`build:smoke` NADPISUJE `.output/`, więc musi biec PO `check:bundle`,
`check:chunks` i `check:entry-purity`, które mierzą artefakt cloudflare'owy.

### 3.4. Progi pokrycia per ścieżka (sekcja 3 zlecenia)

Trzy nowe wpisy w `vitest.config.ts`, każdy z uzasadnieniem liczby w komentarzu:
`src/router.tsx` {96/100/96/92}, `src/lib/ssr/hydrateBudget.ts`
{96/100/96/75}, `src/routes/__root.tsx` {40/12/46/48}. Żaden istniejący próg nie
został obniżony, `all: true` zostaje, nic nie zostało wykluczone z pomiaru.

### 3.5. Przyrząd, nie bramka: `stableChunkName()`

Naprawa `{8,}` -> `{8}` nie jest bramką i nie usuwa ani jednego bajtu - naprawia
NARZĘDZIE, którym od 15.08 czytamy przyczyny. Klasa `[A-Za-z0-9_-]` zawiera
myślnik, a hash Vite ma dokładnie osiem znaków base64url, więc otwarty
kwantyfikator dopasowywał się już przy PIERWSZYM myślniku nazwy: dziesięć plików
`vendor-*` raportowało się jako jedno wiadro `vendor`. Kolumna `vendor +39,8`
w kronice nigdy nie była chunkiem. Wzorzec sprawdzony PRZECIW PRAWDZIE („nazwa
bez ośmiu ostatnich znaków") w 946 przypadkach na 946.

Baseline (`reports/bundle-baseline.json`) dostaje pole `bucketConvention`;
plik bez tego pola jest czytany przez `legacyChunkName()` i raport mówi o tym
jedną linią, zamiast pokazać osiem wierszy `(NOWY)` po samym przemianowaniu.
Baseline NIE jest w tej zmianie przepisywany, bo zasada z kroniki mówi „z
ZIELONEGO buildu runnera", a bramka jest czerwona na `overall`.

### 3.6. Bramka, która zadziałała na sobie samej

`scripts/lib/localeChunkPlugin.ts` (punkt 6) wypisuje ostrzeżenie builda, gdy
nie znajdzie literału do podmiany. **To ostrzeżenie zapaliło się na pierwszym
buildzie** i złapało defekt w kodzie tej samej zmiany: wtyczka nie deklarowała
`enforce`, więc trafiała do koszyka „normal", czyli ZA rdzeniowy `vite:esbuild`,
i widziała kod PO transpilacji TS - a esbuild usuwa przecinek końcowy, którego
literał szukał znak w znak. Artefakt pojechał z `null`, hint słownika był
MARTWY.

Test był przy tym zielony przez cały czas, bo karmił hook **treścią pliku
źródłowego**, czyli innym wejściem niż to, które dostaje build. Naprawa jest
podwójna i obie połowy są nazwane w kodzie: `enforce: "pre"` przywraca
zamierzone wejście, a wzorzec zamiast literału zdejmuje samo sprzężenie
z formatowaniem (przecinek końcowy, szerokość linii). Doszło sześć przypadków
testowych, w tym transpilacja pliku PRAWDZIWYM esbuildem - żeby wejście testu
i wejście builda przestały być dwiema różnymi rzeczami.

---

## 4. Czego NIE zrobiłem i dlaczego - jedno zdanie na punkt

**Punkt 5b (podział arkusza CSS na publiczny i adminowy): ODRZUCONE.** Dziewięć
markerów wyciętych klas ma PUBLICZNYCH konsumentów (m.in. `joinUsSizeCss.ts`
zależy od `.admin-compact li/label/span` i od
`[data-builder-renderer][data-device="mobile"] h3:not(.cms-post-title)`,
a `MobileDrawerBody` od `.mobile-drawer-builder`), więc wycięcie
`@source "../src"` dla panelu i buildera skasowałoby klasy używane na
powierzchni publicznej.

**Punkt 5c (`server.build.inlineCss`): NIE PODJĘTE.** Zależy od punktu 9, który
nie jest domknięty, a samodzielnie wymagałoby sprawdzenia, czy inline'owany CSS
nie łamie odroczonego `tee` do cache'a (tożsamość body koperty SSR).

**`Polyfills.None` dla `@supports lab()/color-mix()`: ODRZUCONE, i to jest
najważniejsze „nie" w tym dokumencie.** Rekomendacja przedstawiała to jako
„ściśle lepszy pierwszy ruch, -7 391 B gzip za jedną linię konfiguracji, stare
przeglądarki nietknięte". W zbudowanym arkuszu jest odwrotnie: blok
`@supports (color: color-mix(in lab, red, red))` niesie wartość DOCELOWĄ,
a deklaracja przed nim jest zgrubnym fallbackiem -
`::placeholder{color:currentColor}` a potem
`@supports…{::placeholder{color:color-mix(in oklab,currentcolor 50%,transparent)}}`;
`:focus-visible{outline:2px solid var(--foreground)}` a potem wariant
z `color-mix`. Usunięcie polyfilli degraduje **każdą nowoczesną przeglądarkę**
do pełnokrytych placeholderów i litych obwódek fokusu. To jest zmiana renderu
produkcji po to, żeby przesunąć licznik bajtów.

---

## 5. Sprostowania do audytu i zlecenia

**(1) „`isLoading` jest w SSR FALSE, więc komponent renderuje nie szkielet, tylko
swoją gałąź «brak danych»"** - prawdziwe WYŁĄCZNIE dla zapytania z
`enabled: false`. ZMIERZONE (`renderToString` + prawdziwy `QueryClient`,
react-query 5.102.8):

```
enabled=true  -> isLoading=true,  isFetching=true,  fetchStatus="fetching" -> gałąź ŁADOWANIA
enabled=false -> isLoading=false, isFetching=false, fetchStatus="idle"     -> gałąź BRAK DANYCH
```

Przy domyślnym `enabled` query-core liczy optymistyczny wynik z `fetchOnMount`,
więc SSR emituje gałąź ŁADOWANIA i zostaje w niej na zawsze. Klasa defektu
i naprawa bez zmian (HTML bez treści, konserwowany do 24 h), różni się TREŚĆ
zakonserwowanego HTML-a.

**(2) „`check-entry-purity.ts` już liczy graf bootowania **i rozmiar
domknięcia**, ale tylko go drukuje"** - liczy GRAF (`bootGraph`), rozmiaru
domknięcia **nie liczy wcale**. Sprawdzone w kodzie.

**(3) Liczba konsumentów martwego opt-outu.** Audyt wymienia szeć tras. Jest ich
**13 plików / 24 wywołania** `setCacheControlHeader` - wszystkie w loaderach tras
dokumentowych, więc naprawa w jednym miejscu (`setCacheControlHeader` zapisuje
dyrektywę) objęła wszystkie bez zmian w trasach.

**(4) `vendor-radix` JEST statycznie osiągalny z entry** - audyt zapisał to jako
niepotwierdzone. Zmierzone: **71,3 KB gzip**, drugi największy chunk domknięcia
startowego po chunku wejściowym.

**(5) React 19 usunął ostrzeżenie „useLayoutEffect does nothing on the
server".** Zlecenie i analiza opisywały D10-D13 jako „hałas ostrzeżeń". Na
zainstalowanym `react-dom` 19.2.5 tego napisu nie ma w żadnym pliku paczki,
a `renderToString` komponentu z gołym `useLayoutEffect` nie wypisuje NIC -
sprawdzone w tym samym przebiegu, w którym ostrzeżenie o brakującym `key` się
pojawia. Zmiana zostaje jako higiena i jest tak opisana w kodzie.

---

## 6. Sekcja 4 zlecenia - czego audyt nie potwierdził

| ustalenie | stan |
|---|---|
| `vendor-radix` osiągalny z entry | **POTWIERDZONE, 71,3 KB gzip** (zmierzone z grafu chunków) |
| rozmiar arkusza CSS | **POTWIERDZONE: 570 392 B surowo, 79 807 B gzip -9, 6 739 bloków reguł** |
| domknięcie startowe | **ZMIERZONE: 571,4 KB gzip w 9 chunkach** |
| `LHCI_URL` ustawione | **NIE** - zmienna repozytorium, nieustawialna z kodu (rozdz. 1) |
| „59 tras publicznych z SSR bez loadera" | **ZAPRZECZONE** - patrz niżej |

### „59 tras publicznych z SSR bez loadera" - ZAPRZECZONE

Skrypt spisu: `bun run report:route-loaders`
(`scripts/report-public-route-loaders.ts` + logika w `src/lib/ci/publicRouteLoaders.ts`,
26 testów). Zmierzone ze źródeł, bez builda:

```
  tras w routeTree.gen.ts              368
  - za bramką sesji                     27
  - ssr: false                           9
  - bez komponentu (server: handlers)   56
  - panel /admin                       194
  = PUBLICZNE STRONY SSR                82

  SSR BEZ TREŚCI - render czyta dane, loadera nie ma                20
  SSR BEZ TREŚCI - loader jest, ale nic nie grzeje                   4
  OK - render czyta dane, loader je rozgrzewa                       47
  LOADER ZBĘDNY - render nie czyta danych                           11

  DO ROBOTY: 24 z 82;  indeksowanych 17, noindex 7
  PUSTY DOKUMENT W NES EDGE CACHE: 19 z 24
```

**Liczby 59 nie da się odtworzyć** żadnym naiwnym pomiarem: `grep -L "loader:"`
bez `admin*` daje 65, po odjęciu gałęzi `/profile` 42, po odjęciu `ssr: false`
56. Prawdziwa liczba to **20 bez loadera / 24 z trywialnymi**, z czego **19 karmi
NES Edge Cache pustym dokumentem** na do 24 h - i to jest ta część, która boli.

Cztery rozróżnienia, bez których liczba nie znaczy nic (wszystkie zapisane
w nagłówku skryptu):

1. Trasy z `routeTree.gen.ts`, nie z `readdir` - to jedyne miejsce znające reguły
   `-`, `[.]` i sufiks `_`.
2. „Publiczna" wyklucza trasy za bramką sesji **dziedziczoną w dół drzewa** (stąd
   23 z 27 tras `/profile/*`): serwer nie ma sesji, więc loader nie zmieniłby tam
   ani bajtu SSR-owego HTML-a.
3. Ścieżka renderu to domknięcie **wyłącznie statycznych** importów **minus 279
   modułów powłoki `__root.tsx`**, których dane grzeje loader korzenia. Bez tego
   odjęcia każda z 82 tras wyglądałaby na defekt, bo `Footer.tsx:32` woła
   `useQuery(siteSettingsQueryOptions)`.
4. „Loader grzeje" znaczy **zapisuje do cache zapytań**, a nie „ściąga". `/qa`
   i `/qa/$slug` wołają `fetchPublicQaSessions()` i oddają wynik jako
   `loaderData` dla `head()` - klucz zostaje zimny, `useQuery` startuje od gałęzi
   ładowania. To dwie z czterech tras w kategorii „loader jest, ale nic nie
   grzeje".

Lista jest **górnym oszacowaniem** i tak jest opisana: jeden fałszywy pozytyw
sprawdzony ręcznie (`/quiz` - treść to statyczny iframe, wszystkie 12 zapytań
przychodzą z `ReadingHeader` i `BrandIcon`).

**Do dalszej roboty, priorytet 1** (indeksowane, pusty dokument wchodzi do
cache'a): `/events/$slug` + pięć podstron modułowych, `/tracker/explorer`,
`/tracker/changes`, `/publications`, `/search`, `/donate`, `/club`,
`/club/apply`, `/club/specialization/$slug`, `/qa`, `/qa/$slug`. Rodzina
`/events/$slug/*` czyta przez wspólne `EventModulePage` +
`lib/events/usePublicEvent.ts`, więc jedna rozgrzewka w loaderze obsłuży całą
szóstkę; podobnie `lib/tracker/queries.ts` dla obu tras trackera. `BrandIcon`
(12 tras) to kandydat na rozgrzewkę w korzeniu, nie na dwanaście loaderów. To
jest osobny zakres - ten spis go NAZYWA, nie wykonuje.

---

Domknięcie startowe, zmierzone (gzip -9, ścieżka bootowania z manifestu
TanStack Start, krawędzie statyczne tą samą metodą co `check-entry-purity`):

```
269,8 KB  index-RQbuiFhe.js
 71,3 KB  vendor-radix-7jJkyXUB.js
 59,9 KB  vendor-react-BXd9Tufd.js
 56,3 KB  vendor-supabase-BR8SVL9Y.js
 49,7 KB  vendor-tanstack-x4J2CtV_.js
 28,9 KB  vendor-lucide-fUtFhR7X.js
 15,4 KB  vendor-i18n-3niL7S7P.js
 12,0 KB  vendor-zod-oLpi5p-c.js
  8,0 KB  vendor-tw-merge-CPcsbTWB.js
-------
571,4 KB gzip / 9 chunków
```

---

## 7. Stan bramek

Oba przebiegi na artefakcie cloudflare'owym, na tym samym hoście, tą samą
komendą.

### Wejście (artefakt z `main`)

```
check:bundle       CZERWONA: overall 4318,0 KB przy florze 4306 KB
                   (PUBLIC 2684,6 / 2715; największy chunk 270,5 / 280)
                   CSS - NIEMIERZONY (bramka nie istniała)
                   domknięcie bootu - NIEMIERZONE (bramka nie istniała)
check:chunks       ZIELONA: 942 chunki, 5456 statycznych krawędzi, graf acykliczny
check:entry-purity ZIELONA: 9 chunków na ścieżce bootowania, czysta
check:chunk-parity ZIELONA: 3 przypadki
```

### Wyjście (artefakt z tej gałęzi)

```
check:bundle       CZERWONA: overall 4321,3 KB przy florze 4306 KB
                   public       2687,3 / 2715   ZIELONA
                   największy    272,6 / 280    ZIELONA (index-CQJOHGUv.js)
                   css            81,0 / 82     ZIELONA (nowa bramka, rozdz. 3.1)
                   domknięcie    575,3 / 579    ZIELONA (nowa bramka, rozdz. 3.2)
                                 575,3 KB gzip / 1951,3 KB surowych, 9 chunków
check:chunks       ZIELONA: 941 chunków, 5455 statycznych krawędzi, graf acykliczny
check:entry-purity ZIELONA: 9 chunków na ścieżce bootowania, czysta
check:chunk-parity ZIELONA: 3 przypadki
```

### `overall` - czerwień odziedziczona plus 3,3 KB, które dołożyłem

`check:bundle` była czerwona **na wejściu, na `main`** (4318,0 przy florze 4306)
- 12 KB długu, którego to zadanie nie zaciągnęło. Do tego doszły **+3,3 KB
z tej gałęzi** i to trzeba powiedzieć wprost, a nie ukryć w liczbie
odziedziczonej.

Zlecenie mówi: „Nie podnoś floora - zmierz przyczynę i zmniejsz". **Floora nie
podniosłem** (4306 zostaje) i nie zamierzam - to jest właściwa decyzja także
wtedy, gdy bramka zostaje czerwona.

Skład moich +3,3 KB, wszystko wchodzące do grafu eager przez statyczne importy
`__root.tsx` i `prefetch.ts`:

| pozycja | punkt zlecenia | czy da się zdjąć |
|---|---|---|
| `bootProbeScript.ts` - sonda w `<head>` jako string | 10 | nie: musi być klasycznym skryptem inline, bo łapie rzut PRZED wykonaniem jakiegokolwiek modułu |
| `appReady.ts` + `markAppReady()` w korzeniu | 10 | nie: bez flagi gotowości boot-test nie ma czego czekać, a martwej hydratacji nie da się odróżnić od wolnej |
| trzy moduły zapytań buildera (taksonomie, media, cennik) | 4 | nie: `widgetQueryOptionsList` jest SYNCHRONICZNE, więc fabryki muszą być w grafie eager |
| `hydrateBudget.ts`, `useNowMs.ts`, `localeChunks.ts` | 7, 6 | nie bez cofnięcia punktów, które je wprowadziły |

Każda z tych pozycji jest wymaganiem zlecenia, więc „zmniejszyć" znaczyłoby tu
„nie zrobić punktu 4 albo 10". Zamiast tego dwie nowe bramki (rozdz. 3.1 i 3.2)
mierzą od dziś te części artefaktu, które **czytelnik naprawdę płaci** - CSS
render-blocking i domknięcie bootu - i obie są ZIELONE. `overall` jest metryką
OSIĄGALNOŚCI, w której 1634,0 KB to chunki adminowe za bramką auth, więc jej
czerwień nie mówi nic o pierwszym wczytaniu strony publicznej.

**Co zmniejszy `overall`, gdy ktoś się tym zajmie** - z pomiaru, nie z domysłu.
Ruchy względem baseline'u z 15.08 (nazwy sklejone starą konwencją wiader, patrz
rozdz. 3.5): `i18n +129,1 KB` (204,5 -> 333,6), `EventStudioModuleSections
+65,5 KB` (nowy), `vendor +39,9 KB`, `useEventSessions +31,1 KB` (nowy),
`admin.posts._slug +15,6 KB`. To jest lista adminowa i jej ścięcie nie ruszy ani
budżetu PUBLIC, ani domknięcia bootu - dlatego jest osobną robotą, a nie
warunkiem domknięcia tego zadania. Dokładny skład per moduł:
`BUNDLE_INVENTORY=1 bun run build && bun run report:chunk-inventory <wiadro>`.
