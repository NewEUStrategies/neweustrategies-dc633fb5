-- ============================================================================
-- profiles.slug: KAZDY PROFIL MA SLUG Z IMIENIA I NAZWISKA, NIGDY UUID W ADRESIE.
--
-- BLIZNIAK drizzle/migrations/0121_profile_slug_always_set.sql - ten sam SQL
-- wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
--
-- FINDING 1 (powiadomienia). Producenci powiadomien o rekomendacjach
-- i poparciach (tg_recommendation_notify, tg_endorsement_notify) sklejaja adres
-- `'/author/' || notification_profile_ref(<odbiorca>)`, a helper
-- (20260807082516:101-109) oddawal slug ALBO - gdy go brak - id. Profil bez
-- sluga dostawal wiec `/author/<uuid>`: hub tylko przez UUID-owy fallback,
-- bez przekierowania nie-autora na /people (porownuje wylacznie slug,
-- 20260925100000:71-74), a po F5 trwale 404. Slug moze zniknac: uzytkownik
-- czysci pole "Nick" (SocialIdentityPanel zapisuje wtedy NULL), wiersz
-- powstaje bez `handle_new_user`, a sciezka zaproszen skleja slug po stronie
-- klienta (`slugify`) i dla nietypowego nazwiska daje pusty napis.
--
-- FINDING 2 (generator). `profiles_generate_unique_slug` (20260704191114:2-38)
-- robil `lower(regexp_replace(unaccent(x), '[^a-z0-9]+', '-'))` - zamiane
-- PRZED zmniejszeniem liter, wiec kazda wielka litera wypadala jako myslnik:
-- "Igor Miasnikow" -> "gor-iasnikow", "Lukasz Zolc" -> "ukasz-olc". Tak powstaje
-- slug kazdego nowego konta (handle_new_user, 20260805083149:107-111).
--
-- CO ZMIENIA
--   1. Generator: `unaccent` -> `lower` -> zamiana znakow, czyli
--      "Igor Miasnikow" -> "igor-miasnikow". Przy kolizji KROTKI sufiks
--      czterech cyfr ("igor-miasnikow-4211") zamiast kolejnego numeru (-2, -3),
--      ktory zdradzal kolejnosc rejestracji osob o tym samym nazwisku. Bez imienia
--      i nazwiska: "user-NNNN" (nigdy lokalna czesc adresu e-mail). Podstawa
--      skracana do 55 znakow, zeby slug z sufiksem miescil sie w 60.
--      VOLATILE zamiast STABLE: funkcja losuje i czyta stan tabeli. Nowy
--      wariant (text, uuid) pomija wlasny wiersz przy sprawdzaniu kolizji;
--      dotychczasowa sygnatura (text) deleguje do niego bez wykluczenia.
--   2. Wyzwalacz `profiles_0_ensure_slug_trg` (BEFORE INSERT OR UPDATE OF slug,
--      WHEN slug pusty): pusty albo bialy slug zastepuje slugiem z imienia
--      i nazwiska (dalej: display_name). Nazwa zaczyna sie od "profiles_0",
--      bo wyzwalacze BEFORE odpalaja alfabetycznie, a `profiles_completeness_trg`
--      i `profiles_discovery_search_trg` licza wynik i wektor wyszukiwania
--      Z SLUGA - maja widziec juz nowy. SECURITY DEFINER, bo generator musi
--      widziec WSZYSTKIE slugi (RLS zawezilby sprawdzenie kolizji do wlasnego
--      wiersza i zapis padlby na unikalnym indeksie).
--   3. Uzupelnienie: istniejace profile z pustym slugiem dostaja slug tym samym
--      wyzwalaczem (UPDATE ... SET slug = NULL), a zapisane juz powiadomienia
--      z `/author/<uuid>` dostaja w adresie slug tej osoby.
--   4. `notification_profile_ref` nie oddaje juz id: slug albo NULL (NULL daje
--      powiadomienie bez linku zamiast martwego adresu - po punktach 2-3 slug
--      zawsze jest, wiec to tylko obrona).
--
-- CZEGO NIE ZMIENIA. Istniejace, niepuste slugi zostaja - takze te znieksztalcone
-- przez stary generator ("gor-iasnikow"). Slug jest publicznym adresem, a do
-- starego nie ma przekierowania, wiec masowa zmiana zerwalaby udostepnione
-- linki. To osobna decyzja.
--
-- IDEMPOTENCJA. `CREATE OR REPLACE` funkcji, `DROP TRIGGER IF EXISTS` +
-- `CREATE TRIGGER`; uzupelnienie dotyka tylko wierszy z pustym slugiem
-- i adresow `/author/<uuid>`, wiec drugie zastosowanie nic nie zmienia.
--
-- ZALEZNOSCI (wszystkie wczesniej w tym pasie): rozszerzenie `unaccent`
-- w schemacie `extensions`, unikalny indeks `profiles_slug_unique`
-- (20260624192716), `notifications.href`.
--
-- Testy: supabase/tests/profile_slug_always_set_test.sql.
-- ============================================================================

