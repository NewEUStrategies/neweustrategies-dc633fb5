ALTER TYPE public.post_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE public.post_status ADD VALUE IF NOT EXISTS 'scheduled';