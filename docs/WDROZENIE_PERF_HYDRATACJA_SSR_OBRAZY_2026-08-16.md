# Wdrożenie: wydajność - hydratacja, SSR, obrazy, nawigacja wewnętrzna (2026-08-16)

Pakiet optymalizacji pierwszego wczytania (LCP/TBT) i nawigacji wewnętrznej.
Każda zmiana przeszła adwersaryjną weryfikację względem istniejącego kodu
(część "oczywistych" poprawek już istniała w helperach - te odrzucono, m.in.
modulepreload łańcucha entry, który TanStack Start emituje sam z manifestu).

## 1. Hydratacja / chunk wejściowy (`src/routes/__root.tsx`)

- **`ConsentBanner` przez `React.lazy`** (wcześniej import statyczny): baner
  renderuje `null` w SSR i w pierwszym renderze klienta (`mounted` przestawia
  się w `useEffect`), więc lazy nie zmienia ani bajtu HTML-a, a wynosi ~1400
  linii źródeł (banner 859 + `cookieBanner/config` 170 + `registry` 402) poza
  chunk wejściowy każdej strony. Pozostaje zamontowany BEZWARUNKOWO - jego
  efekty są jedynym pisarzem `setMarketingConsent`/`setConsentOverlayVisible`
  w `overlayCoordinator`; bramka "tylko dopóki nie zdecydowano" odblokowałaby
  popupy marketingowe u osób, które marketing odrzuciły.
- **`ExpertRequestDialogHost` przez `React.lazy`**: Suspense wokół hosta
  istniał, ale import był statyczny (inertny Suspense) - formularz z zod,
  hookami quota i słownikami PL+EN jechał w entry na 100% odsłon. Host musi
  być zamontowany od pierwszego renderu (bus nie ma replay ostatniego
  zdarzenia) - lazy wydziela chunk, nie odracza montażu.
- **`ConsentPreviewPanel` przez `React.lazy`** (aktywny tylko przy
  `?consent-preview=1`).
- **Watchdog podglądu importowany tylko w iframie**: moduł sam robi no-op poza
  iframe'em edytora, ale chunk i tak był pobierany/parsowany na każdej
  produkcyjnej odsłonie tuż po hydratacji. Ten sam test `self !== top` biegnie
  teraz PRZED importem.
- **`cacheBusting` odroczony do `whenIdle`** (timeout 3 s): setup pollingu
  wersji nie konkuruje już o pasmo/główny wątek z dekodowaniem LCP w oknie tuż
  po hydratacji.

## 2. Preconnect do hosta obrazów (`__root.tsx` head + nagłówek `Link`)

