-- Raport dla sponsorow: wyswietlenia, klikniecia, zebrane kontakty (funkcja f6).
-- Blizniak: supabase/migrations/20260926140000_event_sponsor_report.sql (tam pelny naglowek).

-- ----------------------------------------------------------------------------
-- 1) REKLAMA STRONY GLOWNEJ PRZYPIETA DO SPONSORA
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_home_ads ADD COLUMN IF NOT EXISTS sponsor_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_home_ads'::regclass
       AND conname = 'event_home_ads_tenant_id_key'
  ) THEN
    ALTER TABLE public.event_home_ads
      ADD CONSTRAINT event_home_ads_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_home_ads'::regclass
       AND conname = 'event_home_ads_sponsor_fk'
  ) THEN
    ALTER TABLE public.event_home_ads
      ADD CONSTRAINT event_home_ads_sponsor_fk
      FOREIGN KEY (tenant_id, event_id, sponsor_id)
      REFERENCES public.event_sponsors (tenant_id, event_id, id)
      ON DELETE SET NULL (sponsor_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_home_ads_sponsor_idx
  ON public.event_home_ads (tenant_id, event_id, sponsor_id)
  WHERE sponsor_id IS NOT NULL;

COMMENT ON COLUMN public.event_home_ads.sponsor_id IS
  'Sponsor TEGO wydarzenia, ktorego reklama dotyczy (opcjonalnie). Z niego raport sponsora przypisuje wyswietlenia i klikniecia reklamy. Usuniecie przypiecia sponsora zeruje tylko te kolumne.';

-- ----------------------------------------------------------------------------
-- 2) EKSPOZYCJE SPONSOROW (tabela intake)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_exposures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid,
  placement text NOT NULL,
  kind text NOT NULL,
  material_id uuid,
  home_ad_id uuid,
  day date NOT NULL,
  session_hash text NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_exposures_placement_values
    CHECK (placement IN ('home_strip', 'partners_section', 'partners_tab', 'agenda_session', 'agenda_track', 'materials', 'home_ad')),
  CONSTRAINT event_sponsor_exposures_kind_values
    CHECK (kind IN ('view', 'click', 'material_open')),
  CONSTRAINT event_sponsor_exposures_sponsor_required
    CHECK (sponsor_id IS NOT NULL OR placement = 'home_ad'),
  CONSTRAINT event_sponsor_exposures_material_pair
    CHECK ((kind = 'material_open') = (material_id IS NOT NULL)
           AND (kind <> 'material_open' OR placement = 'materials')),
  CONSTRAINT event_sponsor_exposures_home_ad_pair
    CHECK ((placement = 'home_ad') = (home_ad_id IS NOT NULL)),
  CONSTRAINT event_sponsor_exposures_agenda_views_only
    CHECK (placement NOT IN ('agenda_session', 'agenda_track') OR kind = 'view'),
  CONSTRAINT event_sponsor_exposures_hash_shape CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT event_sponsor_exposures_hits_range CHECK (hits BETWEEN 1 AND 500),
  CONSTRAINT event_sponsor_exposures_time_order CHECK (last_at >= first_at),
  CONSTRAINT event_sponsor_exposures_dedup UNIQUE NULLS NOT DISTINCT
    (tenant_id, event_id, sponsor_id, placement, kind, material_id, home_ad_id, day, session_hash),
  CONSTRAINT event_sponsor_exposures_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_exposures_sponsor_fk FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_exposures_material_fk FOREIGN KEY (tenant_id, material_id)
    REFERENCES public.event_sponsor_materials (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_exposures_home_ad_fk FOREIGN KEY (tenant_id, home_ad_id)
    REFERENCES public.event_home_ads (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_exposures IS
  'Pomiar ekspozycji sponsorow na stronie wydarzenia (tabela intake). Wiersz = sesja x sponsor x miejsce x rodzaj x material/reklama x dzien w strefie wydarzenia; powtorzenia podbijaja hits. Zapis WYLACZNIE przez event_sponsor_exposure_ingest (service_role, endpoint /api/public/sponsor-event po zgodzie marketingowej). Brak IP, UA i uzytkownika.';
COMMENT ON COLUMN public.event_sponsor_exposures.session_hash IS
  'sha256(najemca:wydarzenie:sesja:dzien) - surowy identyfikator sesji nigdy nie trafia do bazy, a skrot nie laczy tej samej osoby miedzy dniami ani wydarzeniami.';
COMMENT ON COLUMN public.event_sponsor_exposures.sponsor_id IS
  'Sponsor wydarzenia. NULL wylacznie dla reklamy strony glownej bez przypietego sponsora (liczniki reklamy w panelu, bez przypisania w raporcie).';
COMMENT ON COLUMN public.event_sponsor_exposures.hits IS
  'Liczba trafien w obrebie wiersza (lacznie z pierwszym), z limitem 500 - miara laczna obok unikalnej (liczba wierszy).';

CREATE INDEX IF NOT EXISTS event_sponsor_exposures_event_day_idx
  ON public.event_sponsor_exposures (tenant_id, event_id, day);
CREATE INDEX IF NOT EXISTS event_sponsor_exposures_sponsor_day_idx
  ON public.event_sponsor_exposures (tenant_id, sponsor_id, day)
  WHERE sponsor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_sponsor_exposures_home_ad_idx
  ON public.event_sponsor_exposures (tenant_id, home_ad_id)
  WHERE home_ad_id IS NOT NULL;

REVOKE ALL ON public.event_sponsor_exposures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_sponsor_exposures TO service_role;
ALTER TABLE public.event_sponsor_exposures ENABLE ROW LEVEL SECURITY;
-- Brak polityk: tabela nie ma zadnej drogi klienckiej, odczyt przez RPC panelu.

-- ----------------------------------------------------------------------------
-- 3) LINKI RAPORTU DLA SPONSORA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_report_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid NOT NULL,
  label text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  include_leads boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_report_links_label_len
    CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
  CONSTRAINT event_sponsor_report_links_token_shape CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT event_sponsor_report_links_prefix_shape CHECK (token_prefix ~ '^[A-Za-z0-9_-]{8}$'),
  CONSTRAINT event_sponsor_report_links_view_count_positive CHECK (view_count >= 0),
  CONSTRAINT event_sponsor_report_links_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT event_sponsor_report_links_token_unique UNIQUE (tenant_id, token_hash),
  CONSTRAINT event_sponsor_report_links_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsor_report_links_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_report_links_sponsor_fk FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_report_links IS
  'Linki raportu dla sponsora bez konta. Token jawny wraca DOKLADNIE RAZ (admin_event_sponsor_report_link_issue); w tabeli jest tylko sha256 i prefiks. Odczyt po tokenie wylacznie przez event_sponsor_report_for_token (service_role). Brak polityk i grantow klienckich.';
COMMENT ON COLUMN public.event_sponsor_report_links.include_leads IS
  'Czy link oddaje liste zebranych kontaktow. Domyslnie NIE; kontakt tylko przy zywej zgodzie na przekazanie partnerowi.';

CREATE INDEX IF NOT EXISTS event_sponsor_report_links_sponsor_idx
  ON public.event_sponsor_report_links (tenant_id, event_id, sponsor_id, created_at DESC);

DROP TRIGGER IF EXISTS event_sponsor_report_links_touch_updated_at ON public.event_sponsor_report_links;
CREATE TRIGGER event_sponsor_report_links_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_report_links
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

REVOKE ALL ON public.event_sponsor_report_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_sponsor_report_links TO service_role;
ALTER TABLE public.event_sponsor_report_links ENABLE ROW LEVEL SECURITY;
-- Brak polityk: tabela trzyma skroty poswiadczen, odczyt wylacznie przez RPC.

-- ----------------------------------------------------------------------------
-- 4) NAPRAWA: REKLAMY STRONY GLOWNEJ DLA GOSCIA (public_tenant_id)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_home_ads_for_viewer(text);
CREATE FUNCTION public.event_home_ads_for_viewer(p_slug text)
RETURNS TABLE(id uuid, image_url text, image_mobile_url text, link_url text, alt_text text, sponsor_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.image_url, a.image_mobile_url, a.link_url, a.alt_text, a.sponsor_id
    FROM public.events ev
    JOIN public.event_home_ads a ON a.event_id = ev.id AND a.tenant_id = ev.tenant_id
   WHERE ev.slug = p_slug AND ev.status <> 'draft'
     AND ev.tenant_id = public.public_tenant_id()
     AND a.is_active
     AND (a.starts_at IS NULL OR a.starts_at <= now())
     AND (a.ends_at IS NULL OR a.ends_at > now())
     AND (cardinality(a.group_ids) = 0 OR EXISTS (
       SELECT 1 FROM public.event_group_members m
         JOIN public.event_people p ON p.id = m.person_id AND p.tenant_id = m.tenant_id
        WHERE m.tenant_id = ev.tenant_id AND m.event_id = ev.id AND m.group_id = ANY(a.group_ids)
          AND auth.uid() IS NOT NULL AND p.user_id = auth.uid()))
   ORDER BY random()
   LIMIT 5;
$$;

REVOKE ALL ON FUNCTION public.event_home_ads_for_viewer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_home_ads_for_viewer(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_home_ads_for_viewer(text) IS
  'Reklamy strony glownej wydarzenia dla ogladajacego (maks. 5, losowo). Najemca z naglowka hosta (public_tenant_id) - gosc bez konta tez je widzi. Reklama grupowa tylko dla czlonkow grupy. Plaszczyzna tresci - zero has_role().';

CREATE OR REPLACE FUNCTION public.event_home_ad_track(p_ad_id uuid, p_kind text, p_session text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF p_kind NOT IN ('view', 'click') OR p_session IS NULL OR length(p_session) NOT BETWEEN 8 AND 128 THEN
    RETURN false;
  END IF;
  SELECT a.tenant_id INTO v_tenant
    FROM public.event_home_ads a
    JOIN public.events ev ON ev.id = a.event_id AND ev.tenant_id = a.tenant_id
   WHERE a.id = p_ad_id AND a.is_active
     AND ev.status <> 'draft'
     AND a.tenant_id = public.public_tenant_id();
  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.event_home_ad_events (tenant_id, ad_id, kind, session_hash)
  VALUES (v_tenant, p_ad_id, p_kind, md5(p_session))
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.event_home_ad_track(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_home_ad_track(uuid, text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_home_ad_track(uuid, text, text) IS
  'PRZESTARZALE (starsze klienty w cache): licznik reklamy strony glownej per sesja i dobe UTC. Najemca z naglowka hosta (public_tenant_id). Nowy front mierzy reklame przez /api/public/sponsor-event (event_sponsor_exposures) po zgodzie marketingowej.';

-- ----------------------------------------------------------------------------
-- 5) NAPRAWA: LINK LOGOTYPU NA STRONIE PUBLICZNEJ
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_sponsors_public(p_slug text)
RETURNS TABLE (
  tier_id uuid,
  tier_key text,
  tier_name_pl text,
  tier_name_en text,
  tier_description_pl text,
  tier_description_en text,
  tier_rank integer,
  tier_accent_color text,
  tier_logo_size text,
  benefits jsonb,
  sponsors jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH grouped AS (
    SELECT
      s.tier_id AS gid,
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.snapshot_name,
          'logo', COALESCE(s.snapshot_logo_url, ''),
          'url', COALESCE(s.snapshot_website, ''),
          'link_mode', s.link_mode,
          'link_url', s.link_url,
          'description_pl', s.snapshot_description_pl,
          'description_en', s.snapshot_description_en,
          'country', s.snapshot_country,
          'role', s.role,
          'booth_label', s.booth_label,
          'sort_order', s.sort_order
        ) ORDER BY s.sort_order, s.snapshot_name
      ) AS items
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant
      AND s.event_id = v_event_id
      AND s.is_published
    GROUP BY s.tier_id
  )
  SELECT
    g.gid,
    t.key,
    t.name_pl,
    t.name_en,
    t.description_pl,
    t.description_en,
    t.rank,
    t.accent_color,
    COALESCE(t.logo_size, 'md'),
    COALESCE(b.items, '[]'::jsonb),
    g.items
  FROM grouped g
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = g.gid AND t.tenant_id = v_tenant
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', bn.id,
        'label_pl', bn.label_pl,
        'label_en', bn.label_en
      ) ORDER BY bn.sort_order, bn.label_pl
    ) AS items
    FROM public.event_sponsor_tier_benefits bn
    WHERE bn.tenant_id = v_tenant AND bn.tier_id = g.gid
  ) b ON true
  ORDER BY t.rank DESC NULLS LAST, t.sort_order NULLS LAST, t.key NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsors_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sponsors_public(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sponsors_public(text) IS
  'Publiczna lista sponsorow opublikowanego wydarzenia po slugu, pogrupowana po poziomie (grupa bez poziomu na koncu), tylko opublikowane przypiecia, w najemcy z naglowka hosta. Oddaje MIGAWKE i ustawienie linku logotypu (link_mode, link_url), nigdy biezacej kartoteki. Plaszczyzna tresci - zero has_role().';

-- ----------------------------------------------------------------------------
-- 6) PANEL REKLAM: SPONSOR REKLAMY I LICZNIKI Z OBU TABEL
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_home_ad_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_event uuid := nullif(p_payload->>'event_id', '')::uuid;
  v_groups uuid[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'group_ids', '[]'::jsonb))::uuid), '{}');
  v_has_sponsor boolean := p_payload ? 'sponsor_id';
  v_sponsor uuid := nullif(p_payload->>'sponsor_id', '')::uuid;
