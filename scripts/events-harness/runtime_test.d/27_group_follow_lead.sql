-- ============================================================================
-- 27_group_follow_lead - GOSCIE GRUPY IDA ZA PROWADZACYM (20260926100000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Gosc rejestracji grupowej dostaje przy dopisaniu status prowadzacego z tej
-- chwili. Do 20260926100000 rusza go potem WYLACZNIE trigger platnosci - wiec
-- zatwierdzenie prowadzacego przez organizatora zostawialo gosci `pending`
-- na zawsze, a bez przyjecia nie ma biletu ani maila. 26_group_tickets nie
-- mogl tego zobaczyc: jego prowadzacy sa wstawiani od razu jako `approved`
-- albo jako nieoplaceni, a sekcja crona zatwierdza wiersz BEZ gosci.
--
-- CO SPRAWDZA (kazda galaz funkcji z 20260926100000)
--   0. Straznik 0044: przepuszcza komplet, odmawia bez funkcji i bez kolumny.
--   1. Zatwierdzenie prowadzacego (bilet z akceptacja) przyjmuje gosci, cron
--      ich widzi, wydanie daje trzy bilety.
--   2. Ponowne przyjecie po odrzuceniu kasuje znacznik wysylki i wraca do
--      crona; `attended`/`no_show` znacznika NIE kasuja, wyjscie z `attended`
--      kasuje, a przyjecie wiersza z `pending` znacznika nie rusza.
--   3. Kwota biletu: nadmiarowy gosc idzie do kolejki z pozycja, gosc w kolejce
--      zostaje na swojej pozycji, zwolnione miejsce awansuje go.
--   4. KOLEJNOSC TRIGGEROW: prowadzacy zajmuje ostatnie miejsce - kaskada po
--      przeliczniku stawia goscia w kolejce, kaskada PRZED nim (kontrola
--      ujemna z przemianowanym triggerem) wywraca zatwierdzenie CHECK-iem puli.
--      4b. Ta sama kaskada przy POJEMNOSCI WYDARZENIA (bez puli biletu).
--      4c. Reczna wplata organizatora przyjmuje gosci Z KONTROLA MIEJSC: ciasna
--      pula (nadmiarowy gosc w kolejce oplacony; ostatnie miejsce prowadzacego -
--      kontrola przeliczenia puli w triggerze platnosci), sama pojemnosc
--      wydarzenia, gosc juz w kolejce zostaje na pozycji, prowadzacy
--      z nieudanym zamowieniem Stripe placi recznie (bez galezi Stripe).
--   5. Odrzucenie i anulowanie prowadzacego zamyka czekajacych gosci (powod,
--      data, pozycja), przyjetych nie rusza.
--      5b. Ponowne przyjecie prowadzacego z odrzucenia i z anulowania przywraca
--      gosci zamknietych RAZEM z nim (rozliczonych do przyjecia albo kolejki,
--      nieoplaconych do `pending`), a gosci zamknietych osobno i osoby
--      z innym aktywnym zapisem - nie; predykat stempla po kazdym czlonie.
--      5c. Samodzielne wycofanie prowadzacego zamyka gosci BEZ autora
--      (`system`), z ich wlasna notatka; przywrocenie nadal dziala; anulowanie
--      przez organizatora z nowym stemplem decyzji niesie jego slad.
--   6. Nieoplaceni goscie czekaja mimo zatwierdzenia prowadzacego - przyjmuje
--      ich dopiero wplata; bilety dostaje cala trojka.
--   7. Reczne `paid`/`refund` organizatora (bez zamowienia) dociera do gosci,
--      gosc zachowuje wlasne zamowienie; wszystkie galezie wyniku platnosci;
--      zwrot (pelny i czesciowy) omija gosci, ktorzy nie zaplacili.
--   8. Cron widzi samodzielny zapis w trybie RSVP, a wpisy organizatora
--      i importy - nie.
--   9. `admin_event_registration_group_links`: tylko wskazane wiersze strony,
--      powiazania, liczniki (z goscmi zamknietymi razem z prowadzacym),
--      granica strony, bramka.
--  10. `admin_event_ticket_resend`: grupa, sam wiersz, odmowy, zywa dzierzawa
--      (odmowa dla wskazanego wiersza, pominiecie w grupie), bramka.
--      10b. `p_exclude_ids` (wykluczony gosc zachowuje bilet i kod) i zakres
--      `admin_event_ticket_resend_scope` (kolejnosc, adres, pominiecia, bramka).
--      10c. Bilet niedoreczony: czteroargumentowe `_event_ticket_code_confirm`,
--      znacznik w panelu, kasowanie przy ponownej wysylce i wyjsciu z przyjecia.
--      10d. `_event_group_repair_stranded_guests`: grupy uwiezione przed
--      migracja (bezplatne, recznie oplacone, `attended`), miejsca, zakonczone
--      wydarzenie, nieoplacony prowadzacy, `p_limit`, drugie wywolanie bez
--      zmian, tylko service_role.
--  11. Funkcje wewnetrzne bez EXECUTE dla anon/authenticated.
--
-- JEDNA TRANSAKCJA = JEDNO `now()`. Caly plik biegnie w jednej transakcji, wiec
-- kazda decyzja dostaje ten sam stempel czasu. Na produkcji kazde wywolanie RPC
-- to osobna transakcja; tam, gdzie test udaje decyzje podjeta WCZESNIEJ (gosc
-- odrzucony albo wycofany osobno), przesuwa jej stempel wprost.
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK - lacznie z atrapa bramki
-- czestotliwosci, ktorej `event_register` wymaga (20_registration zdejmuje
-- swoja na koniec).
-- ============================================================================

\echo '== 27 goscie grupy ida za prowadzacym: kaskada, bilety, panel =='

BEGIN;

CREATE TEMP TABLE gfl_q (k text PRIMARY KEY, u uuid);

-- Atrapa bramki czestotliwosci - zawsze przepuszcza. Ten plik nie bada limitu
-- prob zapisu, a atrapa znika z ROLLBACK-iem.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'rate_limit_hit') THEN
    CREATE FUNCTION public.rate_limit_hit(
      _scope text, _subject text, _max integer, _window_minutes integer DEFAULT 1
    ) RETURNS TABLE(allowed boolean, hits integer, bucket_start timestamptz)
    LANGUAGE sql AS $rl$ SELECT true, 1, now() $rl$;
  END IF;
