-- ============================================================================
-- A30: ODPOWIEDZ MOWI, CO SIE Z NIA STALO
--
-- BLAD, KTORY TO NAPRAWIA. `club_reply` liczy status wpisu po stronie bazy -
-- 'visible' albo 'pending', w zaleznosci od trybu moderacji klubu lub dzialu
-- i od reputacji autora - ale zwracalo WYLACZNIE `uuid`. Klient nie mial wiec
-- zadnej drogi, zeby odroznic te dwa wyniki, i po kazdej udanej odpowiedzi
-- pokazywal "Odpowiedz opublikowana".
--
-- W klubie z premoderacja (`moderation_mode = 'pre'`) oraz w klubie 'trusted'
-- dla konta ponizej progu reputacji to zdanie jest NIEPRAWDA: wpis idzie do
-- kolejki i do czasu zatwierdzenia widzi go WYLACZNIE autor - `club_replies_list`
-- przepuszcza `status = 'pending'` tylko dla `author_id = auth.uid()` oraz dla
-- moderacji. Autor odchodzi wiec od ekranu przekonany, ze jego glos jest
-- w dyskusji, podczas gdy pozostali czlonkowie go nie maja.
--
-- Zmiana typu zwracanego, wiec DROP + CREATE. Cialo jest przeniesione z A8
-- bez zmian merytorycznych; rozni sie wylacznie ostatnia instrukcja.
--
-- Kolumna wyjsciowa nazywa sie `reply_status`, a nie `status`: `RETURNS TABLE`
-- wprowadza nazwy kolumn do zakresu jako zmienne plpgsql, a w tym ciele
-- `status` wystepuje juz jako kolumna `club_threads` i `club_replies`.
-- Kolizja nie wywalilaby CREATE, tylko dala zle rozstrzygniecie w runtime.
-- ============================================================================

DROP FUNCTION IF EXISTS public.club_reply(uuid, text, uuid, boolean);

CREATE FUNCTION public.club_reply(
  p_thread_id uuid, p_body text, p_parent_id uuid DEFAULT NULL,
  p_anonymous boolean DEFAULT false
)
RETURNS TABLE (reply_id uuid, reply_status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_thread public.club_threads%ROWTYPE;
  v_caps   record;
  v_attr   text;
  v_mod    text;
  v_status text;
  v_recent integer;
  v_burst  integer;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serializacja limitow dla tego uzytkownika. Blokada zwalnia sie na koncu
  -- transakcji, wiec rownolegle wywolania ustawiaja sie w kolejce zamiast
  -- czytac ten sam licznik.
  PERFORM pg_advisory_xact_lock(hashtext('club_reply:' || v_uid::text));

  SELECT * INTO v_thread FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF v_thread.locked_at IS NOT NULL OR v_thread.status IN ('locked','hidden','deleted') THEN
    RAISE EXCEPTION 'clubs: thread locked' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_thread.club_id, v_thread.group_id, v_uid);
  IF NOT COALESCE(v_caps.can_reply, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(g.attribution_mode, c.attribution_mode),
         COALESCE(g.moderation_mode, c.moderation_mode)
    INTO v_attr, v_mod
    FROM public.club_groups g JOIN public.clubs c ON c.id = g.club_id
   WHERE g.id = v_thread.group_id;

  IF p_anonymous AND v_attr = 'attributed' THEN
    RAISE EXCEPTION 'clubs: anonymous posting disabled' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_recent FROM public.club_replies
   WHERE author_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_recent >= 60 THEN
    RAISE EXCEPTION 'clubs: reply rate limit' USING ERRCODE = '42901';
  END IF;
  SELECT count(*)::int INTO v_burst FROM public.club_replies
   WHERE author_id = v_uid AND created_at > now() - interval '1 minute';
  IF v_burst >= 5 THEN
    RAISE EXCEPTION 'clubs: reply burst limit' USING ERRCODE = '42901';
  END IF;

  v_status := CASE
    WHEN v_caps.can_moderate THEN 'visible'
    WHEN v_mod = 'pre' THEN 'pending'
    WHEN v_mod = 'trusted' AND v_caps.reason = 'pre_moderation' THEN 'pending'
    ELSE 'visible' END;

  INSERT INTO public.club_replies (
    tenant_id, club_id, thread_id, author_id, parent_id, body, is_anonymous, status
  ) VALUES (
    v_thread.tenant_id, v_thread.club_id, p_thread_id, v_uid, p_parent_id,
    btrim(p_body), COALESCE(p_anonymous, false), v_status
  )
  RETURNING club_replies.id INTO v_id;

  IF v_thread.status = 'dormant' AND v_status = 'visible' THEN
    UPDATE public.club_threads SET status = 'open' WHERE id = p_thread_id;
  END IF;

  RETURN QUERY SELECT v_id, v_status;
END;
$$;

COMMENT ON FUNCTION public.club_reply(uuid, text, uuid, boolean) IS
  'Odpowiedz w watku. Zwraca identyfikator ORAZ status wpisu - visible albo pending. Bez tego drugiego klient nie odrozni publikacji od kolejki moderacyjnej i potwierdza publikacje wpisu, ktorego autor nie zobaczy.';

REVOKE EXECUTE ON FUNCTION public.club_reply(uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_reply(uuid, text, uuid, boolean)
  TO authenticated, service_role;
