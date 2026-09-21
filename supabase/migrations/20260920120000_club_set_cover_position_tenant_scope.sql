-- Bliźniak pasa drizzle `0029_club_set_cover_position_tenant_scope`.
--
-- ZAPIS KADROWANIA OKŁADKI KLUBU BYŁ MIĘDZYNAJEMCOWY.
--
-- `club_set_cover_position` (0028) czytała klub przez `WHERE id = p_club_id`
-- BEZ warunku na najemcę i tak samo go zapisywała. Bramka uprawnień wyglądała
-- na szczelną, ale jej druga gałąź `has_role(v_uid, 'admin')` sprawdza rolę
-- w tenancie WOŁAJĄCEGO (`ur.tenant_id = current_tenant_id()`), a nie w
-- tenancie klubu. Admin najemcy A podający UUID klubu najemcy B przechodził
-- więc tak: `club_capabilities` oddawało `can_moderate = false` (nie jest
-- członkiem), po czym `has_role` oddawało TRUE, bo adminem jest u siebie -
-- i `UPDATE` zmieniał cudzy wiersz. Cicho, bo kadrowanie nie daje sygnału
-- w interfejsie ofiary.
--
-- Poprawka jest tym, co siostrzana `club_update_settings` robi w tym samym
-- pliku od początku: najemca jest ustalany raz (`current_tenant_id()`),
-- istnienie klubu sprawdzane W JEGO GRANICACH (klub z cudzego najemcy wygląda
-- na nieistniejący, więc funkcja nie potwierdza nawet UUID-a), a `UPDATE` ma
-- ten sam warunek. `GET DIAGNOSTICS` domyka wyścig: gdyby wiersz zniknął
-- między sprawdzeniem a zapisem, funkcja zgłasza brak zamiast zwracać sukces
-- po zerowej aktualizacji.
--
-- Forward-only: 0028 zostaje nietknięte w obu pasach, bo jest już zastosowane.

DROP FUNCTION IF EXISTS public.club_set_cover_position(uuid, smallint);
CREATE OR REPLACE FUNCTION public.club_set_cover_position(p_club_id uuid, p_position_y smallint)
 RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id(); v_caps record; v_val smallint; v_hit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF NOT COALESCE(v_caps.can_moderate, false) AND NOT public.has_role(v_uid, 'admin'::app_role) THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  v_val := GREATEST(0::smallint, LEAST(100::smallint, COALESCE(p_position_y, 50)::smallint));
  UPDATE public.clubs c SET cover_position_y = v_val WHERE c.id = p_club_id AND c.tenant_id = v_tenant;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  RETURN v_val;
END;
$function$;
