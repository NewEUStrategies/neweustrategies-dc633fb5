-- Plan sali z przydzialem miejsc (f4): event_seat_maps/_categories/_category_tickets/
-- _sections, event_seats, event_seat_assignments + RPC panelu i uczestnika.
-- Blizniak: supabase/migrations/20260926130000_event_seating.sql.

-- ----------------------------------------------------------------------------
-- 1. PLAN SALI
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 2. KATEGORIE MIEJSC (wspolne dla wszystkich planow wydarzenia)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3. SEKCJE (parametryczne)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 4. MIEJSCA (zmaterializowane, wspolrzedne lokalne sekcji)
-- ----------------------------------------------------------------------------
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
  -- Tylko kierunek "nie-held => bez posiadacza". Odwrotny ("held => ktos
  -- trzyma") zablokowalby usuniecie firmy w CRM: ON DELETE SET NULL
  -- (hold_company_id) naruszylby taki CHECK.
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

-- ----------------------------------------------------------------------------
-- 5. PRZYDZIALY (miekkie zwolnienie = historia)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 6. STEMPEL updated_at
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 7. GRANTY I RLS (tylko odczyt admina / super_admina najemcy)
-- ----------------------------------------------------------------------------
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
-- Zapis: BRAK polityk klienckich na wszystkich szesciu tabelach.

-- ----------------------------------------------------------------------------
-- 8. GEOMETRIA I ETYKIETY (lustro src/lib/events/seatingGeometry.ts)
-- ----------------------------------------------------------------------------

-- Etykieta rzedu: `alpha` = A..Z, AA..AZ, ... (bijektywna podstawa 26),
-- `numeric` = numer. Indeks liczony od 1.
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

-- Etykieta miejsca do migawki przydzialu i eksportu: "A / 3 / 12" albo "Stol 5 / 3".
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

-- Uklad LOKALNY miejsc sekcji. Formula 1:1 z `generateSectionSeats()`:
--   rzedy: x = (p + przejscia przed p) * seat_pitch, y = r * row_pitch,
--          sort_key = r * 1000 + p; numeracja ltr | rtl | odd_even (od srodka:
--          nieparzyste w lewo, parzyste w prawo);
--   stol okragly: promien = max(seat_pitch, ceil(seat_pitch * n / 2pi)),
--          miejsce i pod katem -90 + 360 * i / n stopni (start u gory,
--          zgodnie z ruchem wskazowek);
--   stol prostokatny: gorna krawedz ceil(n/2) miejsc od lewej, dolna reszta od
--          prawej (obieg zgodny z ruchem wskazowek), y = 0 albo row_pitch.
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

-- ----------------------------------------------------------------------------
-- 9. TRIGGERY OCHRONNE
-- ----------------------------------------------------------------------------

-- Walidacja AKTYWNEGO przydzialu - dziedziczy ja kazda sciezka zapisu.
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
    -- ON DELETE SET NULL (seat_id) w trakcie kasowania CALEGO planu (albo
    -- wydarzenia): planu juz nie ma, wiersz zniknie kaskada za chwile.
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

  -- FOR SHARE: rownolegla zmiana statusu zgloszenia (rezygnacja) czeka albo
  -- na nas, albo my na nia - i wtedy czytamy stan PO zmianie.
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

-- Miejsce z aktywnym przydzialem: nie da sie go usunac ani zablokowac, dopoki
-- istnieje plan (kaskada z usuniecia planu / wydarzenia przechodzi).
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

-- Zgloszenie traci status zajmujacy miejsce -> miejsca wracaja do puli.
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

-- ----------------------------------------------------------------------------
-- 10. REGULY PRZYDZIALU (wspolne dla pojedynczego i zbiorczego)
-- ----------------------------------------------------------------------------
-- Zwraca NULL, gdy zgloszenie moze usiasc na miejscu, albo kod odmowy:
-- seat_not_found | seat_blocked | registration_not_found |
-- registration_not_seatable | seat_held_for_other | category_ticket_mismatch.
-- NIE sprawdza zajetosci (to robi wolajacy pod blokada planu).
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

-- ----------------------------------------------------------------------------
-- 11. PANEL: PLANY
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 12. PANEL: KATEGORIE
-- ----------------------------------------------------------------------------
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
    -- Klucz jest NIEZMIENNY (jak klucz sciezki agendy) - edycja go ignoruje.
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

-- ----------------------------------------------------------------------------
-- 13. PANEL: SEKCJE (regeneracja miejsc po kluczu naturalnym)
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

-- ----------------------------------------------------------------------------
-- 14. PANEL: STATUS, REZERWACJE I WLASCIWOSCI MIEJSC
-- ----------------------------------------------------------------------------
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

  -- CRM: rezerwacja dla firmy (wprost, przez sponsora albo zamowienie
  -- pakietowe) trafia na os czasu firmy. Tenant zawsze jawny.
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
