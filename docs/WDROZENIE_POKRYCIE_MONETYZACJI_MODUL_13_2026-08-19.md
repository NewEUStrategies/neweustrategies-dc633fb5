# Monetyzacja po zakupie: obsługa rezygnacji, panele redakcyjne i cennik pod testami (2026-08-19)

Zamknięcie pozycji **MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing** z audytu
`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`. Audyt streścił problem jednym
zdaniem, które wyznaczyło całą tę pracę:

> **KUPNO JEST DOWIEDZIONE. OBSŁUGA PO KUPNIE — NIE.**

Checkout miał 65,0% linii, webhook operatora 67,6%, a jednocześnie **87 z 162 plików
produkcyjnych modułu nie miało ANI JEDNEJ wykonanej linii** — w tym cała ścieżka
rezygnacji i wszystkie panele redakcyjne. Moduł stał na 32,71% linii i 26,68% funkcji
(370 z 1387 funkcji), przy 3542 liniach niepokrytych i stosunku plików
testowych do produkcyjnych 0,30.

Ta asymetria to nie kwestia procentów. Zablokowana albo **POZORNIE WYKONANA** rezygnacja
jest ryzykiem prawnym, a nie usterką wizualną — i dokładnie taki defekt tu znaleziono.

---

## 1. Osiem defektów znalezionych testami

Każdy naprawiony **osobnym commitem**, z dowodem „czerwone przed / zielone po".

### D1–D4 · Odmowa operatora raportowana jako SUKCES (`SubscriptionCard`)

Serwerowe funkcje monetyzacji zwracają `{ error }` **bez rzucania wyjątku**. Cztery
mutacje w karcie subskrypcji traktowały spełnioną obietnicę jako powodzenie:

| akcja         | co widział klient        | co się faktycznie stało                  |
| ------------- | ------------------------ | ---------------------------------------- |
| anulowanie    | „Subskrypcja anulowana"  | subskrypcja aktywna, **dalej obciążana** |
| wznowienie    | „Subskrypcja wznowiona"  | brak wznowienia                          |
| zmiana planu  | „Plan zmieniony"         | plan bez zmiany                          |
| liczba miejsc | „Zapisano liczbę miejsc" | liczba miejsc bez zmiany                 |

Anulowanie jest z tej czwórki najgorsze: klient dostawał komunikat o rezygnacji i był
dalej obciążany. Piąta mutacja w TYM SAMYM pliku (`portal`) sprawdzała odmowę
poprawnie — dowód, że to przeoczenie, nie konwencja.

**Naprawa:** `lib/billing/providerResult.ts` — `unwrapProviderResult` zamienia odmowę na
wyjątek `ProviderCallError`, więc `react-query` trafia do `onError`. Bramka: 10 przypadków
w `subscriptionFalseSuccess.test.tsx`, z których **6 było czerwonych przed naprawą**.

### D5 · Okno rezygnacji zamykało się identycznie po sukcesie i po błędzie

`RetentionDialog` zamykał się po `onConfirmCancel()` niezależnie od wyniku, bo rodzic
(`SubscriptionManagerSection`) zjadał wyjątek po pokazaniu toastu. Klient widział
zamknięte okno — czyli „załatwione" — przy nieudanej rezygnacji.

**Naprawa:** kontrakt `onConfirmCancel` MUSI odrzucić obietnicę przy błędzie (udokumentowane
w propsie); dialog zamyka się dopiero po `await`, a przy odmowie pokazuje komunikat
`role="alert"` i **zostaje otwarty**. 4 z 22 przypadków czerwone przed naprawą.

### D6 · Nazwa planu nigdy nie docierała do panelu zamówień

`paymentOrders.server` pytał o kolumnę `access_plans.name`, **której w tej tabeli nie ma**
(są `name_pl` i `name_en`), a błąd zapytania odrzucał bez sprawdzenia
(`const { data: plans } =`). Mapa nazw zostawała pusta, więc administrator w kolumnie
„pozycja" widział ogólne „Subskrypcja" dla KAŻDEGO zamówienia — cicho, bez śladu w logach,
przy 200 wierszach na ekran.

**Naprawa:** zapytanie o obie kolumny + `if (plansError) throw plansError`, a nazwa
wybierana istniejącą regułą `planName(row, lang)`. 4 z 4 przypadków bramki czerwone przed.

