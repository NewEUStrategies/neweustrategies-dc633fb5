-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S7, 1/3): FAKTY DIAGNOSTYKI - OBSZARY SPRZEDAŻY
-- (`_revenue_facts_<obszar>` dla katalogu, paywalla, licznika, kasy, kuponów,
-- retencji, windykacji i lejka). Obszary operacyjne i RPC panelu
-- `admin_revenue_facts()` - 20261020150050 (podział na limit 45 KiB).
-- pg-harness: exclude
--
-- Znacznik wyżej jest DYREKTYWĄ dla scripts/pg-harness/run.sh: ta dostawa
-- (razem z 20261020150050, gdzie fakty klubów czytają `public.club_applications`)
-- czyta katalog, CRM, ścieżki i księgę przychodu, których atrapa harnessu
-- klubów nie ma - wciągnięta po treści wywróciłaby cały przebieg.
--
-- DEFEKT
--   1. Regresje naprawionych defektów (P01, P02, P03, P05, P07, P14, P17, P19,
--      P24, D1, D13 z briefów) i błędy konfiguracji (plan bez warstwy, kasa
--      bez pary w katalogu, nadawca domyślny newslettera, zatrzymany silnik
--      ścieżek, milczący emiter szyny…) wychodzą dziś przy reklamacji
--      klienta albo nigdy. Każdy moduł widzi tylko swoje tabele, a admin nie
--      ma jednego miejsca, które powie „tu przepływ przychodu jest zepsuty".
--   2. Reguła liczona w przeglądarce z surowych tabel to 16 odczytów,
--      dane osobowe w sieci i polityki RLS innych modułów - redaktor nie
--      dostałby połowy faktów, a wynik zależałby od tego, co RLS przepuści.
--
-- ZMIANA
--   A. `_revenue_facts_<obszar>(p_tenant uuid) RETURNS jsonb` × 16 (obszary =
--      `HUB_FACT_AREAS` w src/lib/ci/hubDelivery.ts; tu osiem pierwszych,
--      reszta w 20261020150050) - wewnętrzne (REVOKE od
--      PUBLIC, anon, authenticated; bez GRANT): LICZBY, flagi i identyfikatory
--      (uuid albo klucz) - zero adresów, nazwisk, treści i tokenów. Kształt
--      = `RevenueFacts v1` (src/lib/revenue/diagnostics/facts.ts, klucze
--      camelCase, bo fakty nie mają drugiego czytelnika poza tym parserem).
--      Czego nie da się policzyć, to BRAK klucza albo `null` - reguła TS mówi
--      wtedy „nie wiadomo", nigdy „w porządku".
--   B. (20261020150050) `admin_revenue_facts()` - RPC panelu: bramka
--      `is_admin_or_editor()` (42501), najemca `current_tenant_id()` (NIGDY z parametru),
--      `SET statement_timeout = '5s'`, wynik `{v:1, computedAt, areas}`.
--      Awaria jednego obszaru = `null` tego obszaru (reszta diagnozy działa),
--      a nie wyjątek całego RPC. Kwoty (`catalog.plans[].priceCents`,
--      `dataQuality.ledgerDrift`, `dataQuality.mrrCatalogBasis`) tylko dla
--      `has_role(…, 'admin')` - redaktor dostaje `null` (SPEC §2.5).
--   Progi operacyjne (okna 24 h / 7 d / 30 d / 90 d, „wygasa w 14 dni",
--   „wniosek czeka > 7 / > 30 dni", limit 20 miejsc Zespołu) to stałe
--   z uzasadnieniem przy zapytaniu i lustrem w TS - nie benchmarki.
--
-- KOLEJNOŚĆ WDROŻENIA: po blokach huba 2026102009…2026102014 (tabele I0,
-- katalog S2 `billing_catalog_entry`, `_revenue_mrr_at`, księga MRR,
-- `paywall_hits`, `journey_*`). NIEZALEŻNA od bloku I9 2026102016*: nie
-- czyta `data_retention_*`, `funnel_paywall_daily`, `metering_events_daily`,
-- `newsletter_campaign_engagement_archive` ani `crm_leads.anonymized_at`,
-- nie woła `_funnel_counts` ani żadnej funkcji I9. Wszystkie funkcje są
-- `LANGUAGE plpgsql` (ciało nie jest walidowane przy CREATE), więc
-- odtworzenie w kolejności wersji (15 → 16) i produkcja w kolejności
-- dziennika drizzle (16 → 15) dają ten sam stan. Zero DDL tabel.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- bezstanowe REVOKE/GRANT.
-- Podział na dwa pliki to wyłącznie limit Lovable (45 KiB): obie wersje są
-- w bloku S7, a RPC z 150050 woła helpery z tego pliku dopiero przy
-- wywołaniu (plpgsql), więc kolejność 150000 → 150050 nie jest warunkiem
-- poprawności CREATE.
-- DOWÓD: supabase/tests/revenue_facts_test.sql (dwóch najemców, kształt v:1,
-- editor bez kwot, brak PII, czas < statement_timeout, ACL), kontrakt TS:
-- src/lib/revenue/diagnostics/__tests__/facts.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1) Katalog: plany, warstwy, dryf ceny operatora, ceny nieznane, migracje
-- cen bez zawiadomienia (P07), Zespół ponad limit miejsc (Z-I9b-06).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_catalog(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plans jsonb;
  v_tiers jsonb;
  v_drift jsonb;
  v_unknown jsonb;
  v_migr jsonb;
  v_seats jsonb;
BEGIN
  -- Para katalogowa jak w macierzy oferty (110700): wpis lustra po warstwie
  -- i cyklu, bez `legacy`; plan jednorazowy pary nie potrzebuje.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'tierKey', p.tier_key, 'tierFound', t.key IS NOT NULL,
           'tierRank', t.rank, 'active', p.active, 'forSale', p.for_sale,
           'interval', p.interval::text, 'currency', upper(p.currency),
           'priceCents', p.price_cents,
           'catalogPair', p.interval::text = 'one_time' OR EXISTS (
             SELECT 1 FROM public.billing_catalog_entry(NULL) c
              WHERE NOT c.legacy AND c.tier_key = p.tier_key AND c.billing_interval = p.interval::text)
         ) ORDER BY p.sort_order, p.id), '[]'::jsonb)
    INTO v_plans
    FROM public.access_plans p
    LEFT JOIN public.membership_tiers t ON t.tenant_id = p.tenant_id AND t.key = p.tier_key
   WHERE p.tenant_id = p_tenant;

  -- Flagi i klucze obietnic to identyfikatory uprawnień (`features` = true,
  -- `benefits[].capability_key`), nie tekst karty - porównuje je TS (P20).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', t.id, 'key', t.key, 'rank', t.rank, 'active', t.active,
           'pricingVisible', t.pricing_visible, 'isDefault', t.is_default, 'ctaMode', t.cta_mode,
           'plansForSale', (SELECT count(*) FROM public.access_plans p
                             WHERE p.tenant_id = p_tenant AND p.tier_key = t.key AND p.active AND p.for_sale),
           'plansNotForSale', (SELECT count(*) FROM public.access_plans p
                                WHERE p.tenant_id = p_tenant AND p.tier_key = t.key AND NOT p.for_sale),
           'featureKeys', COALESCE((
             SELECT jsonb_agg(f.key ORDER BY f.key)
               FROM jsonb_each(CASE WHEN jsonb_typeof(t.features) = 'object' THEN t.features ELSE '{}'::jsonb END) f
              WHERE f.value = 'true'::jsonb), '[]'::jsonb),
           'capabilityKeys', COALESCE((
             SELECT jsonb_agg(DISTINCT b ->> 'capability_key' ORDER BY b ->> 'capability_key')
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.benefits) = 'array' THEN t.benefits ELSE '[]'::jsonb END) b
              WHERE jsonb_typeof(b) = 'object' AND (b ->> 'capability_key') ~ '^[a-z0-9_.:-]{1,64}$'), '[]'::jsonb)
         ) ORDER BY t.rank, t.key), '[]'::jsonb)
    INTO v_tiers
    FROM public.membership_tiers t
   WHERE t.tenant_id = p_tenant;

  -- Dryf: subskrypcja live pobiera inną kwotę niż plan tej warstwy i cyklu
  -- w tej samej walucie. Cennik wolumenowy (Zespół) ma kwotę zależną od
  -- liczby miejsc - pomijany, bo „inna kwota" jest tam normą.
  WITH subs AS (
    SELECT s.unit_amount_minor, upper(s.currency) AS currency, c.tier_key, c.billing_interval
      FROM public.subscriptions s
      CROSS JOIN LATERAL public.billing_catalog_entry(s.price_id) c
     WHERE s.tenant_id = p_tenant AND s.environment = 'live'
       AND s.status IN ('active', 'trialing', 'past_due')
       AND s.unit_amount_minor IS NOT NULL AND NOT c.volume_tiered
  ), drift AS (
    SELECT p.id, (p.active AND p.for_sale) AS selling, count(*) AS n
      FROM subs x
      JOIN public.access_plans p ON p.tenant_id = p_tenant AND p.tier_key = x.tier_key
                                AND p.interval::text = x.billing_interval AND upper(p.currency) = x.currency
     WHERE p.price_cents <> x.unit_amount_minor
     GROUP BY p.id, p.active, p.for_sale
  )
  SELECT jsonb_build_object(
           'forSale', COALESCE(sum(n) FILTER (WHERE selling), 0),
           'notForSale', COALESCE(sum(n) FILTER (WHERE NOT selling), 0),
           'refs', COALESCE(to_jsonb((array_agg(id ORDER BY n DESC, id))[1:20]), '[]'::jsonb))
    INTO v_drift FROM drift;

  -- Cena nieznana: `price_id` spoza lustra katalogu (MRR bez podstawy) albo
  -- brak kwoty od operatora (MRR liczony z ceny katalogowej).
  SELECT jsonb_build_object(
           'unknownPrice', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.billing_catalog_entry(s.price_id))),
           'missingAmount', count(*) FILTER (WHERE s.unit_amount_minor IS NULL
                                              AND EXISTS (SELECT 1 FROM public.billing_catalog_entry(s.price_id))))
    INTO v_unknown
    FROM public.subscriptions s
   WHERE s.tenant_id = p_tenant AND s.environment = 'live' AND s.status IN ('active', 'trialing', 'past_due');

  -- P07: przeniesienie ceny wykonane u operatora (90 dni) a zawiadomienie
  -- nie poszło. `pending` dłużej niż dobę = kolejka maili stoi; `failed`
  -- = klient zapłaci nową cenę bez słowa. `skipped` (obniżka) - bez uwag.
  SELECT jsonb_build_object(
           'applied', count(*),
           'pendingOver24h', count(*) FILTER (WHERE m.email_status = 'pending' AND m.applied_at < now() - interval '24 hours'),
           'failed', count(*) FILTER (WHERE m.email_status = 'failed'))
    INTO v_migr
    FROM public.subscription_price_migrations m
   WHERE m.tenant_id = p_tenant AND m.environment = 'live' AND m.status = 'applied'
     AND m.applied_at >= now() - interval '90 days';

  -- Z-I9b-06: Zespół ma u operatora więcej miejsc niż limit warstwy (20 =
  -- `TEAM_TIER_MAX_SEATS`, src/lib/organizations/teamSeats.ts) - synchronizacja
  -- miejsc odmawia; równo 20 = następny zakup miejsca też odmówi.
  SELECT jsonb_build_object(
           'over', count(*) FILTER (WHERE s.quantity > 20),
           'atCap', count(*) FILTER (WHERE s.quantity = 20),
           'refs', COALESCE(to_jsonb((array_agg(o.id ORDER BY s.quantity DESC, o.id) FILTER (WHERE s.quantity >= 20))[1:20]), '[]'::jsonb))
    INTO v_seats
    FROM public.member_organizations o
    JOIN public.subscriptions s ON s.tenant_id = o.tenant_id AND s.provider_subscription_id = o.provider_subscription_id
   WHERE o.tenant_id = p_tenant AND o.tier_key = 'team' AND o.status = 'active'
     AND s.status IN ('active', 'trialing', 'past_due');

  RETURN jsonb_build_object('plans', v_plans, 'tiers', v_tiers, 'providerPriceDrift', v_drift,
                            'unknownPriceSubscriptions', v_unknown, 'priceMigrations90d', v_migr,
                            'teamSeats', v_seats);
