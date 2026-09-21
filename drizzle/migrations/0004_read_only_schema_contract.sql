CREATE OR REPLACE FUNCTION public.missing_schema_objects(_objects jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_missing jsonb;
BEGIN
  IF _objects IS NULL OR jsonb_typeof(_objects) <> 'array' THEN
    RAISE EXCEPTION 'contract: expected an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_objects) > 100 THEN
    RAISE EXCEPTION 'contract: maximum 100 objects per request' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_objects) o
    WHERE jsonb_typeof(o) <> 'object'
      OR (o->>'kind') IS NULL OR (o->>'kind') NOT IN ('table', 'view', 'function')
      OR (o->>'name') IS NULL OR (o->>'name') !~ '^[a-z_][a-z0-9_]*$'
  ) THEN
    RAISE EXCEPTION 'contract: invalid public object' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(o ORDER BY o->>'kind', o->>'name'), '[]'::jsonb)
  INTO v_missing
  FROM (SELECT DISTINCT jsonb_build_object('kind', x->>'kind', 'name', x->>'name') o
        FROM jsonb_array_elements(_objects) x) requested
  WHERE CASE o->>'kind'
    WHEN 'function' THEN NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = o->>'name' AND p.prokind = 'f'
        AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
    )
    ELSE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = o->>'name'
        AND CASE o->>'kind' WHEN 'table' THEN c.relkind IN ('r', 'p')
                          ELSE c.relkind IN ('v', 'm') END
    ) END;
  RETURN v_missing;
END;
$$;
REVOKE ALL ON FUNCTION public.missing_schema_objects(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.missing_schema_objects(jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.missing_schema_objects(jsonb) IS
  'Fundacja New European Strategies: read-only CI schema contract; no application RPC execution.';