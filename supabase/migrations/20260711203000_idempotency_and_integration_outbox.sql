-- ============================================================================
-- SPÓJNOŚĆ MIĘDZY MODUŁAMI, część 4/5: idempotencja komend + router integracji.
--
-- 1) command_idempotency - JEDNA tabela dla wszystkich mutacji serwerowych
--    (wzorzec dotąd rozproszony per moduł). Frontend generuje klucz
--    idempotencji + correlation_id; serwer "claimuje" komendę przed pracą i
--    zapisuje wynik - retry sieciowy / podwójny klik dostaje zapamiętany
--    wynik zamiast zdublowanego efektu.
--
-- 2) Router integracji wychodzących - zamiast osobnego mechanizmu per
--    integracja (HubSpot, Slack, webhooki...), jeden strumień: INSERT na
--    domain_events -> trigger dopisuje integration_deliveries dla każdego
--    endpointu, którego filtr event_types pasuje. Dispatcher (funkcja
--    serwerowa, service_role) zdejmuje paczki claim-em ze SKIP LOCKED,
--    wysyła HTTP z podpisem HMAC i raportuje wynik; backoff wykładniczy,
--    po 8 próbach status 'dead'.
--
-- Wszystko idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) IDEMPOTENCJA KOMEND
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.command_idempotency (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  command text NOT NULL,
  actor_id uuid,
  correlation_id uuid,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'succeeded', 'failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, idempotency_key),
  CHECK (btrim(idempotency_key) <> '' AND btrim(command) <> '')
);

CREATE INDEX IF NOT EXISTS idx_command_idempotency_created
  ON public.command_idempotency (created_at);

GRANT ALL ON public.command_idempotency TO service_role;
ALTER TABLE public.command_idempotency ENABLE ROW LEVEL SECURITY;
-- Brak polityk dla klientów: dostęp wyłącznie przez RPC SECURITY DEFINER.