END;
$$;

-- ----------------------------------------------------------------------------
-- A2) Paywall: ślepe zaułki P14 (te same warunki co inwentarz 120400) z ruchem
-- z 30 dni, reguły z planami spoza sprzedaży i cisza pomiaru.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_paywall(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  WITH offer AS (
    SELECT mt.rank
      FROM public.access_plans ap
      JOIN public.membership_tiers mt ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key
     WHERE ap.tenant_id = p_tenant AND ap.active AND ap.for_sale
       AND mt.active AND COALESCE(mt.pricing_visible, true) AND COALESCE(mt.cta_mode, 'auto') = 'auto'
  ), premium AS (
    SELECT 1 FROM public.access_plans ap
      JOIN public.membership_tiers mt ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key
     WHERE ap.tenant_id = p_tenant AND ap.active AND ap.for_sale AND mt.active
       AND (mt.features ->> 'premium_content')::boolean IS TRUE
     LIMIT 1
  ), gated AS (
    SELECT ca.entity_type::text AS et, ca.entity_id, ca.mode::text AS mode,
           COALESCE(ca.min_tier_rank, 0) AS rank, ca.plan_ids, ca.one_time_price_cents, ca.created_at,
           EXISTS (SELECT 1 FROM public.paywall_hits h
                    WHERE h.tenant_id = p_tenant AND h.entity_type = ca.entity_type::text
                      AND h.entity_id = ca.entity_id AND h.last_at >= now() - interval '30 days') AS hit
      FROM public.content_access ca
     WHERE ca.tenant_id = p_tenant AND ca.mode IN ('members', 'paid')
  ), dead AS (
    SELECT g.*,
           CASE
             WHEN g.rank > 0 AND NOT EXISTS (SELECT 1 FROM offer o WHERE o.rank >= g.rank)
               THEN CASE WHEN g.mode = 'paid' THEN 'paid' ELSE 'members' END
             WHEN g.mode = 'paid' AND g.rank = 0 AND COALESCE(g.one_time_price_cents, 0) <= 0
              AND NOT EXISTS (SELECT 1 FROM public.access_plans ap
                               WHERE ap.id = ANY (g.plan_ids) AND ap.tenant_id = p_tenant AND ap.active AND ap.for_sale)
              AND NOT EXISTS (SELECT 1 FROM premium)
               THEN 'paid'
           END AS kind,
           ARRAY(SELECT pid FROM unnest(g.plan_ids) pid
                  WHERE NOT EXISTS (SELECT 1 FROM public.access_plans ap
                                     WHERE ap.id = pid AND ap.tenant_id = p_tenant AND ap.active AND ap.for_sale)) AS dead_plans
      FROM gated g
  ), dangling AS (
    -- Reguły dowolnego trybu ze wskazanym planem nieaktywnym albo usuniętym.
    SELECT ca.entity_type::text AS et, ca.entity_id,
           ARRAY(SELECT pid FROM unnest(ca.plan_ids) pid
                  WHERE NOT EXISTS (SELECT 1 FROM public.access_plans ap
                                     WHERE ap.id = pid AND ap.tenant_id = p_tenant AND ap.active AND ap.for_sale)) AS dead_plans,
           EXISTS (SELECT 1 FROM public.paywall_hits h
                    WHERE h.tenant_id = p_tenant AND h.entity_type = ca.entity_type::text
                      AND h.entity_id = ca.entity_id AND h.last_at >= now() - interval '30 days') AS hit
      FROM public.content_access ca
     WHERE ca.tenant_id = p_tenant AND cardinality(ca.plan_ids) > 0
  )
  SELECT jsonb_build_object(
    'gatedRules', (SELECT count(*) FROM gated),
    'firstGatedAt', (SELECT min(created_at) FROM gated),
    'lastHitAt', (SELECT max(h.last_at) FROM public.paywall_hits h WHERE h.tenant_id = p_tenant),
    'paidWithoutOffer', (SELECT jsonb_build_object(
        'count', count(*), 'withHits30d', count(*) FILTER (WHERE hit),
        'refs', COALESCE(to_jsonb((array_agg(et || ':' || entity_id ORDER BY hit DESC, entity_id))[1:20]), '[]'::jsonb))
        FROM dead WHERE kind = 'paid'),
    'membersRankNoCta', (SELECT jsonb_build_object(
        'count', count(*), 'withHits30d', count(*) FILTER (WHERE hit),
        'refs', COALESCE(to_jsonb((array_agg(et || ':' || entity_id ORDER BY hit DESC, entity_id))[1:20]), '[]'::jsonb))
        FROM dead WHERE kind = 'members'),
    'danglingRules', (SELECT jsonb_build_object(
        'count', count(*), 'withHits30d', count(*) FILTER (WHERE hit),
        'refs', COALESCE(to_jsonb((array_agg(et || ':' || entity_id ORDER BY hit DESC, entity_id))[1:20]), '[]'::jsonb),
        'planIds', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM dangling d2, unnest(d2.dead_plans) x), '[]'::jsonb))
        FROM dangling WHERE cardinality(dead_plans) > 0)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A3) Licznik artykułów: wiersz ustawień, limity, P19 (sonda ciała
-- `_metered_view_consume` - poprawka 120200 czyta `user_tier_rank`).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_metering(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.metering_settings%ROWTYPE;
  v_found boolean;
BEGIN
  SELECT * INTO v_row FROM public.metering_settings WHERE tenant_id = p_tenant;
  v_found := FOUND;
  RETURN jsonb_build_object(
    'settingsRow', v_found,
    'enabled', CASE WHEN v_found THEN v_row.enabled END,
    'anonMonthlyLimit', CASE WHEN v_found THEN v_row.anon_monthly_limit END,
    'memberMonthlyLimit', CASE WHEN v_found THEN v_row.member_monthly_limit END,
    'meteredRules', (SELECT count(*) FROM public.content_access ca
                      WHERE ca.tenant_id = p_tenant AND ca.mode IN ('members', 'paid')
                        AND COALESCE(ca.metering_policy, 'inherit') <> 'exempt'),
    'meteredTierGated', (SELECT count(*) FROM public.content_access ca
                          WHERE ca.tenant_id = p_tenant AND ca.mode IN ('members', 'paid')
                            AND COALESCE(ca.min_tier_rank, 0) > 0
                            AND COALESCE(ca.metering_policy, 'inherit') <> 'exempt'),
    -- NULL = funkcji nie ma (baza sprzed licznika) - reguła mówi „nie wiadomo".
    'rankGatePresent', (SELECT bool_or(p.prosrc ILIKE '%user_tier_rank%') FROM pg_proc p
                         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_metered_view_consume')
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- A4) Kasa: okno porzucenia i ścieżka porzuconej kasy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_checkout(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_minutes integer;
  v_found boolean;
BEGIN
  SELECT cs.abandon_after_minutes INTO v_minutes FROM public.checkout_settings cs WHERE cs.tenant_id = p_tenant;
  v_found := FOUND;
  RETURN jsonb_build_object(
    'settingsRow', v_found,
    'abandonAfterMinutes', v_minutes,
    'abandonedJourneyActive', EXISTS (SELECT 1 FROM public.journey_definitions j
                                       WHERE j.tenant_id = p_tenant AND j.status = 'active'
                                         AND j.template_key = 'abandoned_checkout'),
    -- Waluty planów w sprzedaży - TS porównuje je z walutą prezentacji (P09).
    'chargeCurrencies', COALESCE((SELECT jsonb_agg(DISTINCT upper(p.currency) ORDER BY upper(p.currency))
                                    FROM public.access_plans p
                                   WHERE p.tenant_id = p_tenant AND p.active AND p.for_sale), '[]'::jsonb)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- A5) Kupony: kampanie wysłane bez kodów, kody wygasające bez użycia (14 dni -
-- dwa tygodnie to najkrótsze okno, w którym admin zdąży przypomnieć
-- odbiorcom), P03 (kolumna `membership_grants.source_coupon_id`).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_coupons(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'sentWithoutCodes', (SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE c.valid_until IS NULL OR c.valid_until > now()),
        'expired', count(*) FILTER (WHERE c.valid_until <= now()),
        'refs', COALESCE(to_jsonb((array_agg(c.id ORDER BY c.updated_at DESC))[1:20]), '[]'::jsonb))
        FROM public.b2b_coupon_campaigns c
       WHERE c.tenant_id = p_tenant AND c.status = 'sent' AND c.generated_count = 0),
    'expiringUnused', (SELECT jsonb_build_object(
        'coupons', (SELECT count(*) FROM public.b2b_coupons k
                     WHERE k.tenant_id = p_tenant AND k.active AND k.redemptions_count = 0
                       AND k.valid_until > now() AND k.valid_until <= now() + interval '14 days'),
        'campaigns', count(*),
        'refs', COALESCE(to_jsonb((array_agg(c.id ORDER BY c.valid_until))[1:20]), '[]'::jsonb))
        FROM public.b2b_coupon_campaigns c
       WHERE c.tenant_id = p_tenant AND c.status = 'sent'
         AND c.valid_until > now() AND c.valid_until <= now() + interval '14 days'
         AND EXISTS (SELECT 1 FROM public.b2b_coupons k WHERE k.campaign_id = c.id AND k.tenant_id = p_tenant)
         AND NOT EXISTS (SELECT 1 FROM public.b2b_coupons k
                          WHERE k.campaign_id = c.id AND k.tenant_id = p_tenant AND k.redemptions_count > 0)),
    'grantTier', jsonb_build_object(
        'coupons', (SELECT count(*) FROM public.b2b_coupons k
                     WHERE k.tenant_id = p_tenant AND k.active AND k.grants_tier_key IS NOT NULL)
                 + (SELECT count(*) FROM public.b2b_coupon_campaigns c
                     WHERE c.tenant_id = p_tenant AND c.status <> 'archived' AND c.grants_tier_key IS NOT NULL),
        -- P03: bez tej kolumny skutek kuponu po płatności nie zapisze nadania.
        'columnPresent', EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_schema = 'public' AND table_name = 'membership_grants'
                                    AND column_name = 'source_coupon_id'))
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A6) Retencja: konfiguracja kontroferty, anulowania obok przepływu (P01),
-- oferta bez rabatu na subskrypcji (P02), wyniki przepływów (30 dni).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_retention(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rs public.retention_settings%ROWTYPE;
  v_found boolean;
  v_out jsonb;
BEGIN
  SELECT * INTO v_rs FROM public.retention_settings WHERE tenant_id = p_tenant;
  v_found := FOUND;

  WITH canc AS (
    SELECT s.id,
           EXISTS (SELECT 1 FROM public.retention_feedback rf
                    WHERE rf.tenant_id = p_tenant AND rf.subscription_id = s.id
                      AND rf.created_at >= now() - interval '30 days'
                      AND COALESCE(rf.reason_label, '') NOT LIKE 'stripe:%') AS in_app,
           EXISTS (SELECT 1 FROM public.retention_feedback rf
                    WHERE rf.tenant_id = p_tenant AND rf.subscription_id = s.id
                      AND rf.created_at >= now() - interval '30 days'
                      AND rf.reason_label LIKE 'stripe:%') AS provider
      FROM public.subscriptions s
     WHERE s.tenant_id = p_tenant AND s.environment = 'live' AND s.updated_at >= now() - interval '30 days'
       AND (s.status = 'canceled' OR s.cancel_at_period_end)
  )
  SELECT jsonb_build_object(
    'settingsRow', v_found,
    'enabled', CASE WHEN v_found THEN v_rs.enabled END,
    'discountPeriods', CASE WHEN v_found THEN v_rs.discount_periods END,
    'cancellations30d', (SELECT count(*) FROM canc),
    'flowBypass', (SELECT jsonb_build_object(
        'withoutFeedback', count(*) FILTER (WHERE NOT in_app AND NOT provider),
        'providerOnly', count(*) FILTER (WHERE NOT in_app AND provider),
        'refs', COALESCE(to_jsonb((array_agg(id ORDER BY id) FILTER (WHERE NOT in_app))[1:20]), '[]'::jsonb))
        FROM canc),
    -- Oferta przyjęta (okno 30 dni, starsza niż doba na webhook operatora),
    -- a subskrypcja bez rabatu: regresja P02 (kupon jednorazowy/niewykonalny).
    'acceptedWithoutDiscount30d', (SELECT count(*) FROM public.retention_feedback rf
        JOIN public.subscriptions s ON s.id = rf.subscription_id AND s.tenant_id = rf.tenant_id
       WHERE rf.tenant_id = p_tenant AND rf.offer_accepted
         AND rf.created_at >= now() - interval '30 days' AND rf.created_at < now() - interval '24 hours'
         AND (s.discount_minor_per_period = 0 OR s.discount_ends_at IS NULL)),
    'flows30d', (SELECT jsonb_build_object(
        'started', count(*), 'canceled', count(*) FILTER (WHERE rf.outcome = 'canceled'),
        'saved', count(*) FILTER (WHERE rf.outcome = 'saved'),
        'abandoned', count(*) FILTER (WHERE rf.outcome = 'abandoned'))
        FROM public.retention_feedback rf
       WHERE rf.tenant_id = p_tenant AND rf.flow_started_at >= now() - interval '30 days'
         AND COALESCE(rf.reason_label, '') NOT LIKE 'stripe:%')
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A7) Windykacja B2B: otwarte cykle subskrypcji organizacji bez zadania CRM
-- i bez ścieżki `payment_failed_crm`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_dunning(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  WITH b2b AS (
    SELECT d.id, d.user_id, d.started_at
      FROM public.dunning_cycles d
      JOIN public.subscriptions s ON s.id = d.subscription_id AND s.tenant_id = d.tenant_id
     WHERE d.tenant_id = p_tenant AND d.outcome = 'open' AND d.environment = 'live'
       AND EXISTS (SELECT 1 FROM public.member_organizations o
                    WHERE o.tenant_id = p_tenant AND o.provider_subscription_id = s.provider_subscription_id)
  ), handled AS (
    SELECT b.*, EXISTS (SELECT 1 FROM public.crm_tasks t JOIN public.crm_leads l ON l.id = t.lead_id
                         WHERE t.tenant_id = p_tenant AND l.user_id = b.user_id
                           AND t.created_at >= b.started_at AND t.status <> 'cancelled') AS task
      FROM b2b b
  )
  SELECT jsonb_build_object(
    'openB2b', count(*),
    'withoutTask', count(*) FILTER (WHERE NOT task),
    'journeyActive', EXISTS (SELECT 1 FROM public.journey_definitions j
                              WHERE j.tenant_id = p_tenant AND j.status = 'active'
                                AND j.template_key = 'payment_failed_crm'),
    'refs', COALESCE(to_jsonb((array_agg(id ORDER BY started_at) FILTER (WHERE NOT task))[1:20]), '[]'::jsonb)
  ) INTO v_out FROM handled;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A8) Lejek: atrybucja rejestracji (P16, biała lista jak 120000/120400)
-- i zapisy z popupu od posiadaczy kont (P17).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_funnel(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'signups30d', (SELECT count(*) FROM public.profiles p
                    WHERE p.tenant_id = p_tenant AND p.created_at >= now() - interval '30 days'),
    'unknownSource30d', (SELECT count(*) FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
                          WHERE p.tenant_id = p_tenant AND p.created_at >= now() - interval '30 days'
                            AND COALESCE(u.raw_user_meta_data ->> 'signup_source', '') NOT IN (
                              'auth_page', 'login_popup', 'popup', 'club_gate', 'register_widget',
                              'paywall', 'pricing', 'checkout', 'club_apply', 'join_us_form')),
    -- Zapis z popupu przez konto założone wcześniej (godzina zapasu na
    -- rejestrację i zapis w jednej wizycie) = popup dotarł do członka (P17).
    'popupMembers7d', (SELECT count(*) FROM public.newsletter_subscribers ns JOIN public.profiles p ON p.id = ns.user_id
                        WHERE ns.tenant_id = p_tenant AND ns.source = 'popup'
                          AND ns.created_at >= now() - interval '7 days'
                          AND p.created_at < ns.created_at - interval '1 hour'),
    'popupMembers30d', (SELECT count(*) FROM public.newsletter_subscribers ns JOIN public.profiles p ON p.id = ns.user_id
                         WHERE ns.tenant_id = p_tenant AND ns.source = 'popup'
                           AND ns.created_at >= now() - interval '30 days'
                           AND p.created_at < ns.created_at - interval '1 hour')
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- Helpery bez EXECUTE dla ról API (także service_role - SPEC §4.4): najemca
-- idzie parametrem, więc wywołanie z klienta byłoby odczytem cudzej firmy.
-- Woła je wyłącznie RPC `admin_revenue_facts` (20261020150050).
REVOKE ALL ON FUNCTION public._revenue_facts_catalog(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_paywall(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_metering(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_checkout(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_coupons(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_retention(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_dunning(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_funnel(uuid) FROM PUBLIC, anon, authenticated, service_role;
