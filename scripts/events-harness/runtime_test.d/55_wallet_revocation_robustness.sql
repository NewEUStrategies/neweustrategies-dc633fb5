-- ============================================================================
-- 55_wallet_revocation_robustness - KOLEJKA DEZAKTYWACJI PRZEPUSTEK GOOGLE
-- WALLET: PRZYPADKI BRZEGOWE Z PRZEGLADU KONCOWEGO OPS-14 (F7, F8, F9, F10)
-- (migracje 20261013112400 i 20261013112500)
--
-- PO CO TEN PLIK ISTNIEJE
-- 55_wallet_pass_revocation dowodzi sciezki glownej (triggery, zajecie,
-- rozliczenie). Ten plik dowodzi czterech luk, ktore przeglad znalazl obok:
--   F7 - zgloszenie dezaktywacji zamkniete jako nieaktualne PO probie, ktora
--        mogla dojsc do Google, zostawialo obiekt INACTIVE w telefonie,
--        a ponowne dodanie POMIJALO zapis (ten sam skrot tresci);
--   F8 - obiekt sprzed OPS-14, ktorego wiersz nadpisala stara funkcja
--        dziennika w oknie "kod przed migracja", nie byl nigdy dezaktywowany;
--   F9 - usuniecie wydarzenia albo zgloszenia kasowalo kaskada wiersze
--        dziennika razem z identyfikatorami obiektow, wiec kolejka nie miala
--        juz czego wylaczyc (takze po usunieciu najemcy);
--   F10 - porzucone po 8 probach nie mialy drogi powrotu do kolejki.
--
-- CO SPRAWDZA
--   1. F7: stale po probie -> content_hash wyczyszczony, obiekt w
--      `reactivate`, stan {active: true, content_hash: null}; stale bez proby
--      (nigdy nie zajety albo oddany jako deferred) -> bez reaktywacji i ze
--      skrotem tresci.
--   2. F9: usuniecie zgloszenia (wprost) i wydarzenia (przez redaktora pod
--      RLS) zapisuje nagrobki obiektow Google jeszcze aktywnych - bez Apple,
--      bez juz nieaktywnych, bez wydarzen wygaslych; usuniecie najemcy nie
--      zabiera nagrobkow; zajecie i rozliczenie drenuja nagrobki (revoked
--      usuwa, failed liczy probe, deferred oddaje, dzierzawa jako warunek,
--      wygasly usuwany bez sieci, sufit 8 prob).
--   3. F10: ponowienie porzuconych (dziennik i nagrobki), bez wygaslych.
--   4. F8: odtworzenie obiektu sprzed migracji - tylko obiekt z kodem wydany
--      wiecej niz raz, na waznym wydarzeniu, bez wiersza starego obiektu,
--      z prefiksem wlasnego zgloszenia; idempotentne; zajecie bierze go jako
--      `replaced` mimo waznego zgloszenia.
--   5. Granty i ksztalt: nagrobki bez dostepu klienta, z RLS i bez kluczy
--      obcych; nowe funkcje wylacznie service_role / bez grantow klienckich,
--      SECURITY DEFINER z search_path.
--
-- CZEGO NIE SPRAWDZA: wywolan Google Wallet API ani trasy (vitest:
-- walletRevocationJob.server.test.ts, walletRoutes.test.ts).
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 55 portfel: odpornosc kolejki dezaktywacji (F7-F10) =='

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.h5e(_code text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(_code, 'UTF8')), 'hex') $$;

CREATE OR REPLACE FUNCTION pg_temp.w5e(_object text)
RETURNS public.event_wallet_passes LANGUAGE sql AS $$
  SELECT w FROM public.event_wallet_passes w WHERE w.object_id = _object
$$;

CREATE OR REPLACE FUNCTION pg_temp.t5e(_object text)
RETURNS public.event_wallet_pass_tombstones LANGUAGE sql AS $$
  SELECT t FROM public.event_wallet_pass_tombstones t WHERE t.object_id = _object
$$;

-- Identyfikatory obiektow w wyniku zajecia (posortowane).
CREATE OR REPLACE FUNCTION pg_temp.objs5e(_claim jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(p->>'object_id' ORDER BY p->>'object_id'), ARRAY[]::text[])
  FROM jsonb_array_elements(_claim->'passes') p
