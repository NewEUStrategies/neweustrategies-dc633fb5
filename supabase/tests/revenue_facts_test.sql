-- pgTAP: fakty diagnostyki huba (S7, migracje 20261020150000 i 20261020150050).
--
-- CO PRZYPINA:
--   * ACL: `admin_revenue_facts` - authenticated i service_role, nigdy anon;
--     16 helperów `_revenue_facts_<obszar>` bez EXECUTE dla anon,
--     authenticated i service_role (najemca idzie parametrem);
--   * bramka: autor (personel bez admin|editor) -> 42501;
--   * kształt `{v:1, computedAt, areas}` z kompletem 16 obszarów, żaden obszar
--     fiksury nie spada do `null` (awaria obszaru byłaby cichym „nie wiadomo");
--   * kwoty tylko dla administratora: redaktor dostaje `priceCents = null`,
--     `ledgerDrift = null`, `mrrCatalogBasis = null`;
--   * zero PII: fiksura ma e-maile i imiona w leadzie, zgłoszeniu do klubu
--     i nadawcy newslettera - w faktach nie ma znaku `@` ani kluczy
--     `email/name/body/token`, a `refs` to wyłącznie uuid albo klucz;
--   * fakty odpowiadają fiksurze (plan bez warstwy, cena spoza katalogu,
--     lead MQL bez właściciela, wniosek do klubu > 7 dni, błąd emitera,
--     nadawca własny vs domyślny, licznik gości 0);
--   * izolacja najemców: admin B nie widzi niczego z A;
--   * czas: cztery wywołania na fiksurze mieszczą się w `statement_timeout`.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_facts
BEGIN;
SELECT plan(24);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e7150000-0000-0000-0000-0000000000a0', 'hub-s7-facts-a', 'Hub S7 fakty A'),
  ('e7150000-0000-0000-0000-0000000000b0', 'hub-s7-facts-b', 'Hub S7 fakty B');
INSERT INTO auth.users (id, email) VALUES
  ('e7150000-0000-0000-0000-00000000a001', 'admin-a@hub-s7-facts.test'),
  ('e7150000-0000-0000-0000-00000000a002', 'editor-a@hub-s7-facts.test'),
  ('e7150000-0000-0000-0000-00000000a003', 'author-a@hub-s7-facts.test'),
  ('e7150000-0000-0000-0000-00000000a101', 'reader-a@hub-s7-facts.test'),
  ('e7150000-0000-0000-0000-00000000b001', 'admin-b@hub-s7-facts.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e7150000-0000-0000-0000-00000000a001', 'admin-a@hub-s7-facts.test', 'Admin A', 'e7150000-0000-0000-0000-0000000000a0'),
  ('e7150000-0000-0000-0000-00000000a002', 'editor-a@hub-s7-facts.test', 'Editor A', 'e7150000-0000-0000-0000-0000000000a0'),
  ('e7150000-0000-0000-0000-00000000a003', 'author-a@hub-s7-facts.test', 'Author A', 'e7150000-0000-0000-0000-0000000000a0'),
  ('e7150000-0000-0000-0000-00000000a101', 'reader-a@hub-s7-facts.test', 'Reader A', 'e7150000-0000-0000-0000-0000000000a0'),
  ('e7150000-0000-0000-0000-00000000b001', 'admin-b@hub-s7-facts.test', 'Admin B', 'e7150000-0000-0000-0000-0000000000b0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e7150000-0000-0000-0000-00000000a001', 'admin', 'e7150000-0000-0000-0000-0000000000a0'),
  ('e7150000-0000-0000-0000-00000000a002', 'editor', 'e7150000-0000-0000-0000-0000000000a0'),
  ('e7150000-0000-0000-0000-00000000a003', 'author', 'e7150000-0000-0000-0000-0000000000a0'),
  ('e7150000-0000-0000-0000-00000000b001', 'admin', 'e7150000-0000-0000-0000-0000000000b0');

-- Najemca A: plan bez warstwy (strażnik bazy odrzuca klucz spoza najemcy, więc
-- plan bez przypięcia - `tier_key IS NULL`), subskrypcja z ceną spoza lustra katalogu,
-- lead MQL bez właściciela (z adresem - PII, którego fakty nie mogą oddać),
-- wniosek do klubu sprzed 10 dni, błąd emitera, własny nadawca newslettera,
-- licznik bez darmowych artykułów dla gości.
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, tier_key, interval, price_cents, currency, active, for_sale)
VALUES ('e7150000-0000-0000-0000-0000000001a1', 'e7150000-0000-0000-0000-0000000000a0', 'Widmo', 'Ghost',
        NULL, 'month', 4900, 'PLN', true, true);
