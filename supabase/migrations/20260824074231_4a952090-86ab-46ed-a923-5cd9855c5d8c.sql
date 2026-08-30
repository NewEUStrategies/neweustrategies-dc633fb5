-- ZLEPEK SZESCIU NIEPOWIAZANYCH MODULOW w jednym pliku - tak oddaje je panel
-- Lovable. W jednym `20260824074231` siedza obok siebie:
--   * funkcje rol (`is_super_admin`, `is_admin_or_editor`, `has_role`),
--   * careers (`career_applications`, `career_application_events`),
--   * webhooki CRM (`crm_webhook_endpoints`),
--   * integracje (`integration_endpoints`, `integration_deliveries`),
--   * workflow (`workflow_definitions`, `workflow_runs`, `workflow_templates`),
--   * formularz kontaktowy (`contact_messages`).
-- Razem 24 zdania DDL.
--
-- TEN PLIK NIESIE ZAOSTRZENIE, PO KTORE POWSTAL: polityki `career_*_staff_*`
-- przechodza z `is_staff()` na `is_admin_or_editor()`, czyli rola `author`
-- przestaje widziec procesy rekrutacyjne, dziennik etapow i bucket `career-cv`.
-- Sprawdza to sekcja 15. w `scripts/careers-harness/runtime_test.sql`.
--
-- HISTORIA POMINIECIA - I DLACZEGO GO TU JUZ NIE MA. Plik nosil znacznik
-- pomijajacy go w harnessie careers: selektor dobiera migracje PO TRESCI
-- (`public.career_`), wiec wzmianka o `career_applications` wciagala tu caly
-- zlepek, a REPLAY przewracal sie na pierwszym obiekcie spoza modulu (najpierw
-- `user_roles.tenant_id`, potem `public.crm_webhook_endpoints`).
-- Odpowiedzia byly ATRAPY-CELE POLITYK w `scripts/careers-harness/harness.sql`:
-- szesc tabel stojacych tam WYLACZNIE po to, zeby ten plik mial na czym wykonac
-- swoje `CREATE POLICY`. Harness nic o nich nie twierdzi i pilnuje tego straznik
-- w `run.sh`, ktory oblewa, gdy `runtime_test.sql` siegnie po atrape.
--
-- Atrapy dopisano, ale znacznika nie zdjeto - i tak powstala sprzecznosc, ktorej
-- zadna kolejnosc uruchomien nie rozwiazuje: harness POMIJAL migracje niosaca
-- zaostrzenie, a zaraz potem ASERTOWAL to zaostrzenie. Bramka nie miala jak
-- przejsc i nie przechodzila. Zdjecie znacznika daje dokladnie to, o co prosi
-- komentarz w `run.sh`: bez atrap bramka „cicho przestaje pilnowac zaostrzenia,
-- po ktore ta migracja powstala". Zestaw wykonuje sie teraz w calosci -
-- 12 migracji, zero pominietych.
--
-- UWAGA DLA PRZYSZLYCH EDYCJI: znacznika pomijania NIE WOLNO cytowac w tym
-- komentarzu doslownie. Selektor szuka go w CALEJ tresci pliku, wiec sama
-- wzmianka w prozie pomija migracje tak samo skutecznie, jak dyrektywa
-- w pierwszej linii. Oba harnessy dopasowuja go teraz do POCZATKU LINII
-- (`scripts/careers-harness/run.sh` i `scripts/pg-harness/run.sh`), wiec proza
-- juz nie pomija - ale cytowanie dyrektywy nadal myli czytelnika.
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