$$;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('5e000000-0000-0000-0000-0000000000a0', 'Organizator A (portfel 55r)', 't5ea-wallet'),
  ('5e000000-0000-0000-0000-0000000000b0', 'Organizator B (portfel 55r)', 't5eb-wallet')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('5ea00000-0000-0000-0000-0000000000a1', 'editor.a5e@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, prefs) VALUES
  ('5ea00000-0000-0000-0000-0000000000a1', '5e000000-0000-0000-0000-0000000000a0', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('5ea00000-0000-0000-0000-0000000000a1', 'editor', '5e000000-0000-0000-0000-0000000000a0');

-- a1 F7, a2 usuwane wydarzenie, a3 usuwane zgloszenia, a4 wydarzenie
-- wygasle (usuwane), a5 F8, a6 F8 wygasle, b1 najemca B (usuwany najemca).
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status)
VALUES
  ('5ee00000-0000-0000-0000-0000000000a1', '5e000000-0000-0000-0000-0000000000a0',
   'wallet5e-f7', 'F7 55r', 'F7 55r', now() + interval '20 days',
   now() + interval '20 days 8 hours', 'Europe/Warsaw', 'published'),
  ('5ee00000-0000-0000-0000-0000000000a2', '5e000000-0000-0000-0000-0000000000a0',
   'wallet5e-usuniete', 'Usuniete 55r', 'Deleted 55r', now() + interval '10 days',
   now() + interval '10 days 6 hours', 'Europe/Warsaw', 'published'),
  ('5ee00000-0000-0000-0000-0000000000a3', '5e000000-0000-0000-0000-0000000000a0',
   'wallet5e-zgloszenia', 'Zgloszenia 55r', 'Registrations 55r', now() + interval '12 days',
   NULL, 'Europe/Warsaw', 'published'),
  ('5ee00000-0000-0000-0000-0000000000a4', '5e000000-0000-0000-0000-0000000000a0',
   'wallet5e-minione', 'Minione 55r', 'Past 55r', now() - interval '3 days',
   now() - interval '3 days' + interval '8 hours', 'Europe/Warsaw', 'published'),
  ('5ee00000-0000-0000-0000-0000000000a5', '5e000000-0000-0000-0000-0000000000a0',
   'wallet5e-f8', 'F8 55r', 'F8 55r', now() + interval '15 days',
   NULL, 'Europe/Warsaw', 'published'),
  ('5ee00000-0000-0000-0000-0000000000a6', '5e000000-0000-0000-0000-0000000000a0',
   'wallet5e-f8-minione', 'F8 minione 55r', 'F8 past 55r', now() - interval '5 days',
   now() - interval '5 days' + interval '2 hours', 'Europe/Warsaw', 'published'),
  ('5ee00000-0000-0000-0000-0000000000b1', '5e000000-0000-0000-0000-0000000000b0',
   'wallet5e-forum-b', 'Forum B 55r', 'Forum B 55r', now() + interval '25 days',
   NULL, 'Europe/Berlin', 'published');

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
SELECT ('5ed00000-0000-0000-0000-0000000000' || k)::uuid,
       CASE WHEN k LIKE 'b%' THEN '5e000000-0000-0000-0000-0000000000b0'::uuid
            ELSE '5e000000-0000-0000-0000-0000000000a0'::uuid END,
       'person.' || k || '.5e@example.org', 'Osoba', upper(k)
FROM unnest(ARRAY['01', '02', '03', '04', '05', '06', '07', '08', '09',
                  '10', '11', '12', '13', '14', 'b1']) AS k;

-- 01-03 F7; 04-06 usuwane wydarzenie; 07-08 usuwane zgloszenia; 09 wygasle;
-- 10-13 F8; 14 wygasle F8 (porzucone); b1 najemca B.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode,
   payment_status, decided_at, decision_source, qr_token_hash, qr_issued_at)
SELECT ('5eb00000-0000-0000-0000-0000000000' || v.k)::uuid,
       v.tenant::uuid, v.event::uuid,
       ('5ed00000-0000-0000-0000-0000000000' || v.k)::uuid,
       'approved', 'form', 'not_required', now(), 'system',
       pg_temp.h5e('code5e-' || v.k), now() - interval '1 hour'
