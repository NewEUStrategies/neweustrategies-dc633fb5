-- Fix security findings: block anonymous access to sensitive PII columns.
-- Password hashes/hints and staff PII (email/phone/etc.) must never be
-- reachable through the public Data API. Public callers already go through
-- limited column projections (lib/queries/public.ts) and SECURITY DEFINER
-- RPCs (get_password_hint, get_entity_content), so revoking the columns
-- from anon closes the exposure without breaking any code path.

-- content_access: password_hash was already blocked; also lock down the hints.
REVOKE SELECT (password_hash, password_hint_pl, password_hint_en)
  ON public.content_access FROM anon;
REVOKE SELECT (password_hash) ON public.content_access FROM authenticated;
-- Hints stay readable to authenticated because the staff-manage policy needs
-- them for the admin editor (see AccessSettingsPane), gated by has_role().

-- profiles: strip PII from the anonymous author-profile read path.
-- The "Profiles anon public authors" policy exists so unauthenticated visitors
-- can view a staff author page (name, bio, avatar, socials) - it must NEVER
-- expose contact details. Authenticated readers keep column access; the RLS
-- policy still limits them to own row + staff-of-tenant.
REVOKE SELECT (email, phone, contact_email, first_name, last_name, location, gender)
  ON public.profiles FROM anon;

-- Make the content_access public-read policy target explicit roles instead of
-- the broad PUBLIC group, so the scanner sees the intended audience.
DROP POLICY IF EXISTS "content_access public read" ON public.content_access;
CREATE POLICY "content_access public read"
  ON public.content_access
  FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public_tenant_id());
