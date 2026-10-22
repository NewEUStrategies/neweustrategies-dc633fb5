-- pgTAP: cennik v6.2 w bazie (migracje 20261018160000-20261018160300).
--
-- Weryfikuje:
--   1. SEED NOWEGO NAJEMCY (trigger tenants_seed_pricing_defaults) odtwarza
--      stan v6.2: nazwy, wyróżnienie wyłącznie na Członku Pro, karty
--      Enterprise i Partnera Biznesowego ukryte, noty „od", ceny 39/390,
--      119/1190, 89 (próg 11 / 79), student 19/190, kadra 29, trial 7 dni,
--      Decision Lab poza sprzedażą, BEZ planów Partnera Biznesowego, pełne
--      features v6.1 (bilet, Chatham House, wczesny dostęp tylko od Pro);
--   2. APPLY U NAJEMCY ISTNIEJĄCEGO (stan v3 odtworzony w teście) zmienia
--      prezentację i ceny po kluczach, NIE ruszając features (ręczna flaga
--      admina zostaje), wycofuje Partnera Biznesowego ze sprzedaży z
--      `active = true` i dokłada roczny plan studencki;
--   3. IDEMPOTENCJA - drugie apply nie zapisuje żadnego wiersza (ctid
--      zostaje: brak nowej wersji krotki = brak UPDATE i brak zdarzenia);
--   4. IZOLACJA NAJEMCÓW - apply najemcy B nie dotyka progów, planów ani FAQ
--      trzeciego najemcy z celowo innym cennikiem (ctid, ceny, brak
--      dołożonego planu studenckiego, aktywne FAQ);
--   5. ACL - funkcje katalogu tylko dla service_role, search_path z pg_temp.
BEGIN;
SELECT plan(41);

-- ── 1. Świeży najemca ───────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name)
VALUES ('6e620000-0000-4000-8000-0000000000a1', 'v62-fresh', 'V62 Fresh');

SELECT results_eq(
  $$SELECT key, name_pl, name_en FROM public.membership_tiers
     WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1'
       AND key IN ('reader', 'member', 'pro', 'vip', 'partner', 'partner_general', 'presidents_circle')
     ORDER BY rank, key$$,
  $$VALUES ('reader', 'Czytelnik', 'Reader'),
           ('member', 'Członek', 'Member'),
           ('pro', 'Członek Pro', 'Member Pro'),
           ('vip', 'Rada Instytutu', 'Institute Council'),
           ('partner', 'Partner Instytucjonalny', 'Institutional Partner'),
           ('partner_general', 'Partner Strategiczny', 'Strategic Partner'),
           ('presidents_circle', 'Krąg Założycieli', 'Founders'' Circle')$$,
  'seed: nazwy progów v6.2 PL/EN'
);

SELECT is(
  (SELECT array_agg(key ORDER BY key) FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND highlight),
  ARRAY['pro'],
  'seed: wyróżnienie WYŁĄCZNIE na Członku Pro'
);

SELECT is(
  (SELECT badge_pl || ' / ' || badge_en FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND key = 'pro'),
  'Najpopularniejszy / Most popular',
  'seed: badge na Członku Pro'
);

SELECT is(
  (SELECT array_agg(key ORDER BY key) FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND NOT pricing_visible),
  ARRAY['business', 'corporate', 'supporter'],
  'seed: ukryte karty to Partner Biznesowy, Enterprise i wycofany Wspierający'
);

SELECT is(
  (SELECT count(*)::int FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1'
      AND key IN ('business', 'corporate') AND active AND rank IN (28, 30)),
  2,
  'seed: ukryte progi zostają AKTYWNE z rangami 28/30 (uprawnienia, kluby)'
);

