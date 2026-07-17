ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS chat_bell_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.chat_bell_enabled IS
  'Toggles the chat bell icon in the site header for the caller within their tenant. When false, ChatBell is hidden but conversations still work.';