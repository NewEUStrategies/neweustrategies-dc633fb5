-- pgTAP: księga darowizn po audycie SUB-09/SUB-10
-- (migracja 20261012100000_donations_ledger_integrity).
--
-- CO PRZYPINA:
--   1. unikat faktury: ta sama faktura (`invoice.paid` + `invoice.payment_succeeded`)
--      nie zakłada drugiego wiersza raty;
--   2. status wspierającego po zwrocie jest PRZELICZANY z pozostałych wpłat:
--      zwrot ostatniej wpłaty nie odbiera statusu uzasadnionego wcześniejszą,
--      zwrot wcześniejszej skraca przydział, zwrot jedynej - odbiera go;
--   3. ponowiony zapis `paid -> paid` nie przedłuża przydziału o kolejny rok;
--   4. korekta zastanych par sesja/faktura pierwszej raty (oba kierunki
--      kolejności zdarzeń) zostawia JEDEN opłacony wiersz, nie rusza drugiej
--      raty ani par niejednoznacznych i jest idempotentna;
--   5. funkcja korekty jest wyłącznie dla service_role;
--   6. korekta sięga też danych z uzgodnienia w panelu sprzed poprawki:
--      kotwica z PUSTĄ intencją + `renewal:in_...` (para) oraz trójka
--      kotwica + `renewal:in_...` + `renewal:cs_...` - w obu zostaje jeden
--      opłacony wiersz z kluczem faktury (przegląd adwersaryjny, poz. 23);
--   7. przeliczenie statusu wspierającego liczy te same wiersze, które go
--      nadają: korekta testowej pary (`sandbox`) nie skraca ani nie odbiera
--      przydziału uzasadnionego wpłatą `live` (przegląd adwersaryjny, poz. 24).
BEGIN;
SELECT plan(32);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-0000-0000-0000000000d1', 'darczynca-1@ledger.test'),
  ('d1000000-0000-0000-0000-0000000000d2', 'darczynca-2@ledger.test'),
  ('d1000000-0000-0000-0000-0000000000d3', 'darczynca-3@ledger.test'),
  ('d1000000-0000-0000-0000-0000000000d4', 'darczynca-4@ledger.test');

INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, (SELECT id FROM public.tenants WHERE slug = 'nes')
  FROM (VALUES
    ('d1000000-0000-0000-0000-0000000000d1'::uuid),
    ('d1000000-0000-0000-0000-0000000000d2'::uuid),
    ('d1000000-0000-0000-0000-0000000000d3'::uuid),
    ('d1000000-0000-0000-0000-0000000000d4'::uuid)) AS u(id)
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

SELECT public.seed_membership_tiers((SELECT id FROM public.tenants WHERE slug = 'nes'));
UPDATE public.membership_tiers SET active = true
 WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'nes') AND key = 'supporter';

-- ── 1. Unikat faktury ────────────────────────────────────────────────────────
INSERT INTO public.donations
  (tenant_id, amount_cents, currency, provider, provider_session_id,
   provider_invoice_id, environment, recurring, status, paid_at)
VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 5000, 'PLN', 'stripe',
        'renewal:in_ledger_unique', 'in_ledger_unique', 'live', true, 'paid', now());

SELECT throws_ok(
  $$INSERT INTO public.donations
      (tenant_id, amount_cents, currency, provider, provider_session_id,
       provider_invoice_id, environment, recurring, status, paid_at)
    VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 5000, 'PLN', 'stripe',
            'renewal:in_ledger_unique_bis', 'in_ledger_unique', 'live', true, 'paid', now())$$,
  '23505',
  NULL,
  'ta sama faktura w tym samym środowisku nie zakłada drugiego wiersza raty'
);

SELECT lives_ok(
  $$INSERT INTO public.donations
      (tenant_id, amount_cents, currency, provider, provider_session_id,
       provider_invoice_id, environment, recurring, status, paid_at)
    VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 5000, 'PLN', 'stripe',
            'renewal:in_ledger_unique_sbx', 'in_ledger_unique', 'sandbox', true, 'paid', now())$$,
  'unikat faktury jest per środowisko - piaskownica nie blokuje produkcji'
);

-- ── 2. Zwrot przelicza status wspierającego ─────────────────────────────────
-- Darczyńca 1: wpłata A (2 miesiące temu) i B (wczoraj). Przydział po obu:
-- +12 i jeszcze +12 miesięcy, źródłem jest B.
INSERT INTO public.donations
  (id, tenant_id, user_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, environment, status, paid_at)
