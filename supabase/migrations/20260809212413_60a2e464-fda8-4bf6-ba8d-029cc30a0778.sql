-- ============================================================================
-- Anonimowosc UCZESTNIKOW ustawiana przy zakladaniu watku.
--
-- Do tej pory tryb atrybucji mial klub i dzial, a autor decydowal wylacznie
-- o SWOIM podpisie (`is_anonymous`). Nie dalo sie zalozyc jednej rozmowy, w
-- ktorej WSZYSCY uczestnicy wystepuja pod pseudonimem. Watek dostaje wiec
-- wlasne nadpisanie, a projekcje licza tryb efektywny: watek -> dzial -> klub.
-- ============================================================================
ALTER TABLE public.club_threads
  ADD COLUMN IF NOT EXISTS attribution_mode text
  CHECK (attribution_mode IN ('attributed','chatham','anonymous_allowed'));

COMMENT ON COLUMN public.club_threads.attribution_mode IS
  'Nadpisanie trybu atrybucji dla jednego watku. NULL = dziedziczy dzial, dzial dziedziczy klub. chatham = wszyscy uczestnicy pseudonimizowani niezaleznie od wlasnego wyboru.';

-- ============================================================================
-- ALGORYTM PSEUDONIMIZACJI (v2)
--
-- v1 liczyl `hashtextextended` i mapowal wynik na 26 liter. Za malo z dwoch
-- powodow: (1) hashtext nie jest funkcja kryptograficzna, (2) 26 kubelkow to
-- kolizje juz przy kilkunastu rozmowcach - dwie osoby dostawaly ten sam
-- pseudonim i watek stawal sie nieczytelny.
--
-- v2: HMAC-SHA256(klucz = sol tenanta, wiadomosc = 'v2:' || watek || autor);
-- 25 bitow wyniku -> 5 znakow Crockford Base32 (bez I, L, O, U). Przestrzen
-- ~33,5 mln. Pseudonim jest STABILNY w obrebie watku i ROZNY miedzy watkami,
-- wiec nie da sie zlozyc profilu jednej osoby z calej historii klubu.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_author_alias(_thread_id uuid, _author_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_salt     text;
  v_mac      bytea;
  v_bits     bigint;
  v_alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_out      text := '';
  v_i        integer;
BEGIN
  IF _author_id IS NULL OR _thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.tenant_id INTO v_tenant FROM public.club_threads t WHERE t.id = _thread_id;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  -- Funkcja jest STABLE, wiec soli tu nie zakladamy; brak soli znaczy tylko,
  -- ze tenant nie mial jeszcze zadnej rozmowy.
  SELECT s.salt INTO v_salt FROM public.club_anonymity_salts s WHERE s.tenant_id = v_tenant;
  IF v_salt IS NULL THEN
    RETURN '?????';
  END IF;

  v_mac := extensions.hmac('v2:' || _thread_id::text || ':' || _author_id::text, v_salt, 'sha256');

  v_bits := (get_byte(v_mac, 0)::bigint << 32)
          | (get_byte(v_mac, 1)::bigint << 24)
          | (get_byte(v_mac, 2)::bigint << 16)
          | (get_byte(v_mac, 3)::bigint << 8)
          |  get_byte(v_mac, 4)::bigint;

  FOR v_i IN 0..4 LOOP
    v_out := v_out || substr(v_alphabet, 1 + ((v_bits >> (35 - v_i * 5)) & 31)::int, 1);
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.club_author_alias(uuid, uuid) IS
  'Pseudonim Chatham House v2: HMAC-SHA256 z sola tenanta, 25 bitow w Crockford Base32. Stabilny w watku, rozny miedzy watkami, nieodwracalny bez soli.';

REVOKE EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) TO service_role;

