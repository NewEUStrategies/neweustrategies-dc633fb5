CREATE OR REPLACE FUNCTION public.admin_event_seat_map_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_seat_maps;
  v_event_id uuid;
  v_name text;
  v_status text;
  v_room uuid;
  v_session uuid;
  v_width integer;
  v_height integer;
  v_stage_x numeric;
  v_stage_y numeric;
  v_stage_w numeric;
  v_stage_h numeric;
  v_sort integer;
  v_change text := 'map';
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT m.* INTO v_row FROM public.event_seat_maps m
     WHERE m.tenant_id = v_tenant AND m.id = v_id
     FOR UPDATE;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
    END IF;
    v_event_id := v_row.event_id;
  ELSE
    v_event_id := NULLIF(p_payload->>'event_id', '')::uuid;
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'invalid_event: event_id is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;
  END IF;

  v_name := CASE WHEN p_payload ? 'name' THEN btrim(COALESCE(p_payload->>'name', '')) ELSE v_row.name END;
  IF v_name IS NULL OR char_length(v_name) < 1 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_name: seat map name must have 1-120 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_seat_maps m
     WHERE m.tenant_id = v_tenant AND m.event_id = v_event_id
       AND lower(btrim(m.name)) = lower(v_name)
       AND m.id IS DISTINCT FROM v_id
  ) THEN
    RAISE EXCEPTION 'name_taken: another seat map of this event has this name';
  END IF;

  v_status := CASE WHEN p_payload ? 'status' THEN COALESCE(p_payload->>'status', '') ELSE COALESCE(v_row.status, 'draft') END;
  IF v_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'invalid_status: %', v_status;
  END IF;

  v_width := CASE WHEN p_payload ? 'width' THEN NULLIF(p_payload->>'width', '')::integer ELSE COALESCE(v_row.width, 1200) END;
  v_height := CASE WHEN p_payload ? 'height' THEN NULLIF(p_payload->>'height', '')::integer ELSE COALESCE(v_row.height, 800) END;
  IF v_width IS NULL OR v_height IS NULL
     OR v_width NOT BETWEEN 200 AND 20000 OR v_height NOT BETWEEN 200 AND 20000 THEN
    RAISE EXCEPTION 'invalid_size: plan width and height must be between 200 and 20000';
  END IF;

  v_room := CASE WHEN p_payload ? 'room_id' THEN NULLIF(p_payload->>'room_id', '')::uuid ELSE v_row.room_id END;
  IF v_room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_rooms ro
     WHERE ro.tenant_id = v_tenant AND ro.event_id = v_event_id AND ro.id = v_room
  ) THEN
    RAISE EXCEPTION 'room_not_found: room does not belong to this event';
  END IF;

  v_session := CASE WHEN p_payload ? 'session_id' THEN NULLIF(p_payload->>'session_id', '')::uuid ELSE v_row.session_id END;
  IF v_session IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sessions se
     WHERE se.tenant_id = v_tenant AND se.event_id = v_event_id AND se.id = v_session
  ) THEN
    RAISE EXCEPTION 'session_not_found: session does not belong to this event';
  END IF;

  IF p_payload ? 'stage' THEN
    IF jsonb_typeof(p_payload->'stage') = 'object' THEN
      v_stage_x := NULLIF(p_payload->'stage'->>'x', '')::numeric;
      v_stage_y := NULLIF(p_payload->'stage'->>'y', '')::numeric;
      v_stage_w := NULLIF(p_payload->'stage'->>'w', '')::numeric;
      v_stage_h := NULLIF(p_payload->'stage'->>'h', '')::numeric;
      IF v_stage_x IS NULL OR v_stage_y IS NULL OR v_stage_w IS NULL OR v_stage_h IS NULL
         OR v_stage_w <= 0 OR v_stage_h <= 0
         OR v_stage_x < 0 OR v_stage_y < 0
         OR v_stage_x + v_stage_w > v_width OR v_stage_y + v_stage_h > v_height THEN
        RAISE EXCEPTION 'invalid_stage: stage must be a positive rectangle inside the plan';
      END IF;
    END IF;
  ELSE
    v_stage_x := v_row.stage_x;
    v_stage_y := v_row.stage_y;
    v_stage_w := v_row.stage_w;
    v_stage_h := v_row.stage_h;
  END IF;

  v_sort := CASE WHEN p_payload ? 'sort_order' THEN COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 100) ELSE COALESCE(v_row.sort_order, 100) END;

  IF v_id IS NULL THEN
    INSERT INTO public.event_seat_maps (
      tenant_id, event_id, room_id, session_id, name, status, width, height,
      stage_x, stage_y, stage_w, stage_h, sort_order, published_at, created_by
    ) VALUES (
      v_tenant, v_event_id, v_room, v_session, v_name, v_status, v_width, v_height,
      v_stage_x, v_stage_y, v_stage_w, v_stage_h, v_sort,
      CASE WHEN v_status = 'published' THEN now() END, auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    IF v_status IS DISTINCT FROM v_row.status THEN
      v_change := 'status';
    END IF;
    UPDATE public.event_seat_maps m SET
      name = v_name,
      status = v_status,
      room_id = v_room,
      session_id = v_session,
      width = v_width,
      height = v_height,
      stage_x = v_stage_x,
      stage_y = v_stage_y,
      stage_w = v_stage_w,
      stage_h = v_stage_h,
      sort_order = v_sort,
      published_at = CASE
        WHEN v_status = 'published' THEN COALESCE(m.published_at, now())
        ELSE NULL
      END
    WHERE m.tenant_id = v_tenant AND m.id = v_id;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_seat_map',
    v_id::text,
    'event_seat_map.changed.v1',
    jsonb_build_object('event_id', v_event_id, 'map_id', v_id, 'change', v_change),
    auth.uid()
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_map_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_map_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_map_save(jsonb) IS
  'Dodanie albo edycja planu sali (nazwa, sala, sesja, rozmiar, scena, publikacja). Brak klucza = bez zmian, null = wyczysc. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_map_delete(p_map_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_row public.event_seat_maps;
  v_used integer;
BEGIN
  SELECT m.* INTO v_row FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = p_map_id
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
    FROM public.event_seat_assignments a
   WHERE a.tenant_id = v_tenant AND a.map_id = p_map_id AND a.released_at IS NULL;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'map_has_assignments: % active seat assignment(s) on this plan', v_used;
  END IF;

  DELETE FROM public.event_seat_maps m WHERE m.tenant_id = v_tenant AND m.id = p_map_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_seat_map',
    p_map_id::text,
    'event_seat_map.changed.v1',
    jsonb_build_object('event_id', v_row.event_id, 'map_id', p_map_id, 'change', 'deleted'),
    auth.uid()
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_map_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_map_delete(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_map_delete(uuid) IS
  'Usuniecie planu sali razem z sekcjami, miejscami i historia przydzialow. Odrzuca plan z aktywnymi przydzialami (najpierw zwolnij). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_map_detail(p_map_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_map public.event_seat_maps;
BEGIN
  SELECT m.* INTO v_map FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = p_map_id;
  IF v_map.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;

  RETURN jsonb_build_object(
    'map', jsonb_build_object(
      'id', v_map.id, 'event_id', v_map.event_id, 'name', v_map.name,
      'room_id', v_map.room_id, 'session_id', v_map.session_id, 'status', v_map.status,
      'width', v_map.width, 'height', v_map.height,
      'stage', CASE WHEN v_map.stage_x IS NULL THEN NULL ELSE jsonb_build_object(
        'x', v_map.stage_x, 'y', v_map.stage_y, 'w', v_map.stage_w, 'h', v_map.stage_h) END,
      'sort_order', v_map.sort_order, 'published_at', v_map.published_at,
      'updated_at', v_map.updated_at
    ),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'key', c.key, 'name_pl', c.name_pl, 'name_en', c.name_en,
        'color', c.color, 'sort_order', c.sort_order,
        'ticket_type_ids', COALESCE((
          SELECT jsonb_agg(ct.ticket_type_id ORDER BY ct.ticket_type_id)
            FROM public.event_seat_category_tickets ct
           WHERE ct.tenant_id = v_tenant AND ct.category_id = c.id
        ), '[]'::jsonb)
      ) ORDER BY c.sort_order, c.key)
      FROM public.event_seat_categories c
      WHERE c.tenant_id = v_tenant AND c.event_id = v_map.event_id
    ), '[]'::jsonb),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sc.id, 'label', sc.label, 'kind', sc.kind, 'category_id', sc.category_id,
        'origin_x', sc.origin_x, 'origin_y', sc.origin_y, 'rotation_deg', sc.rotation_deg,
        'rows_count', sc.rows_count, 'seats_per_row', sc.seats_per_row,
        'row_label_scheme', sc.row_label_scheme, 'row_label_start', sc.row_label_start,
        'seat_numbering', sc.seat_numbering, 'seat_number_start', sc.seat_number_start,
        'seat_pitch', sc.seat_pitch, 'row_pitch', sc.row_pitch,
        'aisle_after', to_jsonb(sc.aisle_after),
        'table_shape', sc.table_shape, 'table_seats', sc.table_seats,
        'sort_order', sc.sort_order
      ) ORDER BY sc.sort_order, sc.label, sc.id)
      FROM public.event_seat_sections sc
      WHERE sc.tenant_id = v_tenant AND sc.map_id = v_map.id
    ), '[]'::jsonb),
    'seats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'section_id', s.section_id, 'row_label', s.row_label,
        'seat_number', s.seat_number, 'x', s.x, 'y', s.y, 'sort_key', s.sort_key,
        'category_id', s.category_id, 'status', s.status, 'block_reason', s.block_reason,
        'hold_company_id', s.hold_company_id, 'hold_company_name', co.name,
        'hold_sponsor_id', s.hold_sponsor_id, 'hold_sponsor_name', sp.snapshot_name,
        'hold_package_order_id', s.hold_package_order_id, 'hold_package_buyer', po.buyer_name,
        'hold_note', s.hold_note, 'is_accessible', s.is_accessible
      ) ORDER BY s.section_id, s.sort_key)
      FROM public.event_seats s
      LEFT JOIN public.crm_companies co ON co.tenant_id = s.tenant_id AND co.id = s.hold_company_id
      LEFT JOIN public.event_sponsors sp ON sp.tenant_id = s.tenant_id AND sp.id = s.hold_sponsor_id
      LEFT JOIN public.event_package_orders po ON po.tenant_id = s.tenant_id AND po.id = s.hold_package_order_id
      WHERE s.tenant_id = v_tenant AND s.map_id = v_map.id
    ), '[]'::jsonb),
    'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'seat_id', a.seat_id, 'registration_id', a.registration_id,
        'person_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
        'company_id', p.company_id,
        'company', COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
        'ticket_type_id', r.ticket_type_id, 'ticket_name_pl', t.name_pl, 'ticket_name_en', t.name_en,
        'registration_status', r.status, 'source', a.source, 'note', a.note,
        'assigned_at', a.assigned_at
      ) ORDER BY p.last_name, p.first_name, a.id)
      FROM public.event_seat_assignments a
      JOIN public.event_registrations r ON r.tenant_id = a.tenant_id AND r.id = a.registration_id
      JOIN public.event_people p ON p.tenant_id = r.tenant_id AND p.id = r.person_id
      LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
      LEFT JOIN public.event_ticket_types t ON t.tenant_id = r.tenant_id AND t.id = r.ticket_type_id
      WHERE a.tenant_id = v_tenant AND a.map_id = v_map.id
        AND a.released_at IS NULL AND a.seat_id IS NOT NULL
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_map_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_map_detail(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_map_detail(uuid) IS
  'Komplet planu sali jednym zapytaniem: plan, kategorie wydarzenia (z biletami), sekcje, miejsca (z nazwami rezerwujacych) i aktywne przydzialy (osoba, firma w projekcji CRM, bilet). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_category_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_seat_categories;
  v_event_id uuid;
  v_key text;
  v_name_pl text;
  v_name_en text;
  v_color text;
  v_sort integer;
  v_tickets uuid[];
  v_known integer;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT c.* INTO v_row FROM public.event_seat_categories c
     WHERE c.tenant_id = v_tenant AND c.id = v_id
     FOR UPDATE;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: seat category does not exist in this tenant';
    END IF;
    v_event_id := v_row.event_id;
    v_key := v_row.key;
  ELSE
    v_event_id := NULLIF(p_payload->>'event_id', '')::uuid;
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'invalid_event: event_id is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;
    v_key := btrim(COALESCE(p_payload->>'key', ''));
    IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
      RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_seat_categories c
                WHERE c.tenant_id = v_tenant AND c.event_id = v_event_id AND c.key = v_key) THEN
      RAISE EXCEPTION 'key_taken: another seat category of this event has this key';
    END IF;
  END IF;

  v_name_pl := CASE WHEN p_payload ? 'name_pl' THEN btrim(COALESCE(p_payload->>'name_pl', '')) ELSE v_row.name_pl END;
  v_name_en := CASE WHEN p_payload ? 'name_en' THEN btrim(COALESCE(p_payload->>'name_en', '')) ELSE v_row.name_en END;
  IF v_name_pl IS NULL OR v_name_en IS NULL
     OR char_length(v_name_pl) NOT BETWEEN 1 AND 80 OR char_length(v_name_en) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid_names: both names must have 1-80 characters';
  END IF;

  v_color := CASE WHEN p_payload ? 'color' THEN btrim(COALESCE(p_payload->>'color', '')) ELSE v_row.color END;
  IF v_color IS NULL OR v_color !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'invalid_color: color must be #RRGGBB';
  END IF;

  v_sort := CASE WHEN p_payload ? 'sort_order' THEN COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 100) ELSE COALESCE(v_row.sort_order, 100) END;

  IF p_payload ? 'ticket_type_ids' THEN
    IF jsonb_typeof(p_payload->'ticket_type_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_payload: ticket_type_ids must be an array';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT (v.value)::uuid), '{}'::uuid[]) INTO v_tickets
      FROM jsonb_array_elements_text(p_payload->'ticket_type_ids') AS v(value);
    SELECT count(*)::integer INTO v_known
      FROM public.event_ticket_types t
     WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.id = ANY(v_tickets);
    IF v_known <> cardinality(v_tickets) THEN
      RAISE EXCEPTION 'ticket_not_found: % ticket type(s) do not belong to this event',
        cardinality(v_tickets) - v_known;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_seat_categories (tenant_id, event_id, key, name_pl, name_en, color, sort_order)
    VALUES (v_tenant, v_event_id, v_key, v_name_pl, v_name_en, v_color, v_sort)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_seat_categories c SET
      name_pl = v_name_pl, name_en = v_name_en, color = v_color, sort_order = v_sort
    WHERE c.tenant_id = v_tenant AND c.id = v_id;
  END IF;

  IF v_tickets IS NOT NULL THEN
    DELETE FROM public.event_seat_category_tickets ct
     WHERE ct.tenant_id = v_tenant AND ct.category_id = v_id
       AND NOT (ct.ticket_type_id = ANY(v_tickets));
    INSERT INTO public.event_seat_category_tickets (tenant_id, event_id, category_id, ticket_type_id)
    SELECT v_tenant, v_event_id, v_id, t.id
      FROM unnest(v_tickets) AS t(id)
    ON CONFLICT (tenant_id, category_id, ticket_type_id) DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_category_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_category_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_category_save(jsonb) IS
  'Dodanie albo edycja kategorii miejsc na sali (klucz niezmienny, nazwy PL/EN, kolor) oraz - kluczem ticket_type_ids - pelnego zbioru dozwolonych typow biletow. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_category_delete(p_category_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_seat_categories c
     WHERE c.tenant_id = v_tenant AND c.id = p_category_id
  ) THEN
    RAISE EXCEPTION 'not_found: seat category does not exist in this tenant';
  END IF;

  SELECT (SELECT count(*) FROM public.event_seat_sections sc
           WHERE sc.tenant_id = v_tenant AND sc.category_id = p_category_id)
       + (SELECT count(*) FROM public.event_seats s
           WHERE s.tenant_id = v_tenant AND s.category_id = p_category_id)
    INTO v_used;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'category_in_use: % section(s) or seat(s) use this category', v_used;
  END IF;

  DELETE FROM public.event_seat_categories c WHERE c.tenant_id = v_tenant AND c.id = p_category_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_category_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_category_delete(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_category_delete(uuid) IS
  'Usuniecie kategorii miejsc. Odrzuca kategorie uzywana przez sekcje albo miejsca (najpierw przepnij). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_section_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_seat_sections;
  v_map public.event_seat_maps;
  v_map_id uuid;
  v_label text;
  v_kind text;
  v_category uuid;
  v_origin_x numeric;
  v_origin_y numeric;
  v_rotation numeric;
  v_rows integer;
  v_per_row integer;
  v_row_scheme text;
  v_row_start integer;
  v_numbering text;
  v_number_start integer;
  v_seat_pitch numeric;
  v_row_pitch numeric;
  v_aisles integer[];
  v_table_shape text;
  v_table_seats integer;
  v_sort integer;
  v_seat_count integer;
  v_other_seats integer;
  v_in_use integer;
  v_created integer := 0;
  v_removed integer := 0;
  v_kept integer := 0;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT sc.* INTO v_row FROM public.event_seat_sections sc
     WHERE sc.tenant_id = v_tenant AND sc.id = v_id;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: seat section does not exist in this tenant';
    END IF;
    v_map_id := v_row.map_id;
  ELSE
    v_map_id := NULLIF(p_payload->>'map_id', '')::uuid;
  END IF;

  SELECT m.* INTO v_map FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = v_map_id
   FOR UPDATE;
  IF v_map.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;

  v_label := CASE WHEN p_payload ? 'label' THEN btrim(COALESCE(p_payload->>'label', '')) ELSE v_row.label END;
  IF v_label IS NULL OR char_length(v_label) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'invalid_label: section label must have 1-60 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_seat_sections sc
     WHERE sc.tenant_id = v_tenant AND sc.map_id = v_map_id
       AND lower(btrim(sc.label)) = lower(v_label)
       AND sc.id IS DISTINCT FROM v_id
  ) THEN
    RAISE EXCEPTION 'label_taken: another section of this plan has this label';
  END IF;

  v_kind := CASE WHEN p_payload ? 'kind' THEN COALESCE(p_payload->>'kind', '') ELSE v_row.kind END;
  v_category := CASE WHEN p_payload ? 'category_id' THEN NULLIF(p_payload->>'category_id', '')::uuid ELSE v_row.category_id END;
  IF v_category IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_seat_categories c
     WHERE c.tenant_id = v_tenant AND c.event_id = v_map.event_id AND c.id = v_category
  ) THEN
    RAISE EXCEPTION 'category_not_found: seat category does not belong to this event';
  END IF;

  v_origin_x := CASE WHEN p_payload ? 'origin_x' THEN COALESCE(NULLIF(p_payload->>'origin_x', '')::numeric, 0) ELSE COALESCE(v_row.origin_x, 0) END;
  v_origin_y := CASE WHEN p_payload ? 'origin_y' THEN COALESCE(NULLIF(p_payload->>'origin_y', '')::numeric, 0) ELSE COALESCE(v_row.origin_y, 0) END;
  v_rotation := CASE WHEN p_payload ? 'rotation_deg' THEN COALESCE(NULLIF(p_payload->>'rotation_deg', '')::numeric, 0) ELSE COALESCE(v_row.rotation_deg, 0) END;
  v_seat_pitch := CASE WHEN p_payload ? 'seat_pitch' THEN COALESCE(NULLIF(p_payload->>'seat_pitch', '')::numeric, 50) ELSE COALESCE(v_row.seat_pitch, 50) END;
  v_row_pitch := CASE WHEN p_payload ? 'row_pitch' THEN COALESCE(NULLIF(p_payload->>'row_pitch', '')::numeric, 60) ELSE COALESCE(v_row.row_pitch, 60) END;
  v_row_start := CASE WHEN p_payload ? 'row_label_start' THEN COALESCE(NULLIF(p_payload->>'row_label_start', '')::integer, 1) ELSE COALESCE(v_row.row_label_start, 1) END;
  v_number_start := CASE WHEN p_payload ? 'seat_number_start' THEN COALESCE(NULLIF(p_payload->>'seat_number_start', '')::integer, 1) ELSE COALESCE(v_row.seat_number_start, 1) END;
  v_sort := CASE WHEN p_payload ? 'sort_order' THEN COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 100) ELSE COALESCE(v_row.sort_order, 100) END;

  IF v_kind = 'rows' THEN
    v_rows := CASE WHEN p_payload ? 'rows_count' THEN NULLIF(p_payload->>'rows_count', '')::integer ELSE v_row.rows_count END;
    v_per_row := CASE WHEN p_payload ? 'seats_per_row' THEN NULLIF(p_payload->>'seats_per_row', '')::integer ELSE v_row.seats_per_row END;
    v_row_scheme := CASE WHEN p_payload ? 'row_label_scheme' THEN NULLIF(p_payload->>'row_label_scheme', '') ELSE COALESCE(v_row.row_label_scheme, 'alpha') END;
    v_numbering := CASE WHEN p_payload ? 'seat_numbering' THEN NULLIF(p_payload->>'seat_numbering', '') ELSE COALESCE(v_row.seat_numbering, 'ltr') END;
    IF p_payload ? 'aisle_after' THEN
      IF jsonb_typeof(p_payload->'aisle_after') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'invalid_shape: aisle_after must be an array';
      END IF;
      SELECT COALESCE(array_agg(DISTINCT (v.value)::integer ORDER BY (v.value)::integer), '{}'::integer[])
        INTO v_aisles
        FROM jsonb_array_elements_text(p_payload->'aisle_after') AS v(value);
    ELSE
      v_aisles := COALESCE(v_row.aisle_after, '{}'::integer[]);
    END IF;
    IF v_rows IS NULL OR v_per_row IS NULL
       OR v_rows NOT BETWEEN 1 AND 200 OR v_per_row NOT BETWEEN 1 AND 200
       OR v_rows * v_per_row > 2000
       OR v_row_scheme IS NULL OR v_row_scheme NOT IN ('alpha', 'numeric')
       OR v_numbering IS NULL OR v_numbering NOT IN ('ltr', 'rtl', 'odd_even')
       OR cardinality(v_aisles) > 20
       OR EXISTS (SELECT 1 FROM unnest(v_aisles) AS a(v) WHERE a.v < 1 OR a.v >= v_per_row) THEN
      RAISE EXCEPTION 'invalid_shape: rows section needs 1-200 rows, 1-200 seats per row (max 2000 seats), a row scheme, a numbering and aisles inside the row';
    END IF;
    v_table_shape := NULL;
    v_table_seats := NULL;
    v_seat_count := v_rows * v_per_row;
  ELSIF v_kind = 'table' THEN
    v_table_shape := CASE WHEN p_payload ? 'table_shape' THEN NULLIF(p_payload->>'table_shape', '') ELSE COALESCE(v_row.table_shape, 'round') END;
    v_table_seats := CASE WHEN p_payload ? 'table_seats' THEN NULLIF(p_payload->>'table_seats', '')::integer ELSE v_row.table_seats END;
    IF v_table_seats IS NULL OR v_table_seats NOT BETWEEN 1 AND 24
       OR v_table_shape IS NULL OR v_table_shape NOT IN ('round', 'rect') THEN
      RAISE EXCEPTION 'invalid_shape: table section needs 1-24 seats and a table shape';
    END IF;
    v_rows := NULL;
    v_per_row := NULL;
    v_row_scheme := NULL;
    v_numbering := NULL;
    v_aisles := '{}'::integer[];
    v_seat_count := v_table_seats;
  ELSE
    RAISE EXCEPTION 'invalid_shape: kind must be rows or table';
  END IF;

  IF v_seat_pitch NOT BETWEEN 10 AND 500 OR v_row_pitch NOT BETWEEN 10 AND 500
     OR v_row_start NOT BETWEEN 1 AND 1000 OR v_number_start NOT BETWEEN 1 AND 10000
     OR v_origin_x NOT BETWEEN -20000 AND 40000 OR v_origin_y NOT BETWEEN -20000 AND 40000
     OR v_rotation NOT BETWEEN -360 AND 360 THEN
    RAISE EXCEPTION 'invalid_shape: pitch 10-500, start numbers and position out of range';
  END IF;

  SELECT count(*)::integer INTO v_other_seats
    FROM public.event_seats s
   WHERE s.tenant_id = v_tenant AND s.map_id = v_map_id AND s.section_id IS DISTINCT FROM v_id;
  IF v_other_seats + v_seat_count > 5000 THEN
    RAISE EXCEPTION 'map_too_large: plan would have % seats, limit is 5000', v_other_seats + v_seat_count;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_seat_sections (
      tenant_id, event_id, map_id, label, kind, category_id, origin_x, origin_y, rotation_deg,
      rows_count, seats_per_row, row_label_scheme, row_label_start, seat_numbering,
      seat_number_start, seat_pitch, row_pitch, aisle_after, table_shape, table_seats, sort_order
    ) VALUES (
      v_tenant, v_map.event_id, v_map_id, v_label, v_kind, v_category, v_origin_x, v_origin_y, v_rotation,
      v_rows, v_per_row, v_row_scheme, v_row_start, v_numbering,
      v_number_start, v_seat_pitch, v_row_pitch, v_aisles, v_table_shape, v_table_seats, v_sort
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT count(*)::integer INTO v_in_use
      FROM public.event_seats s
      JOIN public.event_seat_assignments a
        ON a.tenant_id = s.tenant_id AND a.seat_id = s.id AND a.released_at IS NULL
     WHERE s.tenant_id = v_tenant AND s.section_id = v_id
       AND NOT EXISTS (
         SELECT 1 FROM public._event_seat_section_layout(
           v_kind, v_rows, v_per_row, v_row_scheme, v_row_start, v_numbering, v_number_start,
           v_seat_pitch, v_row_pitch, v_aisles, v_table_shape, v_table_seats) AS d
          WHERE COALESCE(d.row_label, '') = COALESCE(s.row_label, '') AND d.seat_number = s.seat_number
       );
    IF v_in_use > 0 THEN
      RAISE EXCEPTION 'seats_in_use: % assigned seat(s) would be removed', v_in_use;
    END IF;

    UPDATE public.event_seat_sections sc SET
      label = v_label, kind = v_kind, category_id = v_category,
      origin_x = v_origin_x, origin_y = v_origin_y, rotation_deg = v_rotation,
      rows_count = v_rows, seats_per_row = v_per_row, row_label_scheme = v_row_scheme,
      row_label_start = v_row_start, seat_numbering = v_numbering,
      seat_number_start = v_number_start, seat_pitch = v_seat_pitch, row_pitch = v_row_pitch,
      aisle_after = v_aisles, table_shape = v_table_shape, table_seats = v_table_seats,
      sort_order = v_sort
    WHERE sc.tenant_id = v_tenant AND sc.id = v_id;

    DELETE FROM public.event_seats s
     WHERE s.tenant_id = v_tenant AND s.section_id = v_id
       AND NOT EXISTS (
         SELECT 1 FROM public._event_seat_section_layout(
           v_kind, v_rows, v_per_row, v_row_scheme, v_row_start, v_numbering, v_number_start,
           v_seat_pitch, v_row_pitch, v_aisles, v_table_shape, v_table_seats) AS d
          WHERE COALESCE(d.row_label, '') = COALESCE(s.row_label, '') AND d.seat_number = s.seat_number
       );
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    UPDATE public.event_seats s SET x = d.x, y = d.y, sort_key = d.sort_key
      FROM public._event_seat_section_layout(
        v_kind, v_rows, v_per_row, v_row_scheme, v_row_start, v_numbering, v_number_start,
        v_seat_pitch, v_row_pitch, v_aisles, v_table_shape, v_table_seats) AS d
     WHERE s.tenant_id = v_tenant AND s.section_id = v_id
       AND COALESCE(d.row_label, '') = COALESCE(s.row_label, '') AND d.seat_number = s.seat_number;
    GET DIAGNOSTICS v_kept = ROW_COUNT;
  END IF;

  INSERT INTO public.event_seats (
    tenant_id, event_id, map_id, section_id, row_label, seat_number, x, y, sort_key
  )
  SELECT v_tenant, v_map.event_id, v_map_id, v_id, d.row_label, d.seat_number, d.x, d.y, d.sort_key
    FROM public._event_seat_section_layout(
      v_kind, v_rows, v_per_row, v_row_scheme, v_row_start, v_numbering, v_number_start,
      v_seat_pitch, v_row_pitch, v_aisles, v_table_shape, v_table_seats) AS d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.event_seats s
      WHERE s.tenant_id = v_tenant AND s.section_id = v_id
        AND COALESCE(s.row_label, '') = COALESCE(d.row_label, '') AND s.seat_number = d.seat_number
   );
  GET DIAGNOSTICS v_created = ROW_COUNT;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_seat_map',
    v_map_id::text,
    'event_seat_map.changed.v1',
    jsonb_build_object('event_id', v_map.event_id, 'map_id', v_map_id, 'change', 'section'),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'section_id', v_id,
    'seats_created', v_created,
    'seats_removed', v_removed,
    'seats_kept', v_kept
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_section_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_section_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_section_save(jsonb) IS
  'Dodanie albo edycja sekcji planu sali i regeneracja jej miejsc po kluczu naturalnym (rzad, numer): zostajace miejsca zachowuja status, rezerwacje i przydzial. Odrzuca usuniecie zajetych miejsc (seats_in_use) i plan ponad 5000 miejsc. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_section_delete(p_section_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_row public.event_seat_sections;
  v_used integer;
