-- ============================================================================
-- FUNKCJE, KTORE PADALY PRZY KAZDYM WYKONANIU (poza modulem Wydarzen).
--
-- ZRODLO: `plpgsql_check` na katalogu po wszystkich migracjach (audyt
-- platformy, klasa „SQL nigdy niewykonany"). PL/pgSQL nie sprawdza ciala przy
-- CREATE, a zadna z tych sciezek nie miala testu, ktory by ja WYKONAL:
--   1. `org_apply_subscription_seats(text, integer)` - `paddle_subscription_id`
--      po zmianie nazwy kolumny (20260805134721) -> 42703. Webhook operatora
--      platnosci polykal blad (`teamSeats.server.ts`), wiec limit miejsc
--      planu Team NIGDY nie szedl za liczba miejsc w subskrypcji.
--   2. (synchronizacja CRM zgloszen do klubu - osobna migracja
--      20261007140710: harness klubow stawia wylacznie migracje modulu,
--      w ktorym typow z pozostalych punktow nie ma.)
--   3. `run_workflow_step(domain_events, jsonb)`, akcja `notify_followers` -
--      `uuid = text` -> 42883; obserwujacy autora nie dostawali powiadomien.
--   4. HASLA TRESCI. `admin_set_content_password` wolala
--      `public.gen_salt`/`public.crypt`, a `_verify_content_password` -
--      `public.crypt`; na Supabase pgcrypto mieszka w schemacie `extensions`
--      (ta sama obserwacja co w scripts/pgtap-local/stub.sql), wiec ustawienie
--      i sprawdzenie hasla konczyly sie 42883. Wywolania sa teraz
--      niekwalifikowane z `search_path = public, extensions, pg_temp` - dzialaja
--      niezaleznie od tego, w ktorym z tych schematow stoi rozszerzenie.
--      Przy okazji (audyt, klasa „bramka roli w macierzystym najemcy + zapis
--      po samym id"): ustawienie i wyczyszczenie hasla dotyka WYLACZNIE wiersza
--      `content_access` najemcy wolajacego - dotad redaktor dowolnego najemcy
--      nadpisywal haslo tresci innego najemcy.
--
-- ZMIANA: ciala z katalogu (pg_get_functiondef) z poprawionymi miejscami;
-- sygnatury, typy wyniku i ACL bez zmian.
--
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWOD: supabase/tests/sql_runtime_errors_test.sql (wywolania + plpgsql_check).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.org_apply_subscription_seats(p_subscription_id text, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_limit integer := GREATEST(1, LEAST(500, COALESCE(p_quantity, 1)));
BEGIN
  SELECT id INTO v_org
    FROM public.member_organizations
   WHERE provider_subscription_id = p_subscription_id
   LIMIT 1;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('linked', false);
  END IF;

  UPDATE public.member_organizations
     SET seats_limit = v_limit,
         seats_source = 'subscription',
         updated_at = now()
   WHERE id = v_org;

  RETURN public.org_reconcile_seats(v_org) || jsonb_build_object('linked', true, 'org_id', v_org);
END $function$;

CREATE OR REPLACE FUNCTION public.run_workflow_step(p_event domain_events, p_step jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_action text := p_step ->> 'action';
  v_params jsonb := COALESCE(p_step -> 'params', '{}'::jsonb);
  v_user uuid;
  v_href text;
  v_title_pl text;
  v_title_en text;
  v_kind text;
  v_target_id text;
  v_author text;
  v_follower record;
  v_email text;
  v_lead_id uuid;
  v_lead_owner uuid;
  v_task_title text;
BEGIN
  v_kind := COALESCE(NULLIF(v_params ->> 'kind', ''), 'system');
  v_title_pl := replace(
    COALESCE(v_params ->> 'title_pl', ''), '{aggregate_id}', p_event.aggregate_id
  );
  v_title_en := replace(
    COALESCE(v_params ->> 'title_en', ''), '{aggregate_id}', p_event.aggregate_id
  );
  v_href := NULLIF(replace(
    COALESCE(v_params ->> 'href', ''), '{aggregate_id}', p_event.aggregate_id
  ), '');
  -- Wygodny skrót dla przepisów contentowych: kanoniczny adres posta.
  IF v_params ->> 'href' = '{post_href}' AND p_event.aggregate_type = 'post' THEN
    v_href := public.post_canonical_href(p_event.aggregate_id::uuid);
  END IF;

  CASE v_action
    WHEN 'notify_user' THEN
      v_user := NULLIF(
        public.workflow_param_text(p_event.payload, v_params, 'user_id', 'user_from'), ''
      )::uuid;
      IF v_user IS NOT NULL THEN
        PERFORM public.enqueue_notification(
          v_user, v_kind, v_title_pl, v_title_en, NULL, NULL, v_href,
          NULLIF(v_params ->> 'icon', '')
        );
      END IF;

    WHEN 'notify_staff' THEN
      FOR v_follower IN
        SELECT DISTINCT ur.user_id
          FROM public.user_roles ur
          JOIN public.profiles p ON p.id = ur.user_id
         WHERE p.tenant_id = p_event.tenant_id
           AND ur.role::text = ANY (
             -- ARRAY(pusty SELECT) daje '{}', nie NULL - stąd CASE, nie COALESCE.
             CASE WHEN v_params ? 'roles'
               THEN ARRAY(SELECT jsonb_array_elements_text(v_params -> 'roles'))
               ELSE ARRAY['admin', 'editor']
             END
           )
      LOOP
        PERFORM public.enqueue_notification(
          v_follower.user_id, v_kind, v_title_pl, v_title_en, NULL, NULL, v_href,
          NULLIF(v_params ->> 'icon', '')
        );
      END LOOP;

    WHEN 'notify_followers' THEN
      -- Obserwujący autora wskazanego w payloadzie (target_type 'author').
      v_author := p_event.payload ->> COALESCE(NULLIF(v_params ->> 'author_from', ''), 'author_id');
      IF v_author IS NOT NULL THEN
        FOR v_follower IN
          SELECT uf.user_id
            FROM public.user_follows uf
           WHERE uf.tenant_id = p_event.tenant_id
             AND uf.target_type = 'author'
             AND uf.target_id::text = v_author
             AND uf.user_id::text <> v_author
        LOOP
          PERFORM public.enqueue_notification(
            v_follower.user_id, COALESCE(NULLIF(v_params ->> 'kind', ''), 'content'),
            v_title_pl, v_title_en, NULL, NULL, v_href,
            NULLIF(v_params ->> 'icon', '')
          );
        END LOOP;
      END IF;

    WHEN 'create_crm_lead' THEN
      PERFORM public.crm_upsert_lead(
        p_event.tenant_id,
        p_event.payload ->> COALESCE(NULLIF(v_params ->> 'email_from', ''), 'email'),
        p_event.payload ->> COALESCE(NULLIF(v_params ->> 'first_name_from', ''), 'first_name'),
        p_event.payload ->> COALESCE(NULLIF(v_params ->> 'last_name_from', ''), 'last_name'),
        NULL, NULL,
        COALESCE((v_params ->> 'newsletter')::boolean, false),
        COALESCE((v_params ->> 'marketing')::boolean, false)
      );

    WHEN 'create_crm_task' THEN
      -- Zadanie follow-up przy leadzie. E-mail: wprost z payloadu (email_from)
      -- albo z profilu użytkownika (user_from / payload.user_id) - zdarzenia
      -- monetyzacji niosą user_id, nie e-mail.
      v_email := NULLIF(
        p_event.payload ->> COALESCE(NULLIF(v_params ->> 'email_from', ''), 'email'), ''
      );
      IF v_email IS NULL THEN
        v_user := NULLIF(COALESCE(
          public.workflow_param_text(p_event.payload, v_params, 'user_id', 'user_from'),
          p_event.payload ->> 'user_id'
        ), '')::uuid;
        IF v_user IS NOT NULL THEN
          SELECT COALESCE(NULLIF(btrim(p.email), ''), NULLIF(btrim(p.contact_email), ''))
            INTO v_email
            FROM public.profiles p
           WHERE p.id = v_user AND p.tenant_id = p_event.tenant_id;
        END IF;
      END IF;
      IF v_email IS NULL THEN
        RAISE EXCEPTION 'workflow create_crm_task: no email resolvable from payload/profile';
      END IF;

      -- Klient jest wart bycia leadem: upsert (merge po email_norm) + id.
      v_lead_id := public.crm_upsert_lead(
        p_event.tenant_id, v_email, NULL, NULL, NULL, NULL, false, false
      );
      IF v_lead_id IS NULL THEN
        SELECT l.id INTO v_lead_id
          FROM public.crm_leads l
         WHERE l.tenant_id = p_event.tenant_id AND l.email_norm = lower(btrim(v_email))
         LIMIT 1;
      END IF;
      IF v_lead_id IS NULL THEN
        RAISE EXCEPTION 'workflow create_crm_task: lead not found after upsert';
      END IF;
      SELECT l.owner_id INTO v_lead_owner FROM public.crm_leads l WHERE l.id = v_lead_id;

      v_task_title := COALESCE(
        NULLIF(replace(COALESCE(v_params ->> 'title', ''), '{aggregate_id}', p_event.aggregate_id), ''),
        'Follow-up'
      );
      -- Dedup: jedno OTWARTE zadanie o tym tytule per lead - zdarzenie może
      -- odpalić wielokrotnie (np. zmiana okresu przy zaplanowanym anulowaniu).
      IF NOT EXISTS (
        SELECT 1 FROM public.crm_tasks ct
         WHERE ct.lead_id = v_lead_id AND ct.status = 'open' AND ct.title = v_task_title
      ) THEN
        INSERT INTO public.crm_tasks (
          tenant_id, lead_id, title, note, due_at, assignee_id, created_by
        ) VALUES (
          p_event.tenant_id, v_lead_id, v_task_title,
          NULLIF(v_params ->> 'note', ''),
          now() + make_interval(
            days => GREATEST(0, COALESCE(NULLIF(v_params ->> 'due_days', '')::integer, 3))
          ),
          v_lead_owner, NULL
        );
      END IF;

    WHEN 'add_cross_reference' THEN
      v_target_id := public.workflow_param_text(
        p_event.payload, v_params, 'target_id', 'target_id_from'
      );
      IF v_target_id IS NOT NULL THEN
        PERFORM public.add_cross_reference(
          p_event.tenant_id, p_event.aggregate_type, p_event.aggregate_id,
          COALESCE(NULLIF(v_params ->> 'target_type', ''), 'post'),
          v_target_id,
          COALESCE(NULLIF(v_params ->> 'relation', ''), 'related'),
          p_event.actor_id
        );
      END IF;

    ELSE
      RAISE EXCEPTION 'workflow: unknown action %', v_action;
  END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public._verify_content_password(p_tenant uuid, _entity_type access_entity_type, _entity_id uuid, _password text, _ip_hash text)
 RETURNS TABLE(ok boolean, content_pl text, content_en text, builder_data jsonb, blocks_data jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_hash text;
  v_mode public.access_mode;
  v_attempts integer;
  v_ip_attempts integer;
BEGIN
  -- Kubelek wpisu (10 / minute), atomowy.
  INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
  VALUES ('content_password', 'pwd:' || _entity_id::text, date_trunc('minute', now()), 1)
  ON CONFLICT (scope, subject_id, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_attempts;

  IF v_attempts > 10 THEN
    RAISE EXCEPTION 'content_password: too many attempts';
  END IF;

  -- Kubelek adresu (20 / 5 minut) na WSZYSTKIE tresci chronione haslem.
  IF _ip_hash IS NOT NULL AND length(_ip_hash) > 0 THEN
    INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
    VALUES (
      'content_password_ip',
      'ip:' || _ip_hash,
      to_timestamp((floor(extract(epoch FROM now()) / 300) * 300)::double precision),
      1
    )
    ON CONFLICT (scope, subject_id, window_start)
    DO UPDATE SET count = public.rate_limits.count + 1
    RETURNING count INTO v_ip_attempts;

    IF v_ip_attempts > 20 THEN
      RAISE EXCEPTION 'content_password: too many attempts (ip)';
    END IF;
  END IF;

  SELECT mode, password_hash INTO v_mode, v_hash
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode::text <> 'password' OR v_hash IS NULL OR _password IS NULL OR length(_password) = 0 THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF crypt(_password, v_hash) <> v_hash THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF _entity_type = 'post' THEN
    RETURN QUERY
      SELECT true, p.content_pl, p.content_en, p.builder_data, p.blocks_data
        FROM public.posts p
       WHERE p.id = _entity_id
         AND p.tenant_id = p_tenant
         AND p.status = 'published'
         AND p.deleted_at IS NULL;
  ELSIF _entity_type = 'page' THEN
    RETURN QUERY
      SELECT true, pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
        FROM public.pages pg
       WHERE pg.id = _entity_id
         AND pg.tenant_id = p_tenant
         AND pg.status = 'published'
         AND pg.deleted_at IS NULL;
  END IF;

  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_content_password(_entity_type access_entity_type, _entity_id uuid, _password text, _hint_pl text, _hint_en text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin') OR public.has_role(v_uid, 'editor')) THEN
    RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
  END IF;

  UPDATE public.content_access
     SET password_hash = CASE
           WHEN _password IS NULL OR length(_password) = 0 THEN password_hash
           ELSE crypt(_password, gen_salt('bf', 10))
         END,
         password_hint_pl = _hint_pl,
         password_hint_en = _hint_en,
         updated_at = now()
   WHERE entity_type = _entity_type AND entity_id = _entity_id
     AND tenant_id = public.current_tenant_id();
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_clear_content_password(_entity_type access_entity_type, _entity_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin') OR public.has_role(v_uid, 'editor')) THEN
    RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
  END IF;
  UPDATE public.content_access
     SET password_hash = NULL,
         updated_at = now()
   WHERE entity_type = _entity_type AND entity_id = _entity_id
     AND tenant_id = public.current_tenant_id();
END
$function$;
