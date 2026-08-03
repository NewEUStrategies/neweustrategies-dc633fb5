ALTER TABLE public.user_consents
  ADD COLUMN IF NOT EXISTS gpc boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT public.current_tenant_id();

ALTER TABLE public.user_consent_events
  ADD COLUMN IF NOT EXISTS gpc boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT public.current_tenant_id();

COMMENT ON COLUMN public.user_consents.gpc IS
  'Czy w momencie ostatniej decyzji aktywny byl sygnal Global Privacy Control (Sec-GPC / navigator.globalPrivacyControl).';
COMMENT ON COLUMN public.user_consent_events.gpc IS
  'Czy w momencie tego zdarzenia aktywny byl sygnal Global Privacy Control. Zgoda z gpc = true zostala udzielona jako swiadomy override sygnalu.';
COMMENT ON COLUMN public.user_consents.tenant_id IS
  'Administrator danych, w ktorego obszarze podjeto decyzje. NULL = wiersz sprzed wdrozenia stempla. RLS pozostaje user-scoped.';
COMMENT ON COLUMN public.user_consent_events.tenant_id IS
  'Administrator danych, w ktorego obszarze podjeto decyzje. NULL = wiersz sprzed wdrozenia stempla. RLS pozostaje user-scoped.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_consents_tenant_id_fkey'
      AND conrelid = 'public.user_consents'::regclass
  ) THEN
    ALTER TABLE public.user_consents
      ADD CONSTRAINT user_consents_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_consent_events_tenant_id_fkey'
      AND conrelid = 'public.user_consent_events'::regclass
  ) THEN
    ALTER TABLE public.user_consent_events
      ADD CONSTRAINT user_consent_events_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_consent_events_gpc_idx
  ON public.user_consent_events (tenant_id, created_at DESC)
  WHERE gpc;

CREATE OR REPLACE FUNCTION public.set_user_consent(
  p_key text,
  p_given boolean,
  p_version text,
  p_gpc boolean,
  p_lang text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS public.user_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_gpc boolean := COALESCE(p_gpc, false);
  v_row public.user_consents;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'invalid_key';
  END IF;
  IF p_version IS NULL OR length(p_version) = 0 THEN
    RAISE EXCEPTION 'invalid_version';
  END IF;

  INSERT INTO public.user_consents AS uc
    (user_id, tenant_id, consent_key, given, version, lang, ip, user_agent, gpc,
     given_at, withdrawn_at)
  VALUES
    (v_uid, v_tenant, p_key, p_given, p_version, p_lang, p_ip, p_user_agent, v_gpc,
     CASE WHEN p_given THEN now() ELSE NULL END,
     CASE WHEN p_given THEN NULL ELSE now() END)
  ON CONFLICT (user_id, consent_key) DO UPDATE
    SET given = EXCLUDED.given,
        version = EXCLUDED.version,
        lang = COALESCE(EXCLUDED.lang, uc.lang),
        ip = EXCLUDED.ip,
        user_agent = EXCLUDED.user_agent,
        gpc = EXCLUDED.gpc,
        tenant_id = COALESCE(uc.tenant_id, EXCLUDED.tenant_id),
        given_at = CASE WHEN EXCLUDED.given THEN now() ELSE uc.given_at END,
        withdrawn_at = CASE WHEN EXCLUDED.given THEN NULL ELSE now() END
  RETURNING * INTO v_row;

  INSERT INTO public.user_consent_events
    (user_id, tenant_id, consent_key, given, version, lang, ip, user_agent, source, gpc)
  VALUES
    (v_uid, v_tenant, p_key, p_given, p_version, p_lang, p_ip, p_user_agent, p_source, v_gpc);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_consent(text, boolean, text, boolean, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, boolean, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, boolean, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_consent(
  p_key text,
  p_given boolean,
  p_version text,
  p_lang text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS public.user_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.set_user_consent(
    p_key => p_key,
    p_given => p_given,
    p_version => p_version,
    p_gpc => false,
    p_lang => p_lang,
    p_ip => p_ip,
    p_user_agent => p_user_agent,
    p_source => p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) TO authenticated;

DROP POLICY IF EXISTS "user_consents_insert_own" ON public.user_consents;
DROP POLICY IF EXISTS "user_consents_update_own" ON public.user_consents;
DROP POLICY IF EXISTS "user_consents_delete_own" ON public.user_consents;
DROP POLICY IF EXISTS "user_consent_events_insert_own" ON public.user_consent_events;

REVOKE INSERT, UPDATE, DELETE ON public.user_consents FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_consent_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_consents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.user_consent_events FROM anon;