-- pgTAP: lustro katalogu cen w SQL (S2, migracja 20261020110000).
--
-- CO PRZYPINA:
--   * `billing_catalog_entry` = `[...BILLING_CATALOG, ...BILLING_CATALOG_LEGACY]`
--     (14 pozycji, w tym `student_annual` i wpisy legacy `plus_yearly`,
--     `pro_yearly`); `NULL` = cały katalog; po stronie TS ten sam blok
--     `-- katalog:` czyta src/lib/billing/__tests__/billingCatalogSqlParity.test.ts;
--   * `billing_months_per_interval` = `monthlyEquivalent` na WSPÓLNYM zestawie
--     przypadków (blok `-- fixture:monthly-equivalent` niżej czyta też vitest),
--     w tym zaokrąglenie połówek (0,5 -> 1) i słownik aplikacji
--     (`two_weeks`, `quarter`); `one_time` i nieznane -> NULL;
--   * `subscription_mrr_minor`: migawka operatora (`provider`) kontra katalog
--     najemcy (`catalog`, D-05), rabat tylko do końca, próg wolumenowy
--     Zespołu, limit 100 miejsc, ilość ignorowana dla planu bez miejsc, cena
--     legacy, cena nieznana i jednorazowa = NULL (nie 0), plan brakujący
--     w katalogu najemcy = NULL; najemca z parametru (dwóch najemców);
--   * ACL i atrybuty: helpery wewnętrzne bez EXECUTE dla ról API
--     (`billing_catalog_entry` - service_role dla parytetu).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_catalog_mirror
BEGIN;
SELECT plan(32);

-- ── Fixture: dwóch najemców (plany z seeda najemcy, B z inną ceną) ──────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('d2010000-0000-0000-0000-0000000000a0', 'hub-s2-cat-a', 'Hub S2 katalog A'),
  ('d2010000-0000-0000-0000-0000000000b0', 'hub-s2-cat-b', 'Hub S2 katalog B');
UPDATE public.access_plans SET price_cents = 4900, currency = 'EUR'
 WHERE tenant_id = 'd2010000-0000-0000-0000-0000000000b0' AND tier_key = 'member' AND interval = 'month';

-- ── 1. ACL i atrybuty ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.billing_catalog_entry(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.billing_catalog_entry(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.billing_catalog_entry(text)', 'EXECUTE'),
  'acl: billing_catalog_entry tylko service_role (parytet)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.billing_months_per_interval(text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.billing_months_per_interval(text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.billing_months_per_interval(text, integer)', 'EXECUTE'),
  'acl: billing_months_per_interval bez EXECUTE dla ról API');
SELECT ok(
  NOT has_function_privilege('anon', 'public.subscription_mrr_minor(uuid, text, integer, integer, text, integer, timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.subscription_mrr_minor(uuid, text, integer, integer, text, integer, timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.subscription_mrr_minor(uuid, text, integer, integer, text, integer, timestamptz, timestamptz)', 'EXECUTE'),
  'acl: subscription_mrr_minor bez EXECUTE dla ról API');
SELECT ok(
  (SELECT bool_and(p.provolatile = 'i') FROM pg_proc p
    WHERE p.oid IN ('public.billing_catalog_entry(text)'::regprocedure,
                    'public.billing_months_per_interval(text, integer)'::regprocedure))
  AND (SELECT p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public.subscription_mrr_minor(uuid, text, integer, integer, text, integer, timestamptz, timestamptz)'::regprocedure)
  AND (SELECT bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%pg_temp%'))
         FROM pg_proc p
        WHERE p.oid IN ('public.billing_catalog_entry(text)'::regprocedure,
                        'public.billing_months_per_interval(text, integer)'::regprocedure,
                        'public.subscription_mrr_minor(uuid, text, integer, integer, text, integer, timestamptz, timestamptz)'::regprocedure)),
  'atrybuty: katalog i miesiące IMMUTABLE, MRR SECURITY DEFINER, search_path z pg_temp');

-- ── 2. Katalog ───────────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::integer FROM public.billing_catalog_entry(NULL)), 14,
  'katalog: 12 pozycji BILLING_CATALOG + 2 legacy');