SELECT results_eq(
  $$SELECT key, price_note_pl, cta_mode FROM public.membership_tiers
     WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1'
       AND key IN ('vip', 'ngo', 'team', 'partner', 'partner_general', 'presidents_circle')
     ORDER BY sort_order$$,
  -- NGO po Partnerze (sort_order 85, I9b 20261020160100): remis rangi 40
  -- rozstrzyga kolejność kart, Partner pierwszy.
  $$VALUES ('vip', 'od 6 000 zł rocznie', 'contact'),
           ('team', '3-20 miejsc · od 11 miejsc 79 zł za miejsce', 'contact'),
           ('partner', 'od 24 000 zł rocznie', 'contact'),
           ('ngo', '-50% stawki Partnera Instytucjonalnego · po weryfikacji KRS lub statutu', 'contact'),
           ('partner_general', 'od 60 000 zł rocznie', 'contact'),
           ('presidents_circle', 'od 120 000 zł rocznie · na zaproszenie', 'none')$$,
  'seed: noty „od" i tryb CTA progów bez kasy'
);

SELECT results_eq(
  $$SELECT tier_key, interval::text, price_cents, trial_days, for_sale,
           volume_threshold_seats, volume_price_cents
      FROM public.access_plans
     WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1'
     ORDER BY sort_order$$,
  $$VALUES ('member', 'month', 3900, 7, true, NULL::int, NULL::int),
           ('member', 'year', 39000, 7, true, NULL, NULL),
           ('pro', 'month', 11900, 7, true, NULL, NULL),
           ('pro', 'year', 119000, 7, true, NULL, NULL),
           ('student', 'month', 1900, 7, true, NULL, NULL),
           ('student', 'year', 19000, 7, true, NULL, NULL),
           ('educator', 'month', 2900, 7, true, NULL, NULL),
           ('team', 'month', 8900, 7, false, 11, 7900),
           ('decision_lab', 'one_time', 1600000, 0, false, NULL, NULL)$$,
  'seed: plany v6.2 z ceną, trialem i progiem wolumenowym; Zespół i Decision Lab poza sprzedażą samoobsługową; bez Partnera Biznesowego'
);

SELECT ok(
  NOT (SELECT bool_or(features ? 'chat_inmail_quota_2' OR features ? 'chat_inmail_quota_5')
         FROM public.membership_tiers
        WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND key IN ('member', 'pro')),
  'seed: bez dawnych flag puli InMaili - pula zapytań to dokładnie 1 / 3 (v6.2)'
);

SELECT is(
  (SELECT active FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND key = 'decision_lab'),
  false,
  'seed: Decision Lab jako wpis techniczny (nieaktywny próg, ranga 0)'
);

SELECT is(
  (SELECT (features ->> 'included_event_tickets')::int FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND key = 'member'),
  1,
  'seed: Członek ma wliczony bilet (v6.1)'
);

SELECT ok(
  NOT (SELECT features ? 'early_access' FROM public.membership_tiers
        WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND key = 'member'),
  'seed: Członek NIE ma wczesnego dostępu (od v6 to benefit Pro)'
);

SELECT ok(
  (SELECT (features ->> 'chatham_house_events')::boolean AND (features ->> 'early_access')::boolean
     FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND key = 'pro'),
  'seed: Członek Pro ma Chatham House i wczesny dostęp'
);

SELECT is(
  (SELECT (features ->> 'included_event_tickets_org')::int FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND key = 'team'),
  3,
  'seed: Zespół ma pulę 3 biletów na organizację'
);

SELECT is(
  (SELECT count(*)::int FROM public.pricing_faq_items
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1'
      AND question_pl = 'Jak działa rozliczenie planu Partner Biznesowy?' AND active),
  0,
  'seed: FAQ wycofanego Partnera Biznesowego nie jest aktywne'
);

SELECT is(
  (SELECT count(*)::int FROM public.pricing_faq_items
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1'
      AND question_pl = 'Czym plan korporacyjny różni się od zespołowego?' AND active),
  0,
  'seed: FAQ ukrytej oferty korporacyjnej nie jest aktywne'
);

SELECT ok(
  (SELECT benefits::text NOT LIKE '%pytań do archiwum%' AND benefits::text LIKE '%Klub%'
     FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000a1' AND key = 'pro'),
  'seed: benefity Pro z v6.2, bez obietnic [N] (pytania do archiwum)'
);

-- ── 2. Najemca istniejący w stanie v3 ────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name)
VALUES ('6e620000-0000-4000-8000-0000000000b2', 'v62-legacy', 'V62 Legacy');

