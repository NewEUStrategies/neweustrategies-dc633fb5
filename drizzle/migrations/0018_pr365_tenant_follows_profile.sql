-- PR #365: najemca stanu bieżącego konta i danych OSOBY podąża za profilem.
-- Stan końcowy migracji 20260914090000..20260914220000.

-- 1) push_subscriptions: pin najemcy do profilu właściciela
CREATE OR REPLACE FUNCTION public.push_subscriptions_pin_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant
    FROM public.profiles p
   WHERE p.id = NEW.user_id;

  IF v_tenant IS NOT NULL THEN
    NEW.tenant_id := v_tenant;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.push_subscriptions_pin_tenant() IS
  'Przypina push_subscriptions.tenant_id do profiles.tenant_id WŁAŚCICIELA wiersza (NEW.user_id), przy INSERT i przy UPDATE. Utrzymuje zgodność z kluczem adresata dyspozytora (tenant_id, user_id), który pochodzi z notifications.tenant_id, czyli z tego samego profilu. Brak profilu zostawia wartość dotychczasową - push nigdy nie wywraca zapisu.';

DROP TRIGGER IF EXISTS push_subscriptions_pin_tenant ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_pin_tenant
  BEFORE INSERT OR UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.push_subscriptions_pin_tenant();

DROP POLICY IF EXISTS "push subs owner all" ON public.push_subscriptions;
CREATE POLICY "push subs owner all" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = COALESCE((SELECT public.current_tenant_id()), tenant_id)
  );

UPDATE public.push_subscriptions ps
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = ps.user_id
   AND p.tenant_id IS NOT NULL
   AND ps.tenant_id IS DISTINCT FROM p.tenant_id;

CREATE INDEX IF NOT EXISTS push_subscriptions_user_tenant_live_idx
  ON public.push_subscriptions (user_id, tenant_id) WHERE failed_at IS NULL;

DROP INDEX IF EXISTS public.idx_push_subscriptions_user;
DROP INDEX IF EXISTS public.push_subscriptions_user_live_idx;

COMMENT ON COLUMN public.push_subscriptions.tenant_id IS
  'Najemca WŁAŚCICIELA subskrypcji (profiles.tenant_id), przypinany triggerem push_subscriptions_pin_tenant przy INSERT i UPDATE oraz przepinany triggerem profiles_repin_account_tenant po przeniesieniu konta. NIE jest to najemca przeglądanej witryny: DEFAULT public_tenant_id() to wyłącznie wartość awaryjna dla wiersza bez profilu. Dyspozytor (processPushJobs) dobiera urządzenia po parze (tenant_id, user_id) wywiedzionej z notifications.tenant_id, czyli z tego samego profilu.';

-- 2) notification_preferences: najemca wyprowadzany z profilu, nie zamrażany
CREATE OR REPLACE FUNCTION public.notification_preferences_pin_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id    := OLD.user_id;
    NEW.created_at := OLD.created_at;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF v_tenant IS NOT NULL THEN
    NEW.tenant_id := v_tenant;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notification_preferences_pin_identity() IS
  'Przypina notification_preferences do tożsamości właściciela: user_id i created_at są niezmienne, a tenant_id jest WYPROWADZANY z profiles.tenant_id (nie zamrażany), żeby przeniesienie konta między najemcami nie osierociło wiersza pod politykami own prefs *, które wiążą najemcę w USING.';

