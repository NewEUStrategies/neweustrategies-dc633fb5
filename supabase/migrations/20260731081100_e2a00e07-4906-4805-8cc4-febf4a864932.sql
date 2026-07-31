-- Kanonizacja list wykluczeń e-mail (PR #111 / plik 20260731120000_email_suppression_unification.sql)

CREATE OR REPLACE FUNCTION public.email_default_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    (SELECT t.id FROM public.tenants t WHERE t.is_default LIMIT 1),
    (SELECT t.id FROM public.tenants t WHERE (SELECT count(*) FROM public.tenants) = 1 LIMIT 1)
  );
$fn$;
REVOKE ALL ON FUNCTION public.email_default_tenant_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_default_tenant_id() TO service_role;

CREATE OR REPLACE FUNCTION public.email_resolve_tenant_for_address(p_email text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_tenant uuid;
  v_count integer;
BEGIN
  IF v_email = '' THEN
    RETURN public.email_default_tenant_id();
  END IF;
  SELECT count(DISTINCT ns.tenant_id) INTO v_count FROM public.newsletter_subscribers ns WHERE lower(ns.email) = v_email;
  IF v_count = 1 THEN
    SELECT DISTINCT ns.tenant_id INTO v_tenant FROM public.newsletter_subscribers ns WHERE lower(ns.email) = v_email;
    RETURN v_tenant;
  END IF;
  SELECT count(DISTINCT p.tenant_id) INTO v_count FROM public.profiles p WHERE lower(p.email) = v_email AND p.tenant_id IS NOT NULL;
  IF v_count = 1 THEN
    SELECT DISTINCT p.tenant_id INTO v_tenant FROM public.profiles p WHERE lower(p.email) = v_email AND p.tenant_id IS NOT NULL;
    RETURN v_tenant;
  END IF;
  RETURN public.email_default_tenant_id();
END;
$fn$;
COMMENT ON FUNCTION public.email_resolve_tenant_for_address(text) IS
  'Tenant dla adresu e-mail poza kontekstem zadania (wypis, webhook, mail transakcyjny): jednoznaczny subskrybent -> jednoznaczne konto -> tenant domyslny.';
REVOKE ALL ON FUNCTION public.email_resolve_tenant_for_address(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_resolve_tenant_for_address(text) TO service_role;

DO $mig$
DECLARE
  v_moved integer := 0;
BEGIN
  IF to_regclass('public.suppressed_emails') IS NULL THEN
    RAISE NOTICE 'suppressed_emails nie istnieje - nie ma czego przenosic.';
    RETURN;
  END IF;
  IF (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.suppressed_emails'::regclass) <> 'r' THEN
    RAISE NOTICE 'suppressed_emails jest juz widokiem zgodnosci - przenoszenie pominiete.';
    RETURN;
  END IF;

  INSERT INTO public.email_suppressions (
    tenant_id, email, reason, scope, source, provider, diagnostic,
    first_seen_at, last_seen_at, meta
  )
  SELECT
    public.email_resolve_tenant_for_address(se.email),
    lower(btrim(se.email)),
    CASE se.reason
      WHEN 'complaint'   THEN 'complaint'
      WHEN 'bounce'      THEN 'hard_bounce'
      WHEN 'unsubscribe' THEN 'unsubscribe'
      ELSE 'manual'
    END,
    'permanent',
    'import',
    'resend',
    'migracja 20260731120000: przeniesienie z suppressed_emails',
    se.created_at,
    se.created_at,
    jsonb_build_object('legacy_table', 'suppressed_emails', 'legacy_reason', se.reason)
      || COALESCE(se.metadata, '{}'::jsonb)
  FROM public.suppressed_emails se
  WHERE lower(btrim(se.email)) <> ''
    AND position('@' in se.email) > 0
    AND public.email_resolve_tenant_for_address(se.email) IS NOT NULL
  ON CONFLICT (tenant_id, email_norm) DO NOTHING;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'Przeniesiono % adresow z suppressed_emails do email_suppressions.', v_moved;

  EXECUTE 'CREATE TABLE IF NOT EXISTS public.suppressed_emails_legacy_backup AS TABLE public.suppressed_emails';
  EXECUTE 'ALTER TABLE public.suppressed_emails_legacy_backup ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON public.suppressed_emails_legacy_backup FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT ALL ON public.suppressed_emails_legacy_backup TO service_role';
  EXECUTE 'DROP TABLE public.suppressed_emails';
END $mig$;

COMMENT ON TABLE public.email_suppressions IS
  'JEDYNA lista adresow wykluczonych z wysylki (bounce/complaint/unsubscribe/manual), wspolna dla kampanii, poczty transakcyjnej, digestow i wypisow. Aktywna blokada = released_at IS NULL AND (expires_at IS NULL OR expires_at > now()).';

CREATE OR REPLACE VIEW public.suppressed_emails WITH (security_invoker = true) AS
  SELECT
    es.id,
    es.email_norm AS email,
    CASE
      WHEN es.reason = 'complaint' THEN 'complaint'
      WHEN es.reason = 'unsubscribe' THEN 'unsubscribe'
      ELSE 'bounce'
    END AS reason,
    es.meta AS metadata,
    es.created_at
  FROM public.email_suppressions es
  WHERE es.released_at IS NULL
    AND (es.expires_at IS NULL OR es.expires_at > now());

COMMENT ON VIEW public.suppressed_emails IS
  'PRZESTARZALE - widok zgodnosci nad public.email_suppressions (migracja 20260731120000). Nowy kod uzywa email_suppressions / email_record_suppression / email_filter_suppressed.';
REVOKE ALL ON public.suppressed_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppressed_emails TO service_role;

CREATE OR REPLACE FUNCTION public.tg_suppressed_emails_compat_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_email text;
  v_reason text;
  v_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.email_suppressions
       SET released_at = now(), expires_at = now()
     WHERE email_norm = lower(btrim(OLD.email)) AND released_at IS NULL;
    RETURN OLD;
  END IF;

  v_email := lower(btrim(COALESCE(NEW.email, '')));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  v_reason := CASE COALESCE(NEW.reason, 'bounce')
    WHEN 'bounce'      THEN 'hard_bounce'
    WHEN 'complaint'   THEN 'complaint'
    WHEN 'unsubscribe' THEN 'unsubscribe'
    ELSE 'manual'
  END;

  v_tenant := public.email_resolve_tenant_for_address(v_email);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no_tenant_for_address' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.email_record_suppression(
    p_tenant => v_tenant,
    p_email => v_email,
    p_reason => v_reason,
    p_source => 'system',
    p_provider => 'compat',
    p_meta => jsonb_build_object('via', 'suppressed_emails_view') || COALESCE(NEW.metadata, '{}'::jsonb)
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS suppressed_emails_compat_insert ON public.suppressed_emails;
CREATE TRIGGER suppressed_emails_compat_insert
  INSTEAD OF INSERT ON public.suppressed_emails
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppressed_emails_compat_write();

DROP TRIGGER IF EXISTS suppressed_emails_compat_update ON public.suppressed_emails;
CREATE TRIGGER suppressed_emails_compat_update
  INSTEAD OF UPDATE ON public.suppressed_emails
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppressed_emails_compat_write();

DROP TRIGGER IF EXISTS suppressed_emails_compat_delete ON public.suppressed_emails;
CREATE TRIGGER suppressed_emails_compat_delete
  INSTEAD OF DELETE ON public.suppressed_emails
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppressed_emails_compat_write();

CREATE OR REPLACE FUNCTION public.email_unsubscribe_by_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_email text;
  v_tenant uuid;
  v_claimed boolean := false;
BEGIN
  IF v_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_token');
  END IF;

  UPDATE public.email_unsubscribe_tokens
     SET used_at = now()
   WHERE token = v_token AND used_at IS NULL
   RETURNING lower(btrim(email)) INTO v_email;
  v_claimed := v_email IS NOT NULL;

  IF NOT v_claimed THEN
    SELECT lower(btrim(email)) INTO v_email FROM public.email_unsubscribe_tokens WHERE token = v_token;
  END IF;

  IF v_email IS NULL THEN
    SELECT lower(btrim(ns.email)), ns.tenant_id INTO v_email, v_tenant
      FROM public.newsletter_subscribers ns
     WHERE ns.unsubscribe_token = v_token
     LIMIT 1;
    v_claimed := v_email IS NOT NULL;
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_token');
  END IF;

  v_tenant := COALESCE(v_tenant, public.email_resolve_tenant_for_address(v_email));
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tenant');
  END IF;

  PERFORM public.email_record_suppression(
    p_tenant => v_tenant,
    p_email => v_email,
    p_reason => 'unsubscribe',
    p_source => 'system',
    p_provider => 'self_service',
    p_meta => jsonb_build_object('channel', 'unsubscribe_link')
  );

  RETURN jsonb_build_object('ok', true, 'already_unsubscribed', NOT v_claimed, 'tenant_id', v_tenant);
END;
$fn$;
COMMENT ON FUNCTION public.email_unsubscribe_by_token(text) IS
  'Wypis jednym klikniecim: zuzywa token (globalny lub per subskrybent), stawia blokade unsubscribe na liscie kanonicznej i - przez trigger - zdejmuje subskrypcje. Idempotentny.';
REVOKE ALL ON FUNCTION public.email_unsubscribe_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe_by_token(text) TO service_role;

ALTER TABLE public.job_runner_settings ALTER COLUMN enabled SET DEFAULT true;
ALTER TABLE public.job_runner_settings
  ADD COLUMN IF NOT EXISTS last_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_tick_status text,
  ADD COLUMN IF NOT EXISTS last_tick_error text,
  ADD COLUMN IF NOT EXISTS tick_count bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.job_runner_settings.enabled IS
  'Kill switch runnera zadan tla. Domyslnie WLACZONY - dren kolejki pocztowej i wysylka zaplanowana nie moga zalezec od recznego przelaczenia.';
COMMENT ON COLUMN public.job_runner_settings.base_url IS
  'Nadpisanie publicznego adresu aplikacji. Puste = wyliczany z domeny tenanta domyslnego (job_runner_base_url()).';
COMMENT ON COLUMN public.job_runner_settings.last_tick_at IS
  'Moment ostatniego ticku wyslanego przez cron - dowod, ze automat zyje.';

UPDATE public.job_runner_settings
   SET enabled = true
 WHERE id = 1 AND enabled = false AND COALESCE(btrim(base_url), '') = '';

INSERT INTO public.job_runner_settings (id, enabled) VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.job_runner_base_url()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    NULLIF(btrim((SELECT s.base_url FROM public.job_runner_settings s WHERE s.id = 1)), ''),
    (SELECT 'https://' || t.domain FROM public.tenants t
      WHERE t.is_default AND COALESCE(btrim(t.domain), '') <> '' LIMIT 1),
    (SELECT 'https://' || t.domain FROM public.tenants t
      WHERE COALESCE(btrim(t.domain), '') <> '' AND (SELECT count(*) FROM public.tenants) = 1 LIMIT 1)
  );
$fn$;
REVOKE ALL ON FUNCTION public.job_runner_base_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_runner_base_url() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_jobs_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg record;
  v_url text;
BEGIN
  SELECT enabled, secret INTO cfg FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled THEN
    RETURN;
  END IF;

  v_url := public.job_runner_base_url();
  IF COALESCE(btrim(v_url), '') = '' THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(), last_tick_status = 'skipped', last_tick_error = 'no_base_url'
     WHERE id = 1;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(), last_tick_status = 'skipped', last_tick_error = 'pg_net_unavailable'
     WHERE id = 1;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/api/public/jobs-tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', cfg.secret),
    timeout_milliseconds := 25000
  );

  UPDATE public.job_runner_settings
     SET last_tick_at = now(), last_tick_status = 'dispatched', last_tick_error = NULL,
         tick_count = tick_count + 1
   WHERE id = 1;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(), last_tick_status = 'error', last_tick_error = left(SQLERRM, 500)
     WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_jobs_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_jobs_tick() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostepny - jobs-tick nie zostanie zaplanowany.';
    RETURN;
  END IF;
  PERFORM cron.schedule('jobs-tick', '* * * * *', 'SELECT public.invoke_jobs_tick()');
END $$;

CREATE OR REPLACE FUNCTION public.email_queue_depth()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_queue text;
  v_len bigint;
BEGIN
  IF to_regnamespace('pgmq') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pgmq_unavailable');
  END IF;
  FOREACH v_queue IN ARRAY ARRAY['auth_emails', 'transactional_emails', 'auth_emails_dlq', 'transactional_emails_dlq'] LOOP
    BEGIN
      SELECT m.queue_length INTO v_len FROM pgmq.metrics(v_queue) m;
      v_out := v_out || jsonb_build_object(v_queue, COALESCE(v_len, 0));
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object(v_queue, 0);
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'queues', v_out);
END;
$fn$;
REVOKE ALL ON FUNCTION public.email_queue_depth() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_depth() TO service_role;

CREATE INDEX IF NOT EXISTS email_send_log_message_status_idx
  ON public.email_send_log (message_id, status);