VALUES
  ('d2000000-0000-0000-0000-00000000000a', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'd1000000-0000-0000-0000-0000000000d1', 5000, 'PLN', 'stripe', 'cs_ledger_a', 'pi_ledger_a',
   'live', 'paid', now() - interval '2 months'),
  ('d2000000-0000-0000-0000-00000000000b', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'd1000000-0000-0000-0000-0000000000d1', 5000, 'PLN', 'stripe', 'cs_ledger_b', 'pi_ledger_b',
   'live', 'paid', now() - interval '1 day');

SELECT is(
  (SELECT source_donation_id FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d1' AND source = 'donation'
      AND revoked_at IS NULL),
  'd2000000-0000-0000-0000-00000000000b'::uuid,
  'dwie wpłaty: przydział wskazuje ostatnią'
);

UPDATE public.donations SET status = 'refunded'
 WHERE id = 'd2000000-0000-0000-0000-00000000000b';

SELECT is(
  (SELECT count(*)::int FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d1' AND source = 'donation'
      AND revoked_at IS NULL),
  1,
  'zwrot OSTATNIEJ wpłaty nie odbiera statusu, który uzasadnia wcześniejsza'
);

SELECT is(
  (SELECT source_donation_id FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d1' AND source = 'donation'
      AND revoked_at IS NULL),
  'd2000000-0000-0000-0000-00000000000a'::uuid,
  'po zwrocie przydział wskazuje wpłatę, która go dalej uzasadnia'
);

SELECT is(
  (SELECT expires_at FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d1' AND source = 'donation'
      AND revoked_at IS NULL),
  (SELECT paid_at + interval '12 months' FROM public.donations
    WHERE id = 'd2000000-0000-0000-0000-00000000000a'),
  'przydział skrócony do 12 miesięcy od wpłaty, która została'
);

UPDATE public.donations SET status = 'refunded'
 WHERE id = 'd2000000-0000-0000-0000-00000000000a';

SELECT is(
  (SELECT count(*)::int FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d1' AND source = 'donation'
      AND revoked_at IS NULL),
  0,
  'zwrot JEDYNEJ pozostałej wpłaty odbiera status wspierającego'
);

-- Darczyńca 3: zwrot WCZEŚNIEJSZEJ wpłaty (nie źródła przydziału) też go skraca.
INSERT INTO public.donations
  (id, tenant_id, user_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, environment, status, paid_at)
VALUES
  ('d2000000-0000-0000-0000-00000000003a', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'd1000000-0000-0000-0000-0000000000d3', 5000, 'PLN', 'stripe', 'cs_ledger_3a', 'pi_ledger_3a',
   'live', 'paid', now() - interval '2 months'),
  ('d2000000-0000-0000-0000-00000000003b', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'd1000000-0000-0000-0000-0000000000d3', 5000, 'PLN', 'stripe', 'cs_ledger_3b', 'pi_ledger_3b',
   'live', 'paid', now() - interval '1 day');

UPDATE public.donations SET status = 'refunded'
 WHERE id = 'd2000000-0000-0000-0000-00000000003a';

SELECT is(
  (SELECT expires_at FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d3' AND source = 'donation'
      AND revoked_at IS NULL),
  (SELECT paid_at + interval '12 months' FROM public.donations
    WHERE id = 'd2000000-0000-0000-0000-00000000003b'),
  'zwrot wpłaty, która NIE jest źródłem przydziału, odejmuje jej 12 miesięcy'
);

-- ── 3. paid -> paid nie przedłuża ────────────────────────────────────────────
INSERT INTO public.donations
  (id, tenant_id, user_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, environment, status, paid_at)
VALUES ('d2000000-0000-0000-0000-00000000002c', (SELECT id FROM public.tenants WHERE slug = 'nes'),
        'd1000000-0000-0000-0000-0000000000d2', 5000, 'PLN', 'stripe', 'cs_ledger_c',
        'pi_ledger_c', 'live', 'paid', now());

CREATE TEMP TABLE ledger_grant_before ON COMMIT DROP AS
SELECT expires_at FROM public.membership_grants
 WHERE user_id = 'd1000000-0000-0000-0000-0000000000d2' AND source = 'donation'
   AND revoked_at IS NULL;

UPDATE public.donations SET status = 'paid'
 WHERE id = 'd2000000-0000-0000-0000-00000000002c';

