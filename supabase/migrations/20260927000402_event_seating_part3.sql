-- CZESC 3/3 MIGRACJI 20260927000400_event_seating.sql
-- migration-split: part 3/3 of 20260927000400_event_seating.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 20260927000400_event_seating.sql,
-- potem 20260927000401_event_seating_part2.sql .. 20260927000402_event_seating_part3.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.
-- events-harness: include

-- ----------------------------------------------------------------------------
-- 15. PANEL: PRZYDZIAL, PRZYDZIAL ZBIORCZY, ZWOLNIENIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_seat_assign(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_map_id uuid := NULLIF(p_payload->>'map_id', '')::uuid;
  v_seat_id uuid := NULLIF(p_payload->>'seat_id', '')::uuid;
  v_reg_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_swap boolean := COALESCE(NULLIF(p_payload->>'swap', '')::boolean, false);
  v_force boolean := COALESCE(NULLIF(p_payload->>'force', '')::boolean, false);
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_map public.event_seat_maps;
  v_problem text;
  v_occ public.event_seat_assignments;
  v_cur public.event_seat_assignments;
  v_new uuid;
  v_count integer := 1;
BEGIN
  IF v_map_id IS NULL OR v_seat_id IS NULL OR v_reg_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: map_id, seat_id and registration_id are required';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note: note must have at most 500 characters';
  END IF;

  SELECT m.* INTO v_map FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = v_map_id
   FOR UPDATE;
  IF v_map.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;

  v_problem := public._event_seat_assign_problem(v_tenant, v_map_id, v_seat_id, v_reg_id, v_force);
  IF v_problem = 'seat_not_found' THEN
    RAISE EXCEPTION 'seat_not_found: seat does not belong to this plan';
  ELSIF v_problem = 'seat_blocked' THEN
    RAISE EXCEPTION 'seat_blocked: this seat is blocked';
  ELSIF v_problem = 'registration_not_found' THEN
    RAISE EXCEPTION 'registration_not_found: registration does not belong to this event';
  ELSIF v_problem = 'registration_not_seatable' THEN
    RAISE EXCEPTION 'registration_not_seatable: only approved, attended or no-show registrations can be seated';
  ELSIF v_problem = 'seat_held_for_other' THEN
    RAISE EXCEPTION 'seat_held_for_other: this seat is held for another company, sponsor or package';
  ELSIF v_problem = 'category_ticket_mismatch' THEN
    RAISE EXCEPTION 'category_ticket_mismatch: the ticket type is not allowed in this seat category';
  END IF;

  SELECT a.* INTO v_occ FROM public.event_seat_assignments a
   WHERE a.tenant_id = v_tenant AND a.seat_id = v_seat_id AND a.released_at IS NULL;
  SELECT a.* INTO v_cur FROM public.event_seat_assignments a
   WHERE a.tenant_id = v_tenant AND a.map_id = v_map_id AND a.registration_id = v_reg_id
     AND a.released_at IS NULL;

  IF v_occ.id IS NOT NULL AND v_occ.registration_id = v_reg_id THEN
    RETURN jsonb_build_object('assignment_id', v_occ.id, 'moved_from_seat_id', NULL,
                              'swapped_registration_id', NULL);
  END IF;

  IF v_occ.id IS NOT NULL THEN
    IF NOT v_swap OR v_cur.id IS NULL OR v_cur.seat_id IS NULL THEN
      RAISE EXCEPTION 'seat_taken: this seat already has an attendee';
    END IF;
    -- Zamiana: dotychczasowy posiadacz musi moc usiasc na miejscu, ktore zwalniamy.
    IF public._event_seat_assign_problem(v_tenant, v_map_id, v_cur.seat_id, v_occ.registration_id, v_force) IS NOT NULL THEN
      RAISE EXCEPTION 'swap_not_allowed: the current attendee cannot take the other seat';
    END IF;
  END IF;

  IF v_cur.id IS NOT NULL THEN
    UPDATE public.event_seat_assignments a
       SET released_at = now(), released_by = auth.uid(), release_reason = 'moved'
     WHERE a.tenant_id = v_tenant AND a.id = v_cur.id;
  END IF;
  IF v_occ.id IS NOT NULL THEN
    UPDATE public.event_seat_assignments a
       SET released_at = now(), released_by = auth.uid(), release_reason = 'moved'
     WHERE a.tenant_id = v_tenant AND a.id = v_occ.id;
  END IF;

  INSERT INTO public.event_seat_assignments (
    tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot, source, note, assigned_by
  )
  SELECT v_tenant, v_map.event_id, v_map_id, s.id, v_reg_id,
         public._event_seat_label(sc.label, sc.kind, s.row_label, s.seat_number),
         'manual', COALESCE(v_note, v_cur.note), auth.uid()
    FROM public.event_seats s
    JOIN public.event_seat_sections sc ON sc.tenant_id = s.tenant_id AND sc.id = s.section_id
   WHERE s.tenant_id = v_tenant AND s.id = v_seat_id
  RETURNING id INTO v_new;

  IF v_occ.id IS NOT NULL THEN
    INSERT INTO public.event_seat_assignments (
      tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot, source, note, assigned_by
    )
    SELECT v_tenant, v_map.event_id, v_map_id, s.id, v_occ.registration_id,
           public._event_seat_label(sc.label, sc.kind, s.row_label, s.seat_number),
           'manual', v_occ.note, auth.uid()
      FROM public.event_seats s
      JOIN public.event_seat_sections sc ON sc.tenant_id = s.tenant_id AND sc.id = s.section_id
     WHERE s.tenant_id = v_tenant AND s.id = v_cur.seat_id;
    v_count := 2;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_seat',
    v_map_id::text,
    'event_seat.assigned.v1',
    jsonb_build_object('event_id', v_map.event_id, 'map_id', v_map_id, 'count', v_count,
                       'source', 'manual'),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'assignment_id', v_new,
    'moved_from_seat_id', v_cur.seat_id,
    'swapped_registration_id', v_occ.registration_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_assign(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_assign(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_assign(jsonb) IS
  'Reczny przydzial miejsca na sali pod blokada planu: przeniesienie (zgloszenie mialo inne miejsce), zamiana (swap=true, oba zgloszenia siedza), force=true omija rezerwacje dla innej firmy i regule kategorii vs bilet (blokady nie). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_assign_batch(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_map_id uuid := NULLIF(p_payload->>'map_id', '')::uuid;
  v_source text := COALESCE(NULLIF(p_payload->>'source', ''), 'manual');
  v_map public.event_seat_maps;
  v_item jsonb;
  v_seat_id uuid;
  v_reg_id uuid;
  v_problem text;
  v_applied integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF v_source NOT IN ('manual', 'auto', 'import') THEN
    RAISE EXCEPTION 'invalid_payload: source must be manual, auto or import';
  END IF;
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'invalid_payload: items must be a non-empty array';
  END IF;
  IF jsonb_array_length(p_payload->'items') > 500 THEN
    RAISE EXCEPTION 'too_many_items: % items in one call, limit is 500', jsonb_array_length(p_payload->'items');
  END IF;

  SELECT m.* INTO v_map FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = v_map_id
   FOR UPDATE;
  IF v_map.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_payload->'items') AS e(value) LOOP
    v_seat_id := CASE WHEN COALESCE(v_item->>'seat_id', '') ~ v_uuid THEN (v_item->>'seat_id')::uuid END;
    v_reg_id := CASE WHEN COALESCE(v_item->>'registration_id', '') ~ v_uuid THEN (v_item->>'registration_id')::uuid END;
    IF v_seat_id IS NULL OR v_reg_id IS NULL THEN
      v_problem := 'invalid_payload';
    ELSE
      v_problem := public._event_seat_assign_problem(v_tenant, v_map_id, v_seat_id, v_reg_id, false);
    END IF;
    IF v_problem IS NULL AND EXISTS (
      SELECT 1 FROM public.event_seat_assignments a
       WHERE a.tenant_id = v_tenant AND a.seat_id = v_seat_id AND a.released_at IS NULL
    ) THEN
      v_problem := 'seat_taken';
    END IF;
    IF v_problem IS NULL AND EXISTS (
      SELECT 1 FROM public.event_seat_assignments a
       WHERE a.tenant_id = v_tenant AND a.map_id = v_map_id AND a.registration_id = v_reg_id
         AND a.released_at IS NULL
    ) THEN
      v_problem := 'already_seated';
    END IF;

    IF v_problem IS NOT NULL THEN
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'seat_id', v_item->>'seat_id', 'registration_id', v_item->>'registration_id', 'code', v_problem));
      CONTINUE;
    END IF;

    INSERT INTO public.event_seat_assignments (
      tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot, source, assigned_by
    )
    SELECT v_tenant, v_map.event_id, v_map_id, s.id, v_reg_id,
           public._event_seat_label(sc.label, sc.kind, s.row_label, s.seat_number),
           v_source, auth.uid()
      FROM public.event_seats s
      JOIN public.event_seat_sections sc ON sc.tenant_id = s.tenant_id AND sc.id = s.section_id
     WHERE s.tenant_id = v_tenant AND s.id = v_seat_id;
    v_applied := v_applied + 1;
  END LOOP;

  IF v_applied > 0 THEN
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_seat',
      v_map_id::text,
      'event_seat.assigned.v1',
      jsonb_build_object('event_id', v_map.event_id, 'map_id', v_map_id, 'count', v_applied,
                         'source', v_source),
      auth.uid()
    );
  END IF;

  RETURN jsonb_build_object('applied', v_applied, 'rejected', v_rejected);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_assign_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_assign_batch(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_assign_batch(jsonb) IS
  'Przydzial zbiorczy (<= 500, np. zatwierdzona propozycja auto-przydzialu) pod JEDNA blokada planu i z jednym zdarzeniem domenowym. Pozycja niezgodna z regulami trafia do rejected z kodem - reszta przechodzi. Bez force i bez zamian. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_release(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_map_id uuid := NULLIF(p_payload->>'map_id', '')::uuid;
  v_all boolean := COALESCE(NULLIF(p_payload->>'all', '')::boolean, false);
  v_map public.event_seat_maps;
  v_seats uuid[] := '{}'::uuid[];
  v_regs uuid[] := '{}'::uuid[];
  v_count integer;
BEGIN
  SELECT m.* INTO v_map FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = v_map_id
   FOR UPDATE;
  IF v_map.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;

  IF jsonb_typeof(p_payload->'seat_ids') = 'array' THEN
    SELECT COALESCE(array_agg((v.value)::uuid), '{}'::uuid[]) INTO v_seats
      FROM jsonb_array_elements_text(p_payload->'seat_ids') AS v(value);
  END IF;
  IF jsonb_typeof(p_payload->'registration_ids') = 'array' THEN
    SELECT COALESCE(array_agg((v.value)::uuid), '{}'::uuid[]) INTO v_regs
      FROM jsonb_array_elements_text(p_payload->'registration_ids') AS v(value);
  END IF;
  IF NOT v_all AND cardinality(v_seats) = 0 AND cardinality(v_regs) = 0 THEN
    RAISE EXCEPTION 'invalid_payload: pass seat_ids, registration_ids or all=true';
  END IF;

  UPDATE public.event_seat_assignments a
     SET released_at = now(), released_by = auth.uid(), release_reason = 'manual'
   WHERE a.tenant_id = v_tenant AND a.map_id = v_map_id AND a.released_at IS NULL
     AND (v_all OR a.seat_id = ANY(v_seats) OR a.registration_id = ANY(v_regs));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_seat',
      v_map_id::text,
      'event_seat.released.v1',
      jsonb_build_object('event_id', v_map.event_id, 'map_id', v_map_id, 'count', v_count,
                         'reason', 'manual'),
      auth.uid()
    );
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_release(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_release(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_release(jsonb) IS
  'Zwolnienie przydzialow planu sali (po miejscach, po zgloszeniach albo wszystkich). Zwolnienie jest miekkie - wiersz zostaje w historii. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 16. PANEL: KANDYDACI, ODCZYT MIEJSC ZGLOSZEN, EKSPORT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_seating_candidates(p_payload jsonb)
RETURNS TABLE (
  registration_id uuid,
  person_id uuid,
  first_name text,
  last_name text,
  company_id uuid,
  company text,
  ticket_type_id uuid,
  ticket_name_pl text,
  ticket_name_en text,
  group_id uuid,
  group_name_pl text,
  group_name_en text,
  group_color text,
  party_key uuid,
  package_order_id uuid,
  package_company_id uuid,
  registration_status text,
  seat_id uuid,
  seat_label text,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_map_id uuid := NULLIF(p_payload->>'map_id', '')::uuid;
  v_event uuid;
  v_q text := NULLIF(btrim(COALESCE(p_payload->>'q', '')), '');
  v_ticket uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_group uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_company uuid := NULLIF(p_payload->>'company_id', '')::uuid;
  v_only_unassigned boolean := COALESCE(NULLIF(p_payload->>'only_unassigned', '')::boolean, false);
  v_limit integer := least(greatest(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 50), 1), 500);
  v_offset integer := greatest(COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0), 0);
  v_pattern text;
BEGIN
  SELECT m.event_id INTO v_event FROM public.event_seat_maps m
   WHERE m.tenant_id = v_tenant AND m.id = v_map_id;
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;
  IF v_q IS NOT NULL AND char_length(v_q) >= 2 THEN
    v_pattern := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  RETURN QUERY
  SELECT
    r.id, p.id, p.first_name, p.last_name, p.company_id,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    r.ticket_type_id, t.name_pl, t.name_en,
    r.group_id, g.name_pl, g.name_en, g.color,
    COALESCE(r.group_lead_registration_id, r.id),
    pk.package_order_id, pk.company_id,
    r.status,
    a.seat_id, a.seat_label_snapshot,
    (count(*) OVER ())::integer
  FROM public.event_registrations r
  JOIN public.event_people p ON p.tenant_id = r.tenant_id AND p.id = r.person_id
  LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_ticket_types t ON t.tenant_id = r.tenant_id AND t.id = r.ticket_type_id
  LEFT JOIN public.event_groups g ON g.tenant_id = r.tenant_id AND g.id = r.group_id
  LEFT JOIN LATERAL (
    SELECT ps.package_order_id, po.company_id
      FROM public.event_package_seats ps
      JOIN public.event_package_orders po ON po.tenant_id = ps.tenant_id AND po.id = ps.package_order_id
     WHERE ps.tenant_id = r.tenant_id AND ps.registration_id = r.id AND ps.revoked_at IS NULL
     ORDER BY ps.created_at
     LIMIT 1
  ) pk ON true
  LEFT JOIN public.event_seat_assignments a
    ON a.tenant_id = r.tenant_id AND a.map_id = v_map_id AND a.registration_id = r.id
   AND a.released_at IS NULL
  WHERE r.tenant_id = v_tenant AND r.event_id = v_event
    AND r.status IN ('approved', 'attended', 'no_show')
    AND (v_ticket IS NULL OR r.ticket_type_id = v_ticket)
    AND (v_group IS NULL OR r.group_id = v_group)
    AND (v_company IS NULL OR p.company_id = v_company OR pk.company_id = v_company)
    AND (NOT v_only_unassigned OR a.id IS NULL)
    AND (v_pattern IS NULL
         OR lower(p.first_name || ' ' || p.last_name) LIKE v_pattern
         OR lower(COALESCE(p.email, '')) LIKE v_pattern
         OR lower(COALESCE(NULLIF(btrim(p.company_text), ''), co.name, '')) LIKE v_pattern)
  ORDER BY p.last_name, p.first_name, r.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seating_candidates(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seating_candidates(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seating_candidates(jsonb) IS
  'Uczestnicy do rozsadzenia w planie: wylacznie zgloszenia approved|attended|no_show, z projekcja firmy CRM, biletem, grupa, kluczem zespolu zapisu (group_lead) i zamowieniem pakietowym, filtrami i stronicowaniem po stronie bazy (<= 500). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seat_lookup(p_payload jsonb)
RETURNS TABLE (
  registration_id uuid,
  map_id uuid,
  map_name text,
  map_status text,
  section_label text,
  section_kind text,
  row_label text,
  seat_number integer,
  category_key text,
  category_name_pl text,
  category_name_en text,
  category_color text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_ids uuid[] := '{}'::uuid[];
BEGIN
  IF jsonb_typeof(p_payload->'registration_ids') = 'array' THEN
    SELECT COALESCE(array_agg(DISTINCT (v.value)::uuid), '{}'::uuid[]) INTO v_ids
      FROM jsonb_array_elements_text(p_payload->'registration_ids') AS v(value);
  END IF;
  IF cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'too_many_ids: % registrations in one call, limit is 200', cardinality(v_ids);
  END IF;

  RETURN QUERY
  SELECT a.registration_id, m.id, m.name, m.status, sc.label, sc.kind, s.row_label, s.seat_number,
         c.key, c.name_pl, c.name_en, c.color
    FROM public.event_seat_assignments a
    JOIN public.event_seat_maps m ON m.tenant_id = a.tenant_id AND m.id = a.map_id
    JOIN public.event_seats s ON s.tenant_id = a.tenant_id AND s.id = a.seat_id
    JOIN public.event_seat_sections sc ON sc.tenant_id = s.tenant_id AND sc.id = s.section_id
    LEFT JOIN public.event_seat_categories c
      ON c.tenant_id = s.tenant_id AND c.id = COALESCE(s.category_id, sc.category_id)
   WHERE a.tenant_id = v_tenant AND a.event_id = v_event
     AND a.registration_id = ANY(v_ids) AND a.released_at IS NULL
   ORDER BY m.sort_order, m.name, a.registration_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_lookup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_lookup(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_lookup(jsonb) IS
  'Miejsca na sali dla listy zgloszen (<= 200 identyfikatorow): jeden wspolny odczyt dla listy zgloszen, CSV i stanowiska odprawy - bez przepisywania ich duzych RPC. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_seating_export(p_payload jsonb)
RETURNS TABLE (
  seat_id uuid,
  section_label text,
  section_kind text,
  section_sort integer,
  row_label text,
  seat_number integer,
  sort_key integer,
  seat_status text,
  is_accessible boolean,
  category_key text,
  category_name_pl text,
  category_name_en text,
  hold_company_id uuid,
  hold_company_name text,
  hold_note text,
  registration_id uuid,
  first_name text,
  last_name text,
  email text,
  company_id uuid,
  company text,
  ticket_name_pl text,
  ticket_name_en text,
  registration_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_map_id uuid := NULLIF(p_payload->>'map_id', '')::uuid;
  v_company uuid := NULLIF(p_payload->>'company_id', '')::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.event_seat_maps m WHERE m.tenant_id = v_tenant AND m.id = v_map_id) THEN
    RAISE EXCEPTION 'not_found: seat map does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT
    s.id, sc.label, sc.kind, sc.sort_order, s.row_label, s.seat_number, s.sort_key,
    s.status, s.is_accessible, c.key, c.name_pl, c.name_en,
    COALESCE(s.hold_company_id, sp.company_id, po.company_id),
    COALESCE(hco.name, sp.snapshot_name, po.buyer_name), s.hold_note,
    r.id, p.first_name, p.last_name, p.email, p.company_id,
    COALESCE(NULLIF(btrim(p.company_text), ''), pco.name),
    t.name_pl, t.name_en, r.status
  FROM public.event_seats s
  JOIN public.event_seat_sections sc ON sc.tenant_id = s.tenant_id AND sc.id = s.section_id
  LEFT JOIN public.event_seat_categories c
    ON c.tenant_id = s.tenant_id AND c.id = COALESCE(s.category_id, sc.category_id)
  LEFT JOIN public.crm_companies hco ON hco.tenant_id = s.tenant_id AND hco.id = s.hold_company_id
  LEFT JOIN public.event_sponsors sp ON sp.tenant_id = s.tenant_id AND sp.id = s.hold_sponsor_id
  LEFT JOIN public.event_package_orders po ON po.tenant_id = s.tenant_id AND po.id = s.hold_package_order_id
  LEFT JOIN public.event_seat_assignments a
    ON a.tenant_id = s.tenant_id AND a.seat_id = s.id AND a.released_at IS NULL
  LEFT JOIN public.event_registrations r ON r.tenant_id = a.tenant_id AND r.id = a.registration_id
  LEFT JOIN public.event_people p ON p.tenant_id = r.tenant_id AND p.id = r.person_id
  LEFT JOIN public.crm_companies pco ON pco.tenant_id = p.tenant_id AND pco.id = p.company_id
  LEFT JOIN public.event_ticket_types t ON t.tenant_id = r.tenant_id AND t.id = r.ticket_type_id
  WHERE s.tenant_id = v_tenant AND s.map_id = v_map_id
    AND (v_company IS NULL
         OR p.company_id = v_company
         OR COALESCE(s.hold_company_id, sp.company_id, po.company_id) = v_company)
  ORDER BY sc.sort_order, sc.label, s.sort_key;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seating_export(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seating_export(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seating_export(jsonb) IS
  'Eksport planu sali: jeden wiersz na miejsce z posiadaczem (osoba, e-mail, firma w projekcji CRM, bilet) i rezerwujacym. Filtr company_id daje liste gosci jednej firmy (osoby firmy i jej rezerwacje). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 17. UCZESTNIK: MOJE MIEJSCE (plany opublikowane, tylko wlasne miejsca)
-- ----------------------------------------------------------------------------
-- Karta miejsca bez cudzych danych: geometria WYLACZNIE sekcji uczestnika
-- (pozycje miejsc i znacznik "moje"), bez statusow i posiadaczy innych miejsc.
CREATE OR REPLACE FUNCTION public._event_seat_cards(p_tenant uuid, p_registration_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(q.card ORDER BY q.map_sort, q.map_name, q.section_sort, q.seat_sort), '[]'::jsonb)
  FROM (
    SELECT
      m.sort_order AS map_sort, m.name AS map_name, sc.sort_order AS section_sort, s.sort_key AS seat_sort,
      jsonb_build_object(
        'map_id', m.id,
        'map_name', m.name,
        'room_name', ro.name,
        'room_floor', ro.floor,
        'room_note', ro.location_note,
        'session_title_pl', se.title_pl,
        'session_title_en', se.title_en,
        'section_label', sc.label,
        'section_kind', sc.kind,
        'row_label', s.row_label,
        'seat_number', s.seat_number,
        'is_accessible', s.is_accessible,
        'category', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'name_pl', c.name_pl, 'name_en', c.name_en, 'color', c.color) END,
        'geometry', jsonb_build_object(
          'width', m.width,
          'height', m.height,
          'stage', CASE WHEN m.stage_x IS NULL THEN NULL ELSE jsonb_build_object(
            'x', m.stage_x, 'y', m.stage_y, 'w', m.stage_w, 'h', m.stage_h) END,
          'section', jsonb_build_object(
            'kind', sc.kind, 'table_shape', sc.table_shape,
            'origin_x', sc.origin_x, 'origin_y', sc.origin_y, 'rotation_deg', sc.rotation_deg,
            'seat_pitch', sc.seat_pitch, 'row_pitch', sc.row_pitch),
          'seats', (
            SELECT jsonb_agg(jsonb_build_object('x', o.x, 'y', o.y, 'mine', o.id = s.id) ORDER BY o.sort_key)
              FROM public.event_seats o
             WHERE o.tenant_id = p_tenant AND o.section_id = sc.id
          )
        )
      ) AS card
    FROM public.event_seat_assignments a
    JOIN public.event_seat_maps m
      ON m.tenant_id = a.tenant_id AND m.id = a.map_id AND m.status = 'published'
    JOIN public.event_seats s ON s.tenant_id = a.tenant_id AND s.id = a.seat_id
    JOIN public.event_seat_sections sc ON sc.tenant_id = s.tenant_id AND sc.id = s.section_id
    LEFT JOIN public.event_seat_categories c
      ON c.tenant_id = s.tenant_id AND c.id = COALESCE(s.category_id, sc.category_id)
    LEFT JOIN public.event_rooms ro ON ro.tenant_id = m.tenant_id AND ro.id = m.room_id
    LEFT JOIN public.event_sessions se ON se.tenant_id = m.tenant_id AND se.id = m.session_id
    WHERE a.tenant_id = p_tenant
      AND a.registration_id = ANY(p_registration_ids)
      AND a.released_at IS NULL
  ) q
$$;
REVOKE ALL ON FUNCTION public._event_seat_cards(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seat_cards(uuid, uuid[]) TO service_role;
COMMENT ON FUNCTION public._event_seat_cards(uuid, uuid[]) IS
  'Karty miejsc na sali dla podanych zgloszen: wylacznie plany opublikowane, geometria tylko sekcji wlasnego miejsca bez cudzych danych. Wolaja event_my_seats i event_ticket_seats.';

CREATE OR REPLACE FUNCTION public.event_my_seats(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
  v_event uuid;
  v_regs uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your seat';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_slug: event slug is required';
  END IF;

  SELECT e.id INTO v_event FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = v_slug
   LIMIT 1;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('seats', '[]'::jsonb);
  END IF;

  SELECT COALESCE(array_agg(r.id), '{}'::uuid[]) INTO v_regs
    FROM public.event_registrations r
    JOIN public.event_people p ON p.tenant_id = r.tenant_id AND p.id = r.person_id
   WHERE r.tenant_id = v_tenant AND r.event_id = v_event AND p.user_id = v_uid;

  RETURN jsonb_build_object('seats', public._event_seat_cards(v_tenant, v_regs));
END;
$$;
REVOKE ALL ON FUNCTION public.event_my_seats(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_seats(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.event_my_seats(jsonb) IS
  'Miejsca na sali zalogowanego uczestnika na wydarzeniu (slug): wylacznie plany opublikowane i wlasne zgloszenia (event_people.user_id = auth.uid()). Plaszczyzna tresci: public_tenant_id(), bez has_role.';

CREATE OR REPLACE FUNCTION public.event_ticket_seats(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
  v_qr text := NULLIF(btrim(COALESCE(p_payload->>'qr_token', '')), '');
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_reg uuid;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RETURN jsonb_build_object('seats', '[]'::jsonb);
  END IF;
  -- Ksztalt `_event_new_qr_token()`: 32 znaki base64url. Inny ksztalt nie ma
  -- prawa istniec w bazie - nie liczymy nawet skrotu.
  IF v_manage IS NOT NULL AND v_manage ~ '^[A-Za-z0-9_-]{32}$' THEN
    SELECT r.id INTO v_reg
      FROM public.event_registrations r
      JOIN public.events e ON e.tenant_id = r.tenant_id AND e.id = r.event_id
     WHERE r.tenant_id = v_tenant AND e.slug = v_slug
       AND r.manage_token_hash = encode(digest(v_manage, 'sha256'), 'hex');
  END IF;
  IF v_reg IS NULL AND v_qr IS NOT NULL AND v_qr ~ '^[A-Za-z0-9_-]{32}$' THEN
    SELECT r.id INTO v_reg
      FROM public.event_registrations r
      JOIN public.events e ON e.tenant_id = r.tenant_id AND e.id = r.event_id
     WHERE r.tenant_id = v_tenant AND e.slug = v_slug
       AND r.qr_token_hash = encode(digest(v_qr, 'sha256'), 'hex');
  END IF;
  IF v_reg IS NULL THEN
    RETURN jsonb_build_object('seats', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object('seats', public._event_seat_cards(v_tenant, ARRAY[v_reg]));
END;
$$;
REVOKE ALL ON FUNCTION public.event_ticket_seats(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_ticket_seats(jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.event_ticket_seats(jsonb) IS
  'Miejsce na sali na stronie biletu: zgloszenie wskazane skrotem klucza samoobslugi albo kodu QR z fragmentu adresu (baza trzyma tylko SHA-256), tylko plany opublikowane, ten sam minimalny ksztalt co event_my_seats. Nieznany kod = pusta lista (bez rozroznienia przyczyny). Plaszczyzna tresci: public_tenant_id(), bez has_role.';
