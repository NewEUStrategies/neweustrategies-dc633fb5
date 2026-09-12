-- Atomic member -> CRM sync. Failed secondary writes remain retryable without
-- rolling back an already committed membership grant. Service-role RPCs only.
CREATE TABLE public.member_crm_sync_pending (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier_key text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('manual_grant', 'manual_revoke', 'backfill')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE public.member_crm_sync_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_crm_sync_pending FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.member_crm_sync_pending TO service_role;

CREATE OR REPLACE FUNCTION public.crm_member_company_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(regexp_replace(lower(btrim(p_name)), '[[:space:]]+', ' ', 'g'), '[.,]', '', 'g'),
    '\m(sp ?z ?o ?o|sa|ltd|llc|inc|gmbh)\M', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.crm_ensure_member_company(
  p_tenant_id uuid, p_name text, p_actor_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, created boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_key text := public.crm_member_company_key(p_name);
  v_id uuid;
  v_created boolean := false;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'crm: tenant required'; END IF;
  IF v_key IS NULL OR v_key = '' THEN RETURN; END IF;
  -- Serialize competing syncs for the same company without merging existing
  -- duplicate CRM records or constraining unrelated manual company editing.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':company:' || v_key, 0));
  SELECT c.id INTO v_id FROM public.crm_companies AS c
    WHERE c.tenant_id = p_tenant_id AND public.crm_member_company_key(c.name) = v_key
    ORDER BY c.created_at, c.id LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.crm_companies (tenant_id, name, created_by)
      VALUES (p_tenant_id, btrim(p_name), p_actor_id) RETURNING crm_companies.id INTO v_id;
    v_created := true;
  END IF;
  RETURN QUERY SELECT v_id, v_created;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_ensure_member_company(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ensure_member_company(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sync_member(
  p_user_id uuid, p_tenant_id uuid, p_tier_key text, p_actor_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_lead public.crm_leads%ROWTYPE;
  v_pending public.member_crm_sync_pending%ROWTYPE;
  v_reason text := p_reason;
  v_tier text := p_tier_key;
  v_actor uuid := p_actor_id;
  v_email text;
  v_company uuid;
  v_company_created boolean := false;
  v_tags text[];
  v_stage public.crm_stage;
BEGIN
  IF p_reason NOT IN ('manual_grant', 'manual_revoke', 'backfill') OR p_reason IS NULL THEN
    RAISE EXCEPTION 'crm: invalid sync reason';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'crm: profile outside tenant' USING ERRCODE = '42501'; END IF;
  v_email := lower(btrim(v_profile.email));
  IF v_email IS NULL OR v_email = '' THEN RETURN jsonb_build_object('status', 'skipped'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':member:' || v_email, 0));
  -- Backfill retries a pending membership transition before refreshing data.
  IF p_reason = 'backfill' THEN
    SELECT * INTO v_pending FROM public.member_crm_sync_pending
      WHERE tenant_id = p_tenant_id AND user_id = p_user_id FOR UPDATE;
    IF FOUND THEN
      v_reason := v_pending.reason; v_tier := v_pending.tier_key; v_actor := v_pending.actor_id;
    END IF;
  END IF;
  INSERT INTO public.member_crm_sync_pending (tenant_id, user_id, tier_key, actor_id, reason)
    VALUES (p_tenant_id, p_user_id, v_tier, v_actor, v_reason)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET tier_key = EXCLUDED.tier_key, actor_id = EXCLUDED.actor_id,
          reason = EXCLUDED.reason, requested_at = clock_timestamp();
  BEGIN
    SELECT c.id, c.created INTO v_company, v_company_created
      FROM public.crm_ensure_member_company(p_tenant_id, v_profile.current_company, v_actor) AS c;
    SELECT * INTO v_lead FROM public.crm_leads
      WHERE tenant_id = p_tenant_id AND email_norm = v_email FOR UPDATE;
    SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::text[]) INTO v_tags
      FROM (SELECT DISTINCT tag FROM unnest(COALESCE(v_lead.tags, ARRAY[]::text[])) AS tag
        WHERE v_reason = 'backfill' OR (tag NOT LIKE 'plan:%' AND tag <> 'membership:manual')) AS kept;
    IF v_tier IS NOT NULL AND v_reason <> 'backfill' THEN
      v_tags := v_tags || ARRAY['plan:' || v_tier, 'membership:manual'];
    END IF;
    v_stage := CASE
      WHEN v_reason = 'manual_grant' THEN 'won'
      WHEN v_reason = 'manual_revoke' AND v_lead.stage = 'won' THEN 'qualified'
      ELSE COALESCE(v_lead.stage, 'new') END;
    IF v_lead.id IS NULL THEN
      INSERT INTO public.crm_leads (tenant_id, email, email_norm, source_type)
        VALUES (p_tenant_id, v_email, v_email, CASE WHEN v_reason = 'backfill' THEN 'registered' ELSE 'manual' END)
        RETURNING id INTO v_lead.id;
    END IF;
    UPDATE public.crm_leads SET first_name = v_profile.first_name, last_name = v_profile.last_name,
      position = v_profile.job_title, company = v_profile.current_company,
      company_id = COALESCE(v_company, v_lead.company_id), linkedin_url = v_profile.linkedin_url,
      phone = v_profile.phone, tags = v_tags, stage = v_stage, last_activity_at = now()
      WHERE id = v_lead.id AND tenant_id = p_tenant_id;
    DELETE FROM public.member_crm_sync_pending WHERE tenant_id = p_tenant_id AND user_id = p_user_id;
    RETURN jsonb_build_object('status', 'synced', 'leadId', v_lead.id, 'stage', v_stage,
      'companyId', COALESCE(v_company, v_lead.company_id), 'companyName', v_profile.current_company,
      'companyCreated', COALESCE(v_company_created, false));
  EXCEPTION WHEN OTHERS THEN
    -- This block rolls back company/lead writes only. Retain the intent and
    -- a non-PII error code for the next explicit batch retry.
    UPDATE public.member_crm_sync_pending SET attempts = attempts + 1, last_error_code = SQLSTATE
      WHERE tenant_id = p_tenant_id AND user_id = p_user_id;
    RETURN jsonb_build_object('status', 'failed', 'errorCode', SQLSTATE);
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sync_member(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sync_member(uuid, uuid, text, uuid, text) TO service_role;
