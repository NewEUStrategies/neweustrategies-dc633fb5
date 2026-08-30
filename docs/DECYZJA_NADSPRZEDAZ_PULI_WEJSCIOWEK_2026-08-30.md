# Nadsprzedaż puli wejściówek - co się dzieje z pieniędzmi i cztery możliwe rozstrzygnięcia

**Data:** 2026-08-30
**Status:** DO ROZSTRZYGNIĘCIA PRZEZ ZAMAWIAJĄCEGO - to jest decyzja produktowa o pieniądzach klienta, nie refaktor.
**Defekt zarejestrowany w:** `scripts/events-harness/runtime_test.d/25_payment_binding.sql`, dwie asercje przez `pg_temp.assert_known_defect`.

---

## 1. Co dokładnie się dzieje

Pula konkretnego **typu wejściówki** (`event_ticket_types.quota`) i pojemność
**całego wydarzenia** (`events.capacity`) to dwa różne limity. Ścieżka płatności
pilnuje tylko drugiego z nich.

Przebieg, krok po kroku, przy wyczerpanej puli typu wejściówki, gdy samo
wydarzenie ma jeszcze miejsca:

| #   | Miejsce w kodzie                                            | Co robi                                               | Skutek                                                                                                                                                          |
| --- | ----------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `oneTimeFulfilment.server.ts:216` → `refundIfOversold`      | woła `assertSeatAvailable(supabase, eventId, userId)` | **przepuszcza** - `assertSeatAvailable` (`ticket.server.ts:66`) czyta wyłącznie `seatsFor(eventId)` i rzuca `event_full`; o `quota` typu wejściówki nie wie nic |
| 1   | `grantEntitlement`                                          | nadaje uprawnienie                                    | uprawnienie **przyznane**                                                                                                                                       |
| 2   | `payment_orders` UPDATE                                     | `status='paid'`, `paid_at`                            | pieniądze **zaksięgowane**                                                                                                                                      |
| 3   | `applyCouponEffectsForOrder`                                | efekty kuponu                                         | wykonane                                                                                                                                                        |
| 4   | `event_rsvps` upsert                                        | `status='going'`                                      | RSVP **potwierdzone**                                                                                                                                           |
| 5   | `applyTicketOutcome(order.id, "paid")`                      | RPC `payments_apply_event_ticket_outcome`             | RPC **RZUCA** na `event_ticket_types_sold_within_quota`                                                                                                         |
| 6   | `applyTicketOutcome`, `oneTimeFulfilment.server.ts:154-157` | `if (error) { console.error(...); return; }`          | wyjątek **połknięty** - funkcja kończy się normalnie                                                                                                            |

Stan po tym przebiegu:

- `payment_orders.status = 'paid'` - **pieniądze pobrane**,
- `event_registrations.status = 'pending'`, `payment_status = 'unpaid'`,
  `qr_token_hash IS NULL` - **wejściówki nie ma**,
- **zwrotu nie ma** - `refundIfOversold` już się wykonał i przepuścił,
- **powiadomienia nie ma** - `notifyTicketOutcome` stoi za `return` z kroku 6,
- jedyny ślad to linia `[payments] ticket outcome failed ...` w logu serwera.

Klient zapłacił, nie ma wejściówki, nikt go o tym nie zawiadomił, a organizator
dowie się o tym dopiero z reklamacji.

## 2. Dlaczego to nie jest przeoczenie w bazie

Ograniczenie `event_ticket_types_sold_within_quota` **działa poprawnie** i ma
działać dalej. To ono jest jedyną rzeczą, która nie dopuszcza do sprzedania
nieistniejącego miejsca. W uprzęży stoi obok defektu kontrapunkt, który musi
zostać zielony na zawsze:

```sql
-- KONTRAPUNKT, ktory MUSI byc zielony na zawsze: ograniczenie puli dziala.
-- Gdyby ktos "naprawil" defekt zdejmujac CHECK z `sold_count`, ta asercja
-- zapali sie na czerwono - i o to chodzi.
```

Zdjęcie CHECK-a **nie jest** żadnym z wariantów poniżej. Zamieniłoby ono
„pieniądze pobrane, brak wejściówki" na „pieniądze pobrane, wejściówka wydana,
sala za mała" - czyli problem księgowy na problem bezpieczeństwa na obiekcie.

## 3. Skąd bierze się okno wyścigu

Sprawdzenie dostępności przy tworzeniu zamówienia jest z natury nieaktualne w
chwili księgowania: między otwarciem nakładki Stripe a przyjściem webhooka
mijają minuty, w których ktoś inny może zająć ostatnie miejsce w puli. Dokładnie
z tego powodu w kodzie istnieje `refundIfOversold` - i dokładnie ten sam powód
sprawia, że **musi** on obejmować pulę typu wejściówki, a nie tylko pojemność
wydarzenia.

## 4. Cztery możliwe rozstrzygnięcia

### Wariant A - rozszerzyć `refundIfOversold` o pulę typu wejściówki

**Na czym polega.** `assertSeatAvailable` (albo nowa funkcja obok niej) czyta
także `event_ticket_types.quota` i `sold_count` dla `ticket_type_id` z metadanych
zamówienia i rzuca odrębny powód (np. `ticket_sold_out`). `refundIfOversold`
obsługuje go tak samo jak `event_full`: pełny zwrot, `payment_orders.status =
'refunded'`, mail o zwrocie.

**Za:** korzysta z mechanizmu, który już istnieje, jest przetestowany i ma
działającą ścieżkę powiadomienia. Najmniejsza zmiana. Klient dostaje pieniądze z
powrotem automatycznie, bez reklamacji.

