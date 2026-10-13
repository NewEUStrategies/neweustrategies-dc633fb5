# Uzgodnienie dawnych anulowań za brak płatności (2026-10-13)

Jednorazowe zadanie domykające lukę po regule karencji płatności z PR #495
(audyt SUB-03). Kod: `src/lib/billing/legacyNonPaymentReconcile.server.ts`
(decyzje i zapisy), `legacyNonPaymentReconcile.functions.ts` (bramka),
`legacyNonPaymentReconcile.ts` (kształt raportu), karta
`src/components/admin/billing/LegacyNonPaymentReconcileCard.tsx`.

## Po co

PR #495 wprowadził regułę: przy zaległości i po anulowaniu **za brak płatności**
dostęp trwa najwyżej do `min(koniec okresu, pierwsza nieudana płatność + 14 dni)`
(`PAYMENT_GRACE_DAYS` w `src/lib/billing/accessPeriod.ts`). Migracje
`20261013090500` i `20261013090600` przycięły uprawnienia subskrypcji, które
**w chwili wdrożenia** były `past_due` / `unpaid`.

Poza obiema ścieżkami zostały subskrypcje anulowane za brak płatności
**wcześniej**. Stary webhook dał im dostęp do końca okresu operatora, a Stripe
przy odnowieniu przesuwa okres o cały cykl przed obciążeniem karty - przy planie
rocznym to rok nigdy nieopłaconego dostępu. W bazie nie ma powodu anulowania ani
kotwicy karencji (`first_payment_failed_at`), więc ślepa migracja SQL nie
odróżni ich od rezygnacji klienta, która dostęp do końca opłaconego okresu
zachowuje. Rozstrzyga operator płatności - dlatego to zadanie serwerowe, a nie
migracja.

## Co robi

Partia czyta `subscriptions` o statusie `canceled` w jednym środowisku
(kursor po `id`, rosnąco, domyślnie 50 wierszy). Dla wiersza, którego
uprawnienie (`user_subscriptions` po `external_ref`, **w najemcy tej
subskrypcji**) nadal daje dostęp - albo którego organizacja planu Zespół jest
aktywna - pobiera subskrypcję od operatora (`subscriptions.retrieve` z
`expand: ["latest_invoice"]`, klient właściwego środowiska, jedno żądanie
naraz), a gdy decyzja zależy od dowodu zapłaty, którego ostatnia faktura nie
daje - także historię opłaconych faktur bieżącego okresu (`invoices.list`,
patrz niżej) - i decyduje:

| Decyzja               | Kiedy                                                                                                                                                                     | Skutek                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `clamp`               | powód `payment_failed` / `payment_disputed` albo - bez powodu - ostatnia faktura `open` / `uncollectible` / `void` po co najmniej jednej próbie obciążenia; karencja trwa | uprawnienie `active` do końca karencji                                        |
| `revoke`              | jak wyżej, karencja już minęła                                                                                                                                            | uprawnienie `canceled`, data = koniec karencji; organizacja Zespół zawieszona |
| `already_clamped`     | uprawnienie już nie sięga dalej niż koniec karencji                                                                                                                       | najwyżej dopisanie kotwicy albo wyczyszczenie znacznika zapłaty z dopłaty     |
| `voluntary`           | powód `cancellation_requested` (i każdy inny niż brak płatności)                                                                                                          | bez zmian                                                                     |
| `paid`                | dowód braku płatności jest, ale bieżący okres został opłacony - zaległa faktura zapłacona po anulowaniu (patrz niżej); nie dotyczy `payment_disputed`                     | bez zmian (bez kotwicy, przycięcia i zawieszenia zespołu)                     |
| `no_evidence`         | brak powodu, faktura opłacona albo bez próby obciążenia                                                                                                                   | bez zmian                                                                     |
| `refunded`            | uprawnienie po zwrocie (stan ostateczny)                                                                                                                                  | bez zmian, bez pytania operatora                                              |
| `stripe_missing`      | operator nie zna subskrypcji (`resource_missing`)                                                                                                                         | pominięta                                                                     |
| `stripe_not_canceled` | u operatora subskrypcja nie jest anulowana (rozjazd stanu - patrz /admin/billing-reconcile)                                                                               | pominięta                                                                     |
| `error`               | błąd odczytu u operatora albo zapisu                                                                                                                                      | bez zmian w tym wierszu, partia idzie dalej                                   |

