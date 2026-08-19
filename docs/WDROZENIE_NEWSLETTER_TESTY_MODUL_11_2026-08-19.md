# Newsletter i e-mail (MODUŁ 11): z 26,70% na 81,74% linii, sześć defektów i bramka gęstości asercji (2026-08-19)

Ten sam ruch, co PR #250 zrobił dla czatu
(`docs/WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md`) i PR #252 dla profilu
(`docs/WDROZENIE_PROFIL_TESTY_2026-08-18.md`), zastosowany do **MODUŁU 11 —
newsletter i e-mail**, który audyt `AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`
(PR #254) wskazał jako najgorszy pojedynczy dług w repo: **3 501 nieprzetestowanych
linii, 70 plików ze 135 na zerze, T/P 0,252**.

Różnica wobec dwóch poprzednich wdrożeń jest jedna, ale zasadnicza: **panel
administracyjny jest tu w zakresie**. Decyzja właściciela produktu brzmiała
„panel wolno refaktorować i ma dojść do 90–95%", co unieważnia obowiązującą
dotąd w repo regułę „paneli nie testujemy". 37 plików panelu newslettera stało
na **1,4% linii** - to była największa zerowa powierzchnia w całym audycie.

---

## 1. Stan wyjściowy: liczby z audytu

Tabela niżej jest przepisana z audytu (§MODUŁ 11), a nie zmierzona ponownie.
Powód jest ten sam, który uniemożliwia zaświadczenie „cała suita zielona"
(§6.5): pełny przebieg `bun run test` zawiesza się i zawieszał się PRZED tą
gałęzią, więc odtworzenie pomiaru bazowego w tej samej metodologii co audyt
(cała suita, `all: true`) nie było wykonalne. Pomiar PO zmianie (§4) jest
własny, w zakresie modułu, na tej samej definicji ścieżek co audyt.

| Funkcjonalność (audyt §MODUŁ 11)                  | Plików | Instr. |  Gał. | Funkcje |  Linie |
| ------------------------------------------------- | -----: | -----: | ----: | ------: | -----: |
| Newsletter: doręczalność (SPF/DKIM, bounces)      |      2 |   0,0% |  0,0% |    0,0% |   0,0% |
| POPUP: telemetria zdarzeń                         |      2 |   0,0% |  0,0% |    0,0% |   0,0% |
| Newsletter: panel admina                          |     37 |   1,3% |  1,2% |    0,5% |   1,4% |
| Newsletter: zapis + double opt-in + potwierdzenie |      4 |  15,5% | 12,3% |   28,0% |  14,3% |
| Newsletter: kampanie i wysyłka                    |      3 |  16,2% |  7,7% |    7,1% |  17,9% |
| POPUP: host i wyświetlanie                        |      2 |  21,5% | 27,6% |   28,6% |  19,8% |
| POPUP: edytor popupu w adminie                    |     15 |  25,5% | 31,2% |   21,3% |  26,0% |
| Newsletter: wypis (unsubscribe)                   |      3 |  37,2% | 26,0% |   25,0% |  38,5% |
| Newsletter: builder maila                         |      8 |  37,6% | 26,2% |   40,2% |  38,8% |
| POPUP: panel zapisu (formularz + zgody)           |      3 |  43,5% | 42,5% |   47,6% |  44,7% |
| E-maile systemowe / transakcyjne                  |     38 |  54,9% | 39,9% |   49,4% |  56,6% |
| Newsletter: telemetria (open/click, engagement)   |      8 |  68,7% | 63,1% |   78,6% |  68,1% |
| POPUP: wygląd (design tokens)                     |      1 |  98,0% | 91,8% |  100,0% | 100,0% |

Razem: **26,05% instrukcji / 21,30% gałęzi / 20,74% funkcji / 26,70% linii**.

### 1.1 Dlaczego pokrycie tu stało w miejscu

Nie brak chęci - **cztery różne koszty wejścia**, każdy wystarczający, żeby
odłożyć test „na później":

1. **`createServerFn` z TanStack Start.** Warstwa danych newslettera to server
   functions z `method`/`middleware`/`validator`/`handler`. W teście trzeba
   dostać się do handlera BEZ uruchamiania routera - stąd atrapa
   `src/test/serverFn.ts` (`serverFnModuleMock()`, `setServerFnContext`,
   `serverFnMeta`), która wykonuje handler wprost i jednocześnie pozwala
   sprawdzić, czym funkcja jest OBUDOWANA (metoda POST, obecność walidatora,
   nazwy middleware). To drugie okazało się ważniejsze od pierwszego: `GET`
   zamiast `POST` na zapisie znaczy cachowalny mutator, a brak walidatora
   znaczy dowolny ładunek w bazie.
2. **@dnd-kit w builderze i kreatorze kampanii.** Prawdziwe przeciąganie jest
   w happy-dom niewykonalne (`getBoundingClientRect` zwraca zera). Wzorzec:
   atrapa `@dnd-kit/core`, która PRZECHWYTUJE propsy `onDragStart`/`onDragEnd`
   z `DndContext` i pozwala je zawołać z własnym ładunkiem, plus `DragOverlay`
   podmieniony na przepuszczający `div`.
3. **Radix w happy-dom.** `SelectItem value=""` rzuca wyjątkiem (stąd wartownik
   `"all"` w filtrach), `Select` otwiera listę na `keyDown{key:"Enter"}`, a
   `Tabs` aktywują zakładkę na `mouseDown`, nie na samym `click`.
4. **Łańcuch PostgREST.** Ten koszt był już zapłacony - `src/test/supabaseChain.ts`
   (wydzielony w PR #252) daje pełny thenable łańcuch z NAGRYWANIEM wywołań
   (`RecordedChain.has()`, `argsOf()`, `chainsFor(table)`, `TableResponder`).
   Ta warstwa testów go używa i nie dokłada drugiej atrapy - dopisała tylko
   `realtimeStub()` i wykorzystała istniejący `storageStub()`.

---

## 2. Refaktor: reguły wyprowadzone z paneli do czystych modułów

Panel na 1,4% nie da się doprowadzić do 95% samymi testami komponentu - reguła
zapisana w środku `useState` w 900-linijkowym pliku jest sprawdzalna tylko przez
kliknięcie. Dlatego **każdy panel dostał dwie warstwy**: reguły w czystym module
(walidacja, mapowanie, formatowanie, wybór stanu) i test komponentu przez
`@testing-library/react` z asercjami na TREŚCI i STANIE.

Dwanaście nowych modułów reguł, wszystkie wydzielone **bez zmiany zachowania**
(zmiana zachowania - jeśli była - szła osobnym commitem, §3):

| Moduł reguł                          | Co pilnuje                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `builder/builderDoc.ts`              | cel upuszczenia, przenoszenie widgetów, wyjście z dwóch kolumn, zaczep doku |
| `campaignBlocks.ts`                  | dodawanie/duplikowanie/kolejność bloków kampanii, klucz zapytania listy     |
| `subscribers/importCsvMapping.ts`    | auto-mapowanie nagłówków CSV, walidacja wiersza, składanie ładunku importu  |
| `subscribers/subscriberTable.ts`     | filtry listy, ostrzeżenie o urwanym pobraniu, eksport CSV                   |
| `subscribers/subscriberDetail.ts`    | odczyt metadanych i zgód, os czasu subskrybenta                             |
| `deliverability/suppressionTable.ts` | filtr listy wykluczeń, limit, normalizacja adresu, eksport z diagnostyką    |
| `logFilters.ts`                      | JEDNA reguła filtrów dla OBU logów (systemowego i webhooka autoryzacji)     |
| `system-emails/systemEmailsView.ts`  | zakresy, tony statusów, wskaźnik doręczeń, serie wykresu                    |
| `system-emails/txContentRules.ts`    | nadpisania treści maili transakcyjnych, znacznik niezapisanych zmian        |
| `system-emails/authPreviewRules.ts`  | wybór szablonu podglądu, szerokość ramki, imię w powitaniu                  |
| `auth-logs/authLogsView.ts`          | zakresy i tony logu webhooka, źródło rozpoznania języka                     |
| `overviewKpis.ts`                    | wskaźniki 30-dniowe, zmiana procentowa, wskaźnik potwierdzeń                |

`src/lib/csv/formatCsv.ts` to trzynasty, ale w innej roli: **wspólne cytowanie
CSV dla całego repo**. Dwa eksporty newslettera (subskrybenci i lista wykluczeń)
miały dwie kopie tej samej reguły. Diagnostyka dostawcy zawiera przecinki
(„550, mailbox full") - bez cytowania plik rozjeżdża się o kolumnę i przypisuje
komuś cudzy powód blokady.

**i18n:** funkcje reguł zwracają dane albo KLUCZ tłumaczenia, nigdy gotowy
tekst - inaczej test panelu zależałby od copy. Bramka
`src/lib/__tests__/i18nNewsletterAdmin.test.ts` została zaktualizowana, żeby
szła za wyprowadzonymi mapami etykiet (`BLOCK_LABEL_KEYS`, `TYPE_LABEL_KEYS`),
a nie za panelami, w których ich już nie ma.

---

## 3. Sześć defektów znalezionych testami, każdy osobnym commitem

### 3.1 Wybór kolumn w imporcie CSV wywracał dialog

`ImportCsvDialog` renderował Radixowy `SelectItem` z `value=""` dla opcji
„pomiń tę kolumnę". Radix rzuca na to wyjątkiem - dialog importu wywracał się
przy pierwszym otwarciu selektora mapowania. Poprawka: wartownik `"__skip"`
mapowany na pusty klucz w regule.

Commit: `fix(newsletter): napraw wywracający się wybór kolumn w imporcie CSV`.

### 3.2 Import CSV zapisywał zgodę, której nikt nie wyraził

Trzy defekty w jednym pliku reguł, wszystkie w tę samą stronę - **na korzyść
zapisania czegoś, czego w pliku nie było**:

- kolumna języka nie była w ogóle czytana (`readLanguage` nie istniał), więc
  każdy import lądował jako polski, także lista wyłącznie anglojęzyczna;
- kolumna statusu była czytana dosłownie, więc `"tak"`, `"yes"`, `"active"` -
  słowa, którymi ludzie realnie opisują zgodę w arkuszu - nie mapowały się na
  nic, a wiersz dostawał status domyślny;
- nagłówek `"company name"` mapował się na **nazwę wyświetlaną**, nie na firmę,
  bo reguła nazwy stała przed regułą firmy.

Skutek łączny: import listy z arkusza zapisywał adresy z językiem i statusem
wziętym z powietrza. W module, w którym status znaczy „ta osoba wyraziła zgodę",
to defekt zgodności, nie kosmetyka. Poprawka: `readLanguage()`, słownik
`STATUS_WORDS` + `readStatus(raw, statusMapped)`, reguła firmy przeniesiona
przed regułę nazwy z granicą słowa `/(company|\bfirm)/`.

Commit: `fix(newsletter): import CSV nie zapisuje już zgody, której nikt nie wyraził`.

### 3.3 Komunikat „nie znaleziono popupu" był NIEOSIĄGALNY

`PopupEditorPane` sprawdzał `if (loading || (!popup && !doc))` PRZED `if (!popup)`.
Pierwszy warunek łapał też przypadek „wczytywanie skończone, rekordu nie ma",
więc gałąź `notFound` nie wykonywała się nigdy. Operator wchodzący w usunięty
albo obcy popup patrzył na „Ładowanie..." bez końca i **bez drogi powrotu**.
Poprawka: rozdzielenie warunków - najpierw `loading`, potem `!popup`.

### 3.4 Osiem pól edytora popupu bez powiązania z etykietą

`signup/controls.tsx` renderował `<Label>` jako rodzeństwo pola. Bez `htmlFor`
powiązanie nie istniało: czytnik ekranu ogłaszał nienazwane pola (WCAG 1.3.1 /
4.1.2), a kliknięcie etykiety nie fokusowało pola. W `BilingualRow` dotyczyło to
obu wersji językowych naraz. Poprawka: `useId()` + `htmlFor`/`id`
(`${groupId}-${f.code}`), więc etykiety brzmią „Tytuł (PL)" / „Tytuł (EN)".

Commity 3.3 i 3.4: `fix(popups): osiągalny komunikat „nie znaleziono” i etykiety powiązane z polami`.

### 3.5 Nieodczytany log mówił „brak wpisów w zakresie"

Gdy zapytanie o log maili systemowych albo autoryzacyjnych kończyło się błędem,
panel pokazywał JEDNOCZEŚNIE komunikat awarii nad tabelą i wiersz „brak wysyłek
w wybranym zakresie" w środku. Dwa sprzeczne komunikaty: pierwszy mówi „nie
wiem", drugi „wiem, że nic nie było". Operator patrzący na tabelę wychodził z
przekonaniem, że w okresie nic nie wyszło - a log mógł być pełny, tylko
nieodczytany. Przy diagnozie awarii poczty to najgorsza możliwa pomyłka: kasuje
jedyny sygnał, że coś jest nie tak. Poprawka bez nowych kluczy i18n - pusty
wiersz pokazuje `error`, gdy `isError`.

Commit: `fix(newsletter): log nieodczytany nie mówi już „brak wpisów w zakresie"`.

### 3.6 Defekt W TEŚCIE: przypadek, który przechodził z niewłaściwego powodu

Dwa przypadki telemetrii popupu podmieniały `window.sessionStorage` przez
`vi.spyOn`. Magazyn happy-dom jest `Proxy` i `restoreAllMocks()` **zostawiał
atrapę na miejscu** - test awarii ZAPISU przechodził dlatego, że wywracał się
jeszcze ODCZYT z poprzedniego przypadku. Gdyby moduł przestał w ogóle próbować
zapisywać, test nadal byłby zielony. Zamiast szpiega jest `withStorage()`, które
podmienia cały magazyn i przywraca go w `finally`; asercje sprawdzają teraz
KTÓRE wywołania nastąpiły, nie tylko wynik.

Wliczone tu, bo jest tej samej natury co pozostałe pięć: test, który nie mówi
prawdy, jest gorszy od braku testu - obiecuje pokrycie, którego nie ma.

---

## 4. Wynik: przed → po (własny pomiar)

Pomiar własny na HEAD tej gałęzi, ta sama definicja ścieżek co w audycie
(§ „Zakres modułów", wiersz 11), `--coverage.all=true`, żeby pliki bez testu
liczyły się jako zero.

### 4.1 Moduł 11 razem

| Metryka    |  Audyt |         Po | Delta      |
| ---------- | -----: | ---------: | ---------- |
| Instrukcje | 26,05% | **80,76%** | +54,71 pkt |
| Gałęzie    | 21,30% | **73,05%** | +51,75 pkt |
| Funkcje    | 20,74% | **84,79%** | +64,05 pkt |
| Linie      | 26,70% | **81,74%** | +55,04 pkt |

Plików ze zerowym pokryciem: **70 → 22** (§6 mówi, które zostają i dlaczego).
Nieprzetestowanych linii: **3 501 → 787**.

### 4.2 Per powierzchnia

| Powierzchnia                         | Plików | Instr. | Gałęzie | Funkcje |  Linie |
| ------------------------------------ | -----: | -----: | ------: | ------: | -----: |
| `src/components/admin/newsletter/**` |     35 | 98,37% |  91,13% |  99,21% | 99,19% |
| `src/components/admin/popups/**`     |     12 | 98,80% |  89,42% |  99,49% | 99,68% |
| `src/components/popups/**`           |      2 | 95,10% |  82,03% | 100,00% | 98,32% |
| `src/lib/newsletter-builder/**`      |      4 | 100,0% |  94,44% | 100,00% | 100,0% |
| `src/lib/newsletter/**`              |     13 | 83,55% |  79,90% |  89,09% | 84,95% |
| `src/lib/email/**`                   |     19 | 78,15% |  65,74% |  83,89% | 78,99% |

Panel newslettera: **1,4% → 99,19% linii**. Edytory popupów: **26,0% → 99,68%**.

### 4.3 Per panel i plik krytyczny (przed → po, linie)

Kolumna „Przed" pochodzi z audytu, który podaje liczby **per funkcjonalność**, a
nie per plik - dla plików w jednej grupie jest to więc wartość grupy, nie pomiar
tego jednego pliku. Wyjątkiem są pliki, które audyt zastał na czystym zerze:
tam „0%" jest dokładne.

| Plik                                                   | Przed |     Po | Gałęzie po |
| ------------------------------------------------------ | ----: | -----: | ---------: |
| `lib/newsletter-deliverability.functions.ts`           |    0% | 100,0% |     94,52% |
| `lib/email/reputationGate.server.ts`                   |    0% | 100,0% |    100,00% |
| `lib/email/auth-events.server.ts`                      |    0% | 100,0% |     98,31% |
| `lib/email/provider.server.ts`                         |    0% | 100,0% |    100,00% |
| `lib/newsletter.functions.ts`                          | 14,3% | 100,0% |     91,95% |
| `routes/api.public.newsletter.confirm.ts`              | 14,3% | 100,0% |    100,00% |
| `routes/email/unsubscribe.ts`                          | 38,5% | 100,0% |     94,87% |
| `lib/newsletter-campaigns.functions.ts`                | 17,9% | 88,36% |     81,02% |
| `lib/newsletter-popup-events.functions.ts`             |    0% | 100,0% |     91,67% |
| `lib/newsletter/popupTelemetry.ts`                     |    0% | 100,0% |    100,00% |
| `admin/newsletter/builder/PropertiesPanel.tsx`         |    0% | 100,0% |     89,61% |
| `admin/newsletter/builder/NewsletterBuilder.tsx`       |    0% | 98,70% |     90,60% |
| `admin/newsletter/SubscribersPanel.tsx`                |    0% | 98,21% |     88,89% |
| `admin/newsletter/subscribers/ImportCsvDialog.tsx`     |    0% | 91,84% |     88,89% |
| `admin/newsletter/OverviewPanel.tsx`                   |    0% | 100,0% |     94,32% |
| `admin/newsletter/CampaignContentBuilder.tsx`          |    0% | 100,0% |     88,24% |
| `admin/newsletter/system-emails/SystemEmailsPanel.tsx` |    0% | 100,0% |    100,00% |
| `admin/newsletter/auth-logs/AuthEmailLogsPanel.tsx`    |    0% | 100,0% |    100,00% |
| `admin/popups/PopupEditorPane.tsx`                     | 26,0% | 100,0% |     96,15% |
| `components/popups/PopupHost.tsx`                      | 19,8% | 97,89% |     89,16% |

### 4.4 Testy

**621 plików testowych, 8 365 zielonych testów** w przebiegu obejmującym całe
`src/lib`, `src/hooks`, `src/routes` oraz katalogi newslettera i popupów.
**57 z tych plików jest nowych** (1 685 przypadków). Jeden test jest czerwony -
`src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts > exports exactly the
same component names` - i był czerwony PRZED tą gałęzią; nie dotyczy modułu 11
i nie jest tu naprawiany.

---

## 5. Gęstość asercji: reguła i bramka, która jej pilnuje

Wymóg zadania brzmiał **minimum dwie asercje na przypadek testowy**, z zakazem
testów bez asercji wyniku. To nie jest kaprys: repo raz już usunęło całą warstwę
testów panelu, bo przypadki tylko renderowały komponent i sprawdzały, że nic nie
rzuciło wyjątkiem - ślad po tym stoi w komentarzu przy progach globalnych w
`vitest.config.ts`.

Pierwszy pomiar po zamknięciu warstwy dał **1,86 asercji na przypadek** i - co
ważniejsze od średniej - **477 przypadków z jedną asercją**, w tym dziesiątki
opartych o `expect(container.innerHTML).not.toBe("")`, czyli dokładnie o to,
czego reguła zakazuje. Pięć commitów domknęło to nie przez dopisywanie asercji
„na liczbę", a przez pytanie **czego pierwsza asercja NIE sprawdza**:

- czy pokazało się TYLKO to (przełączenie zakładki gasi poprzednią, wybór
  szablonu gasi poprzednią ramkę, ostrzeżenie o kontraście milczy kompletnie);
- czy element, który widać, DZIAŁA (wymuszony przycisk zamknięcia popupu
  naprawdę zamyka, zablokowany zapis nie wysyła drugiego żądania);
- czy wartość ma właściwy TYP (liczba, nie napis - `frequencyDays || 7` na
  napisie „0" dałoby 7; `null`, nie pusty napis - pusty poszedłby do zapytania
  jako `ilike '%%'`);
- czy nie zdarzył się efekt uboczny, którego nie chcemy (popup pominięty
  warunkiem nie zgłasza WYŚWIETLENIA - inaczej konwersja w panelu jest
  rozcieńczona pokazami, których nikt nie widział; odrzucenie ładunku następuje
  PRZED zapisem do bazy).

**Wynik: 1 685 przypadków, 3 584 asercje, gęstość 2,13. Przypadków z jedną
asercją i bez pętli: 0.**

Reguła bez bramki eroduje przy pierwszym pośpiechu, więc
`src/lib/__tests__/newsletterTestAssertionDensity.test.ts` pilnuje jej
mechanicznie: przechodzi po testach modułu 11 i wymaga, żeby żaden przypadek nie
miał mniej niż dwóch asercji. Przypadek z pętlą (`for (const x of REGISTRY)
expect(...)`) jest zwolniony - statycznie widać tam jedno `expect`, a wykonuje
się ich tyle, ile pozycji rejestru. Bramka sprawdza też SIEBIE: liczbę objętych
przypadków (inaczej milczałaby po przeniesieniu katalogu) i to, że lista
zwolnień nie zawiera plików, których już nie ma - martwa pozycja jest cichym
sposobem na wyłączenie bramki dla pliku, który ktoś potem przeniósł.

**Dług zastany jest jawny, nie schowany.** 22 pliki sprzed tej warstwy (razem 68
przypadków z jedną asercją) stoją na liście `LEGACY` z liczbami. Nie są
naprawiane, bo pokrywają reguły sprawdzone gdzie indziej - tokeny śledzenia,
`emailDoc`, `renderEmailHtml`, audiencja kampanii, projekt popupu - a
przepisywanie ich nie dodałoby wiedzy o module, tylko rozmyło zmianę. Zadanie
wprost zakazywało dublowania tych reguł. Nowy plik w tych katalogach jest objęty
bramką automatycznie.

---

## 6. Co pominięte i dlaczego

### 6.1 Powłoki tras panelu (22 pliki, razem ~340 linii)

Trzynaście plików `src/routes/admin.newsletter.*.tsx` to powłoki po 1-2 linie -
`createFileRoute` + `<Panel />`. Sam panel jest pokryty w 99%, a powłoka nie ma
własnego zachowania, więc test dotknąłby wyłącznie rejestracji trasy - a ta jest
generowana do `src/routeTree.gen.ts`, którego nie wolno edytować ręcznie i który
nie wchodzi do pomiaru pokrycia.

Trzy z nich to jednak PRAWDZIWY kod, świadomie zostawiony:

- **`admin.newsletter.campaigns.$id.tsx` (102 linie, 0%)** - formularz edycji
  kampanii z zapisem, harmonogramem i wysyłką próbną. Reguły, na których stoi
  (audiencja, blokada wysyłki, treść dokumentu), są pokryte w
  `newsletter-campaigns.functions.ts` (88,4%) i `campaignBlocks.ts` (100%);
  brakuje warstwy spinającej. To najgrubszy pojedynczy dług, który tu zostaje.
- **`admin.newsletter.campaigns.index.tsx` (66 linii, 0%)** - lista kampanii.
- **`admin.newsletter.overview.tsx` (15 linii, 0%)**.

### 6.2 `NewsletterDocRenderer.tsx` (189 linii, 5,3%)

Renderer dokumentu newslettera po stronie STRONY (nie maila). Jego bliźniak dla
maila - `renderEmailHtml` - ma własne testy (80,4% linii), a reguły dokumentu
(`emailDoc`, `sections`) mają swoje. Renderer strony wymaga pełnego
środowiska widgetów buildera; koszt wejścia jest tu bliższy testowi buildera
stron niż newslettera. Zostawione jawnie.

### 6.3 Poczta transakcyjna: trzy pliki serwerowe

- **`lib/email/transactional.server.ts` (72 linie, 8,3%)** - kolejka maili
  transakcyjnych. Trasa, która ją wywołuje
  (`routes/platform/email/transactional/send.ts`), jest pokryta w 98% wraz z
  trzema bramkami bezpieczeństwa i cyklem życia tokenu wypisu; sama kolejka
  wymaga atrapy schedulera i jest osobnym zakresem.
- **`lib/email/tx-preview.server.ts` (40 linii, 0%)** i
  **`platformCompat.server.ts` (10 linii, 0%)** - warstwa podglądu i zgodności.
- **`lib/email/suppression.server.ts` (50%)** - reguły listy wykluczeń żyją w
  bazie i są sprawdzane przez **pięć plików pgTAP**
  (`email_suppression_test.sql`, `email_suppression_unification_test.sql`,
  `newsletter_email_ci_unique_test.sql`,
  `newsletter_campaign_events_dedup_test.sql`,
  `newsletter_campaign_events_backfill_test.sql`). Zadanie wprost zakazywało
  dublowania tego w vitest.

### 6.4 Twarde polskie napisy w dwóch panelach - UDOKUMENTOWANE, nie naprawione

`OverviewPanel.tsx` i `PopupPreview.tsx` mają copy wpisane po polsku na sztywno,
więc **angielskojęzyczny operator widzi polskie komunikaty**. Testy
CHARAKTERYZUJĄ ten stan z komentarzem `CHARAKTERYSTYKA STANU OBECNEGO` i asercją,
która wywróci się po poprawce (`expect(en.textContent).toMatch(/[ąćęłńóśźż]/)`).
Nie jest to naprawione tutaj, bo i18n jest bramką blokującą: przeniesienie tego
copy do słownika to kilkadziesiąt nowych kluczy w PL i EN, czyli osobna zmiana
o innym ryzyku niż warstwa testów.

### 6.5 Czego NIE dało się zweryfikować: pełny przebieg suity

**`bun run test` (cała suita) ZAWIESZA SIĘ** - i robił to PRZED tą gałęzią.
Zbisektowane do `src/components/admin` i `src/components/builder`; limit 900 s
ubił oba przebiegi po ~47 kropkach, więc to zawieszenie, nie wolność
(`--testTimeout` nie wyprowadza z niego). Konsekwencja jest wprost: **nie mogę
zaświadczyć, że „cała suita jest zielona"**. Zweryfikowany jest przebieg w
zakresie modułu - całe `src/lib`, `src/hooks`, `src/routes` plus katalogi
newslettera i popupów - i on jest zielony poza jednym zastanym czerwonym testem
(§4.4). Diagnoza zawieszenia to osobne zadanie.

### 6.6 Zakres świadomie nietknięty

- **Reguły już pokryte gdzie indziej**: `emailDoc`, `renderEmailHtml`,
  `tracking*`, `popupDesign`, `popupFields`, `campaignAudience`,
  `engagementRate`, `subscribeFeedback`, `newsletter-builder/sections`. Zadanie
  wprost zakazywało ich dublowania.
- **Unikalność adresu i lista wykluczeń na poziomie bazy** - pięć plików pgTAP.
- **`lib/newsletter-admin.functions.ts` (53 linie, 0%)** - server functions
  panelu wołane wyłącznie z powłok tras z §6.1; wchodzą razem z nimi.

---

## 7. Bramki pokrycia (`vitest.config.ts`)

Progi są floorowane **~4 pkt pod zmierzonym poziomem** (marża na dryf CI) i wolno
je wyłącznie podnosić. Każdy wpis ma komentarz mówiący, CO pilnuje - nie „ile
procent", a którą regułę produktu jego złamanie by zabrało. Żaden istniejący próg
w pliku nie został obniżony.

Siatki katalogowe (chronią to, co ktoś DOŁOŻY, nie tylko to, co napisane):

```
src/components/admin/newsletter/**   statements 95 / functions 95 / lines 95 / branches 85
src/components/admin/popups/**       statements 95 / functions 95 / lines 95 / branches 85
src/components/popups/**             statements 94 / functions 100 / lines 97 / branches 80
src/lib/newsletter/**                statements 79 / functions 84 / lines 80 / branches 75
src/lib/email/**                     statements 74 / functions 79 / lines 74 / branches 61
```

Dwie ostatnie są niżej z rozmysłu - w tych katalogach zostają powierzchnie z §6.3.
Nie są zaniżone „na zapas": trzymają się tuż pod pomiarem, więc dołożenie pliku
bez testu je zapali.

Do tego progi plikowe - **68 wpisów modułu 11 razem z siatkami wyżej**: cztery
pliki doręczalności (100% linii), trasy pocztowe, funkcje zapisu i wypisu,
wszystkie panele newslettera, wszystkie edytory popupów i dwanaście modułów
reguł z §2 (większość na 100% na wszystkich czterech metrykach - to czysta
warstwa, więc każde niedobicie znaczy martwy kod albo brakujący przypadek).

**Zweryfikowane pomiarem**: przebieg w zakresie modułu z włączonymi progami
zgłasza **zero naruszeń dla ścieżek modułu 11**
(`grep -cE 'ERROR: Coverage.*(newsletter|popup|email|nl-|csv)'` = 0). Progi
powierzchni POZA modułem 11 zapalają się w tym przebiegu z oczywistego powodu -
ich testy nie są w nim uruchamiane - więc weryfikacja jest zawężona do progów,
których ta zmiana dotyczy. Pełnego przebiegu z progami nie da się tu wykonać
(§6.5).

**PRZYWRÓCENIE PO SCALENIU PR #264.** Scalenie `main` do gałęzi (commit
`c9d3983`, wykonane poza tą sesją) rozstrzygnęło konflikt w `vitest.config.ts`
na korzyść `main` i **wyrzuciło wszystkie 68 progów modułu 11** - testy zostały,
zapora zniknęła. Ponieważ w tym samym oknie scaliło się osiem innych modułów, na
`main` przybyło 88 własnych wpisów, więc konflikt był realny, nie do
zautomatyzowania. Progi wróciły jako suma obu stron (204 wpisy, zero
zdublowanych kluczy) - żaden wpis `main` nie został ruszony ani obniżony.

`reportOnFailure: true` zostało włączone w pierwszym commicie gałęzi: bez tego
raport pokrycia nie powstaje przy czerwonej suicie, a przy 8 tysiącach testów i
jednym zastanym czerwonym (§4.4) oznaczało to brak jakiejkolwiek mierzalności.

---

## 8. Wzorce wzięte z repo, nie wymyślone

- `src/test/supabaseChain.ts` (PR #252) - łańcuch PostgREST z nagrywaniem.
  Zadanie wprost zakazywało pisania własnej atrapy; ta warstwa jej nie pisze.
  Atrapa została tam, gdzie już była - przenoszenie jej do `src/test/supabase/`
  ruszyłoby importy w dziesięciu plikach testowych bez żadnego zysku.
- `src/test/renderWithQueryClient.tsx` - render z `QueryClientProvider`.
- `src/test/routeHarness.tsx` (`renderRoute`, `routeServerHandlers`) - wzór dla
  tras `createFileRoute` z `server.handlers`.
- `src/components/admin/permissions/__tests__/permissionMatrixTable.test.tsx` -
  wzór przełączania języka przez prawdziwą instancję i18next
  (`i18n.changeLanguage`), użyty w testach panelu popupu i hosta popupów.
- `src/lib/chat/__tests__/chatDataHooks.test.tsx` - wzór testu hooków warstwy
  danych (`vi.hoisted` + dynamiczny import fixture'ów w fabryce `vi.mock`).

---

## 9. Jak zweryfikować

```bash
sed -E -i 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock
bun install
git checkout -- bun.lock   # tylko dla CI, nie commitować

# panele i biblioteki modułu 11 z progami
bun run test:coverage

# bramka gęstości asercji
bunx vitest run src/lib/__tests__/newsletterTestAssertionDensity.test.ts

# bramka i18n panelu newslettera (blokująca)
bunx vitest run src/lib/__tests__/i18nNewsletterAdmin.test.ts

bun run typecheck
bun run lint
bunx prettier --check src/components/admin/newsletter src/components/admin/popups \
  src/components/popups src/lib/newsletter src/lib/email vitest.config.ts \
  docs/WDROZENIE_NEWSLETTER_TESTY_MODUL_11_2026-08-19.md
```
