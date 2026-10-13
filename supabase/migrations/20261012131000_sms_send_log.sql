-- ============================================================================
-- SMS - REG-11: DZIENNIK WYSYLEK ZAMIAST LICZNIKA. „WYSLANE" DOPIERO PO
-- PRZYJECIU PRZEZ OPERATORA, PONOWIENIE PO BLEDZIE NAPRAWDE WYSYLA.
--
-- DEFEKT
--   1. `sendSms` (src/lib/notify/sms.server.ts:77-91, 107-109) pamieta klucz
--      idempotencji w liczniku `rate_limits` (zakres 'sms.once', limit 1) i
--      ZUZYWA go PRZED wywolaniem operatora. Blad HTTP, blad operatora albo
--      wyjatek sieci klucza nie oddaja. Drugie podejscie (dziennik doreczen
--      `_event_delivery_claim` przejmuje wpis 'failed' przy attempts < 3,
--      webhook platnosci jest ponawiany) dostaje `count = 2 > 1` ->
--      'duplicate', a `reminderJob.server.ts:97-101` zamienia to na 'sent'.
--      SMS nie wyszedl nigdy, a dziennik mowi „wyslane".
--   2. Okno 3 dob w kubelkach wyrownanych do epoki kontra retencja
--      `rate_limits_prune` (20261007140800:33-55, 2 doby, co godzine): klucz
--      uzyty w trzeciej dobie kubelka znika w ciagu godziny - realna ochrona
--      przed powtorka wahala sie od kilkudziesieciu minut do 2 dob.
--
-- ZMIANA
--   A. Tabela `sms_send_log`: jeden wiersz na (najemca, klucz idempotencji),
--      stan pending | sent | failed, licznik prob, kod bledu. CELOWO bez
--      numeru telefonu i bez tresci (minimalizacja danych). Tylko
--      service_role (RLS wlaczone, brak polityk klienta, brak grantow).
--   B. `sms_send_claim(najemca, klucz)` - atomowa rezerwacja przed wysylka:
--      'claimed' (nowy klucz, ponowienie po 'failed' przy attempts < 5 albo
--      przejecie wiszacego 'pending' starszego niz 10 minut przy attempts < 10),
--      'sent' (juz wyslane - dopiero teraz „duplicate" mowi prawde),
--      'in_flight' (swieza rezerwacja innego procesu), 'exhausted' (limit
--      prob). Kazda rezerwacja dostaje NOWY `claim_id`, wiec spozniony
--      wynik starszej proby nie nadpisze stanu nowszej.
--      NIEZMIENNIK: 10 minut przejecia 'pending' < 15 minut, po ktorych
--      `_event_delivery_claim` oddaje wiszace doreczenie przypomnienia - proba
--      z dziennika doreczen zawsze zastaje wiersz SMS juz do przejecia.
--   C. `sms_send_finish(najemca, claim_id, status, detail)` - zamkniecie
--      rezerwacji: 'sent' (stempel sent_at) albo 'failed' (kod bledu <= 200).
--      Tylko wiersz 'pending' z TYM claim_id.
--   D. `sms_send_log_prune(limit)` - retencja 30 dni od ostatniej zmiany
--      wiersza (partie, SKIP LOCKED) i pg_cron 'sms-send-log-prune' codziennie
--      o 03:53. 30 dni > 3 doby ponowien operatora platnosci i > 7 dni
--      najdluzszego terminu przypomnienia, wiec retencja nie zderza sie juz
--      z oknem idempotencji.
--
-- CZEGO TO NIE ZAMYKA. Blad HTTP nie dowodzi, ze SMS nie doszedl (operator
-- mogl przyjac wiadomosc i nie odpowiedziec) - ponowienie moze wtedy wyslac
-- drugi raz; ograniczaja to limit prob (5) i budzet najemcy. Awaria samego
-- dziennika (blad RPC) zostaje fail-open po stronie TS, jak dotad: awaria
-- bazy nie zabiera uczestnikowi wiadomosci o pieniadzach.
--
-- KOLEJNOSC WDROZENIA: dowolna. Nowy kod przy braku
-- funkcji (PGRST202/42883) idzie sciezka fail-open - wysyla bez dziennika,
-- jak przy awarii bramki. Stary kod nie wola nowych funkcji.
-- IDEMPOTENTNA: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP TRIGGER IF EXISTS + CREATE, CREATE OR REPLACE, bezstanowe
-- REVOKE/GRANT, wyrejestrowanie zadania pg_cron przed rejestracja.
-- DOWOD: supabase/tests/sms_send_log_test.sql,
-- src/lib/notify/__tests__/sms.server.test.ts („blad HTTP -> ponowienie
-- faktycznie wysyla").
-- ============================================================================

-- A) DZIENNIK ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 1,
  -- Identyfikator BIEZACEJ rezerwacji: zmienia sie przy kazdym przejeciu,
  -- wiec zamkniecie spoznionej proby trafia w pustke.
  claim_id uuid NOT NULL DEFAULT gen_random_uuid(),
  detail text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_send_log_key_uniq UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT sms_send_log_claim_uniq UNIQUE (claim_id),
  CONSTRAINT sms_send_log_key_len CHECK (char_length(idempotency_key) BETWEEN 8 AND 300),
  CONSTRAINT sms_send_log_status_values CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT sms_send_log_attempts_range CHECK (attempts BETWEEN 1 AND 10),
  CONSTRAINT sms_send_log_detail_len CHECK (detail IS NULL OR char_length(detail) <= 200),
  CONSTRAINT sms_send_log_sent_dated CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

-- Retencja wybiera po ostatniej zmianie wiersza.
CREATE INDEX IF NOT EXISTS sms_send_log_updated_at_idx ON public.sms_send_log (updated_at);

DROP TRIGGER IF EXISTS sms_send_log_touch_updated_at ON public.sms_send_log;
CREATE TRIGGER sms_send_log_touch_updated_at
  BEFORE UPDATE ON public.sms_send_log
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

ALTER TABLE public.sms_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_send_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sms_send_log TO service_role;

COMMENT ON TABLE public.sms_send_log IS
  'REG-11 (D12): dziennik idempotencji SMS - jeden wiersz na (tenant_id, idempotency_key), stan pending|sent|failed. „Wyslane" dopiero po przyjeciu przez operatora (sms_send_finish), ponowienie po bledzie przejmuje wiersz (sms_send_claim). Bez numeru i tresci. Retencja 30 dni (sms_send_log_prune). Tylko service_role.';
COMMENT ON COLUMN public.sms_send_log.claim_id IS
  'Identyfikator biezacej rezerwacji - nowy przy kazdym przejeciu; sms_send_finish zamyka tylko wiersz pending z tym claim_id.';

-- B) REZERWACJA PRZED WYSYLKA --------------------------------------------------------
-- LOCKS: sms_send_log (INSERT ... ON CONFLICT blokuje wiersz klucza).
CREATE OR REPLACE FUNCTION public.sms_send_claim(p_tenant_id uuid, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_claim uuid;
  v_status text;
  v_claimed_at timestamptz;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant is required';
  END IF;
  IF char_length(v_key) NOT BETWEEN 8 AND 300 THEN
    RAISE EXCEPTION 'invalid_payload: idempotency key must have 8 to 300 characters';
  END IF;

  -- Jedno zapytanie rozstrzyga wyscig dwoch procesow z tym samym kluczem:
  -- drugi czeka na zatwierdzenie pierwszego i widzi jego swiezy 'pending'.
  INSERT INTO public.sms_send_log AS l (tenant_id, idempotency_key)
  VALUES (p_tenant_id, v_key)
  ON CONFLICT ON CONSTRAINT sms_send_log_key_uniq DO UPDATE
     SET status = 'pending',
         attempts = l.attempts + 1,
         claim_id = gen_random_uuid(),
         claimed_at = now(),
         detail = NULL
   WHERE (l.status = 'failed' AND l.attempts < 5)
      OR (l.status = 'pending' AND l.claimed_at < now() - interval '10 minutes' AND l.attempts < 10)
  RETURNING l.claim_id INTO v_claim;

  IF v_claim IS NOT NULL THEN
    RETURN jsonb_build_object('claim_id', v_claim, 'state', 'claimed');
  END IF;

  SELECT l.status, l.claimed_at INTO v_status, v_claimed_at
    FROM public.sms_send_log l
   WHERE l.tenant_id = p_tenant_id AND l.idempotency_key = v_key;

  RETURN jsonb_build_object(
    'claim_id', NULL,
    'state', CASE
      WHEN v_status = 'sent' THEN 'sent'
      -- Wiersz zniknal miedzy zapytaniami (retencja) albo rezerwacja jest
      -- swieza: nie wysylamy, wolajacy sprobuje pozniej.
      WHEN v_status IS NULL THEN 'in_flight'
      WHEN v_status = 'pending' AND v_claimed_at >= now() - interval '10 minutes' THEN 'in_flight'
      ELSE 'exhausted'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sms_send_claim(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_send_claim(uuid, text) TO service_role;

COMMENT ON FUNCTION public.sms_send_claim(uuid, text) IS
  'REG-11: rezerwacja klucza idempotencji SMS przed wysylka. {claim_id, state}: claimed (nowy klucz, ponowienie po failed przy attempts < 5, przejecie pending starszego niz 10 min przy attempts < 10), sent (juz wyslane), in_flight (swieza rezerwacja), exhausted (limit prob). Najemca i klucz z serwera. Tylko service_role.';

-- C) ZAMKNIECIE REZERWACJI -------------------------------------------------------------
-- LOCKS: sms_send_log (UPDATE jednego wiersza po claim_id).
CREATE OR REPLACE FUNCTION public.sms_send_finish(
  p_tenant_id uuid,
  p_claim_id uuid,
  p_status text,
  p_detail text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'invalid_status: status must be sent or failed';
  END IF;
  IF p_tenant_id IS NULL OR p_claim_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and claim are required';
  END IF;

  UPDATE public.sms_send_log l
     SET status = p_status,
         sent_at = CASE WHEN p_status = 'sent' THEN now() END,
         -- Kod bledu jest diagnostyka, nie trescia - przyciecie nie gubi
         -- niczego, co uczestnik napisal.
         detail = left(NULLIF(btrim(COALESCE(p_detail, '')), ''), 200)
   WHERE l.tenant_id = p_tenant_id
     AND l.claim_id = p_claim_id
     AND l.status = 'pending';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.sms_send_finish(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_send_finish(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.sms_send_finish(uuid, uuid, text, text) IS
  'REG-11: zamkniecie rezerwacji SMS - sent (sent_at = now()) albo failed (detail <= 200). Tylko wiersz pending najemcy z biezacym claim_id; inaczej false (spozniona albo obca proba). Tylko service_role.';

-- D) RETENCJA -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sms_send_log_prune(p_limit integer DEFAULT 50000)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50000), 1), 500000);
  v_deleted integer;
BEGIN
  WITH doomed AS (
    SELECT l.id FROM public.sms_send_log l
     WHERE l.updated_at < now() - interval '30 days'
     ORDER BY l.updated_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.sms_send_log l
   USING doomed d
   WHERE l.id = d.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.sms_send_log_prune(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_send_log_prune(integer) TO service_role;

COMMENT ON FUNCTION public.sms_send_log_prune(integer) IS
  'REG-11: retencja dziennika SMS - kasuje partiami (najstarsze najpierw, SKIP LOCKED) wiersze bez zmian od 30 dni. p_limit 1..500000, domyslnie 50000. Codziennie z pg_cron (sms-send-log-prune, 03:53), gdy rozszerzenie jest dostepne; inaczej na zadanie (service_role).';

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable - sms_send_log retention runs only on demand';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('sms-send-log-prune');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule('sms-send-log-prune', '53 3 * * *', $job$SELECT public.sms_send_log_prune(50000)$job$);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sms_send_log: scheduling retention job failed (%)', SQLERRM;
END $$;