END
$do$;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7', 'Tenant C7 (grupa za prowadzacym)', 'tc7-gfl'),
  ('c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8', 'Tenant C8 (obcy)', 'tc8-gfl')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('c7000000-0000-0000-0000-0000000000a1', 'admin.gfl@example.org'),
  ('c8000000-0000-0000-0000-0000000000a1', 'admin.obcy@example.org'),
  ('c7000000-0000-0000-0000-0000000000e1', 'editor.gfl@example.org'),
  ('c7000000-0000-0000-0000-0000000000b1', 'zwykly.gfl@example.org'),
  ('c7000000-0000-0000-0000-000000000001', 'lead.a@example.org'),
  ('c7000000-0000-0000-0000-000000000002', 'lead.q@example.org'),
  ('c7000000-0000-0000-0000-000000000003', 'lead.o@example.org'),
  ('c7000000-0000-0000-0000-000000000004', 'lead.r@example.org'),
  ('c7000000-0000-0000-0000-000000000005', 'lead.c@example.org'),
  ('c7000000-0000-0000-0000-000000000006', 'lead.u@example.org'),
  ('c7000000-0000-0000-0000-000000000007', 'lead.p@example.org'),
  ('c7000000-0000-0000-0000-000000000008', 'lead.v@example.org'),
  ('c7000000-0000-0000-0000-000000000009', 'lead.x@example.org'),
  ('c7000000-0000-0000-0000-00000000000a', 'lead.y@example.org'),
  ('c7000000-0000-0000-0000-00000000000b', 'lead.k@example.org'),
  ('c7000000-0000-0000-0000-00000000000c', 'lead.s@example.org'),
  ('c7000000-0000-0000-0000-00000000000d', 'lead.t@example.org'),
  ('c7000000-0000-0000-0000-00000000000e', 'lead.t2@example.org'),
  ('c7000000-0000-0000-0000-00000000000f', 'lead.m@example.org'),
  ('c7000000-0000-0000-0000-000000000010', 'lead.f@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, CASE WHEN u.id = 'c8000000-0000-0000-0000-0000000000a1'
                  THEN 'c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8'::uuid
                  ELSE 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7'::uuid END
FROM auth.users u
WHERE u.id::text LIKE 'c7000000-%' OR u.id::text LIKE 'c8000000-%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('c7000000-0000-0000-0000-0000000000a1', 'admin'),
  ('c8000000-0000-0000-0000-0000000000a1', 'admin'),
  ('c7000000-0000-0000-0000-0000000000e1', 'editor')
ON CONFLICT DO NOTHING;

-- E1: formularz, przeplyw natychmiastowy - akceptacje wymusza BILET.
-- E2: tryb RSVP z przeplywem akceptacji - `event_register` pisze `rsvp`.
-- E3: pojemnosc 2 i bilet BEZ puli - druga polowa `_event_seats_left`.
-- E4: pojemnosc 3 i bilet PLATNY bez puli - reczna wplata przy samej
--     pojemnosci wydarzenia.
-- E5: wydarzenie, ktore sie JUZ SKONCZYLO - naprawa gosci go omija.
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('c7100000-0000-0000-0000-000000000004', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'gfl-capacity-paid', 'Warsztat platny na trzy osoby', 'Paid three-seat workshop',
   now() + interval '30 days', NULL, 'published', 'form', 'instant', 3),
  ('c7100000-0000-0000-0000-000000000005', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'gfl-ended', 'Spotkanie zakonczone', 'Finished meeting',
   now() - interval '3 days', now() - interval '2 days', 'published', 'form', 'instant', NULL);
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('c7100000-0000-0000-0000-000000000001', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'gfl-approval', 'Kongres z akceptacja', 'Congress with approval',
   now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('c7100000-0000-0000-0000-000000000002', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'gfl-rsvp', 'Spotkanie RSVP', 'RSVP meeting',
   now() + interval '30 days', 'published', 'rsvp', 'approval', NULL),
  ('c7100000-0000-0000-0000-000000000003', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'gfl-capacity', 'Seminarium na dwie osoby', 'Two-seat seminar',
   now() + interval '30 days', 'published', 'form', 'instant', 2);

-- K1 bezplatny z akceptacja, bez limitu; K2 z akceptacja, pula 2; K3 platny;
-- K5 z akceptacja, pula 1 (dowod kolejnosci); K4 bezplatny na E2; K6
-- z akceptacja, bez puli, na E3 (limit daje pojemnosc wydarzenia).
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('c7200000-0000-0000-0000-000000000001', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'free_approval', 'Z akceptacja', 'With approval',
   0, 'PLN', NULL, 0, true, true, 10, true, 5),
  ('c7200000-0000-0000-0000-000000000002', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'quota_two', 'Pula dwa', 'Quota two',
   0, 'PLN', 2, 0, true, true, 20, true, 5),
  ('c7200000-0000-0000-0000-000000000003', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'paid_group', 'Platny', 'Paid',
   10000, 'PLN', NULL, 0, false, true, 30, true, 5),
  ('c7200000-0000-0000-0000-000000000005', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'quota_one', 'Pula jeden', 'Quota one',
   0, 'PLN', 1, 0, true, true, 40, true, 5),
  ('c7200000-0000-0000-0000-000000000004', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000002', 'rsvp_free', 'RSVP', 'RSVP',
   0, 'PLN', NULL, 0, false, true, 10, true, 5),
  ('c7200000-0000-0000-0000-000000000006', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000003', 'capacity_free', 'Seminarium', 'Seminar',
   0, 'PLN', NULL, 0, true, true, 10, true, 5),
  -- K7/K8 platne z pula (3 i 2) - reczna wplata przy ciasnej puli; K9 platny
  -- bez puli na E4; K10 bezplatny z akceptacja, pula 2 - naprawa przy pelnej
  -- puli; K11 bezplatny na zakonczonym E5; K12 platny, pula 3 - reczna wplata
  -- prowadzacego z nieudanym zamowieniem Stripe.
  ('c7200000-0000-0000-0000-000000000007', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'paid_quota_three', 'Platny, pula trzy', 'Paid, quota three',
   10000, 'PLN', 3, 0, false, true, 50, true, 5),
  ('c7200000-0000-0000-0000-000000000008', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'paid_quota_two', 'Platny, pula dwa', 'Paid, quota two',
   10000, 'PLN', 2, 0, false, true, 60, true, 5),
  ('c7200000-0000-0000-0000-000000000009', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000004', 'capacity_paid', 'Warsztat', 'Workshop',
   10000, 'PLN', NULL, 0, false, true, 10, true, 5),
  ('c7200000-0000-0000-0000-00000000000a', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'repair_quota_two', 'Naprawa, pula dwa', 'Repair, quota two',
   0, 'PLN', 2, 0, true, true, 70, true, 5),
  ('c7200000-0000-0000-0000-00000000000b', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000005', 'ended_free', 'Zakonczone', 'Finished',
   0, 'PLN', NULL, 0, true, true, 10, true, 5),
  ('c7200000-0000-0000-0000-00000000000c', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'paid_quota_three_stale', 'Platny, pula trzy (F)',
   'Paid, quota three (F)', 10000, 'PLN', 3, 0, false, true, 80, true, 5);

-- Dwa wiersze bez grupy: oczekujacy i przyjety (panel i ponowna wysylka).
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('c7300000-0000-0000-0000-000000000001', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'solo.pending@example.org', 'Sam', 'Oczekujacy'),
  ('c7300000-0000-0000-0000-000000000002', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'solo.approved@example.org', 'Sam', 'Przyjety');
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, decided_at, decision_source, ticket_code_sent_at)
VALUES
  ('c7400000-0000-0000-0000-000000000001', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'c7300000-0000-0000-0000-000000000001',
   'c7200000-0000-0000-0000-000000000001', 'pending', 'form', 'not_required',
   NULL, NULL, now() - interval '1 day'),
  ('c7400000-0000-0000-0000-000000000002', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'c7300000-0000-0000-0000-000000000002',
   'c7200000-0000-0000-0000-000000000001', 'approved', 'form', 'not_required',
   now(), 'system', now() - interval '1 day');

SELECT set_config('nes.public_tenant', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7', false);

-- Prowadzacy zapisuje sie PRAWDZIWYM `event_register` i dopisuje gosci -
-- scenariusz ma przejsc te same funkcje, co formularz, a nie INSERT.
CREATE FUNCTION pg_temp.gfl_group(_key text, _uid uuid, _ticket uuid, _slug text,
                                  _emails text[]) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
  v_lead uuid;
  v_guests jsonb := '[]'::jsonb;
  v_email text;
  i integer := 0;
BEGIN
  PERFORM pg_temp.act_as(_uid, 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7');
  v := public.event_register(jsonb_build_object(
    'event_slug', _slug, 'ticket_type_id', _ticket,
    'email', (SELECT u.email FROM auth.users u WHERE u.id = _uid),
    'first_name', 'Lider', 'last_name', initcap(_key),
    'consent_data_processing', true));
  v_lead := (v->>'registration_id')::uuid;
  INSERT INTO gfl_q VALUES (_key, v_lead);
  FOREACH v_email IN ARRAY _emails LOOP
    i := i + 1;
    v_guests := v_guests || jsonb_build_array(jsonb_build_object(
      'first_name', 'Gosc', 'last_name', initcap(_key) || i, 'email', v_email));
    INSERT INTO gfl_q VALUES (_key || '_g' || i, NULL);
  END LOOP;
  PERFORM public.event_register_group_guests(v_lead, v_guests);
  UPDATE gfl_q q SET u = r.id
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id
  WHERE r.group_lead_registration_id = v_lead
    AND q.k = _key || '_g' || (array_position(_emails, p.email_norm));
  PERFORM pg_temp.act_as();
  RETURN v_lead;
END $$;

CREATE FUNCTION pg_temp.gfl(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM gfl_q WHERE k = _key $$;

CREATE FUNCTION pg_temp.gfl_admin() RETURNS void
LANGUAGE sql AS $$
  SELECT pg_temp.act_as('c7000000-0000-0000-0000-0000000000a1',
                        'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7');
$$;

CREATE FUNCTION pg_temp.gfl_decide(_id uuid, _action text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.gfl_admin();
  v := public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', _id, 'action', _action, 'note', _note));
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

-- Potwierdza wysylke kazdego wydanego biletu, oddaje ich liczbe.
CREATE FUNCTION pg_temp.gfl_issue_all(_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := public._event_issue_ticket_codes(_id);
  FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP
    PERFORM public._event_ticket_code_confirm(
      (e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  RETURN jsonb_array_length(v);
END $$;

-- ---------------------------------------------------------------------------
-- 0) STRAZNIK 0044
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public._event_assert_ticket_codes_schema();
  PERFORM pg_temp.assert(true, '27/straznik: baza z kompletem 0044 przechodzi straznika');
END $$;

-- Podmiana dzieje sie W SRODKU sprawdzanej instrukcji, wiec odmowa wycofuje ja
-- razem z soba (podtransakcja `assert_raises_like`).
SELECT pg_temp.assert_raises_like($sql$DO $d$ BEGIN
  ALTER FUNCTION public._event_issue_ticket_codes(uuid) RENAME TO _event_issue_ticket_codes_ukryta;
  PERFORM public._event_assert_ticket_codes_schema();
END $d$$sql$, 'Brak migracji 20260923110000_event_ticket_group_codes (0044)',
  '27/straznik: bez _event_issue_ticket_codes migracja konczy sie GLOSNO');
SELECT pg_temp.assert_raises_like($sql$DO $d$ BEGIN
  ALTER TABLE public.event_registrations RENAME COLUMN ticket_code_sent_at TO ticket_code_sent_at_ukryta;
  PERFORM public._event_assert_ticket_codes_schema();
END $d$$sql$, 'apply it before this one',
  '27/straznik: bez kolumny ticket_code_sent_at migracja konczy sie GLOSNO');
SELECT pg_temp.assert(
  to_regprocedure('public._event_issue_ticket_codes(uuid)') IS NOT NULL
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'event_registrations' AND column_name = 'ticket_code_sent_at'),
  '27/straznik: odmowa wycofala podmiany - schemat nietkniety');

-- ---------------------------------------------------------------------------
-- 1) ZATWIERDZENIE PROWADZACEGO PRZYJMUJE GOSCI
-- ---------------------------------------------------------------------------
SELECT pg_temp.gfl_group('a', 'c7000000-0000-0000-0000-000000000001',
  'c7200000-0000-0000-0000-000000000001', 'gfl-approval',
  ARRAY['guest.a1@example.org', 'guest.a2@example.org']);

DO $$
DECLARE v uuid[];
BEGIN
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations WHERE id = pg_temp.gfl('a')) = 'pending',
    '27/przyjecie: bilet z akceptacja - prowadzacy czeka na decyzje');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gfl('a')
        AND r.status = 'pending' AND r.payment_status = 'not_required'
        AND r.qr_token_hash IS NULL) = 2,
    '27/przyjecie: goscie dziedzicza oczekiwanie - bez kodu');
  v := public._event_ticket_codes_pending(500);
  PERFORM pg_temp.assert(NOT (pg_temp.gfl('a_g1') = ANY(v)) AND NOT (pg_temp.gfl('a') = ANY(v)),
    '27/przyjecie: przed decyzja cron nikomu z grupy nie wydaje biletu');
END $$;

DO $$
DECLARE v jsonb; q uuid[];
BEGIN
  v := pg_temp.gfl_decide(pg_temp.gfl('a'), 'approve');
  PERFORM pg_temp.assert(v->>'status' = 'approved', '27/przyjecie: organizator zatwierdza prowadzacego');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gfl('a')
        AND r.status = 'approved' AND r.waitlist_position IS NULL
        AND r.qr_token_hash ~ '^[0-9a-f]{64}$' AND r.qr_issued_at IS NOT NULL
        AND r.decision_source = 'organizer'
        AND r.decided_by = 'c7000000-0000-0000-0000-0000000000a1'
        AND r.decided_at IS NOT NULL
        AND r.ticket_code_sent_at IS NULL AND r.ticket_code_claimed_at IS NULL) = 2,
    '27/przyjecie: zatwierdzenie prowadzacego przyjmuje OBU gosci (kod, slad decyzji organizatora)');
  q := public._event_ticket_codes_pending(500);
  PERFORM pg_temp.assert(
    pg_temp.gfl('a') = ANY(q) AND pg_temp.gfl('a_g1') = ANY(q) AND pg_temp.gfl('a_g2') = ANY(q),
    '27/przyjecie: cron widzi prowadzacego i obu gosci');
  PERFORM pg_temp.assert(jsonb_array_length(public._event_issue_ticket_codes(pg_temp.gfl('a'))) = 3,
    '27/przyjecie: wydanie od prowadzacego daje trzy bilety - kazdy gosc wlasny');
  -- Dzierzawa trwa - zwalniamy ja, zeby dalsze kroki mialy czysty stan.
  UPDATE public.event_registrations SET ticket_code_claimed_at = NULL
  WHERE id IN (pg_temp.gfl('a'), pg_temp.gfl('a_g1'), pg_temp.gfl('a_g2'));
  PERFORM pg_temp.assert(pg_temp.gfl_issue_all(pg_temp.gfl('a')) = 3,
    '27/przyjecie: po potwierdzeniu wysylki bilety sa odnotowane');
END $$;

-- ---------------------------------------------------------------------------
-- 2) PONOWNE PRZYJECIE WYDAJE NOWY BILET (trigger resetu)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; q uuid[]; v_g1 uuid := pg_temp.gfl('a_g1'); v_g2 uuid := pg_temp.gfl('a_g2');
BEGIN
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NOT NULL FROM public.event_registrations WHERE id = v_g1),
    '27/reset: punkt wyjscia - bilet goscia wyslany');

  v := pg_temp.gfl_decide(v_g1, 'reject', 'Blad w zgloszeniu');
  PERFORM pg_temp.assert(
    (SELECT status = 'rejected' AND ticket_code_sent_at IS NULL AND ticket_code_claimed_at IS NULL
            AND qr_token_hash IS NULL
       FROM public.event_registrations WHERE id = v_g1),
    '27/reset: odrzucenie przyjetego kasuje znacznik wyslanego biletu');
  PERFORM pg_temp.assert(NOT (v_g1 = ANY(public._event_ticket_codes_pending(500))),
    '27/reset: odrzucony nie czeka na bilet');

  v := pg_temp.gfl_decide(v_g1, 'approve');
  q := public._event_ticket_codes_pending(500);
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND qr_token_hash IS NOT NULL AND ticket_code_sent_at IS NULL
       FROM public.event_registrations WHERE id = v_g1) AND v_g1 = ANY(q),
    '27/reset: ponownie przyjety gosc wraca do crona po NOWY bilet');
  PERFORM pg_temp.assert(pg_temp.gfl_issue_all(v_g1) = 1,
    '27/reset: wydanie od goscia obejmuje tylko jego wiersz');

  -- Obecnosc i nieobecnosc NIE zdejmuja kodu - bilet z maila nadal obowiazuje.
  v := pg_temp.gfl_decide(v_g2, 'attended');
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NOT NULL FROM public.event_registrations WHERE id = v_g2),
    '27/reset: approved -> attended nie kasuje znacznika');
  v := pg_temp.gfl_decide(v_g2, 'no_show');
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NOT NULL FROM public.event_registrations WHERE id = v_g2),
    '27/reset: attended -> no_show nie kasuje znacznika (kod QR zostaje)');
  v := pg_temp.gfl_decide(v_g2, 'attended');
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NOT NULL FROM public.event_registrations WHERE id = v_g2),
    '27/reset: no_show -> attended nie wysyla drugiego biletu');
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
  WHERE id = v_g2;
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NULL FROM public.event_registrations WHERE id = v_g2),
    '27/reset: wyjscie z attended kasuje znacznik');

  -- Wiersz wchodzacy do przyjecia z `pending` znacznika nie traci - reset
  -- dotyczy wyjscia z przyjecia, nie wejscia.
  UPDATE public.event_registrations SET status = 'approved', decided_at = now(),
    decision_source = 'system'
  WHERE id = 'c7400000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NOT NULL FROM public.event_registrations
      WHERE id = 'c7400000-0000-0000-0000-000000000001'),
    '27/reset: pending -> approved nie kasuje znacznika');
  UPDATE public.event_registrations SET status = 'pending', decided_at = NULL,
    decision_source = NULL
  WHERE id = 'c7400000-0000-0000-0000-000000000001';
END $$;

-- ---------------------------------------------------------------------------
-- 3) PULA BILETU: NADMIAROWY GOSC W KOLEJCE
-- ---------------------------------------------------------------------------
SELECT pg_temp.gfl_group('q', 'c7000000-0000-0000-0000-000000000002',
  'c7200000-0000-0000-0000-000000000002', 'gfl-approval',
  ARRAY['guest.q1@example.org', 'guest.q2@example.org']);

-- Goscie dopisani jednym wywolaniem maja ten sam `created_at` (czas
-- transakcji), wiec kaskada rozstrzyga kolejnosc po `id` - losowym. Asercje
-- nie zakladaja, KTORY gosc sie zmiescil: biora przyjetego i czekajacego z bazy.
DO $$
DECLARE v jsonb; v_pos integer; v_in uuid; v_out uuid;
BEGIN
  v := pg_temp.gfl_decide(pg_temp.gfl('q'), 'approve');
  PERFORM pg_temp.assert(v->>'status' = 'approved',
    '27/pula: zatwierdzenie prowadzacego przechodzi mimo pelnej puli dla gosci');
  SELECT r.id INTO v_in FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('q') AND r.status = 'approved';
  SELECT r.id INTO v_out FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('q') AND r.status = 'waitlist';
  PERFORM pg_temp.assert(
    v_in IS NOT NULL AND v_out IS NOT NULL
    AND (SELECT waitlist_position > 0 AND decision_source = 'capacity' AND qr_token_hash IS NULL
           FROM public.event_registrations WHERE id = v_out),
    '27/pula: jeden gosc przyjety, drugi w kolejce z pozycja');
  PERFORM pg_temp.assert(
    (SELECT sold_count = 2 AND sold_count <= quota FROM public.event_ticket_types
      WHERE id = 'c7200000-0000-0000-0000-000000000002'),
    '27/pula: sprzedane = pula (2), bez przekroczenia');

  -- Gosc w kolejce zostaje na SWOJEJ pozycji, gdy miejsca nadal brak.
  SELECT waitlist_position INTO v_pos FROM public.event_registrations WHERE id = v_out;
  UPDATE public.event_registrations SET status = 'pending' WHERE id = pg_temp.gfl('q');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations WHERE id = v_in) = 'approved',
    '27/pula: cofniecie prowadzacego do oczekiwania gosci nie rusza');
  UPDATE public.event_registrations SET status = 'approved' WHERE id = pg_temp.gfl('q');
  PERFORM pg_temp.assert(
    (SELECT status = 'waitlist' AND waitlist_position = v_pos
       FROM public.event_registrations WHERE id = v_out),
    '27/pula: gosc juz w kolejce zostaje na swojej pozycji');

  -- Zwolnione miejsce: gosc z kolejki awansuje przy przyjeciu prowadzacego.
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
  WHERE id = v_in;
  UPDATE public.event_registrations SET status = 'waitlist' WHERE id = pg_temp.gfl('q');
  UPDATE public.event_registrations SET status = 'approved' WHERE id = pg_temp.gfl('q');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND waitlist_position IS NULL AND promoted_at IS NOT NULL
            AND qr_token_hash IS NOT NULL
       FROM public.event_registrations WHERE id = v_out),
    '27/pula: gosc z kolejki awansuje, gdy prowadzacy wchodzi na wolne miejsce');
