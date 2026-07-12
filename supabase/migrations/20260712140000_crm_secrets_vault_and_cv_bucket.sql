-- ============================================================================
-- T1 — CRM Merydian secrets -> Supabase Vault + private "cv" bucket.
--
-- A) crm_integrations.merydian_webhook_secret / merydian_api_key were stored
--    in plaintext. Move them into Supabase Vault, referenced by two nullable
--    uuid columns. Read/write only through SECURITY DEFINER RPCs. Drop the
--    plaintext columns.
-- B) profile CV uploads move from the PUBLIC "media" bucket to a PRIVATE "cv"
--    bucket with owner-scoped storage.objects RLS (chat-attachments style).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) Supabase Vault for Merydian secrets
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.crm_integrations
  ADD COLUMN IF NOT EXISTS merydian_webhook_secret_id uuid,
  ADD COLUMN IF NOT EXISTS merydian_api_key_id uuid;

-- Backfill: create a Vault secret per non-null plaintext value and store its
-- id. Idempotent: guarded by column existence and by *_id IS NULL, so a re-run
-- (or a run after the plaintext columns are already dropped) is a no-op.
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'crm_integrations'
       AND column_name = 'merydian_webhook_secret'
  ) THEN
    FOR r IN
      SELECT id,
             merydian_webhook_secret AS wsec,
             merydian_api_key        AS akey,
             merydian_webhook_secret_id AS wid,
             merydian_api_key_id        AS aid
        FROM public.crm_integrations
    LOOP
      IF r.wsec IS NOT NULL AND r.wsec <> '' AND r.wid IS NULL THEN
        UPDATE public.crm_integrations
           SET merydian_webhook_secret_id = vault.create_secret(r.wsec)
         WHERE id = r.id;
      END IF;
      IF r.akey IS NOT NULL AND r.akey <> '' AND r.aid IS NULL THEN
        UPDATE public.crm_integrations
           SET merydian_api_key_id = vault.create_secret(r.akey)
         WHERE id = r.id;
      END IF;
    END LOOP;
  END IF;
END $$;

ALTER TABLE public.crm_integrations
  DROP COLUMN IF EXISTS merydian_webhook_secret,
  DROP COLUMN IF EXISTS merydian_api_key;

-- Write path: admin-of-tenant (or super admin) sets/updates/clears a secret.
-- _kind in ('webhook','api'); NULL/empty plaintext deletes the secret and nulls
-- the id; create vs vault.update_secret is decided by the stored id's presence.
CREATE OR REPLACE FUNCTION public.crm_set_merydian_secret(_kind text, _plaintext text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _tid uuid := public.current_tenant_id();
  _id  uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _kind NOT IN ('webhook', 'api') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;

  -- Ensure a config row exists for this tenant.
  INSERT INTO public.crm_integrations (tenant_id)
    VALUES (_tid)
    ON CONFLICT (tenant_id) DO NOTHING;

  IF _kind = 'webhook' THEN
    SELECT merydian_webhook_secret_id INTO _id
      FROM public.crm_integrations WHERE tenant_id = _tid;
  ELSE
    SELECT merydian_api_key_id INTO _id
      FROM public.crm_integrations WHERE tenant_id = _tid;
  END IF;

  IF _plaintext IS NULL OR _plaintext = '' THEN
    IF _id IS NOT NULL THEN
      DELETE FROM vault.secrets WHERE id = _id;
    END IF;
    IF _kind = 'webhook' THEN
      UPDATE public.crm_integrations
         SET merydian_webhook_secret_id = NULL WHERE tenant_id = _tid;
    ELSE
      UPDATE public.crm_integrations
         SET merydian_api_key_id = NULL WHERE tenant_id = _tid;
    END IF;
    RETURN;
  END IF;

  IF _id IS NULL THEN
    _id := vault.create_secret(_plaintext);
    IF _kind = 'webhook' THEN
      UPDATE public.crm_integrations
         SET merydian_webhook_secret_id = _id WHERE tenant_id = _tid;
    ELSE
      UPDATE public.crm_integrations
         SET merydian_api_key_id = _id WHERE tenant_id = _tid;
    END IF;
  ELSE
    PERFORM vault.update_secret(_id, _plaintext);
  END IF;
END;
$$;

-- Read path: returns decrypted secrets for a tenant (defaults to the caller's
-- tenant). Gated to service_role, super admin, or tenant admin of that tenant.
CREATE OR REPLACE FUNCTION public.crm_get_merydian_secrets(_tenant uuid DEFAULT NULL)
RETURNS TABLE(webhook_secret text, api_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _tid uuid := COALESCE(_tenant, public.current_tenant_id());
  _wid uuid;
  _aid uuid;
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND NOT public.is_super_admin()
     AND NOT (_tid = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT merydian_webhook_secret_id, merydian_api_key_id
    INTO _wid, _aid
    FROM public.crm_integrations
   WHERE tenant_id = _tid;

  RETURN QUERY
    SELECT
      (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id = _wid)::text,
      (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id = _aid)::text;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_set_merydian_secret(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_get_merydian_secrets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_merydian_secret(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_get_merydian_secrets(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B) Private "cv" bucket + owner-scoped storage.objects RLS
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cv', 'cv', false, 10485760,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path convention: "<tenant>/users/<uid>/<file>"  => foldername = {tenant,users,uid}
DROP POLICY IF EXISTS "cv owner read" ON storage.objects;
CREATE POLICY "cv owner read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'cv' AND array_length(storage.foldername(name), 1) >= 3
  AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
);
DROP POLICY IF EXISTS "cv owner upload" ON storage.objects;
CREATE POLICY "cv owner upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'cv' AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id()::text)
  AND (storage.foldername(name))[2] = 'users'
  AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
);
DROP POLICY IF EXISTS "cv owner delete" ON storage.objects;
CREATE POLICY "cv owner delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'cv' AND array_length(storage.foldername(name), 1) >= 3
  AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
);
