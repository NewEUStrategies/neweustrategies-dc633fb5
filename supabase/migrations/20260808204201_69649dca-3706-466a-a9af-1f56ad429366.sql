CREATE OR REPLACE FUNCTION public.club_question_vote_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT q.tenant_id INTO v_tenant
    FROM public.club_thread_questions q WHERE q.id = NEW.question_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: unknown question %', NEW.question_id USING ERRCODE = '23503';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.club_question_vote_pin_tenant() IS
  'Przypina tenant glosu do tenantu PYTANIA. Tabela glosow nie ma club_id, wiec club_child_pin_tenant() jej nie obsluzy.';

DROP TRIGGER IF EXISTS club_thread_question_votes_pin_tenant_tg
  ON public.club_thread_question_votes;
CREATE TRIGGER club_thread_question_votes_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_thread_question_votes
  FOR EACH ROW EXECUTE FUNCTION public.club_question_vote_pin_tenant();

CREATE OR REPLACE FUNCTION public.club_question_votes_sync_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_question uuid := COALESCE(NEW.question_id, OLD.question_id);
BEGIN
  UPDATE public.club_thread_questions q
     SET vote_count = (
           SELECT count(*)::int FROM public.club_thread_question_votes v
            WHERE v.question_id = v_question
         )
   WHERE q.id = v_question;
  RETURN NULL;
END; $$;

COMMENT ON FUNCTION public.club_question_votes_sync_count() IS
  'Utrzymuje club_thread_questions.vote_count. Sort "najwazniejsze" czyta ten licznik przy kazdym otwarciu panelu pytan.';

DROP TRIGGER IF EXISTS club_thread_question_votes_sync_tg ON public.club_thread_question_votes;
CREATE TRIGGER club_thread_question_votes_sync_tg
  AFTER INSERT OR DELETE ON public.club_thread_question_votes
  FOR EACH ROW EXECUTE FUNCTION public.club_question_votes_sync_count();

