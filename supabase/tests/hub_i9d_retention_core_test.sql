-- pgTAP: rdzeń katalogu retencji dla czterech kategorii I9d-Y1 (migracja
-- 20261020162200; decyzje właściciela 2026-10-20 - Z-I9c-01, Z-I9c-07,
-- Z-I9c-08).
--
-- CO PRZYPINA:
--   * katalog: 13 kategorii w kolejności karty, okresy domyślne i zakresy
--     nowych kategorii, reguły wygaszania (30 dni na reakcję, dzienny limit
--     próśb) - lustro `DATA_RETENTION_PERIODS`/`DATA_RETENTION_RULES`;
--   * CHECK zakresów: wartość spoza zakresu ODRZUCONA, granice przyjęte;
--     dziennik przebiegów przyjmuje nowe kategorie (ograniczenie zwalidowane);
--   * karencja 14 dni: najemcy sprzed migracji mają wiersze nowych kategorii
--     (termin nie wcześniejszy niż kategorii I9c); nowa kategoria w podglądzie
--     obok starych wykonywanych - nagłówek karty pokazuje termin z PRZYSZŁOŚCI;
--   * dyspozytor: gałąź każdej kategorii (wynik nie-NULL, tryb, wiersz bez
--     błędu); podgląd karty liczy nowe kategorie; wyłączona kategoria -
--     bez przebiegu i bez granicy odczytu;
--   * panel: zapis okresu nowej kategorii w zakresie, spoza - 22023.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_retention_core
BEGIN;
SELECT plan(15);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- T: najemca założony 60 dni temu (stare kategorie po karencji), nowe
-- kategorie z terminem jak po seedzie migracji (za 14 dni).
INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19d50000-0000-4000-8000-0000000000a0', 'i9d-rdzen', 'I9d Rdzeń', now() - interval '60 days');
INSERT INTO auth.users (id, email) VALUES ('19d50000-0000-4000-8000-00000000a001', 'admin@i9d-rdzen.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19d50000-0000-4000-8000-00000000a001', 'admin@i9d-rdzen.test', 'Admin', '19d50000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19d50000-0000-4000-8000-00000000a001', 'admin', '19d50000-0000-4000-8000-0000000000a0');
INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enabled, enforce_after)
SELECT '19d50000-0000-4000-8000-0000000000a0', k, d, true, now() + interval '14 days'
  FROM (VALUES ('metered_views', 3), ('newsletter_inactive', 12), ('event_attendees', 24), ('club_applications', 24)) x(k, d);

CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated;

-- ── 1. Katalog ───────────────────────────────────────────────────────────────
SELECT is(
  (SELECT array_agg(c ->> 'key' ORDER BY o) FROM jsonb_array_elements(public._data_retention_catalog() -> 'categories')
     WITH ORDINALITY x(c, o)),
  ARRAY['paywall_metering', 'metered_views', 'email_engagement', 'email_send_log', 'newsletter_inactive',
        'crm_inactive_contacts', 'event_attendees', 'club_applications', 'audit_log', 'journey_enrollments',
        'cancellation_surveys', 'crm_customers', 'consent_log'],
  'katalog: 13 kategorii w kolejności karty (nowe obok pokrewnych, ustawowe na końcu)');
SELECT is(
  (SELECT jsonb_object_agg(c ->> 'key', jsonb_build_array(c -> 'default', c -> 'min', c -> 'max', c -> 'editable'))
     FROM jsonb_array_elements(public._data_retention_catalog() -> 'categories') c
    WHERE c ->> 'key' IN ('metered_views', 'newsletter_inactive', 'event_attendees', 'club_applications')),
  '{"metered_views": [3, 2, 13, true], "newsletter_inactive": [12, 6, 24, true],
    "event_attendees": [24, 12, 36, true], "club_applications": [24, 12, 36, true]}'::jsonb,
  'katalog: okresy domyślne i zakresy nowych kategorii (decyzje właściciela)');
SELECT ok(
  (public._data_retention_catalog() -> 'rules' ->> 'newsletter_response_days')::int = 30
  AND (public._data_retention_catalog() -> 'rules' ->> 'newsletter_daily_cap')::int = 200
  AND (public._data_retention_catalog() -> 'rules' ->> 'grace_days')::int = 14,
  'katalog: reguły wygaszania (30 dni na reakcję, 200 próśb dziennie) obok karencji 14 dni');

