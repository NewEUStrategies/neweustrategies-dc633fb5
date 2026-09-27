-- ============================================================================
-- 52_ticket_wallet - BILET W PORTFELU (APPLE WALLET / GOOGLE WALLET)
--
-- PO CO TEN PLIK ISTNIEJE
-- Strona biletu wysyla JAWNY kod QR do trasy serwerowej, a ta sklada
-- przepustke z danych `event_ticket_wallet_payload` (migracja 20260926160000).
-- To jest plaszczyzna TRESCI: najemca z hosta, kod jako jedyne
-- poswiadczenie. Blad w filtrze statusu to przepustka dla biletu anulowanego
-- albo nieoplaconego; blad w filtrze najemcy to przepustka z danymi obcej
-- organizacji. Dziennik `event_wallet_passes` zapisuje wylacznie serwer
-- (service_role) - klient nie moze ani go pisac, ani czytac cudzego.
--
-- CO SPRAWDZA
--   1. Waski ksztalt kodu -> `invalid_token` (takze pusty i za dlugi).
--   2. Poprawny kod przyjetego i bezplatnego / oplaconego / obecnego
--      zgloszenia oddaje komplet danych przepustki (najemca, posiadacz,
--      jezyk, wydarzenie, branding, bilet, grupa) i NIE oddaje e-maila.
--      Zwrot czesciowy (korekta ceny) tez daje przepustke - kod QR zostaje.
--   3. Kazdy stan nieuprawniony -> `not_found`: oczekujace, anulowane,
--      nieoplacone, zwrocone w calosci, wydarzenie odwolane, kod nieznany.
--   4. Izolacja najemcy: kod najemcy B na hoscie A -> `not_found`; ten sam
--      kod na hoscie B -> dane B (kontrapunkt pozytywny).
--   5. Granty: anonim i zalogowany moga wolac payload (SET ROLE), cialo nie
--      miesza public_tenant_id() z has_role/is_staff, funkcja jest definer.
--   6. `_event_wallet_pass_note`: upsert (licznik rosnie, pierwsze wydanie
--      zostaje), odmowy (platforma, pusty identyfikator, obcy najemca),
--      wylacznie service_role.
--   7. RLS dziennika: admin A czyta swoje, redaktor/uzytkownik nic, admin B
--      nic z A, anonim nie ma grantu; klient nie pisze.
--
-- CZEGO NIE SPRAWDZA: podpisu .pkpass ani wywolan Google (to warstwa TS,
-- testy vitest w src/lib/events/wallet/__tests__).
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 52 bilet w portfelu: payload przepustki i dziennik wydan =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('52000000-0000-0000-0000-0000000000a0', 'Organizator A (portfel)', 't52a-wallet'),
  ('52000000-0000-0000-0000-0000000000b0', 'Organizator B (portfel)', 't52b-wallet')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('52a00000-0000-0000-0000-0000000000a1', 'admin.a52@example.org'),
  ('52a00000-0000-0000-0000-0000000000a2', 'editor.a52@example.org'),
  ('52a00000-0000-0000-0000-0000000000a3', 'user.a52@example.org'),
  ('52a00000-0000-0000-0000-0000000000b1', 'admin.b52@example.org'),
  ('52a00000-0000-0000-0000-0000000000c1', 'holder.a52@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, prefs) VALUES
  ('52a00000-0000-0000-0000-0000000000a1', '52000000-0000-0000-0000-0000000000a0', '{}'::jsonb),
  ('52a00000-0000-0000-0000-0000000000a2', '52000000-0000-0000-0000-0000000000a0', '{}'::jsonb),
  ('52a00000-0000-0000-0000-0000000000a3', '52000000-0000-0000-0000-0000000000a0', '{}'::jsonb),
  ('52a00000-0000-0000-0000-0000000000b1', '52000000-0000-0000-0000-0000000000b0', '{}'::jsonb),
  ('52a00000-0000-0000-0000-0000000000c1', '52000000-0000-0000-0000-0000000000a0',
   '{"language":"EN"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('52a00000-0000-0000-0000-0000000000a1', 'admin', '52000000-0000-0000-0000-0000000000a0'),
  ('52a00000-0000-0000-0000-0000000000a2', 'editor', '52000000-0000-0000-0000-0000000000a0'),
  ('52a00000-0000-0000-0000-0000000000b1', 'admin', '52000000-0000-0000-0000-0000000000b0');

-- Gosc bez konta ma jezyk z newslettera.
INSERT INTO public.newsletter_subscribers (tenant_id, email, language) VALUES
  ('52000000-0000-0000-0000-0000000000a0', 'guest.en52@example.org', 'en');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, location,
   cover_url, status)
VALUES
  ('52e00000-0000-0000-0000-0000000000a1', '52000000-0000-0000-0000-0000000000a0',
   'wallet-kongres', 'Kongres portfela', 'Wallet congress', now() + interval '20 days',
   now() + interval '20 days 8 hours', 'Europe/Warsaw', 'Warszawa, Sala Kongresowa',
   'https://cdn.example.org/cover.jpg', 'published'),
  ('52e00000-0000-0000-0000-0000000000a2', '52000000-0000-0000-0000-0000000000a0',
   'wallet-odwolane', 'Odwolane', 'Cancelled', now() + interval '25 days',
   NULL, 'Europe/Warsaw', NULL, NULL, 'cancelled'),
  ('52e00000-0000-0000-0000-0000000000b1', '52000000-0000-0000-0000-0000000000b0',
   'wallet-forum-b', 'Forum B', 'Forum B', now() + interval '20 days',
   NULL, 'Europe/Berlin', NULL, NULL, 'published');

UPDATE public.events SET branding = '{"navigation":"#112233","main_action":"#FF6600"}'::jsonb
WHERE id = '52e00000-0000-0000-0000-0000000000a1';

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order)
VALUES
  ('52f00000-0000-0000-0000-0000000000a1', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', 'standard', 'Standardowy', 'Standard', 0, 'PLN',
   NULL, 0, false, true, 10),
  ('52f00000-0000-0000-0000-0000000000a2', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', 'vip', 'VIP', 'VIP', 50000, 'PLN',
   NULL, 0, false, true, 20);

