# Wdrożenie: braki modułu Wydarzeń, część 3 (2026-09-26)

Pięć rzeczy, które część 2 (PR #405) zostawiła jako „poza zakresem", plus
poprawki z przeglądu części 2. Jedna migracja, zmiany serwera i frontu, harness
na każdą gałąź SQL.

## 1. Zastosowanie migracji na produkcji (PRZED wdrożeniem kodu)

W panelu Lovable, po 0059–0061 z części 2 (Lovable zapisał ich zastosowanie
jako drizzle 0062–0064, wpisy `drizzleOnly` w `MIGRATION_LANES`):

- `supabase/migrations/20260926150000_event_registration_gaps_part3.sql`
  (bliźniak `drizzle/migrations/0065_event_registration_gaps_part3.sql`)

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
  Bez pg_cron migracja kończy się komunikatem NOTICE, a bilety porzuconych kas
  wracają do puli tylko przy zmianie zgłoszenia.

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
4. **Pojedyncze zgłoszenie z biletem z puli** - patrz sekcja 4 niżej.
5. **Wpłata Stripe przy wyczerpanej puli** - patrz sekcja 4 niżej.

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

## 5. Poza zakresem

- Zamknięcia pojedynczego gościa (organizator odrzuca albo anuluje jednego
  gościa, gość wycofuje się sam, zwrot na wierszu gościa) nie wysyłają
  zawiadomienia - to decyzja o jednym wierszu, a nie o grupie.
- Brak zawiadomień wstecz dla grup odwołanych przed tą migracją (znacznik
  wysłanego biletu został już skasowany).
- Wydarzenia mieszane (stara cena w wierszu wydarzenia i cennik etapu 4):
  ponowne zajęcie zwolnionego biletu ścieżką RSVP zostawia go przypiętym do
  zgłoszenia.
