-- events-harness: include
-- ============================================================================
-- KARTOTEKA UCZESTNIKA WYDARZEN (B2, CZESC 1): ADRES PROFILU WYDARZENIA TYLKO
-- Z POTWIERDZONEGO ADRESU KONTA, SAMODZIELNE DOWIAZANIE KONTA PRZEZ TEN SAM
-- WARUNEK (REG-01).
--
-- DEFEKT
--   1. REG-01, zawlaszczenie adresu z panelu uczestnika.
--      `event_my_event_profile_set` (20260828140004:73-176) zapisywal
--      `email = CASE WHEN p_payload ? 'email' THEN v_email ...` (:127) po
--      samym sprawdzeniu ksztaltu. Konto dowiazane do WLASNEJ osoby
--      przestawialo jej adres na cudzy, jeszcze nieuzyty adres - kolejne
--      zapisy wlasciciela tego adresu trafialy do kartoteki napastnika
--      (`COALESCE(p.user_id, ...)` trzymal napastnika), a bilety QR szly na
--      `p.email` (`_event_issue_ticket_codes`). Zgloszone juz w
--      docs/PRZEGLAD_MODUL_EVENT_BUILDER_2026-08-28_USTALENIA.md:1442.
--   2. REG-01, ta sama droga przez profil konta.
--      `event_my_event_profile_sync_account` (20260828105751:453-519, :494)
--      kopiowal `COALESCE(profiles.contact_email, profiles.email)` do
--      `event_people.email`, a obie kolumny `profiles` zalogowany zmienia sam
--      (GRANT UPDATE) - niepotwierdzony adres profilu stawal sie adresem
--      kartoteki.
--   3. Uczestnik, ktorego kartoteke odwiazuje naprawa historii
--      (20261012190000) albo ktory zapisal sie jako gosc przed zalozeniem
--      konta, nie mial zadnej drogi do wlasnego panelu poza ponownym zapisem.
--
-- ZMIANA
--   A. `event_my_event_profile_set`: zmiana adresu WYLACZNIE na potwierdzony
--      adres konta wolajacego (`_event_uid_owns_email`, decyzja D1). Kody:
--      `email_required` (pusty adres zamiast obecnego), `email_unverified`
--      (adres inny niz potwierdzony adres konta - takze gdy konto jest
--      niepotwierdzone), `email_in_use` (adres konta nalezy do innej osoby
--      najemcy). Ta sama wartosc po normalizacji (wielkosc liter, spacje) to
--      nie zmiana. Reszta ciala bez zmian.
--   B. `event_my_event_profile_sync_account`: adres WYLACZNIE
--      z `auth.users.email` z `email_confirmed_at` i tylko gdy nie nalezy do
--      innej osoby najemcy; nigdy z `profiles.email`/`contact_email`.
--   C. `event_my_account_link()` (authenticated): dowiazuje do konta
--      niedowiazana osobe najemcy o POTWIERDZONYM adresie konta - przez
--      `_event_bind_uid_for_email`, jedyna droge zapisu `user_id` (A1).
--   D. `_event_email_hint(adres)` - maska adresu (`j***@domena`) dla podgladu
--      zaproszenia i ekranu administratora: jedna regula maskowania.
--
-- CZEGO TO NIE ZAMYKA: historycznych dowiazan (naprawa w 20261012190000 po
-- wszystkich poprawkach zapisujacych), przyjecia zaproszenia pakietowego
-- (20261012132200) ani zapisu przez formularz (`_event_register`, B1a).
-- Odczyt `event_my_event_profile` (konto -> osoba po `user_id`) zostaje.
--
-- KOLEJNOSC WDROZENIA: dowolna. Formularz profilu (myEventProfileApi.ts)
-- wysyla adres tylko wtedy, gdy uczestnik go zmienil, i mapuje nowe kody;
-- stary front, ktory wysyla adres zawsze, przechodzi, bo niezmieniony adres
-- to nie zmiana. `event_my_account_link` jest nowy - panel uczestnika woluje
-- go tylko przy braku profilu, a 42883/PGRST202 traktuje jak „brak".
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_people_account_binding_test.sql,
--   scripts/events-harness/runtime_test.d/25_account_binding_invites.sql.
-- ============================================================================