INSERT INTO public.subscriptions (tenant_id, user_id, provider_subscription_id, provider_customer_id, product_id,
  price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES ('e7150000-0000-0000-0000-0000000000a0', 'e7150000-0000-0000-0000-00000000a101', 'sub_s7_facts_1',
        'cus_s7_facts_1', 'plan_mystery', 'mystery_monthly', 'active', 'live', 4900, 'PLN', 'evt_s7_facts_1');
INSERT INTO public.crm_leads (tenant_id, email, email_norm, first_name, last_name, lifecycle_stage)
VALUES ('e7150000-0000-0000-0000-0000000000a0', 'lead.mql@hub-s7-facts.test', 'lead.mql@hub-s7-facts.test',
        'Lead', 'Kwalifikowany', 'mql');
INSERT INTO public.club_applications (tenant_id, user_id, specialization_slug, first_name, last_name, email, status, created_at)
VALUES ('e7150000-0000-0000-0000-0000000000a0', 'e7150000-0000-0000-0000-00000000a101', 'transport',
        'Kandydat', 'Klubowy', 'kandydat@hub-s7-facts.test', 'pending', now() - interval '10 days');
INSERT INTO public.domain_event_emit_errors (tenant_id, source, event_type, sqlstate, error)
VALUES ('e7150000-0000-0000-0000-0000000000a0', 'hub_s7_fixture', 'access_plan.changed.v1', 'XX000', 'fiksura');
INSERT INTO public.newsletter_settings (tenant_id, sender_email, sender_name, double_opt_in)
VALUES ('e7150000-0000-0000-0000-0000000000a0', 'newsletter@hub-s7-facts.test', 'Redakcja A', true);
INSERT INTO public.metering_settings (tenant_id, enabled, anon_monthly_limit, member_monthly_limit)
VALUES ('e7150000-0000-0000-0000-0000000000a0', true, 0, 5);

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
-- Klucze w każdym zagnieżdżeniu (obiekty i tablice) - skan PII.
CREATE FUNCTION pg_temp.all_keys(p jsonb) RETURNS SETOF text LANGUAGE sql AS $$
  WITH RECURSIVE walk(v) AS (
    SELECT p
    UNION ALL
    SELECT c.value FROM walk w
      CROSS JOIN LATERAL (
        SELECT e.value FROM jsonb_each(CASE WHEN jsonb_typeof(w.v) = 'object' THEN w.v ELSE '{}'::jsonb END) e
        UNION ALL
        SELECT a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.v) = 'array' THEN w.v ELSE '[]'::jsonb END) a
      ) c
  )
  SELECT k FROM walk w, jsonb_object_keys(CASE WHEN jsonb_typeof(w.v) = 'object' THEN w.v ELSE '{}'::jsonb END) k
$$;
-- Elementy wszystkich tablic `refs` (i `planIds`) w faktach.
CREATE FUNCTION pg_temp.all_refs(p jsonb) RETURNS SETOF text LANGUAGE sql AS $$
  SELECT jsonb_array_elements_text(m.value) FROM jsonb_path_query(p, 'strict $.**') AS x(v),
    LATERAL jsonb_each(CASE WHEN jsonb_typeof(x.v) = 'object' THEN x.v ELSE '{}'::jsonb END) m
   WHERE m.key IN ('refs', 'planIds') AND jsonb_typeof(m.value) = 'array'
$$;
CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb, at timestamptz) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON res TO authenticated;

-- ── 1. Granty i definicje ────────────────────────────────────────────────────
SELECT ok(
  (SELECT has_function_privilege('authenticated', 'public.admin_revenue_facts()', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.admin_revenue_facts()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.admin_revenue_facts()', 'EXECUTE')),
  'acl: admin_revenue_facts - authenticated i service_role, nigdy anon');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '\_revenue\_facts\_%'
      AND p.prosecdef AND p.provolatile = 's'
      AND 'search_path=public, pg_temp' = ANY (p.proconfig)),
  16,
  'helpery: 16 obszarów, SECURITY DEFINER, STABLE, search_path = public, pg_temp');
