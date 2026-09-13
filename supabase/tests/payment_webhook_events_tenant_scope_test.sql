-- pgTAP: zakres najemcy w dzienniku webhookow platnosci
-- (migracja 20260913100000_payment_webhook_events_tenant_binding).
--
-- CO BYLO ZLE. Dwie warstwy naraz, psujace sie nawzajem:
--   (1) trigger wiazacy najemce rozstrzygal go JEDNYM strzalem - profilem po
--       `user_id`. A `user_id` jest znany wylacznie dla zdarzen z checkoutu,
--       wiec subskrypcje, faktury, zwroty i wiersze z uzgadniania ladowaly w
--       najemcy DOMYSLNYM na stale (trigger byl `UPDATE OF user_id`, wiec
--       domkniecie wiersza nie mialo szansy go przewiazac);
--   (2) `admin_payment_webhook_health` bramkowala sama role, a liczyla po CALEJ
--       tabeli - `recent_failures` oddawalo do przegladarki `id`, `event_type` i
--       tresc bledu zdarzen KAZDEGO innego obszaru roboczego.
--
-- JAKIE TO BYLO RYZYKO. Identyfikatory z (2) byly gotowym wejsciem dla server fn
-- czytajacych wiersz po samym `id` - czyli do surowego ladunku operatora
-- platnosci (e-mail platnika, adres, kwoty) i do ODTWORZENIA cudzego zdarzenia
-- rozliczeniowego. Tabela nie miala do tej pory ZADNEGO pokrycia pgTAP.
--
-- JAK NAPRAWIONE. Kaskada nosnikow tozsamosci w
-- `public.payment_webhook_event_tenant` (profil -> subskrypcja -> zamowienie ->
-- e-mail z ladunku) uzywana i przez trigger, i przez backfill; RPC zdrowia
-- liczy wylacznie w granicach `current_tenant_id()`.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa obszary robocze obok istniejacego najemcy domyslnego ──────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-1111111111a1', 'whk-a', 'Webhook Tenant A'),
  ('b2222222-2222-2222-2222-2222222222b2', 'whk-b', 'Webhook Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'super-a@whk.test'),
  ('a0000000-0000-0000-0000-0000000000a2', 'payer-a@whk.test'),
  ('b0000000-0000-0000-0000-0000000000b1', 'payer-b@whk.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'super-a@whk.test', 'Super A',
   'a1111111-1111-1111-1111-1111111111a1'),
  ('a0000000-0000-0000-0000-0000000000a2', 'payer-a@whk.test', 'Payer A',
   'a1111111-1111-1111-1111-1111111111a1'),
  ('b0000000-0000-0000-0000-0000000000b1', 'payer-b@whk.test', 'Payer B',
   'b2222222-2222-2222-2222-2222222222b2');

-- Super admin WYLACZNIE w tenancie A. `has_role`, `is_super_admin` oraz
-- `current_tenant_id` czytaja te sama plaszczyzne (profil wolajacego), wiec to
-- jest dokladnie ten aktor, ktoremu poprawka ma odebrac wglad w tenanta B.
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'super_admin',
   'a1111111-1111-1111-1111-1111111111a1');

-- Nosniki tozsamosci po stronie naszej bazy: po jednej subskrypcji na obszar.
INSERT INTO public.subscriptions
  (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
   product_id, price_id, status, environment)
VALUES
  ('a5000000-0000-0000-0000-0000000000a5', 'a1111111-1111-1111-1111-1111111111a1',
   'a0000000-0000-0000-0000-0000000000a2', 'sub_a', 'cus_a', 'prod_a', 'price_a',
   'active', 'live'),
  ('b5000000-0000-0000-0000-0000000000b5', 'b2222222-2222-2222-2222-2222222222b2',
   'b0000000-0000-0000-0000-0000000000b1', 'sub_b', 'cus_b', 'prod_b', 'price_b',
   'active', 'live');

-- ════════════════════════════════════════════════════════════════════════════
-- WARSTWA 0: kaskada wiazania najemcy (trigger)
-- ════════════════════════════════════════════════════════════════════════════

