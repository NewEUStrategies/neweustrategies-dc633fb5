-- ============================================================================
-- CRM Integracje wychodzące: wielu partnerów CRM bez migracji per odbiorca.
--
-- Dotychczas forwarding leadów znał JEDNEGO sztywnego partnera (Merydian) w
-- kolumnach crm_integrations (merydian_*): dodanie drugiego odbiorcy wymagało
-- migracji schematu, a wysyłka była synchronicznym fetch-em bez retry.
--
-- Nowy model - zgodnie z doktryną "jeden strumień integracji" (20260711203000):
--
--   1) crm_webhook_endpoints - PROFIL partnera CRM nad integration_endpoints
--      (1:1 po endpoint_id). Endpoint niesie transport (url, sekret w Vault,
--      event_types, enabled); profil niesie semantykę CRM: auth_kind
--      (hmac X-Signature | bearer), forward_stages (etapy auto-wysyłki),
--      consent_mapping (mapowanie zgód na pola partnera), workspace_id.
--      Dowolna liczba partnerów per tenant = INSERT, zero migracji.
--
--   2) Dostawy płyną ISTNIEJĄCYM outboxem integration_deliveries (claim ze
--      SKIP LOCKED, backoff wykładniczy, status dead po 8 próbach) - żadnej
--      drugiej kolejki. Router zdarzeń domenowych dostaje filtr etapów dla
--      endpointów z profilem CRM (crm_lead.* poza forward_stages nie trafia
--      do kolejki zamiast być odfiltrowane dopiero w dispatcherze).
--
--   3) crm_enqueue_lead_push - ręczny push leada ("Wyślij do partnera") jako
--      wpis outboxu (event 'crm_lead.pushed.v1'), świadomie POZA filtrem
--      etapów: jawna decyzja człowieka nadpisuje automat.
--
--   4) Dane istniejącej konfiguracji Merydian są przenoszone do nowego modelu
--      (osobne endpointy dla trybu webhook i API; sekrety KOPIOWANE w Vault,
--      żeby stara ścieżka RPC nie mogła osierocić nowych referencji).
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ----------------------------------------------------------------------------
-- 1) Rodzaj endpointu 'crm_partner' + tabela profili crm_webhook_endpoints
-- ----------------------------------------------------------------------------
ALTER TABLE public.integration_endpoints
  DROP CONSTRAINT IF EXISTS integration_endpoints_integration_check;
ALTER TABLE public.integration_endpoints
  ADD CONSTRAINT integration_endpoints_integration_check
  CHECK (integration IN ('webhook', 'slack', 'hubspot', 'gcal', 'confluence', 'crm_partner'));

