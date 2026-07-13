-- ============================================================================
-- SPOŁECZNOŚĆ 2/10: odznaki profilowe (sygnały zaufania w katalogu /people).
--
-- W społeczności eksperckiej "kto jest w pokoju" decyduje o wartości -
-- odznaki to publiczne, nadawane przez redakcję sygnały:
--   verified     zweryfikowana tożsamość/afiliacja zawodowa,
--   expert       ekspert goszczący sesje Q&A / autor analiz,
--   contributor  autor przyjętego tekstu gościnnego (nadawana też
--                automatycznie przy akceptacji zgłoszenia - patrz 8/10),
--   staff        zespół redakcji.
--
-- Odczyt publiczny w obrębie tenantu (to jawny sygnał zaufania); nadawanie
-- i odbieranie wyłącznie przez adminów tenantu. Nadanie odznaki powiadamia
-- użytkownika (enqueue_notification szanuje jego preferencje).
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profile_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge text NOT NULL CHECK (badge IN ('verified', 'expert', 'contributor', 'staff')),
  note text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, badge)
);

CREATE INDEX IF NOT EXISTS idx_profile_badges_user
  ON public.profile_badges (tenant_id, user_id);

GRANT SELECT ON public.profile_badges TO anon, authenticated;
GRANT INSERT, DELETE ON public.profile_badges TO authenticated;
GRANT ALL ON public.profile_badges TO service_role;
ALTER TABLE public.profile_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "badges public read" ON public.profile_badges;
CREATE POLICY "badges public read" ON public.profile_badges
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "badges admin insert" ON public.profile_badges;
CREATE POLICY "badges admin insert" ON public.profile_badges
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "badges admin delete" ON public.profile_badges;
CREATE POLICY "badges admin delete" ON public.profile_badges
  FOR DELETE TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- Wypełnij granted_by po stronie bazy i powiadom odbiorcę o nadaniu.
CREATE OR REPLACE FUNCTION public.tg_profile_badges_granted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label_pl text;
  v_label_en text;
BEGIN
  IF NEW.granted_by IS NULL THEN
    NEW.granted_by := auth.uid();
  END IF;

  v_label_pl := CASE NEW.badge
    WHEN 'verified'    THEN 'Zweryfikowany profil'
    WHEN 'expert'      THEN 'Ekspert'
    WHEN 'contributor' THEN 'Autor gościnny'
    WHEN 'staff'       THEN 'Zespół redakcji'
  END;
  v_label_en := CASE NEW.badge
    WHEN 'verified'    THEN 'Verified profile'
    WHEN 'expert'      THEN 'Expert'
    WHEN 'contributor' THEN 'Guest contributor'
    WHEN 'staff'       THEN 'Editorial staff'
  END;

  PERFORM public.enqueue_notification(
    NEW.user_id,
    'system',
    'Otrzymujesz odznakę: ' || v_label_pl,
    'You received a badge: ' || v_label_en,
    'Odznaka jest widoczna przy Twoim profilu i w katalogu osób.',
    'The badge is visible on your profile and in the people directory.',
    '/profile',
    'BadgeCheck'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profile_badges_granted ON public.profile_badges;
CREATE TRIGGER profile_badges_granted
  BEFORE INSERT ON public.profile_badges
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_badges_granted();