INSERT INTO public.event_groups (id, tenant_id, event_id, key, name_pl, name_en, color) VALUES
  ('52c00000-0000-0000-0000-0000000000a1', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', 'prasa', 'Prasa', 'Press', '#00AA55');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('52d00000-0000-0000-0000-0000000000a1', '52000000-0000-0000-0000-0000000000a0',
   '52a00000-0000-0000-0000-0000000000c1', 'holder.a52@example.org', 'Hanna', 'Posiadaczka'),
  ('52d00000-0000-0000-0000-0000000000a2', '52000000-0000-0000-0000-0000000000a0',
   NULL, 'guest.en52@example.org', 'Guest', 'English'),
  ('52d00000-0000-0000-0000-0000000000a3', '52000000-0000-0000-0000-0000000000a0',
   NULL, 'nobody.a52@example.org', 'Nikt', 'Uprawniony'),
  ('52d00000-0000-0000-0000-0000000000a4', '52000000-0000-0000-0000-0000000000a0',
   NULL, 'pending.a52@example.org', 'Olga', 'Oczekujaca'),
  ('52d00000-0000-0000-0000-0000000000a5', '52000000-0000-0000-0000-0000000000a0',
   NULL, 'cancelled.a52@example.org', 'Adam', 'Anulowany'),
  ('52d00000-0000-0000-0000-0000000000a6', '52000000-0000-0000-0000-0000000000a0',
   NULL, 'unpaid.a52@example.org', 'Nina', 'Nieoplacona'),
  ('52d00000-0000-0000-0000-0000000000a8', '52000000-0000-0000-0000-0000000000a0',
   NULL, 'partial.a52@example.org', 'Paulina', 'Zwrot'),
  ('52d00000-0000-0000-0000-0000000000a9', '52000000-0000-0000-0000-0000000000a0',
   NULL, 'refunded.a52@example.org', 'Robert', 'Zwrocony'),
  ('52d00000-0000-0000-0000-0000000000b1', '52000000-0000-0000-0000-0000000000b0',
   NULL, 'holder.b52@example.org', 'Bruno', 'Obcy');

