-- ============================================================================
-- Dane CV podążają za profilem przy przeniesieniu konta
-- ============================================================================
--
-- PO CO TA MIGRACJA. Sześć tabel biografii zawodowej - `profile_skills`,
-- `profile_education`, `profile_experiences`, `profile_awards`,
-- `profile_hobbies`, `profile_cv_files` - ma ten sam defekt, co naprawione
-- wcześniej `push_subscriptions` (20260914090000), `notification_preferences`
-- (20260914120000) i `author_profiles` (20260914140000), ale najbardziej
-- widoczny dla człowieka skutek.
--
-- Każda z nich ma DOKŁADNIE JEDNĄ politykę właściciela, `FOR ALL`, z
-- warunkiem w USING:
--
--     (auth.uid() = user_id) AND (tenant_id = current_tenant_id())
--
-- `current_tenant_id()` to `SELECT tenant_id FROM profiles WHERE id = auth.uid()`,
-- czyli najemca AKTUALNEGO profilu. Wiersze CV noszą natomiast najemcę z chwili
-- ZAPISANIA i nikt ich nie przepina. Po przeniesieniu konta między najemcami -
-- legalnym i realnym, bo `profiles_pin_tenant_id` zwalnia
-- `is_service_role_caller()`, a tą furtką chodzi przyjęcie zaproszenia
-- (src/lib/admin/invitations.functions.ts:401-406) - warunek przestaje być
-- spełniony dla WSZYSTKICH wierszy naraz.
--
-- SKUTEK: użytkownikowi znika cała biografia zawodowa. Wykształcenie,
-- doświadczenie, umiejętności, nagrody, zainteresowania i pliki CV stają się
-- niewidoczne, nieedytowalne i niekasowalne - bo `FOR ALL` obejmuje każdą
-- operację, a innej polityki na tych tabelach nie ma. Z perspektywy człowieka
-- wygląda to na UTRATĘ DANYCH: profil pokazuje pustkę, choć wiersze leżą
-- nietknięte w bazie.
--
-- Sprawdzone na pełnym schemacie: przed przeniesieniem właściciel widzi swoje
-- wiersze, po przeniesieniu widzi zero.
--
-- DLACZEGO PODĄŻANIE JEST TU POPRAWNE. To są dane OSOBY, nie obszaru roboczego:
-- wykształcenie i doświadczenie zawodowe należą do człowieka i idą z nim tam,
-- gdzie idzie jego konto. Żadna z tych tabel nie ma klucza obcego do treści
-- (posta, klubu, wydarzenia), więc przepięcie niczego nie odspaja od rodzica -
-- jedynym ich rodzicem jest profil.
--
-- CZEGO TA MIGRACJA NIE RUSZA I DLACZEGO.
--   * Zapisy HISTORYCZNE: zgody RODO (`user_consents`, `user_consent_events`),
--     płatności i zakupy, dzienniki zdarzeń i odsłon, wysłane powiadomienia,
--     `personality_result_history`. Tam najemca z chwili zdarzenia JEST
--     prawdą, a przepisanie go byłoby fałszowaniem zapisu.
--   * `user_roles`: nadanie roli jest zakresowane najemcą (`has_role()`
--     sprawdza `ur.tenant_id = current_tenant_id()`), więc podążanie
--     awansowałoby administratora najemcy X na administratora najemcy Y w
--     chwili przeniesienia konta. Zastane zachowanie - rola wygasa wraz z
--     przeniesieniem - jest bezpieczne i zamierzone.
--   * Stan roboczy WSKAZUJĄCY NA TREŚĆ obszaru: zakładki, "do przeczytania",
--     historia lektury, obserwacje, notatki, zapisane wyszukiwania i widoki.
--     Tu "podążać czy zostać" nie jest pytaniem technicznym, tylko decyzją
--     produktową (czy zakładka do artykułu firmy A ma przetrwać przejście do
--     firmy B), a domyślna odpowiedź bazy nie powinna jej przesądzać po cichu.
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

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_repin_account_tenant() IS
  'Po przeniesieniu konta między najemcami przepina wiersze STANU BIEŻĄCEGO konta i danych OSOBY: doręczanie powiadomień (push_subscriptions, notification_preferences), tożsamość autora (author_profiles) oraz biografię zawodową (profile_skills/education/experiences/awards/hobbies/cv_files). CELOWO pomija zapisy historyczne (zgody, płatności, dzienniki, wysłane powiadomienia), user_roles (zakresowane najemcą - podążanie byłoby eskalacją uprawnień) oraz stan roboczy wskazujący na treść obszaru (zakładki, historia lektury, zapisane widoki), gdzie wybór jest decyzją produktową.';

-- Backfill wierszy osieroconych przed tą migracją. Dla tych tabel jest to
-- JEDYNA droga naprawy: USING blokuje właścicielowi każdą operację, więc sam
-- z siebie nie odzyska dostępu do własnej biografii.
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