END $$;

-- ---------------------------------------------------------------------------
-- 4) KOLEJNOSC TRIGGEROW: KASKADA PO PRZELICZNIKU PULI
-- ---------------------------------------------------------------------------
SELECT pg_temp.gfl_group('o', 'c7000000-0000-0000-0000-000000000003',
  'c7200000-0000-0000-0000-000000000005', 'gfl-approval',
  ARRAY['guest.o1@example.org']);

-- Kontrola ujemna: kaskada przemianowana tak, zeby biegla PRZED
-- `event_registrations_sync_ticket_sold`, widzi `sold_count` bez prowadzacego,
-- przyjmuje goscia na nieistniejace miejsce i CHECK puli wywraca decyzje.
-- Bez tej kontroli asercja nizej przechodzilaby takze przy zlej kolejnosci.
DO $o$
BEGIN
  PERFORM pg_temp.gfl_admin();
  PERFORM pg_temp.assert_raises_like(format($f$DO $d$ BEGIN
    ALTER TRIGGER event_registrations_zz_group_follow_lead_status ON public.event_registrations
      RENAME TO event_registrations_aa_group_follow_lead_status;
    PERFORM public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', %L::uuid, 'action', 'approve'));
  END $d$$f$, pg_temp.gfl('o')), 'sold_within_quota',
    '27/kolejnosc: kaskada PRZED przelicznikiem przepelnia pule (kontrola ujemna)');
  PERFORM pg_temp.act_as();
END $o$;

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'event_registrations_zz_group_follow_lead_status'),
    '27/kolejnosc: kontrola ujemna wycofala przemianowanie');
  v := pg_temp.gfl_decide(pg_temp.gfl('o'), 'approve');
  PERFORM pg_temp.assert(v->>'status' = 'approved'
    AND (SELECT status = 'waitlist' AND waitlist_position > 0
           FROM public.event_registrations WHERE id = pg_temp.gfl('o_g1'))
    AND (SELECT sold_count FROM public.event_ticket_types
          WHERE id = 'c7200000-0000-0000-0000-000000000005') = 1,
    '27/kolejnosc: prowadzacy zajmuje ostatnie miejsce, gosc czeka w kolejce - pula cala');
END $$;

-- ---------------------------------------------------------------------------
-- 4b) POJEMNOSC WYDARZENIA: KASKADA LICZY TEZ `events.capacity`
-- ---------------------------------------------------------------------------
-- Sekcje 3 i 4 dowodza tylko puli biletu (`sold_count` z pamieci). Druga
-- polowa `_event_seats_left` liczy przyjete wiersze wydarzenia NA ZYWO - tu
-- bilet nie ma puli, a limit 2 daje wydarzenie: prowadzacy i jeden gosc
-- wchodza, drugi gosc staje w kolejce.
SELECT pg_temp.gfl_group('k', 'c7000000-0000-0000-0000-00000000000b',
  'c7200000-0000-0000-0000-000000000006', 'gfl-capacity',
  ARRAY['guest.k1@example.org', 'guest.k2@example.org']);

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gfl('k') AND r.status = 'pending') = 2,
    '27/pojemnosc: przed decyzja obaj goscie czekaja');
  v := pg_temp.gfl_decide(pg_temp.gfl('k'), 'approve');
  PERFORM pg_temp.assert(v->>'status' = 'approved',
    '27/pojemnosc: zatwierdzenie prowadzacego przechodzi mimo pelnego wydarzenia dla gosci');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.event_id = 'c7100000-0000-0000-0000-000000000003'
        AND r.status IN ('approved', 'attended', 'no_show')) = 2
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.group_lead_registration_id = pg_temp.gfl('k')
            AND r.status = 'approved' AND r.qr_token_hash IS NOT NULL) = 1
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.group_lead_registration_id = pg_temp.gfl('k')
            AND r.status = 'waitlist' AND r.waitlist_position > 0
            AND r.decision_source = 'capacity' AND r.qr_token_hash IS NULL) = 1,
    '27/pojemnosc: przyjetych dokladnie tylu, ile miejsc (2), drugi gosc w kolejce z pozycja');
END $$;

-- ---------------------------------------------------------------------------
-- 4c) RECZNA WPLATA PRZYJMUJE GOSCI Z KONTROLA MIEJSC
-- ---------------------------------------------------------------------------
-- Nieoplacony gosc nie trzyma miejsca, wiec po dopisaniu gosci pula moze sie
-- zapelnic, a 'paid' w `admin_event_registration_decide` sprawdza miejsce
-- TYLKO dla prowadzacego. Przyjecie wszystkich naraz wywracalo zaksiegowanie
-- przelewu CHECK-iem puli (albo po cichu przepelnialo wydarzenie). Teraz
-- nadmiarowy gosc czeka w kolejce OPLACONY.
--   T:  pula 3, zajete 1 - prowadzacy i jeden gosc wchodza, drugi w kolejce.
--   T2: pula 2, zajete 1 - wchodzi SAM prowadzacy. Bez przeliczenia puli
--       w triggerze platnosci (biegnie PRZED przelicznikiem) pierwszy gosc
--       widzialby miejsce prowadzacego i CHECK wywracalby decyzje - ten
--       przypadek jest jego kontrola. Gosc juz w kolejce zostaje na pozycji.
--   M:  pojemnosc wydarzenia 3 (bilet bez puli), zajete 1 - jak T.
--   F:  jak T, ale prowadzacy NOSI zamowienie Stripe, ktorego platnosc
--       odroczona przepadla (wynik `unpaid`). 'paid' organizatora kolumny nie
--       rusza - wplata jest reczna mimo zamowienia: bez tego szla galezia
--       Stripe i CHECK puli wywracal przelew. Goscie nie dostaja nieudanego
--       zamowienia.
SELECT pg_temp.gfl_group('t', 'c7000000-0000-0000-0000-00000000000d',
  'c7200000-0000-0000-0000-000000000007', 'gfl-approval',
  ARRAY['guest.t1@example.org', 'guest.t2@example.org']);
SELECT pg_temp.gfl_group('t2', 'c7000000-0000-0000-0000-00000000000e',
  'c7200000-0000-0000-0000-000000000008', 'gfl-approval',
  ARRAY['guest.tt1@example.org', 'guest.tt2@example.org']);
SELECT pg_temp.gfl_group('m', 'c7000000-0000-0000-0000-00000000000f',
  'c7200000-0000-0000-0000-000000000009', 'gfl-capacity-paid',
  ARRAY['guest.m1@example.org', 'guest.m2@example.org']);

-- Po jednym miejscu zajetym przez kogos spoza grupy - juz PO dopisaniu gosci.
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('c7300000-0000-0000-0000-000000000003', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'solo.k7@example.org', 'Sam', 'Pula trzy'),
  ('c7300000-0000-0000-0000-000000000004', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'solo.k8@example.org', 'Sam', 'Pula dwa'),
  ('c7300000-0000-0000-0000-000000000005', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'solo.e4@example.org', 'Sam', 'Warsztat');
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, decided_at, decision_source)
VALUES
  ('c7400000-0000-0000-0000-000000000003', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'c7300000-0000-0000-0000-000000000003',
   'c7200000-0000-0000-0000-000000000007', 'approved', 'form', 'not_required', now(), 'system'),
  ('c7400000-0000-0000-0000-000000000004', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'c7300000-0000-0000-0000-000000000004',
   'c7200000-0000-0000-0000-000000000008', 'approved', 'form', 'not_required', now(), 'system'),
  ('c7400000-0000-0000-0000-000000000005', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000004', 'c7300000-0000-0000-0000-000000000005',
   'c7200000-0000-0000-0000-000000000009', 'approved', 'form', 'not_required', now(), 'system');

DO $$
DECLARE v jsonb; v_in uuid; v_out uuid;
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id IN (pg_temp.gfl('t'), pg_temp.gfl('t2'), pg_temp.gfl('m'))
        AND r.status = 'pending' AND r.payment_status = 'unpaid') = 6
    AND (SELECT sold_count FROM public.event_ticket_types
          WHERE id = 'c7200000-0000-0000-0000-000000000007') = 1,
    '27/wplata-miejsca: punkt wyjscia - goscie czekaja nieoplaceni, pula T zajeta w jednej trzeciej');

  v := pg_temp.gfl_decide(pg_temp.gfl('t'), 'paid');
  PERFORM pg_temp.assert(v->>'status' = 'approved'
    AND (SELECT status = 'approved' AND payment_status = 'paid'
           FROM public.event_registrations WHERE id = pg_temp.gfl('t')),
    '27/wplata-miejsca: przelew prowadzacego zaksiegowany mimo ciasnej puli');
  SELECT r.id INTO v_in FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('t') AND r.status = 'approved';
  SELECT r.id INTO v_out FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('t') AND r.status = 'waitlist';
  PERFORM pg_temp.assert(
    (SELECT payment_status = 'paid' AND qr_token_hash IS NOT NULL AND paid_at IS NOT NULL
            AND decided_by = 'c7000000-0000-0000-0000-0000000000a1'
            AND decision_source = 'organizer' AND ticket_code_sent_at IS NULL
       FROM public.event_registrations WHERE id = v_in)
    AND (SELECT payment_status = 'paid' AND paid_at IS NOT NULL AND waitlist_position > 0
                AND decision_source = 'capacity' AND decided_by IS NULL AND qr_token_hash IS NULL
           FROM public.event_registrations WHERE id = v_out),
    '27/wplata-miejsca: jeden gosc przyjety na ostatnie miejsce, nadmiarowy czeka w kolejce OPLACONY');
  PERFORM pg_temp.assert(
    (SELECT sold_count = 3 AND sold_count <= quota FROM public.event_ticket_types
      WHERE id = 'c7200000-0000-0000-0000-000000000007'),
    '27/wplata-miejsca: sprzedane = pula (3), bez przekroczenia');
END $$;

DO $$
DECLARE v jsonb; v_wait uuid; v_pos integer; v_other uuid;
BEGIN
  -- Jeden gosc T2 juz stoi w kolejce - po wplacie zostaje na SWOJEJ pozycji.
  SELECT r.id INTO v_wait FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('t2') ORDER BY r.id LIMIT 1;
  UPDATE public.event_registrations SET status = 'waitlist',
    waitlist_position = public._event_next_waitlist_position(
      'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7', 'c7100000-0000-0000-0000-000000000001')
  WHERE id = v_wait
  RETURNING waitlist_position INTO v_pos;
  SELECT r.id INTO v_other FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('t2') AND r.id <> v_wait;

  v := pg_temp.gfl_decide(pg_temp.gfl('t2'), 'paid');
  PERFORM pg_temp.assert(v->>'status' = 'approved'
    AND (SELECT sold_count FROM public.event_ticket_types
          WHERE id = 'c7200000-0000-0000-0000-000000000008') = 2,
    '27/wplata-miejsca: ostatnie miejsce bierze prowadzacy - przelew przechodzi, pula cala (kontrola przeliczenia)');
  PERFORM pg_temp.assert(
    (SELECT status = 'waitlist' AND payment_status = 'paid' AND waitlist_position = v_pos
       FROM public.event_registrations WHERE id = v_wait)
    AND (SELECT status = 'waitlist' AND payment_status = 'paid' AND waitlist_position > v_pos
                AND decision_source = 'capacity'
           FROM public.event_registrations WHERE id = v_other),
    '27/wplata-miejsca: gosc juz w kolejce zostaje na pozycji, drugi staje za nim - obaj oplaceni');
END $$;

DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.gfl_decide(pg_temp.gfl('m'), 'paid');
  PERFORM pg_temp.assert(v->>'status' = 'approved'
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.event_id = 'c7100000-0000-0000-0000-000000000004'
            AND r.status IN ('approved', 'attended', 'no_show')) = 3
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.group_lead_registration_id = pg_temp.gfl('m')
            AND r.status = 'approved' AND r.payment_status = 'paid') = 1
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.group_lead_registration_id = pg_temp.gfl('m')
            AND r.status = 'waitlist' AND r.payment_status = 'paid'
            AND r.decision_source = 'capacity') = 1,
    '27/wplata-miejsca: pojemnosc wydarzenia - przyjetych tylu, ile miejsc (3), nadmiarowy gosc w kolejce');
END $$;

SELECT pg_temp.gfl_group('f', 'c7000000-0000-0000-0000-000000000010',
  'c7200000-0000-0000-0000-00000000000c', 'gfl-approval',
  ARRAY['guest.f1@example.org', 'guest.f2@example.org']);
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('c7300000-0000-0000-0000-000000000006', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'solo.k12@example.org', 'Sam', 'Pula trzy F');
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, decided_at, decision_source)
VALUES
  ('c7400000-0000-0000-0000-000000000006', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
   'c7100000-0000-0000-0000-000000000001', 'c7300000-0000-0000-0000-000000000006',
   'c7200000-0000-0000-0000-00000000000c', 'approved', 'form', 'not_required', now(), 'system');
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT 'c7600000-0000-0000-0000-000000000003', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
  'c7000000-0000-0000-0000-000000000010', 'pending', 30000, 'PLN',
  jsonb_build_object('event_id', 'c7100000-0000-0000-0000-000000000001',
                     'ticket_type_id', 'c7200000-0000-0000-0000-00000000000c',
                     'registration_id', pg_temp.gfl('f'));

