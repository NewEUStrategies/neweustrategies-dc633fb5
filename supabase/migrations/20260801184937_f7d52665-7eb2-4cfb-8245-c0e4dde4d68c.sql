UPDATE public.access_plans
SET trial_days = 7, updated_at = now()
WHERE active = true
  AND interval <> 'one_time'
  AND trial_days = 0;