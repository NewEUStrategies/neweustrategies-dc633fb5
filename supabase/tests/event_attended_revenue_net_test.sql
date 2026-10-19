-- pgTAP: obecność na szynie + jedno źródło przychodu netto wydarzenia
-- (migracja 20261020130600, hub S4).
--
-- Sprawdza:
--   * `event.registration.attended.v1` raz, przy pierwszym ustawieniu
--     `attended_at` (UPDATE i INSERT od razu obecny), bez emisji przy
--     poprawce znacznika i zmianie innej kolumny, aktor wytłumiony, payload
--     bez PII;
--   * `_event_revenue_net`: wiersz na zamówienie, zamówienie grupy bez
--     dublowania, gość z własnym zamówieniem liczony przy prowadzącym, zwrot
--     Stripe odjęty, zwrot ręczny, pula planu i pakiet nieopłacony poza
--     przychodem, kohorta po dacie;
--   * `admin_event_ads_funnel` BIT W BIT jak ciało sprzed zmiany
--     (20260927001100 - kopia słowo w słowo niżej jako
--     `pg_temp.hub_s4_funnel_old`) na fiksturze z kampaniami, kosztami,
--     krokami, grupą, pakietem, pulą planu i zwrotami - w oknie, bez okna
--     i na wydarzeniu bez danych;
--   * ACL: `_event_revenue_net` i funkcja wyzwalacza bez EXECUTE dla ról API.
--
-- Fikstura pieniędzy wstawiana w `session_replication_role = replica` (bez
-- wyzwalaczy i FK domeny wydarzeń): test sprawdza arytmetykę odczytu, nie
-- ścieżkę zakupu - tę pokrywa events-harness (28_ads_funnel*).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test event_attended_revenue_net
BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4700000-0000-0000-0000-0000000000a0', 'hub-s4-evt-a', 'Hub S4 wydarzenia A');
INSERT INTO auth.users (id, email) VALUES
  ('d4700000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-evt.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4700000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-evt.test', 'Admin A', 'd4700000-0000-0000-0000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d4700000-0000-0000-0000-00000000a001', 'admin', 'd4700000-0000-0000-0000-0000000000a0');

-- E1: pełna fikstura lejka; E2: wydarzenie bez danych; E3: obecność.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, timezone) VALUES
  ('d4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-0000000000a0', 'hub-s4-e1', 'E1', 'E1', now() + interval '10 days', 'published', 'Europe/Warsaw'),
  ('d4700000-0000-0000-0000-0000000000e2', 'd4700000-0000-0000-0000-0000000000a0', 'hub-s4-e2', 'E2', 'E2', now() + interval '20 days', 'published', 'Europe/Warsaw'),
  ('d4700000-0000-0000-0000-0000000000e3', 'd4700000-0000-0000-0000-0000000000a0', 'hub-s4-e3', 'E3', 'E3', now() - interval '1 hour', 'published', 'Europe/Warsaw');

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('d4700000-0000-0000-0000-0000000006a1', 'd4700000-0000-0000-0000-0000000000a0', 'p1@hub-s4-evt.test', 'Jan', 'Pierwszy'),
  ('d4700000-0000-0000-0000-0000000006a2', 'd4700000-0000-0000-0000-0000000000a0', 'p2@hub-s4-evt.test', 'Ewa', 'Druga');

