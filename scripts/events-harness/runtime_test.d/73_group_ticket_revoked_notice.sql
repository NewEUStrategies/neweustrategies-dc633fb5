-- ============================================================================
-- 73_group_ticket_revoked_notice - ZAWIADOMIENIE O ODWOLANYM BILECIE GOSCIA
-- GRUPY (20260926150000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Od 20260926120000 odrzucenie, anulowanie i zwrot prowadzacego zamykaja takze
-- gosci JUZ przyjetych: skrot kodu QR znika, a bilet w skrzynce goscia
-- przestaje wpuszczac. Gosc nie dostawal o tym ani slowa - dowiadywal sie przy
-- bramce. 20260926150000 stempluje `ticket_revoked_at` TA SAMA instrukcja,
-- ktora zamyka goscia (kaskada statusu i galaz zwrotu), wylacznie gosciowi, do
-- ktorego bilet dotarl albo byl w drodze, a partie zawiadomien zajmuje
-- i rozlicza para funkcji service_role. Ten plik pilnuje kazdej galezi tych
-- warunkow - znacznik postawiony za szeroko to mail o bilecie, ktorego ktos
-- nigdy nie dostal; za waska - gosc przy bramce z martwym kodem.
--
-- CO SPRAWDZA
--   1. `_event_guest_ticket_reached`: wyslany, w drodze (zajety), adres
--      odrzucony, nieudana wysylka, obecny, nieobecny, NULL.
--   2. Kaskada odrzucenia: znacznik tylko u gosci, do ktorych bilet dotarl
--      albo byl w drodze; prowadzacy, obecny i niedoreczony bez znacznika;
--      wyrazenie SET widzi wiersz sprzed zamkniecia.
--   3. Zajecie i rozliczenie: ladunek maila, wspolna chwila zajecia, zywa
--      i wygasla dzierzawa, obce zajecie, done/retry, NULL-e, granice p_limit
--      (0 -> 1, NULL -> domyslny, 1000 -> 200), najstarsze najpierw, ksztalt
--      pustej partii.
--   4. Przywrocenie z prowadzacym: przyjety gosc zachowuje znacznik, ale nie
--      jest zajmowany; ponowne zamkniecie bez nowego biletu zachowuje stary
--      znacznik, z nowym biletem - nowy znacznik i zdjeta dzierzawa; gosc
--      przywrocony do kolejki (brak miejsca) dostaje zawiadomienie.
--   5. Zwrot organizatora, samodzielne wycofanie prowadzacego, zwrot Stripe.
--   6. Zamkniecie bez maila: `notify_email = false`, wydarzenie minelo (takze
--      bez `ends_at`, takze u goscia przyjetego ponownie).
--   7. Anulowanie prowadzacego przez organizatora (nowy stempel decyzji):
--      znacznik u przyjetego goscia z biletem, `attended`/`no_show` nietknieci.
--   8. Zwrot czesciowy (Stripe/organizator) nie stempluje nikogo; zwrot
--      czesciowy, ktory narastajaco pokrywa zamowienie, stempluje jak pelny.
--   9. Pelny zwrot: oplacony gosc w kolejce (brak miejsca) bez znacznika;
--      nieoplacony gosc pominiety przez galaz zwrotu, zamkniety kaskada, bez
--      znacznika (bilet do niego nie wyszedl).
--  10. Jedno zajecie niesie zawiadomienia DWOCH najemcow, kazde z wlasnym
--      wydarzeniem, prowadzacym i biletem.
--  11. Jezyk: newsletter najemcy (bez wzgledu na wielkosc liter adresu), gdy
--      profil nie ma preferencji; `prefs.lang`, gdy brak `prefs.language`;
--      pierwszenstwo profilu przed newsletterem; newsletter obcego najemcy
--      sie nie liczy.
--  12. Schemat (indeks czesciowy, komentarze kolumn) i granty.
--
-- CZEGO NIE SPRAWDZA
--   * wspolbieznosci zajecia (`FOR UPDATE OF reg SKIP LOCKED`): harness ma
--     jedna sesje, wiec dwoch rownoleglych tickow (minutowy tick
--     i `community-cron`) nie da sie tu odtworzyc - pomijanie zablokowanych
--     wierszy opisuje migracja;
--   * wysylki maila, szablonu i serwerowego rozliczenia partii (vitest
--     jobsTick / tx-copy).
--
-- JEDNA TRANSAKCJA = JEDNO `now()` (patrz 27_group_follow_lead): kazdy
-- znacznik i kazda decyzja maja ten sam stempel. Tam, gdzie test udaje
-- decyzje podjeta WCZESNIEJ, przesuwa jej stempel wprost. Dzierzawa zajecia
-- to `clock_timestamp()`, wiec rozni sie miedzy zajeciami.
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 73 zawiadomienie o odwolanym bilecie =='

BEGIN;

CREATE TEMP TABLE trv_q (k text PRIMARY KEY, u uuid);

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
  ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'Tenant CB (odwolany bilet)', 'tcb-trv')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('cb000000-0000-0000-0000-0000000000a1', 'admin.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000001', 'lead.a.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000002', 'lead.b.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000003', 'lead.c.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000004', 'lead.d.trv@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb'::uuid
FROM auth.users u WHERE u.id::text LIKE 'cb000000-%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('cb000000-0000-0000-0000-0000000000a1', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('cb100000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'trv-main', 'Kongres odwolanych', 'Revocation congress',
   now() + interval '30 days', 'published', 'form', 'instant', NULL);

-- T1 bezplatny z akceptacja, bez puli. T2 platny, bez puli.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('cb200000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'trv_free', 'Bezplatny', 'Free',
   0, 'PLN', NULL, 0, true, true, 10, true, 8),
  ('cb200000-0000-0000-0000-000000000002', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'trv_paid', 'Platny', 'Paid',
   10000, 'PLN', NULL, 0, false, true, 20, true, 8);

