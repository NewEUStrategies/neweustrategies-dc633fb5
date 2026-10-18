# Moduł 13 - monetyzacja, wydanie 14: naprawy, optymalizacje i pokrycie (2026-10-18)

Zlecenie: „napraw, optymalizuj i wdrażaj testy" dla wiersza audytu
**Monetyzacja: checkout / subskrypcje / billing** (wydanie 14,
`docs/audyt-ed14/funkcjonalnosci14.json`): 18 funkcjonalności, 5 nowych,
najsłabsza „Stany rozliczeń i zwrotów" (22,4% linii, 2 pliki na zerze).

## 1. Metoda

- **Pomiar.** vitest + istanbul, pokrycie zawężone do 227 plików
  produkcyjnych modułu 13 (`classifyPath` z `scripts/taxonomy/moduleMap.mjs`).
  Funkcjonalności według wzorców z mapy toru 13 wydania 13 plus pięć nowych
  wierszy. Pomiar bazowy na `6a0b9d5` odtwarza kolumny audytu wyd. 14 co do
  dziesiątej, np. „Stany rozliczeń" 22,4 / 21,0 / 18,2 i 2 pliki zerowe.
  Jedyny zerowy plik wiersza „Billing: rekoncyliacja i panel" w audycie to ta
  sama trasa `admin.billing-settlements.tsx`.
  - Przed: 408 plików testowych importujących kod modułu.
  - Po: cała suita (3432 pliki).
- **Kampania.** 10 rozłącznych klastrów plików. W każdym najpierw pracował
  agent piszący:
  - przy każdym defekcie najpierw test czerwony na starym kodzie, dopiero
    potem poprawka;
  - martwy kod usuwał tylko wtedy, gdy schemat bazy, typy albo graf wywołań
    dowodziły, że jest nieosiągalny;
  - testy pisał pod zachowanie, nie pod liczbę.

  Po nim pracował adwersaryjny weryfikator w prywatnym worktree:
  - odtworzył każdą naprawę na kodzie `6a0b9d5` i potwierdził, że jej test
    jest tam czerwony;
  - przepuścił mutacje przez kod produkcyjny i dopisał testy tam, gdzie
    mutant przeżył;
  - szukał defektów pominiętych przez autora.

## 2. Wynik

| Funkcjonalność                                              | Nowa |  Linie przed → po | Gałęzie przed → po | Funkcje przed → po | Zera przed → po |
| ----------------------------------------------------------- | :--: | ----------------: | -----------------: | -----------------: | --------------: |
| Stany rozliczeń i zwrotów                                   | tak  |  22,4% → **100%** |   21,0% → **100%** |   18,2% → **100%** |           2 → 0 |
| Strażnik drugiej subskrypcji planu i alarm duplikatu        | tak  |  93,7% → **100%** |   83,8% → **100%** |    100% → **100%** |           0 → 0 |
| Retencja dowodów księgowych przy zamknięciu konta           |      |  95,0% → **100%** |   82,4% → **100%** |   92,3% → **100%** |           0 → 0 |
| Zamiatarka i wspólny rdzeń wykonania zdarzeń webhooka       | tak  |  97,0% → **100%** |  84,9% → **99,1%** |    100% → **100%** |           0 → 0 |
| Warstwa serwerowa kodów rabatowych i zakres kodów operatora | tak  |  97,6% → **100%** |   88,8% → **100%** |    100% → **100%** |           0 → 0 |
| Zwroty, spory, windykacja i przypomnienia                   |      |  98,0% → **100%** |  88,8% → **98,9%** |   99,1% → **100%** |           0 → 0 |
| Bilety wydarzeń: wycena, podgląd kasy i odbiór z puli planu |      | 98,5% → **99,8%** |  93,4% → **99,9%** |    100% → **100%** |           0 → 0 |
| Samoobsługa subskrypcji i retencja przy rezygnacji          |      |  98,6% → **100%** |  95,1% → **99,4%** |  99,3% → **99,6%** |           0 → 0 |
| Darowizny                                                   |      |  99,0% → **100%** |   95,8% → **100%** |    100% → **100%** |           0 → 0 |
| Uzgodnienie dawnych anulowań za brak płatności              | tak  |  99,2% → **100%** |  82,0% → **98,7%** |   96,4% → **100%** |           0 → 0 |
| Webhook płatności                                           |      | 99,4% → **99,8%** |  93,1% → **95,5%** |    100% → **100%** |           0 → 0 |
| Checkout (Stripe) + intencja                                |      | 99,4% → **99,9%** |  97,1% → **99,0%** |  99,5% → **99,5%** |           0 → 0 |
| Billing: rekoncyliacja i panel                              |      |  99,5% → **100%** |  95,2% → **99,9%** |   99,6% → **100%** |           0 → 0 |

