# Odrzucona dopłata opłacona później - harmonogram po `pending_update_applied` (2026-10-13)

Domknięcie luki po regule z PR #495 (przegląd #9/#41, audyt SUB-04): odrzucona
dopłata za zmianę natychmiastową **nie kasuje** zaplanowanej wcześniej zmiany.
Kod: `src/lib/billing/stripeEvents.server.ts` (mapowanie zdarzeń),
`src/lib/billing/webhookDispatch.server.ts` (gałąź
`subscription.pending_update_applied`),
`src/lib/billing/subscriptionProvider.server.ts`
(`reconcileScheduleWithAppliedUpdate`).

## Po co

Upgrade planu i dołożenie miejsc idą z `payment_behavior:
"pending_if_incomplete"`. Gdy karta odmówi, operator zostawia zmianę jako
oczekującą (`pending_update`), a my celowo **zachowujemy** dołączony
harmonogram (zaplanowany downgrade, zmniejszenie miejsc) - odnowienie ma pójść
po cenie, na którą klient się umówił.

Klient może jednak zapłacić odrzuconą fakturę później, w oknie oczekującej
zmiany (~23 h), np. inną kartą ze strony faktury. Operator stosuje wtedy zmianę
sam i wysyła `customer.subscription.pending_update_applied`: subskrypcja jest na
nowej cenie / liczbie miejsc, ale zachowany harmonogram na koniec okresu
zastosowałby STARĄ decyzję - klient płaciłby mniej, niż wybrał, a plan po cichu
spadałby przy odnowieniu.

## Co robi

1. `customer.subscription.pending_update_applied` mapuje się na
   `subscription.pending_update_applied`: zwykły `SubscriptionData` plus
   `scheduleId` - harmonogram dołączony **w chwili zastosowania**.
2. Dyspozytor najpierw rozstrzyga harmonogram u operatora (klient środowiska
   zdarzenia, żywy stan), potem stosuje stan tym samym strażnikiem kolejności
   co każde `subscription.updated` (`claimSubscriptionEvent`, remis
   rozstrzygany żywym stanem).
3. Decyzja na następnej fazie harmonogramu (para pozycja-pozycja):

| Następna faza                                                  | Skutek                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| niższy plan (ranga `BILLING_CATALOG`)                          | `released` - zwolnienie (`schedule-release`, klucz z id)         |
| ta sama cena, mniej miejsc niż opłacono                        | `released`                                                       |
| inna, nie niższa cena (panel, migracja cennika), mniej miejsc  | `rewritten` - cena zostaje, ilość = opłacona                     |
| wyższy plan, tyle samo albo więcej miejsc, kształt nieczytelny | `kept` - bez zmian                                               |
| w migawce brak harmonogramu albo dziś steruje inny / żaden     | `not_attached` - bez zmian (bez migawki - bez pytania operatora) |
| pozycje u operatora już nie te z migawki                       | `superseded` - bez zmian                                         |

4. Błąd operatora (odmowa, zgubiona odpowiedź) **rzuca**: trasa odpowiada 500,
   zdarzenie w dzienniku zostaje `failed`, operator je ponawia. Ponowienie czyta
   żywy stan od nowa - zwolnienie, które jednak weszło, nie idzie drugi raz, a
   znacznik strażnika nie jest zajęty, więc lustro też się domyka.

`customer.subscription.pending_update_expired` (zmiana wygasła bez zapłaty) to
zwykła migawka stanu (`subscription.updated` / `past_due` / `paused` jak przy
`customer.subscription.updated`): pozycje zostały stare, a harmonogram jest
dokładnie tym, na co klient się umówił.

## Konfiguracja operatora (wymagana)

Punkt odbioru webhooków (`/api/public/payments/webhook?env=live` i
`?env=sandbox`) musi subskrybować:

- `customer.subscription.pending_update_applied` - **wymagane**; bez niego
  harmonogram zachowany przy odmowie przeżyje opłacenie faktury i cofnie
  upgrade / dołożone miejsca przy odnowieniu,
- `customer.subscription.pending_update_expired` - opcjonalne (tylko lustro
  stanu).

Pozostałe zdarzenia bez zmian (m.in. `invoice.paid` / `invoice.payment_succeeded`,
`charge.dispute.closed`, `refund.failed`).

## Ryzyka i ograniczenia

- **Spóźniona dostawa i przepisany TEN SAM harmonogram.** Działamy tylko na
  harmonogramie z migawki i tylko przy niezmienionych pozycjach, więc
  harmonogram założony po zastosowaniu zmiany zostaje. Gdy jednak klient
  między zastosowaniem a (spóźnioną) obsługą zdarzenia przepisał fazy tego
  samego harmonogramu, nie odróżnimy tego - operator nie podaje, kiedy
  zmieniono fazy. Okno istnieje tylko przy ponowieniu po błędzie.
- **Zapamiętany błąd 5xx.** Klucz zwolnienia jest deterministyczny (id
  harmonogramu), a operator pamięta pod kluczem także 5xx przez dobę - takie
  ponowienia dostaną ten sam błąd, aż klucz wygaśnie (operator ponawia
  zdarzenie do 3 dni). Odmowa sprzed wykonania (limit zapytań) i zgubiona
  odpowiedź nie są tym dotknięte.
- **Uzgodnienie (`reconcile.server.ts`)** nie zna jeszcze typu
  `customer.subscription.pending_update_applied` (`SUPPORTED_EVENT_TYPES`) -
  zgubione zdarzenie nie pokaże się w panelu jako naprawialne.
- **Cena spoza katalogu** w następnej fazie nie ma rangi: przy tej samej lub
  większej liczbie miejsc harmonogram zostaje (nie zwalniamy na domysł).
