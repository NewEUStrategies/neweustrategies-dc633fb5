-- my_introduction_requests: slug kazdej ze stron, tylko gdy get_member_profile go rozwiaze (blizniak 20261002100000).
DROP FUNCTION IF EXISTS public.my_introduction_requests(TEXT);
CREATE FUNCTION public.my_introduction_requests(p_role TEXT DEFAULT 'bridge')
RETURNS TABLE (
  id UUID, requester_id UUID, requester_name TEXT, requester_avatar TEXT,
  target_id UUID, target_name TEXT, target_avatar TEXT,
  bridge_id UUID, bridge_name TEXT, bridge_avatar TEXT,
  message TEXT, status TEXT, created_at TIMESTAMPTZ,
  requester_slug TEXT, target_slug TEXT, bridge_slug TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT i.id, i.requester_id, pr.display_name, pr.avatar_url,
           i.target_id, pt.display_name, pt.avatar_url,
           i.bridge_id, pb.display_name, pb.avatar_url,
           i.message, i.status, i.created_at,
           -- Slug tylko wtedy, gdy /people/<slug> rozwiaze TE osobe dla
           -- wolajacego; inaczej NULL i karta nie renderuje linku.
           CASE WHEN btrim(pr.slug) <> ''
                 AND public.get_member_profile(pr.slug) ->> 'id' = pr.id::text
                THEN pr.slug END,
           CASE WHEN btrim(pt.slug) <> ''
                 AND public.get_member_profile(pt.slug) ->> 'id' = pt.id::text
                THEN pt.slug END,
           CASE WHEN btrim(pb.slug) <> ''
                 AND public.get_member_profile(pb.slug) ->> 'id' = pb.id::text
                THEN pb.slug END
      FROM public.introduction_requests i
      JOIN public.profiles pr ON pr.id = i.requester_id
      JOIN public.profiles pt ON pt.id = i.target_id
      JOIN public.profiles pb ON pb.id = i.bridge_id
     WHERE CASE p_role
             WHEN 'bridge'    THEN i.bridge_id = auth.uid()
             WHEN 'requester' THEN i.requester_id = auth.uid()
             WHEN 'target'    THEN i.target_id = auth.uid() AND i.status = 'forwarded'
             ELSE FALSE END
     ORDER BY i.created_at DESC;
END; $$;

COMMENT ON FUNCTION public.my_introduction_requests(text) IS
  'Wprowadzenia zalogowanego w jednej roli (bridge / requester / target). '
  'Kolumny *_slug sa niepuste wylacznie wtedy, gdy get_member_profile(slug) '
  'rozwiazuje te osobe dla wolajacego - to jedyny parametr, jaki przyjmuje '
  'trasa /people/<slug>. NULL znaczy: nie linkuj (UUID nie jest slugiem).';

REVOKE EXECUTE ON FUNCTION public.my_introduction_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_introduction_requests(text) TO authenticated;
