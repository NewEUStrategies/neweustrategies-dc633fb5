# Renderowanie, SSR i hydratacja - odpowiedź na raport Core Web Vitals z 2026-09-17

Branch: `claude/lucid-cannon-q3nieq`. Baza: `main` w stanie z 2026-09-17.

Status: zmiany kodu wykonane i przepuszczone przez typecheck, lint i testy
jednostkowe repozytorium. **Żadna liczba produkcyjna nie została tu zmierzona
ponownie** - środowisko, w którym powstał ten commit, nie ma dostępu do
prywatnego rejestru pakietów (`europe-west4-npm.pkg.dev`, HTTP 403) ani do
`cdn.sheetjs.com`, więc `bun run build` / `build:smoke` nie dają się wykonać,
a `scripts/measure-home-ssr.ts` nie miał czego odpytać. Wszystko poniżej, co
jest liczbą produkcyjną, pochodzi z raportu zlecającego; wszystko, co jest
twierdzeniem o kodzie, pochodzi z odczytu źródeł i jest przypięte testem.

---

## 1. Co mówią zgłoszone liczby, zanim cokolwiek zmienimy

Raport podaje dla każdej ścieżki osobno FCP i TTFB. Zestawione obok siebie dają
rozstrzygnięcie, którego sam raport nie wyciąga:

| Powierzchnia   | TTFB p75 | FCP p75 | FCP − TTFB |
| -------------- | -------: | ------: | ---------: |
| globalnie      |   2,52 s |  3,10 s |     0,58 s |
| `/`            |   3,19 s |  3,62 s |     0,43 s |
| `/blog/<wpis>` |   2,81 s |  3,05 s |     0,24 s |
| `/admin`       |   3,15 s |  4,52 s |     1,37 s |

**FCP na powierzchniach publicznych jest w całości pochodną TTFB.** Od pierwszego
bajtu do pierwszego malowania mija 0,24-0,58 s, co jest wynikiem dobrym i
oznacza, że krytyczna ścieżka CSS/fontów działa jak zaprojektowano. Trzy
rekomendacje raportu dla FCP nie mają więc w tym wdrożeniu przedmiotu:

- _„Wyeliminuj render-blocking third-party (fonty Google, tag manager przed
  critical CSS)"_ - serwis **nie ładuje** Google Fonts. Red Hat Display jest
  self-hostowany przez `@font-face` w `src/styles.css`, a preload woff2 jedzie
  zarówno `<link>`-iem, jak i nagłówkiem HTTP `Link`
  (`src/lib/seo/rootHead.ts`). Tag Google jest `async` i stoi za zgodą
  (`src/routes/__root.tsx`, `head().scripts`).
- _„Włącz SSR streaming"_ - strumieniowanie **jest** włączone: sekcje spod
  zgięcia idą przez `ServerSectionGate`, a powłoka flushuje się natychmiast
  (`src/routes/index.tsx`, komentarz przy `prefetchAboveFoldQueries`).
  Strumieniowanie przesuwa moment domknięcia dokumentu, a nie moment pierwszego
  bajtu - na metrykę, która jest tu wąskim gardłem, nie działa.
- _„Skróć krytyczną ścieżkę CSS, font-display: swap"_ - już zrobione; delta
  FCP − TTFB to potwierdza.

`/admin` jest jedyną powierzchnią z dużą własną deltą (1,37 s) i jedyną z
rażącym CLS - i to ona dostała w tym commicie realne zmiany zachowania.

## 2. Co zostało zmienione

