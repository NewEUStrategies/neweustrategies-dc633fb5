# Wdrożenie: braki modułu Wydarzeń, część 3 (2026-09-26)

Pięć rzeczy, które część 2 (PR #405) zostawiła jako „poza zakresem", plus
poprawki z przeglądu części 2. Jedna migracja, zmiany serwera i frontu, harness
na każdą gałąź SQL.

## 1. Zastosowanie migracji na produkcji (PRZED wdrożeniem kodu)

W panelu Lovable, PO migracjach modułu organizatora (PR #404, do
`20260926170000_event_clone`) i funkcji uczestnika (PR #406,
`20260926153100`–`20260926153300`):

- `supabase/migrations/20260926180000_event_registration_gaps_part3.sql`
  (bliźniak `drizzle/migrations/0067_event_registration_gaps_part3.sql`;
  drizzle 0065–0066 to zapis zastosowania z Lovable po PR #404)

Numer `20260926180000` jest celowo PÓŹNIEJSZY niż `20260926153200`
(naprawy D0-2 funkcji uczestnika): obie migracje redefiniują
`payments_apply_event_ticket_outcome` i `_event_apply_outcome_to_group`,
a ostatnia definicja wygrywa. Ciała w części 3 niosą więc także naprawy
D0-2 (pełny zwrot czyści kod QR i zwalnia zapisy na sesje, zakładki i starszą
rezerwację RSVP - na tym polega `refunds.server.ts` od PR #406). Zastosowanie
części 3 PRZED `20260926153200` cofnęłoby część 3 w tych dwóch funkcjach.

Jeśli Lovable znów zapisze zastosowanie jako kolejny plik drizzle, trzeba go
dopisać do `MIGRATION_LANES` jako `drizzleOnly` z bliźniakiem wskazanym
w opisie - inaczej bramka pasów migracji zgłosi `brak-wpisu`.

Migracja przy zastosowaniu (jednorazowo, bez żadnej poczty):

- wiąże bilety z puli planu z zgłoszeniami po zamówieniach z benefitem
  `included` i od razu zwalnia bilety porzuconych albo zamkniętych kas
  (`_event_plan_seat_link_backfill()`);
- stawia znacznik wysłanego biletu zgłoszeniom przyjętym i zwróconym
  częściowo, które go nigdy nie miały (ta sama reguła, co w 20260923110000) -
  cron nie wyśle biletu i nie zrotuje kodu komuś, kto swój kod już ma;
- zakłada zadanie pg_cron `event-plan-seat-release` (co godzinę, minuta 17).
  Ten sam przegląd woła też `community-cron` (job `event-ticket-codes`,
  scheduler repo co 5 minut), więc baza bez pg_cron nie zostawia biletów
  porzuconych kas zajętych - migracja kończy się wtedy komunikatem NOTICE.

Kod bez migracji działa: krok crona zawiadomień odpowiada
`skipped: "migration_pending"` (bez czerwonego ticku), a bez migracji nie ma
też znaczników do wysłania.

## 2. Co się zmienia

1. **Goście odwołanej grupy dostają maila.** Gość, do którego bilet dotarł
   (albo był w drodze), dostaje `event_ticket_revoked`, gdy grupa zostaje
   odwołana: odrzucenie albo anulowanie prowadzącego przez organizatora,
   samodzielne wycofanie prowadzącego, zwrot (Stripe albo ręczny). Znacznik
   (`ticket_revoked_at`) stawia baza w tej samej instrukcji, która zamyka
   gościa; mail wysyła cron (`jobs-tick` i `community-cron`, job
   `event-ticket-codes`) przez `sendTxEmail` - z listą wykluczeń
   i idempotencją per odwołanie. Bez maila: gość czekający albo nieopłacony
   (nic od nas nie dostał), gość z `notify_email = false`, wydarzenie już po
   terminie, gość przywrócony na miejsce (czeka na nowy bilet). Mail nie niesie
   uzasadnienia organizatora - dotyczy ono prowadzącego.
2. **Zwrot za grupę awansuje kolejkę także za miejsca gości.** Każdy
   opłacony i przyjęty gość anulowany zwrotem zwalnia miejsce, a kolejka
   awansuje osobno dla każdej wejściówki - po zamknięciu grupy i z pominięciem
   jej własnych gości. Awansowani czekają w panelu na powiadomienie, a bilet
   dostają z crona. Każdy awans kasuje też `waitlist_notified_at`, więc wiersz
   awansowany drugi raz znów pokazuje plakietkę „czeka na powiadomienie".
3. **Bilet z puli planu wraca do puli.** Bilet zajęty w kasie dla miejsca
   prowadzącego należy teraz do zgłoszenia (`plan_ticket_claims.registration_id`)
   i wraca do puli, gdy zgłoszenie go nie potrzebuje: odwołanie, odrzucenie,
   pełny zwrot, nieudana płatność odroczona, kasa porzucona (sesja Stripe
   wygasa po 24 h, przegląd co godzinę) albo przerwana przed zamówieniem.
   Ponowne przyjęcie opłaconego zgłoszenia przywraca bilet (bez sprawdzania
   puli - to zamówienie już go zużyło). Członek nie zwolni sam biletu, który
   trzyma zgłoszenie (to zamykało nadużycie z części 2: zwolnienie po
   opłaceniu dawało darmowe miejsce i pełną pulę); administrator zwalnia
   i odpina bilet od zgłoszenia.
4. **Pojedyncze zgłoszenie z biletem z puli** i 5. **wpłata Stripe przy
   wyczerpanej puli** - sekcja 4 niżej.

## 3. Poprawki z przeglądu części 2

- Zwrot Stripe biletu: status anulowanego udziału w `event_rsvps` to
  `cancelled` (była literówka `canceled`, której CHECK tabeli nie dopuszcza -
  każdy pełny zwrot biletu rzucał, a webhook ponawiał bez końca).
- Goście zwróceni częściowo, zamknięci razem z prowadzącym, wracają z nim
  przy ponownym przyjęciu; zwrot częściowy nie blokuje już wydania biletu ani
  ponownej wysyłki (panel pokazuje przy nich plakietkę i przycisk jak przy
  opłaconych).
- Zamówienie pakietu: zmiana statusu blokuje kod PRZED zamówieniem (koniec
  zakleszczenia z kasowaniem kodu), a anulowanie stawia zatrzask tylko wtedy,
  gdy naprawdę oddało użycie.
- Kasa: pozycja „N × cena" tylko przy równych cenach miejsc; kod rabatowy
  przed „Benefit planu" w nazwie rabatu Stripe (limit 40 znaków); ceny miejsc
  i rabat na miejsce w metadanych zamówienia w walucie zamówienia.
- Kasa zgłoszenia: kod dostępu wpisany po odmowie jedzie do kasy także po
  kliknięciu „Zapłać"; pole kodu nie znika w trakcie sprawdzania (fokus
  zostaje); podgląd pyta bazę raz na montaż, od razu z kodami z pamięci karty.

## 4. Bilet z puli dla pojedynczego zgłoszenia i wpłata przy wyczerpanej puli

**Odbiór biletu z planu (pozycja 4).** Pojedyncze zgłoszenie członka z biletem
w puli dostaje w kasie „Odbierz bilet z planu" zamiast płatności. Baza
sprawdza zgłoszenie, termin, okno sprzedaży, akceptację i wolne miejsce, zdejmuje
bilet z puli tą samą regułą, co kasa grupowa, i przyjmuje zgłoszenie (`paid` bez
zamówienia, `approved`). Bilet z kodem QR wychodzi od razu; cron domyka nieudaną
wysyłkę. Brak miejsca to odmowa bez zużycia biletu. Zgłoszenie, które wymaga
akceptacji organizatora, czeka na nią (odmowa „czeka na akceptację") - po
przyjęciu przez organizatora odbiór przechodzi. Odwołanie oddaje bilet do puli,
a ponowne przyjęcie go przywraca (`plan_ticket_claims.redeemed_at`). Pojedyncze
miejsce, któremu pula biletu nie odda, płaci teraz cenę (ze zniżką stawki, jeśli
jest), zamiast kończyć się odmową.

**Wpłata przy wyczerpanej puli (pozycja 5).** Wpłata Stripe liczy miejsce pod
blokadą wydarzenia i wejściówki (koniec wyścigu dwóch webhooków o ostatnie
miejsce):

- miejsce jest - zgłoszenie przyjęte, bilet z kodem QR jak dotąd;
- miejsca nie ma - wpłata zaksięgowana, zgłoszenie czeka **opłacone** na liście
  rezerwowej i awansuje samo, gdy miejsce się zwolni (bilet przychodzi wtedy
  z crona). Kupujący dostaje „Płatność przyjęta - lista rezerwowa" (bez
  potwierdzenia „miejsce zarezerwowane" i bez RSVP), organizator - dzwonek
  w panelu i plakietkę „Opłacone - czeka na miejsce";
- bilet albo przepływ z akceptacją - wpłata nie jest już akceptacją: zgłoszenie
  zostaje `pending` opłacone („Płatność przyjęta - czeka na decyzję"), organizator
  dostaje dzwonek i plakietkę „Opłacone - czeka na decyzję". **Zmiana
  zachowania:** do tej pory wpłata Stripe przyjmowała takie zgłoszenie bez
  organizatora;
- wpłata na zgłoszenie odwołane albo odrzucone - kupujący nie dostaje już
  fałszywego „Bilet opłacony"; organizator dostaje dzwonek „do zwrotu";
- goście prowadzącego bez miejsca są tylko rozliczani, a przyjmuje ich kaskada,
  gdy prowadzący wejdzie na miejsce.

Webhook ponawia księgowanie raz przy zakleszczeniu (SQLSTATE `40P01`, `40001`).
Zamówienia etapu 4 (z `registration_id`) nie przechodzą już przez
`refundIfOversold` - o miejscu decyduje baza, a tamta ścieżka liczyła RSVP
zamiast zgłoszeń.

**Ofiary sprzed poprawki.** Wpłaty, które wywróciły się na pełnej puli przed tą
migracją, zostawiły zgłoszenie `unpaid` przy opłaconym zamówieniu. Do wglądu
(NIE uruchamiać automatycznie - naprawa wysyła maile):

```sql
SELECT o.id, o.tenant_id, o.paid_at, r.id AS registration_id, r.status
FROM payment_orders o
JOIN event_registrations r
  ON r.id = (o.metadata->>'registration_id')::uuid AND r.tenant_id = o.tenant_id
WHERE o.status = 'paid'
  AND o.metadata->>'registration_id' ~ '^[0-9a-fA-F-]{36}$'
  AND r.payment_status = 'unpaid';
```

Zalecana naprawa: ponowne wysłanie zdarzenia z panelu Stripe - przejdzie wtedy
cała ścieżka z właściwymi mailami. Decyzja właściciela.

**Kolejność wdrożenia.** Migracja i kod w jednym oknie (najpierw migracja).
Kod na starej bazie działa (brak nowych pól w odpowiedzi = zachowanie
dotychczasowe; brak funkcji odbioru = czytelna odmowa), stara baza z nowym
kodem - również.

## 5. Poza zakresem

- Zamknięcia pojedynczego gościa (organizator odrzuca albo anuluje jednego
  gościa, gość wycofuje się sam, zwrot na wierszu gościa) nie wysyłają
  zawiadomienia - to decyzja o jednym wierszu, a nie o grupie.
- Brak zawiadomień wstecz dla grup odwołanych przed tą migracją (znacznik
  wysłanego biletu został już skasowany).
- Zwrot przy odrzuceniu opłaconego zgłoszenia czekającego na akceptację nie
  jest automatyczny - organizator zwraca płatność sam (mail to zapowiada).
- Kupujący awansowany z kolejki opłaconej nie dostaje RSVP „going" (dotyczy
  tylko linku dołączenia do wydarzeń online w warstwie społeczności).
- Wydarzenia mieszane (stara cena w wierszu wydarzenia i cennik etapu 4):
  ponowne zajęcie zwolnionego biletu ścieżką RSVP zostawia go przypiętym do
  zgłoszenia.
