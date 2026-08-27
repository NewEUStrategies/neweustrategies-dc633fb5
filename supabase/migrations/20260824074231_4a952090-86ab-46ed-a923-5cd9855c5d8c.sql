-- careers-harness: exclude
--
-- DLACZEGO TA MIGRACJA JEST POMINIETA W HARNESSIE CAREERS (a NIE w pg-harness,
-- gdzie przechodzi):
--
-- To ZLEPEK szesciu niepowiazanych modulow w jednym pliku - tak oddaje je panel
-- Lovable. W jednym `20260824074231` siedza obok siebie:
--   * funkcje rol (`is_super_admin`, `is_admin_or_editor`, `has_role`),
--   * careers (`career_applications`, `career_application_events`),
--   * webhooki CRM (`crm_webhook_endpoints`),
--   * integracje (`integration_endpoints`, `integration_deliveries`),
--   * workflow (`workflow_definitions`, `workflow_runs`, `workflow_templates`),
--   * formularz kontaktowy (`contact_messages`).
-- Razem 24 zdania DDL.
--
-- Selektor harnessu careers dobiera pliki PO TRESCI (`public.career_`), wiec
-- wzmianka o `career_applications` wciaga tu caly zlepek. REPLAY przewraca sie
-- wtedy na pierwszym obiekcie z modulu, ktorego ten harness CELOWO nie modeluje
-- (jego wlasny komentarz mowi to wprost) - najpierw na `user_roles.tenant_id`,
-- a po uzupelnieniu atrapy na `public.crm_webhook_endpoints`, i tak dalej przez
-- szesc tabel.
--
-- ATRAPOWANIE ICH PO KOLEI NIE JEST NAPRAWA. Kazda atrapa to zdanie o kształcie
-- obcej tabeli, ktorego w tym harnessie nikt nie weryfikuje, a bramka careers
-- przestaje mowic o module careers. Pominiecie jest wiec JAWNE i widoczne
-- w logu (`SKIP ... znacznik careers-harness: exclude`), ze straznikiem, ktory
-- nie pozwoli pominac calego zestawu.
--
-- CZEGO TO NIE ZWALNIA: careersowa czesc tego zlepka jest pokryta z drugiej
-- strony - `pgtap` przechodzi na tej migracji, a same tabele `career_*` zakladaja
-- i bramkuja migracje, ktore w tym harnessie ZOSTAJA (m.in.
-- 20260814100000_careers_tenant_scope.sql i
-- 20260814194500_career_cv_policies_tenant_scope_reassert.sql).
--
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles
     WHERE user_id = _user_id
       AND role = 'super_admin'::public.app_role
       AND tenant_id = public.current_tenant_id()
  )
$$;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin_or_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'editor')
$$;

REVOKE ALL ON FUNCTION public.is_admin_or_editor() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin_or_editor() TO authenticated, service_role;

DROP POLICY IF EXISTS crm_webhook_endpoints_staff_all ON public.crm_webhook_endpoints;
CREATE POLICY crm_webhook_endpoints_staff_all
  ON public.crm_webhook_endpoints FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_editor())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_editor());

DROP POLICY IF EXISTS integration_endpoints_staff_all ON public.integration_endpoints;
CREATE POLICY integration_endpoints_staff_all
  ON public.integration_endpoints FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_editor())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_editor());

DROP POLICY IF EXISTS integration_deliveries_staff_select ON public.integration_deliveries;
CREATE POLICY integration_deliveries_staff_select
  ON public.integration_deliveries FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_editor());

DROP POLICY IF EXISTS career_applications_staff_read ON public.career_applications;
CREATE POLICY career_applications_staff_read ON public.career_applications
  FOR SELECT TO authenticated
  USING (public.is_admin_or_editor() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_applications_staff_update ON public.career_applications;
CREATE POLICY career_applications_staff_update ON public.career_applications
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_editor() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_admin_or_editor() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_application_events_staff_read ON public.career_application_events;
CREATE POLICY career_application_events_staff_read ON public.career_application_events
  FOR SELECT TO authenticated
  USING (public.is_admin_or_editor() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "career_cv_staff_read" ON storage.objects;
CREATE POLICY "career_cv_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_admin_or_editor()
  AND (
    (storage.foldername(name))[1] = public.current_tenant_id()::text
    OR EXISTS (
      SELECT 1
        FROM public.contact_messages m
       WHERE m.tenant_id = public.current_tenant_id()
         AND m.custom ->> 'cv_path' = storage.objects.name
    )
  )
);

DROP POLICY IF EXISTS "career_cv_staff_delete" ON storage.objects;
CREATE POLICY "career_cv_staff_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_admin_or_editor()
  AND (
    (storage.foldername(name))[1] = public.current_tenant_id()::text
    OR EXISTS (
      SELECT 1
        FROM public.contact_messages m
       WHERE m.tenant_id = public.current_tenant_id()
         AND m.custom ->> 'cv_path' = storage.objects.name
    )
  )
);

DROP POLICY IF EXISTS workflow_definitions_staff_all ON public.workflow_definitions;
CREATE POLICY workflow_definitions_staff_all
  ON public.workflow_definitions FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_editor())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_editor());

DROP POLICY IF EXISTS workflow_runs_staff_select ON public.workflow_runs;
CREATE POLICY workflow_runs_staff_select
  ON public.workflow_runs FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_editor());

DROP POLICY IF EXISTS workflow_templates_staff_select ON public.workflow_templates;
CREATE POLICY workflow_templates_staff_select
  ON public.workflow_templates FOR SELECT TO authenticated
  USING (public.is_admin_or_editor());