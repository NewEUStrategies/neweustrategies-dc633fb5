-- ============================================================================
-- 29_group_lead_plan_seat - BENEFIT PLANU TYLKO NA MIEJSCU CZLONKA
-- (20260926140000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Kasa wejsciowki liczyla cene czlonka (zniżka albo bilet z puli planu) dla
-- KAZDEGO miejsca zamowienia grupowego. Od 20260926140000 benefit ma tylko
-- miejsce, ktorego osoba to wolajacy (`holder_is_caller` w kontekscie
-- platnosci), a bilet z puli dla miejsca prowadzacego schodzi z puli przez
-- `event_registration_claim_plan_seat`. Ten plik sprawdza KAZDA galaz obu.
--
-- ATRAPY PULI PLANU. Harness Wydarzen nie odtwarza czlonkostw (patrz
-- harness.sql), a funkcja puli czyta `plan_ticket_claims`,
-- `my_ticket_allowance()` i zrodla warstwy (nadania, subskrypcje). Plik
-- zaklada je W SWOJEJ TRANSAKCJI w ksztalcie produkcyjnym (20260822091000,
-- 20260822171037) - kolumny, ktore funkcja czyta, i unikat (user_id,
-- event_id), na ktorym stoi ponowna kasa. `my_ticket_allowance` oddaje stany
-- z kolejki testu, zeby dalo sie sprawdzic ponowny odczyt pod blokada
-- organizacji. Wszystko znika z ROLLBACK-iem.
--
-- CO SPRAWDZA
--   1. Kontekst platnosci: `holder_is_caller` prawda dla wlasnego zgloszenia,
--      falsz dla zgloszenia goscia oplacanego przez prowadzacego.
--   2. Bilet z puli - odmowy `not_eligible` (cudze, gosc, zamkniete,
--      rozliczone, bez cennika, bilet za zero, konto bez profilu),
--      `account_required` (anonim), `pool_empty` (pusta pula osobista, pula
--      organizacji pusta po ponownym odczycie pod blokada).
--   3. Podglad na sucho (bez zapisu; widzi bilet zajety mimo pustej puli)
--      i zajecie: wiersz puli z wartoscia biletu z CENNIKA, oknem roku,
--      walutą i najwyzsza warstwa (subskrypcja nad nadaniem, brak - `member`);
--      ponowna kasa bierze ten sam bilet (`reused`), zwolniony bilet wraca
--      do tego samego wiersza; pula organizacji zapisuje organizacje.
--   4. Uprawnienia: `authenticated` tak, `anon` nie.
-- ============================================================================

\echo '== 29 benefit planu tylko na miejscu czlonka =='

BEGIN;

-- --- atrapy puli planu (ksztalt produkcyjny, tylko czytane kolumny) --------
CREATE TABLE public.plan_ticket_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  org_id uuid,
  tier_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  face_value_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT plan_ticket_claims_user_event_uniq UNIQUE (user_id, event_id)
);
CREATE TABLE public.membership_grants (
  user_id uuid, tenant_id uuid, tier_key text,
  revoked_at timestamptz, starts_at timestamptz, expires_at timestamptz
);
CREATE TABLE public.access_plans (id uuid PRIMARY KEY, tier_key text);
CREATE TABLE public.user_subscriptions (user_id uuid, tenant_id uuid, plan_id uuid, status text);
ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS key text;

CREATE TEMP TABLE p29_allowance (seq serial PRIMARY KEY, state jsonb NOT NULL);
CREATE TEMP TABLE p29_q (k text PRIMARY KEY, u uuid);

-- Kolejka stanow puli: kazde wywolanie zdejmuje pierwszy stan, ostatni zostaje.
CREATE FUNCTION public.my_ticket_allowance() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_seq integer; v_state jsonb;
BEGIN
  SELECT a.seq, a.state INTO v_seq, v_state FROM pg_temp.p29_allowance a ORDER BY a.seq LIMIT 1;
  IF v_seq IS NULL THEN RETURN '{"remaining": 0}'::jsonb; END IF;
  IF (SELECT count(*) FROM pg_temp.p29_allowance) > 1 THEN
    DELETE FROM pg_temp.p29_allowance WHERE seq = v_seq;
  END IF;
  RETURN v_state;
END $$;