DO $$
DECLARE v jsonb; v_in uuid; v_out uuid;
BEGIN
  -- Ta sama droga, co `markOneTimePaymentFailed`: wynik `unpaid` przypina
  -- zamowienie do nieoplaconego prowadzacego.
  v := public.payments_apply_event_ticket_outcome('c7600000-0000-0000-0000-000000000003', 'unpaid');
  PERFORM pg_temp.assert(
    (SELECT payment_status = 'unpaid' AND status = 'pending'
            AND payment_order_id = 'c7600000-0000-0000-0000-000000000003'
       FROM public.event_registrations WHERE id = pg_temp.gfl('f'))
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.group_lead_registration_id = pg_temp.gfl('f')
            AND r.status = 'pending' AND r.payment_status = 'unpaid'
            AND r.payment_order_id IS NULL) = 2
    AND (SELECT sold_count FROM public.event_ticket_types
          WHERE id = 'c7200000-0000-0000-0000-00000000000c') = 1,
    '27/wplata-miejsca: punkt wyjscia F - prowadzacy nosi nieudane zamowienie, goscie czekaja, pula zajeta w jednej trzeciej');

  v := pg_temp.gfl_decide(pg_temp.gfl('f'), 'paid');
  PERFORM pg_temp.assert(v->>'status' = 'approved'
    AND (SELECT status = 'approved' AND payment_status = 'paid'
                AND payment_order_id = 'c7600000-0000-0000-0000-000000000003'
           FROM public.event_registrations WHERE id = pg_temp.gfl('f')),
    '27/wplata-miejsca: przelew prowadzacego z nieudanym zamowieniem zaksiegowany mimo ciasnej puli (zamowienie zostaje przy nim)');
  SELECT r.id INTO v_in FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('f') AND r.status = 'approved';
  SELECT r.id INTO v_out FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('f') AND r.status = 'waitlist';
  PERFORM pg_temp.assert(
    (SELECT payment_status = 'paid' AND qr_token_hash IS NOT NULL
            AND decision_source = 'organizer' AND payment_order_id IS NULL
       FROM public.event_registrations WHERE id = v_in)
    AND (SELECT payment_status = 'paid' AND waitlist_position > 0
                AND decision_source = 'capacity' AND payment_order_id IS NULL
           FROM public.event_registrations WHERE id = v_out),
    '27/wplata-miejsca: reczna wplata mimo zamowienia - gosc na ostatnie miejsce, nadmiarowy w kolejce oplacony, zaden bez nieudanego zamowienia');
  PERFORM pg_temp.assert(
    (SELECT sold_count = 3 AND sold_count <= quota FROM public.event_ticket_types
      WHERE id = 'c7200000-0000-0000-0000-00000000000c'),
    '27/wplata-miejsca: F - sprzedane = pula (3), bez przekroczenia');
END $$;

-- ---------------------------------------------------------------------------
-- 5) ODRZUCENIE I ANULOWANIE PROWADZACEGO
-- ---------------------------------------------------------------------------
SELECT pg_temp.gfl_group('r', 'c7000000-0000-0000-0000-000000000004',
  'c7200000-0000-0000-0000-000000000001', 'gfl-approval',
  ARRAY['guest.r1@example.org', 'guest.r2@example.org']);
SELECT pg_temp.gfl_group('c', 'c7000000-0000-0000-0000-000000000005',
  'c7200000-0000-0000-0000-000000000001', 'gfl-approval',
  ARRAY['guest.c1@example.org', 'guest.c2@example.org']);

DO $$
DECLARE v jsonb;
BEGIN
  -- Jeden gosc przyjety osobno - odrzucenie prowadzacego go NIE rusza.
  v := pg_temp.gfl_decide(pg_temp.gfl('r_g1'), 'approve');
  v := pg_temp.gfl_decide(pg_temp.gfl('r'), 'reject', 'Zgloszenie niekompletne');
  PERFORM pg_temp.assert(
    (SELECT status = 'rejected' AND decision_note = 'Zgloszenie niekompletne'
            AND decision_source = 'organizer'
            AND decided_by = 'c7000000-0000-0000-0000-0000000000a1'
            AND cancelled_at IS NULL AND qr_token_hash IS NULL
       FROM public.event_registrations WHERE id = pg_temp.gfl('r_g2')),
    '27/odrzucenie: czekajacy gosc odrzucony z powodem prowadzacego');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND qr_token_hash IS NOT NULL
       FROM public.event_registrations WHERE id = pg_temp.gfl('r_g1')),
    '27/odrzucenie: gosc JUZ przyjety zostaje nietkniety');

  -- Anulowanie bez powodu: gosc w kolejce traci pozycje, gosc z wlasna
  -- notatka ja zachowuje.
  UPDATE public.event_registrations SET status = 'waitlist',
    waitlist_position = public._event_next_waitlist_position(
      'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7', 'c7100000-0000-0000-0000-000000000001')
  WHERE id = pg_temp.gfl('c_g1');
  UPDATE public.event_registrations SET decision_note = 'Notatka goscia'
  WHERE id = pg_temp.gfl('c_g2');
  v := pg_temp.gfl_decide(pg_temp.gfl('c'), 'cancel');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gfl('c')
        AND r.status = 'cancelled' AND r.cancelled_at IS NOT NULL
        AND r.waitlist_position IS NULL AND r.decision_source = 'organizer') = 2,
    '27/anulowanie: czekajacy goscie (takze z kolejki) anulowani z data');
  PERFORM pg_temp.assert(
    (SELECT decision_note FROM public.event_registrations WHERE id = pg_temp.gfl('c_g2'))
      = 'Notatka goscia',
    '27/anulowanie: anulowanie bez powodu nie kasuje notatki goscia');
END $$;

-- ---------------------------------------------------------------------------
-- 5b) PONOWNE PRZYJECIE PROWADZACEGO PRZYWRACA GOSCI ZAMKNIETYCH RAZEM Z NIM
-- ---------------------------------------------------------------------------
-- X: odrzucenie -> zatwierdzenie (bilet bezplatny bez limitu); jeden gosc
--    odrzucony wczesniej OSOBNO, osoba innego ma tymczasem wlasny aktywny zapis.
-- Y: anulowanie -> zatwierdzenie (bilet platny, goscie nieoplaceni); jeden gosc
--    wycofal sie wczesniej SAM.
-- K: (z 4b) odrzucenie -> zatwierdzenie przy pelnym wydarzeniu - przywrocony
--    gosc staje w kolejce.
SELECT pg_temp.gfl_group('x', 'c7000000-0000-0000-0000-000000000009',
  'c7200000-0000-0000-0000-000000000001', 'gfl-approval',
  ARRAY['guest.x1@example.org', 'guest.x2@example.org', 'guest.x3@example.org']);
SELECT pg_temp.gfl_group('y', 'c7000000-0000-0000-0000-00000000000a',
  'c7200000-0000-0000-0000-000000000003', 'gfl-approval',
  ARRAY['guest.y1@example.org', 'guest.y2@example.org']);

DO $$
DECLARE
  v jsonb;
  n integer;
  v_lead uuid := pg_temp.gfl('x');
  x1 uuid := pg_temp.gfl('x_g1');
  x2 uuid := pg_temp.gfl('x_g2');
  x3 uuid := pg_temp.gfl('x_g3');
BEGIN
  PERFORM pg_temp.assert(
    NOT public._event_guest_closed_with_lead(
      (SELECT r FROM public.event_registrations r WHERE r.id = x2),
      (SELECT l FROM public.event_registrations l WHERE l.id = v_lead)),
    '27/przywrocenie: prowadzacy czeka - predykat stempla nie trafia (galaz ELSE)');

  -- X1 odrzucony osobno GODZINE wczesniej (patrz naglowek: jedno now()).
  v := pg_temp.gfl_decide(x1, 'reject', 'Osobny powod');
  UPDATE public.event_registrations SET decided_at = now() - interval '1 hour' WHERE id = x1;

  v := pg_temp.gfl_decide(v_lead, 'reject', 'Pomylka organizatora');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id IN (x2, x3) AND r.status = 'rejected'
        AND r.decision_note = 'Pomylka organizatora'
        AND public._event_guest_closed_with_lead(r,
              (SELECT l FROM public.event_registrations l WHERE l.id = v_lead))) = 2
    AND NOT public._event_guest_closed_with_lead(
      (SELECT r FROM public.event_registrations r WHERE r.id = x1),
      (SELECT l FROM public.event_registrations l WHERE l.id = v_lead)),
    '27/przywrocenie: odrzucenie stempluje gosci decyzja prowadzacego, gosc odrzucony osobno ma wlasny stempel');

  -- Panel liczy przy prowadzacym gosci, ktorzy wroca razem z nim.
  PERFORM pg_temp.gfl_admin();
  SELECT l.guest_count INTO n
  FROM public.admin_event_registration_group_links(
    'c7100000-0000-0000-0000-000000000001', ARRAY[v_lead]) l;
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(n = 2,
    '27/przywrocenie: panel liczy przy odrzuconym prowadzacym dwoch gosci zamknietych razem z nim');

  -- Osoba X3 zapisala sie tymczasem sama - drugi aktywny zapis tej osoby.
  INSERT INTO public.event_registrations
    (tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status)
  SELECT r.tenant_id, r.event_id, r.person_id, r.ticket_type_id, 'pending', 'form', 'not_required'
  FROM public.event_registrations r WHERE r.id = x3;

  v := pg_temp.gfl_decide(v_lead, 'approve');
  PERFORM pg_temp.assert(v->>'status' = 'approved',
    '27/przywrocenie: ponowne zatwierdzenie prowadzacego przechodzi (bez naruszenia active_uniq)');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND qr_token_hash IS NOT NULL AND waitlist_position IS NULL
            AND cancelled_at IS NULL AND decision_source = 'organizer'
            AND decided_by = 'c7000000-0000-0000-0000-0000000000a1'
            AND ticket_code_sent_at IS NULL
       FROM public.event_registrations WHERE id = x2),
    '27/przywrocenie: gosc odrzucony RAZEM z prowadzacym wraca przyjety, z nowym kodem');
  PERFORM pg_temp.assert(
    (SELECT status = 'rejected' AND decision_note = 'Osobny powod'
       FROM public.event_registrations WHERE id = x1),
    '27/przywrocenie: gosc odrzucony OSOBNO zostaje odrzucony');
  PERFORM pg_temp.assert(
    (SELECT status = 'rejected' FROM public.event_registrations WHERE id = x3),
    '27/przywrocenie: osoba z innym aktywnym zapisem zostaje zamknieta');
  PERFORM pg_temp.assert(x2 = ANY(public._event_ticket_codes_pending(500)),
    '27/przywrocenie: przywrocony gosc czeka w cronie na bilet');
END $$;

DO $$
DECLARE
  v jsonb;
  v_lead uuid := pg_temp.gfl('y');
  y1 uuid := pg_temp.gfl('y_g1');
  y2 uuid := pg_temp.gfl('y_g2');
BEGIN
  -- Y2 wycofal sie sam GODZINE wczesniej.
  UPDATE public.event_registrations
  SET status = 'cancelled', cancelled_at = now() - interval '1 hour'
  WHERE id = y2;

  v := pg_temp.gfl_decide(v_lead, 'cancel');
  PERFORM pg_temp.assert(
    (SELECT r.status = 'cancelled' AND r.payment_status = 'unpaid'
            AND r.cancelled_at = l.cancelled_at
       FROM public.event_registrations r, public.event_registrations l
      WHERE r.id = y1 AND l.id = v_lead),
    '27/przywrocenie: anulowanie stempluje czekajacego goscia data anulowania prowadzacego');

  v := pg_temp.gfl_decide(v_lead, 'approve');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'unpaid' AND qr_token_hash IS NULL
       FROM public.event_registrations WHERE id = v_lead),
    '27/przywrocenie: prowadzacy przywrocony z anulowania - przyjety, nadal nieoplacony');
  PERFORM pg_temp.assert(
    (SELECT status = 'pending' AND payment_status = 'unpaid' AND cancelled_at IS NULL
            AND decided_at IS NULL AND decided_by IS NULL AND decision_source IS NULL
            AND waitlist_position IS NULL AND qr_token_hash IS NULL
       FROM public.event_registrations WHERE id = y1),
    '27/przywrocenie: nieoplacony gosc wraca do `pending` - czeka na wplate jak przy dopisaniu');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND cancelled_at < now()
       FROM public.event_registrations WHERE id = y2),
    '27/przywrocenie: gosc wycofany SAM zostaje wycofany');
END $$;