-- 3) Wspólny trigger przepinający po przeniesieniu konta (stan końcowy)
CREATE OR REPLACE FUNCTION public.tg_profiles_repin_account_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.push_subscriptions ps
     SET tenant_id = NEW.tenant_id
   WHERE ps.user_id = NEW.id
     AND ps.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.notification_preferences np
     SET tenant_id = NEW.tenant_id
   WHERE np.user_id = NEW.id
     AND np.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.author_profiles ap
     SET tenant_id = NEW.tenant_id
   WHERE ap.user_id = NEW.id
     AND ap.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_skills t
     SET tenant_id = NEW.tenant_id
   WHERE t.user_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_education t
     SET tenant_id = NEW.tenant_id
   WHERE t.user_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_experiences t
     SET tenant_id = NEW.tenant_id
   WHERE t.user_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_awards t
     SET tenant_id = NEW.tenant_id
   WHERE t.user_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_hobbies t
     SET tenant_id = NEW.tenant_id
   WHERE t.user_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_cv_files t
     SET tenant_id = NEW.tenant_id
   WHERE t.user_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.media_mentions t
     SET tenant_id = NEW.tenant_id
   WHERE t.user_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_skill_endorsements t
     SET tenant_id = NEW.tenant_id
   WHERE t.recipient_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_recommendations t
     SET tenant_id = NEW.tenant_id
   WHERE t.recipient_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_embeddings t
     SET tenant_id = NEW.tenant_id
   WHERE t.profile_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_repin_account_tenant() IS
  'Po przeniesieniu konta między najemcami przepina wiersze STANU BIEŻĄCEGO konta i danych OSOBY: doręczanie powiadomień (push_subscriptions, notification_preferences), tożsamość autora (author_profiles), biografię zawodową (profile_skills/education/experiences/awards/hobbies/cv_files), wzmianki prasowe (media_mentions) oraz otoczenie profilu (profile_skill_endorsements, profile_recommendations, profile_embeddings). CELOWO pomija zapisy historyczne (zgody, płatności, dzienniki, wysłane powiadomienia), user_roles (zakresowane najemcą - podążanie byłoby eskalacją uprawnień) oraz stan roboczy wskazujący na treść obszaru (zakładki, historia lektury, zapisane widoki), gdzie wybór jest decyzją produktową.';

DROP TRIGGER IF EXISTS profiles_repin_push_subscriptions ON public.profiles;
DROP FUNCTION IF EXISTS public.tg_profiles_repin_push_subscriptions();

DROP TRIGGER IF EXISTS profiles_repin_account_tenant ON public.profiles;
CREATE TRIGGER profiles_repin_account_tenant
  AFTER UPDATE OF tenant_id ON public.profiles
  FOR EACH ROW
  WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION public.tg_profiles_repin_account_tenant();

-- 4) Backfille wierszy osieroconych przed tą serią
UPDATE public.notification_preferences np
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = np.user_id
   AND p.tenant_id IS NOT NULL
   AND np.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.author_profiles ap
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = ap.user_id
   AND p.tenant_id IS NOT NULL
   AND ap.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_skills t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.user_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_education t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.user_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_experiences t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.user_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_awards t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.user_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_hobbies t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.user_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_cv_files t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.user_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.media_mentions t
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = t.user_id
   AND p.tenant_id IS NOT NULL
   AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_skill_endorsements t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.recipient_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_recommendations t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.recipient_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_embeddings t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.profile_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

-- 5) endorse_skill: najemca poparcia z UMIEJĘTNOŚCI + bramka najemcy
CREATE OR REPLACE FUNCTION public.endorse_skill(p_skill_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_recipient UUID;
  v_tenant    UUID;
  v_id        UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT user_id, tenant_id INTO v_recipient, v_tenant
    FROM public.profile_skills
   WHERE id = p_skill_id;
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'skill not found'; END IF;
  IF v_recipient = auth.uid() THEN RAISE EXCEPTION 'cannot endorse own skill'; END IF;

  IF v_tenant IS DISTINCT FROM public._caller_tenant() THEN
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT public._are_connected(auth.uid(), v_recipient) THEN
    RAISE EXCEPTION 'must be connected';
  END IF;

  INSERT INTO public.profile_skill_endorsements
    (tenant_id, skill_id, recipient_id, endorser_id)
  VALUES (v_tenant, p_skill_id, v_recipient, auth.uid())
  ON CONFLICT (skill_id, endorser_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

COMMENT ON FUNCTION public.endorse_skill(uuid) IS
  'Poparcie umiejętności. Najemca wiersza pochodzi z UMIEJĘTNOŚCI (nie z wołającego), a wołający z innego najemcy jest odrzucany jako tenant_mismatch - inaczej zaakceptowane połączenie sprzed przeniesienia konta pozwalało utworzyć poparcie w starym obszarze pod umiejętnością, która stoi już w nowym, i adresat go nie widział. Ten sam kontrakt co write_recommendation.';

UPDATE public.profile_skill_endorsements e
   SET tenant_id = s.tenant_id
  FROM public.profile_skills s
 WHERE s.id = e.skill_id
   AND e.tenant_id IS DISTINCT FROM s.tenant_id;