-- ============================================================================
-- SPOŁECZNOŚĆ 8/10: współtworzenie - ankiety/sondaże + program kontrybutorów.
--
-- ANKIETY: sondaż opinii przypinany do wpisu (widget pod treścią) lub
-- samodzielny. Głos przez RPC vote_poll (walidacja indeksu, jeden głos per
-- użytkownik ze zmianą zdania); wyniki przez get_poll_results dopiero PO
-- oddaniu głosu / po zamknięciu (klasyczna zasada anty-kotwiczenia).
--
-- KONTRYBUTORZY: zgłoszenia tekstów gościnnych (pitch) z pipeline'em
-- submitted -> in_review -> accepted/rejected. Rate limit 3 zgłoszenia/dobę
-- w DB. Akceptacja automatycznie nadaje odznakę 'contributor' (2/10)
-- i powiadamia autora; nowe zgłoszenie powiadamia adminów tenantu.
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  question_pl text NOT NULL,
  question_en text NOT NULL,
  options jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  ends_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(question_pl) <> '' AND btrim(question_en) <> ''),
  CHECK (jsonb_typeof(options) = 'array'
         AND jsonb_array_length(options) BETWEEN 2 AND 8)
);

CREATE INDEX IF NOT EXISTS idx_polls_tenant_status
  ON public.polls (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_polls_post
  ON public.polls (post_id) WHERE post_id IS NOT NULL;

DROP TRIGGER IF EXISTS polls_set_updated_at ON public.polls;
CREATE TRIGGER polls_set_updated_at
  BEFORE UPDATE ON public.polls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.polls TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.polls TO authenticated;
GRANT ALL ON public.polls TO service_role;
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "polls public read" ON public.polls;
CREATE POLICY "polls public read" ON public.polls
  FOR SELECT TO anon, authenticated
  USING (status IN ('open', 'closed') AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "polls staff all" ON public.polls;
CREATE POLICY "polls staff all" ON public.polls
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.poll_votes (
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  option_idx integer NOT NULL CHECK (option_idx >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

DROP TRIGGER IF EXISTS poll_votes_set_updated_at ON public.poll_votes;
CREATE TRIGGER poll_votes_set_updated_at
  BEFORE UPDATE ON public.poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.poll_votes TO authenticated;
GRANT ALL ON public.poll_votes TO service_role;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

-- Klient widzi tylko własny głos; głosowanie wyłącznie przez RPC.
DROP POLICY IF EXISTS "poll votes own read" ON public.poll_votes;
CREATE POLICY "poll votes own read" ON public.poll_votes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.vote_poll(p_poll_id uuid, p_option_idx integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_poll public.polls%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'polls: authentication required';
  END IF;

  SELECT * INTO v_poll
    FROM public.polls
   WHERE id = p_poll_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_poll.status <> 'open'
     OR (v_poll.ends_at IS NOT NULL AND v_poll.ends_at < now()) THEN
    RAISE EXCEPTION 'polls: closed';
  END IF;
  IF p_option_idx IS NULL OR p_option_idx < 0
     OR p_option_idx >= jsonb_array_length(v_poll.options) THEN
    RAISE EXCEPTION 'polls: invalid option';
  END IF;

  INSERT INTO public.poll_votes (poll_id, user_id, tenant_id, option_idx)
  VALUES (p_poll_id, v_user, v_poll.tenant_id, p_option_idx)
  ON CONFLICT (poll_id, user_id)
  DO UPDATE SET option_idx = EXCLUDED.option_idx, updated_at = now();

  RETURN public.get_poll_results(p_poll_id);
END;
$$;

-- Wyniki: dopiero po własnym głosie / po zamknięciu / dla staffu.
CREATE OR REPLACE FUNCTION public.get_poll_results(p_poll_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_poll public.polls%ROWTYPE;
  v_my integer;
  v_staff boolean := false;
  v_counts jsonb;
  v_total integer;
BEGIN
  SELECT * INTO v_poll
    FROM public.polls
   WHERE id = p_poll_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_poll.status = 'draft' THEN
    RAISE EXCEPTION 'polls: not found';
  END IF;

  IF v_user IS NOT NULL THEN
    SELECT option_idx INTO v_my
      FROM public.poll_votes WHERE poll_id = p_poll_id AND user_id = v_user;
    v_staff := public.has_role(v_user, 'admin'::app_role)
            OR public.has_role(v_user, 'editor'::app_role);
  END IF;

  IF v_my IS NULL AND v_poll.status <> 'closed' AND NOT v_staff THEN
    RETURN jsonb_build_object('visible', false, 'my_vote', NULL);
  END IF;

  SELECT COALESCE(jsonb_object_agg(idx::text, cnt), '{}'::jsonb),
         COALESCE(sum(cnt), 0)::integer
    INTO v_counts, v_total
    FROM (
      SELECT option_idx AS idx, count(*)::integer AS cnt
        FROM public.poll_votes
       WHERE poll_id = p_poll_id
       GROUP BY option_idx
    ) c;

  RETURN jsonb_build_object(
    'visible', true,
    'my_vote', v_my,
    'total', v_total,
    'counts', v_counts
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.vote_poll(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vote_poll(uuid, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_poll_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_poll_results(uuid) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Program kontrybutorów
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contributor_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 200),
  pitch text NOT NULL CHECK (length(btrim(pitch)) BETWEEN 50 AND 5000),
  language text NOT NULL DEFAULT 'pl' CHECK (language IN ('pl', 'en')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'accepted', 'rejected')),
  editor_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contributor_submissions_tenant
  ON public.contributor_submissions (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contributor_submissions_user
  ON public.contributor_submissions (user_id, created_at DESC);

DROP TRIGGER IF EXISTS contributor_submissions_set_updated_at ON public.contributor_submissions;
CREATE TRIGGER contributor_submissions_set_updated_at
  BEFORE UPDATE ON public.contributor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT ON public.contributor_submissions TO authenticated;
GRANT UPDATE ON public.contributor_submissions TO authenticated;
GRANT ALL ON public.contributor_submissions TO service_role;
ALTER TABLE public.contributor_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "submissions own read" ON public.contributor_submissions;
CREATE POLICY "submissions own read" ON public.contributor_submissions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "submissions own insert" ON public.contributor_submissions;
CREATE POLICY "submissions own insert" ON public.contributor_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'submitted'
  );

DROP POLICY IF EXISTS "submissions staff read" ON public.contributor_submissions;
CREATE POLICY "submissions staff read" ON public.contributor_submissions
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "submissions staff update" ON public.contributor_submissions;
CREATE POLICY "submissions staff update" ON public.contributor_submissions
  FOR UPDATE TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- Rate limit + powiadomienie adminów o nowym zgłoszeniu.
CREATE OR REPLACE FUNCTION public.tg_contributor_submissions_created()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent integer;
  v_admin record;
BEGIN
  SELECT count(*) INTO v_recent
    FROM public.contributor_submissions
   WHERE user_id = NEW.user_id
     AND created_at > now() - interval '24 hours';
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'submissions: rate limited';
  END IF;

  FOR v_admin IN
    SELECT ur.user_id
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin'::app_role
       AND p.tenant_id = NEW.tenant_id
     LIMIT 20
  LOOP
    PERFORM public.enqueue_notification(
      v_admin.user_id,
      'system',
      'Nowe zgłoszenie tekstu gościnnego',
      'New guest-essay submission',
      left(btrim(NEW.title), 140),
      left(btrim(NEW.title), 140),
      '/admin/submissions',
      'FilePen'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contributor_submissions_created ON public.contributor_submissions;
CREATE TRIGGER contributor_submissions_created
  BEFORE INSERT ON public.contributor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_contributor_submissions_created();

-- Decyzja: odznaka 'contributor' przy akceptacji + powiadomienie autora.
CREATE OR REPLACE FUNCTION public.tg_contributor_submissions_reviewed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> OLD.status AND NEW.status IN ('accepted', 'rejected', 'in_review') THEN
    IF NEW.reviewed_by IS NULL THEN
      NEW.reviewed_by := auth.uid();
    END IF;
    IF NEW.status IN ('accepted', 'rejected') AND NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;

    IF NEW.status = 'accepted' THEN
      INSERT INTO public.profile_badges (tenant_id, user_id, badge, note, granted_by)
      VALUES (NEW.tenant_id, NEW.user_id, 'contributor',
              'Przyjęte zgłoszenie: ' || left(NEW.title, 120), NEW.reviewed_by)
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

DROP TRIGGER IF EXISTS contributor_submissions_reviewed ON public.contributor_submissions;
CREATE TRIGGER contributor_submissions_reviewed
  BEFORE UPDATE ON public.contributor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_contributor_submissions_reviewed();
