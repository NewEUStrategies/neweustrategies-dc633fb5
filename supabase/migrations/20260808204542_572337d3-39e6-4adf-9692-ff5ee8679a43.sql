CREATE OR REPLACE FUNCTION public.club_thread_links_list(p_thread_id uuid)
RETURNS TABLE (
  id            uuid,
  relation      text,
  direction     text,
  note          text,
  thread_id     uuid,
  thread_slug   text,
  title         text,
  kind          text,
  status        text,
  club_slug     text,
  club_name_pl  text,
  club_name_en  text,
  reply_count   integer,
  last_reply_at timestamptz,
  created_at    timestamptz,
  can_remove    boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  ),
  edges AS (
    SELECT l.id, l.relation, 'outgoing'::text AS direction, l.note,
           l.related_thread_id AS other_id, l.created_at
      FROM acc JOIN public.club_thread_links l ON l.thread_id = acc.thread_id
    UNION ALL
    SELECT l.id, l.relation, 'incoming'::text, l.note,
           l.thread_id, l.created_at
      FROM acc JOIN public.club_thread_links l ON l.related_thread_id = acc.thread_id
  )
  SELECT
    e.id, e.relation, e.direction, e.note,
    t.id, t.slug, t.title, t.kind, t.status,
    c.slug, c.name_pl, c.name_en,
    t.reply_count, t.last_reply_at, e.created_at,
    acc.can_moderate
  FROM edges e
  CROSS JOIN acc
  JOIN public.club_threads t ON t.id = e.other_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) other_cap
  WHERE other_cap.can_read
    AND t.status IN ('open', 'resolved', 'dormant', 'locked')
  ORDER BY e.created_at DESC
$$;

COMMENT ON FUNCTION public.club_thread_links_list(uuid) IS
  'Powiazane watki w OBIE strony. Widocznosc drugiego konca liczy jego wlasne club_capabilities.';