FROM (VALUES
  ('01', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a1'),
  ('02', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a1'),
  ('03', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a1'),
  ('04', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a2'),
  ('05', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a2'),
  ('06', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a2'),
  ('07', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a3'),
  ('08', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a3'),
  ('09', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a4'),
  ('10', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5'),
  ('11', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5'),
  ('12', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5'),
  ('13', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5'),
  ('14', '5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a6'),
  ('b1', '5e000000-0000-0000-0000-0000000000b0', '5ee00000-0000-0000-0000-0000000000b1')
) AS v(k, tenant, event);

CREATE TEMP TABLE c5e (k text PRIMARY KEY, v jsonb NOT NULL);

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_wallet_passes WHERE revoke_requested_at IS NOT NULL
                                                          AND revoked_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.event_wallet_pass_tombstones),
  '55r/start: kolejka i nagrobki puste (kazdy plik sprzata po sobie)');

-- ---------------------------------------------------------------------------
-- 1) F7: NIEAKTUALNE ZGLOSZENIE PO PROBIE -> REAKTYWACJA
-- ---------------------------------------------------------------------------
-- 01: PATCH INACTIVE mogl dojsc (timeout po zapisie w Google), 03: proba
-- oddana jako deferred (nic nie wyslano), 02: nigdy nie zajety.
SELECT public._event_wallet_pass_note('5e000000-0000-0000-0000-0000000000a0',
  ('5eb00000-0000-0000-0000-0000000000' || k)::uuid, 'google', 'g5e.f7.' || k,
  pg_temp.h5e('code5e-' || k), pg_temp.h5e('content5e-' || k))
FROM unnest(ARRAY['01', '02', '03']) AS k;

UPDATE public.event_registrations SET status = 'no_show'
 WHERE id IN ('5eb00000-0000-0000-0000-000000000001', '5eb00000-0000-0000-0000-000000000003');

INSERT INTO c5e VALUES ('f7-1', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  (SELECT pg_temp.objs5e(v) = ARRAY['g5e.f7.01', 'g5e.f7.03'] FROM c5e WHERE k = 'f7-1')
  AND (pg_temp.w5e('g5e.f7.01')).revoke_attempts = 1,
  '55r/F7: no_show -> obiekty zajete do dezaktywacji (proba 1)');

SELECT pg_temp.assert(
  (public._event_wallet_pass_revocations_settle(
     (SELECT (v->>'claimed_at')::timestamptz FROM c5e WHERE k = 'f7-1'),
     ARRAY[]::uuid[],
     jsonb_build_array(jsonb_build_object('id', (pg_temp.w5e('g5e.f7.01')).id, 'error', 'timeout')),
     ARRAY[(pg_temp.w5e('g5e.f7.03')).id])
   ->> 'deferred')::int = 1
  AND (pg_temp.w5e('g5e.f7.01')).revoke_attempts = 1
  AND (pg_temp.w5e('g5e.f7.03')).revoke_attempts = 0,
  '55r/F7: timeout -> proba liczona; deferred -> proba oddana (nic nie wyslano)');

-- 02 zgloszony dopiero teraz; wszystkie trzy wracaja do waznosci z TYM SAMYM
-- kodem, zanim przyjdzie ponowienie.
UPDATE public.event_registrations SET status = 'no_show'
 WHERE id = '5eb00000-0000-0000-0000-000000000002';
UPDATE public.event_registrations SET status = 'attended', attended_at = now()
 WHERE id IN ('5eb00000-0000-0000-0000-000000000001', '5eb00000-0000-0000-0000-000000000002',
              '5eb00000-0000-0000-0000-000000000003');
UPDATE public.event_wallet_passes SET revoke_claimed_at = now() - interval '6 minutes'
 WHERE object_id = 'g5e.f7.01';

INSERT INTO c5e VALUES ('f7-2', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(v->'passes') = 0 AND (v->>'closed')::int = 3
          AND v->'reactivate' = '["g5e.f7.01"]'::jsonb
     FROM c5e WHERE k = 'f7-2'),
  '55r/F7: trzy zgloszenia nieaktualne zamkniete bez sieci; reaktywacja TYLKO obiektu po probie');
SELECT pg_temp.assert(
  (SELECT w.revoke_requested_at IS NULL AND w.revoke_reason IS NULL AND w.revoke_attempts = 0
          AND w.revoke_claimed_at IS NULL AND w.revoked_at IS NULL AND w.content_hash IS NULL
     FROM public.event_wallet_passes w WHERE w.object_id = 'g5e.f7.01')
  AND public._event_wallet_pass_state('5e000000-0000-0000-0000-0000000000a0', 'google', 'g5e.f7.01')
      = jsonb_build_object('content_hash', NULL::text, 'active', true),
  '55r/F7: obiekt po probie -> skrot tresci wyczyszczony, ponowne dodanie nie pominie zapisu');
SELECT pg_temp.assert(
  (pg_temp.w5e('g5e.f7.02')).content_hash = pg_temp.h5e('content5e-02')
  AND (pg_temp.w5e('g5e.f7.03')).content_hash = pg_temp.h5e('content5e-03')
  AND (pg_temp.w5e('g5e.f7.02')).revoke_requested_at IS NULL
  AND (pg_temp.w5e('g5e.f7.03')).revoke_requested_at IS NULL,
  '55r/F7: bez proby (nigdy nie zajety, oddany jako deferred) -> skrot tresci zostaje, bez reaktywacji');

-- ---------------------------------------------------------------------------
-- 2) F9: NAGROBKI USUNIETYCH WYDARZEN I ZGLOSZEN
-- ---------------------------------------------------------------------------
-- Wydarzenie a2: 04 aktywny Google + Apple, 05 Google juz nieaktywny,
-- 06 starszy obiekt w kolejce (code_changed) + nowy aktywny.
SELECT public._event_wallet_pass_note('5e000000-0000-0000-0000-0000000000a0',
  '5eb00000-0000-0000-0000-000000000004', 'google', 'g5e.del.04',
  pg_temp.h5e('code5e-04'), pg_temp.h5e('content5e-04'));
SELECT public._event_wallet_pass_note('5e000000-0000-0000-0000-0000000000a0',
  '5eb00000-0000-0000-0000-000000000004', 'apple', '5eb00000-0000-0000-0000-000000000004',
  pg_temp.h5e('code5e-04'), NULL);
INSERT INTO public.event_wallet_passes
  (tenant_id, event_id, registration_id, platform, object_id, code_hash,
   revoke_requested_at, revoke_reason, revoked_at)
VALUES ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a2',
        '5eb00000-0000-0000-0000-000000000005', 'google', 'g5e.del.05',
        pg_temp.h5e('code5e-05'), now() - interval '1 hour', 'code_changed', now());
SELECT public._event_wallet_pass_note('5e000000-0000-0000-0000-0000000000a0',
  '5eb00000-0000-0000-0000-000000000006', 'google', 'g5e.del.06.old',
  pg_temp.h5e('code5e-06-stary'), pg_temp.h5e('content5e-06-old'));
SELECT public._event_wallet_pass_note('5e000000-0000-0000-0000-0000000000a0',
  '5eb00000-0000-0000-0000-000000000006', 'google', 'g5e.del.06',
  pg_temp.h5e('code5e-06'), pg_temp.h5e('content5e-06'));
-- Wydarzenie a3: 07 usuwane zgloszenie, 08 zostaje. Wydarzenie a4 wygasle: 09.
-- Najemca B: b1.
SELECT public._event_wallet_pass_note(v.tenant::uuid,
  ('5eb00000-0000-0000-0000-0000000000' || v.k)::uuid, 'google', 'g5e.' || v.k,
  pg_temp.h5e('code5e-' || v.k), pg_temp.h5e('content5e-' || v.k))
FROM (VALUES ('07', '5e000000-0000-0000-0000-0000000000a0'),
             ('08', '5e000000-0000-0000-0000-0000000000a0'),
             ('09', '5e000000-0000-0000-0000-0000000000a0'),
             ('b1', '5e000000-0000-0000-0000-0000000000b0')) AS v(k, tenant);
SELECT pg_temp.assert(
  (pg_temp.w5e('g5e.del.06.old')).revoke_reason = 'code_changed'
  AND (pg_temp.w5e('g5e.del.06.old')).revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.event_wallet_pass_tombstones),
  '55r/F9: przygotowanie - obiekt ze starym kodem czeka w kolejce, nagrobkow brak');

-- Usuniecie zgloszenia wprost.
DELETE FROM public.event_registrations WHERE id = '5eb00000-0000-0000-0000-000000000007';
SELECT pg_temp.assert(
  (SELECT t.tenant_id = '5e000000-0000-0000-0000-0000000000a0' AND t.reason = 'registration_deleted'
          AND t.valid_until = (SELECT starts_at + interval '1 day' FROM public.events
                                WHERE id = '5ee00000-0000-0000-0000-0000000000a3')
          AND t.attempts = 0 AND t.claimed_at IS NULL
     FROM public.event_wallet_pass_tombstones t WHERE t.object_id = 'g5e.07')
  AND (pg_temp.w5e('g5e.07')).id IS NULL
  AND (pg_temp.t5e('g5e.08')).id IS NULL,
  '55r/F9: usuniecie zgloszenia -> nagrobek jego obiektu Google (najemca, koniec + 1 dzien), wiersz dziennika znika');

-- Usuniecie wydarzenia przez redaktora pod RLS (grant produkcyjny z
-- 20260713093000; atrapa harnessu daje klientowi tylko SELECT).
GRANT DELETE ON public.events TO authenticated;
SELECT pg_temp.act_as('5ea00000-0000-0000-0000-0000000000a1', '5e000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
DELETE FROM public.events WHERE id = '5ee00000-0000-0000-0000-0000000000a2';
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.events WHERE id = '5ee00000-0000-0000-0000-0000000000a2')
  AND NOT EXISTS (SELECT 1 FROM public.event_wallet_passes
                   WHERE event_id = '5ee00000-0000-0000-0000-0000000000a2'),
  '55r/F9: redaktor usuwa wydarzenie (trigger przepuszcza usuniecie), kaskada zabiera dziennik');
SELECT pg_temp.assert(
  (SELECT array_agg(t.object_id ORDER BY t.object_id)
     FROM public.event_wallet_pass_tombstones t
    WHERE t.reason = 'event_deleted')
    = ARRAY['g5e.del.04', 'g5e.del.06', 'g5e.del.06.old']
  AND (SELECT bool_and(t.tenant_id = '5e000000-0000-0000-0000-0000000000a0'
                       AND t.valid_until = (now() + interval '10 days 6 hours') + interval '1 day')
         FROM public.event_wallet_pass_tombstones t WHERE t.reason = 'event_deleted'),
  '55r/F9: usuniecie wydarzenia -> nagrobki obiektow Google jeszcze aktywnych (takze czekajacego w kolejce); bez Apple i bez juz nieaktywnego');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_wallet_pass_tombstones) = 4,
  '55r/F9: kaskada zgloszen usuwanego wydarzenia nie dubluje nagrobkow');

-- Wydarzenie wygasle: obiekty Google wygasly same - bez nagrobka.
DELETE FROM public.events WHERE id = '5ee00000-0000-0000-0000-0000000000a4';
SELECT pg_temp.assert((pg_temp.t5e('g5e.09')).id IS NULL AND (pg_temp.w5e('g5e.09')).id IS NULL,
  '55r/F9: usuniecie wydarzenia zakonczonego ponad dobe temu -> bez nagrobka');

-- Usuniecie najemcy: nagrobki przezywaja (bez klucza obcego), z jego najemca.
-- Dziennik zdarzen domenowych sprzatamy wprost, jak 20_ i 66_.
DELETE FROM public.domain_events WHERE tenant_id = '5e000000-0000-0000-0000-0000000000b0';
DELETE FROM public.tenants WHERE id = '5e000000-0000-0000-0000-0000000000b0';
SELECT pg_temp.assert(
  (SELECT t.tenant_id = '5e000000-0000-0000-0000-0000000000b0' AND t.reason = 'event_deleted'
     FROM public.event_wallet_pass_tombstones t WHERE t.object_id = 'g5e.b1')
  AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = '5e000000-0000-0000-0000-0000000000b0'),
  '55r/F9: usuniecie najemcy przechodzi, a nagrobek jego obiektu zostaje do dezaktywacji');

-- Zajecie: nagrobki w tej samej kolejce, ten sam ksztalt pozycji.
INSERT INTO c5e VALUES ('t-1', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  (SELECT pg_temp.objs5e(v) = ARRAY['g5e.07', 'g5e.b1', 'g5e.del.04', 'g5e.del.06', 'g5e.del.06.old']
          AND (v->>'closed')::int = 0
     FROM c5e WHERE k = 't-1')
  AND (SELECT bool_and((p->>'attempt')::int = 1
                       AND p->>'reason' IN ('event_deleted', 'registration_deleted')
                       AND (p->>'id')::uuid = (pg_temp.t5e(p->>'object_id')).id)
         FROM c5e, jsonb_array_elements(v->'passes') p WHERE k = 't-1'),
  '55r/F9: zajecie oddaje nagrobki jak obiekty dziennika ({id, object_id, reason, attempt})');
SELECT pg_temp.assert(
  (SELECT bool_and(t.claimed_at = (c.v->>'claimed_at')::timestamptz AND t.attempts = 1)
     FROM public.event_wallet_pass_tombstones t, c5e c WHERE c.k = 't-1')
  AND jsonb_array_length(public._event_wallet_pass_revocations_claim(100)->'passes') = 0,
  '55r/F9: dzierzawa nagrobkow - natychmiastowe ponowne zajecie nie oddaje niczego');

-- Cudza dzierzawa nie rusza nagrobka.
SELECT pg_temp.assert(
  (public._event_wallet_pass_revocations_settle(
     (SELECT (v->>'claimed_at')::timestamptz FROM c5e WHERE k = 'f7-1'),
     ARRAY[(pg_temp.t5e('g5e.del.04')).id], '[]'::jsonb, ARRAY[]::uuid[])->>'revoked')::int = 0
  AND (pg_temp.t5e('g5e.del.04')).id IS NOT NULL,
  '55r/F9: rozliczenie bez dzierzawy tego zajecia nie usuwa nagrobka');

INSERT INTO c5e VALUES ('t-settle', public._event_wallet_pass_revocations_settle(
  (SELECT (v->>'claimed_at')::timestamptz FROM c5e WHERE k = 't-1'),
  ARRAY[(pg_temp.t5e('g5e.del.04')).id, (pg_temp.t5e('g5e.b1')).id],
  jsonb_build_array(jsonb_build_object('id', (pg_temp.t5e('g5e.07')).id, 'error', 'http 503')),
  ARRAY[(pg_temp.t5e('g5e.del.06')).id]));
SELECT pg_temp.assert(
  (SELECT v = jsonb_build_object('revoked', 2, 'failed', 1, 'gave_up', 0, 'deferred', 1,
                                 'reactivate', '[]'::jsonb)
     FROM c5e WHERE k = 't-settle'),
  '55r/F9: rozliczenie nagrobkow: 2 dezaktywowane, 1 blad, 1 odlozony');
SELECT pg_temp.assert(
  (pg_temp.t5e('g5e.del.04')).id IS NULL AND (pg_temp.t5e('g5e.b1')).id IS NULL
  AND (SELECT t.error = 'http 503' AND t.attempts = 1
              AND t.claimed_at = (c.v->>'claimed_at')::timestamptz
         FROM public.event_wallet_pass_tombstones t, c5e c
        WHERE t.object_id = 'g5e.07' AND c.k = 't-1')
  AND (SELECT t.claimed_at IS NULL AND t.attempts = 0
         FROM public.event_wallet_pass_tombstones t WHERE t.object_id = 'g5e.del.06'),
  '55r/F9: revoked usuwa nagrobek; failed zapisuje blad i zostawia dzierzawe; deferred oddaje probe');

-- Nagrobek po valid_until: usuwany bez sieci (takze ten w dzierzawie).
UPDATE public.event_wallet_pass_tombstones SET valid_until = now() - interval '1 minute'
 WHERE object_id = 'g5e.del.06.old';
INSERT INTO c5e VALUES ('t-2', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  (SELECT pg_temp.objs5e(v) = ARRAY['g5e.del.06'] AND (v->>'closed')::int = 1
     FROM c5e WHERE k = 't-2')
  AND (pg_temp.t5e('g5e.del.06.old')).id IS NULL,
  '55r/F9: wygasly nagrobek usuniety bez wywolania (closed); odlozony zajety ponownie');

-- Sufit 8 prob: porzucony nagrobek nie jest zajmowany.
UPDATE public.event_wallet_pass_tombstones
   SET attempts = 8, claimed_at = now() - interval '7 hours', error = 'http 403'
 WHERE object_id = 'g5e.07';
SELECT pg_temp.assert(
  NOT ('g5e.07' = ANY (pg_temp.objs5e(public._event_wallet_pass_revocations_claim(100)))),
  '55r/F9: nagrobek po 8 probach nie jest juz zajmowany');

-- ---------------------------------------------------------------------------
-- 3) F10: PONOWIENIE PORZUCONYCH (OPERACJE)
-- ---------------------------------------------------------------------------
-- Wiersz dziennika porzucony po 8 probach (08) i porzucony na wydarzeniu
-- wygaslym (14 - zostaje, Google wygasil obiekt).
UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
 WHERE id IN ('5eb00000-0000-0000-0000-000000000008', '5eb00000-0000-0000-0000-000000000014');
INSERT INTO public.event_wallet_passes
  (tenant_id, event_id, registration_id, platform, object_id,
   revoke_requested_at, revoke_reason, revoke_claimed_at, revoke_attempts, revoke_error)
VALUES ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a6',
        '5eb00000-0000-0000-0000-000000000014', 'google', 'g5e.14',
        now() - interval '2 days', 'registration_closed', now() - interval '7 hours', 8, 'http 500');