DO $$
DECLARE v jsonb; v_in uuid; v_out uuid;
BEGIN
  SELECT r.id INTO v_in FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('k') AND r.status = 'approved';
  SELECT r.id INTO v_out FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gfl('k') AND r.status = 'waitlist';

  v := pg_temp.gfl_decide(pg_temp.gfl('k'), 'reject', 'Pomylka przy liscie');
  PERFORM pg_temp.assert(
    (SELECT status = 'rejected' AND waitlist_position IS NULL
       FROM public.event_registrations WHERE id = v_out)
    AND (SELECT status = 'approved' FROM public.event_registrations WHERE id = v_in),
    '27/przywrocenie: odrzucenie prowadzacego zamyka goscia z kolejki, przyjetego nie rusza');

  v := pg_temp.gfl_decide(pg_temp.gfl('k'), 'approve');
  PERFORM pg_temp.assert(v->>'status' = 'approved'
    AND (SELECT status = 'waitlist' AND waitlist_position > 0 AND decision_source = 'capacity'
                AND decided_by IS NULL AND cancelled_at IS NULL AND qr_token_hash IS NULL
           FROM public.event_registrations WHERE id = v_out)
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.event_id = 'c7100000-0000-0000-0000-000000000003'
            AND r.status IN ('approved', 'attended', 'no_show')) = 2,
    '27/przywrocenie: przywrocony gosc bez miejsca staje w kolejce - wydarzenie nie przepelnione');
END $$;

-- Predykat stempla po kazdym czlonie: kopia wiersza goscia rozni sie od
-- prowadzacego JEDNYM polem naraz.
DO $$
DECLARE
  g public.event_registrations;
  l public.event_registrations;
  c public.event_registrations;
BEGIN
  SELECT * INTO l FROM public.event_registrations WHERE id = pg_temp.gfl('r');
  SELECT * INTO g FROM public.event_registrations WHERE id = pg_temp.gfl('r_g2');
  PERFORM pg_temp.assert(public._event_guest_closed_with_lead(g, l),
    '27/predykat: gosc odrzucony razem z prowadzacym - trafienie');
  c := g; c.decided_by := NULL;
  PERFORM pg_temp.assert(NOT public._event_guest_closed_with_lead(c, l),
    '27/predykat: inny decydujacy - to nie ta decyzja');
  c := g; c.group_lead_registration_id := pg_temp.gfl('c');
  PERFORM pg_temp.assert(NOT public._event_guest_closed_with_lead(c, l),
    '27/predykat: gosc innego prowadzacego');
  c := g; c.tenant_id := 'c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8';
  PERFORM pg_temp.assert(NOT public._event_guest_closed_with_lead(c, l),
    '27/predykat: obcy najemca');
  c := g; c.status := 'cancelled';
  PERFORM pg_temp.assert(NOT public._event_guest_closed_with_lead(c, l),
    '27/predykat: inny status niz prowadzacy');
  c := g; c.payment_status := 'refunded';
  PERFORM pg_temp.assert(NOT public._event_guest_closed_with_lead(c, l),
    '27/predykat: zwrot nie wraca');
  c := g; c.group_lead_registration_id := NULL;
  PERFORM pg_temp.assert(public._event_guest_closed_with_lead(c, l) IS FALSE,
    '27/predykat: NULL w porownaniu daje false, nie NULL');

  SELECT * INTO l FROM public.event_registrations WHERE id = pg_temp.gfl('c');
  SELECT * INTO g FROM public.event_registrations WHERE id = pg_temp.gfl('c_g1');
  PERFORM pg_temp.assert(public._event_guest_closed_with_lead(g, l),
    '27/predykat: gosc anulowany razem z prowadzacym - ta sama data');
  c := g; c.cancelled_at := g.cancelled_at - interval '1 minute';
  PERFORM pg_temp.assert(NOT public._event_guest_closed_with_lead(c, l),
    '27/predykat: inna data anulowania - wycofal sie osobno');
END $$;

-- ---------------------------------------------------------------------------
-- 5c) KTO ZAMKNAL GOSCIA: SAMODZIELNE ANULOWANIE PROWADZACEGO
-- ---------------------------------------------------------------------------
-- Organizator zatwierdza nieoplaconego prowadzacego (goscie czekaja na
-- wplate), a potem prowadzacy SAM sie wycofuje (`event_registration_cancel`).
-- Wycofanie nie rusza `decided_*` prowadzacego - bez warunku stempla kaskada
-- zapisalaby gosciom „anulowal organizator" za dawne zatwierdzenie. Gosc
-- dostaje `system` bez autora i zachowuje wlasna notatke, a przywrocenie po
-- ponownym zatwierdzeniu nadal dziala (idzie po `cancelled_at`). Na koniec
-- kontrola dodatnia: anulowanie PRZEZ ORGANIZATORA prowadzacego przyjetego
-- WCZESNIEJ (stempel decyzji sie zmienia) - slad organizatora wraca.
SELECT pg_temp.gfl_group('s', 'c7000000-0000-0000-0000-00000000000c',
  'c7200000-0000-0000-0000-000000000003', 'gfl-approval',
  ARRAY['guest.s1@example.org']);

DO $$
DECLARE v jsonb; v_lead uuid := pg_temp.gfl('s'); s1 uuid := pg_temp.gfl('s_g1');
BEGIN
  v := pg_temp.gfl_decide(v_lead, 'approve');
  UPDATE public.event_registrations SET decision_note = 'Notatka goscia S' WHERE id = s1;
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'unpaid'
            AND decided_by = 'c7000000-0000-0000-0000-0000000000a1'
       FROM public.event_registrations WHERE id = v_lead)
    AND (SELECT status = 'pending' FROM public.event_registrations WHERE id = s1),
    '27/samoanulowanie: punkt wyjscia - prowadzacy zatwierdzony przez organizatora, gosc czeka na wplate');

  PERFORM pg_temp.act_as('c7000000-0000-0000-0000-00000000000c', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7');
  v := public.event_registration_cancel(jsonb_build_object('registration_id', v_lead));
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(v->>'status' = 'cancelled'
    AND (SELECT decided_by = 'c7000000-0000-0000-0000-0000000000a1' AND decision_source = 'organizer'
           FROM public.event_registrations WHERE id = v_lead),
    '27/samoanulowanie: prowadzacy wycofal sie sam - jego wlasny slad decyzji zostaje nietkniety');
  PERFORM pg_temp.assert(
    (SELECT r.status = 'cancelled' AND r.cancelled_at = l.cancelled_at
            AND r.decided_by IS NULL AND r.decision_source = 'system' AND r.decided_at IS NOT NULL
            AND r.decision_note = 'Notatka goscia S'
       FROM public.event_registrations r, public.event_registrations l
      WHERE r.id = s1 AND l.id = v_lead),
    '27/samoanulowanie: gosc zamkniety BEZ autora (system), z data prowadzacego i wlasna notatka');
  PERFORM pg_temp.assert(
    public._event_guest_closed_with_lead(
      (SELECT r FROM public.event_registrations r WHERE r.id = s1),
      (SELECT l FROM public.event_registrations l WHERE l.id = v_lead)),
    '27/samoanulowanie: predykat stempla nadal rozpoznaje goscia zamknietego razem z prowadzacym');

  v := pg_temp.gfl_decide(v_lead, 'approve');
  PERFORM pg_temp.assert(
    (SELECT status = 'pending' AND payment_status = 'unpaid' AND cancelled_at IS NULL
            AND decided_by IS NULL AND decided_at IS NULL AND decision_source IS NULL
       FROM public.event_registrations WHERE id = s1),
    '27/samoanulowanie: ponowne zatwierdzenie prowadzacego przywraca goscia do oczekiwania na wplate');

  -- Kontrola dodatnia: przyjety GODZINE wczesniej, anulowany przez organizatora.
  UPDATE public.event_registrations SET decided_at = now() - interval '1 hour' WHERE id = v_lead;
  v := pg_temp.gfl_decide(v_lead, 'cancel', 'Organizator odwoluje grupe');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND decided_by = 'c7000000-0000-0000-0000-0000000000a1'
            AND decision_source = 'organizer' AND decision_note = 'Organizator odwoluje grupe'
       FROM public.event_registrations WHERE id = s1),
    '27/samoanulowanie: anulowanie przez organizatora (nowy stempel decyzji) niesie jego slad i powod');
END $$;

-- ---------------------------------------------------------------------------
-- 6) NIEOPLACENI GOSCIE CZEKAJA NA WPLATE
-- ---------------------------------------------------------------------------
SELECT pg_temp.gfl_group('u', 'c7000000-0000-0000-0000-000000000006',
  'c7200000-0000-0000-0000-000000000003', 'gfl-approval',
  ARRAY['guest.u1@example.org', 'guest.u2@example.org']);

DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.gfl_decide(pg_temp.gfl('u'), 'approve');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'unpaid' AND qr_token_hash IS NULL
       FROM public.event_registrations WHERE id = pg_temp.gfl('u')),
    '27/wplata: prowadzacy przyjety bez wplaty - bez kodu');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gfl('u')
        AND r.status = 'pending' AND r.payment_status = 'unpaid') = 2,
    '27/wplata: nieoplaceni goscie zostaja pending - miejsca bez wplaty nie zajmuja');
END $$;

SELECT pg_temp.gfl_admin();
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_ticket_resend(%L::uuid)', pg_temp.gfl('u')),
  'ticket_not_issuable', '27/ponowna: przyjety, ale nieoplacony - bilet sie nie nalezy');
SELECT pg_temp.act_as();

INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT 'c7600000-0000-0000-0000-000000000001', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
  'c7000000-0000-0000-0000-000000000006', 'paid', 30000, 'PLN',
  jsonb_build_object('event_id', 'c7100000-0000-0000-0000-000000000001',
                     'ticket_type_id', 'c7200000-0000-0000-0000-000000000003',
                     'registration_id', pg_temp.gfl('u'));

DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('c7600000-0000-0000-0000-000000000001', 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean, '27/wplata: wplata prowadzacego zaksiegowana');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gfl('u')
        AND r.status = 'approved' AND r.payment_status = 'paid'
        AND r.payment_order_id = 'c7600000-0000-0000-0000-000000000001') = 2,
    '27/wplata: wplata przyjmuje i oplaca czekajacych gosci');
  PERFORM pg_temp.assert(pg_temp.gfl_issue_all(pg_temp.gfl('u')) = 3,
    '27/wplata: bilet dostaje prowadzacy i kazdy gosc');
END $$;

-- ---------------------------------------------------------------------------
-- 7) RECZNE `paid` / `refund` ORGANIZATORA I GALEZIE WYNIKU PLATNOSCI
-- ---------------------------------------------------------------------------
SELECT pg_temp.gfl_group('p', 'c7000000-0000-0000-0000-000000000007',
  'c7200000-0000-0000-0000-000000000003', 'gfl-approval',
  ARRAY['guest.p1@example.org', 'guest.p2@example.org', 'guest.p3@example.org',
        'guest.p4@example.org']);

INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
VALUES ('c7600000-0000-0000-0000-000000000002', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
  'c7000000-0000-0000-0000-000000000007', 'paid', 10000, 'PLN', '{}'::jsonb);

DO $$
DECLARE
  v jsonb;
  v_lead uuid := pg_temp.gfl('p');
  g1 uuid := pg_temp.gfl('p_g1');
  g2 uuid := pg_temp.gfl('p_g2');
  g3 uuid := pg_temp.gfl('p_g3');
  g4 uuid := pg_temp.gfl('p_g4');
