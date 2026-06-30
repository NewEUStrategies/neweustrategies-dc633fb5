-- Tenant-scope the PUBLIC read policies for ads.
--
-- The original ad policies (migration 20260624165807) let anon/authenticated
-- read EVERY tenant's active ad_slots / ad_placements - the predicates only
-- checked `status = 'active'` / `active = true`, with no tenant_id filter. That
-- meant one tenant's public site could surface another tenant's ad inventory,
-- and the public ad query (`src/lib/ads/queries.ts`) would happily return
-- cross-tenant rows.
--
-- Every other public surface (categories, tags, site_settings,
-- contact_messages) already scopes public SELECT to public.public_tenant_id().
-- This migration brings ads in line so a workspace can never read another
-- workspace's ad data. The "Admins/editors manage ... in tenant" policies are
-- left untouched: they remain OR-combined, so a signed-in editor still sees and
-- manages their own tenant's rows even when that tenant is not the public one.

-- ad_slots: public may read only the public tenant's active slots.
DROP POLICY IF EXISTS "Public can read active ad_slots" ON public.ad_slots;
CREATE POLICY "Public can read active ad_slots"
  ON public.ad_slots FOR SELECT
  USING (
    status = 'active'
    AND tenant_id = public.public_tenant_id()
  );

-- ad_placements: public may read only the public tenant's live placements.
DROP POLICY IF EXISTS "Public can read active ad_placements" ON public.ad_placements;
CREATE POLICY "Public can read active ad_placements"
  ON public.ad_placements FOR SELECT
  USING (
    active = true
    AND tenant_id = public.public_tenant_id()
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  );