-- ============================================================================
-- Projekcje: tryb efektywny liczony z watku. Patchujemy istniejace cialo
-- funkcji, zeby nie duplikowac tu setek linii logiki sortowania i widocznosci
-- - kazdy krok twardo sprawdza, ze wzorzec byl obecny.
-- ============================================================================
DO $do$
DECLARE
  v_def  text;
  v_new  text;
  r      record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('club_thread_view',
       'COALESCE(g.attribution_mode, c.attribution_mode) AS mode',
       'COALESCE(t.attribution_mode, g.attribution_mode, c.attribution_mode) AS mode'),
      ('club_threads_list',
       'COALESCE(g.attribution_mode, cl.attribution_mode) AS attribution',
       'COALESCE(t.attribution_mode, g.attribution_mode, cl.attribution_mode) AS attribution'),
      ('club_replies_list',
       'COALESCE(g.attribution_mode, c.attribution_mode) AS attribution',
       'COALESCE(t.attribution_mode, g.attribution_mode, c.attribution_mode) AS attribution'),
      ('club_reply',
       'SELECT COALESCE(g.attribution_mode, c.attribution_mode),',
       'SELECT COALESCE(v_thread.attribution_mode, g.attribution_mode, c.attribution_mode),')
    ) AS x(fname, needle, repl)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fname;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'clubs: brak funkcji public.%', r.fname;
    END IF;
    IF position(r.needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'clubs: wzorzec atrybucji nieodnaleziony w public.%', r.fname;
    END IF;

    v_new := replace(v_def, r.needle, r.repl);
    EXECUTE v_new;
  END LOOP;
END
$do$;

-- ============================================================================
-- club_create_thread: nowy parametr p_attribution_mode.
-- Autor moze ZAOSTRZYC zasade dziedziczona z dzialu (np. zamknac rozmowe w
-- regule Chatham House), ale nie moze jej POLUZOWAC - to byloby obejscie
-- polityki klubu przez zalozenie watku. Poluzowanie zostaje przy prowadzeniu.
-- ============================================================================
DO $do$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'club_create_thread'
     AND pg_get_function_identity_arguments(p.oid) LIKE '%p_icon text';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'clubs: brak public.club_create_thread(11 arg)';
  END IF;

  v_def := replace(v_def,
    'p_icon text DEFAULT NULL::text)',
    'p_icon text DEFAULT NULL::text, p_attribution_mode text DEFAULT NULL::text)');

  v_def := replace(v_def,
    '  v_prior     jsonb;',
    '  v_prior     jsonb;' || E'\n' ||
    '  v_thread_attr text := NULLIF(btrim(lower(COALESCE(p_attribution_mode, ''''))), '''');' || E'\n' ||
    '  v_base_attr text;');

  v_def := replace(v_def,
    '  v_attr := COALESCE(v_group.attribution_mode, v_club.attribution_mode);',
    '  v_base_attr := COALESCE(v_group.attribution_mode, v_club.attribution_mode);' || E'\n\n' ||
    '  IF v_thread_attr IS NOT NULL THEN' || E'\n' ||
    '    IF v_thread_attr NOT IN (''attributed'',''chatham'',''anonymous_allowed'') THEN' || E'\n' ||
    '      RAISE EXCEPTION ''clubs: invalid attribution mode %'', v_thread_attr USING ERRCODE = ''22023'';' || E'\n' ||
    '    END IF;' || E'\n' ||
    '    IF v_base_attr = ''chatham'' AND v_thread_attr <> ''chatham''' || E'\n' ||
    '       AND NOT COALESCE(v_caps.can_moderate, false) THEN' || E'\n' ||
    '      RAISE EXCEPTION ''clubs: attribution cannot be relaxed'' USING ERRCODE = ''42501'';' || E'\n' ||
    '    END IF;' || E'\n' ||
    '    IF v_base_attr = ''attributed'' AND v_thread_attr <> ''attributed''' || E'\n' ||
    '       AND NOT COALESCE(v_caps.can_moderate, false) THEN' || E'\n' ||
    '      RAISE EXCEPTION ''clubs: anonymous posting disabled'' USING ERRCODE = ''42501'';' || E'\n' ||
    '    END IF;' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  v_attr := COALESCE(v_thread_attr, v_base_attr);');

  v_def := replace(v_def,
    'is_anonymous, anchor_type, anchor_id, topic, icon, locked_at',
    'is_anonymous, anchor_type, anchor_id, topic, icon, locked_at, attribution_mode');

  v_def := replace(v_def,
    'CASE WHEN COALESCE(p_lock_replies, false) THEN now() ELSE NULL END' || E'\n' || '  )',
    'CASE WHEN COALESCE(p_lock_replies, false) THEN now() ELSE NULL END,' || E'\n' ||
    '    v_thread_attr' || E'\n' || '  )');

  IF position('p_attribution_mode text' IN v_def) = 0
     OR position('v_thread_attr' IN v_def) = 0
     OR position('attribution_mode' IN v_def) = 0 THEN
    RAISE EXCEPTION 'clubs: patch club_create_thread nie zlozyl sie';
  END IF;

  EXECUTE v_def;
END
$do$;

DROP FUNCTION IF EXISTS public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text);

COMMENT ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) IS
  'Zakladanie watku. p_attribution_mode ustawia anonimowosc UCZESTNIKOW rozmowy; wolno wylacznie zaostrzyc zasade dziedziczona z dzialu, poluzowanie wymaga prowadzenia klubu.';

REVOKE EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) TO authenticated, service_role;