-- ============================================================================
-- member_slug_is_non_author(text): KONIEC WYROCZNI ISTNIENIA PROFILI.
--
-- BLIZNIAK drizzle/migrations/0053_member_slug_non_author_visibility.sql - ten
-- sam SQL wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
--
-- FINDING. 0047 (w tym pasie 20260924100000) zdefiniowalo te funkcje jako
-- SECURITY DEFINER z EXECUTE dla anon i cialem
--     EXISTS (SELECT 1 FROM profiles p
--              WHERE p.slug = p_slug AND NOT is_platform_author(p.id))
-- - bez tenanta i bez bramki widocznosci. Niezalogowany zgadywal slugi
-- i dostawal `true` dla KAZDEGO czlonka bez roli autora w DOWOLNYM tenancie,
-- takze dla profili, ktorych `profiles_public` celowo mu nie pokazuje (goly
-- czlonek; opt-in `discoverable` to katalog WEWNETRZNY - 20260806160000).
-- Trasa /author/<slug> zamienia `true` na 301 do /people/<slug> PRZED
-- rozstrzygnieciem 404 huba, wiec ta sama wyrocznia wychodzila tez przez
-- HTTP jako roznica 301 / 404.
--
-- CO ZMIENIA
--   1. Cialo `member_slug_is_non_author` - sygnatura, typ wyniku, STABLE,
--      SECURITY DEFINER, `search_path = public, pg_temp` i granty (anon,
--      authenticated, service_role; PUBLIC odebrane) bez zmian, wiec typy
--      klienta i kontrakt server fn `isNonAuthorMemberSlug` zostaja jak sa.
--      Odpowiedz zalezy od tozsamosci wolajacego:
--        * GOSC (brak `auth.uid()`): `true` tylko dla profilu, ktory gosc
--          widzi w `profiles_public` - DOKLADNIE w zrodle, z ktorego
--          `get_expert_hub` bierze profil (warstwa publiczna widoku: realna
--          publiczna obecnosc w tenancie zadania, `public_tenant_id()`).
--          Czytamy widok, a nie kopiujemy jego WHERE, zeby przyszla zmiana
--          bramki widocznosci nie rozjechala sie z hubem. Dla goscia nie ma
--          innego celu przekierowania do sprawdzenia: /people/<slug> i tak
--          stoi za bramka logowania.
--        * ZALOGOWANY: `true` tylko wtedy, gdy CEL przekierowania rozwiaze
--          profil - `get_member_profile(p_slug)` (karta /people/<slug>) oddaje
--          wiersz z `is_author = false`. Nie `profiles_public`: widok pokazuje
--          zalogowanemu takze profile z publiczna obecnoscia (odznaka
--          `expert`, tenant zweryfikowanej domeny) i - personelowi tenanta -
--          kazdego czlonka, a `get_member_profile` oddaje wylacznie wlasny
--          profil, `discoverable` albo polaczenie w tenancie domowym. Werdykt
--          z widoku przerzucal wiec taka osobe z huba, ktory widzi, na
--          "Nie znaleziono profilu", a na zweryfikowanej domenie obcego
--          tenanta gubil czlonka tenanta domowego, ktorego /people otwiera.
--          Nic ponad to, co i tak widzi hub: kazdy wiersz `get_member_profile`
--          lezy w galezi czlonkowskiej `profiles_public` (ten sam tenant
--          domowy, wlasny / discoverable / polaczenie), a samo
--          `get_member_profile` zalogowany i tak moze wolac wprost.
--      `false` znaczy "zostan przy hubie": dla profilu, ktorego wolajacy nie
--      widzi, hub i tak konczy sie 404 - obie odpowiedzi sa nieodroznialne.
--   2. `is_platform_author(uuid)` traci EXECUTE dla `authenticated`. 0047
--      nadalo go bez potrzeby: jedyni wolajacy (`get_member_profile`,
--      `member_slug_is_non_author`) sa SECURITY DEFINER i biegna jako
--      wlasciciel, a klient go nie wola. Funkcja nie zna tenanta, wiec
--      kazdy zalogowany mogl sprawdzic dowolny UUID (identyfikatory wystawia
--      `profiles_public`) na role author / editor / admin / super_admin albo
--      zaakceptowane zaproszenie w DOWOLNYM tenancie. service_role zostaje.
--
-- KTO WOLA I Z JAKA TOZSAMOSCIA. Jedyny wolajacy to server fn
-- `isNonAuthorMemberSlug` (src/lib/profile/memberSlug.functions.ts). Przekazuje
-- ona do PostgREST bearer sesji czytelnika, gdy zadanie go niesie (nawigacja
-- SPA zalogowanego), a bez niego wola jako anon (gosc, SSR - dokument nie
-- niesie sesji). Werdykt z tozsamoscia jest per uzytkownik, wiec server fn
-- oznacza taka odpowiedz `private, no-store`. Zalogowany, ktory wszedl
-- twardo (SSR anonimowy -> 404), dostaje drugie pytanie z sesja po
-- hydratacji (`AuthorHubNotFound` na trasie /author/<slug>).
--
-- SWIADOMY KOSZT. Gosc na /author/<slug> czlonka widocznego wylacznie
-- w katalogu wewnetrznym (`discoverable` bez publicznej obecnosci) dostaje
-- teraz 404 zamiast dawnego 301 na /people/<slug> z bramka logowania. To
-- zamierzone: wlasnie roznica 301/404 byla wyrocznia istnienia takich profili.
--
-- DLACZEGO BEZ UUID. `get_expert_hub` przyjmuje tez UUID zamiast sluga, ale
-- 301 prowadzi na /people/<ten sam parametr>, a `get_member_profile` szuka
-- wylacznie po slugu - dopasowanie UUID przekierowaloby na strone, ktora
-- profilu nie rozwiaze. Funkcja porownuje wiec tylko `slug`, jak 0047.
--
-- DLACZEGO NOWA PARA, a nie poprawka 0047. 0047 stoi juz na produkcji (pas
-- drizzle), a jej blizniak 20260924100000 musi zostac z nia zgodny w SQL-u
-- wykonywalnym. Poprawka idzie wiec do przodu: ten plik (po 20260924100000)
-- nadpisuje cialo `CREATE OR REPLACE`-em i odbiera grant na obu pasach.
--
-- KOLEJNOSC WDROZENIA. 20260924100000 niesie STARE cialo i grant dla
-- `authenticated`. Zastosowane PO tym pliku (np. pozniejszy `supabase db push
-- --include-all`, bo jego wersja jest starsza od juz wdrozonych) przywroci
-- wyrocznie po cichu. Na zdalnej bazie ten plik musi wiec biec PO nim - a gdy
-- 20260924100000 dojdzie pozniej, trzeba ponowic ten plik.
--
-- IDEMPOTENCJA. `CREATE OR REPLACE` tej samej sygnatury, REVOKE / GRANT
-- i COMMENT - bez DDL-a na tabelach i bez przepisywania wierszy.
--
-- ZALEZNOSCI (wszystkie wczesniej w tym pasie): widok `profiles_public`
-- (20260806160000, projekcja z `hide_avatar` 20260807061849),
-- `is_platform_author(uuid)` i `get_member_profile(text)` (20260924100000).
--
-- Testy: supabase/tests/member_slug_non_author_visibility_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.member_slug_is_non_author(p_slug text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN EXISTS (
      SELECT 1 FROM public.profiles_public pp
       WHERE pp.slug = p_slug
         AND NOT public.is_platform_author(pp.id)
    )
    ELSE COALESCE((public.get_member_profile(p_slug) ->> 'is_author') = 'false', false)
  END;
$$;
REVOKE ALL ON FUNCTION public.member_slug_is_non_author(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_slug_is_non_author(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.member_slug_is_non_author(text) IS
  'Czy /author/<slug> ma przekierowac 301 na /people/<slug>: slug osoby BEZ roli autora, '
  'ktorej profil wolajacy zobaczy. Gosc: profil widoczny w profiles_public (zrodlo '
  'get_expert_hub). Zalogowany: get_member_profile(slug) oddaje wiersz z is_author = false. '
  'Wylacznie boolean; dla profilu niewidocznego, obcego tenanta albo nieznanego sluga '
  'false - nie jest wyrocznia istnienia profili.';

REVOKE EXECUTE ON FUNCTION public.is_platform_author(uuid) FROM authenticated;
