DROP FUNCTION IF EXISTS public.admin_event_groups_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_groups_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  color text,
  attendee_visibility text,
  can_see_attendees boolean,
  can_meet boolean,
  can_chat boolean,
  can_lead_retrieval boolean,
  can_see_recording boolean,
  min_tier_rank integer,
  sort_order integer,
  is_default boolean,
  is_system boolean,
  members_count integer,
  primary_members_count integer,
  extra_members_count integer,
  tickets_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    g.id, g.event_id, g.key, g.name_pl, g.name_en,
    g.description_pl, g.description_en, g.color,
    g.attendee_visibility, g.can_see_attendees, g.can_meet, g.can_chat,
    g.can_lead_retrieval, g.can_see_recording, g.min_tier_rank, g.sort_order,
    g.is_default, g.is_system,
    (COALESCE(pm.cnt, 0) + COALESCE(em.cnt, 0))::integer,
    COALESCE(pm.cnt, 0)::integer,
    COALESCE(em.cnt, 0)::integer,
    COALESCE(tk.cnt, 0)::integer,
    g.created_at, g.updated_at
  FROM public.event_groups g
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT r.person_id)::integer AS cnt
    FROM public.event_registrations r
    WHERE r.tenant_id = g.tenant_id
      AND r.group_id = g.id
      AND r.status NOT IN ('cancelled', 'rejected')
  ) pm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_group_members m
    WHERE m.tenant_id = g.tenant_id AND m.group_id = g.id
  ) em ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_ticket_types t
    WHERE t.tenant_id = g.tenant_id AND t.group_id = g.id
  ) tk ON true
  WHERE g.tenant_id = v_tenant AND g.event_id = p_event_id
  ORDER BY g.sort_order, g.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_groups_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_groups_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_groups_list(uuid) IS
  'Grupy uczestnikow wydarzenia z uprawnieniami i licznikami: czlonkowie podstawowi (z zapisu), dodatkowi (czlonkostwo) i bilety nadajace grupe.';

