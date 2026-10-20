-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S4, 8/8): PRZEKROJE SPOŁECZNOŚCI DLA HUBA
-- (`admin_revenue_events_summary`, `admin_revenue_clubs_summary`).
-- pg-harness: exclude
--
-- Znacznik wyżej jest DYREKTYWĄ dla scripts/pg-harness/run.sh: migracja czyta
-- tabele klubów i wydarzeń razem z CRM i ustawieniami najemcy, których atrapa
-- harnessu klubów nie ma - wciągnięta po treści wywróciłaby cały przebieg.
-- Klubowy SQL harnessu to wyłącznie 20261020130500.
--
-- DEFEKT
--   Hub (zakładka Społeczność, kafle BI `event_ticket_revenue`,
--   `event_attendance_rate`, `no_show_rate`, `club_*`) nie ma odczytu
--   wydarzeń ani klubów: studio wydarzenia liczy przychód, obecność i pulę
--   planu per wydarzenie, skrzynka zgłoszeń - per status, a przekroju „ile
--   przyniosły wydarzenia kwartału" i „jak działa lejek zgłoszeń" nie ma
--   nigdzie. Migawka huba (S6, `REVENUE_DOMAIN_READS`) czeka na te funkcje.
--
-- ZMIANA
--   A. `admin_revenue_events_summary(p_since, p_until) RETURNS jsonb` (panel;
--      `is_admin_or_editor()`, najemca `current_tenant_id()`). Kohorta =
--      wydarzenia najemcy (bez szkiców) z `starts_at` w `[p_since, p_until)`
--      - definicje BI EAR/NSR mówią o „wydarzeniach w oknie". Per wydarzenie:
--        * `registrations` - zgłoszenia dopuszczone (`approved`, `attended`,
--          `no_show`), bez anulowanych, odrzuconych i listy rezerwowej;
--        * `attended` - z `attended_at`; `no_show` - status `no_show` albo
--          dopuszczony bez obecności po zakończeniu wydarzenia;
--        * `paid` - konwersje z przychodem (prowadzący i pakiety z co
--          najmniej jednym zamówieniem w `_event_revenue_net`);
--        * `plan_pool` - zgłoszenia rozliczone pulą biletów planu (aktywne
--          `plan_ticket_claims`);
--        * `by_currency` - `[{currency, ticket_revenue_net_minor}]` = suma
--          `_event_revenue_net(najemca, wydarzenie, NULL, NULL)` - CAŁY
--          przychód netto wydarzeń z okna, ta sama liczba co raport lejka
--          w studiu wydarzenia bez granic okna. Kwoty WYŁĄCZNIE dla admina
--          (editor: `null` - brak danych, nie zero), nigdy suma walut.
--      Wynik: `{since, until, money_visible, events_count, registrations,
--      paid, attended, no_show, plan_pool, by_currency, events: [...]}`;
--      sumy najwyższego poziomu liczone z TYCH SAMYCH wierszy co lista
--      (suma przekroju = suma per wydarzenie z konstrukcji).
--   B. `admin_revenue_clubs_summary(p_since, p_until) RETURNS jsonb` (panel;
--      jw., bez kwot). Kluby najemcy BEZ tajnych (`visibility = 'secret'` -
--      sam fakt istnienia jest poufny) i bez szkiców:
--        * `members` - osoby z aktywnym członkostwem (stan na teraz);
--        * `contributors` - aktywni członkowie, którzy w oknie założyli wątek
--          albo odpowiedzieli (bez usuniętych i ukrytych);
--        * `active_members` - współtwórcy plus członkowie, którzy w oknie
--          czytali klub (`last_read_at`);
--        * `applications` - `{submitted, accepted, rejected, pending}`:
--          zgłoszone w oknie, zdecydowane w oknie (`reviewed_at`), otwarte
--          teraz; `decision_hours_median` - mediana godzin od zgłoszenia do
--          decyzji zdecydowanych w oknie (`null` bez decyzji);
--        * `clubs_enabled` - przełącznik modułu (`community_modules`), żeby
--          hub pokazał notkę zamiast pustej sekcji;
--        * `clubs: [...]` - te same liczby per klub (zgłoszenie bez klubu,
--          tylko ze specjalizacją, liczy się wyłącznie na górze).
--   Okno: `p_until > p_since`, najwyżej 400 dni, inaczej 22023
--   `window_invalid` (jak `admin_revenue_email_health`, S1). Kształt jsonb
--   (`-- rpc-shape` w src/lib/revenue/community/parse.ts) jest nadzbiorem
--   kontraktu migawki S6 (`REVENUE_EVENTS_KEYS`, `REVENUE_CLUBS_KEYS`).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020130600 (`_event_revenue_net`) i po
-- 20261020130500 (zdarzenia zgłoszeń - czas decyzji liczony z tych samych
-- kolumn). Przed kodem huba S7, który czyta te funkcje.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/revenue_community_aggregates_test.sql (suma przekroju
-- = suma `_event_revenue_net` per wydarzenie, waluty rozdzielne, klub tajny
-- poza przekrojem, kwoty `null` dla editora, autor 42501, dwóch najemców,
-- okno, znacznik `pg-harness: exclude`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Przekrój wydarzeń.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_events_summary(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_money boolean;
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  -- Kwoty tylko dla admina (macierz ról huba): editor widzi liczby osób.
  v_money := public.has_role(auth.uid(), 'admin'::app_role);

  WITH ev AS (
    SELECT e.id, e.slug, e.title_pl, e.title_en, e.starts_at, e.ends_at, e.status
      FROM public.events e
     WHERE e.tenant_id = v_tenant
       AND e.status <> 'draft'
       AND e.starts_at >= p_since AND e.starts_at < p_until
  ),
  regs AS (
    SELECT ev.id AS event_id,
           count(*) FILTER (WHERE r.status IN ('approved', 'attended', 'no_show')) AS registrations,
           count(*) FILTER (WHERE r.status IN ('approved', 'attended', 'no_show')
                              AND r.attended_at IS NOT NULL) AS attended,
           count(*) FILTER (
             WHERE r.status = 'no_show'
                OR (r.status = 'approved' AND r.attended_at IS NULL
                    AND COALESCE(ev.ends_at, ev.starts_at) < now())
           ) AS no_show
      FROM ev
      LEFT JOIN public.event_registrations r
        ON r.tenant_id = v_tenant AND r.event_id = ev.id
     GROUP BY ev.id
  ),
  pool AS (
    SELECT ev.id AS event_id, count(c.id) AS plan_pool
      FROM ev
      LEFT JOIN public.plan_ticket_claims c
        ON c.tenant_id = v_tenant AND c.event_id = ev.id
       AND c.released_at IS NULL AND c.registration_id IS NOT NULL
     GROUP BY ev.id
  ),
  -- Jedno źródło przychodu z lejkiem reklam studia (`_event_revenue_net`).
  lines AS (
    SELECT ev.id AS event_id, n.kind, n.conv_id, n.currency, n.net_minor
      FROM ev
      CROSS JOIN LATERAL public._event_revenue_net(v_tenant, ev.id, NULL, NULL) n
  ),
  paid AS (
    SELECT l.event_id, count(DISTINCT (l.kind, l.conv_id)) AS paid
      FROM lines l
     GROUP BY l.event_id
  ),
  money AS (
    SELECT l.event_id, l.currency, sum(l.net_minor)::bigint AS amount
      FROM lines l
     GROUP BY l.event_id, l.currency
  ),
  per_event AS (
    SELECT ev.id, ev.slug, ev.title_pl, ev.title_en, ev.starts_at, ev.status,
           COALESCE(rg.registrations, 0) AS registrations,
           COALESCE(rg.attended, 0) AS attended,
           COALESCE(rg.no_show, 0) AS no_show,
           COALESCE(pd.paid, 0) AS paid,
           COALESCE(pl.plan_pool, 0) AS plan_pool,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('currency', m.currency,
                                                 'ticket_revenue_net_minor', m.amount)
                              ORDER BY m.currency)
               FROM money m WHERE m.event_id = ev.id
           ), '[]'::jsonb) AS by_currency
      FROM ev
      LEFT JOIN regs rg ON rg.event_id = ev.id
      LEFT JOIN pool pl ON pl.event_id = ev.id
      LEFT JOIN paid pd ON pd.event_id = ev.id
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'money_visible', v_money,
    'events_count', (SELECT count(*) FROM per_event),
    'registrations', COALESCE((SELECT sum(pe.registrations) FROM per_event pe), 0),
    'paid', COALESCE((SELECT sum(pe.paid) FROM per_event pe), 0),
    'attended', COALESCE((SELECT sum(pe.attended) FROM per_event pe), 0),
    'no_show', COALESCE((SELECT sum(pe.no_show) FROM per_event pe), 0),
    'plan_pool', COALESCE((SELECT sum(pe.plan_pool) FROM per_event pe), 0),
    'by_currency', CASE WHEN v_money THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', t.currency,
                                          'ticket_revenue_net_minor', t.amount)
                       ORDER BY t.currency)
        FROM (SELECT m.currency, sum(m.amount)::bigint AS amount
                FROM money m GROUP BY m.currency) t
    ), '[]'::jsonb) END,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'event_id', pe.id,
               'slug', pe.slug,
               'title_pl', pe.title_pl,
               'title_en', pe.title_en,
               'starts_at', pe.starts_at,
               'status', pe.status,
               'registrations', pe.registrations,
               'paid', pe.paid,
               'attended', pe.attended,
               'no_show', pe.no_show,
               'plan_pool', pe.plan_pool,
               'by_currency', CASE WHEN v_money THEN pe.by_currency END
             ) ORDER BY pe.starts_at DESC, pe.id)
        FROM per_event pe
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revenue_events_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_events_summary(timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_revenue_events_summary(timestamptz, timestamptz) IS
  'Hub S4: przekrój wydarzeń z okna (starts_at): zgłoszenia dopuszczone, obecność, no-show, opłacone, pula planu i przychód netto per waluta z _event_revenue_net (kwoty tylko admin; editor null). Sumy = suma listy per wydarzenie.';

-- ----------------------------------------------------------------------------
-- B) Przekrój klubów (bez tajnych).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_clubs_summary(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  WITH cl AS (
    SELECT c.id, c.slug, c.name_pl, c.name_en, c.visibility
      FROM public.clubs c
     WHERE c.tenant_id = v_tenant
       AND c.visibility <> 'secret'
       AND c.status <> 'draft'
  ),
  mem AS (
    SELECT m.club_id, m.user_id, m.last_read_at
      FROM public.club_members m
      JOIN cl ON cl.id = m.club_id
     WHERE m.tenant_id = v_tenant AND m.status = 'active'
  ),
  authored AS (
    SELECT t.club_id, t.author_id AS user_id
      FROM public.club_threads t
      JOIN cl ON cl.id = t.club_id
     WHERE t.tenant_id = v_tenant
       AND t.created_at >= p_since AND t.created_at < p_until
       AND t.status NOT IN ('deleted', 'hidden')
    UNION
    SELECT rp.club_id, rp.author_id
      FROM public.club_replies rp
      JOIN cl ON cl.id = rp.club_id
     WHERE rp.tenant_id = v_tenant
       AND rp.created_at >= p_since AND rp.created_at < p_until
       AND rp.status NOT IN ('deleted', 'hidden')
  ),
  contrib AS (
    SELECT DISTINCT m.club_id, m.user_id
      FROM mem m
      JOIN authored a ON a.club_id = m.club_id AND a.user_id = m.user_id
  ),
  active AS (
    SELECT c.club_id, c.user_id FROM contrib c
    UNION
    SELECT m.club_id, m.user_id
      FROM mem m
     WHERE m.last_read_at >= p_since AND m.last_read_at < p_until
  ),
  apps AS (
    SELECT a.club_id, a.status, a.created_at, a.reviewed_at
      FROM public.club_applications a
      LEFT JOIN public.clubs c ON c.id = a.club_id
     WHERE a.tenant_id = v_tenant
       AND (a.club_id IS NULL OR (c.visibility <> 'secret' AND c.tenant_id = v_tenant))
  ),
  per_club AS (
    SELECT cl.id, cl.slug, cl.name_pl, cl.name_en,
           (SELECT count(*) FROM mem m WHERE m.club_id = cl.id) AS members,
           (SELECT count(*) FROM active x WHERE x.club_id = cl.id) AS active_members,
           (SELECT count(*) FROM contrib x WHERE x.club_id = cl.id) AS contributors,
           (SELECT count(*) FROM apps a WHERE a.club_id = cl.id
              AND a.created_at >= p_since AND a.created_at < p_until) AS submitted,
           (SELECT count(*) FROM apps a WHERE a.club_id = cl.id AND a.status = 'accepted'
              AND a.reviewed_at >= p_since AND a.reviewed_at < p_until) AS accepted,
           (SELECT count(*) FROM apps a WHERE a.club_id = cl.id AND a.status = 'rejected'
              AND a.reviewed_at >= p_since AND a.reviewed_at < p_until) AS rejected
      FROM cl
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'clubs_enabled', COALESCE((
      SELECT s.value -> 'clubs_enabled' = 'true'::jsonb
        FROM public.site_settings s
       WHERE s.tenant_id = v_tenant AND s.key = 'community_modules'
    ), false),
    'clubs_count', (SELECT count(*) FROM cl),
    -- Osoby, nie członkostwa: ktoś w dwóch klubach to jeden członek społeczności.
    'members', (SELECT count(DISTINCT m.user_id) FROM mem m),
    'active_members', (SELECT count(DISTINCT x.user_id) FROM active x),
    'contributors', (SELECT count(DISTINCT x.user_id) FROM contrib x),
    'applications', jsonb_build_object(
      'submitted', (SELECT count(*) FROM apps a
                     WHERE a.created_at >= p_since AND a.created_at < p_until),
      'accepted', (SELECT count(*) FROM apps a WHERE a.status = 'accepted'
                     AND a.reviewed_at >= p_since AND a.reviewed_at < p_until),
      'rejected', (SELECT count(*) FROM apps a WHERE a.status = 'rejected'
                     AND a.reviewed_at >= p_since AND a.reviewed_at < p_until),
      'pending', (SELECT count(*) FROM apps a WHERE a.status IN ('pending', 'review', 'needs_info'))
    ),
    'decision_hours_median', (
      SELECT round((percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM (a.reviewed_at - a.created_at)) / 3600.0
             ))::numeric, 2)
        FROM apps a
       WHERE a.status IN ('accepted', 'rejected')
         AND a.reviewed_at >= p_since AND a.reviewed_at < p_until
         AND a.reviewed_at >= a.created_at
    ),
    'clubs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'club_id', pc.id,
               'slug', pc.slug,
               'name_pl', pc.name_pl,
               'name_en', pc.name_en,
               'members', pc.members,
               'active_members', pc.active_members,
               'contributors', pc.contributors,
               'applications_submitted', pc.submitted,
               'applications_accepted', pc.accepted,
               'applications_rejected', pc.rejected
             ) ORDER BY pc.members DESC, pc.slug)
        FROM per_club pc
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revenue_clubs_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_clubs_summary(timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_revenue_clubs_summary(timestamptz, timestamptz) IS
  'Hub S4: przekrój klubów bez tajnych: członkowie (stan), aktywni i współtwórcy w oknie, lejek zgłoszeń (zgłoszone/przyjęte/odrzucone w oknie, otwarte teraz), mediana godzin do decyzji, przełącznik modułu i lista per klub. Bez kwot.';