SELECT is(
  (SELECT expires_at FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d2' AND source = 'donation'
      AND revoked_at IS NULL),
  (SELECT expires_at FROM ledger_grant_before),
  'ponowiony zapis księgujący (paid -> paid) nie przedłuża statusu o kolejny rok'
);

-- ── 4. Korekta par sesja/faktura ────────────────────────────────────────────
-- (A) sesja doszła pierwsza: kotwica z intencją `cs_`, faktura jako odnowienie.
-- Druga rata (in_ledger_a2, 30 dni później) to realna wpłata i ma zostać.
INSERT INTO public.donations
  (id, tenant_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, provider_invoice_id, provider_subscription_id,
   environment, recurring, status, paid_at)
VALUES
  ('d3000000-0000-0000-0000-0000000000a1', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   5000, 'PLN', 'stripe', 'cs_ledger_pair_a', 'cs_ledger_pair_a', NULL, 'sub_ledger_a',
   'live', true, 'paid', now() - interval '40 days'),
  ('d3000000-0000-0000-0000-0000000000a2', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   5000, 'PLN', 'stripe', 'renewal:in_ledger_a1', 'in_ledger_a1', 'in_ledger_a1', 'sub_ledger_a',
   'live', true, 'paid', now() - interval '40 days' + interval '1 minute'),
  ('d3000000-0000-0000-0000-0000000000a3', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   5000, 'PLN', 'stripe', 'renewal:in_ledger_a2', 'in_ledger_a2', 'in_ledger_a2', 'sub_ledger_a',
   'live', true, 'paid', now() - interval '10 days');

-- (B) faktura doszła pierwsza: kotwica z kluczem faktury, sesja jako odnowienie.
INSERT INTO public.donations
  (id, tenant_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, provider_invoice_id, provider_subscription_id,
   environment, recurring, status, paid_at)
VALUES
  ('d3000000-0000-0000-0000-0000000000b1', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   7000, 'EUR', 'stripe', 'cs_ledger_pair_b', 'in_ledger_b1', 'in_ledger_b1', 'sub_ledger_b',
   'live', true, 'paid', now() - interval '5 days'),
  ('d3000000-0000-0000-0000-0000000000b2', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   7000, 'EUR', 'stripe', 'renewal:cs_ledger_pair_b', 'cs_ledger_pair_b', NULL, 'sub_ledger_b',
   'live', true, 'paid', now() - interval '5 days' + interval '30 seconds');

-- (C) NIEJEDNOZNACZNE: pierwsza faktura zaginęła, odnowienie 30 dni po sesji
-- to DRUGA rata, nie duplikat - para nie może zostać „skorygowana".
INSERT INTO public.donations
  (id, tenant_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, provider_invoice_id, provider_subscription_id,
   environment, recurring, status, paid_at)
VALUES
  ('d3000000-0000-0000-0000-0000000000c1', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   5000, 'PLN', 'stripe', 'cs_ledger_pair_c', 'cs_ledger_pair_c', NULL, 'sub_ledger_c',
   'live', true, 'paid', now() - interval '35 days'),
  ('d3000000-0000-0000-0000-0000000000c2', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   5000, 'PLN', 'stripe', 'renewal:in_ledger_c2', 'in_ledger_c2', 'in_ledger_c2', 'sub_ledger_c',
   'live', true, 'paid', now() - interval '5 days');

SELECT ok(
  NOT has_function_privilege('anon', 'public.donations_dedupe_session_invoice_pairs()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.donations_dedupe_session_invoice_pairs()', 'EXECUTE'),
  'korekta par: bez EXECUTE dla ról klienckich'
);
SELECT ok(
  has_function_privilege('service_role', 'public.donations_dedupe_session_invoice_pairs()', 'EXECUTE'),
  'korekta par: service_role'
);

