-- ============================================================================
-- 25_account_binding_invites - KARTOTEKA I KONTO, ZAPROSZENIA PAKIETOWE
-- (B2: 20261012132000..132200, 20261012190000; REG-01, REG-15)
--
-- PO CO TEN PLIK ISTNIEJE
-- pgTAP (event_people_account_binding_test.sql,
-- event_package_invite_accept_test.sql) przypina te tezy na pelnym schemacie;
-- ten plik sprawdza je na REPLAYU modulu wydarzen - na tych samych cialach,
-- ktore dostaja pozostale pliki harnessu, i na atrapie `auth.users`
-- (`email_confirmed_at` DEFAULT now(), jawny NULL = konto niepotwierdzone).
-- Zawiera PIERWSZE udane przyjecie zaproszenia pakietowego w historii
-- harnessu: wczesniejsze cialo `event_package_invite_accept` nie przyjmowalo
-- zadnego zaproszenia (zrodlo spoza listy CHECK i lamana para tokenu).
--
-- CO SPRAWDZA
--   1. Profil wydarzenia: adres kartoteki zmienia sie tylko na potwierdzony
--      adres konta (`email_unverified`, `email_in_use`), prawowita zmiana
--      przechodzi.
--   2. Samodzielne dowiazanie: tylko potwierdzony adres konta = adres osoby.
--   3. Naprawa historii: symulowane przejecie sprzed poprawki w audycie jako
--      `foreign_record`, odwiazanie z dziennikiem, audyt najemcy pusty,
--      przywrocenie przez administratora z atestem, obcy administrator
--      odrzucony.
--   4. Zaproszenie: pudlo tokenu jako wartosc z licznikiem, ktory zostaje;
--      regulamin i pola obowiazkowe; pierwsze udane przyjecie (zrodlo
--      `invitation`, para adres + skrot tokenu zachowana, akceptacja
--      regulaminu z wersja); ponowne uzycie -> `seat_taken`; cudza kartoteka
--      nietknieta, a konto niezaproszonego nie wiaze sie.
--
-- CZEGO NIE SPRAWDZA: pelnego ACL, synchronizacji z kontem (atrapa
-- `profiles` nie ma kolumny `bio`, ktora czyta cialo) i kubelka konta - to
-- pgTAP.
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================
\echo '== 25 kartoteka i konto, zaproszenia pakietowe (REG-01, REG-15) =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2', 'Tenant C5B2 (konto i zaproszenia)', 'tc5b2-bind'),
  ('c5b3c5b3-c5b3-c5b3-c5b3-c5b3c5b3c5b3', 'Tenant C5B3 (obcy najemca)', 'tc5b3-bind');

-- 01 X (x@), 02 X2 (napastnik sprzed poprawki), 03 K (potwierdzony k@),
-- 04 M (NIEPOTWIERDZONY), 05 admin najemcy C5B2, 06 admin obcego najemcy,
-- 07 D (zaproszony del@), 08 W (posiadacz cudzego linku, ma swoja kartoteke).
INSERT INTO auth.users (id, email) VALUES
  ('c5b00000-0000-0000-0000-000000000001', 'x.bind@example.org'),
  ('c5b00000-0000-0000-0000-000000000002', 'x2.bind@example.org'),
  ('c5b00000-0000-0000-0000-000000000003', 'k.bind@example.org'),
  ('c5b00000-0000-0000-0000-000000000005', 'admin.bind@example.org'),
  ('c5b00000-0000-0000-0000-000000000006', 'admin-obcy.bind@example.org'),
  ('c5b00000-0000-0000-0000-000000000007', 'del.bind@example.org'),
  ('c5b00000-0000-0000-0000-000000000008', 'w.bind@example.org');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c5b00000-0000-0000-0000-000000000004', 'm.bind@example.org', NULL);
INSERT INTO public.profiles (id, tenant_id, display_name) VALUES
  ('c5b00000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2', 'X'),
  ('c5b00000-0000-0000-0000-000000000005', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2', 'Admin'),
  ('c5b00000-0000-0000-0000-000000000006', 'c5b3c5b3-c5b3-c5b3-c5b3-c5b3c5b3c5b3', 'Admin obcy');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c5b00000-0000-0000-0000-000000000005', 'admin', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2'),
  ('c5b00000-0000-0000-0000-000000000006', 'admin', 'c5b3c5b3-c5b3-c5b3-c5b3-c5b3c5b3c5b3');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
  registration_mode, registration_flow) VALUES
  ('c5b10000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2', 'bind-kongres',
   'Kongres', 'Congress', now() + interval '30 days', NULL, 'published', 'form', 'instant');