CREATE TABLE IF NOT EXISTS public.crm_webhook_endpoints (
  endpoint_id uuid PRIMARY KEY
    REFERENCES public.integration_endpoints(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- hmac: podpis body w nagłówkach X-Signature + x-nes-signature (kontrakt
  -- Merydian); bearer: Authorization: Bearer <sekret z Vault>.
  auth_kind text NOT NULL DEFAULT 'hmac' CHECK (auth_kind IN ('hmac', 'bearer')),
  forward_stages public.crm_stage[] NOT NULL DEFAULT ARRAY['new']::public.crm_stage[],
  consent_mapping jsonb NOT NULL DEFAULT '[]'::jsonb,
  workspace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.crm_webhook_endpoints IS
  'CRM-partner profile (1:1) over integration_endpoints: stage auto-forward filter, consent mapping and auth flavour for outbound lead delivery via the integration_deliveries outbox.';

CREATE INDEX IF NOT EXISTS idx_crm_webhook_endpoints_tenant
  ON public.crm_webhook_endpoints (tenant_id);

-- Profil zawsze dziedziczy tenant endpointu-rodzica. BEFORE-trigger nadpisuje
-- tenant_id przed ewaluacją WITH CHECK polityki RLS, więc próba podpięcia
-- profilu pod endpoint innego tenanta kończy się odmową RLS (tenant profilu
-- staje się tenantem cudzego endpointu i nie przechodzi current_tenant_id()).
CREATE OR REPLACE FUNCTION public.tg_crm_webhook_endpoints_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant
    FROM public.integration_endpoints
   WHERE id = NEW.endpoint_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'endpoint_not_found';
  END IF;
  NEW.tenant_id := v_tenant;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_webhook_endpoints_bind_tenant
  ON public.crm_webhook_endpoints;
CREATE TRIGGER trg_crm_webhook_endpoints_bind_tenant
  BEFORE INSERT OR UPDATE ON public.crm_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_webhook_endpoints_bind_tenant();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_webhook_endpoints TO authenticated;
GRANT ALL ON public.crm_webhook_endpoints TO service_role;

ALTER TABLE public.crm_webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_webhook_endpoints_staff_all ON public.crm_webhook_endpoints;
CREATE POLICY crm_webhook_endpoints_staff_all
  ON public.crm_webhook_endpoints FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

-- ----------------------------------------------------------------------------
-- 2) Router zdarzeń: filtr etapów dla endpointów z profilem CRM
-- ----------------------------------------------------------------------------
-- Zmiana względem 20260711203000: LEFT JOIN na profil partnera. Automatyczne
-- zdarzenia leadowe (created/updated/stage_changed) trafiają do kolejki
-- endpointu-partnera tylko, gdy etap leada należy do forward_stages profilu.
-- Ręczny push (crm_lead.pushed.v1) oraz endpointy bez profilu - bez zmian.
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
  LEFT JOIN public.crm_webhook_endpoints c ON c.endpoint_id = e.id
  WHERE e.tenant_id = NEW.tenant_id
    AND e.enabled
    AND (cardinality(e.event_types) = 0 OR NEW.event_type = ANY (e.event_types))
    AND (
      c.endpoint_id IS NULL
      OR NEW.event_type NOT IN
        ('crm_lead.created.v1', 'crm_lead.updated.v1', 'crm_lead.stage_changed.v1')
      OR COALESCE(NEW.payload->>'new_stage', NEW.payload->>'stage')
        = ANY (c.forward_stages::text[])
    );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3) Ręczny push leada do partnerów przez outbox
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER (insert do integration_deliveries jest service-only), ale
-- zakres danych wyłącznie po current_tenant_id() + bramka is_staff() - zgodnie
-- z inwariantem tenant-scope (żadnego public_tenant_id w połączeniu z rolą).
CREATE OR REPLACE FUNCTION public.crm_enqueue_lead_push(
  p_lead_id uuid,
  p_endpoint_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.crm_leads%ROWTYPE;
  v_count integer;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead
    FROM public.crm_leads
   WHERE id = p_lead_id
     AND tenant_id = public.current_tenant_id();
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'lead_not_found';
  END IF;

  INSERT INTO public.integration_deliveries (
    tenant_id, endpoint_id, event_id, event_type, payload
  )
  SELECT
    v_lead.tenant_id, e.id, NULL, 'crm_lead.pushed.v1',
    jsonb_build_object(
      'id', NULL,
      'event_type', 'crm_lead.pushed.v1',
      'aggregate_type', 'crm_lead',
      'aggregate_id', v_lead.id::text,
      'payload', jsonb_build_object(
        'email', v_lead.email,
        'stage', v_lead.stage::text,
        'pushed_by', auth.uid()
      ),
      'correlation_id', NULL,
      'created_at', now()
    )
  FROM public.integration_endpoints e
  JOIN public.crm_webhook_endpoints c ON c.endpoint_id = e.id
  WHERE e.tenant_id = v_lead.tenant_id
    AND e.enabled
    AND e.integration = 'crm_partner'
    AND (p_endpoint_id IS NULL OR e.id = p_endpoint_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.crm_enqueue_lead_push(uuid, uuid) IS
  'Manual "push lead to CRM partner(s)": enqueues crm_lead.pushed.v1 deliveries in the integration outbox for every enabled crm_partner endpoint of the caller''s tenant (or one endpoint). Staff-gated; deliberately bypasses forward_stages - an explicit human action overrides the automation filter.';

REVOKE ALL ON FUNCTION public.crm_enqueue_lead_push(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_enqueue_lead_push(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Przeniesienie istniejącej konfiguracji Merydian do nowego modelu
-- ----------------------------------------------------------------------------
-- Sekrety są KOPIOWANE (vault.create_secret z odszyfrowanej wartości), nie
-- współdzielone po id: legacy RPC crm_set_merydian_secret przy czyszczeniu
-- robi DELETE FROM vault.secrets - współdzielona referencja osierociłaby
-- endpoint. Idempotencja: guard NOT EXISTS po (tenant, integration, url).
DO $$
DECLARE
  r record;
  v_endpoint uuid;
  v_secret uuid;
  v_api_url text;
  v_events text[] := ARRAY[
    'crm_lead.created.v1',
    'crm_lead.updated.v1',
    'crm_lead.stage_changed.v1',
    'crm_lead.pushed.v1'
  ];
BEGIN
  FOR r IN SELECT * FROM public.crm_integrations LOOP
    -- Tryb webhook: HMAC X-Signature na skonfigurowany URL.
    IF r.merydian_mode IN ('webhook', 'both')
       AND COALESCE(r.merydian_webhook_url, '') ~* '^https://'
       AND NOT EXISTS (
         SELECT 1 FROM public.integration_endpoints e
          WHERE e.tenant_id = r.tenant_id
            AND e.integration = 'crm_partner'
            AND e.url = r.merydian_webhook_url
       )
    THEN
      v_secret := NULL;
      IF r.merydian_webhook_secret_id IS NOT NULL THEN
        SELECT vault.create_secret(ds.decrypted_secret) INTO v_secret
          FROM vault.decrypted_secrets ds
         WHERE ds.id = r.merydian_webhook_secret_id;
      END IF;
      INSERT INTO public.integration_endpoints
        (tenant_id, name, integration, url, event_types, enabled, secret_id)
      VALUES
        (r.tenant_id, 'Merydian (webhook)', 'crm_partner', r.merydian_webhook_url,
         v_events, COALESCE(r.merydian_enabled, false), v_secret)
      RETURNING id INTO v_endpoint;
      INSERT INTO public.crm_webhook_endpoints
        (endpoint_id, tenant_id, auth_kind, forward_stages, consent_mapping, workspace_id)
      VALUES
        (v_endpoint, r.tenant_id, 'hmac',
         COALESCE(r.forward_stages, ARRAY['new']::public.crm_stage[]),
         COALESCE(r.consent_mapping, '[]'::jsonb),
         NULLIF(btrim(COALESCE(r.merydian_workspace_id, '')), ''));
    END IF;

    -- Tryb API: Bearer na <base>/leads.
    IF r.merydian_mode IN ('api', 'both')
       AND COALESCE(r.merydian_api_base, '') ~* '^https://'
    THEN
      v_api_url := rtrim(r.merydian_api_base, '/') || '/leads';
      IF NOT EXISTS (
        SELECT 1 FROM public.integration_endpoints e
         WHERE e.tenant_id = r.tenant_id
           AND e.integration = 'crm_partner'
           AND e.url = v_api_url
      ) THEN
        v_secret := NULL;
        IF r.merydian_api_key_id IS NOT NULL THEN
          SELECT vault.create_secret(ds.decrypted_secret) INTO v_secret
            FROM vault.decrypted_secrets ds
           WHERE ds.id = r.merydian_api_key_id;
        END IF;
        INSERT INTO public.integration_endpoints
          (tenant_id, name, integration, url, event_types, enabled, secret_id)
        VALUES
          (r.tenant_id, 'Merydian (API)', 'crm_partner', v_api_url,
           v_events, COALESCE(r.merydian_enabled, false), v_secret)
        RETURNING id INTO v_endpoint;
        INSERT INTO public.crm_webhook_endpoints
          (endpoint_id, tenant_id, auth_kind, forward_stages, consent_mapping, workspace_id)
        VALUES
          (v_endpoint, r.tenant_id, 'bearer',
           COALESCE(r.forward_stages, ARRAY['new']::public.crm_stage[]),
           COALESCE(r.consent_mapping, '[]'::jsonb),
           NULLIF(btrim(COALESCE(r.merydian_workspace_id, '')), ''));
      END IF;
    END IF;
  END LOOP;
EXCEPTION WHEN undefined_table THEN
  NULL; -- świeża baza bez crm_integrations: nic do przeniesienia
END $$;

COMMENT ON TABLE public.crm_integrations IS
  'DEPRECATED (2026-08-02): single-partner Merydian config superseded by crm_webhook_endpoints profiles over integration_endpoints. Kept for audit/history; the admin UI and dispatch no longer read it.';
