# Wdrożenie: braki modułu Wydarzeń, część 2 (2026-09-26)

Sześć rzeczy, które część 1 (PR #403) zostawiła poza zakresem. Trzy migracje,
zmiany frontu i jeden test.

## 1. Zastosowanie migracji na produkcji (PRZED wdrożeniem frontu)

W panelu Lovable, **w tej kolejności**, po 0055 i 0056 z części 1 (na bazie
od `a7f9e6b` - Lovable zapisał ich zastosowanie jako drizzle 0057 i 0058,
wpisy `drizzleOnly` w `MIGRATION_LANES`):

1. `supabase/migrations/20260926120000_event_group_lead_closes_admitted_guests.sql`
   (bliźniak `drizzle/migrations/0059_event_group_lead_closes_admitted_guests.sql`)
2. `supabase/migrations/20260926130000_event_package_order_cancel_returns_coupon.sql`
   (bliźniak `drizzle/migrations/0060_event_package_order_cancel_returns_coupon.sql`)
3. `supabase/migrations/20260926140000_event_group_lead_plan_seat.sql`
   (bliźniak `drizzle/migrations/0061_event_group_lead_plan_seat.sql`)

Jeśli Lovable znów zapisze zastosowanie jako kolejne pliki drizzle (jak 0057 i
0058 dla części 1), trzeba je dopisać do `MIGRATION_LANES` jako `drizzleOnly`
z bliźniakiem wskazanym w opisie - inaczej bramka pasów migracji zgłosi
`brak-wpisu`.

Migracja 20260926130000 (0060) woła RAZ `_event_package_coupon_link_backfill()`: wiąże
jednoznaczne (1:1) użycia kodów z zamówieniami pakietów złożonymi od 0056
i oddaje użycie kodu zamówieniom JUŻ anulowanym. Funkcja nie wysyła żadnej
poczty; drugie wywołanie niczego nie zmienia.

Front bez 20260926140000 (0061) działa, ale do jej zastosowania prowadzący opłacający zgłoszenie
GOŚCIA nadal dostaje przy nim swój benefit (kasa nie zna `holder_is_caller`),
a bilet z puli planu w zamówieniu grupowym kończy się odmową puli - prowadzący
płaci wtedy za swoje miejsce jak gość.

## 2. Co się zmienia dla organizatora i uczestnika

1. **Odwołana grupa nie wpuszcza.** Odrzucenie albo anulowanie prowadzącego
   zamyka także gości JUŻ przyjętych: ich kod QR przestaje działać od razu,
   a znacznik wysłanego biletu znika. Obecność już odnotowana (`attended`,
   `no_show`) zostaje. Zwolnione miejsca gości awansują kolejkę rezerwową
   (osobno dla każdej wejściówki); awansowani czekają w panelu na
   powiadomienie, a bilet dostają z crona. Ponowne zatwierdzenie prowadzącego
   przywraca tych gości z NOWYMI kodami. Okno decyzji mówi o tym przed
   kliknięciem „Potwierdź".
2. **Stripe liczy miejsca gości.** Wpłata za grupę przyjmuje gości na wolne
   miejsca, a nadmiarowych stawia w kolejce OPŁACONYCH (awansują, gdy miejsce
   się zwolni). Wcześniej przy puli biletu całe księgowanie wpłaty padało
   (pieniądze pobrane, zgłoszenie nietknięte), a przy samej pojemności
   wydarzenia sala przepełniała się po cichu.
3. **Kod dostępu wejściówki.** Formularz zapisu pokazuje pole kodu przy
   wejściówce za kodem (i wypełnia je kodem z linku zaproszenia `?code=`),
   a kasa zgłoszenia wysyła ten kod do podglądu i do kasy. Bez kodu w pamięci
   karty (link samoobsługi, profil) odmowa kasy odsłania pole kodu.
4. **Benefit planu tylko na miejscu członka.** Zniżka stawki ulgowej schodzi
   z miejsca członka, goście płacą cennik. Bilet z puli planu pokrywa miejsce
   prowadzącego w zamówieniu z gośćmi - kasa zajmuje go w puli PRZED
   założeniem zamówienia, a zamówienie obejmuje samych gości. Podgląd pyta
   bazę na sucho, więc ponowna kasa (zamknięta nakładka) widzi bilet już
   zajęty dla tego wydarzenia mimo pustej puli. Odmowa puli (pusta, wyścig
   dwóch kas) - prowadzący płaci cenę ze zniżką stawki. Kasa pokazuje
   osobno „Twoje miejsce" i „Goście: N × cena". Prowadzący płacący za
   zgłoszenie gościa nie przenosi na nie swojego benefitu.
5. **Anulowanie zamówienia pakietu oddaje użycie kodu**; powrót z anulowania
   zużywa je ponownie albo odmawia (`coupon_restore_exhausted`,
   `coupon_restore_used_by_buyer`) bez zmiany zamówienia. Status „zwrócone"
   zatrzymuje użycie.
6. **Test `rootRoute.test.tsx`** nie zależy już od zegara (wyścig atrapy
   modułu w vitest - opis w samym teście).

## 3. Poza zakresem - do decyzji produktu

- Goście odwołanej grupy nie dostają maila o odwołaniu; zawiadomienie o
  decyzji jest, jak dotąd, akcją organizatora.
- Goście anulowani ZWROTEM (Stripe albo ręcznym) nie awansują kolejki - awans
  w tej gałęzi mógłby na chwilę przyjąć gościa grupy zamykanej w tej samej
  instrukcji. Miejsce prowadzącego awansuje jak dotąd.
- Bilet z puli zajęty w kasie NIE wraca do puli, gdy zamówienie przepadnie
  albo zgłoszenie zostanie odwołane (ponowna kasa tego wydarzenia bierze ten
  sam bilet). Zwrot do puli: `release_included_event_ticket` (administrator
  albo sam członek).
- Pojedyncze zgłoszenie etapu 4 z biletem z puli nadal kończy się w kasie
  odmową `ticket_included_in_plan` - przyjęcie takiego zapisu bez płatności
  to osobna ścieżka.
- Wyczerpana pula przy wpłacie Stripe za SAMEGO prowadzącego nadal wywraca
  księgowanie (defekt przybity w `25_payment_binding.sql`).
