-- ============================================================================
-- KANAŁY SYGNAŁÓW: @WZMIANKA I PROŚBA O ZDANIE (2026-11-20).
--
-- STAN PRZED: `process_mentions` i `club_thread_expert_ping` tworzą
-- powiadomienie in-app przez `enqueue_notification`; trigger
-- `tg_notifications_enqueue_push` kolejkuje push dla KAŻDEGO powiadomienia
-- odbiorcy z `push_enabled`. E-mail był wyłącznie zbiorczy (digest).
--
-- ZMIANA:
--   1. `notification_preferences`:
--      - `signal_email` (domyślnie FALSE - decyzja właściciela 2026-11-20):
--        natychmiastowy e-mail o wzmiance i prośbie o zdanie,
--      - `push_scope` ('all' | 'signals'): push dla wszystkich powiadomień
--        albo wyłącznie dla wzmianek i próśb o zdanie.
--   2. `notification_webhooks`: jeden osobisty webhook na konto w najemcy
--      (format standard/slack/discord, podpis HMAC). Sekret wychodzi z bazy
--      WYŁĄCZNIE przy utworzeniu i rotacji; odczyt właściciela przez
--      `notification_webhook_mine()` bez sekretu. Tabela bez grantów dla ról
--      sesji - dostęp tylko przez RPC.
--   3. `notification_signal_jobs`: kolejka e-mail/webhook (claim SKIP LOCKED,
--      backoff wykładniczy, maks. 6 prób, retencja 30 dni). Webhook po 10
--      kolejnych porażkach albo odpowiedzi 404/410 jest wyłączany.
--   4. `enqueue_signal_notification`: JEDYNY producent sygnałów - woła
--      `enqueue_notification` (bramka rodzaju + dedup 5 min bez zmian), a po
--      udanym wstawieniu rozprowadza kanały: push dla zakresu 'signals',
--      e-mail (limit 12 na godzinę na odbiorcę), webhook.
--   5. `process_mentions` i `club_thread_expert_ping` wołają nowego
--      producenta; `tg_notifications_enqueue_push` pomija odbiorców z
--      `push_scope = 'signals'` (ich push kolejkuje producent sygnału).
--
-- Najemca: zawsze z `profiles` (wołający) albo ze stempla powiadomienia
-- (odbiorca) - nigdy z argumentów.
--
-- BLOKADY: ALTER TABLE ADD COLUMN ze stałym DEFAULT jest operacją katalogową,
-- ale bierze ACCESS EXCLUSIVE na `notification_preferences` (krótko);
-- `lock_timeout` 5 s, 55P03 = właściciel ponawia według RUNBOOK §4.6.
-- CREATE OR REPLACE FUNCTION nie blokuje tabel.
--
-- Idempotentne: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS,
-- warunkowe ograniczenia, REVOKE/GRANT.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Preferencje kanałów
-- ---------------------------------------------------------------------------
SET lock_timeout = '5s';
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS signal_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_scope text NOT NULL DEFAULT 'all';
RESET lock_timeout;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notification_preferences_push_scope_check'
       AND conrelid = 'public.notification_preferences'::regclass
  ) THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_push_scope_check
      CHECK (push_scope IN ('all', 'signals'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.notification_preferences.signal_email IS
  'Natychmiastowy e-mail o @wzmiance i prosbie o zdanie (domyslnie wylaczony). Producent: enqueue_signal_notification.';
COMMENT ON COLUMN public.notification_preferences.push_scope IS
  'Zakres web push: all = kazde powiadomienie, signals = tylko @wzmianki i prosby o zdanie.';

-- ---------------------------------------------------------------------------
-- 2. Osobiste webhooki
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  url text NOT NULL,
  format text NOT NULL DEFAULT 'standard',
  events text[] NOT NULL DEFAULT ARRAY['mention', 'expert_ping']::text[],
  secret text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  disabled_reason text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_delivery_at timestamptz,
  last_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_webhooks_owner_key UNIQUE (tenant_id, user_id),
  CONSTRAINT notification_webhooks_url_check CHECK (
    char_length(url) BETWEEN 12 AND 2048
    AND url ~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
  ),
  CONSTRAINT notification_webhooks_format_check CHECK (format IN ('standard', 'slack', 'discord')),
  CONSTRAINT notification_webhooks_events_check CHECK (
    cardinality(events) >= 1 AND events <@ ARRAY['mention', 'expert_ping']::text[]
  ),
  CONSTRAINT notification_webhooks_disabled_reason_check CHECK (
    disabled_reason IS NULL OR disabled_reason IN ('failures', 'gone', 'owner')
  )
);

REVOKE ALL ON public.notification_webhooks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_webhooks TO service_role;
ALTER TABLE public.notification_webhooks ENABLE ROW LEVEL SECURITY;
-- Celowo bez polityk: role sesji nie maja grantow, wlasciciel czyta i zapisuje
-- wylacznie przez RPC ponizej (sekret nie moze wyjsc przez SELECT).

CREATE INDEX IF NOT EXISTS notification_webhooks_user_idx
  ON public.notification_webhooks (user_id);

CREATE OR REPLACE FUNCTION public.notification_webhooks_pin_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = NEW.user_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'notification_webhooks: owner has no tenant' USING ERRCODE = '23502';
  END IF;
  NEW.tenant_id := v_tenant;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notification_webhooks_pin_tenant() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS notification_webhooks_pin_tenant_tg ON public.notification_webhooks;
CREATE TRIGGER notification_webhooks_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.notification_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.notification_webhooks_pin_tenant();

-- ---------------------------------------------------------------------------
-- 3. Kolejka kanałów sygnału (e-mail, webhook)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_signal_jobs (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL,
  channel text NOT NULL,
  signal text NOT NULL,
  webhook_id uuid REFERENCES public.notification_webhooks(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT notification_signal_jobs_once_key UNIQUE (notification_id, channel),
  CONSTRAINT notification_signal_jobs_channel_check CHECK (channel IN ('email', 'webhook')),
  CONSTRAINT notification_signal_jobs_signal_check CHECK (signal IN ('mention', 'expert_ping')),
  CONSTRAINT notification_signal_jobs_status_check CHECK (status IN ('pending', 'sent', 'dead')),
  CONSTRAINT notification_signal_jobs_webhook_check CHECK ((channel = 'webhook') = (webhook_id IS NOT NULL))
);

REVOKE ALL ON public.notification_signal_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_signal_jobs TO service_role;
ALTER TABLE public.notification_signal_jobs ENABLE ROW LEVEL SECURITY;
-- Celowo bez polityk: kolejka serwerowa (claim/report przez service_role).

CREATE INDEX IF NOT EXISTS notification_signal_jobs_due_idx
  ON public.notification_signal_jobs (next_attempt_at, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notification_signal_jobs_user_recent_idx
  ON public.notification_signal_jobs (user_id, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_signal_jobs_retention_idx
  ON public.notification_signal_jobs (created_at) WHERE status <> 'pending';

-- ---------------------------------------------------------------------------
-- 4. RPC właściciela webhooka
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_webhook_mine()
RETURNS TABLE (
  id uuid,
  url text,
  format text,
  events text[],
  enabled boolean,
  disabled_reason text,
  consecutive_failures integer,
  last_delivery_at timestamptz,
  last_status integer,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT w.id, w.url, w.format, w.events, w.enabled, w.disabled_reason,
         w.consecutive_failures, w.last_delivery_at, w.last_status, w.created_at
    FROM public.notification_webhooks w
    JOIN public.profiles p ON p.id = w.user_id AND p.tenant_id = w.tenant_id
   WHERE w.user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.notification_webhook_save(
  p_url text,
  p_format text,
  p_events text[]
)
RETURNS TABLE (webhook_id uuid, secret text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_url text := btrim(COALESCE(p_url, ''));
  v_events text[];
  v_id uuid;
  v_inserted boolean;
  v_secret text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'notification_webhook_save: unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'notification_webhook_save: no tenant' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_url) NOT BETWEEN 12 AND 2048
     OR v_url !~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' THEN
    RAISE EXCEPTION 'notification_webhook_save: invalid url' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_format, '') NOT IN ('standard', 'slack', 'discord') THEN
    RAISE EXCEPTION 'notification_webhook_save: invalid format' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT e ORDER BY e), ARRAY[]::text[]) INTO v_events
    FROM unnest(COALESCE(p_events, ARRAY[]::text[])) AS e
   WHERE e IN ('mention', 'expert_ping');
  IF cardinality(v_events) = 0 THEN
    RAISE EXCEPTION 'notification_webhook_save: no events' USING ERRCODE = '22023';
  END IF;

  v_secret := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.notification_webhooks AS w (tenant_id, user_id, url, format, events, secret)
  VALUES (v_tenant, v_uid, v_url, p_format, v_events, v_secret)
  ON CONFLICT ON CONSTRAINT notification_webhooks_owner_key DO UPDATE
     SET url = EXCLUDED.url,
         format = EXCLUDED.format,
         events = EXCLUDED.events,
         enabled = true,
         disabled_reason = NULL,
         consecutive_failures = 0
  RETURNING w.id, (w.xmax = 0) INTO v_id, v_inserted;

  webhook_id := v_id;
  -- Sekret tylko przy utworzeniu; zmiana adresu nie ujawnia go ponownie
  -- (do tego jest jawna rotacja).
  secret := CASE WHEN v_inserted THEN v_secret ELSE NULL END;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notification_webhook_rotate_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'notification_webhook_rotate_secret: unauthenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notification_webhooks w
     SET secret = v_secret
    FROM public.profiles p
   WHERE w.user_id = v_uid AND p.id = v_uid AND p.tenant_id = w.tenant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN v_secret;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notification_webhook_set_enabled(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'notification_webhook_set_enabled: unauthenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notification_webhooks w
     SET enabled = COALESCE(p_enabled, false),
         disabled_reason = CASE WHEN COALESCE(p_enabled, false) THEN NULL ELSE 'owner' END,
         consecutive_failures = CASE WHEN COALESCE(p_enabled, false) THEN 0 ELSE w.consecutive_failures END
    FROM public.profiles p
   WHERE w.user_id = v_uid AND p.id = v_uid AND p.tenant_id = w.tenant_id;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notification_webhook_delete()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'notification_webhook_delete: unauthenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.notification_webhooks w
   USING public.profiles p
   WHERE w.user_id = v_uid AND p.id = v_uid AND p.tenant_id = w.tenant_id;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.notification_webhook_mine() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_webhook_save(text, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_webhook_rotate_secret() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_webhook_set_enabled(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_webhook_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_webhook_mine() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_webhook_save(text, text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_webhook_rotate_secret() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_webhook_set_enabled(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_webhook_delete() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Producent sygnału
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_signal_notification(
  p_user_id uuid,
  p_signal text,
  p_kind text,
  p_title_pl text,
  p_title_en text,
  p_body_pl text DEFAULT NULL,
  p_body_en text DEFAULT NULL,
  p_href text DEFAULT NULL,
  p_icon text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_n public.notifications%ROWTYPE;
  v_push_enabled boolean;
  v_push_scope text;
  v_signal_email boolean;
  v_payload jsonb;
  v_hook_id uuid;
  v_recent integer;
BEGIN
  v_id := public.enqueue_notification(
    p_user_id, p_kind, p_title_pl, p_title_en, p_body_pl, p_body_en, p_href, p_icon
  );
  -- NULL = rodzaj wyciszony, dedup 5 min albo awaria producenta: zaden kanal.
  IF v_id IS NULL OR p_signal IS NULL OR p_signal NOT IN ('mention', 'expert_ping') THEN
    RETURN v_id;
  END IF;

  -- Rozprowadzenie kanalow nigdy nie moze zabrac powiadomienia in-app.
  BEGIN
    SELECT * INTO v_n FROM public.notifications WHERE id = v_id;
    SELECT np.push_enabled, np.push_scope, np.signal_email
      INTO v_push_enabled, v_push_scope, v_signal_email
      FROM public.notification_preferences np
     WHERE np.user_id = p_user_id;

    v_payload := jsonb_build_object(
      'notification_id', v_n.id,
      'signal', p_signal,
      'kind', v_n.kind,
      'title_pl', v_n.title_pl,
      'title_en', v_n.title_en,
      'body_pl', v_n.body_pl,
      'body_en', v_n.body_en,
      'href', v_n.href,
      'created_at', v_n.created_at
    );

    -- Push dla zakresu 'signals' (trigger pomija tych odbiorcow).
    IF COALESCE(v_push_enabled, false) AND v_push_scope = 'signals'
       AND EXISTS (
         SELECT 1 FROM public.push_subscriptions ps
          WHERE ps.user_id = p_user_id AND ps.tenant_id = v_n.tenant_id AND ps.failed_at IS NULL
       )
    THEN
      INSERT INTO public.notification_push_queue (tenant_id, notification_id, user_id, payload)
      VALUES (v_n.tenant_id, v_n.id, p_user_id, jsonb_build_object(
        'kind', v_n.kind, 'title_pl', v_n.title_pl, 'title_en', v_n.title_en,
        'body_pl', v_n.body_pl, 'body_en', v_n.body_en, 'href', v_n.href));
    END IF;

    -- E-mail: wylacznie po jawnym wlaczeniu (brak wiersza = wylaczone),
    -- maks. 12 na godzine na odbiorce.
    IF COALESCE(v_signal_email, false) THEN
      SELECT count(*) INTO v_recent
        FROM public.notification_signal_jobs j
       WHERE j.user_id = p_user_id AND j.channel = 'email'
         AND j.created_at > now() - interval '1 hour';
      IF v_recent < 12 THEN
        INSERT INTO public.notification_signal_jobs
          (tenant_id, user_id, notification_id, channel, signal, payload)
        VALUES (v_n.tenant_id, p_user_id, v_n.id, 'email', p_signal, v_payload)
        ON CONFLICT ON CONSTRAINT notification_signal_jobs_once_key DO NOTHING;
      END IF;
    END IF;

    SELECT w.id INTO v_hook_id
      FROM public.notification_webhooks w
     WHERE w.user_id = p_user_id AND w.tenant_id = v_n.tenant_id
       AND w.enabled AND p_signal = ANY (w.events);
    IF v_hook_id IS NOT NULL THEN
      INSERT INTO public.notification_signal_jobs
        (tenant_id, user_id, notification_id, channel, signal, webhook_id, payload)
      VALUES (v_n.tenant_id, p_user_id, v_n.id, 'webhook', p_signal, v_hook_id, v_payload)
      ON CONFLICT ON CONSTRAINT notification_signal_jobs_once_key DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_signal_notification: channels dropped (signal=%, user=%): % [%]',
      p_signal, p_user_id, SQLERRM, SQLSTATE;
  END;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_signal_notification(uuid, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_signal_notification(uuid, text, text, text, text, text, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Push trigger: zakres 'signals' obsługuje producent sygnału
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_notifications_enqueue_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.notification_preferences np
        WHERE np.user_id = NEW.user_id AND np.push_enabled AND np.push_scope = 'all'
     )
     AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = NEW.user_id AND ps.failed_at IS NULL)
  THEN
    INSERT INTO public.notification_push_queue (tenant_id, notification_id, user_id, payload)
    VALUES (NEW.tenant_id, NEW.id, NEW.user_id, jsonb_build_object(
      'kind', NEW.kind, 'title_pl', NEW.title_pl, 'title_en', NEW.title_en,
      'body_pl', NEW.body_pl, 'body_en', NEW.body_en, 'href', NEW.href));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push enqueue failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Producenci: wzmianka i prośba o zdanie
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_mentions(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id text,
  p_body text,
  p_actor_id uuid,
  p_kind text,
  p_href text,
  p_actor_label text DEFAULT NULL::text,
  p_record_actor boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

    IF NOT public.club_mention_visible_to(p_source_type, p_source_id, v_profile.id) THEN
      CONTINUE;
    END IF;

    PERFORM public.add_cross_reference(
      p_tenant_id, p_source_type, p_source_id,
      'profile', v_profile.id::text, 'mention',
      CASE WHEN p_record_actor THEN p_actor_id ELSE NULL END
    );

    -- ZMIANA (2026-11-20): producent sygnalu - in-app jak dotad, plus kanaly
    -- wybrane przez odbiorce (push 'signals', e-mail, webhook).
    PERFORM public.enqueue_signal_notification(
      v_profile.id,
      'mention',
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
$function$;

CREATE OR REPLACE FUNCTION public.club_thread_expert_ping(p_thread_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_thread public.club_threads%ROWTYPE;
  v_caps   record;
  v_club   public.clubs%ROWTYPE;
  v_actor  text;
  v_rows   integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_thread_expert_ping: unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'club_thread_expert_ping: self' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_thread FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_thread.club_id, v_thread.group_id, auth.uid());
  -- Prosic o zdanie moze ten, kto sam moze sie w tym watku odezwac.
  IF NOT COALESCE(v_caps.can_reply, false) THEN
    RAISE EXCEPTION 'club_thread_expert_ping: forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_members m
     WHERE m.club_id = v_thread.club_id AND m.user_id = p_user_id AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'club_thread_expert_ping: not a member' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_expert_pings (thread_id, user_id, requested_by, tenant_id)
  VALUES (p_thread_id, p_user_id, auth.uid(), v_thread.tenant_id)
  ON CONFLICT (thread_id, user_id, requested_by) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Prosba juz poszla. Cisza jest poprawna odpowiedzia - drugi sygnal do tej
    -- samej osoby w tym samym watku to nie jest przypomnienie, tylko spam.
    RETURN false;
  END IF;

  SELECT * INTO v_club FROM public.clubs WHERE id = v_thread.club_id;
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'User') INTO v_actor
    FROM public.profiles p WHERE p.id = auth.uid();

  -- ZMIANA (2026-11-20): producent sygnalu zamiast club_notify (ta sama
  -- bramka rodzaju 'club'; self wykluczone wyzej).
  PERFORM public.enqueue_signal_notification(
    p_user_id,
    'expert_ping',
    'club',
    'Poproszono Cię o zdanie',
    'You were asked to weigh in',
    format('%s prosi o Twoje zdanie w temacie "%s".', v_actor, v_thread.title),
    format('%s is asking for your view on "%s".', v_actor, v_thread.title),
    format('/club/%s/t/%s', v_club.slug, v_thread.slug)
  );

  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Dyspozytor (service_role): claim i raport
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_notification_signal_jobs(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id bigint,
  tenant_id uuid,
  user_id uuid,
  channel text,
  signal text,
  payload jsonb,
  attempts integer,
  recipient_email text,
  recipient_lang text,
  recipient_name text,
  webhook_id uuid,
  webhook_url text,
  webhook_format text,
  webhook_secret text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Retencja: zakonczone zadania starsze niz 30 dni, partiami.
  DELETE FROM public.notification_signal_jobs d
   WHERE d.id IN (
     SELECT j.id FROM public.notification_signal_jobs j
      WHERE j.status <> 'pending' AND j.created_at < now() - interval '30 days'
      ORDER BY j.created_at
      LIMIT 500
   );

  WITH claimed AS (
    UPDATE public.notification_signal_jobs q
       SET attempts = q.attempts + 1,
           next_attempt_at = now() + (interval '1 minute' * power(2, LEAST(q.attempts, 6)))
     WHERE q.id IN (
       SELECT j.id FROM public.notification_signal_jobs j
        WHERE j.status = 'pending' AND j.next_attempt_at <= now() AND j.attempts < 6
        ORDER BY j.id
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
          FOR UPDATE SKIP LOCKED
     )
    RETURNING q.*
  )
  SELECT c.id, c.tenant_id, c.user_id, c.channel, c.signal, c.payload, c.attempts,
         CASE WHEN c.channel = 'email' THEN u.email::text END,
         CASE WHEN pr.prefs->>'locale' = 'en' THEN 'en' ELSE 'pl' END,
         NULLIF(btrim(pr.display_name), ''),
         w.id,
         CASE WHEN w.enabled THEN w.url END,
         w.format,
         CASE WHEN w.enabled THEN w.secret END
    FROM claimed c
    LEFT JOIN auth.users u ON u.id = c.user_id
    LEFT JOIN public.profiles pr ON pr.id = c.user_id AND pr.tenant_id = c.tenant_id
    LEFT JOIN public.notification_webhooks w
           ON w.id = c.webhook_id AND w.user_id = c.user_id AND w.tenant_id = c.tenant_id;
$function$;

CREATE OR REPLACE FUNCTION public.report_notification_signal_jobs(p_reports jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_channel text;
  v_webhook uuid;
  v_count integer := 0;
BEGIN
  IF p_reports IS NULL OR jsonb_typeof(p_reports) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_reports)
      AS x(id bigint, outcome text, status integer, error text)
  LOOP
    IF r.id IS NULL OR r.outcome IS NULL OR r.outcome NOT IN ('sent', 'retry', 'dead', 'gone') THEN
      CONTINUE;
    END IF;

    UPDATE public.notification_signal_jobs j
       SET status = CASE
                      WHEN r.outcome = 'sent' THEN 'sent'
                      WHEN r.outcome IN ('dead', 'gone') THEN 'dead'
                      WHEN j.attempts >= 6 THEN 'dead'
                      ELSE 'pending'
                    END,
           sent_at = CASE WHEN r.outcome = 'sent' THEN now() ELSE j.sent_at END,
           last_error = CASE WHEN r.outcome = 'sent' THEN NULL ELSE left(r.error, 300) END
     WHERE j.id = r.id AND j.status = 'pending'
    RETURNING j.channel, j.webhook_id INTO v_channel, v_webhook;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    v_count := v_count + 1;

    IF v_channel = 'webhook' AND v_webhook IS NOT NULL THEN
      UPDATE public.notification_webhooks w
         SET last_delivery_at = now(),
             last_status = r.status,
             consecutive_failures = CASE WHEN r.outcome = 'sent' THEN 0 ELSE w.consecutive_failures + 1 END,
             enabled = CASE
                         WHEN r.outcome = 'gone' THEN false
                         WHEN r.outcome <> 'sent' AND w.consecutive_failures + 1 >= 10 THEN false
                         ELSE w.enabled
                       END,
             disabled_reason = CASE
                                 WHEN r.outcome = 'gone' THEN 'gone'
                                 WHEN r.outcome <> 'sent' AND w.consecutive_failures + 1 >= 10 THEN 'failures'
                                 ELSE w.disabled_reason
                               END
       WHERE w.id = v_webhook;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_notification_signal_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_notification_signal_jobs(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_signal_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_notification_signal_jobs(jsonb) TO service_role;

COMMENT ON TABLE public.notification_webhooks IS
  'Osobisty webhook sygnalow (@wzmianka, prosba o zdanie): jeden na konto w najemcy, podpis HMAC, sekret tylko przy utworzeniu/rotacji. Dostep wylacznie przez RPC notification_webhook_*.';
COMMENT ON TABLE public.notification_signal_jobs IS
  'Kolejka kanalow sygnalu (e-mail, webhook). Producent: enqueue_signal_notification; konsument: claim/report_notification_signal_jobs (service_role).';