-- Claim: pierwszy wygrywa. Zwraca {claimed, status, result?}:
--   claimed=true  -> wykonaj komendę i zgłoś complete_command;
--   claimed=false -> duplikat: status + (dla succeeded) zapamiętany wynik.
CREATE OR REPLACE FUNCTION public.claim_command(p_key text, p_command text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := COALESCE(public.current_tenant_id(), public.public_tenant_id());
  v_actor uuid := auth.uid();
  v_row public.command_idempotency%ROWTYPE;
BEGIN
  IF v_tenant IS NULL OR p_key IS NULL OR btrim(p_key) = '' THEN
    RETURN jsonb_build_object('claimed', false, 'status', 'invalid');
  END IF;

  INSERT INTO public.command_idempotency (
    tenant_id, idempotency_key, command, actor_id, correlation_id
  ) VALUES (
    v_tenant, btrim(p_key), p_command, v_actor, public.request_correlation_id()
  )
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;

  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true, 'status', 'in_progress');
  END IF;

  SELECT * INTO v_row
    FROM public.command_idempotency
   WHERE tenant_id = v_tenant AND idempotency_key = btrim(p_key);

  -- Cudzy klucz: nie zdradzamy wyniku, tylko fakt kolizji.
  IF v_row.actor_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('claimed', false, 'status', 'conflict');
  END IF;

  RETURN jsonb_build_object(
    'claimed', false,
    'status', v_row.status,
    'result', v_row.result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_command(
  p_key text, p_succeeded boolean, p_result jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := COALESCE(public.current_tenant_id(), public.public_tenant_id());
BEGIN
  UPDATE public.command_idempotency
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         result = p_result,
         completed_at = now()
   WHERE tenant_id = v_tenant
     AND idempotency_key = btrim(p_key)
     AND actor_id IS NOT DISTINCT FROM auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_command(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_command(text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_command(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_command(text, boolean, jsonb) TO authenticated, service_role;

-- Klucze idempotencji żyją krótko - 48 h wystarcza na każdy retry klienta.
CREATE OR REPLACE FUNCTION public.prune_command_idempotency()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.command_idempotency WHERE created_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_command_idempotency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_command_idempotency() TO service_role;

-- ----------------------------------------------------------------------------
-- 2) ROUTER INTEGRACJI WYCHODZĄCYCH
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  integration text NOT NULL DEFAULT 'webhook'
    CHECK (integration IN ('webhook', 'slack', 'hubspot', 'gcal', 'confluence')),
  url text NOT NULL,
  secret text,
  -- Pusta tablica = wszystkie zdarzenia; inaczej dokładne dopasowanie typu.
  event_types text[] NOT NULL DEFAULT '{}'::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(name) <> ''),
  CHECK (url ~* '^https://')
);

CREATE INDEX IF NOT EXISTS idx_integration_endpoints_tenant
  ON public.integration_endpoints (tenant_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.integration_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.integration_endpoints(id) ON DELETE CASCADE,
  event_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'delivering', 'delivered', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_deliveries_due
  ON public.integration_deliveries (next_attempt_at)
  WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS idx_integration_deliveries_endpoint
  ON public.integration_deliveries (endpoint_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_endpoints TO authenticated;
GRANT SELECT ON public.integration_deliveries TO authenticated;
GRANT ALL ON public.integration_endpoints TO service_role;
GRANT ALL ON public.integration_deliveries TO service_role;

ALTER TABLE public.integration_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_endpoints_staff_all ON public.integration_endpoints;
CREATE POLICY integration_endpoints_staff_all
  ON public.integration_endpoints FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS integration_deliveries_staff_select ON public.integration_deliveries;
CREATE POLICY integration_deliveries_staff_select
  ON public.integration_deliveries FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

-- Router: każde zdarzenie domenowe trafia do kolejki każdego pasującego
-- endpointu. Payload jest snapshotem - dispatcher nie joinuje z szyną (która
-- ma retencję 90 dni).
CREATE OR REPLACE FUNCTION public.tg_route_domain_event_to_integrations()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.integration_deliveries (
    tenant_id, endpoint_id, event_id, event_type, payload
  )
  SELECT
    NEW.tenant_id, e.id, NEW.id, NEW.event_type,
    jsonb_build_object(
      'id', NEW.id,
      'event_type', NEW.event_type,
      'aggregate_type', NEW.aggregate_type,
      'aggregate_id', NEW.aggregate_id,
      'payload', NEW.payload,
      'correlation_id', NEW.correlation_id,
      'created_at', NEW.created_at
    )
  FROM public.integration_endpoints e
  WHERE e.tenant_id = NEW.tenant_id
    AND e.enabled
    AND (cardinality(e.event_types) = 0 OR NEW.event_type = ANY (e.event_types));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_domain_event_to_integrations ON public.domain_events;
CREATE TRIGGER trg_route_domain_event_to_integrations
  AFTER INSERT ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_route_domain_event_to_integrations();

-- Claim paczki do wysyłki: SKIP LOCKED, więc równolegli dispatcherzy się nie
-- gryzą. Wyłącznie service_role (dispatcher serwerowy).
CREATE OR REPLACE FUNCTION public.claim_integration_deliveries(p_limit integer DEFAULT 20)
RETURNS SETOF public.integration_deliveries
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.integration_deliveries d
     SET status = 'delivering', attempts = d.attempts + 1
   WHERE d.id IN (
     SELECT i.id FROM public.integration_deliveries i
      WHERE i.status IN ('queued', 'failed') AND i.next_attempt_at <= now()
      ORDER BY i.next_attempt_at ASC
      LIMIT GREATEST(1, LEAST(p_limit, 100))
        FOR UPDATE SKIP LOCKED
   )
  RETURNING d.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_integration_delivery(
  p_id uuid, p_succeeded boolean, p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_succeeded THEN
    UPDATE public.integration_deliveries
       SET status = 'delivered', delivered_at = now(), last_error = NULL
     WHERE id = p_id;
  ELSE
    UPDATE public.integration_deliveries
       SET status = CASE WHEN attempts >= 8 THEN 'dead' ELSE 'failed' END,
           last_error = left(COALESCE(p_error, 'unknown error'), 500),
           -- Backoff wykładniczy: 2, 4, 8... minut, sufit 12 h.
           next_attempt_at = now() + LEAST(
             interval '12 hours',
             interval '1 minute' * power(2, LEAST(attempts, 10))
           )
     WHERE id = p_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_integration_deliveries(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_integration_delivery(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_integration_deliveries(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_integration_delivery(uuid, boolean, text) TO service_role;

-- Sprzątanie: dostarczone po 14 dniach, martwe po 30.
CREATE OR REPLACE FUNCTION public.prune_integration_deliveries()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.integration_deliveries
   WHERE (status = 'delivered' AND delivered_at < now() - interval '14 days')
      OR (status = 'dead' AND created_at < now() - interval '30 days');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_integration_deliveries() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_integration_deliveries() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('prune-command-idempotency', '40 3 * * *',
      'SELECT public.prune_command_idempotency()');
    PERFORM cron.schedule('prune-integration-deliveries', '50 3 * * *',
      'SELECT public.prune_integration_deliveries()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;
