ALTER TABLE public.web_vitals
  ADD COLUMN IF NOT EXISTS since_nav_ms   integer,
  ADD COLUMN IF NOT EXISTS navigation_type text,
  ADD COLUMN IF NOT EXISTS device_memory  smallint,
  ADD COLUMN IF NOT EXISTS effective_type text,
  ADD COLUMN IF NOT EXISTS cold_start     boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_navigation_type_values'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_navigation_type_values
      CHECK (navigation_type IS NULL
             OR navigation_type IN ('navigate', 'reload', 'back_forward', 'prerender'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_effective_type_values'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_effective_type_values
      CHECK (effective_type IS NULL
             OR effective_type IN ('slow-2g', '2g', '3g', '4g'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_device_memory_buckets'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_device_memory_buckets
      CHECK (device_memory IS NULL OR device_memory IN (1, 2, 4, 8));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_since_nav_ms_range'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_since_nav_ms_range
      CHECK (since_nav_ms IS NULL OR (since_nav_ms >= 0 AND since_nav_ms <= 86400000));
  END IF;
END
$$;

COMMENT ON COLUMN public.web_vitals.since_nav_ms IS
  'Milisekundy od startu nawigacji do chwili ZGLOSZENIA probki (performance.now()).';

COMMENT ON COLUMN public.web_vitals.navigation_type IS
  'Typ nawigacji z PerformanceNavigationTiming: navigate | reload | back_forward | prerender.';

COMMENT ON COLUMN public.web_vitals.device_memory IS
  'Prog navigator.deviceMemory kubelkowany W DOL do 1/2/4/8 GB.';

COMMENT ON COLUMN public.web_vitals.effective_type IS
  'Klasa lacza z Network Information API: slow-2g | 2g | 3g | 4g.';

COMMENT ON COLUMN public.web_vitals.cold_start IS
  'TRUE = probka PIERWSZEJ trasy dokumentu otwartego na zimno.';