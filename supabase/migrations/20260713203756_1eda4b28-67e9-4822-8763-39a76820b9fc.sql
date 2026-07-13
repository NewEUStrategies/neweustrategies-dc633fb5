-- Rozszerzenie member_organizations o pola brandingu i profilowe.
ALTER TABLE public.member_organizations
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS sector text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS brand_primary text,
  ADD COLUMN IF NOT EXISTS brand_accent text,
  ADD COLUMN IF NOT EXISTS brand_ink text,
  ADD COLUMN IF NOT EXISTS logo_h_light text,
  ADD COLUMN IF NOT EXISTS logo_h_dark text,
  ADD COLUMN IF NOT EXISTS logo_v_light text,
  ADD COLUMN IF NOT EXISTS logo_v_dark text,
  ADD COLUMN IF NOT EXISTS logo_favicon text;

CREATE UNIQUE INDEX IF NOT EXISTS member_organizations_slug_key
  ON public.member_organizations (slug)
  WHERE slug IS NOT NULL;
