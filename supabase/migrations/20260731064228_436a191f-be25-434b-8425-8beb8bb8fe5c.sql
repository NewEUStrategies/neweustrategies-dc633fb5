-- 1) speaker_profiles: publiczna projekcja tylko przez SECURITY DEFINER RPC
--    (get_public_speakers), ktore nie zwraca crm_lead_id.
DROP POLICY IF EXISTS "speaker_profiles public read" ON public.speaker_profiles;

REVOKE ALL ON TABLE public.speaker_profiles FROM anon;
REVOKE ALL ON TABLE public.speaker_profiles FROM authenticated;
GRANT ALL ON TABLE public.speaker_profiles TO service_role;

COMMENT ON COLUMN public.speaker_profiles.crm_lead_id IS
  'Internal CRM correlation id - never exposed to anon/authenticated; public reads go through public.get_public_speakers().';

-- 2) poll_votes: brak bezposrednich zapisow z klienta (glosowanie przez RPC).
REVOKE ALL ON TABLE public.poll_votes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.poll_votes FROM authenticated;
GRANT SELECT ON TABLE public.poll_votes TO authenticated;
GRANT ALL ON TABLE public.poll_votes TO service_role;

COMMENT ON TABLE public.poll_votes IS
  'Votes are written only by SECURITY DEFINER RPCs (n_poll); clients have SELECT-only access limited to their own rows by RLS.';