Wiersze, które przed kampanią miały 100% linii (podgląd kuponu,
członkostwo, plany i cennik, uprawnienia, dokumenty rozliczeniowe), nie
były celem kampanii i mają te same liczby.

**Suma modułu:**

| Metryka                | Przed                     | Po                                             |
| ---------------------- | ------------------------- | ---------------------------------------------- |
| Linie                  | 98,55% (136 niepokrytych) | **99,96% (4 niepokryte)**                      |
| Gałęzie                | 93,18%                    | **97,90%**                                     |
| Pliki testowe w suicie | 3432                      | 3432, wszystkie zielone poza jednym (patrz §5) |

Pozostałe niepokryte linie to celowe bezpieczniki wejścia z zewnątrz
(m.in. ostatni `catch` w `absoluteReturnUrl`) oraz `catch` w
`alertOrderReview`, nieosiągalny, bo `notifyTenantAdmins` sam niczego nie
rzuca. Każda pozostawiona gałąź ma uzasadnienie w raporcie klastra.

## 3. Naprawione defekty

33 defekty zachowania produkcyjnego. Każdy ma test, który na `6a0b9d5`
jest czerwony. Waga: W wysoka, Ś średnia, N niska.

### Stany rozliczeń i zwrotów (nowa funkcjonalność)

| Waga | Defekt i poprawka                                                                                                                                                                                                                     |
| :--: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  Ś   | Odczyt zleceń zwrotu wysyłał do 500 identyfikatorów w jednym `.in()` (URL ok. 19,7 KB, bramka odrzuca powyżej ok. 8 KB kodem 414) i cały raport padał. Teraz odczyt idzie porcjami po 100, równolegle.                                |
|  Ś   | Filtr stanu działał w pamięci, dopiero po oknie 500 najnowszych zamówień, więc starsze zamówienia w wybranym stanie znikały. Teraz filtr stoi w SQL przed oknem. Podział na zwrot pełny i częściowy robi ta sama reguła co wcześniej. |
|  Ś   | Etykiety zleceń zwrotu (`done`/`review`) nie pasowały do słownika bazy (`submitted`/`completed`/`cancelled`/`needs_review`), więc panel pokazywał surowe kody. Klucze PL/EN pokrywają się teraz z CHECK kolumny.                      |
|  N   | Ostrzeżenie o obciętym oknie mówiło o „500 pokazanych pozycjach”.                                                                                                                                                                     |
|  N   | Pola dat pomijały wspólny atom `DateInput` i token wysokości pól.                                                                                                                                                                     |
|  N   | Kwoty w tabeli nie są już formatowane lokalnym `Intl`: trasa korzysta ze wspólnych `formatMoney`/`uiLocale`, odpornych na błędny kod waluty.                                                                                          |

### Webhook, kasa i panel rozliczeń

| Waga | Defekt i poprawka                                                                                                                                                                                  |
| :--: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  Ś   | `resolvePricesByLookupKeys` wysyłał 11 kluczy katalogu w jednym zapytaniu, a operator przyjmuje najwyżej 10. Klucze idą teraz paczkami po 10.                                                      |
|  Ś   | W kasie biletu odrzucenie klienta operatora omijało `.catch` i zostawiało zawieszone zamówienie.                                                                                                   |
|  Ś   | Panel rozliczeń nadpisywał cache dziennika zdarzeń okrojonymi wierszami.                                                                                                                           |
|  Ś   | Panel rozliczeń, dziennik zdarzeń i lista zamówień biletowych pokazywały błąd odczytu albo brak sieci jako „brak danych” z licznikami 0.                                                           |
|  Ś   | Eksport audytu (CSV/XLSX) zwalniał adres pliku od razu po kliknięciu, przez co Safari i część przeglądarek Chromium na Androidzie gubiły plik. Eksport korzysta teraz ze wspólnego `downloadBlob`. |
|  Ś   | Raport audytu i metryki zdrowia webhooków zostawały na ekranie po zmianie zakresu, łącznie ze spóźnioną odpowiedzią dla starego zakresu.                                                           |
|  N   | Diagnostyka świeciła na zielono „0/0” przy nieprzeczytanym dzienniku.                                                                                                                              |
|  N   | Oś czasu zamówienia offline mówiła „nie zapisano zmian”.                                                                                                                                           |

