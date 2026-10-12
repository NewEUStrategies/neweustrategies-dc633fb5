-- ============================================================================
-- SZCZEGOLY PRELEGENTA NA ZADANIE: FUNKCJA WRACA DO PASA SUPABASE.
--
-- DEFEKT. `public.event_speaker_detail(uuid, uuid, boolean)` ma definicje
-- WYLACZNIE w pasie drizzle (`drizzle/migrations/0150_event_speaker_detail_
-- safe_projection.sql`), a wola ja klient: `speakerDetailQueryOptions`
-- (src/lib/events/speakerDetail.ts) przy otwarciu okna prelegenta, na stronie
-- publicznej i w podgladzie studia. Pas supabase zasila kazda bramke
-- `check:*` i baze pgTAP, wiec w KAZDYM srodowisku odtworzonym z
-- `supabase/migrations` (CI, staging, nowa baza) funkcji nie ma: PostgREST
-- odpowiada PGRST202, okno prelegenta nie dostaje biogramu, linkow ani
-- kontaktu. Czerwone sa przez to `check:rpc-contract` i job `pgtap`
-- (supabase/tests/event_speaker_detail_test.sql).
--
-- ZMIANA. Ta sama funkcja co w 0150: sygnatura, cialo, STABLE SECURITY
-- DEFINER, search_path, REVOKE/GRANT. Najemca wylacznie z sesji - nigdy
-- z ladunku: strona publiczna bierze `public_tenant_id()` (plaszczyzna tresci
-- hosta) i tylko opublikowane wydarzenie, podglad studia wymaga admina tego
-- samego najemcy (`assert_event_admin_tenant()`). Nakladka musi byc publiczna
-- (`sp.is_public`) i przypieta do wydarzenia (rejestr `event_speaker_entries`
-- albo legacy `event_speakers`). Widocznosc kontaktu liczy SQL, takze
-- w podgladzie: e-mail i telefon z kartoteki osoby wychodza tylko przy
-- `event_people.email_visible` / `phone_visible`, linki autora tylko
-- z publicznej projekcji `author_profiles_public` - nigdy surowy kontakt
-- z panelu.
--
-- JEDNA ROZNICA WOBEC 0150. Galaz ELSE e-maila czytala `ap.contact_email`.
-- Widok `author_profiles_public` w pasie supabase NIE MA tej kolumny - usunela
-- ja celowo 20260730120000 (kontakt autora czyta tylko wlasciciel, admin
-- najemcy i service_role), a pilnuje tego supabase/tests/author_contact_
-- privacy_test.sql. Cialo plpgsql nie jest walidowane przy CREATE FUNCTION,
-- wiec kopia 1:1 przeszlaby `check:*` i event_speaker_detail_test.sql, ale
-- KAZDE wywolanie konczyloby sie 42703 "column ap.contact_email does not
-- exist" (sprawdzone na bazie odtworzonej z migracji), a w CI oblalaby
-- plpgsql_check_gate_test.sql. Przywrocenie kolumny w widoku otworzyloby z powrotem
-- wyciek PII autora. Dlatego e-mail autora (prelegent z kontem) nie wychodzi:
-- galaz ELSE oddaje NULL. Baza, na ktorej widok wciaz niesie `contact_email`
-- (dryf 20260730072101 - typy z produkcji go pokazuja), traci po tej migracji
-- e-mail autora w oknie prelegenta; to zgodne z granica z 20260730120000.
--
-- GRANTY. Klient wola RPC przez przegladarke (anon na stronie publicznej,
-- authenticated w podgladzie), backend przez service_role - jak w 0150.
--
-- IDEMPOTENTNA: CREATE OR REPLACE, REVOKE/GRANT, COMMENT.
-- DOWOD: supabase/tests/event_speaker_detail_test.sql, plpgsql_check_gate_test.sql,
-- check:rpc-contract.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.event_speaker_detail(p_event_id uuid, p_speaker_profile_id uuid, p_preview boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_tenant uuid; v_result jsonb;
BEGIN
  IF p_preview THEN
    v_tenant := public.assert_event_admin_tenant();
  ELSE
    v_tenant := public.public_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'bio_pl', COALESCE(NULLIF(btrim(sp.bio_pl), ''), NULLIF(btrim(pe.bio_pl), ''), ap.bio_pl),
    'bio_en', COALESCE(NULLIF(btrim(sp.bio_en), ''), NULLIF(btrim(pe.bio_en), ''), ap.bio_en),
    'social_links', jsonb_strip_nulls(COALESCE(pe.social_links, '{}'::jsonb) || jsonb_build_object(
      'linkedin', COALESCE(NULLIF(ap.linkedin_url, ''), pe.social_links->>'linkedin'),
      'x', COALESCE(NULLIF(ap.x_url, ''), pe.social_links->>'x'),
      'facebook', COALESCE(NULLIF(ap.facebook_url, ''), pe.social_links->>'facebook'),
      'instagram', COALESCE(NULLIF(ap.instagram_url, ''), pe.social_links->>'instagram'),
      'website', COALESCE(NULLIF(ap.website_url, ''), pe.social_links->>'website', NULLIF(pe.social_profile_url, ''))
    )),
    'email', CASE WHEN pe.email_visible THEN NULLIF(btrim(pe.email), '') ELSE NULL END,
    'phone', CASE WHEN pe.phone_visible THEN NULLIF(btrim(pe.phone), '') ELSE NULL END
  ) INTO v_result
  FROM public.speaker_profiles sp
  JOIN public.events e ON e.id = p_event_id AND e.tenant_id = sp.tenant_id
  LEFT JOIN public.event_people pe ON pe.id = sp.person_id AND pe.tenant_id = sp.tenant_id
  LEFT JOIN public.author_profiles_public ap ON ap.user_id = sp.user_id AND ap.tenant_id = sp.tenant_id
  WHERE sp.id = p_speaker_profile_id AND sp.tenant_id = v_tenant AND sp.is_public
    AND (p_preview OR e.status = 'published')
    AND (EXISTS (SELECT 1 FROM public.event_speaker_entries en WHERE en.event_id = e.id AND en.tenant_id = v_tenant AND en.speaker_profile_id = sp.id)
      OR EXISTS (SELECT 1 FROM public.event_speakers es WHERE es.event_id = e.id AND es.user_id = sp.user_id));
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) IS
  'On-demand event speaker details: public tenant and published event; preview requires same-tenant event admin. Contact follows existing event_people.email_visible/phone_visible; author links come from the author_profiles_public projection, which carries no author contact e-mail (20260730120000). Never raw admin contact.';