SELECT is((SELECT count(*)::integer FROM public.billing_catalog_entry(NULL) WHERE legacy), 2,
  'katalog: dokładnie 2 wpisy legacy');
SELECT results_eq(
  $$ SELECT tier_key, billing_interval, rank, legacy FROM public.billing_catalog_entry('student_annual') $$,
  $$ VALUES ('student'::text, 'year'::text, 11, false) $$,
  'katalog: student_annual (cennik v6.2) - student / rok / ranga 11');
SELECT results_eq(
  $$ SELECT price_id, tier_key, billing_interval, legacy FROM public.billing_catalog_entry(NULL)
      WHERE legacy ORDER BY price_id $$,
  $$ VALUES ('plus_yearly'::text, 'member'::text, 'year'::text, true),
            ('pro_yearly'::text, 'pro'::text, 'year'::text, true) $$,
  'katalog: legacy plus_yearly -> member/rok, pro_yearly -> pro/rok');
SELECT results_eq(
  $$ SELECT per_seat, volume_tiered, one_time FROM public.billing_catalog_entry('team_monthly_seat')
     UNION ALL
     SELECT per_seat, volume_tiered, one_time FROM public.billing_catalog_entry('decision_lab_seat') $$,
  $$ VALUES (true, true, false), (false, false, true) $$,
  'katalog: Zespół za miejsce i schodkowy, Decision Lab jednorazowy');
SELECT is_empty(
  $$ SELECT 1 FROM public.billing_catalog_entry('nie_ma_takiej') $$,
  'katalog: cena spoza katalogu = brak wiersza');

-- ── 3. Miesiące na cykl = monthlyEquivalent (wspólny fixture) ───────────────
CREATE TEMP TABLE fx_months (
  billing_interval text, interval_count integer, amount_minor integer, mrr_minor integer
) ON COMMIT DROP;
-- fixture:monthly-equivalent:begin
INSERT INTO fx_months (billing_interval, interval_count, amount_minor, mrr_minor) VALUES
  ('month', 1, 3900, 3900),
  ('month', 3, 11700, 3900),
  ('year', 1, 39000, 3250),
  ('year', 1, 119000, 9917),
  ('year', 2, 78000, 3250),
  ('week', 1, 1000, 4333),
  ('week', 2, 2000, 4333),
  ('day', 1, 100, 3042),
  ('day', 7, 700, 3042),
  ('two_weeks', 1, 4000, 8667),
  ('quarter', 1, 30000, 10000),
  ('year', 1, 19000, 1583),
  ('month', 1, 1, 1),
  ('year', 1, 6, 1),
  ('year', 1, 18, 2),
  ('month', 0, 3900, 3900);
-- fixture:monthly-equivalent:end
SELECT is_empty(
  $$ SELECT billing_interval, interval_count, amount_minor, mrr_minor,
            round(amount_minor::numeric / public.billing_months_per_interval(billing_interval, interval_count))
       FROM fx_months
      WHERE round(amount_minor::numeric / public.billing_months_per_interval(billing_interval, interval_count))
            IS DISTINCT FROM mrr_minor $$,
  'miesiące: każdy przypadek wspólnego fixture = monthlyEquivalent (zaokrąglone)');
SELECT ok(
  public.billing_months_per_interval('one_time', 1) IS NULL
  AND public.billing_months_per_interval('fortnight', 1) IS NULL
  AND public.billing_months_per_interval(NULL, 1) IS NULL,
  'miesiące: one_time, nieznany cykl i NULL -> NULL (brak MRR)');
SELECT is(public.billing_months_per_interval('two_weeks', 1), public.billing_months_per_interval('week', 2),
  'miesiące: two_weeks = tydzień × 2 (catalogRecurringFor)');
SELECT is(public.billing_months_per_interval('quarter', 1), public.billing_months_per_interval('month', 3),
  'miesiące: quarter = miesiąc × 3 (catalogRecurringFor)');

