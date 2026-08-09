-- 1) Katalog domen: jaki plan członkostwa nadaje domena
ALTER TABLE public.verification_domains
  ADD COLUMN IF NOT EXISTS grants_tier_key text;

-- 2) Nowe źródło nadania: domena organizacji
ALTER TABLE public.membership_grants
  DROP CONSTRAINT IF EXISTS membership_grants_source_check;
ALTER TABLE public.membership_grants
  ADD CONSTRAINT membership_grants_source_check
  CHECK (source = ANY (ARRAY['manual','donation','import','expert','org_domain']));

CREATE UNIQUE INDEX IF NOT EXISTS membership_grants_org_domain_uniq
  ON public.membership_grants (tenant_id, user_id)
  WHERE source = 'org_domain' AND revoked_at IS NULL;

-- 3) Najwyższy plan nadawany przez domenę adresu e-mail
CREATE OR REPLACE FUNCTION public.verification_domain_tier(
  p_tenant_id uuid,
  p_email text,
  p_email_confirmed boolean
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mt.key
    FROM public.verification_domains vd
    JOIN public.membership_tiers mt
      ON mt.tenant_id = vd.tenant_id AND mt.key = vd.grants_tier_key AND mt.active
   WHERE vd.tenant_id = p_tenant_id
     AND vd.active
     AND vd.grants_tier_key IS NOT NULL
     AND p_email IS NOT NULL
     AND lower(split_part(p_email, '@', 2)) = vd.domain
     AND (p_email_confirmed OR NOT vd.require_email_confirmed)
   ORDER BY mt.rank DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verification_domain_tier(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verification_domain_tier(uuid, text, boolean) TO authenticated, service_role;

-- 4) Synchronizacja: odznaki + bezterminowe nadanie planu
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
  v_tier text;
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

  -- Członkostwo nadawane przez domenę organizacji (np. zespół NES -> VIP).
  v_tier := public.verification_domain_tier(v_tenant, v_email, v_confirmed);
  IF v_tier IS NOT NULL THEN
    UPDATE public.membership_grants
       SET tier_key = v_tier,
           expires_at = NULL,
           note = 'Domena organizacji: ' || lower(split_part(v_email, '@', 2)),
           updated_at = now()
     WHERE tenant_id = v_tenant AND user_id = p_user_id
       AND source = 'org_domain' AND revoked_at IS NULL;
    IF NOT FOUND THEN
      INSERT INTO public.membership_grants
        (tenant_id, user_id, tier_key, source, note, starts_at, expires_at)
      VALUES (v_tenant, p_user_id, v_tier, 'org_domain',
              'Domena organizacji: ' || lower(split_part(v_email, '@', 2)), now(), NULL);
    END IF;
  ELSE
    UPDATE public.membership_grants
       SET revoked_at = now(), updated_at = now()
     WHERE tenant_id = v_tenant AND user_id = p_user_id
       AND source = 'org_domain' AND revoked_at IS NULL;
  END IF;

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
    'verified', ('verified' = ANY (v_badges)),
    'tier', v_tier
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_org_verification(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_org_verification(uuid) TO service_role;

-- 5) Panel admina: zapis pola „nadawany plan"
CREATE OR REPLACE FUNCTION public.admin_upsert_verification_domain(
  p_domain text,
  p_badge text DEFAULT 'verified',
  p_note text DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_require_email_confirmed boolean DEFAULT true,
  p_grants_tier_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.admin_assert_verification_admin();
  v_domain text := lower(btrim(COALESCE(p_domain, '')));
  v_tier text := NULLIF(btrim(COALESCE(p_grants_tier_key, '')), '');
  v_id uuid;
BEGIN
  IF v_domain = '' OR v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'verification: invalid domain' USING ERRCODE = '22023';
  END IF;
  IF p_badge NOT IN ('verified', 'expert', 'staff', 'contributor') THEN
    RAISE EXCEPTION 'verification: unsupported badge' USING ERRCODE = '22023';
  END IF;
  IF v_tier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membership_tiers mt
     WHERE mt.tenant_id = v_tenant AND mt.key = v_tier AND mt.active
  ) THEN
    RAISE EXCEPTION 'verification: unknown membership tier' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.verification_domains
    (tenant_id, domain, badge, note, active, require_email_confirmed, grants_tier_key, created_by)
  VALUES (v_tenant, v_domain, p_badge, NULLIF(btrim(COALESCE(p_note, '')), ''),
          p_active, p_require_email_confirmed, v_tier, auth.uid())
  ON CONFLICT (tenant_id, domain, badge) DO UPDATE
    SET note = EXCLUDED.note,
        active = EXCLUDED.active,
        require_email_confirmed = EXCLUDED.require_email_confirmed,
        grants_tier_key = EXCLUDED.grants_tier_key,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_verification_domain(text, text, text, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_verification_domain(text, text, text, boolean, boolean, text) TO authenticated, service_role;

-- 6) Domeny NES nadają VIP (fallback: najwyższa aktywna warstwa, gdy brak klucza 'vip')
UPDATE public.verification_domains vd
   SET grants_tier_key = COALESCE(
         (SELECT mt.key FROM public.membership_tiers mt
           WHERE mt.tenant_id = vd.tenant_id AND mt.key = 'vip' AND mt.active),
         (SELECT mt.key FROM public.membership_tiers mt
           WHERE mt.tenant_id = vd.tenant_id AND mt.active
           ORDER BY mt.rank DESC LIMIT 1)),
       updated_at = now()
 WHERE vd.domain IN ('neweuropeanstrategies.com', 'neweustrategies.com');

-- 7) Przeliczenie istniejących kont
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id FROM public.profiles p
     WHERE lower(split_part(COALESCE(p.email, ''), '@', 2)) IN
           ('neweuropeanstrategies.com', 'neweustrategies.com')
  LOOP
    PERFORM public.sync_org_verification(r.id);
  END LOOP;
END $$;