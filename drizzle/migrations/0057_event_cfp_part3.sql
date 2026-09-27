-- CZESC 3/6 MIGRACJI 0057_event_cfp.sql
-- migration-split: part 3/6 of 0057_event_cfp.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 0057_event_cfp.sql,
-- potem 0057_event_cfp_part2.sql .. 0057_event_cfp_part6.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.

CREATE OR REPLACE FUNCTION public.admin_event_cfp_field_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_cfp_fields%ROWTYPE;
  v_event_id uuid;
  v_key text;
  v_type text;
  v_label_pl text;
  v_label_en text;
  v_help_pl text;
  v_help_en text;
  v_options jsonb := '[]'::jsonb;
  v_option jsonb;
  v_values text[] := ARRAY[]::text[];
  v_value text;
  v_sort integer;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT f.* INTO v_row
      FROM public.event_cfp_fields f
     WHERE f.tenant_id = v_tenant AND f.id = v_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: question does not exist in this tenant';
    END IF;
    v_event_id := v_row.event_id;
    IF p_payload ? 'key' AND btrim(COALESCE(p_payload->>'key', '')) <> v_row.key THEN
      RAISE EXCEPTION 'key_immutable: the key of an existing question cannot change';
    END IF;
    v_key := v_row.key;
  ELSE
    v_event_id := NULLIF(p_payload->>'event_id', '')::uuid;
    IF v_event_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;
    v_key := btrim(COALESCE(p_payload->>'key', ''));
    IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
      RAISE EXCEPTION 'invalid_key: key must be 2-49 lowercase letters, digits or underscores';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id AND f.key = v_key
    ) THEN
      RAISE EXCEPTION 'key_taken: another question already uses this key';
    END IF;
  END IF;

  v_type := CASE WHEN p_payload ? 'field_type' THEN p_payload->>'field_type' ELSE v_row.field_type END;
  IF v_type IS NULL OR v_type NOT IN ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'url', 'number') THEN
    RAISE EXCEPTION 'invalid_field_type: unknown question type';
  END IF;

  v_label_pl := CASE WHEN p_payload ? 'label_pl' THEN btrim(COALESCE(p_payload->>'label_pl', '')) ELSE v_row.label_pl END;
  v_label_en := CASE WHEN p_payload ? 'label_en' THEN btrim(COALESCE(p_payload->>'label_en', '')) ELSE v_row.label_en END;
  IF char_length(COALESCE(v_label_pl, '')) NOT BETWEEN 1 AND 200
     OR char_length(COALESCE(v_label_en, '')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_labels: both labels are required (up to 200 characters)';
  END IF;

  v_help_pl := CASE WHEN p_payload ? 'help_pl' THEN btrim(COALESCE(p_payload->>'help_pl', '')) ELSE COALESCE(v_row.help_pl, '') END;
  v_help_en := CASE WHEN p_payload ? 'help_en' THEN btrim(COALESCE(p_payload->>'help_en', '')) ELSE COALESCE(v_row.help_en, '') END;
  IF char_length(v_help_pl) > 500 OR char_length(v_help_en) > 500 THEN
    RAISE EXCEPTION 'invalid_help: help texts are limited to 500 characters';
  END IF;

  IF v_type IN ('select', 'multiselect') THEN
    v_option := CASE WHEN p_payload ? 'options' THEN p_payload->'options' ELSE COALESCE(v_row.options, '[]'::jsonb) END;
    IF jsonb_typeof(v_option) IS DISTINCT FROM 'array'
       OR jsonb_array_length(CASE WHEN jsonb_typeof(v_option) = 'array' THEN v_option ELSE '[]'::jsonb END)
          NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'invalid_options: a choice question needs 1-50 options';
    END IF;
    FOR v_option IN SELECT value FROM jsonb_array_elements(v_option) LOOP
      v_value := btrim(COALESCE(v_option->>'value', ''));
      IF jsonb_typeof(v_option) <> 'object'
         OR v_value !~ '^[a-z0-9][a-z0-9_-]{0,48}$'
         OR v_value = ANY (v_values)
         OR char_length(btrim(COALESCE(v_option->>'label_pl', ''))) NOT BETWEEN 1 AND 120
         OR char_length(btrim(COALESCE(v_option->>'label_en', ''))) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'invalid_options: every option needs a unique value and both labels';
      END IF;
      v_values := v_values || v_value;
      v_options := v_options || jsonb_build_array(jsonb_build_object(
        'value', v_value,
        'label_pl', btrim(v_option->>'label_pl'),
        'label_en', btrim(v_option->>'label_en')));
    END LOOP;
  END IF;

  IF v_id IS NULL THEN
    v_sort := public._event_cfp_jsonb_int(p_payload->'sort_order');
    IF v_sort IS NULL THEN
      SELECT COALESCE(max(f.sort_order), 0) + 10 INTO v_sort
        FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id;
    END IF;
    INSERT INTO public.event_cfp_fields (
      tenant_id, event_id, key, field_type, label_pl, label_en, help_pl, help_en,
      is_required, options, sort_order, is_active
    ) VALUES (
      v_tenant, v_event_id, v_key, v_type, v_label_pl, v_label_en, v_help_pl, v_help_en,
      COALESCE(CASE WHEN jsonb_typeof(p_payload->'is_required') = 'boolean'
        THEN (p_payload->>'is_required')::boolean END, false),
      v_options, v_sort,
      COALESCE(CASE WHEN jsonb_typeof(p_payload->'is_active') = 'boolean'
        THEN (p_payload->>'is_active')::boolean END, true)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_cfp_fields f SET
      field_type = v_type,
      label_pl = v_label_pl,
      label_en = v_label_en,
      help_pl = v_help_pl,
      help_en = v_help_en,
      is_required = CASE WHEN jsonb_typeof(p_payload->'is_required') = 'boolean'
        THEN (p_payload->>'is_required')::boolean ELSE f.is_required END,
      options = v_options,
      sort_order = COALESCE(public._event_cfp_jsonb_int(p_payload->'sort_order'), f.sort_order),
      is_active = CASE WHEN jsonb_typeof(p_payload->'is_active') = 'boolean'
        THEN (p_payload->>'is_active')::boolean ELSE f.is_active END
    WHERE f.tenant_id = v_tenant AND f.id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_field_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_field_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_field_upsert(jsonb) IS
  'Pytanie formularza zgloszenia: zalozenie albo zmiana (PATCH po obecnosci klucza, klucz niezmienny). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_field_delete(p_field_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  DELETE FROM public.event_cfp_fields f WHERE f.tenant_id = v_tenant AND f.id = p_field_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: question does not exist in this tenant';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_field_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_field_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_field_delete(uuid) IS
  'Usuniecie pytania formularza zgloszenia (odpowiedzi w zgloszeniach zostaja). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_fields_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_ids uuid[];
  v_count integer;
BEGIN
  IF v_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF jsonb_typeof(p_payload->'ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_order: ids must be a list';
  END IF;
  BEGIN
    SELECT COALESCE(array_agg(x::uuid ORDER BY o), ARRAY[]::uuid[]) INTO v_ids
      FROM jsonb_array_elements_text(p_payload->'ids') WITH ORDINALITY AS a(x, o);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_order: ids must be identifiers';
  END;
  SELECT count(*) INTO v_count
    FROM public.event_cfp_fields f
   WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id;
  IF cardinality(v_ids) <> v_count
     OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> v_count
     OR EXISTS (
       SELECT 1 FROM unnest(v_ids) x
        WHERE NOT EXISTS (
          SELECT 1 FROM public.event_cfp_fields f
           WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id AND f.id = x
        )
     ) THEN
    RAISE EXCEPTION 'invalid_order: ids must list every question of this event exactly once';
  END IF;
  UPDATE public.event_cfp_fields f SET sort_order = a.o * 10
    FROM unnest(v_ids) WITH ORDINALITY AS a(fid, o)
   WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id AND f.id = a.fid;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_fields_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_fields_reorder(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_fields_reorder(jsonb) IS
  'Nowa kolejnosc pytan formularza zgloszenia (pelna lista identyfikatorow). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 12) PANEL: LISTA, LICZNIKI I SZCZEGOL ZGLOSZEN
--
-- Szkic (`draft`) jest prywatny dla zglaszajacego - panel go nie listuje,
-- licznik podaje tylko ile ich jest.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_submissions_list(p_payload jsonb)
RETURNS TABLE (
  id uuid,
  status text,
  title_pl text,
  title_en text,
  talk_language text,
  format_key text,
  duration_min integer,
  track_id uuid,
  track_name_pl text,
  track_name_en text,
  speaker_name text,
  speaker_email text,
  speakers_count integer,
  submitted_at timestamptz,
  decided_at timestamptz,
  updated_at timestamptz,
  reviews_count integer,
  overall_avg numeric,
  weighted_avg numeric,
  recommendations jsonb,
  notified_status text,
  session_id uuid,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_status text := NULLIF(btrim(COALESCE(p_payload->>'status', '')), '');
  v_track uuid := NULLIF(p_payload->>'track_id', '')::uuid;
  v_q text := lower(NULLIF(btrim(COALESCE(p_payload->>'q', '')), ''));
  v_sort text := COALESCE(NULLIF(p_payload->>'sort', ''), 'recent');
  v_limit integer := LEAST(GREATEST(COALESCE(public._event_cfp_jsonb_int(p_payload->'limit'), 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(public._event_cfp_jsonb_int(p_payload->'offset'), 0), 0);
BEGIN
  IF v_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN (
    'submitted', 'under_review', 'changes_requested', 'accepted', 'waitlisted',
    'rejected', 'withdrawn', 'confirmed', 'declined'
  ) THEN
    RAISE EXCEPTION 'invalid_status: unknown submission status filter';
  END IF;
  IF v_sort NOT IN ('recent', 'score', 'title') THEN
    RAISE EXCEPTION 'invalid_payload: sort must be recent, score or title';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT s.id, s.status, s.title_pl, s.title_en, s.talk_language, s.format_key, s.duration_min,
           s.track_id, t.name_pl AS track_name_pl, t.name_en AS track_name_en,
           btrim(p.first_name || ' ' || p.last_name) AS speaker_name,
           p.email AS speaker_email,
           (SELECT count(*)::integer FROM public.event_cfp_submission_speakers sp
             WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id) AS speakers_count,
           s.submitted_at, s.decided_at, s.updated_at,
           public._event_cfp_review_summary(s.tenant_id, s.id) AS summary,
           s.notified_status, s.session_id
      FROM public.event_cfp_submissions s
      JOIN public.event_people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
      LEFT JOIN public.event_tracks t
        ON t.tenant_id = s.tenant_id AND t.event_id = s.event_id AND t.id = s.track_id
     WHERE s.tenant_id = v_tenant
       AND s.event_id = v_event_id
       AND s.status <> 'draft'
       AND (v_status IS NULL OR s.status = v_status)
       AND (v_track IS NULL OR s.track_id = v_track)
       AND (
         v_q IS NULL
         OR strpos(lower(s.title_pl || ' ' || s.title_en || ' ' || p.first_name || ' '
                         || p.last_name || ' ' || COALESCE(p.email, '')), v_q) > 0
         OR EXISTS (
           SELECT 1 FROM public.event_cfp_submission_speakers sp
            WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id
              AND strpos(lower(sp.first_name || ' ' || sp.last_name || ' ' || COALESCE(sp.email, '')), v_q) > 0
         )
       )
  )
  SELECT b.id, b.status, b.title_pl, b.title_en, b.talk_language, b.format_key, b.duration_min,
         b.track_id, b.track_name_pl, b.track_name_en, b.speaker_name, b.speaker_email,
         b.speakers_count, b.submitted_at, b.decided_at, b.updated_at,
         (b.summary->>'reviews_count')::integer,
         (b.summary->>'overall_avg')::numeric,
         (b.summary->>'weighted_avg')::numeric,
         b.summary->'recommendations',
         b.notified_status, b.session_id,
         (count(*) OVER ())::integer
    FROM base b
   ORDER BY
     CASE WHEN v_sort = 'score' THEN COALESCE((b.summary->>'weighted_avg')::numeric,
                                              (b.summary->>'overall_avg')::numeric) END DESC NULLS LAST,
     CASE WHEN v_sort = 'title' THEN lower(COALESCE(NULLIF(btrim(b.title_pl), ''), b.title_en)) END ASC,
     b.submitted_at DESC NULLS LAST,
     b.id
   LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submissions_list(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submissions_list(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submissions_list(jsonb) IS
  'Lista zgloszen naboru (bez szkicow) z filtrami stan/sciezka/szukaj, stronicowaniem i agregatami ocen. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_submissions_counts(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_min integer;
  v_out jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  SELECT COALESCE(max(cs.min_reviews), 2) INTO v_min
    FROM public.event_cfp_settings cs
   WHERE cs.tenant_id = v_tenant AND cs.event_id = p_event_id;

  SELECT jsonb_build_object(
    'total', count(*) FILTER (WHERE s.status <> 'draft'),
    'draft', count(*) FILTER (WHERE s.status = 'draft'),
    'submitted', count(*) FILTER (WHERE s.status = 'submitted'),
    'under_review', count(*) FILTER (WHERE s.status = 'under_review'),
    'changes_requested', count(*) FILTER (WHERE s.status = 'changes_requested'),
    'accepted', count(*) FILTER (WHERE s.status = 'accepted'),
    'waitlisted', count(*) FILTER (WHERE s.status = 'waitlisted'),
    'rejected', count(*) FILTER (WHERE s.status = 'rejected'),
    'withdrawn', count(*) FILTER (WHERE s.status = 'withdrawn'),
    'confirmed', count(*) FILTER (WHERE s.status = 'confirmed'),
    'declined', count(*) FILTER (WHERE s.status = 'declined'),
    'needs_reviews', count(*) FILTER (
      WHERE s.status IN ('submitted', 'under_review')
        AND (public._event_cfp_review_summary(s.tenant_id, s.id)->>'reviews_count')::integer < v_min
    ),
    'min_reviews', v_min
  ) INTO v_out
  FROM public.event_cfp_submissions s
  WHERE s.tenant_id = v_tenant AND s.event_id = p_event_id;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submissions_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submissions_counts(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submissions_counts(uuid) IS
  'Liczniki zgloszen naboru per stan oraz liczba zgloszen z mniejsza niz min_reviews liczba ocen. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_submission_detail(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_sub public.event_cfp_submissions%ROWTYPE;
BEGIN
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = p_submission_id AND s.status <> 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;

  RETURN jsonb_build_object(
    'submission', to_jsonb(v_sub),
    'event', (
      SELECT jsonb_build_object(
        'id', e.id, 'slug', e.slug, 'title_pl', e.title_pl, 'title_en', e.title_en,
        'timezone', e.timezone, 'starts_at', e.starts_at, 'ends_at', e.ends_at)
        FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_sub.event_id
    ),
    'person', (
      SELECT jsonb_build_object(
        'id', p.id, 'user_id', p.user_id, 'first_name', p.first_name, 'last_name', p.last_name,
        'email', p.email, 'phone', p.phone, 'job_title', p.job_title,
        'company_text', p.company_text, 'consent_marketing_at', p.consent_marketing_at,
        'consent_withdrawn_at', p.consent_withdrawn_at)
        FROM public.event_people p WHERE p.tenant_id = v_tenant AND p.id = v_sub.person_id
    ),
    'speakers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', sp.id, 'person_id', sp.person_id, 'is_primary', sp.is_primary, 'role', sp.role,
        'sort_order', sp.sort_order, 'first_name', sp.first_name, 'last_name', sp.last_name,
        'email', sp.email, 'job_title', sp.job_title, 'company_text', sp.company_text,
        'crm', CASE WHEN k.person_id IS NULL THEN NULL ELSE jsonb_build_object(
          'sync_status', k.sync_status, 'crm_lead_id', k.crm_lead_id, 'last_error', k.last_error,
          'synced_at', k.synced_at, 'last_attempt_at', k.last_attempt_at) END
      ) ORDER BY sp.is_primary DESC, sp.sort_order, sp.created_at), '[]'::jsonb)
        FROM public.event_cfp_submission_speakers sp
        LEFT JOIN public.event_person_crm_links k
          ON k.tenant_id = sp.tenant_id AND k.person_id = sp.person_id
       WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id
    ),
    'fields', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', f.key, 'field_type', f.field_type, 'label_pl', f.label_pl, 'label_en', f.label_en,
        'options', f.options, 'is_active', f.is_active) ORDER BY f.sort_order, f.key), '[]'::jsonb)
        FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_sub.event_id
    ),
    'reviews', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reviewer_id', r.reviewer_id, 'user_id', rv.user_id,
        'reviewer_name', COALESCE(NULLIF(btrim(pr.display_name), ''),
                                  NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), ''),
                                  ''),
        'scores', r.scores, 'overall', r.overall, 'recommendation', r.recommendation,
        'comment_private', r.comment_private, 'comment_to_speaker', r.comment_to_speaker,
        'conflict_of_interest', r.conflict_of_interest, 'updated_at', r.updated_at
      ) ORDER BY r.updated_at DESC), '[]'::jsonb)
        FROM public.event_cfp_reviews r
        JOIN public.event_cfp_reviewers rv
          ON rv.tenant_id = r.tenant_id AND rv.event_id = r.event_id AND rv.id = r.reviewer_id
        LEFT JOIN public.profiles pr ON pr.id = rv.user_id
       WHERE r.tenant_id = v_tenant AND r.submission_id = v_sub.id
    ),
    'summary', public._event_cfp_review_summary(v_tenant, v_sub.id),
    'settings', (
      SELECT jsonb_build_object(
        'score_max', COALESCE(max(cs.score_max), 5),
        'review_criteria', COALESCE((array_agg(cs.review_criteria))[1], '[]'::jsonb),
        'min_reviews', COALESCE(max(cs.min_reviews), 2),
        'formats', COALESCE((array_agg(cs.formats))[1], '[]'::jsonb))
        FROM public.event_cfp_settings cs
       WHERE cs.tenant_id = v_tenant AND cs.event_id = v_sub.event_id
    ),
    'track', (
      SELECT jsonb_build_object('id', t.id, 'name_pl', t.name_pl, 'name_en', t.name_en)
        FROM public.event_tracks t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_sub.event_id AND t.id = v_sub.track_id
    ),
    'session', (
      SELECT jsonb_build_object(
        'id', ses.id, 'title_pl', ses.title_pl, 'title_en', ses.title_en,
        'starts_at', ses.starts_at, 'ends_at', ses.ends_at, 'status', ses.status)
        FROM public.event_sessions ses
       WHERE ses.tenant_id = v_tenant AND ses.event_id = v_sub.event_id AND ses.id = v_sub.session_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submission_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submission_detail(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submission_detail(uuid) IS
  'Szczegol zgloszenia dla organizatora: tresc, odpowiedzi, wystepujacy ze stanem CRM, oceny z komentarzami prywatnymi, agregaty, powiazana sesja. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 12b) SKUTKI PRZYJECIA: WPIS NA LISTE PO POTWIERDZENIU I COFNIECIE
--
-- Przyjecie zapisuje w wierszu wystepujacego, co DODALO (nakladka, grupa,
-- zapis); potwierdzenie dopisuje osobe do publicznej listy prelegentow
-- i zapamietuje wpis. Cofniecie (rezygnacja, wycofanie przyjetego, cofniecie
-- przyjecia przez organizatora) zdejmuje DOKLADNIE to - nigdy rzeczy, ktore
-- istnialy wczesniej.
-- ----------------------------------------------------------------------------

-- Potwierdzenie udzialu: kazdy wystepujacy z nakladka trafia na liste
-- prelegentow wydarzenia. Wpis istniejacy wczesniej (reczny, z innego
-- zgloszenia) NIE jest zapamietywany - cofniecie tego zgloszenia go nie ruszy.
CREATE OR REPLACE FUNCTION public._event_cfp_roster_publish(p_tenant uuid, p_submission_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
  v_sp record;
  v_entry uuid;
  v_added integer := 0;
BEGIN
  SELECT s.event_id INTO v_event
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = p_tenant AND s.id = p_submission_id;

  FOR v_sp IN
    SELECT sp.id, sp.speaker_profile_id
      FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = p_tenant AND sp.submission_id = p_submission_id
       AND sp.speaker_profile_id IS NOT NULL
     ORDER BY sp.is_primary DESC, sp.sort_order, sp.created_at, sp.id
  LOOP
    SELECT en.id INTO v_entry
      FROM public.event_speaker_entries en
     WHERE en.tenant_id = p_tenant AND en.event_id = v_event
       AND en.speaker_profile_id = v_sp.speaker_profile_id;
    CONTINUE WHEN v_entry IS NOT NULL;
    v_entry := public._event_speaker_roster_add(p_tenant, v_event, v_sp.speaker_profile_id);
    UPDATE public.event_cfp_submission_speakers sp SET added_roster_entry_id = v_entry
     WHERE sp.tenant_id = p_tenant AND sp.id = v_sp.id;
    v_added := v_added + 1;
  END LOOP;
  RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_roster_publish(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_roster_publish(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_roster_publish(uuid, uuid) IS
  'Po potwierdzeniu udzialu: wystepujacy zgloszenia na publiczna liste prelegentow (event_speaker_entries); zapamietuje wylacznie wpisy, ktore sam dodal (added_roster_entry_id). Liczba dodanych wpisow.';

-- Cofniecie skutkow przyjecia. Gdy ta sama osoba ma w wydarzeniu INNE aktywne
-- przyjecie, zasoby przechodza na nie (zapis i grupa - przy przyjetym albo
-- potwierdzonym, wpis na liscie - tylko przy potwierdzonym), zamiast znikac.
-- Wpis na liscie zostaje tez wtedy, gdy organizator obsadzil osobe w INNEJ,
-- nieodwolanej sesji - to juz jego reczna decyzja.
--
-- Zapis z biletem prelegenta cofamy TYLKO, dopoki nalezy do tej osoby
-- (`person_id` wystepujacego). Przekazany dalej bilet (przekazanie biletu
-- uczestnika) jest juz cudzy: jego anulowanie odebraloby miejsce osobie,
-- ktora nic nie zglaszala. Taki zapis zostaje, a slad `added_registration_id`
-- znika razem z reszta sladu przyjecia.
--
-- Po anulowaniu zapisu konto prelegenta traci tez zapisy na sesje (z awansem
-- z kolejki sesji), zakladki planu i starsza rezerwacje RSVP
-- (`_event_participant_release`, ta sama sciezka co pelny zwrot) - chyba ze
-- trzyma inne aktywne zgloszenie na to wydarzenie. Wolane PO petli, zeby
-- `event_sessions` bylo ostatnim szczeblem blokad (wydarzenie -> zapis ->
-- sesje), takze przy kilku wystepujacych.
CREATE OR REPLACE FUNCTION public._event_cfp_acceptance_undo(
  p_tenant uuid, p_submission_id uuid, p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
  v_session uuid;
  v_sp record;
  v_active uuid;
  v_confirmed uuid;
  v_reg public.event_registrations%ROWTYPE;
  v_n integer;
  v_regs integer := 0;
  v_entries integer := 0;
  v_groups integer := 0;
  v_cast integer := 0;
  v_user uuid;
  v_users uuid[] := '{}'::uuid[];
  v_release jsonb;
  v_signups integer := 0;
BEGIN
  SELECT s.event_id, s.session_id INTO v_event, v_session
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = p_tenant AND s.id = p_submission_id;

  FOR v_sp IN
    SELECT sp.*
      FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = p_tenant AND sp.submission_id = p_submission_id
       AND sp.person_id IS NOT NULL
     ORDER BY sp.is_primary DESC, sp.sort_order, sp.created_at, sp.id
  LOOP
    -- Obsada sesji TEGO zgloszenia znika zawsze - osoba w niej nie wystapi.
    IF v_session IS NOT NULL AND v_sp.speaker_profile_id IS NOT NULL THEN
      DELETE FROM public.event_session_speakers ss
       WHERE ss.tenant_id = p_tenant AND ss.event_id = v_event AND ss.session_id = v_session
         AND ss.speaker_profile_id = v_sp.speaker_profile_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_cast := v_cast + v_n;
    END IF;

    SELECT o.id INTO v_active
      FROM public.event_cfp_submission_speakers o
      JOIN public.event_cfp_submissions os ON os.tenant_id = o.tenant_id AND os.id = o.submission_id
     WHERE o.tenant_id = p_tenant AND os.event_id = v_event AND o.person_id = v_sp.person_id
       AND o.submission_id <> p_submission_id AND os.status IN ('accepted', 'confirmed')
     ORDER BY (os.status = 'confirmed') DESC, os.decided_at, o.id
     LIMIT 1;
    SELECT o.id INTO v_confirmed
      FROM public.event_cfp_submission_speakers o
      JOIN public.event_cfp_submissions os ON os.tenant_id = o.tenant_id AND os.id = o.submission_id
     WHERE o.tenant_id = p_tenant AND os.event_id = v_event AND o.person_id = v_sp.person_id
       AND o.submission_id <> p_submission_id AND os.status = 'confirmed'
     ORDER BY os.decided_at, o.id
     LIMIT 1;

    -- Zapis z biletem prelegenta (tylko wciaz nalezacy do tej osoby).
    IF v_sp.added_registration_id IS NOT NULL AND v_active IS NOT NULL THEN
      UPDATE public.event_cfp_submission_speakers o
         SET added_registration_id = COALESCE(o.added_registration_id, v_sp.added_registration_id)
       WHERE o.tenant_id = p_tenant AND o.id = v_active
         AND EXISTS (
           SELECT 1 FROM public.event_registrations r
            WHERE r.tenant_id = p_tenant AND r.id = v_sp.added_registration_id
              AND r.person_id = v_sp.person_id
         );
    ELSIF v_sp.added_registration_id IS NOT NULL THEN
      -- Kolejnosc blokad jak w decyzji organizatora o zapisie: wydarzenie,
      -- potem wiersz zapisu. Warunek osoby sprawdzany POD blokada wiersza.
      PERFORM 1 FROM public.events e WHERE e.tenant_id = p_tenant AND e.id = v_event FOR UPDATE;
      SELECT r.* INTO v_reg
        FROM public.event_registrations r
       WHERE r.tenant_id = p_tenant AND r.id = v_sp.added_registration_id
         AND r.person_id = v_sp.person_id
       FOR UPDATE;
      IF FOUND AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved') THEN
        UPDATE public.event_registrations r SET
          status = 'cancelled',
          cancelled_at = now(),
          waitlist_position = NULL,
          decided_by = p_actor,
          decided_at = now(),
          decision_source = 'system',
          qr_token_hash = NULL,
          qr_issued_at = NULL
        WHERE r.tenant_id = p_tenant AND r.id = v_reg.id;
        PERFORM public.emit_domain_event(
          p_tenant,
          'event_registration',
          v_reg.id::text,
          'event.registration.decided.v1',
          jsonb_build_object('event_id', v_event, 'person_id', v_reg.person_id,
                             'from', v_reg.status, 'action', 'cancel'),
          p_actor
        );
        IF v_reg.status = 'approved' THEN
          PERFORM public._event_waitlist_promote(p_tenant, v_event, v_reg.ticket_type_id, 1);
        END IF;
        v_regs := v_regs + 1;
        v_user := NULL;
        SELECT p.user_id INTO v_user
          FROM public.event_people p
         WHERE p.tenant_id = p_tenant AND p.id = v_reg.person_id;
        IF v_user IS NOT NULL AND NOT (v_user = ANY (v_users)) THEN
          v_users := v_users || v_user;
        END IF;
      END IF;
    END IF;

    -- Czlonkostwo w grupie prelegentow.
    IF v_sp.added_group_id IS NOT NULL AND v_active IS NOT NULL THEN
      UPDATE public.event_cfp_submission_speakers o
         SET added_group_id = COALESCE(o.added_group_id, v_sp.added_group_id)
       WHERE o.tenant_id = p_tenant AND o.id = v_active;
    ELSIF v_sp.added_group_id IS NOT NULL THEN
      DELETE FROM public.event_group_members m
       WHERE m.tenant_id = p_tenant AND m.group_id = v_sp.added_group_id
         AND m.person_id = v_sp.person_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_groups := v_groups + v_n;
    END IF;

    -- Wpis na publicznej liscie prelegentow.
    IF v_sp.added_roster_entry_id IS NOT NULL AND v_confirmed IS NOT NULL THEN
      UPDATE public.event_cfp_submission_speakers o
         SET added_roster_entry_id = COALESCE(o.added_roster_entry_id, v_sp.added_roster_entry_id)
       WHERE o.tenant_id = p_tenant AND o.id = v_confirmed;
    ELSIF v_sp.added_roster_entry_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM public.event_session_speakers ss
        JOIN public.event_sessions ses
          ON ses.tenant_id = ss.tenant_id AND ses.event_id = ss.event_id AND ses.id = ss.session_id
       WHERE ss.tenant_id = p_tenant AND ss.event_id = v_event
         AND ss.speaker_profile_id = v_sp.speaker_profile_id
         AND ses.status <> 'cancelled'
    ) THEN
      DELETE FROM public.event_speaker_entries en
       WHERE en.tenant_id = p_tenant AND en.id = v_sp.added_roster_entry_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_entries := v_entries + v_n;
    END IF;

    UPDATE public.event_cfp_submission_speakers sp SET
      added_roster_entry_id = NULL,
      added_group_id = NULL,
      added_registration_id = NULL
    WHERE sp.tenant_id = p_tenant AND sp.id = v_sp.id;
  END LOOP;

  FOREACH v_user IN ARRAY v_users LOOP
    v_release := public._event_participant_release(p_tenant, v_event, v_user, 'cfp_revoked');
    v_signups := v_signups + (v_release->>'signups_cancelled')::integer;
  END LOOP;

  RETURN jsonb_build_object(
    'registrations_cancelled', v_regs,
    'roster_entries_removed', v_entries,
    'group_memberships_removed', v_groups,
    'session_cast_removed', v_cast,
    'session_signups_cancelled', v_signups
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_acceptance_undo(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_acceptance_undo(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_acceptance_undo(uuid, uuid, uuid) IS
  'Cofniecie skutkow przyjecia zgloszenia: obsada sesji zgloszenia, zapis utworzony przy przyjeciu (anulowany tylko, dopoki nalezy do tej osoby; awans z rezerwy; potem _event_participant_release konta: zapisy na sesje, zakladki, RSVP), czlonkostwo dopisane do grupy, wpis dodany na liste prelegentow. Inne aktywne przyjecie tej samej osoby przejmuje zasoby. Liczniki cofnietych elementow.';

-- ----------------------------------------------------------------------------
-- 13) PANEL: DECYZJA
--
-- Przyjecie ma osobna funkcje (wpis do rejestru prelegentow), tu zapadaja
-- pozostale decyzje. Ta sama decyzja powtorzona zmienia notatke i informacje
-- zwrotna oraz stempel decyzji - czyli pozwala wyslac poprawiony mail.
--
-- COFNIECIE PRZYJECIA. Zgloszenie przyjete albo potwierdzone mozna przeniesc
-- WYLACZNIE na liste rezerwowa albo odrzucic - i wtedy cofaja sie skutki
-- przyjecia (`_event_cfp_acceptance_undo`). Powrot do oceny czy prosby
-- o poprawki po przyjeciu nie ma sensu (prelegent dostal juz zaproszenie).
--
-- Nowa decyzja kasuje `notify_error`: blad dotyczyl maila o POPRZEDNIEJ
-- decyzji, a panel ma pokazac, ze mail o tej czeka na wyslanie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_submission_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_status text := NULLIF(btrim(COALESCE(p_payload->>'status', '')), '');
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_note text;
  v_feedback text;
  v_at timestamptz := now();
  v_undone jsonb;
BEGIN
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('under_review', 'changes_requested', 'waitlisted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status: decision must be under_review, changes_requested, waitlisted or rejected';
  END IF;
  IF v_sub.status IN ('accepted', 'confirmed') THEN
    IF v_status NOT IN ('waitlisted', 'rejected') THEN
      RAISE EXCEPTION 'invalid_transition: an accepted submission can only be moved to waitlisted or rejected';
    END IF;
  ELSIF v_sub.status NOT IN ('submitted', 'under_review', 'changes_requested', 'waitlisted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_transition: a % submission cannot be decided', v_sub.status;
  END IF;

  v_note := CASE WHEN p_payload ? 'decision_note'
    THEN NULLIF(btrim(COALESCE(p_payload->>'decision_note', '')), '') ELSE v_sub.decision_note END;
  v_feedback := CASE WHEN p_payload ? 'feedback_to_speaker'
    THEN btrim(COALESCE(p_payload->>'feedback_to_speaker', '')) ELSE v_sub.feedback_to_speaker END;
  IF char_length(COALESCE(v_note, '')) > 2000 OR char_length(v_feedback) > 4000 THEN
    RAISE EXCEPTION 'invalid_note: note up to 2000 and feedback up to 4000 characters';
  END IF;
  IF v_status = 'rejected' AND char_length(COALESCE(v_note, '')) < 3 THEN
    RAISE EXCEPTION 'note_required: a rejection needs an internal note';
  END IF;

  UPDATE public.event_cfp_submissions s SET
    status = v_status,
    decision_note = v_note,
    feedback_to_speaker = v_feedback,
    decided_by = auth.uid(),
    decided_at = v_at,
    notify_error = NULL
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  IF v_sub.status IN ('accepted', 'confirmed') THEN
    v_undone := public._event_cfp_acceptance_undo(v_tenant, v_id, auth.uid());
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.decided.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id, 'status', v_status),
    auth.uid()
  );
  PERFORM public._event_cfp_crm_status(v_tenant, v_id, v_status);

  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'decided_at', v_at, 'undone', v_undone);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submission_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submission_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submission_decide(jsonb) IS
  'Decyzja o zgloszeniu (w ocenie / prosba o poprawki / lista rezerwowa / odrzucenie z notatka); z przyjetego albo potwierdzonego tylko na liste rezerwowa albo odrzucenie, z cofnieciem skutkow przyjecia. Kasuje blad poprzedniej wysylki. Tag cfp:<status> w istniejacym kontakcie CRM. Bramka: assert_event_admin_tenant().';