REVOKE EXECUTE ON FUNCTION public.club_thread_links_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_links_list(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_polls_list(p_thread_id uuid)
RETURNS TABLE (
  id          uuid,
  poll_id     uuid,
  label       text,
  sort_order  integer,
  question_pl text,
  question_en text,
  poll_status text,
  ends_at     timestamptz,
  created_at  timestamptz,
  can_remove  boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    tp.id, tp.poll_id, tp.label, tp.sort_order,
    p.question_pl, p.question_en, p.status, p.ends_at, tp.created_at,
    acc.can_moderate
  FROM acc
  JOIN public.club_thread_polls tp ON tp.thread_id = acc.thread_id
  JOIN public.polls p ON p.id = tp.poll_id
  ORDER BY tp.sort_order, tp.created_at
$$;

COMMENT ON FUNCTION public.club_thread_polls_list(uuid) IS
  'Glosowania wpiete w watek. Zwraca identyfikatory - tresc obsluguje warstwa polls.';

REVOKE EXECUTE ON FUNCTION public.club_thread_polls_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_polls_list(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_search(
  p_thread_id uuid,
  p_query     text,
  p_limit     integer DEFAULT 30
)
RETURNS TABLE (
  section      text,
  item_id      uuid,
  title        text,
  snippet      text,
  occurred_at  timestamptz,
  author_label text,
  rank         real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  ),
  q AS (
    SELECT websearch_to_tsquery('public.nes_polish', btrim(COALESCE(p_query, ''))) AS tsq
  ),
  hits AS (
    SELECT
      'reply'::text AS section, r.id AS item_id,
      NULL::text AS title,
      ts_headline('public.nes_polish', r.body, q.tsq,
                  'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1') AS snippet,
      r.created_at AS occurred_at,
      CASE WHEN acc.hide_identity OR r.is_anonymous
           THEN public.club_author_alias(acc.thread_id, r.author_id)
           ELSE COALESCE(NULLIF(btrim(pr.display_name), ''), 'User') END AS author_label,
      ts_rank(r.search_vector, q.tsq) AS rank
    FROM acc CROSS JOIN q
    JOIN public.club_replies r ON r.thread_id = acc.thread_id
    LEFT JOIN public.profiles pr ON pr.id = r.author_id
    WHERE r.status IN ('visible', 'pending') AND r.search_vector @@ q.tsq

    UNION ALL

    SELECT 'document', d.id, d.title,
           ts_headline('public.nes_polish',
                       COALESCE(d.description, d.source_label, d.title), q.tsq,
                       'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1'),
           d.created_at,
           CASE WHEN acc.hide_identity THEN NULL
                ELSE COALESCE(NULLIF(btrim(pd.display_name), ''), 'User') END,
           ts_rank(d.search_vector, q.tsq)
    FROM acc CROSS JOIN q
    JOIN public.club_thread_documents d ON d.thread_id = acc.thread_id
    LEFT JOIN public.profiles pd ON pd.id = d.added_by
    WHERE d.status = 'visible' AND d.search_vector @@ q.tsq

    UNION ALL

    SELECT 'milestone', m.id, m.title,
           ts_headline('public.nes_polish', COALESCE(m.description, m.title), q.tsq,
                       'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1'),
           m.starts_at, NULL,
           ts_rank(m.search_vector, q.tsq)
    FROM acc CROSS JOIN q
    JOIN public.club_thread_milestones m ON m.thread_id = acc.thread_id
    WHERE m.search_vector @@ q.tsq

    UNION ALL

    SELECT 'question', qq.id, NULL,
           ts_headline('public.nes_polish', qq.body, q.tsq,
                       'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1'),
           qq.created_at,
           CASE WHEN acc.hide_identity OR qq.is_anonymous
                THEN public.club_author_alias(acc.thread_id, qq.author_id)
                ELSE COALESCE(NULLIF(btrim(pq.display_name), ''), 'User') END,
           ts_rank(qq.search_vector, q.tsq)
    FROM acc CROSS JOIN q
    JOIN public.club_thread_questions qq ON qq.thread_id = acc.thread_id
    LEFT JOIN public.profiles pq ON pq.id = qq.author_id
    WHERE qq.status <> 'hidden' AND qq.search_vector @@ q.tsq
  )
  SELECT section, item_id, title, snippet, occurred_at, author_label, rank
  FROM hits
  ORDER BY rank DESC, occurred_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100))
$$;

COMMENT ON FUNCTION public.club_thread_search(uuid, text, integer) IS
  'Wyszukiwanie WEWNATRZ watku po czterech sekcjach naraz.';

REVOKE EXECUTE ON FUNCTION public.club_thread_search(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_search(uuid, text, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_insights(
  p_thread_id uuid,
  p_buckets   integer DEFAULT 24
)
RETURNS TABLE (
  bucket_index integer,
  bucket_start timestamptz,
  bucket_end   timestamptz,
  replies      integer,
  questions    integer,
  documents    integer,
  milestones   integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  ),
  span AS (
    SELECT
      t.created_at AS from_at,
      GREATEST(now(), t.created_at + interval '1 hour') AS to_at,
      GREATEST(1, LEAST(COALESCE(p_buckets, 24), 96)) AS n
    FROM acc JOIN public.club_threads t ON t.id = acc.thread_id
  ),
  grid AS (
    SELECT
      i AS bucket_index,
      span.from_at + ((span.to_at - span.from_at) * i / span.n)       AS bucket_start,
      span.from_at + ((span.to_at - span.from_at) * (i + 1) / span.n) AS bucket_end
    FROM span, generate_series(0, span.n - 1) AS i
  )
  SELECT
    g.bucket_index, g.bucket_start, g.bucket_end,
    (SELECT count(*)::int FROM acc, public.club_replies r
      WHERE r.thread_id = acc.thread_id AND r.status IN ('visible', 'pending')
        AND r.created_at >= g.bucket_start AND r.created_at < g.bucket_end),
    (SELECT count(*)::int FROM acc, public.club_thread_questions q
      WHERE q.thread_id = acc.thread_id AND q.status <> 'hidden'
        AND q.created_at >= g.bucket_start AND q.created_at < g.bucket_end),
    (SELECT count(*)::int FROM acc, public.club_thread_documents d
      WHERE d.thread_id = acc.thread_id AND d.status = 'visible'
        AND d.created_at >= g.bucket_start AND d.created_at < g.bucket_end),
    (SELECT count(*)::int FROM acc, public.club_thread_milestones m
      WHERE m.thread_id = acc.thread_id AND m.status <> 'cancelled'
        AND m.starts_at >= g.bucket_start AND m.starts_at < g.bucket_end)
  FROM grid g
  ORDER BY g.bucket_index
$$;

COMMENT ON FUNCTION public.club_thread_insights(uuid, integer) IS
  'Szereg czasowy czterech rodzajow zdarzen watku, liczony w bazie.';

REVOKE EXECUTE ON FUNCTION public.club_thread_insights(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_insights(uuid, integer)
  TO anon, authenticated, service_role;