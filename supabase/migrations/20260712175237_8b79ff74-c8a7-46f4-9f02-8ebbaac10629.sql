CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.crm_integrations
  ADD COLUMN IF NOT EXISTS merydian_webhook_secret_id uuid,
  ADD COLUMN IF NOT EXISTS merydian_api_key_id uuid;

DO $$
DECLARE r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='crm_integrations' AND column_name='merydian_webhook_secret'
  ) THEN
    FOR r IN SELECT id, merydian_webhook_secret AS wsec, merydian_api_key AS akey,
                    merydian_webhook_secret_id AS wid, merydian_api_key_id AS aid
               FROM public.crm_integrations LOOP
      IF r.wsec IS NOT NULL AND r.wsec <> '' AND r.wid IS NULL THEN
        UPDATE public.crm_integrations SET merydian_webhook_secret_id = vault.create_secret(r.wsec) WHERE id=r.id;
      END IF;
      IF r.akey IS NOT NULL AND r.akey <> '' AND r.aid IS NULL THEN
        UPDATE public.crm_integrations SET merydian_api_key_id = vault.create_secret(r.akey) WHERE id=r.id;
      END IF;
    END LOOP;
  END IF;
END $$;

ALTER TABLE public.crm_integrations
  DROP COLUMN IF EXISTS merydian_webhook_secret,
  DROP COLUMN IF EXISTS merydian_api_key;

CREATE OR REPLACE FUNCTION public.crm_set_merydian_secret(_kind text, _plaintext text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE _tid uuid := public.current_tenant_id(); _id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _kind NOT IN ('webhook','api') THEN RAISE EXCEPTION 'invalid kind: %', _kind; END IF;
  INSERT INTO public.crm_integrations (tenant_id) VALUES (_tid) ON CONFLICT (tenant_id) DO NOTHING;
  IF _kind='webhook' THEN SELECT merydian_webhook_secret_id INTO _id FROM public.crm_integrations WHERE tenant_id=_tid;
  ELSE SELECT merydian_api_key_id INTO _id FROM public.crm_integrations WHERE tenant_id=_tid; END IF;
  IF _plaintext IS NULL OR _plaintext='' THEN
    IF _id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id=_id; END IF;
    IF _kind='webhook' THEN UPDATE public.crm_integrations SET merydian_webhook_secret_id=NULL WHERE tenant_id=_tid;
    ELSE UPDATE public.crm_integrations SET merydian_api_key_id=NULL WHERE tenant_id=_tid; END IF;
    RETURN;
  END IF;
  IF _id IS NULL THEN
    _id := vault.create_secret(_plaintext);
    IF _kind='webhook' THEN UPDATE public.crm_integrations SET merydian_webhook_secret_id=_id WHERE tenant_id=_tid;
    ELSE UPDATE public.crm_integrations SET merydian_api_key_id=_id WHERE tenant_id=_tid; END IF;
  ELSE PERFORM vault.update_secret(_id, _plaintext); END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.crm_get_merydian_secrets(_tenant uuid DEFAULT NULL)
RETURNS TABLE(webhook_secret text, api_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE _tid uuid := COALESCE(_tenant, public.current_tenant_id()); _wid uuid; _aid uuid;
BEGIN
  IF current_setting('role',true)<>'service_role' AND NOT public.is_super_admin()
     AND NOT (_tid = public.current_tenant_id() AND public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT merydian_webhook_secret_id, merydian_api_key_id INTO _wid,_aid FROM public.crm_integrations WHERE tenant_id=_tid;
  RETURN QUERY SELECT
    (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id=_wid)::text,
    (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id=_aid)::text;
END; $$;

REVOKE ALL ON FUNCTION public.crm_set_merydian_secret(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_get_merydian_secrets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_merydian_secret(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_get_merydian_secrets(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "cv owner read" ON storage.objects;
CREATE POLICY "cv owner read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='cv' AND array_length(storage.foldername(name),1) >= 3
  AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
);
DROP POLICY IF EXISTS "cv owner upload" ON storage.objects;
CREATE POLICY "cv owner upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='cv' AND array_length(storage.foldername(name),1) = 3
  AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id()::text)
  AND (storage.foldername(name))[2] = 'users'
  AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
);
DROP POLICY IF EXISTS "cv owner delete" ON storage.objects;
CREATE POLICY "cv owner delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='cv' AND array_length(storage.foldername(name),1) >= 3
  AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
);

CREATE TABLE IF NOT EXISTS public.newsletter_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES public.newsletter_subscribers(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('open','click')),
  url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.newsletter_campaign_events TO authenticated;
GRANT ALL ON public.newsletter_campaign_events TO service_role;
ALTER TABLE public.newsletter_campaign_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nl_campaign_events_staff_select" ON public.newsletter_campaign_events;
CREATE POLICY "nl_campaign_events_staff_select" ON public.newsletter_campaign_events
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));
CREATE INDEX IF NOT EXISTS nl_campaign_events_campaign_kind_idx ON public.newsletter_campaign_events (campaign_id, kind);
CREATE INDEX IF NOT EXISTS nl_campaign_events_tenant_created_idx ON public.newsletter_campaign_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ad_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES public.ad_slots(id) ON DELETE CASCADE,
  placement_id uuid REFERENCES public.ad_placements(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('impression','click')),
  path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ad_events TO authenticated;
GRANT ALL ON public.ad_events TO service_role;
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_events_staff_select" ON public.ad_events;
CREATE POLICY "ad_events_staff_select" ON public.ad_events
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));
CREATE INDEX IF NOT EXISTS ad_events_slot_kind_idx ON public.ad_events (tenant_id, slot_id, kind);
CREATE INDEX IF NOT EXISTS ad_events_tenant_created_idx ON public.ad_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.popup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  popup_id uuid NOT NULL REFERENCES public.builder_popups(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('view','conversion')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.popup_events TO authenticated;
GRANT ALL ON public.popup_events TO service_role;
ALTER TABLE public.popup_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "popup_events_staff_select" ON public.popup_events;
CREATE POLICY "popup_events_staff_select" ON public.popup_events
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));
CREATE INDEX IF NOT EXISTS popup_events_popup_kind_idx ON public.popup_events (tenant_id, popup_id, kind);
CREATE INDEX IF NOT EXISTS popup_events_tenant_created_idx ON public.popup_events (tenant_id, created_at DESC);