CREATE TABLE IF NOT EXISTS public.verification_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  badge text NOT NULL DEFAULT 'verified',
  note text,
  active boolean NOT NULL DEFAULT true,
  require_email_confirmed boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_domains_badge_check
    CHECK (badge IN ('verified', 'expert', 'staff', 'contributor')),
  CONSTRAINT verification_domains_domain_check
    CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_domains_tenant_domain_badge_uniq
  ON public.verification_domains (tenant_id, domain, badge);

GRANT SELECT ON public.verification_domains TO authenticated;
GRANT ALL ON public.verification_domains TO service_role;

ALTER TABLE public.verification_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "verification domains staff read" ON public.verification_domains;
CREATE POLICY "verification domains staff read"
  ON public.verification_domains FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
    IF v_uid IS NOT NULL
       AND NOT public.has_role(v_uid, 'admin'::app_role)
       AND COALESCE(current_setting('app.verification_sync', true), '') <> 'on' THEN
      RAISE EXCEPTION 'profiles: verification can only be changed by an admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.verification_domain_badges(
  p_tenant_id uuid,
  p_email text,
  p_email_confirmed boolean
)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT vd.badge), ARRAY[]::text[])
    FROM public.verification_domains vd
   WHERE vd.tenant_id = p_tenant_id
     AND vd.active
     AND p_email IS NOT NULL
     AND lower(split_part(p_email, '@', 2)) = vd.domain
     AND (p_email_confirmed OR NOT vd.require_email_confirmed);
$$;

CREATE OR REPLACE FUNCTION public.sync_org_verification(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_email text;
  v_confirmed boolean := false;
  v_badges text[];
  v_badge text;
  v_granted text[] := ARRAY[]::text[];
  v_revoked text[] := ARRAY[]::text[];
BEGIN
  SELECT p.tenant_id, p.email INTO v_tenant, v_email
    FROM public.profiles p WHERE p.id = p_user_id;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('granted', to_jsonb(v_granted), 'revoked', to_jsonb(v_revoked), 'verified', false);
  END IF;

  SELECT (u.email_confirmed_at IS NOT NULL) INTO v_confirmed
    FROM auth.users u WHERE u.id = p_user_id;
  v_confirmed := COALESCE(v_confirmed, false);

  v_badges := public.verification_domain_badges(v_tenant, v_email, v_confirmed);

  FOREACH v_badge IN ARRAY v_badges LOOP
    INSERT INTO public.profile_badges (tenant_id, user_id, badge, grant_source, note)
    VALUES (v_tenant, p_user_id, v_badge, 'system',
            'Weryfikacja domeny organizacji: ' || lower(split_part(v_email, '@', 2)))
    ON CONFLICT (tenant_id, user_id, badge) DO NOTHING;
    IF FOUND THEN
      v_granted := v_granted || v_badge;
    END IF;
  END LOOP;

  FOR v_badge IN
    SELECT pb.badge FROM public.profile_badges pb
     WHERE pb.tenant_id = v_tenant
       AND pb.user_id = p_user_id
       AND pb.grant_source = 'system'
       AND NOT (pb.badge = ANY (v_badges))
  LOOP
    DELETE FROM public.profile_badges
     WHERE tenant_id = v_tenant AND user_id = p_user_id
       AND badge = v_badge AND grant_source = 'system';
    v_revoked := v_revoked || v_badge;
  END LOOP;

  PERFORM set_config('app.verification_sync', 'on', true);
  IF 'verified' = ANY (v_badges) THEN
    UPDATE public.profiles
       SET verified_at = COALESCE(verified_at, now())
     WHERE id = p_user_id AND verified_at IS NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.profile_badges pb
     WHERE pb.tenant_id = v_tenant AND pb.user_id = p_user_id AND pb.badge = 'verified'
  ) THEN
    UPDATE public.profiles
       SET verified_at = NULL, verified_by = NULL
     WHERE id = p_user_id AND verified_at IS NOT NULL AND verified_by IS NULL;
  END IF;
  PERFORM set_config('app.verification_sync', 'off', true);

  RETURN jsonb_build_object(
    'granted', to_jsonb(v_granted),
    'revoked', to_jsonb(v_revoked),
    'verified', ('verified' = ANY (v_badges))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_org_verification(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_org_verification(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_profiles_org_verification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.sync_org_verification(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'org verification sync failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profiles_org_verification_trg ON public.profiles;
CREATE TRIGGER profiles_org_verification_trg
  AFTER INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_org_verification();

CREATE OR REPLACE FUNCTION public.admin_assert_verification_admin()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL
     OR NOT (public.has_role(v_actor, 'admin'::app_role) OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'verification: admin role required' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_verification_domains()
RETURNS SETOF public.verification_domains
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.admin_assert_verification_admin();
BEGIN
  RETURN QUERY
    SELECT * FROM public.verification_domains
     WHERE tenant_id = v_tenant
     ORDER BY domain, badge;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_verification_domain(
  p_domain text,
  p_badge text DEFAULT 'verified',
  p_note text DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_require_email_confirmed boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.admin_assert_verification_admin();
  v_domain text := lower(btrim(COALESCE(p_domain, '')));
  v_id uuid;
BEGIN
  IF v_domain = '' OR v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'verification: invalid domain' USING ERRCODE = '22023';
  END IF;
  IF p_badge NOT IN ('verified', 'expert', 'staff', 'contributor') THEN
    RAISE EXCEPTION 'verification: unsupported badge' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.verification_domains
    (tenant_id, domain, badge, note, active, require_email_confirmed, created_by)
  VALUES (v_tenant, v_domain, p_badge, NULLIF(btrim(COALESCE(p_note, '')), ''),
          p_active, p_require_email_confirmed, auth.uid())
  ON CONFLICT (tenant_id, domain, badge) DO UPDATE
    SET note = EXCLUDED.note,
        active = EXCLUDED.active,
        require_email_confirmed = EXCLUDED.require_email_confirmed,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_verification_domain(p_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.admin_assert_verification_admin();
BEGIN
  DELETE FROM public.verification_domains
   WHERE id = p_id AND tenant_id = v_tenant;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_run_org_verification()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.admin_assert_verification_admin();
  v_row record;
  v_result jsonb;
  v_checked integer := 0;
  v_granted integer := 0;
  v_revoked integer := 0;
BEGIN
  FOR v_row IN
    SELECT p.id FROM public.profiles p WHERE p.tenant_id = v_tenant
  LOOP
    v_result := public.sync_org_verification(v_row.id);
    v_checked := v_checked + 1;
    v_granted := v_granted + jsonb_array_length(v_result -> 'granted');
    v_revoked := v_revoked + jsonb_array_length(v_result -> 'revoked');
  END LOOP;

  RETURN jsonb_build_object('checked', v_checked, 'granted', v_granted, 'revoked', v_revoked);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assert_verification_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_verification_domains() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_verification_domain(text, text, text, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_verification_domain(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_run_org_verification() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_verification_domains() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_verification_domain(text, text, text, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_verification_domain(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_run_org_verification() TO authenticated, service_role;

INSERT INTO public.verification_domains (tenant_id, domain, badge, note)
SELECT t.id, d.domain, 'verified',
       'Zespol i eksperci New European Strategies'
  FROM public.tenants t
  CROSS JOIN (VALUES ('neweuropeanstrategies.com'), ('neweustrategies.com')) AS d(domain)
ON CONFLICT (tenant_id, domain, badge) DO NOTHING;

DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.profiles LOOP
    PERFORM public.sync_org_verification(v_id);
  END LOOP;
END;
$$;