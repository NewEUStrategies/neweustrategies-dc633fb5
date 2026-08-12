DO $$
DECLARE
  v_signature text;
  v_signatures text[] := ARRAY[
    'public.club_anonymity_salt(uuid)',
    'public.admin_club_invite_link_create(uuid, text, text, integer, timestamptz, boolean, uuid)',
    'public.newsletter_subscribers_ensure_unsub_token()',
    'public.admin_club_thread_create(uuid, text, text, uuid, text, boolean, text)',
    'public.club_create_thread(uuid, text, text, text, boolean, text, text, text, boolean, text, text, text)',
    'public.admin_club_poll_create(uuid, text, text, text, text, jsonb, timestamptz, uuid)',
    'public.guess_gender_from_name(text)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE NOTICE 'search_path fix: brak funkcji % - pomijam', v_signature;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', v_signature);
  END LOOP;
END $$;

INSERT INTO public.club_anonymity_salts (tenant_id, salt)
SELECT DISTINCT c.tenant_id, encode(extensions.gen_random_bytes(32), 'hex')
  FROM public.clubs c
 WHERE NOT EXISTS (
   SELECT 1 FROM public.club_anonymity_salts s WHERE s.tenant_id = c.tenant_id
 )
ON CONFLICT (tenant_id) DO NOTHING;

COMMENT ON FUNCTION public.club_anonymity_salt(uuid) IS
  'Sekret solacy pseudonimy Chatham House, jeden na tenanta. RPC-only i bez grantow - wyciek tej wartosci odwraca anonimowosc calego archiwum. search_path zawiera `extensions`, bo leniwe zasianie soli wola gen_random_bytes() (pgcrypto).';