SELECT set_config('nes.public_tenant', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', false);

-- Prowadzacy przez PRAWDZIWE `event_register` + dopisanie gosci. Najemca
-- i wydarzenie domyslnie z tego pliku; drugi najemca (sekcja 12) podaje
-- wlasne - `event_register` czyta najemce z `nes.public_tenant`.
CREATE FUNCTION pg_temp.trv_group(_key text, _uid uuid, _ticket uuid, _guests integer,
                                  _tenant uuid DEFAULT 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
                                  _slug text DEFAULT 'trv-main') RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v jsonb; v_lead uuid; v_guests jsonb := '[]'::jsonb; i integer;
BEGIN
  PERFORM set_config('nes.public_tenant', _tenant::text, false);
  PERFORM pg_temp.act_as(_uid, _tenant);
  v := public.event_register(jsonb_build_object(
    'event_slug', _slug, 'ticket_type_id', _ticket,
    'email', (SELECT u.email FROM auth.users u WHERE u.id = _uid),
    'first_name', 'Lider', 'last_name', initcap(_key),
    'consent_data_processing', true));
  v_lead := (v->>'registration_id')::uuid;
  INSERT INTO trv_q VALUES (_key, v_lead);
  FOR i IN 1.._guests LOOP
    v_guests := v_guests || jsonb_build_array(jsonb_build_object(
      'first_name', 'Gosc', 'last_name', initcap(_key) || i,
      'email', 'guest.' || _key || i || '@trv.example.org'));
  END LOOP;
  PERFORM public.event_register_group_guests(v_lead, v_guests);
  INSERT INTO trv_q
  SELECT _key || '_g' || substr(p.email_norm, length('guest.' || _key) + 1, 1), r.id
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.group_lead_registration_id = v_lead;
  PERFORM pg_temp.act_as();
  PERFORM set_config('nes.public_tenant', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', false);
  RETURN v_lead;
END $$;

CREATE FUNCTION pg_temp.trv(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM trv_q WHERE k = _key $$;

CREATE FUNCTION pg_temp.trv_decide(_id uuid, _action text, _note text DEFAULT NULL,
                                   _admin uuid DEFAULT 'cb000000-0000-0000-0000-0000000000a1',
                                   _tenant uuid DEFAULT 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(_admin, _tenant);
  v := public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', _id, 'action', _action, 'note', _note));
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.trv_row(_key text) RETURNS public.event_registrations
LANGUAGE sql AS $$ SELECT r FROM public.event_registrations r WHERE r.id = pg_temp.trv(_key) $$;

-- Wydanie biletow grupy i potwierdzenie wysylki kazdego z nich.
CREATE FUNCTION pg_temp.trv_issue_all(_id uuid) RETURNS integer
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

-- Jedna partia zawiadomien tak, jak robi to serwer: zajecie (limit 200)
-- i rozliczenie wszystkich jako wyslanych. Zwraca tablice `notices`, zeby
-- asercja mogla ja przeczytac, a kolejna sekcja zaczynala od pustej kolejki.
CREATE FUNCTION pg_temp.trv_drain() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v jsonb; v_ids uuid[]; k integer;
BEGIN
  v := public._event_ticket_revoked_notices_claim(200);
  SELECT COALESCE(array_agg((n->>'registration_id')::uuid), ARRAY[]::uuid[]) INTO v_ids
  FROM jsonb_array_elements(v->'notices') n;
  k := public._event_ticket_revoked_notices_settle((v->>'claimed_at')::timestamptz, v_ids, NULL);
  IF k <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'trv_drain: rozliczono % z % zawiadomien', k, cardinality(v_ids);
  END IF;
  RETURN v->'notices';
END $$;

-- ---------------------------------------------------------------------------
-- 1) POMOCNIK I KASKADA ODRZUCENIA: KTO DOSTAL BILET, DOSTANIE ZAWIADOMIENIE
-- ---------------------------------------------------------------------------
-- Grupa A: prowadzacy i pieciu gosci. Po wydaniu: A1 wyslany, A2 zajety bez
-- potwierdzenia (w drodze), A3 adres odrzucony przez poczte, A4 nieudana
-- wysylka (zajecie zwolnione), A5 obecny na sali.
SELECT pg_temp.trv_group('a', 'cb000000-0000-0000-0000-000000000001',
  'cb200000-0000-0000-0000-000000000001', 5);

DO $$
DECLARE v jsonb; e jsonb; v_claims jsonb;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('a'), 'approve');
  -- wydanie calej grupy, potem rozne wyniki wysylki
  v_claims := public._event_issue_ticket_codes(pg_temp.trv('a'));
  FOR e IN SELECT * FROM jsonb_array_elements(v_claims) LOOP
    IF (e->>'registration_id')::uuid = pg_temp.trv('a_g2') THEN
      NULL; -- w drodze: zajecie bez potwierdzenia
    ELSIF (e->>'registration_id')::uuid = pg_temp.trv('a_g3') THEN
      PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true, true);
    ELSIF (e->>'registration_id')::uuid = pg_temp.trv('a_g4') THEN
      PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, false);
    ELSE
      PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
    END IF;
  END LOOP;
  v := pg_temp.trv_decide(pg_temp.trv('a_g5'), 'attended');

  PERFORM pg_temp.assert(public._event_guest_ticket_reached(pg_temp.trv_row('a_g1')),
    '73/pomocnik: bilet wyslany - dotarl');
  PERFORM pg_temp.assert(public._event_guest_ticket_reached(pg_temp.trv_row('a_g2')),
    '73/pomocnik: bilet zajety do wysylki - w drodze');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(pg_temp.trv_row('a_g3')),
    '73/pomocnik: adres odrzucony przez poczte - nie dotarl');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(pg_temp.trv_row('a_g4')),
    '73/pomocnik: nieudana wysylka (zajecie zwolnione) - nie dotarl');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(pg_temp.trv_row('a_g5')),
    '73/pomocnik: obecny (attended) - poza przyjetymi');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(NULL::public.event_registrations),
    '73/pomocnik: NULL - false, a nie NULL');

  v := pg_temp.trv_decide(pg_temp.trv('a'), 'reject', 'Grupa odwolana');
  PERFORM pg_temp.assert(
    (SELECT ticket_revoked_at = now() FROM public.event_registrations WHERE id = pg_temp.trv('a_g1'))
    AND (SELECT ticket_revoked_at = now() FROM public.event_registrations WHERE id = pg_temp.trv('a_g2'))
    AND (SELECT ticket_revoked_at IS NULL FROM public.event_registrations WHERE id = pg_temp.trv('a_g3'))
    AND (SELECT ticket_revoked_at IS NULL FROM public.event_registrations WHERE id = pg_temp.trv('a_g4'))
    AND (SELECT ticket_revoked_at IS NULL AND status = 'attended' FROM public.event_registrations WHERE id = pg_temp.trv('a_g5'))
    AND (SELECT ticket_revoked_at IS NULL FROM public.event_registrations WHERE id = pg_temp.trv('a')),
    '73/kaskada: znacznik tylko u gosci, do ktorych bilet dotarl albo byl w drodze');
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NULL AND ticket_code_claimed_at IS NULL FROM public.event_registrations WHERE id = pg_temp.trv('a_g1')),
    '73/kaskada: znacznik wysylki biletu skasowany po staremu (SET widzi wiersz sprzed zamkniecia)');
END $$;

