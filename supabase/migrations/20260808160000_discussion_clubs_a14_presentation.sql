-- ============================================================================
-- Discussion Club A14 - warstwa prezentacji i zakladanie klubu
--
-- Dwie rzeczy, ktorych brakowalo, zeby klub dalo sie ZALOZYC i zeby wygladal
-- jak cos wiecej niz lista linkow.
--
-- 1) ZAKLADANIE BEZ DIAGNOZY. Panel tworzyl klub jednym klikiem, z slugiem
--    z znacznika czasu, i przy kazdej odmowie RPC pokazywal jedno zdanie
--    "Nie udalo sie zapisac". Administrator nie mial jak odroznic zajetego
--    sluga od braku tenanta ani od braku uprawnien - a to sa trzy rozne
--    problemy z trzema roznymi nastepnymi krokami. Doktadamy funkcje, ktora
--    odpowiada na pytanie "czy ten adres jest wolny" ZANIM cokolwiek zapiszemy.
--
-- 2) BRAK WARSTWY PREZENTACJI. Tabela ma cover_image_url od A1 i nikt tego
--    pola nigdy nie ustawial ani nie czytal w interfejsie. Do tego strona
--    klubu renderowala sie zawsze tak samo, niezaleznie od tego, czy klub
--    jest archiwum dokumentow, czy biezaca debata.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Uklad strony klubu
--
-- Slownik domkniety CHECK-iem, jak kazdy inny w tym module - klient zawezа
-- do niego stringa z bazy, wiec dodanie wartosci ma dokladnie jedno miejsce
-- do poprawienia po obu stronach.
--
--   list     - gesta lista tematow; domyslny, najlepszy dla biezacej debaty,
--   cards    - siatka kart z fragmentem tresci; dla klubu, w ktorym watki sa
--              rzadsze i dluzsze,
--   magazine - jeden temat wyrozniony u gory plus lista; dla klubu z redakcja,
--              ktora chce cos wypchnac na wierzch.
-- ----------------------------------------------------------------------------
ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS layout text NOT NULL DEFAULT 'list';

ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_layout_check;
ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_layout_check CHECK (layout IN ('list', 'cards', 'magazine'));

COMMENT ON COLUMN public.clubs.layout IS
  'Uklad strony klubu. Nie kosmetyka: magazine wyroznia jeden watek, wiec zmienia to, co czytelnik zobaczy pierwsze.';