-- Kody: 32 znaki base64url. W bazie wylacznie sha256 kodu.
CREATE TEMP TABLE w52_codes (k text PRIMARY KEY, token text NOT NULL);
INSERT INTO w52_codes (k, token) VALUES
  ('free',      'WalletFreeToken_0123456789abcdef'),
  ('paid',      'WalletPaidToken_0123456789abcdef'),
  ('attended',  'WalletAttendTok_0123456789abcdef'),
  ('pending',   'WalletPendingTk_0123456789abcdef'),
  ('cancelled', 'WalletCancelTok_0123456789abcdef'),
  ('unpaid',    'WalletUnpaidTok_0123456789abcdef'),
  ('evcancel',  'WalletEvCancTok_0123456789abcdef'),
  ('foreign',   'WalletForeignTk_0123456789abcdef'),
  ('partial',   'WalletPartialTk_0123456789abcdef'),
  ('refunded',  'WalletRefundTok_0123456789abcdef'),
  ('unknown',   'WalletUnknownTk_0123456789abcdef');

SELECT pg_temp.assert(
  (SELECT bool_and(token ~ '^[A-Za-z0-9_-]{32}$') FROM w52_codes),
  '52/fixture: kazdy kod ma ksztalt _event_new_qr_token (32 znaki base64url)');

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, group_id, status, registration_mode,
   payment_status, decided_at, decision_source, cancelled_at, attended_at,
   qr_token_hash, qr_issued_at)
SELECT v.id::uuid, v.tenant::uuid, v.event::uuid, v.person::uuid, v.ticket::uuid,
       v.grp::uuid, v.status, 'form', v.payment,
       CASE WHEN v.status IN ('approved', 'attended') THEN now() END,
       CASE WHEN v.status IN ('approved', 'attended') THEN 'system' END,
       CASE WHEN v.status = 'cancelled' THEN now() END,
       CASE WHEN v.status = 'attended' THEN now() END,
       encode(sha256(convert_to(c.token, 'UTF8')), 'hex'), now()
FROM (VALUES
  ('52b00000-0000-0000-0000-0000000000a1', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', '52d00000-0000-0000-0000-0000000000a1',
   '52f00000-0000-0000-0000-0000000000a1', NULL, 'approved', 'not_required', 'free'),
  ('52b00000-0000-0000-0000-0000000000a2', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', '52d00000-0000-0000-0000-0000000000a2',
   '52f00000-0000-0000-0000-0000000000a2', '52c00000-0000-0000-0000-0000000000a1',
   'approved', 'paid', 'paid'),
  ('52b00000-0000-0000-0000-0000000000a3', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', '52d00000-0000-0000-0000-0000000000a3',
   NULL, NULL, 'attended', 'not_required', 'attended'),
  ('52b00000-0000-0000-0000-0000000000a4', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', '52d00000-0000-0000-0000-0000000000a4',
   NULL, NULL, 'pending', 'not_required', 'pending'),
  ('52b00000-0000-0000-0000-0000000000a5', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', '52d00000-0000-0000-0000-0000000000a5',
   NULL, NULL, 'cancelled', 'not_required', 'cancelled'),
  ('52b00000-0000-0000-0000-0000000000a6', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', '52d00000-0000-0000-0000-0000000000a6',
   '52f00000-0000-0000-0000-0000000000a2', NULL, 'approved', 'unpaid', 'unpaid'),
  ('52b00000-0000-0000-0000-0000000000a7', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a2', '52d00000-0000-0000-0000-0000000000a3',
   NULL, NULL, 'approved', 'not_required', 'evcancel'),
  ('52b00000-0000-0000-0000-0000000000a8', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', '52d00000-0000-0000-0000-0000000000a8',
   '52f00000-0000-0000-0000-0000000000a2', NULL, 'approved', 'partially_refunded', 'partial'),
  ('52b00000-0000-0000-0000-0000000000a9', '52000000-0000-0000-0000-0000000000a0',
   '52e00000-0000-0000-0000-0000000000a1', '52d00000-0000-0000-0000-0000000000a9',
   '52f00000-0000-0000-0000-0000000000a2', NULL, 'approved', 'refunded', 'refunded'),
  ('52b00000-0000-0000-0000-0000000000b1', '52000000-0000-0000-0000-0000000000b0',
   '52e00000-0000-0000-0000-0000000000b1', '52d00000-0000-0000-0000-0000000000b1',
   NULL, NULL, 'approved', 'not_required', 'foreign')
) AS v(id, tenant, event, person, ticket, grp, status, payment, code)
JOIN w52_codes c ON c.k = v.code;

