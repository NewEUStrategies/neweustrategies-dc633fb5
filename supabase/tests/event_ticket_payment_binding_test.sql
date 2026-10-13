-- pgTAP: wplata za bilet rozlicza WYLACZNIE zgloszenie, za ktore zaplacono
-- (migracje 20261012130100_event_ticket_payment_binding,
-- 20261012130300_payment_orders_purchase_shape_guard; audyt TIX-01, TIX-02, TIX-05).
--
-- DEFEKT. Kasa doklejala `event_id` i `registration_id` do zamowienia
-- wycenionego inna sciezka (artykul, plan), a webhook dopasowywal zgloszenie po
-- `id AND tenant AND event` - bez wlasciciela i bez kwoty. Zamowienie innego
-- konta rozliczalo cudze zgloszenie VIP jako oplacone, z kodem QR, a zwrot
-- tego zamowienia odwolywal zgloszenie ofiary. Plan miesieczny kupiony
-- „jednorazowo" dawal dostep dozywotni.
--
-- CO PRZYPINA:
--   * zamowienie innego konta nie rozlicza zgloszenia (odmowa, znacznik do
--     przegladu, zwrot w kolejce), a jego zwrot nie odwoluje zgloszenia;
--   * zamowienie wlasciciela z kwota pokrywajaca bilet - rozlicza;
--   * strażnik zapisu zamowienia: plan cykliczny jako zakup jednorazowy,
--     metadane biletu na zamowieniu planu/tresci i wskazanie zgloszenia bez
--     biletu - odmowa; zamowienie biletu i plan jednorazowy - zgoda;
--   * funkcje pomocnicze nie sa dostepne dla klienta.
BEGIN;
SELECT plan(15);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b1d00000-0000-0000-0000-0000000000aa', 'tpb-a', 'Payment Binding A', 'tpb-a.example');

INSERT INTO auth.users (id, email) VALUES
  ('b1d00000-0000-0000-0000-0000000000a1', 'tpb-owner@example.org'),
  ('b1d00000-0000-0000-0000-0000000000a2', 'tpb-other@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b1d00000-0000-0000-0000-0000000000a1', 'tpb-owner@example.org', 'TPB Owner', 'b1d00000-0000-0000-0000-0000000000aa'),
  ('b1d00000-0000-0000-0000-0000000000a2', 'tpb-other@example.org', 'TPB Other', 'b1d00000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('b1d10000-0000-0000-0000-0000000000e1', 'b1d00000-0000-0000-0000-0000000000aa',
   'tpb-event', 'TPB', 'TPB', '2030-06-10 08:00+00', 'published');

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency) VALUES
  ('b1d20000-0000-0000-0000-0000000000f1', 'b1d00000-0000-0000-0000-0000000000aa',
   'b1d10000-0000-0000-0000-0000000000e1', 'tpb_vip', 'VIP', 'VIP', 200000, 'PLN');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('b1d30000-0000-0000-0000-000000000001', 'b1d00000-0000-0000-0000-0000000000aa',
   'b1d00000-0000-0000-0000-0000000000a1', 'tpb-owner@example.org', 'Olga', 'Owner');

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status, created_by)
VALUES
  ('b1d40000-0000-0000-0000-000000000001', 'b1d00000-0000-0000-0000-0000000000aa',
   'b1d10000-0000-0000-0000-0000000000e1', 'b1d30000-0000-0000-0000-000000000001',
   'b1d20000-0000-0000-0000-0000000000f1', 'pending', 'form', 'unpaid',
   'b1d00000-0000-0000-0000-0000000000a1');

-- Zamowienia jak po webhooku (rola serwisowa pisze je bez strażnika).
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders
  (id, tenant_id, user_id, kind, status, amount_cents, currency, metadata, provider_intent_id)