-- ---------------------------------------------------------------------------
-- 2) ZAJECIE I ROZLICZENIE PARTII
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v2 jsonb; k integer; g1 uuid := pg_temp.trv('a_g1'); g2 uuid := pg_temp.trv('a_g2');
BEGIN
  v := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 2,
    '73/zajecie: dwa zawiadomienia (dostano ' || jsonb_array_length(v->'notices') || ')');
  PERFORM pg_temp.assert(
    (SELECT bool_and(n->>'email' LIKE 'guest.a%@trv.example.org' AND n->>'lead_last_name' = 'A'
                     AND n->>'event_slug' = 'trv-main' AND n->>'lang' = 'pl'
                     AND n->>'ticket_name_pl' = 'Bezplatny' AND (n->>'revoked_at')::timestamptz = now())
       FROM jsonb_array_elements(v->'notices') n),
    '73/zajecie: ladunek z adresem, prowadzacym, wydarzeniem, jezykiem i tozsamoscia zawiadomienia');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations WHERE ticket_revoked_notice_claimed_at = (v->>'claimed_at')::timestamptz) = 2,
    '73/zajecie: oba wiersze zajete ta sama chwila');
  v2 := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_array_length(v2->'notices') = 0,
    '73/zajecie: zywa dzierzawa - drugie zajecie puste');

  k := public._event_ticket_revoked_notices_settle(now() - interval '1 hour', ARRAY[g1], ARRAY[g2]);
  PERFORM pg_temp.assert(k = 0, '73/rozliczenie: obce zajecie niczego nie rozlicza');
  k := public._event_ticket_revoked_notices_settle((v->>'claimed_at')::timestamptz, ARRAY[g1], ARRAY[g2]);
  PERFORM pg_temp.assert(k = 2, '73/rozliczenie: dwa wiersze rozliczone');
  PERFORM pg_temp.assert(
    (SELECT ticket_revoked_at IS NULL AND ticket_revoked_notice_claimed_at IS NULL FROM public.event_registrations WHERE id = g1)
    AND (SELECT ticket_revoked_at IS NOT NULL AND ticket_revoked_notice_claimed_at IS NULL FROM public.event_registrations WHERE id = g2),
    '73/rozliczenie: wyslany zamkniety, ponowienie wraca do kolejki');
  v := public._event_ticket_revoked_notices_claim(NULL);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 1 AND (v->'notices'->0->>'registration_id')::uuid = g2,
    '73/zajecie: ponowienie zajete znowu (p_limit NULL = domyslny)');
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = now() - interval '16 minutes' WHERE id = g2;
  v := public._event_ticket_revoked_notices_claim(0);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 1,
    '73/zajecie: wygasla dzierzawa zajeta ponownie, p_limit 0 -> 1');
  k := public._event_ticket_revoked_notices_settle((v->>'claimed_at')::timestamptz, NULL, NULL);
  PERFORM pg_temp.assert(k = 0, '73/rozliczenie: NULL-owe tablice - nic');
  k := public._event_ticket_revoked_notices_settle((v->>'claimed_at')::timestamptz, ARRAY[g2], NULL);
  PERFORM pg_temp.assert(k = 1, '73/rozliczenie: done bez retry');
END $$;

-- ---------------------------------------------------------------------------
-- 3) PRZYWROCENIE: odrzucenie -> zatwierdzenie -> (bez nowego biletu) -> odrzucenie
-- ---------------------------------------------------------------------------
SELECT pg_temp.trv_group('b', 'cb000000-0000-0000-0000-000000000002',
  'cb200000-0000-0000-0000-000000000001', 2);
DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'approve');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('b'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'reject', 'Pomylka');
  PERFORM pg_temp.assert((pg_temp.trv_row('b_g1')).ticket_revoked_at IS NOT NULL,
    '73/przywrocenie: znacznik po odrzuceniu');
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'approve');
  PERFORM pg_temp.assert((pg_temp.trv_row('b_g1')).status = 'approved' AND (pg_temp.trv_row('b_g1')).ticket_revoked_at IS NOT NULL,
    '73/przywrocenie: przyjety gosc zachowuje znacznik');
  v := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 0 AND (pg_temp.trv_row('b_g1')).ticket_revoked_notice_claimed_at IS NULL,
    '73/przywrocenie: przyjety nie dostaje zawiadomienia i nie jest zajmowany');
  -- Wartownik: drugie odrzucenie bez nowego biletu zachowuje stary znacznik.
  UPDATE public.event_registrations SET ticket_revoked_at = '2000-01-01' WHERE id = pg_temp.trv('b_g1');
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'reject', 'Jednak odrzucone');
  PERFORM pg_temp.assert((pg_temp.trv_row('b_g1')).ticket_revoked_at = '2000-01-01',
    '73/przywrocenie: bez nowego biletu - stare zawiadomienie zostaje (ELSE)');
  -- Nowy bilet dotarl -> nowe zawiadomienie przy kolejnym odrzuceniu.
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'approve');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('b'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = now() WHERE id = pg_temp.trv('b_g1');
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'reject', 'Trzecia decyzja');
  PERFORM pg_temp.assert((pg_temp.trv_row('b_g1')).ticket_revoked_at = now()
    AND (pg_temp.trv_row('b_g1')).ticket_revoked_notice_claimed_at IS NULL,
    '73/przywrocenie: nowy bilet dotarl - nowe zawiadomienie, dzierzawa zdjeta');
END $$;

-- ---------------------------------------------------------------------------
-- 4) ZWROT ORGANIZATORA, SAMODZIELNE WYCOFANIE PROWADZACEGO
-- ---------------------------------------------------------------------------
SELECT pg_temp.trv_group('c', 'cb000000-0000-0000-0000-000000000003',
  'cb200000-0000-0000-0000-000000000002', 2);
DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('c'), 'paid');
  PERFORM pg_temp.assert((pg_temp.trv_row('c_g1')).status = 'approved' AND (pg_temp.trv_row('c_g1')).payment_status = 'paid',
    '73/zwrot_organizatora: punkt wyjscia - grupa oplacona recznie i przyjeta');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('c'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  v := pg_temp.trv_decide(pg_temp.trv('c'), 'refund');
  PERFORM pg_temp.assert((pg_temp.trv_row('c_g1')).status = 'cancelled' AND (pg_temp.trv_row('c_g1')).payment_status = 'refunded'
    AND (pg_temp.trv_row('c_g1')).ticket_revoked_at = now() AND (pg_temp.trv_row('c_g2')).ticket_revoked_at = now(),
    '73/zwrot_organizatora: oplaceni goscie anulowani galezia zwrotu ze znacznikiem');
END $$;

SELECT pg_temp.trv_group('d', 'cb000000-0000-0000-0000-000000000004',
  'cb200000-0000-0000-0000-000000000001', 1);
DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('d'), 'approve');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('d'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  PERFORM pg_temp.act_as('cb000000-0000-0000-0000-000000000004', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb');
  v := public.event_registration_cancel(jsonb_build_object('registration_id', pg_temp.trv('d')));
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert((pg_temp.trv_row('d_g1')).status = 'cancelled' AND (pg_temp.trv_row('d_g1')).ticket_revoked_at = now(),
    '73/wycofanie: prowadzacy wycofuje sie sam - gosc ze znacznikiem');
END $$;

-- ---------------------------------------------------------------------------
-- 5) ZAMKNIECIE BEZ MAILA: UCZESTNIK WYLACZYL MAILE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  UPDATE public.event_registrations SET notify_email = false WHERE id = pg_temp.trv('d_g1');
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = NULL WHERE ticket_revoked_notice_claimed_at IS NOT NULL;
  v := public._event_ticket_revoked_notices_claim(50);
  PERFORM pg_temp.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'notices') n WHERE (n->>'registration_id')::uuid = pg_temp.trv('d_g1'))
    AND (pg_temp.trv_row('d_g1')).ticket_revoked_at IS NULL,
    '73/bez_maila: wylaczone maile zamykaja zawiadomienie bez wysylki');
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 4,
    '73/bez_maila: reszta (b_g1, b_g2, c_g1, c_g2) zajeta: ' || jsonb_array_length(v->'notices'));
