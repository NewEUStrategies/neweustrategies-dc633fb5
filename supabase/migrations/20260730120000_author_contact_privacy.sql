-- ============================================================================
-- Security: author contact details (phone / e-mails) must never be public.
--
-- Finding "author_profiles - author contact details exposed to the public by
-- default": author_profiles carries personal contact PII (phone,
-- contact_email, media_contact_email, media_contact_phone) next to public bio
-- content, is_public defaults to true, and the public SELECT policies have no
-- column scoping. RLS policies cannot scope columns in Postgres - the column
-- boundary is enforced with grants - and the base-table grants were already
-- hardened (20260715095639, 20260720120000, 20260720131542, 20260729062739).
-- What still re-exposed contact PII to the whole internet:
--
--   A1  public.author_profiles_public (20260724114239) is a DEFINER-style view
--       (security_invoker = off) granted to anon+authenticated and it selects
--       ap.contact_email - bypassing the deliberate column REVOKE from
--       20260720131542. Every is_public author's contact e-mail was readable
--       by unauthenticated users through the view and through get_expert_hub()
--       (which reads this view).
--
--   A2  is_public still DEFAULTs to true, so any future insert path that does
--       not set it explicitly publishes the profile immediately. Every current
--       app insert path sets is_public explicitly, so flipping the default to
--       false is pure defense-in-depth with no behavior change.
--
--   A3  The owner reads their full row via get_own_author_profile() (SECURITY
--       DEFINER, 20260718084630), but there was NO equivalent for tenant
--       admins: the "Admins can manage tenant author profiles" row policy
--       passes, yet the role-wide column REVOKE stops PostgREST selects of the
--       contact columns for admins too. The admin profile editor silently
--       failed to load them. A dedicated admin_get_author_profile() closes the
--       gap without re-widening the role-wide grants.
--
-- End state: phone, contact_email, media_contact_email and media_contact_phone
-- are readable ONLY by the row owner (get_own_author_profile), tenant admins
-- (admin_get_author_profile) and service_role. Public surfaces (view + RPC)
-- keep the bio/socials/layout columns plus media_contact_name (a display name,
-- not a contact route). All statements are idempotent replays except the view
-- column removal, which is the point of the migration.
-- ============================================================================

-- ---------- A1a: belt-and-braces - re-assert the base-table column REVOKEs ---
-- No-ops today; they pin the end state against historical grant drift.
REVOKE SELECT (phone, contact_email, media_contact_email, media_contact_phone)
  ON public.author_profiles FROM anon, authenticated;

-- ---------- A1b: recreate the public view WITHOUT contact_email --------------
-- Column removal requires DROP + CREATE (CREATE OR REPLACE cannot drop view
-- columns). Same projection and predicate as 20260724114239 otherwise:
-- is_public = true, host tenant only, definer-style with security_barrier.
DROP VIEW IF EXISTS public.author_profiles_public;

CREATE VIEW public.author_profiles_public
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  ap.id,
  ap.user_id,
  ap.tenant_id,
  ap.is_public,
  ap.job_title,
  ap.company,
  ap.avatar_url,
  ap.bio_pl,
  ap.bio_en,
  ap.full_bio_pl,
  ap.full_bio_en,
  ap.linkedin_url,
  ap.x_url,
  ap.facebook_url,
  ap.instagram_url,
  ap.spotify_url,
  ap.website_url,
  ap.custom_socials,
  ap.brand_accent,
  ap.brand_accent_dark,
  ap.layout_template_id,
  ap.layout_preset,
  ap.layout_section_order,
  ap.layout_overrides,
  ap.org_functions,
  ap.counterpart_lang,
  ap.counterpart_user_id,
  ap.media_contact_name,
  ap.created_at,
  ap.updated_at
FROM public.author_profiles ap
WHERE ap.is_public = true
  AND ap.tenant_id = public_tenant_id();

GRANT SELECT ON public.author_profiles_public TO anon, authenticated;

