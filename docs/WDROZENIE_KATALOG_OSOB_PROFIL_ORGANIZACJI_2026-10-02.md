# Katalog osób i profil organizacji: naprawy, optymalizacja i domknięcie pokrycia (2026-10-02)

Zamknięcie wiersza „Katalog osób i profil organizacji" (moduł 20) z wydania 12 audytu
(`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 16.6 i 16.8): **5 plików, 2 na zerze,
240 linii kodu, 70,83% linii, funkcje 59/74 (79,73%), gałęzie 80,50%, 4 defekty w rejestrze**.

Pliki funkcjonalności: `src/routes/people.tsx` (layout), `people.index.tsx` (katalog `/people`),
`people.$slug.tsx` (profil członka), `organization.$slug.tsx` (profil organizacji)
i `src/lib/queries/organization.ts` (warstwa danych profilu organizacji).

---

## 1. Pomiar: przed i po

Metoda identyczna po obu stronach: istanbul, mianownik zawężony do pięciu plików funkcjonalności,
numerator z plików testów, które je importują. Pełna suita w CI może liczby wyłącznie podnieść.

| Plik                      |          Linie przed |           Linie po | Funkcje przed | Funkcje po |        Gałęzie przed |           Gałęzie po |
| ------------------------- | -------------------: | -----------------: | ------------: | ---------: | -------------------: | -------------------: |
| `people.tsx`              |                  0/2 |            **2/2** |           0/1 |    **1/1** |                  0/0 |                  0/0 |
| `people.index.tsx`        |                83/83 |              82/82 |         42/42 |      42/42 |              136/138 |          **134/134** |
| `people.$slug.tsx`        |                 0/21 |          **21/21** |           0/4 |    **4/4** |                 0/14 |            **11/12** |
| `organization.$slug.tsx`  |                38/79 |          **83/83** |          3/13 |  **13/13** |                65/96 |            **90/90** |
| `queries/organization.ts` |                40/46 |          **47/47** |         11/11 |      12/12 |                38/53 |            **53/53** |
| **Razem**                 | **161/231 (69,70%)** | **235/235 (100%)** |     **56/71** |  **72/72** | **239/301 (79,40%)** | **288/289 (99,65%)** |

Plików na zerze: **2 → 0**. Liczby „przed" różnią się od wiersza audytu o ułamek punktu, bo
`organizationTerm.ts` (head-safe teksty termu) wydzielono z `organization.ts` po pomiarze audytu.

Jedyna niepokryta gałąź to `user?.id ?? null` w `people.$slug.tsx`: `AuthGate` wpuszcza wnętrze
wyłącznie z sesją, a `useAuth` liczy użytkownika z tej samej sesji. Prawej strony nie wywołujemy
sztucznie - to ta sama decyzja, którą `peopleRoute.test.tsx` zapisał dla katalogu.

## 2. Defekty z rejestru audytu (4)

| #   | Waga   | Miejsce                      | Defekt                                                                                                                                             | Naprawa                                                                                                          |
| --- | ------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | średni | `people.index.tsx:272`       | Karta pokazywała „N wspólnych kontaktów" z `mutualCount` - faktu grafu, który liczy także mosty ukryte (`discoverable = false`) i z obcego najemcy | licznik z `mutualVisibleCount` (ten sam zbiór co `mutual_connections`); reguła z `lib/network/useConnections.ts` |
| 2   | niski  | `people.index.tsx:272`       | Rozjazd opisu N3/S4: ta sama luka istniała już w wydaniu 11                                                                                        | zamknięta naprawą #1                                                                                             |
| 3   | niski  | `organization.$slug.tsx:151` | SEO i tytuł ekranu błędu składane warunkami `isEn ? … : …`, choć nakładka miała klucze                                                             | `head()` czyta `ORGANIZATION_PAGE_COPY` (head-safe mapa PL/EN), ekran błędu - `t("organization.loadFailed")`     |
| 4   | niski  | `i18n-organizations.ts:70`   | Jedyna nakładka ze starym wzorcem: pusty `ensureI18n()`, rejestracja wyłącznie efektem ubocznym importu                                            | jawna rejestracja w `ensureI18n()` (wzorzec pozostałych 101 nakładek)                                            |

Dlaczego `head()` nie woła `t()`: biegnie poza drzewem Reacta i zostaje w shellu trasy, czyli
w chunku wejściowym (patrz `lib/clubs/applyHead.ts`). Martwe klucze SEO nakładki
(`seoDescriptionFallback`, `seoTitleSuffix`, `pageSuffix`) usunięte; okruszek nakładka czyta
z `ORGANIZATION_PAGE_COPY`, więc widoczna nawigacja i JSON-LD mają jedno źródło.

## 3. Defekty znalezione w tej pracy

- **Każdy profil firmy z kartoteki szedł z `no-store`.** Slug `org-<uuid>` wskazuje firmę
  z `crm_companies`, która z definicji nie ma pivotu publikacji. Loader i tak pytał archiwum
  o kategorię `org-<uuid>`, dostawał `null` i czytał to jako awarię listy
  (`resilientCacheControl(archive === null)`). Skutek: brak cache brzegowego dla wszystkich
  profili firm i zbędny odczyt `categories` na ścieżce TTFB, a po hydratacji drugi.
  Teraz: `isCompanyOrganizationSlug()` w `organization.ts`; dla firmy loader nie pyta archiwum,
  komponent ma `enabled: false`, a sekcja publikacji znika (napis „nie ma jeszcze publikacji"
  był obietnicą, której nic nie spełni).
- **Degradacja profilu organizacji nie leczyła się.** Flaga `degraded` z loadera jest niezmienna
  przez życie dopasowania, a zasiew fallbacku refetchuje się po hydratacji. Profil zostawał pod
  komunikatem awarii (bez przycisku ponowienia) mimo zdrowego backendu. Teraz
  `useDegradedUntilHealed` (wzorzec `author.$slug.tsx`) z `onRetry`; wyleczenie do „nie ma"
  kończy się 404, a nie pustym profilem.
- **Okruszki rozjechane z danymi strukturalnymi.** Ekran: „Strona główna › Nazwa"; JSON-LD
  `BreadcrumbList`: „Strona główna › Organizacje › Nazwa". Widoczne okruszki mają teraz poziom
  „Organizacje" (`/search`) z tego samego źródła.
- **Słownik profilu członka w chunku wejściowym.** `head()` trasy `/people/$slug` importował
  surowe `memberProfilePl`/`memberProfileEn`, więc cały słownik (razem z tekstami bramki, których
  `head()` nie używa) i rejestracja nakładki jechały do `index-*.js` każdego czytelnika - ten sam
  mechanizm co incydent `club.apply` z 2026-08-13. Teraz `head()` czyta `MEMBER_PROFILE_HEAD`
  (`lib/profile/memberProfileHead.ts`, teksty 1:1), a `check:entry-purity` ma regułę
  `i18n-member-profile`.

## 4. Optymalizacje

- **Chunk wejściowy** (build produkcyjny, ta sama metoda co `check:bundle`): domknięcie bootu
  **479,5 → 473,5 KB gzip** (1 578,5 → 1 559,6 KB raw, 10 → 9 chunków). Przypisanie uczciwie:
  sam słownik zdjęty z `index-*.js` to −853 B raw / −314 B gzip. Pozostałe ~5,7 KB gzip to
  wspólny chunk `admin.analytics-*` (m.in. date-fns), który w bazie był statycznie importowany
  przez entry wyłącznie dlatego, że scalanie małych chunków (`experimentalMinChunkSize: 2048`)
  umieściło w nim stałą klucza `["checkout-success"]` potrzebną loaderowi z entry. Po zmianie
  ta stała ląduje w entry, a chunk z date-fns wypada z bootu. To skutek heurystyki scalania, nie
  gwarantowana własność - inna zmiana grafu może go przywrócić.
- `/people`: jedna, memoizowana lista identyfikatorów partii dla `useBadgesForUsers`
  i `useConnectionStatuses` zamiast dwóch `people.map()` na każdy render; martwa obrona
  `if (!user) return null` (i jej `useAuth`) usunięta z `PeopleInner`.
- `/organization/$slug`: brak odczytu archiwum dla firm z kartoteki (SSR i klient).

## 5. Testy

| Plik testów                                                           | Co dowodzi                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/__tests__/organizationRouteMount.test.tsx` (nowy, 18)         | loader i komponent zamontowane w prawdziwym routerze: polityka cache (czysty / awaria listy / 404 / degradacja), firma bez archiwum i bez sekcji publikacji, leczenie degradacji ponowieniem (do profilu i do 404), paginacja bez jawnych wartości domyślnych, okruszki = `BreadcrumbList`, EN, ekran błędu ze słownika, szkielet |
| `routes/__tests__/memberProfileRoute.test.tsx` (nowy, 11)             | `head()` PL/EN z adresu i `noindex`, bramka bez zapytań, ładowanie, awaria z ponowieniem tego samego RPC, brak profilu z drogą do katalogu, layout `/people` bez własnej treści                                                                                                                                                   |
| `routes/__tests__/peopleRoute.test.tsx` (+2)                          | wspólne kontakty WYŁĄCZNIE z widocznych mostów; same ukryte mosty nie dają ani liczby, ani pustej linijki                                                                                                                                                                                                                         |
| `routes/__tests__/organizationRoute.test.tsx` (+2)                    | teksty `head()` w języku adresu, także zastępcze (tytuł, numer strony, opis, okruszki JSON-LD)                                                                                                                                                                                                                                    |
| `lib/queries/__tests__/organization.test.ts` (+9)                     | gałąź firmy z kartoteki (`get_mention_target`), predykat `org-<uuid>`, kolumny opcjonalne → `null`, puste odpowiedzi                                                                                                                                                                                                              |
| `components/organizations/__tests__/organizationPeople.test.tsx` (+3) | sekcja bez danych, inicjały (jedno słowo, polskie znaki, interpunkcja, nazwa bez liter)                                                                                                                                                                                                                                           |

Każdy naprawiony defekt sprawdzono podmianą kodu na wersję sprzed naprawy: dwa nowe testy
`/people` padają przy `mutualCount`, osiem testów trasy organizacji pada na `organization.$slug.tsx`
z bazy (firma ×3, leczenie ×2, okruszki ×2, ekran błędu).

## 6. Podłogi pokrycia

Blok „KATALOG OSÓB I PROFIL ORGANIZACJI, WYDANIE 2026-10-02" w `vitest.config.ts`. Reguła jak
w bloku modułu 1: wartość zmierzona zaokrąglona w dół, 100 tylko tam, gdzie zmierzono 100.

| Ścieżka                               | Instrukcje / funkcje / linie / gałęzie          |
| ------------------------------------- | ----------------------------------------------- |
| `src/routes/people.index.tsx`         | 100 / 100 / 100 / 100 (było 97 / 100 / 99 / 96) |
| `src/routes/people.tsx`               | 100 / 100 / 100 / 100                           |
| `src/routes/people.$slug.tsx`         | 100 / 100 / 100 / 91                            |
| `src/routes/organization.$slug.tsx`   | 100 / 100 / 100 / 100                           |
| `src/lib/queries/organization.ts`     | 100 / 100 / 100 / 100                           |
| `src/lib/queries/organizationTerm.ts` | 100 / 100 / 100 / 100                           |
| `src/components/organizations/**`     | 100 / 100 / 100 / 94                            |

## 7. Weryfikacja

- `bun run verify:static`: 33 bramek OK (w tym `check:i18n-overlay-imports`, `check:i18n-hardcoded`,
  `check:loader-policy`, `check:ssr-budgets`).
- `check:entry-purity` na buildzie po zmianie: ścieżka bootowania czysta, z nową regułą
  `i18n-member-profile`.
- Testy powierzchni i bramek i18n/CI: 153 pliki, 3 423 zielone, 1 czerwony - patrz niżej.
- `tsc --noEmit`: zero błędów w kodzie repo (lokalnie zgłasza wyłącznie brak typów pakietu `xlsx`,
  którego nie dało się pobrać - host `cdn.sheetjs.com` jest zablokowany polityką sieci środowiska).

**Czerwony test spoza zakresu:** `src/lib/ci/__tests__/noHasSelectors.test.ts` pada na
`src/styles.css (2)`. Dwa selektory `:has()` dodał commit `9ac8117` („Naprawiono ucięty styl
w headerze") - ten sam stan jest na `main`. Ta zmiana nie dotyka `styles.css`.

## 8. Czego świadomie nie zrobiono

- Stopień oddalenia i ścieżka kontaktu na karcie `/people` (`DegreeBadge`, `ConnectionPathTrail`)
  zostały bez zmian - reguła `useConnections.ts` dotyczy liczby wspólnych kontaktów.
- `/people/$slug` nie rozwiązuje identyfikatorów UUID - linki z karty wprowadzeń naprawiono po stronie
  `IntroductionsCard` przed tą pracą.
- Skutek prawny hurtowego `discoverable = true` z `drizzle/0001` (Z1 audytu) - to decyzja prawna,
  nie kodu.