END $$;

-- ---------------------------------------------------------------------------
-- 6) STRIPE: WPLATA I ZWROT ZAMOWIENIA PROWADZACEGO
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000005', 'lead.e.trv@example.org') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES ('cb000000-0000-0000-0000-000000000005', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb') ON CONFLICT (id) DO NOTHING;
SELECT pg_temp.trv_group('e', 'cb000000-0000-0000-0000-000000000005', 'cb200000-0000-0000-0000-000000000002', 2);
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT 'cb600000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
  'cb000000-0000-0000-0000-000000000005', 'paid', 30000, 'PLN',
  jsonb_build_object('event_id', 'cb100000-0000-0000-0000-000000000001',
                     'ticket_type_id', 'cb200000-0000-0000-0000-000000000002',
                     'registration_id', pg_temp.trv('e'));
DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000001', 'paid', NULL);
  PERFORM pg_temp.assert((pg_temp.trv_row('e_g1')).status = 'approved',
    '73/stripe: goscie przyjeci po wplacie');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('e'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000001', 'refunded', 30000);
  PERFORM pg_temp.assert(v->>'outcome' = 'refunded'
    AND (pg_temp.trv_row('e_g1')).ticket_revoked_at = now() AND (pg_temp.trv_row('e_g2')).ticket_revoked_at = now()
    AND (pg_temp.trv_row('e')).ticket_revoked_at IS NULL,
    '73/stripe: zwrot zamowienia - znacznik u gosci, nie u prowadzacego');
END $$;

-- ---------------------------------------------------------------------------
-- 7) WYDARZENIE MINELO, PRZYJETY PO ZAKONCZENIU, LIMIT 200, KOLEJNOSC
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = NULL WHERE ticket_revoked_notice_claimed_at IS NOT NULL;
  UPDATE public.event_registrations SET status = 'approved', cancelled_at = NULL, decided_at = now() WHERE id = pg_temp.trv('e_g2');
  UPDATE public.events SET starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' WHERE id = 'cb100000-0000-0000-0000-000000000001';
  v := public._event_ticket_revoked_notices_claim(50);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 0
    AND NOT EXISTS (SELECT 1 FROM public.event_registrations WHERE tenant_id = 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb' AND ticket_revoked_at IS NOT NULL),
    '73/po_wydarzeniu: wszystkie zawiadomienia (takze przyjetego) zamkniete bez maila');
  UPDATE public.events SET starts_at = now() + interval '30 days', ends_at = NULL WHERE id = 'cb100000-0000-0000-0000-000000000001';
END $$;

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
SELECT ('cb700000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'bulk' || i || '@trv.example.org', 'B', 'Bulk'
FROM generate_series(1, 205) i;
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status, cancelled_at, ticket_revoked_at)
SELECT ('cb800000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cb100000-0000-0000-0000-000000000001',
  ('cb700000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'cb200000-0000-0000-0000-000000000001', 'cancelled', 'form', 'not_required', now(), now() - (i || ' seconds')::interval
FROM generate_series(1, 205) i;
DO $$
DECLARE v jsonb;
BEGIN
  v := public._event_ticket_revoked_notices_claim(1000);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 200, '73/zajecie: gorna granica p_limit 200');
  PERFORM pg_temp.assert((v->'notices'->0->>'registration_id')::uuid = 'cb800000-0000-0000-0000-000000000205',
    '73/zajecie: najstarsze najpierw');
END $$;

-- ---------------------------------------------------------------------------
-- 8) JEZYK Z PROFILU, PRZYWROCENIE DO KOLEJKI, KONIEC BEZ ends_at, PUSTA PARTIA
-- ---------------------------------------------------------------------------
DELETE FROM public.event_registrations WHERE id::text LIKE 'cb800000-%';
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('cb200000-0000-0000-0000-000000000003', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'trv_quota', 'Pula trzy', 'Quota three',
   0, 'PLN', 3, 0, true, true, 30, true, 8);
INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000006', 'lead.f.trv@example.org') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES ('cb000000-0000-0000-0000-000000000006', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb') ON CONFLICT (id) DO NOTHING;
SELECT pg_temp.trv_group('f', 'cb000000-0000-0000-0000-000000000006', 'cb200000-0000-0000-0000-000000000003', 2);
DO $$
DECLARE v jsonb; e jsonb; v_other uuid := gen_random_uuid(); v_person uuid := gen_random_uuid(); v_wait uuid; v_back uuid;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('f'), 'approve');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('f'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  v := pg_temp.trv_decide(pg_temp.trv('f'), 'reject', 'Pomylka organizatora');
  -- Miejsce zajmuje ktos z zewnatrz: jeden z gosci F wroci do kolejki.
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
  VALUES (v_person, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'outsider@trv.example.org', 'Out', 'Sider');
  INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status, decided_at, decision_source)
  VALUES (v_other, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cb100000-0000-0000-0000-000000000001', v_person, 'cb200000-0000-0000-0000-000000000003', 'approved', 'form', 'not_required', now(), 'system');
  v := pg_temp.trv_decide(pg_temp.trv('f'), 'approve');
  SELECT r.id INTO v_wait FROM public.event_registrations r
   WHERE r.group_lead_registration_id = pg_temp.trv('f') AND r.status = 'waitlist';
  SELECT r.id INTO v_back FROM public.event_registrations r
   WHERE r.group_lead_registration_id = pg_temp.trv('f') AND r.status = 'approved';
  PERFORM pg_temp.assert(v_wait IS NOT NULL AND v_back IS NOT NULL
    AND (SELECT ticket_revoked_at IS NOT NULL FROM public.event_registrations WHERE id = v_wait)
    AND (SELECT ticket_revoked_at IS NOT NULL FROM public.event_registrations WHERE id = v_back),
    '73/kolejka: jeden gosc przyjety, drugi w kolejce (brak miejsca) - obaj zachowuja znacznik');
  INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000007', 'guest.en.trv@example.org');
  INSERT INTO public.profiles (id, tenant_id, prefs) VALUES ('cb000000-0000-0000-0000-000000000007', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', jsonb_build_object('language', 'EN'));
  UPDATE public.event_people SET user_id = 'cb000000-0000-0000-0000-000000000007' WHERE id = (SELECT person_id FROM public.event_registrations WHERE id = v_wait);
  v := public._event_ticket_revoked_notices_claim(NULL);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 1 AND (v->'notices'->0->>'registration_id')::uuid = v_wait
    AND v->'notices'->0->>'lang' = 'en' AND v->'notices'->0->>'ticket_name_en' = 'Quota three',
    '73/kolejka: zawiadomienie wychodzi tylko do goscia w kolejce (bilet nie dziala), jezyk z prefs.language');
  INSERT INTO trv_q VALUES ('f_wait', v_wait);
END $$;
DO $$
DECLARE v jsonb;
BEGIN
  v := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_typeof(v->'notices') = 'array' AND jsonb_array_length(v->'notices') = 0 AND v ? 'claimed_at',
    '73/zajecie: pusta partia - ksztalt {claimed_at, notices: []}');
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = NULL WHERE id = pg_temp.trv('f_wait');
  UPDATE public.events SET starts_at = now() - interval '25 hours', ends_at = NULL WHERE id = 'cb100000-0000-0000-0000-000000000001';
  v := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 0 AND (pg_temp.trv_row('f_wait')).ticket_revoked_at IS NULL,
    '73/po_wydarzeniu: bez ends_at - starts_at + 1 dzien minal, zamkniete bez maila');
  UPDATE public.events SET starts_at = now() + interval '30 days' WHERE id = 'cb100000-0000-0000-0000-000000000001';
END $$;

-- Od tej chwili kolejka zawiadomien jest pusta: kazda dalsza sekcja zamyka
-- swoje zawiadomienia (`trv_drain`), wiec liczby w asercjach sa dokladne.

-- ---------------------------------------------------------------------------
-- 9) ANULOWANIE PROWADZACEGO PRZEZ ORGANIZATORA (GALAZ NOWEGO STEMPLA)
-- ---------------------------------------------------------------------------
-- Prowadzacy przyjety GODZINE wczesniej, anulowany przez organizatora: nowy
-- stempel decyzji, wiec kaskada niesie jego slad (`v_restamp`). G1 ma
-- wyslany bilet i dostaje znacznik. G2 (`attended`) i G3 (`no_show`) to fakt
-- z sali, odnotowany wczesniej - kaskada ich nie rusza, znacznika nie ma.
INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000008', 'lead.g.trv@example.org') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES ('cb000000-0000-0000-0000-000000000008', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb') ON CONFLICT (id) DO NOTHING;
SELECT pg_temp.trv_group('g', 'cb000000-0000-0000-0000-000000000008', 'cb200000-0000-0000-0000-000000000001', 3);

DO $$
DECLARE
  v jsonb;
  v_lead uuid := pg_temp.trv('g');
  v_att public.event_registrations;
  v_nos public.event_registrations;
BEGIN
  v := pg_temp.trv_decide(v_lead, 'approve');
  PERFORM pg_temp.assert(pg_temp.trv_issue_all(v_lead) = 4,
    '73/anulowanie: punkt wyjscia - grupa czworga przyjeta, bilety wyslane');
  v := pg_temp.trv_decide(pg_temp.trv('g_g2'), 'attended');
  v := pg_temp.trv_decide(pg_temp.trv('g_g3'), 'no_show');
  UPDATE public.event_registrations SET decided_at = now() - interval '2 hours'
  WHERE id IN (pg_temp.trv('g_g2'), pg_temp.trv('g_g3'));
  v_att := pg_temp.trv_row('g_g2');
  v_nos := pg_temp.trv_row('g_g3');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(v_nos),
    '73/pomocnik: nieobecny (no_show) z wyslanym biletem - poza przyjetymi');

  UPDATE public.event_registrations SET decided_at = now() - interval '1 hour' WHERE id = v_lead;
  v := pg_temp.trv_decide(v_lead, 'cancel', 'Organizator odwoluje grupe');
  PERFORM pg_temp.assert(v->>'status' = 'cancelled',
    '73/anulowanie: organizator anuluje prowadzacego');
  PERFORM pg_temp.assert(
    (SELECT g.status = 'cancelled' AND g.cancelled_at = l.cancelled_at
            AND g.decided_by = 'cb000000-0000-0000-0000-0000000000a1'
            AND g.decision_source = 'organizer' AND g.decision_note = 'Organizator odwoluje grupe'
            AND g.qr_token_hash IS NULL AND g.ticket_code_sent_at IS NULL
            AND g.ticket_revoked_at = now() AND g.ticket_revoked_notice_claimed_at IS NULL
            AND l.ticket_revoked_at IS NULL
       FROM public.event_registrations g, public.event_registrations l
      WHERE g.id = pg_temp.trv('g_g1') AND l.id = v_lead),
    '73/anulowanie: gosc z biletem anulowany ze sladem organizatora i ze znacznikiem, prowadzacy bez znacznika');
  PERFORM pg_temp.assert(
    (SELECT r.status = 'attended' AND r.ticket_revoked_at IS NULL
            AND r.qr_token_hash = v_att.qr_token_hash AND r.ticket_code_sent_at IS NOT NULL
            AND r.decided_at = now() - interval '2 hours' AND r.cancelled_at IS NULL
       FROM public.event_registrations r WHERE r.id = v_att.id)
    AND (SELECT r.status = 'no_show' AND r.ticket_revoked_at IS NULL
            AND r.qr_token_hash = v_nos.qr_token_hash AND r.ticket_code_sent_at IS NOT NULL
            AND r.decided_at = now() - interval '2 hours' AND r.cancelled_at IS NULL
       FROM public.event_registrations r WHERE r.id = v_nos.id),
    '73/anulowanie: obecny i nieobecny nietknieci - bez znacznika, kod i stempel decyzji bez zmian');

  v := pg_temp.trv_drain();
  PERFORM pg_temp.assert(jsonb_array_length(v) = 1
    AND (v->0->>'registration_id')::uuid = pg_temp.trv('g_g1'),
    '73/anulowanie: partia niesie jedno zawiadomienie - gosc z biletem, nie obecny, nie nieobecny, nie prowadzacy');
END $$;