-- ----------------------------------------------------------------------------
-- 2) Czy adres jest wolny
--
-- Osobne RPC zamiast czekania na blad 23505 z zapisu. Powod jest prosty:
-- formularz ma powiedziec "ten adres jest zajety" przy wpisywaniu, a nie po
-- kliknieciu "Utworz" - a przy edycji istniejacego klubu jego WLASNY slug nie
-- moze byc raportowany jako zajety.
--
-- Odpowiada wylacznie prawda/falsz w obrebie tenantu wolajacego: to nie jest
-- wyrocznia o cudzych tenantach ani o istnieniu konkretnego klubu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_slug_available(
  p_slug     text,
  p_club_id  uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_club_admin(auth.uid())
     AND NULLIF(btrim(p_slug), '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.clubs c
        WHERE c.tenant_id = public.current_tenant_id()
          AND c.slug = btrim(p_slug)
          AND (p_club_id IS NULL OR c.id <> p_club_id)
     )
$$;

COMMENT ON FUNCTION public.admin_club_slug_available(text, uuid) IS
  'Czy adres jest wolny w tenancie wolajacego. Przy edycji WLASNY slug klubu nie liczy sie jako zajety.';

REVOKE EXECUTE ON FUNCTION public.admin_club_slug_available(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_slug_available(text, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Zapis: layout wchodzi do patcha
--
-- Przy INSERT domyslna wartosc bierze sie z DDL, wiec obsluzyc trzeba tylko
-- galaz UPDATE - i to jako PATCH, czyli klucz nieobecny w jsonb zostawia
-- kolumne nietknieta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_slug   text := NULLIF(btrim(p_payload->>'slug'), '');
  v_exists boolean;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: tenant not resolved' USING ERRCODE = '42501';
  END IF;

  IF v_id IS NULL THEN
    IF v_slug IS NULL OR NULLIF(btrim(p_payload->>'name_pl'), '') IS NULL THEN
      RAISE EXCEPTION 'clubs: slug and name_pl are required' USING ERRCODE = '22023';
    END IF;
    -- Kolizja sluga zglaszana WLASNYM kodem, nie surowym 23505 z indeksu:
    -- klient ma odroznic "zmien adres" od kazdej innej awarii zapisu.
    IF EXISTS (
      SELECT 1 FROM public.clubs c WHERE c.tenant_id = v_tenant AND c.slug = v_slug
    ) THEN
      RAISE EXCEPTION 'clubs: slug already taken' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.clubs (
      tenant_id, slug, name_pl, name_en,
      tagline_pl, tagline_en, description_pl, description_en,
      icon, accent_color, cover_image_url,
      visibility, join_policy, min_tier_rank, attribution_mode,
      who_can_post, moderation_mode, policy_area,
      rules_pl, rules_en, status, layout, created_by
    ) VALUES (
      v_tenant, v_slug,
      btrim(p_payload->>'name_pl'),
      COALESCE(NULLIF(btrim(p_payload->>'name_en'), ''), btrim(p_payload->>'name_pl')),
      NULLIF(btrim(p_payload->>'tagline_pl'), ''),
      NULLIF(btrim(p_payload->>'tagline_en'), ''),
      NULLIF(btrim(p_payload->>'description_pl'), ''),
      NULLIF(btrim(p_payload->>'description_en'), ''),
      COALESCE(NULLIF(btrim(p_payload->>'icon'), ''), 'MessagesSquare'),
      NULLIF(btrim(p_payload->>'accent_color'), ''),
      NULLIF(btrim(p_payload->>'cover_image_url'), ''),
      COALESCE(NULLIF(p_payload->>'visibility', ''), 'members'),
      COALESCE(NULLIF(p_payload->>'join_policy', ''), 'request'),
      COALESCE((p_payload->>'min_tier_rank')::integer, 0),
      COALESCE(NULLIF(p_payload->>'attribution_mode', ''), 'attributed'),
      COALESCE(NULLIF(p_payload->>'who_can_post', ''), 'moderators'),
      COALESCE(NULLIF(p_payload->>'moderation_mode', ''), 'trusted'),
      NULLIF(btrim(p_payload->>'policy_area'), ''),
      NULLIF(btrim(p_payload->>'rules_pl'), ''),
      NULLIF(btrim(p_payload->>'rules_en'), ''),
      COALESCE(NULLIF(p_payload->>'status', ''), 'draft'),
      COALESCE(NULLIF(p_payload->>'layout', ''), 'list'),
      v_uid
    )
    RETURNING id INTO v_id;

    -- Domyslna grupa: klub nigdy nie istnieje bez miejsca na temat.
    INSERT INTO public.club_groups (
      tenant_id, club_id, slug, name_pl, name_en, sort_order, status, created_by
    ) VALUES (
      v_tenant, v_id, 'ogolna', 'Ogólna', 'General', 0, 'active', v_uid
    );

  ELSE
    SELECT true INTO v_exists FROM public.clubs
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT COALESCE(v_exists, false) THEN
      RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
    END IF;
    IF v_slug IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.clubs c
       WHERE c.tenant_id = v_tenant AND c.slug = v_slug AND c.id <> v_id
    ) THEN
      RAISE EXCEPTION 'clubs: slug already taken' USING ERRCODE = '23505';
    END IF;

    UPDATE public.clubs c SET
      slug            = COALESCE(v_slug, c.slug),
      name_pl         = COALESCE(NULLIF(btrim(p_payload->>'name_pl'), ''), c.name_pl),
      name_en         = COALESCE(NULLIF(btrim(p_payload->>'name_en'), ''), c.name_en),
      tagline_pl      = CASE WHEN p_payload ? 'tagline_pl'
                             THEN NULLIF(btrim(p_payload->>'tagline_pl'), '') ELSE c.tagline_pl END,
      tagline_en      = CASE WHEN p_payload ? 'tagline_en'
                             THEN NULLIF(btrim(p_payload->>'tagline_en'), '') ELSE c.tagline_en END,
      description_pl  = CASE WHEN p_payload ? 'description_pl'
                             THEN NULLIF(btrim(p_payload->>'description_pl'), '') ELSE c.description_pl END,
      description_en  = CASE WHEN p_payload ? 'description_en'
                             THEN NULLIF(btrim(p_payload->>'description_en'), '') ELSE c.description_en END,
      icon            = COALESCE(NULLIF(btrim(p_payload->>'icon'), ''), c.icon),
      accent_color    = CASE WHEN p_payload ? 'accent_color'
                             THEN NULLIF(btrim(p_payload->>'accent_color'), '') ELSE c.accent_color END,
      cover_image_url = CASE WHEN p_payload ? 'cover_image_url'
                             THEN NULLIF(btrim(p_payload->>'cover_image_url'), '') ELSE c.cover_image_url END,
      visibility      = COALESCE(NULLIF(p_payload->>'visibility', ''), c.visibility),
      join_policy     = COALESCE(NULLIF(p_payload->>'join_policy', ''), c.join_policy),
      min_tier_rank   = COALESCE((p_payload->>'min_tier_rank')::integer, c.min_tier_rank),
      attribution_mode = COALESCE(NULLIF(p_payload->>'attribution_mode', ''), c.attribution_mode),
      who_can_post    = COALESCE(NULLIF(p_payload->>'who_can_post', ''), c.who_can_post),
      moderation_mode = COALESCE(NULLIF(p_payload->>'moderation_mode', ''), c.moderation_mode),
      policy_area     = CASE WHEN p_payload ? 'policy_area'
                             THEN NULLIF(btrim(p_payload->>'policy_area'), '') ELSE c.policy_area END,
      rules_pl        = CASE WHEN p_payload ? 'rules_pl'
                             THEN NULLIF(btrim(p_payload->>'rules_pl'), '') ELSE c.rules_pl END,
      rules_en        = CASE WHEN p_payload ? 'rules_en'
                             THEN NULLIF(btrim(p_payload->>'rules_en'), '') ELSE c.rules_en END,
      status          = COALESCE(NULLIF(p_payload->>'status', ''), c.status),
      layout          = COALESCE(NULLIF(p_payload->>'layout', ''), c.layout)
    WHERE c.id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_club_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_upsert(jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Odczyt: layout wychodzi tam, gdzie jest potrzebny
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_get(uuid);

CREATE FUNCTION public.admin_club_get(p_club_id uuid)
RETURNS TABLE (
  id uuid, slug text, name_pl text, name_en text,
  tagline_pl text, tagline_en text, description_pl text, description_en text,
  rules_pl text, rules_en text,
  icon text, accent_color text, cover_image_url text,
  visibility text, join_policy text, min_tier_rank integer,
  attribution_mode text, who_can_post text, moderation_mode text,
  policy_area text, status text, layout text,
  member_count integer, group_count integer, thread_count integer,
  last_activity_at timestamptz, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.slug, c.name_pl, c.name_en,
    c.tagline_pl, c.tagline_en, c.description_pl, c.description_en,
    c.rules_pl, c.rules_en,
    c.icon, c.accent_color, c.cover_image_url,
    c.visibility, c.join_policy, c.min_tier_rank,
    c.attribution_mode, c.who_can_post, c.moderation_mode,
    c.policy_area, c.status, c.layout,
    c.member_count, c.group_count, c.thread_count,
    c.last_activity_at, c.created_at, c.updated_at
  FROM public.clubs c
  WHERE c.id = p_club_id
    AND c.tenant_id = public.current_tenant_id()
    AND public.is_club_admin(auth.uid())
$$;

COMMENT ON FUNCTION public.admin_club_get(uuid) IS
  'Pelny klub po id dla edytora w panelu. Po id, nie po slugu - slug moze sie wlasnie w edytorze zmieniac.';

REVOKE EXECUTE ON FUNCTION public.admin_club_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_get(uuid) TO authenticated, service_role;

-- club_view: strona produktowa musi wiedziec, jak sie narysowac.
DROP FUNCTION IF EXISTS public.club_view(text);

CREATE FUNCTION public.club_view(p_slug text)
RETURNS TABLE (
  id uuid, slug text, name_pl text, name_en text,
  tagline_pl text, tagline_en text, description_pl text, description_en text,
  rules_pl text, rules_en text,
  icon text, accent_color text, cover_image_url text,
  visibility text, join_policy text, min_tier_rank integer,
  attribution_mode text, who_can_post text, moderation_mode text,
  policy_area text, status text, layout text,
  member_count integer, group_count integer, thread_count integer,
  last_activity_at timestamptz, created_at timestamptz,
  my_role text, my_status text, rules_accepted_at timestamptz,
  can_read boolean, can_post_thread boolean, can_reply boolean,
  can_moderate boolean, can_manage boolean, can_invite boolean,
  can_see_members boolean, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT COALESCE(
      (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
      public.public_tenant_id()
    ) AS tenant_id
  ),
  found AS (
    SELECT c.* FROM public.clubs c CROSS JOIN scope s
     WHERE c.slug = p_slug AND c.tenant_id = s.tenant_id
  )
  SELECT
    f.id, f.slug, f.name_pl, f.name_en,
    f.tagline_pl, f.tagline_en, f.description_pl, f.description_en,
    f.rules_pl, f.rules_en,
    f.icon, f.accent_color, f.cover_image_url,
    f.visibility, f.join_policy, f.min_tier_rank,
    f.attribution_mode, f.who_can_post, f.moderation_mode,
    f.policy_area, f.status, f.layout,
    f.member_count, f.group_count, f.thread_count,
    f.last_activity_at, f.created_at,
    public.club_effective_member_role(m.role, m.role_expires_at),
    m.status, m.rules_accepted_at,
    cap.can_read, cap.can_post_thread, cap.can_reply,
    cap.can_moderate, cap.can_manage, cap.can_invite,
    cap.can_see_members, cap.reason
  FROM found f
  LEFT JOIN public.club_members m ON m.club_id = f.id AND m.user_id = auth.uid()
  CROSS JOIN LATERAL public.club_capabilities(f.id, NULL, auth.uid()) cap
  -- Klub, ktorego nie wolno nawet zobaczyc na karcie, nie wychodzi w ogole:
  -- 'not_found' z capabilities jest tu jedyna poprawna odpowiedzia.
  WHERE cap.reason IS DISTINCT FROM 'not_found'
$$;

REVOKE EXECUTE ON FUNCTION public.club_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_view(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Fragment tresci na liscie tematow
--
-- Uklady "karty" i "magazyn" pokazuja poczatek watku - bez tego siatka jest
-- tylko lista w dwoch kolumnach, a wyrozniony wpis w magazynie nie ma czym
-- sie wyroznic. Wiersz jest juz odsiany przez cap.can_read, wiec fragment nie
-- jest nowa klasa ekspozycji: tytul wychodzi ta sama droga od A3.
-- ----------------------------------------------------------------------------
-- Zmiana typu zwracanego (nowa kolumna `excerpt`), wiec CREATE OR REPLACE nie
-- wystarcza - Postgres odmawia bledem "cannot change return type of existing
-- function". Zdejmujemy DOKLADNIE ta sygnature; bramka replay uznaje to za
-- legalne wlasnie dlatego, ze DROP stoi w tym samym pliku.
DROP FUNCTION IF EXISTS public.club_threads_list(uuid, uuid, text, text, text, integer);

CREATE FUNCTION public.club_threads_list(
  p_club_id uuid, p_group_id uuid DEFAULT NULL, p_sort text DEFAULT 'hot',
  p_kind text DEFAULT NULL, p_cursor text DEFAULT NULL, p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid, slug text, title text, kind text, status text,
  group_id uuid, group_name_pl text, group_name_en text,
  anchor_type text, anchor_id text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
  reply_count integer, participant_count integer, reaction_count integer,
  pinned_at timestamptz, last_reply_at timestamptz, created_at timestamptz,
  hotness numeric, cursor_value text, excerpt text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, p_group_id, auth.uid())
  ),
  visible AS (
    SELECT t.*, g.name_pl AS g_pl, g.name_en AS g_en,
           COALESCE(g.attribution_mode, cl.attribution_mode) AS attribution,
           -- Flaga przypiecia jest CZESCIA klucza kursora, wiec porzadek
           -- kursora pokrywa sie z porzadkiem sortowania i przypiety watek
           -- nie wraca na kazdej stronie.
           (CASE WHEN t.pinned_at IS NOT NULL THEN '1' ELSE '0' END) AS pin_key
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
      JOIN public.clubs cl ON cl.id = t.club_id
      CROSS JOIN cap
     WHERE t.club_id = p_club_id
       AND cap.can_read
       AND (p_group_id IS NULL OR t.group_id = p_group_id)
       AND (p_kind IS NULL OR t.kind = p_kind)
       AND (t.status IN ('open','resolved','dormant','locked')
            OR cap.can_moderate
            OR (t.status = 'pending' AND t.author_id = auth.uid()))
       AND (g.status NOT IN ('draft','archived') OR cap.can_manage)
  ),
  keyed AS (
    SELECT v.*,
           v.pin_key || '|' ||
           CASE p_sort
             WHEN 'new' THEN to_char(COALESCE(v.last_reply_at, v.created_at), 'YYYYMMDDHH24MISSMS')
             ELSE to_char(v.hotness, 'FM0000000000.0000000000')
           END || '|' || v.id::text AS ckey
      FROM visible v
  )
  SELECT
    k.id, k.slug, k.title, k.kind, k.status,
    k.group_id, k.g_pl, k.g_en, k.anchor_type, k.anchor_id, k.is_anonymous,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE k.author_id END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''),
                       NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User') END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham'
         THEN public.club_author_alias(k.id, k.author_id) ELSE NULL END,
    NULLIF(btrim(pa.display_name), ''),
    k.reply_count, k.participant_count, k.reaction_count,
    k.pinned_at, k.last_reply_at, k.created_at, k.hotness, k.ckey,
    -- Fragment tresci: to on odroznia uklad "karty" i "magazyn" od listy.
    -- Bez niego siatka jest tylko lista w dwoch kolumnach. Wiersz jest juz
    -- odsiany przez cap.can_read, wiec to nie jest nowa klasa ekspozycji -
    -- tytul wychodzi tu od poczatku.
    left(k.body, 280)
  FROM keyed k
  LEFT JOIN public.profiles p ON p.id = k.author_id
  LEFT JOIN public.profiles pa ON pa.id = k.posted_by_admin_id
  WHERE p_cursor IS NULL OR k.ckey < p_cursor
  ORDER BY k.ckey DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

REVOKE EXECUTE ON FUNCTION
  public.club_threads_list(uuid, uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.club_threads_list(uuid, uuid, text, text, text, integer)
  TO anon, authenticated, service_role;
