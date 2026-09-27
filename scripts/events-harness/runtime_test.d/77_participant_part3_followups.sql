-- ============================================================================
-- 77_participant_part3_followups - KONTRAKTY FUNDAMENTU W NOWYM KODZIE
-- CZESCI 3 (20260926183100)
--
-- PO CO TEN PLIK ISTNIEJE
-- `20260926183100_event_participant_part3_followups.sql` redefiniuje cztery
-- funkcje z 20260926180000 i oznacza kazda zmiane `-- ZMIANA (PF-F): <slug>`.
-- Kazdy slug ma tu asercje z etykieta `PF-F ZMIANA <slug>`:
--   * `issue-codes-lang` - `_event_issue_ticket_codes` bierze jezyk
--     z `_event_registration_lang` (kolumna -> profil -> newsletter ->
--     prowadzacy grupy -> pl);
--   * `revoked-notice-lang` - to samo dla `_event_ticket_revoked_notices_claim`;
--   * `cascade-releases-guests` - odrzucenie i anulowanie prowadzacego zwalnia
--     konta zamknietych gosci (zapisy na sesje z awansem kolejki sesji,
--     zakladki, starsza RSVP), PO zamknieciu i PO awansie kolejki;
--   * `group-release-after-promote` - pelny zwrot grupy zwalnia konta
--     zwroconych gosci PO awansie kolejki za ich miejsca (A.3).
-- Kontrapunkty: gosc obecny (`attended`) nietkniety, stan konta na INNYM
-- wydarzeniu (z aktywnym zgloszeniem) nietkniety, gosc bez konta bez bledu,
-- zgloszenie `partially_refunded` nadal dostaje bilet, `unpaid` - nie.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * straznika „konto trzyma inne aktywne zgloszenie na TO wydarzenie" na
--     sciezkach gosci: jedno konto to jedna osoba najemcy
--     (`event_people_tenant_user_uniq`), a osoba ma najwyzej jedno aktywne
--     zgloszenie na wydarzenie (`event_registrations_active_uniq`), wiec gosc
--     zamykany kaskada albo zwrotem nie moze miec drugiego aktywnego
--     zgloszenia. Straznik sprawdza 13_participant_foundation (spozniony
--     zwrot po ponownej rejestracji);
--   * kolejnosci blokad pod wspolbieznoscia (jedna sesja) - tu jej slad
--     w ciele funkcji (awans przed zwolnieniem);
--   * wysylki maili (vitest jobsTick / tx-copy).
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 77 czesc 3 a Fundament: jezyk, zwolnienie gosci, drabina blokad =='

BEGIN;

CREATE TEMP TABLE pf77_q (k text PRIMARY KEY, u uuid);