INSERT INTO public.event_registration_fields (tenant_id, event_id, key, field_type, label_pl, label_en, is_required) VALUES
  ('c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2', 'c5b10000-0000-0000-0000-000000000001', 'sektor', 'text', 'Sektor', 'Sector', true);
INSERT INTO public.event_terms (id, tenant_id, event_id, key, label_pl, label_en, body_pl, is_required, display, version) VALUES
  ('c5b40000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   'c5b10000-0000-0000-0000-000000000001', 'bind_regulamin', 'Regulamin', 'Terms', 'Tresc regulaminu.',
   true, 'registration', 2);

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, created_by) VALUES
  -- X: dowiazanie zgodne z D1.
  ('c5b50000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   'c5b00000-0000-0000-0000-000000000001', 'x.bind@example.org', 'Xawery', 'Iks',
   'c5b00000-0000-0000-0000-000000000001'),
  -- L: gosc, ktorego kartoteke przejelo konto X2 przed poprawka.
  ('c5b50000-0000-0000-0000-000000000002', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   NULL, 'l.bind@example.org', 'Lena', 'Ofiara', NULL),
  -- Goscie k@ i m@ (samodzielne dowiazanie) i kartoteka W.
  ('c5b50000-0000-0000-0000-000000000003', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   NULL, 'k.bind@example.org', 'Kamil', 'Gosc', NULL),
  ('c5b50000-0000-0000-0000-000000000004', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   NULL, 'm.bind@example.org', 'Marta', 'Gosc', NULL),
  ('c5b50000-0000-0000-0000-000000000008', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   'c5b00000-0000-0000-0000-000000000008', 'w.bind@example.org', 'Wanda', 'Wlasna',
   'c5b00000-0000-0000-0000-000000000008'),
  -- Zaproszona other@ (gosc, ktory wycofal zgody).
  ('c5b50000-0000-0000-0000-000000000009', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   NULL, 'other.bind@example.org', 'Olga', 'Other', NULL);
UPDATE public.event_people SET consent_withdrawn_at = now() - interval '5 days'
 WHERE id = 'c5b50000-0000-0000-0000-000000000009';
-- Przejecie sprzed poprawki: stary zapis wiazal konto z osoba o adresie
-- z ladunku (20261007140400:535).
UPDATE public.event_people SET user_id = 'c5b00000-0000-0000-0000-000000000002'
 WHERE id = 'c5b50000-0000-0000-0000-000000000002';

CREATE TEMP TABLE bind25 (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON bind25 TO anon, authenticated;

SELECT set_config('nes.public_tenant', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2', false);

-- 1) PROFIL WYDARZENIA: ADRES TYLKO POTWIERDZONY --------------------------------
SELECT pg_temp.act_as('c5b00000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2');
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_my_event_profile_set('{"slug":"bind-kongres","email":"nieuzyty.bind@example.org"}'::jsonb)$q$,
  'email_unverified',
  '25/profil: X nie przestawi kartoteki na nieuzyty cudzy adres (zawlaszczenie zamkniete)');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_my_event_profile_set('{"slug":"bind-kongres","email":"k.bind@example.org"}'::jsonb)$q$,
  'email_unverified',
  '25/profil: X nie przestawi kartoteki na adres istniejacego goscia (bez wyroczni email_in_use)');
SELECT public.event_my_event_profile_set('{"slug":"bind-kongres","email":"X.Bind@example.org ","first_name":"Xawier"}'::jsonb);
RESET ROLE;
SELECT pg_temp.assert(
  (SELECT email_norm = 'x.bind@example.org' AND first_name = 'Xawier'
     FROM public.event_people WHERE id = 'c5b50000-0000-0000-0000-000000000001'),
  '25/profil: ten sam adres (wielkosc liter, spacja) to nie zmiana - reszta profilu zapisana');