BEGIN
  -- Gosc z WLASNYM zamowieniem, gosc wycofany i gosc ODRZUCONY przed wplata.
  UPDATE public.event_registrations SET payment_order_id = 'c7600000-0000-0000-0000-000000000002'
  WHERE id = g2;
  v := pg_temp.gfl_decide(g3, 'cancel');
  UPDATE public.event_registrations SET cancelled_at = now() - interval '1 hour' WHERE id = g3;
  v := pg_temp.gfl_decide(g4, 'reject', 'Gosc nie wpuszczony');

  v := pg_temp.gfl_decide(v_lead, 'paid');
  PERFORM pg_temp.assert(
    (SELECT payment_status = 'paid' AND status = 'approved' AND payment_order_id IS NULL
       FROM public.event_registrations WHERE id = v_lead),
    '27/reczna: organizator ksieguje wplate bez zamowienia');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'paid' AND payment_order_id IS NULL
            AND qr_token_hash IS NOT NULL
       FROM public.event_registrations WHERE id = g1),
    '27/reczna: wplata bez zamowienia dociera do goscia');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'paid'
            AND payment_order_id = 'c7600000-0000-0000-0000-000000000002'
       FROM public.event_registrations WHERE id = g2),
    '27/reczna: gosc zachowuje wlasne zamowienie (COALESCE, nie nadpisanie NULL-em)');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND payment_status = 'unpaid'
       FROM public.event_registrations WHERE id = g3)
    AND (SELECT status = 'rejected' AND payment_status = 'unpaid'
           FROM public.event_registrations WHERE id = g4),
    '27/reczna: gosc wycofany i odrzucony przed wplata zostaja zamknieci i nieoplaceni');

  -- Zmiana BEZ zmiany rozliczenia nie dotyka gosci: gosc chwilowo nieoplacony
  -- zostaje nieoplacony, choc prowadzacy "przepisal" swoje `paid`.
  UPDATE public.event_registrations SET payment_status = 'unpaid' WHERE id = g1;
  UPDATE public.event_registrations SET decision_note = 'Przelew', payment_status = 'paid'
  WHERE id = v_lead;
  PERFORM pg_temp.assert(
    (SELECT payment_status FROM public.event_registrations WHERE id = g1) = 'unpaid',
    '27/wynik: rozliczenie prowadzacego bez zmiany nie odpala kaskady');
  UPDATE public.event_registrations SET payment_status = 'paid' WHERE id = g1;
  -- Wynik `unpaid` nie cofa oplaconych gosci.
  UPDATE public.event_registrations SET payment_status = 'unpaid' WHERE id = v_lead;
  PERFORM pg_temp.assert(
    (SELECT payment_status FROM public.event_registrations WHERE id = g1) = 'paid'
    AND (SELECT payment_status FROM public.event_registrations WHERE id = g3) = 'unpaid',
    '27/wynik: `unpaid` prowadzacego nie cofa oplaconego goscia');
  UPDATE public.event_registrations SET payment_status = 'paid' WHERE id = v_lead;

  -- ZWROT CZESCIOWY: tylko ci, ktorzy zaplacili.
  UPDATE public.event_registrations SET payment_status = 'partially_refunded' WHERE id = v_lead;
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id IN (g1, g2) AND r.payment_status = 'partially_refunded') = 2
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.id IN (g3, g4) AND r.payment_status = 'unpaid') = 2,
    '27/wynik: zwrot czesciowy prowadzacego przenosi sie na oplaconych gosci, nieoplaconych omija');
  UPDATE public.event_registrations SET payment_status = 'paid' WHERE id = v_lead;
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id IN (g1, g2) AND r.payment_status = 'paid') = 2,
    '27/wynik: ponowna wplata prowadzacego wraca do oplaconych gosci');

  -- Przed pelnym zwrotem: G2 z wlasnym zwrotem czesciowym, G1 - udajemy gosc
  -- znowu czekajacy na wplate (np. cofniety recznie). Zwrot NIE moze dac mu
  -- `refunded`; zamyka go kaskada statusu, bo zwrot anuluje prowadzacego.
  UPDATE public.event_registrations SET payment_status = 'partially_refunded' WHERE id = g2;
  UPDATE public.event_registrations SET status = 'pending', payment_status = 'unpaid'
  WHERE id = g1;

  v := pg_temp.gfl_decide(v_lead, 'refund');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND cancelled_at IS NOT NULL AND payment_status = 'refunded'
            AND paid_at IS NULL AND payment_order_id = 'c7600000-0000-0000-0000-000000000002'
       FROM public.event_registrations WHERE id = g2),
    '27/reczna: zwrot organizatora anuluje i zwraca goscia, ktory zaplacil (takze czesciowo zwroconego), zamowienie goscia zostaje');
  PERFORM pg_temp.assert(
    (SELECT r.status = 'cancelled' AND r.payment_status = 'unpaid'
            AND r.cancelled_at = l.cancelled_at
       FROM public.event_registrations r, public.event_registrations l
      WHERE r.id = g1 AND l.id = v_lead),
    '27/reczna: czekajacy nieoplacony gosc anulowany razem z prowadzacym - bez zwrotu, ktorego nie bylo');
  PERFORM pg_temp.assert(
    (SELECT status = 'rejected' AND payment_status = 'unpaid'
            AND decision_note = 'Gosc nie wpuszczony' AND cancelled_at IS NULL
       FROM public.event_registrations WHERE id = g4)
    AND (SELECT status = 'cancelled' AND payment_status = 'unpaid' AND cancelled_at < now()
           FROM public.event_registrations WHERE id = g3),
    '27/reczna: zwrot NIE rusza goscia odrzuconego ani wycofanego przed wplata');
  PERFORM pg_temp.assert(
    NOT public._event_guest_closed_with_lead(
      (SELECT r FROM public.event_registrations r WHERE r.id = g2),
      (SELECT l FROM public.event_registrations l WHERE l.id = v_lead))
    AND public._event_guest_closed_with_lead(
      (SELECT r FROM public.event_registrations r WHERE r.id = g1),
      (SELECT l FROM public.event_registrations l WHERE l.id = v_lead)),
    '27/reczna: zwrocony gosc nie wroci z prowadzacym, nieoplacony anulowany razem z nim - tak');
END $$;

-- ---------------------------------------------------------------------------
-- 8) CRON: SAMODZIELNY ZAPIS RSVP TAK, WPIS ORGANIZATORA NIE
-- ---------------------------------------------------------------------------
SELECT pg_temp.gfl_group('v', 'c7000000-0000-0000-0000-000000000008',
  'c7200000-0000-0000-0000-000000000004', 'gfl-rsvp',
  ARRAY['guest.v1@example.org', 'guest.v2@example.org']);

DO $$
DECLARE v jsonb; q uuid[]; v_org uuid; v_imp uuid;
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE (r.id = pg_temp.gfl('v') OR r.group_lead_registration_id = pg_temp.gfl('v'))
        AND r.registration_mode = 'rsvp' AND r.source = 'self_registration'
        AND r.status = 'pending') = 3,
    '27/rsvp: wydarzenie RSVP z akceptacja - zapis i goscie jako rsvp, czekaja');
  v := pg_temp.gfl_decide(pg_temp.gfl('v'), 'approve');

  PERFORM pg_temp.gfl_admin();
  v_org := public.admin_event_registration_upsert(jsonb_build_object(
    'event_id', 'c7100000-0000-0000-0000-000000000002',
    'ticket_type_id', 'c7200000-0000-0000-0000-000000000004',
    'email', 'wpis.organizatora@example.org', 'first_name', 'Wpis', 'last_name', 'Organizatora',
    'status', 'approved'));
  v_imp := public.admin_event_registration_upsert(jsonb_build_object(
    'event_id', 'c7100000-0000-0000-0000-000000000002',
    'ticket_type_id', 'c7200000-0000-0000-0000-000000000004',
    'email', 'wpis.importu@example.org', 'first_name', 'Wpis', 'last_name', 'Importu',
    'status', 'approved', 'source', 'import'));
  PERFORM pg_temp.act_as();

  q := public._event_ticket_codes_pending(500);
  PERFORM pg_temp.assert(
    pg_temp.gfl('v') = ANY(q) AND pg_temp.gfl('v_g1') = ANY(q) AND pg_temp.gfl('v_g2') = ANY(q),
    '27/rsvp: cron widzi przyjety zapis RSVP i jego gosci');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND registration_mode = 'rsvp' AND source = 'organizer'
            AND ticket_code_sent_at IS NULL
       FROM public.event_registrations WHERE id = v_org)
    AND NOT (v_org = ANY(q)) AND NOT (v_imp = ANY(q)),
    '27/rsvp: wpis organizatora i import NIE dostaja maila z crona');
END $$;

-- ---------------------------------------------------------------------------
-- 9) PANEL: POWIAZANIA GRUPY (`admin_event_registration_group_links`)
-- ---------------------------------------------------------------------------
-- Strona listy: wiersze, o ktore panel pyta. `a_g2` (wycofany gosc) NIE jest
-- na stronie - nie moze wrocic; `v` jest z innego wydarzenia.
CREATE TEMP TABLE gfl_page AS
SELECT ARRAY[
  pg_temp.gfl('a'), pg_temp.gfl('a_g1'), pg_temp.gfl('r'), pg_temp.gfl('c'),
  pg_temp.gfl('c_g1'), pg_temp.gfl('u_g1'), pg_temp.gfl('v'),
  'c7400000-0000-0000-0000-000000000001'::uuid, 'c7400000-0000-0000-0000-000000000002'::uuid
] AS ids;

SELECT pg_temp.gfl_admin();
CREATE TEMP TABLE gfl_links AS
  SELECT * FROM public.admin_event_registration_group_links(
    'c7100000-0000-0000-0000-000000000001', (SELECT ids FROM gfl_page));
SELECT pg_temp.act_as();

DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT group_lead_registration_id = pg_temp.gfl('a') AND lead_first_name = 'Lider'
            AND lead_last_name = 'A' AND guest_count = 0 AND payment_status = 'not_required'
            AND ticket_code_sent_at IS NOT NULL
       FROM gfl_links WHERE registration_id = pg_temp.gfl('a_g1')),
    '27/panel: gosc wskazuje prowadzacego z imieniem i nazwiskiem, bilet wyslany');
  PERFORM pg_temp.assert(
    (SELECT group_lead_registration_id IS NULL AND lead_first_name IS NULL AND guest_count = 1
       FROM gfl_links WHERE registration_id = pg_temp.gfl('a')),
    '27/panel: przyjety prowadzacy liczy AKTYWNYCH gosci (wycofany osobno sie nie liczy)');
  PERFORM pg_temp.assert(
    (SELECT guest_count = 2 FROM gfl_links WHERE registration_id = pg_temp.gfl('r')),
    '27/panel: odrzucony prowadzacy liczy gosci aktywnego i zamknietego razem z nim');
  PERFORM pg_temp.assert(
    (SELECT guest_count = 2 FROM gfl_links WHERE registration_id = pg_temp.gfl('c'))
    AND EXISTS (SELECT 1 FROM gfl_links WHERE registration_id = pg_temp.gfl('c_g1')),
    '27/panel: anulowany prowadzacy liczy gosci anulowanych razem z nim');
  PERFORM pg_temp.assert(
    (SELECT guest_count = 0 AND group_lead_registration_id IS NULL
            AND payment_status = 'not_required' AND ticket_code_sent_at IS NULL
       FROM gfl_links WHERE registration_id = 'c7400000-0000-0000-0000-000000000001')
    AND (SELECT guest_count = 0 AND ticket_code_sent_at IS NOT NULL FROM gfl_links
          WHERE registration_id = 'c7400000-0000-0000-0000-000000000002'),
    '27/panel: wiersze bez grupy ze strony wracaja bez prowadzacego i bez gosci');
  PERFORM pg_temp.assert(
    (SELECT payment_status FROM gfl_links WHERE registration_id = pg_temp.gfl('u_g1')) = 'paid',
    '27/panel: wiersz niesie rozliczenie (lista go nie oddaje)');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM gfl_links WHERE registration_id = pg_temp.gfl('v')),
    '27/panel: tylko wiersze wskazanego wydarzenia');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM gfl_links WHERE registration_id = pg_temp.gfl('a_g2'))
    AND (SELECT count(*) FROM gfl_links) = 8,
    '27/panel: tylko wiersze strony - spoza niej nic nie wraca');
END $$;

SELECT pg_temp.gfl_admin();
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_registration_group_links(
     'c7100000-0000-0000-0000-000000000001', NULL)) = 0,
  '27/panel: bez listy wierszy - pusty wynik, nie cale wydarzenie');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_registration_group_links(
     'c7100000-0000-0000-0000-000000000001',
     array_fill(pg_temp.gfl('a'), ARRAY[200]))) = 1,
  '27/panel: pelna strona (200) przechodzi');
SELECT pg_temp.assert_raises_like(
  format($sql$SELECT * FROM public.admin_event_registration_group_links(
    'c7100000-0000-0000-0000-000000000001', array_fill(%L::uuid, ARRAY[201]))$sql$,
    pg_temp.gfl('a')),
  'invalid_request', '27/panel: wiecej niz strona - odmowa');

SELECT pg_temp.act_as('c8000000-0000-0000-0000-0000000000a1', 'c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_registration_group_links(
     'c7100000-0000-0000-0000-000000000001', (SELECT ids FROM gfl_page))) = 0,
  '27/panel: administrator OBCEGO najemcy nie widzi ani jednego wiersza');
SELECT pg_temp.act_as('c7000000-0000-0000-0000-0000000000e1', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7');
SELECT pg_temp.assert_raises_like(
  $sql$SELECT * FROM public.admin_event_registration_group_links('c7100000-0000-0000-0000-000000000001', ARRAY[]::uuid[])$sql$,
  'forbidden: admin role required', '27/panel: redaktor odbity - bramka jak lista zgloszen');
SELECT pg_temp.act_as('c7000000-0000-0000-0000-0000000000b1', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7');
SELECT pg_temp.assert_raises_like(
  $sql$SELECT * FROM public.admin_event_registration_group_links('c7100000-0000-0000-0000-000000000001', ARRAY[]::uuid[])$sql$,
  'forbidden', '27/panel: zwykle konto odbite');
SELECT pg_temp.act_as();
SELECT pg_temp.assert_raises_like(
  $sql$SELECT * FROM public.admin_event_registration_group_links('c7100000-0000-0000-0000-000000000001', ARRAY[]::uuid[])$sql$,
  'forbidden: authentication required', '27/panel: anonim odbity');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_registration_group_links(uuid, uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_registration_group_links(uuid, uuid[])', 'EXECUTE'),
  '27/panel: EXECUTE dla authenticated, nie dla anon');

-- ---------------------------------------------------------------------------
-- 10) PONOWNA WYSYLKA (`admin_event_ticket_resend`)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_root uuid; v_lead uuid := pg_temp.gfl('a'); g1 uuid := pg_temp.gfl('a_g1');
BEGIN
  -- Gosc wycofany ze znacznikiem - dowod, ze niekwalifikujacy sie wiersz grupy
  -- zostaje nietkniety.
  UPDATE public.event_registrations SET ticket_code_sent_at = now() - interval '2 days'
  WHERE id = pg_temp.gfl('a_g2');

  PERFORM pg_temp.gfl_admin();
  v_root := public.admin_event_ticket_resend(g1);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(v_root = v_lead,
    '27/ponowna: z grupa (domyslnie) korzeniem jest prowadzacy');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations
      WHERE id IN (v_lead, g1) AND ticket_code_sent_at IS NULL AND ticket_code_claimed_at IS NULL) = 2
    AND (SELECT ticket_code_sent_at IS NOT NULL FROM public.event_registrations
          WHERE id = pg_temp.gfl('a_g2')),
    '27/ponowna: przyjeci z grupy traca znacznik, wycofany gosc nie');
  PERFORM pg_temp.assert(pg_temp.gfl_issue_all(v_root) = 2,
    '27/ponowna: wydanie od korzenia daje nowe bilety calej przyjetej grupie');

  PERFORM pg_temp.gfl_admin();
  v_root := public.admin_event_ticket_resend(g1, false);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(v_root = g1
    AND (SELECT ticket_code_sent_at IS NULL FROM public.event_registrations WHERE id = g1)
    AND (SELECT ticket_code_sent_at IS NOT NULL FROM public.event_registrations WHERE id = v_lead),
    '27/ponowna: bez grupy - tylko ten wiersz, prowadzacy zachowuje bilet');
  PERFORM pg_temp.assert(pg_temp.gfl_issue_all(v_root) = 1,
    '27/ponowna: wydanie bez grupy rotuje kod tylko temu gosciowi');

  PERFORM pg_temp.gfl_admin();
  v_root := public.admin_event_ticket_resend(g1, NULL);
  PERFORM pg_temp.assert(v_root = v_lead, '27/ponowna: NULL znaczy domyslne "z grupa"');
  v_root := public.admin_event_ticket_resend('c7400000-0000-0000-0000-000000000002');
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(v_root = 'c7400000-0000-0000-0000-000000000002'
    AND (SELECT ticket_code_sent_at IS NULL FROM public.event_registrations
          WHERE id = 'c7400000-0000-0000-0000-000000000002'),
    '27/ponowna: wiersz bez grupy jest wlasnym korzeniem');