INSERT INTO public.tenants (id, name, slug) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Tenant 77 (czesc 3 a Fundament)', 't77')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('77000000-0000-0000-0000-0000000000a1', 'admin.77@example.org'),
  ('77000000-0000-0000-0000-000000000001', 'lead.l1.77@example.org'),
  ('77000000-0000-0000-0000-000000000003', 'konto.u3.77@example.org'),
  ('77000000-0000-0000-0000-000000000004', 'konto.u4.77@example.org'),
  ('77000000-0000-0000-0000-000000000011', 'lead.l2.77@example.org'),
  ('77000000-0000-0000-0000-000000000012', 'konto.ua.77@example.org'),
  ('77000000-0000-0000-0000-000000000013', 'konto.ub.77@example.org'),
  ('77000000-0000-0000-0000-000000000014', 'konto.uc.77@example.org'),
  ('77000000-0000-0000-0000-000000000015', 'konto.ue.77@example.org'),
  ('77000000-0000-0000-0000-000000000016', 'konto.uw.77@example.org'),
  ('77000000-0000-0000-0000-000000000021', 'lead.l3.77@example.org'),
  ('77000000-0000-0000-0000-000000000022', 'konto.uf.77@example.org'),
  ('77000000-0000-0000-0000-000000000031', 'lead.l4.77@example.org'),
  ('77000000-0000-0000-0000-000000000032', 'konto.ur.77@example.org'),
  ('77000000-0000-0000-0000-000000000033', 'konto.uw3.77@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, prefs)
SELECT u.id, '77777777-7777-7777-7777-777777777777'::uuid,
       CASE u.id
         WHEN '77000000-0000-0000-0000-000000000003' THEN '{"language": "pl"}'::jsonb
         WHEN '77000000-0000-0000-0000-000000000004' THEN '{"language": "en"}'::jsonb
         ELSE '{}'::jsonb
       END
FROM auth.users u WHERE u.id::text LIKE '77000000-%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('77000000-0000-0000-0000-0000000000a1', 'admin')
ON CONFLICT DO NOTHING;

-- E1 jezyk i bilety, E2 kaskada statusu, E3 zwrot grupy (pojemnosc 3).
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('77100000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   'pf77-lang', 'Jezyk biletow', 'Ticket language',
   now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('77100000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777',
   'pf77-cascade', 'Kaskada gosci', 'Guest cascade',
   now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('77100000-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777',
   'pf77-refund', 'Zwrot grupy', 'Group refund',
   now() + interval '30 days', 'published', 'form', 'instant', 3);

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('77200000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   '77100000-0000-0000-0000-000000000001', 'pf77_lang', 'Jezyk', 'Language',
   0, 'PLN', NULL, 0, false, true, 10, true, 8),
  ('77200000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777',
   '77100000-0000-0000-0000-000000000002', 'pf77_cascade', 'Kaskada', 'Cascade',
   0, 'PLN', NULL, 0, false, true, 10, true, 8),
  ('77200000-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777',
   '77100000-0000-0000-0000-000000000003', 'pf77_paid', 'Platny', 'Paid',
   10000, 'PLN', NULL, 0, false, true, 10, true, 5);

-- Sesje: S1 na E1 (stan konta na innym wydarzeniu), S2A (1 miejsce + kolejka)
-- i S2B na E2, S3 (1 miejsce + kolejka) na E3.
INSERT INTO public.event_sessions
  (id, tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at, status,
   requires_signup, capacity, is_private, stream_url, cancelled_at)
VALUES
  ('77300000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   '77100000-0000-0000-0000-000000000001', NULL, 'Sesja E1', 'Session E1',
   now() + interval '30 days', now() + interval '30 days 1 hour', 'published',
   true, NULL, false, NULL, NULL),
  ('77300000-0000-0000-0000-00000000002a', '77777777-7777-7777-7777-777777777777',
   '77100000-0000-0000-0000-000000000002', NULL, 'Warsztat', 'Workshop',
   now() + interval '30 days', now() + interval '30 days 1 hour', 'published',
   true, 1, false, NULL, NULL),
  ('77300000-0000-0000-0000-00000000002b', '77777777-7777-7777-7777-777777777777',
   '77100000-0000-0000-0000-000000000002', NULL, 'Panel', 'Panel',
   now() + interval '30 days 2 hours', now() + interval '30 days 3 hours', 'published',
   true, NULL, false, NULL, NULL),
  ('77300000-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777',
   '77100000-0000-0000-0000-000000000003', NULL, 'Warsztat E3', 'Workshop E3',
   now() + interval '30 days', now() + interval '30 days 1 hour', 'published',
   true, 1, false, NULL, NULL);

SELECT set_config('nes.public_tenant', '77777777-7777-7777-7777-777777777777', false);

-- Zgloszenie wprost do tabeli. Konto to jedna osoba najemcy
-- (`event_people_tenant_user_uniq`), wiec kolejne zgloszenie tego samego
-- konta dostaje TE SAMA osobe. `_lead` dopina zgloszenie jako goscia.
CREATE FUNCTION pg_temp.pf77_reg(_key text, _event uuid, _ticket uuid, _status text,
                                 _payment text DEFAULT 'not_required',
                                 _user uuid DEFAULT NULL, _lead uuid DEFAULT NULL,
                                 _lang text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t constant uuid := '77777777-7777-7777-7777-777777777777';
  v_person uuid;
  v_id uuid := gen_random_uuid();
  v_seated boolean := _status IN ('approved', 'attended');
BEGIN
  IF _user IS NOT NULL THEN
    SELECT p.id INTO v_person FROM public.event_people p
     WHERE p.tenant_id = t AND p.user_id = _user;
  END IF;
  IF v_person IS NULL THEN
    v_person := gen_random_uuid();
    INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name)
    VALUES (v_person, t, _user, _key || '@pf77.example.org', 'Osoba', initcap(_key));
  END IF;
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
     waitlist_position, decided_at, decision_source, qr_token_hash, qr_issued_at, attended_at,
     group_lead_registration_id, lang)
  VALUES
    (v_id, t, _event, v_person, _ticket, _status, 'form', _payment,
     CASE WHEN _status = 'waitlist' THEN public._event_next_waitlist_position(t, _event) END,
     CASE WHEN v_seated THEN now() END,
     CASE WHEN v_seated THEN 'system' END,
     CASE WHEN v_seated THEN encode(extensions.digest(_key || '-qr', 'sha256'), 'hex') END,
     CASE WHEN v_seated THEN now() END,
     CASE WHEN _status = 'attended' THEN now() END,
     _lead, _lang);
  INSERT INTO pf77_q VALUES (_key, v_id);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.pf77(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM pf77_q WHERE k = _key $$;

CREATE FUNCTION pg_temp.pf77_decide(_id uuid, _action text, _note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as('77000000-0000-0000-0000-0000000000a1', '77777777-7777-7777-7777-777777777777');
  v := public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', _id, 'action', _action, 'note', _note));
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

-- Jezyk pozycji wyniku `_event_issue_ticket_codes` / zawiadomien po zgloszeniu.
CREATE FUNCTION pg_temp.pf77_lang(_items jsonb, _key text) RETURNS text
LANGUAGE sql AS $$
  SELECT e->>'lang' FROM jsonb_array_elements(_items) e
   WHERE (e->>'registration_id')::uuid = pg_temp.pf77(_key)
$$;

-- ---------------------------------------------------------------------------
-- 1) WYDANIE BILETOW: JEZYK ODBIORCY (issue-codes-lang)
-- ---------------------------------------------------------------------------
-- Grupa L1 (prowadzacy z `lang = 'en'` w kolumnie) i pieciu gosci:
--   ga1 bez konta, `lang = 'en'`           -> en (kolumna; bylo: pl)
--   ga2 bez konta, `lang` NULL             -> en (prowadzacy; bylo: pl)
--   ga3 konto z profilem pl, `lang` NULL   -> pl (profil przed prowadzacym)
--   ga4 konto z profilem en, `lang = 'pl'` -> pl (kolumna przed profilem; bylo: en)
--   ga5 bez konta, newsletter pl           -> pl (newsletter przed prowadzacym)
SELECT pg_temp.pf77_reg('l1', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000001', NULL, 'en');
SELECT pg_temp.pf77_reg('ga1', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'not_required', NULL, pg_temp.pf77('l1'), 'en');
SELECT pg_temp.pf77_reg('ga2', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'not_required', NULL, pg_temp.pf77('l1'));
SELECT pg_temp.pf77_reg('ga3', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000003', pg_temp.pf77('l1'));
SELECT pg_temp.pf77_reg('ga4', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000004', pg_temp.pf77('l1'), 'pl');
SELECT pg_temp.pf77_reg('ga5', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'not_required', NULL, pg_temp.pf77('l1'));
INSERT INTO public.newsletter_subscribers (tenant_id, email, language) VALUES
  ('77777777-7777-7777-7777-777777777777', 'GA5@pf77.example.org', 'PL');

-- Pojedyncze zgloszenia: zwrocone czesciowo (bilet nadal wychodzi) i przyjete
-- bez wplaty (warunek rozliczenia go nie przepuszcza).
SELECT pg_temp.pf77_reg('pr', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'partially_refunded');
SELECT pg_temp.pf77_reg('unpaid', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'unpaid');

DO $$
DECLARE
  v jsonb;
  e jsonb;
BEGIN
  v := public._event_issue_ticket_codes(pg_temp.pf77('l1'));
  PERFORM pg_temp.assert(jsonb_array_length(v) = 6,
    '77/lang: punkt wyjscia - wydanie obejmuje prowadzacego i pieciu gosci');
  PERFORM pg_temp.assert(
    pg_temp.pf77_lang(v, 'ga1') = 'en' AND pg_temp.pf77_lang(v, 'l1') = 'en',
    '77/lang: PF-F ZMIANA issue-codes-lang - gosc bez konta z lang = en dostaje bilet po angielsku (kolumna zgloszenia)');
  PERFORM pg_temp.assert(pg_temp.pf77_lang(v, 'ga2') = 'en',
    '77/lang: PF-F ZMIANA issue-codes-lang - gosc bez jezyka dziedziczy lang prowadzacego (en)');
  PERFORM pg_temp.assert(pg_temp.pf77_lang(v, 'ga3') = 'pl',
    '77/lang: PF-F ZMIANA issue-codes-lang - profil (pl) wygrywa z jezykiem prowadzacego');
  PERFORM pg_temp.assert(pg_temp.pf77_lang(v, 'ga4') = 'pl',
    '77/lang: PF-F ZMIANA issue-codes-lang - kolumna zgloszenia (pl) wygrywa z profilem (en)');
  PERFORM pg_temp.assert(pg_temp.pf77_lang(v, 'ga5') = 'pl',
    '77/lang: PF-F ZMIANA issue-codes-lang - newsletter najemcy (pl) wygrywa z jezykiem prowadzacego');

  -- Wydanie potwierdzone: bilety dotarly (podstawa zawiadomien w sekcji 2).
  FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP
    PERFORM public._event_ticket_code_confirm(
      (e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;

  -- Warunek rozliczenia skopiowany z 20260926180000 bez zmian.
  v := public._event_issue_ticket_codes(pg_temp.pf77('pr'));
  PERFORM pg_temp.assert(jsonb_array_length(v) = 1
      AND (v->0->>'registration_id')::uuid = pg_temp.pf77('pr')
      AND v->0->>'qr_token' IS NOT NULL AND v->0->>'lang' = 'pl',
    '77/bilet: partially-refunded-issue - zgloszenie zwrocone czesciowo nadal dostaje bilet (jezyk domyslny pl)');
  v := public._event_issue_ticket_codes(pg_temp.pf77('unpaid'));
  PERFORM pg_temp.assert(v = '[]'::jsonb,
    '77/bilet: kontrapunkt - przyjete zgloszenie bez wplaty (unpaid) biletu nie dostaje');
END $$;

SELECT pg_temp.assert(
  (SELECT p.prosrc LIKE '%public._event_registration_lang(reg.tenant_id, reg.id)%'
          AND p.prosrc NOT LIKE '%public.profiles%'
          AND p.prosrc NOT LIKE '%newsletter_subscribers%'
          AND p.prosrc LIKE '%(''paid'', ''partially_refunded'', ''not_required'')%'
     FROM pg_proc p WHERE p.oid = 'public._event_issue_ticket_codes(uuid)'::regprocedure),
  '77/lang: PF-F ZMIANA issue-codes-lang - cialo czyta jezyk tylko przez _event_registration_lang, warunek rozliczenia bez zmian');
SELECT pg_temp.assert(
  obj_description('public._event_issue_ticket_codes(uuid)'::regprocedure, 'pg_proc') LIKE '%_event_registration_lang%'
  AND obj_description('public._event_issue_ticket_codes(uuid)'::regprocedure, 'pg_proc') LIKE '%partially_refunded%'
  AND has_function_privilege('service_role', 'public._event_issue_ticket_codes(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_issue_ticket_codes(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_issue_ticket_codes(uuid)', 'EXECUTE')
  AND (SELECT 'search_path=public, extensions, pg_temp' = ANY (p.proconfig)
         FROM pg_proc p WHERE p.oid = 'public._event_issue_ticket_codes(uuid)'::regprocedure),
  '77/lang: PF-F ZMIANA issue-codes-lang - komentarz (R-1, warunek rozliczenia), ACL service_role, search_path z pg_temp');

-- ---------------------------------------------------------------------------
-- 2) ZAWIADOMIENIE O ODWOLANYM BILECIE: JEZYK ODBIORCY (revoked-notice-lang)
-- ---------------------------------------------------------------------------
-- Organizator odrzuca prowadzacego L1: kaskada zamyka gosci z dostarczonym
-- biletem i stempluje zawiadomienie. Jezyk jak przy wydaniu biletu.
DO $$
DECLARE
  v jsonb;
BEGIN
  v := pg_temp.pf77_decide(pg_temp.pf77('l1'), 'reject', 'Grupa L1 odwolana');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations
      WHERE group_lead_registration_id = pg_temp.pf77('l1')
        AND status = 'rejected' AND ticket_revoked_at IS NOT NULL) = 5,
    '77/lang: punkt wyjscia - odrzucenie prowadzacego zamyka pieciu gosci i stempluje zawiadomienia');

  v := public._event_ticket_revoked_notices_claim(20)->'notices';
  PERFORM pg_temp.assert(jsonb_array_length(v) = 5,
    '77/lang: punkt wyjscia - partia niesie piec zawiadomien gosci L1');
  PERFORM pg_temp.assert(
    pg_temp.pf77_lang(v, 'ga1') = 'en' AND pg_temp.pf77_lang(v, 'ga2') = 'en',
    '77/lang: PF-F ZMIANA revoked-notice-lang - gosc z lang = en i gosc dziedziczacy lang prowadzacego dostaja zawiadomienie po angielsku');
  PERFORM pg_temp.assert(
    pg_temp.pf77_lang(v, 'ga3') = 'pl' AND pg_temp.pf77_lang(v, 'ga4') = 'pl'
    AND pg_temp.pf77_lang(v, 'ga5') = 'pl',
    '77/lang: PF-F ZMIANA revoked-notice-lang - profil, kolumna i newsletter w kolejnosci _event_registration_lang');
END $$;

SELECT pg_temp.assert(
  (SELECT p.prosrc LIKE '%public._event_registration_lang(m.tenant_id, m.id)%'
          AND p.prosrc NOT LIKE '%public.profiles%'
          AND p.prosrc NOT LIKE '%newsletter_subscribers%'
     FROM pg_proc p WHERE p.oid = 'public._event_ticket_revoked_notices_claim(integer)'::regprocedure)
  AND obj_description('public._event_ticket_revoked_notices_claim(integer)'::regprocedure, 'pg_proc')
      LIKE '%_event_registration_lang (R-1)%'
  AND has_function_privilege('service_role', 'public._event_ticket_revoked_notices_claim(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_ticket_revoked_notices_claim(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_ticket_revoked_notices_claim(integer)', 'EXECUTE')
  AND (SELECT 'search_path=public, pg_temp' = ANY (p.proconfig)
         FROM pg_proc p WHERE p.oid = 'public._event_ticket_revoked_notices_claim(integer)'::regprocedure),
  '77/lang: PF-F ZMIANA revoked-notice-lang - cialo i komentarz przez _event_registration_lang, ACL service_role, search_path z pg_temp');

-- ---------------------------------------------------------------------------
-- 3) KASKADA STATUSU ZWALNIA KONTA ZAMKNIETYCH GOSCI (cascade-releases-guests)
-- ---------------------------------------------------------------------------
-- Grupa L2 na E2:
--   gca konto ua, przyjety: jedyne miejsce na S2A (uw czeka w kolejce sesji),
--       zakladka S2B, RSVP going;
--   gcb konto ub, OBECNY (attended): zapis S2B, zakladka S2A, RSVP going;
--   gcc konto uc, przyjety: zapis S2B i zakladka tutaj, a na E1 aktywne
--       zgloszenie z zapisem na S1, zakladka i RSVP;
--   gcd bez konta, oczekujacy;
--   gce konto ue, oczekujacy: zakladka S2A.
-- uw ma wlasne aktywne zgloszenie na E2 (uczestnik z kolejki sesji).
SELECT pg_temp.pf77_reg('l2', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000011');
SELECT pg_temp.pf77_reg('gca', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000012', pg_temp.pf77('l2'));
SELECT pg_temp.pf77_reg('gcb', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'attended', 'not_required', '77000000-0000-0000-0000-000000000013', pg_temp.pf77('l2'));
SELECT pg_temp.pf77_reg('gcc', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000014', pg_temp.pf77('l2'));
SELECT pg_temp.pf77_reg('gcd', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'pending', 'not_required', NULL, pg_temp.pf77('l2'));
SELECT pg_temp.pf77_reg('gce', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'pending', 'not_required', '77000000-0000-0000-0000-000000000015', pg_temp.pf77('l2'));
SELECT pg_temp.pf77_reg('uw', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000016');
SELECT pg_temp.pf77_reg('uc_e1', '77100000-0000-0000-0000-000000000001', '77200000-0000-0000-0000-000000000001',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000014');

INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status, registered_at) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002a', '77000000-0000-0000-0000-000000000012', 'registered', now() - interval '3 hours'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002a', '77000000-0000-0000-0000-000000000016', 'waitlist', now() - interval '2 hours'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002b', '77000000-0000-0000-0000-000000000013', 'registered', now() - interval '2 hours'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002b', '77000000-0000-0000-0000-000000000014', 'registered', now() - interval '2 hours'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000001',
   '77300000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000014', 'registered', now() - interval '2 hours');
INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002b', '77000000-0000-0000-0000-000000000012'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002a', '77000000-0000-0000-0000-000000000013'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002b', '77000000-0000-0000-0000-000000000014'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000001',
   '77300000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000014'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002a', '77000000-0000-0000-0000-000000000015');
INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77000000-0000-0000-0000-000000000012', 'going'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77000000-0000-0000-0000-000000000013', 'going'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000001',
   '77000000-0000-0000-0000-000000000014', 'going');

DO $$
DECLARE
  v jsonb;
BEGIN
  v := pg_temp.pf77_decide(pg_temp.pf77('l2'), 'reject', 'Grupa L2 odwolana');
  -- Zamkniecie bez zmian (SET i WHERE z 20260926180000): czterech gosci
  -- odrzuconych, obecny zostaje.
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations
      WHERE group_lead_registration_id = pg_temp.pf77('l2') AND status = 'rejected'
        AND qr_token_hash IS NULL) = 4
    AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.pf77('gcb')) = 'attended',
    '77/kaskada: punkt wyjscia - odrzucenie prowadzacego zamyka czterech gosci (takze bez konta), obecny zostaje');
END $$;

SELECT pg_temp.assert(
  (SELECT status FROM public.event_session_signups
    WHERE session_id = '77300000-0000-0000-0000-00000000002a'
      AND user_id = '77000000-0000-0000-0000-000000000012') = 'cancelled'
  AND (SELECT status FROM public.event_session_signups
    WHERE session_id = '77300000-0000-0000-0000-00000000002a'
      AND user_id = '77000000-0000-0000-0000-000000000016') = 'registered'
  AND NOT EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '77000000-0000-0000-0000-000000000012')
  AND (SELECT status FROM public.event_rsvps
    WHERE user_id = '77000000-0000-0000-0000-000000000012') = 'cancelled',
  '77/kaskada: PF-F ZMIANA cascade-releases-guests - odrzucony gosc traci zapis (kolejka sesji awansuje), zakladke i RSVP');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '77000000-0000-0000-0000-000000000015'),
  '77/kaskada: PF-F ZMIANA cascade-releases-guests - oczekujacy gosc z kontem tez traci zakladke');
