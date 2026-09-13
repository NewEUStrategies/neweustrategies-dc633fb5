CREATE OR REPLACE FUNCTION public.email_send_log_tenant_for_address(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_tenant uuid;
  v_count integer;
BEGIN
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT count(DISTINCT ns.tenant_id) INTO v_count
    FROM public.newsletter_subscribers ns
   WHERE lower(btrim(ns.email)) = v_email;
  IF v_count = 1 THEN
    SELECT DISTINCT ns.tenant_id INTO v_tenant
      FROM public.newsletter_subscribers ns
     WHERE lower(btrim(ns.email)) = v_email;
    RETURN v_tenant;
  END IF;

  SELECT count(DISTINCT p.tenant_id) INTO v_count
    FROM public.profiles p
   WHERE lower(btrim(p.email)) = v_email AND p.tenant_id IS NOT NULL;
  IF v_count = 1 THEN
    SELECT DISTINCT p.tenant_id INTO v_tenant
      FROM public.profiles p
     WHERE lower(btrim(p.email)) = v_email AND p.tenant_id IS NOT NULL;
    RETURN v_tenant;
  END IF;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.email_send_log_tenant_for_address(text) IS
  'Najemca wiersza dziennika poczty rozstrzygniety z adresu odbiorcy: jednoznaczny subskrybent -> jednoznaczne konto -> NULL. Swiadomie BEZ fallbacku na najemce domyslnego.';

REVOKE ALL ON FUNCTION public.email_send_log_tenant_for_address(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_send_log_tenant_for_address(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.tg_email_send_log_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.email_send_log_tenant_for_address(NEW.recipient_email);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS email_send_log_bind_tenant ON public.email_send_log;
CREATE TRIGGER email_send_log_bind_tenant
  BEFORE INSERT ON public.email_send_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_email_send_log_bind_tenant();

WITH resolved AS (
  SELECT l.id,
         public.email_send_log_tenant_for_address(l.recipient_email) AS tenant_id
    FROM public.email_send_log l
   WHERE l.tenant_id IS NULL
)
UPDATE public.email_send_log AS l
   SET tenant_id = r.tenant_id
  FROM resolved r
 WHERE r.id = l.id
   AND r.tenant_id IS NOT NULL;

UPDATE public.auth_email_events AS e
   SET tenant_id = l.tenant_id
  FROM public.email_send_log AS l
 WHERE e.message_id = l.message_id
   AND l.tenant_id IS NOT NULL
   AND e.tenant_id IS NULL;

COMMENT ON COLUMN public.email_send_log.tenant_id IS
  'Najemca, do ktorego nalezy wpis dziennika. JEST predykatem polityki email_send_log_admin_select ORAZ jawnego filtru w fetchSystemEmailReport. Wartosc podaje producent, a gdy jej nie zna - trigger email_send_log_bind_tenant kaskada po adresie odbiorcy. NULL = adres nierozstrzygalny: wiersz swiadomie niewidoczny dla rol klienckich.';