BEGIN
  IF v_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event AND e.tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'event_not_found';
    END IF;
  ELSE
    SELECT a.event_id INTO v_event FROM public.event_home_ads a WHERE a.id = v_id AND a.tenant_id = v_tenant;
    IF v_event IS NULL THEN RAISE EXCEPTION 'ad_not_found'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_groups) g WHERE NOT EXISTS
      (SELECT 1 FROM public.event_groups eg WHERE eg.id = g AND eg.event_id = v_event AND eg.tenant_id = v_tenant)) THEN
    RAISE EXCEPTION 'invalid_group';
  END IF;
  IF v_sponsor IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_event AND s.id = v_sponsor
  ) THEN
    RAISE EXCEPTION 'sponsor_not_in_event: the sponsor belongs to another event';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.event_home_ads(tenant_id, event_id, image_url, image_mobile_url, link_url, alt_text,
      group_ids, starts_at, ends_at, is_active, sort_order, created_by, sponsor_id)
    VALUES (v_tenant, v_event, p_payload->>'image_url', nullif(p_payload->>'image_mobile_url', ''),
      nullif(p_payload->>'link_url', ''), COALESCE(p_payload->>'alt_text', ''), v_groups,
      nullif(p_payload->>'starts_at', '')::timestamptz, nullif(p_payload->>'ends_at', '')::timestamptz,
      COALESCE((p_payload->>'is_active')::boolean, true), COALESCE((p_payload->>'sort_order')::int, 0), auth.uid(),
      v_sponsor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_home_ads SET
      image_url = p_payload->>'image_url',
      image_mobile_url = nullif(p_payload->>'image_mobile_url', ''),
      link_url = nullif(p_payload->>'link_url', ''),
      alt_text = COALESCE(p_payload->>'alt_text', ''),
      group_ids = v_groups,
      starts_at = nullif(p_payload->>'starts_at', '')::timestamptz,
      ends_at = nullif(p_payload->>'ends_at', '')::timestamptz,
      is_active = COALESCE((p_payload->>'is_active')::boolean, is_active),
      sponsor_id = CASE WHEN v_has_sponsor THEN v_sponsor ELSE sponsor_id END,
      updated_at = now()
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_home_ad_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_home_ad_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_home_ad_save(jsonb) IS
  'Zapis reklamy strony glownej wydarzenia. sponsor_id: klucz pominiety = bez zmian, null = odepnij, uuid = sponsor TEGO wydarzenia (inaczej sponsor_not_in_event). Bramka: assert_event_admin_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_home_ads_list(uuid);
CREATE FUNCTION public.admin_event_home_ads_list(p_event_id uuid)
RETURNS TABLE(id uuid, image_url text, image_mobile_url text, link_url text, alt_text text,
  group_ids uuid[], starts_at timestamptz, ends_at timestamptz, is_active boolean, sort_order integer,
  views bigint, clicks bigint, sponsor_id uuid, sponsor_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT a.id, a.image_url, a.image_mobile_url, a.link_url, a.alt_text, a.group_ids, a.starts_at, a.ends_at,
         a.is_active, a.sort_order,
         (SELECT count(*) FROM public.event_home_ad_events e
           WHERE e.ad_id = a.id AND e.tenant_id = v_tenant AND e.kind = 'view')
         + (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.home_ad_id = a.id AND x.kind = 'view'),
         (SELECT count(*) FROM public.event_home_ad_events e
           WHERE e.ad_id = a.id AND e.tenant_id = v_tenant AND e.kind = 'click')
         + (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.home_ad_id = a.id AND x.kind = 'click'),
         a.sponsor_id,
         s.snapshot_name
    FROM public.event_home_ads a
    LEFT JOIN public.event_sponsors s
      ON s.tenant_id = a.tenant_id AND s.event_id = a.event_id AND s.id = a.sponsor_id
   WHERE a.event_id = p_event_id AND a.tenant_id = v_tenant
   ORDER BY a.sort_order, a.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_home_ads_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_home_ads_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_home_ads_list(uuid) IS
  'Reklamy strony glownej wydarzenia z przypietym sponsorem i licznikami (unikalne sesje x doba) z obu zrodel: event_home_ad_events (starsze) i event_sponsor_exposures (placement home_ad). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 7) ZAPIS EKSPOZYCJI (service_role; endpoint /api/public/sponsor-event)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_sponsor_exposure_ingest(p_tenant uuid, p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_session text := btrim(COALESCE(p_payload->>'session', ''));
  v_slug text := btrim(COALESCE(p_payload->>'event_slug', ''));
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_event_id uuid;
  v_tz text;
  v_day date;
  v_hash text;
  v_count integer := 0;
BEGIN
  IF p_tenant IS NULL
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
     OR v_session !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN 0;
  END IF;

  SELECT e.id, e.timezone INTO v_event_id, v_tz
    FROM public.events e
   WHERE e.tenant_id = p_tenant AND e.slug = v_slug AND e.status = 'published';
  IF v_event_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Dzien liczymy w STREFIE WYDARZENIA: raport czyta "drugi dzien kongresu",
  -- a nie dobe UTC, ktora w Warszawie konczy sie o pierwszej w nocy.
  v_day := (now() AT TIME ZONE v_tz)::date;
  v_hash := encode(
    digest(p_tenant::text || ':' || v_event_id::text || ':' || v_session || ':' || v_day::text, 'sha256'),
    'hex'
  );

  WITH raw AS (
    SELECT i.item
      FROM jsonb_array_elements(p_payload->'items') WITH ORDINALITY AS i(item, ord)
     WHERE i.ord <= 40 AND jsonb_typeof(i.item) = 'object'
  ), parsed AS (
    SELECT
      CASE WHEN lower(r.item->>'sponsor_id') ~ v_uuid THEN (r.item->>'sponsor_id')::uuid END AS sid,
      r.item->>'placement' AS placement,
      r.item->>'kind' AS kind,
      CASE WHEN lower(r.item->>'material_id') ~ v_uuid THEN (r.item->>'material_id')::uuid END AS mid,
      CASE WHEN lower(r.item->>'home_ad_id') ~ v_uuid THEN (r.item->>'home_ad_id')::uuid END AS aid
      FROM raw r
  ), resolved AS (
    -- Reklama: sponsora bierzemy z WIERSZA REKLAMY, nie od klienta.
    SELECT a.sponsor_id AS sid, p.placement, p.kind, NULL::uuid AS mid, a.id AS aid
      FROM parsed p
      JOIN public.event_home_ads a
        ON a.tenant_id = p_tenant AND a.event_id = v_event_id AND a.id = p.aid
       AND a.is_active
       AND (a.starts_at IS NULL OR a.starts_at <= now())
       AND (a.ends_at IS NULL OR a.ends_at > now())
     WHERE p.placement = 'home_ad' AND p.kind IN ('view', 'click') AND p.mid IS NULL
    UNION ALL
    SELECT p.sid, p.placement, p.kind, p.mid, NULL::uuid
      FROM parsed p
      JOIN public.event_sponsors s
        ON s.tenant_id = p_tenant AND s.event_id = v_event_id AND s.id = p.sid AND s.is_published
     WHERE p.aid IS NULL
       AND (
         (p.placement IN ('home_strip', 'partners_section', 'partners_tab')
           AND p.kind IN ('view', 'click') AND p.mid IS NULL)
         OR (p.placement = 'agenda_session' AND p.kind = 'view' AND p.mid IS NULL
           AND EXISTS (SELECT 1 FROM public.event_sessions es
                        WHERE es.tenant_id = p_tenant AND es.event_id = v_event_id
                          AND es.sponsor_id = p.sid))
         OR (p.placement = 'agenda_track' AND p.kind = 'view' AND p.mid IS NULL
           AND EXISTS (SELECT 1 FROM public.event_tracks et
                        WHERE et.tenant_id = p_tenant AND et.event_id = v_event_id
                          AND et.sponsor_id = p.sid))
         OR (p.placement = 'materials' AND p.kind = 'view' AND p.mid IS NULL)
         OR (p.placement = 'materials' AND p.kind = 'material_open'
           AND EXISTS (SELECT 1 FROM public.event_sponsor_materials m
                        WHERE m.tenant_id = p_tenant AND m.event_id = v_event_id
                          AND m.sponsor_id = p.sid AND m.id = p.mid AND m.is_published))
       )
  ), grouped AS (
    SELECT r.sid, r.placement, r.kind, r.mid, r.aid, count(*)::integer AS n
      FROM resolved r
     GROUP BY r.sid, r.placement, r.kind, r.mid, r.aid
  )
  INSERT INTO public.event_sponsor_exposures AS x (
    tenant_id, event_id, sponsor_id, placement, kind, material_id, home_ad_id, day, session_hash, hits
  )
  SELECT p_tenant, v_event_id, g.sid, g.placement, g.kind, g.mid, g.aid, v_day, v_hash, LEAST(g.n, 500)
    FROM grouped g
  ON CONFLICT ON CONSTRAINT event_sponsor_exposures_dedup
  DO UPDATE SET hits = LEAST(x.hits + EXCLUDED.hits, 500), last_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsor_exposure_ingest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_sponsor_exposure_ingest(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_sponsor_exposure_ingest(uuid, jsonb) IS
  'Zapis paczki ekspozycji sponsorow: {event_slug, session, items:[{sponsor_id, placement, kind, material_id?, home_ad_id?}]} (maks. 40). Wylacznie service_role - najemce podaje endpoint z zaufanego hosta. Kazda pozycja jest weryfikowana wzgledem TEGO opublikowanego wydarzenia; nieznane, cudze i nieopublikowane sa pomijane bez bledu. Zwraca liczbe zapisanych/podbitych wierszy.';

CREATE OR REPLACE FUNCTION public.event_sponsor_exposures_prune(p_keep_days integer DEFAULT 400)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.event_sponsor_exposures x
   WHERE x.day < (now() - make_interval(days => GREATEST(COALESCE(p_keep_days, 400), 30)))::date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsor_exposures_prune(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_sponsor_exposures_prune(integer) TO service_role;

COMMENT ON FUNCTION public.event_sponsor_exposures_prune(integer) IS
  'Retencja ekspozycji sponsorow: usuwa dni starsze niz p_keep_days (domyslnie 400, minimum 30). Harmonogram: pg_cron raz na dobe (35 3 * * *), zakladany przy wdrozeniu.';

-- ----------------------------------------------------------------------------
-- 8) RAPORT W STUDIU (plaszczyzna panelu)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_sponsor_report_assert_filters(
  p_from date,
  p_to date,
  p_placement text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'invalid_range: the start day is after the end day';
  END IF;
  IF p_placement IS NOT NULL AND p_placement NOT IN (
    'home_strip', 'partners_section', 'partners_tab', 'agenda_session', 'agenda_track', 'materials', 'home_ad'
  ) THEN
    RAISE EXCEPTION 'invalid_placement: % is not a sponsor placement', p_placement;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._event_sponsor_report_assert_filters(date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_sponsor_report_assert_filters(date, date, text) TO service_role;

COMMENT ON FUNCTION public._event_sponsor_report_assert_filters(date, date, text) IS
  'Walidacja filtrow raportu sponsora (kolejnosc dni, znane miejsce ekspozycji). Wolana z funkcji panelu.';

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_summary(
  p_event_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_placement text DEFAULT NULL
)
RETURNS TABLE (
  sponsor_id uuid,
  company_id uuid,
  sponsor_name text,
  sponsor_logo_url text,
  role text,
  tier_id uuid,
  tier_name_pl text,
  tier_name_en text,
  tier_rank integer,
  is_published boolean,
  views_unique integer,
  views_total integer,
  clicks_unique integer,
  clicks_total integer,
  material_opens integer,
  leads_total integer,
  leads_consented integer,
  lead_scans_total integer,
  leads_avg_rating numeric,
  meetings_total integer,
  meetings_accepted integer,
  meetings_held integer,
  active_links integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
BEGIN
  PERFORM public._event_sponsor_report_assert_filters(p_from, p_to, p_placement);

  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = p_event_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  WITH ex AS (
    SELECT x.sponsor_id AS sid,
           count(*) FILTER (WHERE x.kind = 'view')::integer AS vu,
           COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0)::integer AS vt,
           count(*) FILTER (WHERE x.kind = 'click')::integer AS cu,
           COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0)::integer AS ct,
           count(*) FILTER (WHERE x.kind = 'material_open')::integer AS mo
      FROM public.event_sponsor_exposures x
     WHERE x.tenant_id = v_tenant AND x.event_id = p_event_id AND x.sponsor_id IS NOT NULL
       AND (p_from IS NULL OR x.day >= p_from)
       AND (p_to IS NULL OR x.day <= p_to)
       AND (p_placement IS NULL OR x.placement = p_placement)
     GROUP BY x.sponsor_id
  ), ld AS (
    SELECT l.sponsor_id AS sid,
           count(*)::integer AS total,
           count(*) FILTER (
             WHERE p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL
           )::integer AS consented,
           COALESCE(sum(l.scan_count), 0)::integer AS scans,
           round(avg(l.interest_rating), 2) AS rating
      FROM public.event_lead_scans l
      JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
     WHERE l.tenant_id = v_tenant AND l.event_id = p_event_id
       AND (p_from IS NULL OR (l.first_scanned_at AT TIME ZONE v_tz)::date >= p_from)
       AND (p_to IS NULL OR (l.first_scanned_at AT TIME ZONE v_tz)::date <= p_to)
     GROUP BY l.sponsor_id
  ), mt AS (
    SELECT m.sponsor_id AS sid,
           count(*) FILTER (WHERE m.status <> 'cancelled')::integer AS total,
           count(*) FILTER (WHERE m.status IN ('accepted', 'rescheduled', 'held', 'no_show'))::integer AS accepted,
           count(*) FILTER (WHERE m.status = 'held')::integer AS held
      FROM public.event_meetings m
     WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id AND m.sponsor_id IS NOT NULL
       AND (p_from IS NULL OR (m.starts_at AT TIME ZONE v_tz)::date >= p_from)
       AND (p_to IS NULL OR (m.starts_at AT TIME ZONE v_tz)::date <= p_to)
     GROUP BY m.sponsor_id
  ), lk AS (
    SELECT k.sponsor_id AS sid, count(*)::integer AS active
      FROM public.event_sponsor_report_links k
     WHERE k.tenant_id = v_tenant AND k.event_id = p_event_id
       AND k.revoked_at IS NULL AND k.expires_at > now()
     GROUP BY k.sponsor_id
  )
  SELECT s.id, s.company_id, s.snapshot_name, s.snapshot_logo_url, s.role,
         s.tier_id, t.name_pl, t.name_en, t.rank, s.is_published,
         COALESCE(ex.vu, 0), COALESCE(ex.vt, 0), COALESCE(ex.cu, 0), COALESCE(ex.ct, 0),
         COALESCE(ex.mo, 0),
         COALESCE(ld.total, 0), COALESCE(ld.consented, 0), COALESCE(ld.scans, 0), ld.rating,
         COALESCE(mt.total, 0), COALESCE(mt.accepted, 0), COALESCE(mt.held, 0),
         COALESCE(lk.active, 0)
    FROM public.event_sponsors s
    LEFT JOIN public.event_sponsor_tiers t ON t.tenant_id = s.tenant_id AND t.id = s.tier_id
    LEFT JOIN ex ON ex.sid = s.id
    LEFT JOIN ld ON ld.sid = s.id
    LEFT JOIN mt ON mt.sid = s.id
    LEFT JOIN lk ON lk.sid = s.id
   WHERE s.tenant_id = v_tenant AND s.event_id = p_event_id
   ORDER BY t.rank DESC NULLS LAST, s.sort_order, s.snapshot_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_summary(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_summary(uuid, date, date, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_summary(uuid, date, date, text) IS
  'Raport sponsorow wydarzenia: wiersz per przypiecie z wyswietleniami i kliknieciami (unikalne = sesja x dzien, lacznie = trafienia), otwarciami materialow, kontaktami ze stoiska (zywa zgoda na przekazanie partnerowi), spotkaniami i aktywnymi linkami. Filtr miejsca dotyczy tylko ekspozycji. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_series(
  p_event_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_sponsor_id uuid DEFAULT NULL,
  p_placement text DEFAULT NULL
)
RETURNS TABLE (
  day date,
  sponsor_id uuid,
  placement text,
  views_unique integer,
  views_total integer,
  clicks_unique integer,
  clicks_total integer,
  material_opens integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  PERFORM public._event_sponsor_report_assert_filters(p_from, p_to, p_placement);

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT x.day, x.sponsor_id, x.placement,
         count(*) FILTER (WHERE x.kind = 'view')::integer,
         COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0)::integer,
         count(*) FILTER (WHERE x.kind = 'click')::integer,
         COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0)::integer,
         count(*) FILTER (WHERE x.kind = 'material_open')::integer
    FROM public.event_sponsor_exposures x
   WHERE x.tenant_id = v_tenant AND x.event_id = p_event_id AND x.sponsor_id IS NOT NULL
     AND (p_from IS NULL OR x.day >= p_from)
     AND (p_to IS NULL OR x.day <= p_to)
     AND (p_sponsor_id IS NULL OR x.sponsor_id = p_sponsor_id)
     AND (p_placement IS NULL OR x.placement = p_placement)
   GROUP BY x.day, x.sponsor_id, x.placement
   ORDER BY x.day, x.sponsor_id, x.placement;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_series(uuid, date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_series(uuid, date, date, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_series(uuid, date, date, uuid, text) IS
  'Szereg dzienny ekspozycji sponsorow wydarzenia (dzien w strefie wydarzenia) per sponsor x miejsce. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_leads_series(
  p_event_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_sponsor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  sponsor_id uuid,
  leads_new integer,
  leads_new_consented integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
BEGIN
  PERFORM public._event_sponsor_report_assert_filters(p_from, p_to, NULL);

  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = p_event_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  WITH d AS (
    SELECT (l.first_scanned_at AT TIME ZONE v_tz)::date AS dday,
           l.sponsor_id AS sid,
           (p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL) AS ok
      FROM public.event_lead_scans l
      JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
     WHERE l.tenant_id = v_tenant AND l.event_id = p_event_id
       AND (p_sponsor_id IS NULL OR l.sponsor_id = p_sponsor_id)
  )
  SELECT d.dday, d.sid, count(*)::integer, count(*) FILTER (WHERE d.ok)::integer
    FROM d
   WHERE (p_from IS NULL OR d.dday >= p_from) AND (p_to IS NULL OR d.dday <= p_to)
   GROUP BY d.dday, d.sid
   ORDER BY d.dday, d.sid;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_leads_series(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_leads_series(uuid, date, date, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_leads_series(uuid, date, date, uuid) IS
  'Nowe kontakty ze stoisk dziennie (pierwszy skan w strefie wydarzenia) per sponsor, z liczba kontaktow z zywa zgoda na przekazanie partnerowi. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 9) LINK DLA SPONSORA: WYDANIE, LISTA, ODWOLANIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_link_issue(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_sponsor_id uuid := NULLIF(COALESCE(p_payload->>'sponsor_id', ''), '')::uuid;
  v_label text := btrim(COALESCE(p_payload->>'label', ''));
  v_expires timestamptz := NULLIF(COALESCE(p_payload->>'expires_at', ''), '')::timestamptz;
  v_include boolean := COALESCE((p_payload->>'include_leads')::boolean, false);
  v_sponsor public.event_sponsors%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_token text;
  v_prefix text;
  v_id uuid;
BEGIN
  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: sponsor_id is required';
  END IF;

  SELECT s.* INTO v_sponsor
    FROM public.event_sponsors s
   WHERE s.tenant_id = v_tenant AND s.id = v_sponsor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sponsor_not_found: the sponsor does not exist in this tenant';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_sponsor.event_id;

  IF char_length(v_label) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'invalid_label: the label must have 2 to 120 characters';
  END IF;

  IF v_expires IS NULL THEN
    v_expires := LEAST(
      GREATEST(COALESCE(v_event.ends_at, v_event.starts_at) + interval '60 days', now() + interval '7 days'),
      now() + interval '180 days'
    );
  END IF;
  IF v_expires <= now() OR v_expires > now() + interval '180 days' THEN
    RAISE EXCEPTION 'invalid_expiry: the link must expire within 180 days';
  END IF;

  IF (
    SELECT count(*) FROM public.event_sponsor_report_links k
     WHERE k.tenant_id = v_tenant AND k.sponsor_id = v_sponsor_id
       AND k.revoked_at IS NULL AND k.expires_at > now()
  ) >= 10 THEN
    RAISE EXCEPTION 'too_many_links: a sponsor may have at most 10 active links';
  END IF;

  v_token := public._event_new_qr_token();
  v_prefix := left(v_token, 8);

  INSERT INTO public.event_sponsor_report_links (
    tenant_id, event_id, sponsor_id, label, token_hash, token_prefix,
    include_leads, expires_at, created_by
  ) VALUES (
    v_tenant, v_sponsor.event_id, v_sponsor_id, v_label,
    encode(digest(v_token, 'sha256'), 'hex'), v_prefix,
    v_include, v_expires, auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant,
    auth.uid(),
    'event.sponsor_report.link_issued',
    'crm_company',
    v_sponsor.company_id,
    jsonb_build_object(
      'event_id', v_event.id,
      'event_slug', v_event.slug,
      'event_title_pl', v_event.title_pl,
      'event_title_en', v_event.title_en,
      'summary_pl', format(
        U&'Udost\0119pniono raport sponsora "%s" (%s): link %s, wa\017Cny do %s',
        v_event.title_pl, v_label, v_prefix, to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      ),
      'summary_en', format(
        'Sponsor report shared "%s" (%s): link %s, valid until %s',
        v_event.title_en, v_label, v_prefix, to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      ),
      'sponsor_id', v_sponsor_id,
      'link_id', v_id,
      'token_prefix', v_prefix,
      'include_leads', v_include,
      'expires_at', v_expires
    )
  );

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_sponsor_report_link',
    v_id::text,
    'event_sponsor_report_link.issued.v1',
    jsonb_build_object('event_id', v_sponsor.event_id, 'sponsor_id', v_sponsor_id, 'link_id', v_id),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'sponsor_id', v_sponsor_id,
    'token', v_token,
    'token_prefix', v_prefix,
    'expires_at', v_expires,
    'include_leads', v_include
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_link_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_link_issue(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_link_issue(jsonb) IS
  'Wydanie linku raportu dla sponsora: {sponsor_id, label, expires_at?, include_leads?}. TOKEN JAWNY WRACA DOKLADNIE RAZ; w bazie tylko sha256 i prefiks. Waznosc maks. 180 dni, maks. 10 aktywnych linkow na sponsora. Wpis audit_log na firmie sponsora (os czasu CRM). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_links_list(
  p_event_id uuid,
  p_sponsor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  sponsor_id uuid,
  sponsor_name text,
  label text,
  token_prefix text,
  include_leads boolean,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  view_count integer,
  created_at timestamptz,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT k.id, k.sponsor_id, s.snapshot_name, k.label, k.token_prefix, k.include_leads,
         k.expires_at, k.revoked_at, k.last_seen_at, k.view_count, k.created_at,
         (k.revoked_at IS NULL AND k.expires_at > now())
    FROM public.event_sponsor_report_links k
    JOIN public.event_sponsors s ON s.tenant_id = k.tenant_id AND s.id = k.sponsor_id
   WHERE k.tenant_id = v_tenant AND k.event_id = p_event_id
     AND (p_sponsor_id IS NULL OR k.sponsor_id = p_sponsor_id)
   ORDER BY k.created_at DESC
   LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_links_list(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_links_list(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_links_list(uuid, uuid) IS
  'Linki raportu sponsorow wydarzenia (bez skrotu tokenu): prefiks, waznosc, odwolanie, otwarcia. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_link_revoke(p_link_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_link public.event_sponsor_report_links%ROWTYPE;
  v_sponsor public.event_sponsors%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  SELECT k.* INTO v_link
    FROM public.event_sponsor_report_links k
   WHERE k.tenant_id = v_tenant AND k.id = p_link_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: the link does not exist in this tenant';
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.event_sponsor_report_links k
     SET revoked_at = now(), revoked_by = auth.uid()
   WHERE k.tenant_id = v_tenant AND k.id = p_link_id;

  SELECT s.* INTO v_sponsor
    FROM public.event_sponsors s
   WHERE s.tenant_id = v_tenant AND s.id = v_link.sponsor_id;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_link.event_id;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant,
    auth.uid(),
    'event.sponsor_report.link_revoked',
    'crm_company',
    v_sponsor.company_id,
    jsonb_build_object(
      'event_id', v_event.id,
      'event_slug', v_event.slug,
      'event_title_pl', v_event.title_pl,
      'event_title_en', v_event.title_en,
      'summary_pl', format(
        U&'Odwo\0142ano link do raportu sponsora "%s" (%s): link %s',
        v_event.title_pl, v_link.label, v_link.token_prefix
      ),
      'summary_en', format(
        'Sponsor report link revoked "%s" (%s): link %s',
        v_event.title_en, v_link.label, v_link.token_prefix
      ),
      'sponsor_id', v_link.sponsor_id,
      'link_id', v_link.id,
      'token_prefix', v_link.token_prefix
    )
  );

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_sponsor_report_link',
    v_link.id::text,
    'event_sponsor_report_link.revoked.v1',
    jsonb_build_object('event_id', v_link.event_id, 'sponsor_id', v_link.sponsor_id, 'link_id', v_link.id),
    auth.uid()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_link_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_link_revoke(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_link_revoke(uuid) IS
  'Odwolanie linku raportu sponsora (idempotentne: drugie odwolanie zwraca false bez zmian). Wpis audit_log na firmie sponsora. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 10) ODCZYT RAPORTU PO TOKENIE (service_role; server fn z limitem po IP)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_sponsor_report_for_token(p_tenant uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_link public.event_sponsor_report_links%ROWTYPE;
  v_sponsor public.event_sponsors%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tier public.event_sponsor_tiers%ROWTYPE;
  v_totals jsonb;
  v_leads_summary jsonb;
  v_meetings jsonb;
  v_placements jsonb;
  v_series jsonb;
  v_leads jsonb;
BEGIN
  IF p_tenant IS NULL OR v_token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT k.* INTO v_link
    FROM public.event_sponsor_report_links k
   WHERE k.tenant_id = p_tenant
     AND k.token_hash = encode(digest(v_token, 'sha256'), 'hex');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_link.revoked_at IS NOT NULL OR v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  UPDATE public.event_sponsor_report_links k
     SET view_count = k.view_count + 1, last_seen_at = now()
   WHERE k.tenant_id = p_tenant AND k.id = v_link.id;

  SELECT s.* INTO v_sponsor
    FROM public.event_sponsors s
   WHERE s.tenant_id = p_tenant AND s.id = v_link.sponsor_id;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = p_tenant AND e.id = v_link.event_id;
  SELECT t.* INTO v_tier
    FROM public.event_sponsor_tiers t
   WHERE t.tenant_id = p_tenant AND t.id = v_sponsor.tier_id;

  SELECT jsonb_build_object(
           'views_unique', count(*) FILTER (WHERE x.kind = 'view'),
           'views_total', COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0),
           'clicks_unique', count(*) FILTER (WHERE x.kind = 'click'),
           'clicks_total', COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0),
           'material_opens', count(*) FILTER (WHERE x.kind = 'material_open')
         )
    INTO v_totals
    FROM public.event_sponsor_exposures x
   WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id;

  SELECT jsonb_build_object(
           'leads_total', count(*),
           'leads_consented', count(*) FILTER (
             WHERE p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL),
           'lead_scans_total', COALESCE(sum(l.scan_count), 0)
         )
    INTO v_leads_summary
    FROM public.event_lead_scans l
    JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
   WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id;

  SELECT jsonb_build_object(
           'meetings_total', count(*) FILTER (WHERE m.status <> 'cancelled'),
           'meetings_accepted', count(*) FILTER (WHERE m.status IN ('accepted', 'rescheduled', 'held', 'no_show')),
           'meetings_held', count(*) FILTER (WHERE m.status = 'held')
         )
    INTO v_meetings
    FROM public.event_meetings m
   WHERE m.tenant_id = p_tenant AND m.event_id = v_link.event_id AND m.sponsor_id = v_link.sponsor_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'placement', g.placement,
           'views_unique', g.vu, 'views_total', g.vt,
           'clicks_unique', g.cu, 'clicks_total', g.ct,
           'material_opens', g.mo
         ) ORDER BY g.placement), '[]'::jsonb)
    INTO v_placements
    FROM (
      SELECT x.placement,
             count(*) FILTER (WHERE x.kind = 'view') AS vu,
             COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0) AS vt,
             count(*) FILTER (WHERE x.kind = 'click') AS cu,
             COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0) AS ct,
             count(*) FILTER (WHERE x.kind = 'material_open') AS mo
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
       GROUP BY x.placement
    ) g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', d.dday,
           'views_unique', COALESCE(ev.vu, 0),
           'clicks_unique', COALESCE(ev.cu, 0),
           'material_opens', COALESCE(ev.mo, 0),
           'leads_new', COALESCE(ls.n, 0)
         ) ORDER BY d.dday), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT x.day AS dday
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
      UNION
      SELECT (l.first_scanned_at AT TIME ZONE v_event.timezone)::date
        FROM public.event_lead_scans l
       WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
    ) d
    LEFT JOIN (
      SELECT x.day AS dday,
             count(*) FILTER (WHERE x.kind = 'view') AS vu,
             count(*) FILTER (WHERE x.kind = 'click') AS cu,
             count(*) FILTER (WHERE x.kind = 'material_open') AS mo
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
       GROUP BY x.day
    ) ev ON ev.dday = d.dday
    LEFT JOIN (
      SELECT (l.first_scanned_at AT TIME ZONE v_event.timezone)::date AS dday, count(*) AS n
        FROM public.event_lead_scans l
       WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
       GROUP BY 1
    ) ls ON ls.dday = d.dday;

  IF v_link.include_leads THEN
    -- Wiersz BEZ zywej zgody na przekazanie partnerowi nie niesie danych
    -- osobowych w ogole: link wychodzi poza system, wiec zostaje sam licznik
    -- skanu z notatka i ocena obslugi stoiska (to dane sponsora).
    SELECT COALESCE(jsonb_agg(q.row_json ORDER BY q.last_scanned_at DESC), '[]'::jsonb)
      INTO v_leads
      FROM (
        SELECT l.last_scanned_at,
               jsonb_build_object(
                 'sponsor_name', v_sponsor.snapshot_name,
                 'first_name', CASE WHEN c.ok THEN p.first_name END,
                 'last_name', CASE WHEN c.ok THEN p.last_name END,
                 'company', CASE WHEN c.ok THEN COALESCE(NULLIF(btrim(p.company_text), ''), co.name) END,
                 'job_title', CASE WHEN c.ok THEN p.job_title END,
                 'email', CASE WHEN c.ok THEN p.email END,
                 'phone', CASE WHEN c.ok THEN p.phone END,
                 'consent', c.ok,
                 'consent_snapshot_at', l.consent_snapshot_at,
                 'interest_rating', l.interest_rating,
                 'note', l.note,
                 'scan_count', l.scan_count,
                 'first_scanned_at', l.first_scanned_at,
                 'last_scanned_at', l.last_scanned_at,
                 'device_label', d.label
               ) AS row_json
          FROM public.event_lead_scans l
          JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
          CROSS JOIN LATERAL (
            SELECT (p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL) AS ok
          ) c
          LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
          LEFT JOIN public.event_scanner_devices d ON d.tenant_id = l.tenant_id AND d.id = l.device_id
         WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
         ORDER BY l.last_scanned_at DESC
         LIMIT 5000
      ) q;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'timezone', v_event.timezone,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at
    ),
    'sponsor', jsonb_build_object(
      'id', v_sponsor.id,
      'name', v_sponsor.snapshot_name,
      'logo_url', v_sponsor.snapshot_logo_url,
      'role', v_sponsor.role,
      'tier_name_pl', v_tier.name_pl,
      'tier_name_en', v_tier.name_en
    ),
    'link', jsonb_build_object(
      'label', v_link.label,
      'expires_at', v_link.expires_at,
      'include_leads', v_link.include_leads
    ),
    'totals', v_totals || v_leads_summary || v_meetings,
    'placements', v_placements,
    'series', v_series,
    'leads', v_leads
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsor_report_for_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_sponsor_report_for_token(uuid, text) TO service_role;

