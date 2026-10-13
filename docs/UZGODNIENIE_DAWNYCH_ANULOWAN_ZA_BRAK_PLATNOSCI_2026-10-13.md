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
naraz) i decyduje:

| Decyzja               | Kiedy                                                                                                                                                                     | Skutek                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `clamp`               | powód `payment_failed` / `payment_disputed` albo - bez powodu - ostatnia faktura `open` / `uncollectible` / `void` po co najmniej jednej próbie obciążenia; karencja trwa | uprawnienie `active` do końca karencji                                        |
| `revoke`              | jak wyżej, karencja już minęła                                                                                                                                            | uprawnienie `canceled`, data = koniec karencji; organizacja Zespół zawieszona |
| `already_clamped`     | uprawnienie już nie sięga dalej niż koniec karencji                                                                                                                       | najwyżej dopisanie kotwicy                                                    |
| `voluntary`           | powód `cancellation_requested` (i każdy inny niż brak płatności)                                                                                                          | bez zmian                                                                     |
| `no_evidence`         | brak powodu, faktura opłacona albo bez próby obciążenia                                                                                                                   | bez zmian                                                                     |
| `refunded`            | uprawnienie po zwrocie (stan ostateczny)                                                                                                                                  | bez zmian, bez pytania operatora                                              |
| `stripe_missing`      | operator nie zna subskrypcji (`resource_missing`)                                                                                                                         | pominięta                                                                     |
| `stripe_not_canceled` | u operatora subskrypcja nie jest anulowana (rozjazd stanu - patrz /admin/billing-reconcile)                                                                               | pominięta                                                                     |
| `error`               | błąd odczytu u operatora albo zapisu                                                                                                                                      | bez zmian w tym wierszu, partia idzie dalej                                   |

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
   kotwice, uprawnienia, zespoły.
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
- **Dokładność kotwicy.** Pierwsza próba obciążenia to finalizacja faktury
  (pobór automatyczny). Faktura zapłacona ręcznie albo przelewem nie ma prób,
  więc nie jest dowodem - wtedy rozstrzyga wyłącznie powód operatora.
- **Sprzątanie.** Po zastosowaniu w produkcji kartę i moduły można usunąć
  osobnym PR-em; reguła na przyszłość żyje w webhooku i `accessPeriod.ts`.
