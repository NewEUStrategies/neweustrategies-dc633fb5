-- ============================================================================
-- 55_wallet_pass_revocation - PRZEPUSTKA GOOGLE WALLET TRACI WAZNOSC RAZEM
-- Z BILETEM (OPS-14, migracje 20261013111600 i 20261013111700)
--
-- PO CO TEN PLIK ISTNIEJE
-- Obiekt Google Wallet zostawal ACTIVE po anulowaniu zgloszenia, zwrocie,
-- odwolaniu wydarzenia i zmianie kodu biletu. Od tych migracji baza zglasza
-- dezaktywacje triggerami, a zadanie serwera zajmuje kolejke i rozlicza ja.
-- Blad w triggerze to albo bilet "wazny" w telefonie, ktorego bramka nie
-- przyjmie, albo - gorzej - przepustka uniewazniona przy wejsciu na sale
-- (approved -> attended). Blad w zajeciu to dublowane wywolania Google albo
-- wieczne ponowienia.
--
-- CO SPRAWDZA
--   1. Dziennik: skrot kodu i tresci, stan obiektu dla trasy, ponowne wydanie,
--      odmowy (ksztalt skrotu, obiekt cudzego zgloszenia), natychmiastowa
--      dezaktywacja obiektu ze starym kodem, zastapienie starszego obiektu.
--   2. Trigger zgloszenia: wejscie na sale NIE dezaktywuje (takze obiektu
--      sprzed migracji bez skrotu kodu); nowy kod, anulowanie, zwrot, no_show
--      - dezaktywuja tylko obiekty Google; zmiana identyfikatora nie rusza
--      niczego; zgloszona juz dezaktywacja nie jest nadpisywana; izolacja
--      najemcy.
--   3. Trigger wydarzenia: odwolanie dezaktywuje obiekty Google tego
--      wydarzenia i tylko jego; zmiana innej kolumny - nic.
--   4. Zajecie: limit, dzierzawa, zamkniecie bez sieci (zgloszenie znow wazne
--      z tym samym kodem -> stale; wydarzenie zakonczone -> lapsed), sufit
--      8 prob, wykladniczy odstep ponowien.
--   5. Rozliczenie: revoked / failed / deferred / gave_up, dzierzawa jako
--      warunek, reactivate dla obiektu wydanego ponownie w trakcie proby,
--      odpornosc na smieci w p_failed, przyciecie bledu.
--   6. Wiezy: tylko Google ma dezaktywacje, spojnosc stanu, ksztalt skrotu.
--   7. Granty i ksztalt: wszystko wylacznie service_role, SECURITY DEFINER
--      z search_path; klient nie wola i nie pisze.
--
-- CZEGO NIE SPRAWDZA: wywolan Google Wallet API (testy vitest
-- walletRevocationJob.server.test.ts) ani backfillu migracji - replay biegnie
-- na pustej bazie, wiec backfill nie ma czego przepisac.
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 55 portfel: dezaktywacja przepustek Google po zmianie biletu =='

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.h55(_code text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(_code, 'UTF8')), 'hex') $$;

-- Wiersz obiektu po identyfikatorze (najemca A, chyba ze podano inaczej).
CREATE OR REPLACE FUNCTION pg_temp.w55(_object text)
RETURNS public.event_wallet_passes LANGUAGE sql AS $$
  SELECT w FROM public.event_wallet_passes w WHERE w.object_id = _object
