-- 1) Czy uzytkownik prowadzi JAKIKOLWIEK klub - potrzebne polityce storage,
--    ktora nie zna id klubu w momencie uploadu.
CREATE OR REPLACE FUNCTION public.club_is_any_moderator(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.club_members m
     WHERE m.user_id = _user_id
       AND m.role IN ('owner', 'moderator')
  ) OR public.has_role(_user_id, 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.club_is_any_moderator(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.club_is_any_moderator(uuid) TO authenticated, service_role;

-- 2) Ustawienie / zdjecie okladki klubu.
CREATE OR REPLACE FUNCTION public.club_set_cover(p_club_id uuid, p_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_club public.clubs%ROWTYPE;
  v_caps record;
  v_url  text := NULLIF(btrim(COALESCE(p_url, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_club FROM public.clubs WHERE id = p_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_club.id, NULL::uuid, v_uid);
  IF NOT COALESCE(v_caps.can_moderate, false)
     AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Tylko adresy z naszego magazynu: pole trafia prosto do <img src>, wiec
  -- dowolny URL byloby zaproszeniem do trackingu i mieszanej tresci.
  IF v_url IS NOT NULL AND v_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/' THEN
    RAISE EXCEPTION 'clubs: invalid cover url' USING ERRCODE = '22023';
  END IF;

  UPDATE public.clubs SET cover_image_url = v_url WHERE id = p_club_id;
  RETURN v_url;
END;
$$;

REVOKE ALL ON FUNCTION public.club_set_cover(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.club_set_cover(uuid, text) TO authenticated, service_role;

-- 3) Prowadzacy kluby moga wgrywac pliki okladek do wydzielonego prefiksu.
CREATE POLICY "club covers moderator insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_any_moderator(auth.uid())
  );

CREATE POLICY "club covers moderator update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_any_moderator(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_any_moderator(auth.uid())
  );

CREATE POLICY "club covers moderator delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_any_moderator(auth.uid())
  );
