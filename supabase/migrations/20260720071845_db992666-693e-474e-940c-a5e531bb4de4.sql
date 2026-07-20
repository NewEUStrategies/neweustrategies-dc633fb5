-- Brute-force hardening: atomic rate limit RPC + paywall per-IP bucket
-- ---------------------------------------------------------------------
-- 1) Atomic hit-counter (INSERT ... ON CONFLICT DO UPDATE RETURNING) so
--    concurrent callers cannot slip past the cap via a select/update race.
--    Callable by anon+authenticated so unauthenticated pre-auth guards can
--    burn attempts before Supabase Auth ever sees the credentials.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  _scope text,
  _subject text,
  _max integer,
  _window_minutes integer DEFAULT 1
)
RETURNS TABLE(allowed boolean, hits integer, window_start timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_minutes integer := GREATEST(1, COALESCE(_window_minutes, 1));
  v_bucket_seconds integer := v_window_minutes * 60;
  v_start timestamptz := to_timestamp(
    (floor(extract(epoch FROM now()) / v_bucket_seconds) * v_bucket_seconds)::double precision
  );
  v_count integer;
BEGIN
  IF _scope IS NULL OR length(_scope) = 0 OR _subject IS NULL OR length(_subject) = 0 THEN
    RAISE EXCEPTION 'rate_limit_hit: scope/subject required';
  END IF;

  INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
  VALUES (_scope, _subject, v_start, 1)
  ON CONFLICT (scope, subject_id, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING public.rate_limits.count INTO v_count;

  RETURN QUERY SELECT (v_count <= GREATEST(1, _max)), v_count, v_start;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, text, integer, integer)
  TO anon, authenticated, service_role;

-- 2) Paywall password: extend verifier with optional per-IP bucket so a slow
--    password (14k/day per entity) is throttled per attacker too. Signature
--    changes -> drop + create.
DROP FUNCTION IF EXISTS public.verify_content_password(public.access_entity_type, uuid, text);
DROP FUNCTION IF EXISTS public.verify_content_password(public.access_entity_type, uuid, text, text);

CREATE OR REPLACE FUNCTION public.verify_content_password(
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _password text,
  _ip_hash text DEFAULT NULL
)
RETURNS TABLE(
  ok boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
  v_mode public.access_mode;
  v_tenant uuid := public.public_tenant_id();
  v_attempts integer;
  v_ip_attempts integer;
BEGIN
  -- Per-entity bucket (existing behaviour, still atomic).
  INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
  VALUES ('content_password', 'pwd:' || _entity_id::text, date_trunc('minute', now()), 1)
  ON CONFLICT (scope, subject_id, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_attempts;

  IF v_attempts > 10 THEN
    RAISE EXCEPTION 'content_password: too many attempts';
  END IF;

  -- Per-IP bucket (new): 20 attempts / 5 minutes across ALL gated content,
  -- so a distributed dictionary attack cannot spread over many entities.
  IF _ip_hash IS NOT NULL AND length(_ip_hash) > 0 THEN
    INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
    VALUES (
      'content_password_ip',
      'ip:' || _ip_hash,
      to_timestamp((floor(extract(epoch FROM now()) / 300) * 300)::double precision),
      1
    )
    ON CONFLICT (scope, subject_id, window_start)
    DO UPDATE SET count = public.rate_limits.count + 1
    RETURNING count INTO v_ip_attempts;

    IF v_ip_attempts > 20 THEN
      RAISE EXCEPTION 'content_password: too many attempts (ip)';
    END IF;
  END IF;

  SELECT mode, password_hash INTO v_mode, v_hash
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode::text <> 'password' OR v_hash IS NULL OR _password IS NULL OR length(_password) = 0 THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF public.crypt(_password, v_hash) <> v_hash THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF _entity_type = 'post' THEN
    RETURN QUERY
      SELECT true, p.content_pl, p.content_en, p.builder_data, p.blocks_data
        FROM public.posts p
       WHERE p.id = _entity_id
         AND p.tenant_id = v_tenant
         AND p.status = 'published'
         AND p.deleted_at IS NULL;
  ELSIF _entity_type = 'page' THEN
    RETURN QUERY
      SELECT true, pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
        FROM public.pages pg
       WHERE pg.id = _entity_id
         AND pg.tenant_id = v_tenant
         AND pg.status = 'published'
         AND pg.deleted_at IS NULL;
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_content_password(public.access_entity_type, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_content_password(public.access_entity_type, uuid, text, text)
  TO anon, authenticated, service_role;