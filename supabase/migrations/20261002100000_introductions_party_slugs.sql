-- ============================================================================
-- my_introduction_requests: SLUG KAZDEJ ZE STRON, A NIE UUID W MIEJSCU SLUGA.
--
-- BLIZNIAK drizzle/migrations/0120_introductions_party_slugs.sql - ten sam SQL
-- wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
--
-- FINDING. Karta "Wprowadzenia" na /profile (IntroductionsCard.tsx) linkowala
-- awatar i nazwisko drugiej strony (proszacy / most / cel) jako
-- `/people/$slug` z `params={{ slug: <requester|target|bridge>_id }}`. Trasa
-- /people/<slug> czyta profil przez `get_member_profile(p_slug)`
-- (20260924100000:34-36), ktore szuka WYLACZNIE po `profiles.slug` - UUID nigdy
-- nie trafia, wiec KAZDE klikniecie w KAZDEJ z trzech rol konczylo sie karta
-- "Nie znaleziono profilu". Dawny cel `/author/$slug` przyjmowal UUID
-- (fallback w src/lib/experts/queries.ts:153), stad defekt ujawnil sie dopiero
-- przy przepieciu linkow na /people. 20260925100000:71-74 opisuje ten sam
-- mechanizm wprost ("dopasowanie UUID przekierowaloby na strone, ktora
-- profilu nie rozwiaze"). Przyczyna zrodlowa lezy tutaj: RPC zasilajace karte
-- (ostatnia definicja 20260724120000:46-73; pas drizzle jej nie redefiniuje)
-- nie zwracalo zadnej kolumny slug, wiec klient nie mial czego podac.
--
-- CO ZMIENIA
--   1. RETURNS TABLE dostaje na KONCU trzy kolumny: requester_slug,
--      target_slug, bridge_slug. Pozostale 13 kolumn, ich kolejnosc, cialo
--      WHERE (lacznie z `ELSE FALSE`) i ORDER BY - bez zmian.
--   2. Slug wraca TYLKO wtedy, gdy /people/<slug> ROZWIAZE te osobe dla
--      wolajacego: `get_member_profile(slug) ->> 'id'` = id tej strony.
--      W kazdym innym przypadku NULL, a karta pokazuje sam tekst zamiast
--      martwego linku. Bramki NIE kopiujemy (tenant + wlasny / discoverable /
--      polaczenie, 20260924100000:31-40) - wolamy ja, jak robi to juz
--      `member_slug_is_non_author` (20260925100000:107), zeby przyszla zmiana
--      widocznosci profilu nie rozjechala sie z tym, co karta linkuje.
--      Realne przypadki NULL: most ogladajacy proszacego po zerwaniu
--      polaczenia (gdy proszacy nie ma `discoverable`), proszacy ogladajacy
--      cel, ktory pozniej zdjal `discoverable` (cel z definicji NIE jest
--      polaczony z proszacym - 20260913171000), stare prosby sprzed bramek
--      20260913171000, profil bez sluga albo z pustym slugiem.
--   3. `search_path = public, pg_temp` zamiast `public`: DROP + CREATE gubi
--      proconfig, a 20260830120000 dopisalo `pg_temp` wszystkim funkcjom
--      SECURITY DEFINER z przypieta sciezka - skopiowanie starej sygnatury
--      cofneloby te ochrone po cichu.
--   4. REVOKE ... FROM PUBLIC, anon przed GRANT dla authenticated. DROP + CREATE
--      zeruje ACL; 20260724120000 nadalo tylko GRANT i zgubilo REVOKE
--      z 20260724111107:50. Wywolanie bez sesji i tak nic nie zwraca
--      (`auth.uid() IS NULL THEN RETURN`), ale funkcja nie ma byc dostepna
--      dla anon bez powodu.
--
-- PRYWATNOSC. Funkcja juz dzis oddaje kazdemu uczestnikowi id, display_name
-- i avatar_url wszystkich trzech osob. Slug zwracany jest WYLACZNIE, gdy
-- wolajacy i tak moze otworzyc ten profil (wtedy slug stoi w adresie
-- strony), wiec nie ujawnia nic ponad to, co juz widzi. Nie jest tez
-- wyrocznia istnienia profili: zalogowany moze zawolac `get_member_profile`
-- wprost.
--
-- KOSZT. Do trzech wywolan `get_member_profile` na wiersz (indeks unikalny
-- po slugu, `_are_connected`, `is_platform_author`). Listy wprowadzen sa male
-- (limit 5 oczekujacych prosb na dobe na proszacego), wiec to swiadomy koszt
-- w zamian za jedno zrodlo prawdy o widocznosci.
--
-- DLACZEGO DROP + CREATE: zmiana ksztaltu RETURNS TABLE nie przechodzi przez
-- `CREATE OR REPLACE` - wzorzec ten sam, co w 20260724120000 i 20260913172000.
--
-- DLACZEGO NOWA PARA, a nie poprawka 20260724120000: tamten plik stoi juz na
-- produkcji, a repozytorium jest forward-only.
--
-- IDEMPOTENCJA. `DROP FUNCTION IF EXISTS` + `CREATE FUNCTION`, REVOKE / GRANT
-- i COMMENT - ponowne zastosowanie daje ten sam stan; bez DDL-a na tabelach
-- i bez przepisywania wierszy.
--
-- ZALEZNOSCI (wszystkie wczesniej w tym pasie): tabela
-- `introduction_requests` (20260718215718), `get_member_profile(text)`
-- (20260924100000).
--
-- KOLEJNOSC WDROZENIA. Klient z tej samej zmiany czyta slug przez
-- `?.trim()`, wiec na bazie bez tej migracji (kolumny `undefined`) karta
-- pokazuje tekst bez linku zamiast /people/<uuid>; po migracji linki wracaja.
--
-- Testy: supabase/tests/introductions_flow_test.sql (kontrakt rozwiazania
-- sluga przez get_member_profile dla trzech rol), komponent:
-- src/components/network/__tests__/IntroductionsCard.test.tsx.
-- ============================================================================

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
