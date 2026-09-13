ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.auth_email_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.email_send_log.tenant_id IS
  'Najemca, do ktorego nalezy wpis dziennika. NULL = wiersz historyczny, ktorego nie dalo sie jednoznacznie przypisac - swiadomie niewidoczny dla rol klienckich.';
COMMENT ON COLUMN public.auth_email_events.tenant_id IS
  'Najemca zdarzenia webhooka auth. NULL = zdarzenie sprzed migracji albo bez dopasowania po message_id.';

UPDATE public.email_send_log AS l
   SET tenant_id = s.tid
  FROM (
    SELECT lower(btrim(email)) AS e, (array_agg(DISTINCT tenant_id))[1] AS tid
      FROM public.newsletter_subscribers
     GROUP BY 1
    HAVING count(DISTINCT tenant_id) = 1
  ) AS s
 WHERE l.tenant_id IS NULL
   AND lower(btrim(l.recipient_email)) = s.e;

UPDATE public.email_send_log AS l
   SET tenant_id = p.tid
  FROM (
    SELECT lower(btrim(email)) AS e, (array_agg(DISTINCT tenant_id))[1] AS tid
      FROM public.profiles
     WHERE email IS NOT NULL AND tenant_id IS NOT NULL
     GROUP BY 1
    HAVING count(DISTINCT tenant_id) = 1
  ) AS p
 WHERE l.tenant_id IS NULL
   AND lower(btrim(l.recipient_email)) = p.e;

UPDATE public.auth_email_events AS e
   SET tenant_id = l.tenant_id
  FROM public.email_send_log AS l
 WHERE e.message_id = l.message_id
   AND l.tenant_id IS NOT NULL
   AND e.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS email_send_log_tenant_created_idx
  ON public.email_send_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_email_events_tenant_created_idx
  ON public.auth_email_events (tenant_id, created_at DESC);

REVOKE ALL ON public.email_send_log FROM PUBLIC, anon;
REVOKE ALL ON public.auth_email_events FROM PUBLIC, anon;
GRANT SELECT ON public.email_send_log TO authenticated;
GRANT SELECT ON public.auth_email_events TO authenticated;

DROP POLICY IF EXISTS email_send_log_admin_select ON public.email_send_log;
CREATE POLICY email_send_log_admin_select
  ON public.email_send_log FOR SELECT TO authenticated
  USING (
    tenant_id = (select public.current_tenant_id())
    AND (
      (select public.has_role(auth.uid(), 'admin'::public.app_role))
      OR (select public.is_super_admin())
    )
  );

DROP POLICY IF EXISTS auth_email_events_admin_select ON public.auth_email_events;
CREATE POLICY auth_email_events_admin_select
  ON public.auth_email_events FOR SELECT TO authenticated
  USING (
    tenant_id = (select public.current_tenant_id())
    AND (
      (select public.has_role(auth.uid(), 'admin'::public.app_role))
      OR (select public.is_super_admin())
    )
  );