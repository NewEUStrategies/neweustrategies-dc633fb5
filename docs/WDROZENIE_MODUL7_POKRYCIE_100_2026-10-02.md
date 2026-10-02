# Moduł 7 „Typy treści specjalne": 100% linii i funkcji w dziesięciu funkcjonalnościach, ~30 naprawionych defektów (2026-10-02)

Zlecenie: „optymalizuj, napraw i wdróż" dla tabeli modułu 7 z wydania 12 audytu pokrycia
(`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 16.6): 10 funkcjonalności,
329 linii bez testu, trzy pliki na zerze, dziewięć martwych funkcji nazwanych.
PR: NewEUStrategies/neweustrategies-dc633fb5#437.

---

## 1. Wynik

Pomiar istanbul, `coverage.all`, zawężony do plików modułu 7 i testów, które ich dotykają
(323 pliki testowe, 12 753 zielone + 45 przypiętych `it.fails`). Tabela wyprowadzona skryptem
repozytorium: `node scripts/taxonomy/report.mjs --summary <coverage-summary.json> --module 7`.

**Moduł: linie 92,59% -> 100,00% (4 373/4 373), funkcje 85,59% -> 100,00% (1 540/1 540),
gałęzie 86,05% -> 90,51%, plików na zerze 3 -> 0, martwych funkcji nazwanych 9 -> 0.**

| Funkcjonalność                      | Linie przed | Linie po | Funkcje przed | Funkcje po | Gałęzie po |
| ----------------------------------- | ----------: | -------: | ------------: | ---------: | ---------: |
| Proces arkuszy i pobieranie plików  |      75,6%¹ |  100,00% |         87,0% |    100,00% |     94,87% |
| Programy badawcze                   |       79,7% |  100,00% |         63,5% |    100,00% |     82,93% |
| Biblioteka członkowska i słowniczek |       84,6% |  100,00% |         70,8% |    100,00% |     84,23% |
| Web stories                         |       86,4% |  100,00% |         71,1% |    100,00% |     93,98% |
| Tracker legislacyjny                |       93,6% |  100,00% |         86,0% |    100,00% |     89,60% |
| Podcast                             |       96,0% |  100,00% |         93,8% |    100,00% |     91,74% |
| Relacje na żywo, Q&A i ankiety      |       96,2% |  100,00% |         87,4% |    100,00% |     88,89% |
| Huby ekspertów                      |       96,5% |  100,00% |         92,7% |    100,00% |     92,46% |
| Biblioteka plików                   |     100,00% |  100,00% |       100,00% |    100,00% |     90,52% |
| Quiz / mapy                         |       99,7% |  100,00% |         97,2% |    100,00% |     95,76% |

¹ Liczba audytu jest liczona z zaślepką `xlsx` (host `cdn.sheetjs.com` zablokowany w środowisku
pomiaru). Z prawdziwą biblioteką brakowało wyłącznie `spreadsheet.worker.ts` (0/5). Ten pomiar
szedł z `xlsx@0.18.5` z rejestru npm podstawionym LOKALNIE (bez zmiany `package.json`
i `bun.lock`) - CI liczy na 0.20.3 z lockfile'a.

Martwe funkcje nazwane z tabeli są dziś wywoływane przez testy, a nie usunięte - wszystkie
są żywym kodem (ekrany błędu tras, komponent panelu, proces arkuszy):
`ProgramDetailError`, `ProgramsIndexError`, `GlossaryAdmin`, `isStep`, `PodcastsIndexError`,
`AdminExpertRequests`, `act`, `onmessage` procesu arkuszy. Usunięto natomiast kod faktycznie
martwy: `notFoundComponent` liścia `admin.live-blog` (router oddaje globalne 404 najgłębszej
trasie z dziećmi, nigdy liściowi) i eksport `downloadBase64File` (jeden konsument w tym samym
pliku).

---

## 2. Naprawione defekty

Każdy ma test regresyjny sprawdzony mutacyjnie: po podmianie pliku na wersję sprzed poprawki
test pada.

### Przekrojowe

| #   | Gdzie                                                                     | Objaw                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `admin.glossary.tsx`                                                      | Trasa owijała się w `<AdminShell>`, który layout `/admin` już renderuje: **drugi pasek boczny** w kolumnie treści, drugi `main#main-content`, zdublowane zapytania powłoki.                        |
| 2   | `admin.web-stories.tsx`, `admin.podcasts.tsx`, `admin.expert-layouts.tsx` | To samo w wariancie `hideSidebar`: drugi `main#main-content` (skip-link trafiał w zewnętrzny), pływający `AdminLangBar` obok paska, który ma już przełącznik języka, podwójny padding.             |
| 3   | `scripts/taxonomy/moduleMap.mjs`                                          | `admin.newsletter.deliverability.tsx` liczony w module 7 - łapacz tras ma człon `live`, a „de-LIVE-rability" go zawiera. Audyt rozstrzygnął to 2026-09-02, mapa w kodzie liczyła dalej po staremu. |
| 4   | `src/styles.css`                                                          | `#FA9346` wielkimi literami - `format:check` w jobie `verify` czerwony od commitu „Ustawiony kolor #FA9346 dla widgetów". Zapis prettiera, wartość bez zmian.                                      |

### Programy badawcze

| #   | Gdzie                                               | Objaw                                                                                                                                                                                                          |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | `i18n-programs.ts` vs `i18n-admin-programs.ts`      | Oba słowniki w przestrzeni `adminPrograms`; `addResourceBundle(deep, overwrite)` scalał je w jedno drzewo - po wejściu w oba panele gołe klucze albo teksty cudzego panelu. Landingi: `adminResearchPrograms`. |
| 6   | `admin.research-programs.tsx`, `admin.programs.tsx` | Awaria odczytu wyglądała jak pusta lista (był przypięty `it.fails`). Teraz `role="alert"` z istniejącym kluczem.                                                                                               |
| 7   | jw.                                                 | Zapis/usunięcie programu unieważniało tylko klucz panelu; widok `research_programs` pokazuje te same wiersze co `programs`, więc strony publiczne, edytor wpisu i katalog ekspertów zostawały stare.           |
| 8   | jw.                                                 | Listy bez jawnego `.eq("tenant_id", tenantId)`, choć klucz cache zawiera tenanta.                                                                                                                              |
| 9   | jw.                                                 | Surowe enumy w UI (`published`, `[completed]`, `podcast`); UUID materiału wysyłany bez `trim()` (22P02); nagłówek okna zawsze `name_pl`; potwierdzenie kaskadowego usunięcia bez `destructive`.                |
| 10  | `programs.$slug.tsx`                                | Godzina wydarzenia z `toLocaleString` bez strefy: SSR i przeglądarka drukowały różne godziny (rozjazd hydratacji). Teraz strefa wydarzenia + etykieta strefy, jak na `/events`.                                |

### Tracker i web stories

| #   | Gdzie                   | Objaw                                                                                                                                                                                           |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11  | `tracker.$slug.tsx`     | Awaria bazy = „Nie znaleziono dossier." na HTTP 200, a pierwszy render klienta pokazywał „ładowanie" (inny HTML niż z serwera). Loader oddaje `{ item, degraded }`, widok `DegradedDataNotice`. |
| 12  | `admin.tracker.tsx`     | Wpis osi czasu unieważniał tylko `["tracker","updates",id]` (trigger zmienia etap dossier); zapis stanowisk nie unieważniał macierzy explorera.                                                 |
| 13  | `admin.web-stories.tsx` | Brak toastu przy nieudanym otwarciu historii; usunięcie nie odświeżało listy publicznej (dwa przypięte `it.fails` zamienione w zwykłe testy).                                                   |
| 14  | jw.                     | Slug: „Gdańsk" -> `gda-sk`, „Łódź" -> `d`. Ułamkowy czas planszy („2.5") nie przechodził `int()`, a `safeParsePages` odrzucał wtedy CAŁĄ historię.                                              |
| 15  | jw.                     | „Nowa historia" w trakcie edycji nadpisywała otwartą historię UPDATE-em (edytor bez `key`).                                                                                                     |
| 16  | oba panele              | Etykiety bez `htmlFor` (axe `select-name`).                                                                                                                                                     |

### Biblioteka, słowniczek, eksperci, arkusze

| #   | Gdzie                                                         | Objaw                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17  | `ExpertRequestList.tsx` (profil), `admin.expert-requests.tsx` | Po odrzuceniu zapytania toast z SUROWYM kluczem `expertRequest.status.decline` (słownik zna `declined`). Istniejący test przypinał błędny klucz, bo atrapa i18n oddaje klucze. Jedno źródło mapowania: `lib/chat/expertRequestStatus.ts` + test słownikowy PL/EN. |
| 18  | `admin.expert-requests.tsx`                                   | Brak blokady podwójnego kliknięcia (drugie RPC = „invalid status transition" zaraz po sukcesie); kolumna statusu podpisana „Oczekuje"; nagłówek akcji „-"; `<label>` filtra niepowiązany.                                                                         |
| 19  | `spreadsheetWorker.ts`                                        | Własna kopia limitu 20 MB obok `SPREADSHEET_MAX_BYTES` - jedno źródło w `spreadsheetProtocol.ts` (bez `xlsx`, więc wolno go importować po obu stronach procesu).                                                                                                  |

**Sprawdzone i NIE będące defektem:** insert słowniczka bez `tenant_id` - kolumna ma
`DEFAULT current_tenant_id()`, a polityka `WITH CHECK (tenant_id = current_tenant_id() AND is_staff())`
(`20260720134000_glossary_terms.sql`); test przypina, że ładunek nie niesie tenanta.

### Podcast, relacje na żywo, quiz

| #   | Gdzie                       | Objaw                                                                                                                                                                 |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20  | `admin.live-blog.tsx`       | Deep-link do jednego z kilku bloków ginął: wyłączone zapytanie ma w TanStack Query v5 `isLoading === false`, więc efekt uznawał „post nie ma bloków" i czyścił adres. |
| 21  | jw.                         | Po zmianie postu formularz publikacji był aktywny dla pary nowy post + stary blok - wpis, którego nie wyświetli żadna relacja.                                        |
| 22  | jw.                         | Etykiety „Live blog #n" liczone od nowa w każdym dokumencie językowym - dwa nieodróżnialne „#1".                                                                      |
| 23  | `podcast.$slug.tsx`         | `/en/podcast/...` miał polski `<title>`, `og:title`, opis i nazwę w JSON-LD (`title_pl \|\| title_en` niezależnie od języka).                                         |
| 24  | `quiz.tsx`                  | Ikona zapasowa WhatsAppa tworzona w renderze = nowy typ komponentu przy każdym renderze (przemontowanie węzła).                                                       |
| 25  | `PodcastShowsPane.test.tsx` | Test „Apple i YouTube dojeżdżają" trafiał heurystyką w opis PL i nie sprawdzał `youtube_url` - test, który przechodził bez względu na kod.                            |

---

## 3. Optymalizacje (bez zmiany zachowania)

- **Bindery pól zamiast domknięć.** Kilkadziesiąt kopii `onChange={(e) => setForm((f) => ({...f, X: ...}))}`
  zastąpiły typowane bindery: `bindDraft` (`lib/programs/adminForm.ts`, ~35 domknięć w dwóch panelach),
  `bind(key)` w trackerze, `text(key)` + `PageFields` w web stories, `LOCALIZED_FIELDS` / `SHOW_LANGS` /
  `PLATFORM_URL_FIELDS` w panelach podcastów, `indexedRowOps` zamiast czterech kopii dodaj/zmień/usuń.
  Test tabelaryczny „pole -> właściwa kolumna ładunku i TYLKO ona" jest prawdziwym kontraktem
  (pomylenie `tagline_pl`/`tagline_en` to realna klasa błędu), a nie klikaniem pól dla procentu.
- **`writeOrToast`** zastępuje 13 kopii obsługi błędu zapisu w panelach programów.
- `admin.research-programs.tsx`: 1 132 -> 1 060 linii, zniknęły dwa rzutowania `as ProgramKind` /
  `as ItemType`, martwe propsy `lang`, bezużyteczne `useMemo` (zależność od nowego `Set` w każdym renderze).
- `errorComponent` / `pendingComponent` tras publicznych jako referencje, nie domknięcia.

---

## 4. Taksonomia, zapadki, progi

- **`FEATURES_7`** w `scripts/taxonomy/features.mjs` - dziesięć wierszy tabeli audytu jako kod
  (liczności plików zgodne z audytem). `check:feature-taxonomy` pilnuje teraz także modułu 7.
- **Wyjątek mapy** `admin.newsletter.*` -> moduł 11 (patrz defekt 3).
- **Progi per-ścieżka** w `vitest.config.ts`: 32 nowe wpisy + 4 podniesione (panele podcastów).
  Reguła: metryka zmierzona na 100% -> 98, każda inna `floor(zmierzone - 4)`; żaden w dół.
  Sprawdzone skryptem na raporcie pomiaru: 47 wpisów ścieżkowych, zero naruszeń.
- **Zapadki w dół:** `clock-freeze` (`programsPublicRoutes` 3 -> 0 dzięki `freezeClock()`,
  `podcastEpisodeRoute` 6 -> 0, `EpisodeEditorPane` 7 -> 6), `monolingualUserText`
  (`PodcastShowsPane.tsx`, `podcast.$slug.tsx` 3 -> 0; baseline 164 -> 162 plików).

---

## 5. Weryfikacja przed pushem

| Krok                                                        | Wynik                                    |
| ----------------------------------------------------------- | ---------------------------------------- |
| `tsc --noEmit` (pełny)                                      | czysto                                   |
| eslint `--max-warnings=0` + prettier na zmienionych plikach | czysto                                   |
| `bun run verify:static`                                     | 33/33 bramek                             |
| `check:ci-gates`                                            | 77 plików, 1 566 testów                  |
| `check:i18n-parity`                                         | 12 plików, 164 testy                     |
| `vitest related` na zmienionych plikach                     | 141 plików, 6 728 testów + 19 `it.fails` |
| pomiar pokrycia modułu 7                                    | 323 pliki, 12 753 testy + 45 `it.fails`  |

---

## 6. Czego NIE zrobiono (zgłoszone, poza zakresem)

- **Zagnieżdżona powłoka poza modułem 7:** `admin.link-monitor.tsx` (pełna powłoka = drugi pasek
  boczny, moduł 8), `admin.content-area`, `admin.newsletter`, `admin.paywall`, `admin.personalized`
  (wariant `hideSidebar`). Ta sama naprawa, osobny PR.
- Tick powiadomień trackera melduje „wysłano 0" jako sukces także przy `{error}` /
  `vapid_not_configured` (wymaga nowego klucza i18n).
- Edytor dossier nie waliduje sluga i tytułów przed CHECK-ami bazy (surowy błąd PostgREST);
  błąd odczytu stanowisk wygląda jak brak stanowisk.
- Cztery zakładki okna treści programu nadal pokazują awarię odczytu jako pustą listę (potrzebny
  ogólny klucz komunikatu PL/EN).
- `admin.expert-requests`: RPC przepuszcza tylko odbiorcę albo superadmina, więc pracownik bez
  tej roli widzi przyciski, które zawsze kończą się „forbidden".
- Słowniczek: termin PL wyłącznie pismem niełacińskim daje pusty slug (drugi taki łamie
  `UNIQUE(tenant_id, slug)`); toast pokazuje surowy komunikat Postgresa.
- Twarde napisy w `admin.live-blog` („Post", „Live Blog - Admin", data zawsze `pl-PL`) i domyślny
  tytuł „Nowa historia" w web stories.