SET LOCAL ROLE service_role;
SELECT is(public.donations_dedupe_session_invoice_pairs(), 2,
  'korekta obejmuje dokładnie dwie jednoznaczne pary');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE provider_subscription_id = 'sub_ledger_a' AND status = 'paid'),
  2,
  '(A) zostają pierwsza i druga rata - jeden wiersz na wpłatę'
);
SELECT is(
  (SELECT provider_invoice_id FROM public.donations WHERE id = 'd3000000-0000-0000-0000-0000000000a1'),
  'in_ledger_a1',
  '(A) kotwica przejmuje klucz faktury pierwszej raty'
);
SELECT is(
  (SELECT status || '|' || provider_session_id FROM public.donations
    WHERE id = 'd3000000-0000-0000-0000-0000000000a2'),
  'canceled|duplicate:renewal:in_ledger_a1',
  '(A) duplikat zostaje jako ślad: canceled + klucz duplicate:'
);
SELECT is(
  (SELECT status FROM public.donations WHERE id = 'd3000000-0000-0000-0000-0000000000a3'),
  'paid',
  '(A) druga rata (30 dni później) nie jest ruszana'
);
SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE provider_subscription_id = 'sub_ledger_b' AND status = 'paid'),
  1,
  '(B) faktura przed sesją: zostaje jeden opłacony wiersz'
);
SELECT is(
  (SELECT status || '|' || provider_session_id FROM public.donations
    WHERE id = 'd3000000-0000-0000-0000-0000000000b2'),
  'canceled|duplicate:renewal:cs_ledger_pair_b',
  '(B) wiersz z sesji oznaczony jako duplikat'
);
SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE provider_subscription_id = 'sub_ledger_c' AND status = 'paid'),
  2,
  '(C) para niejednoznaczna (odstęp > 7 dni) zostaje nietknięta'
);

SET LOCAL ROLE service_role;
SELECT is(public.donations_dedupe_session_invoice_pairs(), 0,
  'korekta jest idempotentna - drugi przebieg nie znajduje par');
RESET ROLE;

-- ── 6. Dane z uzgodnienia w panelu sprzed poprawki ──────────────────────────
-- Uzgodnienie domykało kotwicę subskrypcji `settleDonation` z
-- `session.payment_intent` - w trybie subskrypcji null - więc kotwica zostawała
-- `paid` z PUSTĄ intencją. Ponowione `invoice.paid` dopisywało `renewal:in_...`,
-- a ponowiona sesja - `renewal:cs_...` (trzeci wiersz tej samej raty).
--
-- (D) para: kotwica bez intencji + faktura pierwszej raty.
INSERT INTO public.donations
  (id, tenant_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, provider_invoice_id, provider_subscription_id,
   environment, recurring, status, paid_at)
VALUES
  ('d3000000-0000-0000-0000-0000000000d1', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   5000, 'PLN', 'stripe', 'cs_ledger_pair_d', NULL, NULL, 'sub_ledger_d',
   'live', true, 'paid', now() - interval '20 days'),
  ('d3000000-0000-0000-0000-0000000000d2', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   5000, 'PLN', 'stripe', 'renewal:in_ledger_d1', 'in_ledger_d1', 'in_ledger_d1', 'sub_ledger_d',
   'live', true, 'paid', now() - interval '20 days' + interval '2 hours');

-- (E) trójka: kotwica bez intencji + `renewal:in_...` + `renewal:cs_...`.
INSERT INTO public.donations
  (id, tenant_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, provider_invoice_id, provider_subscription_id,
   environment, recurring, status, paid_at)
VALUES
  ('d3000000-0000-0000-0000-0000000000e1', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   6000, 'PLN', 'stripe', 'cs_ledger_pair_e', NULL, NULL, 'sub_ledger_e',
   'live', true, 'paid', now() - interval '15 days'),
  ('d3000000-0000-0000-0000-0000000000e2', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   6000, 'PLN', 'stripe', 'renewal:in_ledger_e1', 'in_ledger_e1', 'in_ledger_e1', 'sub_ledger_e',
   'live', true, 'paid', now() - interval '15 days' + interval '1 day'),
  ('d3000000-0000-0000-0000-0000000000e3', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   6000, 'PLN', 'stripe', 'renewal:cs_ledger_pair_e', 'cs_ledger_pair_e', NULL, 'sub_ledger_e',
   'live', true, 'paid', now() - interval '15 days' + interval '2 days');

-- ── 7. Korekta testowej pary nie skraca statusu z wpłaty `live` ─────────────
-- Darczyńca 4: testowa para sesja/faktura sprzed 13 miesięcy (migracja
-- przeklasyfikowała ją na `sandbox`) i realna wpłata `live` sprzed 2 tygodni.
-- Korekta kasuje duplikat z piaskownicy; przeliczenie z SAMYCH wierszy
-- piaskownicy dałoby koniec przydziału przed `now()` = odebranie statusu.
INSERT INTO public.donations
  (id, tenant_id, user_id, amount_cents, currency, provider, provider_session_id,
   provider_intent_id, provider_invoice_id, provider_subscription_id,
   environment, recurring, status, paid_at)
