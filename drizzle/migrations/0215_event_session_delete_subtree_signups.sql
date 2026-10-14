CREATE OR REPLACE FUNCTION public.admin_event_session_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_signups integer;
  v_checkpoints integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_sessions s WHERE s.id = _id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: session does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_signups
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.status <> 'cancelled'
    AND g.session_id IN (
      SELECT s.id
      FROM public.event_sessions s
      WHERE s.tenant_id = v_tenant
        AND (s.id = _id OR s.parent_session_id = _id)
    );

  IF v_signups > 0 THEN
    RAISE EXCEPTION 'session_has_signups: % active signup(s) on this session or its sub-sessions - cancel the session instead', v_signups;
  END IF;

  SELECT count(*)::integer INTO v_checkpoints
  FROM public.event_checkpoints c
  WHERE c.tenant_id = v_tenant
    AND c.session_id IN (
      SELECT s.id
      FROM public.event_sessions s
      WHERE s.tenant_id = v_tenant
        AND (s.id = _id OR s.parent_session_id = _id)
    );

  IF v_checkpoints > 0 THEN
    RAISE EXCEPTION 'session_has_checkpoints: % checkpoint(s) are bound to this session or its sub-sessions - change their kind or delete them first', v_checkpoints;
  END IF;

  DELETE FROM public.event_sessions WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_event_session_delete(uuid) IS
  'Usuwa sesje bez aktywnych zapisow i bez punktow odprawy w calym poddrzewie (razem z jej podsesjami i obsada - kaskada). Aktywny zapis na sesji lub jej podsesji wymaga odwolania (session_has_signups, 20261013112600); punkt odprawy sesji lub podsesji trzeba najpierw zmienic albo usunac (session_has_checkpoints).';