SELECT pg_temp.assert(
  (SELECT status FROM public.event_session_signups
    WHERE session_id = '77300000-0000-0000-0000-00000000002b'
      AND user_id = '77000000-0000-0000-0000-000000000013') = 'registered'
  AND EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '77000000-0000-0000-0000-000000000013')
  AND (SELECT status FROM public.event_rsvps
    WHERE user_id = '77000000-0000-0000-0000-000000000013') = 'going',
  '77/kaskada: kontrapunkt - gosc obecny (attended) nie jest zamykany i zachowuje zapis, zakladke i RSVP');
SELECT pg_temp.assert(
  (SELECT status FROM public.event_session_signups
    WHERE session_id = '77300000-0000-0000-0000-00000000002b'
      AND user_id = '77000000-0000-0000-0000-000000000014') = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '77000000-0000-0000-0000-000000000014'
      AND event_id = '77100000-0000-0000-0000-000000000002')
  AND (SELECT status FROM public.event_session_signups
    WHERE session_id = '77300000-0000-0000-0000-000000000001'
      AND user_id = '77000000-0000-0000-0000-000000000014') = 'registered'
  AND EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '77000000-0000-0000-0000-000000000014'
      AND event_id = '77100000-0000-0000-0000-000000000001')
  AND (SELECT status FROM public.event_rsvps
    WHERE user_id = '77000000-0000-0000-0000-000000000014'
      AND event_id = '77100000-0000-0000-0000-000000000001') = 'going'
  AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.pf77('uc_e1')) = 'approved',
  '77/kaskada: kontrapunkt - konto z aktywnym zgloszeniem na INNYM wydarzeniu traci stan tylko tutaj, tamten zostaje');

