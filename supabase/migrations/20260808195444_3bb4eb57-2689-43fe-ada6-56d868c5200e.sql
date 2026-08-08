CREATE TABLE IF NOT EXISTS public.club_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  group_id        uuid REFERENCES public.club_groups(id) ON DELETE SET NULL,
  thread_id       uuid REFERENCES public.club_threads(id) ON DELETE SET NULL,

  slug            text NOT NULL,
  title_pl        text NOT NULL,
  title_en        text NOT NULL,
  summary_pl      text,
  summary_en      text,

  kind            text NOT NULL DEFAULT 'brief'
                  CHECK (kind IN ('brief', 'analysis', 'minutes', 'dataset',
                                  'position', 'legal', 'presentation', 'other')),

  file_url        text,
  file_size       bigint CHECK (file_size IS NULL OR file_size >= 0),
  mime_type       text,
  external_url    text,

  visibility      text NOT NULL DEFAULT 'club'
                  CHECK (visibility IN ('club', 'moderators')),
  status          text NOT NULL DEFAULT 'published'
                  CHECK (status IN ('draft', 'published', 'archived')),

  language        text NOT NULL DEFAULT 'pl' CHECK (language IN ('pl', 'en', 'mixed')),
  version         text,
  source_label    text,
  published_at    timestamptz,
  pinned_at       timestamptz,
  download_count  integer NOT NULL DEFAULT 0,

  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_documents_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT club_documents_title_pl_len CHECK (char_length(btrim(title_pl)) BETWEEN 2 AND 200),
  CONSTRAINT club_documents_title_en_len CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 200),
  CONSTRAINT club_documents_has_payload CHECK (
    NULLIF(btrim(COALESCE(file_url, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(external_url, '')), '') IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS club_documents_club_slug_key
  ON public.club_documents (club_id, slug);
CREATE INDEX IF NOT EXISTS club_documents_club_recent_idx
  ON public.club_documents (club_id, pinned_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS club_documents_club_kind_idx
  ON public.club_documents (club_id, kind, status);
CREATE INDEX IF NOT EXISTS club_documents_thread_idx
  ON public.club_documents (thread_id) WHERE thread_id IS NULL IS FALSE;

CREATE TABLE IF NOT EXISTS public.club_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id          uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  group_id         uuid REFERENCES public.club_groups(id) ON DELETE SET NULL,
  thread_id        uuid REFERENCES public.club_threads(id) ON DELETE SET NULL,

  anchor_event_id  uuid REFERENCES public.events(id) ON DELETE SET NULL,

  slug             text NOT NULL,
  title_pl         text NOT NULL,
  title_en         text NOT NULL,
  description_pl   text,
  description_en   text,

  kind             text NOT NULL DEFAULT 'meeting'
                   CHECK (kind IN ('meeting', 'briefing', 'deadline', 'consultation',
                                   'publication', 'vote', 'workshop', 'other')),

  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz,
  all_day          boolean NOT NULL DEFAULT false,
  location         text,
  meeting_url      text,

  status           text NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'cancelled', 'done')),

  rsvp_enabled     boolean NOT NULL DEFAULT false,
  capacity         integer CHECK (capacity IS NULL OR capacity > 0),
  going_count      integer NOT NULL DEFAULT 0,

  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_events_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT club_events_title_pl_len CHECK (char_length(btrim(title_pl)) BETWEEN 2 AND 200),
  CONSTRAINT club_events_title_en_len CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 200),
  CONSTRAINT club_events_range CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS club_events_club_slug_key
  ON public.club_events (club_id, slug);
CREATE INDEX IF NOT EXISTS club_events_club_starts_idx
  ON public.club_events (club_id, starts_at);
CREATE INDEX IF NOT EXISTS club_events_club_kind_idx
  ON public.club_events (club_id, kind, starts_at);