UPDATE public.event_wallet_passes
   SET revoke_attempts = 8, revoke_claimed_at = now() - interval '7 hours', revoke_error = 'http 403'
 WHERE object_id = 'g5e.08';
SELECT pg_temp.assert(
  (pg_temp.w5e('g5e.08')).revoke_reason = 'registration_closed'
  AND NOT ('g5e.08' = ANY (pg_temp.objs5e(public._event_wallet_pass_revocations_claim(100)))),
  '55r/F10: przygotowanie - wiersz dziennika porzucony po 8 probach nie jest zajmowany');

SELECT pg_temp.assert(
  public._event_wallet_pass_revocations_requeue() = jsonb_build_object('passes', 1, 'tombstones', 1),
  '55r/F10: ponowienie porzuconych -> jeden wiersz dziennika i jeden nagrobek (bez wygaslego)');
SELECT pg_temp.assert(
  (SELECT w.revoke_attempts = 0 AND w.revoke_claimed_at IS NULL AND w.revoke_error IS NULL
          AND w.revoke_reason = 'registration_closed'
     FROM public.event_wallet_passes w WHERE w.object_id = 'g5e.08')
  AND (SELECT t.attempts = 0 AND t.claimed_at IS NULL AND t.error IS NULL
         FROM public.event_wallet_pass_tombstones t WHERE t.object_id = 'g5e.07')
  AND (pg_temp.w5e('g5e.14')).revoke_attempts = 8,
  '55r/F10: ponowione od zera (licznik, dzierzawa, blad); obiekt wygasly zostaje porzucony');