$$;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('55000000-0000-0000-0000-0000000000a0', 'Organizator A (portfel 55)', 't55a-wallet'),
  ('55000000-0000-0000-0000-0000000000b0', 'Organizator B (portfel 55)', 't55b-wallet')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('55a00000-0000-0000-0000-0000000000a1', 'admin.a55@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, prefs) VALUES
  ('55a00000-0000-0000-0000-0000000000a1', '55000000-0000-0000-0000-0000000000a0', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('55a00000-0000-0000-0000-0000000000a1', 'admin', '55000000-0000-0000-0000-0000000000a0');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status)
VALUES
  ('55e00000-0000-0000-0000-0000000000a1', '55000000-0000-0000-0000-0000000000a0',
   'wallet55-kongres', 'Kongres 55', 'Congress 55', now() + interval '20 days',
   now() + interval '20 days 8 hours', 'Europe/Warsaw', 'published'),
  ('55e00000-0000-0000-0000-0000000000a2', '55000000-0000-0000-0000-0000000000a0',
   'wallet55-odwolane', 'Do odwolania 55', 'To cancel 55', now() + interval '30 days',
   NULL, 'Europe/Warsaw', 'published'),
  ('55e00000-0000-0000-0000-0000000000a3', '55000000-0000-0000-0000-0000000000a0',
   'wallet55-minione', 'Minione 55', 'Past 55', now() - interval '3 days',
   now() - interval '3 days' + interval '8 hours', 'Europe/Warsaw', 'published'),
  ('55e00000-0000-0000-0000-0000000000b1', '55000000-0000-0000-0000-0000000000b0',
   'wallet55-forum-b', 'Forum B 55', 'Forum B 55', now() + interval '20 days',
   NULL, 'Europe/Berlin', 'published');

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order)
VALUES
  ('55f00000-0000-0000-0000-0000000000a1', '55000000-0000-0000-0000-0000000000a0',
   '55e00000-0000-0000-0000-0000000000a1', 'vip55', 'VIP', 'VIP', 50000, 'PLN',
   NULL, 0, false, true, 10);

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
SELECT ('55d00000-0000-0000-0000-0000000000' || k)::uuid,
       CASE WHEN k = 'b1' THEN '55000000-0000-0000-0000-0000000000b0'::uuid
            ELSE '55000000-0000-0000-0000-0000000000a0'::uuid END,
       'person.' || k || '.55@example.org', 'Osoba', upper(k)
FROM unnest(ARRAY['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'b1']) AS k;

-- r1 nowy kod, r2 anulowanie, r3 zwrot, r4 no_show i powrot, r5 odwolane
-- wydarzenie, r6 wydarzenie minione, r7 obiekt sprzed migracji, rB najemca B.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, decided_at, decision_source, qr_token_hash, qr_issued_at)
SELECT ('55b00000-0000-0000-0000-0000000000' || v.k)::uuid,
       v.tenant::uuid, v.event::uuid,
       ('55d00000-0000-0000-0000-0000000000' || v.k)::uuid,
       v.ticket::uuid, 'approved', 'form', v.payment, now(), 'system',
       pg_temp.h55('code55-' || v.k), now() - interval '1 hour'
FROM (VALUES
  ('a1', '55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a1', NULL, 'not_required'),
  ('a2', '55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a1', NULL, 'not_required'),
  ('a3', '55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a1',
   '55f00000-0000-0000-0000-0000000000a1', 'paid'),
  ('a4', '55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a1', NULL, 'not_required'),
  ('a5', '55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a2', NULL, 'not_required'),
  ('a6', '55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a3', NULL, 'not_required'),
  ('a7', '55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a1', NULL, 'not_required'),
  ('b1', '55000000-0000-0000-0000-0000000000b0', '55e00000-0000-0000-0000-0000000000b1', NULL, 'not_required')
) AS v(k, tenant, event, ticket, payment);

-- ---------------------------------------------------------------------------
-- 1) DZIENNIK I STAN OBIEKTU
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
    '55b00000-0000-0000-0000-0000000000a1', 'google', 'g55.a1.c1',
    pg_temp.h55('code55-a1'), pg_temp.h55('content-1')) = 1,
  '55/dziennik: pierwsze wydanie obiektu Google -> licznik 1');
SELECT pg_temp.assert(
  (SELECT w.code_hash = pg_temp.h55('code55-a1') AND w.content_hash = pg_temp.h55('content-1')
          AND w.revoke_requested_at IS NULL AND w.revoke_attempts = 0
     FROM public.event_wallet_passes w WHERE w.object_id = 'g55.a1.c1'),
  '55/dziennik: obiekt niesie skrot kodu i skrot zapisanej tresci, bez dezaktywacji');
SELECT pg_temp.assert(
  public._event_wallet_pass_state('55000000-0000-0000-0000-0000000000a0', ' GOOGLE ', 'g55.a1.c1')
    = jsonb_build_object('content_hash', pg_temp.h55('content-1'), 'active', true),
  '55/stan: obiekt aktywny ze skrotem tresci (platforma znormalizowana)');
SELECT pg_temp.assert(
  public._event_wallet_pass_state('55000000-0000-0000-0000-0000000000a0', 'google', 'g55.brak') IS NULL
  AND public._event_wallet_pass_state('55000000-0000-0000-0000-0000000000b0', 'google', 'g55.a1.c1') IS NULL,
  '55/stan: nieznany obiekt i obiekt obcego najemcy -> NULL');

