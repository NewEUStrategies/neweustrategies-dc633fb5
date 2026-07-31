-- Expert page layout system: per-tenant defaults + per-expert overrides.
CREATE TABLE IF NOT EXISTS public.expert_layout_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  default_preset text NOT NULL DEFAULT 'portrait-left',
  center_hero boolean NOT NULL DEFAULT false,
  center_details boolean NOT NULL DEFAULT false,
  max_width integer NOT NULL DEFAULT 1200,
  show_hero_cover boolean NOT NULL DEFAULT true,
  show_expertise_bar boolean NOT NULL DEFAULT true,
  show_details boolean NOT NULL DEFAULT true,
  show_social_row boolean NOT NULL DEFAULT true,
  show_contact_card boolean NOT NULL DEFAULT true,
  show_media_mentions boolean NOT NULL DEFAULT true,
  show_podcast_strip boolean NOT NULL DEFAULT true,
  show_materials boolean NOT NULL DEFAULT true,
  show_cv boolean NOT NULL DEFAULT true,
  show_programs boolean NOT NULL DEFAULT true,
  section_order text[] NOT NULL DEFAULT ARRAY[
    'expertise_bar','details','programs','media_mentions','podcast_strip','materials','cv','contact_card'
  ]::text[],
  hero_bg_color text,
  hero_bg_color_dark text,
  hero_text_color text,
  hero_text_color_dark text,
  accent_color text,
  accent_color_dark text,
  name_size_base integer NOT NULL DEFAULT 32,
  name_size_lg integer NOT NULL DEFAULT 48,
  role_size_base integer NOT NULL DEFAULT 14,
  role_size_lg integer NOT NULL DEFAULT 16,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.expert_layout_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.expert_layout_settings TO authenticated;
GRANT ALL ON public.expert_layout_settings TO service_role;

ALTER TABLE public.expert_layout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expert layout settings are readable by tenant scope"
  ON public.expert_layout_settings FOR SELECT
  USING (tenant_id = public_tenant_id());

CREATE POLICY "Admins manage expert layout settings"
  ON public.expert_layout_settings FOR ALL
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE TRIGGER expert_layout_settings_set_updated_at
  BEFORE UPDATE ON public.expert_layout_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-expert overrides on author_profiles
--
-- Naprawa łańcucha migracji: trzy z tych kolumn (layout_template_id,
-- counterpart_user_id, counterpart_lang) istniały dotąd WYŁĄCZNIE na bazie
-- produkcyjnej - żadna migracja ich nie tworzyła, więc na świeżej bazie
-- (supabase db start / CI) wykładało się dziesięć późniejszych migracji:
-- kolumnowe GRANT-y oraz ciała widoków author_profiles_public. Dokładamy je
-- tutaj, obok rodzeństwa layout_*, bo to pierwsza migracja dotykająca tego
-- bloku i wypada przed pierwszym odwołaniem (20260715095639).
--
-- Typy i cele kluczy obcych są wzięte z wygenerowanego src/integrations/
-- supabase/types.ts (zrzut produkcji): author_profiles_layout_template_id_fkey
-- -> builder_templates(id), author_profiles_counterpart_user_id_fkey ->
-- profiles(id). Oba cele powstają znacznie wcześniej w łańcuchu. types.ts nie
-- zapisuje akcji ON DELETE, więc świadomie wybieramy nieniszczące SET NULL -
-- to opcjonalne wskaźniki, usunięcie szablonu nie może kasować profili.
-- IF NOT EXISTS sprawia, że na produkcji (gdzie kolumny i FK już są) całość
-- jest pustym przebiegiem.
ALTER TABLE public.author_profiles
  ADD COLUMN IF NOT EXISTS layout_preset text,
  ADD COLUMN IF NOT EXISTS layout_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS layout_section_order text[],
  ADD COLUMN IF NOT EXISTS brand_accent text,
  ADD COLUMN IF NOT EXISTS brand_accent_dark text,
  ADD COLUMN IF NOT EXISTS layout_template_id uuid
    REFERENCES public.builder_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counterpart_user_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counterpart_lang text;

ALTER TABLE public.author_profiles
  DROP CONSTRAINT IF EXISTS author_profiles_layout_preset_check;
ALTER TABLE public.author_profiles
  ADD CONSTRAINT author_profiles_layout_preset_check
  CHECK (layout_preset IS NULL OR layout_preset IN (
    'portrait-left','full-bleed-cover','centered-minimal','split-columns',
    'magazine','editorial','card-stack','sidebar-rail'
  ));

-- Seed row(s) for existing tenants
INSERT INTO public.expert_layout_settings (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;
