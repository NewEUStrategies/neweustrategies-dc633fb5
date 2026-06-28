-- Hardening izolacji tenantów + serwerowa warstwa autoryzacji.
--
-- (a) Samoedytowalny profiles.tenant_id
--     Polityka "Users update own profile" pozwala userowi aktualizować własny
--     wiersz (WITH CHECK auth.uid() = id), ale NIE chroniła kolumny tenant_id.
--     Ponieważ current_tenant_id() czyta profiles.tenant_id wywołującego, a całe
--     RLS scope'uje dane po current_tenant_id(), możliwość zmiany własnego
--     tenant_id = przejęcie kontekstu innej firmy (czytanie jej draftów/danych).
--     Kolumnowy REVOKE UPDATE jest nieskuteczny przy table-level GRANT UPDATE,
--     więc pinujemy tenant_id triggerem BEFORE UPDATE (działa niezależnie od
--     grantów i RLS). tenant_id jest niezmienny po utworzeniu profilu.
--
-- (b) Jednowarstwowa autoryzacja
--     Mutacje contentu polegały wyłącznie na RLS (has_role w politykach).
--     Dodajemy is_staff() jako jawny, serwerowy check roli, wpinany w middleware
--     requireStaff przed handlerami - druga, niezależna warstwa obok RLS.

-- (a) tenant_id niezmienny -------------------------------------------------

CREATE OR REPLACE FUNCTION public.profiles_pin_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Ciche przypięcie zamiast błędu: każda próba zmiany tenant_id jest
  -- ignorowana, bez wywracania legalnych UPDATE-ów innych kolumn profilu.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_pin_tenant_tg ON public.profiles;
CREATE TRIGGER profiles_pin_tenant_tg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_pin_tenant();

-- (b) serwerowy check roli staff -------------------------------------------

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'editor')
      OR public.has_role(auth.uid(), 'author')
$$;

REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;
