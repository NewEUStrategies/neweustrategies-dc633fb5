# Czternaście plików na zerze (wyd. 13): naprawy, optymalizacje i testy (2026-10-16)

Zlecenie: „napraw, optymalizuj, wdrażaj testy” dla plików, które raport
pokrycia wydania 13 (`docs/audyt-ed13/`) wykazał na 0%. Było ich 14 (200
linii), w tym 12 tras. Cztery największe to ekrany modułu 4. Przez nie
funkcjonalność „Taksonomie, pola meta i układy eksperta” miała najniższe
pokrycie w raporcie (55,24% linii, poz. 17.6).

| Plik                                                     | Moduł | Linie (wyd. 13) |
| -------------------------------------------------------- | ----: | --------------: |
| `src/routes/admin.content-area.tsx`                      |     4 |              50 |
| `src/routes/admin.custom-meta.tsx`                       |     4 |              50 |
| `src/routes/admin.tags.tsx`                              |     4 |              36 |
| `src/routes/admin.appearance.font-sizes.tsx`             |     4 |              26 |
| `src/lib/clubs/useClubOwner.ts`                          |    16 |               8 |
| `src/components/admin/analytics/TrafficGeoDashboard.tsx` |    17 |               8 |
| `src/routes/feed.ts`                                     |     8 |               5 |
| `src/routes/meetings.$eventSlug.tsx`                     |    22 |               5 |
| `src/routes/mcp.ts`                                      |    20 |               3 |
| `src/routes/[.well-known]/oauth-protected-resource.ts`   |    20 |               3 |
| `src/routes/api/public/version.ts`                       |    20 |               3 |
| `src/routes/admin.newsletter.outbox.tsx`                 |    11 |               1 |
| `src/routes/profile.tickets.tsx`                         |    15 |               1 |
| `src/routes/admin.members.tsx`                           |    20 |               1 |

Każda naprawa produkcyjna ma test, który oblewa na kodzie sprzed poprawki.
Dowód zbierano przez podmianę pliku na wersję bazową i przywrócenie z kontrolą
md5. Każdą grupę zmian przejrzał niezależny recenzent adwersaryjny i
sprawdził ją mutacjami: cofał po jednej poprawce i patrzył, który test oblewa.

**Równoległa praca na main.** W trakcie tego zlecenia na main wylądował
`a94cdb0b` („Taksonomie, pola meta, obszar treści i strony CMS: poprawki i
testy”). Niezależnie poprawił on i pokrył testami trzy z tych ekranów:
`/admin/tags`, `/admin/content-area` i `/admin/custom-meta`. Dla nich bazą
jest wersja z main i jej testy. Ten PR dokłada wyłącznie defekty, które w tej
wersji nadal występowały, a nowe testy dopisuje do istniejących plików
testów z main.

---

## 1. Naprawy

### 1.1 Wysokie: utrata danych albo martwy mechanizm

