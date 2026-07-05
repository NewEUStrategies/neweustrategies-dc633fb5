
-- Enable realtime for CRM tables (used by admin CRM panel)
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_consent_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.newsletter_subscribers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_lead_notes;

-- Full row payload on UPDATE for accurate detail-view refresh
ALTER TABLE public.crm_leads REPLICA IDENTITY FULL;
ALTER TABLE public.crm_consent_log REPLICA IDENTITY FULL;
ALTER TABLE public.contact_messages REPLICA IDENTITY FULL;
ALTER TABLE public.newsletter_subscribers REPLICA IDENTITY FULL;
ALTER TABLE public.crm_lead_notes REPLICA IDENTITY FULL;
