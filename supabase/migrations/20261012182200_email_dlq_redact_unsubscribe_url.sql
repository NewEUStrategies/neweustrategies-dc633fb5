-- ============================================================================
-- KOLEJKI MARTWYCH LISTOW POCZTY (DLQ): REDAKCJA TAKZE `unsubscribe_url`
-- (przeglad R67, REG-17).
--
-- DEFEKT. `_email_dlq_redact` (20261012160100:44-55) usuwal z ladunku DLQ
-- `html`, `text` i `unsubscribe_token`, a zaleglosc w `email_dlq_prune`
-- (20261012160100:93-185) rozpoznawal po tych samych trzech kluczach.
-- `enqueueRawEmail` (src/lib/email/transactional.server.ts) zapisuje jednak
-- w ladunku takze `unsubscribe_url` - adres wypisu z newslettera z kluczem
-- `?token=` w zapytaniu. Po porazce wysylki ten klucz lezal w DLQ przez 30
-- dni (dowod przegladu: `{redacted: true, unsubscribe_url:
-- 'https://x/api/public/newsletter/unsubscribe?token=NEWSLETTER-SECRET'}`).
-- Dzis zaden wolajacy nie przekazuje `unsubscribeUrl`, wiec defekt jest
-- uspiony - ale to wlasnie poswiadczenie, ktorego DLQ ma nie trzymac.
--
-- ZMIANA
--   * `_email_dlq_redact` - ladunek bez `html`, `text`, `unsubscribe_token`
--     I `unsubscribe_url`; reszta bez zmian (redacted, dlq_at).
--   * `email_dlq_prune` - zaleglosc rozpoznawana takze po `unsubscribe_url`
--     (wiadomosc juz zredagowana starym cialem, ale z adresem wypisu, wraca do
--     kolejki bez niego, z zachowaniem wieku). Reszta ciala bez zmian.
--   * jednorazowe sprzatanie zaleglosci (jak w 20261012160100; blad =
--     WARNING). Zadanie pg_cron `email-dlq-prune` wola te sama funkcje - nie
--     wymaga zmiany.
--
-- CZEGO TO NIE ZAMYKA. Kolejki glowne nadal niosa adres wypisu do chwili
-- wysylki (bez niego mail nie ma linku wypisu).
--
-- KOLEJNOSC WDROZENIA: dowolna (zaden kod nie czyta tresci z DLQ).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, sprzatanie
-- powtorzone nie znajduje nic do zrobienia.
-- DOWOD: supabase/tests/event_sms_scanner_r67_test.sql (sekcja DLQ).
-- ============================================================================

-- A) REDAKCJA ---------------------------------------------------------------------
-- Cialo z 20261012160100:44-55. ZMIANA 20261012 (R67): `- 'unsubscribe_url'`.
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

-- B) RETENCJA I REDAKCJA ZALEGLOSCI ------------------------------------------------
-- Cialo z 20261012160100:93-185. ZMIANA 20261012 (R67): zaleglosc to takze
-- wiadomosc z `unsubscribe_url`.
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
             -- ZMIANA 20261012 (R67): adres wypisu z kluczem tez jest trescia.
             OR v_msg.message ?| ARRAY['html', 'text', 'unsubscribe_token', 'unsubscribe_url'] THEN
            PERFORM pgmq.send(v_queue, public._email_dlq_redact(v_msg.message, v_at), 0);
            PERFORM pgmq.delete(v_queue, v_msg.msg_id);
            v_redacted := v_redacted + 1;
          END IF;
        END LOOP;
        EXIT WHEN v_new = 0;
      END LOOP;
    EXCEPTION WHEN undefined_table OR undefined_function THEN
      -- Kolejki nie ma (nigdy nic do niej nie trafilo) - nie ma czego czyscic.
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

-- C) JEDNORAZOWE SPRZATANIE ZALEGLOSCI -------------------------------------------
-- Wiadomosci zredagowane starym cialem, ktore zachowaly `unsubscribe_url`.
-- Awaria nie przerywa migracji - zadanie dzienne dokonczy.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.email_dlq_prune(interval '30 days', 100000);
  RAISE NOTICE 'email DLQ backlog (unsubscribe_url): %', v_result;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email DLQ: backlog redaction failed (%)', SQLERRM;
END $$;