-- ---------------------------------------------------------------------------
-- 1) KSZTALT KODU
-- ---------------------------------------------------------------------------
SELECT set_config('nes.public_tenant', '52000000-0000-0000-0000-0000000000a0', false);
SELECT pg_temp.act_as(NULL, NULL);

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_ticket_wallet_payload('{"qr_token":"za-krotki"}'::jsonb)$q$,
  'invalid_token', '52/ksztalt: kod za krotki -> invalid_token');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_ticket_wallet_payload('{}'::jsonb)$q$,
  'invalid_token', '52/ksztalt: brak kodu -> invalid_token');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_ticket_wallet_payload(
       '{"qr_token":"WalletFreeToken_0123456789abcdefX"}'::jsonb)$q$,
  'invalid_token', '52/ksztalt: kod o znak za dlugi -> invalid_token');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_ticket_wallet_payload(
       '{"qr_token":"WalletFreeToken_0123456789abcde="}'::jsonb)$q$,
  'invalid_token', '52/ksztalt: znak spoza base64url -> invalid_token');

-- ---------------------------------------------------------------------------
-- 2) KOD UPRAWNIONY: KOMPLET DANYCH PRZEPUSTKI
-- ---------------------------------------------------------------------------
DO $do$
DECLARE v jsonb;
BEGIN
  v := public.event_ticket_wallet_payload(jsonb_build_object(
    'qr_token', '  ' || (SELECT token FROM w52_codes WHERE k = 'free') || ' '));
  PERFORM pg_temp.assert(v->>'registration_id' = '52b00000-0000-0000-0000-0000000000a1',
    '52/payload: bezplatny i przyjety -> wlasciwe zgloszenie (kod przyciety z bialych znakow)');
  PERFORM pg_temp.assert(v->>'tenant_id' = '52000000-0000-0000-0000-0000000000a0'
    AND v->>'tenant_name' = 'Organizator A (portfel)',
    '52/payload: najemca i jego nazwa (organizationName przepustki)');
  PERFORM pg_temp.assert(v->>'first_name' = 'Hanna' AND v->>'last_name' = 'Posiadaczka',
    '52/payload: posiadacz biletu');
  PERFORM pg_temp.assert(v->>'lang' = 'en',
    '52/payload: jezyk z profilu posiadacza (prefs.language, bez wzgledu na wielkosc liter)');
  PERFORM pg_temp.assert(v->>'event_slug' = 'wallet-kongres'
    AND v->>'event_title_pl' = 'Kongres portfela' AND v->>'event_title_en' = 'Wallet congress'
    AND v->>'event_timezone' = 'Europe/Warsaw'
    AND v->>'event_location' = 'Warszawa, Sala Kongresowa'
    AND v->>'event_cover_url' = 'https://cdn.example.org/cover.jpg'
    AND (v->>'event_starts_at') IS NOT NULL AND (v->>'event_ends_at') IS NOT NULL,
    '52/payload: wydarzenie (slug, tytuly, strefa, miejsce, okladka, termin)');
  PERFORM pg_temp.assert(v->'event_branding'->>'navigation' = '#112233'
    AND v->'event_branding'->>'main_action' = '#FF6600',
    '52/payload: branding wydarzenia (kolory przepustki)');
  PERFORM pg_temp.assert(v->>'ticket_name_pl' = 'Standardowy' AND v->>'ticket_name_en' = 'Standard'
    AND v->'group_name_pl' = 'null'::jsonb AND v->'group_color' = 'null'::jsonb,
    '52/payload: bilet bez grupy - nazwa biletu jest, grupy brak');
  PERFORM pg_temp.assert(NOT (v ? 'email') AND NOT (v ? 'phone')
    AND position('holder.a52@example.org' IN v::text) = 0,
    '52/payload: odpowiedz NIE niesie adresu e-mail ani telefonu');
  PERFORM pg_temp.assert(NOT (v ? 'qr_token') AND position('WalletFreeToken' IN v::text) = 0,
    '52/payload: odpowiedz nie odsyla kodu (klient go zna, serwer go nie loguje)');
