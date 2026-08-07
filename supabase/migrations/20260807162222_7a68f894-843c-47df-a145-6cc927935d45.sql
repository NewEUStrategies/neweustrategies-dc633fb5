CREATE TABLE IF NOT EXISTS public.club_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('thread', 'reply')),
  target_id   uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL
              CHECK (kind IN ('insightful', 'evidence', 'question',
                              'agree', 'disagree', 'thanks')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_reactions_unique UNIQUE (target_type, target_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS club_reactions_target_idx
  ON public.club_reactions (target_type, target_id);
CREATE INDEX IF NOT EXISTS club_reactions_user_idx
  ON public.club_reactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS club_reactions_tenant_idx
  ON public.club_reactions (tenant_id, club_id);

CREATE TABLE IF NOT EXISTS public.club_stances (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  thread_id  uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stance     text NOT NULL CHECK (stance IN ('support', 'oppose', 'abstain')),
  rationale  text CHECK (rationale IS NULL OR char_length(rationale) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_stances_unique UNIQUE (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS club_stances_thread_idx ON public.club_stances (thread_id, stance);

CREATE TABLE IF NOT EXISTS public.club_thread_subscriptions (
  thread_id  uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state      text NOT NULL DEFAULT 'subscribed' CHECK (state IN ('subscribed', 'muted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS club_thread_subscriptions_user_idx
  ON public.club_thread_subscriptions (user_id, state);

ALTER TABLE public.club_reactions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_stances              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_thread_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_reactions            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_stances              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_thread_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_reactions            TO service_role;
GRANT ALL ON public.club_stances              TO service_role;
GRANT ALL ON public.club_thread_subscriptions TO service_role;

DROP TRIGGER IF EXISTS club_reactions_pin_tenant_tg ON public.club_reactions;
CREATE TRIGGER club_reactions_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_reactions
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();
DROP TRIGGER IF EXISTS club_stances_pin_tenant_tg ON public.club_stances;
CREATE TRIGGER club_stances_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_stances
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();
DROP TRIGGER IF EXISTS club_stances_set_updated_tg ON public.club_stances;
CREATE TRIGGER club_stances_set_updated_tg BEFORE UPDATE ON public.club_stances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.club_reactions_stance_exclusive()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind IN ('agree', 'disagree') THEN
    DELETE FROM public.club_reactions
     WHERE target_type = NEW.target_type
       AND target_id = NEW.target_id
       AND user_id = NEW.user_id
       AND kind IN ('agree', 'disagree')
       AND kind <> NEW.kind;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS club_reactions_stance_exclusive_tg ON public.club_reactions;
CREATE TRIGGER club_reactions_stance_exclusive_tg
  BEFORE INSERT ON public.club_reactions
  FOR EACH ROW EXECUTE FUNCTION public.club_reactions_stance_exclusive();

CREATE OR REPLACE FUNCTION public.club_reactions_sync_counts()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_type text := COALESCE(NEW.target_type, OLD.target_type);
  v_id   uuid := COALESCE(NEW.target_id, OLD.target_id);
  v_cnt  integer;
  v_quality integer;
  v_thread uuid;
BEGIN
  SELECT count(*)::int,
         count(*) FILTER (WHERE kind IN ('insightful', 'evidence'))::int
    INTO v_cnt, v_quality
    FROM public.club_reactions
   WHERE target_type = v_type AND target_id = v_id;
  IF v_type = 'thread' THEN
    UPDATE public.club_threads t
       SET reaction_count = v_cnt,
           hotness = public.club_thread_hotness(
             v_quality, t.reply_count, t.participant_count,
             (SELECT count(*)::int FROM public.club_stances s WHERE s.thread_id = t.id),
             t.created_at)
     WHERE t.id = v_id;
  ELSE
    UPDATE public.club_replies SET reaction_count = v_cnt WHERE id = v_id;
    SELECT thread_id INTO v_thread FROM public.club_replies WHERE id = v_id;
    IF v_thread IS NOT NULL THEN
      UPDATE public.club_threads t
         SET hotness = public.club_thread_hotness(
               (SELECT count(*)::int FROM public.club_reactions r
                 WHERE r.kind IN ('insightful', 'evidence')
                   AND ((r.target_type = 'thread' AND r.target_id = t.id)
                        OR (r.target_type = 'reply' AND r.target_id IN
                            (SELECT id FROM public.club_replies WHERE thread_id = t.id)))),
               t.reply_count, t.participant_count,
               (SELECT count(*)::int FROM public.club_stances s WHERE s.thread_id = t.id),
               t.created_at)
       WHERE t.id = v_thread;
    END IF;
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_reactions_sync_counts_tg ON public.club_reactions;
CREATE TRIGGER club_reactions_sync_counts_tg
  AFTER INSERT OR DELETE ON public.club_reactions
  FOR EACH ROW EXECUTE FUNCTION public.club_reactions_sync_counts();

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_club boolean NOT NULL DEFAULT true;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task','expert_request',
                  'introduction','recommendation','endorsement',
                  'profile_view','meeting',
                  'club'))
  NOT VALID;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'        THEN np.enabled_message
             WHEN 'comment'        THEN np.enabled_comment
             WHEN 'follow'         THEN np.enabled_follow
             WHEN 'subscription'   THEN np.enabled_subscription
             WHEN 'content'        THEN np.enabled_content
             WHEN 'system'         THEN np.enabled_system
             WHEN 'tracker'        THEN np.enabled_tracker
             WHEN 'connection'     THEN np.enabled_connection
             WHEN 'saved_search'   THEN np.enabled_saved_search
             WHEN 'crm_task'       THEN np.enabled_crm_task
             WHEN 'expert_request' THEN np.enabled_expert_request
             WHEN 'introduction'   THEN np.enabled_introduction
             WHEN 'recommendation' THEN np.enabled_recommendation
             WHEN 'endorsement'    THEN np.enabled_endorsement
             WHEN 'profile_view'   THEN np.enabled_profile_view
             WHEN 'meeting'        THEN np.enabled_meeting
             WHEN 'club'           THEN np.enabled_club
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_notify(
  _user_id   uuid,
  _actor_id  uuid,
  _title_pl  text,
  _title_en  text,
  _body_pl   text,
  _body_en   text,
  _href      text
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL OR _user_id = _actor_id THEN
    RETURN;
  END IF;
  PERFORM public.enqueue_notification(
    _user_id, 'club', _title_pl, _title_en, _body_pl, _body_en, _href
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_notify(uuid, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_notify(uuid, uuid, text, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.club_replies_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t    public.club_threads%ROWTYPE;
  v_club public.clubs%ROWTYPE;
  v_href text;
  v_rec  record;
BEGIN
  IF NEW.status <> 'visible' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_t FROM public.club_threads WHERE id = NEW.thread_id;
  SELECT * INTO v_club FROM public.clubs WHERE id = v_t.club_id;
  v_href := '/club/' || v_club.slug || '/t/' || v_t.slug;
  PERFORM public.club_notify(
    v_t.author_id, NEW.author_id,
    'Nowa odpowiedź w Twoim temacie', 'New reply in your topic',
    v_t.title, v_t.title, v_href
  );
  FOR v_rec IN
    SELECT s.user_id FROM public.club_thread_subscriptions s
     WHERE s.thread_id = NEW.thread_id
       AND s.state = 'subscribed'
       AND s.user_id IS DISTINCT FROM v_t.author_id
  LOOP
    PERFORM public.club_notify(
      v_rec.user_id, NEW.author_id,
      'Nowa odpowiedź w śledzonym temacie', 'New reply in a topic you follow',
      v_t.title, v_t.title, v_href
    );
  END LOOP;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_replies_notify_tg ON public.club_replies;
CREATE TRIGGER club_replies_notify_tg
  AFTER INSERT ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.club_replies_notify();

CREATE OR REPLACE FUNCTION public.club_reactions_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_author uuid;
  v_title  text;
  v_slug   text;
  v_cslug  text;
  v_count  integer;
BEGIN
  IF NEW.kind <> 'insightful' THEN
    RETURN NULL;
  END IF;
  SELECT count(*)::int INTO v_count FROM public.club_reactions
   WHERE target_type = NEW.target_type AND target_id = NEW.target_id
     AND kind = 'insightful';
  IF v_count NOT IN (1, 5, 25) THEN
    RETURN NULL;
  END IF;
  IF NEW.target_type = 'thread' THEN
    SELECT t.author_id, t.title, t.slug, c.slug
      INTO v_author, v_title, v_slug, v_cslug
      FROM public.club_threads t JOIN public.clubs c ON c.id = t.club_id
     WHERE t.id = NEW.target_id;
  ELSE
    SELECT r.author_id, t.title, t.slug, c.slug
      INTO v_author, v_title, v_slug, v_cslug
      FROM public.club_replies r
      JOIN public.club_threads t ON t.id = r.thread_id
      JOIN public.clubs c ON c.id = t.club_id
     WHERE r.id = NEW.target_id;
  END IF;
  PERFORM public.club_notify(
    v_author, NEW.user_id,
    'Twoja wypowiedź została doceniona', 'Your post was marked as insightful',
    v_title, v_title, '/club/' || v_cslug || '/t/' || v_slug
  );
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_reactions_notify_tg ON public.club_reactions;
CREATE TRIGGER club_reactions_notify_tg
  AFTER INSERT ON public.club_reactions
  FOR EACH ROW EXECUTE FUNCTION public.club_reactions_notify();

CREATE OR REPLACE FUNCTION public.club_invitations_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_club public.clubs%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_club FROM public.clubs WHERE id = NEW.club_id;
  PERFORM public.club_notify(
    NEW.invitee_id, NEW.inviter_id,
    'Zaproszenie do klubu dyskusyjnego', 'Invitation to a discussion club',
    v_club.name_pl, v_club.name_en, '/club'
  );
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_invitations_notify_tg ON public.club_invitations;
CREATE TRIGGER club_invitations_notify_tg
  AFTER INSERT ON public.club_invitations
  FOR EACH ROW EXECUTE FUNCTION public.club_invitations_notify();

CREATE OR REPLACE FUNCTION public.club_members_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_club public.clubs%ROWTYPE;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'active' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_club FROM public.clubs c WHERE c.id = NEW.club_id;
  PERFORM public.club_notify(
    NEW.user_id, NULL,
    'Dołączyłeś do klubu', 'You joined a club',
    v_club.name_pl, v_club.name_en, '/club/' || v_club.slug
  );
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_members_notify_tg ON public.club_members;
CREATE TRIGGER club_members_notify_tg
  AFTER INSERT OR UPDATE OF status ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.club_members_notify();

CREATE OR REPLACE FUNCTION public.club_threads_notify_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_author uuid;
  v_cslug  text;
BEGIN
  IF NEW.resolved_reply_id IS NULL
     OR NEW.resolved_reply_id IS NOT DISTINCT FROM OLD.resolved_reply_id THEN
    RETURN NULL;
  END IF;
  SELECT r.author_id INTO v_author FROM public.club_replies r
   WHERE r.id = NEW.resolved_reply_id;
  SELECT c.slug INTO v_cslug FROM public.clubs c WHERE c.id = NEW.club_id;
  PERFORM public.club_notify(
    v_author, NEW.author_id,
    'Twoja odpowiedź została uznana za rozstrzygającą',
    'Your reply was accepted as the answer',
    NEW.title, NEW.title, '/club/' || v_cslug || '/t/' || NEW.slug
  );
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_threads_notify_resolved_tg ON public.club_threads;
CREATE TRIGGER club_threads_notify_resolved_tg
  AFTER UPDATE OF resolved_reply_id ON public.club_threads
  FOR EACH ROW EXECUTE FUNCTION public.club_threads_notify_resolved();

CREATE OR REPLACE FUNCTION public.club_react(
  p_target_type text, p_target_id uuid, p_kind text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_club    uuid;
  v_group   uuid;
  v_caps    record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_target_type NOT IN ('thread', 'reply') THEN
    RAISE EXCEPTION 'clubs: invalid target type' USING ERRCODE = '22023';
  END IF;
  IF p_kind NOT IN ('insightful','evidence','question','agree','disagree','thanks') THEN
    RAISE EXCEPTION 'clubs: invalid reaction kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_target_type = 'thread' THEN
    SELECT club_id, group_id INTO v_club, v_group
      FROM public.club_threads WHERE id = p_target_id;
  ELSE
    SELECT t.club_id, t.group_id INTO v_club, v_group
      FROM public.club_replies r JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_target_id;
  END IF;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(v_club, v_group, v_uid);
  IF NOT COALESCE(v_caps.can_react, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.club_reactions (tenant_id, club_id, target_type, target_id, user_id, kind)
  SELECT c.tenant_id, v_club, p_target_type, p_target_id, v_uid, p_kind
    FROM public.clubs c WHERE c.id = v_club
  ON CONFLICT (target_type, target_id, user_id, kind) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_react(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_react(text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_unreact(
  p_target_type text, p_target_id uuid, p_kind text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.club_reactions
   WHERE target_type = p_target_type AND target_id = p_target_id
     AND user_id = auth.uid() AND kind = p_kind;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_unreact(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_unreact(text, uuid, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_reactions_for(text, uuid[]);
CREATE FUNCTION public.club_reactions_for(p_target_type text, p_target_ids uuid[])
RETURNS TABLE (target_id uuid, kind text, total bigint, mine boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.target_id, r.kind, count(*) AS total,
    bool_or(r.user_id = auth.uid()) AS mine
  FROM public.club_reactions r
  WHERE r.target_type = p_target_type
    AND r.target_id = ANY(p_target_ids[1:200])
    AND (SELECT can_read FROM public.club_capabilities(r.club_id, NULL, auth.uid()))
  GROUP BY r.target_id, r.kind
$$;
REVOKE EXECUTE ON FUNCTION public.club_reactions_for(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_reactions_for(text, uuid[])
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_set_stance(
  p_thread_id uuid, p_stance text, p_rationale text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_t    public.club_threads%ROWTYPE;
  v_caps record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_stance NOT IN ('support', 'oppose', 'abstain') THEN
    RAISE EXCEPTION 'clubs: invalid stance %', p_stance USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND OR v_t.kind <> 'position' THEN
    RAISE EXCEPTION 'clubs: stances only apply to position threads' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(v_t.club_id, v_t.group_id, v_uid);
  IF NOT COALESCE(v_caps.can_react, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.club_stances (tenant_id, club_id, thread_id, user_id, stance, rationale)
  VALUES (v_t.tenant_id, v_t.club_id, p_thread_id, v_uid, p_stance,
          NULLIF(btrim(COALESCE(p_rationale, '')), ''))
  ON CONFLICT (thread_id, user_id) DO UPDATE
    SET stance = EXCLUDED.stance, rationale = EXCLUDED.rationale;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_set_stance(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_stance(uuid, text, text)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_stance_summary(uuid);
CREATE FUNCTION public.club_stance_summary(p_thread_id uuid)
RETURNS TABLE (stance text, total bigint, mine boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.stance, count(*) AS total, bool_or(s.user_id = auth.uid()) AS mine
    FROM public.club_stances s
    JOIN public.club_threads t ON t.id = s.thread_id
   WHERE s.thread_id = p_thread_id
     AND (SELECT can_read FROM public.club_capabilities(t.club_id, t.group_id, auth.uid()))
   GROUP BY s.stance
$$;
REVOKE EXECUTE ON FUNCTION public.club_stance_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_stance_summary(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_subscribe_thread(p_thread_id uuid, p_state text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('subscribed', 'muted') THEN
    RAISE EXCEPTION 'clubs: invalid subscription state %', p_state USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.club_thread_subscriptions (thread_id, user_id, state)
  VALUES (p_thread_id, auth.uid(), p_state)
  ON CONFLICT (thread_id, user_id) DO UPDATE SET state = EXCLUDED.state;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_subscribe_thread(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_subscribe_thread(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_threads_autosubscribe()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.author_id IS NOT NULL THEN
    INSERT INTO public.club_thread_subscriptions (thread_id, user_id, state)
    VALUES (NEW.id, NEW.author_id, 'subscribed')
    ON CONFLICT (thread_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_threads_autosubscribe_tg ON public.club_threads;
CREATE TRIGGER club_threads_autosubscribe_tg
  AFTER INSERT ON public.club_threads
  FOR EACH ROW EXECUTE FUNCTION public.club_threads_autosubscribe();

CREATE OR REPLACE FUNCTION public.club_replies_autosubscribe()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.author_id IS NOT NULL THEN
    INSERT INTO public.club_thread_subscriptions (thread_id, user_id, state)
    VALUES (NEW.thread_id, NEW.author_id, 'subscribed')
    ON CONFLICT (thread_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_replies_autosubscribe_tg ON public.club_replies;
CREATE TRIGGER club_replies_autosubscribe_tg
  AFTER INSERT ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.club_replies_autosubscribe();

DROP FUNCTION IF EXISTS public.club_my_subscription(uuid);
CREATE FUNCTION public.club_my_subscription(p_thread_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.state FROM public.club_thread_subscriptions s
   WHERE s.thread_id = p_thread_id AND s.user_id = auth.uid()
     AND auth.uid() IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.club_my_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_my_subscription(uuid)
  TO authenticated, service_role;