CREATE FUNCTION pg_temp.p29_pool(VARIADIC _states jsonb[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE s jsonb;
BEGIN
  DELETE FROM pg_temp.p29_allowance;
  FOREACH s IN ARRAY _states LOOP
    INSERT INTO pg_temp.p29_allowance (state) VALUES (s);
  END LOOP;
END $$;

-- --- dane ---------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'Tenant D9 (benefit planu)', 'td9-plan')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('d9000000-0000-0000-0000-000000000001', 'czlonek.d9@example.org'),
  ('d9000000-0000-0000-0000-000000000002', 'obcy.d9@example.org'),
  ('d9000000-0000-0000-0000-000000000003', 'bez.profilu.d9@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('d9000000-0000-0000-0000-000000000001', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9'),
  ('d9000000-0000-0000-0000-000000000002', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('nes.public_tenant', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', false);

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, user_id) VALUES
  ('d9300000-0000-0000-0000-000000000001', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9',
   'czlonek.d9@example.org', 'Czlonek', 'Planu', 'd9000000-0000-0000-0000-000000000001'),
  ('d9300000-0000-0000-0000-000000000002', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9',
   'gosc.d9@example.org', 'Gosc', 'Czlonka', NULL),
  ('d9300000-0000-0000-0000-000000000003', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9',
   'obcy.d9@example.org', 'Obcy', 'Uczestnik', 'd9000000-0000-0000-0000-000000000002'),
  ('d9300000-0000-0000-0000-000000000004', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9',
   'bez.profilu.d9@example.org', 'Bez', 'Profilu', 'd9000000-0000-0000-0000-000000000003');

-- Jedno wydarzenie na przypadek - osoba ma na wydarzeniu jeden aktywny zapis.
CREATE FUNCTION pg_temp.p29_case(_key text, _price integer, _ticket boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_event uuid := gen_random_uuid(); v_ticket uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events
    (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode, registration_flow)
  VALUES
    (v_event, 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'd9-' || _key, 'Wydarzenie ' || _key,
     'Event ' || _key, now() + interval '30 days', 'published', 'form', 'instant');
  INSERT INTO public.event_ticket_types
    (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, group_registration_enabled)
  VALUES
    (v_ticket, 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', v_event, 'k_' || _key, 'Bilet', 'Ticket',
     _price, 'EUR', true);
  INSERT INTO p29_q VALUES (_key || ':event', v_event), (_key || ':ticket', v_ticket);
  RETURN CASE WHEN _ticket THEN v_ticket ELSE NULL END;
END $$;

-- `_case` = wydarzenie przypadku (`p29_case`), `_key` = nazwa zapisu w p29_q.
CREATE FUNCTION pg_temp.p29_reg(_key text, _case text, _person uuid,
                                _status text DEFAULT 'pending', _payment text DEFAULT 'unpaid',
                                _lead uuid DEFAULT NULL, _with_ticket boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, created_by, group_lead_registration_id, cancelled_at, paid_at,
     decided_at, decision_source)
  VALUES
    (v_id, 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9',
     (SELECT u FROM p29_q WHERE k = _case || ':event'), _person,
     CASE WHEN _with_ticket THEN (SELECT u FROM p29_q WHERE k = _case || ':ticket') END,
     _status, 'form', _payment, 'd9000000-0000-0000-0000-000000000001', _lead,
     CASE WHEN _status = 'cancelled' THEN now() END,
     CASE WHEN _payment = 'paid' THEN now() END,
     CASE WHEN _status IN ('cancelled', 'approved') THEN now() END,
     CASE WHEN _status IN ('cancelled', 'approved') THEN 'system' END);
  INSERT INTO p29_q VALUES (_key, v_id);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.p29(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM p29_q WHERE k = _key $$;

CREATE FUNCTION pg_temp.p29_claim(_key text, _uid uuid DEFAULT 'd9000000-0000-0000-0000-000000000001',
                                  _dry boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(_uid, 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9');
  -- `_dry` NULL = wywolanie jak kasa sprzed podgladu (domyslny argument).
  v := CASE WHEN _dry IS NULL THEN public.event_registration_claim_plan_seat(pg_temp.p29(_key))
            ELSE public.event_registration_claim_plan_seat(pg_temp.p29(_key), _dry) END;
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

SELECT pg_temp.p29_case('lead', 10000);
SELECT pg_temp.p29_reg('lead', 'lead', 'd9300000-0000-0000-0000-000000000001');
SELECT pg_temp.p29_reg('guest', 'lead', 'd9300000-0000-0000-0000-000000000002', 'pending', 'unpaid',
                       pg_temp.p29('lead'));
SELECT pg_temp.p29_case('foreign', 10000);
SELECT pg_temp.p29_reg('foreign', 'foreign', 'd9300000-0000-0000-0000-000000000003');
-- Czlonek zapisany jako GOSC cudzej grupy: osoba to wolajacy, ale miejsce
-- oplaca prowadzacy (obcy).
SELECT pg_temp.p29_reg('memberguest', 'foreign', 'd9300000-0000-0000-0000-000000000001',
                       'pending', 'unpaid', pg_temp.p29('foreign'));
SELECT pg_temp.p29_case('closed', 10000);
SELECT pg_temp.p29_reg('closed', 'closed', 'd9300000-0000-0000-0000-000000000001', 'cancelled');
SELECT pg_temp.p29_case('settled', 10000);
SELECT pg_temp.p29_reg('settled', 'settled', 'd9300000-0000-0000-0000-000000000001', 'approved', 'paid');
SELECT pg_temp.p29_case('free', 0);
SELECT pg_temp.p29_reg('free', 'free', 'd9300000-0000-0000-0000-000000000001');
SELECT pg_temp.p29_case('noticket', 10000);
SELECT pg_temp.p29_reg('noticket', 'noticket', 'd9300000-0000-0000-0000-000000000001',
                       'pending', 'unpaid', NULL, false);
SELECT pg_temp.p29_case('noprofile', 10000);
SELECT pg_temp.p29_reg('noprofile', 'noprofile', 'd9300000-0000-0000-0000-000000000004');
SELECT pg_temp.p29_case('org', 10000);
SELECT pg_temp.p29_reg('org', 'org', 'd9300000-0000-0000-0000-000000000001');
SELECT pg_temp.p29_case('orgfull', 10000);
SELECT pg_temp.p29_reg('orgfull', 'orgfull', 'd9300000-0000-0000-0000-000000000001');

-- Warstwy: nadanie `czlonek` (ranga 10) i subskrypcja `partner` (ranga 20).
INSERT INTO public.membership_tiers (tenant_id, slug, key, rank) VALUES
  ('d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'czlonek-d9', 'czlonek', 10),
  ('d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'partner-d9', 'partner', 20);
INSERT INTO public.membership_grants (user_id, tenant_id, tier_key, starts_at) VALUES
  ('d9000000-0000-0000-0000-000000000001', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'czlonek',
   now() - interval '1 day');
INSERT INTO public.access_plans (id, tier_key) VALUES
  ('d9800000-0000-0000-0000-000000000001', 'partner');
INSERT INTO public.user_subscriptions (user_id, tenant_id, plan_id, status) VALUES
  ('d9000000-0000-0000-0000-000000000001', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9',
   'd9800000-0000-0000-0000-000000000001', 'active');

-- ---------------------------------------------------------------------------
-- 1) KONTEKST PLATNOSCI: CZY TO MIEJSCE WOLAJACEGO
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as('d9000000-0000-0000-0000-000000000001', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9');
  v := public.event_registration_payment_context(pg_temp.p29('lead'));
  PERFORM pg_temp.assert((v->>'ok')::boolean AND (v->>'holder_is_caller')::boolean,
    '29/kontekst: wlasne zgloszenie - miejsce wolajacego, benefit mu przysluguje');
  v := public.event_registration_payment_context(pg_temp.p29('guest'));
  PERFORM pg_temp.assert((v->>'ok')::boolean AND NOT (v->>'holder_is_caller')::boolean,
    '29/kontekst: zgloszenie goscia, ktore prowadzacy moze oplacic - NIE jego miejsce');
  PERFORM pg_temp.act_as();
END $$;

-- ---------------------------------------------------------------------------
-- 2) ODMOWY BILETU Z PULI
-- ---------------------------------------------------------------------------
SELECT pg_temp.p29_pool('{"remaining": 1, "period_start": "2026-01-01", "period_end": "2027-01-01"}'::jsonb);

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as();
  v := public.event_registration_claim_plan_seat(pg_temp.p29('lead'));
  PERFORM pg_temp.assert(v = '{"claimed": false, "reason": "account_required"}'::jsonb,
    '29/pula: anonim - account_required');

  PERFORM pg_temp.assert(
    pg_temp.p29_claim('foreign') = '{"claimed": false, "reason": "not_eligible"}'::jsonb,
    '29/pula: cudze zgloszenie - not_eligible');
  PERFORM pg_temp.assert(
    pg_temp.p29_claim('guest') = '{"claimed": false, "reason": "not_eligible"}'::jsonb,
    '29/pula: zgloszenie goscia (osoba bez konta) - not_eligible');
  PERFORM pg_temp.assert(
    pg_temp.p29_claim('memberguest') = '{"claimed": false, "reason": "not_eligible"}'::jsonb,
    '29/pula: czlonek zapisany jako GOSC cudzej grupy - miejsce oplaca prowadzacy, nie pula');
  PERFORM pg_temp.assert(
    pg_temp.p29_claim('closed') = '{"claimed": false, "reason": "not_eligible"}'::jsonb,
    '29/pula: zapis anulowany - not_eligible');
  PERFORM pg_temp.assert(
    pg_temp.p29_claim('settled') = '{"claimed": false, "reason": "not_eligible"}'::jsonb,
    '29/pula: zapis juz oplacony - not_eligible');
  PERFORM pg_temp.assert(
    pg_temp.p29_claim('free') = '{"claimed": false, "reason": "not_eligible"}'::jsonb,
    '29/pula: bilet za zero - pula nie ma czego pokrywac');
  PERFORM pg_temp.assert(
    pg_temp.p29_claim('noticket') = '{"claimed": false, "reason": "not_eligible"}'::jsonb,
    '29/pula: zapis bez biletu z cennika - not_eligible');
  PERFORM pg_temp.assert(
    pg_temp.p29_claim('noprofile', 'd9000000-0000-0000-0000-000000000003')
      = '{"claimed": false, "reason": "not_eligible"}'::jsonb,
    '29/pula: konto bez profilu (bez najemcy puli) - not_eligible');
  PERFORM pg_temp.assert(NOT EXISTS (SELECT 1 FROM public.plan_ticket_claims),
    '29/pula: zadna odmowa nie zapisala biletu w puli');
END $$;

SELECT pg_temp.p29_pool('{"remaining": 0, "period_start": "2026-01-01", "period_end": "2027-01-01"}'::jsonb);
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.p29_claim('lead');
  PERFORM pg_temp.assert(v = '{"claimed": false, "reason": "pool_empty"}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM public.plan_ticket_claims),
    '29/pula: pusta pula osobista - pool_empty, bez wiersza');
  v := pg_temp.p29_claim('lead', _dry => true);
  PERFORM pg_temp.assert(v = '{"claimed": false, "reason": "pool_empty"}'::jsonb,
    '29/sucho: podglad przy pustej puli bez biletu dla wydarzenia - pool_empty');
END $$;

-- Pula organizacji: przed blokada 1, po ponownym odczycie pod blokada 0.
SELECT pg_temp.p29_pool(
  '{"remaining": 1, "org_id": "d9700000-0000-0000-0000-000000000001", "period_start": "2026-01-01", "period_end": "2027-01-01"}'::jsonb,
  '{"remaining": 0, "org_id": "d9700000-0000-0000-0000-000000000001", "period_start": "2026-01-01", "period_end": "2027-01-01"}'::jsonb);
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.p29_claim('orgfull');
  PERFORM pg_temp.assert(v = '{"claimed": false, "reason": "pool_empty"}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM public.plan_ticket_claims),
    '29/pula: pula organizacji wyczerpana miedzy odczytami - ponowny odczyt pod blokada odmawia');
END $$;

-- ---------------------------------------------------------------------------
-- 3) ZAJECIE BILETU (i podglad na sucho)
-- ---------------------------------------------------------------------------
SELECT pg_temp.p29_pool('{"remaining": 1, "period_start": "2026-01-01", "period_end": "2099-01-01"}'::jsonb);

DO $$
DECLARE v jsonb; c public.plan_ticket_claims;
BEGIN
  -- PODGLAD kasy: pula odda bilet, ale nic sie nie zapisuje.
  v := pg_temp.p29_claim('lead', _dry => true);
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": false, "dry_run": true}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM public.plan_ticket_claims),
    '29/sucho: podglad z wolnym biletem mowi "pokryje", bez zapisu w puli');

  v := pg_temp.p29_claim('lead', _dry => false);
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": false}'::jsonb,
    '29/zajecie: prowadzacy z pula - bilet zajety');
  SELECT * INTO c FROM public.plan_ticket_claims WHERE event_id = pg_temp.p29('lead:event');
  PERFORM pg_temp.assert(
    c.user_id = 'd9000000-0000-0000-0000-000000000001'
    AND c.tenant_id = 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9'
    AND c.face_value_cents = 10000 AND c.currency = 'EUR'
    AND c.period_start = DATE '2026-01-01' AND c.period_end = DATE '2099-01-01'
    AND c.org_id IS NULL AND c.released_at IS NULL,
    '29/zajecie: wartosc biletu z CENNIKA, waluta biletu, okno roku z puli, bez organizacji');
  PERFORM pg_temp.assert(c.tier_key = 'partner',
    '29/zajecie: warstwa najwyzszej rangi - subskrypcja partner nad nadaniem czlonek');

  -- Ponowna kasa (zamknieta nakladka, druga proba) - ten sam bilet. Pula
  -- jest juz PUSTA (bilet zuzyty) - i wlasnie dlatego pyta baza, a nie stan puli.
  PERFORM pg_temp.p29_pool('{"remaining": 0, "period_start": "2026-01-01", "period_end": "2099-01-01"}'::jsonb);
  v := pg_temp.p29_claim('lead', _dry => true);
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": true}'::jsonb,
    '29/sucho: podglad ponownej kasy widzi bilet zajety dla tego wydarzenia mimo pustej puli');
  v := pg_temp.p29_claim('lead');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": true}'::jsonb
    AND (SELECT count(*) FROM public.plan_ticket_claims) = 1,
    '29/zajecie: ponowna kasa bierze TEN SAM bilet - bez drugiego wiersza');
  PERFORM pg_temp.p29_pool('{"remaining": 1, "period_start": "2026-01-01", "period_end": "2099-01-01"}'::jsonb);

  -- Bilet zwolniony (administrator albo czlonek) wraca do tego samego wiersza.
  UPDATE public.plan_ticket_claims SET released_at = now() - interval '1 hour', tier_key = 'stary'
  WHERE id = c.id;
  v := pg_temp.p29_claim('lead');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": false}'::jsonb
    AND (SELECT released_at IS NULL AND tier_key = 'partner'
           FROM public.plan_ticket_claims WHERE id = c.id)
    AND (SELECT count(*) FROM public.plan_ticket_claims) = 1,
    '29/zajecie: zwolniony bilet zajety ponownie w tym samym wierszu (unikat user_id + event_id)');
END $$;

-- Pula organizacji z miejscem - wiersz niesie organizacje; bez warstwy -
-- `member`.
DELETE FROM public.user_subscriptions;
DELETE FROM public.membership_grants;
SELECT pg_temp.p29_pool(
  '{"remaining": 2, "org_id": "d9700000-0000-0000-0000-000000000001", "period_start": "2026-01-01", "period_end": "2099-01-01"}'::jsonb);
-- Zajecie i odczyt w OSOBNYCH instrukcjach: kolejnosc czlonow AND nie jest
-- w Postgresie gwarantowana, a podzapytanie przed wywolaniem widzialo pustke.
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.p29_claim('org');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": false}'::jsonb
    AND (SELECT org_id = 'd9700000-0000-0000-0000-000000000001' AND tier_key = 'member'
           FROM public.plan_ticket_claims WHERE event_id = pg_temp.p29('org:event')),
    '29/zajecie: pula organizacji zapisuje organizacje; bez warstwy - member');