SELECT pg_temp.assert(
  public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
    '55b00000-0000-0000-0000-0000000000a1', 'google', 'g55.a1.c1',
    upper(pg_temp.h55('code55-a1')), upper(pg_temp.h55('content-2'))) = 2
  AND (pg_temp.w55('g55.a1.c1')).content_hash = pg_temp.h55('content-2'),
  '55/dziennik: ponowne wydanie -> licznik 2, nowa tresc (skroty wielkimi literami przyjete)');
SELECT pg_temp.assert(
  public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
    '55b00000-0000-0000-0000-0000000000a1', 'apple', '55b00000-0000-0000-0000-0000000000a1',
    pg_temp.h55('code55-a1'), pg_temp.h55('content-x')) = 1
  AND (pg_temp.w55('55b00000-0000-0000-0000-0000000000a1')).content_hash IS NULL,
  '55/dziennik: Apple - skrot kodu jest, skrotu tresci nie ma (brak obiektu po stronie platformy)');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
       '55b00000-0000-0000-0000-0000000000a1', 'google', 'g55.a1.c1', 'abc', NULL)$q$,
  'invalid_hash', '55/dziennik: skrot kodu zlego ksztaltu -> invalid_hash');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
       '55b00000-0000-0000-0000-0000000000a1', 'google', 'g55.a1.c1', NULL, %L)$q$,
       repeat('g', 64)),
  'invalid_hash', '55/dziennik: skrot tresci zlego ksztaltu -> invalid_hash');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
       '55b00000-0000-0000-0000-0000000000a2', 'google', 'g55.a1.c1', NULL, NULL)$q$,
  'object_conflict', '55/dziennik: identyfikator obiektu innego zgloszenia -> object_conflict');

-- Kod zmienil sie miedzy odczytem danych przepustki a dziennikiem: obiekt ze
-- STARYM kodem od razu idzie do dezaktywacji.
SELECT pg_temp.assert(
  public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
    '55b00000-0000-0000-0000-0000000000a2', 'google', 'g55.a2.old',
    pg_temp.h55('code55-a2-stary'), pg_temp.h55('content-a2')) = 1,
  '55/dziennik: wydanie obiektu ze starym kodem (wyscig) zapisane');
SELECT pg_temp.assert(
  (SELECT w.revoke_requested_at IS NOT NULL AND w.revoke_reason = 'code_changed'
     FROM public.event_wallet_passes w WHERE w.object_id = 'g55.a2.old')
  AND public._event_wallet_pass_state('55000000-0000-0000-0000-0000000000a0', 'google', 'g55.a2.old')
      ->> 'active' = 'false',
  '55/dziennik: obiekt ze starym kodem -> od razu code_changed, stan nieaktywny');
SELECT pg_temp.assert(
  public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
    '55b00000-0000-0000-0000-0000000000a2', 'google', 'g55.a2.c2',
    pg_temp.h55('code55-a2'), pg_temp.h55('content-a2')) = 1
  AND (pg_temp.w55('g55.a2.c2')).revoke_requested_at IS NULL
  AND (pg_temp.w55('g55.a2.old')).revoke_reason = 'code_changed',
  '55/dziennik: obiekt z biezacym kodem aktywny; starszy juz zgloszony zachowuje swoj powod');

-- Pozostale obiekty pod triggery i kolejke.
SELECT public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
  ('55b00000-0000-0000-0000-0000000000' || k)::uuid, 'google', 'g55.' || k || '.c',
  pg_temp.h55('code55-' || k), pg_temp.h55('content-' || k))
FROM unnest(ARRAY['a3', 'a4', 'a5', 'a6']) AS k;
SELECT public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
  '55b00000-0000-0000-0000-0000000000a5', 'apple', '55b00000-0000-0000-0000-0000000000a5',
  pg_temp.h55('code55-a5'), NULL);
SELECT public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000b0',
  '55b00000-0000-0000-0000-0000000000b1', 'google', 'g55.b1.c',
  pg_temp.h55('code55-b1'), pg_temp.h55('content-b1'));

-- Obiekt sprzed migracji: bez skrotu kodu i tresci.
INSERT INTO public.event_wallet_passes
  (tenant_id, event_id, registration_id, platform, object_id)
VALUES ('55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a1',
        '55b00000-0000-0000-0000-0000000000a7', 'google', 'g55.a7.legacy');