**Przeciw:** klient przechodzi całą kasę tylko po to, żeby dostać zwrot -
z jego strony wygląda to jak awaria sklepu. Przy popularnych wydarzeniach
zwrotów może być dużo, a każdy kosztuje prowizję operatora.

**Kiedy wybrać:** gdy priorytetem jest, żeby nigdy nie powstał stan „pieniądze
bez wejściówki", a koszt prowizji od zwrotów jest akceptowalny.

### Wariant B - rezerwacja miejsca na czas sesji płatności

**Na czym polega.** Utworzenie zamówienia rezerwuje miejsce w puli na
`N` minut (osobna kolumna `reserved_until` albo wiersz w tabeli rezerwacji
wliczany do `sold_count`). Wygaśnięcie rezerwacji zwalnia miejsce.

**Za:** jedyny wariant, w którym klient, który zaczął płacić, ma **gwarancję**
wejściówki. Zero zwrotów z tytułu nadsprzedaży. To jest zachowanie, którego
kupujący oczekuje po sklepie z biletami.

**Przeciw:** największa zmiana - nowa kolumna albo tabela, zadanie sprzątające
wygasłe rezerwacje, przeliczenie `sold_count` wszędzie, gdzie jest czytany,
oraz decyzja, co zrobić z rezerwacjami przy zmianie puli przez organizatora.
Porzucone koszyki blokują miejsca do czasu wygaśnięcia, co przy krótkiej puli
realnie zmniejsza sprzedaż.

**Kiedy wybrać:** gdy wejściówki są drogie albo pula mała, a doświadczenie
kupującego jest ważniejsze niż chwilowe zablokowanie miejsc.

### Wariant C - świadoma nadsprzedaż z alertem dla organizatora

**Na czym polega.** Pula typu wejściówki przestaje być twardym limitem i
dostaje dopuszczalny naddatek (`overbook_allowance`). Przekroczenie samej puli
zapisuje zgłoszenie i **jednocześnie** zawiadamia organizatora, że sprzedał
ponad pulę.

**Za:** nikt nie traci pieniędzy ani miejsca, a organizator decyduje, co zrobić
z nadmiarem (dostawić krzesła, przenieść na inny typ wejściówki).

**Przeciw:** wymaga zdjęcia albo poluzowania CHECK-a, czyli dokładnie tego,
przed czym ostrzega kontrapunkt w uprzęży - z tą różnicą, że tutaj byłaby to
zmiana **świadoma i ograniczona** naddatkiem, a nie usunięcie zabezpieczenia.
Przenosi problem na salę: przy limitach przeciwpożarowych albo cateringu
nadsprzedaż nie jest opcją.

**Kiedy wybrać:** wyłącznie tam, gdzie limit jest handlowy, a nie fizyczny
(webinar, wydarzenie zdalne, wystawa z rotacją).

### Wariant D - minimum: przestać połykać wyjątek

**Na czym polega.** `applyTicketOutcome` nadal nie rzuca (webhook Stripe nie
może wpaść w pętlę ponowień), ale odmowę **odnotowuje** w sposób widoczny:
oznaczenie na zamówieniu (`needs_manual_review`), wpis do rejestru zdarzeń
i powiadomienie organizatora oraz kupującego zdaniem „płatność przyjęta,
wejściówka wymaga potwierdzenia - odezwiemy się w ciągu 24 h".

**Za:** najtańsze do wykonania, nie zmienia ani modelu puli, ani ścieżki
płatności. Zdejmuje najgorszą część defektu, czyli **ciszę**.

**Przeciw:** nie rozwiązuje problemu, tylko czyni go widocznym - ktoś musi
obsłużyć sprawę ręcznie. Przy wolumenie to nie skaluje.

**Kiedy wybrać:** jako natychmiastowe załatanie przed wdrożeniem A lub B, nie
zamiast nich.

## 5. Rekomendacja

**A jako rozstrzygnięcie docelowe, D wdrożone natychmiast obok niego.**

Uzasadnienie: A zamyka dziurę w pieniądzach przy najmniejszej zmianie, bo
korzysta z gotowej, przetestowanej ścieżki zwrotu. D jest potrzebne niezależnie
od wybranego wariantu, ponieważ **każde** połknięcie odmowy z
`payments_apply_event_ticket_outcome` - nie tylko to z puli - kończy się dziś
ciszą; po A wciąż zostaną inne powody odmowy (`registration_mismatch`,
`already_settled_by_another_order`, `refund_for_other_order`), które muszą być
widoczne.

B jest właściwym rozwiązaniem docelowym, jeśli moduł wydarzeń ma sprzedawać
drogie wejściówki z krótkich pul, ale to osobne zlecenie z własnym budżetem -
dotyka modelu danych, zadania sprzątającego i wszystkich odczytów `sold_count`.

C odradzam wszędzie, gdzie limit puli odzwierciedla realną pojemność sali.

## 6. Czego ta praca NIE zrobiła i dlaczego

Defekt został **zarejestrowany, nie naprawiony**. Zasada zlecenia: „Nie zmieniaj
zachowania produkcyjnego, żeby test przeszedł. Znaleziony defekt → `it.fails`
(lub failing pgTAP) z opisem". Wyjątkiem była wyłącznie CZĘŚĆ A (dowiązanie
płatności do zgłoszenia), gdzie zmiana zachowania była całym zadaniem - a to
jest znalezisko z CZĘŚCI A5, czyli z pomiaru, nie z zakresu wdrożeniowego.

Rejestracja użyła `pg_temp.assert_known_defect`, który **rzuca, gdy defekt
zniknie**:

```
DEFEKT NAPRAWIONY, USUN WPIS: <opis>
```

Dzięki temu wybór dowolnego z wariantów A-D zapali uprząż na czerwono i wymusi
usunięcie wpisu - rejestr nie zostanie sierotą po naprawie.