VALUES
  ('b1d60000-0000-0000-0000-000000000001', 'b1d00000-0000-0000-0000-0000000000aa',
   'b1d00000-0000-0000-0000-0000000000a2', 'one_time', 'paid', 500, 'PLN',
   jsonb_build_object('event_id', 'b1d10000-0000-0000-0000-0000000000e1',
     'registration_id', 'b1d40000-0000-0000-0000-000000000001',
     'ticket_type_id', 'b1d20000-0000-0000-0000-0000000000f1', 'quantity', 1), 'pi_tpb_other'),
  ('b1d60000-0000-0000-0000-000000000002', 'b1d00000-0000-0000-0000-0000000000aa',
   'b1d00000-0000-0000-0000-0000000000a1', 'one_time', 'paid', 200000, 'PLN',
   jsonb_build_object('event_id', 'b1d10000-0000-0000-0000-0000000000e1',
     'registration_id', 'b1d40000-0000-0000-0000-000000000001',
     'ticket_type_id', 'b1d20000-0000-0000-0000-0000000000f1', 'quantity', 1), 'pi_tpb_owner');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.role', '', true);

-- ── 1-4. Zamowienie innego konta ────────────────────────────────────────────
SELECT is(
  public.payments_apply_event_ticket_outcome('b1d60000-0000-0000-0000-000000000001', 'paid') ->> 'reason',
  'registration_not_owned',
  'zamowienie innego konta nie rozlicza zgloszenia - odmowa registration_not_owned');
SELECT ok(
  (SELECT payment_status = 'unpaid' AND payment_order_id IS NULL AND qr_token_hash IS NULL
     FROM public.event_registrations WHERE id = 'b1d40000-0000-0000-0000-000000000001'),
  'cudze zgloszenie nietkniete: bez wplaty, bez kodu QR');
SELECT ok(
  (SELECT (metadata ->> 'needs_manual_review')::boolean FROM public.payment_orders
    WHERE id = 'b1d60000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM public.event_registration_refund_jobs j
               WHERE j.payment_order_id = 'b1d60000-0000-0000-0000-000000000001'),
  'odmowa = znacznik needs_manual_review i zwrot w kolejce');
SELECT ok(
  (public.payments_apply_event_ticket_outcome('b1d60000-0000-0000-0000-000000000001', 'refunded') ->> 'reason')
    = 'refund_for_other_order'
  AND (SELECT status = 'pending' AND cancelled_at IS NULL FROM public.event_registrations
        WHERE id = 'b1d40000-0000-0000-0000-000000000001'),
  'zwrot zamowienia innego konta NIE odwoluje zgloszenia');

-- ── 5-6. Zamowienie wlasciciela ──────────────────────────────────────────────
-- Dwie instrukcje: podzapytanie w tej samej instrukcji co wywolanie widzi
-- migawke SPRZED zapisu funkcji.
SELECT is(
  public.payments_apply_event_ticket_outcome('b1d60000-0000-0000-0000-000000000002', 'paid') ->> 'registration_status',
  'approved',
  'zamowienie wlasciciela z kwota pokrywajaca bilet - przyjete');
SELECT ok(
  (SELECT payment_status = 'paid' AND payment_order_id = 'b1d60000-0000-0000-0000-000000000002'
          AND qr_token_hash IS NOT NULL
     FROM public.event_registrations WHERE id = 'b1d40000-0000-0000-0000-000000000001'),
  'zamowienie wlasciciela rozlicza zgloszenie (wplata, kod QR)');

-- ── 7-9. Funkcje pomocnicze poza zasiegiem klienta ─────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._event_ticket_order_mismatch(public.payment_orders,public.event_registrations,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public._event_ticket_order_mismatch(public.payment_orders,public.event_registrations,boolean)', 'EXECUTE'),
  '_event_ticket_order_mismatch: bez EXECUTE dla klienta');
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._event_ticket_payment_refused(public.payment_orders,uuid,uuid,text)', 'EXECUTE'),
  '_event_ticket_payment_refused: bez EXECUTE dla klienta');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._event_rsvp_claim_paid_seat(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_rsvp_claim_paid_seat(uuid)', 'EXECUTE'),
  '_event_rsvp_claim_paid_seat: wylacznie service_role (webhook)');