-- ── 4. MRR subskrypcji ───────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT mrr_minor, currency, basis, tier_key, billing_interval
       FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_monthly', 1, 5900, 'pln', 0, NULL) $$,
  $$ VALUES (5900, 'PLN'::text, 'provider'::text, 'member'::text, 'month'::text) $$,
  'mrr: migawka operatora wygrywa z katalogiem (59 zł mimo ceny 39 zł), waluta wielkimi');
SELECT results_eq(
  $$ SELECT mrr_minor, currency, basis
       FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_monthly', 1, NULL, NULL, 0, NULL) $$,
  $$ VALUES (3900, 'PLN'::text, 'catalog'::text) $$,
  'mrr: bez migawki - katalog najemcy, jawnie basis=catalog (D-05)');
SELECT results_eq(
  $$ SELECT mrr_minor, basis FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_annual', 1, NULL, NULL, 0, NULL) $$,
  $$ VALUES (3250, 'catalog'::text) $$,
  'mrr: plan roczny 390 zł / 12 = 32,50 zł');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_yearly', 1, NULL, NULL, 0, NULL)),
  3250,
  'mrr: cena legacy plus_yearly liczy się jak member / rok');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'team_monthly_seat', 12, NULL, NULL, 0, NULL)),
  12 * 7900,
  'mrr: Zespół od 11 miejsc - WSZYSTKIE miejsca po 79 zł (tryb volume)');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'team_monthly_seat', 5, NULL, NULL, 0, NULL)),
  5 * 8900,
  'mrr: Zespół poniżej progu - stawka podstawowa');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'team_monthly_seat', 150, NULL, NULL, 0, NULL)),
  100 * 7900,
  'mrr: katalog liczy najwyżej 100 miejsc (MAX_PLAN_SEATS)');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_monthly', 3, NULL, NULL, 0, NULL)),
  3900,
  'mrr: plan bez miejsc z katalogu - ilość ignorowana (catalogPlanQuote)');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_monthly', 1, 5900, 'PLN', 1000, now() + interval '30 days')),
  4900,
  'mrr: rabat trwający odejmuje się od migawki');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_monthly', 1, 5900, 'PLN', 1000, now() - interval '1 day')),
  5900,
  'mrr: rabat po terminie nie obniża MRR');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_monthly', 1, 500, 'PLN', 1000, NULL)),
  0,
  'mrr: rabat większy od kwoty - zero, nigdy wartość ujemna');
SELECT results_eq(
  $$ SELECT mrr_minor, currency, basis FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000b0', 'plus_monthly', 1, NULL, NULL, 0, NULL) $$,
  $$ VALUES (4900, 'EUR'::text, 'catalog'::text) $$,
  'najemcy: katalog B z własną ceną i walutą (najemca z parametru)');
SELECT ok(
  (SELECT mrr_minor IS NULL AND basis IS NULL AND tier_key IS NULL
     FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'nie_ma_takiej', 1, 5900, 'PLN', 0, NULL)),
  'mrr: cena spoza katalogu = NULL (nie 0), nawet z migawką');
SELECT ok(
  (SELECT mrr_minor IS NULL AND tier_key = 'decision_lab'
     FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'decision_lab_seat', 1, NULL, NULL, 0, NULL)),
  'mrr: pozycja jednorazowa = NULL (brak cyklu)');
SELECT ok(
  (SELECT mrr_minor IS NULL AND tier_key = 'business'
     FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'business_monthly', 1, NULL, NULL, 0, NULL)),
  'mrr: brak planu najemcy dla pary warstwa × cykl = NULL');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'business_monthly', 1, 9900, 'PLN', 0, NULL)),
  9900,
  'mrr: wycofany ze sprzedaży plan nadal liczy się z migawki operatora');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'pro_annual', 1, 119000, 'PLN', 0, NULL)),
  9917,
  'mrr: zaokrąglenie połówek od zera jak Math.round (1190 zł / 12)');
SELECT is(
  (SELECT mrr_minor FROM public.subscription_mrr_minor('d2010000-0000-0000-0000-0000000000a0', 'plus_monthly', 1, NULL, NULL, 1000, NULL)),
  2900,
  'mrr: rabat bez końca obniża także kwotę z katalogu');

SELECT * FROM finish();
ROLLBACK;