-- ---------------------------------------------------------------------------
-- 2) TRIGGER ZGLOSZENIA
-- ---------------------------------------------------------------------------
UPDATE public.event_registrations SET status = 'attended', attended_at = now()
WHERE id IN ('55b00000-0000-0000-0000-0000000000a7', '55b00000-0000-0000-0000-0000000000a4');
SELECT pg_temp.assert(
  (pg_temp.w55('g55.a7.legacy')).revoke_requested_at IS NULL
  AND (pg_temp.w55('g55.a4.c')).revoke_requested_at IS NULL,
  '55/trigger: wejscie na sale (approved -> attended) NIE dezaktywuje - takze obiektu bez skrotu kodu');

-- Wydanie nowego obiektu zgloszenia zastepuje starszy.
SELECT public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
  '55b00000-0000-0000-0000-0000000000a7', 'google', 'g55.a7.c',
  pg_temp.h55('code55-a7'), pg_temp.h55('content-a7'));
SELECT pg_temp.assert(
  (pg_temp.w55('g55.a7.legacy')).revoke_reason = 'replaced'
  AND (pg_temp.w55('g55.a7.c')).revoke_requested_at IS NULL,
  '55/dziennik: nowy obiekt zgloszenia -> starszy obiekt Google zastapiony (replaced)');

-- Zmiana identyfikatora (osobne poswiadczenie) nie rusza przepustek.
UPDATE public.event_registrations
   SET badge_token_hash = pg_temp.h55('badge55-a4'), badge_issued_at = now()
 WHERE id = '55b00000-0000-0000-0000-0000000000a4';
SELECT pg_temp.assert((pg_temp.w55('g55.a4.c')).revoke_requested_at IS NULL,
  '55/trigger: druk identyfikatora (badge_token_hash) nie dezaktywuje przepustki');

-- Nowy kod biletu (ponowna wysylka, uniewaznienie zgubionego).
UPDATE public.event_registrations
   SET qr_token_hash = pg_temp.h55('code55-a1-nowy'), qr_issued_at = now()
 WHERE id = '55b00000-0000-0000-0000-0000000000a1';
SELECT pg_temp.assert(
  (SELECT w.revoke_reason = 'code_changed' AND w.revoke_requested_at IS NOT NULL
          AND w.revoke_claimed_at IS NULL AND w.revoke_attempts = 0
     FROM public.event_wallet_passes w WHERE w.object_id = 'g55.a1.c1'),
  '55/trigger: nowy kod biletu -> obiekt Google ze starym kodem: code_changed');
SELECT pg_temp.assert(
  (pg_temp.w55('55b00000-0000-0000-0000-0000000000a1')).revoke_requested_at IS NULL,
  '55/trigger: przepustka Apple nie jest kolejkowana (statyczna, bez uslugi aktualizacji)');

-- Anulowanie z wyczyszczeniem kodu.
UPDATE public.event_registrations
   SET status = 'cancelled', cancelled_at = now()
 WHERE id = '55b00000-0000-0000-0000-0000000000a2';
SELECT pg_temp.assert(
  (pg_temp.w55('g55.a2.c2')).revoke_reason = 'registration_closed'
  AND (pg_temp.w55('g55.a2.old')).revoke_reason = 'code_changed',
  '55/trigger: anulowanie -> registration_closed; zgloszona wczesniej dezaktywacja nie nadpisana');

-- Zwrot pelny bez zmiany kodu (sama zmiana statusu platnosci).
UPDATE public.event_registrations SET payment_status = 'refunded'
 WHERE id = '55b00000-0000-0000-0000-0000000000a3';
SELECT pg_temp.assert((pg_temp.w55('g55.a3.c')).revoke_reason = 'registration_closed',
  '55/trigger: zwrot pelny (payment_status) -> registration_closed');

-- no_show: przepustka przestaje byc wazna; cofniecie w attended jej nie
-- przywraca od razu - zrobi to zajecie kolejki (stale) nizej.
UPDATE public.event_registrations SET status = 'no_show'
 WHERE id = '55b00000-0000-0000-0000-0000000000a4';
SELECT pg_temp.assert((pg_temp.w55('g55.a4.c')).revoke_reason = 'registration_closed',
  '55/trigger: no_show -> registration_closed');
UPDATE public.event_registrations SET status = 'attended'
 WHERE id = '55b00000-0000-0000-0000-0000000000a4';