END $$;

-- ZYWA DZIERZAWA: bilet wlasnie wychodzi - ponowna wysylka nie moze wydac
-- kodu od nowa, bo mail w drodze nioslby kod, ktory juz nie wpuszcza.
DO $$
DECLARE v_root uuid; v_lead uuid := pg_temp.gfl('a'); g1 uuid := pg_temp.gfl('a_g1');
BEGIN
  UPDATE public.event_registrations SET ticket_code_sent_at = NULL, ticket_code_claimed_at = now()
  WHERE id = g1;
  PERFORM pg_temp.gfl_admin();
  PERFORM pg_temp.assert_raises_like(
    format('SELECT public.admin_event_ticket_resend(%L::uuid)', g1),
    'ticket_send_in_progress',
    '27/dzierzawa: wskazany wiersz w trakcie wysylki - odmowa, kod w drodze nie rotuje');

  -- Prowadzacy WYSLANY trzyma swieza chwile zajecia po potwierdzeniu - to nie
  -- dzierzawa. Z grupa: prowadzacy do ponowienia, gosc w trakcie wysylki
  -- pominiety (jego bilet i tak zaraz wyjdzie).
  UPDATE public.event_registrations SET ticket_code_sent_at = now(), ticket_code_claimed_at = now()
  WHERE id = v_lead;
  v_root := public.admin_event_ticket_resend(v_lead);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(v_root = v_lead
    AND (SELECT ticket_code_sent_at IS NULL AND ticket_code_claimed_at IS NULL
           FROM public.event_registrations WHERE id = v_lead)
    AND (SELECT ticket_code_sent_at IS NULL AND ticket_code_claimed_at IS NOT NULL
           FROM public.event_registrations WHERE id = g1),
    '27/dzierzawa: wyslany prowadzacy do ponowienia, gosc w trakcie wysylki pominiety');

  -- Dzierzawa wygasla (proces padl w polowie) - ponowna wysylka ja zwalnia.
  UPDATE public.event_registrations SET ticket_code_claimed_at = now() - interval '20 minutes'
  WHERE id = g1;
  PERFORM pg_temp.gfl_admin();
  v_root := public.admin_event_ticket_resend(g1, false);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(v_root = g1
    AND (SELECT ticket_code_claimed_at IS NULL FROM public.event_registrations WHERE id = g1),
    '27/dzierzawa: wygasla dzierzawa nie blokuje - ponowna wysylka ja zwalnia');
END $$;

SELECT pg_temp.gfl_admin();
SELECT pg_temp.assert_raises_like(
  $sql$SELECT public.admin_event_ticket_resend('c7400000-0000-0000-0000-000000000001')$sql$,
  'ticket_not_issuable', '27/ponowna: oczekujacy - bilet sie nie nalezy');
SELECT pg_temp.assert_raises_like(
  $sql$SELECT public.admin_event_ticket_resend('c7400000-0000-0000-0000-0000000000ff')$sql$,
  'not_found: registration does not exist in this tenant', '27/ponowna: nieznane zgloszenie');
SELECT pg_temp.act_as('c8000000-0000-0000-0000-0000000000a1', 'c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_ticket_resend(%L::uuid)', pg_temp.gfl('a_g1')),
  'not_found', '27/ponowna: administrator OBCEGO najemcy nie wysle cudzego biletu');
SELECT pg_temp.act_as('c7000000-0000-0000-0000-0000000000b1', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_ticket_resend(%L::uuid)', pg_temp.gfl('a_g1')),
  'forbidden', '27/ponowna: zwykle konto odbite');
SELECT pg_temp.act_as();
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_ticket_resend(%L::uuid)', pg_temp.gfl('a_g1')),
  'forbidden: authentication required', '27/ponowna: anonim odbity');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_ticket_resend(uuid, boolean, uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_ticket_resend(uuid, boolean, uuid[])', 'EXECUTE')
  AND to_regprocedure('public.admin_event_ticket_resend(uuid, boolean)') IS NULL,
  '27/ponowna: EXECUTE dla authenticated, nie dla anon; stara sygnatura bez przeciazenia');

-- ---------------------------------------------------------------------------
-- 10b) ADRES Z LISTY WYKLUCZEN NIE TRACI BILETU (`p_exclude_ids`, zakres)
-- ---------------------------------------------------------------------------
-- Liste wykluczen zna serwer: czyta zakres (`admin_event_ticket_resend_scope`),
-- sprawdza adresy i podaje zablokowane wiersze w `p_exclude_ids`. Pominiety
-- wiersz ZACHOWUJE znacznik wysylki - wydanie od korzenia go nie rotuje.
DO $$
DECLARE
  v_root uuid;
  v_lead uuid := pg_temp.gfl('a');
  g1 uuid := pg_temp.gfl('a_g1');
  v_hash text;
  v_scope uuid[];
BEGIN
  -- Punkt wyjscia: obaj przyjeci z grupy maja wyslany bilet.
  UPDATE public.event_registrations SET ticket_code_claimed_at = NULL
  WHERE id IN (v_lead, g1);
  PERFORM pg_temp.gfl_issue_all(v_lead);
  SELECT qr_token_hash INTO v_hash FROM public.event_registrations WHERE id = g1;

  PERFORM pg_temp.gfl_admin();
  SELECT array_agg(sc.registration_id ORDER BY sc.ord) INTO v_scope
  FROM (SELECT x.*, row_number() OVER () AS ord
        FROM public.admin_event_ticket_resend_scope(g1) x) sc;
  PERFORM pg_temp.assert(v_scope = ARRAY[v_lead, g1],
    '27/zakres: z grupa - prowadzacy (korzen) pierwszy, potem przyjety gosc; wycofany gosc poza zakresem');
  PERFORM pg_temp.assert(
    (SELECT email = 'guest.a1@example.org' AND tenant_id = 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7'
       FROM public.admin_event_ticket_resend_scope(g1) WHERE registration_id = g1),
    '27/zakres: wiersz niesie adres i najemce - dla bramki listy wykluczen');
  PERFORM pg_temp.assert(
    (SELECT array_agg(registration_id) FROM public.admin_event_ticket_resend_scope(g1, false)) = ARRAY[g1]
    AND (SELECT array_agg(registration_id) FROM public.admin_event_ticket_resend_scope(g1, NULL))
        = ARRAY[v_lead, g1],
    '27/zakres: bez grupy - sam wiersz; NULL znaczy domyslne "z grupa"');

  v_root := public.admin_event_ticket_resend(g1, true, ARRAY[g1]);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(v_root = v_lead
    AND (SELECT ticket_code_sent_at IS NULL FROM public.event_registrations WHERE id = v_lead)
    AND (SELECT ticket_code_sent_at IS NOT NULL FROM public.event_registrations WHERE id = g1),
    '27/wykluczenia: prowadzacy do ponowienia, wykluczony gosc zachowuje znacznik wysylki');
  PERFORM pg_temp.assert(pg_temp.gfl_issue_all(v_root) = 1
    AND (SELECT qr_token_hash = v_hash FROM public.event_registrations WHERE id = g1),
    '27/wykluczenia: wydanie od korzenia NIE rotuje kodu wykluczonego goscia - jego bilet dziala');

  -- Zakres pomija wiersz w trakcie wysylki i wiersz nieprzyjety.
  UPDATE public.event_registrations SET ticket_code_sent_at = NULL, ticket_code_claimed_at = now()
  WHERE id = g1;
  PERFORM pg_temp.gfl_admin();
  PERFORM pg_temp.assert(
    (SELECT array_agg(registration_id) FROM public.admin_event_ticket_resend_scope(v_lead)) = ARRAY[v_lead]
    AND NOT EXISTS (SELECT 1 FROM public.admin_event_ticket_resend_scope(
      'c7400000-0000-0000-0000-000000000001'))
    AND NOT EXISTS (SELECT 1 FROM public.admin_event_ticket_resend_scope(
      'c7400000-0000-0000-0000-0000000000ff')),
    '27/zakres: gosc w trakcie wysylki, wiersz oczekujacy i nieznany - poza zakresem (pusty wynik, nie wyjatek)');
  PERFORM pg_temp.act_as();
  UPDATE public.event_registrations SET ticket_code_claimed_at = NULL WHERE id = g1;
END $$;

SELECT pg_temp.act_as('c8000000-0000-0000-0000-0000000000a1', 'c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.admin_event_ticket_resend_scope(pg_temp.gfl('a_g1'))),
  '27/zakres: administrator OBCEGO najemcy nie widzi cudzych adresow');
SELECT pg_temp.act_as('c7000000-0000-0000-0000-0000000000b1', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7');
SELECT pg_temp.assert_raises_like(
  format('SELECT * FROM public.admin_event_ticket_resend_scope(%L::uuid)', pg_temp.gfl('a_g1')),
  'forbidden', '27/zakres: zwykle konto odbite');
SELECT pg_temp.act_as();
SELECT pg_temp.assert_raises_like(
  format('SELECT * FROM public.admin_event_ticket_resend_scope(%L::uuid)', pg_temp.gfl('a_g1')),
  'forbidden: authentication required', '27/zakres: anonim odbity');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_ticket_resend_scope(uuid, boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_ticket_resend_scope(uuid, boolean)', 'EXECUTE'),
  '27/zakres: EXECUTE dla authenticated, nie dla anon');

-- ---------------------------------------------------------------------------
-- 10c) BILET NIEDORECZONY NIE UDAJE WYSLANEGO
-- ---------------------------------------------------------------------------
-- Czteroargumentowe `_event_ticket_code_confirm` z `p_undeliverable`; panel
-- czyta `ticket_code_undeliverable_at` z powiazan. Kazda droga, ktora kasuje
-- znacznik wysylki, kasuje tez ten.
DO $$
DECLARE
  v jsonb;
  v_root uuid;
  g1 uuid := pg_temp.gfl('a_g1');
  v_claim timestamptz;
  v_ok boolean;
  v_links record;
BEGIN
  PERFORM pg_temp.gfl_admin();
  v_root := public.admin_event_ticket_resend(g1, false);
  PERFORM pg_temp.act_as();

  v := public._event_issue_ticket_codes(g1);
  v_claim := (v->0->>'claimed_at')::timestamptz;
  PERFORM pg_temp.assert(
    NOT public._event_ticket_code_confirm(g1, v_claim - interval '1 minute', true, true),
    '27/niedoreczony: potwierdzenie cudzego zajecia niczego nie odnotowuje');
  -- Wywolanie w OSOBNEJ instrukcji: podzapytanie w tej samej instrukcji co
  -- funkcja zmieniajaca wiersz czyta migawke sprzed jej UPDATE.
  v_ok := public._event_ticket_code_confirm(g1, v_claim, true, true);
  PERFORM pg_temp.assert(v_ok
    AND (SELECT ticket_code_sent_at IS NOT NULL AND ticket_code_undeliverable_at IS NOT NULL
           FROM public.event_registrations WHERE id = g1),
    '27/niedoreczony: adres niedoreczalny zamyka zajecie ZE znacznikiem niedoreczenia');
  PERFORM pg_temp.assert(NOT (g1 = ANY(public._event_ticket_codes_pending(500))),
    '27/niedoreczony: zamkniety wiersz nie wraca do crona (kod nie rotuje co tick)');

  PERFORM pg_temp.gfl_admin();
  SELECT * INTO v_links FROM public.admin_event_registration_group_links(
    'c7100000-0000-0000-0000-000000000001', ARRAY[g1]);
  PERFORM pg_temp.assert(v_links.ticket_code_undeliverable_at IS NOT NULL
    AND v_links.ticket_code_sent_at IS NOT NULL,
    '27/niedoreczony: panel dostaje znacznik niedoreczenia obok znacznika wysylki');

  -- Ponowna wysylka kasuje oba znaczniki.
  v_root := public.admin_event_ticket_resend(g1, false);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NULL AND ticket_code_undeliverable_at IS NULL
       FROM public.event_registrations WHERE id = g1),
    '27/niedoreczony: ponowna wysylka kasuje znacznik niedoreczenia');

  -- Flaga `false` i NULL - zwykla wysylka, bez znacznika niedoreczenia.
  v := public._event_issue_ticket_codes(g1);
  v_ok := public._event_ticket_code_confirm(g1, (v->0->>'claimed_at')::timestamptz, true, false);
  PERFORM pg_temp.assert(v_ok
    AND (SELECT ticket_code_sent_at IS NOT NULL AND ticket_code_undeliverable_at IS NULL
           FROM public.event_registrations WHERE id = g1),
    '27/niedoreczony: p_undeliverable = false to zwykla wysylka');
  UPDATE public.event_registrations SET ticket_code_sent_at = NULL, ticket_code_claimed_at = NULL
  WHERE id = g1;
  v := public._event_issue_ticket_codes(g1);
  v_ok := public._event_ticket_code_confirm(g1, (v->0->>'claimed_at')::timestamptz, true, NULL);
  PERFORM pg_temp.assert(v_ok
    AND (SELECT ticket_code_undeliverable_at IS NULL FROM public.event_registrations WHERE id = g1),
    '27/niedoreczony: p_undeliverable = NULL nie udaje niedoreczenia');

  -- Nieudana wysylka zwalnia zajecie i nie zostawia znacznika mimo flagi.
  UPDATE public.event_registrations SET ticket_code_sent_at = NULL, ticket_code_claimed_at = NULL
  WHERE id = g1;
  v := public._event_issue_ticket_codes(g1);
  v_ok := public._event_ticket_code_confirm(g1, (v->0->>'claimed_at')::timestamptz, false, true);
  PERFORM pg_temp.assert(v_ok
    AND (SELECT ticket_code_sent_at IS NULL AND ticket_code_claimed_at IS NULL
                AND ticket_code_undeliverable_at IS NULL
           FROM public.event_registrations WHERE id = g1),
    '27/niedoreczony: nieudana wysylka zwalnia zajecie bez znacznika niedoreczenia');

  -- Wyjscie z przyjecia (trigger resetu) kasuje znacznik niedoreczenia.
  v := public._event_issue_ticket_codes(g1);
  PERFORM public._event_ticket_code_confirm(g1, (v->0->>'claimed_at')::timestamptz, true, true);
  v := pg_temp.gfl_decide(g1, 'reject', 'Adres zablokowany');
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NULL AND ticket_code_undeliverable_at IS NULL
       FROM public.event_registrations WHERE id = g1),
    '27/niedoreczony: wyjscie z przyjecia kasuje znacznik niedoreczenia');
  v := pg_temp.gfl_decide(g1, 'approve');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND ticket_code_undeliverable_at IS NULL
       FROM public.event_registrations WHERE id = g1)
    AND g1 = ANY(public._event_ticket_codes_pending(500)),
    '27/niedoreczony: ponownie przyjety wraca do crona bez znacznika niedoreczenia');