END $$;

-- Okno roku minelo: stary bilet nie liczy sie jako zajety - nowe zajecie.
UPDATE public.plan_ticket_claims SET period_end = CURRENT_DATE
WHERE event_id = pg_temp.p29('org:event');
SELECT pg_temp.p29_pool('{"remaining": 1, "period_start": "2026-01-01", "period_end": "2099-01-01"}'::jsonb);
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.p29_claim('org');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": false}'::jsonb
    AND (SELECT period_end = DATE '2099-01-01' AND org_id IS NULL
           FROM public.plan_ticket_claims WHERE event_id = pg_temp.p29('org:event')),
    '29/zajecie: bilet z minionego roku czlonkowskiego nie jest ponowna kasa - nowy rok, nowy zapis');
END $$;

-- ---------------------------------------------------------------------------
-- 4) UPRAWNIENIA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  has_function_privilege('authenticated', 'public.event_registration_claim_plan_seat(uuid, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_registration_claim_plan_seat(uuid, boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_registration_payment_context(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_registration_payment_context(uuid)', 'EXECUTE'),
  '29/uprawnienia: kasa z sesja wola obie funkcje, anonim zadnej');

ROLLBACK;

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9')
  AND to_regclass('public.plan_ticket_claims') IS NULL
  AND to_regprocedure('public.my_ticket_allowance()') IS NULL,
  '29/sprzatanie: plik nie zostawil wierszy ani atrap puli');

\echo '== 29 benefit planu: koniec =='
