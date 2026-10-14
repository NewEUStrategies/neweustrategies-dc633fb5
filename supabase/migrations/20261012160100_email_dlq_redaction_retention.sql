-- ============================================================================
-- KOLEJKI MARTWYCH LISTOW POCZTY (DLQ): BEZ TRESCI MAILA I Z RETENCJA 30 DNI
-- (REG-17, B7).
--
-- DEFEKT. `move_to_dlq` (20260728154925_email_infra.sql:172-199, granty
-- 20261007140000:45-46) kopiowal do `transactional_emails_dlq`
-- i `auth_emails_dlq` CALY ladunek kolejki: wyrenderowany `html` i `text`
-- (kod wejscia z biletu i link `#t=..&m=..`, link samoobslugi, link resetu
-- hasla i magic link z poczty autoryzacyjnej) oraz `unsubscribe_token`.
-- Nikt tych kolejek nie czyta (brak ponowien; `email_queue_depth` liczy tylko
-- wiersze) i nic ich nie czysci - poswiadczenia lezaly w bazie bez konca,
-- w kazdej kopii zapasowej i w kazdym zrzucie.
--
-- ZMIANA:
--   * `_email_dlq_redact(wiadomosc, chwila)` - ladunek bez `html`, `text`
--     i `unsubscribe_token`, z `redacted: true` i `dlq_at` (chwila wejscia do
--     DLQ). Zostaje to, czego potrzebuje operator: adresat, temat, etykieta,
--     najemca, `message_id` (przyczyne trzyma `email_send_log`). Ladunek, ktory
--     nie jest obiektem, zostaje zastapiony w calosci.
--   * `move_to_dlq` - to samo cialo, ale do DLQ idzie ladunek po redakcji.
--   * `email_dlq_prune(wiek, limit)` - przeglada obie DLQ wylacznie przez API
--     pgmq (read/send/delete): wiadomosc starsza niz `wiek` (domyslnie 30 dni,
--     liczony od `dlq_at`, a bez niego od `enqueued_at`) kasuje, wiadomosc
--     z trescia (zaleglosc sprzed tej migracji) redaguje, zachowujac jej wiek.
--     Kolejka, ktorej nie ma, jest pomijana. TYLKO `service_role`.
--   * jednorazowe sprzatanie zaleglosci w tej migracji (blad = WARNING, nie
--     przerwanie migracji) i pg_cron 'email-dlq-prune' codziennie o 3:37
--     (minuta wolna w harmonogramie repo), gdy rozszerzenie jest dostepne.
--
-- CZEGO TO NIE ZAMYKA. Kolejki glowne nadal niosa pelna tresc do chwili
-- wysylki albo przeniesienia do DLQ (TTL drenu 60 min) - bez tresci mail nie
-- wyjdzie. Kasowanie w pgmq zostawia krotki do VACUUM. Retencja po stronie
-- dostawcy poczty jest poza baza.
--
-- KOLEJNOSC WDROZENIA: dowolna (zaden kod nie czyta tresci z DLQ).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, sprzatanie
-- zaleglosci powtorzone nie znajduje nic do zrobienia, wyrejestrowanie
-- zadania pg_cron przed rejestracja.
-- DOWOD: supabase/tests/email_dlq_redaction_test.sql.
-- ============================================================================

-- A) REDAKCJA ---------------------------------------------------------------------
-- STABLE, nie IMMUTABLE: `to_jsonb(timestamptz)` zalezy od strefy sesji.
CREATE OR REPLACE FUNCTION public._email_dlq_redact(p_message jsonb, p_dlq_at timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_message) = 'object'
      THEN (p_message - 'html' - 'text' - 'unsubscribe_token')
    ELSE '{}'::jsonb
  END || jsonb_build_object('redacted', true, 'dlq_at', to_jsonb(COALESCE(p_dlq_at, now())));
