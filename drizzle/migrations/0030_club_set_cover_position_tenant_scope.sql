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
GRANT EXECUTE ON FUNCTION public.club_set_cover_position(uuid, smallint) TO authenticated;