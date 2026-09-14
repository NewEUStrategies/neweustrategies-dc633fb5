WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY requester_id, bridge_id, target_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM public.introduction_requests
   WHERE status = 'pending'
)
UPDATE public.introduction_requests i
   SET status = 'withdrawn', updated_at = now()
  FROM ranked r
 WHERE i.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS introduction_requests_active_uidx
  ON public.introduction_requests (requester_id, bridge_id, target_id)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.request_introduction(
  p_bridge UUID, p_target UUID, p_message TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID; v_id UUID; v_target_discoverable BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public._are_connected(auth.uid(), p_bridge) THEN
    RAISE EXCEPTION 'not connected to bridge'; END IF;
  IF NOT public._are_connected(p_bridge, p_target) THEN
    RAISE EXCEPTION 'bridge not connected to target'; END IF;
  IF public._are_connected(auth.uid(), p_target) THEN
    RAISE EXCEPTION 'already connected to target'; END IF;

  SELECT discoverable INTO v_target_discoverable
    FROM public.profiles WHERE id = p_target;
  IF public.is_blocked_pair(auth.uid(), p_target)
     OR NOT COALESCE(v_target_discoverable, false)
     OR NOT public.connections_allowed_from(p_target, auth.uid()) THEN
    RAISE EXCEPTION 'connections: peer not available';
  END IF;

  SELECT id INTO v_id FROM public.introduction_requests
   WHERE requester_id = auth.uid() AND bridge_id = p_bridge
     AND target_id = p_target AND status = 'pending';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  IF (SELECT COUNT(*) FROM public.introduction_requests
       WHERE requester_id = auth.uid() AND status = 'pending'
         AND created_at > now() - INTERVAL '24 hours') >= 5 THEN
    RAISE EXCEPTION 'rate limited'; END IF;

  v_tenant := public._caller_tenant();
  BEGIN
    INSERT INTO public.introduction_requests
      (tenant_id, requester_id, bridge_id, target_id, message)
    VALUES (v_tenant, auth.uid(), p_bridge, p_target, p_message)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.introduction_requests
     WHERE requester_id = auth.uid() AND bridge_id = p_bridge
       AND target_id = p_target AND status = 'pending';
  END;
  RETURN v_id;
END; $$;

COMMENT ON INDEX public.introduction_requests_active_uidx IS
  'Jedna AKTYWNA prośba na trójkę (requester, bridge, target). Częściowy, bo prośba odrzucona/wycofana/przekazana ma prawo zostać ponowiona. Do 20260913171000 deduplikacja istniała wyłącznie w komentarzu i w kliencie.';