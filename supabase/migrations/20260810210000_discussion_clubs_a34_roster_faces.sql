-- ============================================================================
-- A34: SKLAD MOWI TWARZAMI, NIE WYKRESEM. KONIEC MODULU "DOROBEK KLUBU".
--
-- Dwie decyzje produktowe, jedna migracja - bo obie sprowadzaja sie do tego
-- samego: usuwamy z bazy to, czego produkt przestal pytac.
--
-- 1) ISKRA AKTYWNOSCI WYCHODZI ZE SKLADU. Czternastodniowy szereg liczby
--    roznych aktywnych osob byl poprawna odpowiedzia na pytanie, ktorego
--    czlonek klubu nie zadaje. Wchodzac na klub, ktorego nie zna, pyta "KTO
--    tu jest", a nie "ilu ich bylo w srode". Slupki zastepuje rzad twarzy:
--    ta sama wysokosc panelu, informacja o ludziach zamiast o wolumenie.
--
--    Skoro szereg nie ma juz konsumenta, znika takze z RPC - razem z oknem
--    14-dniowym, ktore skanowalo trzy tabele wylacznie po to, zeby go zlozyc.
--    Zostaje okno 7-dniowe, jedyne, ktorego potrzebuja liczniki.
--
--    W zamian twarz niesie DWA POLA WIECEJ: `headline` (stanowisko sklejone
--    z profilu) i `joined_at`. Awatar bez podpisu jest ozdoba; awatar, pod ktorym stoi
--    "kto to jest i od kiedy tu jest", jest powodem, zeby sie odezwac - a
--    o to w tym module chodzi. Domyslna pula rosnie z 12 do 24, bo interfejs
--    pokazuje SZESC osob rotacyjnie i musi miec z czego rotowac.
--
-- 2) `club_output_list` ZNIKA. Modul "Dorobek klubu" zostal wycofany z
--    produktu w calosci (panel szyny, trasa, kafelek sekcji). Funkcja bez ani
--    jednego wolajacego nie jest neutralna: ma GRANT dla `authenticated`
--    i `anon`, oddaje tytuly materialow i nazwiska wspolautorow, i nikt jej
--    juz nie testuje przy zmianie regul widocznosci. Martwe RPC jest gorsze
--    niz martwy komponent - komponentu nie da sie zawolac z internetu.
--
-- ZMIANA SYGNATURY = DROP + CREATE (patrz A33). DROP-ujemy takze NOWA
-- sygnature, bo platforma zapisuje przy wdrozeniu wlasna kopie pliku i ten
-- sam CREATE wykonuje sie w odtworzeniu bazy od zera dwa razy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) DOROBEK KLUBU: koniec RPC
--
-- Obie sygnatury: A32 miala dwa argumenty, A33 dolozyla `p_offset`. Bez
-- zdjecia obu w bazie zostalby dzialajacy endpoint z pierwszej wersji.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_output_list(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.club_output_list(uuid, integer);

-- ----------------------------------------------------------------------------
-- 2) SKLAD Z SYGNALEM OBECNOSCI: liczby i twarze, bez szeregu
--
-- Kolejnosc twarzy zostaje bez zmian - najpierw kto tu wlasnie byl, potem kto
-- wlasnie doszedl - i to jest warunek poprawnosci rotacji po stronie klienta:
-- interfejs przypina osoby aktywne w dobie, a rotuje wylacznie ogonem. Gdyby
-- baza oddawala pule w porzadku losowym, "aktywni" gubiliby sie w rotacji
-- i kropka obecnosci przestalaby cokolwiek znaczyc.
--
-- Stanowisko idzie tym samym torem widocznosci, co nazwisko: pole wychodzi
-- wylacznie z wiersza, ktory juz przeszedl przez `discoverable`. Awatar nadal
-- respektuje `hide_avatar` osobno - to sa dwa rozne ustawienia i tylko drugie
-- mowi o zdjeciu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_roster_signal(uuid, integer);

