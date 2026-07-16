-- Reconcile conflicting comment BEFORE UPDATE triggers.
-- The older `comments_owner_edit` (5-min edit window, rejects any status change
-- including soft-delete) collides with the canonical `comments_guard_update`
-- (15-min window, allows author status='deleted' soft-delete). Drop the older
-- one and its function so the 15-min policy and soft-delete work.

DROP TRIGGER IF EXISTS comments_owner_edit ON public.comments;
DROP FUNCTION IF EXISTS public.tg_comments_owner_edit();

-- Re-assert canonical trigger (idempotent) in case ordering ever regressed.
DROP TRIGGER IF EXISTS comments_guard_update_trg ON public.comments;
CREATE TRIGGER comments_guard_update_trg
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_guard_update();