DROP FUNCTION IF EXISTS public.has_content_access(uuid, access_entity_type, uuid);

CREATE OR REPLACE FUNCTION public.has_content_access(
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode access_mode;
  v_plans uuid[];
  v_uid uuid := auth.uid();
BEGIN
  SELECT mode, plan_ids INTO v_mode, v_plans
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF v_mode = 'members' THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_purchases
     WHERE user_id = v_uid
       AND entity_type = _entity_type
       AND entity_id = _entity_id
       AND status = 'active'
  ) THEN
    RETURN true;
  END IF;

  IF array_length(v_plans, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_subscriptions
     WHERE user_id = v_uid
       AND plan_id = ANY (v_plans)
       AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.has_content_access(access_entity_type, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_content_access(access_entity_type, uuid) TO anon, authenticated;