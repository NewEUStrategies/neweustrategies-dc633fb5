-- ============================================================================
-- Security: tenant-scope the redirect manager and the 404 monitor.
--
-- public.redirects was a GLOBAL table (unique on source_path alone) managed
-- by any tenant's admins/editors. In a multi-tenant deployment that means any
-- tenant's staff could create or overwrite a rule that captures ANOTHER
-- tenant's traffic (the serving middleware matched rules with the service
-- role, tenant-blind). Combined with absolute https:// targets this was a
-- cross-tenant traffic-takeover primitive.
--
-- Changes:
--   * redirects.tenant_id (NOT NULL, DEFAULT current_tenant_id()) + unique
--     (tenant_id, source_path); RLS policies additionally require
--     tenant_id = current_tenant_id().
--   * seo_404_hits gets the same treatment (PK becomes (tenant_id, path)).
--   * record_seo_404() takes the tenant explicitly (the middleware resolves
--     it from the request host - see src/lib/server/tenant.server.ts).
--
-- The open-redirect half of the finding (absolute https:// targets accepted
-- verbatim) is closed in the application layer: normalizeTargetPath() now
-- only accepts absolute URLs whose host is allowlisted (the tenant's own
-- domains), see src/lib/seo/redirects.ts.
-- ============================================================================

-- ---------- redirects ----------

ALTER TABLE public.redirects
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.redirects
SET tenant_id = public.public_tenant_id()
WHERE tenant_id IS NULL;

ALTER TABLE public.redirects
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

ALTER TABLE public.redirects DROP CONSTRAINT IF EXISTS redirects_source_path_key;
CREATE UNIQUE INDEX IF NOT EXISTS redirects_source_per_tenant
  ON public.redirects (tenant_id, source_path);

DROP INDEX IF EXISTS redirects_enabled_idx;
CREATE INDEX IF NOT EXISTS redirects_tenant_enabled_idx
  ON public.redirects (tenant_id) WHERE is_enabled;

DROP POLICY IF EXISTS "Staff reads redirects" ON public.redirects;
CREATE POLICY "Staff reads redirects" ON public.redirects FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );
DROP POLICY IF EXISTS "Staff inserts redirects" ON public.redirects;
CREATE POLICY "Staff inserts redirects" ON public.redirects FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );
DROP POLICY IF EXISTS "Staff updates redirects" ON public.redirects;
CREATE POLICY "Staff updates redirects" ON public.redirects FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );
DROP POLICY IF EXISTS "Staff deletes redirects" ON public.redirects;
CREATE POLICY "Staff deletes redirects" ON public.redirects FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

-- ---------- seo_404_hits ----------

ALTER TABLE public.seo_404_hits
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.seo_404_hits
SET tenant_id = public.public_tenant_id()
WHERE tenant_id IS NULL;

ALTER TABLE public.seo_404_hits
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.seo_404_hits DROP CONSTRAINT IF EXISTS seo_404_hits_pkey;
ALTER TABLE public.seo_404_hits ADD PRIMARY KEY (tenant_id, path);

DROP POLICY IF EXISTS "Staff reads 404 hits" ON public.seo_404_hits;
CREATE POLICY "Staff reads 404 hits" ON public.seo_404_hits FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );
DROP POLICY IF EXISTS "Staff deletes 404 hits" ON public.seo_404_hits;
CREATE POLICY "Staff deletes 404 hits" ON public.seo_404_hits FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

-- Tenant-aware recorder; replaces record_seo_404(text, text).
DROP FUNCTION IF EXISTS public.record_seo_404(text, text);
CREATE OR REPLACE FUNCTION public.record_seo_404(
  _tenant_id uuid,
  _path text,
  _referrer text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.seo_404_hits AS h (tenant_id, path, last_referrer)
  VALUES (_tenant_id, left(_path, 500), left(_referrer, 500))
  ON CONFLICT (tenant_id, path) DO UPDATE
  SET hits = h.hits + 1,
      last_seen = now(),
      last_referrer = COALESCE(EXCLUDED.last_referrer, h.last_referrer);
$$;

REVOKE ALL ON FUNCTION public.record_seo_404(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_seo_404(uuid, text, text) TO service_role;
