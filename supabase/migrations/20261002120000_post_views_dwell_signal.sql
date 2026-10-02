-- ============================================================================
-- post_views.dwell_ms: ZRODLO DANYCH SYGNALU DWELL SILNIKA REKOMENDACJI v2.
--
-- BLIZNIAK drizzle/migrations/0124_post_views_dwell_signal.sql - ten sam SQL
-- wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
--
-- FINDING (docs/PROMPT_MODUL_01_WPISY.md, pozycja A1, stan "czesciowo"). Szesc
-- z siedmiu wag silnika docieralo do `scoreRelatedDetailed`, a siodma -
-- `weight_dwell` (related_posts_config, domyslnie 2) - mnozyla pusty sygnal:
-- `signals.dwellByPost` nie mial ZADNEGO zrodla danych po stronie publicznej,
-- wiec panel /admin/related-posts pokazywal suwak jako wylaczony. Zlecenie
-- zabrania dokladnie tego stanu ("czesc wag dziala, a czesc nie").
--
-- DLACZEGO NIE `user_read_history`. Agregat historii czytania WSZYSTKICH
-- czytelnikow wymagalby wystawienia anonimowi tabeli, ktora RLS ogranicza do
-- wlasnych wierszy i ktora 20260831170000 klasyfikuje jako dane osobowe. Do tego
-- historia to "przeczytal / nie przeczytal" (wpis po 1,5 s), nie czas czytania.
--
-- CO ZMIENIA
--   1. `post_views.dwell_ms integer NULL` - czas AKTYWNEGO czytania wpisu w ms:
--      karta widoczna, a ostatnia aktywnosc czytelnika nie starsza niz 30 s.
--      Zglasza go przegladarka dla odslony JUZ policzonej - ta sama zgoda
--      analityczna, ten sam wiersz, zaden nowy identyfikator. NULL znaczy "brak
--      zgloszenia" i NIE jest zerem. CHECK 0..30 min.
--   2. `record_post_dwell(_tenant_id, _post_id, _viewer_hash, _dwell_ms)` -
--      SECURITY DEFINER, EXECUTE WYLACZNIE dla service_role. Wola ja beacon
--      `/api/public/post-dwell` za limiterem adresu, z najemca z zaufanego
--      hosta. Trafia NAJNOWSZA odslone (wpis, viewer_hash) w najemcy z ostatnich
--      2 h. Wartosc tylko ROSNIE (GREATEST), wiec powtorne dostarczenie beaconu
--      i kolejne zgloszenia narastajacego czasu sa idempotentne. Zgloszenie
--      jest przyciete do czasu, jaki REALNIE uplynal od odslony (+5 s zapasu na
--      opoznienie zapisu odslony): swiezo nabita odslona nie dostanie od razu
--      30 minut.
--   3. `related_posts_dwell(_days, _limit)` - SECURITY DEFINER dla anon i
--      authenticated, wzorcem `popular_post_ids` / `trending_posts`: MEDIANA
--      `dwell_ms` per opublikowany wpis najemcy PUBLICZNEGO (`public_tenant_id()`)
--      w oknie, wylacznie wpisy z co najmniej 5 pomiarami. Zwraca same liczby -
--      zero kolumn viewer_hash / user_id. Zadnego `has_role` w ciele (inwariant
--      `check:sql-tenant-scope`).
--   4. Indeks czesciowy pod skan okna agregatu.
--
-- Nowej polityki RLS nie ma: zapis idzie funkcja SECURITY DEFINER, odczyt
-- agregatem. Wyzwalacz `trg_score_on_post_view` jest AFTER INSERT, wiec
-- UPDATE `dwell_ms` go nie odpala.
--
-- Regresje pilnuje `supabase/tests/post_views_dwell_signal_test.sql`.
-- ============================================================================

ALTER TABLE public.post_views
  ADD COLUMN IF NOT EXISTS dwell_ms integer;

DO $$
BEGIN
  ALTER TABLE public.post_views
    ADD CONSTRAINT post_views_dwell_ms_range
    CHECK (dwell_ms IS NULL OR (dwell_ms >= 0 AND dwell_ms <= 1800000));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMENT ON COLUMN public.post_views.dwell_ms IS
  'Czas aktywnego czytania wpisu w ms (karta widoczna, aktywnosc < 30 s), zgloszony '
  'beaconem /api/public/post-dwell dla tej odslony; NULL = brak zgloszenia (nie 0). '
  'Zasila sygnal dwell silnika rekomendacji (related_posts_dwell). Rejestr semantyki: '
  'src/lib/analytics/semantic/streams.ts.';

