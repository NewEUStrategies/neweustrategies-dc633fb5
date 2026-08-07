-- ============================================================================
-- NAPRAWA NAPRAWY: kolejnosc parametrow emit_domain_event
--
-- A16 zlikwidowala przeciazenie emitera - to bylo poprawne i zostaje. Ale
-- POSTAWILA `p_suppress_actor` na SZOSTEJ pozycji, a `p_actor_id` przesunela
-- na siodma, opierajac sie na twierdzeniu, ze nikt nie podaje aktora
-- pozycyjnie. Twierdzenie bylo falszywe.
--
-- Prawdziwy rozklad wywolan szescioargumentowych w repozytorium:
--
--   25  ...(…, jsonb, <uuid>)   billing, monetyzacja, subskrypcje, odznaki
--    4  ...(…, jsonb, <boolean>) szwy klubowe z A12
--
-- Po A16 tamte dwadziescia piec przestalo sie wiazac. W logu pgTAP:
--
--   WARNING: profile_badges: domain event failed: function
--            public.emit_domain_event(uuid, unknown, text, unknown, jsonb, uuid)
--            does not exist
--
-- i cztery nowe czerwone asercje w profile_badge_domain_sync_test - plik,
-- ktory przed A16 byl zielony. Zamienilem jedna cicha awarie szyny na druga,
-- wezsza, ale tak samo cicha: emitery lapia wlasny wyjatek, wiec brak funkcji
-- wyglada tak samo jak brak zdarzenia.
--
-- ROZWIAZANIE. Kolejnosc wraca do umowy lipcowej: aktor szosty, tlumienie
-- siodme. Cztery wywolania klubowe przechodza na ARGUMENT NAZWANY - to one sa
-- mniejszoscia i to one dolozyly parametr, wiec to one sie dostosowuja.
--
-- Argument nazwany jest tu lepszy niz pozycyjny takze dlatego, ze `true` na
-- siodmej pozycji nie mowi nic czytajacemu, a `p_suppress_actor => true` mowi
-- wszystko.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  -- SZOSTA pozycja nalezy do aktora - tak wola dwadziescia piec miejsc
  -- w billingu, monetyzacji i odznakach. Zmiana tej kolejnosci jest zmiana
  -- lamiaca, nawet jesli kompilator SQL-a nic nie powie.
  p_actor_id uuid DEFAULT NULL,
  -- true = wiersz powstaje BEZ aktora, nawet gdy sesja go zna. Wolane
  -- WYLACZNIE argumentem nazwanym.
  p_suppress_actor boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_aggregate_type IS NULL OR p_aggregate_id IS NULL
     OR p_event_type IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.domain_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload,
    correlation_id, actor_id
  ) VALUES (
    p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    public.request_correlation_id(),
    CASE WHEN p_suppress_actor THEN NULL ELSE COALESCE(p_actor_id, auth.uid()) END
  )
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, uuid, boolean)
  TO service_role;

-- Wariant z A16 (boolean szosty) znika. Zostaje DOKLADNIE jedna funkcja tej
-- nazwy - inwariant z A16 obowiazuje dalej, zmienia sie tylko kolejnosc.
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb, boolean, uuid);
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb, boolean);
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb);

COMMENT ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, uuid, boolean) IS
  'JEDYNY emiter szyny zdarzen. Szosta pozycja to AKTOR (tak wola 25 miejsc w billingu, monetyzacji i odznakach) - tlumienie aktora wolamy wylacznie argumentem nazwanym p_suppress_actor. Przeciazenie tej nazwy jest awaria: wszystkie pozostale wywolania podaja piec argumentow, wiec drugi wariant czyni je niejednoznacznymi (42725), a wlasny EXCEPTION emiterow zamienia to w cisze.';