-- D) MASKA ADRESU -------------------------------------------------------------------
-- Pierwszy znak czesci lokalnej, gwiazdki i pelna domena: zaproszony rozpozna
-- swoja skrzynke, a posiadacz cudzego linku nie dostaje adresu. Adres bez
-- `@` albo pusty - NULL (nie ma czego pokazac).
CREATE OR REPLACE FUNCTION public._event_email_hint(p_email text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_email, '')), '') IS NULL
      OR position('@' IN btrim(p_email)) < 2 THEN NULL
    ELSE left(lower(btrim(p_email)), 1) || '***@' || split_part(lower(btrim(p_email)), '@', 2)
  END;
$$;
REVOKE ALL ON FUNCTION public._event_email_hint(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_email_hint(text) TO service_role;

COMMENT ON FUNCTION public._event_email_hint(text) IS
  'Maska adresu e-mail (pierwszy znak + ***@domena; brak adresu -> NULL) dla podgladu zaproszenia i ekranu dowiazan kont. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- A) PROFIL WYDARZENIA: ADRES TYLKO POTWIERDZONY ---------------------------------
-- Cialo z 20260828140004:73-176. Zmiany oznaczone `ZMIANA 20261012 (REG-01)`.
CREATE OR REPLACE FUNCTION public.event_my_event_profile_set(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug','')), '');
  v_person_id uuid;
  v_company_id uuid := NULLIF(p_payload->>'company_id', '')::uuid;
  v_url text := NULLIF(btrim(COALESCE(p_payload->>'social_profile_url','')), '');
  v_photo text := NULLIF(btrim(COALESCE(p_payload->>'photo_url','')), '');
  v_email text := NULLIF(btrim(COALESCE(p_payload->>'email','')), '');
  v_links jsonb := CASE WHEN jsonb_typeof(p_payload->'social_links') = 'object' THEN p_payload->'social_links' ELSE NULL END;
  v_push boolean := COALESCE((p_payload->>'push_account')::boolean, false);
  v_key text;
  v_val text;
  v_clean jsonb := '{}'::jsonb;
  v_current_email text;
  v_new_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required: sign in to edit your event profile'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'invalid_tenant: unknown host'; END IF;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'invalid_slug: event slug is required'; END IF;
  IF v_url IS NOT NULL AND v_url !~* '^https?://' THEN RAISE EXCEPTION 'invalid_url: social profile link must start with http(s)'; END IF;
  IF v_photo IS NOT NULL AND v_photo !~* '^https?://' THEN RAISE EXCEPTION 'invalid_url: photo link must start with http(s)'; END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'invalid_email: contact e-mail is malformed'; END IF;

  IF v_company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.crm_companies c WHERE c.tenant_id = v_tenant AND c.id = v_company_id
  ) THEN RAISE EXCEPTION 'invalid_company: organisation is outside the current tenant'; END IF;

  IF v_links IS NOT NULL THEN
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(v_links) LOOP
      IF v_key !~ '^(linkedin|x|facebook|instagram|youtube|website)$' THEN RAISE EXCEPTION 'invalid_social_key: % is not supported', v_key; END IF;
      v_val := NULLIF(btrim(COALESCE(v_val, '')), '');
      IF v_val IS NOT NULL THEN
        IF v_val !~* '^https?://' OR length(v_val) > 400 THEN RAISE EXCEPTION 'invalid_url: % link is invalid', v_key; END IF;
        v_clean := v_clean || jsonb_build_object(v_key, v_val);
      END IF;
    END LOOP;
  END IF;

  -- ZMIANA 20261012 (REG-01): wiersz osoby pod blokada - sprawdzenie adresu
  -- i jego zapis nizej to jedna chwila (rownolegla zmiana adresu czeka).
  SELECT p.id, p.email_norm INTO v_person_id, v_current_email FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.user_id = v_uid LIMIT 1
  FOR UPDATE;

  IF v_person_id IS NULL AND NOT v_push THEN
    RAISE EXCEPTION 'not_registered: no event profile for this account';
  END IF;

  -- ZMIANA 20261012 (REG-01, D1): ADRES KARTOTEKI = POTWIERDZONY ADRES KONTA.
  -- Adres osoby to klucz, po ktorym kolejne zapisy, zaproszenia i nabor
  -- znajduja kartoteke, i skrzynka, do ktorej ida bilety. Dowolny adres
  -- pozwalal kontu zawlaszczyc cudzy, jeszcze nieuzyty adres. Dlatego:
  --   * ten sam adres po normalizacji (wielkosc liter, spacje) - bez zmian;
  --   * pusty zamiast obecnego - `email_required` (kartoteka bez adresu nie
  --     dostanie biletu ani linku samoobslugi);
  --   * inny niz POTWIERDZONY adres konta - `email_unverified` (zmiana adresu
  --     konta ma wlasna, potwierdzana mailem sciezke: /profile/security);
  --   * adres konta, ktory ma juz inna osoba najemcy - `email_in_use`.
  -- Kolejnosc celowa: `email_in_use` tylko dla adresu, ktory wolajacy
  -- udowodnil - dla cudzego adresu baza nie mowi, czy ma go ktos inny.
  IF v_person_id IS NOT NULL AND p_payload ? 'email' THEN
    v_new_email := NULLIF(lower(v_email), '');
    IF v_new_email IS DISTINCT FROM v_current_email THEN
      IF v_new_email IS NULL THEN
        RAISE EXCEPTION 'email_required: the event profile keeps a contact e-mail';
      END IF;
      IF NOT public._event_uid_owns_email(v_uid, v_new_email) THEN
        RAISE EXCEPTION 'email_unverified: only the confirmed e-mail of your account can be used here';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.event_people p2
         WHERE p2.tenant_id = v_tenant AND p2.email_norm = v_new_email AND p2.id <> v_person_id
      ) THEN
        RAISE EXCEPTION 'email_in_use: this e-mail belongs to another event profile';
      END IF;
    END IF;
  END IF;

  IF v_person_id IS NOT NULL THEN
    UPDATE public.event_people p SET
      first_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'first_name','')), ''), p.first_name),
      last_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'last_name','')), ''), p.last_name),
      email = CASE WHEN p_payload ? 'email' THEN v_email ELSE p.email END,
      phone = CASE WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone','')), '') ELSE p.phone END,
      email_visible = CASE WHEN p_payload ? 'email_visible' THEN COALESCE((p_payload->>'email_visible')::boolean, false) ELSE p.email_visible END,
      phone_visible = CASE WHEN p_payload ? 'phone_visible' THEN COALESCE((p_payload->>'phone_visible')::boolean, false) ELSE p.phone_visible END,
      job_title = CASE WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title','')), '') ELSE p.job_title END,
      company_id = CASE WHEN p_payload ? 'company_id' THEN v_company_id ELSE p.company_id END,
      company_text = CASE WHEN p_payload ? 'company_text' THEN NULLIF(btrim(COALESCE(p_payload->>'company_text','')), '') ELSE p.company_text END,
      industry = CASE WHEN p_payload ? 'industry' THEN NULLIF(btrim(COALESCE(p_payload->>'industry','')), '') ELSE p.industry END,
      specialization = CASE WHEN p_payload ? 'specialization' THEN NULLIF(btrim(COALESCE(p_payload->>'specialization','')), '') ELSE p.specialization END,
      seeking_pl = CASE WHEN p_payload ? 'seeking_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_pl','')), '') ELSE p.seeking_pl END,
      seeking_en = CASE WHEN p_payload ? 'seeking_en' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_en','')), '') ELSE p.seeking_en END,
      offering_pl = CASE WHEN p_payload ? 'offering_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_pl','')), '') ELSE p.offering_pl END,
      offering_en = CASE WHEN p_payload ? 'offering_en' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_en','')), '') ELSE p.offering_en END,
      social_profile_url = CASE WHEN p_payload ? 'social_profile_url' THEN v_url ELSE p.social_profile_url END,
      social_links = CASE WHEN v_links IS NOT NULL THEN v_clean ELSE p.social_links END,
      photo_url = CASE WHEN p_payload ? 'photo_url' THEN v_photo ELSE p.photo_url END,
      bio_pl = CASE WHEN p_payload ? 'bio_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_pl','')), '') ELSE p.bio_pl END,
      bio_en = CASE WHEN p_payload ? 'bio_en' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_en','')), '') ELSE p.bio_en END,
      updated_at = now()
    WHERE p.id = v_person_id AND p.tenant_id = v_tenant AND p.user_id = v_uid;
  END IF;

  IF v_push THEN
    UPDATE public.profiles pr SET
      first_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'first_name','')), ''), pr.first_name),
      last_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'last_name','')), ''), pr.last_name),
      phone = CASE WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone','')), '') ELSE pr.phone END,
      job_title = CASE WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title','')), '') ELSE pr.job_title END,
      current_company_id = CASE WHEN p_payload ? 'company_id' THEN v_company_id ELSE pr.current_company_id END,
      current_company = CASE WHEN p_payload ? 'company_text' THEN NULLIF(btrim(COALESCE(p_payload->>'company_text','')), '') ELSE pr.current_company END,
      specialization = CASE WHEN p_payload ? 'specialization' THEN NULLIF(btrim(COALESCE(p_payload->>'specialization','')), '') ELSE pr.specialization END,
      seeking_pl = CASE WHEN p_payload ? 'seeking_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_pl','')), '') ELSE pr.seeking_pl END,
      seeking_en = CASE WHEN p_payload ? 'seeking_en' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_en','')), '') ELSE pr.seeking_en END,
      offering_pl = CASE WHEN p_payload ? 'offering_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_pl','')), '') ELSE pr.offering_pl END,
      offering_en = CASE WHEN p_payload ? 'offering_en' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_en','')), '') ELSE pr.offering_en END,
      bio_pl = CASE WHEN p_payload ? 'bio_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_pl','')), '') ELSE pr.bio_pl END,
      bio_en = CASE WHEN p_payload ? 'bio_en' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_en','')), '') ELSE pr.bio_en END,
      avatar_url = CASE WHEN p_payload ? 'photo_url' THEN v_photo ELSE pr.avatar_url END,
      linkedin_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'linkedin','')), '') ELSE pr.linkedin_url END,
      twitter_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'x','')), '') ELSE pr.twitter_url END,
      facebook_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'facebook','')), '') ELSE pr.facebook_url END,
      instagram_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'instagram','')), '') ELSE pr.instagram_url END,
      website_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'website','')), '') ELSE pr.website_url END,
      updated_at = now()
    WHERE pr.id = v_uid AND pr.tenant_id = v_tenant;
  END IF;

  RETURN public.event_my_event_profile(jsonb_build_object('slug', v_slug));