-- ── 10-15. Strażnik zapisu zamowienia (zalogowany kupujacy, RLS) ────────────
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, active) VALUES
  ('b1d70000-0000-0000-0000-000000000001', 'b1d00000-0000-0000-0000-0000000000aa',
   'Miesieczny', 'Monthly', 4900, 'PLN', 'month', true),
  ('b1d70000-0000-0000-0000-000000000002', 'b1d00000-0000-0000-0000-0000000000aa',
   'Dozywotni', 'Lifetime', 49900, 'PLN', 'one_time', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b1d00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_like(
  $$INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents, currency, plan_id)
    VALUES ('b1d00000-0000-0000-0000-0000000000aa', 'b1d00000-0000-0000-0000-0000000000a1',
            'one_time', 'pending', 4900, 'PLN', 'b1d70000-0000-0000-0000-000000000001')$$,
  '%plan_not_one_time%',
  'TIX-02: plan miesieczny jako zakup jednorazowy (dozywotni) - odmowa');
SELECT lives_ok(
  $$INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents, currency, plan_id)
    VALUES ('b1d00000-0000-0000-0000-0000000000aa', 'b1d00000-0000-0000-0000-0000000000a1',
            'one_time', 'pending', 49900, 'PLN', 'b1d70000-0000-0000-0000-000000000002')$$,
  'TIX-02: plan jednorazowy jako zakup jednorazowy - zgoda');
SELECT throws_like(
  $$INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents, currency,
                                      entity_type, entity_id, metadata)
    VALUES ('b1d00000-0000-0000-0000-0000000000aa', 'b1d00000-0000-0000-0000-0000000000a1',
            'one_time', 'pending', 500, 'PLN', 'post', gen_random_uuid(),
            jsonb_build_object('event_id', 'b1d10000-0000-0000-0000-0000000000e1',
                               'registration_id', 'b1d40000-0000-0000-0000-000000000001'))$$,
  '%ticket_order_conflict%',
  'TIX-01: metadane biletu na zamowieniu tresci - odmowa');
SELECT throws_like(
  $$INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, metadata)
    VALUES ('b1d00000-0000-0000-0000-0000000000aa', 'b1d00000-0000-0000-0000-0000000000a1',
            'one_time', 'pending', 49900, 'PLN', 'b1d70000-0000-0000-0000-000000000002',
            jsonb_build_object('event_id', 'b1d10000-0000-0000-0000-0000000000e1'))$$,
  '%ticket_order_conflict%',
  'TIX-01: metadane biletu na zamowieniu planu - odmowa');
SELECT throws_like(
  $$INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents, currency, metadata)
    VALUES ('b1d00000-0000-0000-0000-0000000000aa', 'b1d00000-0000-0000-0000-0000000000a1',
            'one_time', 'pending', 200000, 'PLN',
            jsonb_build_object('event_id', 'b1d10000-0000-0000-0000-0000000000e1',
                               'registration_id', 'b1d40000-0000-0000-0000-000000000001'))$$,
  '%ticket_order_conflict%',
  'TIX-01: wskazanie zgloszenia bez biletu - odmowa');
SELECT lives_ok(
  $$INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents, currency, metadata)
    VALUES ('b1d00000-0000-0000-0000-0000000000aa', 'b1d00000-0000-0000-0000-0000000000a1',
            'one_time', 'pending', 200000, 'PLN',
            jsonb_build_object('event_id', 'b1d10000-0000-0000-0000-0000000000e1',
                               'registration_id', 'b1d40000-0000-0000-0000-000000000001',
                               'ticket_type_id', 'b1d20000-0000-0000-0000-0000000000f1', 'quantity', 1))$$,
  'TIX-01: zamowienie biletu z kompletem wskazan - zgoda');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