-- ── 1. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._event_revenue_net(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_revenue_net(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._event_revenue_net(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE'),
  'acl: _event_revenue_net bez EXECUTE dla ról API (wewnętrzna)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.tg_event_registrations_attended_emit()', 'EXECUTE'),
  'acl: emiter obecności bez EXECUTE dla authenticated');

-- ── 2. Obecność na szynie ───────────────────────────────────────────────────
CREATE FUNCTION pg_temp.att(p_reg uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.domain_events
   WHERE event_type = 'event.registration.attended.v1' AND aggregate_id = p_reg::text
$$;

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode, payment_status) VALUES
  ('d4700000-0000-0000-0000-0000000007a1', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e3',
   'd4700000-0000-0000-0000-0000000006a1', 'approved', 'rsvp', 'not_required');
SELECT is(pg_temp.att('d4700000-0000-0000-0000-0000000007a1'), 0, 'obecność: samo zgłoszenie nie emituje');

UPDATE public.event_registrations SET attended_at = now()
 WHERE id = 'd4700000-0000-0000-0000-0000000007a1';
UPDATE public.event_registrations SET attended_at = now() + interval '5 minutes'
 WHERE id = 'd4700000-0000-0000-0000-0000000007a1';
UPDATE public.event_registrations SET directory_opt_out = true
 WHERE id = 'd4700000-0000-0000-0000-0000000007a1';
SELECT is(pg_temp.att('d4700000-0000-0000-0000-0000000007a1'), 1,
  'obecność: jedno zdarzenie mimo poprawki znacznika i zmiany innej kolumny');
SELECT is(
  (SELECT (payload ->> 'event_id') || '|' || (payload ->> 'person_id') || '|' || COALESCE(actor_id::text, '-')
     || '|' || (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(payload) k)
     FROM public.domain_events
    WHERE event_type = 'event.registration.attended.v1'
      AND aggregate_id = 'd4700000-0000-0000-0000-0000000007a1'),
  'd4700000-0000-0000-0000-0000000000e3|d4700000-0000-0000-0000-0000000006a1|-|event_id,person_id,registration_id',
  'obecność: payload {event_id, registration_id, person_id} bez PII, aktor wytłumiony');

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode, payment_status, source, attended_at) VALUES
  ('d4700000-0000-0000-0000-0000000007a2', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e3',
   'd4700000-0000-0000-0000-0000000006a2', 'attended', 'rsvp', 'not_required', 'scan', now());
SELECT is(pg_temp.att('d4700000-0000-0000-0000-0000000007a2'), 1,
  'obecność: wejście z bramki (INSERT od razu obecny) emituje raz');

-- ── 3. Fikstura pieniędzy E1 ────────────────────────────────────────────────
SET LOCAL session_replication_role = replica;

INSERT INTO public.event_ad_campaigns (id, tenant_id, event_id, match_kind, match_value, label) VALUES
  ('d4700000-0000-0000-0000-0000000008c1', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'utm_campaign', 'wiosna', 'Wiosna'),
  ('d4700000-0000-0000-0000-0000000008c2', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'google_ads_campaign_id', '777', 'PMax 777');
INSERT INTO public.event_ad_campaign_costs (tenant_id, event_id, campaign_id, day, cost_micros, currency) VALUES
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-0000000008c1',
   (now() AT TIME ZONE 'Europe/Warsaw')::date, 12500000, 'PLN'),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-0000000008c2',
   (now() AT TIME ZONE 'Europe/Warsaw')::date - 20, 3000000, 'PLN');

INSERT INTO public.event_funnel_events (tenant_id, event_id, step, visitor_key, session_key, occurred_at, source, medium, utm_campaign, gad_campaign_id) VALUES
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'visit', 'visitor-0001', 'session-0001', now() - interval '2 hours', 'google', 'cpc', 'wiosna', NULL),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'registration_start', 'visitor-0001', 'session-0001', now() - interval '2 hours', 'google', 'cpc', 'wiosna', NULL),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'checkout_start', 'visitor-0001', 'session-0001', now() - interval '2 hours', 'google', 'cpc', 'wiosna', NULL),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'visit', 'visitor-0002', 'session-0002', now() - interval '3 hours', 'google', 'cpc', NULL, '777'),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'visit', 'visitor-0003', 'session-0003', now() - interval '12 days', '(direct)', '(none)', NULL, NULL),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'visit', 'visitor-0004', 'session-0004', now() - interval '1 hour', 'facebook', 'paid', 'Jesien', NULL);