-- Anulowanie przez samego prowadzacego (samoobsluga): ta sama kaskada.
SELECT pg_temp.pf77_reg('l3', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000021');
SELECT pg_temp.pf77_reg('gf', '77100000-0000-0000-0000-000000000002', '77200000-0000-0000-0000-000000000002',
  'approved', 'not_required', '77000000-0000-0000-0000-000000000022', pg_temp.pf77('l3'));
INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status, registered_at) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002b', '77000000-0000-0000-0000-000000000022', 'registered', now());
INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77300000-0000-0000-0000-00000000002b', '77000000-0000-0000-0000-000000000022');
INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000002',
   '77000000-0000-0000-0000-000000000022', 'going');

DO $$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.act_as('77000000-0000-0000-0000-000000000021', '77777777-7777-7777-7777-777777777777');
  v := public.event_registration_cancel(jsonb_build_object('registration_id', pg_temp.pf77('l3')));
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations WHERE id = pg_temp.pf77('l3')) = 'cancelled'
    AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.pf77('gf')) = 'cancelled',
    '77/kaskada: punkt wyjscia - samodzielne anulowanie prowadzacego zamyka goscia');
END $$;

SELECT pg_temp.assert(
  (SELECT status FROM public.event_session_signups
    WHERE session_id = '77300000-0000-0000-0000-00000000002b'
      AND user_id = '77000000-0000-0000-0000-000000000022') = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '77000000-0000-0000-0000-000000000022')
  AND (SELECT status FROM public.event_rsvps
    WHERE user_id = '77000000-0000-0000-0000-000000000022') = 'cancelled',
  '77/kaskada: PF-F ZMIANA cascade-releases-guests - anulowanie prowadzacego (samoobsluga) zwalnia konto goscia tak samo');

