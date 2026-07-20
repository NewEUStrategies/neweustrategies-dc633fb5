-- Anon profiles: allow only public-safe columns
GRANT SELECT ON public.profiles TO anon;
REVOKE SELECT (
  email,
  phone,
  contact_email,
  location,
  gender,
  verified_by,
  prefs,
  profile_view_mode,
  discovery_search,
  discoverable
) ON public.profiles FROM anon;

-- Public-safe content_access view (no password hashes/hints)
CREATE OR REPLACE VIEW public.content_access_public
WITH (security_invoker = off) AS
SELECT
  id,
  tenant_id,
  entity_type,
  entity_id,
  mode,
  plan_ids,
  one_time_price_cents,
  one_time_currency,
  teaser_pl,
  teaser_en,
  created_at,
  updated_at
FROM public.content_access
WHERE tenant_id = public_tenant_id();

GRANT SELECT ON public.content_access_public TO anon, authenticated;

-- Block direct anon reads of the sensitive base table
DROP POLICY IF EXISTS "content_access public read" ON public.content_access;
CREATE POLICY "content_access public read"
  ON public.content_access
  FOR SELECT
  TO anon
  USING (false);