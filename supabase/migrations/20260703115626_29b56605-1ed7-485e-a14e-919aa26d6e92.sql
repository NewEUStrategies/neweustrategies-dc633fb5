
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.categories ADD CONSTRAINT categories_color_hex CHECK (color IS NULL OR color ~* '^#[0-9a-f]{6}$');

-- Seed 12 core content areas per existing tenant with recommended non-yellow palette.
INSERT INTO public.categories (tenant_id, slug, name_pl, name_en, color)
SELECT t.id, v.slug, v.name_pl, v.name_en, v.color
FROM public.tenants t
CROSS JOIN (VALUES
  ('geopolityka',            'Geopolityka',              'Geopolitics',              '#1f3a8a'),
  ('wojskowosc',             'Wojskowość',               'Military',                 '#4a5d23'),
  ('technologia',            'Technologia',              'Technology',               '#0ea5e9'),
  ('cyberbezpieczenstwo',    'Cyberbezpieczeństwo',      'Cybersecurity',            '#7c3aed'),
  ('finanse',                'Finanse',                  'Finance',                  '#059669'),
  ('gospodarka',             'Gospodarka',               'Economy',                  '#0d9488'),
  ('transport',              'Transport',                'Transport',                '#ea580c'),
  ('energetyka',             'Energetyka',               'Energy',                   '#dc2626'),
  ('historia',               'Historia',                 'History',                  '#78350f'),
  ('dyplomacja',             'Dyplomacja',               'Diplomacy',                '#be185d'),
  ('stosunki-miedzynarodowe','Stosunki międzynarodowe',  'International Relations',  '#475569'),
  ('wydarzenia',             'Wydarzenia',               'Events',                   '#111827')
) AS v(slug, name_pl, name_en, color)
ON CONFLICT (tenant_id, slug) DO UPDATE
  SET color = COALESCE(public.categories.color, EXCLUDED.color);
