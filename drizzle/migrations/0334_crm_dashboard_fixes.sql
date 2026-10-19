-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S4, 5/8): PULPIT CRM BEZ ZADAŃ ANULOWANYCH (D11).
--
-- DEFEKT
--   `admin_dashboard_crm` liczył `tasksOpen` i `tasksOverdue` jako
--   `status <> 'done'`, czyli także zadania ANULOWANE. Od S4 automat anuluje
--   otwarte zadania retencyjne po wznowieniu subskrypcji (P13) i fałszywe
--   win-backi po pauzie - kafel „zaległe" na pulpicie rósłby z każdym
--   klientem, który wrócił, a przypomnień do zrobienia nie przybywało.
--
-- ZMIANA
--   Ciało z jedynej definicji (CIALO-Z niżej) z dwiema zmianami:
--   `tasksOpen` i `tasksOverdue` liczą wyłącznie `status = 'open'`
--   (`tasksDone` bez zmian - liczy domknięcia w oknie po `completed_at`) oraz
--   komentarz o historii etapów (od S4 istnieje `crm_lead_stage_history`).
--   Sygnatura, kształt jsonb (kontrakt `CrmPanel`) i granty bez zmian.
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna względem pozostałych migracji S4 (czyta tylko
-- istniejące kolumny); przed publikacją frontu, który pokazuje anulowane
-- zadania retencyjne (purchaseEffects P13).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/crm_dashboard_fixes_test.sql (zadanie otwarte,
-- zaległe, zrobione i anulowane - liczniki bez anulowanego; dwóch najemców;
-- autor 42501).
-- ============================================================================

-- CIALO-Z: 20260912110000
CREATE OR REPLACE FUNCTION public.admin_dashboard_crm(
  p_since timestamptz,
  p_until timestamptz,
  p_prev_since timestamptz,
  p_prev_until timestamptz,
  p_bucket text DEFAULT 'day',
  p_offset_minutes integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.admin_dashboard_tenant();
  v_bucket text := public.admin_dashboard_bucket(p_bucket);
  v_shift  interval := make_interval(mins => coalesce(p_offset_minutes, 0));
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'current', (
      SELECT jsonb_build_object(
               'newLeads',   count(*),
               'won',        count(*) FILTER (WHERE l.stage = 'won'),
               'lost',       count(*) FILTER (WHERE l.stage = 'lost'),
               'hot',        count(*) FILTER (WHERE l.score_band = 'hot'),
               'consented',  count(*) FILTER (WHERE l.marketing_consent)
             )
        FROM public.crm_leads l
       WHERE l.tenant_id = v_tenant
         AND l.created_at >= p_since AND l.created_at < p_until
    ),
    'previous', (
      SELECT jsonb_build_object(
               'newLeads',   count(*),
               'won',        count(*) FILTER (WHERE l.stage = 'won'),
               'lost',       count(*) FILTER (WHERE l.stage = 'lost'),
               'hot',        count(*) FILTER (WHERE l.score_band = 'hot'),
               'consented',  count(*) FILTER (WHERE l.marketing_consent)
             )
        FROM public.crm_leads l
       WHERE l.tenant_id = v_tenant
         AND l.created_at >= p_prev_since AND l.created_at < p_prev_until
    ),
    -- STAN LEJKA JEST STANEM NA TERAZ, nie sumą z okna. Etap kontaktu zmienia
    -- się w miejscu (kolumna `stage`); historia zmian żyje od S4
    -- w `crm_lead_stage_history`, a przekrój „ilu było zakwalifikowanych we
    -- wrześniu" liczy z niej tor Sprzedaż huba - pulpit zostaje przy lejku
    -- bieżącym i mówi o tym wprost w podpisie.
    'stages', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.stage)
        FROM (
          SELECT l.stage::text AS stage, count(*) AS leads
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
           GROUP BY l.stage
        ) s
    ), '[]'::jsonb),
    'sources', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.leads DESC, s.source)
        FROM (
          SELECT coalesce(l.source_type::text, 'other') AS source, count(*) AS leads
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
             AND l.created_at >= p_since AND l.created_at < p_until
           GROUP BY 1
        ) s
    ), '[]'::jsonb),
    'countries', coalesce((
      SELECT jsonb_agg(row_to_json(c) ORDER BY c.leads DESC, c.code)
        FROM (
          SELECT upper(l.country) AS code, count(*) AS leads
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
             AND l.country IS NOT NULL AND length(trim(l.country)) = 2
           GROUP BY 1
        ) c
    ), '[]'::jsonb),
    'series', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.bucket)
        FROM (
          SELECT to_char(date_trunc(v_bucket, l.created_at + v_shift), 'YYYY-MM-DD HH24:MI') AS bucket,
                 count(*) AS leads
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
             AND l.created_at >= p_since AND l.created_at < p_until
           GROUP BY 1
        ) s
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'leads',     (SELECT count(*) FROM public.crm_leads l WHERE l.tenant_id = v_tenant),
      'companies', (SELECT count(*) FROM public.crm_companies c WHERE c.tenant_id = v_tenant),
      -- D11: zadanie ANULOWANE nie jest otwarte ani zaległe. `status <> 'done'`
      -- liczył `cancelled` jako pracę do zrobienia - kafel „zaległe" rósł
      -- z każdym zamkniętym przez automat zadaniem retencyjnym.
      'tasksOpen', (SELECT count(*) FROM public.crm_tasks t
                     WHERE t.tenant_id = v_tenant AND t.status = 'open'),
      'tasksOverdue', (SELECT count(*) FROM public.crm_tasks t
                        WHERE t.tenant_id = v_tenant AND t.status = 'open'
                          AND t.due_at IS NOT NULL AND t.due_at < now()),
      'tasksDone', (SELECT count(*) FROM public.crm_tasks t
                     WHERE t.tenant_id = v_tenant AND t.completed_at IS NOT NULL
                       AND t.completed_at >= p_since AND t.completed_at < p_until)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_crm(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_crm(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) TO authenticated, service_role;
