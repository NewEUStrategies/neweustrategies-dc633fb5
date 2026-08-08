-- ============================================================================
-- Kluby dyskusyjne - etap A24: przelacznik modulu dostaje skutek
--
-- BLAD, KTORY TO NAPRAWIA. `community_modules.clubs_enabled` powstal w A1
-- razem z komentarzem obiecujacym, ze "wylaczenie chowa modul z nawigacji bez
-- rebuildu, jak kazdy inny modul". Klucz nie mial ANI JEDNEGO konsumenta poza
-- przelacznikiem w panelu: administrator klikal "wylacz", zapis sie udawal,
-- panel pokazywal stan wylaczony - a `/club` dzialalo dalej tak samo.
-- Przelacznik bez skutku jest gorszy niz jego brak, bo zostawia zapisany DOWOD,
-- ze cos jest wylaczone.
--
-- Skutek po stronie klienta dokłada trasa ukladu `src/routes/club.tsx`:
-- niezrenderowany `<Outlet />` to dzieci NIEZAMONTOWANE, wiec wylaczony modul
-- nie tylko nie rysuje ekranow, ale i nie woła `club_list` ani reszty RPC.
--
-- TA MIGRACJA ODPOWIADA ZA DRUGA POLOWE: stan poczatkowy klucza. Domyslna
-- wartoscia po stronie klienta jest `false` (modul wlacza sie swiadomie,
-- V2 par. 6.3), wiec bez tego wpisu tenant, ktory ma juz zaseedowany klub
-- referencyjny z A20, zobaczylby ekran "modul wylaczony" nad kompletna,
-- dzialajaca trescia. Wlaczamy go WYLACZNIE tam, gdzie klub realnie istnieje -
-- to wiaze przelacznik z faktem, a nie z zalozeniem.
--
-- `jsonb_set` z `create_if_missing`, a nie nadpisanie calego obiektu: klucz
-- niesie dziesiec innych przelacznikow modulow i skasowanie ich przy okazji
-- wlaczania klubow byloby dokladnie ta klasa bledu, ktora ta migracja naprawia.
-- Swiadoma decyzja administratora tez zostaje uszanowana - jesli klucz
-- `clubs_enabled` juz w wierszu jest, nie ruszamy go.
-- ============================================================================

DO $module$
DECLARE
  v_updated integer;
BEGIN
  -- DWA OSOBNE POLECENIA, nie jedno z CTE modyfikujacym dane. Wszystkie CTE
  -- jednego polecenia widza TEN SAM snapshot, wiec UPDATE sklejony z INSERT-em
  -- nie zobaczylby wierszy dopiero co wstawionych - i tenant bez wiersza
  -- `community_modules` (czyli ten, ktorego to najbardziej dotyczy) zostalby
  -- z modulem wylaczonym mimo dzialajacego klubu.
  INSERT INTO public.site_settings (tenant_id, key, value)
  SELECT DISTINCT c.tenant_id, 'community_modules', '{}'::jsonb
    FROM public.clubs c
   WHERE c.status = 'active'
  ON CONFLICT (tenant_id, key) DO NOTHING;

  UPDATE public.site_settings s
     SET value = jsonb_set(s.value, '{clubs_enabled}', 'true'::jsonb, true)
   WHERE s.key = 'community_modules'
     AND s.tenant_id IN (
       SELECT DISTINCT c.tenant_id FROM public.clubs c WHERE c.status = 'active'
     )
     -- Administrator, ktory swiadomie wylaczyl modul, ma zostac przy swoim.
     AND NOT (s.value ? 'clubs_enabled');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'clubs: modul wlaczony dla % tenantow z aktywnym klubem', v_updated;
END;
$module$;