DROP FUNCTION IF EXISTS public.admin_event_group_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_group_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_is_default boolean := (NULLIF(p_payload->>'is_default', ''))::boolean;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT g.event_id INTO v_event_id
    FROM public.event_groups g
    WHERE g.id = v_id AND g.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: group does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;

  IF v_is_default IS TRUE THEN
    UPDATE public.event_groups g
    SET is_default = false
    WHERE g.tenant_id = v_tenant
      AND g.event_id = v_event_id
      AND g.is_default
      AND (v_id IS NULL OR g.id <> v_id);
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_groups g SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), g.description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), g.description_en),
      color = CASE
        WHEN p_payload ? 'color' THEN NULLIF(btrim(COALESCE(p_payload->>'color', '')), '')
        ELSE g.color
      END,
      attendee_visibility =
        COALESCE(NULLIF(p_payload->>'attendee_visibility', ''), g.attendee_visibility),
      can_see_attendees =
        COALESCE((NULLIF(p_payload->>'can_see_attendees', ''))::boolean, g.can_see_attendees),
      can_meet = COALESCE((NULLIF(p_payload->>'can_meet', ''))::boolean, g.can_meet),
      can_chat = COALESCE((NULLIF(p_payload->>'can_chat', ''))::boolean, g.can_chat),
      can_lead_retrieval =
        COALESCE((NULLIF(p_payload->>'can_lead_retrieval', ''))::boolean, g.can_lead_retrieval),
      can_see_recording =
        COALESCE((NULLIF(p_payload->>'can_see_recording', ''))::boolean, g.can_see_recording),
      min_tier_rank = COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, g.min_tier_rank),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, g.sort_order),
      is_default = COALESCE(v_is_default, g.is_default)
    WHERE g.id = v_id AND g.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_groups (
    tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    color, attendee_visibility, can_see_attendees, can_meet, can_chat,
    can_lead_retrieval, can_see_recording, min_tier_rank, sort_order,
    is_default, is_system
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    COALESCE(btrim(p_payload->>'description_pl'), ''),
    COALESCE(btrim(p_payload->>'description_en'), ''),
    NULLIF(btrim(COALESCE(p_payload->>'color', '')), ''),
    COALESCE(NULLIF(p_payload->>'attendee_visibility', ''), 'registered'),
    COALESCE((NULLIF(p_payload->>'can_see_attendees', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'can_meet', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'can_chat', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'can_lead_retrieval', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'can_see_recording', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE(v_is_default, false),
    false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_group_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_group_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_group_upsert(jsonb) IS
  'Dodanie albo edycja grupy uczestnikow. Ustawienie grupy domyslnej odbiera flage poprzedniej w jednej operacji.';

DROP FUNCTION IF EXISTS public.admin_event_group_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_group_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_is_system boolean;
  v_used integer;
BEGIN
  SELECT g.is_system INTO v_is_system
  FROM public.event_groups g
  WHERE g.id = _id AND g.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: group does not exist in this tenant';
  END IF;

  IF v_is_system THEN
    RAISE EXCEPTION 'group_system: system groups cannot be deleted';
  END IF;

  SELECT
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.group_id = _id)
    + (SELECT count(*) FROM public.event_ticket_types t
        WHERE t.tenant_id = v_tenant AND t.group_id = _id)
    + (SELECT count(*) FROM public.event_group_members m
        WHERE m.tenant_id = v_tenant AND m.group_id = _id)
  INTO v_used;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'group_in_use: % registration(s), ticket(s) or membership(s) use this group', v_used;
  END IF;

  DELETE FROM public.event_groups g WHERE g.id = _id AND g.tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_group_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_group_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_group_delete(uuid) IS
  'Usuwa grupe uczestnikow. Odmawia dla grup systemowych i dla grup uzywanych przez zapisy, bilety albo czlonkostwa.';

DROP FUNCTION IF EXISTS public.admin_event_group_member_set(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_group_member_set(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_member boolean := COALESCE((NULLIF(p_payload->>'is_member', ''))::boolean, true);
  v_event_id uuid;
BEGIN
  IF v_group_id IS NULL OR v_person_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: group_id and person_id are required';
  END IF;

  SELECT g.event_id INTO v_event_id
  FROM public.event_groups g
  WHERE g.id = v_group_id AND g.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: group does not exist in this tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_people p
    WHERE p.id = v_person_id AND p.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: person does not exist in this tenant';
  END IF;

  IF v_member THEN
    INSERT INTO public.event_group_members (
      tenant_id, event_id, group_id, person_id, added_by
    ) VALUES (
      v_tenant, v_event_id, v_group_id, v_person_id, v_uid
    )
    ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
  ELSE
    DELETE FROM public.event_group_members m
    WHERE m.tenant_id = v_tenant
      AND m.group_id = v_group_id
      AND m.person_id = v_person_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_group_member_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_group_member_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_group_member_set(jsonb) IS
  'Dodaje albo odejmuje osobe w grupie DODATKOWEJ wydarzenia (is_member decyduje o kierunku). Idempotentna w obie strony.';

DROP FUNCTION IF EXISTS public.admin_event_terms_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_terms_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  label_pl text,
  label_en text,
  body_pl text,
  body_en text,
  external_url text,
  display text,
  is_required boolean,
  version integer,
  sort_order integer,
  is_active boolean,
  acceptances_current integer,
  acceptances_total integer,
  withdrawn_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    tr.id, tr.event_id, tr.key, tr.label_pl, tr.label_en,
    tr.body_pl, tr.body_en, tr.external_url, tr.display,
    tr.is_required, tr.version, tr.sort_order, tr.is_active,
    COALESCE(a.current_version, 0)::integer,
    COALESCE(a.total, 0)::integer,
    COALESCE(a.withdrawn, 0)::integer,
    tr.created_at, tr.updated_at
  FROM public.event_terms tr
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE ac.version = tr.version AND ac.withdrawn_at IS NULL)::integer
        AS current_version,
      count(*) FILTER (WHERE ac.withdrawn_at IS NULL)::integer AS total,
      count(*) FILTER (WHERE ac.withdrawn_at IS NOT NULL)::integer AS withdrawn
    FROM public.event_term_acceptances ac
    WHERE ac.tenant_id = tr.tenant_id AND ac.term_id = tr.id
  ) a ON true
  WHERE tr.tenant_id = v_tenant AND tr.event_id = p_event_id
  ORDER BY tr.sort_order, tr.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_terms_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_terms_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_terms_list(uuid) IS
  'Zgody wydarzenia z licznikami akceptacji: w AKTUALNEJ wersji, w dowolnej, i wycofanych. Roznica dwoch pierwszych mierzy skutek podniesienia wersji.';

DROP FUNCTION IF EXISTS public.admin_event_term_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_term_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_label_pl text := btrim(COALESCE(p_payload->>'label_pl', ''));
  v_label_en text := btrim(COALESCE(p_payload->>'label_en', ''));
  v_bump boolean := COALESCE((NULLIF(p_payload->>'bump_version', ''))::boolean, false);
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT tr.event_id INTO v_event_id
    FROM public.event_terms tr
    WHERE tr.id = v_id AND tr.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: term does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_label_pl = '' OR v_label_en = '' THEN
    RAISE EXCEPTION 'invalid_labels: the label is required in both languages';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_terms tr SET
      label_pl = v_label_pl,
      label_en = v_label_en,
      body_pl = COALESCE(p_payload->>'body_pl', tr.body_pl),
      body_en = COALESCE(p_payload->>'body_en', tr.body_en),
      external_url = CASE
        WHEN p_payload ? 'external_url'
          THEN NULLIF(btrim(COALESCE(p_payload->>'external_url', '')), '')
        ELSE tr.external_url
      END,
      display = COALESCE(NULLIF(p_payload->>'display', ''), tr.display),
      is_required = COALESCE((NULLIF(p_payload->>'is_required', ''))::boolean, tr.is_required),
      version = CASE WHEN v_bump THEN tr.version + 1 ELSE tr.version END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, tr.sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, tr.is_active)
    WHERE tr.id = v_id AND tr.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_terms (
    tenant_id, event_id, key, label_pl, label_en, body_pl, body_en,
    external_url, display, is_required, version, sort_order, is_active
  ) VALUES (
    v_tenant, v_event_id, v_key, v_label_pl, v_label_en,
    COALESCE(p_payload->>'body_pl', ''),
    COALESCE(p_payload->>'body_en', ''),
    NULLIF(btrim(COALESCE(p_payload->>'external_url', '')), ''),
    COALESCE(NULLIF(p_payload->>'display', ''), 'registration'),
    COALESCE((NULLIF(p_payload->>'is_required', ''))::boolean, false),
    1,
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_term_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_term_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_term_upsert(jsonb) IS
  'Dodanie albo edycja zgody wydarzenia. Wersja rosnie WYLACZNIE przy bump_version = true - podniesienie uniewaznia dotychczasowe akceptacje jako aktualne.';

DROP FUNCTION IF EXISTS public.admin_event_term_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_term_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_terms tr WHERE tr.id = _id AND tr.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: term does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_term_acceptances a
  WHERE a.tenant_id = v_tenant AND a.term_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'term_in_use: % acceptance(s) recorded - deactivate instead', v_used;
  END IF;

  DELETE FROM public.event_terms tr WHERE tr.id = _id AND tr.tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_term_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_term_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_term_delete(uuid) IS
  'Usuwa zgode wydarzenia. Odmawia, gdy istnieje choc jedna akceptacja - akceptacja jest dowodem, wiec poprawna operacja jest wylaczenie zgody.';