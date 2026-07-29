-- 1) Rejestr zgód CRM zawiera PII (e-mail, IP, user agent) i nie jest
--    konsumowany przez żaden kanał realtime w aplikacji.
ALTER PUBLICATION supabase_realtime DROP TABLE public.crm_consent_log;

-- 2) domain_events musi zostać w realtime (strumień zdarzeń UI), ale jego
--    generyczny payload nie może nigdy przenosić PII. Sanityzacja przy zapisie.
CREATE OR REPLACE FUNCTION public.domain_events_redact_payload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sensitive_keys text[] := ARRAY[
    'email','emails','email_address','recipient_email','phone','phone_norm',
    'ip','ip_address','user_agent','useragent','token','access_token',
    'refresh_token','password','password_hash','secret','api_key','address',
    'street','postal_code','body','message_body','content','note','notes'
  ];
  k text;
BEGIN
  IF NEW.payload IS NULL OR jsonb_typeof(NEW.payload) <> 'object' THEN
    RETURN NEW;
  END IF;

  FOREACH k IN ARRAY sensitive_keys LOOP
    IF NEW.payload ? k THEN
      NEW.payload := NEW.payload - k;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS domain_events_redact_payload_trg ON public.domain_events;
CREATE TRIGGER domain_events_redact_payload_trg
  BEFORE INSERT OR UPDATE ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.domain_events_redact_payload();