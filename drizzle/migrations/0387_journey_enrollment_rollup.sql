-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9, Z-I9c-06): DZIENNE ZESTAWIENIE STATUSÓW ZAPISÓW
-- NA ŚCIEŻKI - PODSUMOWANIE I SERIA ŚCIEŻKI PRZEŻYWAJĄ RETENCJĘ ZAPISÓW.
--
-- DEFEKT
--   1. Z-I9c-06: retencja (I9c-X2, `_data_retention_journey_enrollments`,
--      20261020161100) usuwa zakończone zapisy (`completed`, `goal_reached`,
--      `exited`, `failed`) starsze niż okres kategorii, a podsumowanie
--      ścieżki (`admin_journey_stats` - wejścia, cele, wyjścia per powód,
--      konwersja do celu) i seria dzienna (`admin_journey_series`) liczą je
--      wyłącznie z SUROWYCH `journey_enrollments`. Okno sprzed progu
--      pokazywało więc zera albo niepełne liczby (S8 uczciwie pisało
--      „podsumowanie obejmuje tylko zachowane zapisy"), choć liczniki kroków
--      i maili przeżywały retencję w `journey_node_daily_stats`.
--   2. Z-I9c-05 (część ścieżek): seria dzienna liczyła maile i kliknięcia
--      dni zapieczętowanych z surowych wiadomości i zdarzeń, które retencja
--      już usunęła - wykres starszego okna spadał do zera.
--
-- ZMIANA
--   A. Tabela `journey_enrollment_daily_stats` - anonimowe zestawienie
--      zapisów usuniętych przez retencję: (ścieżka, wersja, dzień wejścia,
--      dzień zakończenia, status, powód wyjścia) -> liczba zapisów. BEZ
--      kontaktu, leada i identyfikatora zapisu (minimalizacja). Zapisy
--      testowe (`is_test`) nie są składane - jak w rollupie kroków.
--   B. `_data_retention_journey_enrollments` (CIALO-Z niżej): składa
--      usuwane zapisy do zestawienia W TEJ SAMEJ instrukcji co DELETE (CTE
--      `gone` -> INSERT … ON CONFLICT DO UPDATE n = n + nowe) - zapis
--      usunięty nie wraca, więc zestawienie i wiersze surowe są rozłączne,
--      a powtórzony przebieg niczego nie dubluje. Tryb podglądu nic nie
--      składa.
--   C. `admin_journey_stats` (S5, rezerwa I9 - `HUB_I9_REDEFINITIONS`,
--      CIALO-Z niżej): podsumowanie = surowe zapisy okna + zestawienie dla
--      dnia wejścia w oknie (dni UTC); „w toku" i „czeka" tylko z surowych;
--      warianty A/B z surowych (zestawienie nie zna ramion podziału).
--   D. `admin_journey_series` (S5, rezerwa I9, CIALO-Z niżej): wejścia po
--      dniu wejścia, cele i wyjścia po dniu zakończenia - surowe +
--      zestawienie; maile i kliknięcia dni zapieczętowanych
--      (`_data_retention_journey_sealed`) z `journey_node_daily_stats`
--      (wysłane i unikalne kliknięcia wg dnia kroku - opis w runbooku).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162500 (I9d-Y2); wymaga 20261020161000-
-- 161200 (retencja I9c-X2) i 20261020140500 (statystyki S5). Kod panelu nie
-- zmienia kształtu odpowiedzi - wdrożenie migracji przed kodem i po nim jest
-- bezpieczne. Zapisy usunięte PRZED tą migracją nie są w zestawieniu (nie da
-- się ich odtworzyć) - podsumowanie okna z takich dni zostaje niepełne.
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, bezstanowe REVOKE/GRANT, ENABLE ROW LEVEL SECURITY (powtórka -
-- no-op).
-- DOWÓD: supabase/tests/hub_i9_journey_enrollment_rollup_test.sql
-- (podsumowanie i seria identyczne przed czyszczeniem i po nim, powtórny
-- przebieg bez dublowania, zapisy testowe pominięte, podgląd nic nie
-- składa, ACL tabeli).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Zestawienie dzienne zapisów usuniętych przez retencję.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_enrollment_daily_stats (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  entered_day date NOT NULL,
  finished_day date NOT NULL,
  status text NOT NULL
    CHECK (status IN ('completed', 'goal_reached', 'exited', 'failed')),
  -- '' = status bez powodu wyjścia (klucz główny nie przyjmuje NULL).
  exit_reason text NOT NULL DEFAULT '',
  enrollments integer NOT NULL CHECK (enrollments >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (journey_id, version_id, entered_day, finished_day, status, exit_reason),
  -- Usunięcie ścieżki (a z nią najemcy) zabiera jej zestawienie.
  CONSTRAINT journey_enrollment_daily_stats_journey_fkey
    FOREIGN KEY (tenant_id, journey_id) REFERENCES public.journey_definitions(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS journey_enrollment_daily_stats_tenant_journey_idx
  ON public.journey_enrollment_daily_stats (tenant_id, journey_id, entered_day);

COMMENT ON TABLE public.journey_enrollment_daily_stats IS
  'Hub (I9, Z-I9c-06): anonimowe zestawienie zapisów na ścieżki usuniętych przez retencję - liczba per ścieżka, wersja, dzień wejścia, dzień zakończenia, status i powód wyjścia. Bez kontaktu i identyfikatora zapisu.';

-- RLS i ACL: czytają wyłącznie funkcje SECURITY DEFINER statystyk (panel
-- przez RPC), pisze wyłącznie retencja. Domyślne uprawnienia Supabase dają
-- nowej tabeli komplet dla anon i authenticated - REVOKE jest konieczny.
ALTER TABLE public.journey_enrollment_daily_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journey_enrollment_daily_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journey_enrollment_daily_stats TO service_role;

-- ----------------------------------------------------------------------------
-- B) Retencja zapisów: złożenie przed usunięciem (ta sama instrukcja).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020161100
CREATE OR REPLACE FUNCTION public._data_retention_journey_enrollments(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (p_cutoff AT TIME ZONE 'UTC')::date;
  v_seal jsonb;
  v_cut timestamptz;
  v_n integer := 0;
BEGIN
  v_seal := public._data_retention_seal_journeys(p_tenant, v_day);
  v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1)::timestamp AT TIME ZONE 'UTC';
  IF p_execute THEN
    -- Złożenie i usunięcie w JEDNEJ instrukcji: wiersz usunięty jest
    -- złożony dokładnie raz (DELETE … RETURNING), a SKIP LOCKED oddaje
    -- zapisy zajęte przez silnik następnemu przebiegowi.
    WITH doomed AS (
      SELECT e.id FROM public.journey_enrollments e
       WHERE e.tenant_id = p_tenant AND e.status IN ('completed', 'goal_reached', 'exited', 'failed')
         AND e.finished_at < v_cut
       ORDER BY e.finished_at LIMIT p_limit FOR UPDATE SKIP LOCKED),
    gone AS (
      DELETE FROM public.journey_enrollments e USING doomed d WHERE e.id = d.id
      RETURNING e.tenant_id, e.journey_id, e.version_id, e.entered_at, e.finished_at, e.status,
                e.exit_reason, e.is_test),
    folded AS (
      INSERT INTO public.journey_enrollment_daily_stats AS s (
        tenant_id, journey_id, version_id, entered_day, finished_day, status, exit_reason, enrollments)
      SELECT g.tenant_id, g.journey_id, g.version_id, (g.entered_at AT TIME ZONE 'UTC')::date,
             (g.finished_at AT TIME ZONE 'UTC')::date, g.status, COALESCE(g.exit_reason, ''), count(*)
        FROM gone g
       WHERE NOT g.is_test
       GROUP BY g.tenant_id, g.journey_id, g.version_id, (g.entered_at AT TIME ZONE 'UTC')::date,
                (g.finished_at AT TIME ZONE 'UTC')::date, g.status, COALESCE(g.exit_reason, '')
      ON CONFLICT (journey_id, version_id, entered_day, finished_day, status, exit_reason) DO UPDATE
         SET enrollments = s.enrollments + EXCLUDED.enrollments, updated_at = now()
      RETURNING 1)
    SELECT count(*) INTO v_n FROM gone;
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_n FROM (
      SELECT 1 FROM public.journey_enrollments e
       WHERE e.tenant_id = p_tenant AND e.status IN ('completed', 'goal_reached', 'exited', 'failed')
         AND e.finished_at < v_cut LIMIT p_limit) x;
  END IF;
  RETURN jsonb_build_object('affected', v_n,
    'backlog', v_n >= p_limit OR NOT COALESCE((v_seal ->> 'complete')::boolean, false), 'cutoff', v_cut);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_journey_enrollments(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Podsumowanie ścieżki: surowe + zestawienie (rezerwa I9).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020161200
CREATE OR REPLACE FUNCTION public.admin_journey_stats(
  p_journey_id uuid,
  p_version_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Próg istotności A/B (SPEC §5.6): z liczone od 100 zapisów na wariant.
  c_min_n constant integer := 100;
  v_tenant uuid := public._journey_staff_tenant(false);
  v_def record;
  v_graph jsonb;
  v_since timestamptz := COALESCE(p_since, now() - interval '30 days');
  v_until timestamptz := COALESCE(p_until, now());
  v_rollup boolean;
  v_journey jsonb;
  v_nodes jsonb;
  v_variants jsonb := '[]'::jsonb;
  v_ab jsonb;
  v_metric text;
  -- Zapisy okna jako tablica identyfikatorów (jedno przejście filtra okna;
  -- bez tabeli tymczasowej, której analiza statyczna plpgsql_check nie widzi).
  v_ids uuid[];
  -- Z-I9c-06: zapisy surowe (zachowane) i złożone przed usunięciem
  -- (`journey_enrollment_daily_stats`) - zbiory rozłączne, więc sumowalne.
  v_raw record;
  v_fold record;
  v_exited jsonb;
  v_an bigint;
  v_ag bigint;
  v_ac bigint;
  v_bn bigint;
  v_bg bigint;
  v_bc bigint;
  v_p double precision;
  v_se double precision;
  v_za double precision;
  v_zb double precision;
BEGIN
  IF v_until <= v_since THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT d.id, d.published_version_id INTO v_def FROM public.journey_definitions d
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT v.graph INTO v_graph FROM public.journey_versions v
   WHERE v.journey_id = v_def.id AND v.tenant_id = v_tenant
     AND v.id = COALESCE(p_version_id, v_def.published_version_id);

  SELECT COALESCE(array_agg(e.id), '{}'::uuid[]) INTO v_ids FROM public.journey_enrollments e
   WHERE e.tenant_id = v_tenant AND e.journey_id = v_def.id AND NOT e.is_test
     AND (p_version_id IS NULL OR e.version_id = p_version_id)
     AND e.entered_at >= v_since AND e.entered_at <= v_until;

  -- ZMIANA (I9c-X2): okno siegajace dnia zapieczetowanego przez retencje -
  -- surowe zapisy i zdarzenia tych dni mogly juz zniknac, rollup jest pelny.
  v_rollup := v_until - v_since > interval '400 days' OR cardinality(v_ids) > 50000
    OR (v_since AT TIME ZONE 'UTC')::date <= public._data_retention_journey_sealed(v_tenant);

  -- ZMIANA (I9, Z-I9c-06): podsumowanie = zapisy surowe okna + zapisy
  -- złożone przez retencję do zestawienia dziennego (dzień wejścia w oknie,
  -- dni UTC). „W toku" i „czeka" tylko z surowych - retencja usuwa
  -- wyłącznie zapisy zakończone. Zestawienie nie zna wariantów A/B, więc
  -- ramiona podziału niżej liczą się z zapisów surowych.
  SELECT count(*) AS enrolled,
         count(*) FILTER (WHERE status = 'active') AS active,
         count(*) FILTER (WHERE status = 'waiting') AS waiting,
         count(*) FILTER (WHERE status = 'completed') AS completed,
         count(*) FILTER (WHERE status = 'goal_reached') AS goal_reached,
         count(*) FILTER (WHERE status = 'failed') AS failed
    INTO v_raw FROM public.journey_enrollments
   WHERE tenant_id = v_tenant AND id = ANY (v_ids);
  SELECT COALESCE(sum(f.enrollments), 0) AS enrolled,
         COALESCE(sum(f.enrollments) FILTER (WHERE f.status = 'completed'), 0) AS completed,
         COALESCE(sum(f.enrollments) FILTER (WHERE f.status = 'goal_reached'), 0) AS goal_reached,
         COALESCE(sum(f.enrollments) FILTER (WHERE f.status = 'failed'), 0) AS failed
    INTO v_fold FROM public.journey_enrollment_daily_stats f
   WHERE f.tenant_id = v_tenant AND f.journey_id = v_def.id
     AND (p_version_id IS NULL OR f.version_id = p_version_id)
     AND f.entered_day >= (v_since AT TIME ZONE 'UTC')::date
     AND f.entered_day <= (v_until AT TIME ZONE 'UTC')::date;
  SELECT COALESCE(jsonb_object_agg(x.exit_reason, x.n), '{}'::jsonb) INTO v_exited FROM (
    SELECT u.exit_reason, sum(u.n) AS n FROM (
      SELECT j.exit_reason, count(*) AS n FROM public.journey_enrollments j
       WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids) AND j.status = 'exited'
       GROUP BY j.exit_reason
      UNION ALL
      SELECT f.exit_reason, sum(f.enrollments) AS n FROM public.journey_enrollment_daily_stats f
       WHERE f.tenant_id = v_tenant AND f.journey_id = v_def.id AND f.status = 'exited'
         AND (p_version_id IS NULL OR f.version_id = p_version_id)
         AND f.entered_day >= (v_since AT TIME ZONE 'UTC')::date
         AND f.entered_day <= (v_until AT TIME ZONE 'UTC')::date
       GROUP BY f.exit_reason) u
     -- Wyjście bez powodu nie istnieje (zapis z `exited` zawsze go ma);
     -- filtr chroni `jsonb_object_agg` przed kluczem NULL/pustym.
     WHERE u.exit_reason IS NOT NULL AND u.exit_reason <> ''
     GROUP BY u.exit_reason) x;
  v_journey := jsonb_build_object(
    'enrolled', v_raw.enrolled + v_fold.enrolled,
    'active', v_raw.active,
    'waiting', v_raw.waiting,
    'completed', v_raw.completed + v_fold.completed,
    'goal_reached', v_raw.goal_reached + v_fold.goal_reached,
    'failed', v_raw.failed + v_fold.failed,
    'exited', v_exited,
    'goal_rate', CASE WHEN v_raw.enrolled + v_fold.enrolled > 0
                      THEN round((v_raw.goal_reached + v_fold.goal_reached)::numeric
                                 / (v_raw.enrolled + v_fold.enrolled), 4) END);

  IF v_rollup THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'node_id', r.node_id, 'type', public._journey_node(v_graph, r.node_id) ->> 'type',
      'entered', r.entered, 'succeeded', r.succeeded, 'skipped', r.skipped, 'failed', r.failed,
      'dead', r.dead, 'waiting_now', 0, 'outcomes', '{}'::jsonb,
      'email', CASE WHEN public._journey_node(v_graph, r.node_id) ->> 'type' = 'send_email' THEN jsonb_build_object(
        'queued', r.sent, 'sent', r.sent, 'suppressed', 0, 'bounced', r.bounced, 'complained', r.complained,
        'unique_opens', r.opens, 'unique_human_opens', r.human_opens, 'unique_clicks', r.clicks,
        'ctor', CASE WHEN r.human_opens > 0 THEN round(r.clicks::numeric / r.human_opens, 4) END,
        'unsubscribed', r.unsubs, 'fallback_locale', 0) END
    ) ORDER BY r.node_id), '[]'::jsonb) INTO v_nodes
    FROM (
      SELECT s.node_id, sum(s.entered) AS entered, sum(s.succeeded) AS succeeded, sum(s.skipped) AS skipped,
             sum(s.failed) AS failed, sum(s.dead) AS dead, sum(s.emails_sent) AS sent,
             sum(s.emails_bounced) AS bounced, sum(s.emails_complained) AS complained,
             sum(s.unique_opens) AS opens, sum(s.unique_human_opens) AS human_opens,
             sum(s.unique_clicks) AS clicks, sum(s.unsubscribes) AS unsubs
        FROM public.journey_node_daily_stats s
       WHERE s.tenant_id = v_tenant AND s.journey_id = v_def.id AND s.variant = '-'
         AND (p_version_id IS NULL OR s.version_id = p_version_id)
         AND s.day >= v_since::date AND s.day < v_until::date
       GROUP BY s.node_id
    ) r;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'node_id', n.node_id, 'type', n.node_type,
      'entered', n.entered, 'succeeded', n.succeeded, 'skipped', n.skipped, 'failed', n.failed,
      'dead', n.dead, 'waiting_now', n.waiting_now, 'outcomes', n.outcomes,
      'email', CASE WHEN n.node_type = 'send_email' THEN (
        SELECT jsonb_build_object(
          'queued', count(*),
          'sent', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    WHERE l.message_id = m.message_id AND l.status = 'sent')),
          'suppressed', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    WHERE l.message_id = m.message_id AND l.status = 'suppressed')),
          'bounced', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
                    WHERE l.message_id = m.message_id AND de.kind = 'bounced')),
          'complained', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
                    WHERE l.message_id = m.message_id AND de.kind = 'complained')),
          'unique_opens', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open')),
          'unique_human_opens', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)),
          'unique_clicks', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'click')),
          'ctor', CASE WHEN count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)) > 0
                  THEN round((count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'click')))::numeric
                    / count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)), 4) END,
          'unsubscribed', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'unsubscribe')),
          'fallback_locale', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_step_runs sr
                    WHERE sr.enrollment_id = m.enrollment_id AND sr.node_id = m.node_id
                      AND (sr.detail ->> 'fallback_locale')::boolean))
        )
          FROM public.journey_messages m
         WHERE m.journey_id = v_def.id AND m.node_id = n.node_id
           AND m.tenant_id = v_tenant AND m.enrollment_id = ANY (v_ids)
      ) END
    ) ORDER BY n.node_id), '[]'::jsonb) INTO v_nodes
    FROM (
      SELECT sr.node_id, max(sr.node_type) AS node_type,
             count(*) AS entered,
             count(*) FILTER (WHERE sr.status = 'succeeded') AS succeeded,
             count(*) FILTER (WHERE sr.status = 'skipped') AS skipped,
             count(*) FILTER (WHERE sr.status = 'failed') AS failed,
             count(*) FILTER (WHERE sr.status = 'dead') AS dead,
             (SELECT count(*) FROM public.journey_enrollments j
               WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
                 AND j.current_node_id = sr.node_id AND j.status IN ('active', 'waiting')) AS waiting_now,
             COALESCE((SELECT jsonb_object_agg(o.outcome, o.n) FROM (
                SELECT sr2.outcome, count(*) AS n FROM public.journey_step_runs sr2
                 WHERE sr2.tenant_id = v_tenant AND sr2.enrollment_id = ANY (v_ids)
                   AND sr2.node_id = sr.node_id AND sr2.outcome IS NOT NULL
                 GROUP BY sr2.outcome) o), '{}'::jsonb) AS outcomes
        FROM public.journey_step_runs sr
       WHERE sr.tenant_id = v_tenant AND sr.enrollment_id = ANY (v_ids)
       GROUP BY sr.node_id
    ) n;
  END IF;

  -- Warianty A/B (ramiona podziału): wejścia, kliknięcia, cele, z.
  FOR v_ab IN SELECT n FROM jsonb_array_elements(COALESCE(v_graph -> 'nodes', '[]'::jsonb)) n
               WHERE n ->> 'type' = 'ab_split' LOOP
    v_metric := COALESCE(v_ab -> 'params' ->> 'winnerMetric', 'goal');
    SELECT count(*) AS n,
           count(*) FILTER (WHERE j.status = 'goal_reached') AS goals,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'click'
             WHERE m.enrollment_id = j.id)) AS clicks
      INTO v_an, v_ag, v_ac
      FROM public.journey_enrollments j JOIN public.journey_step_runs sr ON sr.enrollment_id = j.id
     WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
       AND sr.node_id = v_ab ->> 'id' AND sr.outcome = 'A';
    SELECT count(*) AS n,
           count(*) FILTER (WHERE j.status = 'goal_reached') AS goals,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'click'
             WHERE m.enrollment_id = j.id)) AS clicks
      INTO v_bn, v_bg, v_bc
      FROM public.journey_enrollments j JOIN public.journey_step_runs sr ON sr.enrollment_id = j.id
     WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
       AND sr.node_id = v_ab ->> 'id' AND sr.outcome = 'B';
    v_za := NULL;
    v_zb := NULL;
    IF v_an >= c_min_n AND v_bn >= c_min_n THEN
      -- Test dwóch proporcji (wspólna proporcja w błędzie standardowym).
      IF v_metric = 'click' THEN
        v_p := (v_ac + v_bc)::double precision / (v_an + v_bn);
      ELSE
        v_p := (v_ag + v_bg)::double precision / (v_an + v_bn);
      END IF;
      v_se := sqrt(v_p * (1 - v_p) * (1.0 / v_an + 1.0 / v_bn));
      IF v_se > 0 THEN
        IF v_metric = 'click' THEN
          v_za := ((v_ac::double precision / v_an) - (v_bc::double precision / v_bn)) / v_se;
        ELSE
          v_za := ((v_ag::double precision / v_an) - (v_bg::double precision / v_bn)) / v_se;
        END IF;
        v_zb := -v_za;
      END IF;
    END IF;
    v_variants := v_variants
      || jsonb_build_object('node_id', v_ab ->> 'id', 'variant', 'A', 'metric', v_metric, 'entered', v_an,
                            'unique_clicks', v_ac, 'goal_reached', v_ag,
                            'z', CASE WHEN v_za IS NOT NULL THEN round(v_za::numeric, 3) END)
      || jsonb_build_object('node_id', v_ab ->> 'id', 'variant', 'B', 'metric', v_metric, 'entered', v_bn,
                            'unique_clicks', v_bc, 'goal_reached', v_bg,
                            'z', CASE WHEN v_zb IS NOT NULL THEN round(v_zb::numeric, 3) END);
  END LOOP;

  RETURN jsonb_build_object('since', v_since, 'until', v_until, 'version_id', p_version_id,
                            'source', CASE WHEN v_rollup THEN 'rollup' ELSE 'raw' END,
                            'journey', v_journey, 'nodes', v_nodes, 'variants', v_variants);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_stats(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_stats(uuid, uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Seria dzienna ścieżki: surowe + zestawienie, maile dni zapieczętowanych
--    z rollupu kroków (rezerwa I9).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020140500
CREATE OR REPLACE FUNCTION public.admin_journey_series(
  p_journey_id uuid,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_since date := COALESCE(p_since, now() - interval '30 days')::date;
  v_until date := COALESCE(p_until, now())::date;
  -- Dni do tej daty włącznie mogą nie mieć już surowych wiadomości
  -- i zdarzeń (retencja I9c-X2) - maile i kliknięcia z rollupu kroków.
  v_sealed date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.journey_definitions d WHERE d.id = p_journey_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_until < v_since OR v_until - v_since > 731 THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  v_sealed := public._data_retention_journey_sealed(v_tenant);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'day', g.day,
             'enrolled', (SELECT count(*) FROM public.journey_enrollments e
                           WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id AND NOT e.is_test
                             AND e.entered_at >= g.day AND e.entered_at < g.day + 1)
                         + (SELECT COALESCE(sum(f.enrollments), 0) FROM public.journey_enrollment_daily_stats f
                             WHERE f.tenant_id = v_tenant AND f.journey_id = p_journey_id
                               AND f.entered_day = g.day),
             'goal_reached', (SELECT count(*) FROM public.journey_enrollments e
                               WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id AND NOT e.is_test
                                 AND e.status = 'goal_reached'
                                 AND e.finished_at >= g.day AND e.finished_at < g.day + 1)
                             + (SELECT COALESCE(sum(f.enrollments), 0) FROM public.journey_enrollment_daily_stats f
                                 WHERE f.tenant_id = v_tenant AND f.journey_id = p_journey_id
                                   AND f.status = 'goal_reached' AND f.finished_day = g.day),
             'exited', (SELECT count(*) FROM public.journey_enrollments e
                         WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id AND NOT e.is_test
                           AND e.status = 'exited'
                           AND e.finished_at >= g.day AND e.finished_at < g.day + 1)
                       + (SELECT COALESCE(sum(f.enrollments), 0) FROM public.journey_enrollment_daily_stats f
                           WHERE f.tenant_id = v_tenant AND f.journey_id = p_journey_id
                             AND f.status = 'exited' AND f.finished_day = g.day),
             'emails_queued', CASE WHEN v_sealed IS NOT NULL AND g.day <= v_sealed
               THEN (SELECT COALESCE(sum(s.emails_sent), 0) FROM public.journey_node_daily_stats s
                      WHERE s.tenant_id = v_tenant AND s.journey_id = p_journey_id AND s.variant = '-'
                        AND s.day = g.day)
               ELSE (SELECT count(*) FROM public.journey_messages m
                      JOIN public.journey_enrollments e ON e.id = m.enrollment_id AND NOT e.is_test
                      WHERE m.tenant_id = v_tenant AND m.journey_id = p_journey_id
                        AND m.queued_at >= g.day AND m.queued_at < g.day + 1) END,
             'unique_clicks', CASE WHEN v_sealed IS NOT NULL AND g.day <= v_sealed
               THEN (SELECT COALESCE(sum(s.unique_clicks), 0) FROM public.journey_node_daily_stats s
                      WHERE s.tenant_id = v_tenant AND s.journey_id = p_journey_id AND s.variant = '-'
                        AND s.day = g.day)
               ELSE (SELECT count(DISTINCT me.message_id) FROM public.journey_message_events me
                      JOIN public.journey_messages m ON m.message_id = me.message_id
                      JOIN public.journey_enrollments e ON e.id = m.enrollment_id AND NOT e.is_test
                      WHERE me.tenant_id = v_tenant AND m.journey_id = p_journey_id
                        AND me.kind = 'click' AND me.day = g.day) END
           ) ORDER BY g.day)
      FROM (SELECT d::date AS day FROM generate_series(v_since, v_until, interval '1 day') d) g
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_journey_series(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_series(uuid, timestamptz, timestamptz) TO authenticated, service_role;