INSERT INTO c5e VALUES ('r-1', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  (SELECT ARRAY['g5e.07', 'g5e.08'] <@ pg_temp.objs5e(v) FROM c5e WHERE k = 'r-1'),
  '55r/F10: ponowione wracaja do kolejki od razu');
SELECT pg_temp.assert(
  public._event_wallet_pass_revocations_requeue() = jsonb_build_object('passes', 0, 'tombstones', 0),
  '55r/F10: ponowienie bez porzuconych nie zmienia niczego');

-- ---------------------------------------------------------------------------
-- 4) F8: OBIEKT SPRZED MIGRACJI NADPISANY PRZEZ STARA FUNKCJE DZIENNIKA
-- ---------------------------------------------------------------------------
-- 10: wiersz nadpisany (obiekt z kodem, 2 wydania) - kandydat;
-- 11: stary obiekt ma wlasny wiersz - nic; 12: jedno wydanie - nic;
-- 13: prefiks cudzego zgloszenia - nic; 14 (wygasle wydarzenie) - nic;
-- Apple z dwoma wydaniami - nic.
INSERT INTO public.event_wallet_passes
  (tenant_id, event_id, registration_id, platform, object_id, issue_count,
   first_issued_at, last_issued_at, code_hash)
VALUES
  ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5',
   '5eb00000-0000-0000-0000-000000000010', 'google',
   'ISS5E.reg_5eb00000-0000-0000-0000-000000000010.0123456789ab', 2,
   now() - interval '9 days', now() - interval '1 day', pg_temp.h5e('code5e-10')),
  ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5',
   '5eb00000-0000-0000-0000-000000000011', 'google',
   'ISS5E.reg_5eb00000-0000-0000-0000-000000000011', 1,
   now() - interval '9 days', now() - interval '9 days', NULL),
  ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5',
   '5eb00000-0000-0000-0000-000000000011', 'google',
   'ISS5E.reg_5eb00000-0000-0000-0000-000000000011.abcdefabcdef', 3,
   now() - interval '2 days', now() - interval '1 day', pg_temp.h5e('code5e-11')),
  ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5',
   '5eb00000-0000-0000-0000-000000000012', 'google',
   'ISS5E.reg_5eb00000-0000-0000-0000-000000000012.0123456789ab', 1,
   now() - interval '1 day', now() - interval '1 day', pg_temp.h5e('code5e-12')),
  ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5',
   '5eb00000-0000-0000-0000-000000000013', 'google',
   'ISS5E.reg_5eb00000-0000-0000-0000-000000000012.fedcba987654', 2,
   now() - interval '1 day', now() - interval '1 day', pg_temp.h5e('code5e-13')),
  ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a6',
   '5eb00000-0000-0000-0000-000000000014', 'google',
   'ISS5E.reg_5eb00000-0000-0000-0000-000000000014.0123456789ab', 2,
   now() - interval '6 days', now() - interval '6 days', pg_temp.h5e('code5e-14')),
  ('5e000000-0000-0000-0000-0000000000a0', '5ee00000-0000-0000-0000-0000000000a5',
   '5eb00000-0000-0000-0000-000000000012', 'apple',
   '5eb00000-0000-0000-0000-000000000012', 2,
   now() - interval '1 day', now() - interval '1 day', pg_temp.h5e('code5e-12'));