SELECT pg_temp.assert(
  (SELECT position('PERFORM public._event_group_promote_freed' IN p.prosrc) > 0
          AND position('PERFORM public._event_group_promote_freed' IN p.prosrc)
              < position('PERFORM public._event_participant_release' IN p.prosrc)
          AND p.prosrc LIKE '%RETURNING r.person_id%'
     FROM pg_proc p WHERE p.oid = 'public._tg_event_group_follow_lead_status()'::regprocedure)
  AND obj_description('public._tg_event_group_follow_lead_status()'::regprocedure, 'pg_proc')
      LIKE '%_event_participant_release, D0-2%'
  AND NOT has_function_privilege('authenticated', 'public._tg_event_group_follow_lead_status()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._tg_event_group_follow_lead_status()', 'EXECUTE'),
  '77/kaskada: PF-F ZMIANA cascade-releases-guests - zwolnienie PO awansie kolejki (A.3), komentarz D0-2, bez grantu dla klientow');

-- ---------------------------------------------------------------------------
-- 4) ZWROT GRUPY: ZWOLNIENIE KONT PO AWANSIE KOLEJKI (group-release-after-promote)
-- ---------------------------------------------------------------------------
-- E3 ma 3 miejsca: prowadzacy L4 i dwoch gosci (gr1 z kontem ur, gr2 bez
-- konta) placa jednym zamowieniem, potem ktos staje w kolejce. Pelny zwrot:
-- goscie anulowani, kolejka awansuje za ich miejsca (bez wlasnej grupy),
-- dopiero potem konto ur traci zapis na S3 (uw3 z kolejki sesji awansuje),
-- zakladke i RSVP.
SELECT pg_temp.pf77_reg('l4', '77100000-0000-0000-0000-000000000003', '77200000-0000-0000-0000-000000000003',
  'pending', 'unpaid', '77000000-0000-0000-0000-000000000031');
