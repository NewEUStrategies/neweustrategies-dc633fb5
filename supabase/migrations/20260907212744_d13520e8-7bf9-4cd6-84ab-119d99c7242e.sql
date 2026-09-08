ALTER TABLE public.user_notes
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS entity_title text,
  ADD COLUMN IF NOT EXISTS entity_url text;

ALTER TABLE public.user_notes
  DROP CONSTRAINT IF EXISTS user_notes_entity_type_check;

ALTER TABLE public.user_notes
  ADD CONSTRAINT user_notes_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN ('post','page','event','podcast','document','external'));

CREATE INDEX IF NOT EXISTS user_notes_entity_idx
  ON public.user_notes (tenant_id, user_id, entity_type, entity_id);