-- ----------------------------------------------------------------------------
-- Trzy funkcje z A12, ktore wolaly emiter z booleanem na szostej pozycji.
-- Tresc bez zmian - jedyna roznica to `p_suppress_actor => ` przed ostatnim
-- argumentem. Odtwarzamy je w calosci, bo plpgsql nie ma sposobu na podmiane
-- pojedynczego wywolania w ciele.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_mentions(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id text,
  p_body text,
  p_actor_id uuid,
  p_kind text,
  p_href text,
  p_actor_label text DEFAULT NULL,
  p_record_actor boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_profile record;
  v_actor_name text;
  v_count integer := 0;
BEGIN
  IF p_body IS NULL OR position('@' in p_body) = 0 THEN
    RETURN 0;
  END IF;

  IF p_actor_label IS NOT NULL AND btrim(p_actor_label) <> '' THEN
    v_actor_name := btrim(p_actor_label);
  ELSE
    SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Ktoś')
      INTO v_actor_name FROM public.profiles WHERE id = p_actor_id;
    v_actor_name := COALESCE(v_actor_name, 'Ktoś');
  END IF;

  FOR v_slug IN
    SELECT DISTINCT lower(m[1])
    FROM regexp_matches(p_body, '(?:^|[^a-zA-Z0-9@._-])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})', 'g') AS m
    LIMIT 10
  LOOP
    SELECT id, display_name INTO v_profile
      FROM public.profiles
     WHERE tenant_id = p_tenant_id AND slug = v_slug;
    IF v_profile.id IS NULL OR v_profile.id = p_actor_id THEN
      CONTINUE;
    END IF;

    PERFORM public.add_cross_reference(
      p_tenant_id, p_source_type, p_source_id,
      'profile', v_profile.id::text, 'mention',
      CASE WHEN p_record_actor THEN p_actor_id ELSE NULL END
    );

    PERFORM public.enqueue_notification(
      v_profile.id,
      p_kind,
      v_actor_name || ' wspomniał(a) o Tobie',
      v_actor_name || ' mentioned you',
      NULL, NULL,
      p_href,
      'at-sign'
    );

    PERFORM public.emit_domain_event(
      p_tenant_id, p_source_type, p_source_id, 'mention.created.v1',
      jsonb_build_object(
        'mentioned_user_id', v_profile.id,
        'actor_id', CASE WHEN p_record_actor THEN to_jsonb(p_actor_id) ELSE 'null'::jsonb END,
        'source_type', p_source_type
      ),
      p_suppress_actor => NOT p_record_actor
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_club_threads_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx  record;
  v_href text;
BEGIN
  SELECT * INTO v_ctx FROM public.club_thread_seam_context(NEW.id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  v_href := '/club/' || v_ctx.club_slug || '/t/' || v_ctx.thread_slug;

  IF TG_OP = 'INSERT' THEN
    -- Krawedz do klubu: pozwala panelowi powiazan pokazac, gdzie watek zyje.
    PERFORM public.add_cross_reference(
      NEW.tenant_id, 'club_thread', NEW.id::text, 'club', v_ctx.club_id::text,
      'belongs_to', CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.author_id END
    );

    -- Kotwica: to jest wlasciwy powod istnienia tej kolumny. Strona aktu
    -- prawnego pyta graf, a nie modul klubow, wiec nie musi go znac.
    IF NEW.anchor_type IS NOT NULL AND NULLIF(btrim(COALESCE(NEW.anchor_id, '')), '') IS NOT NULL THEN
      PERFORM public.add_cross_reference(
        NEW.tenant_id, 'club_thread', NEW.id::text, NEW.anchor_type, NEW.anchor_id,
        'discusses', CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.author_id END
      );
    END IF;

    PERFORM public.process_mentions(
      NEW.tenant_id, 'club_thread', NEW.id::text,
      COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, ''),
      NEW.author_id, 'club', v_href,
      CASE WHEN v_ctx.hide_actor THEN 'Uczestnik dyskusji' ELSE NULL END,
      NOT v_ctx.hide_actor
    );

    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_thread', NEW.id::text, 'club_thread.created.v1',
      -- Payload NIE niesie tytulu ani tresci: domain_events czyta caly staff
      -- tenantu, a czlonkostwo w klubie to inna bramka niz rola redakcyjna.
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'group_id', NEW.group_id,
        'status', NEW.status, 'kind', NEW.kind
      ),
      p_suppress_actor => v_ctx.hide_actor
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_thread', NEW.id::text, 'club_thread.status_changed.v1',
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'group_id', NEW.group_id,
        'status', NEW.status, 'previous_status', OLD.status
      ),
      p_suppress_actor => v_ctx.hide_actor
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Awaria szyny nie moze wywrocic publikacji watku. Ta sama doktryna, co
  -- w tg_comments_cohesion.
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_club_replies_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx  record;
  v_href text;
BEGIN
  SELECT * INTO v_ctx FROM public.club_thread_seam_context(NEW.thread_id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  v_href := '/club/' || v_ctx.club_slug || '/t/' || v_ctx.thread_slug;
  -- Anonimowosc odpowiedzi jest sama w sobie wystarczajaca, niezaleznie od
  -- tego, jak podpisany jest watek.
  IF NEW.is_anonymous THEN
    v_ctx.hide_actor := true;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.add_cross_reference(
      NEW.tenant_id, 'club_reply', NEW.id::text, 'club_thread', NEW.thread_id::text,
      'belongs_to', CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.author_id END
    );

    PERFORM public.process_mentions(
      NEW.tenant_id, 'club_reply', NEW.id::text, NEW.body,
      NEW.author_id, 'club', v_href,
      CASE WHEN v_ctx.hide_actor THEN 'Uczestnik dyskusji' ELSE NULL END,
      NOT v_ctx.hide_actor
    );

    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_reply', NEW.id::text, 'club_reply.created.v1',
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'thread_id', NEW.thread_id,
        'status', NEW.status, 'depth', NEW.depth
      ),
      p_suppress_actor => v_ctx.hide_actor
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_reply', NEW.id::text, 'club_reply.status_changed.v1',
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'thread_id', NEW.thread_id,
        'status', NEW.status, 'previous_status', OLD.status
      ),
      p_suppress_actor => v_ctx.hide_actor
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
