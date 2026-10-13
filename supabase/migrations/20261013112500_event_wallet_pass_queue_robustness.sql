-- events-harness: include
-- ============================================================================
-- WYDARZENIA: KOLEJKA DEZAKTYWACJI PRZEPUSTEK GOOGLE WALLET - REAKTYWACJA PO
-- NIEAKTUALNYM ZGLOSZENIU, NAGROBKI, PONOWIENIE PORZUCONYCH
-- (przeglad koncowy OPS-14: F7, F9, F10).
--
-- CZESC 2/2. Wymaga czesci 20261013112400 (`event_wallet_pass_tombstones`).
-- Ciala: `_event_wallet_pass_revocations_claim` i `_settle` z 20261013111700;
-- sygnatury, wynik (jsonb) i ACL bez zmian (CREATE OR REPLACE zachowuje
-- GRANT-y, ponizej powtorzone jawnie).
--
-- PROBLEM 1 (F7). Zajecie zamykalo jako `stale` zgloszenie dezaktywacji,
-- gdy zgloszenie znow dawalo przepustke z tym samym kodem (przywrocone
-- wydarzenie, cofniety `no_show`, zwrot cofniety na oplacone). Robilo to
-- takze PO probie, ktora mogla dojsc do Google: PATCH INACTIVE wykonany, ale
-- nie odnotowany (limit 8 s minal po zapisie w Google - `timeout` jako blad,
-- awaria rozliczenia, zabity proces). Wiersz wracal do stanu
-- {active: true, content_hash: <stary>}, wiec ponowne "Dodaj do Google
-- Wallet" liczylo te sama tresc i POMIJALO zapis obiektu - przepustka
-- w telefonie zostawala INACTIVE az do niezwiazanej zmiany tresci, a
-- uczestnik nie mial jak tego naprawic.
--
-- PROBLEM 2 (F9). Nagrobki z 20261013112400 nie maja kto drenowac.
--
-- PROBLEM 3 (F10, czesc bazy). Po 8 nieudanych probach wiersz nie jest juz
-- zajmowany i nic go nie przywraca: triggery ruszaja tylko wiersze bez
-- zgloszenia, a dziennik - tylko obiekt wydany ponownie. Po naprawie
-- przyczyny (klucz konta uslugi, uprawnienia wystawcy, awaria Google)
-- operacje nie mialy jak ponowic porzuconych dezaktywacji. (Czesc kodu:
-- blad wymiany tokenu nie zajmuje juz prob - zadanie oddaje partie jako
-- `deferred`, src/lib/events/wallet/walletRevocationJob.server.ts.)
--
-- ZMIANA:
--   * zajecie - `stale` po probie (`revoke_attempts > 0`): czysci
--     `content_hash` (nastepne dodanie zawsze zapisze obiekt w calosci, ze
--     stanem ACTIVE) i oddaje obiekt w nowej liscie `reactivate` - zadanie
--     ustawia mu ACTIVE od razu, tak jak dla obiektu wydanego ponownie
--     w trakcie proby (rozliczenie). `stale` bez proby (nic nie wyslano)
--     zostaje jak bylo - bez wywolania i ze skrotem tresci;
--   * zajecie - nagrobki: kandydaci z obu kolejek (dziennik i nagrobki) ida
--     po kolei zgloszenia (najstarsze pierwsze) pod JEDNYM limitem, wiec
--     masowe odwolanie nie zaglodzi usunietego wydarzenia ani odwrotnie.
--     Nagrobek po `valid_until` jest usuwany bez sieci (`closed`), takze po
--     8 probach; pozostale dostaja dzierzawe i probe jak wiersz dziennika.
--     Pozycja w `passes` ma ten sam ksztalt ({id, object_id, reason,
--     attempt}; reason = powod nagrobka), wiec zadanie traktuje obie kolejki
--     tak samo;
--   * rozliczenie - nagrobki: p_revoked usuwa wiersz (obiekt nieaktywny albo
--     nie istnieje), p_failed zapisuje blad (proba sie liczy, po 8 -
--     `gave_up`), p_deferred oddaje probe; zawsze tylko pod dzierzawa tego
--     zajecia;
--   * `_event_wallet_pass_revocations_requeue()` - operacje (service_role):
--     przywraca do kolejki wiersze porzucone po 8 probach (dziennik
--     i nagrobki), ktorych obiekt jeszcze nie wygasl; licznik i dzierzawa od
--     zera, ostatni blad czyszczony. Zwraca {passes, tombstones}.
--
-- WYNIK ZAJECIA: {claimed_at, passes:[{id, object_id, reason, attempt}],
-- closed, reactivate:[object_id]} - nowe pole `reactivate`; stare pola bez
-- zmian, wiec kod sprzed tej migracji (ignoruje nowe pole) dziala dalej.
--
-- BEZPIECZENSTWO: wszystkie trzy funkcje wylacznie service_role, SECURITY
-- DEFINER z search_path. Nie przyjmuja najemcy: zajecie i rozliczenie
-- operuja na wierszach wlasnej dzierzawy, ponowienie - na wierszach
-- porzuconych we wszystkich najemcach (operacja serwisowa bez danych
-- wejsciowych).
--
-- IDEMPOTENTNA: CREATE OR REPLACE (sygnatury bez zmian), bezstanowe
-- REVOKE/GRANT.
--
-- DOWOD: scripts/events-harness/runtime_test.d/55_wallet_revocation_robustness.sql
-- (sekcje: reaktywacja po stale, nagrobki w kolejce, ponowienie porzuconych);
-- zadanie: src/lib/events/wallet/__tests__/walletRevocationJob.server.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ZAJECIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_wallet_pass_revocations_claim(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_claim timestamptz := clock_timestamp();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_pass_ids uuid[];
  v_tombstone_ids uuid[];
  v_passes jsonb;
  v_reactivate jsonb;
  v_closed integer;
  v_tombstone_passes jsonb;
  v_tombstones_closed integer;
BEGIN
  -- ZMIANA 20261013112500 (F9): kandydaci z dziennika i z nagrobkow pod
  -- jednym limitem, najstarsze zgloszenie pierwsze. Blokady SKIP LOCKED
  -- zakladaja podzapytania kolejek; wiersz zablokowany, a niewybrany, zwalnia
  -- koniec transakcji.
  WITH pass_queue AS (
    SELECT w.id, w.revoke_requested_at AS requested_at
      FROM public.event_wallet_passes w
     WHERE w.platform = 'google'
       AND w.revoke_requested_at IS NOT NULL
       AND w.revoked_at IS NULL
       -- Ten sam sufit co `gave_up` w rozliczeniu.
       AND w.revoke_attempts < 8
       AND (w.revoke_claimed_at IS NULL
            OR w.revoke_claimed_at < now() - LEAST(
                 interval '5 minutes' * power(2, GREATEST(w.revoke_attempts - 1, 0)),
                 interval '6 hours'))
     ORDER BY w.revoke_requested_at, w.id
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), tombstone_queue AS (
    SELECT t.id, t.requested_at
      FROM public.event_wallet_pass_tombstones t
     WHERE t.valid_until <= now()
        OR (t.attempts < 8
            AND (t.claimed_at IS NULL
                 OR t.claimed_at < now() - LEAST(
                      interval '5 minutes' * power(2, GREATEST(t.attempts - 1, 0)),
                      interval '6 hours')))
     ORDER BY t.requested_at, t.id
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), chosen AS (
    SELECT q.id, q.source
      FROM (SELECT p.id, p.requested_at, 'pass'::text AS source FROM pass_queue p
            UNION ALL
            SELECT t.id, t.requested_at, 'tombstone'::text FROM tombstone_queue t) q
     ORDER BY q.requested_at, q.id
     LIMIT v_limit
  )
  SELECT COALESCE(array_agg(c.id) FILTER (WHERE c.source = 'pass'), ARRAY[]::uuid[]),
         COALESCE(array_agg(c.id) FILTER (WHERE c.source = 'tombstone'), ARRAY[]::uuid[])
    INTO v_pass_ids, v_tombstone_ids
    FROM chosen c;

  WITH picked AS (
    SELECT w.id,
           -- ZMIANA 20261013112500 (F7): proba mogla dojsc do Google.
           w.revoke_attempts > 0 AS tried,
           CASE
             WHEN COALESCE(e.ends_at, e.starts_at) + interval '1 day' <= now() THEN 'lapsed'
             WHEN w.revoke_reason <> 'replaced'
                  AND w.code_hash IS NOT NULL
                  AND w.code_hash = r.qr_token_hash
                  AND r.status IN ('approved', 'attended')
                  AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
                  AND e.status <> 'cancelled' THEN 'stale'
           END AS outcome
    FROM public.event_wallet_passes w
    JOIN public.event_registrations r
      ON r.id = w.registration_id AND r.tenant_id = w.tenant_id
    JOIN public.events e
      ON e.id = w.event_id AND e.tenant_id = w.tenant_id
    WHERE w.id = ANY (v_pass_ids)
  ), marked AS (
    UPDATE public.event_wallet_passes w SET
      revoke_requested_at = CASE WHEN p.outcome = 'stale' THEN NULL ELSE w.revoke_requested_at END,
      revoke_reason = CASE WHEN p.outcome = 'stale' THEN NULL ELSE w.revoke_reason END,
      revoked_at = CASE WHEN p.outcome = 'lapsed' THEN now() ELSE w.revoked_at END,
      -- F7: obiekt mogl zostac INACTIVE w Google - nastepne dodanie musi go
      -- zapisac w calosci, a zadanie przywraca mu ACTIVE (`reactivate`).
      content_hash = CASE WHEN p.outcome = 'stale' AND p.tried THEN NULL ELSE w.content_hash END,
      revoke_claimed_at = CASE WHEN p.outcome IS NULL THEN v_claim END,
      revoke_attempts = CASE
        WHEN p.outcome IS NULL THEN w.revoke_attempts + 1
        WHEN p.outcome = 'stale' THEN 0
        ELSE w.revoke_attempts
      END,
      revoke_error = CASE WHEN p.outcome IS NULL THEN w.revoke_error END
    FROM picked p
    WHERE w.id = p.id
    RETURNING w.id, w.object_id, w.revoke_reason, w.revoke_attempts,
              w.revoke_requested_at, p.outcome, p.tried
  )
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object(
             'id', m.id,
             'object_id', m.object_id,
             'reason', m.revoke_reason,
             'attempt', m.revoke_attempts)
             ORDER BY m.revoke_requested_at, m.id) FILTER (WHERE m.outcome IS NULL),
           '[]'::jsonb),
         COALESCE(
           jsonb_agg(m.object_id ORDER BY m.object_id)
             FILTER (WHERE m.outcome = 'stale' AND m.tried),
           '[]'::jsonb),
         count(*) FILTER (WHERE m.outcome IS NOT NULL)
    INTO v_passes, v_reactivate, v_closed
    FROM marked m;

  -- Nagrobek po waznosci obiektu: Google wygasil go sam.
  WITH gone AS (
    DELETE FROM public.event_wallet_pass_tombstones t
     WHERE t.id = ANY (v_tombstone_ids)
       AND t.valid_until <= now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_tombstones_closed FROM gone;

  WITH marked AS (
    UPDATE public.event_wallet_pass_tombstones t
       SET claimed_at = v_claim,
           attempts = t.attempts + 1
     WHERE t.id = ANY (v_tombstone_ids)
       AND t.valid_until > now()
    RETURNING t.id, t.object_id, t.reason, t.attempts, t.requested_at
  )
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object(
             'id', m.id,
             'object_id', m.object_id,
             'reason', m.reason,
             'attempt', m.attempts)
             ORDER BY m.requested_at, m.id),
           '[]'::jsonb)
    INTO v_tombstone_passes
    FROM marked m;

  RETURN jsonb_build_object(
    'claimed_at', v_claim,
    'passes', v_passes || v_tombstone_passes,
    'closed', v_closed + v_tombstones_closed,
    'reactivate', v_reactivate
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_wallet_pass_revocations_claim(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_revocations_claim(integer) TO service_role;

COMMENT ON FUNCTION public._event_wallet_pass_revocations_claim(integer) IS
  'Zajmuje do p_limit (1-100, domyslnie 20) obiektow Google Wallet do dezaktywacji z dziennika i z nagrobkow usunietych wydarzen/zgloszen, najstarsze zgloszenie pierwsze (SKIP LOCKED, dzierzawa, odstep 5 min * 2^(proba-1) do 6 h, najwyzej 8 prob). Bez wywolania sieci zamyka obiekty wygasle (wydarzenie zakonczone ponad dobe temu) i zgloszenia nieaktualne (zgloszenie znow wazne z tym samym kodem); nieaktualne PO probie oddaje w reactivate z wyczyszczonym content_hash. Zwraca {claimed_at, passes:[{id, object_id, reason, attempt}], closed, reactivate:[object_id]}. Wylacznie service_role.';

-- ----------------------------------------------------------------------------
-- 2) ROZLICZENIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_wallet_pass_revocations_settle(
  p_claimed_at timestamptz,
  p_revoked uuid[],
  p_failed jsonb DEFAULT '[]'::jsonb,
  p_deferred uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_revoked integer := 0;
  v_tombstones_revoked integer := 0;
  v_failed integer := 0;
  v_gave_up integer := 0;
  v_deferred integer := 0;
  v_tombstones_deferred integer := 0;
  v_reactivate jsonb;
BEGIN
  IF p_claimed_at IS NULL THEN
    RAISE EXCEPTION 'invalid_claim: claimed_at is required' USING ERRCODE = '22023';
  END IF;

  WITH done AS (
    UPDATE public.event_wallet_passes w
       SET revoked_at = now(),
           revoke_claimed_at = NULL,
           revoke_error = NULL
     WHERE w.id = ANY (COALESCE(p_revoked, ARRAY[]::uuid[]))
       AND w.revoke_claimed_at = p_claimed_at
       AND w.revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_revoked FROM done;

  -- ZMIANA 20261013112500 (F9): nagrobek dezaktywowanego obiektu znika.
  WITH done AS (
    DELETE FROM public.event_wallet_pass_tombstones t
     WHERE t.id = ANY (COALESCE(p_revoked, ARRAY[]::uuid[]))
       AND t.claimed_at = p_claimed_at
    RETURNING 1
  )
  SELECT count(*) INTO v_tombstones_revoked FROM done;

  -- Wydany ponownie w trakcie proby: dziennik zdjal zgloszenie i dzierzawe,
  -- a PATCH INACTIVE mogl przyjsc po zapisie trasy.
  WITH again AS (
    UPDATE public.event_wallet_passes w
       SET content_hash = NULL
     WHERE w.id = ANY (COALESCE(p_revoked, ARRAY[]::uuid[]))
       AND w.platform = 'google'
       AND w.revoke_requested_at IS NULL
       AND w.revoked_at IS NULL
    RETURNING w.object_id
  )
  SELECT COALESCE(jsonb_agg(a.object_id ORDER BY a.object_id), '[]'::jsonb)
    INTO v_reactivate
    FROM again a;

  WITH failed AS (
    SELECT DISTINCT ON ((x->>'id')::uuid)
           (x->>'id')::uuid AS id,
           left(NULLIF(btrim(COALESCE(x->>'error', '')), ''), 300) AS error
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_failed) = 'array' THEN p_failed ELSE '[]'::jsonb END) x
    WHERE jsonb_typeof(x) = 'object'
      AND (x->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), marked AS (
    -- Dzierzawa zostaje jako chwila ostatniej proby (odstep ponowienia).
    UPDATE public.event_wallet_passes w
       SET revoke_error = COALESCE(f.error, 'unknown')
      FROM failed f
     WHERE w.id = f.id
       AND w.revoke_claimed_at = p_claimed_at
       AND w.revoked_at IS NULL
    RETURNING w.revoke_attempts
  ), marked_tombstones AS (
    UPDATE public.event_wallet_pass_tombstones t
       SET error = COALESCE(f.error, 'unknown')
      FROM failed f
     WHERE t.id = f.id
       AND t.claimed_at = p_claimed_at
    RETURNING t.attempts
  ), attempts AS (
    SELECT m.revoke_attempts AS n FROM marked m
    UNION ALL
    SELECT mt.attempts FROM marked_tombstones mt
  )
  SELECT count(*), count(*) FILTER (WHERE a.n >= 8)
    INTO v_failed, v_gave_up
    FROM attempts a;

  WITH released AS (
    UPDATE public.event_wallet_passes w
       SET revoke_claimed_at = NULL,
           revoke_attempts = GREATEST(w.revoke_attempts - 1, 0)
     WHERE w.id = ANY (COALESCE(p_deferred, ARRAY[]::uuid[]))
       AND w.revoke_claimed_at = p_claimed_at
       AND w.revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_deferred FROM released;

  WITH released AS (
    UPDATE public.event_wallet_pass_tombstones t
       SET claimed_at = NULL,
           attempts = GREATEST(t.attempts - 1, 0)
     WHERE t.id = ANY (COALESCE(p_deferred, ARRAY[]::uuid[]))
       AND t.claimed_at = p_claimed_at
    RETURNING 1
  )
  SELECT count(*) INTO v_tombstones_deferred FROM released;

  RETURN jsonb_build_object(
    'revoked', v_revoked + v_tombstones_revoked,
    'failed', v_failed,
    'gave_up', v_gave_up,
    'deferred', v_deferred + v_tombstones_deferred,
    'reactivate', v_reactivate
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_wallet_pass_revocations_settle(timestamptz, uuid[], jsonb, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_revocations_settle(timestamptz, uuid[], jsonb, uuid[])
  TO service_role;

COMMENT ON FUNCTION public._event_wallet_pass_revocations_settle(timestamptz, uuid[], jsonb, uuid[]) IS
  'Rozlicza partie z _event_wallet_pass_revocations_claim po dzierzawie p_claimed_at (dziennik i nagrobki): p_revoked -> revoked_at (dziennik) albo usuniecie nagrobka, p_failed [{id, error}] -> blad (proba sie liczy; po 8 - gave_up), p_deferred -> proba wraca i dzierzawa znika. Obiekt z p_revoked wydany ponownie w trakcie proby wraca w reactivate (content_hash wyczyszczony). Zwraca {revoked, failed, gave_up, deferred, reactivate}. Wylacznie service_role.';

-- ----------------------------------------------------------------------------
-- 3) PONOWIENIE PORZUCONYCH (OPERACJE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_wallet_pass_revocations_requeue()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_passes integer;
  v_tombstones integer;
BEGIN
  WITH requeued AS (
    UPDATE public.event_wallet_passes w
       SET revoke_attempts = 0,
           revoke_claimed_at = NULL,
           revoke_error = NULL
      FROM public.events e
     WHERE e.id = w.event_id
       AND e.tenant_id = w.tenant_id
       AND w.platform = 'google'
       AND w.revoke_requested_at IS NOT NULL
       AND w.revoked_at IS NULL
       AND w.revoke_attempts >= 8
       AND COALESCE(e.ends_at, e.starts_at) + interval '1 day' > now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_passes FROM requeued;

  WITH requeued AS (
    UPDATE public.event_wallet_pass_tombstones t
       SET attempts = 0,
           claimed_at = NULL,
           error = NULL
     WHERE t.attempts >= 8
       AND t.valid_until > now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_tombstones FROM requeued;

  RETURN jsonb_build_object('passes', v_passes, 'tombstones', v_tombstones);
END;
$$;

REVOKE ALL ON FUNCTION public._event_wallet_pass_revocations_requeue()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_revocations_requeue() TO service_role;

COMMENT ON FUNCTION public._event_wallet_pass_revocations_requeue() IS
  'Operacje (F10): po naprawie przyczyny (klucz konta uslugi, uprawnienia wystawcy, awaria Google) przywraca do kolejki dezaktywacje porzucone po 8 probach - wiersze dziennika i nagrobki, ktorych obiekt jeszcze nie wygasl. Licznik prob i dzierzawa od zera, blad czyszczony. Zwraca {passes, tombstones}. Wylacznie service_role.';