-- 2) SAMODZIELNE DOWIAZANIE ---------------------------------------------------------
SELECT pg_temp.act_as('c5b00000-0000-0000-0000-000000000003', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2');
SET ROLE authenticated;
INSERT INTO bind25 VALUES ('link_k', public.event_my_account_link('{}'::jsonb));
SELECT pg_temp.act_as('c5b00000-0000-0000-0000-000000000004', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2');
INSERT INTO bind25 VALUES ('link_m', public.event_my_account_link('{}'::jsonb));
RESET ROLE;
SELECT pg_temp.assert(
  (SELECT (v->>'linked')::boolean FROM bind25 WHERE k = 'link_k')
  AND (SELECT user_id = 'c5b00000-0000-0000-0000-000000000003' FROM public.event_people
        WHERE id = 'c5b50000-0000-0000-0000-000000000003'),
  '25/dowiazanie: konto z potwierdzonym adresem k@ dowiazuje kartoteke goscia');
SELECT pg_temp.assert(
  (SELECT v->>'reason' = 'email_unconfirmed' FROM bind25 WHERE k = 'link_m')
  AND (SELECT user_id IS NULL FROM public.event_people WHERE id = 'c5b50000-0000-0000-0000-000000000004'),
  '25/dowiazanie: konto bez potwierdzenia nie dowiazuje kartoteki m@');

-- 3) NAPRAWA HISTORII --------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(
  (SELECT count(*) = 1 AND bool_and(person_id = 'c5b50000-0000-0000-0000-000000000002'
                                    AND user_id = 'c5b00000-0000-0000-0000-000000000002'
                                    AND risk = 'foreign_record')
     FROM public.event_people_account_binding_audit('c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2')),
  '25/naprawa: audyt najemcy widzi symulowane przejecie L jako foreign_record (i tylko je)');
SELECT pg_temp.assert(
  public._event_people_unbind_unverified('reg01_remediation') >= 1,
  '25/naprawa: odwiazanie zwraca liczbe odwiazanych');
SELECT pg_temp.assert(
  (SELECT user_id IS NULL FROM public.event_people WHERE id = 'c5b50000-0000-0000-0000-000000000002')
  AND EXISTS (SELECT 1 FROM public.event_person_account_unbinds b
               WHERE b.person_id = 'c5b50000-0000-0000-0000-000000000002'
                 AND b.user_id = 'c5b00000-0000-0000-0000-000000000002'
                 AND b.reason = 'reg01_remediation' AND b.risk = 'foreign_record'),
  '25/naprawa: L odwiazana, wpis w dzienniku');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_people_account_binding_audit('c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2'))
  AND NOT EXISTS (SELECT 1 FROM public.event_people_account_binding_audit()),
  '25/naprawa: audyt zwraca 0 wierszy');
INSERT INTO bind25
SELECT 'unbind_l', to_jsonb(b.id) FROM public.event_person_account_unbinds b
 WHERE b.person_id = 'c5b50000-0000-0000-0000-000000000002';

SELECT pg_temp.act_as('c5b00000-0000-0000-0000-000000000006', 'c5b3c5b3-c5b3-c5b3-c5b3-c5b3c5b3c5b3');
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_person_account_restore(jsonb_build_object('unbind_id', %L))$q$,
         (SELECT v #>> '{}' FROM bind25 WHERE k = 'unbind_l')),
  'not_found',
  '25/organizator: administrator obcego najemcy nie przywraca dowiazania (najemca z sesji)');
