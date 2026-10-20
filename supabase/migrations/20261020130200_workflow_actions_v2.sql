-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S4, 3/8): AKCJE V2 WE WSPÓLNYM `run_workflow_step`
-- (przepisy automatyzacji i - od S5 - kroki ścieżek komunikacji).
--
-- DEFEKT
--   1. D1: przepis `newsletter-confirmed-to-crm` to cichy no-op. Redakcja
--      ładunku (20260729123407) usuwa `payload.email`, `crm_upsert_lead`
--      dostaje NULL i zwraca NULL bez błędu, a przebieg zapisuje się jako
--      `succeeded`. Lead zakładał niezależny `trg_newsletter_to_lead`, więc
--      test spójności był fałszywie zielony.
--   2. D9: `create_crm_lead` z parametrem `marketing: true` WŁĄCZAŁ zgodę
--      marketingową - zgodę daje wyłącznie dowód (double opt-in, konto,
--      księga zgód), nie konfiguracja przepisu.
--   3. P24: zadanie z automatu dostaje `assignee_id` = właściciel leada; lead
--      bez właściciela = zadanie bez osoby i bez przypomnienia. Zadanie nie
--      wie też, kto je utworzył, a powtórka kroku tworzy duplikat.
--   4. Katalog akcji nie umie zmienić etapu CRM, cyklu życia, tagów,
--      właściciela ani listy newslettera - ścieżki (S5) i przepisy nie mają
--      czym pisać do CRM, więc każda funkcja dopisywałaby własnego pisarza.
--
-- ZMIANA
--   A. `run_workflow_step(domain_events, jsonb)` - pełne ciało z najnowszej
--      definicji (CIALO-Z niżej: poprawka `uuid = text` w `notify_followers`
--      zostaje) + akcje:
--        * `set_lifecycle_stage` {stage, allow_backward} - przez
--          `crm_set_lifecycle_stage(..., 'workflow'|'journey')`, czyli
--          z pierwszeństwem (odmowa `precedence`/`billing_owned` = krok
--          udany bez zmiany - automat nie nadpisuje płatności ani człowieka);
--        * `set_crm_stage` {stage} - etap sprzedaży (`crm_stage`), historia
--          ze źródłem z GUC `app.change_source`;
--        * `add_tag` / `remove_tag` {tag} - tag ≤ 40 znaków (jak panel CRM),
--          za długi ODRZUCONY, nie przycięty;
--        * `assign_owner` {owner_id, overwrite} - wyłącznie personel CRM
--          najemcy (admin|editor|super_admin), domyślnie tylko pusty właściciel;
--        * `newsletter_list_add` / `newsletter_list_remove` {list_key} - przez
--          `newsletter_subscriber_list_set` (niżej);
--        * `create_crm_task` += `assignee_id` (personel najemcy) -> właściciel
--          leada -> `journey_settings.default_task_assignee_id` (P24),
--          `source` = `workflow` (albo `journey` z kroku ścieżki),
--          `origin_ref` (szablon z `{event_id}`, `{aggregate_id}`, `{user_id}`,
--          `{lead_id}`; domyślnie `wf:<zdarzenie>:<md5 kroku>`) - unikalny
--          w najemcy, powtórka kroku nie dubluje zadania, za długi (> 200)
--          ODRZUCONY; `due_hours` (dokładność do godzin dla ścieżek);
--        * `create_crm_lead` - e-mail z ładunku, a gdy redakcja go usunęła:
--          z wiersza subskrybenta (agregat `newsletter_subscriber` albo
--          `payload.subscriber_id`) i z profilu konta (D1); brak adresu =
--          wyjątek (przebieg `failed`, nie cichy sukces); zgoda marketingowa
--          NIGDY nie jest włączana (D9 - parametr `marketing` ignorowany).
--      Lead dla akcji CRM: agregat `crm_lead` -> `payload.lead_id` ->
--      `crm_leads.user_id` konta -> e-mail (upsert jak dotąd w zadaniu).
--      Parametry z podkreśleniem (`_source`, `_journey_id`, `_enrollment_id`)
--      ustawia wyłącznie silnik ścieżek S5; edytor przepisów ich nie pokazuje.
--      Lustro katalogu w TS: `WORKFLOW_ACTIONS` (src/lib/admin/workflows.ts) -
--      test parytetu czyta etykiety `WHEN` tej funkcji z TEGO pliku.
--   B. `newsletter_subscriber_list_set(p_subscriber_id, p_list_key, p_op)`
--      (tylko `service_role` i SECURITY DEFINER): `add`|`remove` listy
--      z katalogu najemcy (`newsletter_settings.popup_mailing_lists[].id`),
--      zapis do `meta.mailing_lists` w formacie TS (`"a,b"`,
--      src/lib/newsletter/preferences.ts) z wchłonięciem starego klucza
--      `mailing_list`; napis > 500 znaków ODRZUCONY (22001), nie przycięty;
--      lustro w CRM: tag `lista:<id>` dokładany i USUWANY (dotąd tylko
--      dokładany). Nieznana lista = 22023.
--   C. Szablony retencyjne (20260723140000) dostają `origin_ref`
--      `retention:<rodzaj>:{event_id}` - billing zamyka po nim otwarte zadania
--      retencyjne po wznowieniu (P13). Definicje zainstalowane u najemców
--      dostają nowe kroki tylko wtedy, gdy są identyczne z dawnym szablonem
--      (przepis zmieniony przez admina zostaje nietknięty).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020130000 (`crm_set_lifecycle_stage`,
-- strażnik kolumn huba - zadanie z `source`/`origin_ref` pisze właściciel
-- funkcji) i po I0 (`journey_settings`). Przed `20261020130300` (silnik
-- przepisów woła tę funkcję w nowym kształcie przebiegu).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, UPDATE szablonów
-- warunkowy na dawnej treści (powtórka nic nie zmienia).
-- DOWÓD: supabase/tests/workflow_actions_v2_test.sql (każda nowa akcja,
-- `origin_ref` idempotentny, `marketing:true` nie włącza zgody, D1 z wyłączonym
-- `trg_newsletter_to_lead`); parytet katalogu: src/lib/admin/__tests__/workflows.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B) Listy newslettera - jedyny pisarz `meta.mailing_lists` z automatów.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.newsletter_subscriber_list_set(
  p_subscriber_id uuid,
  p_list_key text,
  p_op text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub record;
  v_key text := btrim(COALESCE(p_list_key, ''));
  v_lists text[];
  v_next text[];
  v_joined text;
  v_meta jsonb;
BEGIN
  IF p_op IS NULL OR p_op NOT IN ('add', 'remove') THEN
    RAISE EXCEPTION 'newsletter_list_op_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_key = '' THEN
    RAISE EXCEPTION 'newsletter_list_key_required' USING ERRCODE = '22023';
  END IF;

  SELECT s.id, s.tenant_id, s.email, s.meta
    INTO v_sub
    FROM public.newsletter_subscribers s
   WHERE s.id = p_subscriber_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter_subscriber_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Lista spoza katalogu najemcy nie istnieje: zapis „lista: cokolwiek"
  -- tworzyłby segment, którego kampania nigdy nie wybierze.
  IF NOT EXISTS (
    SELECT 1
      FROM public.newsletter_settings ns,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(ns.popup_mailing_lists) = 'array'
                  THEN ns.popup_mailing_lists ELSE '[]'::jsonb END
           ) AS e(entry)
     WHERE ns.tenant_id = v_sub.tenant_id
       AND jsonb_typeof(e.entry) = 'object'
       AND btrim(e.entry ->> 'id') = v_key
  ) THEN
    RAISE EXCEPTION 'newsletter_list_unknown' USING ERRCODE = '22023';
  END IF;

  -- Te same reguły co `readPreferences`: `mailing_lists` + stary
  -- `mailing_list`, rozbite po przecinku, bez pustych i duplikatów.
  SELECT COALESCE(array_agg(x.v ORDER BY x.first_pos), ARRAY[]::text[])
    INTO v_lists
    FROM (
      SELECT btrim(part) AS v, min(ord) AS first_pos
        FROM unnest(
               string_to_array(
                 concat_ws(',', v_sub.meta ->> 'mailing_lists', v_sub.meta ->> 'mailing_list'), ','
               )
             ) WITH ORDINALITY AS t(part, ord)
       WHERE btrim(part) <> ''
       GROUP BY btrim(part)
    ) x;

  IF p_op = 'add' THEN
    v_next := CASE WHEN v_key = ANY (v_lists) THEN v_lists ELSE v_lists || v_key END;
  ELSE
    v_next := array_remove(v_lists, v_key);
  END IF;

  v_joined := array_to_string(v_next, ',');
  -- `MAX_LISTS_LEN` z preferences.ts. Przycięcie zgubiłoby ostatnią listę
  -- bez śladu - odrzucamy całą zmianę.
  IF char_length(v_joined) > 500 THEN
    RAISE EXCEPTION 'newsletter_mailing_lists_too_long' USING ERRCODE = '22001';
  END IF;

  v_meta := COALESCE(v_sub.meta, '{}'::jsonb) - 'mailing_list';
  v_meta := CASE WHEN cardinality(v_next) = 0 THEN v_meta - 'mailing_lists'
                 ELSE v_meta || jsonb_build_object('mailing_lists', v_joined) END;

  IF v_meta IS DISTINCT FROM v_sub.meta THEN
    UPDATE public.newsletter_subscribers
       SET meta = v_meta,
           updated_at = now()
     WHERE id = v_sub.id;
  END IF;

  -- Lustro w CRM (tag `lista:<id>`, crmTagsFromPreferences) - w obie strony.
  UPDATE public.crm_leads l
     SET tags = CASE
           WHEN p_op = 'add' THEN
             CASE WHEN ('lista:' || v_key) = ANY (l.tags) THEN l.tags ELSE l.tags || ('lista:' || v_key) END
           ELSE array_remove(l.tags, 'lista:' || v_key)
         END
   WHERE l.tenant_id = v_sub.tenant_id
     AND l.email_norm = lower(btrim(v_sub.email))
     AND (('lista:' || v_key) = ANY (l.tags)) IS DISTINCT FROM (p_op = 'add');

  RETURN jsonb_build_object(
    'subscriber_id', v_sub.id,
    'list_key', v_key,
    'op', p_op,
    'changed', v_meta IS DISTINCT FROM v_sub.meta,
    'lists', to_jsonb(v_next)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_subscriber_list_set(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_subscriber_list_set(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_subscriber_list_set(uuid, text, text) IS
  'Hub S4: dodanie/usunięcie listy z katalogu najemcy w meta.mailing_lists subskrybenta (format TS "a,b", > 500 znaków = 22001) + lustro tagu lista:<id> w CRM. Tylko service_role i funkcje SECURITY DEFINER (akcje newsletter_list_add/remove).';

-- ----------------------------------------------------------------------------
-- A) Katalog akcji.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261007140700
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
  v_first_name text;
  v_last_name text;
  v_sub_ref text;
  v_sub_id uuid;
  v_lead_id uuid;
  v_lead_owner uuid;
  v_task_title text;
  v_assignee uuid;
  v_origin text;
  v_due interval;
  v_tag text;
  v_stage text;
  v_owner uuid;
  -- Kto pisze: przepis (domyślnie) albo krok ścieżki S5 - nic poza tym.
  v_source text := COALESCE(NULLIF(v_params ->> '_source', ''), 'workflow');
  v_prev_source text;
  v_prev_journey text;
  v_prev_enrollment text;
BEGIN
  IF v_source NOT IN ('workflow', 'journey') THEN
    RAISE EXCEPTION 'workflow: invalid _source %', v_source;
  END IF;

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

  -- KONTAKT ZDARZENIA (akcje CRM i newslettera). Redakcja ładunku
  -- (20260729123407) usuwa e-mail, więc adres bierzemy z miejsc, które go
  -- trzymają: subskrybent (agregat albo `subscriber_id`) i profil konta.
  IF v_action IN ('create_crm_lead', 'create_crm_task', 'set_lifecycle_stage', 'set_crm_stage',
                  'add_tag', 'remove_tag', 'assign_owner',
                  'newsletter_list_add', 'newsletter_list_remove') THEN
    v_user := NULLIF(COALESCE(
      public.workflow_param_text(p_event.payload, v_params, 'user_id', 'user_from'),
      p_event.payload ->> 'user_id'
    ), '')::uuid;
    v_email := NULLIF(btrim(
      p_event.payload ->> COALESCE(NULLIF(v_params ->> 'email_from', ''), 'email')
    ), '');
    v_first_name := p_event.payload ->> COALESCE(NULLIF(v_params ->> 'first_name_from', ''), 'first_name');
    v_last_name := p_event.payload ->> COALESCE(NULLIF(v_params ->> 'last_name_from', ''), 'last_name');

    v_sub_ref := CASE
      WHEN p_event.aggregate_type = 'newsletter_subscriber' THEN p_event.aggregate_id
      ELSE NULLIF(p_event.payload ->> 'subscriber_id', '')
    END;
    IF v_sub_ref IS NOT NULL THEN
      SELECT s.id, COALESCE(v_email, NULLIF(btrim(s.email), '')),
             COALESCE(v_first_name, s.first_name), COALESCE(v_last_name, s.last_name)
        INTO v_sub_id, v_email, v_first_name, v_last_name
        FROM public.newsletter_subscribers s
       WHERE s.id::text = v_sub_ref AND s.tenant_id = p_event.tenant_id;
    END IF;
    IF v_email IS NULL AND v_user IS NOT NULL THEN
      SELECT COALESCE(NULLIF(btrim(p.email), ''), NULLIF(btrim(p.contact_email), ''))
        INTO v_email
        FROM public.profiles p
       WHERE p.id = v_user AND p.tenant_id = p_event.tenant_id;
    END IF;
    -- Zdarzenia leada (np. `crm_lead.lifecycle_changed.v1`) nie niosą adresu:
    -- bierzemy go z samego leada, żeby akcje listy newslettera działały też
    -- w przepisach uruchamianych zmianą etapu.
    IF v_email IS NULL THEN
      SELECT NULLIF(btrim(l.email), '')
        INTO v_email
        FROM public.crm_leads l
       WHERE l.tenant_id = p_event.tenant_id
         AND l.id::text = CASE WHEN p_event.aggregate_type = 'crm_lead'
                               THEN p_event.aggregate_id
                               ELSE NULLIF(p_event.payload ->> 'lead_id', '') END;
    END IF;
  END IF;

  -- LEAD ZDARZENIA (akcje CRM poza zakładaniem leada): agregat leada,
  -- `payload.lead_id`, konto (`crm_leads.user_id`), a na końcu e-mail -
  -- z upsertem, jak dotąd w `create_crm_task` („klient jest wart bycia leadem").
  IF v_action IN ('create_crm_task', 'set_lifecycle_stage', 'set_crm_stage',
                  'add_tag', 'remove_tag', 'assign_owner') THEN
    IF p_event.aggregate_type = 'crm_lead' THEN
      SELECT l.id INTO v_lead_id
        FROM public.crm_leads l
       WHERE l.id::text = p_event.aggregate_id AND l.tenant_id = p_event.tenant_id;
    END IF;
    IF v_lead_id IS NULL AND NULLIF(p_event.payload ->> 'lead_id', '') IS NOT NULL THEN
      SELECT l.id INTO v_lead_id
        FROM public.crm_leads l
       WHERE l.id::text = p_event.payload ->> 'lead_id' AND l.tenant_id = p_event.tenant_id;
    END IF;
    IF v_lead_id IS NULL AND v_user IS NOT NULL THEN
      SELECT l.id INTO v_lead_id
        FROM public.crm_leads l
       WHERE l.tenant_id = p_event.tenant_id AND l.user_id = v_user;
    END IF;
    IF v_lead_id IS NULL THEN
      IF v_email IS NULL THEN
        RAISE EXCEPTION 'workflow %: no lead or email resolvable from event', v_action;
      END IF;
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
        RAISE EXCEPTION 'workflow %: lead not found after upsert', v_action;
      END IF;
    END IF;
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
      -- D1: bez adresu przebieg ma się NIE udać (dotąd crm_upsert_lead
      -- zwracał NULL, a przebieg był `succeeded`).
      IF v_email IS NULL THEN
        RAISE EXCEPTION 'workflow create_crm_lead: no email resolvable from payload, subscriber or profile';
      END IF;
      -- D9: zgoda marketingowa wyłącznie z dowodu, nigdy z parametru przepisu.
      PERFORM public.crm_upsert_lead(
        p_event.tenant_id, v_email, v_first_name, v_last_name, NULL, NULL,
        COALESCE((v_params ->> 'newsletter')::boolean, false),
        false
      );

    WHEN 'create_crm_task' THEN
      SELECT l.owner_id INTO v_lead_owner FROM public.crm_leads l WHERE l.id = v_lead_id;

      -- P24: osoba z parametru (tylko personel CRM najemcy), potem właściciel
      -- leada, potem domyślna osoba z ustawień ścieżek. Bez niej przypomnienie
      -- nie trafi do nikogo (reguła diagnostyki S7 to wyłapie).
      v_assignee := NULLIF(v_params ->> 'assignee_id', '')::uuid;
      IF v_assignee IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
         WHERE ur.tenant_id = p_event.tenant_id AND ur.user_id = v_assignee
           AND ur.role::text IN ('admin', 'editor', 'super_admin')
      ) THEN
        RAISE EXCEPTION 'workflow create_crm_task: assignee is not CRM staff of the tenant';
      END IF;
      IF v_assignee IS NULL THEN
        v_assignee := v_lead_owner;
      END IF;
      IF v_assignee IS NULL THEN
        SELECT js.default_task_assignee_id INTO v_assignee
          FROM public.journey_settings js WHERE js.tenant_id = p_event.tenant_id;
      END IF;

      v_task_title := COALESCE(
        NULLIF(replace(COALESCE(v_params ->> 'title', ''), '{aggregate_id}', p_event.aggregate_id), ''),
        'Follow-up'
      );
      -- Klucz idempotencji kroku. Domyślny łączy zdarzenie z treścią kroku:
      -- ten sam krok tego samego zdarzenia = jedno zadanie także po powtórce.
      v_origin := COALESCE(
        NULLIF(btrim(v_params ->> 'origin_ref'), ''),
        'wf:' || p_event.id::text || ':' || md5(p_step::text)
      );
      v_origin := replace(replace(replace(replace(v_origin,
        '{event_id}', p_event.id::text),
        '{aggregate_id}', p_event.aggregate_id),
        '{user_id}', COALESCE(v_user::text, '')),
        '{lead_id}', v_lead_id::text);
      -- Przycięcie skleiłoby dwa różne kroki w jedno zadanie (I0 CHECK).
      IF char_length(v_origin) > 200 THEN
        RAISE EXCEPTION 'workflow create_crm_task: origin_ref longer than 200 characters';
      END IF;

      IF NULLIF(v_params ->> 'due_hours', '') IS NOT NULL THEN
        v_due := make_interval(hours => GREATEST(0, (v_params ->> 'due_hours')::integer));
      ELSE
        v_due := make_interval(
          days => GREATEST(0, COALESCE(NULLIF(v_params ->> 'due_days', '')::integer, 3))
        );
      END IF;

      -- Dedup: jedno OTWARTE zadanie o tym tytule per lead - zdarzenie może
      -- odpalić wielokrotnie (np. zmiana okresu przy zaplanowanym anulowaniu).
      IF NOT EXISTS (
        SELECT 1 FROM public.crm_tasks ct
         WHERE ct.lead_id = v_lead_id AND ct.status = 'open' AND ct.title = v_task_title
      ) THEN
        INSERT INTO public.crm_tasks (
          tenant_id, lead_id, title, note, due_at, assignee_id, created_by, source, origin_ref
        ) VALUES (
          p_event.tenant_id, v_lead_id, v_task_title,
          NULLIF(v_params ->> 'note', ''),
          now() + v_due,
          v_assignee, NULL, v_source, v_origin
        )
        ON CONFLICT (tenant_id, origin_ref) WHERE origin_ref IS NOT NULL DO NOTHING;
      END IF;

    WHEN 'set_lifecycle_stage' THEN
      v_stage := NULLIF(btrim(v_params ->> 'stage'), '');
      IF v_stage IS NULL THEN
        RAISE EXCEPTION 'workflow set_lifecycle_stage: stage is required';
      END IF;
      v_prev_journey := current_setting('app.change_journey_id', true);
      v_prev_enrollment := current_setting('app.change_enrollment_id', true);
      PERFORM set_config('app.change_journey_id', COALESCE(v_params ->> '_journey_id', ''), true);
      PERFORM set_config('app.change_enrollment_id', COALESCE(v_params ->> '_enrollment_id', ''), true);
      -- Odmowa pierwszeństwa to WYNIK (krok udany bez zmiany), nie błąd.
      PERFORM public.crm_set_lifecycle_stage(
        v_lead_id, v_stage, v_source, COALESCE((v_params ->> 'allow_backward')::boolean, false)
      );
      PERFORM set_config('app.change_journey_id', COALESCE(v_prev_journey, ''), true);
      PERFORM set_config('app.change_enrollment_id', COALESCE(v_prev_enrollment, ''), true);

    WHEN 'set_crm_stage' THEN
      v_stage := NULLIF(btrim(v_params ->> 'stage'), '');
      IF v_stage IS NULL THEN
        RAISE EXCEPTION 'workflow set_crm_stage: stage is required';
      END IF;
      v_prev_source := current_setting('app.change_source', true);
      PERFORM set_config('app.change_source', v_source, true);
      UPDATE public.crm_leads
         SET stage = v_stage::public.crm_stage,
             last_activity_at = now()
       WHERE id = v_lead_id AND stage IS DISTINCT FROM v_stage::public.crm_stage;
      PERFORM set_config('app.change_source', COALESCE(v_prev_source, ''), true);

    WHEN 'add_tag' THEN
      v_tag := btrim(COALESCE(v_params ->> 'tag', ''));
      IF char_length(v_tag) NOT BETWEEN 1 AND 40 THEN
        RAISE EXCEPTION 'workflow add_tag: tag must have 1-40 characters';
      END IF;
      UPDATE public.crm_leads l
         SET tags = l.tags || v_tag
       WHERE l.id = v_lead_id AND NOT (v_tag = ANY (l.tags));

    WHEN 'remove_tag' THEN
      v_tag := btrim(COALESCE(v_params ->> 'tag', ''));
      IF char_length(v_tag) NOT BETWEEN 1 AND 40 THEN
        RAISE EXCEPTION 'workflow remove_tag: tag must have 1-40 characters';
      END IF;
      UPDATE public.crm_leads l
         SET tags = array_remove(l.tags, v_tag)
       WHERE l.id = v_lead_id AND v_tag = ANY (l.tags);

    WHEN 'assign_owner' THEN
      v_owner := NULLIF(v_params ->> 'owner_id', '')::uuid;
      IF v_owner IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
         WHERE ur.tenant_id = p_event.tenant_id AND ur.user_id = v_owner
           AND ur.role::text IN ('admin', 'editor', 'super_admin')
      ) THEN
        RAISE EXCEPTION 'workflow assign_owner: owner is not CRM staff of the tenant';
      END IF;
      UPDATE public.crm_leads l
         SET owner_id = v_owner
       WHERE l.id = v_lead_id
         AND l.owner_id IS DISTINCT FROM v_owner
         AND (l.owner_id IS NULL OR COALESCE((v_params ->> 'overwrite')::boolean, false));

    WHEN 'newsletter_list_add', 'newsletter_list_remove' THEN
      IF v_sub_id IS NULL AND v_email IS NOT NULL THEN
        SELECT s.id INTO v_sub_id
          FROM public.newsletter_subscribers s
         WHERE s.tenant_id = p_event.tenant_id AND lower(s.email) = lower(v_email)
         LIMIT 1;
      END IF;
      -- Automat nie zapisuje na newsletter (zgoda!) - bez subskrybenta nie ma
      -- czego przypisać do listy.
      IF v_sub_id IS NULL THEN
        RAISE EXCEPTION 'workflow %: no newsletter subscriber for the event', v_action;
      END IF;
      PERFORM public.newsletter_subscriber_list_set(
        v_sub_id, v_params ->> 'list_key',
        CASE WHEN v_action = 'newsletter_list_add' THEN 'add' ELSE 'remove' END
      );

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

-- ACL jak w 20260711204000 / 20260723140000 (tylko service_role).
REVOKE ALL ON FUNCTION public.run_workflow_step(public.domain_events, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_workflow_step(public.domain_events, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- C) Szablony retencyjne z `origin_ref` (P13: zamykanie po wznowieniu).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_new jsonb;
BEGIN
  FOR r IN
    SELECT wt.key, wt.steps AS old_steps,
           CASE wt.key
             WHEN 'subscription-cancel-scheduled-crm-task' THEN 'retention:cancel_scheduled:{event_id}'
             ELSE 'retention:canceled:{event_id}'
           END AS origin_ref
      FROM public.workflow_templates wt
     WHERE wt.key IN ('subscription-cancel-scheduled-crm-task', 'subscription-canceled-crm-task')
       AND wt.steps -> 0 ->> 'action' = 'create_crm_task'
       AND NOT (wt.steps -> 0 -> 'params' ? 'origin_ref')
  LOOP
    v_new := jsonb_set(r.old_steps, '{0,params,origin_ref}', to_jsonb(r.origin_ref), true);
    -- Przepis zainstalowany u najemcy dostaje nowe kroki tylko, gdy jest
    -- IDENTYCZNY z dawnym szablonem - zmiany admina zostają nietknięte.
    UPDATE public.workflow_definitions d
       SET steps = v_new, updated_at = now()
     WHERE d.template_key = r.key AND d.steps = r.old_steps;
    UPDATE public.workflow_templates SET steps = v_new WHERE key = r.key;
  END LOOP;
END $$;