CREATE TABLE IF NOT EXISTS public.club_event_rsvps (
  event_id   uuid NOT NULL REFERENCES public.club_events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  state      text NOT NULL DEFAULT 'going' CHECK (state IN ('going', 'maybe', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS club_event_rsvps_user_idx
  ON public.club_event_rsvps (user_id, state);

CREATE TABLE IF NOT EXISTS public.club_milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  thread_id      uuid REFERENCES public.club_threads(id) ON DELETE SET NULL,

  slug           text NOT NULL,
  title_pl       text NOT NULL,
  title_en       text NOT NULL,
  description_pl text,
  description_en text,

  state          text NOT NULL DEFAULT 'planned'
                 CHECK (state IN ('planned', 'active', 'done', 'blocked', 'cancelled')),

  starts_on      date,
  due_on         date,
  progress       smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  order_index    integer NOT NULL DEFAULT 0,

  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_milestones_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT club_milestones_title_pl_len CHECK (char_length(btrim(title_pl)) BETWEEN 2 AND 200),
  CONSTRAINT club_milestones_title_en_len CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 200),
  CONSTRAINT club_milestones_range CHECK (due_on IS NULL OR starts_on IS NULL OR due_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS club_milestones_club_slug_key
  ON public.club_milestones (club_id, slug);
CREATE INDEX IF NOT EXISTS club_milestones_club_order_idx
  ON public.club_milestones (club_id, order_index, due_on NULLS LAST);

ALTER TABLE public.club_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_event_rsvps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_milestones   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.club_documents   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_events      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_event_rsvps FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_milestones  FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.club_documents   TO service_role;
GRANT ALL ON public.club_events      TO service_role;
GRANT ALL ON public.club_event_rsvps TO service_role;
GRANT ALL ON public.club_milestones  TO service_role;

DROP TRIGGER IF EXISTS club_documents_pin_tenant_tg ON public.club_documents;
CREATE TRIGGER club_documents_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_documents
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_events_pin_tenant_tg ON public.club_events;
CREATE TRIGGER club_events_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_events
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_milestones_pin_tenant_tg ON public.club_milestones;
CREATE TRIGGER club_milestones_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_milestones
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

CREATE OR REPLACE FUNCTION public.club_event_rsvp_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT e.tenant_id INTO v_tenant FROM public.club_events e WHERE e.id = NEW.event_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: unknown event %', NEW.event_id USING ERRCODE = '23503';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS club_event_rsvps_pin_tenant_tg ON public.club_event_rsvps;
CREATE TRIGGER club_event_rsvps_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.club_event_rsvp_pin_tenant();

DROP TRIGGER IF EXISTS club_documents_set_updated_tg ON public.club_documents;
CREATE TRIGGER club_documents_set_updated_tg BEFORE UPDATE ON public.club_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_events_set_updated_tg ON public.club_events;
CREATE TRIGGER club_events_set_updated_tg BEFORE UPDATE ON public.club_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_event_rsvps_set_updated_tg ON public.club_event_rsvps;
CREATE TRIGGER club_event_rsvps_set_updated_tg BEFORE UPDATE ON public.club_event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_milestones_set_updated_tg ON public.club_milestones;
CREATE TRIGGER club_milestones_set_updated_tg BEFORE UPDATE ON public.club_milestones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.club_event_rsvps_sync_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_event uuid := COALESCE(NEW.event_id, OLD.event_id);
BEGIN
  UPDATE public.club_events e
     SET going_count = (
           SELECT count(*)::int FROM public.club_event_rsvps r
            WHERE r.event_id = v_event AND r.state = 'going'
         )
   WHERE e.id = v_event;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS club_event_rsvps_sync_count_tg ON public.club_event_rsvps;
CREATE TRIGGER club_event_rsvps_sync_count_tg
  AFTER INSERT OR UPDATE OR DELETE ON public.club_event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.club_event_rsvps_sync_count();

CREATE OR REPLACE FUNCTION public.club_require_curator(_club_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_caps   record;
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT c.tenant_id INTO v_tenant FROM public.clubs c WHERE c.id = _club_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(_club_id, NULL, v_uid);
  IF NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN v_tenant;
END;
$$;

COMMENT ON FUNCTION public.club_require_curator(uuid) IS
  'Bramka kuratorska przestrzeni roboczej klubu (dokumenty, kalendarz, harmonogram): wymaga can_moderate. Zwraca tenant_id klubu.';

REVOKE EXECUTE ON FUNCTION public.club_require_curator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_require_curator(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_documents_list(uuid, uuid, text, text, integer, integer);

CREATE FUNCTION public.club_documents_list(
  p_club_id  uuid,
  p_group_id uuid    DEFAULT NULL,
  p_kind     text    DEFAULT NULL,
  p_search   text    DEFAULT NULL,
  p_limit    integer DEFAULT 50,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, thread_id uuid,
  slug text, title_pl text, title_en text, summary_pl text, summary_en text,
  kind text, file_url text, file_size bigint, mime_type text, external_url text,
  visibility text, status text, language text, version text, source_label text,
  published_at timestamptz, pinned_at timestamptz, download_count integer,
  thread_slug text, group_name_pl text, group_name_en text,
  uploader_name text, created_at timestamptz, updated_at timestamptz,
  can_manage boolean, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH caps AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  visible AS (
    SELECT d.*
      FROM public.club_documents d
     CROSS JOIN caps
     WHERE d.club_id = p_club_id
       AND caps.can_read
       AND (d.visibility = 'club' OR caps.can_moderate)
       AND (d.status = 'published' OR caps.can_moderate OR d.uploaded_by = auth.uid())
       AND (p_group_id IS NULL OR d.group_id = p_group_id)
       AND (p_kind IS NULL OR d.kind = p_kind)
       AND (
         NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
         OR d.title_pl ILIKE '%' || btrim(p_search) || '%'
         OR d.title_en ILIKE '%' || btrim(p_search) || '%'
         OR COALESCE(d.summary_pl, '') ILIKE '%' || btrim(p_search) || '%'
         OR COALESCE(d.summary_en, '') ILIKE '%' || btrim(p_search) || '%'
       )
  )
  SELECT
    v.id, v.club_id, v.group_id, v.thread_id,
    v.slug, v.title_pl, v.title_en, v.summary_pl, v.summary_en,
    v.kind, v.file_url, v.file_size, v.mime_type, v.external_url,
    v.visibility, v.status, v.language, v.version, v.source_label,
    v.published_at, v.pinned_at, v.download_count,
    t.slug, g.name_pl, g.name_en,
    NULLIF(btrim(COALESCE(p.display_name, '')), ''),
    v.created_at, v.updated_at,
    caps.can_moderate,
    count(*) OVER ()
  FROM visible v
  CROSS JOIN caps
  LEFT JOIN public.club_threads t ON t.id = v.thread_id
  LEFT JOIN public.club_groups  g ON g.id = v.group_id
  LEFT JOIN public.profiles     p ON p.id = v.uploaded_by
  ORDER BY v.pinned_at DESC NULLS LAST, v.created_at DESC
  LIMIT  GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0))
$$;

COMMENT ON FUNCTION public.club_documents_list(uuid, uuid, text, text, integer, integer) IS
  'Biblioteka klubu. Dokumenty moderacyjne i szkice sa odsiewane w projekcji, a nie w kliencie.';

REVOKE EXECUTE ON FUNCTION public.club_documents_list(uuid, uuid, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_documents_list(uuid, uuid, text, text, integer, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_document_upsert(
  p_club_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.club_require_curator(p_club_id);
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_slug   text := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
  v_uid    uuid := auth.uid();
BEGIN
  IF v_id IS NULL THEN
    IF v_slug IS NULL THEN
      RAISE EXCEPTION 'clubs: slug required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.club_documents (
      tenant_id, club_id, group_id, thread_id, slug,
      title_pl, title_en, summary_pl, summary_en, kind,
      file_url, file_size, mime_type, external_url,
      visibility, status, language, version, source_label,
      published_at, pinned_at, uploaded_by
    ) VALUES (
      v_tenant, p_club_id,
      NULLIF(p_payload->>'group_id', '')::uuid,
      NULLIF(p_payload->>'thread_id', '')::uuid,
      v_slug,
      COALESCE(p_payload->>'title_pl', ''),
      COALESCE(p_payload->>'title_en', ''),
      NULLIF(p_payload->>'summary_pl', ''),
      NULLIF(p_payload->>'summary_en', ''),
      COALESCE(NULLIF(p_payload->>'kind', ''), 'brief'),
      NULLIF(p_payload->>'file_url', ''),
      NULLIF(p_payload->>'file_size', '')::bigint,
      NULLIF(p_payload->>'mime_type', ''),
      NULLIF(p_payload->>'external_url', ''),
      COALESCE(NULLIF(p_payload->>'visibility', ''), 'club'),
      COALESCE(NULLIF(p_payload->>'status', ''), 'published'),
      COALESCE(NULLIF(p_payload->>'language', ''), 'pl'),
      NULLIF(p_payload->>'version', ''),
      NULLIF(p_payload->>'source_label', ''),
      CASE WHEN COALESCE(NULLIF(p_payload->>'status', ''), 'published') = 'published'
           THEN now() ELSE NULL END,
      CASE WHEN COALESCE((p_payload->>'pinned')::boolean, false) THEN now() ELSE NULL END,
      v_uid
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  END IF;

  UPDATE public.club_documents d SET
    group_id     = CASE WHEN p_payload ? 'group_id'
                        THEN NULLIF(p_payload->>'group_id', '')::uuid ELSE d.group_id END,
    thread_id    = CASE WHEN p_payload ? 'thread_id'
                        THEN NULLIF(p_payload->>'thread_id', '')::uuid ELSE d.thread_id END,
    slug         = COALESCE(v_slug, d.slug),
    title_pl     = COALESCE(NULLIF(p_payload->>'title_pl', ''), d.title_pl),
    title_en     = COALESCE(NULLIF(p_payload->>'title_en', ''), d.title_en),
    summary_pl   = CASE WHEN p_payload ? 'summary_pl'
                        THEN NULLIF(p_payload->>'summary_pl', '') ELSE d.summary_pl END,
    summary_en   = CASE WHEN p_payload ? 'summary_en'
                        THEN NULLIF(p_payload->>'summary_en', '') ELSE d.summary_en END,
    kind         = COALESCE(NULLIF(p_payload->>'kind', ''), d.kind),
    file_url     = CASE WHEN p_payload ? 'file_url'
                        THEN NULLIF(p_payload->>'file_url', '') ELSE d.file_url END,
    file_size    = CASE WHEN p_payload ? 'file_size'
                        THEN NULLIF(p_payload->>'file_size', '')::bigint ELSE d.file_size END,
    mime_type    = CASE WHEN p_payload ? 'mime_type'
                        THEN NULLIF(p_payload->>'mime_type', '') ELSE d.mime_type END,
    external_url = CASE WHEN p_payload ? 'external_url'
                        THEN NULLIF(p_payload->>'external_url', '') ELSE d.external_url END,
    visibility   = COALESCE(NULLIF(p_payload->>'visibility', ''), d.visibility),
    status       = COALESCE(NULLIF(p_payload->>'status', ''), d.status),
    language     = COALESCE(NULLIF(p_payload->>'language', ''), d.language),
    version      = CASE WHEN p_payload ? 'version'
                        THEN NULLIF(p_payload->>'version', '') ELSE d.version END,
    source_label = CASE WHEN p_payload ? 'source_label'
                        THEN NULLIF(p_payload->>'source_label', '') ELSE d.source_label END,
    published_at = CASE
                     WHEN COALESCE(NULLIF(p_payload->>'status', ''), d.status) = 'published'
                       THEN COALESCE(d.published_at, now())
                     ELSE d.published_at
                   END,
    pinned_at    = CASE
                     WHEN p_payload ? 'pinned'
                       THEN CASE WHEN (p_payload->>'pinned')::boolean THEN COALESCE(d.pinned_at, now()) ELSE NULL END
                     ELSE d.pinned_at
                   END
  WHERE d.id = v_id AND d.club_id = p_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_document_upsert(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_document_upsert(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_document_delete(p_document_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club uuid;
BEGIN
  SELECT d.club_id INTO v_club FROM public.club_documents d WHERE d.id = p_document_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  PERFORM public.club_require_curator(v_club);
  DELETE FROM public.club_documents WHERE id = p_document_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_document_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_document_delete(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_document_register_download(p_document_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club uuid;
  v_vis  text;
  v_caps record;
BEGIN
  SELECT d.club_id, d.visibility INTO v_club, v_vis
    FROM public.club_documents d WHERE d.id = p_document_id;
  IF v_club IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_club, NULL, auth.uid());
  IF NOT COALESCE(v_caps.can_read, false) THEN
    RETURN false;
  END IF;
  IF v_vis = 'moderators' AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RETURN false;
  END IF;

  UPDATE public.club_documents
     SET download_count = download_count + 1
   WHERE id = p_document_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_document_register_download(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_document_register_download(uuid) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_events_list(uuid, timestamptz, timestamptz, text, integer);

CREATE FUNCTION public.club_events_list(
  p_club_id uuid,
  p_from    timestamptz DEFAULT NULL,
  p_to      timestamptz DEFAULT NULL,
  p_kind    text        DEFAULT NULL,
  p_limit   integer     DEFAULT 200
)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, thread_id uuid, anchor_event_id uuid,
  slug text, title_pl text, title_en text, description_pl text, description_en text,
  kind text, starts_at timestamptz, ends_at timestamptz, all_day boolean,
  location text, meeting_url text, status text,
  rsvp_enabled boolean, capacity integer, going_count integer,
  my_rsvp text, thread_slug text, group_name_pl text, group_name_en text,
  created_at timestamptz, can_manage boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id, e.club_id, e.group_id, e.thread_id, e.anchor_event_id,
    e.slug, e.title_pl, e.title_en, e.description_pl, e.description_en,
    e.kind, e.starts_at, e.ends_at, e.all_day,
    e.location,
    CASE WHEN cap.can_reply OR cap.can_moderate THEN e.meeting_url ELSE NULL END,
    e.status,
    e.rsvp_enabled, e.capacity, e.going_count,
    r.state,
    t.slug, g.name_pl, g.name_en,
    e.created_at, cap.can_moderate
  FROM public.club_events e
  CROSS JOIN LATERAL public.club_capabilities(e.club_id, NULL, auth.uid()) cap
  LEFT JOIN public.club_threads t ON t.id = e.thread_id
  LEFT JOIN public.club_groups  g ON g.id = e.group_id
  LEFT JOIN public.club_event_rsvps r ON r.event_id = e.id AND r.user_id = auth.uid()
  WHERE e.club_id = p_club_id
    AND cap.can_read
    AND (p_from IS NULL OR COALESCE(e.ends_at, e.starts_at) >= p_from)
    AND (p_to   IS NULL OR e.starts_at <= p_to)
    AND (p_kind IS NULL OR e.kind = p_kind)
  ORDER BY e.starts_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
$$;

COMMENT ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) IS
  'Kalendarz klubu w zakresie dat. meeting_url wychodzi tylko uczestnikom.';

REVOKE EXECUTE ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_event_upsert(
  p_club_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.club_require_curator(p_club_id);
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_slug   text := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
BEGIN
  IF v_id IS NULL THEN
    IF v_slug IS NULL THEN
      RAISE EXCEPTION 'clubs: slug required' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(p_payload->>'starts_at', '') IS NULL THEN
      RAISE EXCEPTION 'clubs: starts_at required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.club_events (
      tenant_id, club_id, group_id, thread_id, anchor_event_id, slug,
      title_pl, title_en, description_pl, description_en, kind,
      starts_at, ends_at, all_day, location, meeting_url, status,
      rsvp_enabled, capacity, created_by
    ) VALUES (
      v_tenant, p_club_id,
      NULLIF(p_payload->>'group_id', '')::uuid,
      NULLIF(p_payload->>'thread_id', '')::uuid,
      NULLIF(p_payload->>'anchor_event_id', '')::uuid,
      v_slug,
      COALESCE(p_payload->>'title_pl', ''),
      COALESCE(p_payload->>'title_en', ''),
      NULLIF(p_payload->>'description_pl', ''),
      NULLIF(p_payload->>'description_en', ''),
      COALESCE(NULLIF(p_payload->>'kind', ''), 'meeting'),
      (p_payload->>'starts_at')::timestamptz,
      NULLIF(p_payload->>'ends_at', '')::timestamptz,
      COALESCE((p_payload->>'all_day')::boolean, false),
      NULLIF(p_payload->>'location', ''),
      NULLIF(p_payload->>'meeting_url', ''),
      COALESCE(NULLIF(p_payload->>'status', ''), 'scheduled'),
      COALESCE((p_payload->>'rsvp_enabled')::boolean, false),
      NULLIF(p_payload->>'capacity', '')::integer,
      auth.uid()
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  END IF;

  UPDATE public.club_events e SET
    group_id        = CASE WHEN p_payload ? 'group_id'
                           THEN NULLIF(p_payload->>'group_id', '')::uuid ELSE e.group_id END,
    thread_id       = CASE WHEN p_payload ? 'thread_id'
                           THEN NULLIF(p_payload->>'thread_id', '')::uuid ELSE e.thread_id END,
    anchor_event_id = CASE WHEN p_payload ? 'anchor_event_id'
                           THEN NULLIF(p_payload->>'anchor_event_id', '')::uuid ELSE e.anchor_event_id END,
    slug            = COALESCE(v_slug, e.slug),
    title_pl        = COALESCE(NULLIF(p_payload->>'title_pl', ''), e.title_pl),
    title_en        = COALESCE(NULLIF(p_payload->>'title_en', ''), e.title_en),
    description_pl  = CASE WHEN p_payload ? 'description_pl'
                           THEN NULLIF(p_payload->>'description_pl', '') ELSE e.description_pl END,
    description_en  = CASE WHEN p_payload ? 'description_en'
                           THEN NULLIF(p_payload->>'description_en', '') ELSE e.description_en END,
    kind            = COALESCE(NULLIF(p_payload->>'kind', ''), e.kind),
    starts_at       = COALESCE(NULLIF(p_payload->>'starts_at', '')::timestamptz, e.starts_at),
    ends_at         = CASE WHEN p_payload ? 'ends_at'
                           THEN NULLIF(p_payload->>'ends_at', '')::timestamptz ELSE e.ends_at END,
    all_day         = COALESCE((p_payload->>'all_day')::boolean, e.all_day),
    location        = CASE WHEN p_payload ? 'location'
                           THEN NULLIF(p_payload->>'location', '') ELSE e.location END,
    meeting_url     = CASE WHEN p_payload ? 'meeting_url'
                           THEN NULLIF(p_payload->>'meeting_url', '') ELSE e.meeting_url END,
    status          = COALESCE(NULLIF(p_payload->>'status', ''), e.status),
    rsvp_enabled    = COALESCE((p_payload->>'rsvp_enabled')::boolean, e.rsvp_enabled),
    capacity        = CASE WHEN p_payload ? 'capacity'
                           THEN NULLIF(p_payload->>'capacity', '')::integer ELSE e.capacity END
  WHERE e.id = v_id AND e.club_id = p_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_event_upsert(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_upsert(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_event_delete(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club uuid;
BEGIN
  SELECT e.club_id INTO v_club FROM public.club_events e WHERE e.id = p_event_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  PERFORM public.club_require_curator(v_club);
  DELETE FROM public.club_events WHERE id = p_event_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_event_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_delete(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_event_rsvp(
  p_event_id uuid,
  p_state    text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_club     uuid;
  v_tenant   uuid;
  v_enabled  boolean;
  v_capacity integer;
  v_going    integer;
  v_prev     text;
  v_member   boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('going', 'maybe', 'declined') THEN
    RAISE EXCEPTION 'clubs: invalid rsvp state %', p_state USING ERRCODE = '22023';
  END IF;

  SELECT e.club_id, e.tenant_id, e.rsvp_enabled, e.capacity, e.going_count
    INTO v_club, v_tenant, v_enabled, v_capacity, v_going
    FROM public.club_events e WHERE e.id = p_event_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'clubs: rsvp disabled' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.club_members m
     WHERE m.club_id = v_club AND m.user_id = v_uid AND m.status = 'active'
  ) INTO v_member;
  IF NOT v_member THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT r.state INTO v_prev
    FROM public.club_event_rsvps r
   WHERE r.event_id = p_event_id AND r.user_id = v_uid;

  IF p_state = 'going'
     AND v_capacity IS NOT NULL
     AND COALESCE(v_prev, '') <> 'going'
     AND v_going >= v_capacity THEN
    RAISE EXCEPTION 'clubs: event is full' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_event_rsvps (event_id, user_id, tenant_id, state)
  VALUES (p_event_id, v_uid, v_tenant, p_state)
  ON CONFLICT (event_id, user_id) DO UPDATE SET state = EXCLUDED.state;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_event_rsvp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_rsvp(uuid, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_milestones_list(uuid);

CREATE FUNCTION public.club_milestones_list(p_club_id uuid)
RETURNS TABLE (
  id uuid, club_id uuid, thread_id uuid, slug text,
  title_pl text, title_en text, description_pl text, description_en text,
  state text, starts_on date, due_on date, progress smallint, order_index integer,
  thread_slug text, created_at timestamptz, can_manage boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id, m.club_id, m.thread_id, m.slug,
    m.title_pl, m.title_en, m.description_pl, m.description_en,
    m.state, m.starts_on, m.due_on, m.progress, m.order_index,
    t.slug, m.created_at, cap.can_moderate
  FROM public.club_milestones m
  CROSS JOIN LATERAL public.club_capabilities(m.club_id, NULL, auth.uid()) cap
  LEFT JOIN public.club_threads t ON t.id = m.thread_id
  WHERE m.club_id = p_club_id
    AND cap.can_read
  ORDER BY m.order_index ASC, m.due_on ASC NULLS LAST, m.created_at ASC
$$;

REVOKE EXECUTE ON FUNCTION public.club_milestones_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_milestones_list(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_milestone_upsert(
  p_club_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.club_require_curator(p_club_id);
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_slug   text := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
BEGIN
  IF v_id IS NULL THEN
    IF v_slug IS NULL THEN
      RAISE EXCEPTION 'clubs: slug required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.club_milestones (
      tenant_id, club_id, thread_id, slug,
      title_pl, title_en, description_pl, description_en,
      state, starts_on, due_on, progress, order_index, created_by
    ) VALUES (
      v_tenant, p_club_id,
      NULLIF(p_payload->>'thread_id', '')::uuid,
      v_slug,
      COALESCE(p_payload->>'title_pl', ''),
      COALESCE(p_payload->>'title_en', ''),
      NULLIF(p_payload->>'description_pl', ''),
      NULLIF(p_payload->>'description_en', ''),
      COALESCE(NULLIF(p_payload->>'state', ''), 'planned'),
      NULLIF(p_payload->>'starts_on', '')::date,
      NULLIF(p_payload->>'due_on', '')::date,
      COALESCE(NULLIF(p_payload->>'progress', '')::smallint, 0::smallint),
      COALESCE(
        NULLIF(p_payload->>'order_index', '')::integer,
        (SELECT COALESCE(max(m.order_index), -1) + 1 FROM public.club_milestones m WHERE m.club_id = p_club_id)
      ),
      auth.uid()
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  END IF;

  UPDATE public.club_milestones m SET
    thread_id      = CASE WHEN p_payload ? 'thread_id'
                          THEN NULLIF(p_payload->>'thread_id', '')::uuid ELSE m.thread_id END,
    slug           = COALESCE(v_slug, m.slug),
    title_pl       = COALESCE(NULLIF(p_payload->>'title_pl', ''), m.title_pl),
    title_en       = COALESCE(NULLIF(p_payload->>'title_en', ''), m.title_en),
    description_pl = CASE WHEN p_payload ? 'description_pl'
                          THEN NULLIF(p_payload->>'description_pl', '') ELSE m.description_pl END,
    description_en = CASE WHEN p_payload ? 'description_en'
                          THEN NULLIF(p_payload->>'description_en', '') ELSE m.description_en END,
    state          = COALESCE(NULLIF(p_payload->>'state', ''), m.state),
    starts_on      = CASE WHEN p_payload ? 'starts_on'
                          THEN NULLIF(p_payload->>'starts_on', '')::date ELSE m.starts_on END,
    due_on         = CASE WHEN p_payload ? 'due_on'
                          THEN NULLIF(p_payload->>'due_on', '')::date ELSE m.due_on END,
    progress       = COALESCE(NULLIF(p_payload->>'progress', '')::smallint, m.progress),
    order_index    = COALESCE(NULLIF(p_payload->>'order_index', '')::integer, m.order_index)
  WHERE m.id = v_id AND m.club_id = p_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_milestone_upsert(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_milestone_upsert(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_milestone_delete(p_milestone_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club uuid;
BEGIN
  SELECT m.club_id INTO v_club FROM public.club_milestones m WHERE m.id = p_milestone_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  PERFORM public.club_require_curator(v_club);
  DELETE FROM public.club_milestones WHERE id = p_milestone_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_milestone_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_milestone_delete(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_activity_series(uuid, integer);

CREATE FUNCTION public.club_activity_series(
  p_club_id uuid,
  p_days    integer DEFAULT 90
)
RETURNS TABLE (
  day date,
  threads integer,
  replies integer,
  participants integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH caps AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  span AS (
    SELECT generate_series(
      (current_date - (GREATEST(1, LEAST(COALESCE(p_days, 90), 365)) - 1) * interval '1 day')::date,
      current_date,
      interval '1 day'
    )::date AS day
  ),
  th AS (
    SELECT t.created_at::date AS day, count(*)::int AS n
      FROM public.club_threads t CROSS JOIN caps
     WHERE t.club_id = p_club_id AND caps.can_read
       AND t.status IN ('open', 'resolved', 'dormant', 'locked')
       AND t.created_at >= current_date - (GREATEST(1, LEAST(COALESCE(p_days, 90), 365)) - 1) * interval '1 day'
     GROUP BY 1
  ),
  rp AS (
    SELECT r.created_at::date AS day,
           count(*)::int AS n,
           count(DISTINCT r.author_id)::int AS people
      FROM public.club_replies r CROSS JOIN caps
     WHERE r.club_id = p_club_id AND caps.can_read
       AND r.status = 'visible'
       AND r.created_at >= current_date - (GREATEST(1, LEAST(COALESCE(p_days, 90), 365)) - 1) * interval '1 day'
     GROUP BY 1
  )
  SELECT s.day,
         COALESCE(th.n, 0),
         COALESCE(rp.n, 0),
         COALESCE(rp.people, 0)
    FROM span s
    LEFT JOIN th ON th.day = s.day
    LEFT JOIN rp ON rp.day = s.day
   WHERE EXISTS (SELECT 1 FROM caps WHERE caps.can_read)
   ORDER BY s.day ASC
$$;

REVOKE EXECUTE ON FUNCTION public.club_activity_series(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_activity_series(uuid, integer) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_workspace_stats(uuid, integer);

CREATE FUNCTION public.club_workspace_stats(
  p_club_id uuid,
  p_days    integer DEFAULT 30
)
RETURNS TABLE (
  threads_total       integer,
  threads_window      integer,
  replies_total       integer,
  replies_window      integer,
  active_participants integer,
  unanswered          integer,
  median_first_reply_hours numeric,
  documents_count     integer,
  upcoming_events     integer,
  open_milestones     integer,
  kind_breakdown      jsonb,
  group_breakdown     jsonb,
  top_contributors    jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH caps AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  win AS (
    SELECT (now() - GREATEST(1, LEAST(COALESCE(p_days, 30), 365)) * interval '1 day') AS since
  ),
  th AS (
    SELECT t.*
      FROM public.club_threads t CROSS JOIN caps
     WHERE t.club_id = p_club_id AND caps.can_read
       AND t.status IN ('open', 'resolved', 'dormant', 'locked')
  ),
  rp AS (
    SELECT r.*
      FROM public.club_replies r CROSS JOIN caps
     WHERE r.club_id = p_club_id AND caps.can_read
       AND r.status = 'visible'
  ),
  first_reply AS (
    SELECT t.id,
           (SELECT min(r.created_at) FROM rp r WHERE r.thread_id = t.id) AS first_at,
           t.created_at
      FROM th t
  )
  SELECT
    (SELECT count(*)::int FROM th),
    (SELECT count(*)::int FROM th, win WHERE th.created_at >= win.since),
    (SELECT count(*)::int FROM rp),
    (SELECT count(*)::int FROM rp, win WHERE rp.created_at >= win.since),
    (SELECT count(DISTINCT author_id)::int FROM rp, win WHERE rp.created_at >= win.since),
    (SELECT count(*)::int FROM th WHERE th.reply_count = 0),
    (SELECT round(
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(epoch FROM (f.first_at - f.created_at)) / 3600.0
              )::numeric, 1)
       FROM first_reply f WHERE f.first_at IS NOT NULL),
    (SELECT count(*)::int FROM public.club_documents d CROSS JOIN caps
      WHERE d.club_id = p_club_id AND caps.can_read
        AND (d.visibility = 'club' OR caps.can_moderate)
        AND (d.status = 'published' OR caps.can_moderate)),
    (SELECT count(*)::int FROM public.club_events e CROSS JOIN caps
      WHERE e.club_id = p_club_id AND caps.can_read
        AND e.status = 'scheduled' AND e.starts_at >= now()),
    (SELECT count(*)::int FROM public.club_milestones m CROSS JOIN caps
      WHERE m.club_id = p_club_id AND caps.can_read
        AND m.state IN ('planned', 'active', 'blocked')),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', k.kind, 'count', k.n) ORDER BY k.n DESC)
        FROM (SELECT th.kind, count(*)::int AS n FROM th GROUP BY th.kind) k
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', g.id, 'name_pl', g.name_pl, 'name_en', g.name_en, 'count', gg.n
             ) ORDER BY gg.n DESC)
        FROM (SELECT th.group_id, count(*)::int AS n FROM th GROUP BY th.group_id) gg
        JOIN public.club_groups g ON g.id = gg.group_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', x.name, 'slug', x.slug, 'avatar_url', x.avatar_url, 'count', x.n
             ) ORDER BY x.n DESC)
        FROM (
          SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'User') AS name,
                 p.slug, CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END AS avatar_url,
                 count(*)::int AS n
            FROM rp
            JOIN win ON true
            JOIN public.clubs c ON c.id = p_club_id
            JOIN public.profiles p ON p.id = rp.author_id
           WHERE rp.created_at >= win.since
             AND rp.is_anonymous IS FALSE
             AND c.attribution_mode = 'attributed'
           GROUP BY p.display_name, p.slug, p.avatar_url, p.hide_avatar
           ORDER BY n DESC
           LIMIT 8
        ) x
    ), '[]'::jsonb)
  WHERE EXISTS (SELECT 1 FROM caps WHERE caps.can_read)
$$;

COMMENT ON FUNCTION public.club_workspace_stats(uuid, integer) IS
  'Przekroj dynamiki klubu. Ranking autorow wychodzi WYLACZNIE dla attribution_mode=attributed.';

REVOKE EXECUTE ON FUNCTION public.club_workspace_stats(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_workspace_stats(uuid, integer) TO anon, authenticated, service_role;