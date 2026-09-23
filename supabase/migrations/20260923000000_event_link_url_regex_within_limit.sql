-- Adres linku sponsora i reklamy: wzorzec w granicach silnika wyrazen PostgreSQL.
--
-- OBJAW. Migracja `20260922200000_event_sponsor_sections_and_home_ads` walidowala
-- adres wzorcem `'^https://[^\s]{3,2000}$'` w trzech miejscach: ograniczeniu
-- `event_sponsors.link_url`, ograniczeniu `event_home_ads.link_url` i funkcji
-- `admin_event_sponsor_set_link`. Silnik wyrazen regularnych PostgreSQL
-- dopuszcza w `{m,n}` najwyzej 255 powtorzen, wiec KAZDE porownanie z tym
-- wzorcem konczylo sie bledem `invalid regular expression: invalid repetition
-- count(s)`. Zmierzone na PostgreSQL 16.13: `{3,2000}` - blad, `{2,255}` i `{3,}`
-- - dzialaja. Skutek dla panelu: link zewnetrzny sponsora i link reklamy na
-- stronie wydarzenia nie dawaly sie zapisac w ogole.
--
-- DLACZEGO MIGRACJA PRZESZLA. Ograniczenie jest sprawdzane dla istniejacych
-- wierszy przy jego dodaniu, ale kolumny byly nowe i puste - `link_url IS NULL`
-- rozstrzygalo warunek bez dotykania wzorca. Blad wychodzi dopiero przy pierwszym
-- niepustym zapisie. Wykryly go asercje runtime `30_sponsors.sql` (sekcja 13A).
--
-- NAPRAWA. Gorna granica dlugosci przechodzi do `char_length`, wzorzec zostaje
-- bez gornej granicy powtorzen: `^https://[^\s]{3,}$` i najwyzej 2008 znakow
-- (8 znakow `https://` plus 2000, czyli ta sama granica, co w oryginale).
-- Zadna istniejaca wartosc nie mogla przejsc starego ograniczenia, wiec nowe nie
-- ma czego odrzucic. `DROP ... IF EXISTS` i `CREATE OR REPLACE`, bo plik jedzie
-- na produkcje dwoma pasami (blizniak w `drizzle/migrations/`) i musi byc
-- odporny na drugie wykonanie.
--
-- Nazwy ograniczen sprawdzone empirycznie: PostgreSQL nadaje ograniczeniu
-- kolumny nazwe `<tabela>_<kolumna>_check` zarowno w `CREATE TABLE`, jak
-- i w `ALTER TABLE ... ADD COLUMN`.

ALTER TABLE public.event_sponsors DROP CONSTRAINT IF EXISTS event_sponsors_link_url_check;
ALTER TABLE public.event_sponsors ADD CONSTRAINT event_sponsors_link_url_check
  CHECK (link_url IS NULL OR (link_url ~* '^https://[^\s]{3,}$' AND char_length(link_url) <= 2008));

ALTER TABLE public.event_home_ads DROP CONSTRAINT IF EXISTS event_home_ads_link_url_check;
ALTER TABLE public.event_home_ads ADD CONSTRAINT event_home_ads_link_url_check
  CHECK (link_url IS NULL OR (link_url ~* '^https://[^\s]{3,}$' AND char_length(link_url) <= 2008));

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_set_link(_id uuid, _mode text, _url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF _mode NOT IN ('exhibitor','external','none') THEN RAISE EXCEPTION 'invalid_link_mode'; END IF;
  IF _mode = 'external' AND (
    _url IS NULL OR _url !~* '^https://[^\s]{3,}$' OR char_length(_url) > 2008
  ) THEN
    RAISE EXCEPTION 'invalid_link_url';
  END IF;
  UPDATE public.event_sponsors
     SET link_mode = _mode,
         link_url = CASE WHEN _mode = 'external' THEN _url ELSE NULL END,
         updated_at = now()
   WHERE id = _id AND tenant_id = v_tenant;
  RETURN FOUND;
END $$;