SELECT pg_temp.assert(
  public._event_wallet_pass_queue_legacy_google_objects() = 1,
  '55r/F8: odtworzenie -> dokladnie jeden obiekt sprzed migracji');
SELECT pg_temp.assert(
  (SELECT w.platform = 'google' AND w.revoke_reason = 'replaced'
          AND w.revoke_requested_at IS NOT NULL AND w.revoked_at IS NULL
          AND w.code_hash IS NULL AND w.issue_count = 1
          AND w.tenant_id = '5e000000-0000-0000-0000-0000000000a0'
          AND w.event_id = '5ee00000-0000-0000-0000-0000000000a5'
          AND w.registration_id = '5eb00000-0000-0000-0000-000000000010'
          AND w.first_issued_at = now() - interval '9 days'
     FROM public.event_wallet_passes w
    WHERE w.object_id = 'ISS5E.reg_5eb00000-0000-0000-0000-000000000010'),
  '55r/F8: stary identyfikator (prefiks bez sufiksu kodu) wraca do dziennika jako replaced');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_wallet_passes
    WHERE object_id IN ('ISS5E.reg_5eb00000-0000-0000-0000-000000000012',
                        'ISS5E.reg_5eb00000-0000-0000-0000-000000000013',
                        'ISS5E.reg_5eb00000-0000-0000-0000-000000000014')) = 0
  AND (SELECT count(*) FROM public.event_wallet_passes
        WHERE object_id = 'ISS5E.reg_5eb00000-0000-0000-0000-000000000011') = 1
  AND (pg_temp.w5e('ISS5E.reg_5eb00000-0000-0000-0000-000000000011')).revoke_requested_at IS NULL,
  '55r/F8: bez kandydatow pozornych (stary wiersz istnieje, jedno wydanie, cudzy prefiks, wydarzenie wygasle, Apple)');
