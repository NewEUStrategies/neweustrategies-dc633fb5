-- ============================================================================
-- RANGA 28 JEST OSIEROCONA - KLUBY BRAMKOWANE NIĄ TRAFIAJĄ NA PRÓG BEZ OFERTY
--
-- Audyt katalogu członkostw v6.1 (rozdział 3, „Ranga osierocona"). Próg
-- „Partner Biznesowy" (`business`, ranga 28) został wycofany z katalogu w v6,
-- ale ranga została w `TIER_RANKS` i - co gorsza - mogła zostać wpisana do
-- `clubs.min_tier_rank` przez droplistę panelu, zanim próg zniknął z oferty.
--
-- Skutek jest cichy i trwały: klub z progiem 28 nie ma już pozycji cennika,
-- która by go otwierała. Ranga 25 (Rada Instytutu / Zespół) go nie osiąga,
-- więc klub jest faktycznie klubem od rangi 30 (Enterprise) - tylko nikt tego
-- nigdzie nie zapisał, a droplista `CLUB_PLAN_TIERS` w ogóle nie zna wartości
-- 28 i degraduje ją przy wyświetlaniu do „VIP" (25). Administrator widzi więc
-- w panelu próg NIŻSZY niż faktycznie egzekwowany.
--
-- DECYZJA WŁAŚCICIELA: przemapowanie na 30 (Enterprise). Wybór jest świadomie
-- najostrożniejszy z trzech rozważanych (25 / 30 / 40) - zachowuje faktyczny
-- stan dostępu co do osoby:
--   * dziś klub z progiem 28 wpuszcza rangi >= 28, czyli realnie >= 30,
--   * po zmianie wpuszcza rangi >= 30 - ten sam zbiór ludzi.
-- Nikt nie zyskuje ani nie traci wejścia; znika wyłącznie rozjazd między
-- progiem w bazie a progiem pokazywanym w panelu.
--
-- Sam próg `business` w `membership_tiers` / `access_plans` ZOSTAJE nietknięty.
-- Ma trzy aktywne cykle rozliczeniowe w katalogu Stripe (`business_2w`,
-- `business_monthly`, `business_quarterly`) i mógł zostać sprzedany; wycofanie
-- go z drabinki jest decyzją handlową, nie porządkową, i wymagałoby osobnej
-- migracji wraz z obsługą istniejących subskrypcji.
--
-- Ranga progu Zespół (25) pozostaje BEZ ZMIAN - rozstrzygnięcie otwarte od v6
-- zamknięte decyzją: ranga zostaje, a katalog jawnie opisuje, że Zespół daje
-- zakres Pro plus wejścia rangi 25. Zmiana rangi zabrałaby miejscom zespołowym
-- wejście do klubów i treści bramkowanych rangą 25, więc kosztuje więcej niż
-- rozjazd, który usuwa.
-- ============================================================================

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.clubs WHERE min_tier_rank = 28;
  IF v_count > 0 THEN
    RAISE NOTICE 'Kluby z osieroconą rangą 28: % - przemapowanie na 30 (Enterprise).', v_count;
  END IF;
END $$;

UPDATE public.clubs
   SET min_tier_rank = 30,
       updated_at = now()
 WHERE min_tier_rank = 28;

-- Ta sama ranga mogła trafić do progów wydarzeń i reguł dostępu do treści -
-- oba miejsca mają kolumnę `min_tier_rank` wypełnianą ręcznie w panelu.
UPDATE public.events
   SET min_tier_rank = 30
 WHERE min_tier_rank = 28;

UPDATE public.content_access
   SET min_tier_rank = 30
 WHERE min_tier_rank = 28;

-- Zasoby biblioteki członkowskiej - ta sama kolumna, ten sam mechanizm.
UPDATE public.member_resources
   SET min_tier_rank = 30
 WHERE min_tier_rank = 28;

COMMENT ON COLUMN public.clubs.min_tier_rank IS
  'Próg rangi planu otwierający klub. Wartości dopuszczalne = rangi z katalogu (0, 10, 20, 25, 30, 40, 50, 60). Ranga 28 (wycofany próg Partner Biznesowy) została przemapowana na 30 migracją 20260822090000 - nie wprowadzać jej ponownie.';