-- ── 2. CHECK zakresów ────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.try_period(p_cat text, p_months int) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enabled, enforce_after)
  VALUES ('19d50000-0000-4000-8000-0000000000a0', p_cat, p_months, true, now())
  ON CONFLICT (tenant_id, category) DO UPDATE SET period_months = EXCLUDED.period_months;
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN
  RETURN 'check';
END;
$$;
SELECT is(
  (SELECT array_agg(pg_temp.try_period(c, m) ORDER BY o)
     FROM (VALUES (1, 'metered_views', 1), (2, 'metered_views', 14), (3, 'newsletter_inactive', 5),
                  (4, 'newsletter_inactive', 25), (5, 'event_attendees', 11), (6, 'event_attendees', 37),
                  (7, 'club_applications', 11), (8, 'club_applications', 37), (9, 'metered_views', NULL)) x(o, c, m)),
  ARRAY['check', 'check', 'check', 'check', 'check', 'check', 'check', 'check', 'check'],
  'CHECK: okres spoza zakresu (i brak okresu) nowej kategorii odrzucony');
SELECT is(
  (SELECT array_agg(pg_temp.try_period(c, m) ORDER BY o)
     FROM (VALUES (1, 'metered_views', 2), (2, 'metered_views', 13), (3, 'newsletter_inactive', 6),
                  (4, 'newsletter_inactive', 24), (5, 'event_attendees', 12), (6, 'event_attendees', 36),
                  (7, 'club_applications', 12), (8, 'club_applications', 36)) x(o, c, m)),
  ARRAY['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  'CHECK: granice zakresów przyjęte');
-- Przywrócenie okresów domyślnych fikstury.
UPDATE public.data_retention_settings s SET period_months = x.d
  FROM (VALUES ('metered_views', 3), ('newsletter_inactive', 12), ('event_attendees', 24), ('club_applications', 24)) x(k, d)
 WHERE s.tenant_id = '19d50000-0000-4000-8000-0000000000a0' AND s.category = x.k;

SELECT ok(
  (SELECT convalidated FROM pg_constraint WHERE conname = 'data_retention_runs_category_check'
      AND conrelid = 'public.data_retention_runs'::regclass),
  'dziennik przebiegów: CHECK kategorii rozszerzony i zwalidowany (NOT VALID + VALIDATE)');
SELECT lives_ok(
  $$ INSERT INTO public.data_retention_runs (tenant_id, category, mode, run_trigger)
     SELECT '19d50000-0000-4000-8000-0000000000a0', c, 'preview', 'schedule'
       FROM unnest(ARRAY['metered_views', 'newsletter_inactive', 'event_attendees', 'club_applications']) c $$,
  'dziennik przebiegów przyjmuje nowe kategorie (bez tego błąd kategorii wywracałby przebieg najemcy)');

-- ── 3. Karencja 14 dni ───────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.data_retention_settings old
     WHERE old.category = 'paywall_metering'
       AND old.tenant_id <> '19d50000-0000-4000-8000-0000000000a0'
       AND (SELECT count(*) FROM public.data_retention_settings n
             WHERE n.tenant_id = old.tenant_id
               AND n.category IN ('metered_views', 'newsletter_inactive', 'event_attendees', 'club_applications')
               AND n.enforce_after >= old.enforce_after AND n.enabled) <> 4),
  'seed karencji: każdy najemca z wierszami I9c ma wiersze 4 nowych kategorii (termin nie wcześniejszy niż I9c)');

