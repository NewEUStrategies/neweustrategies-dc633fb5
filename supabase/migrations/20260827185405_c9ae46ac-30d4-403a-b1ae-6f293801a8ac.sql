-- Wsadowe powiazanie sesji ze sciezka programu (takze odpiecie: track_id = null).
--
-- DLACZEGO OSOBNY RPC. Zapis pojedynczej sesji (`admin_event_session_save`)
-- wymaga pelnego payloadu i jednego wywolania na sesje. Organizator ukladajacy
-- pasmo przypina kilkanascie sesji naraz - kazde osobne wywolanie moglo by sie
-- nie udac osobno i zostawic pasmo w polowie zlozone.
DROP FUNCTION IF EXISTS public.admin_event_sessions_set_track(jsonb);
CREATE FUNCTION public.admin_event_sessions_set_track(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_track_id uuid := NULLIF(p_payload->>'track_id', '')::uuid;
  v_track_event uuid;
  v_ids uuid[];
  v_changed integer := 0;
BEGIN
  IF jsonb_typeof(p_payload->'ids') <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: ids must be an array of session ids';
  END IF;

  SELECT array_agg((x)::uuid) INTO v_ids
  FROM jsonb_array_elements_text(p_payload->'ids') AS x
  WHERE NULLIF(x, '') IS NOT NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF v_track_id IS NOT NULL THEN
    SELECT t.event_id INTO v_track_event
    FROM public.event_tracks t
    WHERE t.id = v_track_id AND t.tenant_id = v_tenant;

    IF v_track_event IS NULL THEN
      RAISE EXCEPTION 'track_not_found: track does not belong to this organisation';
    END IF;

    -- Sciezka nalezy do jednego wydarzenia; sesja z innego wydarzenia nie moze
    -- do niej trafic, bo publiczna agenda pokazalaby obce pasmo.
    IF EXISTS (
      SELECT 1 FROM public.event_sessions s
      WHERE s.id = ANY (v_ids) AND s.tenant_id = v_tenant AND s.event_id <> v_track_event
    ) THEN
      RAISE EXCEPTION 'track_not_found: track belongs to a different event';
    END IF;
  END IF;

  WITH updated AS (
    UPDATE public.event_sessions s
    SET track_id = v_track_id
    WHERE s.tenant_id = v_tenant
      AND s.id = ANY (v_ids)
      AND s.track_id IS DISTINCT FROM v_track_id
    RETURNING s.id
  )
  SELECT count(*)::integer INTO v_changed FROM updated;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sessions_set_track(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sessions_set_track(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sessions_set_track(jsonb) IS
  'Wsadowe przypisanie sesji do sciezki: {"ids":[uuid],"track_id":uuid|null}. null odpina sesje od sciezki. Odrzuca sciezke z innego wydarzenia. Bramka: assert_editor_tenant().';