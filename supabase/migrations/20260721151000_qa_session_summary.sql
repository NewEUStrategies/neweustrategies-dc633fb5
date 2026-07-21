-- ============================================================================
-- Q&A: publikacja podsumowania sesji jako treści (wpis na blogu).
--
-- Dziś wiedza z sesji ginie po jej zamknięciu - odpowiedzi eksperta zostają
-- w module Q&A, poza obiegiem treści (wyszukiwarka, RSS, newsletter, powiązane
-- wpisy). publish_qa_session_summary kompiluje odpowiedziane pytania sesji
-- w dwujęzyczny wpis (PL/EN) i spina go z sesją przez qa_sessions.post_id
-- (kolumna istniała od 20260713095000, była martwa).
--
--   * Uprawnienia: staff tenantu (admin/editor) LUB host sesji - dokładnie
--     ten sam krąg, który moderuje i odpowiada. Publikacja (p_publish=true)
--     dodatkowo respektuje workflow redakcyjny (can_publish_content,
--     20260702113027): host-ekspert kompiluje szkic, publikuje redakcja.
--   * Idempotencja: ponowna publikacja aktualizuje istniejący wpis (post_id
--     sesji albo wpis o tym samym slugu w tenancie) zamiast tworzyć duplikat.
--     Wpis raz opublikowany nie wraca do szkicu.
--   * Treść: pytania w porządku "głosy > starszeństwo" (mądrość społeczności
--     decyduje o kolejności), pełny escaping HTML (treść pytań/odpowiedzi to
--     surowy tekst użytkowników), anonimowość Chatham House zachowana
--     (author_display albo etykieta "Anonimowo"/"Anonymous").
--   * p_publish=false tworzy szkic do redakcyjnego szlifu; p_publish=true
--     publikuje od razu i powiadamia autorów odpowiedzianych pytań
--     (enqueue_notification szanuje ich preferencje). Trigger
--     notify_post_published (20260720124500) zadziała jak przy każdym wpisie.
--
-- Wszystko idempotentne.
-- ============================================================================

