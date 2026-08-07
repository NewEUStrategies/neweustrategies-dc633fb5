-- ============================================================================
-- DISCUSSION CLUB - ETAP A1: POWIERZCHNIA ADMINISTRACYJNA
--
-- Struktura (kluby, grupy, role, czlonkostwa) nalezy WYLACZNIE do admina
-- i super_admina (V2 §0). Kazda funkcja ponizej zaczyna sie od tej samej
-- bramki - public.is_club_admin() - i nigdy nie rozwija jej inline.
--
-- Tenant: wszystkie funkcje skaluja dane po public.current_tenant_id(), czyli
-- po tenancie DOMOWYM wolajacego. Nigdy po public_tenant_id(), bo ten czyta
-- naglowek x-tenant-host ustawiany przez klienta - admin tenanta A podrobilby
-- go na domene tenanta B i zapisywal w cudzych danych. To jest dokladnie ta
-- klasa bledu, ktora wyciekala przychod w monetization_dashboard.
--
-- Wejscie jako jsonb, a nie 20 parametrow pozycyjnych: upsert klubu ma 22 pola,
-- a lista pozycyjna gwarantuje, ze predzej czy pozniej ktos przestawi dwa
-- teksty. Klucz nieobecny w jsonb = "nie ruszaj tego pola" (patch), klucz z
-- wartoscia null = "wyczysc". Rozroznienie robi operator ?, nie COALESCE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Lista klubow dla panelu (bez filtra widocznosci - admin widzi wszystko
--    w swoim tenancie, lacznie z draftami i archiwum)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_list(text, text, text, integer, integer);

CREATE FUNCTION public.admin_club_list(
  p_search      text DEFAULT NULL,
  p_status      text DEFAULT NULL,
  p_visibility  text DEFAULT NULL,
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, slug text, name_pl text, name_en text,
  icon text, accent_color text, visibility text, join_policy text,
  min_tier_rank integer, attribution_mode text, who_can_post text,
  moderation_mode text, policy_area text, status text,
  member_count integer, group_count integer, thread_count integer,
  pending_count integer, lead_names text[],
  last_activity_at timestamptz, created_at timestamptz, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT c.*
      FROM public.clubs c
     WHERE public.is_club_admin(auth.uid())
       AND c.tenant_id = public.current_tenant_id()
       AND (p_status IS NULL OR c.status = p_status)
       AND (p_visibility IS NULL OR c.visibility = p_visibility)
       AND (
         p_search IS NULL OR btrim(p_search) = ''
         OR c.name_pl ILIKE '%' || btrim(p_search) || '%'
         OR c.name_en ILIKE '%' || btrim(p_search) || '%'
         OR c.slug    ILIKE '%' || btrim(p_search) || '%'
       )
  )
  SELECT
    s.id, s.slug, s.name_pl, s.name_en,
    s.icon, s.accent_color, s.visibility, s.join_policy,
    s.min_tier_rank, s.attribution_mode, s.who_can_post,
    s.moderation_mode, s.policy_area, s.status,
    s.member_count, s.group_count, s.thread_count,
    -- Oczekujacy na przyjecie: badge w wierszu tabeli, bez drugiego zapytania.
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = s.id AND m.status = 'pending') AS pending_count,
    -- Prowadzacy: kolumna "kto tym kieruje" bez N+1 na liscie.
    COALESCE((
      SELECT array_agg(COALESCE(
               NULLIF(btrim(p.display_name), ''),
               NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
               'User'
             ) ORDER BY p.display_name)
        FROM public.club_members m
        JOIN public.profiles p ON p.id = m.user_id
       WHERE m.club_id = s.id AND m.status = 'active' AND m.role = 'lead'
    ), '{}'::text[]) AS lead_names,
    s.last_activity_at, s.created_at,
    count(*) OVER () AS total_count
  FROM scoped s
  ORDER BY
    CASE s.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
    s.last_activity_at DESC NULLS LAST,
    lower(s.name_pl) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.admin_club_list(text, text, text, integer, integer) IS
  'Lista klubow dla panelu admina (wlasny tenant, wszystkie statusy). Liczniki i prowadzacy w tym samym wierszu - zero N+1 na liscie.';

