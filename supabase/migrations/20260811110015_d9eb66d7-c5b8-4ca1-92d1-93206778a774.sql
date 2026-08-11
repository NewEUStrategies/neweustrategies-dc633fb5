-- 1. Katalog specjalizacji ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_specializations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slug text NOT NULL,
  key text NOT NULL,
  label_pl text NOT NULL,
  label_en text NOT NULL,
  lead_pl text,
  lead_en text,
  desc_pl text,
  desc_en text,
  icon text NOT NULL DEFAULT 'Globe2',
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS club_specializations_tenant_slug_key
  ON public.club_specializations (tenant_id, slug);
CREATE INDEX IF NOT EXISTS club_specializations_tenant_sort_idx
  ON public.club_specializations (tenant_id, sort_order, slug);

GRANT SELECT ON public.club_specializations TO anon, authenticated;
GRANT ALL ON public.club_specializations TO service_role;

ALTER TABLE public.club_specializations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS club_specializations_public_read ON public.club_specializations;
CREATE POLICY club_specializations_public_read
  ON public.club_specializations FOR SELECT TO anon, authenticated
  USING (is_active AND tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id()));

DROP TRIGGER IF EXISTS club_specializations_updated_at ON public.club_specializations;
CREATE TRIGGER club_specializations_updated_at
  BEFORE UPDATE ON public.club_specializations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Powiazanie klubu ze specjalizacja ---------------------------------------
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS specialization_slug text;
CREATE INDEX IF NOT EXISTS clubs_specialization_idx
  ON public.clubs (tenant_id, specialization_slug);

-- 3. Seed osmiu specjalizacji dla tenanta publicznego ------------------------
INSERT INTO public.club_specializations
  (tenant_id, slug, key, label_pl, label_en, lead_pl, lead_en, desc_pl, desc_en, icon, sort_order, is_system)
VALUES
  (public.public_tenant_id(), 'defence-geopolitics', 'defence',
   'Wojskowość i Geopolityka', 'Defence and Geopolitics',
   'Architektura bezpieczeństwa Europy, odstraszanie i układ sił.',
   'Europe''s security architecture, deterrence and the balance of power.',
   'Klub dla osób, które zawodowo czytają budżety obronne, doktryny i rozmieszczenie sił.',
   'For people who read defence budgets, doctrine and force posture for a living.',
   'Globe2', 10, true),
  (public.public_tenant_id(), 'finance-economy', 'finance',
   'Finanse i Gospodarka', 'Finance and Economy',
   'Kapitał, polityka fiskalna i konkurencyjność europejskich gospodarek.',
   'Capital, fiscal policy and the competitiveness of European economies.',
   'Decyzje monetarne i fiskalne, unia rynków kapitałowych, inwestycje i polityka przemysłowa.',
   'Monetary and fiscal decisions, capital markets union, investment and industrial policy.',
   'Building2', 20, true),
  (public.public_tenant_id(), 'transport', 'transport',
   'Transport', 'Transport',
   'Korytarze, logistyka i infrastruktura europejskiej mobilności.',
   'Corridors, logistics and the infrastructure of European mobility.',
   'Kolej, drogi, porty, lotnictwo i mobilność wojskowa.',
   'Rail, roads, ports, aviation and military mobility.',
   'Ship', 30, true),
  (public.public_tenant_id(), 'energy', 'energy',
   'Energetyka', 'Energy',
   'Bezpieczeństwo dostaw, transformacja i cena energii.',
   'Security of supply, the transition and the price of energy.',
   'Wytwarzanie, atom, gaz i OZE, sieci i dyplomacja energetyczna.',
   'Generation, nuclear, gas and renewables, grids and energy diplomacy.',
   'Zap', 40, true),
  (public.public_tenant_id(), 'technology-cybersecurity', 'technology',
   'Technologia i Cyberbezpieczeństwo', 'Technology and Cybersecurity',
   'Suwerenność cyfrowa, AI i odporność systemów krytycznych.',
   'Digital sovereignty, AI and the resilience of critical systems.',
   'Regulacja AI, zagrożenia cybernetyczne, dane i chmura, półprzewodniki.',
   'AI regulation, cyber threats, data and cloud, semiconductors.',
   'Cpu', 50, true),
  (public.public_tenant_id(), 'diplomacy-international-relations', 'diplomacy',
   'Dyplomacja i Stosunki międzynarodowe', 'Diplomacy and International Relations',
   'Sojusze, rozszerzenie i wpływ Europy w świecie.',
   'Alliances, enlargement and Europe''s influence in the world.',
   'Rozszerzenie UE i NATO, relacje transatlantyckie, sankcje i dyplomacja wielostronna.',
   'EU and NATO enlargement, transatlantic relations, sanctions and multilateral diplomacy.',
   'Landmark', 60, true),
  (public.public_tenant_id(), 'legislation', 'legislation',
   'Legislacja', 'Legislation',
   'Stanowienie prawa, compliance i praktyka regulacyjna.',
   'Lawmaking, compliance and regulatory practice.',
   'Proces legislacyjny krajowy i unijny, ocena skutków regulacji, wdrażanie dyrektyw.',
   'National and EU lawmaking, impact assessment and implementation of directives.',
   'Scale', 70, true),
  (public.public_tenant_id(), 'culture-history-policy', 'culture',
   'Polityka kulturalna i historyczna', 'Culture and History Policy',
   'Narracja, pamięć i miękka siła państwa.',
   'Narrative, memory and the soft power of the state.',
   'Polityka historyczna, dyplomacja kulturalna, media i dezinformacja.',
   'History policy, cultural diplomacy, media and disinformation.',
   'Palette', 80, true)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- 4. Odczyt publiczny --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_specializations_public()
