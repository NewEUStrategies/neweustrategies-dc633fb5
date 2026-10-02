# Wyszukiwarka (moduł 6): naprawy po wydaniu 12, testy regresji, optymalizacja palety (2026-10-02)

Zlecenie: „optymalizuj, napraw, wdróż testy" dla modułu Wyszukiwarka, na
podstawie sekcji modułu w raporcie wydania 12 (stan dowodu, rozliczenie
rekomendacji wydania 11, nowe rekomendacje). PR: `NewEUStrategies/neweustrategies-dc633fb5#444`.

Zasada: każda naprawa ma test, który OBLEWA na kodzie sprzed poprawki.
Sprawdzone dla każdej grupy przez `git stash` samego kodu produkcyjnego
i uruchomienie nowych testów: 8 + 5 + 14 + 1 przypadków czerwonych przed
poprawką, zielonych po niej.

---

## 1. Defekty naprawione

| #   | waga    | miejsce                                                        | defekt                                                                                                                                                                                                                                                                                                                                                                             | naprawa                                                                                                                                                                                                                                                                                                              |
| --- | ------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | wysoka  | `lib/search/useVoiceSearch.ts`                                 | **Dyktowanie anonima było martwe.** Hook nagrywał (zgoda na mikrofon, dioda), a `/api/stt` wymaga sesji - `uploadForTranscription` zwracał `null` i fraza nigdy nie wracała. Fallback do Web Speech nie startował, bo nagrywanie „się udało". Test „ANONIM nie ma tokenu…" przypinał to jako poprawne.                                                                             | Bez sesji hook od razu startuje Web Speech, bez prośby o mikrofon. Anonim bez Web Speech (np. Firefox) nie dostaje przycisku - jedyną drogą byłoby STT z sesją. Błąd odczytu sesji = anonim.                                                                                                                         |
| D1b | średnia | jw.                                                            | Drugi toggle podczas dialogu zgody otwierał DRUGI strumień (pierwszego nikt nie zamykał). Zgoda przyznana po odmontowaniu zostawiała włączony mikrofon. Odmontowanie w trakcie nagrania odpalało `onstop`: nagranie szło na serwer, a `onFinal` (submit frazy) nawigował z powrotem na `/search` spod innej strony.                                                                | `startingRef` (start w toku), `aliveRef` sprawdzany po każdym `await`; odmontowanie wyrzuca nagranie i spóźnioną transkrypcję.                                                                                                                                                                                       |
| D2  | średnia | `components/search/SearchAutosuggest.tsx`, `routes/search.tsx` | Zakładka kubełka mieszkała w `useState` i nie patrzyła na zbiór podpowiedzi: „Tematyka", potem fraza bez tematów - lista pusta, a pasek nie pokazywał zakładki, którą dałoby się odkliknąć. Strzałki w trasie liczyły CAŁĄ listę, więc pod zakładką zaznaczały schowane wiersze, `aria-activedescendant` wskazywał nieistniejący element, a Enter wybierał niewidoczną podpowiedź. | Zakładka sterowana przez trasę; pokazywana zakładka wyprowadzana z bieżących kubełków (`effectiveSuggestTab`). Numeracja i krok strzałki z jednego modelu w `facetModel.ts` (`bucketSuggestions`, `visibleSuggestionIndices`, `stepSuggestion`), wspólnego dla renderu i klawiatury. Zmiana zakładki zdejmuje wybór. |
| D3  | średnia | `lib/search/overlayTabs.ts`                                    | Fraza szła do logicznego filtra PostgREST `.or()` sklejona wprost. „Unia, Polska" rozcinała filtr (400 = pusta sekcja tematyki), a fraza z przecinkiem i kropką dokładała do OR własny warunek.                                                                                                                                                                                    | `orIlikeValue`: wartość w cudzysłowie (w środku `\` przed `"` i `\`), metaznaki LIKE (`%`, `_`, `\`) poprzedzone ucieczką - „50%" szuka procentu.                                                                                                                                                                    |
| D4  | niska   | `lib/search/facetModel.ts` (`suggestionHref`)                  | Term z podpowiedzi kasował wartości TEGO SAMEGO wymiaru zaznaczone w panelu faset (`[param]: it.id`), choć scalanie z `base` istnieje po to, żeby podpowiedź nie gubiła stanu.                                                                                                                                                                                                     | Term dokłada się do wyboru (OR wewnątrz wymiaru, bez duplikatów). Autor - wybór pojedynczy - nadal zastępuje.                                                                                                                                                                                                        |
| D5  | niska   | `routes/search.tsx` („czy chodziło o")                         | Adres brał `title_pl` bez zapasu: wpis bez polskiego tytułu pokazywał tytuł angielski, a prowadził pod `/search?q=`.                                                                                                                                                                                                                                                               | Jeden tytuł dla etykiety i adresu (`searchHref`).                                                                                                                                                                                                                                                                    |
| D6  | niska   | `useCommandPaletteShortcut.ts`, `admin/AdminShell.tsx`         | Ctrl+K w panelu admina odpalał OBA nasłuchy okna: panel zaznaczał swoją wyszukiwarkę, a paleta otwierała się nad nią i zabierała fokus. Kto był „pierwszy", zależało od kolejności rejestracji (wejście wprost na /admin vs przejście z witryny).                                                                                                                                  | Paleta ustępuje zdarzeniu `defaultPrevented` (dotyczy też `/` i Escape); panel zajmuje skrót w fazie przechwytywania, więc kolejność jest deterministyczna.                                                                                                                                                          |
| D7  | niska   | `lib/search/useAuthorAvatars.ts`                               | Odmowa bazy zapisywała `null` dla każdego id NA STAŁE (filtr pomija id obecne w mapie - brak ponownej próby). Zerwane połączenie w `void (async …)` było nieobsłużonym odrzuceniem obietnicy (telemetria błędów JS).                                                                                                                                                               | Błąd nie trafia do mapy, wyjątek przechwycony. Hook dostał własny plik testów (rekomendacja „stanu dowodu").                                                                                                                                                                                                         |
| D8  | niska   | `lib/queries/archives.ts` (`searchQueryOptions`)               | „Pokaż więcej" to to samo zapytanie z większym `_limit`, więc `log_search_query` liczył frazę przy KAŻDYM doładowaniu - i pompował „popularne frazy", które `/search` pokazuje w stanie pustym.                                                                                                                                                                                    | Telemetria tylko dla pierwszej strony (`limit <= SEARCH_PAGE_SIZE`).                                                                                                                                                                                                                                                 |

## 2. Optymalizacja

- **Indeks palety liczony raz na zestaw komend.** `CommandPalette` budował
  `haystack` wszystkich komend przy każdym znaku (memo zależne od `query`),
  a render liczył go drugi raz - razem ze składaniem diakrytyków i normalizacją
  NFD dla każdego widocznego wiersza. Teraz `indexed` zależy wyłącznie od
  zestawu komend (rola), a ranking per znak tylko go przeszukuje.
- **Paleta wyłącznie sterowana** (nowa rekomendacja wyd. 12). Tryb z lokalnym
  stanem i drugim nasłuchem skrótu był martwy - jedyne miejsce montowania to
  `CommandPaletteHost`. `open`/`onOpenChange` są wymagane, skrót ma jednego
  właściciela.
- **Martwy kod** (rekomendacja wyd. 11 „uprzątnąć martwy kod"): `run`
  i gałąź `if (cmd.run)`, sekcje `actions`/`content` w typie i `SECTION_ORDER`
  (oraz klucz i18n `palette.sections.actions` w PL i EN - `content` zostaje,
  to nagłówek grupy wyników treści), ignorowany parametr `lang`
  w `buildHaystack`, nieczytana mapa `bySlug` w `ActiveFilterChips`. `to` jest
  w typie wymagane - komenda bez celu nie skompiluje się. Haystack bez
  pustych członów (podwójnych spacji).
- Nieaktualny komentarz w `SuggestRow` (popover „zamyka się na onBlur")
  poprawiony na stan po wydaniu 12.

## 3. Testy dopisane

| plik                                                            | co domyka                                                                                              |        przypadków |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------: |
| `lib/search/__tests__/useAuthorAvatars.test.ts` (nowy)          | batch, deduplikacja, brak ponownego pobrania, odmowa bez zapisu, zerwane połączenie, anulowanie        |                 6 |
| `lib/search/__tests__/useVoiceSearch.test.tsx`                  | D1, D1b: anonim przez Web Speech, wsparcie per sesja, podwójny start, odmontowanie w toku (3 warianty) | +9 (1 przepisany) |
| `components/search/__tests__/SearchAutosuggest.test.tsx`        | harness rodzica zakładki, regresja zawieszonej zakładki, wybór utrzymany, zakładka oddawana rodzicowi  |                +3 |
| `routes/__tests__/searchRoute.test.tsx`                         | klawiatura pod zakładką (krok, zawinięcie, Enter, zdjęcie wyboru), fallback „czy chodziło o"           |                +4 |
| `lib/search/__tests__/facetModelSuggestions.test.ts`            | model kubełków i kroku strzałki; scalanie multi-select                                                 |               +10 |
| `lib/search/__tests__/overlayTabs.test.ts`                      | fraza z przecinkiem/nawiasem, próba dołożenia warunku, `orIlikeValue`                                  |                +5 |
| `components/search/__tests__/useCommandPaletteShortcut.test.ts` | pierwszeństwo skrótu zajętego lokalnie                                                                 |                +3 |
| `components/admin/__tests__/AdminShell.test.tsx`                | Ctrl+K zajęty przed nasłuchami bąbelkowymi okna                                                        |                +1 |
| `lib/queries/__tests__/archives.test.ts`                        | D8                                                                                                     |                +1 |
| `CommandPalette.test.tsx`, `registry.test.ts`                   | dostosowane do palety sterowanej i rejestru bez `run`/`lang`                                           |                 - |

Przebieg lokalny na końcu: 228 plików, **4 940 testów zielonych** (13
`it.fails` bez zmian) - moduł, konsumenci (widget nagłówka, overlay, 404,
AdminShell), `lib/queries`, bramki i18n i `lib/ci`. Prettier i eslint czyste
na zmienionych plikach; `tsc` czysty poza brakującym pakietem `xlsx` (host
`cdn.sheetjs.com` blokuje polityka sieci środowiska - 10 błędów, wszystkie
`xlsx`, żaden w module).

## 4. Rekomendacje wydania 11 - rozliczenie po tym wdrożeniu

| rekomendacja                                                          | stan                    | dowód                                                                                            |
| --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Zresetować lokalny stan zakładki autosuggestu przy zmianie zbioru     | **wykonana**            | D2 - zakładka wyprowadzana z bieżących kubełków, test regresji na komponencie i trasie           |
| Dołożyć straże współbieżności i uprzątnąć martwy kod                  | **wykonana**            | D1b (`startingRef`, `aliveRef`), §2 (`run`, `actions`/`content`, `lang`, `bySlug`)               |
| Zamknąć frazę użytkownika w bezpiecznym kontrakcie zapytania overlayu | **wykonana**            | D3 - `orIlikeValue`, testy przecinka/nawiasu i próby dołożenia warunku                           |
| Usunąć niekontrolowany tryb `CommandPalette` (wyd. 12)                | **wykonana**            | §2                                                                                               |
| Przebudować kształt zapytań `search_posts`/`search_facets` pod GIN    | niewykonana (świadomie) | wymaga migracji i pomiaru `EXPLAIN` na danych produkcyjnych - poza zasięgiem bez dostępu do bazy |
| Indeksy pod ścieżki podobieństwa (`_suggest_score`, trigramy)         | niewykonana (świadomie) | jw.                                                                                              |

## 5. Czego dowód nadal nie obejmuje

- Planu zapytań (`EXPLAIN` dla `search_posts`, `search_facets`, użycie GIN
  i trigramów) - patrz §4.
- Lądowania pod adresem kanonicznym po 301 z `/post/<slug>` (test trasy
  sprawdza tylko cel kliknięcia).
- Escape przed zamontowaniem leniwego dialogu w `CommandPaletteHost.test.tsx`
  (pokrywa to test hooka).
- `orIlikeValue` jest sprawdzony na poziomie budowanego filtra; zachowanie
  parsera PostgREST dla wartości w cudzysłowie (udokumentowane, używane też
  przez `postgrest-js` w `.in()`) nie ma testu na żywej bazie.
- Telemetria nadal liczy frazę ponownie przy odświeżeniu zapytania po
  `staleTime` (np. powrót do karty) - przeniesienie logowania z `queryFn`
  do zdarzenia „wysłano frazę" to zmiana kontraktu `/publications`, osobny krok.

## 6. Bramki czerwone na bazie gałęzi (nie z tego PR-a)

`verify:static` pada na dwóch bramkach, które padają identycznie bez zmian
tego PR-a - oba pliki wprowadził `81d84b1`:

- `check:feature-taxonomy`: `src/lib/builder/globalColorsValue.ts` poza
  taksonomią. Proponowana poprawka: dopisać `globalColorsValue` do wzorca
  w `scripts/taxonomy/features.mjs:493`.
- `check:unknown-casts`: nowe `as unknown as` w
  `src/lib/analytics/gtagLoadPolicy.ts`.

Pozostałe bramki statyczne puszczone lokalnie (z tymczasową, wycofaną łatką
taksonomii) są zielone do miejsca `check:unknown-casts`; i18n, rzutowania,
`dangerouslySetInnerHTML`, singletony i prettier - zielone.
