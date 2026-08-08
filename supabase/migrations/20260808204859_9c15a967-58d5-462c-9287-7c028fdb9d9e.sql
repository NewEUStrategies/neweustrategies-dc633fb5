CREATE OR REPLACE FUNCTION public.club_thread_document_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_thread uuid := NULLIF(p_payload->>'thread_id', '')::uuid;
  v_acc    record;
  v_row    public.club_thread_documents%ROWTYPE;
  v_kind   text := COALESCE(NULLIF(btrim(p_payload->>'kind'), ''), 'document');
BEGIN
  IF v_thread IS NULL AND v_id IS NOT NULL THEN
    SELECT d.thread_id INTO v_thread FROM public.club_thread_documents d WHERE d.id = v_id;
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_thread);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;

  IF v_kind NOT IN ('document', 'dataset', 'link', 'note', 'recording') THEN
    RAISE EXCEPTION 'clubs: unknown document kind' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    IF NOT v_acc.can_reply THEN
      RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.club_thread_documents (
      club_id, thread_id, added_by, kind, title, description, url,
      source_label, published_on, mime_type, byte_size, is_primary, sort_order
    ) VALUES (
      v_acc.club_id, v_thread, auth.uid(), v_kind,
      btrim(p_payload->>'title'),
      NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'source_label', '')), ''),
      NULLIF(p_payload->>'published_on', '')::date,
      NULLIF(btrim(COALESCE(p_payload->>'mime_type', '')), ''),
      NULLIF(p_payload->>'byte_size', '')::bigint,
      (v_acc.can_moderate AND COALESCE((p_payload->>'is_primary')::boolean, false)),
      COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 0)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  END IF;

  SELECT * INTO v_row FROM public.club_thread_documents WHERE id = v_id;
  IF NOT FOUND OR v_row.thread_id <> v_thread THEN
    RAISE EXCEPTION 'clubs: document not found' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_acc.can_moderate OR (v_row.added_by IS NOT NULL AND v_row.added_by = auth.uid())) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_thread_documents SET
    kind         = CASE WHEN p_payload ? 'kind' THEN v_kind ELSE kind END,
    title        = CASE WHEN p_payload ? 'title' THEN btrim(p_payload->>'title') ELSE title END,
    description  = CASE WHEN p_payload ? 'description'
                        THEN NULLIF(btrim(COALESCE(p_payload->>'description', '')), '')
                        ELSE description END,
    url          = CASE WHEN p_payload ? 'url'
                        THEN NULLIF(btrim(COALESCE(p_payload->>'url', '')), '') ELSE url END,
    source_label = CASE WHEN p_payload ? 'source_label'
                        THEN NULLIF(btrim(COALESCE(p_payload->>'source_label', '')), '')
                        ELSE source_label END,
    published_on = CASE WHEN p_payload ? 'published_on'
                        THEN NULLIF(p_payload->>'published_on', '')::date ELSE published_on END,
    mime_type    = CASE WHEN p_payload ? 'mime_type'
                        THEN NULLIF(btrim(COALESCE(p_payload->>'mime_type', '')), '')
                        ELSE mime_type END,
    byte_size    = CASE WHEN p_payload ? 'byte_size'
                        THEN NULLIF(p_payload->>'byte_size', '')::bigint ELSE byte_size END,
    is_primary   = CASE WHEN p_payload ? 'is_primary' AND v_acc.can_moderate
                        THEN COALESCE((p_payload->>'is_primary')::boolean, false)
                        ELSE is_primary END,
    sort_order   = CASE WHEN p_payload ? 'sort_order'
                        THEN COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 0)
                        ELSE sort_order END,
    status       = CASE WHEN p_payload ? 'status' AND v_acc.can_moderate
                        AND p_payload->>'status' IN ('visible', 'hidden')
                        THEN p_payload->>'status' ELSE status END
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_document_upsert(jsonb) IS
  'Dodaje albo redaguje zrodlo watku. Obecnosc klucza = "zmien", brak = "nie ruszaj".';