| #   | Miejsce                                                           | Defekt                                                                                                                                                                                                                                                                                                                    | Naprawa                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z1  | `routes/api/public/version.ts`                                    | Identyfikator deploya był liczony w ZASIĘGU MODUŁU (`rt-${Date.now()}`). W workerd zegar zakresu globalnego stoi na 0, więc produkcja zawsze zwracała `rt-0`. Repo opisywało to samo w `documentCache.server.ts`. `LOVABLE_BUILD_ID` nie jest nigdzie ustawiany, więc `cacheBusting.ts` nigdy nie widział nowego deployu. | Kolejność źródeł: runtime `LOVABLE_BUILD_ID` → stała buildu `__NES_BUILD_ID__` (define Vite, za bramką `import.meta.env.SSR`) → leniwe `rt-<czas pierwszego żądania>`, raz na izolat. W zasięgu modułu nie liczy się nic.                                                     |
| Z2  | `routes/admin.appearance.font-sizes.tsx`, `hooks/useFontScale.ts` | Edytor startował z odczytu prezentacyjnego, który każdą awarię zamienia w pustą tabelę (`fetchSiteDesignTokensRow` łapie błąd). Zapis wysyła `font_scale` w całości, więc po chwilowym błędzie odczytu poprawka jednego wiersza kasowała pozostałe nadpisania najemcy.                                                    | Własny odczyt edytora `useAdminFontScale` (klucz `["site_font_scale","admin"]`, błąd rzuca, `staleTime: 0`). Szkic startuje wyłącznie z odczytu zakończonego po montażu, z zatrzaskiem. Błąd odczytu pokazuje alert z ponowieniem zamiast pustej tabeli.                      |
| Z3  | `routes/admin.content-area.tsx`, `hooks/usePostLayoutSettings.ts` | Ta sama klasa defektu. Publiczny `postLayoutSettingsQueryOptions` degraduje każdy błąd do domyślnych z `tenant_id: ""`, a ekran traktował to jak „najemcę bez wiersza” i pierwszy zapis wysyłał CAŁY wiersz z domyślnymi. Do tego szkic startował z wiersza sprzed minut z cache.                                         | `useAdminPostLayoutSettings` (klucz `["post-layout-settings","admin"]` pod prefiksem publicznego, błąd rzuca, `refetchOnMount: "always"`). Szkic startuje tylko ze świeżego, udanego odczytu. Błąd pokazuje alert z ponowieniem.                                              |
| Z4  | `routes/admin.content-area.tsx`                                   | Po pierwszym zapisie (INSERT) `tenant_id` szkicu zostawał pusty. Każdy kolejny zapis w tej wizycie niósł więc cały wiersz i cofał kolumny, które w międzyczasie zmienił inny panel.                                                                                                                                       | Flaga `stored` w szkicu. Pełny zapis idzie tylko przy pierwszym INSERT, kolejne wysyłają wyłącznie zmienione pola.                                                                                                                                                            |
| Z5  | `lib/customMeta.ts`, `routes/admin.custom-meta.tsx`               | Zapis szedł UPSERTEM po `(tenant_id, key)`, który nie odróżnia dodania od nadpisania ani edycji od wskrzeszenia. Klucz dodany w innej karcie był po cichu nadpisywany. Definicja usunięta w innej karcie wracała przy „Zapisz zmiany”. Lista na ekranie bywa sprzed minut.                                                | `addCustomMetaDef` używa INSERT, a 23505 oznacza „klucz zajęty”. `updateCustomMetaDef` robi UPDATE po `id` z `.select("id")`. Zero wierszy plus sprawdzenie widoczności daje „usunięta w międzyczasie” albo „brak uprawnień” (RLS). Klucz i tenant nie jadą w ładunku edycji. |
| Z6  | `routes/admin.tags.tsx`                                           | Po usunięciu tagu (kaskada `post_tags`) edytor wpisu trzymał w cache `["post-tags", id]` relację z usuniętym id. Jego zapis (`updatePost`: delete, potem insert) padał na kluczu obcym już po skasowaniu WSZYSTKICH tagów wpisu.                                                                                          | `removeQueries(["post-tags"])` po udanym usunięciu. Usunięcie zamiast unieważnienia, bo przemontowany edytor dostaje unieważnione dane jako pierwsze.                                                                                                                         |

### 1.2 Średnie i niskie

