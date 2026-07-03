-- ============================================================================
-- Local development / E2E seed. Applied by `supabase db reset` (and `db test`)
-- AFTER all migrations. Idempotent: every insert is keyed and skipped when the
-- row already exists, so re-running is always safe.
--
-- Provides the minimum living content the user-path E2E suite (e2e/*.spec.ts,
-- run with E2E_SEEDED=1) and a fresh developer environment need:
--   * dev accounts     admin@nes.local / reader@nes.local (password: nes-dev-1234)
--   * content tree     "blog" parent page + published, bilingual posts
--   * taxonomies       categories + tags wired to the posts
--
-- The default tenant ('nes') is created by the base migration; the seed only
-- attaches content to it. No production data, no external URLs.
-- ============================================================================

-- ---------- 1. Dev users (auth schema; triggers create profile + role) ------
-- First user in the seed tenant becomes 'admin' (see handle_new_user), the
-- reader signs up with signup_type=reader -> role 'user'.

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  '6f9e6f6e-0000-4000-8000-000000000001',
  'authenticated', 'authenticated',
  'admin@nes.local',
  extensions.crypt('nes-dev-1234', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Dev Admin","signup_type":"staff"}'::jsonb,
  now(), now(), '', '', '', ''
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@nes.local');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  '6f9e6f6e-0000-4000-8000-000000000002',
  'authenticated', 'authenticated',
  'reader@nes.local',
  extensions.crypt('nes-dev-1234', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Dev Reader","signup_type":"reader"}'::jsonb,
  now(), now(), '', '', '', ''
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'reader@nes.local');

-- GoTrue requires a matching identities row for email+password sign-in.
INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
SELECT gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
FROM auth.users u
WHERE u.email IN ('admin@nes.local', 'reader@nes.local')
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
  );

-- ---------- 2. Content tree -------------------------------------------------

DO $$
DECLARE
  v_tenant uuid;
  v_admin uuid;
  v_blog uuid;
  v_cat_polityka uuid;
  v_cat_gospodarka uuid;
  v_tag_ue uuid;
  v_tag_energia uuid;
  v_post uuid;
  v_i int;
  v_titles_pl text[] := ARRAY[
    'Nowa architektura bezpieczeństwa Europy',
    'Transformacja energetyczna po 2030 roku',
    'Rozszerzenie UE: scenariusze dla Bałkanów',
    'Cyfrowa suwerenność - między regulacją a innowacją',
    'Polityka spójności w nowym budżecie Unii'
  ];
  v_titles_en text[] := ARRAY[
    'A new security architecture for Europe',
    'The energy transition beyond 2030',
    'EU enlargement: scenarios for the Balkans',
    'Digital sovereignty - between regulation and innovation',
    'Cohesion policy in the new Union budget'
  ];
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'nes';
  SELECT id INTO v_admin FROM auth.users WHERE email = 'admin@nes.local';
  IF v_tenant IS NULL OR v_admin IS NULL THEN
    RAISE NOTICE 'seed: tenant or admin user missing - skipping content seed';
    RETURN;
  END IF;

  -- Parent "blog" page (the default posts container the app resolves).
  SELECT id INTO v_blog FROM public.pages
  WHERE tenant_id = v_tenant AND slug = 'blog' AND parent_id IS NULL;
  IF v_blog IS NULL THEN
    INSERT INTO public.pages (tenant_id, author_id, slug, title_pl, title_en, status, published_at)
    VALUES (v_tenant, v_admin, 'blog', 'Blog', 'Blog', 'published', now())
    RETURNING id INTO v_blog;
  END IF;

  -- Categories (bilingual).
  INSERT INTO public.categories (tenant_id, slug, name_pl, name_en, description_pl, description_en)
  SELECT v_tenant, 'polityka-europejska', 'Polityka europejska', 'European politics',
         'Analizy polityki UE i państw członkowskich.', 'Analyses of EU and member-state politics.'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE tenant_id = v_tenant AND slug = 'polityka-europejska'
  );
  INSERT INTO public.categories (tenant_id, slug, name_pl, name_en, description_pl, description_en)
  SELECT v_tenant, 'gospodarka', 'Gospodarka', 'Economy',
         'Gospodarka, energia i handel.', 'Economy, energy and trade.'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE tenant_id = v_tenant AND slug = 'gospodarka'
  );
  SELECT id INTO v_cat_polityka FROM public.categories WHERE tenant_id = v_tenant AND slug = 'polityka-europejska';
  SELECT id INTO v_cat_gospodarka FROM public.categories WHERE tenant_id = v_tenant AND slug = 'gospodarka';

  -- Tags.
  INSERT INTO public.tags (tenant_id, slug, name)
  SELECT v_tenant, 'unia-europejska', 'Unia Europejska'
  WHERE NOT EXISTS (SELECT 1 FROM public.tags WHERE tenant_id = v_tenant AND slug = 'unia-europejska');
  INSERT INTO public.tags (tenant_id, slug, name)
  SELECT v_tenant, 'energetyka', 'Energetyka'
  WHERE NOT EXISTS (SELECT 1 FROM public.tags WHERE tenant_id = v_tenant AND slug = 'energetyka');
  SELECT id INTO v_tag_ue FROM public.tags WHERE tenant_id = v_tenant AND slug = 'unia-europejska';
  SELECT id INTO v_tag_energia FROM public.tags WHERE tenant_id = v_tenant AND slug = 'energetyka';

  -- Published bilingual posts (staggered dates, newest first in lists).
  FOR v_i IN 1..array_length(v_titles_pl, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.posts
      WHERE tenant_id = v_tenant AND slug = 'seed-wpis-' || v_i
    ) THEN
      INSERT INTO public.posts (
        tenant_id, author_id, parent_page_id, slug, status, editor,
        title_pl, title_en, excerpt_pl, excerpt_en,
        content_pl, content_en, read_minutes, published_at
      ) VALUES (
        v_tenant, v_admin, v_blog, 'seed-wpis-' || v_i, 'published', 'richtext',
        v_titles_pl[v_i], v_titles_en[v_i],
        'Skrót analizy: ' || v_titles_pl[v_i] || '.',
        'Analysis brief: ' || v_titles_en[v_i] || '.',
        '<p>' || v_titles_pl[v_i] || ' - to jedna z kluczowych debat Nowej Europy. '
          || 'Poniższa analiza porządkuje fakty, interesy stron i możliwe scenariusze.</p>'
          || '<h2>Kontekst</h2><p>Materiał seedowy do środowiska deweloperskiego i testów E2E.</p>',
        '<p>' || v_titles_en[v_i] || ' - one of the defining debates of the New Europe. '
          || 'This analysis maps the facts, the actors and the plausible scenarios.</p>'
          || '<h2>Context</h2><p>Seed content for the development environment and the E2E suite.</p>',
        4 + v_i,
        now() - make_interval(days => v_i)
      ) RETURNING id INTO v_post;

      INSERT INTO public.post_categories (post_id, category_id)
      VALUES (v_post, CASE WHEN v_i % 2 = 0 THEN v_cat_gospodarka ELSE v_cat_polityka END)
      ON CONFLICT DO NOTHING;
      INSERT INTO public.post_tags (post_id, tag_id)
      VALUES (v_post, CASE WHEN v_i % 2 = 0 THEN v_tag_energia ELSE v_tag_ue END)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
