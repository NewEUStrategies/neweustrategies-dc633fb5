-- 1. Dopuszczamy nowe źródło nadania: odznaka eksperta.
ALTER TABLE public.membership_grants DROP CONSTRAINT IF EXISTS membership_grants_source_check;
ALTER TABLE public.membership_grants
  ADD CONSTRAINT membership_grants_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'donation'::text, 'import'::text, 'expert'::text]));

-- Jedno nadanie „ekspert" na użytkownika i tenanta - idempotencja triggera.
CREATE UNIQUE INDEX IF NOT EXISTS membership_grants_expert_uniq
  ON public.membership_grants (tenant_id, user_id)
  WHERE source = 'expert';

-- 2. Nadanie/cofnięcie dożywotniego VIP-a na podstawie odznaki 'expert'.
CREATE OR REPLACE FUNCTION public.sync_expert_vip_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
    v_user := OLD.user_id;
    IF OLD.badge <> 'expert' THEN
      RETURN OLD;
    END IF;
    UPDATE public.membership_grants
       SET revoked_at = now(), updated_at = now()
     WHERE tenant_id = v_tenant
       AND user_id = v_user
       AND source = 'expert'
       AND revoked_at IS NULL;
    RETURN OLD;
  END IF;

  v_tenant := NEW.tenant_id;
  v_user := NEW.user_id;
  IF NEW.badge <> 'expert' THEN
    RETURN NEW;
  END IF;

  -- Poziom VIP musi istnieć i być aktywny w tym tenancie; inaczej nic nie robimy.
  IF NOT EXISTS (
    SELECT 1 FROM public.membership_tiers
     WHERE tenant_id = v_tenant AND key = 'vip' AND active
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.membership_grants
    (tenant_id, user_id, tier_key, source, note, starts_at, expires_at)
  VALUES
    (v_tenant, v_user, 'vip', 'expert', 'Ekspert New European Strategies - VIP dożywotnio', now(), NULL)
  ON CONFLICT (tenant_id, user_id) WHERE source = 'expert'
  DO UPDATE SET tier_key = 'vip', expires_at = NULL, revoked_at = NULL, updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_badges_expert_vip ON public.profile_badges;
CREATE TRIGGER trg_profile_badges_expert_vip
AFTER INSERT OR UPDATE OR DELETE ON public.profile_badges
FOR EACH ROW EXECUTE FUNCTION public.sync_expert_vip_grant();

-- 3. Uzupełnienie danych historycznych dla obecnych ekspertów.
INSERT INTO public.membership_grants
  (tenant_id, user_id, tier_key, source, note, starts_at, expires_at)
SELECT pb.tenant_id, pb.user_id, 'vip', 'expert',
       'Ekspert New European Strategies - VIP dożywotnio', now(), NULL
  FROM public.profile_badges pb
 WHERE pb.badge = 'expert'
   AND EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = pb.tenant_id AND mt.key = 'vip' AND mt.active
   )
ON CONFLICT (tenant_id, user_id) WHERE source = 'expert'
DO UPDATE SET tier_key = 'vip', expires_at = NULL, revoked_at = NULL, updated_at = now();