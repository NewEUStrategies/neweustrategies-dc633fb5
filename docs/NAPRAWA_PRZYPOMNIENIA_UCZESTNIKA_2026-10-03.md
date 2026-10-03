# Naprawa: przypomnienia uczestnika - rodzaj `event` i konsument ustawień organizatora (2026-10-03)

Zamyka dwa zgłoszenia toru 12 z tabeli defektów audytu `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`:

- **średni (12):** „Glowne przypomnienie o wydarzeniu 24 h nadal idzie rodzajem content - przelacznik Wydarzenia, TTL 1 h i wykluczenie z digestu go nie obejmuja” (`src/lib/notifications/dispatch.server.ts:87`),
- **średni (12):** „Ustawienia przypomnien organizatora (reminder_event_leads_minutes, session_reminders_enabled) bez konsumenta” (`supabase/migrations/20260926153101_event_participant_foundation_part2.sql:106`).

Przy okazji zamyka zgłoszenia, które opisują ten sam defekt z innej strony: 22b i 22c (zadanie F2 było zaślepką), niski (12) „Rodzaj powiadomienia 'event' nie ma zadnego producenta” oraz niski (12) „Filtr rodzaju event w digestu dziala po claimie z LIMIT 20”.

## 1. Mechanizm defektu (stan przed naprawą)

