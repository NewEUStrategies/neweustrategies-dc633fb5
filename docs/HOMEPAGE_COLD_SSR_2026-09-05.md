# Pierwsze wejście na homepage - etap 1

PR: [#335](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/pull/335).
Baza: `1988d24900517fb05a1947150fa85a5dcdcefd24`.

Status: draft do weryfikacji na reprezentatywnym stagingu. Ten PR ogranicza
oczekiwanie na dane i poprawia degradację. Nie dowodzi jeszcze osiągnięcia
produkcyjnego TTFB, FCP, LCP, app-ready ani CLS.

## 1. Fakty i granice diagnozy

- Nagranie pokazuje opóźnione pojawienie się treści. Sam film nie mierzy TTFB,
  czasu hydracji ani waterfallu żądań.
- Loader homepage miał nieograniczone własnym deadline'em oczekiwanie na
  `homePageQueryOptions` i `homepageModeQueryOptions`. Następne fazy mogły
  dokładać oczekiwanie na archiwum, widgety i ustawienia SEO.
- Root i child loader wykonują się równolegle. Nie należy sumować ich
  budżetów jako czasu dokumentu. Sumują się fazy szeregowe jednego loadera.
- Pojedynczy odczyt publicznego URL-u dał HTTP 200, TTFB 10,144 s, pełną
  odpowiedź po 10,460 s i 774 947 bajtów raportowanych przez curl.
  `Server-Timing` zawierał `nes-edge;desc="MISS", ssr;dur=674.0,
db;dur=2697.0;desc="n=19"`. Suma czasów DB nie jest czasem ściennym.
  Duża różnica między TTFB i SSR wymaga osobnego pomiaru sieci, middleware
  oraz runtime'u. Ta próbka nie identyfikuje przyczyny całych 10 sekund.
- Długość `document.documentElement.outerHTML` nie jest transferem HTML.
  Zmierzony po hydracji DOM nie powinien służyć za rozmiar odpowiedzi SSR.
- `withHydrateBudget` ogranicza obietnicę integracji, nie dowodzi zakończenia
  pompowania całego `queryStream`. Istniejące zabezpieczenia pozostają w kodzie.

## 2. Zmiany i punkty przeglądu

| Plik / punkt wejścia                                                                                            | Kontrakt                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [homeSsrBudget.ts](../src/lib/ssr/homeSsrBudget.ts)                                                             | Jeden deadline 600 ms per requestowy QueryClient. Theme do 400 ms, above-fold do 500 ms i tylko w pozostałym czasie.                                                          |
| [resilientLoad.ts](../src/lib/ssr/resilientLoad.ts#L89)                                                         | Reuse istniejącego helpera. Deadline nie restartuje się między fazami; anulowanie przed zasiewem; `updatedAt: 0`; istniejący fallback nie staje się czystym wynikiem.         |
| [asyncBudget.ts](../src/lib/asyncBudget.ts)                                                                     | Opcjonalny trzeci argument może wyłącznie skrócić budżet. Wygasły deadline nie oznacza nieskończonego oczekiwania. Stary kontrakt dwuargumentowy zostaje.                     |
| [root loader](../src/routes/__root.tsx#L275)                                                                    | Zegar przed synchronizacją i18n, ograniczona fala theme i chrome. Wczesne anulowanie theme tylko dla homepage SSR. Inne trasy i SPA zachowują wcześniejszy kontrakt root.     |
| [homepage loader](../src/routes/index.tsx#L105)                                                                 | Page, mode i settings startują razem; archiwum oraz prefetch używają pozostałego czasu; nie ma późnego osobnego oczekiwania na SEO.                                           |
| [Index](../src/routes/index.tsx#L342) i [LatestPostsHome](../src/components/home/organisms/LatestPostsHome.tsx) | Rozróżnienie prawdziwej pustki od braku danych. Automatyczny refetch i przycisk ponowienia odzyskują treść bez przeładowania. Paginacja i pageSize zostają zgodne z loaderem. |
| [HomeLoadingNotice](../src/components/home/molecules/HomeLoadingNotice.tsx)                                     | Query-free molekuła z istniejących atomów `Skeleton`; status dostępności, PL/EN, obsługa reduced motion. Bez routera i providerów danych.                                     |
| [Header](../src/components/Header.tsx)                                                                          | Istniejący `HeaderSkeleton` na homepage, gdy ustawienia są jawnym fallbackiem. Poprawna pusta konfiguracja nadal może świadomie nie renderować headera.                       |
| [responseHeaders.ts](../src/lib/http/responseHeaders.ts#L50)                                                    | `private`/`no-store` jest nieodwracalne w obrębie Request. Kolejność zakończenia root/child nie zmienia bezpieczeństwa document cache.                                        |
| [public.ts](../src/lib/queries/public.ts#L392)                                                                  | Awaria odczytu reading nie fabrykuje trybu strony i nie utrwala go w edge TTL. Brak wiersza bez błędu pozostaje poprawnym pustym wynikiem.                                    |
| [ssrBudgets.ts](../src/lib/ci/ssrBudgets.ts)                                                                    | Bramka nadal czyta drugi argument jako sufit fazy, także przy trzecim argumencie deadline. Kontrola negatywna pilnuje podniesienia sufitu i dołożenia fazy.                   |
| [boot-home.spec.ts](../e2e/boot-home.spec.ts)                                                                   | Test HTML przed JS, widocznego main, app-ready i błędów hydratacji w PL/EN. Obie konfiguracje Playwright mają zgodny podział speców.                                          |

Zegar 600 ms ogranicza oczekiwanie loaderów na dane, nie import modułów,
middleware, CPU Reacta, transport ani domknięcie sekcji strumieniowanych.
Nie jest dowodem TTFB <= 600 ms. Wyczerpany budżet nie uruchamia kolejnej
nieograniczonej fazy prefetchu.

## 3. Odtwarzalny pomiar HTTP

Probe nie wysyła cookies, beaconów, parametrów URL ani danych użytkownika.
Nie wykonuje purge i nie zmienia konfiguracji cache.

```sh
bun run build:smoke
PORT=4320 node .output/server/index.mjs
# W drugim terminalu:
bun scripts/measure-home-ssr.ts http://localhost:4320
```

Build smoke nadpisuje `.output`. Najpierw wykonać build Cloudflare i bramki
bundle/chunks/entry-purity, dopiero potem smoke. Nie uruchamiać kilku ciężkich
buildów i typecheck równolegle na runnerze 16 GB.

Poniżej próbki z Node smoke, z repozytoryjną konfiguracją zastępczą backendu,
bez konta użytkownika. Baza była budowana w osobnym worktree. Etap 1 to commit
`33bfe9fcd2ea0557e86a13449ecf65e6193cb8ff`. Późniejsza korekta izoluje
anulowanie root do homepage. To mała próba diagnostyczna, nie p75 ani pomiar
produkcyjny. W trakcie pracy działały również testy, więc nie jest to ścisły
benchmark CPU A/B. Pierwszy odczyt obejmuje zimny moduł aplikacji.

| Wariant                    | TTFB `/`, kolejne 3 próbki, ms | TTFB `/en`, kolejne 3 próbki, ms | HTML `/`, bajty po dekodowaniu |
| -------------------------- | ------------------------------ | -------------------------------- | -----------------------------: |
| main `1988d24`             | 1552, 1058, 1037               | 1031, 1022, 1041                 |                         72 914 |
| etap 1 `33bfe9f`           | 1002, 626, 622                 | 619, 629, 635                    |                         74 273 |
| po korekcie root `4dfc105` | 998, 626, 619                  | 617, 618, 619                    |                         74 273 |

Wszystkie odpowiedzi: HTTP 200, `MISS`, `private, no-store`. Szybszy powtórny
odczyt w tej próbie nie jest HIT-em document cache. Wzrost HTML wynika m.in.
z widocznego fallbacku, którego baza nie miała.

Proxy rozmiaru inline skryptów zawierających `$_TSR`: 6139 -> 5826 bajtów.
To nie jest dokładny payload query: zawiera stan routera i nie obejmuje
wszystkich późniejszych porcji streamu. Nie usunięto żadnej klasy danych
z dehydracji. Dokładny podział per query i redukcja payloadu pozostają follow-upem.

FCP, LCP, app-ready, CLS, `onShellReady`, rozmiar skompresowanego transferu
i produkcyjne p75 nie zostały zmierzone tym probe'em. Nie należy wyliczać
ich z powyższych czasów ani z nagłówka `ssr`.

## 4. Weryfikacja i czerwone wyniki

Przed zmianą: 3 celowane pliki, 66 pass + 1 expected-fail na bazowym SHA.
Po wdrożeniu: 17 plików, 281 pass + 7 istniejących expected-fail.
Po dodatkowym teście automatycznego odzyskania: homepage 38 pass + 1 expected-fail.
Po zawężeniu root: root + bramka SSR 53 pass. Parytet konfiguracji E2E: 13 pass.
Końcowe powtórzenie: 18 plików, 296 pass + 7 expected-fail. Ostatni test
nieznanego trybu strony: homepage 39 pass + 1 expected-fail. Gdy tryb jest
nieznany, loader nie prefetchuje ukrytej kanwy ani nie emituje jej canonicalu
i preloadu obrazu przeciwko widocznemu komunikatowi odzyskiwania.

Pełny przebieg: 2365 plików, 64 721 pass, 378 expected-fail, 50 skipped,
11 failed. Dwa błędy parytetu Playwright były związane z tym PR i zostały
naprawione, a cały plik parytetu uruchomiony ponownie. Nie przedstawiamy
tego jako pełnej zielonej suity ani jako kolejnego pełnego przebiegu po poprawce.

Pozostałe 9 błędów odtworzono na czystym `1988d24` tą samą instalacją
z zamrożonego lockfile'a, w osobnym worktree:

| Plik bazowy                                                                  | Liczba identycznie nieudanych testów |
| ---------------------------------------------------------------------------- | -----------------------------------: |
| `src/routes/__tests__/adminPostsCalendarRoute.test.tsx`                      |                                    1 |
| `src/components/clubs/__tests__/clubWorkspaceScreens.test.tsx`               |                                    2 |
| `src/lib/authz/__tests__/authzSnapshotParity.test.ts`                        |                                    1 |
| `src/lib/billing/__tests__/donationsAdmin.server.test.ts`                    |                                    1 |
| `src/lib/billing/__tests__/entitlement.test.ts`                              |                                    1 |
| `src/components/events/meetings/__tests__/AvailabilityWindowDialog.test.tsx` |                                    3 |

Wynik odtworzenia bazy: 9 failed, 165 pass, 1 expected-fail w 6 plikach.
Nie naprawiano przy okazji billing, kalendarzy ani snapshotu autoryzacji.

Typecheck, format, lint (0 błędów; istniejące ostrzeżenia), build Cloudflare,
smoke, chunks, entry-purity oraz bramki SSR, i18n-hardcoded, taxonomy,
ownership i unknown-casts zostały sprawdzone. Przerwane z powodu pamięci
przebiegi typecheck/smoke nie były uznane za sukces i zostały powtórzone.
Testy browserowe artefaktu dodano i sprawdzono ich discovery, ale nie wykonano
lokalnie pełnego Playwrighta; wynik CI/stagingu nadal jest wymagany.

### Bundle: istniejące przekroczenia, bez zmiany limitów

| Metryka gzip z bramki | Czysty main | Etap 1 po korekcie root |   Limit |
| --------------------- | ----------: | ----------------------: | ------: |
| największy chunk      |    317,1 KB |                317,3 KB |  280 KB |
| public JS             |   2725,2 KB |               2725,8 KB | 2715 KB |
| overall JS            |   4352,9 KB |               4353,4 KB | 4351 KB |
| boot closure          |    619,7 KB |                620,0 KB |  579 KB |

To dowód długu na bazowym main i niewielkiego kosztu tego PR, nie zielona
bramka. Nie zmieniono progów, baseline'u ani konfiguracji manualChunks.

## 5. Warunki przed merge i follow-up

1. Wykonać testy artefaktu na finalnym SHA oraz pomiary przeglądarkowe
   z zimnym cache klienta, osobno od cold/MISS document cache. Sprawdzić
   desktop/mobile, PL/EN, `?page=2`, zdrowy/wolny/niedostępny backend.
2. Na stagingu z rzeczywistym dokumentem CMS zmierzyć TTFB, FCP, LCP,
   app-ready, CLS i odsetek fallbacków. 600 ms może być zbyt krótkie dla
   niektórych zdrowych cold zapytań. Nie uznać szybszego skeletonu za sukces,
   jeśli pogarsza czas do prawdziwej treści.
3. Osobno sprawdzić crawler bez JS: fallback 200 nie może trwale zastępować
   indeksowanej treści. Nie zmieniono trybu renderera dla botów, ale krótszy
   budżet danych obejmuje także ich homepage. Częste timeouty są blokadą wydania.
4. Fallback headera jest deterministyczny, lecz nie zna dowolnej wysokości
   headera CMS. Nie gwarantuje zerowego CLS przy zmianie motywu i nawigacji.
   Zmierzyć i ewentualnie zapisać bezpieczną rezerwację układu per tenant.
5. Zweryfikować L2 Cache API, HIT/STALE, oversize i store failure w docelowym
   runtime. Nie wykonywano purge ani administracyjnego odczytu cache produkcji.
6. Zmierzyć dokładny snapshot query oraz późniejsze porcje streamu, w stagingu,
   grupując po bezpiecznej rodzinie query, bez identyfikatorów i danych treści.
   Dopiero potem zaprojektować selektywną dehydrację z testami HTML/React.
7. Pozostały wcześniejszy przypadek błędu odczytu wskazanej strony CMS
   wpadającego w fallback `home` wymaga odrębnego, ukierunkowanego przeglądu.
   Ten PR naprawia odczyt reading, nie cały resolver stron.
8. Naprawić odziedziczone czerwone bramki bez obniżania ich progów przed
   traktowaniem gałęzi jako gotowej do wydania.

W przebiegu Lighthouse `33995307281` dla commitu `33bfe9f` krok
`Lighthouse against deployed URL (blocking)` był **skipped**, a krok
Lighthouse na artefakcie zakończył się **success**. To realny odczyt joba,
nie wniosek z komentarza. W razie braku zmiennej maintainer ustawia
`Settings > Secrets and variables > Actions > Variables > LHCI_URL`.
Workflow już obsługuje tę zmienną. Sam Lighthouse nie wymusza cold MISS;
kontrolowany purge na stagingu wymaga osobnego uzgodnienia. Ten PR niczego
nie wdraża, nie scala i nie zmienia zmiennych środowiskowych.

## 6. Czego nie zmieniać przy kontynuacji

- Nie usuwać `guardQueryStream`, `sweepQueryCacheForSerialization`,
  `installSsrQueryTimeout`, `withHydrateBudget` ani `ServerSectionGate`.
- Nie odcinać globalnie danych below-fold od dehydracji gotowego HTML.
- Nie wyłączać SSR i nie czekać globalnie na `allReady` dla zwykłych użytkowników.
- Nie zmieniać tenantowych kluczy cache, auth bypass, RLS, CSP ani limitu 2 MiB.
- Nie wydłużać timeoutów, cache freshness, limitów bundla ani progów Lighthouse
  w celu ukrycia regresji. Nie tworzyć drugiego systemu analityki.
- Nie dodawać typów `any` / `as any`. Nowe teksty zapisujemy ze znakiem `-`.

Kontekst historyczny, który należy konfrontować z aktualnym kodem:
[SSR i hydratacja](WDROZENIE_SSR_HYDRATACJA_PIERWSZE_WCZYTANIE_2026-09-01.md),
[runbook wykonawcy](RUNBOOK_CIAGLOSC_WYKONAWCY.md).