-- Odtworzenie stanu sprzed v6.2: nazwy i ceny v3, wyróżnienie Plus,
-- Partner Biznesowy w sprzedaży, brak rocznego planu studenckiego - oraz
-- RĘCZNA flaga admina, której apply nie może zgubić.
UPDATE public.membership_tiers
   SET name_pl = 'Plus', name_en = 'Plus', highlight = true, badge_pl = 'Najpopularniejszy'
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND key = 'member';
UPDATE public.membership_tiers
   SET highlight = false, badge_pl = NULL, badge_en = NULL
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND key = 'pro';
UPDATE public.membership_tiers
   SET pricing_visible = true
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND key IN ('business', 'corporate');
UPDATE public.membership_tiers
   SET features = features || '{"regulatory_monitoring": true}'::jsonb
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND key = 'team';
UPDATE public.access_plans SET price_cents = 5900, name_pl = 'Plus - miesięcznie'
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'member' AND interval = 'month';
UPDATE public.access_plans SET price_cents = 12900
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'pro' AND interval = 'month';
UPDATE public.access_plans SET price_cents = 9900
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'team';
DELETE FROM public.access_plans
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'student' AND interval = 'year';
INSERT INTO public.access_plans
  (tenant_id, name_pl, name_en, price_cents, currency, interval, active, sort_order, tier_key, trial_days)
VALUES ('6e620000-0000-4000-8000-0000000000b2', 'Partner Biznesowy - miesięcznie',
        'Business Partner - monthly', 99000, 'PLN', 'month', true, 90, 'business', 7);

-- Trzeci najemca z CELOWO innym cennikiem: dowód, że apply najemcy B nie
-- sięga poza `p_tenant` (zgubiony filtr najemcy zmieniłby te wiersze).
INSERT INTO public.tenants (id, slug, name)
VALUES ('6e620000-0000-4000-8000-0000000000c3', 'v62-other', 'V62 Other');
UPDATE public.membership_tiers
   SET name_pl = 'Plus', highlight = true, pricing_visible = true
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3' AND key IN ('member', 'corporate');
UPDATE public.access_plans SET price_cents = 5900, name_pl = 'Plus - miesięcznie'
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3' AND tier_key = 'member' AND interval = 'month';
UPDATE public.access_plans SET price_cents = 9900, for_sale = true
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3' AND tier_key = 'team';
DELETE FROM public.access_plans
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3' AND tier_key = 'student' AND interval = 'year';
UPDATE public.pricing_faq_items SET active = true
 WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3'
   AND question_pl = 'Jak działa rozliczenie planu Partner Biznesowy?';
CREATE TEMP TABLE v62_other_before AS
  SELECT 'tier'::text AS kind, id, ctid::text AS ct FROM public.membership_tiers
   WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3'
  UNION ALL
  SELECT 'plan', id, ctid::text FROM public.access_plans
   WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3'
  UNION ALL
  SELECT 'faq', id, ctid::text FROM public.pricing_faq_items
   WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3';

SELECT lives_ok(
  $$SELECT public.apply_pricing_catalog_v62('6e620000-0000-4000-8000-0000000000b2')$$,
  'apply: przebiega na najemcy w stanie v3'
);

SELECT results_eq(
  $$SELECT tier_key, interval::text, price_cents FROM public.access_plans
     WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2'
       AND tier_key IN ('member', 'pro', 'team') AND interval = 'month'
     ORDER BY sort_order$$,
  $$VALUES ('member', 'month', 3900), ('pro', 'month', 11900), ('team', 'month', 8900)$$,
  'apply: ceny v6.2 po (tier_key, interval)'
);

SELECT is(
  (SELECT name_pl FROM public.access_plans
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'member' AND interval = 'month'),
  'Członek - miesięcznie',
  'apply: nazwa planu v6.2'
);

