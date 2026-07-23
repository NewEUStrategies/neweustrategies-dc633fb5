
-- Unique pair index (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS user_connections_pair_uidx
  ON public.user_connections (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

CREATE OR REPLACE FUNCTION public.auto_connect_experts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT LEAST(a.user_id, b.user_id) AS u1,
           GREATEST(a.user_id, b.user_id) AS u2,
           pa.tenant_id AS tenant_id
    FROM (SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('author','admin','super_admin')) a
    JOIN (SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('author','admin','super_admin')) b
      ON a.user_id < b.user_id
    JOIN public.profiles pa ON pa.id = a.user_id
    JOIN public.profiles pb ON pb.id = b.user_id AND pb.tenant_id = pa.tenant_id
    WHERE pa.tenant_id IS NOT NULL
  LOOP
    BEGIN
      INSERT INTO public.user_connections (requester_id, addressee_id, status)
      VALUES (r.u1, r.u2, 'pending');
      UPDATE public.user_connections
        SET status = 'accepted', responded_at = now()
        WHERE requester_id = r.u1 AND addressee_id = r.u2 AND status = 'pending';
      n := n + 1;
    EXCEPTION WHEN unique_violation THEN
      -- pair already connected; if pending, accept it
      UPDATE public.user_connections
        SET status = 'accepted', responded_at = now()
        WHERE ((requester_id = r.u1 AND addressee_id = r.u2)
            OR (requester_id = r.u2 AND addressee_id = r.u1))
          AND status = 'pending';
    END;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_expert_role_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_tenant uuid;
  other record;
  u1 uuid;
  u2 uuid;
BEGIN
  IF NEW.role NOT IN ('author','admin','super_admin') THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO new_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF new_tenant IS NULL THEN
    RETURN NEW;
  END IF;

  FOR other IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.tenant_id = new_tenant
    WHERE ur.role IN ('author','admin','super_admin')
      AND ur.user_id <> NEW.user_id
  LOOP
    u1 := LEAST(NEW.user_id, other.user_id);
    u2 := GREATEST(NEW.user_id, other.user_id);
    BEGIN
      INSERT INTO public.user_connections (requester_id, addressee_id, status)
      VALUES (u1, u2, 'pending');
      UPDATE public.user_connections
        SET status = 'accepted', responded_at = now()
        WHERE requester_id = u1 AND addressee_id = u2 AND status = 'pending';
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.user_connections
        SET status = 'accepted', responded_at = now()
        WHERE ((requester_id = u1 AND addressee_id = u2)
            OR (requester_id = u2 AND addressee_id = u1))
          AND status = 'pending';
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_expert_role_added ON public.user_roles;
CREATE TRIGGER trg_on_expert_role_added
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.on_expert_role_added();

SELECT public.auto_connect_experts();