-- ---------------------------------------------------------------------------
-- 10) ZWROT CZESCIOWY NIE ZAWIADAMIA NIKOGO
-- ---------------------------------------------------------------------------
-- Zwrot czesciowy to korekta ceny (tak ksieguje go i webhook Stripe, i zwrot
-- organizatora z panelu - oba przez `payments_apply_event_ticket_outcome`
-- z wynikiem 'partial_refund'): grupa zachowuje miejsca, kody i bilety, wiec
-- zawiadomienie byloby nieprawda. Dopiero zwrot, ktory NARASTAJACO pokrywa
-- zamowienie, jest pelny - i stempluje gosci zwroconych wczesniej czesciowo.
INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000009', 'lead.h.trv@example.org') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES ('cb000000-0000-0000-0000-000000000009', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb') ON CONFLICT (id) DO NOTHING;
SELECT pg_temp.trv_group('h', 'cb000000-0000-0000-0000-000000000009', 'cb200000-0000-0000-0000-000000000002', 2);
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT 'cb600000-0000-0000-0000-000000000002', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
  'cb000000-0000-0000-0000-000000000009', 'paid', 30000, 'PLN',
  jsonb_build_object('event_id', 'cb100000-0000-0000-0000-000000000001',
                     'ticket_type_id', 'cb200000-0000-0000-0000-000000000002',
                     'registration_id', pg_temp.trv('h'));

DO $$
DECLARE
  v jsonb;
  v_lead uuid := pg_temp.trv('h');
  v_h1 text;
  v_h2 text;
BEGIN
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000002', 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE (r.id = v_lead OR r.group_lead_registration_id = v_lead)
            AND r.status = 'approved' AND r.payment_status = 'paid') = 3,
    '73/zwrot_czesciowy: punkt wyjscia - grupa oplacona przez Stripe i przyjeta');
  PERFORM pg_temp.assert(pg_temp.trv_issue_all(v_lead) = 3,
    '73/zwrot_czesciowy: punkt wyjscia - trzy bilety wyslane');
  v_h1 := (pg_temp.trv_row('h_g1')).qr_token_hash;
  v_h2 := (pg_temp.trv_row('h_g2')).qr_token_hash;

  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000002', 'partial_refund', 10000);
  PERFORM pg_temp.assert((v->>'applied')::boolean AND v->>'outcome' = 'partial_refund'
    AND (v->>'refunded_cents')::integer = 10000,
    '73/zwrot_czesciowy: zwrot ponizej kwoty zamowienia zaksiegowany jako czesciowy');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE (r.id = v_lead OR r.group_lead_registration_id = v_lead)
        AND r.status = 'approved' AND r.payment_status = 'partially_refunded'
        AND r.ticket_code_sent_at IS NOT NULL
        AND r.ticket_revoked_at IS NULL AND r.ticket_revoked_notice_claimed_at IS NULL) = 3
    AND (pg_temp.trv_row('h_g1')).qr_token_hash = v_h1
    AND (pg_temp.trv_row('h_g2')).qr_token_hash = v_h2,
    '73/zwrot_czesciowy: korekta ceny - grupa przyjeta z tymi samymi kodami i biletami, bez znacznika');
  v := pg_temp.trv_drain();
  PERFORM pg_temp.assert(jsonb_array_length(v) = 0,
    '73/zwrot_czesciowy: partia pusta - nikogo nie zawiadamiamy');

  -- Drugi zwrot czesciowy narastajaco do pelnej kwoty zamowienia.
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000002', 'partial_refund', 30000);
  PERFORM pg_temp.assert((v->>'applied')::boolean AND v->>'outcome' = 'refunded',
    '73/zwrot_czesciowy: zwrot narastajaco rowny kwocie zamowienia staje sie pelnym');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = v_lead
        AND r.status = 'cancelled' AND r.payment_status = 'refunded'
        AND r.qr_token_hash IS NULL AND r.ticket_revoked_at = now()) = 2
    AND (pg_temp.trv_row('h')).ticket_revoked_at IS NULL,
    '73/zwrot_czesciowy: pelny zwrot po czesciowym - goscie zwroceni czesciowo dostaja znacznik, prowadzacy nie');
  v := pg_temp.trv_drain();
  PERFORM pg_temp.assert(jsonb_array_length(v) = 2
    AND (SELECT bool_and((n->>'registration_id')::uuid IN (pg_temp.trv('h_g1'), pg_temp.trv('h_g2')))
           FROM jsonb_array_elements(v) n),
    '73/zwrot_czesciowy: partia niesie obu gosci grupy');
END $$;

-- ---------------------------------------------------------------------------
-- 11) PELNY ZWROT: GOSC W KOLEJCE I GOSC NIEOPLACONY BEZ ZNACZNIKA
-- ---------------------------------------------------------------------------
-- Bilet T4: platny, pula 4. Grupa W (prowadzacy i czterech gosci) miesci sie
-- przy zapisie (nieoplacony prowadzacy nie trzyma miejsca). Przed wplata:
-- W1 wycofany przez organizatora, jedno miejsce zajmuje zapis z zewnatrz.
-- Wplata: prowadzacy i dwaj goscie na miejscach, trzeci OPLACONY w kolejce
-- (`capacity`). Potem organizator podnosi pule i wpuszcza W1 recznie - bez
-- wplaty, wiec bez biletu. Pelny zwrot:
--   * goscie na miejscach z biletem - znacznik z galezi zwrotu;
--   * oplacony gosc z kolejki - zwrocony, ale bez znacznika (bilet do niego
--     nie wyszedl);
--   * W1 - galaz zwrotu go POMIJA (CONTINUE: nie jest rozliczony), zamyka go
--     kaskada statusu (`system`, data prowadzacego) i tez bez znacznika.
-- Ktory z trzech oplaconych gosci trafi do kolejki, rozstrzyga `id` (jedno
-- `now()` = ten sam `created_at`), wiec asercje wybieraja ich po statusie.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('cb200000-0000-0000-0000-000000000004', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'trv_paid_quota', 'Pula cztery', 'Quota four',
   10000, 'PLN', 4, 0, false, true, 40, true, 8);
INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000010', 'lead.w.trv@example.org') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES ('cb000000-0000-0000-0000-000000000010', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb') ON CONFLICT (id) DO NOTHING;
SELECT pg_temp.trv_group('w', 'cb000000-0000-0000-0000-000000000010', 'cb200000-0000-0000-0000-000000000004', 4);
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
VALUES ('cb710000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'filler@trv.example.org', 'Zapis', 'Zewnetrzny');
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status, decided_at, decision_source)
VALUES ('cb810000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cb100000-0000-0000-0000-000000000001',
        'cb710000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000004', 'approved', 'form', 'paid', now(), 'system');
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT 'cb600000-0000-0000-0000-000000000003', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
  'cb000000-0000-0000-0000-000000000010', 'paid', 50000, 'PLN',
  jsonb_build_object('event_id', 'cb100000-0000-0000-0000-000000000001',
                     'ticket_type_id', 'cb200000-0000-0000-0000-000000000004',
                     'registration_id', pg_temp.trv('w'));

