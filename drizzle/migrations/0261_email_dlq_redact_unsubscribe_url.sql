CREATE OR REPLACE FUNCTION public._email_dlq_redact(p_message jsonb, p_dlq_at timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_message) = 'object'
      THEN (p_message - 'html' - 'text' - 'unsubscribe_token' - 'unsubscribe_url')
    ELSE '{}'::jsonb
  END || jsonb_build_object('redacted', true, 'dlq_at', to_jsonb(COALESCE(p_dlq_at, now())));
$$;
REVOKE ALL ON FUNCTION public._email_dlq_redact(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_dlq_redact(jsonb, timestamptz) TO service_role;

COMMENT ON FUNCTION public._email_dlq_redact(jsonb, timestamptz) IS
  'REG-17 (przeglad R67): ladunek wiadomosci do DLQ poczty bez html, text, unsubscribe_token i unsubscribe_url (kody wejscia, linki samoobslugi, autoryzacji i wypisu), z redacted=true i dlq_at. Ladunek nie-obiekt zastapiony w calosci. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public.email_dlq_prune(
  p_max_age interval DEFAULT interval '30 days',
  p_limit integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max_age interval := COALESCE(p_max_age, interval '30 days');
  v_budget integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 200000);
  v_queue text;
  v_msg record;
  v_seen bigint[];
  v_new integer;
  v_at timestamptz;
  v_scanned integer := 0;
  v_deleted integer := 0;
  v_redacted integer := 0;
  v_skipped text[] := ARRAY[]::text[];
BEGIN
  IF v_max_age <= interval '0' THEN
    RAISE EXCEPTION 'invalid_payload: retention age must be positive';
  END IF;
  IF to_regnamespace('pgmq') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pgmq_unavailable');
  END IF;

  FOREACH v_queue IN ARRAY ARRAY['transactional_emails_dlq', 'auth_emails_dlq'] LOOP
    v_seen := ARRAY[]::bigint[];
    BEGIN
      LOOP
        EXIT WHEN v_scanned >= v_budget;
        v_new := 0;
        FOR v_msg IN
          SELECT q.msg_id, q.enqueued_at, q.message
            FROM pgmq.read(v_queue, 300, LEAST(100, v_budget - v_scanned)) q
        LOOP
          CONTINUE WHEN v_msg.msg_id = ANY (v_seen);
          v_seen := v_seen || v_msg.msg_id;
          v_new := v_new + 1;
          v_scanned := v_scanned + 1;

          v_at := NULL;
          IF jsonb_typeof(v_msg.message) = 'object' AND v_msg.message ? 'dlq_at' THEN
            BEGIN
              v_at := (v_msg.message->>'dlq_at')::timestamptz;
            EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow
                        OR invalid_text_representation OR invalid_parameter_value THEN
              v_at := NULL;
            END;
          END IF;
          v_at := COALESCE(v_at, v_msg.enqueued_at, now());

          IF v_at < now() - v_max_age THEN
            PERFORM pgmq.delete(v_queue, v_msg.msg_id);
            v_deleted := v_deleted + 1;
          ELSIF jsonb_typeof(v_msg.message) IS DISTINCT FROM 'object'
             OR v_msg.message ?| ARRAY['html', 'text', 'unsubscribe_token', 'unsubscribe_url'] THEN
            PERFORM pgmq.send(v_queue, public._email_dlq_redact(v_msg.message, v_at), 0);
            PERFORM pgmq.delete(v_queue, v_msg.msg_id);
            v_redacted := v_redacted + 1;
          END IF;
        END LOOP;
        EXIT WHEN v_new = 0;
      END LOOP;
    EXCEPTION WHEN undefined_table OR undefined_function THEN
      v_skipped := v_skipped || v_queue;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'scanned', v_scanned,
    'deleted', v_deleted,
    'redacted', v_redacted,
    'skipped', to_jsonb(v_skipped)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.email_dlq_prune(interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_dlq_prune(interval, integer) TO service_role;

COMMENT ON FUNCTION public.email_dlq_prune(interval, integer) IS
  'REG-17 (przeglad R67): retencja DLQ poczty (transactional_emails_dlq, auth_emails_dlq) przez API pgmq: wiadomosc starsza niz p_max_age (domyslnie 30 dni; wiek z dlq_at, inaczej enqueued_at) kasowana, wiadomosc z trescia (html/text/unsubscribe_token/unsubscribe_url) redagowana przez _email_dlq_redact z zachowaniem wieku. p_limit = budzet przejrzanych wiadomosci (1..200000). Wynik {ok, scanned, deleted, redacted, skipped}; bez pgmq {ok:false, error:pgmq_unavailable}. Codziennie z pg_cron (email-dlq-prune, 3:37), gdy rozszerzenie jest dostepne. Tylko service_role.';

DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.email_dlq_prune(interval '30 days', 100000);
  RAISE NOTICE 'email DLQ backlog (unsubscribe_url): %', v_result;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email DLQ: backlog redaction failed (%)', SQLERRM;
END $$;