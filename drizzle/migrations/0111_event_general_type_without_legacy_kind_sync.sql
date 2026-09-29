CREATE OR REPLACE FUNCTION public.admin_event_general_save_v2(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid;
  v_type_id uuid;
BEGIN
  v_id := public.admin_event_general_save(p_payload);

  IF p_payload ? 'event_type_id' THEN
    v_type_id := NULLIF(btrim(COALESCE(p_payload->>'event_type_id', '')), '')::uuid;
    IF v_type_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.event_types et
      WHERE et.id = v_type_id AND et.tenant_id = v_tenant AND et.is_active
    ) THEN
      RAISE EXCEPTION 'invalid_event_type: choose an active event type';
    END IF;
  END IF;

  UPDATE public.events e SET
    subtitle_pl = CASE WHEN p_payload ? 'subtitle_pl'
      THEN NULLIF(btrim(COALESCE(p_payload->>'subtitle_pl', '')), '') ELSE e.subtitle_pl END,
    subtitle_en = CASE WHEN p_payload ? 'subtitle_en'
      THEN NULLIF(btrim(COALESCE(p_payload->>'subtitle_en', '')), '') ELSE e.subtitle_en END,
    event_type_id = CASE WHEN p_payload ? 'event_type_id' THEN v_type_id ELSE e.event_type_id END,
    updated_at = now()
  WHERE e.id = v_id AND e.tenant_id = v_tenant;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_general_save_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_general_save_v2(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_general_save_v2(jsonb) IS
  'Atomowy zapis informacji ogolnych wydarzenia, rozszerzony o podtytuly PL/EN oraz aktywny rodzaj wydarzenia. Pole legacy kind pozostaje niezalezne.';