SELECT is(
  (SELECT name_pl || '/' || highlight::text FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND key = 'member'),
  'Członek/false',
  'apply: Członek po nazwie v6.2 i bez wyróżnienia'
);

SELECT is(
  (SELECT highlight FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND key = 'pro'),
  true,
  'apply: wyróżnienie przeniesione na Członka Pro'
);

SELECT is(
  (SELECT (features ->> 'regulatory_monitoring')::boolean FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND key = 'team'),
  true,
  'apply: ręczna flaga admina w features ZOSTAJE (apply nie rusza mechaniki)'
);

SELECT results_eq(
  $$SELECT active, for_sale FROM public.access_plans
     WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'business'$$,
  $$VALUES (true, false)$$,
  'apply: Partner Biznesowy poza sprzedażą, ale AKTYWNY (odnowienia obecnych klientów)'
);

SELECT results_eq(
  $$SELECT active, for_sale FROM public.access_plans
     WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'team'$$,
  $$VALUES (true, false)$$,
  'apply: Zespół sprzedawany przez rozmowę (poza kasą), plan AKTYWNY dla obecnych zespołów'
);

SELECT is(
  (SELECT price_cents FROM public.access_plans
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'business'),
  99000,
  'apply: cena Partnera Biznesowego bez zmian (obecni zachowują cenę)'
);

SELECT is(
  (SELECT array_agg(key ORDER BY key) FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND NOT pricing_visible),
  ARRAY['business', 'corporate', 'supporter'],
  'apply: karty Enterprise, Partnera Biznesowego i Wspierającego ukryte'
);

SELECT results_eq(
  $$SELECT price_cents, trial_days FROM public.access_plans
     WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'student' AND interval = 'year'$$,
  $$VALUES (19000, 7)$$,
  'apply: dołożony roczny plan studencki 190 zł z trialem planu miesięcznego'
);

-- ── 3. Idempotencja: drugie apply nie tworzy nowych wersji krotek ────────────
CREATE TEMP TABLE v62_before AS
  SELECT 'tier'::text AS kind, id, ctid::text AS ct FROM public.membership_tiers
   WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2'
  UNION ALL
  SELECT 'plan', id, ctid::text FROM public.access_plans
   WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2';

SELECT public.apply_pricing_catalog_v62('6e620000-0000-4000-8000-0000000000b2');

SELECT is(
  (SELECT count(*)::int FROM v62_before b
     LEFT JOIN public.membership_tiers t ON b.kind = 'tier' AND t.id = b.id
     LEFT JOIN public.access_plans p ON b.kind = 'plan' AND p.id = b.id
    WHERE COALESCE(t.ctid::text, p.ctid::text) IS DISTINCT FROM b.ct),
  0,
  'idempotencja: drugie apply nie aktualizuje żadnego wiersza'
);