### D7/D8 · Edytor benefitów: dziesięć pól bez nazwy i rozwinięcie gubiące wiersz

`TierBenefitsEditor` renderował dwa pola tekstowe i cztery dodatkowe na benefit **bez
etykiet**, a stan „rozwinięty" trzymał po POZYCJI w tablicy — po przesunięciu albo
usunięciu wiersza rozwinięcie zostawało przy indeksie, czyli przy innym beneficiem.

**Naprawa:** `aria-label` z numerem wiersza na wszystkich polach i przyciskach ikonowych;
stan rozwinięcia przenoszony razem z wierszem (`swapExpanded`, `shiftExpandedAfterRemove`
w `lib/ui/expandedRows.ts`). 15 z 61 przypadków czerwonych przed.

### D9 · Ta sama płatność w RÓŻNYCH kolorach na różnych kartach

Decyzja „który stan płatności jest czerwony" istniała w TRZECH kopiach:

| plik                   | stany „czerwone"                         |
| ---------------------- | ---------------------------------------- |
| `BillingDocumentsCard` | `refunded`, `void`                       |
| `OrdersTableCard`      | `failed`, `refunded`, `canceled`         |
| `PaymentHistoryCard`   | `failed`, `refunded`, `canceled`, `void` |

Nieudana płatność (`failed`) świeciła się na czerwono w historii, a w dokumentach
wyglądała neutralnie; anulowany dokument (`void`) — odwrotnie. Klient nie ma jak zgadnąć,
która karta mówi prawdę, a to strona, na której sprawdza, czy zapłacił.

**Naprawa:** `lib/billing/statusTone.ts` bierze **SUMĘ** trzech zestawów. Nieznany stan
zostaje neutralny, nie czerwony.

### D10 · „Invalid Date" w miejscu daty faktury

Osiem miejsc w `components/billing` liczyło datę własnym
`toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL")` — **żadne** bez zabezpieczenia
przed wartością niepoprawną, choć wspólny `formatDate` z `lib/i18n/format` ma je od
początku. Uszkodzony znacznik czasu pokazywał klientowi „Invalid Date" tam, gdzie miała
być data pobrania pieniędzy.

### D11 · 42 pola paneli redakcyjnych bez nazwy dla czytnika ekranu

W panelach cennika i członkostwa pola stały w układzie
`<Label>Nazwa PL</Label><Input />` — etykieta OBOK pola, bez `htmlFor`, bez `id`, bez
zagnieżdżenia. Dla osoby widzącej wygląda to poprawnie; dla czytnika ekranu to 42 pola
BEZ NAZWY w formularzach, w których ustawia się ceny, benefity, rabat retencyjny
i wygaśnięcie dostępu. Najgorsze trafienie: formularz nadań, w którym **puste pole
„miesiące" znaczy dostęp BEZ KOŃCA** — i to pole nie miało nazwy.

Widać to było wprost w testach: pól nie dało się znaleźć po etykiecie, tylko po wpisanej
wartości albo po pozycji na liście.

**Naprawa:** atom `LabeledField` wiąże etykietę z polem przez `useId` i podłącza
podpowiedź przez `aria-describedby`. Dla list rozwijanych propsy idą na WYZWALACZ Radiksa —
korzeń `Select` nie renderuje elementu, więc etykieta nie miałaby z czym się związać.

### D12 · Liczebniki: „1 dni za darmo", „na kolejne 1 płatności"

Cztery napisy wstawiały liczbę w polski tekst z JEDNĄ formą mnogą — na karcie planu w chwili
decyzji o zakupie i w oknie rezygnacji, gdy próbujemy klienta zatrzymać.
Naprawione formami `_one`/`_few`/`_many`/`_other` (PL) i `_one`/`_other` (EN),
wybieranymi po zmiennej `count`.

### Osobno: bramka kreatora czerwona PRZED tą pracą

`eagerWidgetChunks.test.ts` (moduł kreatora, **nie** monetyzacja) był czerwony już na
commicie bazowym gałęzi — `AccordionWidget` i `SectionLabelWidgetView` były
w `lazyWidgets`, a nie w lustrze testowym. Uzupełnione dwiema linijkami w `src/test/`,
bo bez tego cały zestaw testów nie mógł być zielony.

---

## 2. Pokrycie: przed i po, per powierzchnia

