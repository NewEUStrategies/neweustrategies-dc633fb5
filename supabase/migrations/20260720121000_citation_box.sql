-- Box "Cytuj tę analizę" (A1): globalny przełącznik w ustawieniach layoutu
-- wpisu. Per-wpis nadpisanie mieszka w posts.layout_overrides (jsonb) i nie
-- wymaga zmiany schematu. DEFAULT true: cytowania to wyróżnik wiarygodności
-- think-tanku, więc istniejące tenanty dostają funkcję od razu po deployu.
ALTER TABLE public.post_layout_settings
  ADD COLUMN IF NOT EXISTS show_citation boolean NOT NULL DEFAULT true;