SELECT pg_temp.assert((pg_temp.w55('g55.a4.c')).revoke_reason = 'registration_closed',
  '55/trigger: powrot do attended nie dotyka juz zgloszonej dezaktywacji');

-- Wydarzenie minione: zgloszenie anulowane (obiekt i tak wygasl).
UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
 WHERE id = '55b00000-0000-0000-0000-0000000000a6';

-- Najemca B: anulowanie jego zgloszenia nie rusza najemcy A.
UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
 WHERE id = '55b00000-0000-0000-0000-0000000000b1';
SELECT pg_temp.assert(
  (pg_temp.w55('g55.b1.c')).revoke_reason = 'registration_closed'
  AND (pg_temp.w55('g55.a7.c')).revoke_requested_at IS NULL,
  '55/trigger: dezaktywacja tylko obiektow zmienionego zgloszenia (najemca B nie rusza A)');

-- ---------------------------------------------------------------------------
-- 3) TRIGGER WYDARZENIA
-- ---------------------------------------------------------------------------
UPDATE public.events SET title_pl = 'Do odwolania 55 (zmiana)'
 WHERE id = '55e00000-0000-0000-0000-0000000000a2';
SELECT pg_temp.assert((pg_temp.w55('g55.a5.c')).revoke_requested_at IS NULL,
  '55/wydarzenie: zmiana tytulu nie dezaktywuje przepustek');
UPDATE public.events SET status = 'cancelled'
 WHERE id = '55e00000-0000-0000-0000-0000000000a2';
SELECT pg_temp.assert(
  (pg_temp.w55('g55.a5.c')).revoke_reason = 'event_cancelled'
  AND (pg_temp.w55('55b00000-0000-0000-0000-0000000000a5')).revoke_requested_at IS NULL
  AND (SELECT count(*) FROM public.event_wallet_passes
        WHERE revoke_reason = 'event_cancelled') = 1,
  '55/wydarzenie: odwolanie -> event_cancelled dla obiektow Google tego wydarzenia i tylko jego');

-- ---------------------------------------------------------------------------
-- 4) ZAJECIE KOLEJKI
-- ---------------------------------------------------------------------------
-- Kolejnosc: najstarsze zgloszenie pierwsze.
UPDATE public.event_wallet_passes SET revoke_requested_at = now() - interval '2 hours'
 WHERE object_id = 'g55.a2.old';

CREATE TEMP TABLE c55 (k text PRIMARY KEY, v jsonb NOT NULL);

INSERT INTO c55 VALUES ('first', public._event_wallet_pass_revocations_claim(1));
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(v->'passes') = 1
          AND v->'passes'->0->>'object_id' = 'g55.a2.old'
          AND v->'passes'->0->>'reason' = 'code_changed'
          AND (v->'passes'->0->>'attempt')::int = 1
     FROM c55 WHERE k = 'first'),
  '55/zajecie: limit 1 -> jeden obiekt, najstarsze zgloszenie, proba 1');
SELECT pg_temp.assert(
  (SELECT w.revoke_claimed_at = (c.v->>'claimed_at')::timestamptz AND w.revoke_attempts = 1
     FROM public.event_wallet_passes w, c55 c
    WHERE w.object_id = 'g55.a2.old' AND c.k = 'first'),
  '55/zajecie: dzierzawa = claimed_at odpowiedzi, licznik prob 1');

INSERT INTO c55 VALUES ('second', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(v->'passes') = 6 AND (v->>'closed')::int = 2
     FROM c55 WHERE k = 'second')
  AND (SELECT array_agg(p->>'object_id' ORDER BY p->>'object_id')
         FROM c55, jsonb_array_elements(v->'passes') p WHERE k = 'second')
      = ARRAY['g55.a1.c1', 'g55.a2.c2', 'g55.a3.c', 'g55.a5.c', 'g55.a7.legacy', 'g55.b1.c'],
  '55/zajecie: pozostale obiekty Google (obu najemcow), bez zajetego wyzej; 2 zamkniete bez sieci');
SELECT pg_temp.assert(
  (SELECT w.revoke_requested_at IS NULL AND w.revoke_reason IS NULL AND w.revoke_attempts = 0
          AND w.revoke_claimed_at IS NULL AND w.revoked_at IS NULL
     FROM public.event_wallet_passes w WHERE w.object_id = 'g55.a4.c')
  AND public._event_wallet_pass_state('55000000-0000-0000-0000-0000000000a0', 'google', 'g55.a4.c')
      ->> 'active' = 'true',
  '55/zajecie: zgloszenie znow wazne z tym samym kodem (attended) -> stale: dezaktywacja zdjeta');