**Okres opłacony po anulowaniu** (`paid`). Operator zostawia powód
`payment_failed` także wtedy, gdy klient zapłacił zaległą fakturę już po
anulowaniu (link z maila windykacyjnego, zapłata oznaczona poza operatorem).
Taki klient zapłacił za cały okres i dostępu nie traci. Dowodem zapłaty jest
którekolwiek z dwóch (`periodPaymentProof`):

- ostatnia faktura `paid` ze znacznikiem `status_transitions.paid_at` i realną
  kwotą (`amount_paid > 0` - od API Basil obejmuje też zapłatę poza operatorem,
  `amount_paid_off_stripe > 0`, `amount_due = 0`; `paid_out_of_band` czytamy
  już tylko z ładunków sprzed Basil, przypięta wersja dahlia go nie zwraca),
  o ile nie jest to dopłata za zmianę w trakcie okresu (`billing_reason`
  `subscription_update` - ta nie spłaca odnowienia, jak w windykacji) - w
  raporcie `invoice`,
- opłacona faktura OKRESU w historii operatora: `invoices.list` z
  `subscription`, `status: "paid"` i `created >= początek okresu - 1 h` (zapas na
  znacznik faktury odnowienia), strony automatycznie, najwyżej 300 faktur.
  Liczy się `billing_reason` `subscription_cycle` albo `subscription_create`,
  a `subscription_update` wyłącznie wtedy, gdy ta dopłata OTWORZYŁA bieżący
  okres: zmiana interwału (samoobsługowy upgrade z miesięcznego na roczny idzie
  przez `always_invoice`, operator resetuje okres i obciąża za cały nowy) ma
  pozycję subskrypcji bez proraty, która zaczyna się z początkiem okresu
  (± 120 s). Zwykła dopłata za resztę okresu (same proraty od chwili zmiany)
  i faktura ręczna (`manual`) - nigdy. Warunki zapłaty jak wyżej; reguła
  powodu jest wspólna z windykacją (`billingReasonPaysPeriod` w
  `accessPeriod.ts`). W raporcie `ledger` (etykieta „opłacona faktura okresu
  u operatora"). Historię czytamy tylko dla wierszy, które bez dowodu zostałyby
  przycięte (dowód braku płatności, nie spór, ostatnia faktura bez dowodu
  zapłaty, znany początek okresu).

`subscriptions.last_payment_at` dowodem NIE jest. Dawna windykacja przesuwała
go przy KAŻDEJ zapłacie, także opłaconej dopłacie za upgrade w trakcie okresu,
gdy porażka odnowienia nie dotarła (brak licznika) - więc wiersz z nieopłaconym
odnowieniem wyglądał na opłacony i zostawał z rokiem dostępu. Odwrotnie: przy
zgubionym `invoice.paid` znacznik jest stary, choć klient zapłacił. Od tej
zmiany `applyPaymentRecoveredEffects` przesuwa `last_payment_at` wyłącznie przy
zapłacie za okres (ta sama lista co wyżej; bez `billing_reason` - sesja
checkout, stary dziennik - jak dotąd). Dawne wiersze, które zadanie przycina,
porządkuje ono samo (patrz „Trwałość decyzji").

Błąd operatora przy historii faktur (albo historia ponad limit bez faktury
okresu) to wiersz `error` bez zapisów - brak odpowiedzi nie jest dowodem braku
zapłaty. Spór o płatność (`payment_disputed`) dotyczy faktury opłaconej, więc
tam zapłata niczego nie dowodzi i obowiązuje karencja.

**Kotwica karencji** (ta sama kolejność co w webhooku `handleCanceled`):
zapisana `first_payment_failed_at` → chwila pierwszej próby obciążenia
nieopłaconej faktury (`status_transitions.finalized_at`, inaczej `created`) →
początek okresu. Nowa kotwica nigdy nie jest późniejsza niż `ended_at`
subskrypcji. Gdy wiersz jej nie miał, zostaje zapisana - z niej liczy karencję
dobowy `suspendTeamsPastPaymentGrace` i kolejne przebiegi tego zadania.

**Uprawnienie** dostaje semantykę `syncEntitlementState` dla anulowania:
status z `mapProviderStatus("canceled", koniec karencji)`, zapisane
`canceled_at` zostaje (brak - „teraz"), `refunded` nietykalne. Zapis jest
warunkowy: wyłącznie wiersze `active` tego najemcy z datą późniejszą niż koniec
karencji (albo bez daty). Przycinany jest każdy taki wiersz klucza, także
duplikat.

**Plan Zespół** (cena za miejsce): organizacja tego samego najemcy, której
karencja minęła (`subscriptionGrantsTeamAccess`), przechodzi z `active` na
`suspended`. Trwającą karencję domknie dobowy przebieg - po zapisaniu kotwicy
rozpoznaje to anulowanie jako koniec windykacji.

**Trwałość decyzji.** Zapisana kotwica to ślad, który widzi webhook. Każde
kolejne `customer.subscription.deleted` - przycisk synchronizacji rozliczeń
klienta (`syncMyBillingFromProvider` buduje syntetyczne zdarzenie z czasem
„teraz"), odtworzenie zdarzenia, remis rozstrzygany żywym stanem - przechodzi
przez `handleCanceled`, a spóźnione zdarzenie przy anulowanej subskrypcji
wyrównuje uprawnienie stanem z API (`resyncFromProvider`). Oba liczą dostęp
jedną regułą (`cancellationAccess`), która dla anulowania **bez powodu**
z zapisaną kotwicą i bez zapłaty za bieżący okres przyjmuje `payment_failed`
(`effectiveCancellationReason`), czyli liczy tę samą karencję co zadanie,
zamiast oddać dostęp do końca nieopłaconego okresu. Zapłata za okres
(`paymentCoversPeriod`, czyli `last_payment_at` nie wcześniejszy niż początek
okresu) to wnioskowanie znosi - dlatego dawny znacznik z dopłaty w okresie
cofnąłby przycięcie przy pierwszym kliknięciu synchronizacji. Zadanie przy
decyzji braku płatności na sprawdzonej historii (brak opłaconej faktury
okresu) czyści `last_payment_at` z bieżącego okresu: zapis warunkowy na
zaobserwowanej wartości (`eq("last_payment_at", odczytana)`), PRZED kotwicą
i przycięciem. Chybienie znaczy, że w trakcie przebiegu zaksięgowano zapłatę
za okres - wiersz kończy się `error` bez zapisów i rozstrzyga go kolejny
przebieg. Dla czytelników znacznika `null` działa jak prawdziwa chwila
poprzedniej zapłaty za okres (sprzed jego początku): `paymentCoversPeriod` -
`false`, strażnik spóźnionej porażki przepuszcza porażki z okresu, `neverPaid`
w `handleCanceled` wymaga statusu sprzed aktywacji. Prawdziwa zapłata
odnowienia po anulowaniu zapisze nowy znacznik i kolejna synchronizacja odda
dostęp do końca okresu, jak dotąd.

## Czego nie robi

- Nie wydłuża dostępu. Organizacji zawieszonej przez stary kod w chwili
  anulowania nie wznawia, choć karencja mogłaby jeszcze trwać.
- Nie wysyła maili, nie rusza CRM ani dzwonka - skutki anulowania wyszły przy
  starym webhooku.
- Nie zmienia `subscriptions.current_period_end` (to data operatora) ani niczego
  u operatora - operatora tylko czyta.
- Nie obejmuje subskrypcji nigdy nieopłaconych (`incomplete`) anulowanych ręcznie
  z powodem `cancellation_requested` - powód operatora mówi „rezygnacja", więc
  zadanie trzyma się reguły „rezygnacja bez zmian".

## Jak uruchomić

1. Zaloguj się jako **operator platformy**: `super_admin` w najemcy domyślnym,
   sesja potwierdzona drugim składnikiem (`aal2`). Admin najemcy dostaje odmowę
   bramki `requirePlatformAdmin` - zadanie obejmuje wszystkich najemców
   środowiska.
2. Wejdź na **/admin/billing**, karta **„Dawne anulowania za brak płatności"**.
3. **Symulacja** (`dry_run`, domyślnie) - czyta bazę i operatora, niczego nie
   zapisuje. Przejrzyj liczniki i tabelę decyzji, szczególnie `clamp` /
   `revoke` (daty „Dostęp przed" → „Dostęp po") oraz `error`.
4. **Zastosuj** → potwierdzenie → przebieg `apply`. Karta pokazuje zapisy:
   kotwice, wyczyszczone znaczniki zapłaty z dopłat, uprawnienia, zespoły.
5. Jeden przebieg przechodzi do 40 partii (2000 wierszy `subscriptions`). Gdy
   lista jest dłuższa albo przebieg przerwał błąd, przycisk **Kontynuuj** rusza
   od kursora z ostatniej partii, w tym samym trybie.
6. Uruchom **Zastosuj** drugi raz: poprawny wynik to zero zapisów (decyzje
   `already_clamped` albo brak kandydatów). Wiersze `error` z pierwszego
   przebiegu są wtedy ponawiane.

Środowisko rozstrzyga serwer: w produkcji zawsze `live`
(`resolveEnvironment`), poza produkcją `sandbox`, o ile ładunek nie mówi
inaczej. Każda partia `apply` zostawia w logu serwera wpis
`[billing] legacy non-payment reconcile apply` (kto, środowisko, kursor) i
`[billing] legacy non-payment reconcile batch` (liczniki i zapisy).

Dlaczego panel, a nie skrypt w `scripts/`: klucze operatora idą przez bramkę
konektorów platformy i istnieją wyłącznie w środowisku wykonawczym Workera,
a skrypt potrzebowałby dodatkowo klucza `service_role` na maszynie operatora.
Funkcja serwerowa ma oba w środowisku wdrożenia i stoi za tą samą bramką co
synchronizacja katalogu i ręczne przypomnienia.

## Sprawdzenie po zastosowaniu (tylko odczyt)

```sql
-- Anulowane subskrypcje, których uprawnienie nadal sięga dalej niż karencja
-- liczona z zapisanej kotwicy. Po zastosowaniu: wyłącznie rezygnacje klientów
-- (bez kotwicy) albo wiersze, których zadanie nie mogło rozstrzygnąć.
SELECT s.tenant_id, s.provider_subscription_id, s.first_payment_failed_at,
       us.current_period_end
  FROM public.subscriptions s
  JOIN public.user_subscriptions us
    ON us.external_ref = s.provider_subscription_id
   AND us.tenant_id = s.tenant_id
 WHERE s.status = 'canceled'
   AND s.first_payment_failed_at IS NOT NULL
   AND us.status = 'active'
   AND (us.current_period_end IS NULL
        OR us.current_period_end > LEAST(
             s.first_payment_failed_at + interval '14 days',
             COALESCE(s.current_period_end, 'infinity'::timestamptz)));
```

Uwaga: anulowanie z kotwicą, ale z powodem `cancellation_requested` (klient
zrezygnował w trakcie windykacji), zostaje z dostępem do końca okresu - tak samo
jak w bieżącym webhooku - i może się w tym zapytaniu pojawić.

## Ryzyka i decyzje do podjęcia

- **Komunikacja.** Klienci objęci `clamp` / `revoke` dostali kiedyś mail starego
  kodu „dostęp do końca opłaconego okresu". Zadanie odbiera dostęp po cichu;
  jeśli to potrzebne, komunikat wysyła się osobno (lista: tabela decyzji).
- **Zapłata po anulowaniu w bieżącym webhooku.** `invoice.paid` dla subskrypcji
  już anulowanej zapisuje zapłatę, ale nie przelicza uprawnienia, a ponowne
  `deleted` z powodem `payment_failed` nadal liczy karencję (reguła z PR #495).
  Zadanie takich wierszy nie rusza (`paid`), ale ich nie naprawia - to osobna
  zmiana ścieżki webhooka.
- **Wyczyszczony `last_payment_at`.** Zadanie zeruje znacznik zapłaty tylko
  w wierszach, które samo przycina (albo już przycięte) na sprawdzonej
  historii bez opłaconej faktury okresu, i tylko gdy znacznik leży w bieżącym
  okresie. Prawdziwej chwili poprzedniej zapłaty za okres nie odtwarza (wymagałoby
  to kolejnego zapytania o historię sprzed okresu) - `null` daje tym samym
  czytelnikom ten sam wynik. Po zastosowaniu takich wierszy jest tyle, ile
  „wyczyszczonych znaczników" w podsumowaniu karty.
- **Dwa żądania na kandydata.** Wiersze, które bez dowodu zostałyby przycięte,
  pytają operatora drugi raz (historia faktur) - partia 100 to do ~200 żądań
  sekwencyjnie. Przy przekroczeniu czasu żądania zmniejsz partię.
- **Dokładność kotwicy.** Pierwsza próba obciążenia to finalizacja faktury
  (pobór automatyczny). Faktura zapłacona ręcznie albo przelewem nie ma prób,
  więc nie jest dowodem - wtedy rozstrzyga wyłącznie powód operatora.
- **Sprzątanie.** Po zastosowaniu w produkcji kartę i moduły można usunąć
  osobnym PR-em; reguła na przyszłość żyje w webhooku i `accessPeriod.ts`.