END
$do$;

DO $do$
DECLARE v jsonb;
BEGIN
  v := public.event_ticket_wallet_payload(jsonb_build_object(
    'qr_token', (SELECT token FROM w52_codes WHERE k = 'paid')));
  PERFORM pg_temp.assert(v->>'registration_id' = '52b00000-0000-0000-0000-0000000000a2'
    AND v->>'ticket_name_en' = 'VIP',
    '52/payload: oplacone i przyjete -> dane biletu VIP');
  PERFORM pg_temp.assert(v->>'group_name_pl' = 'Prasa' AND v->>'group_name_en' = 'Press'
    AND v->>'group_color' = '#00AA55',
    '52/payload: grupa uczestnika (nazwa PL/EN i kolor)');
  PERFORM pg_temp.assert(v->>'lang' = 'en',
    '52/payload: gosc bez konta - jezyk z newslettera');

  v := public.event_ticket_wallet_payload(jsonb_build_object(
    'qr_token', (SELECT token FROM w52_codes WHERE k = 'attended')));
  PERFORM pg_temp.assert(v->>'registration_id' = '52b00000-0000-0000-0000-0000000000a3'
    AND v->>'status' = 'attended' AND v->>'lang' = 'pl'
    AND v->'ticket_name_pl' = 'null'::jsonb,
    '52/payload: obecny (po wejsciu) tez dostaje przepustke; jezyk domyslny pl; bez biletu');

  -- Zwrot CZESCIOWY to korekta ceny: kod QR zostaje wazny (skaner wpuszcza,
  -- bilet idzie mailem), wiec przepustka tez musi sie dac dodac.
  v := public.event_ticket_wallet_payload(jsonb_build_object(
    'qr_token', (SELECT token FROM w52_codes WHERE k = 'partial')));
  PERFORM pg_temp.assert(v->>'registration_id' = '52b00000-0000-0000-0000-0000000000a8'
    AND v->>'first_name' = 'Paulina' AND v->>'ticket_name_en' = 'VIP',
    '52/payload: przyjete po zwrocie czesciowym -> przepustka (kod QR nadal wazny)');
END
$do$;

-- ---------------------------------------------------------------------------
-- 3) STANY NIEUPRAWNIONE -> not_found (bez rozrozniania powodu)
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_ticket_wallet_payload(%L::jsonb)',
    jsonb_build_object('qr_token', (SELECT token FROM w52_codes WHERE k = 'pending'))),
  'not_found', '52/stan: oczekujace -> not_found');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_ticket_wallet_payload(%L::jsonb)',
    jsonb_build_object('qr_token', (SELECT token FROM w52_codes WHERE k = 'cancelled'))),
  'not_found', '52/stan: anulowane -> not_found');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_ticket_wallet_payload(%L::jsonb)',
    jsonb_build_object('qr_token', (SELECT token FROM w52_codes WHERE k = 'unpaid'))),
  'not_found', '52/stan: przyjete, ale nieoplacone -> not_found');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_ticket_wallet_payload(%L::jsonb)',
    jsonb_build_object('qr_token', (SELECT token FROM w52_codes WHERE k = 'refunded'))),
  'not_found', '52/stan: zwrot PELNY -> not_found (nawet gdyby skrot kodu zostal)');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_ticket_wallet_payload(%L::jsonb)',
    jsonb_build_object('qr_token', (SELECT token FROM w52_codes WHERE k = 'evcancel'))),
  'not_found', '52/stan: wydarzenie odwolane -> not_found');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_ticket_wallet_payload(%L::jsonb)',
    jsonb_build_object('qr_token', (SELECT token FROM w52_codes WHERE k = 'unknown'))),
  'not_found', '52/stan: kod poprawnego ksztaltu, ale nieznany -> not_found');

-- ---------------------------------------------------------------------------
-- 4) IZOLACJA NAJEMCY
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_ticket_wallet_payload(%L::jsonb)',
    jsonb_build_object('qr_token', (SELECT token FROM w52_codes WHERE k = 'foreign'))),
  'not_found', '52/najemca: kod najemcy B na hoscie A -> not_found');

