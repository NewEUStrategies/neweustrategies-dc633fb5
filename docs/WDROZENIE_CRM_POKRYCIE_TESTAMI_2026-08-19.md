# Wdrożenie: CRM (MODUŁ 18) z 12% na 99% pokrycia (2026-08-19)

## Diagnoza

Audyt z 18.08 (`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdział 2)
postawił MODUŁ 18 na ostatnim miejscu w całym repozytorium:

| Miara                       |                  18.08 |
| --------------------------- | ---------------------: |
| Linie                       |             **12,04%** |
| Instrukcje                  |                 12,43% |
| Gałęzie                     |                 12,18% |
| Funkcje                     | **9,30%** (93 z 1 000) |
| Plików produkcyjnych        |                     47 |
| Plików z pokryciem 0%       |                     33 |
| Stosunek plików test./prod. |                  0,319 |

Ta liczba nie jest wyłącznie kosmetyczna. Przez ten moduł przechodzą **dane
osobowe**: import kontaktów z pliku CSV, zgody marketingowe i ich historia,
konwersja subskrybentów newslettera na kontakty handlowe, wysyłka leada do
zewnętrznych partnerów CRM oraz kasowanie rekordów hurtem. Trzy powierzchnie
audyt wskazał imiennie:

1. **Reguły filtrowania i sortowania leadów istniały DWA razy** - raz po stronie
   klienta (`src/lib/crm/leadViews.ts`, 33,3% linii i 15% gałęzi), raz po stronie
   serwera (`src/lib/crm.functions.ts`, 0%). Dwie kopie tej samej reguły, z czego
   jedna nietestowana.
2. **Cała warstwa serwerowa CRM stała na zerze** - żaden handler `createServerFn`
   nie miał ani jednego wywołania w suicie.
3. **19 paneli CRM na zerze** (302 funkcje, 9 wywołanych), w tym `autoMap`/`mapRows`
   w `ImportLeadsCsvDialog` - kod, który decyduje, która kolumna z pliku klienta
   ląduje w której kolumnie bazy.

---

## Wynik

Pomiar na tej gałęzi, tą samą metodą co audyt (v8, `all: true`), na 56 plikach
produkcyjnych modułu (47 z audytu + 9 nowych czystych modułów reguł):

| Miara      |  18.08 |      Teraz |     Delta |
| ---------- | -----: | ---------: | --------: |
| Linie      | 12,04% | **98,98%** | +86,94 pp |
| Instrukcje | 12,43% | **98,16%** | +85,73 pp |
| Gałęzie    | 12,18% | **86,44%** | +74,26 pp |
| Funkcje    |  9,30% | **98,48%** | +89,18 pp |

Funkcje w sztukach: **1 038 z 1 054** (było 93 z 1 000). Plików z pokryciem 0%:
**0** (było 33). Suita modułu: 44 pliki testowe, 1 326 testów, wszystkie zielone.

Rozbicie po warstwach:

| Warstwa                                   | Instr. |   Gał. | Funkcje |  Linie |
| ----------------------------------------- | -----: | -----: | ------: | -----: |
| `src/lib/crm/**` (czyste reguły)          | 99,52% | 97,26% |  99,29% | 99,62% |
| `src/lib/crm*.functions.ts` (serwer)      | 98,91% | 84,28% |    100% |   100% |
| `src/lib/csv/**`                          |   100% | 97,36% |    100% |   100% |
| `src/lib/organizations/**`                | 98,34% | 90,81% |  94,59% | 99,36% |
| `src/components/admin/crm/**` (19 paneli) | 95,14% | 83,59% |  96,53% | 95,95% |
| `src/routes/*` (7 tras panelu)            | 98,49% | 80,94% |  99,76% | 99,68% |

---

## 1. Duplikat filtra i sortu leadów: dwie kopie → jeden kontrakt

To była **główna** pozycja z audytu i najważniejsza część tej pracy.

### Czym był problem

Ta sama reguła biznesowa („pokaż leady gorące, z Polski, z ostatnich 30 dni,
posortowane po score malejąco”) żyła w dwóch miejscach:

- `applyLeadFilter`/`applyLeadSort` w `src/lib/crm/leadViews.ts` - w JavaScripcie,
  na tablicy wierszy;
- `applyLeadListFilters`/`applyLeadListSort` w `src/lib/crm.functions.ts` - jako
  łańcuch PostgREST wysyłany do bazy.

Kopie **już się rozjechały w czterech miejscach**, m.in.:

- porządek etapów: JS sortował etapy alfabetycznie, SQL po kolejności deklaracji
  ENUM-a `crm_stage` (migracja `20260630053403`) - inny wynik dla tej samej listy;
- zakres dat: różne granice okna (`>=` vs `>`);
- puste wartości przy sortowaniu (`nullsFirst`);
- dopasowanie frazy wyszukiwania po kolumnach.

Żadna z tych różnic nie miała testu, a wersja JS-owa okazała się **martwym kodem**:
panel od dawna liczy filtry w SQL-u. Czyli nietestowana kopia reguły, która
w dodatku nie działała, czekała, aż ktoś jej użyje.

### Co zrobiliśmy

Powstał **jeden moduł kontraktu**: `src/lib/crm/leadListSpec.ts`. Zawiera opis
filtra jako danych (`buildLeadFilterSpec` → lista predykatów) i **dwa jedyne**
konsumenty tego opisu:

- `applyLeadFilterSpec(query, spec)` - jedyne miejsce w repo, które tłumaczy
  predykat na PostgREST;
- `matchesLeadRow(row, spec)` - jedyne miejsce, które tłumaczy predykat na JS.

Obie strony (`leadViews.ts` i `crm.functions.ts`) delegują do tego modułu; nie
mają już własnych reguł.

### Bramka parytetu

Sam wspólny moduł nie dowodzi jeszcze, że SQL i JS zwrócą to samo - dlatego
`src/lib/crm/__tests__/leadListParity.test.ts` (329 testów) przepuszcza
wygenerowany zbiór kombinacji filtrów i sortów **przez obie ścieżki naraz**
i porównuje wyniki. Emulator PostgREST w tym teście jest napisany **niezależnie**
od kodu produkcyjnego (własne porównania), a porządek etapów czyta **z migracji**,
nie ze stałej w kodzie - inaczej test dowodziłby tylko, że kod zgadza się sam
ze sobą.

`leadListSpec.ts`, `leadViews.ts` i `importMapping.ts` mają teraz próg 100% na
wszystkich czterech metrykach.

---

## 2. Mapowanie importu CSV: z dialogu do czystego modułu

`autoMap` i `mapRows` mieszkały wewnątrz `ImportLeadsCsvDialog.tsx`, więc jedyną
drogą do nich był render dialogu. Zostały wyprowadzone do
`src/lib/crm/importMapping.ts` (100% pokrycia na wszystkich metrykach) razem
z limitami (`IMPORT_MAX_ROWS`, `IMPORT_MAX_TAGS`, `IMPORT_VALUE_MAX_LENGTH`).

**Inwariant odwrotny.** Tabela `crm_import_leads` nie ma kolumny zgody -
i tak ma być: zgody marketingowej **nie da się wgrać plikiem**, bo zgoda wymaga
dowodu (formularz, wersja, treść). Reguła `NEVER_MAPPED` (wyrażenie regularne na
`zgod|consent|marketing|rodo|gdpr|opt-in|newsletter|subskryp`) biegnie **przed**
wszystkimi innymi regułami dopasowania nagłówka, a test dowodzi, że kolumna
o takiej nazwie nigdy nie trafia do mapowania.

---

## 3. Karencja miejsc w organizacjach: 4,2% → 100% linii

`src/lib/organizations/teamSeats.server.ts` decyduje, **komu i kiedy odbierany
jest dostęp** po zmniejszeniu planu, oraz kiedy idą przypomnienia. Test obejmuje
całą orkiestrację, w tym **idempotencję przypomnień**: drugi przebieg tego samego
dnia nie wysyła drugiego maila. Bez tego testu regresja objawiłaby się jako
seria maili do klienta, a nie jako czerwony test.

---

## 4. Warstwa serwerowa: z 0% na 100% funkcji

`createServerFn().middleware().validator().handler()` nie da się wywołać
z testu bez atrapy `@tanstack/react-start` - i to była faktyczna przyczyna zera
w tej warstwie. Powstał `src/test/serverFnHarness.ts`: atrapa modułu wystawia
walidator i handler jako zwykłe funkcje, a `callServerFn(fn, { data, context })`
uruchamia je z podstawionym klientem Supabase (`src/test/supabaseChain.ts`).

**Autoryzacji i RLS te testy NIE sprawdzają** - to warstwa pgTAP i tam zostaje.
Testy jednostkowe pilnują kształtu zapytania i ładunku: jakie kolumny, jakie
filtry, jakie wartości lecą do bazy.

---

## 5. Panele: reguła, nie render

19 paneli CRM startowało z 3,6% linii i 9 z 302 funkcji. Zamiast pisać testy
renderu (które niczego nie dowodzą), reguły zostały **wyprowadzone z komponentów**
do czystych modułów - zgodnie z atomic design, tak jak wcześniej w profilu i czacie:

| Moduł                            | Co niesie                                             |
| -------------------------------- | ----------------------------------------------------- |
| `src/lib/crm/tasksView.ts`       | terminy follow-upów, „po terminie”, etykieta kontaktu |
| `src/lib/crm/columnSelection.ts` | wybór kolumn tabeli i kolumny wymagane                |
| `src/lib/crm/meteringUsage.ts`   | zużycie limitu i poziom ostrzeżenia                   |
| `src/lib/crm/companyForm.ts`     | walidacja i ładunek formularza nowej firmy            |
| `src/lib/crm/profileSyncView.ts` | formatowanie rozmiaru CV, lat i nazwy                 |
| `src/lib/crm/text.ts`            | `nullIfBlank`, `shortId`                              |
| `src/lib/crm/viewActions.ts`     | uruchamianie akcji zapisanego widoku (patrz niżej)    |

Panele dostały testy **zachowania**: co widzi i co klika sprzedaż, jakie
identyfikatory idą do mutacji, co się dzieje przy odmowie z bazy. Wszystkie
dane w testach są **syntetyczne** - żaden fragment prawdziwej bazy nie trafił
do repozytorium.

---

## 6. Trasy panelu: prawdziwy router, nie sam komponent

Siedem tras (`/admin/crm`, `/admin/crm/$id`, `/admin/crm/funnel`,
`/admin/companies`, `/admin/companies/$id`, `/admin/contact` + dwa layouty)
jest montowanych przez `src/test/routeHarness.tsx` w **routerze pamięciowym**,
więc test przechodzi przez warstwę, w której mieszkają błędy sklejenia:
`validateSearch`, `head()` z `noindex`, parametr ścieżki, deep-linki
z powiadomień (`?lead=…&task=…`).

Asercje idą po tym, co decyduje o skutku - identyfikatory w ładunku operacji
zbiorczej, dziedziczenie filtrów przez eksport CSV, wymagane potwierdzenie przy
kasowaniu - a nie po tym, że „coś się wyrenderowało”.

---

## 7. Defekty znalezione PRZY PISANIU testów

Pięć rzeczy, których nikt nie zgłosił, bo objawiały się cicho:

### 7.1 Dialog importu CSV wywracał się po wybraniu pliku

`ImportLeadsCsvDialog` renderował `<SelectItem value="">` dla opcji „pomiń
kolumnę”. Radix **rzuca wyjątek** na pustej wartości `SelectItem` - czyli cały
dialog padał natychmiast po wybraniu pliku. Naprawione wartownikiem `__skip__`
tłumaczonym z powrotem na pusty łańcuch przy odczycie.

### 7.2 Lead płacącego klienta ginął po cichu

`src/lib/billing/purchaseEffects.server.ts` wstawiał leada z
`source_type: "import"`. Ograniczenie `crm_leads_source_type_check` (migracja
`20260814122512`) nie dopuszcza tej wartości - insert leciał na błąd, który był
połykany. Skutek: **klient płacił, a jego kontakt nigdy nie powstawał w CRM.**
Wartość poprawiona na `paid_subscriber`; dodatkowo powstała bramka
`leadSourceTypeContract.test.ts`, która skanuje `src/` w poszukiwaniu literałów
`source_type` i porównuje je z listą z CHECK-a odczytaną z migracji.

### 7.3 Wyczyszczone pole kontaktu zapisywało pusty napis zamiast NULL

W `admin.crm.$id.tsx` zapis edycji robił `form[k] ?? null`, co łapie wyłącznie
`undefined` - a pole formularza zawsze oddaje string. Skasowanie telefonu
zapisywało `''`, więc panel pokazywał pustą komórkę zamiast myślnika, a zliczanie
„ilu leadów ma telefon” liczyło je jako wypełnione. Porównanie i zapis idą teraz
przez `nullIfBlank`.

### 7.4 Odrzucona akcja zapisanego widoku wypuszczała nieobsłużony promise

Zakładki widoków (`LeadViewTabs`, `CompanyViewTabs`) wołały akcje
(`onCreate`/`onRename`/`onDelete`/`onToggleShared`) wprost w `onClick`.
Przy odmowie z bazy operator widział toast z `onError`, ale odrzucony promise
wychodził z handlera zdarzenia jako **unhandled rejection** - monitoring
dostawał drugi, niewyjaśniony błąd. Dodatkowo sprzątanie po akcji (zamknięcie
dymka, wyczyszczenie szkicu nazwy) biegło w `await`, więc przy błędzie
nie wykonywało się w ogóle. Reguła mieszka teraz w `src/lib/crm/viewActions.ts`:
`onDone` odpala się **wyłącznie po sukcesie**, błąd zostaje przy warstwie mutacji.

### 7.5 Reguła nagłówka „Adres” myliła adres pocztowy z e-mailem

W automatycznym mapowaniu kolumn CSV wzorzec e-maila łapał samo słowo „Adres”,
więc kolumna z adresem pocztowym lądowała w polu e-mail. Reguła zawężona;
„Imię i nazwisko” mapuje się teraz poprawnie na imię.

---

## 8. Bramki (progi per-ścieżka)

`vitest.config.ts` dostał progi floorowane **~3-4 pp pod zmierzonym poziomem**
(marża na dryf CI), zgodnie z zasadą obowiązującą w tym pliku: **próg wolno
wyłącznie podnosić**.

- czyste moduły kontraktu (`leadListSpec`, `importMapping`, `leadViews`,
  `viewActions`) - **100% na czterech metrykach**;
- reszta `src/lib/crm/**` - 96/96/96/93;
- warstwa serwerowa (`crm*.functions.ts`) - per plik, 95-96% instrukcji i linii;
- `src/lib/csv/**` - 96/96/96/93;
- `teamSeats.server.ts` - 95/90/96/86, `src/lib/organizations/**` - 94/90/95/86;
- `src/components/admin/crm/**` - 91/92/92/79;
- sześć tras panelu CRM - per plik, 92-96% linii.

Progi gałęzi na trasach stoją niżej niż linie i to jest uczciwe: każde wywołanie
`t(pl, en)` liczy się jako dwa ramiona gałęzi, a nie każdy ekran jest w testach
renderowany w obu językach.

---

## 9. Czego świadomie NIE zrobiliśmy

- **Autoryzacji i RLS nie testujemy w vitest.** To warstwa pgTAP; testy
  jednostkowe sprawdzają kształt zapytania, nie uprawnienia.
- **Nie duplikujemy testów reguł, które już miały 100%** (scoring, `consentLog`,
  `csv`, `funnelConsent`, `leadTimeline`, `membershipSummary`, `parseCsv`).
- **Nie ma testów renderu bez asercji.** Każdy test paneli sprawdza dane albo
  ładunek mutacji.
- **Etykiety pól w `CrmPartnerEndpointsPanel` nie są powiązane z kontrolkami
  przez `for`/`aria-labelledby`** (komponent `Field` renderuje `<Label>` obok
  `<Input>`, nie wokół niego). To realny dług dostępności - ten sam, który
  naprawiono wcześniej w formularzu tworzenia firmy - ale dotyczy pięciu
  zduplikowanych komponentów `Field` w różnych plikach i wykracza poza zakres
  tej pracy. Testy obchodzą to, szukając kontrolki w obrębie sekcji pola.

---

## 10. Odtworzenie pomiaru

```bash
bun run test:coverage \
  --coverage.include='src/lib/crm*' \
  --coverage.include='src/lib/crm/**' \
  --coverage.include='src/components/admin/crm/**' \
  --coverage.include='src/lib/organizations/**' \
  --coverage.include='src/lib/csv/**' \
  --coverage.include='src/routes/*crm*' \
  --coverage.include='src/routes/admin.companies*' \
  --coverage.include='src/routes/admin.contact.tsx'
```

Zakres plików odpowiada regułom mapowania modułu 18 z rozdziału 9.1 audytu.
