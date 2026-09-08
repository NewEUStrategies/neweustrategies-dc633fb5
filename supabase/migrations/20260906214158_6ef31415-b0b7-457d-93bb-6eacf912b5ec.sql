ALTER TABLE public.user_invitations
  ADD COLUMN IF NOT EXISTS send_count integer NOT NULL DEFAULT 0;

UPDATE public.user_invitations
SET send_count = 1
WHERE sent_at IS NOT NULL
  AND send_count = 0;

ALTER TABLE public.user_invitations
  DROP CONSTRAINT IF EXISTS user_invitations_send_count_range;

ALTER TABLE public.user_invitations
  ADD CONSTRAINT user_invitations_send_count_range
  CHECK (send_count >= 0 AND send_count <= 5);