| Plik / punkt wejścia                                                                                      | Kontrakt                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [clientOnlyDocument.ts](../src/lib/routing/clientOnlyDocument.ts)                                         | Nowy predykat: dokument bez serwerowego renderu treści I bez chrome'u. Dziś dokładnie jedna powierzchnia - `/admin`. Termin fali 1 to 300 ms zamiast 2 500 ms.                                               |
| [\_\_root.tsx](../src/routes/__root.tsx)                                                                  | Trzeci, rozłączny wariant terminu fali 1 (obok strony głównej i reszty serwisu). Trzeci argument `withBudget` może budżet wyłącznie SKRÓCIĆ, więc sufit `check:ssr-budgets` (3 000 ms) pozostaje nietknięty. |
| [AdminShellSkeleton.tsx](../src/components/admin/AdminShellSkeleton.tsx)                                  | Szkielet o GEOMETRII `AdminShell` na czas rozstrzygania sesji. Bez tłumaczeń, bez zapytań, w całości `aria-hidden` (ta sama doktryna, co `EventsListSkeleton`).                                              |
| [admin.tsx](../src/routes/admin.tsx)                                                                      | Stan `loading` renderuje szkielet zamiast jednej wyśrodkowanej kropki. Brak uprawnień nadal renderuje `null`.                                                                                                |
| [sidebarStylePreference.ts](../src/lib/admin/sidebarStylePreference.ts)                                   | Pamięć rozstrzygniętego wariantu paska bocznego w `localStorage`. Preferencja widoku, nie stan aplikacji; ustawienia z bazy zawsze ją nadpisują.                                                             |
| [AdminShell.tsx](../src/components/admin/AdminShell.tsx)                                                  | Szerokość paska liczona z surowego zapytania (rozróżnia „jeszcze nie wiem" od „najemca ma style-1"), z pamięcią jako wartością pierwszego malowania. Wiersz marki dostał przypiętą wysokość (`h-8`/`h-9`).   |
| [DashboardSection.tsx](../src/components/admin/dashboard/DashboardSection.tsx)                            | Opcjonalna `pendingMinHeight` - rezerwa układu na czas odczytu. Bez argumentu zachowanie bez zmian.                                                                                                          |
| [AdminDashboard.tsx](../src/components/admin/dashboard/AdminDashboard.tsx)                                | Rezerwa per sekcja, wyprowadzona z wysokości wykresów deklarowanych przez same panele.                                                                                                                       |
| [admin.index.tsx](../src/routes/admin.index.tsx)                                                          | Zastępka leniwego pulpitu rezerwuje ekran (`min-h-[70vh]`) zamiast `py-16`.                                                                                                                                  |
| [admin.analytics.bi.tsx](../src/routes/admin.analytics.bi.tsx)                                            | Siedem zastępek `Suspense` rezerwuje wysokość dashboardu (mapa 560 px, stopka 280 px, reszta 420 px) zamiast ~72 px.                                                                                         |
| [ssrTiming.ts](../src/lib/http/ssrTiming.ts) + [ssrTiming.server.ts](../src/lib/http/ssrTiming.server.ts) | Nowa oś telemetrii: fazy potoku mierzone zegarem ŚCIENNYM, per żądanie. Nazwa spoza tokenu jest pomijana, bo psułaby parsowanie całego nagłówka.                                                             |
| [start.ts](../src/start.ts)                                                                               | `redirectMiddleware` mierzy odcinek routingu krawędziowego i zapisuje go jako fazę `edge-routing`. Pomiar czysto obserwacyjny - nie zmienia ani jednej decyzji potoku.                                       |
| [documentCache.server.ts](../src/lib/http/documentCache.server.ts)                                        | Fazy dopisywane do `Server-Timing` na KAŻDEJ gałęzi (HIT, STALE, MISS), bo routing krawędziowy biegnie przed konsultacją cache'u i płaci go także trafienie.                                                 |

### 2.1 TTFB `/admin`: fala 1 korzenia przestała blokować dokument

`routes/admin.tsx` deklaruje `ssr: false` (sesja Supabase żyje w `localStorage`,
więc SSR szkicu jest gwarantowanym mismatchem hydratacji), a `showsSiteChrome`
wyklucza panel z chrome'u serwisu. Mimo to loader korzenia awaitował na tej
ścieżce pełną falę 1 - `site_settings` + tokeny designu + kolory globalne - z
budżetem `ROOT_WARM_BUDGET_MS` = 2 500 ms. Z tych danych na dokumencie `/admin`
nie powstaje ANI JEDEN piksel przed hydratacją: trasa nie renderuje treści, a
`<DesignTokensStyle/>` i pokrewne emitują `<style>`, który nie ma czego
pomalować, dopóki ciało jest puste. Dokumenty `/admin` są przy tym na
deny-liście NES Edge Cache (`PUBLIC_DOCUMENT_DENY_PREFIXES`), więc ten koszt
płaciło KAŻDE twarde wejście do panelu, nigdy nie amortyzowane trafieniem.

