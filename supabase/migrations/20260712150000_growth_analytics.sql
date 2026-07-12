-- Growth analytics: newsletter open/click, ad impression/click, popup
-- conversion. Three append-only event sinks.
--
-- Write path: the public ingest routes write via the service role (RLS bypass);
-- there is intentionally NO insert policy, so anon/authenticated cannot forge
-- rows directly. Read path: staff (admin/editor) of the owning tenant only.
-- tenant_id defaults to public_tenant_id() as a safety net (the ingest routes
-- attribute each row explicitly - from the campaign for newsletter events, from
-- the browsed host for ad/popup events).

-- ---------------------------------------------------------------------------
-- A) Newsletter open/click
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.newsletter_campaign_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT public.public_tenant_id()
                  REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id   uuid NOT NULL REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES public.newsletter_subscribers(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('open','click')),
  url           text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.newsletter_campaign_events TO authenticated;
GRANT ALL ON public.newsletter_campaign_events TO service_role;

ALTER TABLE public.newsletter_campaign_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nl_campaign_events_staff_select" ON public.newsletter_campaign_events;
CREATE POLICY "nl_campaign_events_staff_select" ON public.newsletter_campaign_events
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

CREATE INDEX IF NOT EXISTS nl_campaign_events_campaign_kind_idx
  ON public.newsletter_campaign_events (campaign_id, kind);
CREATE INDEX IF NOT EXISTS nl_campaign_events_tenant_created_idx
  ON public.newsletter_campaign_events (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- B) Ad impression/click
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT public.public_tenant_id()
                 REFERENCES public.tenants(id) ON DELETE CASCADE,
  slot_id      uuid NOT NULL REFERENCES public.ad_slots(id) ON DELETE CASCADE,
  placement_id uuid REFERENCES public.ad_placements(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('impression','click')),
  path         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ad_events TO authenticated;
GRANT ALL ON public.ad_events TO service_role;

ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_events_staff_select" ON public.ad_events;
CREATE POLICY "ad_events_staff_select" ON public.ad_events
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

CREATE INDEX IF NOT EXISTS ad_events_slot_kind_idx
  ON public.ad_events (tenant_id, slot_id, kind);
CREATE INDEX IF NOT EXISTS ad_events_tenant_created_idx
  ON public.ad_events (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- C) Popup view/conversion
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.popup_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT public.public_tenant_id()
               REFERENCES public.tenants(id) ON DELETE CASCADE,
  popup_id   uuid NOT NULL REFERENCES public.builder_popups(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('view','conversion')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.popup_events TO authenticated;
GRANT ALL ON public.popup_events TO service_role;

ALTER TABLE public.popup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "popup_events_staff_select" ON public.popup_events;
CREATE POLICY "popup_events_staff_select" ON public.popup_events
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

CREATE INDEX IF NOT EXISTS popup_events_popup_kind_idx
  ON public.popup_events (tenant_id, popup_id, kind);
CREATE INDEX IF NOT EXISTS popup_events_tenant_created_idx
  ON public.popup_events (tenant_id, created_at DESC);
