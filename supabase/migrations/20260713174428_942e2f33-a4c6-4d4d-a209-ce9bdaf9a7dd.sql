-- PR #25: Membership as digital product (schema+funcs; storage bucket handled separately)

CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         v.benefits, v.features, v.is_default, v.sort_order
    FROM (VALUES
      ('reader', 0, 'Konto bezpłatne', 'Free account',
       'Zapisywanie i personalizacja: zakładki, obserwowanie tematów i udział w dyskusjach.',
       'Saving and personalisation: bookmarks, topic follows and joining the discussion.',
       '[{"pl":"Zapisywanie materiałów i lista do przeczytania","en":"Saved items and a reading list"},{"pl":"Personalizacja: zainteresowania i obserwowane tematy","en":"Personalisation: interests and followed topics"},{"pl":"Udział w dyskusjach i ankietach","en":"Join discussions and polls"}]'::jsonb,
       '{}'::jsonb, true, 0),
      ('supporter', 5, 'Wspierający', 'Supporter',
       'Darowizna wspiera niezależność instytutu; wspierający otrzymują dedykowane aktualizacje.',
       'A donation supports the institute''s independence; supporters receive dedicated updates.',
       '[{"pl":"Wszystko z konta bezpłatnego","en":"Everything in the free account"},{"pl":"Aktualizacje i podsumowania dla wspierających","en":"Supporter updates and briefings"},{"pl":"Status wspierającego przez 12 miesięcy od darowizny","en":"Supporter status for 12 months after a donation"}]'::jsonb,
       '{"supporter_updates": true}'::jsonb, false, 5),
      ('member', 10, 'Członek indywidualny', 'Individual member',
       'Zamknięte treści i wydarzenia: pełny dostęp do analiz, briefingów i biblioteki materiałów.',
       'Closed content and events: full access to analyses, briefings and the members'' library.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},{"pl":"Wydarzenia i briefingi dla członków","en":"Member events and briefings"},{"pl":"Pierwszeństwo rejestracji na wydarzenia","en":"Priority event registration"},{"pl":"Biblioteka materiałów do pobrania","en":"Downloadable members'' library"},{"pl":"Nagrania z wydarzeń","en":"Event recordings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "member_library": true}'::jsonb, false, 10),
      ('pro', 20, 'Członek ekspercki', 'Expert member',
       'Dla ekspertów i profesjonalistów public affairs: wszystko z członkostwa indywidualnego plus grupy robocze.',
       'For experts and public-affairs professionals: everything in individual membership plus working groups.',
       '[{"pl":"Wszystko z członkostwa indywidualnego","en":"Everything in individual membership"},{"pl":"Udział w grupach roboczych","en":"Participation in working groups"},{"pl":"Priorytet pytań w sesjach Q&A","en":"Priority in expert Q&A"},{"pl":"Zamknięte briefingi eksperckie","en":"Closed-door expert briefings"},{"pl":"Tracker legislacyjny z alertami","en":"Legislative tracker with alerts"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true}'::jsonb, false, 20),
      ('corporate', 30, 'Członek korporacyjny', 'Corporate member',
       'Dla instytucji i firm: wiele kont dla zespołu oraz briefingi i wydarzenia dla członków.',
       'For institutions and companies: multiple team seats plus member briefings and events.',
       '[{"pl":"Wiele kont dla zespołu (miejsca w organizacji)","en":"Multiple team accounts (organisation seats)"},{"pl":"Wszystko z członkostwa eksperckiego","en":"Everything in expert membership"},{"pl":"Briefingi i wydarzenia dla członków","en":"Member briefings and events"},{"pl":"Wspólna biblioteka materiałów","en":"Shared members'' library"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true}'::jsonb, false, 30),
      ('partner', 40, 'Partner strategiczny', 'Strategic partner',
       'Relacja instytucjonalna: partnerstwo programowe, dedykowane briefingi i wspólne projekty.',
       'An institutional relationship: programme partnership, dedicated briefings and joint projects.',
       '[{"pl":"Wszystko z członkostwa korporacyjnego","en":"Everything in corporate membership"},{"pl":"Relacja instytucjonalna i wspólne projekty","en":"Institutional relationship and joint projects"},{"pl":"Dedykowane briefingi dla partnera","en":"Dedicated partner briefings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "strategic_partner": true}'::jsonb, false, 40)
    ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features, is_default, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM public.membership_tiers mt WHERE mt.tenant_id = p_tenant AND mt.key = v.key);