-- ---------- A1c: get_expert_hub - drop contact_email from the payload --------
-- Identical to 20260724184141 except the author_profile projection no longer
-- selects contact_email (the column is gone from the view anyway; keeping the
-- function in sync avoids a 42703 on the hub RPC path).
CREATE OR REPLACE FUNCTION public.get_expert_hub(_slug_or_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_profile jsonb; v_expert uuid; v_tenant uuid;
  v_author_profile jsonb; v_badges jsonb; v_program_members jsonb;
  v_expertise_areas jsonb; v_media_mentions jsonb;
  v_primary_posts jsonb; v_coauthor_posts jsonb; v_podcasts jsonb;
  v_host_events jsonb; v_speaker_events jsonb;
  v_post_ids uuid[]; v_post_categories jsonb; v_post_programs jsonb;
  v_post_regions jsonb; v_post_tags jsonb;
  v_program_ids uuid[]; v_region_ids uuid[]; v_layout jsonb;
BEGIN
  SELECT to_jsonb(p) INTO v_profile FROM (
    SELECT id, tenant_id, slug, display_name, avatar_url, cover_url, bio_pl, bio_en,
           twitter_url, linkedin_url, website_url, verified_at, updated_at,
           expert_requests_enabled
      FROM public.profiles_public WHERE slug = _slug_or_id LIMIT 1
  ) p;
  IF v_profile IS NULL
     AND _slug_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT to_jsonb(p) INTO v_profile FROM (
      SELECT id, tenant_id, slug, display_name, avatar_url, cover_url, bio_pl, bio_en,
             twitter_url, linkedin_url, website_url, verified_at, updated_at,
             expert_requests_enabled
        FROM public.profiles_public WHERE id = _slug_or_id::uuid LIMIT 1
    ) p;
  END IF;
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('profile', NULL);
  END IF;

  v_expert := (v_profile ->> 'id')::uuid;
  v_tenant := NULLIF(v_profile ->> 'tenant_id', '')::uuid;

  SELECT to_jsonb(ap) INTO v_author_profile FROM (
    SELECT job_title, company, website_url, x_url, linkedin_url, facebook_url,
           instagram_url, spotify_url, custom_socials,
           full_bio_pl, full_bio_en, org_functions, media_contact_name, is_public
      FROM public.author_profiles_public WHERE user_id = v_expert LIMIT 1
  ) ap;

  SELECT COALESCE(jsonb_agg(b.badge), '[]'::jsonb) INTO v_badges
    FROM public.profile_badges b WHERE b.user_id = v_expert;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'role_pl', pm.role_pl, 'role_en', pm.role_en, 'sort_order', pm.sort_order,
           'program', (SELECT to_jsonb(pr) FROM (
             SELECT p2.id, p2.slug, p2.name_pl, p2.name_en, p2.kind,
                    p2.description_pl, p2.description_en
               FROM public.programs p2 WHERE p2.id = pm.program_id) pr)
         ) ORDER BY pm.sort_order ASC), '[]'::jsonb) INTO v_program_members
    FROM public.program_members pm WHERE pm.user_id = v_expert;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sort_order', ea.sort_order,
           'area', (SELECT to_jsonb(ar) FROM (
             SELECT a2.id, a2.slug, a2.name_pl, a2.name_en
               FROM public.expertise_areas a2 WHERE a2.id = ea.area_id) ar)
         ) ORDER BY ea.sort_order ASC), '[]'::jsonb) INTO v_expertise_areas
    FROM public.expert_expertise_areas ea WHERE ea.user_id = v_expert;

  SELECT COALESCE(jsonb_agg(to_jsonb(mm) ORDER BY mm.published_on DESC), '[]'::jsonb)
    INTO v_media_mentions FROM (
      SELECT id, outlet, title, url, kind, language, published_on, cover_url
        FROM public.media_mentions WHERE user_id = v_expert AND is_public = true
    ) mm;

  SELECT COALESCE(jsonb_agg(to_jsonb(pp) ORDER BY pp.published_at DESC), '[]'::jsonb)
    INTO v_primary_posts FROM (
      SELECT id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url,
             published_at, post_format, author_id
        FROM public.posts WHERE author_id = v_expert AND status = 'published' AND deleted_at IS NULL
    ) pp;

  SELECT COALESCE(jsonb_agg(to_jsonb(cp)), '[]'::jsonb) INTO v_coauthor_posts FROM (
    SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
           p.cover_image_url, p.published_at, p.post_format, p.author_id
      FROM public.posts p
      JOIN public.post_authors pa ON pa.post_id = p.id AND pa.user_id = v_expert
      WHERE p.status = 'published' AND p.deleted_at IS NULL
  ) cp;

  SELECT COALESCE(jsonb_agg(to_jsonb(pod) ORDER BY pod.published_at DESC), '[]'::jsonb)
    INTO v_podcasts FROM (
      SELECT id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url,
             published_at, program_id, region_id
        FROM public.podcasts WHERE author_id = v_expert AND status = 'published' AND deleted_at IS NULL
    ) pod;

  SELECT COALESCE(jsonb_agg(to_jsonb(he)), '[]'::jsonb) INTO v_host_events FROM (
    SELECT id, slug, title_pl, title_en, description_pl, description_en, cover_url,
           starts_at, program_id, region_id, host_user_id
      FROM public.events WHERE host_user_id = v_expert AND status = 'published'
  ) he;

  SELECT COALESCE(jsonb_agg(to_jsonb(se)), '[]'::jsonb) INTO v_speaker_events FROM (
    SELECT e.id, e.slug, e.title_pl, e.title_en, e.description_pl, e.description_en,
           e.cover_url, e.starts_at, e.program_id, e.region_id, e.host_user_id
      FROM public.events e
      JOIN public.event_speakers es ON es.event_id = e.id AND es.user_id = v_expert
      WHERE e.status = 'published'
  ) se;

  SELECT array_agg(DISTINCT p.id) INTO v_post_ids
    FROM public.posts p
    LEFT JOIN public.post_authors pa ON pa.post_id = p.id AND pa.user_id = v_expert
    WHERE p.status = 'published' AND p.deleted_at IS NULL
      AND (p.author_id = v_expert OR pa.user_id IS NOT NULL);
  v_post_ids := COALESCE(v_post_ids, ARRAY[]::uuid[]);

  SELECT COALESCE(jsonb_agg(to_jsonb(pc)), '[]'::jsonb) INTO v_post_categories FROM (
    SELECT post_id, category_id FROM public.post_categories WHERE post_id = ANY (v_post_ids)
  ) pc;
  SELECT COALESCE(jsonb_agg(to_jsonb(pg)), '[]'::jsonb) INTO v_post_programs FROM (
    SELECT post_id, program_id FROM public.post_programs WHERE post_id = ANY (v_post_ids)
  ) pg;
  SELECT COALESCE(jsonb_agg(to_jsonb(pr)), '[]'::jsonb) INTO v_post_regions FROM (
    SELECT post_id, region_id FROM public.post_regions WHERE post_id = ANY (v_post_ids)
  ) pr;
  SELECT COALESCE(jsonb_agg(to_jsonb(pt)), '[]'::jsonb) INTO v_post_tags FROM (
    SELECT post_id, tag_id FROM public.post_tags WHERE post_id = ANY (v_post_ids)
  ) pt;

  SELECT array_agg(DISTINCT x.program_id) INTO v_program_ids FROM (
    SELECT pp2.program_id FROM public.post_programs pp2 WHERE pp2.post_id = ANY (v_post_ids)
    UNION
    SELECT pod2.program_id FROM public.podcasts pod2
      WHERE pod2.author_id = v_expert AND pod2.status = 'published'
        AND pod2.deleted_at IS NULL AND pod2.program_id IS NOT NULL
    UNION
    SELECT e2.program_id FROM public.events e2
      LEFT JOIN public.event_speakers es2 ON es2.event_id = e2.id AND es2.user_id = v_expert
      WHERE e2.status = 'published' AND e2.program_id IS NOT NULL
        AND (e2.host_user_id = v_expert OR es2.user_id IS NOT NULL)
  ) x WHERE x.program_id IS NOT NULL;
  v_program_ids := COALESCE(v_program_ids, ARRAY[]::uuid[]);

  SELECT array_agg(DISTINCT x.region_id) INTO v_region_ids FROM (
    SELECT pr2.region_id FROM public.post_regions pr2 WHERE pr2.post_id = ANY (v_post_ids)
    UNION
    SELECT pod3.region_id FROM public.podcasts pod3
      WHERE pod3.author_id = v_expert AND pod3.status = 'published'
        AND pod3.deleted_at IS NULL AND pod3.region_id IS NOT NULL
    UNION
    SELECT e3.region_id FROM public.events e3
      LEFT JOIN public.event_speakers es3 ON es3.event_id = e3.id AND es3.user_id = v_expert
      WHERE e3.status = 'published' AND e3.region_id IS NOT NULL
        AND (e3.host_user_id = v_expert OR es3.user_id IS NOT NULL)
  ) x WHERE x.region_id IS NOT NULL;
  v_region_ids := COALESCE(v_region_ids, ARRAY[]::uuid[]);

  SELECT to_jsonb(l) INTO v_layout FROM (
    SELECT * FROM public.expert_layout_settings WHERE tenant_id = v_tenant LIMIT 1
  ) l;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'author_profile', v_author_profile,
    'badges', v_badges,
    'program_members', v_program_members,
    'expertise_areas', v_expertise_areas,
    'media_mentions', v_media_mentions,
    'primary_posts', v_primary_posts,
    'coauthor_posts', v_coauthor_posts,
    'podcasts', v_podcasts,
    'host_events', v_host_events,
    'speaker_events', v_speaker_events,
    'post_categories', v_post_categories,
    'post_programs', v_post_programs,
    'post_regions', v_post_regions,
    'post_tags', v_post_tags,
    'programs', (SELECT COALESCE(jsonb_agg(to_jsonb(tp)), '[]'::jsonb) FROM (
      SELECT id, slug, name_pl, name_en, kind, description_pl, description_en
        FROM public.programs WHERE id = ANY (v_program_ids)) tp),
    'regions', (SELECT COALESCE(jsonb_agg(to_jsonb(tr)), '[]'::jsonb) FROM (
      SELECT id, slug, name_pl, name_en FROM public.regions WHERE id = ANY (v_region_ids)) tr),
    'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(tc)), '[]'::jsonb) FROM (
      SELECT id, slug, name_pl, name_en FROM public.categories
        WHERE id IN (SELECT DISTINCT pc2.category_id FROM public.post_categories pc2
                       WHERE pc2.post_id = ANY (v_post_ids))) tc),
    'tags', (SELECT COALESCE(jsonb_agg(to_jsonb(tt)), '[]'::jsonb) FROM (
      SELECT id, slug, name FROM public.tags
        WHERE id IN (SELECT DISTINCT pt2.tag_id FROM public.post_tags pt2
                       WHERE pt2.post_id = ANY (v_post_ids))) tt),
    'layout_settings', v_layout
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_expert_hub(text) TO anon, authenticated, service_role;

-- ---------- A2: privacy by default -------------------------------------------
-- Every app insert path (profile editor, invitation provisioning, seed) sets
-- is_public explicitly, so this only protects future paths that forget to.
ALTER TABLE public.author_profiles ALTER COLUMN is_public SET DEFAULT false;

-- ---------- A3: tenant-admin read path for the full row ----------------------
-- Mirrors the "Admins can manage tenant author profiles" policy predicate
-- exactly (admin/super_admin role AND same home tenant as the target row).
-- SETOF + sql: non-admins and cross-tenant callers get an empty set, which
-- PostgREST maps to null on .maybeSingle() - no error-channel probing.
CREATE OR REPLACE FUNCTION public.admin_get_author_profile(_user_id uuid)
RETURNS SETOF public.author_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ap.*
  FROM public.author_profiles ap
  WHERE ap.user_id = _user_id
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role))
    AND ap.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.admin_get_author_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_author_profile(uuid) TO authenticated, service_role;
