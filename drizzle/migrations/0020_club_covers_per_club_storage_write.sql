-- Okładki klubów: zapis do `club-covers/<clubId>/...` tylko dla prowadzących
-- TEGO klubu.
--
-- DEFEKT (skan bezpieczeństwa, IDOR_CROSS_CLUB_STORAGE_WRITE): polityki
-- `club covers moderator insert/update/delete` sprawdzały wyłącznie prefiks
-- `club-covers` oraz `club_is_any_moderator(auth.uid())` - czyli „czy jesteś
-- moderatorem JAKIEGOKOLWIEK klubu". Prowadzący klub A mógł więc nadpisać albo
-- usunąć okładkę klubu B, znając (albo zgadując) jej ścieżkę w magazynie.
--
-- POPRAWKA: drugi segment ścieżki to identyfikator klubu i musi wskazywać klub,
-- który wywołujący realnie prowadzi. Sprawdzenie żyje w jednej funkcji
-- SECURITY DEFINER (polityka storage nie może czytać `public.club_members`
-- prawami wywołującego), która przy ścieżce bez poprawnego UUID zwraca FALSE
-- (fail-closed).

CREATE OR REPLACE FUNCTION public.club_is_cover_moderator(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts text[] := storage.foldername(COALESCE(_object_name, ''));
  v_club  uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Wymagamy DOKŁADNIE `club-covers/<uuid>/<plik>`: brak segmentu klubu albo
  -- segment, który nie jest UUID, to brak uprawnienia - nie "wolno wszystko".
  IF array_length(v_parts, 1) IS DISTINCT FROM 2 OR v_parts[1] <> 'club-covers' THEN
    RETURN FALSE;
  END IF;
  BEGIN
    v_club := v_parts[2]::uuid;
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;

  RETURN EXISTS (
    SELECT 1
      FROM public.club_members m
     WHERE m.user_id = _user_id
       AND m.club_id = v_club
       AND m.role IN ('owner', 'moderator')
  ) OR public.has_role(_user_id, 'admin'::app_role);
END;
$$;

COMMENT ON FUNCTION public.club_is_cover_moderator(uuid, text) IS
  'TRUE, gdy sciezka club-covers/<clubId>/... nalezy do klubu prowadzonego przez _user_id (albo gdy _user_id jest adminem). Fail-closed dla sciezek bez poprawnego UUID klubu.';

REVOKE ALL ON FUNCTION public.club_is_cover_moderator(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.club_is_cover_moderator(uuid, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "club covers moderator insert" ON storage.objects;
DROP POLICY IF EXISTS "club covers moderator update" ON storage.objects;
DROP POLICY IF EXISTS "club covers moderator delete" ON storage.objects;

CREATE POLICY "club covers moderator insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  );

CREATE POLICY "club covers moderator update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  )
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  );

CREATE POLICY "club covers moderator delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  );