$$;
REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;

DO $$ DECLARE v_t uuid; BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP PERFORM public.seed_membership_tiers(v_t); END LOOP;
END $$;

UPDATE public.membership_tiers SET name_pl='Konto bezpłatne', name_en='Free account',
  description_pl='Zapisywanie i personalizacja: zakładki, obserwowanie tematów i udział w dyskusjach.',
  description_en='Saving and personalisation: bookmarks, topic follows and joining the discussion.'
 WHERE key='reader' AND name_pl='Czytelnik' AND name_en='Reader';
UPDATE public.membership_tiers SET name_pl='Członek indywidualny', name_en='Individual member'
 WHERE key='member' AND name_pl='Członek' AND name_en='Member';
UPDATE public.membership_tiers SET name_pl='Członek ekspercki', name_en='Expert member'
 WHERE key='pro' AND name_pl='Pro' AND name_en='Pro';
UPDATE public.membership_tiers SET features = features || '{"member_library": true}'::jsonb
 WHERE key IN ('member','pro') AND NOT (features ? 'member_library');
UPDATE public.membership_tiers SET features = features || '{"working_groups": true}'::jsonb
 WHERE key='pro' AND NOT (features ? 'working_groups');

CREATE TABLE IF NOT EXISTS public.membership_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_key text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','donation','import')),
  source_donation_id uuid REFERENCES public.donations(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR length(btrim(note)) <= 300),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, tier_key) REFERENCES public.membership_tiers (tenant_id, key) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_membership_grants_user ON public.membership_grants (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_membership_grants_tenant ON public.membership_grants (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_grants_donation ON public.membership_grants (tenant_id, user_id) WHERE source='donation' AND revoked_at IS NULL;
DROP TRIGGER IF EXISTS membership_grants_set_updated_at ON public.membership_grants;
CREATE TRIGGER membership_grants_set_updated_at BEFORE UPDATE ON public.membership_grants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_grants TO authenticated;
GRANT ALL ON public.membership_grants TO service_role;
ALTER TABLE public.membership_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "grants own read" ON public.membership_grants;
CREATE POLICY "grants own read" ON public.membership_grants FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS "grants admin read" ON public.membership_grants;
CREATE POLICY "grants admin read" ON public.membership_grants FOR SELECT TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()),'admin'::app_role));
DROP POLICY IF EXISTS "grants admin write" ON public.membership_grants;
CREATE POLICY "grants admin write" ON public.membership_grants FOR ALL TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()),'admin'::app_role))
  WITH CHECK (tenant_id=(SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.admin_grant_membership(p_email text, p_tier_key text, p_months integer DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid := public.assert_admin_tenant(); v_user uuid; v_id uuid;
BEGIN
  IF p_months IS NOT NULL AND (p_months<1 OR p_months>120) THEN RAISE EXCEPTION 'grants: months out of range'; END IF;
  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email)=lower(btrim(p_email)) LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'grants: user not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membership_tiers WHERE tenant_id=v_tenant AND key=p_tier_key AND active) THEN
    RAISE EXCEPTION 'grants: tier not found'; END IF;
  INSERT INTO public.membership_grants (tenant_id,user_id,tier_key,source,note,granted_by,expires_at)
  VALUES (v_tenant, v_user, p_tier_key, 'manual', NULLIF(btrim(COALESCE(p_note,'')),''), auth.uid(),
          CASE WHEN p_months IS NULL THEN NULL ELSE now() + make_interval(months => p_months) END)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_grant_membership(text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_membership(text, text, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_membership_grants()
RETURNS TABLE (id uuid, user_id uuid, email text, display_name text, tier_key text, source text, note text,
  starts_at timestamptz, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mg.id, mg.user_id, u.email, p.display_name, mg.tier_key, mg.source, mg.note, mg.starts_at, mg.expires_at, mg.revoked_at, mg.created_at
    FROM public.membership_grants mg JOIN auth.users u ON u.id=mg.user_id
    LEFT JOIN public.profiles p ON p.id=mg.user_id
   WHERE mg.tenant_id=public.assert_admin_tenant()
   ORDER BY mg.created_at DESC LIMIT 500;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_membership_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_membership_grants() TO authenticated, service_role;

ALTER TABLE public.donations ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_donations_user ON public.donations (user_id) WHERE user_id IS NOT NULL;
DROP POLICY IF EXISTS "donations own read" ON public.donations;
CREATE POLICY "donations own read" ON public.donations FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_donations_grant_supporter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_grant public.membership_grants%ROWTYPE;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.status='refunded' AND OLD.status='paid' THEN
    UPDATE public.membership_grants SET revoked_at=now() WHERE source_donation_id=NEW.id AND revoked_at IS NULL;
    RETURN NEW; END IF;
  IF NEW.status <> 'paid' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membership_tiers WHERE tenant_id=NEW.tenant_id AND key='supporter' AND active) THEN RETURN NEW; END IF;
  SELECT * INTO v_grant FROM public.membership_grants
   WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND source='donation' AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
    UPDATE public.membership_grants
       SET expires_at = GREATEST(COALESCE(v_grant.expires_at, now()), now()) + interval '12 months',
           source_donation_id = NEW.id
     WHERE id = v_grant.id;
  ELSE
    INSERT INTO public.membership_grants (tenant_id,user_id,tier_key,source,source_donation_id,expires_at)
    VALUES (NEW.tenant_id, NEW.user_id, 'supporter','donation', NEW.id, now() + interval '12 months');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS donations_grant_supporter ON public.donations;
CREATE TRIGGER donations_grant_supporter AFTER INSERT OR UPDATE OF status, user_id ON public.donations
  FOR EACH ROW EXECUTE FUNCTION public.tg_donations_grant_supporter();

CREATE TABLE IF NOT EXISTS public.member_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  tier_key text NOT NULL DEFAULT 'corporate',
  seats_limit integer NOT NULL DEFAULT 5 CHECK (seats_limit BETWEEN 1 AND 500),
  contact_email text CHECK (contact_email IS NULL OR contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  note text CHECK (note IS NULL OR length(btrim(note)) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, tier_key) REFERENCES public.membership_tiers (tenant_id, key) ON UPDATE CASCADE,
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_member_orgs_tenant ON public.member_organizations (tenant_id, created_at DESC);
DROP TRIGGER IF EXISTS member_orgs_set_updated_at ON public.member_organizations;
CREATE TRIGGER member_orgs_set_updated_at BEFORE UPDATE ON public.member_organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.organization_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.member_organizations(id) ON DELETE CASCADE,
  invited_email text NOT NULL CHECK (invited_email = lower(btrim(invited_email)) AND invited_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, invited_email)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_seats_user ON public.organization_seats (org_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_seats_user ON public.organization_seats (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_seats_email ON public.organization_seats (invited_email);

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_seats os WHERE os.org_id=p_org AND os.user_id=auth.uid() AND os.role='owner');
$$;
REVOKE EXECUTE ON FUNCTION public.is_org_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_organizations TO authenticated;
GRANT ALL ON public.member_organizations TO service_role;
ALTER TABLE public.member_organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orgs admin all" ON public.member_organizations;
CREATE POLICY "orgs admin all" ON public.member_organizations FOR ALL TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()),'admin'::app_role))
  WITH CHECK (tenant_id=(SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()),'admin'::app_role));
DROP POLICY IF EXISTS "orgs seat read" ON public.member_organizations;
CREATE POLICY "orgs seat read" ON public.member_organizations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.organization_seats os WHERE os.org_id=member_organizations.id AND os.user_id=(SELECT auth.uid())));

