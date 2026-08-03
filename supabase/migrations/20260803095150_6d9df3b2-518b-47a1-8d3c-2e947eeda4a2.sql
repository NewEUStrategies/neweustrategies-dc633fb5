-- ============================================================================
-- ODZNAKI PROFILOWE: jeden kontrakt, bezpieczne mutacje, zdarzenia domenowe
-- i automatyczne nadawanie za reputację. (PR #148)
-- ============================================================================

ALTER TABLE public.profile_badges
  ADD COLUMN IF NOT EXISTS grant_source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.profile_badges
  DROP CONSTRAINT IF EXISTS profile_badges_badge_check;
ALTER TABLE public.profile_badges
  ADD CONSTRAINT profile_badges_badge_check
  CHECK (badge IN ('verified', 'expert', 'staff', 'contributor'));

ALTER TABLE public.profile_badges
  DROP CONSTRAINT IF EXISTS profile_badges_grant_source_check;
ALTER TABLE public.profile_badges
  ADD CONSTRAINT profile_badges_grant_source_check
  CHECK (grant_source IN ('manual', 'reputation', 'contributor_submission', 'system'));

UPDATE public.profile_badges
   SET grant_source = 'contributor_submission'
 WHERE badge = 'contributor'
   AND note LIKE 'Przyjęte zgłoszenie:%'
   AND grant_source = 'manual';

CREATE INDEX IF NOT EXISTS idx_profile_badges_tenant_created
  ON public.profile_badges (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.tg_profile_badges_validate_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = NEW.user_id
       AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'profile_badges: user does not belong to tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profile_badges_validate_tenant ON public.profile_badges;
CREATE TRIGGER profile_badges_validate_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, user_id ON public.profile_badges
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_badges_validate_tenant();

CREATE OR REPLACE FUNCTION public.tg_profile_badges_granted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label_pl text;
  v_label_en text;
BEGIN
  IF NEW.grant_source = 'manual' AND NEW.granted_by IS NULL THEN
    NEW.granted_by := auth.uid();
  END IF;

  v_label_pl := CASE NEW.badge
    WHEN 'verified'    THEN 'Zweryfikowany profil'
    WHEN 'expert'      THEN 'Ekspert'
    WHEN 'contributor' THEN 'Autor gościnny'
    WHEN 'staff'       THEN 'Zespół redakcji'
  END;
  v_label_en := CASE NEW.badge
    WHEN 'verified'    THEN 'Verified profile'
    WHEN 'expert'      THEN 'Expert'
    WHEN 'contributor' THEN 'Guest contributor'
    WHEN 'staff'       THEN 'Editorial staff'
  END;

  BEGIN
    PERFORM public.enqueue_notification(
      NEW.user_id,
      'system',
      'Otrzymujesz odznakę: ' || v_label_pl,
      'You received a badge: ' || v_label_en,
      'Odznaka jest widoczna przy Twoim profilu i w katalogu osób.',
      'The badge is visible on your profile and in the people directory.',
      '/profile',
      'BadgeCheck'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'profile_badges: notification failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_profile_badges_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.profile_badges%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    PERFORM public.emit_domain_event(
      v_row.tenant_id,
      'profile_badge',
      v_row.id::text,
      'profile_badge.revoked.v1',
      jsonb_build_object(
        'user_id', v_row.user_id,
        'badge', v_row.badge,
        'grant_source', v_row.grant_source
      ),
      v_row.user_id
    );
  ELSE
    v_row := NEW;
    PERFORM public.emit_domain_event(
      v_row.tenant_id,
      'profile_badge',
      v_row.id::text,
      'profile_badge.granted.v1',
      jsonb_build_object(
        'user_id', v_row.user_id,
        'badge', v_row.badge,
        'grant_source', v_row.grant_source
      ),
      v_row.user_id
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'profile_badges: domain event failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profile_badges_emit_events ON public.profile_badges;
CREATE TRIGGER profile_badges_emit_events
  AFTER INSERT OR DELETE ON public.profile_badges
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_badges_emit_events();

REVOKE INSERT, UPDATE, DELETE ON public.profile_badges FROM anon, authenticated;
REVOKE SELECT ON public.profile_badges FROM anon, authenticated;
GRANT SELECT (id, tenant_id, user_id, badge, created_at)
  ON public.profile_badges TO anon, authenticated;

DROP POLICY IF EXISTS "badges admin insert" ON public.profile_badges;
DROP POLICY IF EXISTS "badges admin delete" ON public.profile_badges;

DROP POLICY IF EXISTS "badges tenant member read" ON public.profile_badges;
CREATE POLICY "badges tenant member read" ON public.profile_badges
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()));

CREATE OR REPLACE FUNCTION public.admin_list_profile_badges(p_limit integer DEFAULT 300)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  user_id uuid,
  badge text,
  note text,
  granted_by uuid,
  grant_source text,
  created_at timestamptz,
  member_display_name text,
  member_email text,
  member_avatar_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL
     OR NOT (
       public.has_role(v_actor, 'admin'::app_role)
       OR public.is_super_admin(v_actor)
     ) THEN
    RAISE EXCEPTION 'profile_badges: admin role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pb.id,
         pb.tenant_id,
         pb.user_id,
         pb.badge,
         pb.note,
         pb.granted_by,
         pb.grant_source,
         pb.created_at,
         p.display_name,
         p.email,
         p.avatar_url
    FROM public.profile_badges pb
    JOIN public.profiles p
      ON p.id = pb.user_id
     AND p.tenant_id = pb.tenant_id
   WHERE pb.tenant_id = v_tenant
   ORDER BY pb.created_at DESC, pb.id DESC
   LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_profile_badge(
  p_user_id uuid,
  p_badge text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_badge_id uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL
     OR NOT (
       public.has_role(v_actor, 'admin'::app_role)
       OR public.is_super_admin(v_actor)
     ) THEN
    RAISE EXCEPTION 'profile_badges: admin role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_badge IS NULL
     OR p_badge NOT IN ('verified', 'expert', 'contributor', 'staff') THEN
    RAISE EXCEPTION 'profile_badges: unsupported badge'
      USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'profile_badges: note exceeds 500 characters'
      USING ERRCODE = '22001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user_id AND p.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'profile_badges: member not found in active tenant'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.profile_badges (
    tenant_id, user_id, badge, note, granted_by, grant_source
  ) VALUES (
    v_tenant, p_user_id, p_badge, v_note, v_actor, 'manual'
  )
  ON CONFLICT (tenant_id, user_id, badge) DO NOTHING
  RETURNING public.profile_badges.id INTO v_badge_id;

  IF v_badge_id IS NULL THEN
    SELECT pb.id INTO v_badge_id
      FROM public.profile_badges pb
     WHERE pb.tenant_id = v_tenant
       AND pb.user_id = p_user_id
       AND pb.badge = p_badge;
  END IF;
  RETURN v_badge_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_profile_badge(p_badge_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_deleted integer := 0;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL
     OR NOT (
       public.has_role(v_actor, 'admin'::app_role)
       OR public.is_super_admin(v_actor)
     ) THEN
    RAISE EXCEPTION 'profile_badges: admin role required'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.profile_badges pb
   WHERE pb.id = p_badge_id
     AND pb.tenant_id = v_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_user_profile_badge(
  p_user_id uuid,
  p_badge text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_deleted integer := 0;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL
     OR NOT (
       public.has_role(v_actor, 'admin'::app_role)
       OR public.is_super_admin(v_actor)
     ) THEN
    RAISE EXCEPTION 'profile_badges: admin role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_badge IS NULL
     OR p_badge NOT IN ('verified', 'expert', 'contributor', 'staff') THEN
    RAISE EXCEPTION 'profile_badges: unsupported badge'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.profile_badges pb
   WHERE pb.tenant_id = v_tenant
     AND pb.user_id = p_user_id
     AND pb.badge = p_badge;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profile_badges(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_profile_badge(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_profile_badge(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_user_profile_badge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_profile_badges(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_profile_badge(uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_profile_badge(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_profile_badge(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profile_badge_activity_points(
  p_tenant_id uuid,
  p_user_id uuid,
  p_since timestamptz DEFAULT now() - interval '90 days'
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user_id AND p.tenant_id = p_tenant_id
  ) THEN
    COALESCE((
      SELECT count(*)::integer * 10
        FROM public.qa_questions q
       WHERE q.tenant_id = p_tenant_id
         AND q.user_id = p_user_id
         AND q.status = 'answered'
         AND q.created_at >= p_since
    ), 0)
    + COALESCE((
      SELECT count(*)::integer * 3
        FROM public.qa_questions q
       WHERE q.tenant_id = p_tenant_id
         AND q.user_id = p_user_id
         AND q.status = 'approved'
         AND q.created_at >= p_since
    ), 0)
    + COALESCE((
      SELECT count(*)::integer * 2
        FROM public.qa_question_votes qv
        JOIN public.qa_questions q ON q.id = qv.question_id
       WHERE q.tenant_id = p_tenant_id
         AND q.user_id = p_user_id
         AND qv.created_at >= p_since
    ), 0)
    + COALESCE((
      SELECT count(*)::integer * 5
        FROM public.event_rsvps r
        JOIN public.events e ON e.id = r.event_id
       WHERE e.tenant_id = p_tenant_id
         AND r.user_id = p_user_id
         AND e.status = 'published'
         AND r.status = 'going'
         AND e.starts_at < now()
         AND e.starts_at >= p_since
    ), 0)
    + COALESCE((
      SELECT count(*)::integer * 2
        FROM public.comments c
       WHERE c.tenant_id = p_tenant_id
         AND c.user_id = p_user_id
         AND c.status = 'approved'
         AND c.created_at >= p_since
    ), 0)
    + COALESCE((
      SELECT count(*)::integer
        FROM public.poll_votes pv
       WHERE pv.tenant_id = p_tenant_id
         AND pv.user_id = p_user_id
         AND pv.updated_at >= p_since
    ), 0)
    + COALESCE((
      SELECT count(*)::integer * 25
        FROM public.contributor_submissions cs
       WHERE cs.tenant_id = p_tenant_id
         AND cs.user_id = p_user_id
         AND cs.status = 'accepted'
         AND cs.updated_at >= p_since
    ), 0)
  ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_profile_badge_for_user(
  p_tenant_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.profile_badge_activity_points(
       p_tenant_id,
       p_user_id,
       now() - interval '90 days'
     ) < 150 THEN
    RETURN false;
  END IF;

  INSERT INTO public.profile_badges (
    tenant_id, user_id, badge, note, granted_by, grant_source
  ) VALUES (
    p_tenant_id, p_user_id, 'contributor', NULL, NULL, 'reputation'
  )
  ON CONFLICT (tenant_id, user_id, badge) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_reconcile_profile_badge_from_activity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_row jsonb := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME = 'qa_question_votes' THEN
    SELECT q.tenant_id, q.user_id INTO v_tenant, v_user
      FROM public.qa_questions q
     WHERE q.id = NEW.question_id;
  ELSIF TG_TABLE_NAME = 'event_rsvps' THEN
    SELECT e.tenant_id, NEW.user_id INTO v_tenant, v_user
      FROM public.events e
     WHERE e.id = NEW.event_id;
  ELSE
    v_tenant := NULLIF(v_row ->> 'tenant_id', '')::uuid;
    v_user := NULLIF(v_row ->> 'user_id', '')::uuid;
  END IF;

  IF v_tenant IS NOT NULL AND v_user IS NOT NULL THEN
    PERFORM public.reconcile_profile_badge_for_user(v_tenant, v_user);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'profile_badges: reputation reconciliation failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_badge_reputation_qa_questions ON public.qa_questions;
CREATE TRIGGER trg_badge_reputation_qa_questions
  AFTER INSERT OR UPDATE OF status ON public.qa_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_profile_badge_from_activity();

DROP TRIGGER IF EXISTS trg_badge_reputation_qa_votes ON public.qa_question_votes;
CREATE TRIGGER trg_badge_reputation_qa_votes
  AFTER INSERT ON public.qa_question_votes
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_profile_badge_from_activity();

DROP TRIGGER IF EXISTS trg_badge_reputation_event_rsvps ON public.event_rsvps;
CREATE TRIGGER trg_badge_reputation_event_rsvps
  AFTER INSERT OR UPDATE OF status ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_profile_badge_from_activity();

DROP TRIGGER IF EXISTS trg_badge_reputation_comments ON public.comments;
CREATE TRIGGER trg_badge_reputation_comments
  AFTER INSERT OR UPDATE OF status ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_profile_badge_from_activity();

DROP TRIGGER IF EXISTS trg_badge_reputation_poll_votes ON public.poll_votes;
CREATE TRIGGER trg_badge_reputation_poll_votes
  AFTER INSERT OR UPDATE ON public.poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_profile_badge_from_activity();

DROP TRIGGER IF EXISTS trg_badge_reputation_submissions ON public.contributor_submissions;
CREATE TRIGGER trg_badge_reputation_submissions
  AFTER INSERT OR UPDATE OF status ON public.contributor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_profile_badge_from_activity();

CREATE OR REPLACE FUNCTION public.tg_contributor_submissions_reviewed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('accepted', 'rejected', 'in_review') THEN
    IF NEW.reviewed_by IS NULL THEN
      NEW.reviewed_by := auth.uid();
    END IF;
    IF NEW.status IN ('accepted', 'rejected') AND NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;

    IF NEW.status = 'accepted' THEN
      INSERT INTO public.profile_badges (
        tenant_id, user_id, badge, note, granted_by, grant_source
      ) VALUES (
        NEW.tenant_id,
        NEW.user_id,
        'contributor',
        'Przyjęte zgłoszenie: ' || left(NEW.title, 120),
        NEW.reviewed_by,
        'contributor_submission'
      )
      ON CONFLICT (tenant_id, user_id, badge) DO NOTHING;

      PERFORM public.enqueue_notification(
        NEW.user_id,
        'system',
        'Zgłoszenie przyjęte: ' || left(NEW.title, 120),
        'Submission accepted: ' || left(NEW.title, 120),
        'Redakcja skontaktuje się w sprawie dalszych kroków.',
        'The editors will follow up on next steps.',
        '/contribute',
        'FileCheck'
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.enqueue_notification(
        NEW.user_id,
        'system',
        'Zgłoszenie odrzucone: ' || left(NEW.title, 120),
        'Submission declined: ' || left(NEW.title, 120),
        NULLIF(btrim(COALESCE(NEW.editor_note, '')), ''),
        NULLIF(btrim(COALESCE(NEW.editor_note, '')), ''),
        '/contribute',
        'FileX'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contributor_submissions_reviewed
  ON public.contributor_submissions;
CREATE TRIGGER contributor_submissions_reviewed
  BEFORE UPDATE ON public.contributor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_contributor_submissions_reviewed();

CREATE OR REPLACE FUNCTION public.reconcile_due_profile_badges(p_limit integer DEFAULT 250)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 250), 1), 1000);
  v_row record;
  v_granted integer := 0;
BEGIN
  FOR v_row IN
    WITH active_users AS (
      SELECT q.tenant_id, q.user_id, q.created_at AS activity_at
        FROM public.qa_questions q
       WHERE q.created_at >= now() - interval '90 days'
      UNION ALL
      SELECT q.tenant_id, q.user_id, qv.created_at
        FROM public.qa_question_votes qv
        JOIN public.qa_questions q ON q.id = qv.question_id
       WHERE qv.created_at >= now() - interval '90 days'
      UNION ALL
      SELECT e.tenant_id, r.user_id, e.starts_at
        FROM public.event_rsvps r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.status = 'going'
         AND e.status = 'published'
         AND e.starts_at < now()
         AND e.starts_at >= now() - interval '90 days'
      UNION ALL
      SELECT c.tenant_id, c.user_id, c.created_at
        FROM public.comments c
       WHERE c.user_id IS NOT NULL
         AND c.created_at >= now() - interval '90 days'
      UNION ALL
      SELECT pv.tenant_id, pv.user_id, pv.updated_at
        FROM public.poll_votes pv
       WHERE pv.updated_at >= now() - interval '90 days'
      UNION ALL
      SELECT cs.tenant_id, cs.user_id, cs.updated_at
        FROM public.contributor_submissions cs
       WHERE cs.updated_at >= now() - interval '90 days'
    ), candidates AS (
      SELECT au.tenant_id, au.user_id, max(au.activity_at) AS last_activity_at
        FROM active_users au
        JOIN public.profiles p
          ON p.id = au.user_id AND p.tenant_id = au.tenant_id
       WHERE NOT EXISTS (
         SELECT 1 FROM public.profile_badges pb
          WHERE pb.tenant_id = au.tenant_id
            AND pb.user_id = au.user_id
            AND pb.badge = 'contributor'
       )
       GROUP BY au.tenant_id, au.user_id
       ORDER BY max(au.activity_at) DESC
       LIMIT v_limit
    )
    SELECT c.tenant_id, c.user_id FROM candidates c
  LOOP
    IF public.reconcile_profile_badge_for_user(v_row.tenant_id, v_row.user_id) THEN
      v_granted := v_granted + 1;
    END IF;
  END LOOP;
  RETURN v_granted;
END;
$$;

REVOKE ALL ON FUNCTION public.profile_badge_activity_points(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_profile_badge_for_user(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_due_profile_badges(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_badge_activity_points(uuid, uuid, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_profile_badge_for_user(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_due_profile_badges(integer)
  TO service_role;