END;
$function$;
REVOKE ALL ON FUNCTION public.event_my_event_profile_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_event_profile_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_event_profile_set(jsonb) IS
  'Edycja profilu wydarzenia zalogowanego uczestnika (osoba po user_id = auth.uid(), najemca z hosta). REG-01: adres zmienia sie wylacznie na POTWIERDZONY adres konta (email_unverified), nigdy na pusty (email_required) ani na adres innej osoby najemcy (email_in_use); ten sam adres po normalizacji to nie zmiana. push_account kopiuje dane (bez adresu) do profilu konta.';

-- B) SYNCHRONIZACJA Z KONTEM: ADRES Z AUTH, NIE Z PROFILU --------------------------
-- Cialo z 20260828105751:453-519. Zmiana oznaczona `ZMIANA 20261012 (REG-01)`.
CREATE OR REPLACE FUNCTION public.event_my_event_profile_sync_account(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug','')), '');
  v_person_id uuid;
  v_acc record;
  v_auth_email text;
  v_sync_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to sync your event profile';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;

  SELECT p.id INTO v_person_id
  FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.user_id = v_uid
  LIMIT 1
  FOR UPDATE;

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'not_registered: no event profile for this account';
  END IF;

  SELECT pr.* INTO v_acc
  FROM public.profiles pr
  WHERE pr.id = v_uid AND pr.tenant_id = v_tenant
  LIMIT 1;

  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'no_account_profile: platform profile is missing';
  END IF;

  -- ZMIANA 20261012 (REG-01, D1): adres kartoteki WYLACZNIE z adresu
  -- LOGOWANIA (`auth.users.email`) i tylko potwierdzonego. `profiles.email`
  -- i `profiles.contact_email` zalogowany zmienia sam (GRANT UPDATE), wiec
  -- byly ta sama furtka zawlaszczenia cudzego adresu co edycja profilu.
  -- Adres nalezacy do innej osoby najemcy zostaje nietkniety (bez bledu:
  -- synchronizacja przenosi to, co sie da, a nie odmawia calosci).
  SELECT NULLIF(lower(btrim(COALESCE(u.email, ''))), '') INTO v_auth_email
    FROM auth.users u
   WHERE u.id = v_uid;
  IF public._event_uid_owns_email(v_uid, v_auth_email)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_people p2
        WHERE p2.tenant_id = v_tenant AND p2.email_norm = v_auth_email AND p2.id <> v_person_id
     ) THEN
    v_sync_email := v_auth_email;
  END IF;

  UPDATE public.event_people p SET
    first_name = COALESCE(NULLIF(btrim(COALESCE(v_acc.first_name, '')), ''), p.first_name),
    last_name = COALESCE(NULLIF(btrim(COALESCE(v_acc.last_name, '')), ''), p.last_name),
    email = COALESCE(v_sync_email, p.email),
    phone = COALESCE(NULLIF(btrim(COALESCE(v_acc.phone, '')), ''), p.phone),
    job_title = COALESCE(NULLIF(btrim(COALESCE(v_acc.job_title, '')), ''), p.job_title),
    company_text = COALESCE(NULLIF(btrim(COALESCE(v_acc.current_company, '')), ''), p.company_text),
    specialization = COALESCE(NULLIF(btrim(COALESCE(v_acc.specialization, '')), ''), p.specialization),
    seeking_pl = COALESCE(NULLIF(btrim(COALESCE(v_acc.seeking_pl, '')), ''), p.seeking_pl),
    seeking_en = COALESCE(NULLIF(btrim(COALESCE(v_acc.seeking_en, '')), ''), p.seeking_en),
    offering_pl = COALESCE(NULLIF(btrim(COALESCE(v_acc.offering_pl, '')), ''), p.offering_pl),
    offering_en = COALESCE(NULLIF(btrim(COALESCE(v_acc.offering_en, '')), ''), p.offering_en),
    bio_pl = COALESCE(NULLIF(btrim(COALESCE(v_acc.bio_pl, v_acc.bio, '')), ''), p.bio_pl),
    bio_en = COALESCE(NULLIF(btrim(COALESCE(v_acc.bio_en, '')), ''), p.bio_en),
    photo_url = CASE WHEN v_acc.hide_avatar THEN p.photo_url
                     ELSE COALESCE(NULLIF(btrim(COALESCE(v_acc.avatar_url, '')), ''), p.photo_url) END,
    social_links = COALESCE(p.social_links, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'linkedin', NULLIF(btrim(COALESCE(v_acc.linkedin_url, '')), ''),
      'x', NULLIF(btrim(COALESCE(v_acc.twitter_url, '')), ''),
      'facebook', NULLIF(btrim(COALESCE(v_acc.facebook_url, '')), ''),
      'instagram', NULLIF(btrim(COALESCE(v_acc.instagram_url, '')), ''),
      'website', NULLIF(btrim(COALESCE(v_acc.website_url, '')), '')
    )),
    updated_at = now()
  WHERE p.id = v_person_id AND p.tenant_id = v_tenant AND p.user_id = v_uid;

  RETURN public.event_my_event_profile(jsonb_build_object('slug', COALESCE(v_slug, '')));
