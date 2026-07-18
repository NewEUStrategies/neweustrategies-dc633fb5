-- helpery
CREATE OR REPLACE FUNCTION public._tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

-- ============================ 1. REKOMENDACJE =============================
CREATE TABLE public.profile_recommendations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relationship TEXT CHECK (relationship IN
                 ('colleague','manager','report','client','mentor','partner','other')),
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 20 AND 3000),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','published','declined','hidden')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (author_id, recipient_id),
  CHECK (author_id <> recipient_id)
);
CREATE INDEX idx_prof_rec_recipient ON public.profile_recommendations (recipient_id, status);
CREATE INDEX idx_prof_rec_author    ON public.profile_recommendations (author_id);
GRANT SELECT ON public.profile_recommendations TO authenticated;
GRANT ALL ON public.profile_recommendations TO service_role;
ALTER TABLE public.profile_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY prof_rec_read ON public.profile_recommendations FOR SELECT TO authenticated
  USING (author_id = auth.uid() OR recipient_id = auth.uid() OR status = 'published');
CREATE TRIGGER trg_prof_rec_updated
  BEFORE UPDATE ON public.profile_recommendations
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ============================ 2. ENDORSEMENTS =============================
CREATE TABLE public.profile_skill_endorsements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  skill_id     UUID NOT NULL REFERENCES public.profile_skills(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endorser_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (skill_id, endorser_id),
  CHECK (endorser_id <> recipient_id)
);
CREATE INDEX idx_endorse_skill     ON public.profile_skill_endorsements (skill_id);
CREATE INDEX idx_endorse_recipient ON public.profile_skill_endorsements (recipient_id);
GRANT SELECT ON public.profile_skill_endorsements TO authenticated;
GRANT ALL ON public.profile_skill_endorsements TO service_role;
ALTER TABLE public.profile_skill_endorsements ENABLE ROW LEVEL SECURITY;
CREATE POLICY endorse_read ON public.profile_skill_endorsements FOR SELECT TO authenticated
  USING (true);

-- ============================ 3. PROFILE VIEWS ============================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_view_mode TEXT NOT NULL DEFAULT 'public'
    CHECK (profile_view_mode IN ('public','anonymous','private'));

CREATE TABLE public.profile_view_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  profile_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewer_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  viewer_mode   TEXT NOT NULL DEFAULT 'public'
                CHECK (viewer_mode IN ('public','anonymous','private')),
  viewer_snapshot JSONB,
  viewed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pv_profile ON public.profile_view_events (profile_id, viewed_at DESC);
CREATE INDEX idx_pv_viewer  ON public.profile_view_events (viewer_id, viewed_at DESC);
GRANT SELECT ON public.profile_view_events TO authenticated;
GRANT ALL ON public.profile_view_events TO service_role;
ALTER TABLE public.profile_view_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY pv_no_direct_read ON public.profile_view_events FOR SELECT TO authenticated
  USING (false);

-- ============================ 4. INTRODUCTIONS ============================
CREATE TABLE public.introduction_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bridge_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message      TEXT NOT NULL CHECK (char_length(message) BETWEEN 20 AND 600),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','forwarded','declined','withdrawn')),
  responded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_id <> bridge_id AND bridge_id <> target_id AND requester_id <> target_id)
);
CREATE INDEX idx_intro_bridge    ON public.introduction_requests (bridge_id, status);
CREATE INDEX idx_intro_requester ON public.introduction_requests (requester_id);
GRANT SELECT ON public.introduction_requests TO authenticated;
GRANT ALL ON public.introduction_requests TO service_role;
ALTER TABLE public.introduction_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY intro_read ON public.introduction_requests FOR SELECT TO authenticated
  USING (auth.uid() IN (requester_id, bridge_id, target_id));
CREATE TRIGGER trg_intro_updated
  BEFORE UPDATE ON public.introduction_requests
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ===================== helpery RPC =======================================
CREATE OR REPLACE FUNCTION public._caller_tenant()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public._are_connected(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_connections uc
    WHERE uc.status = 'accepted'
      AND ((uc.requester_id = _a AND uc.addressee_id = _b)
        OR (uc.requester_id = _b AND uc.addressee_id = _a))
  );
$$;

