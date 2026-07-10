-- Enable realtime for notification_preferences so widget preference toggles
-- (group_by_conversation, enabled_*) propagate across tabs and to widgets in
-- the same session without a manual refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notification_preferences'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_preferences';
  END IF;
END$$;

ALTER TABLE public.notification_preferences REPLICA IDENTITY FULL;

-- Batch helpers: mark many notification ids as read / unread in a single call.
-- Used by the notification center's "mark whole conversation" quick actions.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.notifications
    SET read_at = now()
  WHERE id = ANY(p_ids)
    AND user_id = auth.uid()
    AND read_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END$$;

CREATE OR REPLACE FUNCTION public.mark_notifications_unread(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.notifications
    SET read_at = NULL
  WHERE id = ANY(p_ids)
    AND user_id = auth.uid()
    AND read_at IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END$$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifications_unread(uuid[]) TO authenticated;