Przeglądarki kluczują połączenia parą (origin, tryb poświadczeń). Jedyny
preconnect do Supabase niósł `crossOrigin="anonymous"`, więc rozgrzewał tylko
pulę CORS (fetch supabase-js) - a KAŻDY `<img>` treści/okładek i preload LCP
idą w trybie no-cors i płaciły pełny DNS+TCP+TLS (Lighthouse: "preconnect
found but not used by the browser"). Dodany DRUGI preconnect bez
`crossOrigin` (standardowy wzorzec dual-preconnect) + odpowiednik w nagłówku
HTTP `Link` (droga do 103 Early Hints).

## 3. SSR: serve-stale w `edgeTtlCache` (`src/lib/ssrCache.ts`)

Cache per-izolat za praktycznie każdym anonimowym odczytem SSR (site_settings,
menu, resolved content, archiwa, ticker) był twardo wygasający: pierwsze
żądanie po TTL blokowało render na pełnym round-tripie do Supabase, a klucze
rozgrzewane przez loader roota wygasały stadnie. Teraz:

- **Stale-while-revalidate**: w oknie `5 x ttlMs` nieświeży wpis wraca
  natychmiast, odświeżenie biegnie w tle (start synchroniczny w kontekście
  żądania - ALS/host tenanta; dokończenie przez `runAfterResponse`/waitUntil,
  import dynamiczny, żeby moduł .server nie wszedł do grafu klienta). Ten sam
  wzorzec co katalog tenantów (`tenant.server.ts`) i indeks przekierowań
  (`redirects.server.ts`).
- **Single-flight**: równoległe zimne missy tego samego klucza (świeżo
  wystartowany izolat) dzielą jeden fetch zamiast N identycznych.
- **Strażnik generacji**: `invalidateEdgeTtlCache` podbija generację, więc
  fetch w locie nie może zapisać sprzed-operatorskich danych ze świeżym
  znacznikiem (kontrakt "akcja operatora widoczna od razu" zachowany).
- Kompromis świadomy: maksymalna nieświeżość na gorącym izolacie rośnie z
  `ttl` do `5 x ttl` (np. 5 min dla resolved content) - porównywalnie z
  klienckim `staleTime` 5 min i z akceptowaną nieświeżością siblingów SWR.
- Testy: `src/lib/__tests__/ssrCacheHostScope.test.ts` rozszerzone o kontrakty
  serve-stale, twardego wygaśnięcia, single-flight i wyścigu unieważnienia.

## 4. Nawigacja wewnętrzna

- **`src/routes/index.tsx`**: loader biegnie też przy każdej nawigacji
  klientowej (brak `isServer` gate), a `prefetchCachedRouteQueries` celowo
  rozgrzewa WSZYSTKIE sekcje z budżetem 6 s - uzasadnienie "płacone raz na
  rewalidację" dotyczy tylko renderu serwerowego (edge-cache). Klik w logo z
  artykułu blokował przejście na najwolniejszym zapytaniu spod zgięcia. Teraz
  klient czeka tylko na `prefetchAboveFoldQueries` (3 sekcje, budżet 2,5 s);
  widgety niżej to zwykłe `useQuery` (szkielet, bez suspenda), dogrzewane
  przez `useSectionPreload` (IO, 1200 px wyprzedzenia). Ścieżka serwerowa
  bajt w bajt bez zmian.
- **`warmWidgetChunks.ts`**: do idle-warmupu dołączyły chunki ścieżki hero
  strony głównej (`PostsSliderWidget` + `@/lib/builder/sliderVariants`) -
  loader "/" rozgrzewał DANE slidera, ale nawigacja SPA na "/" montowała
  największy element nad zgięciem jako pusty fallback Suspense do czasu
  pobrania kodu.

## 5. Obrazy

- **`podcast.$slug.tsx` / `podcasts.$show.tsx`** (okładka = kandydat LCP,
  preload z fetchpriority=high już istniał): malowany `<img>` dostał
  `fetchPriority="high" decoding="async"` + wymiary, a preload i src schodzą
  przez `buildAvatarSrc` na wariant ~2x DPR pola (256/320 px) zamiast
  pełnowymiarowego oryginału na wysokim priorytecie. PARYTET preload==paint
  zachowany (ten sam helper po obu stronach). Awatary osób i okładki list
  odcinków: `buildAvatarSrc` + `loading="lazy" decoding="async"` + wymiary.
- **`podcasts.index.tsx`**: siatka programów przez `OptimizedImage responsive`
  (`CARD_IMAGE_SIZES`, pierwszy rząd `priority`), miniatury archiwum przez
  `buildAvatarSrc(…, 80)` + lazy.
- **`WebStoriesCarouselView`** (widget buildera, m.in. strona główna): kafelki
  ~160 px pobierały pełnowymiarowe okładki historii - teraz `OptimizedImage
  responsive` z `sizes` zależnym od wariantu (carousel/grid). Analogicznie
  kafelki w `web-stories.index.tsx` i "więcej historii" w
  `web-stories.$slug.tsx`.
- **`events.tsx`**: karty wydarzeń przez `OptimizedImage responsive`.
- **`CommentsSection`**: awatary komentarzy - `buildAvatarSrc(…, 36)` + lazy
  (wątek z dziesiątkami komentarzy pobierał oryginały eager pod zgięciem).
- **`FoxizExtraViews`** (bloki powiązanych wpisów na każdym artykule):
  miniatury 4:3 przez `OptimizedImage responsive`.
- **`sliderVariants.tsx`**:
  - pasek miniatur wariantu minimal-strip pobierał KAŻDY oryginał drugi raz
    (kadr główny używa innego transformowanego URL-a, cache HTTP nie skleja) -
    teraz stały wariant 192x144 (2x DPR pola 96x72) + lazy + wymiary;
  - ukryte slajdy stacka hero (`opacity: 0`, ale w viewporcie - natywne lazy
    ich nie wstrzymuje) dostają `fetchPriority="low"`, żeby nie konkurowały o
    pasmo z aktywnym slajdem (LCP). Deterministyczne dla SSR/hydratacji
    (obie strony renderują idx=0 jako aktywny).

## Świadomie odrzucone / backlog

- Modulepreload łańcucha entry: JUŻ emitowany przez TanStack Start z manifestu
  (`HeadContent` renderuje `preloads` roota) - propozycja odrzucona po
  weryfikacji w pinowanych pakietach.
- Bramka `mounted && !decided` dla ConsentBanner: regresja zgodowa (patrz p. 1).
- Restrukturyzacja dwóch fal loadera roota (`ROOT_WARM_BUDGET_MS` 2x2,5 s
  sekwencyjnie): realny zysk, ale średnie ryzyko - wymaga osobnego podejścia
  z testami kontraktu chrome-warm.
- Podział `styles.css` (admin/builder/profil/czat poza publicznym CSS):
  duży refactor kaskady - osobny PR.
- `preload="viewport"` dla kart archiwów: wymaga decyzji o fan-oucie loaderów
  na backend przy długich listach.
- Lżejszy favicon (26 KB ICO) + PNG dla apple-touch-icon: wymaga nowych
  assetów graficznych.