SELECT pg_temp.act_as('c5b00000-0000-0000-0000-000000000005', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2');
INSERT INTO bind25 VALUES ('list', public.admin_event_people_account_bindings('{}'::jsonb));
INSERT INTO bind25 SELECT 'restore', public.admin_event_person_account_restore(
  jsonb_build_object('unbind_id', (SELECT v #>> '{}' FROM bind25 WHERE k = 'unbind_l')));
RESET ROLE;
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(v->'unverified') = 0
          AND v->'unbinds'->0->>'account_email_hint' = 'x***@example.org'
     FROM bind25 WHERE k = 'list')
  AND (SELECT user_id = 'c5b00000-0000-0000-0000-000000000002' FROM public.event_people
        WHERE id = 'c5b50000-0000-0000-0000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.event_people_account_binding_audit('c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2')),
  '25/organizator: lista z zamaskowanym adresem konta, przywrocenie z atestem - audyt dalej pusty');

-- 4) ZAPROSZENIE PAKIETOWE -------------------------------------------------------
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency) VALUES
  ('c5b60000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   'c5b10000-0000-0000-0000-000000000001', 'bind_std', 'Standard', 'Standard', 20000, 'PLN');
INSERT INTO public.event_ticket_packages (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en,
  audience, seats, price_cents, currency) VALUES
  ('c5b70000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   'c5b10000-0000-0000-0000-000000000001', 'c5b60000-0000-0000-0000-000000000001',
   'bind_pakiet', 'Pakiet', 'Pack', 'public', 3, 50000, 'PLN');
INSERT INTO public.event_package_orders (id, tenant_id, event_id, package_id, buyer_email, seats_total,
  status, amount_cents, paid_at) VALUES
  ('c5b80000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   'c5b10000-0000-0000-0000-000000000001', 'c5b70000-0000-0000-0000-000000000001',
   'kupujacy.bind@example.org', 3, 'paid', 50000, now());

CREATE TEMP TABLE bind25_tok (k text PRIMARY KEY, token text NOT NULL) ON COMMIT DROP;
GRANT SELECT ON bind25_tok TO anon, authenticated;
INSERT INTO bind25_tok VALUES
  ('del', public._event_new_qr_token()), ('oth', public._event_new_qr_token()),
  ('brak', public._event_new_qr_token());
INSERT INTO public.event_package_seats (id, tenant_id, event_id, package_order_id, invite_email,
  invite_name, invite_token_hash, invite_sent_at) VALUES
  ('c5b90000-0000-0000-0000-000000000001', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   'c5b10000-0000-0000-0000-000000000001', 'c5b80000-0000-0000-0000-000000000001',
   'del.bind@example.org', 'Dorota',
   encode(extensions.digest((SELECT token FROM bind25_tok WHERE k = 'del'), 'sha256'), 'hex'), now()),
  ('c5b90000-0000-0000-0000-000000000002', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2',
   'c5b10000-0000-0000-0000-000000000001', 'c5b80000-0000-0000-0000-000000000001',
   'other.bind@example.org', '',
   encode(extensions.digest((SELECT token FROM bind25_tok WHERE k = 'oth'), 'sha256'), 'hex'), now());

CREATE FUNCTION pg_temp.bind25_p(p_tok text, p_terms boolean, p_answers jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'token', (SELECT token FROM bind25_tok WHERE k = p_tok),
    'first_name', 'Dorota', 'last_name', 'Delegat',
    'consent_data_processing', true, 'answers', p_answers,
    'accepted_term_ids', CASE WHEN p_terms THEN jsonb_build_array('c5b40000-0000-0000-0000-000000000001')
                              ELSE '[]'::jsonb END,
    'user_agent', 'z-ladunku/1.0')
$$;
GRANT EXECUTE ON FUNCTION pg_temp.bind25_p(text, boolean, jsonb) TO anon, authenticated;

SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
INSERT INTO bind25 VALUES
  ('miss', public.event_package_invite_accept(pg_temp.bind25_p('brak', true, '{"sektor":"x"}'::jsonb))),
  ('prev', public.event_package_invite_preview(jsonb_build_object('token', (SELECT token FROM bind25_tok WHERE k = 'del'))));
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_package_invite_accept(pg_temp.bind25_p('del', false, '{"sektor":"energia"}'::jsonb))$q$,
  'terms_required',
  '25/zaproszenie: bez obowiazkowego regulaminu -> terms_required');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_package_invite_accept(pg_temp.bind25_p('del', true, '{}'::jsonb))$q$,
  'missing_required_fields',
  '25/zaproszenie: bez obowiazkowego pola -> missing_required_fields');
RESET ROLE;
SELECT pg_temp.assert(
  (SELECT v = '{"ok": false, "error": "invalid_token"}'::jsonb FROM bind25 WHERE k = 'miss')
  AND (SELECT count = 1 FROM public.rate_limits
        WHERE scope = 'event_invite_miss.tenant'
          AND subject_id = 'tenant:c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2'),
  '25/zaproszenie: nieznany token to WARTOSC invalid_token, pudlo zliczone (licznik zostaje)');
SELECT pg_temp.assert(
  (SELECT v->>'state' = 'open' AND v->>'event_slug' = 'bind-kongres'
          AND v->>'invite_email_hint' = 'd***@example.org' AND v->>'account_matches' = 'false'
     FROM bind25 WHERE k = 'prev'),
  '25/zaproszenie: podglad dla goscia - stan open, slug, zamaskowany adres');