DO $$
DECLARE
  v jsonb;
  v_lead uuid := pg_temp.trv('w');
  w1 uuid := pg_temp.trv('w_g1');
  v_seated uuid[];
  v_wait uuid;
BEGIN
  v := pg_temp.trv_decide(w1, 'cancel');
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000003', 'paid');
  SELECT array_agg(r.id ORDER BY r.created_at, r.id) INTO v_seated
  FROM public.event_registrations r
  WHERE r.group_lead_registration_id = v_lead AND r.status = 'approved';
  SELECT r.id INTO v_wait
  FROM public.event_registrations r
  WHERE r.group_lead_registration_id = v_lead AND r.status = 'waitlist';
  PERFORM pg_temp.assert((v->>'applied')::boolean AND cardinality(v_seated) = 2 AND v_wait IS NOT NULL
    AND (SELECT payment_status = 'paid' AND decision_source = 'capacity' AND qr_token_hash IS NULL
           FROM public.event_registrations WHERE id = v_wait),
    '73/zwrot_pelny: punkt wyjscia - dwaj goscie na miejscach, trzeci oplacony w kolejce (brak miejsca w puli)');

  UPDATE public.event_ticket_types SET quota = 5 WHERE id = 'cb200000-0000-0000-0000-000000000004';
  v := pg_temp.trv_decide(w1, 'approve');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'unpaid' AND payment_order_id IS NULL
            AND qr_token_hash IS NULL
       FROM public.event_registrations WHERE id = w1),
    '73/zwrot_pelny: punkt wyjscia - nieoplacony gosc wpuszczony przez organizatora, bez kodu');
  PERFORM pg_temp.assert(pg_temp.trv_issue_all(v_lead) = 3,
    '73/zwrot_pelny: punkt wyjscia - bilety tylko dla prowadzacego i dwoch oplaconych gosci na miejscach');

  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000003', 'refunded', 50000);
  PERFORM pg_temp.assert((v->>'applied')::boolean AND v->>'outcome' = 'refunded'
    AND (pg_temp.trv_row('w')).status = 'cancelled' AND (pg_temp.trv_row('w')).ticket_revoked_at IS NULL,
    '73/zwrot_pelny: zwrot zamowienia anuluje prowadzacego (bez znacznika)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id = ANY(v_seated) AND r.status = 'cancelled' AND r.payment_status = 'refunded'
        AND r.ticket_revoked_at = now()) = 2,
    '73/zwrot_pelny: goscie na miejscach z biletem - znacznik z galezi zwrotu');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND payment_status = 'refunded' AND ticket_revoked_at IS NULL
       FROM public.event_registrations WHERE id = v_wait),
    '73/zwrot_pelny: oplacony gosc z kolejki zwrocony bez znacznika - bilet do niego nie wyszedl');
  PERFORM pg_temp.assert(
    (SELECT r.status = 'cancelled' AND r.cancelled_at = l.cancelled_at
            AND r.payment_status = 'unpaid' AND r.payment_order_id IS NULL
            AND r.decision_source = 'system' AND r.decided_by IS NULL
            AND r.ticket_revoked_at IS NULL
       FROM public.event_registrations r, public.event_registrations l
      WHERE r.id = w1 AND l.id = v_lead),
    '73/zwrot_pelny: nieoplacony gosc pominiety przez galaz zwrotu (bez zwrotu i zamowienia), zamkniety kaskada bez znacznika');

  v := pg_temp.trv_drain();
  PERFORM pg_temp.assert(jsonb_array_length(v) = 2
    AND (SELECT bool_and((n->>'registration_id')::uuid = ANY(v_seated)) FROM jsonb_array_elements(v) n),
    '73/zwrot_pelny: partia niesie tylko gosci, do ktorych bilet dotarl');
END $$;