END $$;

SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated',
    'public._event_ticket_code_confirm(uuid, timestamptz, boolean, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public._event_ticket_code_confirm(uuid, timestamptz, boolean, boolean)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public._event_ticket_code_confirm(uuid, timestamptz, boolean, boolean)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public._event_ticket_code_confirm(uuid, timestamptz, boolean)', 'EXECUTE'),
  '27/niedoreczony: potwierdzenie z flaga tylko dla service_role, trojargumentowe z 0044 nadal dziala');

-- ---------------------------------------------------------------------------
-- 10d) NAPRAWA GOSCI UWIEZIONYCH PRZED MIGRACJA
-- ---------------------------------------------------------------------------
-- Stan sprzed migracji odtwarzamy INSERT-em (nie odpala kaskady statusu):
--   W1: bezplatny prowadzacy przyjety, dwoch gosci `pending`, pula 2 - jeden
--       gosc wchodzi, drugi do kolejki;
--   W2: prowadzacy oplacony RECZNIE (bez zamowienia), gosc `pending`
--       nieoplacony i gosc przyjety, ale nieoplacony (dopisany po
--       zatwierdzeniu, przed przelewem) - obaj rozliczeni i z biletem;
--   W3: prowadzacy `attended`, gosc `pending` - wchodzi;
--   W4: to samo co W3 na wydarzeniu, ktore sie skonczylo - nietkniete;
--   W5: prowadzacy przyjety, ale NIEOPLACONY - gosc czeka na wplate dalej.
-- `created_at` sprzed kilku dni: grupy W sa najstarsze, wiec `p_limit`
-- wybiera je deterministycznie przed grupami reszty pliku.
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
SELECT ('c7300000-0000-0000-0000-0000000000' || k)::uuid, 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
       'repair.' || k || '@example.org', 'Naprawa', upper(k)
FROM unnest(ARRAY['10','11','12','20','21','22','30','31','40','41','50','51']) AS k;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, source,
   payment_status, paid_at, decided_by, decided_at, decision_source, attended_at,
   group_lead_registration_id, created_at)
SELECT ('c7a00000-0000-0000-0000-0000000000' || w.k)::uuid, 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7',
       w.event_id::uuid, ('c7300000-0000-0000-0000-0000000000' || w.k)::uuid, w.ticket::uuid,
       w.status, 'form', 'self_registration', w.payment, w.paid_at,
       CASE WHEN w.status IN ('approved', 'attended') THEN 'c7000000-0000-0000-0000-0000000000a1'::uuid END,
       CASE WHEN w.status IN ('approved', 'attended') THEN now() - w.age END,
       CASE WHEN w.status IN ('approved', 'attended') THEN 'organizer' END,
       CASE WHEN w.status = 'attended' THEN now() - w.age END,
       CASE WHEN w.lead IS NOT NULL THEN ('c7a00000-0000-0000-0000-0000000000' || w.lead)::uuid END,
       now() - w.age + w.shift
FROM (VALUES
  ('10', NULL, 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-00000000000a',
   'approved', 'not_required', NULL::timestamptz, interval '10 days', interval '0 seconds'),
  ('11', '10', 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-00000000000a',
   'pending', 'not_required', NULL, interval '10 days', interval '1 second'),
  ('12', '10', 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-00000000000a',
   'pending', 'not_required', NULL, interval '10 days', interval '2 seconds'),
  ('20', NULL, 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-000000000003',
   'approved', 'paid', now() - interval '9 days', interval '9 days', interval '0 seconds'),
  ('21', '20', 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-000000000003',
   'pending', 'unpaid', NULL, interval '9 days', interval '1 second'),
  ('22', '20', 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-000000000003',
   'approved', 'unpaid', NULL, interval '9 days', interval '2 seconds'),
  ('30', NULL, 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-000000000001',
   'attended', 'not_required', NULL, interval '8 days', interval '0 seconds'),
  ('31', '30', 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-000000000001',
   'pending', 'not_required', NULL, interval '8 days', interval '1 second'),
  ('40', NULL, 'c7100000-0000-0000-0000-000000000005', 'c7200000-0000-0000-0000-00000000000b',
   'approved', 'not_required', NULL, interval '7 days', interval '0 seconds'),
  ('41', '40', 'c7100000-0000-0000-0000-000000000005', 'c7200000-0000-0000-0000-00000000000b',
   'pending', 'not_required', NULL, interval '7 days', interval '1 second'),
  ('50', NULL, 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-000000000003',
   'approved', 'unpaid', NULL, interval '6 days', interval '0 seconds'),
  ('51', '50', 'c7100000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-000000000003',
   'pending', 'unpaid', NULL, interval '6 days', interval '1 second')
) AS w(k, lead, event_id, ticket, status, payment, paid_at, age, shift)
ORDER BY w.lead NULLS FIRST, w.k;

-- Uprawnienia sprawdzamy PRZED wywolaniem: funkcja idzie po wszystkich
-- najemcach, wiec klient nie moze jej nawet dotknac.
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_group_repair_stranded_guests(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_group_repair_stranded_guests(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_group_repair_stranded_guests(integer)', 'EXECUTE'),
  '27/naprawa: tylko service_role - anon i authenticated bez EXECUTE');
SELECT pg_temp.act_as('c7000000-0000-0000-0000-0000000000a1', 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7');
SELECT pg_temp.assert_raises_like($sql$DO $d$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM public._event_group_repair_stranded_guests();
END $d$$sql$, 'permission denied', '27/naprawa: administrator najemcy (rola authenticated) odbity');
SELECT pg_temp.act_as();

DO $$
DECLARE
  n integer;
  v_before jsonb;
  v_after jsonb;
  v_in uuid;
  v_out uuid;
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations
      WHERE id::text LIKE 'c7a00000-%' AND group_lead_registration_id IS NOT NULL
        AND status = 'pending') = 6
    AND (SELECT sold_count FROM public.event_ticket_types
          WHERE id = 'c7200000-0000-0000-0000-00000000000a') = 1,
    '27/naprawa: punkt wyjscia - szesciu gosci uwiezionych za przyjetymi prowadzacymi');

  -- p_limit = 1: tylko najstarsza grupa (W1).
  n := public._event_group_repair_stranded_guests(1);
  SELECT id INTO v_in FROM public.event_registrations
  WHERE group_lead_registration_id = 'c7a00000-0000-0000-0000-000000000010' AND status = 'approved';
  SELECT id INTO v_out FROM public.event_registrations
  WHERE group_lead_registration_id = 'c7a00000-0000-0000-0000-000000000010' AND status = 'waitlist';
  PERFORM pg_temp.assert(n = 1
    AND v_in = 'c7a00000-0000-0000-0000-000000000011'
    AND v_out = 'c7a00000-0000-0000-0000-000000000012'
    AND (SELECT qr_token_hash IS NOT NULL AND ticket_code_sent_at IS NULL
                AND decision_source = 'organizer'
           FROM public.event_registrations WHERE id = v_in)
    AND (SELECT waitlist_position > 0 AND decision_source = 'capacity'
           FROM public.event_registrations WHERE id = v_out)
    AND (SELECT sold_count FROM public.event_ticket_types
          WHERE id = 'c7200000-0000-0000-0000-00000000000a') = 2
    AND (SELECT status FROM public.event_registrations
          WHERE id = 'c7a00000-0000-0000-0000-000000000031') = 'pending',
    '27/naprawa: p_limit 1 - tylko najstarsza grupa; pierwszy gosc na ostatnie miejsce, drugi do kolejki');
  PERFORM pg_temp.assert(v_in = ANY(public._event_ticket_codes_pending(500)),
    '27/naprawa: przyjety gosc czeka w cronie na bilet (mail wysle cron)');

  n := public._event_group_repair_stranded_guests();
  PERFORM pg_temp.assert(n = 3,
    '27/naprawa: reszta grup - bilet dostaje trzech gosci (W2 x2, W3), nikt spoza uwiezionych');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations
      WHERE id IN ('c7a00000-0000-0000-0000-000000000021', 'c7a00000-0000-0000-0000-000000000022')
        AND status = 'approved' AND payment_status = 'paid' AND paid_at IS NOT NULL
        AND payment_order_id IS NULL AND qr_token_hash IS NOT NULL) = 2,
    '27/naprawa: goscie recznie oplaconego prowadzacego rozliczeni i przyjeci (takze przyjety bez wplaty)');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND qr_token_hash IS NOT NULL
       FROM public.event_registrations WHERE id = 'c7a00000-0000-0000-0000-000000000031'),
    '27/naprawa: gosc prowadzacego obecnego na wydarzeniu przyjety');
  PERFORM pg_temp.assert(
    (SELECT status = 'pending' AND qr_token_hash IS NULL
       FROM public.event_registrations WHERE id = 'c7a00000-0000-0000-0000-000000000041')
    AND (SELECT status = 'pending' AND payment_status = 'unpaid'
           FROM public.event_registrations WHERE id = 'c7a00000-0000-0000-0000-000000000051'),
    '27/naprawa: zakonczone wydarzenie nietkniete, gosc nieoplaconego prowadzacego czeka na wplate');
  PERFORM pg_temp.assert(
    (SELECT status = 'waitlist' FROM public.event_registrations
      WHERE id = 'c7a00000-0000-0000-0000-000000000012'),
    '27/naprawa: brak miejsca nadal szanowany - gosc W1 zostaje w kolejce');

  -- Drugie wywolanie niczego nie zmienia.
  SELECT jsonb_agg(jsonb_build_array(id, status, payment_status, waitlist_position,
                                     qr_token_hash, decided_at, ticket_code_sent_at) ORDER BY id)
  INTO v_before FROM public.event_registrations WHERE group_lead_registration_id IS NOT NULL;
  n := public._event_group_repair_stranded_guests(NULL);
  SELECT jsonb_agg(jsonb_build_array(id, status, payment_status, waitlist_position,
                                     qr_token_hash, decided_at, ticket_code_sent_at) ORDER BY id)
  INTO v_after FROM public.event_registrations WHERE group_lead_registration_id IS NOT NULL;
  PERFORM pg_temp.assert(n = 0 AND v_after = v_before,
    '27/naprawa: drugie wywolanie (p_limit NULL = domyslny) oddaje 0 i nie zmienia zadnego goscia');
END $$;

-- ---------------------------------------------------------------------------
-- 11) FUNKCJE WEWNETRZNE: BEZ EXECUTE DLA KLIENTA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._tg_event_group_follow_lead_status()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tg_event_group_follow_lead_status()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tg_event_ticket_code_reset()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._tg_event_ticket_code_reset()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_assert_ticket_codes_schema()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public._event_guest_closed_with_lead(public.event_registrations, public.event_registrations)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public._event_guest_closed_with_lead(public.event_registrations, public.event_registrations)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public._event_apply_outcome_to_group(uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tg_event_group_follow_lead()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public._event_group_admit_guest(public.event_registrations, public.event_registrations)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public._event_group_admit_guest(public.event_registrations, public.event_registrations)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public._event_group_admit_guests(public.event_registrations, public.event_registrations)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public._event_group_admit_guests(public.event_registrations, public.event_registrations)', 'EXECUTE'),
  '27/uprawnienia: triggery, straznik, predykat stempla, przyjecie gosci i kaskada platnosci bez EXECUTE dla anon/authenticated');
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public._event_ticket_codes_pending(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_ticket_codes_pending(integer)', 'EXECUTE'),
  '27/uprawnienia: kolejka crona tylko dla service_role');

ROLLBACK;

SELECT set_config('nes.public_tenant', '', false);
SELECT pg_temp.act_as();