REVOKE EXECUTE ON FUNCTION public.admin_club_list(text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_list(text, text, text, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) Upsert klubu
--
-- Tworzenie klubu ZAWSZE zaklada domyslna grupe "Ogolna". Dzieki temu
-- trzypoziomowosc nigdy nie jest widoczna dla kogos, kto jej nie potrzebuje
-- (V2 §1), a kod tematow moze zakladac, ze group_id istnieje - bez galezi
-- "klub bez grupy".
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
    -- INSERT: nazwa i slug sa obowiazkowe, reszta ma wartosci domyslne z DDL.
    IF v_slug IS NULL OR NULLIF(btrim(p_payload->>'name_pl'), '') IS NULL THEN
      RAISE EXCEPTION 'clubs: slug and name_pl are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.clubs (
      tenant_id, slug, name_pl, name_en,
      tagline_pl, tagline_en, description_pl, description_en,
      icon, accent_color, cover_image_url,
      visibility, join_policy, min_tier_rank, attribution_mode,
      who_can_post, moderation_mode, policy_area,
      rules_pl, rules_en, status, created_by
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
    -- UPDATE jako PATCH: klucz nieobecny w jsonb zostawia kolumne nietknieta.
    SELECT true INTO v_exists FROM public.clubs
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT COALESCE(v_exists, false) THEN
      RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
    END IF;

    UPDATE public.clubs SET
      slug             = COALESCE(NULLIF(btrim(p_payload->>'slug'), ''), slug),
      name_pl          = COALESCE(NULLIF(btrim(p_payload->>'name_pl'), ''), name_pl),
      name_en          = COALESCE(NULLIF(btrim(p_payload->>'name_en'), ''), name_en),
      tagline_pl       = CASE WHEN p_payload ? 'tagline_pl'
                              THEN NULLIF(btrim(p_payload->>'tagline_pl'), '') ELSE tagline_pl END,
      tagline_en       = CASE WHEN p_payload ? 'tagline_en'
                              THEN NULLIF(btrim(p_payload->>'tagline_en'), '') ELSE tagline_en END,
      description_pl   = CASE WHEN p_payload ? 'description_pl'
                              THEN NULLIF(btrim(p_payload->>'description_pl'), '') ELSE description_pl END,
      description_en   = CASE WHEN p_payload ? 'description_en'
                              THEN NULLIF(btrim(p_payload->>'description_en'), '') ELSE description_en END,
      icon             = COALESCE(NULLIF(btrim(p_payload->>'icon'), ''), icon),
      accent_color     = CASE WHEN p_payload ? 'accent_color'
                              THEN NULLIF(btrim(p_payload->>'accent_color'), '') ELSE accent_color END,
      cover_image_url  = CASE WHEN p_payload ? 'cover_image_url'
                              THEN NULLIF(btrim(p_payload->>'cover_image_url'), '') ELSE cover_image_url END,
      visibility       = COALESCE(NULLIF(p_payload->>'visibility', ''), visibility),
      join_policy      = COALESCE(NULLIF(p_payload->>'join_policy', ''), join_policy),
      min_tier_rank    = COALESCE((p_payload->>'min_tier_rank')::integer, min_tier_rank),
      attribution_mode = COALESCE(NULLIF(p_payload->>'attribution_mode', ''), attribution_mode),
      who_can_post     = COALESCE(NULLIF(p_payload->>'who_can_post', ''), who_can_post),
      moderation_mode  = COALESCE(NULLIF(p_payload->>'moderation_mode', ''), moderation_mode),
      policy_area      = CASE WHEN p_payload ? 'policy_area'
                              THEN NULLIF(btrim(p_payload->>'policy_area'), '') ELSE policy_area END,
      rules_pl         = CASE WHEN p_payload ? 'rules_pl'
                              THEN NULLIF(btrim(p_payload->>'rules_pl'), '') ELSE rules_pl END,
      rules_en         = CASE WHEN p_payload ? 'rules_en'
                              THEN NULLIF(btrim(p_payload->>'rules_en'), '') ELSE rules_en END,
      status           = COALESCE(NULLIF(p_payload->>'status', ''), status)
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'clubs: slug already taken' USING ERRCODE = '23505';
END;
$$;

COMMENT ON FUNCTION public.admin_club_upsert(jsonb) IS
  'Tworzy albo aktualizuje klub (PATCH po jsonb: brak klucza = nie ruszaj). Nowy klub dostaje domyslna grupe "Ogolna", wiec kod tematow nigdy nie widzi klubu bez grupy.';

REVOKE EXECUTE ON FUNCTION public.admin_club_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_upsert(jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Upsert grupy
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_group_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid := public.current_tenant_id();
  v_id      uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_club_id uuid := NULLIF(p_payload->>'club_id', '')::uuid;
  v_exists  boolean;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Klub musi nalezec do tenanta wolajacego. Bez tego sprawdzenia admin
  -- tenanta A dopisalby grupe do klubu tenanta B, podajac samo club_id.
  IF v_id IS NOT NULL THEN
    SELECT g.club_id INTO v_club_id
      FROM public.club_groups g
      JOIN public.clubs c ON c.id = g.club_id
     WHERE g.id = v_id AND c.tenant_id = v_tenant;
    IF v_club_id IS NULL THEN
      RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT true INTO v_exists FROM public.clubs
     WHERE id = v_club_id AND tenant_id = v_tenant;
    IF NOT COALESCE(v_exists, false) THEN
      RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    IF NULLIF(btrim(p_payload->>'slug'), '') IS NULL
       OR NULLIF(btrim(p_payload->>'name_pl'), '') IS NULL THEN
      RAISE EXCEPTION 'clubs: slug and name_pl are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.club_groups (
      tenant_id, club_id, slug, name_pl, name_en,
      description_pl, description_en, icon, accent_color, sort_order,
      visibility, who_can_post, moderation_mode, min_tier_rank, attribution_mode,
      opens_at, closes_at, status, anchor_type, anchor_id, created_by
    ) VALUES (
      v_tenant, v_club_id,
      btrim(p_payload->>'slug'),
      btrim(p_payload->>'name_pl'),
      COALESCE(NULLIF(btrim(p_payload->>'name_en'), ''), btrim(p_payload->>'name_pl')),
      NULLIF(btrim(p_payload->>'description_pl'), ''),
      NULLIF(btrim(p_payload->>'description_en'), ''),
      NULLIF(btrim(p_payload->>'icon'), ''),
      NULLIF(btrim(p_payload->>'accent_color'), ''),
      COALESCE((p_payload->>'sort_order')::integer,
               (SELECT COALESCE(max(sort_order), -1) + 1
                  FROM public.club_groups WHERE club_id = v_club_id)),
      -- NULL = dziedzicz z klubu. Pusty string tez znaczy dziedzicz, bo
      -- droplista "dziedziczone" wysyla wlasnie pusta wartosc.
      NULLIF(p_payload->>'visibility', ''),
      NULLIF(p_payload->>'who_can_post', ''),
      NULLIF(p_payload->>'moderation_mode', ''),
      (p_payload->>'min_tier_rank')::integer,
      NULLIF(p_payload->>'attribution_mode', ''),
      (NULLIF(p_payload->>'opens_at', ''))::timestamptz,
      (NULLIF(p_payload->>'closes_at', ''))::timestamptz,
      COALESCE(NULLIF(p_payload->>'status', ''), 'draft'),
      NULLIF(p_payload->>'anchor_type', ''),
      NULLIF(btrim(p_payload->>'anchor_id'), ''),
      v_uid
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.club_groups SET
      slug             = COALESCE(NULLIF(btrim(p_payload->>'slug'), ''), slug),
      name_pl          = COALESCE(NULLIF(btrim(p_payload->>'name_pl'), ''), name_pl),
      name_en          = COALESCE(NULLIF(btrim(p_payload->>'name_en'), ''), name_en),
      description_pl   = CASE WHEN p_payload ? 'description_pl'
                              THEN NULLIF(btrim(p_payload->>'description_pl'), '') ELSE description_pl END,
      description_en   = CASE WHEN p_payload ? 'description_en'
                              THEN NULLIF(btrim(p_payload->>'description_en'), '') ELSE description_en END,
      icon             = CASE WHEN p_payload ? 'icon'
                              THEN NULLIF(btrim(p_payload->>'icon'), '') ELSE icon END,
      accent_color     = CASE WHEN p_payload ? 'accent_color'
                              THEN NULLIF(btrim(p_payload->>'accent_color'), '') ELSE accent_color END,
      sort_order       = COALESCE((p_payload->>'sort_order')::integer, sort_order),
      visibility       = CASE WHEN p_payload ? 'visibility'
                              THEN NULLIF(p_payload->>'visibility', '') ELSE visibility END,
      who_can_post     = CASE WHEN p_payload ? 'who_can_post'
                              THEN NULLIF(p_payload->>'who_can_post', '') ELSE who_can_post END,
      moderation_mode  = CASE WHEN p_payload ? 'moderation_mode'
                              THEN NULLIF(p_payload->>'moderation_mode', '') ELSE moderation_mode END,
      min_tier_rank    = CASE WHEN p_payload ? 'min_tier_rank'
                              THEN (p_payload->>'min_tier_rank')::integer ELSE min_tier_rank END,
      attribution_mode = CASE WHEN p_payload ? 'attribution_mode'
                              THEN NULLIF(p_payload->>'attribution_mode', '') ELSE attribution_mode END,
      opens_at         = CASE WHEN p_payload ? 'opens_at'
                              THEN (NULLIF(p_payload->>'opens_at', ''))::timestamptz ELSE opens_at END,
      closes_at        = CASE WHEN p_payload ? 'closes_at'
                              THEN (NULLIF(p_payload->>'closes_at', ''))::timestamptz ELSE closes_at END,
      status           = COALESCE(NULLIF(p_payload->>'status', ''), status),
      anchor_type      = CASE WHEN p_payload ? 'anchor_type'
                              THEN NULLIF(p_payload->>'anchor_type', '') ELSE anchor_type END,
      anchor_id        = CASE WHEN p_payload ? 'anchor_id'
                              THEN NULLIF(btrim(p_payload->>'anchor_id'), '') ELSE anchor_id END
    WHERE id = v_id;
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'clubs: slug already taken' USING ERRCODE = '23505';
END;
$$;

COMMENT ON FUNCTION public.admin_club_group_upsert(jsonb) IS
  'Tworzy albo aktualizuje grupe. NULL/pusty string w kolumnie ustawienia = dziedzicz z klubu (droplista "dziedziczone" wysyla pusta wartosc).';

REVOKE EXECUTE ON FUNCTION public.admin_club_group_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_group_upsert(jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Kolejnosc grup (drag & drop)
--
-- Jedno wywolanie na cala liste, nie N wywolan po jednym wierszu: przeciagniecie
-- elementu zmienia pozycje wszystkich ponizej, a N zapytan dawaloby N stanow
-- posrednich widocznych dla innych czytelnikow.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_group_reorder(
  p_club_id uuid, p_group_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  uuid := public.current_tenant_id();
  v_updated integer := 0;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_group_ids IS NULL OR array_length(p_group_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.club_groups g
     SET sort_order = ord.pos - 1
    FROM unnest(p_group_ids) WITH ORDINALITY AS ord(gid, pos)
    JOIN public.clubs c ON c.id = p_club_id
   WHERE g.id = ord.gid
     AND g.club_id = p_club_id
     AND c.tenant_id = v_tenant;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.admin_club_group_reorder(uuid, uuid[]) IS
  'Ustawia kolejnosc grup jedna transakcja z tablicy id. Wiersze spoza klubu albo spoza tenanta sa po prostu pomijane.';

REVOKE EXECUTE ON FUNCTION public.admin_club_group_reorder(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_group_reorder(uuid, uuid[])
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Zarzadzanie czlonkami
--
-- Rola KLUBOWA to osobna os od public.app_role. Ta funkcja przyjmuje wylacznie
-- role klubowe; przekazanie 'admin' konczy sie bledem CHECK-a, nie cichym
-- nadaniem uprawnien redakcyjnych. To jest najgrozniejszy mozliwy blad w tym
-- module (V2 §3.2) i pilnuje go pgTAP.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_member_upsert(
  p_club_id uuid,
  p_user_id uuid,
  p_role    text DEFAULT 'member',
  p_status  text DEFAULT 'active',
  p_role_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant      uuid := public.current_tenant_id();
  v_club_tenant uuid;
  v_peer_tenant uuid;
  v_id          uuid;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('lead', 'moderator', 'member', 'observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('active', 'pending', 'invited', 'banned', 'left') THEN
    RAISE EXCEPTION 'clubs: invalid member status %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT c.tenant_id INTO v_club_tenant FROM public.clubs c WHERE c.id = p_club_id;
  SELECT p.tenant_id INTO v_peer_tenant FROM public.profiles p WHERE p.id = p_user_id;

  -- Trzy tenanty musza byc tym samym tenantem: admina, klubu i dodawanej osoby.
  IF v_club_tenant IS NULL OR v_club_tenant <> v_tenant THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF v_peer_tenant IS NULL OR v_peer_tenant <> v_tenant THEN
    RAISE EXCEPTION 'clubs: user not available' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.club_members (
    tenant_id, club_id, user_id, role, status, role_expires_at,
    invited_by, invite_source
  ) VALUES (
    v_tenant, p_club_id, p_user_id, p_role, p_status, p_role_expires_at,
    auth.uid(), 'direct'
  )
  ON CONFLICT (club_id, user_id) DO UPDATE SET
    role            = EXCLUDED.role,
    status          = EXCLUDED.status,
    role_expires_at = EXCLUDED.role_expires_at
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz) IS
  'Dodaje albo aktualizuje czlonka. Przyjmuje WYLACZNIE role klubowe - rola platformy (app_role) jest osobna osia i nie moze tedy przejsc.';

REVOKE EXECUTE ON FUNCTION public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_club_member_remove(
  p_club_id uuid, p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hit    integer;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.club_members m
   USING public.clubs c
   WHERE m.club_id = p_club_id
     AND m.user_id = p_user_id
     AND c.id = m.club_id
     AND c.tenant_id = v_tenant;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit > 0;
END;
$$;

COMMENT ON FUNCTION public.admin_club_member_remove(uuid, uuid) IS
  'Usuwa czlonkostwo. Do trwalego odciecia sluzy status banned (admin_club_member_upsert), bo usuniecie pozwala wrocic.';

REVOKE EXECUTE ON FUNCTION public.admin_club_member_remove(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_member_remove(uuid, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) Podglad zdolnosci wskazanej osoby ("Podglad jako...", V2 zakladka 7)
--
-- Najtanszy znany sposob na uniknieciu klasy bledow "myslalem, ze ma dostep".
-- Osobna funkcja, bo club_capabilities z cudzym _user_id nie moze byc dostepne
-- dla kazdego - to bylby wyciek informacji o czyichs uprawnieniach.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_capabilities_preview(uuid, uuid, uuid);

-- Parametr opcjonalny musi byc ostatni, wiec kolejnosc to (klub, osoba, grupa)
-- - inna niz w club_capabilities. Swiadomie, bo alternatywa jest wymuszanie
-- na kliencie podawania pustej grupy, a pusty string nie skastuje sie na uuid.
CREATE FUNCTION public.admin_club_capabilities_preview(
  _club_id uuid, _user_id uuid, _group_id uuid DEFAULT NULL
)
RETURNS TABLE (
  can_read boolean, can_post_thread boolean, can_reply boolean, can_react boolean,
  can_moderate boolean, can_manage boolean, can_invite boolean,
  can_see_members boolean, can_reveal_author boolean,
  effective_role text, reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ok     boolean;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT true INTO v_ok
    FROM public.clubs c
    JOIN public.profiles p ON p.id = _user_id
   WHERE c.id = _club_id AND c.tenant_id = v_tenant AND p.tenant_id = v_tenant;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT * FROM public.club_capabilities(_club_id, _group_id, _user_id);
END;
$$;

COMMENT ON FUNCTION public.admin_club_capabilities_preview(uuid, uuid, uuid) IS
  'Podglad zdolnosci wskazanej osoby dla panelu. Osobna funkcja, bo club_capabilities z cudzym user_id byloby wyciekiem informacji o uprawnieniach.';

REVOKE EXECUTE ON FUNCTION public.admin_club_capabilities_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_capabilities_preview(uuid, uuid, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Statystyki klubu (zakladka 9)
--
-- "Odsetek tematow bez odpowiedzi" jest tu od pierwszego dnia, mimo ze tematy
-- przychodza dopiero w A3 - bo to jedyna metryka, ktora mowi, czy klub dziala.
-- Do czasu A3 zwraca zera, a nie NULL: pusta karta jest czytelniejsza niz brak
-- karty, ktora nagle sie pojawia.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_stats(uuid);

CREATE FUNCTION public.admin_club_stats(p_club_id uuid)
RETURNS TABLE (
  member_count integer, active_members_30d integer, pending_members integer,
  group_count integer, thread_count integer, banned_count integer,
  leads_count integer, moderators_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.member_count,
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'active'
        AND m.last_read_at IS NOT NULL AND m.last_read_at > now() - interval '30 days'),
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'pending'),
    c.group_count,
    c.thread_count,
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'banned'),
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'active' AND m.role = 'lead'),
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'active' AND m.role = 'moderator')
  FROM public.clubs c
  WHERE c.id = p_club_id
    AND public.is_club_admin(auth.uid())
    AND c.tenant_id = public.current_tenant_id()
$$;

COMMENT ON FUNCTION public.admin_club_stats(uuid) IS
  'Metryki klubu dla zakladki statystyk. Zwraca zero wierszy dla obcego tenanta - brak wyjatku, bo panel i tak nie pokaze karty.';

REVOKE EXECUTE ON FUNCTION public.admin_club_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_stats(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8) Pelny klub po id dla edytora
--
-- Osobno od club_view(slug): edytor pracuje na id (slug moze sie w nim wlasnie
-- zmieniac, wiec nie nadaje sie na klucz), a admin musi widziec takze wersje
-- robocze i archiwum, ktorych projekcja produktowa nie pokazuje.
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
  policy_area text, status text,
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
    c.policy_area, c.status,
    c.member_count, c.group_count, c.thread_count,
    c.last_activity_at, c.created_at, c.updated_at
  FROM public.clubs c
  WHERE c.id = p_club_id
    AND public.is_club_admin(auth.uid())
    AND c.tenant_id = public.current_tenant_id()
$$;

COMMENT ON FUNCTION public.admin_club_get(uuid) IS
  'Pelny klub po id dla edytora w panelu. Po id, nie po slugu - slug moze sie wlasnie w edytorze zmieniac.';

REVOKE EXECUTE ON FUNCTION public.admin_club_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_get(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) Grupy klubu dla panelu
--
-- club_groups_list() filtruje po can_read i chowa draft/archived przed
-- nie-zarzadzajacym. Admin potrzebuje kompletu w jednym miejscu, bez
-- przepuszczania kazdej grupy przez club_capabilities - to N wywolan na liste.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_groups(uuid);

CREATE FUNCTION public.admin_club_groups(p_club_id uuid)
RETURNS TABLE (
  id uuid, club_id uuid, slug text, name_pl text, name_en text,
  description_pl text, description_en text, icon text, accent_color text,
  sort_order integer, status text,
  opens_at timestamptz, closes_at timestamptz,
  anchor_type text, anchor_id text,
  thread_count integer, last_activity_at timestamptz,
  visibility text, visibility_inherited boolean,
  who_can_post text, who_can_post_inherited boolean,
  moderation_mode text, moderation_mode_inherited boolean,
  min_tier_rank integer, min_tier_rank_inherited boolean,
  attribution_mode text, attribution_mode_inherited boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id, g.club_id, g.slug, g.name_pl, g.name_en,
    g.description_pl, g.description_en, g.icon, g.accent_color,
    g.sort_order, g.status,
    g.opens_at, g.closes_at,
    g.anchor_type, g.anchor_id,
    g.thread_count, g.last_activity_at,
    COALESCE(g.visibility, c.visibility),             (g.visibility IS NULL),
    COALESCE(g.who_can_post, c.who_can_post),         (g.who_can_post IS NULL),
    COALESCE(g.moderation_mode, c.moderation_mode),   (g.moderation_mode IS NULL),
    COALESCE(g.min_tier_rank, c.min_tier_rank),       (g.min_tier_rank IS NULL),
    COALESCE(g.attribution_mode, c.attribution_mode), (g.attribution_mode IS NULL)
  FROM public.club_groups g
  JOIN public.clubs c ON c.id = g.club_id
  WHERE g.club_id = p_club_id
    AND public.is_club_admin(auth.uid())
    AND c.tenant_id = public.current_tenant_id()
  ORDER BY g.sort_order ASC, g.created_at ASC
$$;

COMMENT ON FUNCTION public.admin_club_groups(uuid) IS
  'Wszystkie grupy klubu (takze draft i archived) z rozwiazanym dziedziczeniem, dla panelu admina.';

REVOKE EXECUTE ON FUNCTION public.admin_club_groups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_groups(uuid) TO authenticated, service_role;
