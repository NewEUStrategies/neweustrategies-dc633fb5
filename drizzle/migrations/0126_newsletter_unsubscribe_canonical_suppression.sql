CREATE OR REPLACE FUNCTION public.email_unsubscribe_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_email text;
  v_tenant uuid;
  v_global boolean := false;
  v_subscriber uuid;
  v_status text;
  v_claimed boolean := false;
  v_result jsonb;
BEGIN
  IF v_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_token');
  END IF;

  SELECT lower(btrim(t.email)), t.used_at IS NULL
    INTO v_email, v_claimed
    FROM public.email_unsubscribe_tokens t
   WHERE t.token = v_token
   FOR UPDATE;
  v_global := FOUND;

  IF NOT v_global THEN
    SELECT ns.id, lower(btrim(ns.email)), ns.tenant_id, ns.status
      INTO v_subscriber, v_email, v_tenant, v_status
      FROM public.newsletter_subscribers ns
     WHERE ns.unsubscribe_token = v_token
     FOR UPDATE;
    v_claimed := v_subscriber IS NOT NULL AND v_status IS DISTINCT FROM 'unsubscribed';
  END IF;

  IF COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_token');
  END IF;

  v_tenant := COALESCE(v_tenant, public.email_resolve_tenant_for_address(v_email));
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tenant');
  END IF;

  IF v_subscriber IS NOT NULL THEN
    IF v_claimed THEN
      UPDATE public.newsletter_subscribers
         SET status = 'unsubscribed',
             unsubscribed_at = now(),
             confirmation_token = NULL,
             confirmation_expires_at = NULL
       WHERE id = v_subscriber;
    END IF;
  ELSE
    UPDATE public.newsletter_subscribers ns
       SET status = 'unsubscribed',
           unsubscribed_at = now(),
           confirmation_token = NULL,
           confirmation_expires_at = NULL
     WHERE ns.tenant_id = v_tenant
       AND lower(ns.email) = v_email
       AND ns.status <> 'unsubscribed';

    IF v_claimed THEN
      UPDATE public.email_unsubscribe_tokens
         SET used_at = now()
       WHERE token = v_token AND used_at IS NULL;
    END IF;
  END IF;

  v_result := public.email_record_suppression(
    p_tenant => v_tenant,
    p_email => v_email,
    p_reason => 'unsubscribe',
    p_source => 'system',
    p_provider => 'self_service',
    p_subscriber => v_subscriber,
    p_meta => jsonb_build_object(
      'channel', 'unsubscribe_link',
      'token_kind', CASE WHEN v_global THEN 'global' ELSE 'newsletter' END)
  );

  IF COALESCE((v_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'suppression_not_recorded: %', COALESCE(v_result ->> 'error', 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_unsubscribed', NOT v_claimed,
    'tenant_id', v_tenant);
END;
$fn$;

COMMENT ON FUNCTION public.email_unsubscribe_by_token(text) IS
  'Wypis jednym kliknieciem (token globalny lub per subskrybent): w JEDNEJ transakcji wypisuje subskrybenta (status + uniewaznienie tokenu potwierdzenia), zuzywa token globalny i stawia blokade unsubscribe w tenancie wlasciciela wiersza. Nieudana blokada wycofuje calosc. Idempotentny; already_unsubscribed odzwierciedla stan sprzed wywolania.';

REVOKE ALL ON FUNCTION public.email_unsubscribe_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe_by_token(text) TO service_role;

INSERT INTO public.email_suppressions AS es (
  tenant_id, email, reason, scope, source, provider, subscriber_id,
  occurrences, diagnostic, expires_at, first_seen_at, last_seen_at, meta
)
SELECT DISTINCT ON (ns.tenant_id, lower(btrim(ns.email)))
  ns.tenant_id,
  lower(btrim(ns.email)),
  'unsubscribe'::text,
  'permanent'::text,
  'import'::text,
  'newsletter_status'::text,
  ns.id,
  1,
  'migracja 20261002190100: wypis z newslettera bez blokady na liscie kanonicznej'::text,
  NULL::timestamptz,
  COALESCE(ns.unsubscribed_at, ns.updated_at, now()),
  now(),
  jsonb_build_object(
    'backfill', '20261002190100',
    'channel', 'newsletter_status',
    'unsubscribed_at', ns.unsubscribed_at)
FROM public.newsletter_subscribers ns
WHERE ns.status = 'unsubscribed'
  AND btrim(ns.email) <> ''
  AND position('@' in ns.email) > 0
ORDER BY ns.tenant_id, lower(btrim(ns.email)), ns.unsubscribed_at DESC NULLS LAST
ON CONFLICT (tenant_id, email_norm) DO UPDATE
   SET reason = EXCLUDED.reason,
       scope = EXCLUDED.scope,
       source = EXCLUDED.source,
       provider = EXCLUDED.provider,
       subscriber_id = COALESCE(es.subscriber_id, EXCLUDED.subscriber_id),
       occurrences = 1,
       expires_at = NULL,
       released_at = NULL,
       released_by = NULL,
       last_seen_at = now(),
       meta = es.meta || EXCLUDED.meta
 WHERE (es.released_at IS NULL AND es.scope <> 'permanent')
    OR (es.released_at IS NOT NULL
        AND es.released_at < (EXCLUDED.meta ->> 'unsubscribed_at')::timestamptz);