VALUES
  ('d3000000-0000-0000-0000-0000000000f1', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'd1000000-0000-0000-0000-0000000000d4', 5000, 'PLN', 'stripe', 'cs_test_ledger_pair_f',
   'cs_test_ledger_pair_f', NULL, 'sub_ledger_f', 'sandbox', true, 'paid',
   now() - interval '13 months'),
  ('d3000000-0000-0000-0000-0000000000f2', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'd1000000-0000-0000-0000-0000000000d4', 5000, 'PLN', 'stripe', 'renewal:in_test_ledger_f1',
   'in_test_ledger_f1', 'in_test_ledger_f1', 'sub_ledger_f', 'sandbox', true, 'paid',
   now() - interval '13 months' + interval '1 minute'),
  ('d3000000-0000-0000-0000-0000000000f3', (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'd1000000-0000-0000-0000-0000000000d4', 5000, 'PLN', 'stripe', 'cs_ledger_live_f',
   'pi_ledger_live_f', NULL, NULL, 'live', false, 'paid', now() - interval '14 days');

SET LOCAL ROLE service_role;
SELECT is(public.donations_dedupe_session_invoice_pairs(), 4,
  'korekta obejmuje parę z pustą intencją (1), trójkę (2) i testową parę (1)');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE provider_subscription_id = 'sub_ledger_d' AND status = 'paid'),
  1,
  '(D) kotwica z pustą intencją + faktura: zostaje jeden opłacony wiersz');
SELECT is(
  (SELECT provider_invoice_id || '|' || provider_intent_id FROM public.donations
    WHERE id = 'd3000000-0000-0000-0000-0000000000d1'),
  'in_ledger_d1|in_ledger_d1',
  '(D) kotwica przejmuje klucz faktury (ponowione invoice.paid trafi w unikat)');
SELECT is(
  (SELECT status || '|' || provider_session_id FROM public.donations
    WHERE id = 'd3000000-0000-0000-0000-0000000000d2'),
  'canceled|duplicate:renewal:in_ledger_d1',
  '(D) wiersz faktury oznaczony jako duplikat');

SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE provider_subscription_id = 'sub_ledger_e' AND status = 'paid'),
  1,
  '(E) trójka: zostaje jeden opłacony wiersz pierwszej raty');
SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.donations
    WHERE provider_subscription_id = 'sub_ledger_e' AND status = 'paid'),
  ARRAY['d3000000-0000-0000-0000-0000000000e1'::uuid],
  '(E) zostaje KOTWICA (wiersz z formularza)');
SELECT is(
  (SELECT provider_invoice_id FROM public.donations WHERE id = 'd3000000-0000-0000-0000-0000000000e1'),
  'in_ledger_e1',
  '(E) kotwica niesie klucz faktury');
SELECT is(
  (SELECT string_agg(status || '|' || provider_session_id, ',' ORDER BY id) FROM public.donations
    WHERE id IN ('d3000000-0000-0000-0000-0000000000e2', 'd3000000-0000-0000-0000-0000000000e3')),
  'canceled|duplicate:renewal:in_ledger_e1,canceled|duplicate:renewal:cs_ledger_pair_e',
  '(E) oba dopisane wiersze (faktura i sesja) zostają jako ślad duplikatu');

SELECT is(
  (SELECT status FROM public.donations WHERE id = 'd3000000-0000-0000-0000-0000000000f2'),
  'canceled',
  '(F) testowa para w piaskownicy skorygowana');
SELECT is(
  (SELECT count(*)::int FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d4' AND source = 'donation'
      AND revoked_at IS NULL),
  1,
  '(F) korekta testowej pary NIE odbiera statusu uzasadnionego wpłatą live');
SELECT is(
  (SELECT expires_at FROM public.membership_grants
    WHERE user_id = 'd1000000-0000-0000-0000-0000000000d4' AND source = 'donation'
      AND revoked_at IS NULL),
  (SELECT paid_at + interval '12 months' FROM public.donations
    WHERE id = 'd3000000-0000-0000-0000-0000000000f3'),
  '(F) przydział przeliczony ze WSZYSTKICH opłaconych wpłat: 12 miesięcy od wpłaty live');

SET LOCAL ROLE service_role;
SELECT is(public.donations_dedupe_session_invoice_pairs(), 0,
  'korekta danych z uzgodnienia też jest idempotentna');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
