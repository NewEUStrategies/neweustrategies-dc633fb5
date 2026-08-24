DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_tenant_id_key'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT events_tenant_id_key ON public.events IS
  'Tozsamosc wydarzenia w granicach najemcy. Cel kluczy obcych zlozonych (tenant_id, event_id) we wszystkich tabelach potomnych modulu Wydarzen.';