-- (a) Najmocniejszy nosnik: profil platnika wskazany wprost.
INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, user_id, status, occurred_at)
VALUES ('e0000000-0000-0000-0000-00000000a001', 'evt_user_a',
        'checkout.session.completed', 'live',
        'a0000000-0000-0000-0000-0000000000a2', 'processed', now());

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000a001'),
  'a1111111-1111-1111-1111-1111111111a1'::uuid,
  'trigger: zdarzenie z user_id platnika laduje w jego obszarze roboczym'
);

-- (b) Bez `user_id` - subskrypcja operatora. Tak wyglada KAZDE zdarzenie
-- `customer.subscription.*`, ktore do tej pory lecialo do puli domyslnej.
INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, subscription_id, status, occurred_at)
VALUES ('e0000000-0000-0000-0000-00000000b001', 'evt_sub_b',
        'customer.subscription.updated', 'live', 'sub_b', 'processed', now());

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000b001'),
  'b2222222-2222-2222-2222-2222222222b2'::uuid,
  'trigger: zdarzenie bez user_id wiaze sie po identyfikatorze subskrypcji'
);

-- (c) Bez `user_id` i bez subskrypcji - sam klient operatora (`invoice.*`).
INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, customer_id, status, occurred_at)
VALUES ('e0000000-0000-0000-0000-00000000a002', 'evt_cus_a',
        'invoice.payment_succeeded', 'live', 'cus_a', 'processed', now());

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000a002'),
  'a1111111-1111-1111-1111-1111111111a1'::uuid,
  'trigger: zdarzenie bez user_id wiaze sie po identyfikatorze klienta'
);

-- (d) Ten sam identyfikator w innym srodowisku NIE moze wiazac. Pomylka
-- piaskownica/produkcja jest tu tym samym bledem co pomylka miedzy najemcami.
INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, subscription_id, status, occurred_at)
VALUES ('e0000000-0000-0000-0000-00000000c001', 'evt_sub_b',
        'customer.subscription.updated', 'sandbox', 'sub_b', 'processed', now());

SELECT isnt(
  (SELECT tenant_id FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000c001'),
  'b2222222-2222-2222-2222-2222222222b2'::uuid,
  'trigger: identyfikator subskrypcji z produkcji nie wiaze zdarzenia z piaskownicy'
);

-- (e) Zaden nosnik nie rozstrzyga - wiersz zostaje w najemcy domyslnym.
-- To jest SWIADOMA pozostalosc, opisana w migracji, a nie luka w kaskadzie.
INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, status, occurred_at)
VALUES ('e0000000-0000-0000-0000-00000000d001', 'evt_orphan',
        'price.updated', 'live', 'processed', now());

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000d001'),
  public.email_default_tenant_id(),
  'trigger: zdarzenie bez zadnego nosnika tozsamosci zostaje w najemcy domyslnym'
);

-- (f) Domkniecie wiersza dopisujace `subscription_id` MUSI przewiazac. Stary
-- trigger byl `UPDATE OF user_id`, wiec ta sciezka nie dzialala nigdy.
UPDATE public.payment_webhook_events
   SET subscription_id = 'sub_b', status = 'processed'
 WHERE id = 'e0000000-0000-0000-0000-00000000d001';

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000d001'),
  'b2222222-2222-2222-2222-2222222222b2'::uuid,
  'trigger: UPDATE dopisujacy subscription_id przewiazuje wiersz z puli domyslnej'
);

-- (g) To samo dla `user_id` - najmocniejszy nosnik wygrywa nad slabszym.
UPDATE public.payment_webhook_events
   SET user_id = 'a0000000-0000-0000-0000-0000000000a2'
 WHERE id = 'e0000000-0000-0000-0000-00000000d001';

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000d001'),
  'a1111111-1111-1111-1111-1111111111a1'::uuid,
  'trigger: UPDATE dopisujacy user_id przewiazuje wiersz do obszaru platnika'
);