RETURNS TABLE(
  slug text, key text, label_pl text, label_en text,
  lead_pl text, lead_en text, desc_pl text, desc_en text,
  icon text, sort_order integer, club_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH scope AS (
    SELECT COALESCE(public._caller_tenant(), public.public_tenant_id()) AS tenant_id
  )
  SELECT s.slug, s.key, s.label_pl, s.label_en,
         s.lead_pl, s.lead_en, s.desc_pl, s.desc_en,
         s.icon, s.sort_order,
         (
           SELECT count(*)::integer FROM public.clubs c
           WHERE c.tenant_id = s.tenant_id
             AND c.status = 'active'
             AND c.specialization_slug = s.slug
             AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
         ) AS club_count
  FROM public.club_specializations s
  CROSS JOIN scope sc
  WHERE s.is_active AND s.tenant_id = sc.tenant_id
  ORDER BY s.sort_order, s.slug;
$$;

REVOKE ALL ON FUNCTION public.club_specializations_public() FROM public;
GRANT EXECUTE ON FUNCTION public.club_specializations_public() TO anon, authenticated, service_role;

-- 5. Kluby w specjalizacji ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_list_by_specialization(
  p_slug text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text,
  icon text, accent_color text, cover_image_url text, visibility text, join_policy text,
  min_tier_rank integer, policy_area text, specialization_slug text, status text,
  member_count integer, group_count integer, thread_count integer,
  last_activity_at timestamptz, my_role text, my_status text, can_read boolean,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH scope AS (
    SELECT COALESCE(public._caller_tenant(), public.public_tenant_id()) AS tenant_id
  ),
  visible AS (
    SELECT
      c.id, c.slug, c.name_pl, c.name_en, c.tagline_pl, c.tagline_en, c.icon, c.accent_color,
      c.cover_image_url, c.visibility, c.join_policy, c.min_tier_rank, c.policy_area,
      c.specialization_slug, c.status,
      c.member_count, c.group_count, c.thread_count, c.last_activity_at,
      public.club_effective_member_role(m.role, m.role_expires_at) AS my_role,
      m.status AS my_status,
      cap.can_read,
      (m.user_id IS NOT NULL) AS is_mine
    FROM public.clubs c
    CROSS JOIN scope s
    LEFT JOIN public.club_members m
      ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
    CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) cap
    WHERE c.tenant_id = s.tenant_id
      AND c.status = 'active'
      AND c.specialization_slug = btrim(p_slug)
      AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
  )
  SELECT
    v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en, v.icon, v.accent_color,
    v.cover_image_url, v.visibility, v.join_policy, v.min_tier_rank, v.policy_area,
    v.specialization_slug, v.status,
    v.member_count, v.group_count, v.thread_count, v.last_activity_at,
    v.my_role, v.my_status, v.can_read,
    count(*) OVER () AS total_count
  FROM visible v
  ORDER BY v.is_mine DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC
  LIMIT GREATEST(COALESCE(p_limit, 60), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE ALL ON FUNCTION public.club_list_by_specialization(text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.club_list_by_specialization(text, integer, integer)
  TO anon, authenticated, service_role;

-- 6. Panel administracyjny ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_specializations_list()
RETURNS TABLE(
  id uuid, slug text, key text, label_pl text, label_en text,
  lead_pl text, lead_en text, desc_pl text, desc_en text,
  icon text, sort_order integer, is_active boolean, is_system boolean,
  clubs_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.id, s.slug, s.key, s.label_pl, s.label_en, s.lead_pl, s.lead_en,
         s.desc_pl, s.desc_en, s.icon, s.sort_order, s.is_active, s.is_system,
         (SELECT count(*)::integer FROM public.clubs c
           WHERE c.tenant_id = s.tenant_id AND c.specialization_slug = s.slug) AS clubs_count
  FROM public.club_specializations s
  WHERE s.tenant_id = public.assert_admin_tenant()
  ORDER BY s.sort_order, s.slug;
$$;

REVOKE ALL ON FUNCTION public.admin_club_specializations_list() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_specializations_list() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_club_specialization_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_slug text := lower(btrim(COALESCE(p_payload->>'slug', '')));
  v_key text := lower(btrim(COALESCE(NULLIF(p_payload->>'key', ''), v_slug)));
  v_old_slug text;
BEGIN
  IF v_id IS NULL AND (v_slug !~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$') THEN
    RAISE EXCEPTION 'invalid_slug: slug is required';
  END IF;
  IF NULLIF(btrim(COALESCE(p_payload->>'label_pl', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_payload->>'label_en', '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_labels: both labels are required';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT s.slug INTO v_old_slug FROM public.club_specializations s
     WHERE s.id = v_id AND s.tenant_id = v_tenant;
    IF v_old_slug IS NULL THEN
      RAISE EXCEPTION 'not_found: specialization does not exist in this tenant';
    END IF;

    UPDATE public.club_specializations SET
      slug = CASE WHEN v_slug = '' THEN slug ELSE v_slug END,
      key = CASE WHEN v_key = '' THEN key ELSE v_key END,
      label_pl = btrim(p_payload->>'label_pl'),
      label_en = btrim(p_payload->>'label_en'),
      lead_pl = NULLIF(btrim(COALESCE(p_payload->>'lead_pl', '')), ''),
      lead_en = NULLIF(btrim(COALESCE(p_payload->>'lead_en', '')), ''),
      desc_pl = NULLIF(btrim(COALESCE(p_payload->>'desc_pl', '')), ''),
      desc_en = NULLIF(btrim(COALESCE(p_payload->>'desc_en', '')), ''),
      icon = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'icon', '')), ''), icon),
      sort_order = COALESCE((p_payload->>'sort_order')::integer, sort_order),
      is_active = COALESCE((p_payload->>'is_active')::boolean, is_active)
    WHERE id = v_id;

    -- Zmiana adresu nie moze osierocic klubow przypisanych do specjalizacji.
    IF v_slug <> '' AND v_slug <> v_old_slug THEN
      UPDATE public.clubs SET specialization_slug = v_slug
       WHERE tenant_id = v_tenant AND specialization_slug = v_old_slug;
    END IF;

    RETURN v_id;
  END IF;

  INSERT INTO public.club_specializations (
    tenant_id, slug, key, label_pl, label_en, lead_pl, lead_en, desc_pl, desc_en,
    icon, sort_order, is_active, is_system
  ) VALUES (
    v_tenant, v_slug, v_key,
    btrim(p_payload->>'label_pl'), btrim(p_payload->>'label_en'),
    NULLIF(btrim(COALESCE(p_payload->>'lead_pl', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'lead_en', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'desc_pl', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'desc_en', '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_payload->>'icon', '')), ''), 'Globe2'),
    COALESCE((p_payload->>'sort_order')::integer, 100),
    COALESCE((p_payload->>'is_active')::boolean, true),
    false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_club_specialization_upsert(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_specialization_upsert(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_club_specialization_set_active(_id uuid, _is_active boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
BEGIN
  UPDATE public.club_specializations SET is_active = _is_active
   WHERE id = _id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: specialization does not exist in this tenant';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_club_specialization_set_active(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_specialization_set_active(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_club_specialization_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_slug text;
  v_used integer;
BEGIN
  SELECT s.slug INTO v_slug FROM public.club_specializations s
   WHERE s.id = _id AND s.tenant_id = v_tenant;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'not_found: specialization does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used FROM public.clubs c
   WHERE c.tenant_id = v_tenant AND c.specialization_slug = v_slug;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'in_use: specialization is assigned to % club(s)', v_used;
  END IF;

  DELETE FROM public.club_specializations WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_club_specialization_delete(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_specialization_delete(uuid) TO authenticated, service_role;