| #   | Miejsce                                                                               | Defekt                                                                                                                                                                                                       | Naprawa                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `admin.appearance.font-sizes.tsx`                                                     | Pole sterowane wartością PRZYCIĘTĄ do zakresu: „1” od razu stawało się „9”, dopisane „6” dawało „96”, a zapisywało się 18 zamiast 16.                                                                        | Surowy tekst wiersza w trakcie edycji. Przycięcie przy wyjściu z pola i przy zapisie. `aria-invalid` z zakresem jako opisem pola. `validity.badInput` nie kasuje nadpisania. |
| S2  | `admin.content-area.tsx`                                                              | Zagnieżdżona `<AdminShell hideSidebar>` w powłoce layoutu `/admin` dawała drugi `<main id="main-content">` i drugi przełącznik języka. Spad nagłówka był szerszy niż padding kolumny.                        | Bez własnej powłoki. Spad nagłówka równy `adminContentPaddingClass`.                                                                                                         |
| S3  | `admin.content-area.tsx`                                                              | Pola liczbowe, listy i pola kolorów nie miały nazwy dostępnej, bo etykiety były gołymi `<span>`.                                                                                                             | `role="group"` z `aria-labelledby`. Id etykiety trafia do kontrolek atomów przez kontekst.                                                                                   |
| S4  | `admin.custom-meta.tsx`                                                               | Brak blokady w trakcie zapisu. Reset po zapisie kasował edycję innego wiersza zaczętą w trakcie. „Edytuj” zapisywanego wiersza ładował jego stan sprzed zapisu. Etykieta „Ikona” nie była powiązana z listą. | Migawka zapisu (`saving`). Reset tylko wtedy, gdy formularz to wciąż wysłana migawka. „Edytuj” zapisywanego wiersza jest wyłączone. `useId` łączy etykietę z triggerem.      |
| S5  | `admin.tags.tsx`                                                                      | Ta sama nazwa (inne litery, spacje) tworzyła drugi tag ze slugiem `-2`, nieodróżnialny w selektorach. Blokada dodawania zwalniała się przed odświeżeniem listy. Każde × miało etykietę „Usuń”.               | Kontrola duplikatu po pełnej liście. Blokada trwa do odświeżenia. Pole czyści się tylko wtedy, gdy nazwa się nie zmieniła. Etykieta „Usuń tag {{name}}”.                     |
| S6  | `lib/clubs/useClubOwner.ts`                                                           | `useUpdateClubSettings` nie unieważniał „Moich zgłoszeń”, a `club_my_proposals` zwraca `name_pl`. Po zmianie nazwy /club pokazywało starą nazwę obok nowej.                                                  | Nazwane skutki `clubProposedKeys` i `clubOwnerSettingsKeys` w `clubInvalidations.ts`, wpisane do rejestru `clubInvalidationsForTest`, więc obejmują je inwarianty rejestru.  |
| S7  | `admin.members.tsx`, `admin.newsletter.outbox.tsx`, `admin.appearance.font-sizes.tsx` | Ekrany bez `head()` dziedziczyły ogólny tytuł „Admin”.                                                                                                                                                       | Sekcyjne `adminPageHead` (AGENTS.md).                                                                                                                                        |
| S8  | `profile.tickets.tsx`                                                                 | Brak własnego tytułu: karta i historia pokazywały „Profil - Mój panel”.                                                                                                                                      | Tytuł i opis wzorowane na `/profile/invoices`. `noindex` dziedziczy po layoucie (bramka `noindexCodeRoutes`).                                                                |

### 1.3 Optymalizacje

- **`/admin/analytics/bi`**: sekcje ruchu i mapy nie miały rezerwy wysokości
  na czas odczytu, choć te same sekcje na pulpicie `/admin` ją mają (przyczyna
  CLS 0,532). Stała `SECTION_RESERVE_PX` przeniesiona do
  `components/admin/dashboard/sectionReserve.ts`, bez zależności. Używają jej
  oba widoki. Import z `AdminDashboard.tsx` wciągnąłby cały kokpit do
  leniwego chunku BI.
- **`/admin/tags`**: osobny klucz cache i `select` jawnych kolumn są już w
  bazie z main.

### 1.4 Testy i bramki

- **Trasy MCP** (`/mcp`, `/.well-known/oauth-protected-resource`): delegacja,
  opcje identyczne z trasami `[.mcp]`, prawdziwa definicja z `auth`. Granica
  „pakiet tylko przez `await import` w handlerze” jest sprawdzana na drzewie
  składniowym źródła. Wspólny pomocnik `src/test/routeSourceImports.ts`
  zastąpił regex, który nie widział gołego importu ani re-eksportu. Używają go
  oba pliki testów MCP.
- **Bramka `staticAssetShadowing`** skanuje `src/routes/**` (poza plikami z
  prefiksem `-`). Literał `createFileRoute("${sciezka}")` w pliku testowym
  brała za trasę. Test buduje teraz oczekiwany tekst przez
  `JSON.stringify`.
- **`clubHooksModuleBoundary.test.ts`**: oba strażniki źródła mają jedną
  listę modułów, w tym `useClubOwner`, który wcześniej nie był sprawdzany.
- Nieaktualne komentarze o `rt-0` w `cacheBusting.ts`,
  `documentCache.server.ts` i `cacheBusting.test.ts` zostały poprawione.

---

## 2. Pokrycie po zmianie

Pomiar własny (istanbul): `vitest related` dla 14 plików, 85 plików testów,
3267 testów zielonych. Wszystkie pliki były na 0%.