Numery „przed" z audytu 18.08, „po" zmierzone na tym HEAD.

| Powierzchnia                                | linie przed |  linie po | funkcje po |
| ------------------------------------------- | ----------: | --------: | ---------: |
| `components/billing/**` (rezygnacja, plany) |        0,0% | **95,3%** |      95,6% |
| — `atoms/**` (4 nowe atomy)                 |           — |  **100%** |       100% |
| — `molecules/**`                            |        0,0% | **98,3%** |       100% |
| — `organisms/**`                            |        0,0% | **93,0%** |      91,7% |
| `components/pricing/**`                     |       20,0% | **98,0%** |      93,6% |
| `components/membership-join/**`             |        0,0% | **96,9%** |      93,8% |
| `components/admin/billing/**`               |        0,0% | **98,2%** |      97,9% |
| `components/admin/pricing/**`               |        0,0% | **97,9%** |      96,3% |
| `components/admin/membership/**`            |           — | **95,7%** |      92,2% |
| `lib/pricing/**`                            |           — | **97,0%** |      93,4% |
| `lib/billing/membership.ts`                 |        0,0% |  **100%** |       100% |
| `lib/billing/diagnostics.server.ts`         |        0,0% |  **100%** |       100% |
| `lib/billing/portalLink.server.ts`          |        0,0% |  **~96%** |       100% |
| `lib/billing/queries.ts`                    |        2,0% |  **~96%** |       100% |
| `lib/retention/queries.ts`                  |       14,1% |  **~90%** |       ~85% |
| **MODUŁ 13 razem (bez plików tras)**        |   **32,7%** | **65,5%** |  **80,8%** |

Cel z definicji ukończenia: ≥60% linii i ≥55% funkcji dla modułu — **osiągnięty
z zapasem** (65,5% / 80,8%).

48 nowych plików testowych, **1108 przypadków**, każdy z co najmniej dwiema asercjami.

---

## 3. Wyniesienie tras: 2719 linii → 41

Dwa największe pliki panelu monetyzacji miały po kilku zakładkach w jednym module, więc
żadnej z nich nie dało się wyrenderować w teście osobno. To nie przypadek, że oba miały 0%.

| plik                                            | przed |      po |
| ----------------------------------------------- | ----: | ------: |
| `src/routes/admin.pricing.tsx`                  |  1821 |  **21** |
| `src/routes/admin.membership.tsx`               |   898 |  **20** |
| `src/components/pricing/organisms/TierCard.tsx` |   476 | **393** |

Zawartość przeszła do `components/admin/pricing/**`, `components/admin/membership/**`
i `components/pricing/organisms/**` w podziale atomy / molekuły / organizmy. Trasy zostały
przy tym, czym mają być: `createFileRoute`, `head()`, rejestracja słowników i kompozycja.

---

## 4. Reguły wyniesione z JSX-a

Wszystko poniżej dawało się wcześniej sprawdzić TYLKO przez wyrenderowanie całego panelu
albo całej karty — razem z routerem, i18n, bazą i analityką.

| moduł reguły                    | co rozstrzyga                                             |
| ------------------------------- | --------------------------------------------------------- |
| `lib/pricing/tierCardModel.ts`  | co w miejscu ceny i **który przycisk** dostaje klient     |
| `lib/billing/providerResult.ts` | odmowa operatora jako wyjątek, nie jako zwykły wynik      |
| `lib/billing/statusTone.ts`     | jeden kolor na stan płatności, wszędzie                   |
| `lib/admin/sortOrder.ts`        | renumeracja kolejności — tylko zmienione wiersze          |
| `lib/admin/pricingDrafts.ts`    | warunki zapisu segmentu, warstwy i FAQ; przycięcie rabatu |
| `lib/admin/rankTone.ts`         | progi 30/15/5 — która warstwa wygląda na premium          |
| `lib/admin/tierGroups.ts`       | warstwa bez istniejącego segmentu **nie ginie**           |
| `lib/admin/retentionStats.ts`   | okno 90 dni i mianownik „pokazane oferty"                 |
| `lib/admin/membershipDrafts.ts` | niepoprawny JSON bramek **przerywa** zapis warstwy        |
| `lib/keyFormat.ts`              | format klucza technicznego (dawniej trzy kopie)           |
| `lib/billing/intervalLabel.ts`  | deskryptor cyklu: liczba + klucz, odmiana w słowniku      |

