CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.site_settings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_settings public read"
  ON public.site_settings FOR SELECT USING (true);

CREATE POLICY "site_settings admin insert"
  ON public.site_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "site_settings admin update"
  ON public.site_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_site_settings_updated_at
BEFORE UPDATE ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.site_settings (key, value) VALUES
  ('general', '{"site_name":"New European Strategies","tagline":"","site_url":"","admin_email":"","site_icon_url":"","site_logo_url":"","default_language":"pl","timezone":"Europe/Warsaw","date_format":"d.m.Y","time_format":"H:i","week_starts_on":1}'::jsonb),
  ('reading', '{"posts_per_page":10,"homepage_mode":"latest_posts","homepage_page_slug":"","search_engine_visibility":true}'::jsonb),
  ('discussion', '{"allow_comments":false,"require_login_to_comment":true,"moderate_new_comments":true}'::jsonb),
  ('media', '{"thumbnail_w":150,"thumbnail_h":150,"medium_w":768,"medium_h":768,"large_w":1536,"large_h":1536}'::jsonb),
  ('permalinks', '{"post_base":"post","page_base":""}'::jsonb),
  ('privacy', '{"privacy_page_slug":"","cookie_banner":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;