$$;
REVOKE ALL ON FUNCTION public._email_dlq_redact(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_dlq_redact(jsonb, timestamptz) TO service_role;

COMMENT ON FUNCTION public._email_dlq_redact(jsonb, timestamptz) IS
  'REG-17: ladunek wiadomosci do DLQ poczty bez html, text i unsubscribe_token (kody wejscia, linki samoobslugi i autoryzacji), z redacted=true i dlq_at. Ladunek nie-obiekt zastapiony w calosci. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- B) PRZENIESIENIE DO DLQ --------------------------------------------------------
-- Cialo z 20260728154925_email_infra.sql:172-199 (search_path z ALTER
-- w 20260729062739). Jedyna zmiana: wysylany ladunek.
CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pgmq, extensions, pg_temp
AS $$
DECLARE
  new_id BIGINT;
  -- ZMIANA 20261012 (REG-17): DLQ nigdy nie trzyma tresci maila.
  v_redacted JSONB := public._email_dlq_redact(payload, now());
BEGIN
  SELECT pgmq.send(dlq_name, v_redacted) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, v_redacted) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;

COMMENT ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) IS
  'Przeniesienie wiadomosci z kolejki poczty do jej DLQ: do DLQ idzie ladunek po _email_dlq_redact (bez html, text, unsubscribe_token; redacted, dlq_at), zrodlo kasowane. Tylko service_role (dren poczty). Retencja: email_dlq_prune.';

-- C) RETENCJA I REDAKCJA ZALEGLOSCI ------------------------------------------------
-- Wylacznie API pgmq (read/send/delete) - bez nazw tabel `pgmq.q_*`, ktore sa
-- szczegolem wersji rozszerzenia.
--
-- POSTEP PETLI. Prawdziwe `pgmq.read(q, 300, n)` ukrywa przeczytane
-- wiadomosci na 300 s, wiec kolejne partie ida dalej. Petla nie polega
-- jednak tylko na tym: liczy NOWE identyfikatory i konczy, gdy partia nie
-- przyniosla zadnego (implementacja bez ukrywania - albo wiadomosc oddana
-- drugi raz - nie zapetla przebiegu), a budzet `p_limit` ogranicza liczbe
-- przejrzanych wiadomosci.
--
-- WIEK. `dlq_at` z ladunku (ustawia go `move_to_dlq`), bez niego - albo gdy
-- nie jest data - `enqueued_at`. Redagowana zaleglosc wraca do kolejki
-- z `dlq_at` = swoj dotychczasowy wiek, wiec ponowne wyslanie jej nie
-- odmladza.
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
             OR v_msg.message ?| ARRAY['html', 'text', 'unsubscribe_token'] THEN
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
  'REG-17: retencja DLQ poczty (transactional_emails_dlq, auth_emails_dlq) przez API pgmq: wiadomosc starsza niz p_max_age (domyslnie 30 dni; wiek z dlq_at, inaczej enqueued_at) kasowana, wiadomosc z trescia (html/text/unsubscribe_token) redagowana przez _email_dlq_redact z zachowaniem wieku. p_limit = budzet przejrzanych wiadomosci (1..200000). Wynik {ok, scanned, deleted, redacted, skipped}; bez pgmq {ok:false, error:pgmq_unavailable}. Codziennie z pg_cron (email-dlq-prune, 3:37), gdy rozszerzenie jest dostepne. Tylko service_role.';

-- D) JEDNORAZOWE SPRZATANIE ZALEGLOSCI -------------------------------------------
-- Tresci, ktore przez dotychczasowe `move_to_dlq` juz trafily do DLQ. Wiekszy
-- budzet niz w zadaniu dziennym: zaleglosc to wszystkie porazki od poczatku
-- kolejek. Awaria nie przerywa migracji - zadanie dzienne dokonczy.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.email_dlq_prune(interval '30 days', 100000);
  RAISE NOTICE 'email DLQ backlog: %', v_result;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email DLQ: backlog redaction failed (%)', SQLERRM;
END $$;

-- E) ZADANIE DZIENNE ----------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable - email DLQ retention runs only on demand';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('email-dlq-prune');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule('email-dlq-prune', '37 3 * * *',
    $job$SELECT public.email_dlq_prune(interval '30 days', 20000)$job$);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email DLQ: scheduling retention job failed (%)', SQLERRM;
END $$;