END;
$function$;
REVOKE ALL ON FUNCTION public.event_my_event_profile_sync_account(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_event_profile_sync_account(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_event_profile_sync_account(jsonb) IS
  'Kopiuje dane profilu konta do profilu wydarzenia zalogowanego uczestnika. REG-01: adres wylacznie z auth.users.email z email_confirmed_at (nigdy z profiles.email ani contact_email) i tylko gdy nie nalezy do innej osoby najemcy; inaczej adres osoby zostaje.';

-- C) SAMODZIELNE DOWIAZANIE KONTA ---------------------------------------------------
-- Uczestnik z potwierdzonym adresem konta odzyskuje panel bez organizatora:
-- gosc, ktory zalozyl konto po zapisie, i osoba odwiazana naprawa historii,
-- gdy jej konto potwierdzilo juz adres. Dowiazanie idzie przez
-- `_event_bind_uid_for_email` - ten sam warunek co przy zapisie (D1), wiec
-- konto bez potwierdzonego adresu osoby niczego tu nie dostaje.
--
-- Odpowiedz `{ok, linked, person_id?, reason?}` jest wartoscia, nie wyjatkiem:
-- „nie ma czego dowiazac" to normalny wynik dla panelu. Powody mowia
-- wylacznie o WLASNYM, potwierdzonym adresie wolajacego - nic o cudzych.
CREATE OR REPLACE FUNCTION public.event_my_account_link(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_email text;
  v_person public.event_people;
  v_bind uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to link your event profile';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;

  -- Juz dowiazany: nic do zrobienia (wywolanie powtorzone przez panel).
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.user_id = v_uid;
  IF v_person.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'linked', true, 'already_linked', true,
                              'person_id', v_person.id);
  END IF;

  SELECT NULLIF(lower(btrim(COALESCE(u.email, ''))), '') INTO v_email
    FROM auth.users u
   WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'linked', false, 'reason', 'email_unconfirmed');
  END IF;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.email_norm = v_email
   FOR UPDATE;
  IF v_person.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'linked', false, 'reason', 'no_record');
  END IF;
  -- Osoba z tym adresem ma juz INNE konto (wolajacy nie jest dowiazany nigdzie,
  -- patrz wyzej). Przepiecie miedzy kontami to decyzja organizatora, nie
  -- samoobslugi - historia zgloszen nie zmienia wlasciciela po cichu.
  IF v_person.user_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'linked', false, 'reason', 'record_bound_elsewhere');
  END IF;

  v_bind := public._event_bind_uid_for_email(v_tenant, v_uid, v_email);
  IF v_bind IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'linked', false, 'reason', 'email_unconfirmed');
  END IF;

  UPDATE public.event_people p
     SET user_id = v_bind
   WHERE p.tenant_id = v_tenant AND p.id = v_person.id AND p.user_id IS NULL;

  RETURN jsonb_build_object('ok', true, 'linked', true, 'already_linked', false,
                            'person_id', v_person.id);
END;
$$;
REVOKE ALL ON FUNCTION public.event_my_account_link(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_account_link(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_account_link(jsonb) IS
  'REG-01 (D14): zalogowany uczestnik dowiazuje do swojego konta niedowiazana osobe najemcy hosta o POTWIERDZONYM adresie konta (auth.users.email_confirmed_at) - przez _event_bind_uid_for_email. Wartosc {ok, linked, already_linked?, person_id?, reason: email_unconfirmed|no_record|record_bound_elsewhere}. Ladunek ignorowany; konto z sesji, najemca z hosta.';
