-- Zaproszenia: odbiorca może przestawić WYŁĄCZNIE przyjęcie, nic więcej.
--
-- PO CO TA MIGRACJA ISTNIEJE. Hardening wszedł wyłącznie na pas drizzle (0031).
-- Na pasie kanonicznym trigger zatrzymywał się na `send_count`, więc w każdym
-- środowisku odtworzonym z `supabase/migrations` klient przyjmujący zaproszenie
-- mógł jednym UPDATE-em przepisać `id`, `auth_user_id`, `created_at`, `sent_at`
-- i `last_error`, a `status` ustawić na dowolną wartość - również cofnąć.
-- Rozjazd pasów oznaczał więc nie „inną wersję pliku", tylko SŁABSZĄ OCHRONĘ
-- na pasie, którym stawiane są środowiska.
--
-- CO TO ZMIENIA. Wszystkie kolumny administracyjne i tożsamościowe wracają do
-- wartości zapisanej, przejście statusu jest dozwolone tylko w stronę
-- `accepted`, a `accepted_at` stempluje baza. Migracja wyłącznie ZAWĘŻA
-- uprawnienia klienta - nie nadaje żadnych nowych i jest bezpieczna do
-- ponownego wykonania (`CREATE OR REPLACE`).
--
-- Serwis i administracja przechodzą jak dotąd: gałąź `is_service_role_caller()`
-- / `super_admin` zwraca NEW bez zmian, więc panel zaproszeń działa bez wyjątku.

CREATE OR REPLACE FUNCTION public.user_invitations_pin_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role_caller()
     OR public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Administrative / identity columns: never client-writable.
  NEW.id           := OLD.id;
  NEW.role         := OLD.role;
  NEW.tenant_id    := OLD.tenant_id;
  NEW.email        := OLD.email;
  NEW.display_name := OLD.display_name;
  NEW.mode         := OLD.mode;
  NEW.source       := OLD.source;
  NEW.metadata     := OLD.metadata;
  NEW.invited_by   := OLD.invited_by;
  NEW.expires_at   := OLD.expires_at;
  NEW.send_count   := OLD.send_count;
  NEW.sent_at      := OLD.sent_at;
  NEW.last_error   := OLD.last_error;
  NEW.created_at   := OLD.created_at;
  NEW.auth_user_id := OLD.auth_user_id;

  -- Acceptance is the only recipient-driven transition, and only forward.
  IF NEW.status <> OLD.status AND NEW.status <> 'accepted'::public.invitation_status THEN
    RAISE EXCEPTION 'user_invitations: recipient may only accept';
  END IF;

  IF NEW.status = 'accepted'::public.invitation_status AND NEW.accepted_at IS NULL THEN
    NEW.accepted_at := now();
  END IF;

  IF NEW.status = OLD.status THEN
    NEW.accepted_at := OLD.accepted_at;
  END IF;

  RETURN NEW;
END;
$$;
