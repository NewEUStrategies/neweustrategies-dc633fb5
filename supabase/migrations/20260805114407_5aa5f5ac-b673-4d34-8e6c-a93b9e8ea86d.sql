DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgcrypto unavailable: % - host assertions will stay unverified', SQLERRM;
  END;
END $$;

CREATE TABLE IF NOT EXISTS public.tenant_host_assertion_keys (
  kid text PRIMARY KEY CHECK (kid ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  secret_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CONSTRAINT tenant_host_assertion_keys_retired_shape_chk
    CHECK (active OR retired_at IS NOT NULL)
);

COMMENT ON TABLE public.tenant_host_assertion_keys IS
  'Rejestr kluczy podpisujących poświadczenia hosta (x-tenant-assert). Materiał klucza leży w Vault (secret_id); tabela trzyma wyłącznie metadane i stan rotacji.';

ALTER TABLE public.tenant_host_assertion_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_host_assertion_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tenant_host_assertion_keys TO service_role;

CREATE OR REPLACE FUNCTION public.set_tenant_host_assertion_key(p_kid text, p_secret text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kid text := lower(btrim(COALESCE(p_kid, '')));
  v_secret text := btrim(COALESCE(p_secret, ''));
  v_existing uuid;
BEGIN
  IF v_kid !~ '^[a-z0-9][a-z0-9_-]{1,31}$' THEN
    RAISE EXCEPTION 'tenant host assertion: invalid kid';
  END IF;
  IF length(v_secret) < 32 THEN
    RAISE EXCEPTION 'tenant host assertion: secret too short (min 32 chars)';
  END IF;
  SELECT k.secret_id INTO v_existing
    FROM public.tenant_host_assertion_keys k WHERE k.kid = v_kid;
  IF v_existing IS NULL THEN
    INSERT INTO public.tenant_host_assertion_keys (kid, secret_id)
    VALUES (v_kid, vault.create_secret(v_secret, 'tenant_host_assertion:' || v_kid))
    ON CONFLICT (kid) DO NOTHING;
  ELSE
    PERFORM vault.update_secret(v_existing, v_secret);
    UPDATE public.tenant_host_assertion_keys
       SET active = true, retired_at = NULL
     WHERE kid = v_kid;
  END IF;
  RETURN v_kid;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_tenant_host_assertion_key(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_host_assertion_key(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.retire_tenant_host_assertion_key(p_kid text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_done boolean := false;
BEGIN
  UPDATE public.tenant_host_assertion_keys
     SET active = false, retired_at = COALESCE(retired_at, now())
   WHERE kid = lower(btrim(COALESCE(p_kid, '')))
  RETURNING true INTO v_done;
  RETURN COALESCE(v_done, false);
END $$;

REVOKE EXECUTE ON FUNCTION public.retire_tenant_host_assertion_key(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_tenant_host_assertion_key(text) TO service_role;

CREATE OR REPLACE FUNCTION public.normalize_public_host(p_raw text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  WITH raw AS (SELECT lower(btrim(COALESCE(p_raw, ''))) AS h)
  SELECT CASE
           WHEN h = '' THEN NULL
           WHEN h ~ '^\[' THEN (regexp_match(h, '^\[([^\]]+)\]'))[1]
           ELSE nullif(split_part(h, ':', 1), '')
         END
    FROM raw
$$;

GRANT EXECUTE ON FUNCTION public.normalize_public_host(text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tenant_id_for_public_host(p_host text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH req AS (SELECT public.normalize_public_host(p_host) AS host)
  SELECT t.id
    FROM public.tenants t, req r
   WHERE r.host IS NOT NULL
     AND (
       lower(t.domain) IN (
         r.host,
         CASE WHEN r.host LIKE 'www.%' THEN substr(r.host, 5)
              ELSE 'www.' || r.host END
       )
       OR r.host = ANY (ARRAY(SELECT lower(a) FROM unnest(t.aliases) a))
     )
   ORDER BY (lower(t.domain) = r.host) DESC
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.tenant_id_for_public_host(text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.b64url_decode(p_value text)
RETURNS bytea
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v text := rtrim(translate(COALESCE(p_value, ''), '-_', '+/'), '=');
BEGIN
  IF v = '' OR v !~ '^[A-Za-z0-9+/]+$' THEN
    RETURN NULL;
  END IF;
  v := v || repeat('=', (4 - (length(v) % 4)) % 4);
  RETURN decode(v, 'base64');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.b64url_decode(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.b64url_encode(p_value bytea)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT rtrim(translate(replace(encode(p_value, 'base64'), E'\n', ''), '+/', '-_'), '=')
$$;

GRANT EXECUTE ON FUNCTION public.b64url_encode(bytea) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verify_tenant_host_assertion(p_raw text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_parts text[];
  v_kid text;
  v_host text;
  v_exp bigint;
  v_secret text;
  v_expected text;
  v_given text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN NULL; END IF;
  IF length(p_raw) > 512 THEN RETURN NULL; END IF;
  v_parts := string_to_array(btrim(p_raw), '.');
  IF array_length(v_parts, 1) <> 5 OR v_parts[1] <> 'v1' THEN RETURN NULL; END IF;
  v_kid := lower(v_parts[2]);
  IF v_kid !~ '^[a-z0-9][a-z0-9_-]{1,31}$' THEN RETURN NULL; END IF;
  IF v_parts[4] !~ '^[0-9]{1,15}$' THEN RETURN NULL; END IF;
  v_exp := v_parts[4]::bigint;
  IF to_timestamp(v_exp) <= now() THEN RETURN NULL; END IF;
  v_host := public.normalize_public_host(
    convert_from(public.b64url_decode(v_parts[3]), 'utf8')
  );
  IF v_host IS NULL THEN RETURN NULL; END IF;
  SELECT ds.decrypted_secret::text INTO v_secret
    FROM public.tenant_host_assertion_keys k
    JOIN vault.decrypted_secrets ds ON ds.id = k.secret_id
   WHERE k.kid = v_kid AND k.active;
  IF v_secret IS NULL OR v_secret = '' THEN RETURN NULL; END IF;
  v_expected := public.b64url_encode(
    hmac('v1:' || v_kid || ':' || v_host || ':' || v_parts[4], v_secret, 'sha256')
  );
  v_given := rtrim(translate(v_parts[5], '+/', '-_'), '=');
  IF sha256(convert_to(v_expected, 'utf8')) <> sha256(convert_to(v_given, 'utf8')) THEN
    RETURN NULL;
  END IF;
  RETURN v_host;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.verify_tenant_host_assertion(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_tenant_host_assertion(text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_asserted_host()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.normalize_public_host(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-host'
  )
$$;

GRANT EXECUTE ON FUNCTION public.request_asserted_host()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_verified_host()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.verify_tenant_host_assertion(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-assert'
  )
$$;

GRANT EXECUTE ON FUNCTION public.request_verified_host()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_public_host_trust()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN public.request_verified_host() IS NOT NULL THEN 'verified'
           WHEN public.request_asserted_host() IS NOT NULL THEN 'asserted'
           ELSE 'none'
         END
$$;

GRANT EXECUTE ON FUNCTION public.request_public_host_trust()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_public_host()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    public.request_verified_host(),
    (SELECT h.host
       FROM (SELECT public.request_asserted_host() AS host) h
      WHERE h.host IS NOT NULL
        AND public.tenant_id_for_public_host(h.host) IS NOT NULL)
  )
$$;

REVOKE ALL ON FUNCTION public.request_public_host() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_public_host()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_tenant_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified text := public.request_verified_host();
  v_tenant uuid;
  v_home uuid;
BEGIN
  IF v_verified IS NOT NULL THEN
    v_tenant := public.tenant_id_for_public_host(v_verified);
  ELSE
    v_tenant := public.tenant_id_for_public_host(public.request_asserted_host());
  END IF;

  IF v_verified IS NULL AND auth.uid() IS NOT NULL THEN
    v_home := public.current_tenant_id();
    IF v_home IS NOT NULL AND v_tenant IS DISTINCT FROM v_home THEN
      RETURN v_home;
    END IF;
  END IF;

  RETURN COALESCE(
    v_tenant,
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
  );
END $$;

REVOKE ALL ON FUNCTION public.public_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tenant_id()
  TO anon, authenticated, service_role;

UPDATE public.tenants t
   SET domain = 'neweuropeanstrategies.com',
       aliases = ARRAY(
         SELECT DISTINCT a
           FROM unnest(t.aliases || ARRAY['localhost', '127.0.0.1']) a
          WHERE a NOT LIKE '%lovable%'
       )
 WHERE t.slug = 'nes'
   AND (t.domain IS NULL OR t.domain = '' OR t.domain LIKE '%lovable%')
   AND NOT EXISTS (
     SELECT 1 FROM public.tenants other
      WHERE other.id <> t.id
        AND lower(other.domain) = 'neweuropeanstrategies.com'
   );

UPDATE public.tenants
   SET aliases = ARRAY(SELECT a FROM unnest(aliases) a WHERE a NOT LIKE '%lovable%')
 WHERE EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a LIKE '%lovable%');