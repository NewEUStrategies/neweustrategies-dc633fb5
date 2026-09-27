CREATE TABLE IF NOT EXISTS public.event_seat_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  room_id uuid,
  session_id uuid,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  width integer NOT NULL DEFAULT 1200,
  height integer NOT NULL DEFAULT 800,
  stage_x numeric(8,2),
  stage_y numeric(8,2),
  stage_w numeric(8,2),
  stage_h numeric(8,2),
  sort_order integer NOT NULL DEFAULT 100,
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_seat_maps_status_values CHECK (status IN ('draft', 'published')),
  CONSTRAINT event_seat_maps_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT event_seat_maps_size_range CHECK (width BETWEEN 200 AND 20000 AND height BETWEEN 200 AND 20000),
  CONSTRAINT event_seat_maps_stage_shape CHECK (
    (stage_x IS NULL AND stage_y IS NULL AND stage_w IS NULL AND stage_h IS NULL)
    OR (stage_x IS NOT NULL AND stage_y IS NOT NULL AND stage_w > 0 AND stage_h > 0)
  ),
  CONSTRAINT event_seat_maps_published_shape CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT event_seat_maps_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_seat_maps_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_seat_maps_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_seat_maps_room_fk FOREIGN KEY (tenant_id, event_id, room_id)
    REFERENCES public.event_rooms (tenant_id, event_id, id) ON DELETE SET NULL (room_id),
  CONSTRAINT event_seat_maps_session_fk FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE SET NULL (session_id)
);

COMMENT ON TABLE public.event_seat_maps IS
  'Plan sali wydarzenia (rozsadzenie). Nazwa jednojezyczna jak nazwa sali. Uczestnik widzi swoje miejsce dopiero po publikacji (status published). Zapis wylacznie przez admin_event_seat_map_save / _delete.';