SELECT set_config('nes.public_tenant', '52000000-0000-0000-0000-0000000000b0', false);
SELECT pg_temp.assert(
  (public.event_ticket_wallet_payload(jsonb_build_object(
    'qr_token', (SELECT token FROM w52_codes WHERE k = 'foreign')))->>'tenant_name')
    = 'Organizator B (portfel)',
  '52/najemca: ten sam kod na hoscie B -> dane B (kontrapunkt)');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_ticket_wallet_payload(%L::jsonb)',
    jsonb_build_object('qr_token', (SELECT token FROM w52_codes WHERE k = 'free'))),
  'not_found', '52/najemca: kod najemcy A na hoscie B -> not_found');
SELECT set_config('nes.public_tenant', '52000000-0000-0000-0000-0000000000a0', false);

-- ---------------------------------------------------------------------------
-- 5) GRANTY I KSZTALT FUNKCJI
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_ticket_wallet_payload(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_ticket_wallet_payload(jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_ticket_wallet_payload(jsonb)', 'EXECUTE'),
  '52/granty: payload dla anonima, zalogowanego i serwera');
SELECT pg_temp.assert(
  (SELECT p.prosecdef AND p.provolatile = 's'
          AND p.prosrc ~ 'public_tenant_id\s*\('
          AND p.prosrc !~ '(has_role|is_staff)\s*\('
          AND array_to_string(p.proconfig, ',') ~ 'search_path=public, ?extensions, ?pg_temp'
     FROM pg_proc p WHERE p.oid = 'public.event_ticket_wallet_payload(jsonb)'::regprocedure),
  '52/ksztalt: SECURITY DEFINER, STABLE, plaszczyzna tresci bez has_role/is_staff');

SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
-- Kod wprost: tabela tymczasowa kodow nalezy do superuzytkownika harnessu.
SELECT pg_temp.assert(
  (public.event_ticket_wallet_payload(
    '{"qr_token":"WalletFreeToken_0123456789abcdef"}'::jsonb)->>'registration_id')
    = '52b00000-0000-0000-0000-0000000000a1',
  '52/granty: anonim (SET ROLE anon) dostaje dane przepustki po kodzie');
RESET ROLE;

SELECT pg_temp.act_as('52a00000-0000-0000-0000-0000000000a3', '52000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (public.event_ticket_wallet_payload(
    '{"qr_token":"WalletPaidToken_0123456789abcdef"}'::jsonb)->>'registration_id')
    = '52b00000-0000-0000-0000-0000000000a2',
  '52/granty: zalogowany (SET ROLE authenticated) tez - kod jest poswiadczeniem, nie sesja');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6) DZIENNIK WYDAN (service_role)
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000a0',
    '52b00000-0000-0000-0000-0000000000a1', 'apple', '52b00000-0000-0000-0000-0000000000a1') = 1,
  '52/dziennik: pierwsze wydanie Apple -> licznik 1');
UPDATE public.event_wallet_passes SET first_issued_at = now() - interval '2 days',
  last_issued_at = now() - interval '2 days'
WHERE registration_id = '52b00000-0000-0000-0000-0000000000a1' AND platform = 'apple';
SELECT pg_temp.assert(
  public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000a0',
    '52b00000-0000-0000-0000-0000000000a1', ' APPLE ', '52b00000-0000-0000-0000-0000000000a1') = 2,
  '52/dziennik: ponowne wydanie -> licznik 2 (platforma znormalizowana)');
SELECT pg_temp.assert(
  (SELECT first_issued_at < now() - interval '1 day' AND last_issued_at >= now() - interval '1 minute'
          AND event_id = '52e00000-0000-0000-0000-0000000000a1'
     FROM public.event_wallet_passes
    WHERE registration_id = '52b00000-0000-0000-0000-0000000000a1' AND platform = 'apple'),
  '52/dziennik: pierwsze wydanie zostaje, ostatnie sie przesuwa, wydarzenie z zgloszenia');
SELECT pg_temp.assert(
  public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000a0',
    '52b00000-0000-0000-0000-0000000000a1', 'google',
    '3388000000000000000.reg_52b00000-0000-0000-0000-0000000000a1') = 1,
  '52/dziennik: pierwsze wydanie Google -> licznik 1 (licznik per platforma)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_wallet_passes
    WHERE registration_id = '52b00000-0000-0000-0000-0000000000a1') = 2,
  '52/dziennik: Google to osobny wiersz tego samego zgloszenia');
