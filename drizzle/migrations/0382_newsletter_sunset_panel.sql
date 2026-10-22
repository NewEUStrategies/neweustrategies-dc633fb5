-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y1, 7/8): RETENCJA DANYCH - LISTA „DO
-- WYGASZENIA" I WYKLUCZENIA W KARCIE „RETENCJA DANYCH"
-- (/admin/settings/privacy). Decyzja właściciela 2026-10-20 (Z-I9c-08)
-- i wymóg „wszystko w panelu admina".
--
-- DEFEKT: wygaszanie (20261020161900-162000) nie ma wejścia w panelu - admin
-- najemcy nie widzi, kto dostanie prośbę o potwierdzenie i kto zostanie
-- usunięty, ani nie może wykluczyć adresu (np. partner, prenumerata
-- instytucjonalna czytana na innym adresie).
--
-- ZMIANA (admin najemcy z SESJI - `_data_retention_admin_tenant`, rola
-- admin albo super_admin; najemca nigdy z argumentu):
--   A. `admin_data_retention_newsletter_due(limit)` - liczby (kandydaci do
--      prośby w najbliższym przebiegu, prośby czekające na wysyłkę, wysłane
--      czekające na reakcję, po terminie - do usunięcia w najbliższym
--      przebiegu, wykluczeni), lista (cykle po terminie usunięcia, potem
--      kandydaci) z ostatnim zaangażowaniem, lista wykluczonych z powodem,
--      reguły (30 dni na reakcję, dzienny limit próśb), stan pomiaru otwarć
--      (dymek: przy wyłączonym zaangażowanie liczy się bez otwarć).
--   B. `admin_data_retention_newsletter_exclude(subskrybent, powód)` -
--      wykluczenie z powodem 3-500 znaków (dłuższy odrzucony, nie skrócony;
--      22023 `reason_length`), subskrybent najemcy z sesji (P0002
--      `subscriber_not_found`), cykl w toku anulowany, `audit_log`
--      (`data_retention.newsletter_excluded`, encja = id subskrybenta - bez
--      adresu), zdarzenie `data_retention.changed.v1`.
--   C. `admin_data_retention_newsletter_include(subskrybent, powód)` -
--      cofnięcie wykluczenia z powodem (P0002 `exclusion_not_found`),
--      `audit_log` (`data_retention.newsletter_exclusion_removed`), zdarzenie.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162000. Panel woła RPC literałami; przed
-- wdrożeniem dostaje PGRST202/42883 i pokazuje „źródło niewdrożone".
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/hub_i9d_newsletter_sunset_test.sql (rola, najemca
-- z sesji, powód, audyt, zdarzenie, lista).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Lista „do wygaszenia".
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_data_retention_newsletter_due (counts, items, excluded,
-- response_days, daily_cap, open_tracking_enabled, enabled, enforced,
-- cutoff, period_months)
CREATE OR REPLACE FUNCTION public.admin_data_retention_newsletter_due(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustra DATA_RETENTION_RULES.newsletterResponseDays / newsletterDailyCap
  -- (te same stałe co `_data_retention_newsletter_inactive` i claim).
  c_response_days constant integer := 30;
  c_daily_cap constant integer := 200;
  -- Sufit licznika kandydatów (jak podgląd karty).
  c_cap constant integer := 100000;
  v_tenant uuid := public._data_retention_admin_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_track boolean := public._newsletter_track_opens(v_tenant);
  v_set record;
  v_enabled boolean;
  v_counts jsonb;
  v_items jsonb;
  v_excluded jsonb;
BEGIN
  SELECT * INTO v_set FROM public._data_retention_effective(v_tenant) e WHERE e.category = 'newsletter_inactive';
  v_enabled := COALESCE(v_set.enabled, false);

  SELECT jsonb_build_object(
           'candidates', CASE WHEN v_enabled THEN (SELECT count(*) FROM
                           public._data_retention_newsletter_candidates(v_tenant, v_set.cutoff, c_cap)) ELSE 0 END,
           'requested', count(*) FILTER (WHERE q.mailed_at IS NULL),
           'mailed', count(*) FILTER (WHERE q.mailed_at IS NOT NULL),
           'due', count(*) FILTER (WHERE q.mailed_at < now() - make_interval(days => c_response_days)),
           'excluded', (SELECT count(*) FROM public.newsletter_sunset_exclusions x WHERE x.tenant_id = v_tenant))
    INTO v_counts
    FROM public.newsletter_sunset_requests q WHERE q.tenant_id = v_tenant;

  -- Najpierw cykle (najbliższy termin usunięcia na górze), potem kandydaci
  -- najbliższego przebiegu.
  WITH cycles AS (
    SELECT q.subscriber_id, CASE WHEN q.mailed_at IS NULL THEN 'requested' ELSE 'mailed' END AS state,
           q.requested_at, q.mailed_at, q.mail_outcome,
           q.mailed_at + make_interval(days => c_response_days) AS delete_after
      FROM public.newsletter_sunset_requests q WHERE q.tenant_id = v_tenant
  ), candidates AS (
    SELECT c.subscriber_id, 'candidate'::text AS state, NULL::timestamptz AS requested_at,
           NULL::timestamptz AS mailed_at, NULL::text AS mail_outcome, NULL::timestamptz AS delete_after
      FROM public._data_retention_newsletter_candidates(v_tenant, v_set.cutoff, v_limit) c
     WHERE v_enabled
  ), picked AS (
    SELECT * FROM (SELECT * FROM cycles UNION ALL SELECT * FROM candidates) u
     ORDER BY (u.state = 'candidate'), u.delete_after NULLS LAST, u.requested_at NULLS LAST, u.subscriber_id
     LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subscriber_id', p.subscriber_id, 'email', s.email, 'first_name', s.first_name,
           'last_name', s.last_name, 'language', CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END,
           'state', p.state, 'last_engaged_at', public._newsletter_last_engagement(s.id, v_track),
           'requested_at', p.requested_at, 'mailed_at', p.mailed_at, 'mail_outcome', p.mail_outcome,
           'delete_after', p.delete_after)
         ORDER BY (p.state = 'candidate'), p.delete_after NULLS LAST, p.requested_at NULLS LAST, p.subscriber_id),
         '[]'::jsonb)
    INTO v_items
    FROM picked p JOIN public.newsletter_subscribers s ON s.id = p.subscriber_id AND s.tenant_id = v_tenant;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subscriber_id', x.subscriber_id, 'email', s.email, 'reason', x.reason, 'created_at', x.created_at)
         ORDER BY x.created_at DESC, x.subscriber_id), '[]'::jsonb)
    INTO v_excluded
    FROM (SELECT * FROM public.newsletter_sunset_exclusions x0 WHERE x0.tenant_id = v_tenant
           ORDER BY x0.created_at DESC, x0.subscriber_id LIMIT v_limit) x
    JOIN public.newsletter_subscribers s ON s.id = x.subscriber_id;

  RETURN jsonb_build_object(
    'counts', v_counts, 'items', v_items, 'excluded', v_excluded,
    'response_days', c_response_days, 'daily_cap', c_daily_cap, 'open_tracking_enabled', v_track,
    'enabled', v_enabled, 'enforced', COALESCE(v_set.enforced, false), 'cutoff', v_set.cutoff,
    'period_months', v_set.period_months);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_data_retention_newsletter_due(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_newsletter_due(integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Wykluczenie adresu z wygaszania.
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_data_retention_newsletter_exclude (subscriber_id, excluded, cycle_cancelled)
CREATE OR REPLACE FUNCTION public.admin_data_retention_newsletter_exclude(p_subscriber_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_RULES.crmExtensionReason* (jeden limit powodu karty).
  c_reason_min constant integer := 3;
  c_reason_max constant integer := 500;
  v_tenant uuid := public._data_retention_admin_tenant();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_cancelled integer := 0;
BEGIN
  IF char_length(v_reason) < c_reason_min OR char_length(v_reason) > c_reason_max THEN
    RAISE EXCEPTION 'reason_length' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.newsletter_subscribers s
                  WHERE s.id = p_subscriber_id AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'subscriber_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.newsletter_sunset_exclusions AS x (subscriber_id, tenant_id, reason, created_by, created_at)
  VALUES (p_subscriber_id, v_tenant, v_reason, auth.uid(), now())
  ON CONFLICT (subscriber_id) DO UPDATE
     SET reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at;
  -- Wykluczony nie dostaje prośby i nie zostanie usunięty - cykl w toku znika.
  DELETE FROM public.newsletter_sunset_requests q WHERE q.subscriber_id = p_subscriber_id AND q.tenant_id = v_tenant;
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, auth.uid(), 'data_retention.newsletter_excluded', 'newsletter_subscriber', p_subscriber_id,
          jsonb_build_object('reason', v_reason, 'cycle_cancelled', v_cancelled > 0));
  PERFORM public._data_retention_emit(v_tenant, 'exclusion', 'newsletter_inactive');
  RETURN jsonb_build_object('subscriber_id', p_subscriber_id, 'excluded', true, 'cycle_cancelled', v_cancelled > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_data_retention_newsletter_exclude(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_newsletter_exclude(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Cofnięcie wykluczenia.
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_data_retention_newsletter_include (subscriber_id, excluded)
CREATE OR REPLACE FUNCTION public.admin_data_retention_newsletter_include(p_subscriber_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_RULES.crmExtensionReason*.
  c_reason_min constant integer := 3;
  c_reason_max constant integer := 500;
  v_tenant uuid := public._data_retention_admin_tenant();
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF char_length(v_reason) < c_reason_min OR char_length(v_reason) > c_reason_max THEN
    RAISE EXCEPTION 'reason_length' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.newsletter_sunset_exclusions x
   WHERE x.subscriber_id = p_subscriber_id AND x.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exclusion_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, auth.uid(), 'data_retention.newsletter_exclusion_removed', 'newsletter_subscriber',
          p_subscriber_id, jsonb_build_object('reason', v_reason));
  PERFORM public._data_retention_emit(v_tenant, 'exclusion', 'newsletter_inactive');
  RETURN jsonb_build_object('subscriber_id', p_subscriber_id, 'excluded', false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_data_retention_newsletter_include(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_newsletter_include(uuid, text) TO authenticated, service_role;
