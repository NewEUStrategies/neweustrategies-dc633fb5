
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_leads_source_type_check'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_source_type_check
      CHECK (source_type IN (
        'registered','paid_subscriber','event_participant',
        'speaker','expert','contact_form','newsletter','manual'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crm_leads_tenant_source_type_idx
  ON public.crm_leads (tenant_id, source_type);

UPDATE public.crm_leads l
   SET source_type = 'registered'
  FROM public.profiles p
 WHERE l.source_type = 'manual'
   AND lower(p.email) = l.email_norm
   AND p.tenant_id = l.tenant_id;

UPDATE public.crm_leads l
   SET source_type = 'paid_subscriber'
  FROM public.user_subscriptions s
  JOIN public.profiles p ON p.id = s.user_id
 WHERE lower(p.email) = l.email_norm
   AND p.tenant_id = l.tenant_id
   AND s.status = 'active';

UPDATE public.crm_leads l
   SET source_type = 'expert'
  FROM public.author_profiles a
  JOIN public.profiles p ON p.id = a.user_id
 WHERE lower(p.email) = l.email_norm
   AND a.tenant_id = l.tenant_id;

UPDATE public.crm_leads
   SET source_type = 'newsletter'
 WHERE source_type = 'manual'
   AND newsletter_status IS NOT NULL
   AND newsletter_status <> '';

CREATE OR REPLACE VIEW public.crm_funnel_view
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.tenant_id,
  s.email,
  lower(s.email)                                 AS email_norm,
  s.first_name,
  s.last_name,
  COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''),
    s.display_name,
    s.email
  )                                              AS display_name,
  s.language,
  s.source,
  s.status,
  s.confirmed_at,
  s.unsubscribed_at,
  s.consents,
  s.source_form_id,
  s.source_form_name,
  s.created_at,
  s.updated_at,
  s.user_id,
  p.id                                           AS profile_id,
  p.avatar_url                                   AS avatar_url,
  (p.id IS NOT NULL)                             AS is_registered,
  c.id                                           AS contact_id,
  (c.id IS NOT NULL)                             AS is_contact,
  c.stage                                        AS contact_stage,
  c.score                                        AS contact_score
FROM public.newsletter_subscribers s
LEFT JOIN public.profiles p
  ON p.tenant_id = s.tenant_id
 AND lower(p.email) = lower(s.email)
LEFT JOIN public.crm_leads c
  ON c.tenant_id = s.tenant_id
 AND c.email_norm = lower(s.email);

GRANT SELECT ON public.crm_funnel_view TO authenticated;
GRANT ALL   ON public.crm_funnel_view TO service_role;

COMMENT ON VIEW public.crm_funnel_view IS
  'Marketing funnel: newsletter subscribers enriched with flags is_registered/is_contact. Security-invoker respects underlying RLS on newsletter_subscribers.';