SELECT pg_temp.as_user('19d50000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'get', public.admin_data_retention_get();
INSERT INTO r SELECT 'preview', public.admin_data_retention_preview();
RESET ROLE;
SELECT ok(
  (SELECT (v -> 'grace' ->> 'enforce_after')::timestamptz > now() + interval '13 days'
          AND (v -> 'grace' ->> 'any_preview')::boolean AND NOT (v -> 'grace' ->> 'enforced')::boolean
     FROM r WHERE k = 'get')
  AND (SELECT bool_and((c ->> 'enforced')::boolean = (c ->> 'key' NOT IN ('metered_views', 'newsletter_inactive',
                                                                           'event_attendees', 'club_applications')))
         FROM r, jsonb_array_elements(v -> 'categories') c WHERE k = 'get'),
  'karencja: nowe kategorie w podglądzie obok starych wykonywanych; nagłówek karty - termin z przyszłości, nie z przeszłości');
SELECT ok(
  (SELECT bool_and(c -> 'count' IS NOT NULL AND jsonb_typeof(c -> 'count') = 'number' AND c ->> 'mode' = 'preview')
     FROM r, jsonb_array_elements(v -> 'categories') c
    WHERE k = 'preview' AND c ->> 'key' IN ('metered_views', 'newsletter_inactive', 'event_attendees', 'club_applications')),
  'podgląd karty: liczba dla każdej nowej kategorii (gałąź istnieje), tryb podglądu');

-- ── 4. Dyspozytor ────────────────────────────────────────────────────────────
INSERT INTO r SELECT 'run', public._data_retention_run_tenant('19d50000-0000-4000-8000-0000000000a0', 'manual', 1000);
SELECT ok(
  (SELECT count(*) = 13 AND bool_and(jsonb_typeof(x.value) = 'object' AND NOT x.value ? 'error')
     FROM r, jsonb_each(v) x WHERE k = 'run')
  AND (SELECT bool_and(v -> c ->> 'mode' = 'preview') FROM r,
         unnest(ARRAY['metered_views', 'newsletter_inactive', 'event_attendees', 'club_applications']) c WHERE k = 'run')
  AND (SELECT v -> 'paywall_metering' ->> 'mode' = 'execute' FROM r WHERE k = 'run')
  AND (SELECT count(*) = 13 FROM public.data_retention_runs
        WHERE tenant_id = '19d50000-0000-4000-8000-0000000000a0' AND error_code IS NULL AND run_trigger = 'manual'),
  'dyspozytor: wynik każdej z 13 kategorii (bez NULL i błędów), nowe w podglądzie, stare w wykonaniu');

-- ── 5. Panel: zapis okresu i wyłączenie ──────────────────────────────────────
-- Token współbieżności (CAS) z wiersza - jak karta z odczytu `get`.
INSERT INTO r SELECT 'tok_' || category, to_jsonb(updated_at) FROM public.data_retention_settings
 WHERE tenant_id = '19d50000-0000-4000-8000-0000000000a0' AND category IN ('newsletter_inactive', 'metered_views');
SELECT pg_temp.as_user('19d50000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_data_retention_save('newsletter_inactive', 25, true,
       (SELECT (v #>> '{}')::timestamptz FROM r WHERE k = 'tok_newsletter_inactive')) $$,
  '22023', 'period_out_of_range', 'panel: okres wygaszania spoza 6-24 - 22023');
SELECT lives_ok(
  $$ SELECT public.admin_data_retention_save('metered_views', 13, false,
       (SELECT (v #>> '{}')::timestamptz FROM r WHERE k = 'tok_metered_views')) $$,
  'panel: odczyty licznika - okres 13 mies. i wyłączenie zapisane');
INSERT INTO r SELECT 'preview2', public.admin_data_retention_preview();
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO r SELECT 'run2', public._data_retention_run_tenant('19d50000-0000-4000-8000-0000000000a0', 'manual', 1000);
SELECT ok(
  (SELECT c -> 'count' = 'null'::jsonb AND NOT (c ->> 'enabled')::boolean
     FROM r, jsonb_array_elements(v -> 'categories') c WHERE k = 'preview2' AND c ->> 'key' = 'metered_views')
  AND (SELECT NOT v ? 'metered_views' AND v ? 'club_applications' FROM r WHERE k = 'run2'),
  'kategoria wyłączona: podgląd bez liczby, przebieg ją pomija');

-- Granica odczytu z agregatu nie bierze progu wyłączonej kategorii.
INSERT INTO public.data_retention_state (tenant_id, scope, sealed_through)
VALUES ('19d50000-0000-4000-8000-0000000000a0', 'funnel', (now() - interval '1 day')::date)
ON CONFLICT (tenant_id, scope) DO UPDATE SET sealed_through = EXCLUDED.sealed_through, purged_before = NULL;
SELECT is(
  public._data_retention_funnel_cut('19d50000-0000-4000-8000-0000000000a0'),
  (now() - interval '13 months')::date,
  'granica odczytu: wyłączone odczyty licznika - próg lejka (13 mies.), nie 3 mies.');

SELECT * FROM finish();
ROLLBACK;
