-- ============================================================================
-- author_profiles: najemca profilu autorskiego podąża za profilem konta
-- ============================================================================
--
-- PO CO TA MIGRACJA. Trzeci wiersz STANU BIEŻĄCEGO konta z tym samym defektem,
-- co `push_subscriptions` (20260914090000) i `notification_preferences`
-- (20260914120000): najemca jest ustawiany RAZ, przy zakładaniu wiersza, i nie
-- podąża za przeniesieniem konta między najemcami.
--
-- Tutaj skutek jest NAJOSTRZEJSZY z całej trójki, bo 20260803140000 utwardziło
-- izolację po obu stronach naraz:
--   * wszystkie cztery polityki właściciela wiążą `tenant_id = current_tenant_id()`,
--   * ORAZ robi to samo ciało `get_own_author_profile()` (SECURITY DEFINER),
--     czyli JEDYNA droga odczytu edytora - kolumny kontaktowe mają odebrany
--     kolumnowy SELECT, więc tabeli bazowej klient nie czyta.
--
-- Utwardzenie było słuszne (obszar roboczy firmy A wystawiał wiersz sesji
-- firmy B), ale zamknęło objaw, nie przyczynę: DRYF został. Po przeniesieniu
-- konta właściciel widzi PUSTY formularz profilu autorskiego - RPC zwraca
-- zero wierszy - a próba zapisania czegokolwiek kończy się twardym błędem:
--
--     new row violates row-level security policy (USING expression)
--
-- bo upsert `onConflict: "user_id"` (src/components/profile/AuthorProfileEditor.tsx:373)
-- trafia w istniejący wiersz, którego USING już nie przepuszcza. Profil
-- autorski - bio, zdjęcie, kontakt medialny - staje się trwale niedostępny,
-- a użytkownik nie ma ŻADNEJ drogi naprawy: UNIQUE (user_id) blokuje też
-- założenie wiersza zastępczego.
--
-- Zwróć uwagę, że sam trigger pinujący tego NIE naprawia. `BEFORE` ustawia
-- wiersz NOWY, a USING jest sprawdzane na wierszu ISTNIEJĄCYM - dla rekordu,
-- który zdążył osierocieć, żadna zmiana triggera nie otworzy zapisu. Naprawą
-- jest więc BACKFILL (rekordy już osierocone) plus PRZEPIĘCIE przy
-- przeniesieniu (żeby nowe nie powstawały). To samo dotyczyło preferencji.
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CZEGO TU NIE MA: zmiany `author_profiles_set_tenant`
-- ----------------------------------------------------------------------------
-- Kuszące było kazać temu triggerowi WYPROWADZAĆ najemcę z profilu przy każdym
-- zapisie (tak jak robią to piny push i preferencji), zamiast uzupełniać go
-- wyłącznie `IF NEW.tenant_id IS NULL`. Świadomie tego NIE robimy, z dwóch
-- powodów:
--
--   * Nic by to nie dało. Klient i tak nie wstawi obcego najemcy, bo polityka
--     "Owners can insert own author profile" ma `WITH CHECK (... AND tenant_id
--     = current_tenant_id())`. Jedynym realnym źródłem dryfu jest
--     PRZENIESIENIE KONTA, a to obsługuje punkt 2.
--   * Zabrałoby narzędzie testom izolacji.
--     `supabase/tests/author_profiles_owner_tenant_scope_test.sql` (asercje
--     12-14) MUSI umieć zbudować wiersz z dryfem, żeby udowodnić, że polityki
--     właściciela i `get_own_author_profile()` taki wiersz odfiltrowują.
--     Trigger wyprowadzający najemcę bezwarunkowo uniemożliwia zbudowanie tej
--     fikstury, czyli kasuje dowód na działanie zabezpieczenia, którego sam nie
--     zastępuje.
--
-- Zostawiamy więc obronę wielowarstwową: polityki pilnują izolacji, punkt 2
-- pilnuje, żeby legalne przeniesienie konta nie produkowało dryfu.

-- ----------------------------------------------------------------------------
-- 2) Przepięcie po przeniesieniu konta - dopisanie do wspólnego triggera
-- ----------------------------------------------------------------------------
-- Lista pozostaje JAWNA (osobne UPDATE, nie pętla po katalogu): każda kolejna
-- tabela ma wymagać rozstrzygnięcia "stan bieżący czy zapis historyczny".
-- Automat przepisałby przy okazji dowody zgód, płatności i dzienniki, gdzie
-- najemca z chwili zdarzenia JEST prawdą.
--
-- Świadomie NIE MA tu `user_roles`: nadanie roli jest zakresowane najemcą
-- (`has_role()` sprawdza `ur.tenant_id = current_tenant_id()`), więc
-- "podążanie za profilem" awansowałoby administratora najemcy X na
-- administratora najemcy Y w chwili przeniesienia konta. Zastane zachowanie -
-- rola zostaje przy starym najemcy i wygasa wraz z przeniesieniem - jest
-- bezpieczne i zamierzone.
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

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_repin_account_tenant() IS
  'Po przeniesieniu konta między najemcami przepina wiersze STANU BIEŻĄCEGO konta (push_subscriptions, notification_preferences, author_profiles), żeby klucze zakresu najemcy nadal zgadzały się z profilem. Zapisy historyczne (zgody, płatności, dzienniki, wysłane powiadomienia) oraz nadania ról (user_roles - zakresowane najemcą, podążanie byłoby eskalacją uprawnień) są CELOWO pominięte.';

-- ----------------------------------------------------------------------------
-- 3) Backfill wierszy osieroconych przed tą migracją
-- ----------------------------------------------------------------------------
-- To jest jedyna droga naprawy dla rekordu, który już dryfnął: USING blokuje
-- zapis właścicielowi, więc sam z siebie nie odzyska do niego dostępu.
UPDATE public.author_profiles ap
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = ap.user_id
   AND p.tenant_id IS NOT NULL
   AND ap.tenant_id IS DISTINCT FROM p.tenant_id;
