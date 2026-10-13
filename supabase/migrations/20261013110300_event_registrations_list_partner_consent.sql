-- events-harness: include
-- ============================================================================
-- WYDARZENIA: LISTA ZGLOSZEN W PANELU POKAZUJE ZGODE PARTNERSKA Z TEGO
-- ZGLOSZENIA (OPS-01, panel i eksport CSV uczestnikow).
--
-- PROBLEM. `admin_event_registrations_list` oddawal w kolumnie
-- `consent_partner_sharing_at` globalny stempel OSOBY. Organizator widzial
-- w wierszu wydarzenia B (i w pliku CSV uczestnikow) date zgody zaznaczonej
-- przy wydarzeniu A - czyli dokument zgody, ktorej na B nikt nie udzielil.
-- Wycofanie zgody partnerskiej zgloszenia nie bylo widoczne nigdzie.
--
-- ZMIANA. Cialo z 20260824090214 z jedna zmiana w wyniku:
--   * `consent_partner_sharing_at` = stempel nadania z TEGO zgloszenia
--     (`event_registrations`, fundament 20261013110000);
--   * NOWA kolumna `consent_partner_withdrawn_at` = stempel wycofania tej zgody
--     (samoobsluga uczestnika albo organizator, 20261013110400).
-- Zgody jada dalej jako DATY - CSV uczestnikow niesie oba stemple, bo data
-- nadania bez daty wycofania nie jest dowodem (art. 7 ust. 1 RODO).
-- `consent_withdrawn_at` zostaje globalnym wycofaniem zgod osoby.
--
-- SYGNATURA WYNIKU SIE ZMIENIA (nowa kolumna), wiec DROP + CREATE: CREATE OR
-- REPLACE nie zmienia typu wyniku, a dwie wersje obok siebie bylyby
-- przeciazeniem niejednoznacznym dla PostgREST. ACL odtworzone dokladnie
-- jak w 20260824090214 (PUBLIC i anon bez prawa, authenticated i
-- service_role z prawem wykonania). `search_path` z dopisanym `pg_temp`
-- (regula repozytorium dla SECURITY DEFINER). Typy klienta: sekcja Functions
-- w src/integrations/supabase/types.ts.
--
-- IDEMPOTENTNA: DROP FUNCTION IF EXISTS + CREATE.
-- DOWOD: scripts/events-harness/runtime_test.d/33_partner_consent_per_registration.sql.
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer);

