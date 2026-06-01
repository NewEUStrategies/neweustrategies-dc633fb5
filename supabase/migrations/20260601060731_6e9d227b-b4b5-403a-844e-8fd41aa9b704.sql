
-- Read history table
CREATE TABLE IF NOT EXISTS public.user_read_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  post_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_read_history TO authenticated;
GRANT ALL ON public.user_read_history TO service_role;

ALTER TABLE public.user_read_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_history owner select" ON public.user_read_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "read_history owner insert" ON public.user_read_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "read_history owner update" ON public.user_read_history
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "read_history owner delete" ON public.user_read_history
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_read_history_user_read_at
  ON public.user_read_history (user_id, read_at DESC);

-- Default personalized settings entry
INSERT INTO public.site_settings (key, value)
VALUES ('personalized_system', jsonb_build_object(
  'enabled', true,
  'allowGuests', false,
  'guestExpirationDays', 14,
  'userExpirationDays', 60,
  'popupNotification', true,
  'restrictedTitle', 'Dołącz do społeczności',
  'restrictedDescription', 'Załóż konto, aby zapisywać ulubione artykuły i wracać do nich w dowolnym momencie.',
  'followInCategoryHeader', true,
  'followInTagHeader', false,
  'followInAuthorHeader', true,
  'readingListPath', '/reading-list',
  'sections', jsonb_build_object(
    'saved', jsonb_build_object(
      'enabled', true,
      'heading', 'Twoja lista do przeczytania',
      'description', 'Tutaj znajdziesz wszystkie zapisane artykuły.',
      'columns', 3
    ),
    'followed', jsonb_build_object(
      'enabled', true,
      'heading', 'Obserwowane',
      'description', 'Kategorie i autorzy, których obserwujesz.',
      'columns', 3
    ),
    'recommended', jsonb_build_object(
      'enabled', true,
      'heading', 'Rekomendowane dla Ciebie',
      'description', 'Wybrane na podstawie Twoich zainteresowań i historii czytania.',
      'columns', 3,
      'postsPerPage', 9
    )
  )
))
ON CONFLICT (key) DO NOTHING;
