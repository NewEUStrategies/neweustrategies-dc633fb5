-- Run before applying the historical 20260907194459 migration to a populated
-- older database. NULL is the unchanged soft-gradient UI default and is valid
-- under both CHECK constraints. Safe to repeat on already upgraded databases.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'conversations' AND column_name = 'wallpaper') THEN
    UPDATE public.conversations SET wallpaper = NULL WHERE wallpaper = 'soft';
  END IF;
END;
$$;
