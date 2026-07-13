-- Notifications reconciliation (drops parallel push/digest pipeline from step 1)

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name = 'ua'
  ) THEN
    UPDATE public.push_subscriptions SET user_agent = COALESCE(user_agent, ua);
    ALTER TABLE public.push_subscriptions DROP COLUMN ua;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name = 'disabled_at'
  ) THEN
    UPDATE public.push_subscriptions SET failed_at = COALESCE(failed_at, disabled_at);
    ALTER TABLE public.push_subscriptions DROP COLUMN disabled_at;
  END IF;
END $$;

DROP POLICY IF EXISTS push_subscriptions_own_select ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_own_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_own_update ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_own_delete ON public.push_subscriptions;

CREATE INDEX IF NOT EXISTS push_subscriptions_user_live_idx
  ON public.push_subscriptions (user_id) WHERE failed_at IS NULL;

DROP TRIGGER IF EXISTS notifications_enqueue_push_trg ON public.notifications;
DROP FUNCTION IF EXISTS public.notifications_enqueue_push();
DROP FUNCTION IF EXISTS public.claim_push_outbox(integer);
DROP TABLE IF EXISTS public.push_outbox;

DO $$
DECLARE v_has_job boolean;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''prune-push-outbox'')' INTO v_has_job;
  IF v_has_job THEN PERFORM cron.unschedule('prune-push-outbox'); END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'notification_preferences'
       AND column_name = 'email_digest_frequency'
  ) THEN
    UPDATE public.notification_preferences
       SET email_digest = email_digest_frequency
     WHERE email_digest = 'off' AND email_digest_frequency IN ('daily', 'weekly');
    ALTER TABLE public.notification_preferences DROP COLUMN email_digest_frequency;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'notification_preferences'
       AND column_name = 'email_digest_last_at'
  ) THEN
    ALTER TABLE public.notification_preferences DROP COLUMN email_digest_last_at;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.claim_due_digest_users(integer);

-- Chrome / community nav links

CREATE FUNCTION pg_temp.nes_fix_nav_hrefs(j jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_type text := jsonb_typeof(j);
  v_out jsonb;
  v_key text;
  v_val jsonb;
  v_idx integer;
  v_label text;
  v_href text;
  v_new text;
BEGIN
  IF v_type = 'object' THEN
    v_label := j ->> 'label_pl';
    v_href := COALESCE(j ->> 'href', '');
    IF v_label IS NOT NULL AND j ? 'href' AND v_href IN ('#', '') THEN
      v_new := CASE v_label
        WHEN 'Wydarzenia' THEN '/events'
        WHEN 'Tracker UE' THEN '/tracker'
        WHEN 'Tracker legislacyjny UE' THEN '/tracker'
        WHEN 'Sesje Q&A' THEN '/qa'
        WHEN 'Q&A' THEN '/qa'
        WHEN 'Ankiety' THEN '/polls'
        WHEN 'Katalog osób' THEN '/people'
        WHEN 'Zostań kontrybutorem' THEN '/contribute'
        ELSE NULL
      END;
      IF v_new IS NOT NULL THEN j := jsonb_set(j, '{href}', to_jsonb(v_new)); END IF;
    END IF;
    v_out := '{}'::jsonb;
    FOR v_key, v_val IN SELECT * FROM jsonb_each(j) LOOP
      v_out := v_out || jsonb_build_object(v_key, pg_temp.nes_fix_nav_hrefs(v_val));
    END LOOP;
    RETURN v_out;
  ELSIF v_type = 'array' THEN
    v_out := '[]'::jsonb;
    FOR v_idx IN 0 .. jsonb_array_length(j) - 1 LOOP
      v_out := v_out || jsonb_build_array(pg_temp.nes_fix_nav_hrefs(j -> v_idx));
    END LOOP;
    RETURN v_out;
  END IF;
  RETURN j;
END;
$$;

UPDATE public.site_settings ss
   SET value = pg_temp.nes_fix_nav_hrefs(ss.value),
       updated_at = now()
 WHERE ss.key IN ('header', 'footer', 'menu_primary')
   AND ss.value ? 'builder_data'
   AND pg_temp.nes_fix_nav_hrefs(ss.value) IS DISTINCT FROM ss.value;

UPDATE public.site_settings ss
   SET value = jsonb_set(
         ss.value,
         '{builder_data,sections}',
         (ss.value -> 'builder_data' -> 'sections') || jsonb_build_array(
           jsonb_build_object(
             'id', 'community-links-s0',
             'kind', 'section',
             'layout', jsonb_build_object('contentWidth', 'boxed', 'width', 1400, 'htmlTag', 'nav'),
             'children', jsonb_build_array(
               jsonb_build_object(
                 'id', 'community-links-s0-c0',
                 'kind', 'column',
                 'span', jsonb_build_object('desktop', 12),
                 'children', jsonb_build_array(
                   jsonb_build_object('id', 'community-links-s0-c0-w0', 'kind', 'widget', 'type', 'heading',
                     'content', jsonb_build_object('text_pl', 'Społeczność', 'text_en', 'Community', 'tag', 'h4')),
                   jsonb_build_object('id', 'community-links-s0-c0-w1', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Wydarzenia', 'label_en', 'Events', 'href', '/events', 'variant', 'text')),
                   jsonb_build_object('id', 'community-links-s0-c0-w2', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Sesje Q&A', 'label_en', 'Q&A sessions', 'href', '/qa', 'variant', 'text')),
                   jsonb_build_object('id', 'community-links-s0-c0-w3', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Ankiety', 'label_en', 'Polls', 'href', '/polls', 'variant', 'text')),
                   jsonb_build_object('id', 'community-links-s0-c0-w4', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Tracker legislacyjny UE', 'label_en', 'EU policy tracker', 'href', '/tracker', 'variant', 'text')),
                   jsonb_build_object('id', 'community-links-s0-c0-w5', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Katalog osób', 'label_en', 'People directory', 'href', '/people', 'variant', 'text')),
                   jsonb_build_object('id', 'community-links-s0-c0-w6', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Zostań kontrybutorem', 'label_en', 'Become a contributor', 'href', '/contribute', 'variant', 'text'))
                 )
               )
             )
           )
         ),
         false
       ),
       updated_at = now()
 WHERE ss.key = 'footer'
   AND jsonb_typeof(ss.value -> 'builder_data' -> 'sections') = 'array'
   AND ss.value::text NOT LIKE '%/events%';

DROP FUNCTION pg_temp.nes_fix_nav_hrefs(jsonb);