CREATE INDEX IF NOT EXISTS post_views_dwell_window_idx
  ON public.post_views (tenant_id, viewed_at DESC)
  INCLUDE (post_id, dwell_ms)
  WHERE dwell_ms IS NOT NULL;

COMMENT ON INDEX public.post_views_dwell_window_idx IS
  'Skan okna agregatu related_posts_dwell: tylko odslony ze zgloszonym czasem czytania.';

CREATE OR REPLACE FUNCTION public.record_post_dwell(
  _tenant_id uuid,
  _post_id uuid,
  _viewer_hash text,
  _dwell_ms integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_viewed_at timestamptz;
  v_elapsed_ms bigint;
BEGIN
  IF _tenant_id IS NULL OR _post_id IS NULL OR _viewer_hash IS NULL
     OR length(_viewer_hash) < 16 OR length(_viewer_hash) > 64
     OR _dwell_ms IS NULL OR _dwell_ms < 1000 THEN
    RETURN false;
  END IF;

  SELECT v.id, v.viewed_at INTO v_id, v_viewed_at
    FROM public.post_views v
   WHERE v.post_id = _post_id
     AND v.viewer_hash = _viewer_hash
     AND v.tenant_id = _tenant_id
     AND v.viewed_at > now() - interval '2 hours'
   ORDER BY v.viewed_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  v_elapsed_ms := (EXTRACT(EPOCH FROM (now() - v_viewed_at)) * 1000)::bigint + 5000;

  UPDATE public.post_views
     SET dwell_ms = GREATEST(
           COALESCE(dwell_ms, 0),
           LEAST(_dwell_ms::bigint, 1800000, GREATEST(v_elapsed_ms, 0))::integer
         )
   WHERE id = v_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_post_dwell(uuid, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_post_dwell(uuid, uuid, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_post_dwell(uuid, uuid, text, integer) TO service_role;

COMMENT ON FUNCTION public.record_post_dwell(uuid, uuid, text, integer) IS
  'Zapis czasu aktywnego czytania do najnowszej odslony (wpis, viewer_hash) najemcy '
  'z ostatnich 2 h. Tylko service_role (beacon /api/public/post-dwell za limiterem '
  'adresu, najemca z zaufanego hosta). Wartosc tylko rosnie, przycieta do 30 min i do '
  'czasu, jaki uplynal od odslony. Zwraca, czy odslona zostala trafiona.';

CREATE OR REPLACE FUNCTION public.related_posts_dwell(
  _days integer DEFAULT 28,
  _limit integer DEFAULT 200
)
RETURNS TABLE (post_id uuid, median_dwell_ms integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.post_id,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY v.dwell_ms))::integer AS median_dwell_ms
    FROM public.post_views v
    JOIN public.posts p ON p.id = v.post_id
   WHERE v.tenant_id = public.public_tenant_id()
     AND p.tenant_id = public.public_tenant_id()
     AND p.status = 'published'
     AND p.deleted_at IS NULL
     AND v.dwell_ms IS NOT NULL
     AND v.viewed_at > now() - make_interval(days => GREATEST(LEAST(_days, 365), 1))
   GROUP BY v.post_id
  HAVING count(*) >= 5
   ORDER BY median_dwell_ms DESC, v.post_id
   LIMIT GREATEST(LEAST(_limit, 500), 1);
$$;

REVOKE ALL ON FUNCTION public.related_posts_dwell(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.related_posts_dwell(integer, integer)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.related_posts_dwell(integer, integer) IS
  'Mediana czasu aktywnego czytania (post_views.dwell_ms) per opublikowany wpis '
  'BIEZACEGO najemcy publicznego (host-aware public_tenant_id) w oknie _days (1..365), '
  'wylacznie wpisy z >= 5 pomiarami, cap _limit (twardo 500). SECURITY DEFINER, bo '
  'post_views nie ma publicznej polityki SELECT; zwraca same liczby (zero viewer_hash / '
  'user_id). Zasila sygnal dwell silnika rekomendacji (lib/queries/relatedPosts).';
