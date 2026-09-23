-- UKLAD SEKCJI SPONSOROW PROWADZI LIMIT FIRM (`max_companies`).
--
-- Tablica "Sponsorzy i reklama" tworzyla sekcje banerowa z `max_companies = 1`,
-- a siatke bez limitu (NULL). Pozniejsza zmiana ukladu w bocznym panelu wolala
-- jednak TYLKO `admin_event_sponsor_tier_set_layout` z 20260922200000, ktora
-- zmieniala kolumne `layout` i nic wiecej. Skutek:
--   * baner przelaczony na siatke zostawal z limitem 1 - druga firma odbijala
--     sie od `tier_full` w `admin_event_sponsor_save` (20260824093916), choc
--     panel pokazywal siatke, czyli "wiele logotypow";
--   * siatka przelaczona na baner zostawala bez limitu - regule "baner ma
--     jeden obraz" pilnowal wtedy tylko przycisk w interfejsie.
--
-- REGULA (jedno miejsce, w bazie, bo limit egzekwuje baza):
--   * `banner` ustawia `max_companies = 1`. Liczba przypiec jest w tym miejscu
--     juz sprawdzona (`banner_single_image` przy wiecej niz jednej), wiec limit
--     nigdy nie spada ponizej liczby firm;
--   * `grid` czysci limit (NULL) TYLKO wtedy, gdy jest to pozostalosc po banerze:
--     poprzedni uklad to `banner`, a limit wynosi 1. Kazdy inny limit - takze 1
--     ustawione swiadomie na siatce w panelu poziomow - zostaje nietkniety.
--
-- JEDYNY WLASCICIEL LIMITU BANERA. Tablica tworzy teraz kazda sekcje BEZ limitu
-- i dopiero potem wola te funkcje. Gdyby wysylala limit 1 sama, awaria zapisu
-- ukladu zostawialaby siatke z limitem 1, a ponowny wybor siatki by go nie zdjal
-- (poprzedni uklad to juz `grid`) - ta sama odmowa `tier_full`, co przed migracja.
--
-- GRANICA NAJEMCY OBEJMUJE TEZ LICZNIK. Poprzednia wersja liczyla przypiecia
-- poziomu bez warunku `tenant_id` i PRZED sprawdzeniem, czy poziom nalezy do
-- wolajacego - admin najemcy B dostawal dla cudzego UUID `banner_single_image`
-- zamiast `false`, czyli dowiadywal sie, ze poziom ma wiecej niz jedna firme
-- (harness zdarzen trzymal to jako znany defekt). Teraz funkcja najpierw
-- blokuje wiersz poziomu W GRANICACH NAJEMCY (`FOR UPDATE`); cudzy albo
-- nieistniejacy poziom konczy sie `false` bez zadnego licznika. Blokada ma
-- drugi skutek: `admin_event_sponsor_save` bierze te sama blokade przed
-- liczeniem miejsc, wiec przypiecie firmy i zmiana ukladu nie przeplota sie
-- tak, zeby baner skonczyl z dwiema firmami.
--
-- Sygnatura, SECURITY DEFINER, search_path, bramka roli
-- (`assert_event_admin_tenant`) i uprawnienia bez zmian. Kody odmow tez:
-- `invalid_layout` (teraz takze dla NULL, ktory wczesniej przechodzil do
-- UPDATE-u i konczyl sie naruszeniem NOT NULL) i `banner_single_image`.
--
-- Forward-only: 20260922200000 zostaje nietkniete, bo jest juz zastosowane.
-- Plik jedzie na produkcje dwoma pasami (blizniak drizzle
-- 0043_event_sponsor_layout_follows_limit); `CREATE OR REPLACE` wykonany drugi
-- raz daje ten sam stan.
-- Istniejacych wierszy nie przeliczamy: siatki z limitem 1 nie da sie odroznic
-- od limitu ustawionego swiadomie. Taka siatka NIE wyrowna sie przy ponownym
-- wyborze siatki (poprzedni uklad to `grid`, wiec limit zostaje) - wyrownuje ja
-- przelaczenie na baner i z powrotem albo zmiana limitu w panelu poziomow.

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_tier_set_layout(_id uuid, _layout text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_old_layout text;
BEGIN
  IF _layout IS NULL OR _layout NOT IN ('banner','grid') THEN
    RAISE EXCEPTION 'invalid_layout';
  END IF;

  SELECT t.layout INTO v_old_layout
    FROM public.event_sponsor_tiers t
   WHERE t.id = _id AND t.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF _layout = 'banner' AND (
    SELECT count(*) FROM public.event_sponsors s
     WHERE s.tier_id = _id AND s.tenant_id = v_tenant
  ) > 1 THEN
    RAISE EXCEPTION 'banner_single_image';
  END IF;

  UPDATE public.event_sponsor_tiers t
     SET layout = _layout,
         max_companies = CASE
           WHEN _layout = 'banner' THEN 1
           WHEN v_old_layout = 'banner' AND t.max_companies = 1 THEN NULL
           ELSE t.max_companies
         END,
         updated_at = now()
   WHERE t.id = _id AND t.tenant_id = v_tenant;
  RETURN FOUND;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_event_sponsor_tier_set_layout(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tier_set_layout(uuid, text) TO authenticated;