SELECT ok(
  (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '\_revenue\_facts\_%'),
  'acl: helpery _revenue_facts_* bez EXECUTE dla anon, authenticated i service_role');
SELECT ok(
  (SELECT 'statement_timeout=5s' = ANY (p.proconfig) AND 'search_path=public, pg_temp' = ANY (p.proconfig)
          AND p.prosecdef
     FROM pg_proc p WHERE p.oid = 'public.admin_revenue_facts()'::regprocedure),
  'admin_revenue_facts: SECURITY DEFINER, search_path, statement_timeout = 5s');

-- ── 2. Odczyty ───────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('e7150000-0000-0000-0000-00000000a003');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.admin_revenue_facts() $$, '42501', 'forbidden',
  'bramka: autor (bez admin|editor) -> 42501');
SELECT pg_temp.as_user('e7150000-0000-0000-0000-00000000a001');
INSERT INTO res VALUES ('t0', NULL, clock_timestamp());
INSERT INTO res SELECT 'admin_a', public.admin_revenue_facts(), clock_timestamp();
SELECT pg_temp.as_user('e7150000-0000-0000-0000-00000000a002');
INSERT INTO res SELECT 'editor_a', public.admin_revenue_facts(), clock_timestamp();
SELECT pg_temp.as_user('e7150000-0000-0000-0000-00000000b001');
INSERT INTO res SELECT 'admin_b', public.admin_revenue_facts(), clock_timestamp();
RESET ROLE;

-- ── 3. Kształt v:1 ───────────────────────────────────────────────────────────
SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'admin_a' $$,
  ARRAY['v', 'computedAt', 'areas'], 'kształt: v, computedAt, areas (REVENUE_FACTS_KEYS.root)');
SELECT is((SELECT (r ->> 'v')::int FROM res WHERE name = 'admin_a'), 1, 'kształt: wersja v = 1');
SELECT set_eq($$ SELECT jsonb_object_keys(r -> 'areas') FROM res WHERE name = 'admin_a' $$,
  ARRAY['catalog', 'paywall', 'metering', 'checkout', 'coupons', 'retention', 'dunning', 'funnel', 'crm',
        'newsletter', 'workflows', 'journeys', 'events', 'clubs', 'sync', 'data_quality'],
  'kształt: komplet 16 obszarów (HUB_FACT_AREAS)');
SELECT is_empty(
  $$ SELECT a.key FROM res, jsonb_each(r -> 'areas') a WHERE name = 'admin_a' AND a.value = 'null'::jsonb $$,
  'kształt: żaden obszar fiksury nie spadł do null (awaria obszaru)');

-- ── 4. Kwoty tylko dla administratora ────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(p -> 'priceCents' <> 'null'::jsonb)
     FROM res, jsonb_array_elements(r #> '{areas,catalog,plans}') p WHERE name = 'admin_a'),
  'kwoty: administrator widzi ceny planów');
SELECT ok(
  (SELECT count(*) > 0 AND bool_and(p -> 'priceCents' = 'null'::jsonb)
     FROM res, jsonb_array_elements(r #> '{areas,catalog,plans}') p WHERE name = 'editor_a'),
  'kwoty: redaktor dostaje priceCents = null w każdym planie');
SELECT ok(
  (SELECT r #> '{areas,data_quality}' ? 'ledgerDrift'
          AND r #> '{areas,data_quality,ledgerDrift}' = 'null'::jsonb
          AND r #> '{areas,data_quality,mrrCatalogBasis}' = 'null'::jsonb
     FROM res WHERE name = 'editor_a'),
  'kwoty: redaktor bez dryfu księgi i podstawy MRR (null)');

-- ── 5. Zero PII ──────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(position('@' IN r::text) = 0) FROM res WHERE name IN ('admin_a', 'editor_a', 'admin_b')),
  'PII: w faktach nie ma znaku @ (adresy leadu, kandydata i nadawcy zostają w bazie)');