-- Escaping HTML dla surowego tekstu użytkowników (pytania/odpowiedzi).
CREATE OR REPLACE FUNCTION public.qa_escape_html(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT replace(replace(replace(replace(replace(COALESCE(p_text, ''),
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    '''', '&#39;');
$$;

REVOKE EXECUTE ON FUNCTION public.qa_escape_html(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_escape_html(text) TO service_role;

-- Akapit HTML z zachowaniem łamań wierszy użytkownika.
CREATE OR REPLACE FUNCTION public.qa_text_to_html(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT '<p>' || replace(public.qa_escape_html(btrim(p_text)), E'\n', '<br />') || '</p>';
$$;

REVOKE EXECUTE ON FUNCTION public.qa_text_to_html(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_text_to_html(text) TO service_role;

CREATE OR REPLACE FUNCTION public.publish_qa_session_summary(
  p_session_id uuid,
  p_publish boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session public.qa_sessions%ROWTYPE;
  v_staff boolean;
  v_q record;
  v_n integer := 0;
  v_body_pl text := '';
  v_body_en text := '';
  v_author_pl text;
  v_author_en text;
  v_slug text;
  v_post_id uuid;
  v_parent_page uuid;
  v_was_published boolean := false;
  v_status public.post_status;
  v_notified uuid[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'qa: authentication required';
  END IF;

  SELECT * INTO v_session
    FROM public.qa_sessions
   WHERE id = p_session_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qa: session not found';
  END IF;

  v_staff := public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role);
  IF NOT v_staff AND v_session.host_user_id <> v_user THEN
    RAISE EXCEPTION 'qa: not allowed';
  END IF;

  -- Publikacja przechodzi przez workflow redakcyjny (trigger
  -- enforce_post_workflow i tak by ją zatrzymał - tu czytelny błąd domenowy).
  IF p_publish AND NOT public.can_publish_content(v_user) THEN
    RAISE EXCEPTION 'qa: publish requires editorial role';
  END IF;

  -- Podsumowanie ma sens od fazy odpowiadania; szkic/otwarta sesja to za wcześnie.
  IF v_session.status NOT IN ('answering', 'closed') THEN
    RAISE EXCEPTION 'qa: session not summarizable';
  END IF;

  -- Wstęp sesji otwiera wpis (jeśli istnieje).
  IF COALESCE(btrim(v_session.intro_pl), '') <> '' THEN
    v_body_pl := public.qa_text_to_html(v_session.intro_pl);
  END IF;
  IF COALESCE(btrim(v_session.intro_en), '') <> '' THEN
    v_body_en := public.qa_text_to_html(v_session.intro_en);
  END IF;

  -- Porządek jak na stronie sesji: głosy społeczności > starszeństwo.
  FOR v_q IN
    SELECT q.body, q.answer_body, q.author_display, q.is_anonymous, q.user_id
      FROM public.qa_questions q
      LEFT JOIN LATERAL (
        SELECT count(*) AS votes
          FROM public.qa_question_votes qv
         WHERE qv.question_id = q.id
      ) v ON true
     WHERE q.session_id = p_session_id
       AND q.status = 'answered'
       AND COALESCE(btrim(q.answer_body), '') <> ''
     ORDER BY v.votes DESC, q.created_at ASC
     LIMIT 200
  LOOP
    v_n := v_n + 1;
    v_author_pl := CASE
      WHEN v_q.is_anonymous OR COALESCE(btrim(v_q.author_display), '') = ''
        THEN 'Anonimowo'
      ELSE public.qa_escape_html(v_q.author_display)
    END;
    v_author_en := CASE
      WHEN v_q.is_anonymous OR COALESCE(btrim(v_q.author_display), '') = ''
        THEN 'Anonymous'
      ELSE public.qa_escape_html(v_q.author_display)
    END;

    v_body_pl := v_body_pl
      || '<h3>Pytanie ' || v_n || '</h3>'
      || '<blockquote>' || public.qa_text_to_html(v_q.body)
      || '<p><cite>- ' || v_author_pl || '</cite></p></blockquote>'
      || public.qa_text_to_html(v_q.answer_body);
    v_body_en := v_body_en
      || '<h3>Question ' || v_n || '</h3>'
      || '<blockquote>' || public.qa_text_to_html(v_q.body)
      || '<p><cite>- ' || v_author_en || '</cite></p></blockquote>'
      || public.qa_text_to_html(v_q.answer_body);

    v_notified := array_append(v_notified, v_q.user_id);
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'qa: no answered questions';
  END IF;

  v_slug := 'qa-' || v_session.slug || '-podsumowanie';

  -- Idempotentny upsert: najpierw wpis spięty z sesją, potem slug w tenancie.
  v_post_id := v_session.post_id;
  IF v_post_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.id = v_post_id) THEN
    v_post_id := NULL;
  END IF;
  IF v_post_id IS NULL THEN
    SELECT p.id INTO v_post_id
      FROM public.posts p
     WHERE p.tenant_id = v_session.tenant_id AND p.slug = v_slug;
  END IF;

  IF v_post_id IS NULL THEN
    -- Wpisy żyją pod stroną-rodzicem (posts.parent_page_id NOT NULL) -
    -- kanonicznie strona "blog" tenanta, awaryjnie najstarsza strona główna.
    SELECT pg.id INTO v_parent_page
      FROM public.pages pg
     WHERE pg.tenant_id = v_session.tenant_id
       AND pg.slug = 'blog'
       AND pg.parent_id IS NULL
       AND pg.deleted_at IS NULL
     ORDER BY pg.created_at ASC
     LIMIT 1;
    IF v_parent_page IS NULL THEN
      SELECT pg.id INTO v_parent_page
        FROM public.pages pg
       WHERE pg.tenant_id = v_session.tenant_id
         AND pg.parent_id IS NULL
         AND pg.deleted_at IS NULL
       ORDER BY pg.created_at ASC
       LIMIT 1;
    END IF;
    IF v_parent_page IS NULL THEN
      RAISE EXCEPTION 'qa: no parent page for summary post';
    END IF;

    INSERT INTO public.posts (
      tenant_id, slug, parent_page_id, author_id, status, editor,
      title_pl, title_en, excerpt_pl, excerpt_en, content_pl, content_en,
      published_at
    )
    VALUES (
      v_session.tenant_id,
      v_slug,
      v_parent_page,
      COALESCE(v_session.host_user_id, v_user),
      CASE WHEN p_publish THEN 'published' ELSE 'draft' END::public.post_status,
      'richtext'::public.editor_type,
      'Q&A: ' || v_session.title_pl || ' - podsumowanie',
      'Q&A: ' || v_session.title_en || ' - recap',
      'Najważniejsze pytania społeczności i odpowiedzi eksperta z sesji Q&A.',
      'The community''s top questions and the expert''s answers from the Q&A session.',
      v_body_pl,
      v_body_en,
      CASE WHEN p_publish THEN now() END
    )
    RETURNING id INTO v_post_id;
  ELSE
    SELECT p.status = 'published' INTO v_was_published
      FROM public.posts p WHERE p.id = v_post_id;
    UPDATE public.posts
       SET title_pl = 'Q&A: ' || v_session.title_pl || ' - podsumowanie',
           title_en = 'Q&A: ' || v_session.title_en || ' - recap',
           content_pl = v_body_pl,
           content_en = v_body_en,
           -- Publikacja jest jednokierunkowa: odświeżenie treści nie cofa
           -- opublikowanego wpisu do szkicu.
           status = CASE
             WHEN p_publish OR v_was_published THEN 'published'::public.post_status
             ELSE status
           END,
           published_at = CASE
             WHEN p_publish OR v_was_published THEN COALESCE(published_at, now())
             ELSE published_at
           END,
           deleted_at = NULL,
           updated_at = now()
     WHERE id = v_post_id;
  END IF;

  UPDATE public.qa_sessions
     SET post_id = v_post_id, updated_at = now()
   WHERE id = p_session_id;

  SELECT p.status INTO v_status FROM public.posts p WHERE p.id = v_post_id;

  -- Powiadom autorów odpowiedzianych pytań przy pierwszej publikacji -
  -- ich pytanie właśnie stało się częścią opublikowanej treści.
  IF p_publish AND NOT v_was_published THEN
    PERFORM public.enqueue_notification(
      u.user_id,
      'content',
      'Podsumowanie sesji Q&A jest już dostępne',
      'The Q&A session recap is now available',
      v_session.title_pl,
      v_session.title_en,
      '/post/' || v_slug,
      'BookOpenCheck'
    )
    FROM (SELECT DISTINCT unnest(v_notified) AS user_id) u
    WHERE u.user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'post_id', v_post_id,
    'slug', v_slug,
    'status', v_status,
    'questions', v_n
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_qa_session_summary(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_qa_session_summary(uuid, boolean) TO authenticated, service_role;
