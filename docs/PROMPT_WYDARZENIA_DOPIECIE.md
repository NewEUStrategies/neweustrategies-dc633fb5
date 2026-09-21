# ZADANIE: dopiąć moduł 22 (wydarzenia) - 1 369 niepokrytych linii, 518 funkcji, 67 plików na zerze

Wejście: audyt pokrycia testami, wydanie 9
(`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 3, MODUŁ 22).

**MODUŁ 22 - Wydarzenia: event builder, rejestracja, onsite. 366 plików:
linie 9 124/10 493 = 86,95%, funkcje 3 427/3 945 = 86,87%, gałęzie 81,29%, instrukcje 85,46%.**

To zlecenie nie jest o procentach. Jest o **liczniku po drugiej stronie**: **1 369 niepokrytych
linii i 518 niewywołanych funkcji**. Moduł jest w dobrym stanie i to jest jego najważniejsza
cecha - 109 plików testowych w `src/lib/events/__tests__/` i 50 w
`src/components/admin/events/__tests__/`. Nie buduj nowej suity. **Domknij dziurę, która ma
konkretny kształt i konkretne 25 plików.**

---

# 0. Co jest ustalone. Przeczytaj, zanim cokolwiek zmienisz

## 0.1 Podstawa pomiaru

Procenty z `coverage-ed9/coverage-summary.json` (PIERWSZY przebieg wydania 9 - ten, w którym
zakotwiczony jest cały dokument audytu). Nazwy niewywołanych funkcji
z `coverage-ed9-final/coverage-final.json` (przebieg 2 - jedyny z reporterem `json`).
**Nie używaj `coverage-ed8/` jako stanu dzisiejszego.**

Zanim ruszysz jakąkolwiek liczbę z tego zlecenia - odtwórz ją u siebie. Jeśli się nie zgadza,
**zatrzymaj się i zgłoś rozbieżność**, nie „popraw pod nią kodu".

## 0.2 Kształt dziury: 25 plików niesie 56,7% całej luki

| niepokrytych linii |  linie | funkcje |   gałęzie | plik                                                                       |
| -----------------: | -----: | ------: | --------: | -------------------------------------------------------------------------- |
|             **86** |  8,51% |   8,33% | **3,81%** | `src/lib/events/registrationOutcomeNotify.server.ts`                       |
|             **65** |  4,41% |  11,11% | **1,12%** | `src/lib/events/participantTicketsApi.ts`                                  |
|             **59** | **0%** |  **0%** |        0% | `src/components/admin/events/organisms/EventPackagesPanel.tsx`             |
|             **47** | **0%** |  **0%** |        0% | `src/components/admin/events/organisms/EventRegistrationSettingsPanel.tsx` |
|             **47** | 18,96% |   5,88% |    31,81% | `src/routes/events.index.tsx`                                              |
|                 34 | 43,33% |  53,33% |    46,98% | `src/lib/events/admissionApi.ts`                                           |
|                 33 | **0%** |  **0%** |        0% | `src/components/admin/events/organisms/RegistrationFieldsPanel.tsx`        |
|                 33 | 10,81% |   9,09% |    **0%** | `src/lib/events/packagesApi.ts`                                            |
|                 31 | 71,29% |  54,23% |    64,77% | `src/components/admin/events/organisms/EventPagesMenuPanel.tsx`            |
|                 30 | 30,23% |  32,25% |    50,00% | `src/lib/events/useEventRegistrations.ts`                                  |
|                 30 | 71,15% |  31,57% |    54,13% | `src/routes/events.$slug.index.tsx`                                        |
|                 29 | 55,38% |  54,16% |    40,00% | `src/lib/events/sponsorsApi.ts`                                            |
|                 27 | 73,78% |  80,00% |    63,82% | `src/lib/events/meetingsApi.ts`                                            |
|                 24 | **0%** |  **0%** |        0% | `src/routes/admin.events_.new.tsx`                                         |
|                 22 | 79,04% |  75,00% |    60,71% | `src/lib/events/publicEventApi.ts`                                         |
|                 21 | 71,23% |  61,53% |    63,23% | `src/components/events/public/organisms/EventAgendaSection.tsx`            |
|                 21 | 77,65% |  62,22% |    63,52% | `src/components/events/registration/PublicRegistrationForm.tsx`            |
|                 20 | 37,50% |  32,00% |    55,00% | `src/components/admin/events/organisms/EventTypeDialog.tsx`                |
|                 20 |  9,09% |  **0%** |        0% | `src/components/events/public/organisms/EventSponsorsSection.tsx`          |
|                 19 | 13,63% |  **0%** |        0% | `src/lib/events/useEventTypes.ts`                                          |
|                 17 | **0%** |  **0%** |        0% | `src/components/events/public/organisms/SavedEventsList.tsx`               |
|                 16 | 72,88% |  92,30% |    65,21% | `src/lib/events/myEventProfileApi.ts`                                      |
|                 15 | 73,68% |  50,00% |    61,22% | `src/components/events/public/organisms/EventAttendeesList.tsx`            |
|                 15 | 11,76% |  **0%** |        0% | `src/components/events/public/organisms/EventMaterialsSection.tsx`         |
|                 15 | 25,00% |  40,00% |    12,12% | `src/lib/events/packageInviteApi.ts`                                       |

**Razem 776 z 1 369 niepokrytych linii = 56,7%.** Pozostałe 593 linie rozkładają się na
ponad trzysta plików po kilka linii - to ogon, nie zadanie.

## 0.3 Sześćdziesiąt siedem zer, ale to nie są zera logiki

67 plików modułu ma **zero pokrytych linii** i razem to **549 linii i 213 funkcji** - czyli
średnio osiem linii na plik. Rozkład jest jednoznaczny:

|    ile | katalog                                                           |
| -----: | ----------------------------------------------------------------- |
| **56** | `src/routes`                                                      |
|      4 | `src/components/admin/events/organisms`                           |
|      2 | `src/components/admin/events/studio`                              |
|      5 | pozostałe (public organisms/molecules/atoms, registration, hooks) |

**Pięćdziesiąt sześć z sześćdziesięciu siedmiu zer to pliki tras** - cienkie owijki
`createFileRoute` z komponentem strony. To jest problem drzewa tras, nie logiki: to samo
zjawisko, które w module 20 daje `Routing / trasy publiczne` 33,7% funkcji. Nie wpisuj tego
do jednego worka z punktami z §0.2.

## 0.4 168 martwych funkcji nazwanych, w sześciu klasach

|    ile | klasa                                                                                   | co z tym zrobić                          |
| -----: | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| **51** | komponent trasy (`*Page`, `*Route`, `*RouteError`, `*Layout`, `*Tab`, `*Shell`)         | B3 - jeden test na drzewo, nie 51 testów |
|     29 | odczyt (`fetch*`, `parse*`, `read*`, `search*`, `download*`, `sync*`)                   | A3                                       |
| **19** | **usuwanie i zmiana stanu** (`delete*`, `revoke*`, `set…Status`, `purchase*`, `quote*`) | **A2 - najwyższe ryzyko**                |
|     14 | hook mutujący (`useSave*`, `useDelete*`, `useDecide*`, `useUpsert*`, `usePromote*`)     | A3                                       |
|      9 | hook czytający                                                                          | A3                                       |
|     46 | pozostałe (formatery, panele, pomocnicy powiadomień)                                    | A1, A4                                   |

## 0.5 Piętnaście funkcjonalności: gdzie realnie jest praca

| funkcjonalność                                  | plików |   LOC |      linie |   gałęzie |   funkcje | fn      | zera |
| ----------------------------------------------- | -----: | ----: | ---------: | --------: | --------: | ------- | ---: |
| Katalog wydarzeń, typy, tworzenie               |     24 |   629 |  **76,8%** |     82,5% | **74,3%** | 202/272 |    6 |
| Rejestracja: formularz, pola, zgody, decyzje    |     38 | 1 303 |  **77,1%** | **72,0%** | **68,6%** | 273/398 |    9 |
| Bilety, pakiety, wejściówki (pieniądze)         |     30 |   955 |  **78,7%** |     73,5% |     80,6% | 261/324 |    4 |
| Publiczny portal wydarzenia                     |     60 | 1 148 |  **78,9%** | **67,6%** |     76,5% | 323/422 |   10 |
| Studio wydarzenia: rama, moduły, gotowość       |     28 |   569 |      87,3% |     78,9% |     84,4% | 178/211 |    7 |
| Branding, strony i menu wydarzenia              |     12 |   435 |      89,4% |     86,6% |     83,6% | 158/189 |    2 |
| Giełda spotkań 1-1                              |     32 |   950 |      91,4% |     85,8% |     93,6% | 366/391 |    7 |
| Sponsorzy i partnerzy                           |     16 |   595 |      92,1% |     83,1% |     93,9% | 248/264 |    3 |
| Agenda: sesje, ścieżki, sale, konflikty         |     28 | 1 054 |      92,5% |     85,8% |     94,9% | 392/413 |    9 |
| Informacje ogólne, strefa czasowa, adres        |     10 |   290 |      93,4% |     93,8% |     95,3% | 101/106 |    1 |
| Odprawa na miejscu: skan, identyfikatory, leady |     49 | 1 586 |      93,7% |     92,3% |     95,5% | 536/561 |    9 |
| Powierzchnia uczestnika (moje wydarzenie)       |     21 |   445 |      93,9% |     87,2% |     97,0% | 162/167 |    1 |
| Regulaminy, grupy i uprawnienia uczestników     |     18 |   492 |      95,3% |     94,7% |     96,9% | 219/226 |    4 |
| Widgety wydarzeń w builderze stron              |     10 |   547 |      97,4% |     83,9% |     95,0% | 170/179 |    0 |
| Analityka, komunikacja, integracje wydarzenia   |      4 |    33 | **100,0%** |    100,0% |    100,0% | 9/9     |    0 |

**Cztery pierwsze wiersze to cała robota.** Jedenaście pozostałych stoi na 87-100% i **nie
należy ich ruszać** - podnoszenie 93,7% na 95% w odprawie kosztuje więcej niż 68,6% funkcji
w rejestracji.

## 0.6 Czego NIE ma sensu ruszać

- **Jedenaście funkcjonalności z dolnej części tabeli §0.5** (od `Studio` w dół). Ogon 593
  linii rozłożony po trzystu plikach nie jest zadaniem.
- **Nie przepisuj testów, które już są.** Moduł ma 159 plików testowych w dwóch katalogach.
  Dziura nie jest z braku suity - jest z braku **konkretnych ścieżek** w istniejącej suicie.
- **Nie ruszaj `it.fails`.** Moduł 22 ma najwięcej zarejestrowanych defektów w całym
  repozytorium (**52 wpisy**, rozdz. 7.2 audytu) i to jest jego zaleta, nie dług. Wpisy
  powstały RAZEM z pokryciem, nie zamiast napraw.

---

# CZĘŚĆ A - DEFEKTY I NIEDOMKNIĘTE KONTRAKTY (P1)

## A1. Powiadomienia o pieniądzach: 86 niepokrytych linii, 3,81% gałęzi i idempotencja, której nie sprawdza nic

**To jest pozycja blokująca tego zlecenia.**

`src/lib/events/registrationOutcomeNotify.server.ts` (324 linie) to **jedyna ścieżka
„skutek płatności → uczestnik"**. Nadawcą nie jest człowiek, a webhook Stripe:
`payments_apply_event_ticket_outcome` przenosi wynik płatności na zgłoszenie, a moduł rozsyła
mail, SMS i dzwonek w aplikacji - **także wtedy, gdy nikt z redakcji nie patrzy** (komentarz
`:1-8`).

Pomiar: **8,51% linii (86 niepokrytych), 1/12 funkcji (8,33%), gałęzie 3,81%.** Martwych
funkcji nazwanych **dziesięć**: `str` (`:57`), `readContact` (`:62`), `resolveLang` (`:73`),
`money` (`:85`), `eventTitle` (`:93`), `detailsFor` (`:99`), `smsBody` (`:120`), `pushBell`
(`:137`), `notifyPromoted` (`:175`), `readChannels` (`:232`).

**Jedyny plik testowy, który ten moduł wymienia, PODMIENIA go na atrapę**
(`src/lib/events/__tests__/outcomeResend.test.ts:23`, `vi.mock("@/lib/events/registrationOutcomeNotify.server", …)`).
Czyli: testowana jest ścieżka ponownej wysyłki **wokół** notyfikatora, a sam notyfikator nie
wykonał się ani raz.

Pięć kontraktów do przypięcia, w kolejności konsekwencji:

**1. Idempotencja przy ponowieniu webhooka - najważniejsza.** `notifyPromoted` (`:196`) nadaje
każdemu awansowi klucz `event-ticket-promoted:${registrationId}` z komentarzem: _„Awans jest
jednorazowy per zgłoszenie - klucz trzyma ten kontrakt nawet przy ponowieniu tego samego
zdarzenia przez operatora."_ Osobno `notifyTicketOutcome` przyjmuje `idempotencySuffix`
(`:252-257`) z odwrotnym wymaganiem: _„Ponowna wysyłka z panelu MUSI ominąć bramkę powtórzeń -
to jest jej jedyny sens - a webhook nadal nie może wysłać tej samej wiadomości dwa razy."_
**Dwa przeciwne wymagania w jednym parametrze i zero testów.** Awaria jest głośna i droga:
Stripe ponawia webhooki, więc pęknięcie klucza oznacza ten sam mail do każdej awansowanej
osoby tyle razy, ile było prób. Test: ten sam `payload` dwa razy → **jedna** wysyłka; ten sam
`payload` z `idempotencySuffix` → **druga** wysyłka przechodzi; klucz zawiera `registration_id`
i nie zawiera znacznika czasu.

**2. `unpaid` nie ma typu maila, a kolejka rusza PRZED tym sprawdzeniem.** `TYPE_BY_OUTCOME`
(`:28-32`) mapuje `paid`, `refunded` i `partial_refund` - **`unpaid` nie ma wpisu**, choć jest
legalnym `TicketOutcome` (`:25`). W `notifyTicketOutcome` `notifyPromoted` biegnie w `:277`,
a `if (!type || !registrationId) return result` dopiero w `:283`. To jest **celowe**
i udokumentowane (`:275-276`: _„Pełny zwrot zwalnia miejsce - kolejka rusza niezależnie od
tego, czy sam zwracający ma jeszcze adres w bazie"_), ale nie ma na to testu, więc odwrócenie
kolejności przechodzi CI. Test: `outcome: "unpaid"` → **żaden mail do płacącego**, a awansowani
**dostają** swoje; `applied !== true` → zero wysyłek w ogóle (`:272`).

**3. Asymetria kanałów - ROZSTRZYGNIJ i podaj wynik.** Płacący uczestnik ma preferencje
kanałów czytane per zgłoszenie (`readChannels`, `:232-250`, z semantyką opt-out: `notify_email
!== false`, więc NULL znaczy „wysyłaj", i fail-soft na błędzie bazy - _„brak wiersza albo błąd
bazy nie może wyciszyć powiadomienia o pieniądzach"_). **`notifyPromoted` nie woła
`readChannels` w ogóle** - awansowani dostają mail I SMS bez pytania o swoje preferencje,
choć każdy ma własne `registration_id`. Może to być świadome (awans jest czasowo krytyczny),
ale nie jest ani udokumentowane, ani przetestowane. Rozstrzygnij: jeśli świadome - dopisz
komentarz i test przypinający; jeśli nie - dołóż odczyt kanałów i test.

**4. SMS-y są bez polskich znaków CELOWO i nikt tego nie pilnuje.** `smsBody` (`:120-135`)
zwraca `Bilet oplacony`, `Szczegoly wyslalismy mailem`, `zostal anulowany`, `Czesciowy zwrot` -
sześć tekstów (trzy wyniki × dwa języki) **bez diakrytyków**. To nie literówki: znak poza
GSM-7 przełącza całą wiadomość na UCS-2 i **połowi długość segmentu**, czyli podwaja koszt
i grozi ucięciem. Bez testu pierwszy „porządkujący ogonki" commit to zepsuje, a rachunek
przyjdzie miesiąc później. Test: każdy z sześciu tekstów przechodzi
`/^[\x00-\x7F@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-.\/0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/`
(albo prostszy wariant: brak znaków z `ąćęłńóśźżĄĆĘŁŃÓŚŹŻ`), plus asercja na obecność tytułu
wydarzenia w treści.

**5. Formater kwoty i kaskada języka.** `money` (`:85-91`) buduje `Intl.NumberFormat` z locale
po języku (`en-GB` / `pl-PL`), waluty z ładunku **z fallbackiem `"PLN"`** i dzieli grosze przez 100. `eventTitle` (`:93-97`) ma kaskadę `en ?? pl` / `pl ?? en` z domknięciem `?? ""`.
`detailsFor` (`:99-118`) składa do trzech wierszy, a wiersz „Kwota zwrotu" pojawia się
**tylko gdy `outcome !== "paid"`**. `resolveLang` (`:73-83`) daje `"pl"` dla gościa bez konta
i `"pl"` w `catch`. To sześć czystych, tanich testów na funkcjach, które decydują, jaką kwotę
i w jakiej walucie widzi uczestnik w mailu.

**Kryterium odbioru:** `registrationOutcomeNotify.server.ts` z **8,51% na ≥ 80% linii i z 3,81%
na ≥ 70% gałęzi**; dziesięć martwych funkcji z niezerową liczbą wywołań; **test nie mockuje
modułu, który pokrywa**; rozstrzygnięcie punktu 3 zapisane w PR z plikiem i linią; próg
per-ścieżka z pomiarem i datą.

---

## A2. Dziewiętnaście operacji usuwających i zmieniających stan - żadna nie wykonała się w teście

Z 168 martwych funkcji nazwanych modułu **dziewiętnaście to operacje nieodwracalne albo
przesuwające pieniądze**. To najgroźniejsza klasa w całym module, bo błąd w usuwaniu nie daje
się cofnąć, a błąd w statusie zamówienia jest widoczny w kasie:

| funkcja                         | plik:linia                                    |
| ------------------------------- | --------------------------------------------- |
| `quoteAdmission`                | `src/lib/events/admissionApi.ts:196`          |
| `purchasePackage`               | `src/lib/events/admissionApi.ts:239`          |
| `acceptPackageInvite`           | `src/lib/events/packageInviteApi.ts:66`       |
| `setPackageOrderStatus`         | `src/lib/events/packagesApi.ts:224`           |
| `revokePackageSeat`             | `src/lib/events/packagesApi.ts:277`           |
| `deleteEventPackage`            | `src/lib/events/packagesApi.ts:176`           |
| `deleteEventTicket`             | `src/lib/events/registrationsApi.ts:270`      |
| `deleteRegistrationField`       | `src/lib/events/registrationsApi.ts:340`      |
| `setRegistrationChannels`       | `src/lib/events/participantTicketsApi.ts:169` |
| `deleteEventSession`            | `src/lib/events/sessionsApi.ts:314`           |
| `deleteEventTrack`              | `src/lib/events/sessionsApi.ts:156`           |
| `deleteEventRoom`               | `src/lib/events/sessionsApi.ts:205`           |
| `deleteSponsor`                 | `src/lib/events/sponsorsApi.ts:250`           |
| `deleteSponsorTier`             | `src/lib/events/sponsorsApi.ts:132`           |
| `deleteSponsorMaterial`         | `src/lib/events/sponsorsApi.ts:351`           |
| `setSponsorsPublished`          | `src/lib/events/sponsorsApi.ts:266`           |
| `deleteMeetingTable`            | `src/lib/events/meetingsApi.ts:100`           |
| `deleteAdminAvailability`       | `src/lib/events/meetingsApi.ts:515`           |
| `setMeetingDirectoryVisibility` | `src/lib/events/meetingsApi.ts:651`           |

Wzorzec jest czytelny i wart zapisania w raporcie: **suita modułu 22 testuje czytanie
i tworzenie, a nie testuje usuwania, odwoływania i zmiany statusu.** Trzydzieści zapytań
`fetch*` ma pokrycie, a dziewiętnaście operacji destrukcyjnych - nie.

Zadanie, w kolejności ryzyka:

1. **`purchasePackage` + `quoteAdmission` + `setPackageOrderStatus`** - ścieżka pieniędzy.
   Wycena musi być zgodna z tym, co potem obciąża zamówienie; zmiana statusu musi być
   **jednokierunkowa albo jawnie odwracalna** - rozstrzygnij, który kontrakt obowiązuje,
   i przypnij go testem. `admissionApi.ts` stoi dziś na 43,33% linii, `packagesApi.ts` na
   **0% gałęzi**.
2. **`revokePackageSeat` + `acceptPackageInvite`** - miejsce w pakiecie. Test na wyścig:
   odwołanie zaproszenia po jego przyjęciu **nie może** cicho przejść.
3. **Sześć `delete*` na treści wydarzenia** (`sessionsApi`, `sponsorsApi`): każdy z testem
   na **zakres najemcy** (usunięcie nie może dotknąć wiersza innego wydarzenia ani innego
   najemcy) i na kaskadę (usunięcie ścieżki a sesje w niej).
4. **`setRegistrationChannels`** - to jest druga strona punktu A1.3: uczestnik wyłącza SMS,
   a powiadomienie o pieniądzach ma go ominąć. Bez testu obie strony tego kontraktu są
   niesprawdzone jednocześnie.

**Kryterium odbioru:** dziewiętnaście funkcji z niezerową liczbą wywołań; każda operacja
`delete*` z **testem na zakres najemcy**; `packagesApi.ts` z 0% na ≥ 70% gałęzi;
`admissionApi.ts` z 43,33% na ≥ 80% linii.

---

## A3. Cztery panele administratora na absolutnym zerze - i wszystkie cztery to rejestracja albo pieniądze

| plik                                 | linie    | funkcje  | co konfiguruje                                    |
| ------------------------------------ | -------- | -------- | ------------------------------------------------- |
| `EventPackagesPanel.tsx`             | **0/59** | **0/31** | pakiety, zamówienia, miejsca - **pieniądze**      |
| `EventRegistrationSettingsPanel.tsx` | **0/47** | **0/31** | ustawienia rejestracji (limity, waitlista, zgody) |
| `RegistrationFieldsPanel.tsx`        | **0/33** | **0/15** | pola formularza zgłoszenia                        |
| `admin.events_.new.tsx`              | **0/24** | **0/7**  | tworzenie wydarzenia                              |

Razem **163 niepokryte linie i 84 niewywołane funkcje w czterech plikach** - 11,9% luki modułu
w liniach i **16,2% w funkcjach**. Wszystkie
cztery są w globach z realnymi podłogami (`src/components/admin/events/organisms/**` ma
`functions: 82, lines: 86`) - i przechodzą, bo glob jest agregatem katalogu (patrz B1).

`EventPackagesPanel.tsx` ma dodatkowo dwa martwe pomocniki czyste, które są najtańszym
możliwym testem w tym module: `formatPrice` (`:53`) i `orderStatus` (`:60`).

Zadanie: po jednym teście renderu na panel, z asercją na **stan pusty**, **stan z danymi**
i **stan błędu** - te trzy gałęzie są w każdym z nich i żadna nie jest dziś wykonana. Wzorzec
weź z `src/components/admin/events/__tests__/` (50 plików) i podaj w PR, z którego.

**Kryterium odbioru:** cztery pliki powyżej zera; `formatPrice` i `orderStatus` pokryte;
cztery panele razem z 0% na ≥ 60% linii.

---

## A4. Dwie ściany hooków: `useEventRegistrations` i `useEventTypes`

`src/lib/events/useEventRegistrations.ts` - **30,23% linii, 32,25% funkcji**, dziesięć martwych
hooków, wszystkie mutujące: `useRegistrationFields` (`:80`), `useInvalidateEvent` (`:115`),
`useSaveEventTicket` (`:122`), `useDeleteEventTicket` (`:132`), `useSaveRegistrationField`
(`:140`), `useDeleteRegistrationField` (`:150`), `useDecideRegistration` (`:160`),
`useSaveRegistration` (`:170`), `usePromoteFromWaitlist` (`:180`),
`useMarkRegistrationsNotified` (`:190`).

`src/lib/events/useEventTypes.ts` - **13,63% linii, 0% funkcji**, martwe **wszystkie siedem**:
`useEventTypes` (`:45`), `useAdminEventTypes` (`:54`), `useEventTypeInvalidation` (`:68`),
`useUpsertEventType` (`:75`), `useSetEventTypeActive` (`:83`), `useDeleteEventType` (`:95`),
`useReassignEventType` (`:108`).

`useDecideRegistration` i `usePromoteFromWaitlist` to klienckie odpowiedniki tego, co A1 testuje
po stronie serwera - **rób je razem z A1**, bo dopiero para dowodzi, że decyzja organizatora
i powiadomienie uczestnika mówią to samo. `useReassignEventType` jest najgroźniejszy z drugiej
listy: przepisuje wydarzenia z jednego typu na inny, czyli masowa zmiana danych bez testu.

Zadanie: unieważnianie cache (który klucz, po której mutacji) i **stan błędu mutacji**
(czy UI wraca do stanu przed, czy zostaje w połowie). Wzorzec testowania hooków React Query
jest w repozytorium wielokrotnie - znajdź go, zastosuj, podaj źródło w PR.

**Kryterium odbioru:** `useEventRegistrations.ts` z 32,25% na ≥ 80% funkcji;
`useEventTypes.ts` z **0% na ≥ 85% funkcji**; każdy hook mutujący z asercją na klucz
unieważnienia.

---

# CZĘŚĆ B - PROGI I DRZEWO TRAS

## B1. Progi są dobre, ale są agregatem katalogu - i pod 85% podłogą siedzi plik na 8,51%

Moduł 22 jest **dobrze obramkowany** i to trzeba powiedzieć wprost: z 366 plików **294 są
złapane globem**, 1 ma próg jawny, 71 nie ma żadnego. Globy mają realne podłogi:

| glob                                       | instr. | funkcje | linie | gałęzie |
| ------------------------------------------ | -----: | ------: | ----: | ------: |
| `src/lib/events/**`                        |     82 |      87 |    85 |      77 |
| `src/components/events/**`                 |     82 |      79 |    83 |      75 |
| `src/components/events/packages/**`        |     94 |      96 |    96 |      90 |
| `src/components/admin/events/**`           |     87 |      86 |    88 |      85 |
| `src/components/admin/events/molecules/**` |     95 |      95 |    95 |      92 |
| `src/components/admin/events/organisms/**` |     85 |      82 |    86 |      85 |

**A `thresholds.perFile` NIE jest ustawione**, więc każdy z tych globów jest **agregatem
katalogu**. Konsekwencja jest mierzalna: `registrationOutcomeNotify.server.ts` stoi na
**8,51% linii wewnątrz globa z podłogą 85** i bramka jest zielona, bo pozostałe pliki
`src/lib/events/**` go dowożą. Tak samo `packagesApi.ts` (0% gałęzi pod podłogą 77)
i cztery panele z A3 (0% pod podłogą 86).

Zadanie: dołóż **próg jawny per plik** na każdy plik, który w tym zleceniu ruszasz -
„zmierzone minus ~2 pp", z komentarzem podającym pomiar i datę, tak jak istniejące wpisy.
Osobno **rozstrzygnij i podaj liczbę**: ile plików modułu 22 byłoby dziś pod podłogą swojego
globa, gdyby włączyć `perFile: true`. **Nie włączaj go w tym PR-ze** - to decyzja na cały
repozytorium, nie na jeden moduł.

## B2. Siedemdziesiąt jeden plików bez progu to dokładnie te, w których siedzą zera

71 plików bez żadnego progu to trasy (`src/routes/admin.events_*`, `src/routes/events.*`) -
i to w nich mieszka **56 z 67 zer** modułu. Czyli zapadka jest przypięta do katalogów
komponentów i biblioteki, a nie ma jej tam, gdzie pokrycie realnie wynosi zero. Ten sam
układ co w module 20 (`Routing` 33,7% funkcji, próg `__root.tsx` = `functions: 12`).

## B3. Pięćdziesiąt jeden komponentów tras: jeden test, nie pięćdziesiąt jeden

51 z 168 martwych funkcji nazwanych to komponenty tras. Nie pisz na nie osobnych testów -
to owijki po kilka linii, a koszt utrzymania 51 plików testowych przewyższy zysk.

Zadanie: **jeden test drzewa tras wydarzeń**, który montuje każdą trasę modułu z atrapą
loadera i sprawdza, że komponent się renderuje bez rzutu oraz że jego granica błędu
(`*RouteError`) renderuje się na wstrzykniętym błędzie. Dwie pary są najważniejsze, bo to
powierzchnie publiczne: `RegisterRoute`/`RegisterRouteError`
(`src/routes/events.$slug_.register.tsx:49`, `:58`) i `PackagesRoute`/`PackagesRouteError`
(`src/routes/events.$slug_.packages.tsx:40`, `:49`) - rejestracja i pakiety, czyli dwie strony,
na których uczestnik zostawia dane i pieniądze.

Do tego trzy trasy z listy §0.2 zasługują na własny test, bo nie są owijkami:
`events.index.tsx` (47 niepokrytych linii, martwe `EventsPage` `:158`, `EventsPageBody` `:185`,
`Section` `:227`), `events.$slug.index.tsx` (30 niepokrytych, **31,57% funkcji**)
i `admin.events_.new.tsx` (24 niepokryte, zero).

**Kryterium odbioru:** jeden test drzewa tras modułu 22; 51 komponentów tras powyżej zera;
`events.index.tsx` z 5,88% na ≥ 60% funkcji.

---

# JAK MIERZYĆ

**Pomiar wyjściowy jest w repozytorium i nie trzeba go powtarzać:**

```bash
coverage-ed9/coverage-summary.json        # pokrycie per plik - PODSTAWA tego zlecenia
coverage-ed9-final/coverage-final.json    # fnMap + licznik f = nazwy funkcji bez wywołania
```

**Mierz na pojedynczych katalogach, nie na całej suicie** (pełny przebieg ~36 minut). Reporter
`json` nie jest w konfiguracji, więc nazwy niewywołanych funkcji wymagają dołożenia go
z wiersza poleceń:

```bash
npx vitest run --coverage --coverage.reporter=json --coverage.reporter=json-summary \
  src/lib/events/__tests__ src/components/admin/events/__tests__ \
  src/components/events src/routes/__tests__
```

**Licz LUKĘ, nie procent.** Kryterium sukcesu tego zlecenia to `1 369 → poniżej 700`
niepokrytych linii, i tę liczbę podaj przed i po:

```bash
node -e 'const s=require("./coverage/coverage-summary.json");/* filtruj moduł 22 wg modules.mjs */'
```

**Stan wyjściowy CI, który MUSISZ znać przed startem:**

- `check:ci-gates` jest **czerwona** - jedno padnięcie na ratchecie tekstu jednojęzycznego
  (`src/routes/admin.analytics.index.tsx:387`). **To nie jest twoja czerwień.**
- suita jest czerwona w **ośmiu plikach (272 testy)** - przyczyny w rozdz. 12.2 audytu
  i w `docs/PROMPT_OSIEM_CZERWIENI.md`. **Żaden z tych ośmiu nie należy do modułu 22** -
  dziewiąty będzie twój.

---

# ZASADY - obowiązują w całości

**Pomiar przed i po.** Każdy punkt ma dzisiejszą liczbę. Odtwórz ją, zanim ruszysz punkt;
przy rozbieżności zatrzymaj się i zgłoś. Po zmianie podaj tę samą liczbę tą samą metodą.
„Powinno być lepiej" nie jest wynikiem odbioru.

**Testy.** Progi w `vitest.config.ts` wolno **wyłącznie podnosić** („zmierzone minus ~2 pp"
per plik, „minus ~4 pp" per glob, z komentarzem: pomiar + data). **Nie wykluczaj plików
z pomiaru** - żadnego `exclude`, `all: true` zostaje. **Nie zmieniaj zachowania produkcyjnego,
żeby test przeszedł** - defekt → `it.fails` z opisem. **Nie regenerujesz snapshotu autoryzacji,
żeby zgasić czerwień.** I reguła, która w tym module jest kluczowa: **nowy test NIE MOŻE
podmieniać na atrapę modułu, który ma pokryć** - to jest dokładnie przyczyna 8,51% w A1.

**Dane i bezpieczeństwo.** Żaden test nie wychodzi do sieci, **nie wysyła maila ani SMS-a**
i nie zawiera prawdziwego sekretu - atrapy `sendTxEmail` i `sendSms`, zawsze. RODO: żadnych
prawdziwych danych osobowych w fixture'ach; uczestnicy, adresy i telefony syntetyczne, maile
wyłącznie w `example.com`/`example.org`, numery z zakresów testowych. **`tenant_id` jest
warunkiem, nie ozdobą** - każda operacja `delete*` z A2 dostaje test na zakres najemcy.

**Kod.** Bez `any` i `as any`. Zamiast „—" stosuj „-". i18n: PL i EN - w tym module dotyczy to
także **treści powiadomień** (A1 punkt 4 i 5: sześć tekstów SMS i kaskada tytułu wydarzenia).
Atomic design: nowe komponenty w istniejącą hierarchię `atoms`/`molecules`/`organisms`.

---

# CZEGO NIE ROBIĆ - pięć pułapek

1. **Nie „napraw" polskich ogonków w SMS-ach.** Brak diakrytyków w `smsBody` jest celowy
   (GSM-7 kontra UCS-2). A1 punkt 4 każe to **przypiąć testem**, nie poprawić.
2. **Nie podnoś jedenastu funkcjonalności z dolnej części §0.5.** 93,7% w odprawie na 95%
   kosztuje więcej niż 68,6% funkcji w rejestracji, a luka jest w rejestracji.
3. **Nie pisz 51 testów na komponenty tras.** Jeden test drzewa (B3). Pięćdziesiąt jeden
   plików testowych na owijki to dług utrzymaniowy, nie pokrycie.
4. **Nie włączaj `perFile: true`** w tym PR-ze. Podaj liczbę plików, które by oblały (B1),
   i zostaw decyzję.
5. **Nie kasuj ani nie „naprawiaj" 52 wpisów `it.fails`** modułu. To rejestr defektów
   i najwyższy wynik w repozytorium - zaleta, nie dług.

---

# DEFINICJA UKOŃCZENIA

1. **Niepokrytych linii modułu 22 z 1 369 na poniżej 700**, a niewywołanych funkcji
   z 518 na poniżej 260 - liczba podana przed i po, tą samą metodą.
2. **`registrationOutcomeNotify.server.ts` z 8,51% na ≥ 80% linii i z 3,81% na ≥ 70% gałęzi**,
   dziesięć martwych funkcji wywołanych, test **nie mockuje** pokrywanego modułu (A1).
3. **Idempotencja przy ponowieniu webhooka dowiedziona testem** w obie strony: ten sam ładunek
   dwa razy → jedna wysyłka; z `idempotencySuffix` → druga przechodzi (A1 punkt 1).
4. **Rozstrzygnięta asymetria kanałów** dla awansowanych z listy rezerwowej - odpowiedź w PR
   z plikiem i linią, plus komentarz w kodzie albo naprawa (A1 punkt 3).
5. **Dziewiętnaście operacji usuwających i zmieniających stan z niezerową liczbą wywołań**,
   każda `delete*` z testem na zakres najemcy (A2).
6. **Cztery panele administratora powyżej zera**, razem na ≥ 60% linii (A3).
7. **`useEventTypes.ts` z 0% na ≥ 85% funkcji**, `useEventRegistrations.ts` z 32,25% na ≥ 80%
   funkcji, każdy hook mutujący z asercją na klucz unieważnienia cache (A4).
8. **Jeden test drzewa tras modułu**, 51 komponentów tras powyżej zera, obie pary
   `RegisterRoute`/`PackagesRoute` z granicami błędu (B3).
9. **Próg jawny per plik na każdy plik, który ruszasz**, z pomiarem i datą; podana liczba
   plików, które oblałyby `perFile: true` (B1).
10. **Cztery najsłabsze funkcjonalności** z 76,8% / 77,1% / 78,7% / 78,9% linii **na ≥ 88%
    każda**, a `Rejestracja` z 68,6% na **≥ 85% funkcji**.
11. **`bun run check:*` w komplecie zielone poza `check:ci-gates`**; suita czerwona
    w dokładnie ośmiu plikach, tych samych co przed startem.

**Na koniec zdaj raport:** co zmierzyłeś przed i po (liczba za liczbą, tą samą metodą), które
defekty zarejestrowałeś jako `it.fails` i dlaczego, czego świadomie nie zrobiłeś, oraz -
osobno - **które liczby z tego zlecenia okazały się nieaktualne**. Ta ostatnia lista jest dla
audytu najcenniejsza: wydanie 9 znalazło osiem własnych pomyłek i wszystkie przez sprawdzenie
liczby, nie przez jej przepisanie.