SELECT pg_temp.pf77_reg('gr1', '77100000-0000-0000-0000-000000000003', '77200000-0000-0000-0000-000000000003',
  'pending', 'unpaid', '77000000-0000-0000-0000-000000000032', pg_temp.pf77('l4'));
SELECT pg_temp.pf77_reg('gr2', '77100000-0000-0000-0000-000000000003', '77200000-0000-0000-0000-000000000003',
  'pending', 'unpaid', NULL, pg_temp.pf77('l4'));
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT '77400000-0000-0000-0000-000000000004', '77777777-7777-7777-7777-777777777777',
       '77000000-0000-0000-0000-000000000031', 'paid', 30000, 'PLN',
       jsonb_build_object('event_id', '77100000-0000-0000-0000-000000000003',
                          'ticket_type_id', '77200000-0000-0000-0000-000000000003',
                          'registration_id', pg_temp.pf77('l4'));

DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('77400000-0000-0000-0000-000000000004', 'paid', NULL);
  PERFORM pg_temp.assert((v->>'applied')::boolean
    AND (SELECT count(*) FROM public.event_registrations
          WHERE event_id = '77100000-0000-0000-0000-000000000003'
            AND status = 'approved' AND payment_status = 'paid') = 3,
    '77/grupa: punkt wyjscia - prowadzacy i dwoch gosci oplaceni i przyjeci, sala pelna');