COMMENT ON FUNCTION public.event_sponsor_report_for_token(uuid, text) IS
  'Raport sponsora po tokenie linku: {ok:false, reason:not_found|expired} albo {ok:true, event, sponsor, link, totals, placements, series, leads}. Wylacznie service_role - najemca z zaufanego hosta, limit prob po IP po stronie serwera. Podbija view_count i last_seen_at. Kontakt tylko przy zywej zgodzie na przekazanie partnerowi.';

-- ----------------------------------------------------------------------------
-- 11) CRM: HISTORIA SPONSORINGU FIRMY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_company_sponsorships(p_company_id uuid)
RETURNS TABLE (
  event_id uuid,
  event_slug text,
  event_title_pl text,
  event_title_en text,
  event_starts_at timestamptz,
  event_timezone text,
  event_status text,
  sponsor_id uuid,
  role text,
  tier_name_pl text,
  tier_name_en text,
  is_published boolean,
  views_unique integer,
  clicks_unique integer,
  material_opens integer,
  leads_total integer,
  leads_consented integer,
  meetings_held integer,
  active_links integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.starts_at, e.timezone, e.status,
         s.id, s.role, t.name_pl, t.name_en, s.is_published,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'view')::integer,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'click')::integer,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'material_open')::integer,
         (SELECT count(*) FROM public.event_lead_scans l
           WHERE l.tenant_id = v_tenant AND l.sponsor_id = s.id)::integer,
         (SELECT count(*) FROM public.event_lead_scans l
            JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
           WHERE l.tenant_id = v_tenant AND l.sponsor_id = s.id
             AND p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL)::integer,
         (SELECT count(*) FROM public.event_meetings m
           WHERE m.tenant_id = v_tenant AND m.sponsor_id = s.id AND m.status = 'held')::integer,
         (SELECT count(*) FROM public.event_sponsor_report_links k
           WHERE k.tenant_id = v_tenant AND k.sponsor_id = s.id
             AND k.revoked_at IS NULL AND k.expires_at > now())::integer
    FROM public.event_sponsors s
    JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
    LEFT JOIN public.event_sponsor_tiers t ON t.tenant_id = s.tenant_id AND t.id = s.tier_id
   WHERE s.tenant_id = v_tenant AND s.company_id = p_company_id
   ORDER BY e.starts_at DESC, e.id
   LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_company_sponsorships(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_company_sponsorships(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_company_sponsorships(uuid) IS
  'Historia sponsoringu firmy z CRM na wydarzeniach najemcy z metrykami raportu (wyswietlenia, klikniecia, otwarcia materialow, kontakty, spotkania, aktywne linki). Bramka: assert_event_admin_tenant() - redaktor CRM dostaje forbidden.';

-- ----------------------------------------------------------------------------
-- 12) CRM: PRZENIESIENIE ZEBRANYCH KONTAKTOW (jawna akcja organizatora)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_lead_scans_push_to_crm(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(COALESCE(p_payload->>'event_id', ''), '')::uuid;
  v_sponsor_id uuid := NULLIF(COALESCE(p_payload->>'sponsor_id', ''), '')::uuid;
  v_event public.events%ROWTYPE;
  v_label text;
  r record;
  v_email text;
  v_consent boolean;
  v_existing boolean;
  v_prev public.event_person_crm_links%ROWTYPE;
  v_lead uuid;
  v_status text;
  v_reason text;
  v_persons integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_no_email integer := 0;
  v_no_consent integer := 0;
  v_failed integer := 0;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF v_sponsor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id AND s.id = v_sponsor_id
  ) THEN
    RAISE EXCEPTION 'sponsor_not_found: the sponsor does not exist in this event';
  END IF;

  v_label := 'event:' || v_event.slug || ':sponsor_lead';

  FOR r IN
    SELECT l.person_id,
           array_agg(DISTINCT s.company_id ORDER BY s.company_id) AS company_ids,
           array_agg(DISTINCT s.id ORDER BY s.id) AS sponsor_ids,
           string_agg(DISTINCT s.snapshot_name, ', ' ORDER BY s.snapshot_name) AS sponsor_names
      FROM public.event_lead_scans l
      JOIN public.event_sponsors s ON s.tenant_id = l.tenant_id AND s.id = l.sponsor_id
     WHERE l.tenant_id = v_tenant AND l.event_id = v_event_id
       AND (v_sponsor_id IS NULL OR l.sponsor_id = v_sponsor_id)
     GROUP BY l.person_id
     ORDER BY l.person_id
     LIMIT 5000
  LOOP
    v_persons := v_persons + 1;

    SELECT lower(NULLIF(btrim(COALESCE(p.email, '')), '')),
           (p.consent_marketing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL)
      INTO v_email, v_consent
      FROM public.event_people p
     WHERE p.tenant_id = v_tenant AND p.id = r.person_id;

    v_existing := v_email IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.crm_leads c WHERE c.tenant_id = v_tenant AND c.email_norm = v_email
    );

    -- Ponowne przeniesienie tej samej osoby nie zasmieca osi czasu CRM:
    -- wpis audytu idzie tylko przy pierwszym udanym przeniesieniu z tej
    -- etykiety (albo po wczesniejszej porazce).
    SELECT k.* INTO v_prev
      FROM public.event_person_crm_links k
     WHERE k.tenant_id = v_tenant AND k.person_id = r.person_id;

    v_lead := public._event_person_crm_sync(
      v_tenant,
      r.person_id,
      'event_participant',
      v_label,
      ARRAY['event:' || v_event.slug]
        || ARRAY(SELECT 'sponsor_lead:' || c::text FROM unnest(r.company_ids) AS c),
      '{}'::jsonb,
      COALESCE(v_consent, false),
      CASE
        WHEN v_prev.sync_status = 'ok' AND v_prev.last_source_label = v_label THEN NULL
        ELSE 'event.sponsor_lead.pushed'
      END,
      jsonb_build_object(
        'event_id', v_event.id,
        'event_slug', v_event.slug,
        'event_title_pl', v_event.title_pl,
        'event_title_en', v_event.title_en,
        'summary_pl', format(
          U&'Kontakt zebrany na stoisku (%s) podczas wydarzenia "%s" przeniesiony do CRM',
          r.sponsor_names, v_event.title_pl
        ),
        'summary_en', format(
          'Contact collected at the booth (%s) during "%s" moved to CRM',
          r.sponsor_names, v_event.title_en
        ),
        'sponsor_ids', to_jsonb(r.sponsor_ids)
      )
    );

    IF v_lead IS NOT NULL THEN
      IF v_existing THEN
        v_updated := v_updated + 1;
      ELSE
        v_created := v_created + 1;
      END IF;
    ELSE
      SELECT k.sync_status, k.last_error INTO v_status, v_reason
        FROM public.event_person_crm_links k
       WHERE k.tenant_id = v_tenant AND k.person_id = r.person_id;
      IF v_status = 'skipped' AND v_reason = 'email_missing' THEN
        v_no_email := v_no_email + 1;
      ELSIF v_status = 'skipped' AND v_reason = 'lead_not_found' THEN
        v_no_consent := v_no_consent + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'persons', v_persons,
    'created', v_created,
    'updated', v_updated,
    'skipped_no_email', v_no_email,
    'skipped_no_consent', v_no_consent,
    'failed', v_failed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) IS
  'Jawne przeniesienie kontaktow zebranych na stoiskach do CRM: {event_id, sponsor_id?}. Przez most _event_person_crm_sync: nowy kontakt WYLACZNIE ze zgoda marketingowa organizatora (p_create = dowod), inaczej tylko wzbogacenie istniejacego; segment event_participant, tagi event:<slug> i sponsor_lead:<id firmy>; notatki i oceny sponsora nie ida do CRM. Zwraca {persons, created, updated, skipped_no_email, skipped_no_consent, failed}. Bramka: assert_event_admin_tenant().';