| Miejsce                                                   | Co robiło                                                                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_event_reminders()` (`20260713093000:297-330`)        | `enqueue_notification(user, 'content', ...)` dla RSVP `going` na < 24 h przed startem, sztywne `interval '24 hours'`, raz (`reminded_at`). To był jedyny działający producent przypomnień.                                       |
| `enqueue_notification` (`20260926153300:88`)              | Bramka czytała `enabled_content`, a nie `enabled_event` - grupa „Wydarzenia” w ustawieniach (`preferences.ts:263-266`) przypomnienia nie obejmowała.                                                                             |
| `pushOptionsForKind` (`dispatch.server.ts`)               | TTL 1 h i pilność `high` tylko dla rodzaju `event` - przypomnienie `content` żyło w usłudze push dobę.                                                                                                                           |
| `processDigests` / `claim_due_digests` (`20260713092000`) | Filtr `kind !== "event"` nie łapał `content`, więc przypomnienie trafiało do digestu następnego dnia. Dla rodzaju `event` filtr działał dopiero PO claimie: zjadał miejsca z limitu 20 i przesuwał okno digestu.                 |
| `reminderJob.server.ts`                                   | Zaślepka (`note: "stub"`). Ustawienia `reminders_enabled`, `reminder_event_leads_minutes`, `session_reminders_enabled`, `session_reminder_lead_minutes`, `reminder_sms_enabled` i preferencje `remind_*` czytał wyłącznie panel. |

## 2. Co zmienia naprawa

### Baza (`supabase/migrations/20261003140000_event_participant_reminders.sql`, bliźniak `drizzle/migrations/0133_event_participant_reminders.sql`, idx 133)

- **`_event_reminder_candidates(now, kanały, limit)`** - jedno źródło prawdy „co jest należne”, czytające ustawienia wyłącznie przez `_event_participant_settings_effective`:
  - przypomnienia o wydarzeniu dla zgłoszeń z biletem (`approved`/`attended` i opłata `paid`/`partially_refunded`/`not_required`), kanały według `remind_email`, `remind_push` (konto) i `remind_sms` (zgoda, numer, ustawienie organizatora);
  - przypomnienia o wydarzeniu dla samych RSVP `going` (tylko dzwonek; konto z żywym zgłoszeniem obsługuje gałąź zgłoszeń, więc nie ma dwóch dzwonków);
  - przypomnienia o sesjach z planu (zapis `registered` albo zakładka) dla kont z biletem na wydarzenie i `remind_sessions`; e-mail i dzwonek, bez SMS.
- **Reguły:** należny jest najmniejszy termin, którego chwila minęła (po przerwie harmonogramu jedno przypomnienie, nie seria); termin obowiązuje zapis istniejący przed jego chwilą; cisza nocna 22-07 w strefie wydarzenia odracza dzwonek i SMS z wyprzedzeniem > 60 min (e-mail nie czeka); klucz deduplikacji zawiera czas startu, więc przesunięte wydarzenie dostaje przypomnienia od nowa; wpis dziennika, którego nie wolno przejąć, zamyka kandydata (ta sama reguła co w `_event_delivery_claim`).
- **`run_event_reminders()`** - ta sama sygnatura (pg_cron, tick, cron społeczności). Wysyła dzwonki rodzajem **`event`** przez dziennik doręczeń (`_event_delivery_claim` → `enqueue_notification` → `_event_delivery_confirm`), ikona `calendar-clock`, godzina w strefie wydarzenia. Wyciszony dzwonek zostaje w dzienniku jako `skipped/not_enqueued`. Stempluje `event_rsvps.reminded_at`, a dzwonek pomija, gdy stary skaner przypomniał już po chwili terminu (przejście bez podwójnego „24 h” w dniu wdrożenia).
- **`_event_reminders_claim(limit, sms)`** - rezerwuje porcję e-mail (i SMS) i oddaje dane do wysyłki jednym wywołaniem. Numer telefonu wychodzi tylko dla kanału `sms`.
- **`_event_delivery_confirm_many(items)`** - zamknięcie porcji jednym RPC; cała porcja jest walidowana przed pierwszym zapisem.
- **`claim_due_digests`** - rodzaj `event` wykluczony z wyboru kandydatów i z pozycji (konto z samymi przypomnieniami nie traci okna digestu, a przypomnienia nie wypierają pozycji z limitu 20); `search_path` z `pg_temp`.
- Indeksy częściowe `events_published_starts_idx` i `event_sessions_published_starts_idx` pod skan po czasie startu (co minutę, między najemcami).
- Wszystkie nowe funkcje: SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE wyłącznie `service_role`.

### Serwer (TS)

- **`src/lib/events/jobs/reminderJob.server.ts`** - zadanie F2 (sygnatura zamrożona): porcje po 20, sufit 200 na przebieg, termin sprawdzany przed porcją, 4 równoległe wysyłki. E-mail przez `sendTxEmail` (szablony `event_reminder` / `event_session_reminder`, przycisk na domenie najemcy przez `tenantPublicUrl`), SMS przez `sendParticipantSms` tylko przy `participantSmsEnabled()`. Wynik każdej wysyłki trafia do dziennika (`sent` / `skipped` z powodem / `failed` z kodem, bez danych osobowych). Klucz idempotencji poczty i SMS-a = klucz deduplikacji, więc wpis przejęty ponownie nie wyśle wiadomości drugi raz.
- **`src/lib/events/reminderNotice.server.ts`** - czysty moduł treści: parser porcji (uszkodzony zarezerwowany wiersz wraca do zamknięcia), wiersze szczegółów dokładnie według `PARTICIPANT_TX_DETAIL_LABELS`, termin w strefie wydarzenia z nazwą strefy, „Miejsce” z lokalizacji i adresu (albo „Online”), SMS w jednym segmencie GSM-7.
- `src/integrations/supabase/types.ts` - sygnatury trzech nowych RPC.

### Optymalizacja

| Ścieżka            | Przed                                                                                                   | Po                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Wysyłka e-mail/SMS | brak (zaślepka); kontrakt foundation zakładał 2 RPC na doręczenie (`claimDelivery` + `confirmDelivery`) | 2 RPC na porcję 20 doręczeń (`_event_reminders_claim` + `_event_delivery_confirm_many`)                 |
| Skan należnych     | pełny skan `events` po `starts_at` bez indeksu bez najemcy                                              | indeksy częściowe po `starts_at` dla wydarzeń i sesji; anty-złączenie z dziennikiem po unikalnym kluczu |
| Digest             | przypomnienia wybierane i odfiltrowywane po claimie                                                     | odfiltrowane w zapytaniu claimu                                                                         |

### Dokumentacja

- `docs/RUNBOOK_COMMUNITY.md` - opis przypomnień i schemat potoku według nowego zachowania.

## 3. Kolejność wdrożenia

Obie kolejności są bezpieczne:

- **Kod przed migracją:** `_event_reminders_claim` nie istnieje, więc krok `eventParticipantReminders` w ticku zapisuje błąd RPC (jak każda brakująca funkcja) i nic nie wysyła; stary `run_event_reminders` działa jak dotąd. Filtr `kind !== "event"` w `processDigests` zostaje jako obrona w głąb.
- **Migracja przed kodem:** dzwonki idą już rodzajem `event` według ustawień organizatora; e-mail i SMS czekają na kod (zaślepka nic nie rezerwuje).

Po wdrożeniu domyślne terminy `{1440, 60}` oznaczają, że samo RSVP dostaje dwa dzwonki (24 h i 1 h), a nie jeden - tak jak obiecuje panel organizatora.

## 4. Pomiary i granice weryfikacji

| Sprawdzenie                                                                                                      | Wynik                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `supabase/tests/event_participant_reminders_test.sql` (lokalny runner pgTAP na pełnym schemacie, 1072 migracje)  | 44/44; na starych ciałach `run_event_reminders` i `claim_due_digests` - 14 asercji czerwonych |
| Migracja zastosowana drugi raz na tej samej bazie                                                                | bez błędów                                                                                    |
| Sąsiednie pliki pgTAP (bramka preferencji, push i digest, fundament F1-F5, powiadomienia wydarzeń i sieci, RSVP) | 16 plików zielonych                                                                           |
| vitest: `reminderNotice.server.test.ts` (26), `reminderJob.server.test.ts` (15), bramka pasów migracji (44)      | zielone                                                                                       |

Granice weryfikacji:

- Nie sprawdzałem wysyłki na produkcji ani dostarczalności; operator SMS jest wyłączony, dopóki środowisko nie ma `SMSAPI_TOKEN` i `EVENT_SMS_ENABLED=1`.
- Przycisk „Przypomnienia” na liście wydarzeń (`EventsListManager` → `src/lib/admin/community.ts:296`) woła `run_event_reminders` klientem przeglądarki, a funkcja od `20260713093000` ma EXECUTE wyłącznie dla `service_role`. To defekt sprzed tej naprawy i nie jest tu zmieniany: nadanie EXECUTE rolom klienckim wystawiłoby globalny skaner wszystkich najemców; właściwa naprawa to funkcja serwerowa z bramką administratora.