SELECT pg_temp.assert(
  public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000b0',
    '52b00000-0000-0000-0000-0000000000b1', 'apple', '52b00000-0000-0000-0000-0000000000b1') = 1,
  '52/dziennik: wydanie najemcy B (pod izolacje RLS nizej)');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000a0',
       '52b00000-0000-0000-0000-0000000000a1', 'samsung', 'x')$q$,
  'invalid_platform', '52/dziennik: nieznana platforma -> invalid_platform');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000a0',
       '52b00000-0000-0000-0000-0000000000a1', 'google', '   ')$q$,
  'invalid_object_id', '52/dziennik: pusty identyfikator obiektu -> invalid_object_id');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000a0',
       '52b00000-0000-0000-0000-0000000000a1', 'google', %L)$q$, repeat('x', 201)),
  'invalid_object_id', '52/dziennik: identyfikator ponad 200 znakow -> invalid_object_id');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000a0',
       '52b00000-0000-0000-0000-0000000000b1', 'apple', 'x')$q$,
  'not_found', '52/dziennik: zgloszenie najemcy B podane z najemca A -> not_found');

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_wallet_pass_note(uuid,uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_wallet_pass_note(uuid,uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_wallet_pass_note(uuid,uuid,text,text)', 'EXECUTE'),
  '52/granty: dziennik pisze WYLACZNIE service_role');

SELECT pg_temp.act_as('52a00000-0000-0000-0000-0000000000a1', '52000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_note('52000000-0000-0000-0000-0000000000a0',
       '52b00000-0000-0000-0000-0000000000a1', 'apple', 'x')$q$,
  'permission denied', '52/granty: nawet admin nie wola dziennika z klienta');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_wallet_passes (tenant_id, event_id, registration_id, platform, object_id)
     VALUES ('52000000-0000-0000-0000-0000000000a0', '52e00000-0000-0000-0000-0000000000a1',
             '52b00000-0000-0000-0000-0000000000a3', 'apple', 'x')$q$,
  'permission denied', '52/granty: klient nie wstawia wiersza dziennika');

-- ---------------------------------------------------------------------------
-- 7) RLS DZIENNIKA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_wallet_passes) = 2
  AND (SELECT count(*) FROM public.event_wallet_passes
        WHERE tenant_id <> '52000000-0000-0000-0000-0000000000a0') = 0,
  '52/RLS: admin A czyta dziennik swojego najemcy i tylko jego');
RESET ROLE;

SELECT pg_temp.act_as('52a00000-0000-0000-0000-0000000000a2', '52000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_wallet_passes) = 0,
  '52/RLS: redaktor NIE czyta dziennika (modul Wydarzen jest tylko dla admina)');
RESET ROLE;

SELECT pg_temp.act_as('52a00000-0000-0000-0000-0000000000a3', '52000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_wallet_passes) = 0,
  '52/RLS: zwykly uzytkownik NIE czyta dziennika');
RESET ROLE;

SELECT pg_temp.act_as('52a00000-0000-0000-0000-0000000000b1', '52000000-0000-0000-0000-0000000000b0');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_wallet_passes) = 1
  AND (SELECT count(*) FROM public.event_wallet_passes
        WHERE tenant_id = '52000000-0000-0000-0000-0000000000a0') = 0,
  '52/RLS: admin B czyta wylacznie swoj wiersz');
RESET ROLE;

SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.event_wallet_passes$q$,
  'permission denied', '52/RLS: anonim nie ma nawet grantu do dziennika');
RESET ROLE;

SELECT pg_temp.assert(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_wallet_passes'::regclass),
  '52/RLS: dziennik ma wlaczone RLS');

-- Kaskada: usuniecie zgloszenia zabiera wiersze dziennika.
DELETE FROM public.event_registrations WHERE id = '52b00000-0000-0000-0000-0000000000a1';
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_wallet_passes
               WHERE registration_id = '52b00000-0000-0000-0000-0000000000a1'),
  '52/FK: usuniecie zgloszenia zabiera jego wiersze dziennika');

ROLLBACK;
