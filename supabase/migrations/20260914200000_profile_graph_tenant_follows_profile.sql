-- ============================================================================
-- Otoczenie profilu podąża za kontem: poparcia, rekomendacje, wektory
-- ============================================================================
--
-- PO CO TA MIGRACJA. Domknięcie serii 20260914*: trzy ostatnie tabele opisujące
-- OSOBĘ, które zostawały w starym najemcy po przeniesieniu konta.
--
-- 1) profile_skill_endorsements - SPÓJNOŚĆ Z RODZICEM, nie tylko wygoda.
--    Tabela ma `skill_id` z kluczem obcym do `profile_skills`, a
--    20260914160000 kazało umiejętnościom podążać za profilem. Gdyby poparcia
--    zostały, najemca poparcia rozjechałby się z najemcą WŁASNEJ umiejętności:
--    `endorse_read` wiąże `tenant_id = current_tenant_id()`, więc adresat
--    widziałby swoją umiejętność, ale nie widziałby poparć pod nią. Ten defekt
--    utworzyłaby dopiero poprzednia migracja - dlatego zamykamy go w tej samej
--    serii.
--
-- 2) profile_recommendations - treść profilu ADRESATA.
--    Rekomendacja jest wyświetlana na profilu osoby, której dotyczy, więc idzie
--    za `recipient_id`. ŚWIADOMY KOSZT: `prof_rec_read` wiąże
--    `tenant_id = current_tenant_id()` dla OBU stron, więc po przeniesieniu
--    adresata autor rekomendacji, który został w starym najemcy, przestaje ją
--    widzieć. Wybór jest między "adresat traci rekomendacje ze swojego profilu"
--    a "autor traci wgląd w tekst, który już napisał" - pierwsze jest utratą
--    treści profilu dla jej właściciela i widocznym brakiem dla wszystkich
--    czytelników, drugie dotyczy wglądu w cudzy profil po rozstaniu obszarów.
--
-- 3) profile_embeddings - WYSZUKIWALNOŚĆ I IZOLACJA NARAZ.
--    Klucz to `profile_id` (nie `user_id`). Tabela nie ma polityk klienckich,
--    ale `semantic_search_profiles` łączy ją warunkiem
--    `pe.tenant_id = me.tenant_id`, czyli najemcą SZUKAJĄCEGO. Nieaktualny
--    wektor działa więc w obie strony: przeniesiona osoba NIE JEST znajdowana
--    w wyszukiwarce ludzi swojego nowego obszaru, a POZOSTAJE znajdowana w
--    obszarze, z którego odeszła. To drugie jest wyciekiem profilu do
--    obszaru roboczego, który stracił do niego prawo.
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

  -- Otoczenie profilu. Poparcia MUSZĄ iść za umiejętnością, pod którą wiszą.
  UPDATE public.profile_skill_endorsements t
     SET tenant_id = NEW.tenant_id
   WHERE t.recipient_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.profile_recommendations t
     SET tenant_id = NEW.tenant_id
   WHERE t.recipient_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  -- Klucz to profile_id, nie user_id.
  UPDATE public.profile_embeddings t
     SET tenant_id = NEW.tenant_id
   WHERE t.profile_id = NEW.id AND t.tenant_id IS DISTINCT FROM NEW.tenant_id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_repin_account_tenant() IS
  'Po przeniesieniu konta między najemcami przepina wiersze STANU BIEŻĄCEGO konta i danych OSOBY: doręczanie powiadomień (push_subscriptions, notification_preferences), tożsamość autora (author_profiles), biografię zawodową (profile_skills/education/experiences/awards/hobbies/cv_files), wzmianki prasowe (media_mentions) oraz otoczenie profilu (profile_skill_endorsements, profile_recommendations, profile_embeddings). CELOWO pomija zapisy historyczne (zgody, płatności, dzienniki, wysłane powiadomienia), user_roles (zakresowane najemcą - podążanie byłoby eskalacją uprawnień) oraz stan roboczy wskazujący na treść obszaru (zakładki, historia lektury, zapisane widoki), gdzie wybór jest decyzją produktową.';

-- Backfill wierszy osieroconych przed tą serią migracji.
UPDATE public.profile_skill_endorsements t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.recipient_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_recommendations t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.recipient_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;

UPDATE public.profile_embeddings t SET tenant_id = p.tenant_id FROM public.profiles p
 WHERE p.id = t.profile_id AND p.tenant_id IS NOT NULL AND t.tenant_id IS DISTINCT FROM p.tenant_id;