SELECT is_empty(
  $$ SELECT k FROM res, pg_temp.all_keys(r) k
      WHERE name = 'admin_a' AND lower(k) IN ('email', 'name', 'body', 'token', 'phone', 'note') $$,
  'PII: brak kluczy email/name/body/token/phone/note w żadnym zagnieżdżeniu');
SELECT is_empty(
  $$ SELECT x FROM res, pg_temp.all_refs(r) x
      WHERE name = 'admin_a'
        AND x !~ '^([a-z_]+:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' $$,
  'PII: refs i planIds to wyłącznie uuid albo <typ>:<uuid>');
SELECT ok(
  (SELECT jsonb_typeof(r #> '{areas,newsletter,defaultSender}') = 'boolean' FROM res WHERE name = 'admin_a'),
  'PII: nadawca newslettera wyłącznie jako flaga defaultSender');

-- ── 6. Fakty z fiksury ───────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_or(p ->> 'id' = 'e7150000-0000-0000-0000-0000000001a1' AND (p ->> 'tierFound')::boolean IS FALSE)
     FROM res, jsonb_array_elements(r #> '{areas,catalog,plans}') p WHERE name = 'admin_a'),
  'katalog: plan bez warstwy ma tierFound = false');
SELECT results_eq(
  $$ SELECT (r #>> '{areas,catalog,unknownPriceSubscriptions,unknownPrice}')::int,
            (r #>> '{areas,crm,qualifiedWithoutOwner,mqlSql}')::int,
            (r #>> '{areas,clubs,pendingApplications,over7d}')::int,
            (r #>> '{areas,sync,emitErrors24h}')::int,
            (r #>> '{areas,metering,anonMonthlyLimit}')::int
       FROM res WHERE name = 'admin_a' $$,
  $$ VALUES (1, 1, 1, 1, 0) $$,
  'fakty A: cena spoza katalogu, MQL bez właściciela, wniosek > 7 dni, błąd emitera, licznik gości 0');
SELECT ok(
  (SELECT (r #>> '{areas,newsletter,defaultSender}')::boolean IS FALSE FROM res WHERE name = 'admin_a')
  AND (SELECT (r #>> '{areas,newsletter,defaultSender}')::boolean IS TRUE FROM res WHERE name = 'admin_b'),
  'newsletter: własny nadawca A = false, B bez wiersza ustawień = nadawca domyślny');
SELECT is(
  (SELECT r #> '{areas,crm,qualifiedWithoutOwner,refs}' FROM res WHERE name = 'admin_a'),
  (SELECT jsonb_build_array(l.id) FROM public.crm_leads l
    WHERE l.tenant_id = 'e7150000-0000-0000-0000-0000000000a0' AND l.email_norm = 'lead.mql@hub-s7-facts.test'),
  'CRM: refs leadu bez właściciela = sam uuid');

-- ── 7. Izolacja najemców ─────────────────────────────────────────────────────
SELECT ok(
  NOT (SELECT bool_or(p ->> 'id' = 'e7150000-0000-0000-0000-0000000001a1')
         FROM res, jsonb_array_elements(r #> '{areas,catalog,plans}') p WHERE name = 'admin_b'),
  'najemcy: admin B nie widzi planu A');
SELECT results_eq(
  $$ SELECT (r #>> '{areas,sync,emitErrors24h}')::int, (r #>> '{areas,crm,qualifiedWithoutOwner,mqlSql}')::int,
            (r #>> '{areas,clubs,pendingApplications,over7d}')::int,
            (r #>> '{areas,catalog,unknownPriceSubscriptions,unknownPrice}')::int
       FROM res WHERE name = 'admin_b' $$,
  $$ VALUES (0, 0, 0, 0) $$,
  'najemcy: liczniki B nie liczą wierszy A');

-- ── 8. Czas ──────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT max(at) - min(at) < interval '5 seconds' FROM res),
  'czas: trzy pełne odczyty faktów na fiksurze < statement_timeout (5 s)');
SELECT ok(
  (SELECT bool_and((r ->> 'computedAt')::timestamptz IS NOT NULL) FROM res WHERE r IS NOT NULL),
  'kształt: computedAt to znacznik czasu');

SELECT * FROM finish();
ROLLBACK;