CREATE UNIQUE INDEX IF NOT EXISTS event_seat_maps_event_name_uniq
  ON public.event_seat_maps (tenant_id, event_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS event_seat_maps_event_idx
  ON public.event_seat_maps (tenant_id, event_id, sort_order);

CREATE TABLE IF NOT EXISTS public.event_seat_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  color text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_seat_categories_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_seat_categories_names_len CHECK (
    char_length(btrim(name_pl)) BETWEEN 1 AND 80 AND char_length(btrim(name_en)) BETWEEN 1 AND 80
  ),
  CONSTRAINT event_seat_categories_color_hex CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT event_seat_categories_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_seat_categories_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_seat_categories_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_seat_categories_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_seat_categories IS
  'Kategorie miejsc na sali (VIP, Prasa). Nazwy PL/EN, bo widzi je uczestnik; klucz niezmienny po utworzeniu. Zapis wylacznie przez admin_event_seat_category_save / _delete.';

CREATE TABLE IF NOT EXISTS public.event_seat_category_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  category_id uuid NOT NULL,
  ticket_type_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_seat_category_tickets_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_seat_category_tickets_pair_unique UNIQUE (tenant_id, category_id, ticket_type_id),
  CONSTRAINT event_seat_category_tickets_category_fk FOREIGN KEY (tenant_id, event_id, category_id)
    REFERENCES public.event_seat_categories (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_seat_category_tickets_ticket_fk FOREIGN KEY (tenant_id, event_id, ticket_type_id)
    REFERENCES public.event_ticket_types (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_seat_category_tickets IS
  'Typy biletow, ktore wolno sadzac w kategorii miejsc. Kategoria bez wierszy przyjmuje kazdy bilet. Reczny przydzial wbrew regule wymaga force. Zapis przez admin_event_seat_category_save (klucz ticket_type_ids).';

CREATE INDEX IF NOT EXISTS event_seat_category_tickets_ticket_idx
  ON public.event_seat_category_tickets (tenant_id, event_id, ticket_type_id);

CREATE TABLE IF NOT EXISTS public.event_seat_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  map_id uuid NOT NULL,
  label text NOT NULL,
  kind text NOT NULL,
  category_id uuid,
  origin_x numeric(8,2) NOT NULL DEFAULT 0,
  origin_y numeric(8,2) NOT NULL DEFAULT 0,
  rotation_deg numeric(5,2) NOT NULL DEFAULT 0,
  rows_count integer,
  seats_per_row integer,
  row_label_scheme text,
  row_label_start integer NOT NULL DEFAULT 1,
  seat_numbering text,
  seat_number_start integer NOT NULL DEFAULT 1,
  seat_pitch numeric(6,2) NOT NULL DEFAULT 50,
  row_pitch numeric(6,2) NOT NULL DEFAULT 60,
  aisle_after integer[] NOT NULL DEFAULT '{}',
  table_shape text,
  table_seats integer,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_seat_sections_kind_values CHECK (kind IN ('rows', 'table')),
  CONSTRAINT event_seat_sections_row_label_scheme_values
    CHECK (row_label_scheme IS NULL OR row_label_scheme IN ('alpha', 'numeric')),
  CONSTRAINT event_seat_sections_seat_numbering_values
    CHECK (seat_numbering IS NULL OR seat_numbering IN ('ltr', 'rtl', 'odd_even')),
  CONSTRAINT event_seat_sections_table_shape_values
    CHECK (table_shape IS NULL OR table_shape IN ('round', 'rect')),
  CONSTRAINT event_seat_sections_shape CHECK (
    (kind = 'rows'
      AND rows_count BETWEEN 1 AND 200 AND seats_per_row BETWEEN 1 AND 200
      AND rows_count * seats_per_row <= 2000
      AND row_label_scheme IS NOT NULL AND seat_numbering IS NOT NULL
      AND table_shape IS NULL AND table_seats IS NULL)
    OR (kind = 'table'
      AND table_seats BETWEEN 1 AND 24 AND table_shape IS NOT NULL
      AND rows_count IS NULL AND seats_per_row IS NULL
      AND row_label_scheme IS NULL AND seat_numbering IS NULL)
  ),
  CONSTRAINT event_seat_sections_label_len CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  CONSTRAINT event_seat_sections_starts_range CHECK (
    row_label_start BETWEEN 1 AND 1000 AND seat_number_start BETWEEN 1 AND 10000
  ),
  CONSTRAINT event_seat_sections_pitch_range CHECK (
    seat_pitch BETWEEN 10 AND 500 AND row_pitch BETWEEN 10 AND 500
  ),
  CONSTRAINT event_seat_sections_position_range CHECK (
    origin_x BETWEEN -20000 AND 40000 AND origin_y BETWEEN -20000 AND 40000
    AND rotation_deg BETWEEN -360 AND 360
  ),
  CONSTRAINT event_seat_sections_aisles_len CHECK (cardinality(aisle_after) <= 20),
  CONSTRAINT event_seat_sections_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_seat_sections_tenant_map_id_key UNIQUE (tenant_id, map_id, id),
  CONSTRAINT event_seat_sections_map_fk FOREIGN KEY (tenant_id, event_id, map_id)
    REFERENCES public.event_seat_maps (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_seat_sections_category_fk FOREIGN KEY (tenant_id, event_id, category_id)
    REFERENCES public.event_seat_categories (tenant_id, event_id, id) ON DELETE SET NULL (category_id)
);

COMMENT ON TABLE public.event_seat_sections IS
  'Sekcje planu sali: rzedy x miejsca albo stol x krzesla. Parametry, nie rysunek - miejsca generuje admin_event_seat_section_save. Etykieta jednojezyczna (A, Balkon, Stol 5).';

CREATE UNIQUE INDEX IF NOT EXISTS event_seat_sections_map_label_uniq
  ON public.event_seat_sections (tenant_id, map_id, lower(btrim(label)));

CREATE TABLE IF NOT EXISTS public.event_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  map_id uuid NOT NULL,
  section_id uuid NOT NULL,
  row_label text,
  seat_number integer NOT NULL,
  x numeric(8,2) NOT NULL,
  y numeric(8,2) NOT NULL,
  sort_key integer NOT NULL,
  category_id uuid,
  status text NOT NULL DEFAULT 'available',
  block_reason text,
  hold_company_id uuid,
  hold_sponsor_id uuid,
  hold_package_order_id uuid,
  hold_note text,
  is_accessible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_seats_status_values CHECK (status IN ('available', 'blocked', 'held')),
  CONSTRAINT event_seats_hold_only_when_held CHECK (
    status = 'held'
    OR (hold_company_id IS NULL AND hold_sponsor_id IS NULL
        AND hold_package_order_id IS NULL AND hold_note IS NULL)
  ),
  CONSTRAINT event_seats_block_reason_shape CHECK (status = 'blocked' OR block_reason IS NULL),
  CONSTRAINT event_seats_notes_len CHECK (
    (block_reason IS NULL OR char_length(block_reason) <= 200)
    AND (hold_note IS NULL OR char_length(hold_note) <= 200)
  ),
  CONSTRAINT event_seats_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_seats_tenant_map_id_key UNIQUE (tenant_id, map_id, id),
  CONSTRAINT event_seats_section_fk FOREIGN KEY (tenant_id, map_id, section_id)
    REFERENCES public.event_seat_sections (tenant_id, map_id, id) ON DELETE CASCADE,
  CONSTRAINT event_seats_map_fk FOREIGN KEY (tenant_id, event_id, map_id)
    REFERENCES public.event_seat_maps (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_seats_category_fk FOREIGN KEY (tenant_id, event_id, category_id)
    REFERENCES public.event_seat_categories (tenant_id, event_id, id) ON DELETE SET NULL (category_id),
  CONSTRAINT event_seats_hold_company_fk FOREIGN KEY (tenant_id, hold_company_id)
    REFERENCES public.crm_companies (tenant_id, id) ON DELETE SET NULL (hold_company_id),
  CONSTRAINT event_seats_hold_sponsor_fk FOREIGN KEY (tenant_id, event_id, hold_sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE SET NULL (hold_sponsor_id),
  CONSTRAINT event_seats_hold_package_fk FOREIGN KEY (tenant_id, event_id, hold_package_order_id)
    REFERENCES public.event_package_orders (tenant_id, event_id, id) ON DELETE SET NULL (hold_package_order_id)
);

COMMENT ON TABLE public.event_seats IS
  'Miejsca na sali, zmaterializowane z parametrow sekcji (wspolrzedne LOKALNE sekcji). Status available|blocked|held; rezerwacja dla firmy z CRM, sponsora albo zamowienia pakietowego. Zapis przez admin_event_seat_section_save i admin_event_seats_update.';

CREATE UNIQUE INDEX IF NOT EXISTS event_seats_natural_uniq
  ON public.event_seats (tenant_id, section_id, COALESCE(row_label, ''), seat_number);
CREATE INDEX IF NOT EXISTS event_seats_map_order_idx
  ON public.event_seats (tenant_id, map_id, sort_key);
CREATE INDEX IF NOT EXISTS event_seats_hold_company_idx
  ON public.event_seats (tenant_id, hold_company_id) WHERE hold_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_seat_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  map_id uuid NOT NULL,
  seat_id uuid,
  registration_id uuid NOT NULL,
  seat_label_snapshot text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  note text,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  release_reason text,
  CONSTRAINT event_seat_assignments_source_values CHECK (source IN ('manual', 'auto', 'import')),
  CONSTRAINT event_seat_assignments_release_reason_values CHECK (
    release_reason IS NULL OR release_reason IN ('manual', 'moved', 'registration_status', 'seat_blocked')
  ),
  CONSTRAINT event_seat_assignments_release_shape CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  CONSTRAINT event_seat_assignments_note_len CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT event_seat_assignments_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_seat_assignments_map_fk FOREIGN KEY (tenant_id, event_id, map_id)
    REFERENCES public.event_seat_maps (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_seat_assignments_seat_fk FOREIGN KEY (tenant_id, map_id, seat_id)
    REFERENCES public.event_seats (tenant_id, map_id, id) ON DELETE SET NULL (seat_id),
  CONSTRAINT event_seat_assignments_registration_fk FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_seat_assignments IS
  'Przydzialy miejsc na sali. Zwolnienie jest miekkie (released_at + release_reason) - wiersz zostaje jako historia. Jedno aktywne miejsce na zgloszenie w planie i jeden aktywny posiadacz miejsca gwarantuja indeksy czesciowe. Zapis przez admin_event_seat_assign / _assign_batch / _release oraz trigger zwalniajacy na event_registrations.';

CREATE UNIQUE INDEX IF NOT EXISTS event_seat_assignments_seat_active_uniq
  ON public.event_seat_assignments (tenant_id, seat_id)
  WHERE released_at IS NULL AND seat_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_seat_assignments_registration_active_uniq
  ON public.event_seat_assignments (tenant_id, map_id, registration_id)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS event_seat_assignments_registration_idx
  ON public.event_seat_assignments (tenant_id, registration_id)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS event_seat_assignments_seat_idx
  ON public.event_seat_assignments (tenant_id, map_id, seat_id);

DROP TRIGGER IF EXISTS event_seat_maps_touch_updated_at ON public.event_seat_maps;
CREATE TRIGGER event_seat_maps_touch_updated_at
  BEFORE UPDATE ON public.event_seat_maps
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

DROP TRIGGER IF EXISTS event_seat_categories_touch_updated_at ON public.event_seat_categories;
CREATE TRIGGER event_seat_categories_touch_updated_at
  BEFORE UPDATE ON public.event_seat_categories
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

DROP TRIGGER IF EXISTS event_seat_sections_touch_updated_at ON public.event_seat_sections;
CREATE TRIGGER event_seat_sections_touch_updated_at
  BEFORE UPDATE ON public.event_seat_sections
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

DROP TRIGGER IF EXISTS event_seats_touch_updated_at ON public.event_seats;
CREATE TRIGGER event_seats_touch_updated_at
  BEFORE UPDATE ON public.event_seats
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

REVOKE ALL ON public.event_seat_maps FROM anon, authenticated;
GRANT SELECT ON public.event_seat_maps TO authenticated;
GRANT ALL ON public.event_seat_maps TO service_role;
ALTER TABLE public.event_seat_maps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_seat_maps_staff_read" ON public.event_seat_maps;
CREATE POLICY "event_seat_maps_staff_read"
  ON public.event_seat_maps FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

REVOKE ALL ON public.event_seat_categories FROM anon, authenticated;
GRANT SELECT ON public.event_seat_categories TO authenticated;
GRANT ALL ON public.event_seat_categories TO service_role;
ALTER TABLE public.event_seat_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_seat_categories_staff_read" ON public.event_seat_categories;
CREATE POLICY "event_seat_categories_staff_read"
  ON public.event_seat_categories FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

REVOKE ALL ON public.event_seat_category_tickets FROM anon, authenticated;
GRANT SELECT ON public.event_seat_category_tickets TO authenticated;
GRANT ALL ON public.event_seat_category_tickets TO service_role;
ALTER TABLE public.event_seat_category_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_seat_category_tickets_staff_read" ON public.event_seat_category_tickets;
CREATE POLICY "event_seat_category_tickets_staff_read"
  ON public.event_seat_category_tickets FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

REVOKE ALL ON public.event_seat_sections FROM anon, authenticated;
GRANT SELECT ON public.event_seat_sections TO authenticated;
GRANT ALL ON public.event_seat_sections TO service_role;
ALTER TABLE public.event_seat_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_seat_sections_staff_read" ON public.event_seat_sections;
CREATE POLICY "event_seat_sections_staff_read"
  ON public.event_seat_sections FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

REVOKE ALL ON public.event_seats FROM anon, authenticated;
GRANT SELECT ON public.event_seats TO authenticated;
GRANT ALL ON public.event_seats TO service_role;
ALTER TABLE public.event_seats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_seats_staff_read" ON public.event_seats;
CREATE POLICY "event_seats_staff_read"
  ON public.event_seats FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

REVOKE ALL ON public.event_seat_assignments FROM anon, authenticated;
GRANT SELECT ON public.event_seat_assignments TO authenticated;
GRANT ALL ON public.event_seat_assignments TO service_role;
ALTER TABLE public.event_seat_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_seat_assignments_staff_read" ON public.event_seat_assignments;
CREATE POLICY "event_seat_assignments_staff_read"
  ON public.event_seat_assignments FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public._event_seat_row_label(p_scheme text, p_index integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer := p_index;
  v_out text := '';
BEGIN
  IF p_scheme = 'numeric' THEN
    RETURN p_index::text;
  END IF;
  WHILE v_n > 0 LOOP
    v_n := v_n - 1;
    v_out := chr(65 + (v_n % 26)) || v_out;
    v_n := v_n / 26;
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public._event_seat_row_label(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seat_row_label(text, integer) TO service_role;
COMMENT ON FUNCTION public._event_seat_row_label(text, integer) IS
  'Etykieta rzedu planu sali (alpha: A..Z, AA..; numeric: liczba). Lustro rowLabel() w src/lib/events/seatingGeometry.ts.';

CREATE OR REPLACE FUNCTION public._event_seat_label(
  p_section_label text,
  p_kind text,
  p_row_label text,
  p_seat_number integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_kind = 'rows' THEN p_section_label || ' / ' || COALESCE(p_row_label, '') || ' / ' || p_seat_number::text
    ELSE p_section_label || ' / ' || p_seat_number::text
  END
$$;
REVOKE ALL ON FUNCTION public._event_seat_label(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seat_label(text, text, text, integer) TO service_role;
COMMENT ON FUNCTION public._event_seat_label(text, text, text, integer) IS
  'Tekst miejsca do migawki przydzialu i eksportu CSV (sekcja / rzad / numer albo stol / numer). Interfejs sklada zdanie z i18n (seatLabel.ts), ta wersja jest dla historii i plikow.';

CREATE OR REPLACE FUNCTION public._event_seat_section_layout(
  p_kind text,
  p_rows integer,
  p_per_row integer,
  p_row_scheme text,
  p_row_start integer,
  p_numbering text,
  p_number_start integer,
  p_seat_pitch numeric,
  p_row_pitch numeric,
  p_aisles integer[],
  p_table_shape text,
  p_table_seats integer
)
RETURNS TABLE (row_label text, seat_number integer, x numeric, y numeric, sort_key integer)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_left integer;
  v_top integer;
  v_radius double precision;
BEGIN
  IF p_kind = 'rows' THEN
    v_left := (p_per_row + 1) / 2;
    RETURN QUERY
    SELECT
      public._event_seat_row_label(p_row_scheme, p_row_start + r.i),
      CASE p_numbering
        WHEN 'ltr' THEN p_number_start + s.i
        WHEN 'rtl' THEN p_number_start + (p_per_row - 1 - s.i)
        ELSE p_number_start - 1 + CASE
          WHEN s.i < v_left THEN 2 * (v_left - 1 - s.i) + 1
          ELSE 2 * (s.i - v_left + 1)
        END
      END,
      round(
        ((s.i + (SELECT count(*) FROM unnest(COALESCE(p_aisles, '{}'::integer[])) AS a(v) WHERE a.v <= s.i))
          * p_seat_pitch)::numeric,
        2
      ),
      round((r.i * p_row_pitch)::numeric, 2),
      r.i * 1000 + s.i
    FROM generate_series(0, p_rows - 1) AS r(i)
    CROSS JOIN generate_series(0, p_per_row - 1) AS s(i)
    ORDER BY r.i, s.i;
    RETURN;
  END IF;

  IF p_table_shape = 'round' THEN
    v_radius := greatest(
      p_seat_pitch::double precision,
      ceil(p_seat_pitch::double precision * p_table_seats / (2 * pi()))
    );
    RETURN QUERY
    SELECT
      NULL::text,
      p_number_start + s.i,
      round((v_radius * cos(-pi() / 2 + 2 * pi() * s.i / p_table_seats))::numeric, 2),
      round((v_radius * sin(-pi() / 2 + 2 * pi() * s.i / p_table_seats))::numeric, 2),
      s.i
    FROM generate_series(0, p_table_seats - 1) AS s(i)
    ORDER BY s.i;
    RETURN;
  END IF;

  v_top := (p_table_seats + 1) / 2;
  RETURN QUERY
  SELECT
    NULL::text,
    p_number_start + s.i,
    round((CASE WHEN s.i < v_top THEN s.i ELSE v_top - 1 - (s.i - v_top) END * p_seat_pitch)::numeric, 2),
    round((CASE WHEN s.i < v_top THEN 0 ELSE p_row_pitch END)::numeric, 2),
    s.i
  FROM generate_series(0, p_table_seats - 1) AS s(i)
  ORDER BY s.i;
END;
$$;
REVOKE ALL ON FUNCTION public._event_seat_section_layout(text, integer, integer, text, integer, text, integer, numeric, numeric, integer[], text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seat_section_layout(text, integer, integer, text, integer, text, integer, numeric, numeric, integer[], text, integer) TO service_role;
COMMENT ON FUNCTION public._event_seat_section_layout(text, integer, integer, text, integer, text, integer, numeric, numeric, integer[], text, integer) IS
  'Uklad lokalny miejsc sekcji planu sali z jej parametrow. Lustro generateSectionSeats() w src/lib/events/seatingGeometry.ts - zgodnosc pilnuje test parytetu na zlotym wzorcu z runtime_test.d/65_seating.sql.';

CREATE OR REPLACE FUNCTION public._tg_event_seat_assignment_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.released_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.seat_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.event_seat_maps m
       WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.map_id
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'seat_required: an active seat assignment must point at a seat';
  END IF;

  SELECT s.status INTO v_status
    FROM public.event_seats s
   WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.seat_id;
  IF v_status = 'blocked' THEN
    RAISE EXCEPTION 'seat_blocked: this seat is blocked';
  END IF;

  SELECT r.status INTO v_status
    FROM public.event_registrations r
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.registration_id
   FOR SHARE;
  IF v_status IS NULL OR v_status NOT IN ('approved', 'attended', 'no_show') THEN
    RAISE EXCEPTION 'registration_not_seatable: registration status % cannot hold a seat',
      COALESCE(v_status, '<none>');
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_seat_assignment_validate() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._tg_event_seat_assignment_validate() IS
  'Ostatnia linia obrony przydzialu miejsca: miejsce nie jest zablokowane, zgloszenie ma status zajmujacy miejsce (approved|attended|no_show), aktywny przydzial wskazuje miejsce.';

DROP TRIGGER IF EXISTS event_seat_assignments_validate ON public.event_seat_assignments;
CREATE TRIGGER event_seat_assignments_validate
  BEFORE INSERT OR UPDATE OF seat_id, registration_id, released_at ON public.event_seat_assignments
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_seat_assignment_validate();

CREATE OR REPLACE FUNCTION public._tg_event_seat_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'blocked' AND OLD.status IS DISTINCT FROM 'blocked' AND EXISTS (
      SELECT 1 FROM public.event_seat_assignments a
       WHERE a.tenant_id = NEW.tenant_id AND a.seat_id = NEW.id AND a.released_at IS NULL
    ) THEN
      RAISE EXCEPTION 'seat_assigned: release the attendee before blocking this seat';
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_seat_assignments a
     WHERE a.tenant_id = OLD.tenant_id AND a.seat_id = OLD.id AND a.released_at IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.event_seat_maps m
     WHERE m.tenant_id = OLD.tenant_id AND m.id = OLD.map_id
  ) THEN
    RAISE EXCEPTION 'seats_in_use: 1 assigned seat cannot be removed';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_seat_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._tg_event_seat_guard() IS
  'Straznik miejsca na sali: odrzuca usuniecie i zablokowanie miejsca z aktywnym przydzialem, dopoki istnieje jego plan.';

DROP TRIGGER IF EXISTS event_seats_guard ON public.event_seats;
CREATE TRIGGER event_seats_guard
  BEFORE UPDATE OF status OR DELETE ON public.event_seats
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_seat_guard();

CREATE OR REPLACE FUNCTION public._tg_event_registration_release_seats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_map uuid;
BEGIN
  FOR v_map IN
    UPDATE public.event_seat_assignments a
       SET released_at = now(),
           released_by = auth.uid(),
           release_reason = 'registration_status'
     WHERE a.tenant_id = NEW.tenant_id
       AND a.registration_id = NEW.id
       AND a.released_at IS NULL
    RETURNING a.map_id
  LOOP
    PERFORM public.emit_domain_event(
      NEW.tenant_id,
      'event_seat',
      v_map::text,
      'event_seat.released.v1',
      jsonb_build_object('event_id', NEW.event_id, 'map_id', v_map, 'count', 1,
                         'reason', 'registration_status'),
      auth.uid()
    );
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_registration_release_seats() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._tg_event_registration_release_seats() IS
  'Zwalnia miejsca na sali zgloszenia, ktore stracilo status zajmujacy miejsce (approved|attended|no_show). Jedno zdarzenie event_seat.released.v1 na plan.';

DROP TRIGGER IF EXISTS event_registrations_release_seats ON public.event_registrations;
CREATE TRIGGER event_registrations_release_seats
  AFTER UPDATE OF status ON public.event_registrations
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status NOT IN ('approved', 'attended', 'no_show'))
  EXECUTE FUNCTION public._tg_event_registration_release_seats();

CREATE OR REPLACE FUNCTION public._event_seat_assign_problem(
  p_tenant uuid,
  p_map uuid,
  p_seat uuid,
  p_registration uuid,
  p_force boolean
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seat record;
  v_reg record;
  v_category uuid;
  v_ok boolean;
BEGIN
  SELECT s.id, s.event_id, s.status, s.category_id, s.hold_company_id, s.hold_sponsor_id,
         s.hold_package_order_id, sc.category_id AS section_category_id
    INTO v_seat
    FROM public.event_seats s
    JOIN public.event_seat_sections sc ON sc.tenant_id = s.tenant_id AND sc.id = s.section_id
   WHERE s.tenant_id = p_tenant AND s.id = p_seat AND s.map_id = p_map;
  IF v_seat.id IS NULL THEN
    RETURN 'seat_not_found';
  END IF;
  IF v_seat.status = 'blocked' THEN
    RETURN 'seat_blocked';
  END IF;

  SELECT r.id, r.status, r.ticket_type_id, p.company_id INTO v_reg
    FROM public.event_registrations r
    JOIN public.event_people p ON p.tenant_id = r.tenant_id AND p.id = r.person_id
   WHERE r.tenant_id = p_tenant AND r.id = p_registration AND r.event_id = v_seat.event_id;
  IF v_reg.id IS NULL THEN
    RETURN 'registration_not_found';
  END IF;
  IF v_reg.status NOT IN ('approved', 'attended', 'no_show') THEN
    RETURN 'registration_not_seatable';
  END IF;

  IF p_force THEN
    RETURN NULL;
  END IF;

  IF v_seat.status = 'held' THEN
    v_ok := (v_seat.hold_company_id IS NOT NULL AND v_reg.company_id = v_seat.hold_company_id)
      OR (v_seat.hold_sponsor_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.event_sponsors sp
             WHERE sp.tenant_id = p_tenant AND sp.id = v_seat.hold_sponsor_id
               AND sp.company_id = v_reg.company_id))
      OR (v_seat.hold_package_order_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.event_package_seats ps
             WHERE ps.tenant_id = p_tenant AND ps.package_order_id = v_seat.hold_package_order_id
               AND ps.registration_id = v_reg.id AND ps.revoked_at IS NULL));
    IF NOT COALESCE(v_ok, false) THEN
      RETURN 'seat_held_for_other';
    END IF;
  END IF;

  v_category := COALESCE(v_seat.category_id, v_seat.section_category_id);
  IF v_category IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.event_seat_category_tickets ct
                  WHERE ct.tenant_id = p_tenant AND ct.category_id = v_category)
     AND NOT EXISTS (SELECT 1 FROM public.event_seat_category_tickets ct
                      WHERE ct.tenant_id = p_tenant AND ct.category_id = v_category
                        AND ct.ticket_type_id = v_reg.ticket_type_id)
  THEN
    RETURN 'category_ticket_mismatch';
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._event_seat_assign_problem(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seat_assign_problem(uuid, uuid, uuid, uuid, boolean) TO service_role;
COMMENT ON FUNCTION public._event_seat_assign_problem(uuid, uuid, uuid, uuid, boolean) IS
  'Reguly przydzialu miejsca na sali (blokada, status zgloszenia, rezerwacja firmy/sponsora/pakietu, kategoria vs bilet). NULL = wolno; inaczej kod odmowy. Wolaja admin_event_seat_assign i _assign_batch pod blokada planu.';

CREATE OR REPLACE FUNCTION public.admin_event_seat_maps_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name text,
  room_id uuid,
  room_name text,
  session_id uuid,
  session_title_pl text,
  session_title_en text,
  status text,
  width integer,
  height integer,
  stage_x numeric,
  stage_y numeric,
  stage_w numeric,
  stage_h numeric,
  sort_order integer,
  published_at timestamptz,
  sections_count integer,
  seats_total integer,
  seats_blocked integer,
  seats_held integer,
  seats_assigned integer,
  seatable_registrations integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_seatable integer;
BEGIN
  SELECT count(*)::integer INTO v_seatable
    FROM public.event_registrations r
   WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
     AND r.status IN ('approved', 'attended', 'no_show');

  RETURN QUERY
  SELECT
    m.id, m.event_id, m.name, m.room_id, ro.name, m.session_id, se.title_pl, se.title_en,
    m.status, m.width, m.height, m.stage_x, m.stage_y, m.stage_w, m.stage_h, m.sort_order, m.published_at,
    (SELECT count(*)::integer FROM public.event_seat_sections sc
      WHERE sc.tenant_id = v_tenant AND sc.map_id = m.id),
    COALESCE(st.total, 0), COALESCE(st.blocked, 0), COALESCE(st.held, 0),
    (SELECT count(*)::integer FROM public.event_seat_assignments a
      WHERE a.tenant_id = v_tenant AND a.map_id = m.id AND a.released_at IS NULL
        AND a.seat_id IS NOT NULL),
    v_seatable,
    m.created_at, m.updated_at
  FROM public.event_seat_maps m
  LEFT JOIN public.event_rooms ro ON ro.tenant_id = m.tenant_id AND ro.id = m.room_id
  LEFT JOIN public.event_sessions se ON se.tenant_id = m.tenant_id AND se.id = m.session_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS total,
           count(*) FILTER (WHERE s.status = 'blocked')::integer AS blocked,
           count(*) FILTER (WHERE s.status = 'held')::integer AS held
      FROM public.event_seats s
     WHERE s.tenant_id = v_tenant AND s.map_id = m.id
  ) st ON true
  WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id
  ORDER BY m.sort_order, m.name, m.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_seat_maps_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_seat_maps_list(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_seat_maps_list(uuid) IS
  'Plany sali wydarzenia z licznikami (sekcje, miejsca, zablokowane, zarezerwowane, zajete) i liczba zgloszen uprawnionych do miejsca. Bramka: assert_event_admin_tenant().';