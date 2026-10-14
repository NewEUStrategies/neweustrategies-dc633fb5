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
  v_passes jsonb;
  v_closed integer;
BEGIN
  WITH picked AS (
    SELECT w.id,
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
    WHERE w.platform = 'google'
      AND w.revoke_requested_at IS NOT NULL
      AND w.revoked_at IS NULL
      AND w.revoke_attempts < 8
      AND (w.revoke_claimed_at IS NULL
           OR w.revoke_claimed_at < now() - LEAST(
                interval '5 minutes' * power(2, GREATEST(w.revoke_attempts - 1, 0)),
                interval '6 hours'))
    ORDER BY w.revoke_requested_at, w.id
    LIMIT v_limit
    FOR UPDATE OF w SKIP LOCKED
  ), marked AS (
    UPDATE public.event_wallet_passes w SET
      revoke_requested_at = CASE WHEN p.outcome = 'stale' THEN NULL ELSE w.revoke_requested_at END,
      revoke_reason = CASE WHEN p.outcome = 'stale' THEN NULL ELSE w.revoke_reason END,
      revoked_at = CASE WHEN p.outcome = 'lapsed' THEN now() ELSE w.revoked_at END,
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
              w.revoke_requested_at, p.outcome
  )
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object(
             'id', m.id,
             'object_id', m.object_id,
             'reason', m.revoke_reason,
             'attempt', m.revoke_attempts)
             ORDER BY m.revoke_requested_at, m.id) FILTER (WHERE m.outcome IS NULL),
           '[]'::jsonb),
         count(*) FILTER (WHERE m.outcome IS NOT NULL)
    INTO v_passes, v_closed
    FROM marked m;

  RETURN jsonb_build_object('claimed_at', v_claim, 'passes', v_passes, 'closed', v_closed);
END;
$$;

REVOKE ALL ON FUNCTION public._event_wallet_pass_revocations_claim(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_revocations_claim(integer) TO service_role;

COMMENT ON FUNCTION public._event_wallet_pass_revocations_claim(integer) IS
  'Zajmuje do p_limit (1-100, domyslnie 20) obiektow Google Wallet do dezaktywacji (SKIP LOCKED, dzierzawa = revoke_claimed_at, odstep 5 min * 2^(proba-1) do 6 h, najwyzej 8 prob). Bez wywolania sieci zamyka obiekty wydarzen zakonczonych ponad dobe temu (revoked_at) i zgloszenia nieaktualne (zgloszenie znow wazne z tym samym kodem). Zwraca {claimed_at, passes:[{id, object_id, reason, attempt}], closed}. Wylacznie service_role.';

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
  v_failed integer := 0;
  v_gave_up integer := 0;
  v_deferred integer := 0;
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
    UPDATE public.event_wallet_passes w
       SET revoke_error = COALESCE(f.error, 'unknown')
      FROM failed f
     WHERE w.id = f.id
       AND w.revoke_claimed_at = p_claimed_at
       AND w.revoked_at IS NULL
    RETURNING w.revoke_attempts
  )
  SELECT count(*), count(*) FILTER (WHERE m.revoke_attempts >= 8)
    INTO v_failed, v_gave_up
    FROM marked m;

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

  RETURN jsonb_build_object(
    'revoked', v_revoked,
    'failed', v_failed,
    'gave_up', v_gave_up,
    'deferred', v_deferred,
    'reactivate', v_reactivate
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_wallet_pass_revocations_settle(timestamptz, uuid[], jsonb, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_revocations_settle(timestamptz, uuid[], jsonb, uuid[])
  TO service_role;

COMMENT ON FUNCTION public._event_wallet_pass_revocations_settle(timestamptz, uuid[], jsonb, uuid[]) IS
  'Rozlicza partie z _event_wallet_pass_revocations_claim po dzierzawie p_claimed_at: p_revoked -> revoked_at, p_failed [{id, error}] -> revoke_error (proba sie liczy; po 8 - gave_up), p_deferred -> proba wraca i dzierzawa znika. Obiekt z p_revoked wydany ponownie w trakcie proby wraca w reactivate (content_hash wyczyszczony). Zwraca {revoked, failed, gave_up, deferred, reactivate}. Wylacznie service_role.';