-- === 1. rekomendacje =====================================================
CREATE OR REPLACE FUNCTION public.write_recommendation(
  p_recipient UUID, p_relationship TEXT, p_body TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID; v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_recipient = auth.uid() THEN RAISE EXCEPTION 'cannot recommend self'; END IF;
  IF NOT public._are_connected(auth.uid(), p_recipient) THEN
    RAISE EXCEPTION 'must be connected';
  END IF;
  v_tenant := public._caller_tenant();
  INSERT INTO public.profile_recommendations
    (tenant_id, recipient_id, author_id, relationship, body)
  VALUES (v_tenant, p_recipient, auth.uid(), p_relationship, p_body)
  ON CONFLICT (author_id, recipient_id) DO UPDATE
    SET body = EXCLUDED.body, relationship = EXCLUDED.relationship,
        status = 'pending', updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.respond_recommendation(p_id UUID, p_action TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.profile_recommendations
     SET status = CASE p_action WHEN 'publish' THEN 'published'
                                WHEN 'decline' THEN 'declined'
                                WHEN 'hide'    THEN 'hidden'
                                ELSE status END,
         updated_at = now()
   WHERE id = p_id AND recipient_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not your recommendation'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.list_recommendations(p_recipient UUID)
RETURNS TABLE (
  id UUID, author_id UUID, author_name TEXT, author_avatar TEXT,
  author_headline TEXT, relationship TEXT, body TEXT, status TEXT, created_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID := public._caller_tenant();
BEGIN
  RETURN QUERY
    SELECT r.id, r.author_id, p.display_name, p.avatar_url,
           p.job_title, r.relationship, r.body, r.status, r.created_at
      FROM public.profile_recommendations r
      JOIN public.profiles p ON p.id = r.author_id
     WHERE r.recipient_id = p_recipient
       AND r.tenant_id = v_tenant
       AND (r.status = 'published' OR r.recipient_id = auth.uid() OR r.author_id = auth.uid())
     ORDER BY r.created_at DESC;
END; $$;

-- === 2. endorsements =====================================================
CREATE OR REPLACE FUNCTION public.endorse_skill(p_skill_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_recipient UUID; v_tenant UUID; v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id INTO v_recipient FROM public.profile_skills WHERE id = p_skill_id;
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'skill not found'; END IF;
  IF v_recipient = auth.uid() THEN RAISE EXCEPTION 'cannot endorse own skill'; END IF;
  IF NOT public._are_connected(auth.uid(), v_recipient) THEN
    RAISE EXCEPTION 'must be connected';
  END IF;
  v_tenant := public._caller_tenant();
  INSERT INTO public.profile_skill_endorsements
    (tenant_id, skill_id, recipient_id, endorser_id)
  VALUES (v_tenant, p_skill_id, v_recipient, auth.uid())
  ON CONFLICT (skill_id, endorser_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.unendorse_skill(p_skill_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.profile_skill_endorsements
   WHERE skill_id = p_skill_id AND endorser_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.skill_endorsement_counts(p_user UUID)
RETURNS TABLE (skill_id UUID, cnt INT, by_me BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, COUNT(e.id)::int, BOOL_OR(e.endorser_id = auth.uid())
    FROM public.profile_skills s
    LEFT JOIN public.profile_skill_endorsements e ON e.skill_id = s.id
   WHERE s.user_id = p_user
   GROUP BY s.id;
$$;

-- === 3. profile views ====================================================
CREATE OR REPLACE FUNCTION public.record_profile_view(p_profile UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID; v_mode TEXT; v_snapshot JSONB;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() = p_profile THEN RETURN; END IF;
  v_tenant := public._caller_tenant();
  SELECT profile_view_mode INTO v_mode FROM public.profiles WHERE id = auth.uid();
  IF v_mode = 'public' THEN
    SELECT jsonb_build_object(
      'display_name', display_name, 'job_title', job_title,
      'company', current_company, 'avatar_url', avatar_url
    ) INTO v_snapshot FROM public.profiles WHERE id = auth.uid();
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profile_view_events
     WHERE profile_id = p_profile AND viewer_id = auth.uid()
       AND viewed_at > now() - INTERVAL '1 hour'
  ) THEN RETURN; END IF;
  INSERT INTO public.profile_view_events
    (tenant_id, profile_id, viewer_id, viewer_mode, viewer_snapshot)
  VALUES (v_tenant, p_profile,
          CASE WHEN v_mode = 'private' THEN NULL ELSE auth.uid() END,
          v_mode, v_snapshot);
END; $$;

CREATE OR REPLACE FUNCTION public.my_profile_viewers(p_limit INT DEFAULT 20)
RETURNS TABLE (
  viewed_at TIMESTAMPTZ, viewer_mode TEXT,
  viewer_id UUID, display_name TEXT, avatar_url TEXT, job_title TEXT, company TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT e.viewed_at, e.viewer_mode,
           CASE WHEN e.viewer_mode = 'public' THEN e.viewer_id END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'display_name') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'avatar_url') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'job_title') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'company') END
      FROM public.profile_view_events e
     WHERE e.profile_id = auth.uid()
     ORDER BY e.viewed_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 100);
END; $$;

CREATE OR REPLACE FUNCTION public.profile_view_stats()
RETURNS TABLE (last_7 INT, last_30 INT, last_90 INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '7 days')::int,
         COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '30 days')::int,
         COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '90 days')::int
    FROM public.profile_view_events
   WHERE profile_id = auth.uid();
$$;

-- === 4. introductions ====================================================
CREATE OR REPLACE FUNCTION public.request_introduction(
  p_bridge UUID, p_target UUID, p_message TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID; v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public._are_connected(auth.uid(), p_bridge) THEN
    RAISE EXCEPTION 'not connected to bridge'; END IF;
  IF NOT public._are_connected(p_bridge, p_target) THEN
    RAISE EXCEPTION 'bridge not connected to target'; END IF;
  IF public._are_connected(auth.uid(), p_target) THEN
    RAISE EXCEPTION 'already connected to target'; END IF;
  IF (SELECT COUNT(*) FROM public.introduction_requests
       WHERE requester_id = auth.uid() AND status = 'pending'
         AND created_at > now() - INTERVAL '24 hours') >= 5 THEN
    RAISE EXCEPTION 'rate limited'; END IF;
  v_tenant := public._caller_tenant();
  INSERT INTO public.introduction_requests
    (tenant_id, requester_id, bridge_id, target_id, message)
  VALUES (v_tenant, auth.uid(), p_bridge, p_target, p_message)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.respond_introduction(p_id UUID, p_action TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.introduction_requests
     SET status = CASE p_action WHEN 'forward' THEN 'forwarded'
                                WHEN 'decline' THEN 'declined'
                                ELSE status END,
         responded_at = now(), updated_at = now()
   WHERE id = p_id AND bridge_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not your request or not pending'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.my_introduction_requests(p_role TEXT DEFAULT 'bridge')
RETURNS TABLE (
  id UUID, requester_id UUID, requester_name TEXT, requester_avatar TEXT,
  target_id UUID, target_name TEXT, target_avatar TEXT,
  bridge_id UUID, bridge_name TEXT,
  message TEXT, status TEXT, created_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT i.id, i.requester_id, pr.display_name, pr.avatar_url,
           i.target_id, pt.display_name, pt.avatar_url,
           i.bridge_id, pb.display_name,
           i.message, i.status, i.created_at
      FROM public.introduction_requests i
      JOIN public.profiles pr ON pr.id = i.requester_id
      JOIN public.profiles pt ON pt.id = i.target_id
      JOIN public.profiles pb ON pb.id = i.bridge_id
     WHERE CASE p_role
             WHEN 'bridge'    THEN i.bridge_id = auth.uid()
             WHEN 'requester' THEN i.requester_id = auth.uid()
             WHEN 'target'    THEN i.target_id = auth.uid() AND i.status = 'forwarded'
             ELSE FALSE END
     ORDER BY i.created_at DESC;
END; $$;

-- granty
GRANT EXECUTE ON FUNCTION public.write_recommendation(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_recommendation(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_recommendations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.endorse_skill(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unendorse_skill(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skill_endorsement_counts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_profile_view(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_profile_viewers(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profile_view_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_introduction(UUID,UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_introduction(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_introduction_requests(TEXT) TO authenticated;