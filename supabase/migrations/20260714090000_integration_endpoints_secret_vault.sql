-- SECURITY: move integration_endpoints.secret (the HMAC signing key for the
-- outbound integration outbox) from a plaintext `text` column into Supabase
-- Vault, mirroring the Merydian secrets pattern (20260712140000). The plaintext
-- column was directly SELECT-able by any staff role (incl. the lowest, `author`)
-- via the `integration_endpoints_staff_all` FOR ALL policy.
--
-- After this migration the signing key lives only in vault.secrets; it is set
-- via integration_endpoint_set_secret() (admin/service-role) and read only by
-- integration_endpoint_get_secret() (service_role - the dispatcher runs as the
-- service role). Idempotent.

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.integration_endpoints
  ADD COLUMN IF NOT EXISTS secret_id uuid;

-- Backfill any existing plaintext secret into the vault, then drop the column.
-- (There is currently no admin UI to create endpoints, so this is typically a
-- no-op, but we handle pre-seeded rows correctly.)
DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'integration_endpoints' AND column_name = 'secret'
  ) THEN
    FOR r IN
      EXECUTE 'SELECT id, secret FROM public.integration_endpoints WHERE secret IS NOT NULL AND secret <> '''' AND secret_id IS NULL'
    LOOP
      UPDATE public.integration_endpoints SET secret_id = vault.create_secret(r.secret) WHERE id = r.id;
    END LOOP;
  END IF;
END $$;

ALTER TABLE public.integration_endpoints DROP COLUMN IF EXISTS secret;

-- Write/rotate the signing secret. Gated to service_role, super admin, or the
-- tenant admin of the endpoint's own tenant. NULL/'' clears the secret.
CREATE OR REPLACE FUNCTION public.integration_endpoint_set_secret(_endpoint_id uuid, _plaintext text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _id uuid;
  _tenant uuid;
BEGIN
  SELECT tenant_id, secret_id INTO _tenant, _id
    FROM public.integration_endpoints WHERE id = _endpoint_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'endpoint_not_found';
  END IF;
  IF current_setting('role', true) <> 'service_role'
     AND NOT public.is_super_admin()
     AND NOT (public.has_role(auth.uid(), 'admin') AND _tenant = public.current_tenant_id()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _plaintext IS NULL OR _plaintext = '' THEN
    UPDATE public.integration_endpoints SET secret_id = NULL WHERE id = _endpoint_id;
  ELSIF _id IS NULL THEN
    UPDATE public.integration_endpoints SET secret_id = vault.create_secret(_plaintext) WHERE id = _endpoint_id;
  ELSE
    PERFORM vault.update_secret(_id, _plaintext);
  END IF;
END $$;

-- Read the decrypted signing secret. service_role only (the outbox dispatcher).
CREATE OR REPLACE FUNCTION public.integration_endpoint_get_secret(_endpoint_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _id uuid;
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT secret_id INTO _id FROM public.integration_endpoints WHERE id = _endpoint_id;
  IF _id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id = _id)::text;
END $$;

REVOKE ALL ON FUNCTION public.integration_endpoint_set_secret(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.integration_endpoint_set_secret(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.integration_endpoint_get_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_endpoint_get_secret(uuid) TO service_role;