| Plik                                                     |       Linie |     Funkcje |             Gałęzie |
| -------------------------------------------------------- | ----------: | ----------: | ------------------: |
| `src/routes/admin.content-area.tsx`                      |       76/76 |       38/38 |       89/93 (95,7%) |
| `src/routes/admin.custom-meta.tsx`                       |       76/76 |       25/25 |               67/67 |
| `src/routes/admin.tags.tsx`                              |       49/49 |       14/14 |               38/38 |
| `src/routes/admin.appearance.font-sizes.tsx`             |       56/56 |       20/20 |       37/38 (97,4%) |
| `src/lib/clubs/useClubOwner.ts`                          |         8/8 |         6/6 |                   - |
| `src/components/admin/analytics/TrafficGeoDashboard.tsx` |         8/8 |         3/3 |                 8/8 |
| `src/routes/feed.ts`                                     |         5/5 |         1/1 |                 2/2 |
| `src/routes/meetings.$eventSlug.tsx`                     |         5/5 |         3/3 |                   - |
| `src/routes/mcp.ts`                                      |         3/3 |         1/1 |                   - |
| `src/routes/[.well-known]/oauth-protected-resource.ts`   |         3/3 |         1/1 |                   - |
| `src/routes/api/public/version.ts`                       |         7/7 |         3/3 |                 9/9 |
| `src/routes/admin.newsletter.outbox.tsx`                 |         2/2 |         1/1 |                   - |
| `src/routes/profile.tickets.tsx`                         |         2/2 |         1/1 |                   - |
| `src/routes/admin.members.tsx`                           |         2/2 |         1/1 |                   - |
| **Razem**                                                | **302/302** | **118/118** | **250/255 (98,0%)** |

Pięć niepokrytych gałęzi to martwe ścieżki:

- strażnik `NaN` pola `type=number`, nieosiągalny ani w przeglądarce, ani w
  happy-dom;
- cztery domyślne wartości atomów formularza z bazy main (`step = 1`,
  `unit ? … : null`, `description ? … : null`, `Number.isFinite(value) ? value : 0`),
  których żadne miejsce wywołania nie uruchamia.

Szerszy przebieg `vitest related` po WSZYSTKICH plikach zmienionych względem
main (testy zmienionych plików i ich konsumentów) dał 274 pliki i 9689 testów
zielonych. 57 to istniejące wcześniej `it.fails`. Przeszły też `tsgo --noEmit`,
eslint, prettier, `check:ts-sql-contract`, `check:on-conflict-arbiters`,
`check:rpc-contract` i `check:public-assets`.

Uwaga do pomiaru: `--coverage.include` traktuje `[.well-known]` jak klasę
znaków glob. Ten plik trzeba mierzyć wzorcem `src/routes/**/oauth-protected-resource.ts`.

---

## 3. Poza zakresem: znalezione, nie ruszane

- `admin.categories.tsx`: po usunięciu kategorii `["post-cats"]` zostaje w
  cache. `post_categories` też ma `ON DELETE CASCADE`, więc to ten sam defekt
  co Z6.
- `updatePost` (`lib/content.functions.ts`) zamienia relacje wpisu przez
  delete, potem insert, poza transakcją. Insert odrzucony na kluczu obcym
  zostawia wpis bez żadnych tagów. Z6 zamyka tylko ścieżkę z tej samej karty.
  Trwała naprawa wymaga RPC w transakcji albo filtrowania nieistniejących id.
- `PostLayoutsSettingsPanel` i `ThemeFontSizesPane` nadal czytają
  degradujący klucz publiczny. To ta sama klasa co Z2 i Z3, do sprawdzenia w
  ich modułach.
- `deleteCustomMetaDef` nie prosi o usunięte wiersze. Autor, któremu RLS
  usuwa 0 wierszy, dostaje „Usunięto”. Naprawa byłaby lustrem Z5.
- `/admin/custom-meta` nie ma bramki ról: autor dostaje surowe 42501 przy
  dodawaniu.
- Kontrola duplikatu tagów działa tylko na wczytanej liście. Pełna ochrona to
  kontrola nazwy w `createTag`. `useInlineTaxonomy` wstawia tagi z pominięciem
  `createTag`.
- `clubUpsertedKeys` (zapis klubu z panelu) nie obejmuje `bySlugAll()` ani
  `myProposals()`.
- `src/routes/api/public/-jobs-tick.test.ts` ma ten sam dziurawy regex
  granicy importu (handler `POST`, więc pomocnik wymaga parametru nazwy).
- Bramka `staticAssetShadowing` nie pomija `__tests__` ani `*.test.*`, choć
  `routeFileIgnorePattern` generatora tras je pomija.
