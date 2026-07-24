-- ============================================================================
-- FIX (funkcjonalny): przepływ "Wprowadzeń" (introduction_requests).
--
-- Model statusów (CHECK): 'pending' -> 'forwarded' (most przekazuje) |
-- 'declined' (most odrzuca) | 'withdrawn' (proszący wycofuje).
--
-- Wykryte defekty po stronie serwera:
--   1) respond_introduction obsługiwało tylko akcje mostu ('forward'/'decline')
--      z warunkiem bridge_id = auth.uid(). Proszący nie miał ŻADNEJ ścieżki
--      wycofania - przycisk "Wycofaj" w UI zawsze kończył się wyjątkiem
--      ('not your request or not pending'). Dodajemy ścieżkę 'withdraw' dla
--      proszącego (requester_id = auth.uid(), pending -> withdrawn).
--   2) my_introduction_requests nie zwracało avatara mostu, więc zakładka
--      "O mnie" (target) nie mogła pokazać, KTO wprowadził. Dodajemy
--      bridge_avatar (zmiana sygnatury -> DROP + CREATE + ponowny GRANT).
--
-- CREATE OR REPLACE dla respond_introduction zachowuje granty (sygnatura bez
-- zmian). my_introduction_requests zmienia RETURNS TABLE, więc wymaga DROP.
-- ============================================================================

-- ── respond_introduction: dodaj ścieżkę wycofania dla proszącego ────────────
CREATE OR REPLACE FUNCTION public.respond_introduction(p_id UUID, p_action TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF p_action IN ('forward', 'decline') THEN
    -- Most rozstrzyga oczekującą prośbę skierowaną do niego.
    UPDATE public.introduction_requests
       SET status = CASE p_action WHEN 'forward' THEN 'forwarded' ELSE 'declined' END,
           responded_at = now(), updated_at = now()
     WHERE id = p_id AND bridge_id = auth.uid() AND status = 'pending';
  ELSIF p_action = 'withdraw' THEN
    -- Proszący wycofuje własną, wciąż oczekującą prośbę.
    UPDATE public.introduction_requests
       SET status = 'withdrawn', responded_at = now(), updated_at = now()
     WHERE id = p_id AND requester_id = auth.uid() AND status = 'pending';
  ELSE
    RAISE EXCEPTION 'invalid action: %', p_action;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'not your request or not pending'; END IF;
END; $$;

-- ── my_introduction_requests: dodaj bridge_avatar ───────────────────────────
DROP FUNCTION IF EXISTS public.my_introduction_requests(TEXT);
CREATE FUNCTION public.my_introduction_requests(p_role TEXT DEFAULT 'bridge')
RETURNS TABLE (
  id UUID, requester_id UUID, requester_name TEXT, requester_avatar TEXT,
  target_id UUID, target_name TEXT, target_avatar TEXT,
  bridge_id UUID, bridge_name TEXT, bridge_avatar TEXT,
  message TEXT, status TEXT, created_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT i.id, i.requester_id, pr.display_name, pr.avatar_url,
           i.target_id, pt.display_name, pt.avatar_url,
           i.bridge_id, pb.display_name, pb.avatar_url,
           i.message, i.status, i.created_at
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

GRANT EXECUTE ON FUNCTION public.my_introduction_requests(TEXT) TO authenticated;
