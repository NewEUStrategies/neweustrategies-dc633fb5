-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S7, 2/3): FAKTY DIAGNOSTYKI - OBSZARY OPERACYJNE
-- (`_revenue_facts_<obszar>` dla CRM, newslettera, automatyzacji, ścieżek,
-- wydarzeń, klubów, synchronizacji i jakości danych) ORAZ RPC PANELU
-- `admin_revenue_facts()`. Obszary sprzedaży - 20261020150000.
-- pg-harness: exclude
--
-- Znacznik wyżej jest DYREKTYWĄ dla scripts/pg-harness/run.sh: fakty klubów
-- czytają `public.club_applications` i `public.clubs` razem z CRM, ścieżkami
-- i księgą przychodu, których atrapa harnessu klubów nie ma - wciągnięta po
-- treści wywróciłaby cały przebieg, nie wnosząc pokrycia.
--
-- DEFEKT: jak 20261020150000 - regresje naprawionych defektów (P17, P24,
-- D1, D13, br. 03 D7) i awarie operacyjne (silnik ścieżek zatrzymany przy
-- aktywnych ścieżkach, skrzynka zdarzeń stoi, emiter szyny ucichł, migawka
-- MRR rozjechana z księgą) nie mają dziś żadnego sygnału w panelu.
--
-- ZMIANA
--   A. `_revenue_facts_<obszar>(p_tenant uuid)` × 8 - wewnętrzne, bez EXECUTE
--      dla ról API; liczby, flagi i identyfikatory (uuid albo klucz), zero
--      PII; czego nie da się policzyć - `null` („nie wiadomo").
--   B. `admin_revenue_facts()` - RPC panelu (admin|editor, inaczej 42501),
--      najemca wyłącznie z `current_tenant_id()`, `SET statement_timeout =
--      '5s'`, wynik `{v:1, computedAt, areas{16}}`; awaria obszaru = `null`
--      obszaru; kwoty tylko dla administratora (redaktor: `null`).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020150000 (helpery obszarów sprzedaży - wołane
-- dopiero przy wywołaniu RPC, plpgsql nie waliduje ciała przy CREATE) i po
-- blokach huba 2026102009…2026102014. NIEZALEŻNA od bloku I9 2026102016*: nie
-- czyta `data_retention_*`, `funnel_paywall_daily`, `metering_events_daily`,
-- `newsletter_campaign_engagement_archive` ani `crm_leads.anonymized_at`, nie
-- woła `_funnel_counts` ani funkcji I9 (`_revenue_mrr_at` należy do S2).
-- Zero DDL tabel.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/revenue_facts_test.sql (dwóch najemców, kształt v:1,
-- editor bez kwot, brak PII, czas < statement_timeout, ACL), kontrakt TS:
-- src/lib/revenue/diagnostics/__tests__/facts.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A9) CRM: zadania automatów bez osoby (P24), leady kwalifikowane bez
-- właściciela, leady w cyklu konta bez konta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_crm(p_tenant uuid)
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
    'autoTasksUnassigned', (SELECT jsonb_build_object(
        'open', count(*), 'overdue', count(*) FILTER (WHERE t.due_at < now()))
        FROM public.crm_tasks t
       WHERE t.tenant_id = p_tenant AND t.status = 'open' AND t.assignee_id IS NULL AND t.source <> 'manual'),
    'qualifiedWithoutOwner', (SELECT jsonb_build_object(
        'mqlSql', count(*) FILTER (WHERE l.lifecycle_stage IN ('mql', 'sql')),
        'opportunity', count(*) FILTER (WHERE l.lifecycle_stage = 'opportunity'),
        'refs', COALESCE(to_jsonb((array_agg(l.id ORDER BY l.lifecycle_stage = 'opportunity' DESC, l.updated_at DESC))[1:20]), '[]'::jsonb))
        FROM public.crm_leads l
       WHERE l.tenant_id = p_tenant AND l.owner_id IS NULL AND l.lifecycle_stage IN ('mql', 'sql', 'opportunity')),
    'withoutUserId', (SELECT jsonb_build_object(
        'registered', count(*) FILTER (WHERE l.lifecycle_stage = 'registered'),
        'customer', count(*) FILTER (WHERE l.lifecycle_stage = 'customer'))
        FROM public.crm_leads l
       WHERE l.tenant_id = p_tenant AND l.user_id IS NULL AND l.lifecycle_stage IN ('registered', 'customer')),
    'defaultAssigneeSet', EXISTS (SELECT 1 FROM public.journey_settings js
                                   WHERE js.tenant_id = p_tenant AND js.default_task_assignee_id IS NOT NULL)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A10) Newsletter: DOI, nadawca domyślny (WYŁĄCZNIE flaga - adres nie
-- opuszcza bazy), wysyłki z 30 dni.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_newsletter(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ns public.newsletter_settings%ROWTYPE;
  v_found boolean;
BEGIN
  SELECT * INTO v_ns FROM public.newsletter_settings WHERE tenant_id = p_tenant;
  v_found := FOUND;
  RETURN jsonb_build_object(
    'settingsRow', v_found,
    'enabled', CASE WHEN v_found THEN v_ns.enabled END,
    'doubleOptIn', CASE WHEN v_found THEN v_ns.double_opt_in END,
    'popupEnabled', CASE WHEN v_found THEN v_ns.popup_enabled END,
    -- Brak wiersza = nadawca platformy (`onboarding@resend.dev`), czyli też domyślny.
    'defaultSender', NOT v_found OR COALESCE(btrim(v_ns.sender_email), '') = ''
                     OR lower(btrim(v_ns.sender_email)) = 'onboarding@resend.dev',
    'campaignsSent30d', (SELECT count(*) FROM public.newsletter_campaigns c
                          WHERE c.tenant_id = p_tenant AND c.status = 'sent'
                            AND COALESCE(c.finished_at, c.updated_at) >= now() - interval '30 days')
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- A11) Automatyzacje: D1 (przebieg „udany" bez kroków), D13 (przepis
-- anulowania odpala się na pauzie), lista włączonych do porównania ze ścieżkami.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_workflows(p_tenant uuid)
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
    'newsletterConfirmedNoop', (SELECT jsonb_build_object(
        'recent', count(*) FILTER (WHERE r.created_at >= now() - interval '7 days'),
        'older', count(*) FILTER (WHERE r.created_at < now() - interval '7 days'),
        'refs', COALESCE(jsonb_agg(DISTINCT w.id), '[]'::jsonb))
        FROM public.workflow_runs r JOIN public.workflow_definitions w ON w.id = r.workflow_id
       WHERE r.tenant_id = p_tenant AND w.template_key = 'newsletter-confirmed-to-crm'
         AND r.status = 'succeeded' AND r.steps_completed = 0
         AND r.created_at >= now() - interval '30 days'),
    'cancelRecipe', (SELECT jsonb_build_object(
        'id', w.id, 'enabled', w.enabled,
        -- Warunek z kluczem `paused` (np. `"paused": false`) odsiewa pauzę.
        'guarded', jsonb_typeof(w.condition) = 'object' AND w.condition ? 'paused',
        -- Pauza u operatora zapisuje dostęp jako `canceled`, więc przepis tworzy
        -- zadanie win-back, które billing zaraz anuluje (`closeRetentionTasks`,
        -- prefiks `retention:canceled:`) - takie zadanie to ślad odpalenia na pauzie.
        'cancelledByPause30d', (SELECT count(*) FROM public.crm_tasks t
                                 WHERE t.tenant_id = p_tenant AND t.origin_ref LIKE 'retention:canceled:%'
                                   AND t.status = 'cancelled' AND t.created_at >= now() - interval '30 days'))
        FROM public.workflow_definitions w
       WHERE w.tenant_id = p_tenant AND w.template_key = 'subscription-canceled-crm-task'
       ORDER BY w.created_at LIMIT 1),
    'enabled', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', w.id, 'templateKey', w.template_key,
                                                             'trigger', w.trigger_event_type) ORDER BY w.created_at)
                           FROM public.workflow_definitions w WHERE w.tenant_id = p_tenant AND w.enabled), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A12) Ścieżki: silnik, aktywne szablony, skrzynka, błędy kroków (24 h),
