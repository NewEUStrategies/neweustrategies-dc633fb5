
-- =========================================================
-- Form field policies: per-tenant "required / optional / active"
-- rules used by server functions to verify submissions and by
-- widgets as a source of truth for what to render as mandatory.
-- =========================================================
CREATE TABLE IF NOT EXISTS public.form_field_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_type text NOT NULL CHECK (form_type IN ('contact_form','join_us','newsletter')),
  field_key text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  active   boolean NOT NULL DEFAULT true,
  min_length int,
  max_length int,
  pattern text,
  notes   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, form_type, field_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_field_policies TO authenticated;
GRANT ALL ON public.form_field_policies TO service_role;

ALTER TABLE public.form_field_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read form field policies"
  ON public.form_field_policies FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
    )
  );

CREATE POLICY "Admins can manage form field policies"
  ON public.form_field_policies FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE INDEX IF NOT EXISTS form_field_policies_tenant_form_idx
  ON public.form_field_policies (tenant_id, form_type)
  WHERE active;

CREATE OR REPLACE FUNCTION public.form_field_policies_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_form_field_policies_touch ON public.form_field_policies;
CREATE TRIGGER trg_form_field_policies_touch
  BEFORE UPDATE ON public.form_field_policies
  FOR EACH ROW EXECUTE FUNCTION public.form_field_policies_touch();

-- ---------------------------------------------------------
-- Helper: enforce policies against a submitted payload.
-- Returns text[] of violation codes (empty when payload OK).
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_form_field_policy(
  _tenant uuid,
  _form_type text,
  _payload jsonb
)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_errors text[] := ARRAY[]::text[];
  r record;
  v_val text;
  v_len int;
BEGIN
  IF _tenant IS NULL OR _form_type IS NULL OR _payload IS NULL THEN
    RETURN v_errors;
  END IF;

  FOR r IN
    SELECT field_key, required, min_length, max_length, pattern
      FROM public.form_field_policies
     WHERE tenant_id = _tenant
       AND form_type = _form_type
       AND active = true
  LOOP
    v_val := NULLIF(btrim(COALESCE(_payload ->> r.field_key, '')), '');
    v_len := COALESCE(length(v_val), 0);

    IF r.required AND v_val IS NULL THEN
      v_errors := v_errors || ('required:' || r.field_key);
      CONTINUE;
    END IF;

    IF v_val IS NOT NULL THEN
      IF r.min_length IS NOT NULL AND v_len < r.min_length THEN
        v_errors := v_errors || ('min_length:' || r.field_key);
      END IF;
      IF r.max_length IS NOT NULL AND v_len > r.max_length THEN
        v_errors := v_errors || ('max_length:' || r.field_key);
      END IF;
      IF r.pattern IS NOT NULL AND v_val !~ r.pattern THEN
        v_errors := v_errors || ('pattern:' || r.field_key);
      END IF;
    END IF;
  END LOOP;

  RETURN v_errors;
END $$;

GRANT EXECUTE ON FUNCTION public.enforce_form_field_policy(uuid, text, jsonb) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.is_form_field_active(
  _tenant uuid,
  _form_type text,
  _field text
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT active FROM public.form_field_policies
      WHERE tenant_id = _tenant AND form_type = _form_type AND field_key = _field
      LIMIT 1),
    true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_form_field_active(uuid, text, text) TO authenticated, anon, service_role;

-- ---------------------------------------------------------
-- Seed sane defaults for every existing tenant.
-- ---------------------------------------------------------
INSERT INTO public.form_field_policies (tenant_id, form_type, field_key, required, active, max_length)
SELECT t.id, x.form_type, x.field_key, x.required, true, x.max_length
FROM public.tenants t
CROSS JOIN (VALUES
  -- contact_form
  ('contact_form','firstName', false, 100),
  ('contact_form','lastName',  false, 100),
  ('contact_form','email',     true,  320),
  ('contact_form','phone',     false, 40),
  ('contact_form','company',   false, 200),
  ('contact_form','subject',   false, 300),
  ('contact_form','message',   true,  8000),
  ('contact_form','consent',   true,  NULL),
  -- join_us
  ('join_us','firstName', false, 100),
  ('join_us','lastName',  false, 100),
  ('join_us','email',     true,  320),
  ('join_us','position',  false, 200),
  ('join_us','linkedin',  false, 300),
  ('join_us','phone',     false, 40),
  ('join_us','company',   false, 200),
  ('join_us','country',   false, 100),
  -- newsletter (raw signup)
  ('newsletter','email',     true, 320),
  ('newsletter','firstName', false, 100),
  ('newsletter','lastName',  false, 100)
) AS x(form_type, field_key, required, max_length)
ON CONFLICT (tenant_id, form_type, field_key) DO NOTHING;
