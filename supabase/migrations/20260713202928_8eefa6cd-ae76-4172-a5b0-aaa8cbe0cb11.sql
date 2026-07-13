-- 1) Extend builder_templates.scope to support expert_profile layouts
ALTER TABLE public.builder_templates DROP CONSTRAINT IF EXISTS builder_templates_scope_check;
ALTER TABLE public.builder_templates ADD CONSTRAINT builder_templates_scope_check
  CHECK (scope IN ('section','page','widget','expert_profile'));

-- 2) Author profile: per-expert layout override + PL/EN counterpart
ALTER TABLE public.author_profiles
  ADD COLUMN IF NOT EXISTS layout_template_id uuid NULL REFERENCES public.builder_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS layout_overrides jsonb NULL,
  ADD COLUMN IF NOT EXISTS counterpart_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counterpart_lang text NULL CHECK (counterpart_lang IN ('pl','en'));

CREATE INDEX IF NOT EXISTS author_profiles_counterpart_idx
  ON public.author_profiles(counterpart_user_id) WHERE counterpart_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS author_profiles_layout_template_idx
  ON public.author_profiles(layout_template_id) WHERE layout_template_id IS NOT NULL;

-- 3) Bidirectional counterpart sync: setting A.counterpart=B mirrors B.counterpart=A;
--    clearing A.counterpart also clears the partner's reference to A.
CREATE OR REPLACE FUNCTION public.sync_author_counterpart()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_counterpart uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_counterpart := OLD.counterpart_user_id;
  END IF;

  -- Clear stale partner if we changed counterpart
  IF TG_OP = 'UPDATE'
     AND old_counterpart IS NOT NULL
     AND old_counterpart IS DISTINCT FROM NEW.counterpart_user_id THEN
    UPDATE public.author_profiles
       SET counterpart_user_id = NULL
     WHERE user_id = old_counterpart
       AND counterpart_user_id = NEW.user_id;
  END IF;

  -- Set partner side to point back to us
  IF NEW.counterpart_user_id IS NOT NULL AND NEW.counterpart_user_id <> NEW.user_id THEN
    UPDATE public.author_profiles
       SET counterpart_user_id = NEW.user_id
     WHERE user_id = NEW.counterpart_user_id
       AND (counterpart_user_id IS DISTINCT FROM NEW.user_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_author_counterpart ON public.author_profiles;
CREATE TRIGGER trg_sync_author_counterpart
AFTER INSERT OR UPDATE OF counterpart_user_id ON public.author_profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_author_counterpart();

-- 4) Site-level default template for expert pages: use site_settings key
--    'expert_profile_default_template_id'. No schema change; already covered.
