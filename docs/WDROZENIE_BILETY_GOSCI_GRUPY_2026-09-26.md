# Wdrożenie: goście grupy dostają własny bilet - notatka operacyjna

**Data:** 2026-09-26
**Zgłoszenie:** „goście rejestracji grupowej nie dostają biletów z kodem QR po zatwierdzeniu prowadzącego".
**Migracja:** `supabase/migrations/20260926100000_event_group_guests_follow_lead.sql`
(bliźniak: `drizzle/migrations/0055_event_group_guests_follow_lead.sql`, bajt w bajt)
**Harness:** `scripts/events-harness/runtime_test.d/27_group_follow_lead.sql`

Migracja naprawia DROGĘ: od wdrożenia zatwierdzenie prowadzącego i jego ręczna
wpłata przyjmują gości (z kontrolą miejsc), a każdy gość dostaje osobny mail
z biletem. Migracja NIE rusza grup, które utknęły PRZED wdrożeniem - to dwa
kroki operacyjne poniżej. Oba kończą się mailami do prawdziwych ludzi, więc
migracja nie robi ich sama.

---

## 1. Zastosowanie migracji na produkcji (PRZED wdrożeniem frontu)

Produkcja jest aplikowana z pasa Lovable/drizzle. Zastosuj z panelu Lovable
`0055_event_group_guests_follow_lead.sql`, a PO NIM
`0056_event_package_coupon_per_seat.sql` (kolejność: 0055, potem 0056).

Migracja ma strażnika: bez obiektów `20260923110000_event_ticket_group_codes`
(0044 - `_event_issue_ticket_codes`, kolumna `ticket_code_sent_at`) kończy się
błędem **„Brak migracji 20260923110000_event_ticket_group_codes (0044)"**. To
celowe - bez 0044 każda wysyłka biletów milczy. Najpierw 0044, potem 0055.

Kod serwera działa na bazie sprzed 0055 i po niej: udaną wysyłkę i ponowienie
potwierdza trójargumentowym `_event_ticket_code_confirm` z 0044, a wariant
z flagą `p_undeliverable` woła tylko dla adresu, na który poczta nie wyśle.

## 2. Naprawa gości uwięzionych przed wdrożeniem (RAZ, decyzja właściciela)

**Kogo dotyczy.** Grupy, w których prowadzący został przyjęty (albo oznaczony
jako obecny) PRZED wdrożeniem, a goście zostali `pending` - bo bilet wymagał
akceptacji, wydarzenie miało przepływ z akceptacją albo organizator zaksięgował
wpłatę ręcznie (przelew, gotówka). Nowe triggery odpalą dopiero przy następnej
zmianie statusu albo rozliczenia prowadzącego, a tej nie będzie: ponowne
„zatwierdź" przyjętego to `invalid_transition`, a „opłacone" wymaga
nieopłaconego. Ponowna wysyłka z panelu odmawia oczekującym gościom.

**Kiedy.** Po kroku 1, w godzinach pracy - cron wyśle maile w ciągu minuty.

**Krok 1 - podgląd** (ile grup i gości czeka; zapytanie tylko czyta):

```sql
SELECT l.tenant_id, e.slug, l.id AS lead_id, l.status AS lead_status,
       l.payment_status AS lead_payment,
       count(*) FILTER (WHERE g.status IN ('draft', 'pending', 'waitlist')) AS waiting_guests,
       count(*) FILTER (WHERE l.payment_status = 'paid' AND g.payment_status = 'unpaid'
                          AND g.status NOT IN ('cancelled', 'rejected')) AS unpaid_guests_of_paid_lead
FROM public.event_registrations l
JOIN public.events e ON e.id = l.event_id AND e.tenant_id = l.tenant_id
JOIN public.event_registrations g
  ON g.group_lead_registration_id = l.id AND g.tenant_id = l.tenant_id
WHERE l.group_lead_registration_id IS NULL
  AND l.status IN ('approved', 'attended')
  AND COALESCE(e.ends_at, e.starts_at + interval '1 day') > now()
GROUP BY l.tenant_id, e.slug, l.id, l.status, l.payment_status
HAVING count(*) FILTER (WHERE g.status IN ('draft', 'pending', 'waitlist')) > 0
    OR count(*) FILTER (WHERE l.payment_status = 'paid' AND g.payment_status = 'unpaid'
                          AND g.status NOT IN ('cancelled', 'rejected')) > 0
ORDER BY min(l.created_at);
```

**Krok 2 - naprawa** (SQL Editor, rola `postgres` albo `service_role`; klient
aplikacji nie ma do niej prawa):

```sql
SELECT public._event_group_repair_stranded_guests();
```

Co robi, dla najstarszych 500 takich grup (wydarzenia, które się jeszcze nie
skończyły):

- prowadzący **opłacony** - goście zostają rozliczeni tak, jak dziś zrobiłaby
  to ręczna wpłata (gość zachowuje własne zamówienie, jeśli je miał);