END $$;

SELECT pg_temp.pf77_reg('wq', '77100000-0000-0000-0000-000000000003', '77200000-0000-0000-0000-000000000003',
  'waitlist', 'unpaid');
INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status, registered_at) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000003',
   '77300000-0000-0000-0000-000000000003', '77000000-0000-0000-0000-000000000032', 'registered', now() - interval '3 hours'),
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000003',
   '77300000-0000-0000-0000-000000000003', '77000000-0000-0000-0000-000000000033', 'waitlist', now() - interval '2 hours');
INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000003',
   '77300000-0000-0000-0000-000000000003', '77000000-0000-0000-0000-000000000032');
INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status) VALUES
  ('77777777-7777-7777-7777-777777777777', '77100000-0000-0000-0000-000000000003',
   '77000000-0000-0000-0000-000000000032', 'going');

DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('77400000-0000-0000-0000-000000000004', 'refunded', NULL);
  PERFORM pg_temp.assert((v->>'applied')::boolean
    AND (SELECT count(*) FROM public.event_registrations
          WHERE group_lead_registration_id = pg_temp.pf77('l4')
            AND status = 'cancelled' AND payment_status = 'refunded' AND qr_token_hash IS NULL) = 2,
    '77/grupa: punkt wyjscia - pelny zwrot anuluje obu gosci i czysci ich kody');