-- martwe kroki (wersja opublikowana > 14 dni z zapisami - dwa tygodniowe
-- cykle, krótsze okno myli „nikt jeszcze nie doszedł" z „nie da się dojść"),
-- grafy do wykrycia cykli wyzwalaczy (TS, `ACTION_EMITS`).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_journeys(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  WITH active AS (
    SELECT j.id, j.template_key, v.id AS version_id, v.trigger_event_type, v.reentry, v.graph, v.published_at
      FROM public.journey_definitions j
      LEFT JOIN public.journey_versions v ON v.id = j.published_version_id
     WHERE j.tenant_id = p_tenant AND j.status = 'active'
  ), dead AS (
    SELECT a.id,
           (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.graph -> 'nodes') = 'array' THEN a.graph -> 'nodes' ELSE '[]'::jsonb END) n
             WHERE n ->> 'type' <> 'trigger') AS total,
           (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.graph -> 'nodes') = 'array' THEN a.graph -> 'nodes' ELSE '[]'::jsonb END) n
             WHERE n ->> 'type' <> 'trigger'
               AND NOT EXISTS (SELECT 1 FROM public.journey_step_runs r
                                WHERE r.tenant_id = p_tenant AND r.version_id = a.version_id AND r.node_id = n ->> 'id')) AS unreached
      FROM active a
     WHERE a.published_at <= now() - interval '14 days'
       AND EXISTS (SELECT 1 FROM public.journey_enrollments e
                    WHERE e.tenant_id = p_tenant AND e.version_id = a.version_id AND NOT e.is_test)
  )
  SELECT jsonb_build_object(
    -- Brak wiersza = DOMYŚLNIE WYŁĄCZONY (kolumna `enabled DEFAULT false`, 090300).
    'engineEnabled', COALESCE((SELECT js.enabled FROM public.journey_settings js WHERE js.tenant_id = p_tenant), false),
    'activeCount', (SELECT count(*) FROM active),
    'activeTemplates', COALESCE((SELECT jsonb_agg(DISTINCT template_key) FROM active WHERE template_key IS NOT NULL), '[]'::jsonb),
    'pendingInbox', (SELECT count(*) FROM public.journey_event_inbox i WHERE i.tenant_id = p_tenant AND i.processed_at IS NULL),
    'oldestPendingAt', (SELECT min(i.received_at) FROM public.journey_event_inbox i
                         WHERE i.tenant_id = p_tenant AND i.processed_at IS NULL),
    'stepRuns24h', (SELECT jsonb_build_object(
        'finished', count(*), 'failed', count(*) FILTER (WHERE r.status IN ('failed', 'dead')))
        FROM public.journey_step_runs r
       WHERE r.tenant_id = p_tenant AND r.finished_at >= now() - interval '24 hours'
         AND r.status IN ('succeeded', 'skipped', 'failed', 'dead')),
    'deadSteps', COALESCE((SELECT jsonb_agg(jsonb_build_object('journeyId', d.id, 'unreached', d.unreached, 'total', d.total)
                                            ORDER BY d.unreached DESC, d.id)
                             FROM dead d WHERE d.unreached > 0), '[]'::jsonb),
    'deadJourneys', (SELECT count(*) FROM dead d WHERE d.total > 0 AND d.unreached = d.total),
    'graphs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'templateKey', a.template_key, 'trigger', a.trigger_event_type, 'reentry', a.reentry,
        'nodeTypes', COALESCE((SELECT jsonb_agg(DISTINCT n ->> 'type')
                                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.graph -> 'nodes') = 'array' THEN a.graph -> 'nodes' ELSE '[]'::jsonb END) n
                                WHERE n ->> 'type' IS NOT NULL), '[]'::jsonb)) ORDER BY a.id)
        FROM active a WHERE a.version_id IS NOT NULL), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A13) Wydarzenia: nadchodzące bez ścieżki opieki nad zapisanymi, bilety