-- b1 opłacone; b2 częściowy zwrot Stripe; b7 grupa (prowadzący + gość bez
-- własnego zamówienia); b4 gość z własnym zamówieniem (EUR); b5 zwrot
-- ręczny (zgłoszenie refunded, zamówienie paid); b6 zgłoszenie sprzed okna;
-- b8 zwrot Stripe całości (zamówienie refunded, netto 0).
INSERT INTO public.payment_orders (id, tenant_id, kind, status, amount_cents, currency, refunded_amount_cents, paid_at) VALUES
  ('d4700000-0000-0000-0000-0000000009b1', 'd4700000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 49900, 'PLN', 0, now()),
  ('d4700000-0000-0000-0000-0000000009b2', 'd4700000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 30000, 'PLN', 10000, now()),
  ('d4700000-0000-0000-0000-0000000009b7', 'd4700000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 40000, 'PLN', 0, now()),
  ('d4700000-0000-0000-0000-0000000009b4', 'd4700000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 15000, 'EUR', 0, now()),
  ('d4700000-0000-0000-0000-0000000009b5', 'd4700000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 10000, 'PLN', 0, now()),
  ('d4700000-0000-0000-0000-0000000009b6', 'd4700000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 5000, 'PLN', 0, now() - interval '10 days'),
  ('d4700000-0000-0000-0000-0000000009b8', 'd4700000-0000-0000-0000-0000000000a0', 'one_time', 'refunded', 20000, 'PLN', 20000, now());

-- Zgłoszenia E1 (kohorta po created_at): c003 prowadzi grupę (c004 na
-- zamówieniu prowadzącego, c005 z własnym), c006 zwrot ręczny, c007 bez
-- płatności, c008 sprzed okna, c009 bilet z puli planu (bez zamówienia),
-- c00a miejsce z pakietu, c00b zwrot Stripe całości. Osoby bez wierszy
-- `event_people` (tryb replica pomija FK; odczyt pieniędzy ich nie czyta).
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status, payment_order_id,
   group_lead_registration_id, source, created_at)
VALUES
  ('d4700000-0000-0000-0000-00000000c001', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c001', 'approved', 'form', 'paid', 'd4700000-0000-0000-0000-0000000009b1', NULL, 'self_registration', now() - interval '1 hour'),
  ('d4700000-0000-0000-0000-00000000c002', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c002', 'approved', 'form', 'partially_refunded', 'd4700000-0000-0000-0000-0000000009b2', NULL, 'self_registration', now() - interval '2 hours'),
  ('d4700000-0000-0000-0000-00000000c003', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c003', 'approved', 'form', 'paid', 'd4700000-0000-0000-0000-0000000009b7', NULL, 'self_registration', now() - interval '3 hours'),
  ('d4700000-0000-0000-0000-00000000c004', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c004', 'approved', 'form', 'paid', 'd4700000-0000-0000-0000-0000000009b7', 'd4700000-0000-0000-0000-00000000c003', 'self_registration', now() - interval '3 hours'),
  ('d4700000-0000-0000-0000-00000000c005', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c005', 'approved', 'form', 'paid', 'd4700000-0000-0000-0000-0000000009b4', 'd4700000-0000-0000-0000-00000000c003', 'self_registration', now() - interval '3 hours'),
  ('d4700000-0000-0000-0000-00000000c006', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c006', 'approved', 'form', 'refunded', 'd4700000-0000-0000-0000-0000000009b5', NULL, 'self_registration', now() - interval '4 hours'),
  ('d4700000-0000-0000-0000-00000000c007', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c007', 'approved', 'form', 'not_required', NULL, NULL, 'self_registration', now() - interval '5 hours'),
  ('d4700000-0000-0000-0000-00000000c008', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c008', 'approved', 'form', 'paid', 'd4700000-0000-0000-0000-0000000009b6', NULL, 'self_registration', now() - interval '10 days'),
  ('d4700000-0000-0000-0000-00000000c009', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c009', 'approved', 'form', 'paid', NULL, NULL, 'self_registration', now() - interval '6 hours'),
  ('d4700000-0000-0000-0000-00000000c00a', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c00a', 'approved', 'form', 'not_required', NULL, NULL, 'package_invitation', now() - interval '20 minutes'),
  ('d4700000-0000-0000-0000-00000000c00b', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', 'd4700000-0000-0000-0000-00000006c00b', 'approved', 'form', 'partially_refunded', 'd4700000-0000-0000-0000-0000000009b8', NULL, 'self_registration', now() - interval '7 hours');


INSERT INTO public.event_registration_attributions (tenant_id, registration_id, event_id, source, medium, utm_campaign, gad_campaign_id) VALUES
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-00000000c001', 'd4700000-0000-0000-0000-0000000000e1', 'google', 'cpc', 'wiosna', NULL),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-00000000c002', 'd4700000-0000-0000-0000-0000000000e1', 'google', 'cpc', NULL, '777'),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-00000000c008', 'd4700000-0000-0000-0000-0000000000e1', 'facebook', 'paid', 'Jesien', NULL),
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-00000000c009', 'd4700000-0000-0000-0000-0000000000e1', 'newsletter', 'email', 'wiosna', NULL);

INSERT INTO public.plan_ticket_claims (tenant_id, user_id, event_id, tier_key, period_start, period_end, registration_id) VALUES
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-00000000a001', 'd4700000-0000-0000-0000-0000000000e1',
   'pro', current_date, current_date + 30, 'd4700000-0000-0000-0000-00000000c009');

-- Pakiety: e001 opłacony (z atrybucją), e002 oczekujący.
INSERT INTO public.event_package_orders (id, tenant_id, event_id, package_id, buyer_email, seats_total, status, amount_cents, currency, created_at, paid_at) VALUES
  ('d4700000-0000-0000-0000-00000000e001', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1',
   'd4700000-0000-0000-0000-00000000f001', 'firma@hub-s4-evt.test', 5, 'paid', 100000, 'PLN', now() - interval '30 minutes', now() - interval '29 minutes'),
  ('d4700000-0000-0000-0000-00000000e002', 'd4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1',
   'd4700000-0000-0000-0000-00000000f001', 'firma2@hub-s4-evt.test', 3, 'pending', 50000, 'PLN', now() - interval '40 minutes', NULL);
INSERT INTO public.event_package_order_attributions (tenant_id, package_order_id, event_id, source, medium, utm_campaign) VALUES
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-00000000e001', 'd4700000-0000-0000-0000-0000000000e1', 'google', 'cpc', 'wiosna');
INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id, registration_id, assigned_at) VALUES
  ('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1',
   'd4700000-0000-0000-0000-00000000e001', 'd4700000-0000-0000-0000-00000000c00a', now());

SET LOCAL session_replication_role = origin;

-- ── 4. _event_revenue_net ───────────────────────────────────────────────────

SELECT is(
  (SELECT count(*) || '|' || sum(net_minor) FILTER (WHERE currency = 'PLN') || '|' || sum(net_minor) FILTER (WHERE currency = 'EUR')
     FROM public._event_revenue_net('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', NULL, NULL)),
  '7|214900|15000',
  'przychód netto: 7 zamówień (grupa bez dublowania), zwrot Stripe odjęty, ręczny zwrot, pula planu i pakiet nieopłacony poza');
SELECT is(
  (SELECT string_agg(kind || ':' || right(conv_id::text, 4) || ':' || right(order_id::text, 4) || ':' || net_minor, ',' ORDER BY order_id)
     FROM public._event_revenue_net('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1', NULL, NULL)),
  'reg:c001:09b1:49900,reg:c002:09b2:20000,reg:c003:09b4:15000,reg:c008:09b6:5000,reg:c003:09b7:40000,reg:c00b:09b8:0,pkg:e001:e001:100000',
  'przychód netto: wiersz na zamówienie, gość z własnym zamówieniem przy prowadzącym');
SELECT is(
  (SELECT count(*) || '|' || sum(net_minor) FILTER (WHERE currency = 'PLN')
     FROM public._event_revenue_net('d4700000-0000-0000-0000-0000000000a0', 'd4700000-0000-0000-0000-0000000000e1',
                                    now() - interval '7 days', now() + interval '1 day')),
  '6|209900', 'przychód netto: kohorta po dacie zgłoszenia (c008 sprzed okna poza)');

-- ── 5. Lejek reklam bit w bit ───────────────────────────────────────────────
-- Kopia ciała z 20260927001100 (jedyna zmiana: nazwa funkcji).
CREATE FUNCTION pg_temp.hub_s4_funnel_old(
  p_event_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
  v_from_day date;
  v_to_day date;
  v_out jsonb;
BEGIN
  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.id = p_event_id AND e.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to THEN
    RAISE EXCEPTION 'invalid_window: from must be earlier than to';
  END IF;
  v_tz := CASE
    WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN v_tz
    ELSE 'Europe/Warsaw'
  END;
  v_from_day := (p_from AT TIME ZONE v_tz)::date;
  v_to_day := ((p_to - interval '1 microsecond') AT TIME ZONE v_tz)::date;

  WITH camps AS (
    SELECT c.id, c.label, c.match_kind, c.match_value
      FROM public.event_ad_campaigns c
     WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
  ),
  -- Zgloszenia prowadzacych z kohorty. Oplacone: status platnosci i - przy
  -- aktywnym bilecie z puli planu - zamowienie z karty (sama pula nie jest
  -- zakupem).
  leads AS (
    SELECT r.id, r.payment_status, r.payment_order_id,
           a.registration_id IS NOT NULL AS attributed,
           a.source, a.medium, a.utm_campaign, a.gad_campaign_id,
           (r.payment_status IN ('paid', 'partially_refunded')
            AND (o.id IS NOT NULL OR NOT EXISTS (
              SELECT 1 FROM public.plan_ticket_claims c
               WHERE c.tenant_id = r.tenant_id AND c.registration_id = r.id
                 AND c.released_at IS NULL
            ))) AS paid
      FROM public.event_registrations r
      LEFT JOIN public.event_registration_attributions a
        ON a.tenant_id = r.tenant_id AND a.registration_id = r.id
      LEFT JOIN public.payment_orders o
        ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
       AND o.status::text IN ('paid', 'refunded')
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND r.source IS DISTINCT FROM 'package_invitation'
       AND NOT EXISTS (
         SELECT 1 FROM public.event_package_seats s
          WHERE s.tenant_id = r.tenant_id AND s.registration_id = r.id
       )
       AND (p_from IS NULL OR r.created_at >= p_from)
       AND (p_to IS NULL OR r.created_at < p_to)
  ),
  pkgs AS (
    SELECT po.id, po.status = 'paid' AS paid, po.currency, po.amount_cents,
           pa.package_order_id IS NOT NULL AS attributed,
           pa.source, pa.medium, pa.utm_campaign, pa.gad_campaign_id
      FROM public.event_package_orders po
      LEFT JOIN public.event_package_order_attributions pa
        ON pa.tenant_id = po.tenant_id AND pa.package_order_id = po.id
     WHERE po.tenant_id = v_tenant AND po.event_id = p_event_id
       AND (p_from IS NULL OR po.created_at >= p_from)
       AND (p_to IS NULL OR po.created_at < p_to)
  ),
  convs AS (
    SELECT 'reg'::text AS kind, l.id, l.paid, l.attributed,
           l.source, l.medium, l.utm_campaign, l.gad_campaign_id
      FROM leads l
    UNION ALL
    SELECT 'pkg', p.id, p.paid, p.attributed, p.source, p.medium, p.utm_campaign, p.gad_campaign_id
      FROM pkgs p
  ),
  -- Zamowienia z karty prowadzacego i jego gosci (gosc z WLASNYM zamowieniem,
  -- innym niz zamowienie prowadzacego). Zamowienie liczy sie tylko zaplacone
  -- (albo zwrocone przez Stripe - kwota minus zwroty) i tylko dla zgloszenia
  -- `paid`/`partially_refunded`: zwrot reczny z panelu zostawia zamowienie
  -- `paid` ze zwrotem 0, a zgloszenie `refunded`.
  lead_orders AS (
    SELECT l.id AS conv_id, o.id AS order_id, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net
      FROM leads l
      JOIN public.payment_orders o ON o.id = l.payment_order_id AND o.tenant_id = v_tenant
     WHERE l.payment_status IN ('paid', 'partially_refunded')
       AND o.status::text IN ('paid', 'refunded')
    UNION ALL
    SELECT l.id, o.id, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint
      FROM leads l
      JOIN public.event_registrations g
        ON g.tenant_id = v_tenant AND g.group_lead_registration_id = l.id
      JOIN public.payment_orders o ON o.id = g.payment_order_id AND o.tenant_id = v_tenant
     WHERE g.payment_status IN ('paid', 'partially_refunded')
       AND o.status::text IN ('paid', 'refunded')
       AND g.payment_order_id IS DISTINCT FROM l.payment_order_id
  ),
  rev AS (
    SELECT DISTINCT ON (x.order_id) x.kind, x.conv_id, x.currency, x.net
      FROM (
        SELECT 'reg'::text AS kind, lo.conv_id, lo.order_id, lo.currency, lo.net
          FROM lead_orders lo
        UNION ALL
        SELECT 'pkg', p.id, p.id, p.currency, p.amount_cents::bigint
          FROM pkgs p WHERE p.paid
      ) x
     ORDER BY x.order_id, x.conv_id
  ),
  touches AS (
    SELECT 'step'::text AS kind, f.step, f.visitor_key, NULL::uuid AS conv_id, false AS paid,
           f.source, f.medium, f.utm_campaign, f.gad_campaign_id
      FROM public.event_funnel_events f
     WHERE f.tenant_id = v_tenant AND f.event_id = p_event_id
       AND (p_from IS NULL OR f.occurred_at >= p_from)
       AND (p_to IS NULL OR f.occurred_at < p_to)
    UNION ALL
    SELECT c.kind, NULL, NULL, c.id, c.paid, c.source, c.medium, c.utm_campaign, c.gad_campaign_id
      FROM convs c
     WHERE c.attributed
  ),
  raw_keyed AS (
    SELECT t.*,
           CASE
             WHEN m.id IS NOT NULL THEN 'campaign:' || m.id::text
             WHEN t.utm_campaign IS NOT NULL THEN 'utm:' || lower(t.utm_campaign)
             WHEN t.gad_campaign_id IS NOT NULL THEN 'gad:' || t.gad_campaign_id
             ELSE 'none'
           END AS raw_key
      FROM touches t
      LEFT JOIN LATERAL (
        SELECT c.id
          FROM camps c
         WHERE (c.match_kind = 'google_ads_campaign_id' AND c.match_value = t.gad_campaign_id)
            OR (c.match_kind = 'utm_campaign' AND c.match_value = lower(t.utm_campaign))
         ORDER BY (c.match_kind = 'google_ads_campaign_id') DESC, c.id
         LIMIT 1
      ) m ON true
  ),
  -- Limit grup niezmapowanych: wartosci przychodza z publicznego beaconu.
  ranked AS (
    SELECT k.raw_key,
           row_number() OVER (
             ORDER BY count(*) FILTER (WHERE k.kind <> 'step') DESC,
                      count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') DESC,
                      k.raw_key
           ) AS rn
      FROM raw_keyed k
     WHERE k.raw_key LIKE 'utm:%' OR k.raw_key LIKE 'gad:%'
     GROUP BY k.raw_key
  ),
  keyed AS (
    SELECT k.*, CASE WHEN r.rn > 50 THEN 'other' ELSE k.raw_key END AS group_key
      FROM raw_keyed k
      LEFT JOIN ranked r ON r.raw_key = k.raw_key
  ),
  grp AS (
    SELECT k.group_key,
           CASE WHEN k.group_key = 'other' THEN NULL ELSE min(k.utm_campaign) END AS utm_campaign,
           CASE WHEN k.group_key = 'other' THEN NULL ELSE min(k.gad_campaign_id) END AS gad_campaign_id,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') AS visits,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'registration_start') AS starts,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'checkout_start') AS checkouts,
           count(*) FILTER (WHERE k.kind <> 'step') AS registrations,
           count(*) FILTER (WHERE k.kind <> 'step' AND k.paid) AS paid
      FROM keyed k
     GROUP BY k.group_key
  ),
  chan AS (
    SELECT k.group_key, k.source, k.medium,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') AS visits,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'registration_start') AS starts,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'checkout_start') AS checkouts,
           count(*) FILTER (WHERE k.kind <> 'step') AS registrations,
           count(*) FILTER (WHERE k.kind <> 'step' AND k.paid) AS paid
      FROM keyed k
     GROUP BY k.group_key, k.source, k.medium
  ),
  keyed_rev AS (
    SELECT k.group_key, k.source, k.medium, r.currency, r.net
      FROM rev r
      JOIN keyed k ON k.kind = r.kind AND k.conv_id = r.conv_id
  ),
  grp_rev AS (
    SELECT x.group_key,
           jsonb_agg(jsonb_build_object('currency', x.currency, 'cents', x.cents)
                     ORDER BY x.currency) AS revenue
      FROM (
        SELECT kr.group_key, kr.currency, sum(kr.net)::bigint AS cents
          FROM keyed_rev kr
         GROUP BY kr.group_key, kr.currency
      ) x
     GROUP BY x.group_key
  ),
  chan_rev AS (
    SELECT x.group_key, x.source, x.medium,
           jsonb_agg(jsonb_build_object('currency', x.currency, 'cents', x.cents)
                     ORDER BY x.currency) AS revenue
      FROM (
        SELECT kr.group_key, kr.source, kr.medium, kr.currency, sum(kr.net)::bigint AS cents
          FROM keyed_rev kr
         GROUP BY kr.group_key, kr.source, kr.medium, kr.currency
      ) x
     GROUP BY x.group_key, x.source, x.medium
  ),
  chan_json AS (
    SELECT ch.group_key,
           jsonb_agg(jsonb_build_object(
             'source', ch.source,
             'medium', ch.medium,
             'visits', ch.visits,
             'registration_starts', ch.starts,
             'checkout_starts', ch.checkouts,
             'registrations', ch.registrations,
             'paid', ch.paid,
             'revenue', COALESCE(cr.revenue, '[]'::jsonb)
           ) ORDER BY ch.visits DESC, ch.registrations DESC, ch.source, ch.medium) AS channels
      FROM chan ch
      LEFT JOIN chan_rev cr
        ON cr.group_key = ch.group_key AND cr.source = ch.source AND cr.medium = ch.medium
     GROUP BY ch.group_key
  ),
  cost AS (
    SELECT k.campaign_id, k.currency, sum(k.cost_micros)::bigint AS micros
      FROM public.event_ad_campaign_costs k
     WHERE k.tenant_id = v_tenant AND k.event_id = p_event_id
       AND (v_from_day IS NULL OR k.day >= v_from_day)
       AND (v_to_day IS NULL OR k.day <= v_to_day)
     GROUP BY k.campaign_id, k.currency
  ),
  cost_json AS (
    SELECT 'campaign:' || co.campaign_id::text AS group_key,
           jsonb_agg(jsonb_build_object('currency', co.currency, 'micros', co.micros)
                     ORDER BY co.currency) AS cost
      FROM cost co
     GROUP BY co.campaign_id
  ),
  group_keys AS (
    SELECT g.group_key FROM grp g
    UNION
    SELECT cj.group_key FROM cost_json cj
  ),
  unattr AS (
    SELECT c.kind, c.id, c.paid FROM convs c WHERE NOT c.attributed
  ),
  unattr_rev AS (
    SELECT r.currency, r.net
      FROM rev r
      JOIN unattr u ON u.kind = r.kind AND u.id = r.conv_id
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', gk.group_key,
               'kind', CASE
                 WHEN gk.group_key LIKE 'campaign:%' THEN 'campaign'
                 WHEN gk.group_key LIKE 'utm:%' THEN 'utm_campaign'
                 WHEN gk.group_key LIKE 'gad:%' THEN 'gad_campaign'
                 WHEN gk.group_key = 'other' THEN 'other'
                 ELSE 'none'
               END,
               'campaign_id', c.id,
               'label', c.label,
               'match_kind', c.match_kind,
               'match_value', c.match_value,
               'utm_campaign', g.utm_campaign,
               'gad_campaign_id', g.gad_campaign_id,
               'visits', COALESCE(g.visits, 0),
               'registration_starts', COALESCE(g.starts, 0),
               'checkout_starts', COALESCE(g.checkouts, 0),
               'registrations', COALESCE(g.registrations, 0),
               'paid', COALESCE(g.paid, 0),
               'revenue', COALESCE(gr.revenue, '[]'::jsonb),
               'cost', COALESCE(cj.cost, '[]'::jsonb),
               'channels', COALESCE(chj.channels, '[]'::jsonb)
             ) ORDER BY
               CASE
                 WHEN gk.group_key LIKE 'campaign:%' THEN 0
                 WHEN gk.group_key LIKE 'utm:%' THEN 1
                 WHEN gk.group_key LIKE 'gad:%' THEN 2
                 WHEN gk.group_key = 'other' THEN 3
                 ELSE 4
               END,
               lower(COALESCE(c.label, g.utm_campaign, g.gad_campaign_id, '')),
               gk.group_key)
        FROM group_keys gk
        LEFT JOIN grp g ON g.group_key = gk.group_key
        LEFT JOIN camps c ON 'campaign:' || c.id::text = gk.group_key
        LEFT JOIN grp_rev gr ON gr.group_key = gk.group_key
        LEFT JOIN cost_json cj ON cj.group_key = gk.group_key
        LEFT JOIN chan_json chj ON chj.group_key = gk.group_key
    ), '[]'::jsonb),
    'groups_folded', (SELECT count(*) FROM ranked r WHERE r.rn > 50),
    'unattributed', jsonb_build_object(
      'registrations', (SELECT count(*) FROM unattr),
      'paid', (SELECT count(*) FROM unattr u WHERE u.paid),
      'revenue', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', z.currency, 'cents', z.cents) ORDER BY z.currency)
          FROM (SELECT ur.currency, sum(ur.net)::bigint AS cents FROM unattr_rev ur GROUP BY ur.currency) z
      ), '[]'::jsonb)
    ),
    'totals', jsonb_build_object(
      'visits', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'visit'),
      'registration_starts', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'registration_start'),
      'checkout_starts', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'checkout_start'),
      'attributed_registrations', (SELECT count(*) FROM convs c WHERE c.attributed),
      'registrations', (SELECT count(*) FROM convs),
      'paid', (SELECT count(*) FROM convs c WHERE c.paid),
      'revenue', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', w.currency, 'cents', w.cents) ORDER BY w.currency)
          FROM (SELECT r.currency, sum(r.net)::bigint AS cents FROM rev r GROUP BY r.currency) w
      ), '[]'::jsonb),
      'cost', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', q.currency, 'micros', q.micros) ORDER BY q.currency)
          FROM (SELECT co.currency, sum(co.micros)::bigint AS micros FROM cost co GROUP BY co.currency) q
      ), '[]'::jsonb)
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'd4700000-0000-0000-0000-00000000a001', 'role', 'authenticated')::text, true);

SELECT is(
  public.admin_event_ads_funnel('d4700000-0000-0000-0000-0000000000e1') -> 'totals' -> 'revenue',
  '[{"cents": 15000, "currency": "EUR"}, {"cents": 214900, "currency": "PLN"}]'::jsonb,
  'lejek: przychód sum z fikstury (sprawdzian, że porównanie nie jest puste)');
SELECT is(
  public.admin_event_ads_funnel('d4700000-0000-0000-0000-0000000000e1'),
  pg_temp.hub_s4_funnel_old('d4700000-0000-0000-0000-0000000000e1'),
  'lejek: bez okna wynik identyczny z ciałem sprzed zmiany');
SELECT is(
  public.admin_event_ads_funnel('d4700000-0000-0000-0000-0000000000e1', now() - interval '7 days', now() + interval '1 day'),
  pg_temp.hub_s4_funnel_old('d4700000-0000-0000-0000-0000000000e1', now() - interval '7 days', now() + interval '1 day'),
  'lejek: w oknie wynik identyczny z ciałem sprzed zmiany (koszty po dniach, kohorta)');
SELECT is(
  public.admin_event_ads_funnel('d4700000-0000-0000-0000-0000000000e2'),
  pg_temp.hub_s4_funnel_old('d4700000-0000-0000-0000-0000000000e2'),
  'lejek: wydarzenie bez danych identyczne');
SELECT ok(
  (SELECT prosrc LIKE '%public._event_revenue_net(v_tenant, p_event_id, p_from, p_to)%'
          AND prosrc NOT LIKE '%lead_orders AS%'
     FROM pg_proc WHERE oid = 'public.admin_event_ads_funnel(uuid,timestamptz,timestamptz)'::regprocedure),
  'lejek: przychód z jednego źródła (_event_revenue_net), bez własnej kopii reguły');

SELECT * FROM finish();
ROLLBACK;