SELECT is(
  (SELECT count(*)::int FROM public.access_plans
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000b2' AND tier_key = 'student' AND interval = 'year'),
  1,
  'idempotencja: plan studencki roczny nie jest dokładany drugi raz'
);

-- ── 4. Izolacja: trzeci najemca bez zmian po dwóch apply najemcy B ──────────
SELECT is(
  (SELECT count(*)::int FROM v62_other_before b
     LEFT JOIN public.membership_tiers t ON b.kind = 'tier' AND t.id = b.id
     LEFT JOIN public.access_plans p ON b.kind = 'plan' AND p.id = b.id
     LEFT JOIN public.pricing_faq_items f ON b.kind = 'faq' AND f.id = b.id
    WHERE COALESCE(t.ctid::text, p.ctid::text, f.ctid::text) IS DISTINCT FROM b.ct),
  0,
  'izolacja: apply najemcy B nie zapisał ŻADNEGO progu, planu ani FAQ innego najemcy'
);

SELECT results_eq(
  $$SELECT tier_key, price_cents, name_pl, for_sale FROM public.access_plans
     WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3'
       AND tier_key IN ('member', 'team') AND interval = 'month'
     ORDER BY tier_key$$,
  $$VALUES ('member', 5900, 'Plus - miesięcznie', true),
           ('team', 9900, 'Zespół - za miejsce, miesięcznie', true)$$,
  'izolacja: ceny, nazwy i sprzedaż planów innego najemcy bez zmian'
);

SELECT is(
  (SELECT name_pl || '/' || highlight::text || '/' || pricing_visible::text
     FROM public.membership_tiers
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3' AND key = 'member'),
  'Plus/true/true',
  'izolacja: prezentacja progu innego najemcy bez zmian'
);

SELECT is(
  (SELECT count(*)::int FROM public.access_plans
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3'
      AND tier_key = 'student' AND interval = 'year'),
  0,
  'izolacja: roczny plan studencki NIE jest dokładany innemu najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.pricing_faq_items
    WHERE tenant_id = '6e620000-0000-4000-8000-0000000000c3'
      AND question_pl = 'Jak działa rozliczenie planu Partner Biznesowy?' AND active),
  1,
  'izolacja: FAQ innego najemcy zostaje aktywne'
);

SELECT throws_ok(
  $$SELECT public.apply_pricing_catalog_v62(NULL)$$,
  '22004', NULL,
  'apply bez najemcy jest odrzucane'
);

-- ── 5. ACL i search_path ─────────────────────────────────────────────────────
SELECT ok(
  NOT (SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))
         FROM unnest(ARRAY['anon', 'authenticated']) r,
              unnest(ARRAY[
                'public.apply_pricing_catalog_v62(uuid)',
                'public.seed_pricing_plans_v62(uuid)',
                'public.seed_decision_lab_product(uuid)',
                'public.seed_membership_tiers(uuid)',
                'public.seed_pricing_defaults(uuid)',
                'public.pricing_catalog_v62_rows()',
                'public.pricing_catalog_v62_benefits()'
              ]) f),
  'ACL: anon i authenticated nie wołają funkcji katalogu v6.2'
);

SELECT ok(
  (SELECT bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
     FROM unnest(ARRAY[
       'public.apply_pricing_catalog_v62(uuid)',
       'public.seed_pricing_plans_v62(uuid)',
       'public.seed_decision_lab_product(uuid)',
       'public.pricing_catalog_v62_rows()',
       'public.pricing_catalog_v62_benefits()'
     ]) f),
  'ACL: service_role woła funkcje katalogu v6.2'
);

SELECT is(
  (SELECT count(*)::int FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('apply_pricing_catalog_v62', 'seed_pricing_plans_v62',
                        'seed_decision_lab_product', 'seed_membership_tiers',
                        'seed_pricing_defaults', 'pricing_catalog_v62_rows',
                        'pricing_catalog_v62_benefits', 'payment_orders_secure_insert')
      AND 'search_path=public, pg_temp' = ANY (p.proconfig)),
  8,
  'search_path=public, pg_temp na wszystkich funkcjach v6.2'
);

SELECT is(
  (SELECT count(*)::int FROM public.pricing_catalog_v62_rows()),
  14,
  'katalog v6.2: 14 progów (bez wpisu technicznego decision_lab)'
);

SELECT is(
  (SELECT count(*)::int FROM public.pricing_catalog_v62_rows() r
     LEFT JOIN public.pricing_catalog_v62_benefits() b ON b.key = r.key
    WHERE b.key IS NULL OR jsonb_array_length(b.benefits) = 0),
  0,
  'katalog v6.2: każdy próg ma benefity'
);

SELECT is(
  (SELECT count(*)::int FROM public.tenants t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.access_plans p
       WHERE p.tenant_id = t.id AND p.tier_key IN ('business', 'decision_lab', 'team') AND p.for_sale
         -- Trzeci najemca testu izolacji celowo wraca do stanu sprzed v6.2.
         AND t.id <> '6e620000-0000-4000-8000-0000000000c3'
    )),
  (SELECT count(*)::int FROM public.tenants),
  'backfill: u ŻADNEGO najemcy Partner Biznesowy, Decision Lab ani Zespół nie są w sprzedaży samoobsługowej'
);

SELECT * FROM finish();
ROLLBACK;
