-- ============================================================================
-- ZAKRES NAJEMCY DLA DZIENNIKA WYSYŁEK (email_send_log).
--
-- PRZYCZYNA ŹRÓDŁOWA. `email_send_log` jest jedynym zapisem tego, co platforma
-- faktycznie wysłała: niesie ADRESY ODBIORCÓW i dosłowną treść błędów dostawcy.
-- RLS tej tabeli dopuszcza wyłącznie `service_role` (20260728154925:44-64), więc
-- dla obu paneli, które ją czytają - /admin/newsletter/outbox
-- (`emailOutbox.functions.ts`) i /admin/newsletter/system-emails
-- (`system-log.server.ts`) - polityka nie stawia ŻADNEJ granicy: obie idą
-- klientem serwisowym, który RLS omija z definicji. Bramka przed handlerem
-- sprawdzała ROLĘ (`requireAdminEditor` / `requireAdmin`) i tylko rolę. Rola nie
-- jest granicą danych: administrator serwisu A widział adresy odbiorców serwisu
-- B. Filtr po najemcy był jedyną możliwą zaporą, a nie było po czym filtrować -
-- tabela nie miała kolumny `tenant_id` od dnia powstania.
--
-- Wzorzec jest ten sam co w 20260720120100 (client_errors) i 20260708150000
-- (web_vitals): kolumna -> backfill -> DEFAULT -> NOT NULL -> indeks
-- tenant-first, RLS bez zmian (dalej wyłącznie service_role).
--
-- ODSTĘPSTWO OD WZORCA, ŚWIADOME: DEFAULT TU NIE WYSTARCZA. Tamte migracje
-- pinują `DEFAULT public.public_tenant_id()`, co jest poprawne dla beacona
-- z przeglądarki, ale nie dla tej tabeli - z dwóch niezależnych powodów:
--   1. ta ścieżka NIE MA hosta żądania (service_role, bez sesji i bez nagłówka),
--      więc `public_tenant_id()` w praktyce zawsze zwróciłby tenanta domyślnego;
--   2. DEFAULT odpala się WYŁĄCZNIE wtedy, gdy kolumna jest POMINIĘTA w INSERT.
--      PostgREST serializuje jawny `null` dla każdego klucza obecnego w ładunku,
--      a dokładnie taki ładunek wyśle nadawca, któremu rozstrzygnięcie tenanta
--      się nie powiodło - i wtedy INSERT wywala się na NOT NULL już PO tym, jak
--      mail wyszedł.
-- Dlatego granicę domyka trigger BEFORE INSERT nad
-- `public.email_resolve_tenant_for_address` - tym samym rozstrzygaczem, który to
-- repozytorium napisało w 20260731120000 dokładnie dla przypadków „wypis,
-- webhook, mail transakcyjny" - z `public_tenant_id()` jako ostatnią deską.
-- Trigger łapie także jawny NULL, więc NULL jest nieosiągalny, dopóki istnieje
-- jakikolwiek najemca.
--
-- TYLKO INSERT, NIE UPDATE: ścieżka dostarczalności aktualizuje `status`
-- istniejącego wiersza (odbicie/skarga/wypis, 20260728154925:22-24) i nie wolno
-- jej przy okazji przeliczyć tenanta.
--
-- UCZCIWIE O BACKFILLU: jest NAJLEPSZYM MOŻLIWYM PRZYBLIŻENIEM, nie rekonstrukcją.
-- `email_resolve_tenant_for_address` schodzi na tenanta domyślnego dla adresu,
-- który nigdy się nie zapisał i nie ma konta, więc część wierszy historycznych
-- wyląduje u tenanta domyślnego. Backfill ZAWĘŻA wyciek, nie odkręca go w pełni;
-- wiersze powstające od tej migracji stempluje nadawca, który tenanta zna.
--
-- Migracja jest idempotentna.
-- ============================================================================

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Backfill: adres -> najemca (jednoznaczny subskrybent -> jednoznaczne konto),
-- a gdy adres nie mówi nic - najemca domyślny.
UPDATE public.email_send_log
   SET tenant_id = COALESCE(
         public.email_resolve_tenant_for_address(recipient_email),
         public.public_tenant_id())
 WHERE tenant_id IS NULL;

-- Ostatnia zapora przed wierszem bez najemcy. Wiersz bez najemcy jest gorszy niż
-- brak wiersza: nie widzi go ŻADEN operator, a widzi go każdy filtr `IS NULL`.
CREATE OR REPLACE FUNCTION public.tg_email_send_log_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(
      public.email_resolve_tenant_for_address(NEW.recipient_email),
      public.public_tenant_id());
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_email_send_log_bind_tenant() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_email_send_log_bind_tenant() TO service_role;

DROP TRIGGER IF EXISTS trg_email_send_log_bind_tenant ON public.email_send_log;
CREATE TRIGGER trg_email_send_log_bind_tenant
  BEFORE INSERT ON public.email_send_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_email_send_log_bind_tenant();

ALTER TABLE public.email_send_log ALTER COLUMN tenant_id SET DEFAULT public.public_tenant_id();
ALTER TABLE public.email_send_log ALTER COLUMN tenant_id SET NOT NULL;

-- Indeks pod OBA czytniki: okno czasu w granicach jednego najemcy.
CREATE INDEX IF NOT EXISTS email_send_log_tenant_created_idx
  ON public.email_send_log (tenant_id, created_at DESC);

-- Supabase nie nadaje service_role dostępu do schematu public domyślnie; grant
-- z 20260728154925 obejmuje tabelę, ale powtarzamy go jawnie, bo ta migracja
-- zmienia kształt tabeli i jest samodzielnie odtwarzalna.
GRANT ALL ON public.email_send_log TO service_role;

COMMENT ON COLUMN public.email_send_log.tenant_id IS
  'Najemca wysyłki. Stempluje go nadawca (tenant z bramki listy wykluczeń), a trigger dopina go z adresu, gdy nadawca go nie zna - dziennik niesie adresy odbiorców i nie wolno go czytać poza granicą najemcy.';