REVOKE EXECUTE ON FUNCTION public.club_thread_document_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_document_upsert(jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_document_remove(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_documents%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: document not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_acc.can_moderate OR (v_row.added_by IS NOT NULL AND v_row.added_by = auth.uid())) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_thread_documents SET status = 'deleted' WHERE id = p_document_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_document_remove(uuid) IS
  'Miekkie usuniecie zrodla watku.';

REVOKE EXECUTE ON FUNCTION public.club_thread_document_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_document_remove(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_milestone_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_thread uuid := NULLIF(p_payload->>'thread_id', '')::uuid;
  v_acc    record;
  v_row    public.club_thread_milestones%ROWTYPE;
  v_kind   text := COALESCE(NULLIF(btrim(p_payload->>'kind'), ''), 'milestone');
  v_status text := COALESCE(NULLIF(btrim(p_payload->>'status'), ''), 'planned');
BEGIN
  IF v_thread IS NULL AND v_id IS NOT NULL THEN
    SELECT m.thread_id INTO v_thread FROM public.club_thread_milestones m WHERE m.id = v_id;
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_thread);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_kind NOT IN ('milestone', 'meeting', 'deadline', 'publication', 'vote', 'consultation') THEN
    RAISE EXCEPTION 'clubs: unknown milestone kind' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('planned', 'active', 'done', 'cancelled') THEN
    RAISE EXCEPTION 'clubs: unknown milestone status' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.club_thread_milestones (
      club_id, thread_id, created_by, owner_id, event_id, title, description,
      kind, status, starts_at, ends_at, all_day, location, url, sort_order
    ) VALUES (
      v_acc.club_id, v_thread, auth.uid(),
      NULLIF(p_payload->>'owner_id', '')::uuid,
      NULLIF(p_payload->>'event_id', '')::uuid,
      btrim(p_payload->>'title'),
      NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
      v_kind, v_status,
      (p_payload->>'starts_at')::timestamptz,
      NULLIF(p_payload->>'ends_at', '')::timestamptz,
      COALESCE((p_payload->>'all_day')::boolean, false),
      NULLIF(btrim(COALESCE(p_payload->>'location', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''),
      COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 0)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  END IF;

  SELECT * INTO v_row FROM public.club_thread_milestones WHERE id = v_id;
  IF NOT FOUND OR v_row.thread_id <> v_thread THEN
    RAISE EXCEPTION 'clubs: milestone not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_thread_milestones SET
    title       = CASE WHEN p_payload ? 'title' THEN btrim(p_payload->>'title') ELSE title END,
    description = CASE WHEN p_payload ? 'description'
                       THEN NULLIF(btrim(COALESCE(p_payload->>'description', '')), '')
                       ELSE description END,
    kind        = CASE WHEN p_payload ? 'kind' THEN v_kind ELSE kind END,
    status      = CASE WHEN p_payload ? 'status' THEN v_status ELSE status END,
    starts_at   = CASE WHEN p_payload ? 'starts_at'
                       THEN (p_payload->>'starts_at')::timestamptz ELSE starts_at END,
    ends_at     = CASE WHEN p_payload ? 'ends_at'
                       THEN NULLIF(p_payload->>'ends_at', '')::timestamptz ELSE ends_at END,
    all_day     = CASE WHEN p_payload ? 'all_day'
                       THEN COALESCE((p_payload->>'all_day')::boolean, false) ELSE all_day END,
    location    = CASE WHEN p_payload ? 'location'
                       THEN NULLIF(btrim(COALESCE(p_payload->>'location', '')), '') ELSE location END,
    url         = CASE WHEN p_payload ? 'url'
                       THEN NULLIF(btrim(COALESCE(p_payload->>'url', '')), '') ELSE url END,
    owner_id    = CASE WHEN p_payload ? 'owner_id'
                       THEN NULLIF(p_payload->>'owner_id', '')::uuid ELSE owner_id END,
    event_id    = CASE WHEN p_payload ? 'event_id'
                       THEN NULLIF(p_payload->>'event_id', '')::uuid ELSE event_id END,
    sort_order  = CASE WHEN p_payload ? 'sort_order'
                       THEN COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 0)
                       ELSE sort_order END
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_milestone_upsert(jsonb) IS
  'Zaklada albo redaguje pozycje harmonogramu watku. Prawo ma moderacja.';

REVOKE EXECUTE ON FUNCTION public.club_thread_milestone_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_milestone_upsert(jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_milestone_remove(p_milestone_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_milestones%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_milestones WHERE id = p_milestone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: milestone not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.club_thread_milestones WHERE id = p_milestone_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_milestone_remove(uuid) IS
  'Kasuje pozycje harmonogramu watku.';

REVOKE EXECUTE ON FUNCTION public.club_thread_milestone_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_milestone_remove(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_question_ask(
  p_thread_id uuid,
  p_body      text,
  p_anonymous boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc  record;
  v_mode text;
  v_id   uuid;
BEGIN
  SELECT * INTO v_acc FROM public.club_thread_access(p_thread_id);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF NOT v_acc.can_reply THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  v_mode := v_acc.attribution_mode;
  IF p_anonymous AND v_mode NOT IN ('anonymous_allowed', 'chatham') THEN
    RAISE EXCEPTION 'clubs: anonymous not allowed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_thread_questions (club_id, thread_id, author_id, body, is_anonymous)
  VALUES (v_acc.club_id, p_thread_id, auth.uid(), btrim(p_body),
          COALESCE(p_anonymous, false))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_question_ask(uuid, text, boolean) IS
  'Zadaje pytanie w watku. Anonimowosc tylko tam, gdzie tryb atrybucji na nia pozwala.';

REVOKE EXECUTE ON FUNCTION public.club_thread_question_ask(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_question_ask(uuid, text, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_question_answer(
  p_question_id uuid,
  p_body        text,
  p_status      text DEFAULT 'answered'
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_questions%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: question not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_acc.can_moderate
          OR (v_acc.author_id IS NOT NULL AND v_acc.author_id = auth.uid())) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('answered', 'declined', 'open', 'hidden') THEN
    RAISE EXCEPTION 'clubs: unknown question status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'answered' AND NULLIF(btrim(COALESCE(p_body, '')), '') IS NULL THEN
    RAISE EXCEPTION 'clubs: answer body required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.club_thread_questions SET
    answer_body = NULLIF(btrim(COALESCE(p_body, '')), ''),
    status      = p_status,
    answered_by = CASE WHEN p_status = 'answered' THEN auth.uid() ELSE NULL END,
    answered_at = CASE WHEN p_status = 'answered' THEN now() ELSE NULL END
  WHERE id = p_question_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_question_answer(uuid, text, text) IS
  'Odpowiada na pytanie albo zmienia jego stan. Prawo ma moderacja oraz autor watku.';

REVOKE EXECUTE ON FUNCTION public.club_thread_question_answer(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_question_answer(uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_question_vote(
  p_question_id uuid,
  p_on          boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.club_thread_questions%ROWTYPE;
  v_acc   record;
  v_count integer;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: question not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'clubs: auth required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_on, true) THEN
    INSERT INTO public.club_thread_question_votes (question_id, user_id, tenant_id)
    VALUES (p_question_id, auth.uid(), v_row.tenant_id)
    ON CONFLICT (question_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.club_thread_question_votes
     WHERE question_id = p_question_id AND user_id = auth.uid();
  END IF;

  SELECT vote_count INTO v_count FROM public.club_thread_questions WHERE id = p_question_id;
  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.club_thread_question_vote(uuid, boolean) IS
  'Glos na waznosc pytania. Zwraca licznik PO zapisie.';

REVOKE EXECUTE ON FUNCTION public.club_thread_question_vote(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_question_vote(uuid, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_link_add(
  p_thread_id         uuid,
  p_related_thread_id uuid,
  p_relation          text DEFAULT 'context',
  p_note              text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc   record;
  v_other record;
  v_id    uuid;
BEGIN
  IF p_thread_id = p_related_thread_id THEN
    RAISE EXCEPTION 'clubs: cannot link thread to itself' USING ERRCODE = '22023';
  END IF;
  IF p_relation NOT IN ('continues', 'supersedes', 'contradicts', 'supports',
                        'duplicates', 'context') THEN
    RAISE EXCEPTION 'clubs: unknown relation' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(p_thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_other FROM public.club_thread_access(p_related_thread_id);
  IF NOT FOUND OR NOT v_other.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.club_thread_links (
    club_id, thread_id, related_thread_id, created_by, relation, note
  ) VALUES (
    v_acc.club_id, p_thread_id, p_related_thread_id, auth.uid(), p_relation,
    NULLIF(btrim(COALESCE(p_note, '')), '')
  )
  ON CONFLICT (thread_id, related_thread_id) DO UPDATE
    SET relation = EXCLUDED.relation, note = EXCLUDED.note
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_link_add(uuid, uuid, text, text) IS
  'Laczy dwa watki nazwana relacja. Drugi koniec musi byc czytelny dla zakladajacego.';

REVOKE EXECUTE ON FUNCTION public.club_thread_link_add(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_link_add(uuid, uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_link_remove(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_links%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: link not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.club_thread_links WHERE id = p_link_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_link_remove(uuid) IS
  'Zdejmuje powiazanie miedzy watkami.';

REVOKE EXECUTE ON FUNCTION public.club_thread_link_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_link_remove(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_poll_create(
  p_thread_id   uuid,
  p_question_pl text,
  p_question_en text,
  p_options     jsonb,
  p_ends_at     timestamptz DEFAULT NULL,
  p_label       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc  record;
  v_poll uuid;
BEGIN
  SELECT * INTO v_acc FROM public.club_thread_access(p_thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_options) <> 'array'
     OR jsonb_array_length(p_options) NOT BETWEEN 2 AND 8 THEN
    RAISE EXCEPTION 'clubs: poll needs 2-8 options' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.polls (
    tenant_id, question_pl, question_en, options, status, ends_at, created_by
  ) VALUES (
    v_acc.tenant_id, btrim(p_question_pl), btrim(p_question_en), p_options,
    'open', p_ends_at, auth.uid()
  )
  RETURNING id INTO v_poll;

  INSERT INTO public.club_thread_polls (club_id, thread_id, poll_id, created_by, label, sort_order)
  VALUES (
    v_acc.club_id, p_thread_id, v_poll, auth.uid(),
    NULLIF(btrim(COALESCE(p_label, '')), ''),
    (SELECT COALESCE(max(sort_order), -1) + 1
       FROM public.club_thread_polls WHERE thread_id = p_thread_id)
  );

  RETURN v_poll;
END;
$$;

COMMENT ON FUNCTION public.club_thread_poll_create(uuid, text, text, jsonb, timestamptz, text) IS
  'Zaklada glosowanie w watku: ankieta w polls + krawedz w jednej transakcji.';

REVOKE EXECUTE ON FUNCTION
  public.club_thread_poll_create(uuid, text, text, jsonb, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.club_thread_poll_create(uuid, text, text, jsonb, timestamptz, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_poll_detach(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_polls%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_polls WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: poll link not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.club_thread_polls WHERE id = p_link_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_poll_detach(uuid) IS
  'Odpina glosowanie od watku. Kasuje krawedz, nie ankiete.';

REVOKE EXECUTE ON FUNCTION public.club_thread_poll_detach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_poll_detach(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_club_thread_documents_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public.club_thread_seam_context(NEW.thread_id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  PERFORM public.add_cross_reference(
    NEW.tenant_id, 'club_thread', NEW.thread_id::text,
    'club_thread_document', NEW.id::text, 'cites',
    CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.added_by END
  );

  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'club_thread', NEW.thread_id::text, 'club_thread.document_added.v1',
    jsonb_build_object('club_id', v_ctx.club_id, 'document_id', NEW.id, 'kind', NEW.kind),
    NEW.added_by,
    p_suppress_actor => v_ctx.hide_actor
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_club_thread_documents_seams() IS
  'Szyna dla zrodel watku: krawedz w grafie powiazan + zdarzenie domenowe.';

DROP TRIGGER IF EXISTS club_thread_documents_seams_tg ON public.club_thread_documents;
CREATE TRIGGER club_thread_documents_seams_tg
  AFTER INSERT ON public.club_thread_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_thread_documents_seams();

CREATE OR REPLACE FUNCTION public.tg_club_thread_milestones_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public.club_thread_seam_context(NEW.thread_id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS NOT NULL THEN
    PERFORM public.add_cross_reference(
      NEW.tenant_id, 'club_thread', NEW.thread_id::text,
      'event', NEW.event_id::text, 'scheduled_with',
      CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.created_by END
    );
  END IF;

  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'club_thread', NEW.thread_id::text, 'club_thread.milestone_set.v1',
    jsonb_build_object(
      'club_id', v_ctx.club_id, 'milestone_id', NEW.id,
      'kind', NEW.kind, 'status', NEW.status, 'starts_at', NEW.starts_at
    ),
    NEW.created_by,
    p_suppress_actor => v_ctx.hide_actor
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_club_thread_milestones_seams() IS
  'Szyna dla harmonogramu watku.';

DROP TRIGGER IF EXISTS club_thread_milestones_seams_tg ON public.club_thread_milestones;
CREATE TRIGGER club_thread_milestones_seams_tg
  AFTER INSERT OR UPDATE OF starts_at, status, event_id ON public.club_thread_milestones
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_thread_milestones_seams();