SELECT pg_temp.assert(
  (SELECT w.revoked_at IS NOT NULL AND w.revoke_claimed_at IS NULL AND w.revoke_attempts = 0
     FROM public.event_wallet_passes w WHERE w.object_id = 'g55.a6.c'),
  '55/zajecie: wydarzenie zakonczone ponad dobe temu -> lapsed: revoked_at bez wywolania Google');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM c55, jsonb_array_elements(v->'passes') p
               WHERE p->>'object_id' NOT LIKE 'g55.%'),
  '55/zajecie: obiekty Apple nigdy nie trafiaja do kolejki');
SELECT pg_temp.assert(
  jsonb_array_length(public._event_wallet_pass_revocations_claim(100)->'passes') = 0,
  '55/zajecie: dzierzawa - natychmiastowe ponowne zajecie nie oddaje niczego');

-- ---------------------------------------------------------------------------
-- 5) ROZLICZENIE
-- ---------------------------------------------------------------------------
INSERT INTO c55 VALUES ('settle', public._event_wallet_pass_revocations_settle(
  (SELECT (v->>'claimed_at')::timestamptz FROM c55 WHERE k = 'second'),
  ARRAY[(pg_temp.w55('g55.a1.c1')).id, (pg_temp.w55('g55.a2.c2')).id],
  jsonb_build_array(
    jsonb_build_object('id', (pg_temp.w55('g55.a3.c')).id, 'error', 'http 503'),
    jsonb_build_object('id', 'nie-uuid', 'error', 'x'),
    5, 'tekst'),
  ARRAY[(pg_temp.w55('g55.a5.c')).id]));
SELECT pg_temp.assert(
  (SELECT v = jsonb_build_object('revoked', 2, 'failed', 1, 'gave_up', 0, 'deferred', 1,
                                 'reactivate', '[]'::jsonb)
     FROM c55 WHERE k = 'settle'),
  '55/rozliczenie: 2 dezaktywowane, 1 blad, 1 odlozony; smieci w p_failed pominiete');
SELECT pg_temp.assert(
  (pg_temp.w55('g55.a1.c1')).revoked_at IS NOT NULL
  AND (pg_temp.w55('g55.a1.c1')).revoke_claimed_at IS NULL
  AND (pg_temp.w55('g55.a2.c2')).revoked_at IS NOT NULL,
  '55/rozliczenie: revoked -> revoked_at, dzierzawa zdjeta');
SELECT pg_temp.assert(
  (SELECT w.revoke_error = 'http 503' AND w.revoked_at IS NULL AND w.revoke_attempts = 1
          AND w.revoke_claimed_at = (c.v->>'claimed_at')::timestamptz
     FROM public.event_wallet_passes w, c55 c
    WHERE w.object_id = 'g55.a3.c' AND c.k = 'second'),
  '55/rozliczenie: failed -> blad zapisany, proba liczona, dzierzawa zostaje jako chwila proby');
SELECT pg_temp.assert(
  (SELECT w.revoke_claimed_at IS NULL AND w.revoke_attempts = 0 AND w.revoked_at IS NULL
     FROM public.event_wallet_passes w WHERE w.object_id = 'g55.a5.c'),
  '55/rozliczenie: deferred -> proba oddana, dzierzawa zdjeta (gotowy od razu)');

-- Cudza dzierzawa: rozliczenie z chwila pierwszego zajecia nie rusza drugiego.
SELECT pg_temp.assert(
  (public._event_wallet_pass_revocations_settle(
     (SELECT (v->>'claimed_at')::timestamptz FROM c55 WHERE k = 'first'),
     ARRAY[(pg_temp.w55('g55.b1.c')).id], '[]'::jsonb, ARRAY[]::uuid[])->>'revoked')::int = 0
  AND (pg_temp.w55('g55.b1.c')).revoked_at IS NULL,
  '55/rozliczenie: wiersz bez dzierzawy tego zajecia nie jest zmieniany');

-- Wydany ponownie w trakcie proby: dziennik zdejmuje zgloszenie i dzierzawe,
-- rozliczenie oddaje obiekt do przywrocenia (ACTIVE).
SELECT public._event_wallet_pass_note('55000000-0000-0000-0000-0000000000a0',
  '55b00000-0000-0000-0000-0000000000a7', 'google', 'g55.a7.legacy',
  NULL, pg_temp.h55('content-a7-legacy'));
