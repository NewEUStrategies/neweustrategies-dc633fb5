-- ============================================================================
-- Security: close direct anon/authenticated INSERTs on public-intake tables.
--
-- Three findings from the anonymous-INSERT scan (2026-07-30). Each table had
-- an RLS INSERT policy that let any unauthenticated caller write rows straight
-- through PostgREST with the anon key, bypassing every server-side guard:
--
--   F1  contact_messages - "Anyone can submit a contact message" checked only
--       tenant_id = public_tenant_id() AND recipient IS NULL. Email, phone,
--       name and message content were fully attacker-controlled with no
--       validation or throttling at the RLS layer: spam/phishing could be
--       inserted directly into the admin Contact Center inbox (and each row
--       fires the CRM lead-scoring + consent-log triggers). The hardened
--       funnel already exists: submitContactMessage (contact.functions.ts) -
--       zod validation, enforce_form_field_policy, per-IP (5/10 min) and
--       per-recipient (3/h) rate limits, tenant pinned to the browsed host,
--       service_role insert. The last direct-insert caller (ContactFormView in
--       MarketingViews.tsx) is switched to that server fn in this change.
--
--   F2  crm_consent_log - "Anyone can insert consent log" checked only
--       tenant_id = public_tenant_id(). Anyone could fabricate GDPR/RODO
--       consent records for arbitrary e-mail addresses, undermining the
--       evidentiary value of the consent audit trail. Legitimate rows are
--       written exclusively by the SECURITY DEFINER triggers tied to real
--       events (contact_messages_to_lead, newsletter_to_lead - they run as
--       the table owner, so no anon grant is needed) and by service_role.
--
--   F3  related_post_clicks - "related_post_clicks public insert" checked only
--       same-tenant source/target posts and user_id NULL-or-self, with no tie
--       to a real page view: the table could be flooded with fabricated click
--       data, skewing recommendations and analytics. The only legitimate
--       writer is the /api/public/related-click beacon route (zod validation,
--       30 clicks / 5 min per viewer_hash rate limit, tenant consistency
--       resolved server-side from posts.tenant_id, service_role insert).
--
-- End state: INSERT on all three tables is service_role-only. Staff SELECT /
-- UPDATE / DELETE policies and grants are untouched. The dead anon SELECT
-- grant on crm_consent_log (no anon SELECT policy ever existed) is dropped as
-- defense-in-depth. All statements are idempotent replays.
-- ============================================================================

-- ── F1: contact_messages ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can submit a contact message" ON public.contact_messages;
REVOKE INSERT ON public.contact_messages FROM anon, authenticated;

-- ── F2: crm_consent_log ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can insert consent log" ON public.crm_consent_log;
REVOKE INSERT ON public.crm_consent_log FROM anon, authenticated;
-- anon never had a SELECT policy on this audit table; drop the unused grant so
-- a future policy mistake cannot expose consent history to the public.
REVOKE SELECT ON public.crm_consent_log FROM anon;

-- ── F3: related_post_clicks ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "related_post_clicks public insert" ON public.related_post_clicks;
REVOKE INSERT ON public.related_post_clicks FROM anon, authenticated;
