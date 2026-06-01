
-- 1. Post layout & content settings (globalne, per-tenant)
CREATE TABLE public.post_layout_settings (
  tenant_id uuid PRIMARY KEY DEFAULT current_tenant_id(),
  -- Foxiz-like Single Post Layout
  standard_layout text NOT NULL DEFAULT 'layout-1',
  video_layout text NOT NULL DEFAULT 'layout-1',
  audio_layout text NOT NULL DEFAULT 'layout-1',
  gallery_layout text NOT NULL DEFAULT 'layout-1',
  -- Featured ratio (procent szerokości)
  featured_ratio_l6 integer NOT NULL DEFAULT 150,
  featured_ratio_l10 integer NOT NULL DEFAULT 45,
  featured_ratio_l11 integer NOT NULL DEFAULT 45,
  -- Centering Header
  center_header boolean NOT NULL DEFAULT true,
  center_entry_meta boolean NOT NULL DEFAULT true,
  -- Content area
  has_sidebar_max_width integer NOT NULL DEFAULT 760,
  no_sidebar_max_width integer NOT NULL DEFAULT 840,
  paragraph_spacing_rem numeric(4,2) NOT NULL DEFAULT 1.5,
  hyperlink_style text NOT NULL DEFAULT 'bold',
  hyperlink_underline boolean NOT NULL DEFAULT true,
  hyperlink_color text,
  hyperlink_color_dark text,
  underline_color text,
  underline_color_dark text,
  list_style text NOT NULL DEFAULT 'circle',
  wide_align_max_width integer NOT NULL DEFAULT 1600,
  image_caption_left_border boolean NOT NULL DEFAULT false,
  quick_view_info boolean NOT NULL DEFAULT true,
  -- Footer area (per-post bottom)
  show_post_tags_bar boolean NOT NULL DEFAULT true,
  show_sources_bar boolean NOT NULL DEFAULT true,
  show_via_bar boolean NOT NULL DEFAULT true,
  show_author_card boolean NOT NULL DEFAULT false,
  show_prev_next boolean NOT NULL DEFAULT false,
  prev_next_mobile_hide boolean NOT NULL DEFAULT true,
  -- Newsletter (in-post)
  show_bottom_newsletter boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.post_layout_settings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.post_layout_settings TO authenticated;
GRANT ALL ON public.post_layout_settings TO service_role;

ALTER TABLE public.post_layout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pls public read"
  ON public.post_layout_settings FOR SELECT
  USING (true);

CREATE POLICY "pls staff insert"
  ON public.post_layout_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

CREATE POLICY "pls staff update"
  ON public.post_layout_settings FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')))
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER pls_set_updated_at
  BEFORE UPDATE ON public.post_layout_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Per-post / per-page override layoutu (JSON: { layout, format, featured_ratio_pct, center_header, ... })
ALTER TABLE public.posts ADD COLUMN layout_overrides jsonb;
ALTER TABLE public.posts ADD COLUMN post_format text NOT NULL DEFAULT 'standard';
ALTER TABLE public.pages ADD COLUMN layout_overrides jsonb;

-- 3. Newsletter (subskrybenci + ustawienia)
CREATE TABLE public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  email text NOT NULL,
  display_name text,
  language text NOT NULL DEFAULT 'pl',
  source text,
  status text NOT NULL DEFAULT 'subscribed',
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  ip inet,
  user_agent text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

GRANT INSERT ON public.newsletter_subscribers TO anon;
GRANT INSERT ON public.newsletter_subscribers TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.newsletter_subscribers TO authenticated;
GRANT ALL ON public.newsletter_subscribers TO service_role;

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Publiczny zapis (formularz na stronie). Walidacja po stronie aplikacji.
CREATE POLICY "newsletter public subscribe"
  ON public.newsletter_subscribers FOR INSERT
  TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL AND email IS NOT NULL);

CREATE POLICY "newsletter staff read"
  ON public.newsletter_subscribers FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

CREATE POLICY "newsletter staff update"
  ON public.newsletter_subscribers FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')))
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "newsletter staff delete"
  ON public.newsletter_subscribers FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND has_role(auth.uid(),'admin'));

CREATE TRIGGER newsletter_set_updated_at
  BEFORE UPDATE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_newsletter_tenant_status ON public.newsletter_subscribers (tenant_id, status);

-- 4. Ustawienia modułu newsletter (heading, description, policy, shortcode itd.)
CREATE TABLE public.newsletter_settings (
  tenant_id uuid PRIMARY KEY DEFAULT current_tenant_id(),
  heading_pl text NOT NULL DEFAULT 'Zapisz się do newslettera',
  heading_en text NOT NULL DEFAULT 'Subscribe to our Newsletter',
  description_pl text NOT NULL DEFAULT 'Otrzymuj najnowsze artykuły prosto na swoją skrzynkę.',
  description_en text NOT NULL DEFAULT 'Get the latest articles delivered to your inbox.',
  policy_html_pl text DEFAULT 'Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.',
  policy_html_en text DEFAULT 'By signing up, you agree to our <a href="/privacy-policy">Privacy Policy</a>. You may unsubscribe at any time.',
  success_message_pl text NOT NULL DEFAULT 'Dziękujemy! Sprawdź swoją skrzynkę.',
  success_message_en text NOT NULL DEFAULT 'Thanks! Please check your inbox.',
  double_opt_in boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.newsletter_settings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.newsletter_settings TO authenticated;
GRANT ALL ON public.newsletter_settings TO service_role;

ALTER TABLE public.newsletter_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "newsletter_settings public read"
  ON public.newsletter_settings FOR SELECT USING (true);

CREATE POLICY "newsletter_settings staff insert"
  ON public.newsletter_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

CREATE POLICY "newsletter_settings staff update"
  ON public.newsletter_settings FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')))
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TRIGGER newsletter_settings_set_updated_at
  BEFORE UPDATE ON public.newsletter_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