INSERT INTO c55 VALUES ('reactivate', public._event_wallet_pass_revocations_settle(
  (SELECT (v->>'claimed_at')::timestamptz FROM c55 WHERE k = 'second'),
  ARRAY[(pg_temp.w55('g55.a7.legacy')).id], '[]'::jsonb, ARRAY[]::uuid[]));
SELECT pg_temp.assert(
  (SELECT (v->>'revoked')::int = 0 AND v->'reactivate' = '["g55.a7.legacy"]'::jsonb
     FROM c55 WHERE k = 'reactivate')
  AND (pg_temp.w55('g55.a7.legacy')).content_hash IS NULL
  AND (pg_temp.w55('g55.a7.legacy')).revoked_at IS NULL
  AND (pg_temp.w55('g55.a7.c')).revoke_reason = 'replaced',
  '55/rozliczenie: obiekt wydany ponownie w trakcie proby -> reactivate, tresc do ponownego zapisu');

-- Przyciecie bledu do 300 znakow.
UPDATE public.event_wallet_passes SET revoke_claimed_at = now() - interval '7 hours'
 WHERE object_id = 'g55.a3.c';
INSERT INTO c55 VALUES ('third', public._event_wallet_pass_revocations_claim(100));
SELECT public._event_wallet_pass_revocations_settle(
  (SELECT (v->>'claimed_at')::timestamptz FROM c55 WHERE k = 'third'),
  ARRAY[]::uuid[],
  jsonb_build_array(jsonb_build_object('id', (pg_temp.w55('g55.a3.c')).id, 'error', repeat('e', 400))),
  ARRAY[]::uuid[]);
SELECT pg_temp.assert(
  char_length((pg_temp.w55('g55.a3.c')).revoke_error) = 300
  AND (pg_temp.w55('g55.a3.c')).revoke_attempts = 2,
  '55/rozliczenie: blad przyciety do 300 znakow, druga proba policzona');

-- Wykladniczy odstep: proba 2 czeka 10 minut od ostatniej.
UPDATE public.event_wallet_passes SET revoke_claimed_at = now() - interval '9 minutes'
 WHERE object_id = 'g55.a3.c';
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                public._event_wallet_pass_revocations_claim(100)->'passes') p
               WHERE p->>'object_id' = 'g55.a3.c'),
  '55/odstep: po 2 probach 9 minut to za wczesnie (odstep 10 minut)');
UPDATE public.event_wallet_passes SET revoke_claimed_at = now() - interval '11 minutes'
 WHERE object_id = 'g55.a3.c';
INSERT INTO c55 VALUES ('fourth', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM c55, jsonb_array_elements(v->'passes') p
           WHERE k = 'fourth' AND p->>'object_id' = 'g55.a3.c' AND (p->>'attempt')::int = 3),
  '55/odstep: po 11 minutach - trzecia proba');

-- Sufit prob: osma nieudana -> gave_up i koniec zajec.
UPDATE public.event_wallet_passes
   SET revoke_attempts = 7, revoke_claimed_at = now() - interval '7 hours'
 WHERE object_id = 'g55.a3.c';
INSERT INTO c55 VALUES ('fifth', public._event_wallet_pass_revocations_claim(100));
SELECT pg_temp.assert(
  (public._event_wallet_pass_revocations_settle(
     (SELECT (v->>'claimed_at')::timestamptz FROM c55 WHERE k = 'fifth'),
     ARRAY[]::uuid[],
     jsonb_build_array(jsonb_build_object('id', (pg_temp.w55('g55.a3.c')).id, 'error', 'http 403')),
     ARRAY[]::uuid[])->>'gave_up')::int = 1,
  '55/sufit: osma nieudana proba -> gave_up');
UPDATE public.event_wallet_passes SET revoke_claimed_at = now() - interval '7 hours'
 WHERE object_id = 'g55.a3.c';
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                public._event_wallet_pass_revocations_claim(100)->'passes') p
               WHERE p->>'object_id' = 'g55.a3.c')
  AND (pg_temp.w55('g55.a3.c')).revoke_error = 'http 403',
  '55/sufit: po 8 probach obiekt nie jest juz zajmowany, ostatni blad zostaje');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_revocations_settle(NULL, ARRAY[]::uuid[])$q$,
  'invalid_claim', '55/rozliczenie: brak claimed_at -> invalid_claim');

