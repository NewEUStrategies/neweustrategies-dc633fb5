-- post_views.dwell_ms: zrodlo sygnalu dwell silnika rekomendacji v2 - kolumna, zapis record_post_dwell (tylko service_role), agregat related_posts_dwell (mediana, prog 5 pomiarow, najemca publiczny) (blizniak 20261002120000).
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