Termin zszedł do 300 ms. Wartość nie jest zerem świadomie: przy rozgrzanym
`edgeTtlCache` albo zdrowej bazie fala 1 rozstrzyga się w dziesiątkach ms i
dehydratowany stan nadal oszczędza klientowi round-trip. Wyczerpanie terminu
nie jest awarią - zapytania zostają zasiane PRZETERMINOWANYMI domyślnymi
(`updatedAt: 0`), więc klient dociąga wartości najemcy natychmiast po
hydratacji.

Zmierzone w teście jednostkowym (`rootRoute.test.tsx`, zawieszony backend):
**302 ms zamiast 2 503 ms**.

### 2.2 CLS `/admin` (0,532) i `/admin/analytics/bi` (0,676)

Cztery niezależne źródła przesunięcia, wszystkie wyprowadzone z lektury źródeł:

1. **Wymiana całej powłoki.** Stan `loading` malował jedną wyśrodkowaną kropkę
   w `min-h-screen flex items-center justify-center`, którą React podmieniał na
   pełną ramę panelu. To nie jest dokończenie układu, tylko jego wymiana.
   → `AdminShellSkeleton` o tej samej geometrii.
2. **Przeskok szerokości paska.** `theme_options.sidebars.style === "style-4"`
   zwija pasek do `w-12`. Ustawienie przyjeżdża zapytaniem, którego panel nie
   ma z czego zhydratować, więc pierwszy render malował `w-56` i po odpowiedzi
   bazy zwężał się o 176 px razem z całą treścią.
   → Pamięć rozstrzygniętego wariantu w `localStorage`.
3. **Sekcje pulpitu.** Sześć sekcji rozstrzyga się niezależnie; każda rosła z
   ~56 px do kilkuset i spychała w dół wszystkie następne.
   → `pendingMinHeight` per sekcja.
4. **Siedem dashboardów BI.** Ten sam mechanizm, siedem razy, w jednej kolumnie:
   dashboard nr 7 przesuwał się sześć razy.
   → Rezerwa per zastępka `Suspense`.

Rezerwy są PRZYBLIŻENIAMI wysokości docelowych paneli, wyprowadzonymi z
wysokości wykresów, które te panele deklarują same (`height={200}`, `{220}`,
`{240}`). Rezerwa dokładna wymagałaby zamrożenia wysokości paneli, czyli
kontraktu, którego one nie mają i mieć nie powinny - liczba kafli zależy od
danych. Rezerwa przybliżona zbija wkład tego mechanizmu o rząd wielkości.

### 2.3 Czego nagłówek `Server-Timing` dotąd nie mówił

Odcinek PRZED routerem - katalog tenantów, potem indeks przekierowań, oba
planem service-role, SZEREGOWO, oba z własnym terminem 1 500 ms - biegnie
**przed** `documentCacheMiddleware`, więc nawet gorące trafienie w cache
dokumentów nie ratuje czytelnika przed tym czekaniem. Ten odcinek nie wchodził
do `db;dur` (ta metryka mierzy wyłącznie plan anon) ani do `ssr;dur` (to czas
renderu): mieścił się w różnicy `app;dur − ssr;dur` razem z siecią, middleware
bezpieczeństwa i samym cache'em.

Przy TTFB p75 = 2,5-3,2 s to jest dokładnie ta niewiadoma, od której zależy
następna decyzja. Nowa faza `edge-routing` czyni ją mierzalną w RUM, który to
wdrożenie i tak zbiera. Zlecenie mówi „zprofiluj, wyszukaj zapytania > 500 ms" -
to jest instrument, który na to pytanie odpowiada.

### 2.4 ANEKS 2026-09-20: szkielet panelu wychodzi teraz z serwera

Ten rozdział **unieważnia jedno założenie §2.1 i §2.2**: `routes/admin.tsx` nie
deklaruje już `ssr: false`. Reszta opisu (geometria szkieletu, pamięć wariantu
paska, rezerwy `pendingMinHeight`) obowiązuje bez zmian.