-- Pierwsze udane przyjecie: zaproszony D z potwierdzonym adresem.
SELECT pg_temp.act_as('c5b00000-0000-0000-0000-000000000007', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2');
SET ROLE authenticated;
INSERT INTO bind25 VALUES
  ('acc_d', public.event_package_invite_accept(pg_temp.bind25_p('del', true, '{"sektor":"energia"}'::jsonb)));
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_package_invite_accept(pg_temp.bind25_p('del', true, '{"sektor":"energia"}'::jsonb))$q$,
  'seat_taken',
  '25/zaproszenie: ponowne uzycie linku -> seat_taken');
-- W (wlasna kartoteka) przyjmuje miejsce zaproszone na other@.
SELECT pg_temp.act_as('c5b00000-0000-0000-0000-000000000008', 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2');
INSERT INTO bind25 VALUES
  ('acc_w', public.event_package_invite_accept(pg_temp.bind25_p('oth', true, '{"sektor":"nauka"}'::jsonb)));
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);

SELECT pg_temp.assert(
  (SELECT v->>'ok' = 'true' AND v->>'account_linked' = 'true' AND v->>'status' = 'approved'
          AND v->>'qr_token' ~ '^[A-Za-z0-9_-]{32}$' AND v->>'manage_token' ~ '^[A-Za-z0-9_-]{32}$'
     FROM bind25 WHERE k = 'acc_d')
  AND (SELECT user_id = 'c5b00000-0000-0000-0000-000000000007' AND source = 'invitation'
         FROM public.event_people WHERE tenant_id = 'c5b2c5b2-c5b2-c5b2-c5b2-c5b2c5b2c5b2'
          AND email_norm = 'del.bind@example.org'),
  '25/zaproszenie: pierwsze udane przyjecie - kartoteka zaproszenia (zrodlo invitation) dowiazana do potwierdzonego konta');
SELECT pg_temp.assert(
  (SELECT r.source = 'invitation' AND r.status = 'approved' AND r.registration_mode = 'form'
          AND r.answers->>'sektor' = 'energia' AND r.qr_token_hash IS NOT NULL
     FROM public.event_registrations r
    WHERE r.id = (SELECT (v->>'registration_id')::uuid FROM bind25 WHERE k = 'acc_d'))
  AND (SELECT s.registration_id = (SELECT (v->>'registration_id')::uuid FROM bind25 WHERE k = 'acc_d')
          AND s.invite_email = 'del.bind@example.org' AND s.invite_token_hash IS NOT NULL
     FROM public.event_package_seats s WHERE s.id = 'c5b90000-0000-0000-0000-000000000001'),
  '25/zaproszenie: zgloszenie z zaproszenia (invitation, form, odpowiedzi), miejsce zachowuje adres i skrot tokenu');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_term_acceptances a
           WHERE a.term_id = 'c5b40000-0000-0000-0000-000000000001'
             AND a.registration_id = (SELECT (v->>'registration_id')::uuid FROM bind25 WHERE k = 'acc_d')
             AND a.version = 2 AND a.ip_hash IS NULL AND a.user_agent IS NULL),
  '25/zaproszenie: akceptacja regulaminu z wersja, bez dowodu przegladarki z ladunku');
SELECT pg_temp.assert(
  (SELECT v->>'ok' = 'true' AND v->>'account_linked' = 'false' FROM bind25 WHERE k = 'acc_w')
  AND (SELECT user_id IS NULL AND first_name = 'Olga' AND consent_withdrawn_at IS NOT NULL
         FROM public.event_people WHERE id = 'c5b50000-0000-0000-0000-000000000009')
  AND (SELECT user_id = 'c5b00000-0000-0000-0000-000000000008' FROM public.event_people
        WHERE id = 'c5b50000-0000-0000-0000-000000000008')
  AND (SELECT r.submitted_profile->>'last_name' = 'Delegat' FROM public.event_registrations r
        WHERE r.id = (SELECT (v->>'registration_id')::uuid FROM bind25 WHERE k = 'acc_w')),
  '25/zaproszenie: posiadacz cudzego linku - bez 23505, cudza kartoteka nietknieta (imie, wycofanie, konto), dane w submitted_profile');
SELECT pg_temp.assert(
  (SELECT seats_assigned = 2 FROM public.event_package_orders WHERE id = 'c5b80000-0000-0000-0000-000000000001'),
  '25/zaproszenie: licznik przypisanych miejsc zamowienia = 2');

ROLLBACK;
SELECT set_config('nes.public_tenant', '', false);
SELECT pg_temp.act_as(NULL, NULL);