CREATE FUNCTION public.club_roster_signal(p_club_id uuid, p_limit integer DEFAULT 24)
RETURNS TABLE (
  members_total integer,
  new_7d integer,
  active_24h integer,
  active_7d integer,
  faces jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  -- Jedno okno, 7 dni: tyle, ile potrzebuja liczniki i kropka obecnosci.
  -- Okno 14-dniowe zywilo iskre, ktorej juz nie ma.
  acts AS (
    SELECT author_id, created_at FROM public.club_threads
     WHERE club_id = p_club_id AND author_id IS NOT NULL
       AND created_at > now() - interval '7 days'
    UNION ALL
    SELECT author_id, created_at FROM public.club_replies
     WHERE club_id = p_club_id AND author_id IS NOT NULL AND status = 'visible'
       AND created_at > now() - interval '7 days'
    UNION ALL
    SELECT author_id, created_at FROM public.club_posts
     WHERE club_id = p_club_id AND author_id IS NOT NULL AND status = 'published'
       AND created_at > now() - interval '7 days'
  ),
  last_seen AS (
    SELECT author_id, max(created_at) AS last_at
      FROM acts
     GROUP BY author_id
  ),
  roster AS (
    SELECT m.user_id, m.joined_at,
           public.club_effective_member_role(m.role, m.role_expires_at) AS club_role,
           l.last_at
      FROM public.club_members m
      CROSS JOIN cap
      LEFT JOIN last_seen l ON l.author_id = m.user_id
     WHERE m.club_id = p_club_id
       AND m.status = 'active'
       AND cap.can_read
  ),
  counts AS (
    SELECT
      count(*)::int AS members_total,
      count(*) FILTER (WHERE joined_at > now() - interval '7 days')::int AS new_7d,
      count(*) FILTER (WHERE last_at > now() - interval '24 hours')::int AS active_24h,
      count(*) FILTER (WHERE last_at IS NOT NULL)::int AS active_7d
    FROM roster
  ),
  visible AS (
    -- Pozycja jedzie JAWNA kolumna, bo `ORDER BY` w podzapytaniu nie jest
    -- obietnica dla agregatu ponizej - jest tylko wyborem wierszy do limitu.
    SELECT r.*,
           row_number() OVER (
             ORDER BY (r.last_at IS NOT NULL) DESC, r.last_at DESC NULLS LAST, r.joined_at DESC
           ) AS pos
      FROM roster r
      CROSS JOIN cap
      JOIN public.profiles p ON p.id = r.user_id
     WHERE cap.can_see_members
       AND (p.discoverable OR r.user_id = auth.uid())
     ORDER BY pos
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 60)
  )
  SELECT
    counts.members_total, counts.new_7d, counts.active_24h, counts.active_7d,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id',    v.user_id,
                  'name',       COALESCE(NULLIF(btrim(p.display_name), ''),
                                         NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                                         'User'),
                  'avatar_url', CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
                  'slug',       p.slug,
                  -- Ta sama sklejka stanowiska, co w tablicy ogloszen
                  -- i w katalogu ekspertow: "Dyrektor - MSZ". Trzeci wariant
                  -- tego samego napisu rozjechalby sie przy pierwszej zmianie.
                  'headline',   NULLIF(btrim(concat_ws(' - ', NULLIF(btrim(p.job_title), ''),
                                                              NULLIF(btrim(p.current_company), ''))), ''),
                  'role',       v.club_role,
                  'joined_at',  v.joined_at,
                  'is_new',     v.joined_at > now() - interval '7 days',
                  'is_active',  COALESCE(v.last_at > now() - interval '24 hours', false),
                  'topics',     COALESCE(
                                  (SELECT array_agg(e.topic ORDER BY e.topic)
                                     FROM public.club_member_expertise e
                                    WHERE e.club_id = p_club_id AND e.user_id = v.user_id),
                                  ARRAY[]::text[])
                ) ORDER BY v.pos)
         FROM visible v
         JOIN public.profiles p ON p.id = v.user_id),
      '[]'::jsonb)
  FROM counts
$$;

COMMENT ON FUNCTION public.club_roster_signal(uuid, integer) IS
  'Sklad klubu z sygnalem obecnosci: liczby (razem / nowi 7 dni / aktywni 24 h / aktywni 7 dni) i pula twarzy z stanowiskiem, data dolaczenia i tagami kompetencji, uporzadkowana od ostatnio aktywnych. Twarze wychodza tylko przy can_see_members i tylko dla profili discoverable. Bez szeregu czasowego - iskra aktywnosci zostala wycofana w A34.';

REVOKE EXECUTE ON FUNCTION public.club_roster_signal(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_roster_signal(uuid, integer) TO authenticated, service_role;