GRANT SELECT, UPDATE, DELETE ON public.organization_seats TO authenticated;
GRANT ALL ON public.organization_seats TO service_role;
ALTER TABLE public.organization_seats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "seats admin all" ON public.organization_seats;
CREATE POLICY "seats admin all" ON public.organization_seats FOR ALL TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()),'admin'::app_role))
  WITH CHECK (tenant_id=(SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()),'admin'::app_role));
DROP POLICY IF EXISTS "seats own read" ON public.organization_seats;
CREATE POLICY "seats own read" ON public.organization_seats FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS "seats owner read" ON public.organization_seats;
CREATE POLICY "seats owner read" ON public.organization_seats FOR SELECT TO authenticated USING (public.is_org_owner(org_id));
DROP POLICY IF EXISTS "seats owner delete" ON public.organization_seats;
CREATE POLICY "seats owner delete" ON public.organization_seats FOR DELETE TO authenticated USING (public.is_org_owner(org_id) AND role <> 'owner');

CREATE OR REPLACE FUNCTION public.org_add_seat(p_org uuid, p_email text, p_role text DEFAULT 'member')
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_org public.member_organizations%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email,''))); v_user uuid; v_used integer; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;
  IF p_role NOT IN ('owner','member') THEN RAISE EXCEPTION 'orgs: invalid role'; END IF;
  IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'orgs: invalid email'; END IF;
  SELECT * INTO v_org FROM public.member_organizations WHERE id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;
  IF NOT (public.has_role(v_uid,'admin'::app_role) OR public.is_org_owner(p_org)) THEN RAISE EXCEPTION 'orgs: not allowed'; END IF;
  IF p_role='owner' AND NOT public.has_role(v_uid,'admin'::app_role) THEN RAISE EXCEPTION 'orgs: not allowed'; END IF;
  IF v_org.status <> 'active' THEN RAISE EXCEPTION 'orgs: organization inactive'; END IF;
  SELECT count(*) INTO v_used FROM public.organization_seats WHERE org_id=p_org;
  IF v_used >= v_org.seats_limit THEN RAISE EXCEPTION 'orgs: seats limit reached'; END IF;
  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email)=v_email LIMIT 1;
  INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, user_id, role, claimed_at)
  VALUES (v_org.tenant_id, p_org, v_email, v_user, p_role, CASE WHEN v_user IS NULL THEN NULL ELSE now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'orgs: seat exists';
END; $$;
REVOKE EXECUTE ON FUNCTION public.org_add_seat(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_add_seat(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_my_org_seats() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id=v_uid;
  IF v_email IS NULL THEN RETURN 0; END IF;
  UPDATE public.organization_seats os SET user_id=v_uid, claimed_at=now()
   WHERE os.user_id IS NULL AND os.invited_email=v_email
     AND NOT EXISTS (SELECT 1 FROM public.organization_seats dup WHERE dup.org_id=os.org_id AND dup.user_id=v_uid);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
REVOKE EXECUTE ON FUNCTION public.claim_my_org_seats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_org_seats() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_organization()
RETURNS TABLE (org_id uuid, name text, tier_key text, my_role text, status text,
  seats_limit integer, seats_used integer, starts_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mo.id, mo.name, mo.tier_key, os.role, mo.status, mo.seats_limit,
         (SELECT count(*)::integer FROM public.organization_seats s WHERE s.org_id=mo.id),
         mo.starts_at, mo.expires_at
    FROM public.organization_seats os
    JOIN public.member_organizations mo ON mo.id=os.org_id
    LEFT JOIN public.membership_tiers mt ON mt.tenant_id=mo.tenant_id AND mt.key=mo.tier_key
   WHERE os.user_id=auth.uid()
     AND mo.tenant_id=COALESCE(public.public_tenant_id(), public.current_tenant_id())
   ORDER BY COALESCE(mt.rank,0) DESC, mo.created_at ASC LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.my_organization() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_organization() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_membership_tier()
RETURNS TABLE (key text, rank integer, name_pl text, name_en text, features jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT COALESCE(public.public_tenant_id(), public.current_tenant_id()) AS tid),
  entitled AS (
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.user_subscriptions us JOIN public.access_plans ap ON ap.id=us.plan_id
      JOIN t ON ap.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=ap.tenant_id AND mt.key=ap.tier_key AND mt.active
     WHERE us.user_id=auth.uid() AND us.status='active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
    UNION ALL
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.membership_grants mg JOIN t ON mg.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=mg.tenant_id AND mt.key=mg.tier_key AND mt.active
     WHERE mg.user_id=auth.uid() AND mg.revoked_at IS NULL AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
    UNION ALL
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.organization_seats os JOIN public.member_organizations mo ON mo.id=os.org_id
      JOIN t ON mo.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=mo.tenant_id AND mt.key=mo.tier_key AND mt.active
     WHERE os.user_id=auth.uid() AND mo.status='active' AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
  ),
  best AS (SELECT * FROM entitled ORDER BY rank DESC LIMIT 1),
  def AS (SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
            FROM public.membership_tiers mt JOIN t ON mt.tenant_id=t.tid
           WHERE mt.is_default AND mt.active LIMIT 1)
  SELECT * FROM best
  UNION ALL SELECT * FROM def WHERE NOT EXISTS (SELECT 1 FROM best)
  UNION ALL SELECT 'reader',0,'Konto bezpłatne','Free account','{}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM best) AND NOT EXISTS (SELECT 1 FROM def);
$$;

CREATE OR REPLACE FUNCTION public.user_has_tier_feature(p_user uuid, _feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_subscriptions us JOIN public.access_plans ap ON ap.id=us.plan_id
      JOIN public.membership_tiers mt ON mt.tenant_id=ap.tenant_id AND mt.key=ap.tier_key AND mt.active
     WHERE us.user_id=p_user AND us.status='active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
       AND (mt.features->>_feature)::boolean IS TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.membership_grants mg
      JOIN public.membership_tiers mt ON mt.tenant_id=mg.tenant_id AND mt.key=mg.tier_key AND mt.active
     WHERE mg.user_id=p_user AND mg.revoked_at IS NULL AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
       AND (mt.features->>_feature)::boolean IS TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.organization_seats os JOIN public.member_organizations mo ON mo.id=os.org_id
      JOIN public.membership_tiers mt ON mt.tenant_id=mo.tenant_id AND mt.key=mo.tier_key AND mt.active
     WHERE os.user_id=p_user AND mo.status='active' AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
       AND (mt.features->>_feature)::boolean IS TRUE
  );
$$;
REVOKE EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.user_tier_rank(p_user uuid, p_tenant uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT COALESCE(p_tenant, public.public_tenant_id(), public.current_tenant_id()) AS tid),
  entitled AS (
    SELECT mt.rank FROM public.user_subscriptions us JOIN public.access_plans ap ON ap.id=us.plan_id
      JOIN t ON ap.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=ap.tenant_id AND mt.key=ap.tier_key AND mt.active
     WHERE us.user_id=p_user AND us.status='active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
    UNION ALL
    SELECT mt.rank FROM public.membership_grants mg JOIN t ON mg.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=mg.tenant_id AND mt.key=mg.tier_key AND mt.active
     WHERE mg.user_id=p_user AND mg.revoked_at IS NULL AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
    UNION ALL
    SELECT mt.rank FROM public.organization_seats os JOIN public.member_organizations mo ON mo.id=os.org_id
      JOIN t ON mo.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=mo.tenant_id AND mt.key=mo.tier_key AND mt.active
     WHERE os.user_id=p_user AND mo.status='active' AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
  )
  SELECT COALESCE((SELECT max(rank) FROM entitled),
    (SELECT mt.rank FROM public.membership_tiers mt JOIN t ON mt.tenant_id=t.tid WHERE mt.is_default AND mt.active LIMIT 1), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.user_tier_rank(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_tier_rank(uuid, uuid) TO service_role;

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS rsvp_opens_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS early_rsvp_rank integer;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_early_rsvp_rank_check;
ALTER TABLE public.events ADD CONSTRAINT events_early_rsvp_rank_check CHECK (early_rsvp_rank IS NULL OR early_rsvp_rank >= 0);
GRANT SELECT (rsvp_opens_at, early_rsvp_rank) ON public.events TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_event public.events%ROWTYPE; v_going integer; v_min_rank integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'events: authentication required'; END IF;
  IF p_status NOT IN ('going','interested','cancelled') THEN RAISE EXCEPTION 'events: invalid status'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND tenant_id=public.public_tenant_id() AND status='published' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'events: not found'; END IF;
  IF v_event.visibility='members' THEN
    IF v_event.kind='briefing' THEN
      IF NOT public.has_tier_feature('pro_briefings') THEN RAISE EXCEPTION 'events: membership required'; END IF;
    ELSE
      v_min_rank := GREATEST(COALESCE(v_event.min_tier_rank,0),1);
      IF NOT public.has_tier_rank(v_min_rank) THEN RAISE EXCEPTION 'events: membership required'; END IF;
    END IF;
  END IF;
  IF p_status <> 'cancelled' AND v_event.rsvp_opens_at IS NOT NULL AND now() < v_event.rsvp_opens_at THEN
    IF v_event.early_rsvp_rank IS NULL OR NOT public.has_tier_rank(v_event.early_rsvp_rank) THEN
      RAISE EXCEPTION 'events: rsvp not open';
    END IF;
  END IF;
  IF p_status='going' AND v_event.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_going FROM public.event_rsvps WHERE event_id=p_event_id AND status='going' AND user_id <> v_user;
    IF v_going >= v_event.capacity THEN RAISE EXCEPTION 'events: full'; END IF;
  END IF;
  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status)
  VALUES (v_event.tenant_id, p_event_id, v_user, p_status)
  ON CONFLICT (event_id, user_id) DO UPDATE SET status=EXCLUDED.status, updated_at=now();
  SELECT count(*) INTO v_going FROM public.event_rsvps WHERE event_id=p_event_id AND status='going';
  RETURN jsonb_build_object('status', p_status, 'going', v_going);
END; $$;
REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.member_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  description_pl text,
  description_en text,
  category text NOT NULL DEFAULT 'report' CHECK (category IN ('report','brief','transcript','slides','data','other')),
  file_path text NOT NULL CHECK (file_path ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{2,299}$'),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  file_size bigint CHECK (file_size IS NULL OR file_size > 0),
  mime_type text,
  min_tier_rank integer NOT NULL DEFAULT 10 CHECK (min_tier_rank >= 0),
  published boolean NOT NULL DEFAULT false,
  download_count integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(title_pl) <> '' AND btrim(title_en) <> '')
);
CREATE INDEX IF NOT EXISTS idx_member_resources_tenant ON public.member_resources (tenant_id, sort_order, created_at DESC) WHERE published;
DROP TRIGGER IF EXISTS member_resources_set_updated_at ON public.member_resources;
CREATE TRIGGER member_resources_set_updated_at BEFORE UPDATE ON public.member_resources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
GRANT SELECT ON public.member_resources TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.member_resources TO authenticated;
GRANT ALL ON public.member_resources TO service_role;
ALTER TABLE public.member_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "resources public read" ON public.member_resources;
CREATE POLICY "resources public read" ON public.member_resources FOR SELECT TO anon, authenticated
  USING (published AND tenant_id=(SELECT public.public_tenant_id()));
DROP POLICY IF EXISTS "resources staff read" ON public.member_resources;
CREATE POLICY "resources staff read" ON public.member_resources FOR SELECT TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id()) AND (public.has_role((SELECT auth.uid()),'admin'::app_role) OR public.has_role((SELECT auth.uid()),'editor'::app_role)));
DROP POLICY IF EXISTS "resources staff write" ON public.member_resources;
CREATE POLICY "resources staff write" ON public.member_resources FOR ALL TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id()) AND (public.has_role((SELECT auth.uid()),'admin'::app_role) OR public.has_role((SELECT auth.uid()),'editor'::app_role)))
  WITH CHECK (tenant_id=(SELECT public.current_tenant_id()) AND (public.has_role((SELECT auth.uid()),'admin'::app_role) OR public.has_role((SELECT auth.uid()),'editor'::app_role)));