### Kolejność gałęzi przycisku zakupu JEST kontraktem

1. `cta_mode='none'` wygrywa **zawsze** — warstwy zamkniętej nie da się kupić ani
   „zapytać o ofertę", nawet gdy ktoś przypisał do niej plan.
2. Warstwa **domyślna** jest bezpłatna nawet z przypisanym planem; niezalogowany dostaje
   rejestrację, zalogowany — nic (już ją ma).
3. `cta_mode='contact'` wyprzedza checkout — sprzedaż za miejsce przez checkout jednego
   miejsca byłaby nieuczciwa.
4. „To jest twój plan" wyprzedza zakup — inaczej klient kupiłby drugi raz to samo.
5. Procent oszczędności liczy się **tylko** dla planu rocznego i tylko przy planie
   miesięcznym w tej samej walucie — inaczej byłby liczbą bez odniesienia.

---

## 5. Atomic design: jedenaście nowych atomów, jedenaście scalonych kopii

Każdy nowy atom ma **kontrakt dostępności** we własnym pliku testowym.

| atom                                    | ile kopii scalił | kontrakt                                                              |
| --------------------------------------- | ---------------: | --------------------------------------------------------------------- |
| `billing/atoms/PaymentStatusBadge`      |   3 (rozjechane) | kolor NIE jest jedynym nośnikiem; `data-status` z surowym stanem      |
| `billing/atoms/BillingDate`             |                8 | `<time dateTime>`; brak „Invalid Date"                                |
| `billing/atoms/MoneyText`               |                — | `<data value="4900:PLN">` — wsparcie odczyta grosze ze zrzutu DOM     |
| `billing/atoms/BillingEmptyState`       |                3 | `role="status"` — pustą listę da się odróżnić od trwającego zapytania |
| `admin/pricing/atoms/RowOrderControls`  |                3 | `aria-label` na przyciskach ikonowych; skrajne strzałki wyłączone     |
| `admin/pricing/atoms/EmptyHint`         |                4 | `role="status"`                                                       |
| `admin/pricing/atoms/LabeledField`      |          42 pola | `useId` wiąże etykietę z polem; podpowiedź przez `aria-describedby`   |
| `admin/pricing/atoms/PricingKpi`        |                — | `<dl>/<dt>/<dd>` — licznik czytelny bez ikony                         |
| `admin/pricing/atoms/FieldGroup`        |                — | `<fieldset>/<legend>`                                                 |
| `admin/membership/atoms/KpiTile`        |                — | `<dl>/<dt>/<dd>`                                                      |
| `admin/membership/atoms/SectionCard`    |                — | `<section>` + `<h2>` — sekcje tworzą spis treści                      |
| `admin/membership/atoms/FieldGroupRule` |                — | `<fieldset>/<legend>`                                                 |

**Świadomie NIE scalone:** `KpiTile` z `PricingKpi` i `FieldGroupRule` z `FieldGroup` —
mają różny DOM i wagę wizualną, scalenie zmieniłoby wygląd jednego z paneli. To decyzja
projektowa, nie porządkowa; oba pliki mówią to wprost w nagłówku.

---

## 6. Infrastruktura pomiaru i atomy testowe

- **`vitest.config.ts`: `reportOnFailure: true`.** `checkThresholds` żyje wewnątrz
  `reportCoverage()`, a vitest wychodzi na PIERWSZYM czerwonym teście — czyli pokrycie
  było niemierzalne dokładnie wtedy, gdy jest najbardziej potrzebne.
- **`src/test/reactStubs.ts`** — atrapy warstwy reactowej wyniesione z fixture'ów profilu.
  Dołożone tą pracą: `radixSwitchStub` (Radix Switch nie przełącza się pod happy-dom od
  `fireEvent.click`) i `radixTabsStub`, obsługujący **oba** tryby Radiksa — sterowany
  i `defaultValue`.
- **`src/test/billing/fixtures.ts`** i **`src/test/admin/pricingFixtures.ts`** — atomy
  testowe monetyzacji i paneli redakcyjnych. Kwoty asertowane wzorcem `moneyPattern`,
  nigdy napisem z `Intl` (wersja ICU w środowisku nie może psuć testu).
