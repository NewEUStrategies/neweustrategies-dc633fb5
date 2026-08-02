-- 1) speaker_profiles: brak bezpośredniego dostępu z klienta (crm_lead_id nigdy nie trafia do API).
REVOKE ALL ON public.speaker_profiles FROM anon, authenticated;
REVOKE ALL (crm_lead_id) ON public.speaker_profiles FROM anon, authenticated;
GRANT ALL ON public.speaker_profiles TO service_role;

-- 2) profile_view_events: zapisy tylko przez SECURITY DEFINER record_profile_view().
REVOKE ALL ON public.profile_view_events FROM anon, authenticated;
GRANT ALL ON public.profile_view_events TO service_role;

-- 3) poll_votes: odczyt własnych głosów, zapis wyłącznie przez vote_poll().
REVOKE INSERT, UPDATE, DELETE ON public.poll_votes FROM anon, authenticated;
GRANT SELECT ON public.poll_votes TO authenticated;
GRANT ALL ON public.poll_votes TO service_role;