-- ---------------------------------------------------------------------------
-- 6) WIEZY
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_wallet_passes SET revoke_requested_at = now(), revoke_reason = 'replaced'
     WHERE object_id = '55b00000-0000-0000-0000-0000000000a1'$q$,
  'event_wallet_passes_revoke_google_only', '55/wiezy: przepustka Apple nie ma dezaktywacji');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_wallet_passes SET revoke_requested_at = now()
     WHERE object_id = 'g55.a7.legacy'$q$,
  'event_wallet_passes_revoke_state', '55/wiezy: zgloszenie dezaktywacji bez powodu');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_wallet_passes SET revoked_at = now() WHERE object_id = 'g55.a7.legacy'$q$,
  'event_wallet_passes_revoke_state', '55/wiezy: revoked_at bez zgloszenia');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_wallet_passes SET code_hash = 'ABC' WHERE object_id = 'g55.a7.c'$q$,
  'event_wallet_passes_code_hash_shape', '55/wiezy: skrot kodu zlego ksztaltu');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_wallet_passes (tenant_id, event_id, registration_id, platform, object_id)
     VALUES ('55000000-0000-0000-0000-0000000000a0', '55e00000-0000-0000-0000-0000000000a1',
             '55b00000-0000-0000-0000-0000000000a1', 'google', 'g55.a7.c')$q$,
  'event_wallet_passes_object_unique', '55/wiezy: jeden wiersz na obiekt platformy');

-- ---------------------------------------------------------------------------
-- 7) GRANTY I KSZTALT
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  bool_and(NOT has_function_privilege('anon', f, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
           AND has_function_privilege('service_role', f, 'EXECUTE')),
  '55/granty: dziennik, stan, zajecie i rozliczenie wylacznie dla service_role')
FROM unnest(ARRAY[
  'public._event_wallet_pass_note(uuid,uuid,text,text,text,text)',
  'public._event_wallet_pass_state(uuid,text,text)',
  'public._event_wallet_pass_revocations_claim(integer)',
  'public._event_wallet_pass_revocations_settle(timestamptz,uuid[],jsonb,uuid[])']) AS f;
SELECT pg_temp.assert(
  bool_and(NOT has_function_privilege('anon', f, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', f, 'EXECUTE')),
  '55/granty: funkcje triggerow bez grantu klienckiego')
FROM unnest(ARRAY[
  'public._tg_event_registrations_wallet_revoke()',
  'public._tg_events_wallet_revoke()']) AS f;
SELECT pg_temp.assert(
  bool_and(p.prosecdef AND array_to_string(p.proconfig, ',') ~ 'search_path=')
  AND count(*) = 6,
  '55/ksztalt: wszystkie nowe funkcje SECURITY DEFINER z ustawionym search_path')
FROM pg_proc p
WHERE p.oid IN (
  'public._event_wallet_pass_note(uuid,uuid,text,text,text,text)'::regprocedure,
  'public._event_wallet_pass_state(uuid,text,text)'::regprocedure,
  'public._event_wallet_pass_revocations_claim(integer)'::regprocedure,
  'public._event_wallet_pass_revocations_settle(timestamptz,uuid[],jsonb,uuid[])'::regprocedure,
  'public._tg_event_registrations_wallet_revoke()'::regprocedure,
  'public._tg_events_wallet_revoke()'::regprocedure);
SELECT pg_temp.assert(
  to_regprocedure('public._event_wallet_pass_note(uuid,uuid,text,text)') IS NULL,
  '55/ksztalt: stara sygnatura dziennika usunieta (brak przeciazenia)');

SELECT pg_temp.act_as('55a00000-0000-0000-0000-0000000000a1', '55000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_wallet_pass_revocations_claim(10)$q$,
  'permission denied', '55/granty: admin nie zajmuje kolejki z klienta');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_wallet_passes SET revoke_requested_at = NULL$q$,
  'permission denied', '55/granty: klient nie zmienia stanu obiektow');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_wallet_passes WHERE revoke_reason IS NOT NULL) > 0
  AND (SELECT count(*) FROM public.event_wallet_passes
        WHERE tenant_id <> '55000000-0000-0000-0000-0000000000a0') = 0,
  '55/RLS: admin A widzi stan dezaktywacji obiektow swojego najemcy i tylko jego');
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;