CREATE OR REPLACE FUNCTION public.club_thread_access(p_thread_id uuid)
RETURNS TABLE (
  thread_id        uuid,
  club_id          uuid,
  group_id         uuid,
  tenant_id        uuid,
  author_id        uuid,
  attribution_mode text,
  is_locked        boolean,
  hide_identity    boolean,
  can_read         boolean,
  can_reply        boolean,
  can_moderate     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.club_id, t.group_id, t.tenant_id, t.author_id,
    attr.mode,
    (t.locked_at IS NOT NULL OR t.status IN ('locked', 'hidden', 'deleted')),
    (t.is_anonymous OR attr.mode = 'chatham'),
    cap.can_read,
    (cap.can_reply AND t.locked_at IS NULL AND t.status NOT IN ('locked', 'hidden', 'deleted')),
    cap.can_moderate
  FROM public.club_threads t
  JOIN public.club_groups g ON g.id = t.group_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL (SELECT COALESCE(g.attribution_mode, c.attribution_mode) AS mode) attr
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE t.id = p_thread_id
$$;

COMMENT ON FUNCTION public.club_thread_access(uuid) IS
  'Jedyna bramka przestrzeni roboczej watku. Kazde RPC A28 zaczyna sie tutaj - drugi model uprawnien obok club_capabilities rozjechalby sie z nim w pierwszym tygodniu.';

REVOKE EXECUTE ON FUNCTION public.club_thread_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_thread_access(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.club_thread_participants(
  p_thread_id uuid,
  p_limit     integer DEFAULT 50
)
RETURNS TABLE (
  participant_key    text,
  user_id            uuid,
  display_name       text,
  avatar_url         text,
  profile_slug       text,
  alias              text,
  club_role          text,
  is_thread_author   boolean,
  reply_count        integer,
  question_count     integer,
  document_count     integer,
  reactions_received integer,
  stance             text,
  first_at           timestamptz,
  last_at            timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  ),
  contributions AS (
    SELECT
      t.author_id AS uid,
      (acc.hide_identity OR t.is_anonymous) AS anon,
      true  AS author_post,
      0 AS replies, 0 AS questions, 0 AS documents, 0 AS reactions,
      t.created_at AS at
      FROM acc JOIN public.club_threads t ON t.id = acc.thread_id
     WHERE t.author_id IS NOT NULL
    UNION ALL
    SELECT r.author_id, (acc.hide_identity OR r.is_anonymous), false,
           1, 0, 0, r.reaction_count, r.created_at
      FROM acc JOIN public.club_replies r ON r.thread_id = acc.thread_id
     WHERE r.status IN ('visible', 'pending') AND r.author_id IS NOT NULL
    UNION ALL
    SELECT q.author_id, (acc.hide_identity OR q.is_anonymous), false,
           0, 1, 0, 0, q.created_at
      FROM acc JOIN public.club_thread_questions q ON q.thread_id = acc.thread_id
     WHERE q.status <> 'hidden' AND q.author_id IS NOT NULL
    UNION ALL
    SELECT d.added_by, acc.hide_identity, false,
           0, 0, 1, 0, d.created_at
      FROM acc JOIN public.club_thread_documents d ON d.thread_id = acc.thread_id
     WHERE d.status = 'visible' AND d.added_by IS NOT NULL
  ),
  rolled AS (
    SELECT
      uid,
      anon,
      bool_or(author_post)  AS author_post,
      sum(replies)::int     AS replies,
      sum(questions)::int   AS questions,
      sum(documents)::int   AS documents,
      sum(reactions)::int   AS reactions,
      min(at)               AS first_at,
      max(at)               AS last_at
    FROM contributions
    GROUP BY uid, anon
  )
  SELECT
    CASE WHEN rolled.anon
         THEN 'alias:' || public.club_author_alias(acc.thread_id, rolled.uid)
         ELSE 'user:' || rolled.uid::text END,
    CASE WHEN rolled.anon THEN NULL ELSE rolled.uid END,
    CASE WHEN rolled.anon THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN rolled.anon OR p.hide_avatar THEN NULL ELSE p.avatar_url END,
    CASE WHEN rolled.anon THEN NULL ELSE p.slug END,
    CASE WHEN rolled.anon
         THEN public.club_author_alias(acc.thread_id, rolled.uid) ELSE NULL END,
    CASE WHEN rolled.anon THEN NULL
         ELSE public.club_effective_member_role(cm.role, cm.role_expires_at) END,
    rolled.author_post,
    rolled.replies, rolled.questions, rolled.documents, rolled.reactions,
    CASE WHEN rolled.anon THEN NULL ELSE st.stance END,
    rolled.first_at,
    rolled.last_at
  FROM acc
  JOIN rolled ON true
  LEFT JOIN public.profiles p ON p.id = rolled.uid
  LEFT JOIN public.club_members cm
         ON cm.club_id = acc.club_id AND cm.user_id = rolled.uid AND cm.status = 'active'
  LEFT JOIN public.club_stances st
         ON st.thread_id = acc.thread_id AND st.user_id = rolled.uid
  ORDER BY rolled.author_post DESC, rolled.replies DESC, rolled.last_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
$$;

COMMENT ON FUNCTION public.club_thread_participants(uuid, integer) IS
  'Uczestnicy watku liczeni z TRESCI (wypowiedzi, pytania, zrodla), nie z listy czlonkow klubu.';

REVOKE EXECUTE ON FUNCTION public.club_thread_participants(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_participants(uuid, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_workspace(p_thread_id uuid)
RETURNS TABLE (
  thread_id          uuid,
  document_count     integer,
  milestone_count    integer,
  upcoming_count     integer,
  question_count     integer,
  open_question_count integer,
  poll_count         integer,
  open_poll_count    integer,
  link_count         integer,
  participant_count  integer,
  reply_count        integer,
  next_milestone_at  timestamptz,
  can_contribute     boolean,
  can_curate         boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    acc.thread_id,
    (SELECT count(*)::int FROM public.club_thread_documents d
      WHERE d.thread_id = acc.thread_id AND d.status = 'visible'),
    (SELECT count(*)::int FROM public.club_thread_milestones m
      WHERE m.thread_id = acc.thread_id AND m.status <> 'cancelled'),
    (SELECT count(*)::int FROM public.club_thread_milestones m
      WHERE m.thread_id = acc.thread_id AND m.status IN ('planned', 'active')
        AND COALESCE(m.ends_at, m.starts_at) >= now()),
    (SELECT count(*)::int FROM public.club_thread_questions q
      WHERE q.thread_id = acc.thread_id AND q.status <> 'hidden'),
    (SELECT count(*)::int FROM public.club_thread_questions q
      WHERE q.thread_id = acc.thread_id AND q.status = 'open'),
    (SELECT count(*)::int FROM public.club_thread_polls tp
      WHERE tp.thread_id = acc.thread_id),
    (SELECT count(*)::int FROM public.club_thread_polls tp
      JOIN public.polls p ON p.id = tp.poll_id
      WHERE tp.thread_id = acc.thread_id AND p.status = 'open'
        AND (p.ends_at IS NULL OR p.ends_at > now())),
    (SELECT count(*)::int FROM public.club_thread_links l
      WHERE l.thread_id = acc.thread_id OR l.related_thread_id = acc.thread_id),
    (SELECT count(*)::int FROM public.club_thread_participants(acc.thread_id, 200)),
    t.reply_count,
    (SELECT min(m.starts_at) FROM public.club_thread_milestones m
      WHERE m.thread_id = acc.thread_id AND m.status IN ('planned', 'active')
        AND m.starts_at >= now()),
    acc.can_reply,
    acc.can_moderate
  FROM acc
  JOIN public.club_threads t ON t.id = acc.thread_id
$$;

COMMENT ON FUNCTION public.club_thread_workspace(uuid) IS
  'Spis tresci przestrzeni roboczej watku: liczniki wszystkich paneli i dwie flagi uprawnien w JEDNYM wywolaniu.';

REVOKE EXECUTE ON FUNCTION public.club_thread_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_workspace(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_documents_list(
  p_thread_id uuid,
  p_kind      text DEFAULT NULL,
  p_limit     integer DEFAULT 100
)
RETURNS TABLE (
  id            uuid,
  kind          text,
  title         text,
  description   text,
  url           text,
  source_label  text,
  published_on  date,
  mime_type     text,
  byte_size     bigint,
  is_primary    boolean,
  sort_order    integer,
  added_by_id   uuid,
  added_by_name text,
  added_by_slug text,
  created_at    timestamptz,
  can_edit      boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    d.id, d.kind, d.title, d.description, d.url, d.source_label,
    d.published_on, d.mime_type, d.byte_size, d.is_primary, d.sort_order,
    CASE WHEN acc.hide_identity THEN NULL ELSE d.added_by END,
    CASE WHEN acc.hide_identity THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN acc.hide_identity THEN NULL ELSE p.slug END,
    d.created_at,
    (acc.can_moderate OR (d.added_by IS NOT NULL AND d.added_by = auth.uid()))
  FROM acc
  JOIN public.club_thread_documents d ON d.thread_id = acc.thread_id
  LEFT JOIN public.profiles p ON p.id = d.added_by
  WHERE (d.status = 'visible' OR (d.status = 'hidden' AND acc.can_moderate))
    AND (p_kind IS NULL OR d.kind = p_kind)
  ORDER BY d.is_primary DESC, d.sort_order, d.published_on DESC NULLS LAST, d.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
$$;

COMMENT ON FUNCTION public.club_thread_documents_list(uuid, text, integer) IS
  'Biblioteka zrodel watku. can_edit liczone po stronie bazy.';

REVOKE EXECUTE ON FUNCTION public.club_thread_documents_list(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_documents_list(uuid, text, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_milestones_list(
  p_thread_id uuid,
  p_from      timestamptz DEFAULT NULL,
  p_to        timestamptz DEFAULT NULL,
  p_limit     integer DEFAULT 200
)
RETURNS TABLE (
  id           uuid,
  kind         text,
  status       text,
  title        text,
  description  text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  all_day      boolean,
  location     text,
  url          text,
  sort_order   integer,
  event_id     uuid,
  event_slug   text,
  owner_id     uuid,
  owner_name   text,
  owner_slug   text,
  created_at   timestamptz,
  can_edit     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    m.id, m.kind, m.status, m.title, m.description,
    m.starts_at, m.ends_at, m.all_day, m.location, m.url, m.sort_order,
    m.event_id, e.slug,
    CASE WHEN acc.hide_identity THEN NULL ELSE m.owner_id END,
    CASE WHEN acc.hide_identity THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN acc.hide_identity THEN NULL ELSE p.slug END,
    m.created_at,
    acc.can_moderate
  FROM acc
  JOIN public.club_thread_milestones m ON m.thread_id = acc.thread_id
  LEFT JOIN public.profiles p ON p.id = m.owner_id
  LEFT JOIN public.events e ON e.id = m.event_id
  WHERE (p_from IS NULL OR COALESCE(m.ends_at, m.starts_at) >= p_from)
    AND (p_to IS NULL OR m.starts_at <= p_to)
  ORDER BY m.starts_at, m.sort_order, m.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
$$;

COMMENT ON FUNCTION public.club_thread_milestones_list(uuid, timestamptz, timestamptz, integer) IS
  'Harmonogram watku. Jeden zbior, dwie prezentacje (lista i kalendarz).';

REVOKE EXECUTE ON FUNCTION
  public.club_thread_milestones_list(uuid, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.club_thread_milestones_list(uuid, timestamptz, timestamptz, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_questions_list(
  p_thread_id uuid,
  p_status    text DEFAULT NULL,
  p_sort      text DEFAULT 'top',
  p_limit     integer DEFAULT 100
)
RETURNS TABLE (
  id             uuid,
  body           text,
  status         text,
  answer_body    text,
  answered_at    timestamptz,
  answered_by_id uuid,
  answered_by_name text,
  vote_count     integer,
  my_vote        boolean,
  author_id      uuid,
  author_name    text,
  author_avatar  text,
  author_slug    text,
  author_alias   text,
  created_at     timestamptz,
  can_answer     boolean,
  can_edit       boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    q.id, q.body, q.status, q.answer_body, q.answered_at,
    q.answered_by,
    COALESCE(NULLIF(btrim(pa.display_name), ''), 'User'),
    q.vote_count,
    EXISTS (SELECT 1 FROM public.club_thread_question_votes v
             WHERE v.question_id = q.id AND v.user_id = auth.uid()),
    CASE WHEN acc.hide_identity OR q.is_anonymous THEN NULL ELSE q.author_id END,
    CASE WHEN acc.hide_identity OR q.is_anonymous THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN acc.hide_identity OR q.is_anonymous OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN acc.hide_identity OR q.is_anonymous THEN NULL ELSE p.slug END,
    CASE WHEN acc.hide_identity OR q.is_anonymous
         THEN public.club_author_alias(acc.thread_id, q.author_id) ELSE NULL END,
    q.created_at,
    (acc.can_moderate OR (acc.author_id IS NOT NULL AND acc.author_id = auth.uid())),
    (acc.can_moderate OR (q.author_id IS NOT NULL AND q.author_id = auth.uid()))
  FROM acc
  JOIN public.club_thread_questions q ON q.thread_id = acc.thread_id
  LEFT JOIN public.profiles p ON p.id = q.author_id
  LEFT JOIN public.profiles pa ON pa.id = q.answered_by
  WHERE (q.status <> 'hidden' OR acc.can_moderate)
    AND (p_status IS NULL OR q.status = p_status)
  ORDER BY
    CASE WHEN p_sort = 'top' THEN q.vote_count END DESC NULLS LAST,
    CASE WHEN p_sort = 'unanswered' AND q.status = 'open' THEN 0 ELSE 1 END,
    q.created_at DESC,
    q.id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 300))
$$;

COMMENT ON FUNCTION public.club_thread_questions_list(uuid, text, text, integer) IS
  'Kolejka Q&A. Chroniona jest tozsamosc PYTAJACEGO; odpowiadajacy jest jawny takze w trybie chatham.';

REVOKE EXECUTE ON FUNCTION public.club_thread_questions_list(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_questions_list(uuid, text, text, integer)
  TO anon, authenticated, service_role;