-- z planu odebrane i niewykorzystane (wydarzenia zakończone w 90 dni).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_events(p_tenant uuid)
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
    'upcoming30d', (SELECT count(*) FROM public.events e
                     WHERE e.tenant_id = p_tenant AND e.status = 'published' AND e.cancelled_at IS NULL
                       AND e.starts_at > now() AND e.starts_at <= now() + interval '30 days'),
    'upcoming7dWithRegistrations', (SELECT count(*) FROM public.events e
                     WHERE e.tenant_id = p_tenant AND e.status = 'published' AND e.cancelled_at IS NULL
                       AND e.starts_at > now() AND e.starts_at <= now() + interval '7 days'
                       AND EXISTS (SELECT 1 FROM public.event_registrations r WHERE r.event_id = e.id)),
    'nurtureActive', EXISTS (SELECT 1 FROM public.journey_definitions j
                              WHERE j.tenant_id = p_tenant AND j.status = 'active'
                                AND j.template_key = 'event_registration_nurture'),
    'ticketClaims', (SELECT jsonb_build_object(
        'claimedPast', count(*), 'unredeemed', count(*) FILTER (WHERE c.redeemed_at IS NULL))
        FROM public.plan_ticket_claims c JOIN public.events e ON e.id = c.event_id
       WHERE c.tenant_id = p_tenant AND c.released_at IS NULL
         AND COALESCE(e.ends_at, e.starts_at) < now()
         AND COALESCE(e.ends_at, e.starts_at) >= now() - interval '90 days')
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A14) Kluby: próg rangi bez warstwy (albo bez warstwy do kupienia) i wnioski
-- czekające > 7 dni (SPEC) / > 30 dni (miesiąc = cały okres rozliczeniowy
-- płacącego kandydata bez decyzji).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_clubs(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  WITH gated AS (
    SELECT c.id, c.min_tier_rank,
           EXISTS (SELECT 1 FROM public.membership_tiers t
                    WHERE t.tenant_id = p_tenant AND t.active AND t.rank >= c.min_tier_rank) AS tier_exists,
           EXISTS (SELECT 1 FROM public.membership_tiers t
                    JOIN public.access_plans p ON p.tenant_id = t.tenant_id AND p.tier_key = t.key
                   WHERE t.tenant_id = p_tenant AND t.active AND t.rank >= c.min_tier_rank
                     AND COALESCE(t.pricing_visible, true) AND COALESCE(t.cta_mode, 'auto') = 'auto'
                     AND p.active AND p.for_sale) AS offerable
      FROM public.clubs c
     WHERE c.tenant_id = p_tenant AND c.status = 'active' AND c.min_tier_rank > 0
  )
  SELECT jsonb_build_object(
    'rankWithoutTier', (SELECT jsonb_build_object(
        'impossible', count(*) FILTER (WHERE NOT tier_exists),
        'notOfferable', count(*) FILTER (WHERE tier_exists AND NOT offerable),
        'refs', COALESCE(to_jsonb((array_agg(id ORDER BY tier_exists, id) FILTER (WHERE NOT offerable))[1:20]), '[]'::jsonb))
        FROM gated),
    'pendingApplications', (SELECT jsonb_build_object(
        'over7d', count(*) FILTER (WHERE a.created_at < now() - interval '7 days'),
        'over30d', count(*) FILTER (WHERE a.created_at < now() - interval '30 days'),
        'oldestAt', min(a.created_at))
        FROM public.club_applications a
       WHERE a.tenant_id = p_tenant AND a.status IN ('pending', 'review'))
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A15) Synchronizacja: błędy emiterów (24 h / 7 d), typy zdarzeń 90 dni,
-- emitery, które ucichły. Rytm z 83 dni sprzed ostatniego tygodnia: ≥ 11
-- zdarzeń (co najmniej raz w tygodniu) i zero w 7 dni = cichy tygodniowy;
-- ≥ 83 (co najmniej raz dziennie) i zero w 7 dni = cichy codzienny.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_sync(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  WITH types AS (
    SELECT e.event_type,
           count(*) FILTER (WHERE e.created_at >= now() - interval '7 days') AS last7,
           count(*) FILTER (WHERE e.created_at < now() - interval '7 days') AS prior
      FROM public.domain_events e
     WHERE e.tenant_id = p_tenant AND e.created_at >= now() - interval '90 days'
     GROUP BY e.event_type
  )
  SELECT jsonb_build_object(
    'emitErrors24h', (SELECT count(*) FROM public.domain_event_emit_errors x
                       WHERE x.tenant_id = p_tenant AND x.created_at >= now() - interval '24 hours'),
    'emitErrors7d', (SELECT count(*) FROM public.domain_event_emit_errors x
                      WHERE x.tenant_id = p_tenant AND x.created_at >= now() - interval '7 days'),
    'seenTypes90d', COALESCE((SELECT jsonb_agg(event_type ORDER BY event_type) FROM types), '[]'::jsonb),
    'silentWeekly', COALESCE((SELECT jsonb_agg(event_type ORDER BY event_type) FROM types
                               WHERE last7 = 0 AND prior >= 11 AND prior < 83), '[]'::jsonb),
    'silentDaily', COALESCE((SELECT jsonb_agg(event_type ORDER BY event_type) FROM types
                              WHERE last7 = 0 AND prior >= 83), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- A16) Jakość danych: dokumenty bez środowiska, podstawa MRR z cennika, dryf
-- migawki od księgi (tolerancja 0,5 % = `BRIDGE_TOLERANCE` w TS), dane
-- wyłącznie z piaskownicy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_facts_data_quality(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date;
  v_drift jsonb;
  v_basis numeric;
BEGIN
  SELECT max(s.day) INTO v_day FROM public.mrr_daily_snapshots s
   WHERE s.tenant_id = p_tenant AND s.environment = 'live';

  IF v_day IS NOT NULL THEN
    SELECT round(sum(s.basis_catalog_share * s.mrr_minor) / NULLIF(sum(s.mrr_minor), 0), 4) INTO v_basis
      FROM public.mrr_daily_snapshots s
     WHERE s.tenant_id = p_tenant AND s.environment = 'live' AND s.day = v_day;

    -- Migawka dnia D kontra księga na koniec D (UTC) - ta sama para co
    -- `snapshot_mrr_minor` w serii MRR (110400). Baza 0 = `null` (I6).
    WITH snap AS (
      SELECT s.currency, sum(s.mrr_minor)::numeric AS mrr
        FROM public.mrr_daily_snapshots s
       WHERE s.tenant_id = p_tenant AND s.environment = 'live' AND s.day = v_day
       GROUP BY s.currency
    ), ledger AS (
      SELECT x.currency, x.mrr_minor::numeric AS mrr
        FROM public._revenue_mrr_at(p_tenant, (v_day + 1)::timestamp AT TIME ZONE 'UTC') x
    ), pairs AS (
      SELECT COALESCE(s.currency, l.currency) AS currency,
             CASE WHEN COALESCE(l.mrr, 0) = 0 THEN CASE WHEN COALESCE(s.mrr, 0) = 0 THEN 0 END
                  ELSE round(abs(COALESCE(s.mrr, 0) - l.mrr) / l.mrr, 6) END AS ratio
        FROM snap s FULL JOIN ledger l ON l.currency = s.currency
    )
    SELECT jsonb_build_object('day', v_day, 'maxRatio', max(ratio),
                              'currencies', COALESCE(jsonb_agg(jsonb_build_object('currency', currency, 'ratio', ratio)
                                                               ORDER BY currency), '[]'::jsonb))
      INTO v_drift FROM pairs;
  END IF;

  RETURN jsonb_build_object(
    'documentsEnvUnknown', (SELECT jsonb_build_object(
        'recent30d', count(*) FILTER (WHERE d.created_at >= now() - interval '30 days'),
        'older', count(*) FILTER (WHERE d.created_at < now() - interval '30 days'))
        FROM public.billing_documents d WHERE d.tenant_id = p_tenant AND d.environment IS NULL),
    'mrrCatalogBasis', CASE WHEN v_day IS NULL THEN NULL
                            ELSE jsonb_build_object('day', v_day, 'share', v_basis) END,
    'ledgerDrift', v_drift,
    'live', (SELECT jsonb_build_object('subscriptions', count(*), 'lastAt', max(s.created_at))
               FROM public.subscriptions s WHERE s.tenant_id = p_tenant AND s.environment = 'live'),
    'sandbox', (SELECT jsonb_build_object('subscriptions', count(*), 'lastAt', max(s.created_at))
                  FROM public.subscriptions s WHERE s.tenant_id = p_tenant AND s.environment <> 'live')
  );
END;
$$;

-- Helpery bez EXECUTE dla ról API (także service_role - SPEC §4.4): najemca
-- idzie parametrem, więc wywołanie z klienta byłoby odczytem cudzej firmy.
-- Woła je wyłącznie RPC niżej.
REVOKE ALL ON FUNCTION public._revenue_facts_crm(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_newsletter(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_workflows(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_journeys(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_events(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_clubs(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_sync(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_facts_data_quality(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) RPC panelu - sklejenie obszarów.
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_revenue_facts (v, computedAt, areas{16 obszarów})
CREATE OR REPLACE FUNCTION public.admin_revenue_facts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '5s'
AS $$
DECLARE
  v_tenant uuid;
  v_admin boolean;
  v_areas jsonb := '{}'::jsonb;
  v_catalog jsonb;
  v_dq jsonb;
BEGIN
  IF NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_admin := public.has_role((SELECT auth.uid()), 'admin'::app_role);

  -- Każdy obszar w osobnym bloku: błąd jednego (np. tabela modułu w trakcie
  -- wdrożenia) daje `null` obszaru - reguły tego obszaru mówią „nie wiadomo",
  -- reszta diagnozy działa. Przekroczenie `statement_timeout` (57014) nie jest
  -- łapane przez OTHERS i kończy całe RPC - panel pokazuje wtedy błąd odczytu.
  BEGIN v_catalog := public._revenue_facts_catalog(v_tenant);
  EXCEPTION WHEN OTHERS THEN v_catalog := NULL; END;
  BEGIN v_areas := v_areas || jsonb_build_object('paywall', public._revenue_facts_paywall(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"paywall": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('metering', public._revenue_facts_metering(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"metering": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('checkout', public._revenue_facts_checkout(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"checkout": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('coupons', public._revenue_facts_coupons(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"coupons": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('retention', public._revenue_facts_retention(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"retention": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('dunning', public._revenue_facts_dunning(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"dunning": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('funnel', public._revenue_facts_funnel(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"funnel": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('crm', public._revenue_facts_crm(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"crm": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('newsletter', public._revenue_facts_newsletter(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"newsletter": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('workflows', public._revenue_facts_workflows(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"workflows": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('journeys', public._revenue_facts_journeys(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"journeys": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('events', public._revenue_facts_events(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"events": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('clubs', public._revenue_facts_clubs(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"clubs": null}'::jsonb; END;
  BEGIN v_areas := v_areas || jsonb_build_object('sync', public._revenue_facts_sync(v_tenant));
  EXCEPTION WHEN OTHERS THEN v_areas := v_areas || '{"sync": null}'::jsonb; END;
  BEGIN v_dq := public._revenue_facts_data_quality(v_tenant);
  EXCEPTION WHEN OTHERS THEN v_dq := NULL; END;

  -- Kwoty tylko dla administratora (SPEC §2.5): redaktor widzi te same
  -- diagnozy, ale cena planu i dryf księgi zostają `null` („nie wiadomo").
  IF NOT v_admin THEN
    IF v_catalog IS NOT NULL THEN
      v_catalog := jsonb_set(v_catalog, '{plans}', COALESCE((
        SELECT jsonb_agg(p || '{"priceCents": null}'::jsonb) FROM jsonb_array_elements(v_catalog -> 'plans') p),
        '[]'::jsonb));
    END IF;
    IF v_dq IS NOT NULL THEN
      v_dq := v_dq || '{"ledgerDrift": null, "mrrCatalogBasis": null}'::jsonb;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'v', 1,
    'computedAt', now(),
    'areas', v_areas || jsonb_build_object('catalog', v_catalog, 'data_quality', v_dq)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revenue_facts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_facts() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_revenue_facts() IS
  'Hub S7: fakty diagnostyki {v:1, computedAt, areas{16 obszarów}} najemcy z sesji; admin|editor (42501), kwoty tylko admin (editor null), awaria obszaru = null obszaru, bez PII, statement_timeout 5s.';
