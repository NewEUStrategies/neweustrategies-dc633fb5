-- ============================================================================
-- media_mentions: wzmianki prasowe podążają za profilem konta
-- ============================================================================
--
-- PO CO TA MIGRACJA. Sekcja "W mediach" profilu eksperta ma ten sam defekt, co
-- naprawione wcześniej push_subscriptions (20260914090000),
-- notification_preferences (20260914120000), author_profiles (20260914140000)
-- i biografia zawodowa (20260914160000) - ale z dodatkowym skutkiem, którego
-- tamte nie mają.
--
-- `media_mentions.tenant_id` to MIGAWKA profilu z chwili zapisu: DEFAULT
-- `COALESCE(current_tenant_id(), public_tenant_id())` (20260829091010:2-3), bez
-- triggera pinującego i bez przepięcia. Klient nie podaje tej kolumny ani przy
-- INSERT, ani przy UPDATE, więc stara wartość zostaje na zawsze.
--
-- Obie polityki właściciela wiążą najemcę w USING:
--     (user_id = auth.uid()) AND (tenant_id = current_tenant_id())
--
-- SKUTEK PO PRZENIESIENIU KONTA jest dwustronny i to ta druga strona jest tu
-- najpoważniejsza:
--
--   * dla WŁAŚCICIELA wpisy znikają - SELECT wraca pusty (sekcja "W mediach"
--     wygląda jak nigdy nieuzupełniona), a UPDATE i DELETE zwracają 0 wierszy
--     BEZ BŁĘDU, więc przyciski "Zapisz" i "Usuń" udają sukces
--     (src/components/profile/MediaMentionsSection.tsx:140, 170);
--
--   * dla ŚWIATA wpisy zostają OPUBLIKOWANE. Polityka "media_mentions public
--     read" filtruje po `is_public = true AND tenant_id = public_tenant_id()`
--     (20260714130000_expert_hub.sql:433-436), czyli po najemcy PRZEGLĄDANEJ
--     WITRYNY - a ten się nie zmienił. Wzmianki dalej wiszą publicznie na
--     stronie STAREGO najemcy, a autor nie ma ŻADNEJ drogi ich zdjęcia:
--     nie widzi ich, nie zaktualizuje ich i nie skasuje, a wstawienie nowego
--     wiersza starego nie usuwa.
--
-- Człowiek zostaje więc z treścią opublikowaną pod swoim nazwiskiem, nad którą
-- stracił kontrolę - i to jest powód, dla którego ta tabela należy do grupy
-- "dane OSOBY", a nie "treść obszaru roboczego". Wzmianka prasowa opisuje
-- eksperta, nie firmę, w której akurat miał konto.
--
-- Idempotentne.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_profiles_repin_account_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Moduł 12: doręczanie powiadomień.
  UPDATE public.push_subscriptions ps
     SET tenant_id = NEW.tenant_id
   WHERE ps.user_id = NEW.id
     AND ps.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.notification_preferences np
     SET tenant_id = NEW.tenant_id
   WHERE np.user_id = NEW.id
     AND np.tenant_id IS DISTINCT FROM NEW.tenant_id;

  -- Tożsamość publiczna autora.
  UPDATE public.author_profiles ap
     SET tenant_id = NEW.tenant_id
   WHERE ap.user_id = NEW.id
     AND ap.tenant_id IS DISTINCT FROM NEW.tenant_id;

  -- Biografia zawodowa: dane OSOBY, idą razem z kontem.
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

  -- Wzmianki prasowe: opisują EKSPERTA, nie firmę, w której miał konto.
  UPDATE public.media_mentions t
     SET tenant_id = NEW.tenant_id
   WHERE t.user_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_repin_account_tenant() IS
  'Po przeniesieniu konta między najemcami przepina wiersze STANU BIEŻĄCEGO konta i danych OSOBY: doręczanie powiadomień (push_subscriptions, notification_preferences), tożsamość autora (author_profiles), biografię zawodową (profile_skills/education/experiences/awards/hobbies/cv_files) i wzmianki prasowe (media_mentions). CELOWO pomija zapisy historyczne (zgody, płatności, dzienniki, wysłane powiadomienia), user_roles (zakresowane najemcą - podążanie byłoby eskalacją uprawnień) oraz stan roboczy wskazujący na treść obszaru (zakładki, historia lektury, zapisane widoki), gdzie wybór jest decyzją produktową.';

-- Backfill. Dla wierszy publicznych ma on drugie znaczenie: zdejmuje wzmiankę
-- z witryny najemcy, z którym autor nie ma już nic wspólnego, i oddaje mu nad
-- nią kontrolę.
UPDATE public.media_mentions t
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = t.user_id
   AND p.tenant_id IS NOT NULL
   AND t.tenant_id IS DISTINCT FROM p.tenant_id;
