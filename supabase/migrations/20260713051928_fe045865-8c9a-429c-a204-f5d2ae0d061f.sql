-- Dołącz poll_votes do publikacji realtime, aby wyniki ankiet aktualizowały się na żywo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'poll_votes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_votes';
  END IF;
END $$;

-- REPLICA IDENTITY FULL, żeby DELETE dostarczał kompletny wiersz do subskrybentów.
ALTER TABLE public.poll_votes REPLICA IDENTITY FULL;