-- ---------------------------------------------------------------------------
-- 12) DWAJ NAJEMCY W JEDNEJ PARTII; JEZYK ZAWIADOMIENIA
-- ---------------------------------------------------------------------------
-- Zajecie jest globalne (jeden tick obsluguje wszystkich najemcow), a kazde
-- zawiadomienie niesie `tenant_id` i dane WLASNEGO najemcy. Grupa L (ten
-- najemca, trzech gosci) i grupa M (drugi najemca, jeden gosc) zostaja
-- odrzucone po wyslaniu biletow. Jezyk gosci L:
--   L1 bez konta - newsletter najemcy (adres wielkimi literami, 'EN');
--   L2 konto z `prefs.lang` bez `prefs.language`;
--   L3 konto z `prefs.language = 'pl'` i newsletter 'en' - profil wygrywa.
-- M1 ma newsletter 'en' tylko u PIERWSZEGO najemcy - u siebie dostaje 'pl'.
INSERT INTO public.tenants (id, name, slug) VALUES
  ('cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2', 'Tenant CB2 (odwolany bilet, drugi najemca)', 'tcb-trv2')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email) VALUES
  ('cb000000-0000-0000-0000-0000000000a2', 'admin2.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000011', 'lead.l.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000012', 'konto.l2.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000013', 'konto.l3.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000014', 'lead.m.trv@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, prefs) VALUES
  ('cb000000-0000-0000-0000-0000000000a2', 'cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2', '{}'::jsonb),
  ('cb000000-0000-0000-0000-000000000011', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', '{}'::jsonb),
  ('cb000000-0000-0000-0000-000000000012', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', '{"lang": "En"}'::jsonb),
  ('cb000000-0000-0000-0000-000000000013', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', '{"language": "pl"}'::jsonb),
  ('cb000000-0000-0000-0000-000000000014', 'cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('cb000000-0000-0000-0000-0000000000a2', 'admin')
ON CONFLICT DO NOTHING;
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('cb100000-0000-0000-0000-000000000002', 'cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2',
   'trv-other', 'Drugi najemca', 'Second tenant',
   now() + interval '30 days', 'published', 'form', 'instant', NULL);
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('cb200000-0000-0000-0000-000000000009', 'cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2',
   'cb100000-0000-0000-0000-000000000002', 'trv2_free', 'Drugi', 'Second',
   0, 'PLN', NULL, 0, true, true, 10, true, 8);

SELECT pg_temp.trv_group('l', 'cb000000-0000-0000-0000-000000000011', 'cb200000-0000-0000-0000-000000000001', 3);
SELECT pg_temp.trv_group('m', 'cb000000-0000-0000-0000-000000000014', 'cb200000-0000-0000-0000-000000000009', 1,
  'cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2', 'trv-other');

UPDATE public.event_people SET user_id = 'cb000000-0000-0000-0000-000000000012'
WHERE tenant_id = 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb' AND email_norm = 'guest.l2@trv.example.org';
UPDATE public.event_people SET user_id = 'cb000000-0000-0000-0000-000000000013'
WHERE tenant_id = 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb' AND email_norm = 'guest.l3@trv.example.org';
INSERT INTO public.newsletter_subscribers (tenant_id, email, language) VALUES
  ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'GUEST.L1@TRV.example.org', 'EN'),
  ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'guest.l3@trv.example.org', 'en'),
  ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'guest.m1@trv.example.org', 'en');

DO $$
DECLARE
  v jsonb;
  e jsonb;
  t1 uuid := 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb';
  t2 uuid := 'cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2';
  a2 uuid := 'cb000000-0000-0000-0000-0000000000a2';
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('l'), 'approve');
  PERFORM pg_temp.assert(pg_temp.trv_issue_all(pg_temp.trv('l')) = 4,
    '73/najemcy: punkt wyjscia - grupa L przyjeta, bilety wyslane');
  v := pg_temp.trv_decide(pg_temp.trv('m'), 'approve', NULL, a2, t2);
  PERFORM pg_temp.assert(pg_temp.trv_issue_all(pg_temp.trv('m')) = 2,
    '73/najemcy: punkt wyjscia - grupa M drugiego najemcy przyjeta, bilety wyslane');
  v := pg_temp.trv_decide(pg_temp.trv('l'), 'reject', 'Grupa L odwolana');
  v := pg_temp.trv_decide(pg_temp.trv('m'), 'reject', 'Grupa M odwolana', a2, t2);

  v := pg_temp.trv_drain();
  PERFORM pg_temp.assert(jsonb_array_length(v) = 4
    AND (SELECT count(*) FROM jsonb_array_elements(v) n WHERE (n->>'tenant_id')::uuid = t1) = 3
    AND (SELECT count(*) FROM jsonb_array_elements(v) n WHERE (n->>'tenant_id')::uuid = t2) = 1,
    '73/najemcy: jedna partia niesie zawiadomienia obu najemcow (3 + 1)');
  SELECT n INTO e FROM jsonb_array_elements(v) n WHERE (n->>'tenant_id')::uuid = t2;
  PERFORM pg_temp.assert((e->>'registration_id')::uuid = pg_temp.trv('m_g1')
    AND e->>'email' = 'guest.m1@trv.example.org'
    AND e->>'event_slug' = 'trv-other' AND e->>'event_title_pl' = 'Drugi najemca'
    AND e->>'lead_last_name' = 'M' AND e->>'ticket_name_pl' = 'Drugi',
    '73/najemcy: zawiadomienie drugiego najemcy z jego wydarzeniem, prowadzacym i biletem');
  PERFORM pg_temp.assert(
    (SELECT bool_and(n->>'event_slug' = 'trv-main' AND n->>'lead_last_name' = 'L'
                     AND n->>'ticket_name_pl' = 'Bezplatny' AND n->>'email' LIKE 'guest.l_@trv.example.org')
       FROM jsonb_array_elements(v) n WHERE (n->>'tenant_id')::uuid = t1),
    '73/najemcy: zawiadomienia pierwszego najemcy z jego wydarzeniem, prowadzacym i biletem');

  PERFORM pg_temp.assert(
    (SELECT n->>'lang' FROM jsonb_array_elements(v) n
      WHERE (n->>'registration_id')::uuid = pg_temp.trv('l_g1')) = 'en',
    '73/jezyk: bez konta - newsletter najemcy (adres bez wzgledu na wielkosc liter)');
  PERFORM pg_temp.assert(
    (SELECT n->>'lang' FROM jsonb_array_elements(v) n
      WHERE (n->>'registration_id')::uuid = pg_temp.trv('l_g2')) = 'en',
    '73/jezyk: prefs.lang, gdy profil nie ma prefs.language');
  PERFORM pg_temp.assert(
    (SELECT n->>'lang' FROM jsonb_array_elements(v) n
      WHERE (n->>'registration_id')::uuid = pg_temp.trv('l_g3')) = 'pl',
    '73/jezyk: prefs.language profilu wygrywa z newsletterem');
  PERFORM pg_temp.assert(e->>'lang' = 'pl',
    '73/jezyk: newsletter OBCEGO najemcy sie nie liczy - domyslny pl');
END $$;

-- ---------------------------------------------------------------------------
-- 13) SCHEMAT I UPRAWNIENIA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM pg_indexes i
           WHERE i.schemaname = 'public' AND i.tablename = 'event_registrations'
             AND i.indexname = 'event_registrations_ticket_revoked_idx'
             AND i.indexdef LIKE '%(ticket_revoked_at, id)%'
             AND i.indexdef LIKE '%WHERE (ticket_revoked_at IS NOT NULL)%'),
  '73/schemat: indeks czesciowy (ticket_revoked_at, id) tylko na czekajacych zawiadomieniach');
SELECT pg_temp.assert(
  col_description('public.event_registrations'::regclass,
    (SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = 'public.event_registrations'::regclass AND a.attname = 'ticket_revoked_at'))
    LIKE '%event_ticket_revoked%'
  AND col_description('public.event_registrations'::regclass,
    (SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = 'public.event_registrations'::regclass AND a.attname = 'ticket_revoked_notice_claimed_at'))
    LIKE '%_event_ticket_revoked_notices_claim%',
  '73/schemat: komentarze obu nowych kolumn');

SELECT pg_temp.assert(
  has_function_privilege('service_role', 'public._event_ticket_revoked_notices_claim(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_ticket_revoked_notices_settle(timestamptz, uuid[], uuid[])', 'EXECUTE'),
  '73/uprawnienia: zajecie i rozliczenie dla service_role');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_ticket_revoked_notices_claim(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_ticket_revoked_notices_claim(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_ticket_revoked_notices_settle(timestamptz, uuid[], uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_ticket_revoked_notices_settle(timestamptz, uuid[], uuid[])', 'EXECUTE'),
  '73/uprawnienia: zajecia i rozliczenia nie wola ani anon, ani authenticated (partia niesie adresy)');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_guest_ticket_reached(public.event_registrations)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_guest_ticket_reached(public.event_registrations)', 'EXECUTE'),
  '73/uprawnienia: pomocnik bez EXECUTE dla anon i authenticated');

ROLLBACK;

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants
               WHERE id IN ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2'))
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations
                   WHERE tenant_id IN ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cbcbcbcb-cbcb-cbcb-cbcb-0000000000b2'))
  AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'cb000000-%'),
  '73/sprzatanie: plik nie zostawil ani jednego wiersza');

\echo '== 73 zawiadomienie o odwolanym bilecie: koniec =='
