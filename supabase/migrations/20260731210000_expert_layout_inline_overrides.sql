-- ============================================================================
-- Expert hub: inline editor nadpisań layoutu per-ekspert (domknięcie kroku
-- "nadpisanie per-ekspert" z /admin/expert-layouts).
--
-- Stan przed migracją:
--   B1  author_profiles.layout_preset ma CHECK z PIERWOTNYMI id presetów
--       ('portrait-left', 'full-bleed-cover', ...), podczas gdy aplikacja od
--       migracji 20260713212243+ renderuje zestaw z lib/expertLayouts.ts
--       ('classic', 'centered', 'magazine', 'sidebar-left', 'sidebar-right',
--       'minimal', 'card-stack', 'editorial'). Zapis nadpisania per-ekspert
--       jest więc niemożliwy - INSERT/UPDATE wykłada się na constraincie.
--   B2  get_expert_hub() nie projektuje layout_preset / layout_overrides w
--       ładunku author_profile, mimo że widok author_profiles_public te
--       kolumny wystawia (20260730120000). Publiczna strona /author/$slug
--       nie ma jak zastosować nadpisań w jednym round-tripie.
--
-- Po migracji: dane wyrównane do obecnych id (remap starych wartości),
-- constraint zgodny z ExpertLayoutPresetId, a hub RPC niesie oba pola.
-- Wszystkie kroki są idempotentne (re-run na świeżej bazie i na produkcji).
-- ============================================================================

-- ---------- B1a: zdejmij stary constraint PRZED remapem ----------------------
-- Remap ustawia nowe id, których stary CHECK nie zna - kolejność jest istotna.
ALTER TABLE public.author_profiles
  DROP CONSTRAINT IF EXISTS author_profiles_layout_preset_check;

-- ---------- B1b: remap historycznych wartości na obecne id -------------------
-- Mapowanie 1:1 po semantyce hero (portret z lewej -> classic, pełna okładka
-- -> magazine, wycentrowany minimal -> centered, kolumny -> sidebar-left,
-- szyna boczna -> sidebar-right). 'magazine' / 'editorial' / 'card-stack'
-- pokrywają się nazwami i zostają bez zmian.
UPDATE public.author_profiles
   SET layout_preset = CASE layout_preset
         WHEN 'portrait-left' THEN 'classic'
         WHEN 'full-bleed-cover' THEN 'magazine'
         WHEN 'centered-minimal' THEN 'centered'
         WHEN 'split-columns' THEN 'sidebar-left'
         WHEN 'sidebar-rail' THEN 'sidebar-right'
         ELSE layout_preset
       END
 WHERE layout_preset IN (
   'portrait-left', 'full-bleed-cover', 'centered-minimal',
   'split-columns', 'sidebar-rail'
 );

-- ---------- B1c: constraint zgodny z lib/expertLayouts.ts --------------------
ALTER TABLE public.author_profiles
  ADD CONSTRAINT author_profiles_layout_preset_check
  CHECK (layout_preset IS NULL OR layout_preset IN (
    'classic', 'centered', 'magazine', 'sidebar-left',
    'sidebar-right', 'minimal', 'card-stack', 'editorial'
  ));

-- ---------- B2: get_expert_hub niesie nadpisania layoutu eksperta ------------
-- Identyczna z 20260730120000 poza projekcją author_profile, która dokłada
-- layout_preset i layout_overrides (oba już publiczne przez
-- author_profiles_public - to nie jest poszerzenie powierzchni danych,
-- tylko domknięcie RPC do stanu widoku).
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
           full_bio_pl, full_bio_en, org_functions, media_contact_name, is_public,
           layout_preset, layout_overrides
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