-- -- 1. Generator ----------------------------------------------------------------
-- Wariant z `_exclude_id`: przy wyczyszczeniu nicka wlasny dotychczasowy slug
-- nie jest "zajety" - osoba odzyskuje "igor-miasnikow", a nie "...-4211".
CREATE OR REPLACE FUNCTION public.profiles_generate_unique_slug(_base text, _exclude_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_try int := 0;
BEGIN
  -- Najpierw litery bez znakow diakrytycznych i male, DOPIERO potem zamiana
  -- reszty na myslnik - odwrotna kolejnosc gubila kazda wielka litere.
  v_base := lower(unaccent(coalesce(_base, '')));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  v_base := regexp_replace(v_base, '-{2,}', '-', 'g');

  IF length(v_base) > 55 THEN
    v_base := regexp_replace(substr(v_base, 1, 55), '-+$', '', 'g');
  END IF;

  -- Bez imienia i nazwiska: "user-NNNN" (sufiks zawsze, sam "user" nic nie mowi).
  IF length(v_base) < 2 THEN
    v_base := 'user';
  ELSIF NOT EXISTS (SELECT 1 FROM public.profiles
                     WHERE slug = v_base AND id IS DISTINCT FROM _exclude_id) THEN
    RETURN v_base;
  END IF;

  -- Kolizja: krotki sufiks czterech cyfr ("igor-miasnikow-4211").
  LOOP
    v_try := v_try + 1;
    v_candidate := v_base || '-' || (1000 + floor(random() * 9000))::int::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles
                           WHERE slug = v_candidate AND id IS DISTINCT FROM _exclude_id);
    IF v_try >= 50 THEN
      v_candidate := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$$;

-- Dotychczasowa sygnatura (handle_new_user) - ta sama logika, bez wykluczenia.
CREATE OR REPLACE FUNCTION public.profiles_generate_unique_slug(_base text)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  SELECT public.profiles_generate_unique_slug(_base, NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.profiles_generate_unique_slug(text, uuid) FROM PUBLIC, anon, authenticated;

-- -- 2. Kazdy zapis profilu z pustym slugiem dostaje slug ---------------------------
CREATE OR REPLACE FUNCTION public.profiles_ensure_slug()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := public.profiles_generate_unique_slug(
      COALESCE(
        NULLIF(btrim(concat_ws(' ', NEW.first_name, NEW.last_name)), ''),
        NULLIF(btrim(NEW.display_name), '')
      ),
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_ensure_slug() IS
  'BEFORE INSERT/UPDATE OF slug: pusty slug zastepuje slugiem z imienia i nazwiska '
  '(dalej display_name; przy kolizji sufiks czterech cyfr). Profil zawsze ma slug, '
  'wiec zaden link nie musi podstawiac id w miejsce sluga.';

REVOKE ALL ON FUNCTION public.profiles_ensure_slug() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_0_ensure_slug_trg ON public.profiles;
CREATE TRIGGER profiles_0_ensure_slug_trg
  BEFORE INSERT OR UPDATE OF slug ON public.profiles
  FOR EACH ROW
  WHEN (NEW.slug IS NULL OR btrim(NEW.slug) = '')
  EXECUTE FUNCTION public.profiles_ensure_slug();

-- -- 3. Uzupelnienie istniejacych wierszy i zapisanych powiadomien -----------------
UPDATE public.profiles SET slug = NULL
 WHERE slug IS NULL OR btrim(slug) = '';

UPDATE public.notifications n
   SET href = '/author/' || p.slug || substr(n.href, 45)
  FROM public.profiles p
 WHERE n.href ~ '^/author/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}([#?/]|$)'
   AND p.id = substr(n.href, 9, 36)::uuid
   AND btrim(COALESCE(p.slug, '')) <> '';

-- -- 4. Helper powiadomien: slug albo NULL, nigdy id -------------------------------
CREATE OR REPLACE FUNCTION public.notification_profile_ref(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(btrim(p.slug), '') FROM public.profiles p WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.notification_profile_ref(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notification_profile_ref(uuid) IS
  'Segment sciezki /author/<ref> dla powiadomien: slug profilu albo NULL (powiadomienie '
  'bez linku). Nigdy id - /author/<uuid> omija przekierowanie nie-autora na /people '
  'i po F5 konczy sie 404. Profil zawsze ma slug (profiles_0_ensure_slug_trg).';
