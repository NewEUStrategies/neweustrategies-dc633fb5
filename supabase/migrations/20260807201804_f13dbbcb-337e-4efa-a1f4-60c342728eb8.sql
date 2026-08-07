CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_suppress_actor boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_aggregate_type IS NULL OR p_aggregate_id IS NULL
     OR p_event_type IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.domain_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload,
    correlation_id, actor_id
  ) VALUES (
    p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    public.request_correlation_id(),
    CASE WHEN p_suppress_actor THEN NULL ELSE COALESCE(p_actor_id, auth.uid()) END
  )
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, boolean, uuid)
  TO service_role;

DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb, boolean);
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb);

COMMENT ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, boolean, uuid) IS
  'JEDYNY emiter szyny zdarzen - jedna funkcja, dwa opcjonalne parametry. Przeciazenie tej nazwy jest awaria: wszystkie wywolania podaja piec argumentow, wiec drugi wariant z domyslnym szostym czyni kazde z nich niejednoznacznym (42725).';