BEGIN
  SELECT sc.* INTO v_row FROM public.event_seat_sections sc
   WHERE sc.tenant_id = v_tenant AND sc.id = p_section_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat section does not exist in this tenant';
  END IF;
  PERFORM 1 FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = v_row.map_id
   FOR UPDATE;

  SELECT count(*)::integer INTO v_used
    FROM public.event_seat_assignments a
    JOIN public.event_seats s ON s.tenant_id = a.tenant_id AND s.id = a.seat_id
   WHERE a.tenant_id = v_tenant AND s.section_id = p_section_id AND a.released_at IS NULL;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'section_has_assignments: % attendee(s) are seated in this section', v_used;
  END IF;

  DELETE FROM public.event_seat_sections sc WHERE sc.tenant_id = v_tenant AND sc.id = p_section_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_seat_map',
    v_row.map_id::text,
    'event_seat_map.changed.v1',
    jsonb_build_object('event_id', v_row.event_id, 'map_id', v_row.map_id, 'change', 'section'),
    auth.uid()
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_section_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_section_delete(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_section_delete(uuid) IS
  'Usuniecie sekcji planu sali z jej miejscami. Odrzuca sekcje, na ktorej ktos siedzi. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seats_update(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_map_id uuid := NULLIF(p_payload->>'map_id', '')::uuid;
  v_map public.event_seat_maps;
  v_event public.events;
  v_ids uuid[];
  v_known integer;
  v_status text;
  v_release boolean := COALESCE(NULLIF(p_payload->>'release', '')::boolean, false);
  v_block_reason text;
  v_hold_company uuid;
  v_hold_sponsor uuid;
  v_hold_package uuid;
  v_hold_note text;
  v_category uuid;
  v_busy integer;
  v_released integer := 0;
  v_crm_company uuid;
BEGIN
  SELECT m.* INTO v_map FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = v_map_id
   FOR UPDATE;
  IF v_map.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;

  IF jsonb_typeof(p_payload->'seat_ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: seat_ids must be an array';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT (v.value)::uuid), '{}'::uuid[]) INTO v_ids
    FROM jsonb_array_elements_text(p_payload->'seat_ids') AS v(value);
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'invalid_payload: seat_ids must not be empty';
  END IF;
  IF cardinality(v_ids) > 2000 THEN
    RAISE EXCEPTION 'too_many_seats: % seats in one call, limit is 2000', cardinality(v_ids);
  END IF;
  SELECT count(*)::integer INTO v_known
    FROM public.event_seats s
   WHERE s.tenant_id = v_tenant AND s.map_id = v_map_id AND s.id = ANY(v_ids);
  IF v_known <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'seat_not_found: % seat(s) do not belong to this plan', cardinality(v_ids) - v_known;
  END IF;

  IF p_payload ? 'status' THEN
    v_status := COALESCE(p_payload->>'status', '');
    IF v_status NOT IN ('available', 'blocked', 'held') THEN
      RAISE EXCEPTION 'invalid_status: %', v_status;
    END IF;

    IF v_status = 'blocked' THEN
      v_block_reason := NULLIF(btrim(COALESCE(p_payload->>'block_reason', '')), '');
      IF v_block_reason IS NOT NULL AND char_length(v_block_reason) > 200 THEN
        RAISE EXCEPTION 'invalid_note: note must have at most 200 characters';
      END IF;
      SELECT count(*)::integer INTO v_busy
        FROM public.event_seat_assignments a
       WHERE a.tenant_id = v_tenant AND a.seat_id = ANY(v_ids) AND a.released_at IS NULL;
      IF v_busy > 0 AND NOT v_release THEN
        RAISE EXCEPTION 'seat_assigned: % seat(s) have an assigned attendee', v_busy;
      END IF;
      IF v_busy > 0 THEN
        UPDATE public.event_seat_assignments a
           SET released_at = now(), released_by = auth.uid(), release_reason = 'seat_blocked'
         WHERE a.tenant_id = v_tenant AND a.seat_id = ANY(v_ids) AND a.released_at IS NULL;
        GET DIAGNOSTICS v_released = ROW_COUNT;
      END IF;
    ELSIF v_status = 'held' THEN
      v_hold_company := NULLIF(p_payload->>'hold_company_id', '')::uuid;
      v_hold_sponsor := NULLIF(p_payload->>'hold_sponsor_id', '')::uuid;
      v_hold_package := NULLIF(p_payload->>'hold_package_order_id', '')::uuid;
      v_hold_note := NULLIF(btrim(COALESCE(p_payload->>'hold_note', '')), '');
      IF v_hold_note IS NOT NULL AND char_length(v_hold_note) > 200 THEN
        RAISE EXCEPTION 'invalid_note: note must have at most 200 characters';
      END IF;
      IF v_hold_company IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.crm_companies co WHERE co.tenant_id = v_tenant AND co.id = v_hold_company
      ) THEN
        RAISE EXCEPTION 'company_not_found: company does not exist in this tenant';
      END IF;
      IF v_hold_sponsor IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.event_sponsors sp
         WHERE sp.tenant_id = v_tenant AND sp.event_id = v_map.event_id AND sp.id = v_hold_sponsor
      ) THEN
        RAISE EXCEPTION 'sponsor_not_found: sponsor does not belong to this event';
      END IF;
      IF v_hold_package IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.event_package_orders po
         WHERE po.tenant_id = v_tenant AND po.event_id = v_map.event_id AND po.id = v_hold_package
      ) THEN
        RAISE EXCEPTION 'package_not_found: package order does not belong to this event';
      END IF;
    END IF;

    UPDATE public.event_seats s SET
      status = v_status,
      block_reason = v_block_reason,
      hold_company_id = v_hold_company,
      hold_sponsor_id = v_hold_sponsor,
      hold_package_order_id = v_hold_package,
      hold_note = v_hold_note
    WHERE s.tenant_id = v_tenant AND s.map_id = v_map_id AND s.id = ANY(v_ids);
  END IF;

  IF p_payload ? 'is_accessible' THEN
    UPDATE public.event_seats s
       SET is_accessible = COALESCE(NULLIF(p_payload->>'is_accessible', '')::boolean, false)
     WHERE s.tenant_id = v_tenant AND s.map_id = v_map_id AND s.id = ANY(v_ids);
  END IF;

  IF p_payload ? 'category_id' THEN
    v_category := NULLIF(p_payload->>'category_id', '')::uuid;
    IF v_category IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_seat_categories c
       WHERE c.tenant_id = v_tenant AND c.event_id = v_map.event_id AND c.id = v_category
    ) THEN
      RAISE EXCEPTION 'category_not_found: seat category does not belong to this event';
    END IF;
    UPDATE public.event_seats s SET category_id = v_category
     WHERE s.tenant_id = v_tenant AND s.map_id = v_map_id AND s.id = ANY(v_ids);
  END IF;

  IF v_released > 0 THEN
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_seat',
      v_map_id::text,
      'event_seat.released.v1',
      jsonb_build_object('event_id', v_map.event_id, 'map_id', v_map_id, 'count', v_released,
                         'reason', 'seat_blocked'),
      auth.uid()
    );
  END IF;

  IF v_status = 'held' THEN
    v_crm_company := COALESCE(
      v_hold_company,
      (SELECT sp.company_id FROM public.event_sponsors sp
        WHERE sp.tenant_id = v_tenant AND sp.id = v_hold_sponsor),
      (SELECT po.company_id FROM public.event_package_orders po
        WHERE po.tenant_id = v_tenant AND po.id = v_hold_package)
    );
    IF v_crm_company IS NOT NULL THEN
      SELECT e.* INTO v_event FROM public.events e
       WHERE e.tenant_id = v_tenant AND e.id = v_map.event_id;
      INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_tenant,
        auth.uid(),
        'event.seating.hold_set',
        'crm_company',
        v_crm_company,
        jsonb_build_object(
          'event_id', v_event.id,
          'event_slug', v_event.slug,
          'event_title_pl', v_event.title_pl,
          'event_title_en', v_event.title_en,
          'summary_pl', format('Zarezerwowano miejsca na sali: %s (plan "%s")', cardinality(v_ids), v_map.name),
          'summary_en', format('Seats held on the seating plan: %s (plan "%s")', cardinality(v_ids), v_map.name),
          'map_id', v_map_id,
          'seats_count', cardinality(v_ids)
        )
      );
    END IF;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_seat_map',
    v_map_id::text,
    'event_seat_map.changed.v1',
    jsonb_build_object('event_id', v_map.event_id, 'map_id', v_map_id, 'change', 'seats',
                       'count', cardinality(v_ids)),
    auth.uid()
  );
  RETURN cardinality(v_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seats_update(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seats_update(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seats_update(jsonb) IS
  'Zbiorcza zmiana miejsc planu sali (<= 2000): status available|blocked|held z rezerwacja dla firmy CRM / sponsora / zamowienia pakietowego, dostepnosc dla wozka, nadpisanie kategorii. Blokada zajetego miejsca wymaga release=true. Rezerwacja dla firmy pisze wpis osi czasu CRM firmy. Bramka: assert_event_admin_tenant().';