SELECT pg_temp.assert(
  public._event_wallet_pass_queue_legacy_google_objects() = 0,
  '55r/F8: odtworzenie jest idempotentne');
INSERT INTO c5e VALUES ('f8-1', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  (SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'passes') p
                   WHERE p->>'object_id' = 'ISS5E.reg_5eb00000-0000-0000-0000-000000000010'
                     AND p->>'reason' = 'replaced')
     FROM c5e WHERE k = 'f8-1'),
  '55r/F8: zajecie bierze stary obiekt do dezaktywacji mimo waznego zgloszenia (replaced nie jest stale)');

-- ---------------------------------------------------------------------------
-- 5) GRANTY I KSZTALT
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_wallet_pass_tombstones'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'event_wallet_pass_tombstones'),
  '55r/RLS: nagrobki z wlaczonym RLS i bez polityk klienckich');
SELECT pg_temp.assert(
  bool_and(NOT has_table_privilege('anon', 'public.event_wallet_pass_tombstones', p)
           AND NOT has_table_privilege('authenticated', 'public.event_wallet_pass_tombstones', p)
           AND has_table_privilege('service_role', 'public.event_wallet_pass_tombstones', p)),
  '55r/granty: nagrobki - klient nic, service_role odczyt i zapis')
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p;
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM pg_constraint
               WHERE conrelid = 'public.event_wallet_pass_tombstones'::regclass AND contype = 'f'),
  '55r/ksztalt: nagrobki bez kluczy obcych (przezywaja kaskade wydarzenia, zgloszenia i najemcy)');
