-- ============================================================================
-- PLAN SALI - POPRAWKI Z PRZEGLADU MIGRACJI 20260927000400..000402.
--
-- BLIZNIAK drizzle/migrations/0074_event_seating_review_fixes.sql - ten sam SQL
-- wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`). Blizniak NIE
-- ma wpisu w `drizzle/migrations/meta/_journal.json`: migrator Lovable wykonuje
-- kazdy wpis dziennika przy najblizszym wdrozeniu, bez wzgledu na kolejnosc
-- (docs/WDROZENIE_FUNKCJE_ORGANIZATORA_CZ3_2026-09-27.md, sekcja 2.2).
-- events-harness: include
--
-- DLACZEGO NOWY PLIK. Pliki 20260927000400..000402 moga zostac zastosowane na
-- produkcji w kazdej chwili, wiec ich nie zmieniamy. Ten plik idzie PO nich
-- (scripts/deploy-order/produkcja.txt) i nadpisuje szesc funkcji przez
-- CREATE OR REPLACE - bez zmiany sygnatur i ksztaltu RETURNS. Ciala sa
-- przepisane z 000401/000402 i zmienione tylko tam, gdzie wymaga tego
-- poprawka; REVOKE/GRANT bez zmian, COMMENT bez zmian poza eksportem
-- i `event_my_seats` (opisuja nowe zachowanie).
--
-- 1. KOLEJNOSC BLOKAD (zakleszczenie 40P01 odtworzone w harnessie).
--    `admin_event_seat_assign` bral blokade planu, zwalnial przydzialy,
--    a dopiero INSERT (trigger `_tg_event_seat_assignment_validate`) bral
--    FOR SHARE na zgloszeniu: plan -> przydzialy -> zgloszenie. Sciezki
--    statusu (`payments_apply_event_ticket_outcome`,
--    `admin_event_registration_decide`) ida wydarzenie -> bilet -> zgloszenie,
--    a potem trigger `_tg_event_registration_release_seats` zwalnia przydzialy -
--    ofiara zakleszczenia byl zwrot, anulowanie albo sam przydzial (ta sesja,
--    ktora czekala dluzej). `_assign_batch` bral
--    FOR SHARE w petli, juz pod blokada planu, i zakleszczal sie z anulowaniem
--    prowadzacego grupy (`_tg_event_group_follow_lead_status` blokuje gosci
--    FOR UPDATE po prowadzacym). Teraz obie funkcje biora FOR SHARE na
--    zgloszeniach PRZED planem, w kolejnosci kaskady grupy (prowadzacy, potem
--    goscie wg created_at, id), i po planie nie blokuja juz zadnego zgloszenia
--    (FOR SHARE w triggerze trafia w blokade, ktora transakcja juz ma).
--    Posiadacza miejsca przydzial czyta bez blokady; gdy pod blokada planu na
--    miejscu siedzi juz ktos inny - `seat_taken`.
-- 2. ZAOKRAGLENIE PARAMETROW SEKCJI. `admin_event_seat_section_save` liczyl
--    uklad z rozstawu z wejscia (45.555), a zapisywal numeric(6,2) (45.56) -
--    zmiana samej etykiety przeliczala potem miejsca z innej liczby. Rozstawy,
--    poczatek i obrot sa zaokraglane do setnych PRZED walidacja i ukladem.
-- 3. EKSPORT BEZ E-MAILI. Lista przy drzwiach trafia do hostess i cateringu;
--    `admin_event_seating_export` oddaje w kolumnie `email` zawsze NULL
--    (kolumny RETURNS TABLE nie da sie usunac przez CREATE OR REPLACE).
-- 4. KANDYDACI. `admin_event_seating_candidates` sklada etykiete miejsca na
--    zywo z sekcji - migawka przydzialu nie wie o zmianie nazwy sekcji.
-- 5. MOJE MIEJSCE. `event_my_seats` oddaje tez `seatable` (wolajacy ma
--    zgloszenie approved|attended|no_show) i `has_published_plan` (wydarzenie
--    ma opublikowany plan) - panel "Moje" nie zapowiada miejsca komus, kto go
--    nie dostanie, ani na wydarzeniu bez planu sali.
--
-- IDEMPOTENCJA: wylacznie CREATE OR REPLACE FUNCTION, REVOKE, GRANT, COMMENT.
--
-- Testy: scripts/events-harness/runtime_test.d/65_seating.sql,
-- scripts/events-harness/runtime_test.d/66_seating_lock_order.sql (dwie sesje).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PANEL: PRZYDZIAL I PRZYDZIAL ZBIORCZY (kolejnosc blokad)
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
  v_occ_hint uuid;
BEGIN
  IF v_map_id IS NULL OR v_seat_id IS NULL OR v_reg_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: map_id, seat_id and registration_id are required';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note: note must have at most 500 characters';
  END IF;

  -- KOLEJNOSC BLOKAD (20260927001200): zgloszenia PRZED planem, jak sciezki
  -- statusu (wydarzenie -> bilet -> zgloszenie -> przydzialy). Posiadacza
  -- miejsca czytamy bez blokady - zamiana posadzi go ponownie, a trigger
  -- przydzialu bierze FOR SHARE na jego zgloszeniu. Po planie zadne zgloszenie
  -- nie jest juz blokowane; inny posiadacz pod blokada planu = seat_taken nizej.
  SELECT a.registration_id INTO v_occ_hint FROM public.event_seat_assignments a
   WHERE a.tenant_id = v_tenant AND a.seat_id = v_seat_id AND a.released_at IS NULL;
  PERFORM 1 FROM public.event_registrations r
   WHERE r.tenant_id = v_tenant AND r.id IN (v_reg_id, v_occ_hint)
   ORDER BY COALESCE(r.group_lead_registration_id, r.id),
            (r.group_lead_registration_id IS NOT NULL), r.created_at, r.id
   FOR SHARE;

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

  -- Posiadacz usiadl miedzy odczytem bez blokady a blokada planu: jego
  -- zgloszenia nie blokowalismy, a pod planem juz go nie zablokujemy.
  IF v_occ.id IS NOT NULL AND v_occ.registration_id IS DISTINCT FROM v_occ_hint THEN
    RAISE EXCEPTION 'seat_taken: this seat already has an attendee';
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
  v_reg_ids uuid[];
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

  -- KOLEJNOSC BLOKAD (20260927001200): zgloszenia WSZYSTKICH pozycji FOR SHARE
  -- PRZED planem, w kolejnosci kaskady grupy (prowadzacy, potem goscie wg
  -- created_at, id - jak `_tg_event_group_follow_lead_status`). FOR SHARE
  -- w triggerze przydzialu trafia potem w blokade, ktora juz mamy.
  SELECT COALESCE(array_agg((e.value->>'registration_id')::uuid), '{}'::uuid[]) INTO v_reg_ids
    FROM jsonb_array_elements(p_payload->'items') AS e(value)
   WHERE COALESCE(e.value->>'registration_id', '') ~ v_uuid;
  PERFORM 1 FROM public.event_registrations r
   WHERE r.tenant_id = v_tenant AND r.id = ANY(v_reg_ids)
   ORDER BY COALESCE(r.group_lead_registration_id, r.id),
            (r.group_lead_registration_id IS NOT NULL), r.created_at, r.id
   FOR SHARE;

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

-- ----------------------------------------------------------------------------
-- 2. PANEL: SEKCJE (parametry zaokraglone przed ukladem)
-- ----------------------------------------------------------------------------
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

  -- ZAOKRAGLENIE (20260927001200): kolumny sekcji sa numeric(8,2)/(5,2)/(6,2),
  -- wiec walidacja i uklad ida z TYCH wartosci, ktore zapisze wiersz. Inaczej
  -- nastepny zapis (np. sama zmiana etykiety) liczylby miejsca z innej liczby.
  -- Lustro: `sectionDraftToInput` w src/lib/events/seatingDraft.ts.
  v_origin_x := round(v_origin_x, 2);
  v_origin_y := round(v_origin_y, 2);
  v_rotation := round(v_rotation, 2);
  v_seat_pitch := round(v_seat_pitch, 2);
  v_row_pitch := round(v_row_pitch, 2);

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
    -- Miejsca, ktorych nowe parametry juz nie maja, a ktos na nich siedzi.
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

-- ----------------------------------------------------------------------------
-- 3. PANEL: KANDYDACI (etykieta miejsca na zywo) I EKSPORT (bez e-maili)
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
    -- Etykieta NA ZYWO z sekcji (20260927001200): migawka przydzialu zostaje
    -- przy starej nazwie sekcji; migawka tylko wtedy, gdy miejsca juz nie ma.
    a.seat_id,
    COALESCE(public._event_seat_label(sc.label, sc.kind, s.row_label, s.seat_number), a.seat_label_snapshot),
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
  LEFT JOIN public.event_seats s ON s.tenant_id = a.tenant_id AND s.id = a.seat_id
  LEFT JOIN public.event_seat_sections sc ON sc.tenant_id = s.tenant_id AND sc.id = s.section_id
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
    -- Bez e-maili (20260927001200): plik trafia do obslugi sali, kolumna
    -- zostaje tylko dla ksztaltu RETURNS TABLE.
    r.id, p.first_name, p.last_name, NULL::text, p.company_id,
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
  'Eksport planu sali: jeden wiersz na miejsce z posiadaczem (osoba, firma w projekcji CRM, bilet) i rezerwujacym. Kolumna email jest zawsze NULL (od 20260927001200) - plik trafia do obslugi sali, adresy e-mail nie opuszczaja systemu. Filtr company_id daje liste gosci jednej firmy (osoby firmy i jej rezerwacje). Bramka: assert_event_admin_tenant().';


-- ----------------------------------------------------------------------------
-- 4. UCZESTNIK: MOJE MIEJSCE (czy zapowiadac miejsce)
-- ----------------------------------------------------------------------------
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
  v_seatable boolean;
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
    RETURN jsonb_build_object('seats', '[]'::jsonb, 'seatable', false, 'has_published_plan', false);
  END IF;

  -- `seatable` i `has_published_plan` (20260927001200): panel "Moje" zapowiada
  -- miejsce tylko wtedy, gdy wolajacy moze je dostac (status zajmujacy miejsce,
  -- ten sam zbior co trigger przydzialu) i plan jest juz opublikowany. Bez nich
  -- zapowiedz widzial kazdy - takze na wydarzeniu bez planu sali.
  SELECT COALESCE(array_agg(r.id), '{}'::uuid[]),
         COALESCE(bool_or(r.status IN ('approved', 'attended', 'no_show')), false)
    INTO v_regs, v_seatable
    FROM public.event_registrations r
    JOIN public.event_people p ON p.tenant_id = r.tenant_id AND p.id = r.person_id
   WHERE r.tenant_id = v_tenant AND r.event_id = v_event AND p.user_id = v_uid;

  RETURN jsonb_build_object(
    'seats', public._event_seat_cards(v_tenant, v_regs),
    'seatable', v_seatable,
    'has_published_plan', EXISTS (
      SELECT 1 FROM public.event_seat_maps m
       WHERE m.tenant_id = v_tenant AND m.event_id = v_event AND m.status = 'published'
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_my_seats(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_seats(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.event_my_seats(jsonb) IS
  'Miejsca na sali zalogowanego uczestnika na wydarzeniu (slug): wylacznie plany opublikowane i wlasne zgloszenia (event_people.user_id = auth.uid()). Oddaje tez seatable (wolajacy ma zgloszenie approved|attended|no_show) i has_published_plan (wydarzenie ma opublikowany plan) - zapowiedz miejsca tylko, gdy oba sa prawda. Plaszczyzna tresci: public_tenant_id(), bez has_role.';
