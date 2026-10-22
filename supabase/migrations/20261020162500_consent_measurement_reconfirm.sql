-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y2, 3/3): PONOWNE POTWIERDZENIE - „POPROŚ
-- O ZGODĘ NA POMIAR" (jednorazowy mail do subskrybentów ze zgodą sprzed
-- nowej wersji) I PANEL TREŚCI ZGODY („mój tekst obejmuje pomiar").
-- Decyzja właściciela 2026-10-20 („tak, uzupełnij", pkt 3 - opcjonalne,
-- ręcznie z panelu newslettera) i 2026-10-21 (wariant (a)).
--
-- DEFEKT
--   1. Subskrybenci zapisani przed Y2 mają zgodę na newsletter bez pomiaru -
--      od 20261020162400 ich maile nie mają piksela ani linków
--      z identyfikatorem, a jedyna droga do zgody z pomiarem (formularz)
--      dla istniejącego adresu zwraca `exists` bez zapisu i nie dowodzi
--      własności skrzynki.
--   2. Admin nie ma jak zaświadczyć, że WŁASNY tekst zgody informuje
--      o pomiarze - panel mógłby tylko zgadywać po słowach.
--
-- ZMIANA (DECYZJE WYKONAWCZE I9d-Y2, dziennik §21.23)
--   A. `newsletter_measurement_requests` - prośba per (subskrybent, wersja
--      treści): JEDNA na wersję (powtórny start nie dubluje), nonce linku,
--      dzierżawa wysyłki, próby (maks. 5), wynik (`queued`/`duplicate` =
--      wysłana, `suppressed` = zablokowana listą wyłączeń, `skipped` = przed
--      wysyłką zgoda udzielona innym kanałem albo wypis), kod błędu,
--      potwierdzenie. Brak reakcji = bez zmian (żadnego wpisu „nie").
--   B. Kandydaci: aktywni subskrybenci najemcy BEZ zgody na pomiar, bez
--      prośby dla bieżącej wersji, bez własnego „nie mierz" (ostatni wpis
--      `email_measurement` = „nie" - nie prosimy ponownie) i poza listą
--      wyłączeń (liczeni osobno w podglądzie).
--   C. RPC panelu (admin albo super_admin z sesji - wysyłka do całej listy):
--      podgląd liczb i start z potwierdzoną liczbą (`p_expected`; więcej
--      kandydatów niż potwierdzono = 40001 `stale_preview` - nigdy nie
--      wysyłamy do większej grupy, niż admin zatwierdził). Audyt bez adresów.
--   D. Wysyłka przez krok TS (service_role): `newsletter_measurement_claim`
--      (porcja, dzierżawa 15 min) i `newsletter_measurement_mark`. Dzienny
--      limit 200 na najemcę jest WSPÓLNY z prośbami wygaszania Y1 (ta sama
--      reputacja domeny nadawcy): `_newsletter_oneoff_mail_used` i redefinicja
--      `newsletter_sunset_claim` (ciało z 20261020162000).
--   E. Link potwierdzenia `newsletter_measurement_confirm(subskrybent, nonce)`
--      (podpis HMAC sprawdza serwer TS; nonce jednorazowy): wpis `newsletter`
--      „tak" z BIEŻĄCĄ treścią domyślną i wersją z pomiarem - wyzwalacz
--      rejestru dopisuje `email_measurement` „tak" (20261020162300).
--   F. Oznaczenie „mój tekst obejmuje pomiar": odczyt (admin/editor - edytują
--      treść) i zapis (admin) - skrót ZAPISANEGO tekstu pola liczy baza, nie
--      klient; audyt i zdarzenie `newsletter_settings.changed.v1`.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162300 (treść, wersja, rejestr, czytelnik
-- zgody) i 20261020162000 (`newsletter_sunset_claim`). Krok wysyłki TS
-- (Y2-B, jobs-tick) - po tej migracji; do tego czasu prośby czekają.
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- bezstanowe REVOKE/GRANT. Zero zmian danych.
-- DOWÓD: supabase/tests/hub_i9d_y2_reconfirm_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Prośby o zgodę na pomiar.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.newsletter_measurement_requests (
  subscriber_id uuid NOT NULL REFERENCES public.newsletter_subscribers(id) ON DELETE CASCADE,
  -- Wersja treści, o którą prosimy (`_newsletter_consent_version()`): nowa
  -- wersja = nowa prośba możliwa, ta sama - nigdy druga.
  consent_version text NOT NULL CHECK (consent_version ~ '^[a-z0-9_.:-]{1,64}$'),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nonce uuid NOT NULL DEFAULT gen_random_uuid(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_until timestamptz,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  mailed_at timestamptz,
  mail_outcome text CHECK (mail_outcome IS NULL OR mail_outcome IN ('queued', 'duplicate', 'suppressed', 'skipped')),
  -- Wyłącznie kod błędu wysyłki - nigdy tekst (mógłby cytować adres).
  last_error text CHECK (last_error IS NULL OR last_error ~ '^[a-z0-9_.:-]{1,64}$'),
  confirmed_at timestamptz,
  PRIMARY KEY (subscriber_id, consent_version),
  CONSTRAINT newsletter_measurement_requests_mailed_check CHECK ((mailed_at IS NULL) = (mail_outcome IS NULL))
);
CREATE INDEX IF NOT EXISTS newsletter_measurement_requests_tenant_idx
  ON public.newsletter_measurement_requests (tenant_id, consent_version, mailed_at);
CREATE INDEX IF NOT EXISTS newsletter_measurement_requests_pending_idx
  ON public.newsletter_measurement_requests (tenant_id, requested_at) WHERE mailed_at IS NULL;

ALTER TABLE public.newsletter_measurement_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_measurement_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_measurement_requests TO service_role;

COMMENT ON TABLE public.newsletter_measurement_requests IS
  'Zgoda i pomiar (I9d-Y2): jednorazowa prośba o zgodę na pomiar otwarć i kliknięć per (subskrybent, wersja treści) - nonce linku, dzierżawa wysyłki, próby, wynik, potwierdzenie. Tylko funkcje SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- D) Wspólny dzienny budżet jednorazowych maili do listy.
-- ----------------------------------------------------------------------------
-- Prośby wygaszania (Y1) i o zgodę na pomiar (Y2) idą do tej samej listy
-- z tej samej domeny: ich suma w 24 h (plus dzierżawy w toku) jest liczona
-- jednym budżetem. Zablokowane listą wyłączeń i pominięte - bez maila, więc
-- poza budżetem po stronie Y2 (Y1 liczy zablokowane jak dotąd).
CREATE OR REPLACE FUNCTION public._newsletter_oneoff_mail_used(p_tenant uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ((SELECT count(*) FROM public.newsletter_sunset_requests q
            WHERE q.tenant_id = p_tenant
              AND (q.mailed_at > now() - interval '24 hours' OR (q.mailed_at IS NULL AND q.claimed_until > now())))
        + (SELECT count(*) FROM public.newsletter_measurement_requests r
            WHERE r.tenant_id = p_tenant
              AND ((r.mailed_at > now() - interval '24 hours' AND r.mail_outcome IN ('queued', 'duplicate'))
                   OR (r.mailed_at IS NULL AND r.claimed_until > now()))))::integer
$$;

REVOKE ALL ON FUNCTION public._newsletter_oneoff_mail_used(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Ciało z 20261020162000; zmiana - zużycie limitu dziennego ze wspólnego
-- budżetu (prośby wygaszania + prośby o zgodę na pomiar).
-- CIALO-Z: 20261020162000
-- rpc-shape: newsletter_sunset_claim (subscriber_id, tenant_id, email, lang,
-- first_name, nonce, requested_at, delete_after, unsubscribe_token, attempt)
CREATE OR REPLACE FUNCTION public.newsletter_sunset_claim(p_limit integer DEFAULT 50)
RETURNS TABLE (
  subscriber_id uuid,
  tenant_id uuid,
  email text,
  lang text,
  first_name text,
  nonce uuid,
  requested_at timestamptz,
  delete_after timestamptz,
  unsubscribe_token text,
  attempt integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Dzienny limit jednorazowych maili do listy na najemcę - REPUTACJA
  -- DOMENY NADAWCY: prośba idzie do adresów nieaktywnych od miesięcy, więc
  -- fala tysięcy takich wiadomości jednego dnia podnosi odsetek odbić
  -- i skarg, od których zależy, czy skrzynki przyjmują CAŁĄ pocztę najemcy.
  -- Lustro TS: DATA_RETENTION_RULES.newsletterDailyCap. Od I9d-Y2 budżet
  -- wspólny z prośbami o zgodę na pomiar (`_newsletter_oneoff_mail_used`).
  c_daily_cap constant integer := 200;
  -- Lustro DATA_RETENTION_RULES.newsletterResponseDays.
  c_response_days constant integer := 30;
  -- Dzierżawa: dren nie zdążył potwierdzić wysyłki (awaria ticku) - po 15 min
  -- prośba wraca do puli; klucz idempotencji maila (nonce) nie dubluje wysyłki.
  c_lease constant interval := interval '15 minutes';
  v_left integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_tenant uuid;
  v_take integer;
  v_n integer;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT q.tenant_id FROM public.newsletter_sunset_requests q
     WHERE q.mailed_at IS NULL AND (q.claimed_until IS NULL OR q.claimed_until < now())
     ORDER BY q.tenant_id
  LOOP
    EXIT WHEN v_left <= 0;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public._data_retention_effective(v_tenant) e
                               WHERE e.category = 'newsletter_inactive' AND e.enabled AND e.enforced);
    v_take := LEAST(v_left, c_daily_cap - public._newsletter_oneoff_mail_used(v_tenant));
    CONTINUE WHEN v_take <= 0;
    RETURN QUERY
      WITH picked AS (
        SELECT q.subscriber_id AS sid FROM public.newsletter_sunset_requests q
          JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id AND s.tenant_id = q.tenant_id
         WHERE q.tenant_id = v_tenant AND q.mailed_at IS NULL
           AND (q.claimed_until IS NULL OR q.claimed_until < now())
           AND s.status IN ('subscribed', 'confirmed')
         ORDER BY q.requested_at, q.subscriber_id
         LIMIT v_take
         FOR UPDATE OF q SKIP LOCKED
      ), upd AS (
        UPDATE public.newsletter_sunset_requests q
           SET claimed_until = now() + c_lease, attempts = q.attempts + 1
          FROM picked p WHERE q.subscriber_id = p.sid
        RETURNING q.subscriber_id AS sid, q.tenant_id AS tid, q.nonce AS n, q.requested_at AS req, q.attempts AS att
      )
      SELECT u.sid, u.tid, s.email, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END, s.first_name, u.n,
             u.req, now() + make_interval(days => c_response_days), s.unsubscribe_token, u.att::integer
        FROM upd u JOIN public.newsletter_subscribers s ON s.id = u.sid
       ORDER BY u.req, u.sid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_left := v_left - v_n;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_sunset_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_sunset_claim(integer) TO service_role;

COMMENT ON FUNCTION public.newsletter_sunset_claim(integer) IS
  'Wygaszanie (I9d): porcja próśb o potwierdzenie do wysłania (najemcy z kategorią newsletter_inactive włączoną i po karencji, dzienny limit 200 na najemcę WSPÓLNY z prośbami o zgodę na pomiar - I9d-Y2, dzierżawa 15 min). Wiersz: subskrybent, najemca, adres, język (pl|en), imię, nonce, prośba, przewidywany termin usunięcia, token wypisu, próba. Tylko service_role.';

-- ----------------------------------------------------------------------------
-- B) Kandydaci do prośby (podgląd i start).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._newsletter_measurement_candidates(p_tenant uuid)
RETURNS TABLE (subscriber_id uuid, suppressed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, public.email_is_suppressed(p_tenant, s.email)
    FROM public.newsletter_subscribers s
   WHERE s.tenant_id = p_tenant AND s.status IN ('subscribed', 'confirmed')
     AND NOT EXISTS (SELECT 1 FROM public.newsletter_measurement_requests r
                      WHERE r.subscriber_id = s.id AND r.consent_version = public._newsletter_consent_version())
     AND NOT public._email_measurement_consent(p_tenant, s.email)
     -- Osoba, która sama wyłączyła pomiar, nie dostaje prośby (jej „nie"
     -- jest ostatnim słowem łańcucha pomiaru).
     AND COALESCE((SELECT c.given FROM public.crm_consent_log c
                    WHERE c.tenant_id = p_tenant AND lower(c.email) = lower(s.email)
                      AND c.consent_key = 'email_measurement'
                    ORDER BY c.created_at DESC, c.id DESC LIMIT 1), true)
   ORDER BY s.created_at, s.id
$$;

REVOKE ALL ON FUNCTION public._newsletter_measurement_candidates(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Panel: podgląd i start (admin z sesji).
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_newsletter_measurement_preview (version, enabled, subscribers,
-- with_consent, candidates, suppressed, requested, pending, mailed, blocked,
-- skipped, failed, confirmed, daily_cap, last_requested_at)
CREATE OR REPLACE FUNCTION public.admin_newsletter_measurement_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro `newsletter_measurement_claim` (limit i próby).
  c_daily_cap constant integer := 200;
  c_max_attempts constant integer := 5;
  v_tenant uuid := public._data_retention_admin_tenant();
  v_version text := public._newsletter_consent_version();
  v_c record;
  v_r record;
  v_s record;
BEGIN
  SELECT count(*) FILTER (WHERE NOT x.suppressed) AS candidates,
         count(*) FILTER (WHERE x.suppressed) AS suppressed
    INTO v_c FROM public._newsletter_measurement_candidates(v_tenant) x;
  SELECT count(*) AS requested,
         count(*) FILTER (WHERE r.mailed_at IS NULL AND r.attempts < c_max_attempts) AS pending,
         count(*) FILTER (WHERE r.mail_outcome IN ('queued', 'duplicate')) AS mailed,
         count(*) FILTER (WHERE r.mail_outcome = 'suppressed') AS blocked,
         count(*) FILTER (WHERE r.mail_outcome = 'skipped') AS skipped,
         count(*) FILTER (WHERE r.mailed_at IS NULL AND r.attempts >= c_max_attempts) AS failed,
         count(*) FILTER (WHERE r.confirmed_at IS NOT NULL) AS confirmed,
         max(r.requested_at) AS last_requested_at
    INTO v_r FROM public.newsletter_measurement_requests r
   WHERE r.tenant_id = v_tenant AND r.consent_version = v_version;
  SELECT count(*) AS subscribers,
         count(*) FILTER (WHERE public._email_measurement_consent(v_tenant, s.email)) AS with_consent
    INTO v_s FROM public.newsletter_subscribers s
   WHERE s.tenant_id = v_tenant AND s.status IN ('subscribed', 'confirmed');
  RETURN jsonb_build_object(
    'version', v_version,
    'enabled', public._newsletter_track_opens(v_tenant),
    'subscribers', v_s.subscribers, 'with_consent', v_s.with_consent,
    'candidates', v_c.candidates, 'suppressed', v_c.suppressed,
    'requested', v_r.requested, 'pending', v_r.pending, 'mailed', v_r.mailed, 'blocked', v_r.blocked,
    'skipped', v_r.skipped, 'failed', v_r.failed, 'confirmed', v_r.confirmed,
    'daily_cap', c_daily_cap, 'last_requested_at', v_r.last_requested_at);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_measurement_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_measurement_preview() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_measurement_preview() IS
  'Zgoda i pomiar (I9d-Y2): podgląd „Poproś o zgodę na pomiar" - wersja treści, przełącznik najemcy, aktywni subskrybenci, ze zgodą na pomiar, kandydaci (bez/na liście wyłączeń), stan próśb bieżącej wersji (zlecone, w kolejce, wysłane, zablokowane, pominięte, nieudane, potwierdzone), limit dzienny. Admin albo super_admin z sesji (42501).';

-- rpc-shape: admin_newsletter_measurement_request (requested, version)
CREATE OR REPLACE FUNCTION public.admin_newsletter_measurement_request(p_expected integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._data_retention_admin_tenant();
  v_version text := public._newsletter_consent_version();
  v_count integer;
  v_n integer := 0;
BEGIN
  IF p_expected IS NULL OR p_expected < 0 THEN
    RAISE EXCEPTION 'expected_invalid' USING ERRCODE = '22023';
  END IF;
  -- Jeden start naraz na najemcę (dwie karty panelu).
  PERFORM pg_advisory_xact_lock(hashtextextended('newsletter_measurement_request:' || v_tenant::text, 0));
  SELECT count(*) INTO v_count FROM public._newsletter_measurement_candidates(v_tenant) x WHERE NOT x.suppressed;
  -- Nigdy do większej grupy, niż admin zatwierdził w podglądzie.
  IF v_count > p_expected THEN
    RAISE EXCEPTION 'stale_preview' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, requested_by)
  SELECT x.subscriber_id, v_version, v_tenant, auth.uid()
    FROM public._newsletter_measurement_candidates(v_tenant) x
   WHERE NOT x.suppressed
  ON CONFLICT (subscriber_id, consent_version) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_tenant, auth.uid(), 'newsletter.measurement_reconfirm_requested', 'newsletter_settings', v_tenant,
            jsonb_build_object('requested', v_n, 'consent_version', v_version));
  END IF;
  RETURN jsonb_build_object('requested', v_n, 'version', v_version);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_measurement_request(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_measurement_request(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_measurement_request(integer) IS
  'Zgoda i pomiar (I9d-Y2): start „Poproś o zgodę na pomiar" - prośba dla każdego kandydata spoza listy wyłączeń (jedna na wersję treści). p_expected = liczba z podglądu: więcej kandydatów = 40001 stale_preview, NULL/ujemna = 22023 expected_invalid. Audyt bez adresów. Admin albo super_admin z sesji.';

-- ----------------------------------------------------------------------------
-- D) Wysyłka (krok TS): porcja i wynik.
-- ----------------------------------------------------------------------------
-- rpc-shape: newsletter_measurement_claim (subscriber_id, tenant_id, email, lang,
-- first_name, nonce, consent_version, unsubscribe_token, attempt)
CREATE OR REPLACE FUNCTION public.newsletter_measurement_claim(p_limit integer DEFAULT 50)
RETURNS TABLE (
  subscriber_id uuid,
  tenant_id uuid,
  email text,
  lang text,
  first_name text,
  nonce uuid,
  consent_version text,
  unsubscribe_token text,
  attempt integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Lustro DATA_RETENTION_RULES.newsletterDailyCap (budżet wspólny z Y1).
  c_daily_cap constant integer := 200;
  c_lease constant interval := interval '15 minutes';
  -- Po 5 nieudanych próbach prośba zostaje „nieudana" (podgląd w panelu) -
  -- adres stale odrzucany przez dostawcę nie zjada codziennie budżetu.
  c_max_attempts constant integer := 5;
  v_left integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_tenant uuid;
  v_take integer;
  v_n integer;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT r.tenant_id FROM public.newsletter_measurement_requests r
     WHERE r.mailed_at IS NULL AND r.attempts < c_max_attempts
       AND (r.claimed_until IS NULL OR r.claimed_until < now())
     ORDER BY r.tenant_id
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, c_daily_cap - public._newsletter_oneoff_mail_used(v_tenant));
    CONTINUE WHEN v_take <= 0;
    -- Czoło kolejki: prośba nieaktualna (wypis, zgoda na pomiar udzielona
    -- w międzyczasie formularzem albo innym linkiem) - `skipped`, bez maila.
    WITH head AS (
      SELECT r.subscriber_id AS sid, r.consent_version AS ver FROM public.newsletter_measurement_requests r
       WHERE r.tenant_id = v_tenant AND r.mailed_at IS NULL AND r.attempts < c_max_attempts
         AND (r.claimed_until IS NULL OR r.claimed_until < now())
       ORDER BY r.requested_at, r.subscriber_id
       LIMIT v_take
       FOR UPDATE OF r SKIP LOCKED
    )
    UPDATE public.newsletter_measurement_requests r
       SET mailed_at = now(), mail_outcome = 'skipped', claimed_until = NULL
      FROM head h JOIN public.newsletter_subscribers s ON s.id = h.sid
     WHERE r.subscriber_id = h.sid AND r.consent_version = h.ver
       AND (s.status NOT IN ('subscribed', 'confirmed') OR public._email_measurement_consent(v_tenant, s.email));
    RETURN QUERY
      WITH picked AS (
        SELECT r.subscriber_id AS sid, r.consent_version AS ver FROM public.newsletter_measurement_requests r
         WHERE r.tenant_id = v_tenant AND r.mailed_at IS NULL AND r.attempts < c_max_attempts
           AND (r.claimed_until IS NULL OR r.claimed_until < now())
         ORDER BY r.requested_at, r.subscriber_id
         LIMIT v_take
         FOR UPDATE OF r SKIP LOCKED
      ), upd AS (
        UPDATE public.newsletter_measurement_requests r
           SET claimed_until = now() + c_lease, attempts = r.attempts + 1
          FROM picked p WHERE r.subscriber_id = p.sid AND r.consent_version = p.ver
        RETURNING r.subscriber_id AS sid, r.tenant_id AS tid, r.nonce AS n, r.consent_version AS ver,
                  r.requested_at AS req, r.attempts AS att
      )
      SELECT u.sid, u.tid, s.email, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END, s.first_name, u.n,
             u.ver, s.unsubscribe_token, u.att::integer
        FROM upd u JOIN public.newsletter_subscribers s ON s.id = u.sid
       ORDER BY u.req, u.sid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_left := v_left - v_n;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_measurement_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_measurement_claim(integer) TO service_role;

COMMENT ON FUNCTION public.newsletter_measurement_claim(integer) IS
  'Zgoda i pomiar (I9d-Y2): porcja próśb o zgodę na pomiar do wysłania (dzienny limit 200 na najemcę wspólny z prośbami wygaszania, dzierżawa 15 min, maks. 5 prób; nieaktualne -> skipped). Wiersz: subskrybent, najemca, adres, język (pl|en), imię, nonce, wersja treści, token wypisu, próba. Tylko service_role.';

-- rpc-shape: newsletter_measurement_mark (ok, reason, mailed, retry_at)
CREATE OR REPLACE FUNCTION public.newsletter_measurement_mark(
  p_subscriber uuid, p_nonce uuid, p_outcome text, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := CASE WHEN p_error ~ '^[a-z0-9_.:-]{1,64}$' THEN p_error ELSE 'failed' END;
  v_retry timestamptz;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('queued', 'duplicate', 'suppressed', 'failed') THEN
    RAISE EXCEPTION 'outcome_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'failed' THEN
    -- Ponowienie po przerwie rosnącej z liczbą prób (1 h x próba, maks. doba).
    UPDATE public.newsletter_measurement_requests r
       SET claimed_until = now() + make_interval(hours => LEAST(GREATEST(r.attempts, 1), 24)), last_error = v_code
     WHERE r.subscriber_id = p_subscriber AND r.nonce = p_nonce AND r.mailed_at IS NULL
    RETURNING r.claimed_until INTO v_retry;
  ELSE
    UPDATE public.newsletter_measurement_requests r
       SET mailed_at = now(), mail_outcome = p_outcome, claimed_until = NULL, last_error = NULL
     WHERE r.subscriber_id = p_subscriber AND r.nonce = p_nonce AND r.mailed_at IS NULL;
  END IF;
  IF NOT FOUND THEN
    -- Subskrybent usunięty, prośba pominięta albo wynik już zapisany.
    RETURN jsonb_build_object('ok', false, 'reason', 'gone');
  END IF;
  RETURN jsonb_build_object('ok', true, 'mailed', p_outcome <> 'failed', 'retry_at', v_retry);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_measurement_mark(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_measurement_mark(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_measurement_mark(uuid, uuid, text, text) IS
  'Zgoda i pomiar (I9d-Y2): wynik wysyłki prośby o zgodę na pomiar - queued/duplicate = wysłana, suppressed = zablokowana listą wyłączeń (bez maila, poza budżetem), failed = ponowienie po przerwie (kod błędu, nie tekst). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- E) Link potwierdzenia (jednorazowy).
-- ----------------------------------------------------------------------------
-- Serwer TS sprawdza podpis HMAC (subskrybent, nonce) i woła tę funkcję
-- z POST strony potwierdzenia (GET bez mutacji). Wpis rejestru niesie
-- BIEŻĄCĄ treść domyślną w języku subskrybenta i wersję z pomiarem - to
-- treść, którą strona potwierdzenia pokazuje; email_measurement dopisuje
-- wyzwalacz rejestru.
-- rpc-shape: newsletter_measurement_confirm (result, tenant_id, lang)
CREATE OR REPLACE FUNCTION public.newsletter_measurement_confirm(
  p_subscriber uuid, p_nonce uuid, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s public.newsletter_subscribers%ROWTYPE;
  v_r public.newsletter_measurement_requests%ROWTYPE;
  v_lang text;
BEGIN
  IF p_subscriber IS NULL OR p_nonce IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.id = p_subscriber FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'gone');
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  SELECT * INTO v_r FROM public.newsletter_measurement_requests r
   WHERE r.subscriber_id = p_subscriber AND r.tenant_id = v_s.tenant_id AND r.nonce = p_nonce
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'invalid', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  IF v_r.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  IF v_s.status NOT IN ('subscribed', 'confirmed') THEN
    RETURN jsonb_build_object('result', 'inactive', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;

  UPDATE public.newsletter_measurement_requests r SET confirmed_at = now()
   WHERE r.subscriber_id = v_r.subscriber_id AND r.consent_version = v_r.consent_version;
  -- Zgoda na pomiar udzielona w międzyczasie (formularz, inny link) -
  -- link zużyty, bez drugiego wpisu.
  IF public._email_measurement_consent(v_s.tenant_id, v_s.email) THEN
    RETURN jsonb_build_object('result', 'already', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, ip, user_agent, lang)
  VALUES (v_s.tenant_id, v_s.email, 'newsletter', v_s.id, 'newsletter:measurement_reconfirm',
          'measurement_reconfirm', 'newsletter', public._newsletter_consent_default(v_lang),
          public._newsletter_consent_version(), true, left(NULLIF(btrim(p_ip), ''), 64),
          left(NULLIF(btrim(p_user_agent), ''), 512), v_lang);
  -- Kliknięcie w link z maila = zaangażowanie (wygaszanie Y1).
  PERFORM public._newsletter_engagement_touch(v_s.tenant_id, v_s.id, NULL, 'form', now());
  RETURN jsonb_build_object('result', 'confirmed', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) IS
  'Zgoda i pomiar (I9d-Y2): link „Zgadzam się na pomiar" z prośby (nonce jednorazowy; podpis HMAC sprawdza serwer TS) - wpis newsletter „tak" z bieżącą treścią domyślną i wersją z pomiarem (wyzwalacz dopisuje email_measurement), znacznik zaangażowania. Wynik: confirmed | already | inactive | gone | invalid (+ tenant_id, lang). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- F) Panel treści zgody: oznaczenie „mój tekst obejmuje pomiar".
-- ----------------------------------------------------------------------------
-- Pola z treścią zgody newslettera; `covers` = tekst domyślny bieżącej
-- wersji albo oznaczony (aktualny skrót). Pole puste (`text_present` =
-- false) renderuje tekst zastępczy (formularz: treść domyślna; popup: pole
-- formularza) - `covers` NULL, rozstrzyga panel.
-- rpc-shape: admin_newsletter_consent_measurement_get (version, fields[field,
-- lang, text_present, is_default, marked, stale, covers, marked_at])
CREATE OR REPLACE FUNCTION public.admin_newsletter_consent_measurement_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_row public.newsletter_settings%ROWTYPE;
  v_fields jsonb;
BEGIN
  -- Treść edytują admin i redaktor (ostrzeżenie w edytorze), oznacza - admin.
  IF v_tenant IS NULL
     OR NOT (public.is_admin_or_editor() OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.newsletter_settings ns WHERE ns.tenant_id = v_tenant;
  SELECT jsonb_agg(jsonb_build_object(
           'field', f.field, 'lang', f.lang,
           'text_present', f.present,
           'is_default', f.present AND f.sha = public._consent_text_sha256(public._newsletter_consent_default(f.lang)),
           'marked', f.present AND m.text_sha256 IS NOT NULL AND m.text_sha256 = f.sha,
           'stale', m.text_sha256 IS NOT NULL AND m.text_sha256 IS DISTINCT FROM f.sha,
           'covers', CASE WHEN f.present THEN
                       f.sha = public._consent_text_sha256(public._newsletter_consent_default(f.lang))
                       OR m.text_sha256 IS NOT DISTINCT FROM f.sha
                     END,
           'marked_at', m.marked_at) ORDER BY f.ord)
    INTO v_fields
    FROM (SELECT x.ord, x.field, x.lang, NULLIF(btrim(x.txt), '') IS NOT NULL AS present,
                 public._consent_text_sha256(NULLIF(btrim(x.txt), '')) AS sha
            FROM (VALUES (1, 'policy_html_pl', 'pl', v_row.policy_html_pl),
                         (2, 'policy_html_en', 'en', v_row.policy_html_en),
                         (3, 'popup_privacy_html_pl', 'pl', v_row.popup_privacy_html_pl),
                         (4, 'popup_privacy_html_en', 'en', v_row.popup_privacy_html_en)) x(ord, field, lang, txt)) f
    LEFT JOIN public.newsletter_consent_measurement_marks m ON m.tenant_id = v_tenant AND m.field = f.field;
  RETURN jsonb_build_object('version', public._newsletter_consent_version(), 'fields', COALESCE(v_fields, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_consent_measurement_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_consent_measurement_get() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_consent_measurement_get() IS
  'Zgoda i pomiar (I9d-Y2): stan treści zgody newslettera - per pole (policy_html_pl/en, popup_privacy_html_pl/en): text_present, is_default (bieżąca treść domyślna z pomiarem), marked (oznaczenie admina pasuje do zapisanego tekstu), stale (tekst zmieniony po oznaczeniu), covers, marked_at. Admin/editor z sesji (42501).';

-- rpc-shape: admin_newsletter_consent_measurement_mark (jak _get)
CREATE OR REPLACE FUNCTION public.admin_newsletter_consent_measurement_mark(p_field text, p_marked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._data_retention_admin_tenant();
  v_text text;
  v_sha text;
BEGIN
  IF p_field IS NULL OR p_field NOT IN ('policy_html_pl', 'policy_html_en',
                                        'popup_privacy_html_pl', 'popup_privacy_html_en') THEN
    RAISE EXCEPTION 'field_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_marked IS NULL THEN
    RAISE EXCEPTION 'marked_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_marked THEN
    -- Skrót ZAPISANEGO tekstu (nie z żądania): oznaczenie dotyczy dokładnie
    -- tej treści, którą formularz pokazuje.
    SELECT CASE p_field
             WHEN 'policy_html_pl' THEN ns.policy_html_pl
             WHEN 'policy_html_en' THEN ns.policy_html_en
             WHEN 'popup_privacy_html_pl' THEN ns.popup_privacy_html_pl
             WHEN 'popup_privacy_html_en' THEN ns.popup_privacy_html_en
           END
      INTO v_text
      FROM public.newsletter_settings ns WHERE ns.tenant_id = v_tenant;
    IF NULLIF(btrim(v_text), '') IS NULL THEN
      RAISE EXCEPTION 'text_missing' USING ERRCODE = '22023';
    END IF;
    v_sha := public._consent_text_sha256(v_text);
    INSERT INTO public.newsletter_consent_measurement_marks AS m (tenant_id, field, text_sha256, marked_by, marked_at)
    VALUES (v_tenant, p_field, v_sha, auth.uid(), now())
    ON CONFLICT (tenant_id, field) DO UPDATE
       SET text_sha256 = EXCLUDED.text_sha256, marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at;
  ELSE
    DELETE FROM public.newsletter_consent_measurement_marks m WHERE m.tenant_id = v_tenant AND m.field = p_field;
  END IF;
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, auth.uid(),
          CASE WHEN p_marked THEN 'newsletter.consent_measurement_marked' ELSE 'newsletter.consent_measurement_unmarked' END,
          'newsletter_settings', v_tenant, jsonb_strip_nulls(jsonb_build_object('field', p_field, 'text_sha256', v_sha)));
  BEGIN
    PERFORM public.emit_domain_event(v_tenant, 'newsletter_settings', v_tenant::text, 'newsletter_settings.changed.v1',
      jsonb_build_object('op', 'update', 'keys', jsonb_build_array('consent_measurement_marks')), auth.uid(), false);
  EXCEPTION WHEN OTHERS THEN
    -- Szyna nie może wycofać oznaczenia.
    PERFORM public._log_emit_error(v_tenant, 'admin_newsletter_consent_measurement_mark',
                                   'newsletter_settings.changed.v1', SQLSTATE, SQLERRM);
  END;
  RETURN public.admin_newsletter_consent_measurement_get();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_consent_measurement_mark(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_consent_measurement_mark(text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_consent_measurement_mark(text, boolean) IS
  'Zgoda i pomiar (I9d-Y2): oznaczenie admina „mój tekst obejmuje pomiar" dla pola treści zgody (skrót SHA-256 zapisanego tekstu liczy baza) albo jego zdjęcie. Błędy: 22023 field_invalid | marked_invalid | text_missing. audit_log newsletter.consent_measurement_(un)marked, zdarzenie newsletter_settings.changed.v1. Admin albo super_admin z sesji. Zwraca stan jak _get.';