### Zwroty, windykacja i przypomnienia

| Waga | Defekt i poprawka                                                                                                                  |
| :--: | ---------------------------------------------------------------------------------------------------------------------------------- |
|  Ś   | Potwierdzenie zapisu na wydarzenie podawało godzinę w strefie serwera (UTC), a nie w strefie wydarzenia.                           |
|  Ś   | Przypomnienie o wygaśnięciu obiecywało dostęp do końca okresu po anulowaniu za brak płatności. Dostęp kończy się wtedy z karencją. |
|  Ś   | Subskrypcja nigdy nieopłacona (porzucone 3DS) dostawała mail „wznów subskrypcję”.                                                  |

### Samoobsługa subskrypcji

| Waga | Defekt i poprawka                                                                    |
| :--: | ------------------------------------------------------------------------------------ |
|  Ś   | Subskrypcja na planie wycofanym ze sprzedaży pokazywała „brak członkostwa”.          |
|  Ś   | Zawieszony zapis ankiety rezygnacji wstrzymywał anulowanie subskrypcji.              |
|  N   | Błąd odczytu bazy w portalu operatora udawał „brak konta u operatora”.               |
|  N   | Przyciski zmiany planu pojawiały się przy zakupie dożywotnim i po końcu okresu.      |
|  N   | Odznaka „status płatności” brała zamówienia biletów i treści zamiast zamówień planu. |
|  N   | W trakcie odczytu sekcja pokazywała „brak członkostwa”.                              |

### Darowizny i bilety

| Waga | Defekt i poprawka                                                                                           |
| :--: | ----------------------------------------------------------------------------------------------------------- |
|  Ś   | Izolacja najemców: synchronizacja z operatorem rozliczała darowiznę po samym `id`, bez sprawdzenia najemcy. |
|  Ś   | Sesja `complete`, ale nieopłacona (polecenie zapłaty SEPA, przelew), była księgowana jako wpłata.           |
|  Ś   | Awaria odczytu kotwicy darowizny cyklicznej kończyła webhook sukcesem i operator już jej nie ponawiał.      |
|  Ś   | Awaria odczytu opcji podatkowych biletu otwierała kasę bez `tax_behavior` i bez `tax_code`.                 |
|  N   | `paid_at` darowizny jednorazowej brało chwilę zaksięgowania zamiast chwili zapłaty.                         |
|  N   | Sprzątanie osieroconych wierszy darowizn działało bez filtra środowiska.                                    |
|  N   | Niestandardowy identyfikator wydarzenia zrywał słownik nazw na liście zamówień biletowych.                  |

### Pozostałe

| Waga | Defekt i poprawka                                                                                      |
| :--: | ------------------------------------------------------------------------------------------------------ |
|  N   | Zamknięcie konta pomijało subskrypcję w stanie `unpaid`, która dalej obciąża klienta.                  |
|  N   | Uzgodnienie dawnych anulowań gubiło liczniki kroków już zapisanych, gdy kolejny zapis się nie powiódł. |
|  N   | Alarm duplikatu planu nie ponawiał chwilowego błędu odczytu właściciela.                               |

## 4. Optymalizacje

- **Stany rozliczeń:**
  - filtr w SQL przed oknem 500 zamówień zamiast pobierania całego okna i
    odrzucania w pamięci;
  - zlecenia zwrotu czytane równolegle, porcjami;
  - z `metadata` czytana jest tylko flaga `needs_manual_review`.
- **Dziennik zdarzeń płatności:** pełny ładunek zdarzenia operatora jest
  pobierany dopiero przy podglądzie wiersza, a nie dla 300 wierszy przy
  każdym otwarciu. Panel rozliczeń nie czyta już dziennika przy montowaniu.
- **Diagnostyka kuponów:** zapytania do operatora idą równolegle, w 5
  torach.
- **Zamknięcie konta:** odczyty planów i darowizn idą równolegle.
- **Pozostałe drobne:**
  - przypomnienia pomijają wiersze po karencji przed trzema odczytami;
  - `suspendPlanEntitlements` nie prosi już o `RETURNING`;
  - weryfikacja darowizn sprawdza najemcę jednym zapytaniem na przebieg.

Martwy kod usunięty w 60 miejscach, w każdym z dowodem ze schematu bazy,
typów albo grafu wywołań. Przykłady:

- `?? 0` na kolumnach `NOT NULL`;
- gałąź `"cancelled"` przy enumie `canceled`;
- nieużywane `REFUND_JOB_STATES`;
- nieużywana opcja `limit` zamiatarki, która przy `NaN` dawała pętlę bez
  limitu.

## 5. Walidacja

- `npx tsgo --noEmit`: czysto, także po scaleniu `origin/main`.
- `prettier --check` i `eslint` na 96 zmienionych plikach: czysto.
- `bun run verify:static`: 18 bramek OK, w tym kontrakt TS↔SQL.
- Pełna suita vitest: 3429 plików zielonych, 86 178 testów. Na `6a0b9d5`
  czerwony był tylko `clubThreadWorkspaceShell.test.tsx` (atrapa routera bez
  `useHydrated`); poprawka `24854b7` z `main` weszła tutaj przez scalenie.
  Po scaleniu zbiór plików nakładających się z `main` jest zielony
  (16 plików, 384 testy).

## 6. Uprawnienia `user_subscriptions` przy usunięciu konta (RODO)

Kampania wykryła, że `user_subscriptions.user_id` (20260601051732) nie ma
klucza obcego. W efekcie usunięcie konta zostawiało wiersze uprawnień z
surowym identyfikatorem osoby: ani `anonymize_accounting_evidence_for_user()`,
ani trigger `on_auth_user_deleted_retain_accounting` tej tabeli nie dotykały.

**Decyzja właściciela: kasowanie kaskadowe**, nie anonimizacja. Uzasadnienie:

- lustro operatora `subscriptions` od początku kasuje się kaskadowo razem z
  kontem;
- dowodami księgowymi zostają `payment_orders` (pseudonim) i
  `billing_documents`, których `subscription_id` odpina się
  (`ON DELETE SET NULL`);
- `user_subscriptions`, w odróżnieniu od `user_purchases`, nie niesie kwoty.

Zmiany:

- **Migracja** `20261018120000_user_subscriptions_user_fk_cascade.sql` z
  bliźniakiem `drizzle/migrations/0307_*`:
  - usuwa wiersze osierocone;
  - zakłada `user_subscriptions_user_id_fkey`
    `REFERENCES auth.users(id) ON DELETE CASCADE`.
- **Kod:** zapis uprawnienia dla konta usuniętego w trakcie dostawy webhooka
  (23503 na tym kluczu) kończy się ostrzeżeniem zamiast wyjątku. Dotyczy to
  `syncEntitlementState` i `grantEntitlement`; inaczej zdarzenie byłoby
  ponawiane bez końca. 23503 na innym kluczu (plan, najemca) nadal jest
  błędem.
- **Testy:**
  - pgTAP `supabase/tests/user_subscriptions_user_fk_cascade_test.sql`
    (7 asercji, czerwony bez FK);
  - dwa testy regresji w vitest (czerwone na starym kodzie).
- **Weryfikacja na pełnym schemacie** (lokalny PostgreSQL 16, wszystkie
  migracje): pozostałe testy pgTAP wstawiające uprawnienia działają na
  istniejących kontach `auth.users`.

## 7. Świadomie NIE zrobione (poza zakresem klastrów albo decyzja produktowa)

- **Strefa w `formatDate` maili rozliczeniowych** (`transactional.server.ts`).
  Daty końca okresu formatują się w strefie procesu (UTC), więc godziny
  22:00-24:00 UTC wypadają poprzedniego dnia. Wymaga decyzji o strefie.
- **`src/routes/profile.plan.tsx`** ma ten sam błąd „plan wycofany = brak
  planu” i datę zależną od strefy przeglądarki. Poprawka jest gotowa w
  raporcie klastra C9.
- **Przekazanie `generation` z trasy webhooka, uzgadniania i ponowienia z
  panelu do rdzenia.** Oszczędza jeden odczyt na zdarzenie. Dotyka trzech
  wywołujących spoza klastra.
- **Stała `DONATION_MIN_CENTS = 500`** ma komentarz „50 gr”, a 500 groszy
  to 5 zł. Do wyjaśnienia, czy błędny jest komentarz, czy wartość.
- **Kopia na karcie operatora (`SubscriptionCard`)** anuluje subskrypcję
  jednym kliknięciem, bez dialogu retencji. Decyzja produktowa.
- **Bramka „raz na dobę” alarmu duplikatu** jest zużywana przed wysłaniem
  dzwonka. Jej zwolnienie wymaga migracji.