**Dlaczego wracamy do SSR.** Audyt `docs/AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md`
(F32, plan 3.13) pokazał, że `ssr: false` kosztowało nie tylko puste ciało.
Router ładuje chunk trasy na serwerze **wyłącznie dla dopasowań `ssr === true`**
(`router-core/load-server.js`, `loadNormalChunks`), więc `head()` trasy `/admin`
w ogóle nie biegł po stronie serwera - i `admin-styles.css` (12,6 KB,
render-blocking) odkrywała przeglądarka dopiero **po** zhydratowaniu ~570 KB
gzip bootu, szeregowo zamiast równolegle.

**Jak omijamy rozjazd hydratacji, który był powodem `ssr: false`.** Powód był
prawdziwy - sesja Supabase żyje w `localStorage` - więc nie znosimy go, tylko
odsuwamy od serwera:

- serwer renderuje **wyłącznie** `AdminShellSkeleton`, a jego jedynym wejściem
  jest ścieżka z URL-a (`isCompactSidebarRoute`, `isEventStudioPath`);
- wariant zapamiętany w `localStorage` **nie wchodzi** do renderu serwerowego -
  serwer go nie zna, więc byłby gwarantowanym rozjazdem. Doczytuje go pierwszy
  render po hydratacji;
- `useAuth`, przekierowanie na `/login`, `AdminShell` i `<Outlet/>` mieszkają
  w osobnym komponencie za bramką `useHydrated()` (ten sam
  `useSyncExternalStore`, na którym stoi `<ClientOnly>` routera), czyli SSR-owy
  HTML i pierwszy render klienta są identyczne z konstrukcji;
- `ensureAdminExtrasI18n()` przeniesione z ciała komponentu do `beforeLoad` -
  pierwsze malowanie nie czeka już na ewaluację 18,6 KB nakładki słownika;
- `beforeLoad` nadaje dokumentowi `private, no-store`. Deny-lista NES Edge Cache
  mówiła „nie zapisuj" tylko naszemu brzegowi (`planDefaultCacheControl` zwraca
  dla tych ścieżek `null`), a od tej zmiany dokument niesie HTML.

**Czego ten aneks NIE zmienia i co zostaje do sprawdzenia.**

- Wariant paska dla najemcy ze `style-4`: serwer maluje 224 px, a pierwszy
  render po hydratacji zwęża pasek do 48 px. To jedno przesunięcie zostaje -
  zdjęłoby je dopiero liczenie szerokości z **odwodnionego** `site_settings`
  (`theme_options.sidebars.style`), czyli z tych samych danych, z których liczy
  ją `AdminShell`. Wymaga to jednak, żeby fala 1 korzenia zdążyła w terminie
  `CLIENT_ONLY_WARM_BUDGET_MS`.
- `lib/routing/clientOnlyDocument.ts` nadal klasyfikuje `/admin` jako dokument
  bez serwerowego renderu treści. Predykat pozostaje użyteczny (skrócony termin
  fali 1), ale jego uzasadnienie w komentarzu odwołuje się do nieistniejącego
  już `ssr: false` i należy je odświeżyć.
- Trasy potomne `/admin/**` odziedziczyły SSR, więc ich `beforeLoad`/`loader`
  biegną teraz na serwerze. W praktyce są to same przekierowania, z dwoma
  wyjątkami: `/admin/authors` (awaituje `expertsDirectoryQueryOptions()` -
  dokłada round-trip do TTFB) i `/admin/` (rozgrzewka chunku pulpitu, `void`).

## 3. Czego ten commit NIE rozwiązuje, powiedziane wprost

**TTFB na powierzchniach publicznych (`/` = 3,19 s, `/blog/<wpis>` = 2,81 s)
pozostaje nierozwiązany i nie da się go zdiagnozować z samych źródeł.** Oto co
odczyt kodu ustalił - i dlaczego to nie wystarcza:

- Loader strony głównej ma JEDEN wspólny deadline 600 ms na wszystkie fazy
  danych (`homeSsrBudget.ts`), a `docs/HOMEPAGE_COLD_SSR_2026-09-05.md`
  raportuje z lokalnego smoke TTFB 619-626 ms. Różnica wobec produkcyjnych
  3,19 s **nie mieści się w budżetach loaderów** - musi pochodzić spoza kodu
  aplikacji (zimne izolaty, latencja krawędź → baza, region, trafialność cache
  dokumentów).
- Katalog tenantów i indeks przekierowań mają stale-while-revalidate, migawkę
  L2 (Cache API kolonii) i odświeżanie w tle pod `waitUntil`. Blokuje wyłącznie
  izolat zupełnie zimny, i wyłącznie raz.
- `fetchWithTenantHost` nie dokłada per-zapytanie nic istotnego: klucz HMAC i
  poświadczenie są cache'owane per izolat, katalog tenantów to odczyt z Mapy.
- Próbka z raportu `db;dur=2697;desc="n=19"` mówi o 19 round-tripach i ~142 ms
  średnio na round-trip. To jest KOSZT, nie czas ścienny, więc nie sumuje się
  z TTFB wprost - ale sugeruje bazę wolniejszą, niż zakładają budżety.

Następny krok należy do pomiaru, nie do kolejnej zmiany kodu. Konkretnie:

1. Odczytać `Server-Timing` z produkcji na `/` i `/en` - teraz z fazą
   `edge-routing`. Rozkład `app;dur` na `edge-routing` + `ssr;dur` + resztę
   rozstrzyga, czy problem jest przed routerem, w renderze, czy w sieci.
2. Skorelować z `nes-edge;desc=` - udział MISS-ów na `/` jest drugą niewiadomą.
   Przy `s-maxage=900` i L2 kolonii MISS-y powinny być rzadkie; jeśli nie są,
   przyczyną jest kardynalność klucza albo rozmiar wpisu (limit 2 MiB, dokument
   strony głównej potrafi się do niego zbliżać - `documentCache.ts`).
3. Dopiero mając te dwie liczby wybierać między: skróceniem szeregowego odcinka
   routingu krawędziowego, zmniejszeniem dokumentu strony głównej, a zmianą
   konfiguracji wdrożenia.

Nie zmieniono też niczego w LCP powierzchni publicznych: preload obrazu
bohatera (`rel=preload`, `fetchpriority=high`, `srcset`/`sizes` bajtowo zgodne
z malowanym `<img>`) jest w tym repozytorium zaimplementowany i pokryty testami
(`src/lib/seo/meta.ts`, `src/lib/builder/heroImage.ts`,
`routes/__tests__/homeRoute.test.tsx`). Globalny LCP p75 = 3,29 s przy TTFB
p75 = 2,52 s to znowu ta sama zależność: obraz nie może zacząć się pobierać,
zanim przyjdzie nagłówek, który go zapowiada.

## 4. Jak to zweryfikować

```sh
# Bramki statyczne i testy jednostkowe (biegają bez buildu):
bun run check:ssr-budgets
npx vitest run src/routes/__tests__/rootRoute.test.tsx \
  src/lib/routing/__tests__/clientOnlyDocument.test.ts \
  src/lib/admin/__tests__/sidebarStylePreference.test.ts \
  src/routes/__tests__/adminRouteSsr.test.tsx \
  src/components/admin/__tests__/AdminShellSkeleton.test.tsx \
  src/components/admin/__tests__/AdminShell.test.tsx \
  src/components/admin/dashboard/__tests__/dashboardSection.test.tsx \
  src/lib/http/__tests__/ssrTiming.server.test.ts

# Pomiar TTFB (wymaga środowiska z dostępem do rejestru pakietów):
bun run build:smoke
PORT=4320 node .output/server/index.mjs
bun scripts/measure-home-ssr.ts http://localhost:4320
```

CLS mierzy się w przeglądarce, nie w happy-dom: rezerwy z §2.2 należy
potwierdzić na zbudowanym artefakcie (DevTools → Performance → Experience →
Layout Shifts) albo w RUM po wdrożeniu. Testy jednostkowe dowodzą wyłącznie
tego, że rezerwa i geometria docierają do DOM-u - i tak są opisane.