- potem goście rozliczeni są przyjmowani **z kontrolą miejsc**: wolne miejsce -
  przyjęcie i nowy kod, brak miejsca - lista rezerwowa (awansuje zwykłą drogą,
  gdy miejsce się zwolni);
- goście nieopłaconego prowadzącego czekają dalej na wpłatę.

Wynik to liczba gości, którzy w tym wywołaniu dostali prawo do biletu. Cron
(`runPendingTicketCodes`, co minutę) wyśle im maile z biletem - adresy z listy
wykluczeń poczty dostaną w panelu plakietkę „Bilet nie dotarł - adres
zablokowany".

**Krok 3 - sprawdzenie.** Drugie wywołanie oddaje `0` i niczego nie zmienia
(funkcja jest idempotentna). Jeśli podgląd z kroku 1 miał więcej niż 500 grup,
wołaj `SELECT public._event_group_repair_stranded_guests(5000);`. Grupy, w których
został już tylko gość na liście rezerwowej, podgląd pokazuje dalej - to
poprawny stan, nie błąd naprawy. Wysłane bilety widać w dzienniku poczty
(`email_send_log`, `template_name = 'event_ticket_issued'`) i na plakietkach
panelu zgłoszeń.

## 3. Wiersze ostemplowane przez backfill 0044 (RAZ, decyzja właściciela)

Backfill migracji 0044 oznaczył część biletów gości jako wysłane, choć mail nie
wyszedł. Te wiersze nie wrócą do crona same. Zapytanie zdejmuje znacznik TYLKO
tam, gdzie dziennik poczty nie ma żadnej wysyłki biletu na ten adres:

```sql
-- podgląd: zamień UPDATE ... SET na SELECT r.id, p.email FROM ...
UPDATE public.event_registrations r
SET ticket_code_sent_at = NULL,
    ticket_code_claimed_at = NULL,
    ticket_code_undeliverable_at = NULL
FROM public.event_people p, public.events e
WHERE p.id = r.person_id AND p.tenant_id = r.tenant_id
  AND e.id = r.event_id AND e.tenant_id = r.tenant_id
  AND r.group_lead_registration_id IS NOT NULL
  AND r.created_at >= '2026-09-22 22:19:57+00'
  AND r.ticket_code_sent_at IS NOT NULL
  AND r.status IN ('approved', 'attended')
  AND r.payment_status IN ('paid', 'not_required')
  AND COALESCE(e.ends_at, e.starts_at + interval '1 day') > now()
  AND NOT EXISTS (
    SELECT 1 FROM public.email_send_log l
    WHERE l.template_name = 'event_ticket_issued'
      AND lower(l.recipient_email) = lower(p.email)
      AND l.status IN ('pending', 'sent'));
```

Cron wyśle tym osobom bilety w ciągu minuty. Alternatywa bez SQL: przycisk
„Wyślij bilety całej grupie" przy prowadzącym, grupa po grupie.

## 4. Zmiany zachowania do wiadomości właściciela produktu

- Zatwierdzenie prowadzącego przyjmuje jego rozliczonych gości; gość, dla
  którego brak miejsca, staje na liście rezerwowej.
- Ręczna wpłata organizatora („opłacone" zaksięgowane przez organizatora, także
  u prowadzącego, którego wcześniejsza płatność Stripe przepadła i który nadal
  nosi to zamówienie) rozlicza gości i przyjmuje ich **z kontrolą miejsc** -
  nadmiarowy gość czeka na liście rezerwowej opłacony, zamiast wywracać
  zaksięgowanie przelewu. Wpłata idzie ścieżką Stripe tylko wtedy, gdy przynosi
  zamówienie (zmienia `payment_order_id`); ta ścieżka bez zmian.
- Odrzucenie i anulowanie prowadzącego zamyka jego czekających gości; ponowne
  zatwierdzenie ich przywraca. Gość zamknięty przez samodzielne wycofanie
  prowadzącego albo zwrot Stripe ma źródło decyzji `system`, bez autora.
- Ręczny zwrot organizatora anuluje i zwraca tylko gości, którzy zapłacili.
- Cron wysyła bilety także samodzielnym zapisom na wydarzeniach w trybie RSVP -
  po wdrożeniu dostaną je także istniejące przyjęte zapisy RSVP bez biletu.
- Ponowna wysyłka pomija adresy z listy wykluczeń poczty (ich dotychczasowy
  bilet nadal działa); pojedynczy taki wiersz kończy się odmową z powodem.

## 5. Poza zakresem tej zmiany

- Goście JUŻ przyjęci zostają przyjęci, gdy prowadzący zostaje odrzucony albo
  anulowany - ich kod QR nadal wpuszcza (decyzja produktu).
- Ścieżka Stripe gałęzi „opłacone" nie sprawdza miejsc (zamówienie opłaciło
  całą grupę naraz) - znane i przybite w harnessie (`25_payment_binding.sql`).