END $$;

SELECT pg_temp.assert(
  (SELECT status = 'approved' AND waitlist_position IS NULL
     FROM public.event_registrations WHERE id = pg_temp.pf77('wq'))
  AND (SELECT status FROM public.event_session_signups
    WHERE session_id = '77300000-0000-0000-0000-000000000003'
      AND user_id = '77000000-0000-0000-0000-000000000032') = 'cancelled'
  AND (SELECT status FROM public.event_session_signups
    WHERE session_id = '77300000-0000-0000-0000-000000000003'
      AND user_id = '77000000-0000-0000-0000-000000000033') = 'registered'
  AND NOT EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '77000000-0000-0000-0000-000000000032')
  AND (SELECT status FROM public.event_rsvps
    WHERE user_id = '77000000-0000-0000-0000-000000000032') = 'cancelled',
  '77/grupa: PF-F ZMIANA group-release-after-promote - czolo kolejki awansuje, a zwrocony gosc traci zapis (kolejka sesji awansuje), zakladke i RSVP');

SELECT pg_temp.assert(
  (SELECT position('PERFORM public._event_group_promote_freed' IN p.prosrc) > 0
          AND position('PERFORM public._event_group_promote_freed' IN p.prosrc)
              < position('PERFORM public._event_participant_release' IN p.prosrc)
          AND (length(p.prosrc) - length(replace(p.prosrc, '_event_participant_release(', '')))
              / length('_event_participant_release(') = 1
          AND p.prosrc LIKE '%v_release := array_append(v_release, v_guest_user)%'
     FROM pg_proc p WHERE p.oid = 'public._event_apply_outcome_to_group(uuid,uuid,text)'::regprocedure)
  AND obj_description('public._event_apply_outcome_to_group(uuid,uuid,text)'::regprocedure, 'pg_proc') LIKE '%A.3%'
  AND obj_description('public._event_apply_outcome_to_group(uuid,uuid,text)'::regprocedure, 'pg_proc') LIKE '%D0-2%'
  AND has_function_privilege('service_role', 'public._event_apply_outcome_to_group(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_apply_outcome_to_group(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_apply_outcome_to_group(uuid,uuid,text)', 'EXECUTE'),
  '77/grupa: PF-F ZMIANA group-release-after-promote - jedno zwolnienie, PO awansie kolejki (A.3); komentarz A.3 i D0-2; ACL service_role');

SELECT set_config('nes.public_tenant', '', false);
ROLLBACK;