SELECT pg_temp.assert(
  bool_and(NOT has_function_privilege('anon', f, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
           AND has_function_privilege('service_role', f, 'EXECUTE')),
  '55r/granty: zajecie, rozliczenie, ponowienie i odtworzenie wylacznie dla service_role')
FROM unnest(ARRAY[
  'public._event_wallet_pass_revocations_claim(integer)',
  'public._event_wallet_pass_revocations_settle(timestamptz,uuid[],jsonb,uuid[])',
  'public._event_wallet_pass_revocations_requeue()',
  'public._event_wallet_pass_queue_legacy_google_objects()']) AS f;
SELECT pg_temp.assert(
  bool_and(NOT has_function_privilege('anon', f, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', f, 'EXECUTE')),
  '55r/granty: funkcje triggerow usuniecia bez grantu klienckiego')
FROM unnest(ARRAY[
  'public._tg_events_wallet_tombstone()',
  'public._tg_event_registrations_wallet_tombstone()']) AS f;
SELECT pg_temp.assert(
  bool_and(p.prosecdef AND array_to_string(p.proconfig, ',') ~ 'search_path=')
  AND count(*) = 6,
  '55r/ksztalt: nowe i zmienione funkcje SECURITY DEFINER z ustawionym search_path')
FROM pg_proc p
WHERE p.oid IN (
  'public._event_wallet_pass_revocations_claim(integer)'::regprocedure,
  'public._event_wallet_pass_revocations_settle(timestamptz,uuid[],jsonb,uuid[])'::regprocedure,
  'public._event_wallet_pass_revocations_requeue()'::regprocedure,
  'public._event_wallet_pass_queue_legacy_google_objects()'::regprocedure,
  'public._tg_events_wallet_tombstone()'::regprocedure,
  'public._tg_event_registrations_wallet_tombstone()'::regprocedure);

SELECT pg_temp.act_as('5ea00000-0000-0000-0000-0000000000a1', '5e000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.event_wallet_pass_tombstones$q$,
  'permission denied', '55r/granty: redaktor nie czyta nagrobkow');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_revocations_requeue()$q$,
  'permission denied', '55r/granty: klient nie ponawia porzuconych');
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;