CREATE TABLE IF NOT EXISTS public.resource_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.member_resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resource_downloads_user ON public.resource_downloads (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_downloads_resource ON public.resource_downloads (resource_id);
GRANT SELECT ON public.resource_downloads TO authenticated;
GRANT ALL ON public.resource_downloads TO service_role;
ALTER TABLE public.resource_downloads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "downloads own read" ON public.resource_downloads;
CREATE POLICY "downloads own read" ON public.resource_downloads FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS "downloads admin read" ON public.resource_downloads;
CREATE POLICY "downloads admin read" ON public.resource_downloads FOR SELECT TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_resource_download_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.member_resources SET download_count=download_count+1 WHERE id=NEW.resource_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS resource_downloads_count ON public.resource_downloads;
CREATE TRIGGER resource_downloads_count AFTER INSERT ON public.resource_downloads FOR EACH ROW EXECUTE FUNCTION public.tg_resource_download_count();

CREATE OR REPLACE FUNCTION public.authorize_resource_download(p_resource uuid)
RETURNS TABLE (file_path text, file_name text, mime_type text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_res public.member_resources%ROWTYPE; v_staff boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'resources: authentication required'; END IF;
  SELECT * INTO v_res FROM public.member_resources WHERE id=p_resource
    AND tenant_id=COALESCE(public.public_tenant_id(), public.current_tenant_id());
  IF NOT FOUND THEN RAISE EXCEPTION 'resources: not found'; END IF;
  v_staff := public.has_role(v_user,'admin'::app_role) OR public.has_role(v_user,'editor'::app_role);
  IF NOT v_res.published AND NOT v_staff THEN RAISE EXCEPTION 'resources: not found'; END IF;
  IF NOT v_staff AND NOT public.has_tier_rank(v_res.min_tier_rank) THEN RAISE EXCEPTION 'resources: tier required'; END IF;
  INSERT INTO public.resource_downloads (tenant_id, resource_id, user_id) VALUES (v_res.tenant_id, v_res.id, v_user);
  RETURN QUERY SELECT v_res.file_path, v_res.file_name, v_res.mime_type;
END; $$;
REVOKE EXECUTE ON FUNCTION public.authorize_resource_download(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_resource_download(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_event_participation()
RETURNS TABLE (event_id uuid, slug text, title_pl text, title_en text, kind text,
  starts_at timestamptz, ends_at timestamptz, event_status text, rsvp_status text, rsvp_updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.kind, e.starts_at, e.ends_at, e.status, r.status, r.updated_at
    FROM public.event_rsvps r JOIN public.events e ON e.id=r.event_id
   WHERE r.user_id=auth.uid() AND e.tenant_id=COALESCE(public.public_tenant_id(), public.current_tenant_id())
   ORDER BY e.starts_at DESC LIMIT 200;
$$;
REVOKE EXECUTE ON FUNCTION public.my_event_participation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_event_participation() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_resource_downloads()
RETURNS TABLE (resource_id uuid, title_pl text, title_en text, category text, downloaded_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (rd.resource_id) rd.resource_id, mr.title_pl, mr.title_en, mr.category, rd.created_at
    FROM public.resource_downloads rd JOIN public.member_resources mr ON mr.id=rd.resource_id
   WHERE rd.user_id=auth.uid()
   ORDER BY rd.resource_id, rd.created_at DESC LIMIT 200;
$$;
REVOKE EXECUTE ON FUNCTION public.my_resource_downloads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_resource_downloads() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.newsletter_min_tier_emails(p_tenant uuid, p_min integer)
RETURNS TABLE (email text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT lower(u.email) FROM auth.users u
   WHERE u.email IS NOT NULL AND public.user_tier_rank(u.id, p_tenant) >= COALESCE(p_min, 0);
$$;
REVOKE EXECUTE ON FUNCTION public.newsletter_min_tier_emails(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_min_tier_emails(uuid, integer) TO service_role;