-- ════════════════════════════════════════════════════════════════════════════
-- WARSTWA 3: admin_payment_webhook_health liczy w granicach najemcy
-- ════════════════════════════════════════════════════════════════════════════

-- Po jednej AWARII na obszar - to one trafiaja do `recent_failures`.
INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, user_id, status, error, occurred_at)
VALUES
  ('e0000000-0000-0000-0000-00000000a003', 'evt_fail_a', 'invoice.payment_failed',
   'live', 'a0000000-0000-0000-0000-0000000000a2', 'failed',
   'karta odrzucona (obszar A)', now()),
  ('e0000000-0000-0000-0000-00000000b003', 'evt_fail_b', 'charge.refunded',
   'live', 'b0000000-0000-0000-0000-0000000000b1', 'failed',
   'karta odrzucona (obszar B)', now());

-- Wcielenie: super admin obszaru A.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

CREATE TEMP TABLE whk_health AS
SELECT public.admin_payment_webhook_health('{"environment":"live"}'::jsonb) AS res;

-- REGRESJA PRZYPIETA: zdarzenie obszaru B nie moze pojawic sie na liscie awarii
-- super admina obszaru A - ani jego `id`, ani tresc bledu.
SELECT is(
  (SELECT count(*)::int FROM whk_health h,
     LATERAL jsonb_array_elements(h.res->'recent_failures') AS f
    WHERE f->>'id' = 'e0000000-0000-0000-0000-00000000b003'),
  0,
  'RPC zdrowia: super admin obszaru A nie widzi awarii obszaru B w recent_failures'
);

-- Kontrola pozytywna: wlasna awaria nadal jest widoczna (poprawka nie moze
-- oslepic legalnego operatora - to byl glowny warunek wdrozenia).
SELECT is(
  (SELECT count(*)::int FROM whk_health h,
     LATERAL jsonb_array_elements(h.res->'recent_failures') AS f
    WHERE f->>'id' = 'e0000000-0000-0000-0000-00000000a003'),
  1,
  'RPC zdrowia: wlasna awaria obszaru A nadal jest widoczna'
);

-- Agregat glowny: trzy zdarzenia produkcyjne obszaru A (a001, a002, a003)
-- plus przewiazany d001 - i ani jedno zdarzenie obszaru B.
SELECT is(
  (SELECT (h.res->>'total')::int FROM whk_health h),
  4,
  'RPC zdrowia: total liczy wylacznie zdarzenia obszaru wolajacego'
);

-- Rozbicie po typach nie moze zdradzac, jakie zdarzenia obsluguje obszar B.
SELECT is(
  (SELECT count(*)::int FROM whk_health h,
     LATERAL jsonb_array_elements(h.res->'by_type') AS t
    WHERE t->>'event_type' = 'charge.refunded'),
  0,
  'RPC zdrowia: by_type nie zdradza typu zdarzenia wystepujacego tylko w obszarze B'
);

-- KONTRAKT WYNIKU: panel konsumuje te same klucze, zmienil sie wylacznie zakres.
SELECT is(
  (SELECT array_agg(k ORDER BY k)
     FROM whk_health h, LATERAL jsonb_object_keys(h.res) AS k),
  ARRAY['avg_duration_ms','avg_lag_seconds','by_type','environment','failed',
        'failure_rate','p95_duration_ms','pending','processed','recent_failures',
        'retries','since','skipped','total']::text[],
  'RPC zdrowia: ksztalt wyniku nietkniety - panel dostaje dokladnie te same klucze'
);

-- ════════════════════════════════════════════════════════════════════════════
-- POLITYKA RLS: druga, niezalezna warstwa tej samej granicy
-- ════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000b003'),
  0,
  'polityka RLS: super admin obszaru A nie odczyta wiersza obszaru B'
);

SELECT is(
  (SELECT count(*)::int FROM public.payment_webhook_events
     WHERE id = 'e0000000-0000-0000-0000-00000000a003'),
  1,
  'polityka RLS: super admin obszaru A odczytuje wlasny wiersz'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