CREATE FUNCTION public.admin_event_registrations_list(
  p_event_id uuid,
  p_status text DEFAULT NULL,
  p_ticket_type_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  person_id uuid,
  status text,
  registration_mode text,
  source text,
  first_name text,
  last_name text,
  email text,
  phone text,
  job_title text,
  company_text text,
  company_id uuid,
  company_name text,
  social_profile_url text,
  person_user_id uuid,
  ticket_type_id uuid,
  ticket_key text,
  ticket_name_pl text,
  ticket_name_en text,
  ticket_price_cents integer,
  ticket_currency text,
  group_id uuid,
  group_key text,
  group_name_pl text,
  group_name_en text,
  group_color text,
  extra_groups_count integer,
  answers jsonb,
  decided_by uuid,
  decided_at timestamptz,
  decision_source text,
  decision_note text,
  waitlist_position integer,
  waitlist_notified_at timestamptz,
  promoted_at timestamptz,
  cancelled_at timestamptz,
  attended_at timestamptz,
  has_qr boolean,
  consent_data_processing_at timestamptz,
  consent_marketing_at timestamptz,
  consent_partner_sharing_at timestamptz,
  consent_partner_withdrawn_at timestamptz,
  consent_withdrawn_at timestamptz,
  accepted_terms_count integer,
  required_terms_missing integer,
  created_at timestamptz,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.event_id, r.person_id, r.status, r.registration_mode, r.source,
    p.first_name, p.last_name, p.email, p.phone, p.job_title,
    p.company_text, p.company_id, c.name,
    p.social_profile_url, p.user_id,
    r.ticket_type_id, t.key, t.name_pl, t.name_en, t.price_cents, t.currency,
    r.group_id, g.key, g.name_pl, g.name_en, g.color,
    COALESCE(gm.cnt, 0)::integer,
    r.answers, r.decided_by, r.decided_at, r.decision_source, r.decision_note,
    r.waitlist_position, r.waitlist_notified_at, r.promoted_at,
    r.cancelled_at, r.attended_at,
    (r.qr_token_hash IS NOT NULL),
    p.consent_data_processing_at, p.consent_marketing_at,
    -- ZMIANA 20261013110300: zgoda partnerska Z TEGO ZGLOSZENIA (nadanie
    -- i wycofanie), nie globalny stempel osoby z dowolnego wydarzenia.
    r.consent_partner_sharing_at, r.consent_partner_withdrawn_at,
    p.consent_withdrawn_at,
    COALESCE(ta.accepted, 0)::integer,
    COALESCE(tm.missing, 0)::integer,
    r.created_at,
    count(*) OVER ()::integer
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  LEFT JOIN public.crm_companies c
    ON c.id = p.company_id AND c.tenant_id = p.tenant_id
  LEFT JOIN public.event_ticket_types t
    ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
  LEFT JOIN public.event_groups g
    ON g.id = r.group_id AND g.tenant_id = r.tenant_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_group_members m
    WHERE m.tenant_id = r.tenant_id
      AND m.event_id = r.event_id
      AND m.person_id = r.person_id
  ) gm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS accepted
    FROM public.event_term_acceptances a
    JOIN public.event_terms tr
      ON tr.id = a.term_id AND tr.tenant_id = a.tenant_id
    WHERE a.tenant_id = r.tenant_id
      AND a.person_id = r.person_id
      AND tr.event_id = r.event_id
      AND a.version = tr.version
      AND a.withdrawn_at IS NULL
  ) ta ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS missing
    FROM public.event_terms tr
    WHERE tr.tenant_id = r.tenant_id
      AND tr.event_id = r.event_id
      AND tr.is_active
      AND tr.is_required
      AND NOT EXISTS (
        SELECT 1 FROM public.event_term_acceptances a
        WHERE a.tenant_id = tr.tenant_id
          AND a.term_id = tr.id
          AND a.person_id = r.person_id
          AND a.version = tr.version
          AND a.withdrawn_at IS NULL
      )
  ) tm ON true
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND (p_status IS NULL OR p_status = 'all' OR r.status = p_status)
    AND (p_ticket_type_id IS NULL OR r.ticket_type_id = p_ticket_type_id)
    AND (
      p_group_id IS NULL
      OR r.group_id = p_group_id
      OR EXISTS (
        SELECT 1 FROM public.event_group_members m2
        WHERE m2.tenant_id = r.tenant_id
          AND m2.group_id = p_group_id
          AND m2.person_id = r.person_id
      )
    )
    AND (p_from IS NULL OR r.created_at >= p_from)
    AND (p_to IS NULL OR r.created_at <= p_to)
    AND (
      v_q IS NULL
      OR p.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR p.email_norm LIKE '%' || lower(v_q) || '%'
      OR p.company_text ILIKE '%' || v_q || '%'
      OR p.job_title ILIKE '%' || v_q || '%'
    )
  ORDER BY
    CASE WHEN r.status = 'waitlist' THEN 0 ELSE 1 END,
    r.waitlist_position NULLS LAST,
    r.created_at DESC,
    r.id DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) IS
  'Lista zapisow wydarzenia dla panelu: filtry (status, bilet, grupa, fraza, zakres dat), licznik calosci do paginacji, liczba brakujacych zgod wymaganych. Zgoda partnerska (nadanie i wycofanie) z TEGO zgloszenia; consent_withdrawn_at to globalne wycofanie zgod osoby. Nie oddaje haszy tokenow. Bramka: assert_editor_tenant().';