- **Atrapy na GRANICY SDK** (`@supabase/supabase-js`, `stripe`), nie na naszych
  wrapperach: moduły serwerowe wciągają klienty dynamicznie (`await import`), a podmiana
  wrappera do takiego importu nie dochodzi. Przy okazji test przechodzi przez PRAWDZIWY
  wrapper, więc pilnuje też wymagania kluczy środowiskowych.
- **ŻADEN test nie wykonuje realnego żądania** do operatora płatności ani do dostawcy
  poczty. Żadnych kluczy testowych. Kwoty, NIP-y i adresy — syntetyczne (domena `.test`).

---

## 7. i18n

- Liczebniki (`_one`/`_few`/`_many`/`_other`) w czterech napisach z liczbą — patrz D12.
- Deskryptor cyklu rozliczeniowego: jedna mapa `cykl -> klucz słownika` zamiast dwóch kopii.
- `ResendPortalLinkButton`: pięć komunikatów obsługi zgłoszeń istniało wyłącznie w kodzie
  jako pary `pl ? "..." : "..."` — poza bramką parytetu i poza zasięgiem tłumacza.
  Przeniesione do `adminBilling.resendPortal`.
- Cztery etykiety karty warstwy („Nazwa PL", „Name EN", „Opis PL", „Description EN") były
  twardymi napisami w JSX — **angielska wersja panelu pokazywała „Nazwa PL"**. Klucze
  `adminMembership.fields.*` istniały w słowniku od początku; komponent ich nie używał.
- Ratchet nakładek i18n przepisany po przeniesieniu plików i **dociśnięty w dół**:
  791 → 775 zależności pośrednich, 80 → 77 plików.
- Cztery bramki i18n zielone; `untranslated` bez zmian (**459**).

---

## 8. Progi pokrycia (`vitest.config.ts`)

Dwadzieścia jeden nowych progów **per ścieżka**, floorowanych tuż pod osiągniętym
pokryciem, każdy z komentarzem „czego pilnuje". Progi per katalog (a nie jeden dla
całego modułu) są tu celowe: regresja w JEDNYM katalogu nie może schować się w średniej.

Progi na 100% dostały wyłącznie czyste moduły reguł (`pricingDrafts`, `membershipDrafts`,
`rankTone`, `retentionStats`, `sortOrder`, `tierGroups`, `keyFormat`, `statusTone`,
`providerResult`, `membership`) oraz atomy powstałe ze scalenia kopii — zejście pod 100%
znaczy tam, że ktoś dołożył nieobsłużoną gałąź.

---

## 9. Świadomie NIE zmienione — do decyzji właściciela produktu

Trzy rzeczy znalezione testami i **przypięte stanem faktycznym**, bo ich naprawa jest
decyzją produktową, nie porządkową:

1. **NIP nie jest wymagany dla firm.** `validateTaxId` przepuszcza pustą wartość
   i deleguje „wymagany dla firm" do interfejsu, który tego nigdy nie zaimplementował.
   Zablokowanie zapisu bez NIP-u zablokowałoby część checkoutu — wpływ na przychód.
2. **`TierBenefitsEditor` nie waliduje niczego.** Benefit z pustą treścią zapisuje się
   i trafia na stronę cennika jako pusty punkt listy.
3. **Panel zamówień biletowych pokazuje sprzeczne komunikaty** — przy błędzie odczytu
   widać JEDNOCZEŚNIE treść błędu i „brak zamówień biletowych".

Wszystkie trzy mają testy przypinające bieżące zachowanie, więc zmiana będzie widoczna.

---

## 10. Czego ta praca NIE dotyka (świadomie)

- **pgTAP zostaje pgTAP.** Retencja księgowa, efekty kuponu po płatności i izolacja
  tenanta w storage mają swoje cztery pliki SQL — nie duplikujemy ich w vitest.
- **Reguły z istniejącymi bramkami** (`grant.server`, `webhooks.stripe`, `checkoutIntent`,
  `planSwitch`, `couponMoney`, `accessPeriod`, `entitlementSync`, `capabilities`,
  `accountingRetention`, `displayCurrencyApprox`, `purchaseConfirmation`, `nip`) nie
  dostały drugiego zestawu testów.
- **Kontrakt starych referencji płatniczych** — `check:legacy-payment-refs` zielony
  (3750 plików, zero żywych referencji).
- Pliki generowane (`routeTree.gen.ts`, `types.ts`, `authzSnapshot.generated.ts`) —
  nietknięte.
