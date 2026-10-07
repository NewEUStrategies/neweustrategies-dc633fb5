-- ============================================================================
-- ZAPISY CRM I NEWSLETTERA WIAZANE Z WOLAJACYM.
--
-- DEFEKTY (audyt platformy, definer-grants-6 i service-role-idor-5):
--   1. `crm_upsert_lead_from_profile(uuid)` - SECURITY DEFINER, GRANT dla
--      `authenticated` (masowy GRANT z 20260725181430), bez bramki: kazdy
--      zalogowany wymuszal przetwarzanie w CRM profilu DOWOLNEGO konta
--      dowolnego najemcy (UUID-y kont sa widoczne na stronach autorow
--      i prelegentow). Grantu nie dalo sie po prostu zdjac, bo SECURITY
--      INVOKER `accept_my_user_invitation` wolala te funkcje z JWT konta.
--   2. `crm_backfill_all_leads()` - sprawdzala role administratora w najemcy
--      wolajacego, a petla szla po profilach i subskrybentach WSZYSTKICH
--      najemcow: administrator najemcy A tworzyl i scalal leady w CRM-ie B.
--   3. `join_us_link_and_backfill` przepinal subskrypcje takze wtedy, gdy byla
--      juz powiazana z INNYM kontem (`user_id IS DISTINCT FROM _user_id`),
--      a adres przychodzil z ladunku formularza (naprawione w TS - adres
--      z sesji; tu warstwa bazy: wiazemy wylacznie wiersze bez wlasciciela).
--
-- ZMIANA:
--   A. `accept_my_user_invitation()` - SECURITY DEFINER zwiazana z wolajacym
--      (przy okazji naprawia jej cicha awarie, opis w sekcji A);
--      `crm_upsert_lead_from_profile(uuid)` i `crm_upsert_lead_from_subscriber
--      (uuid)` - TYLKO `service_role` (wyzwalacze, backfill,
--      `admin_upsert_speaker_profile` i przyjecie zaproszenia sa SECURITY
--      DEFINER, wiec dalej je woluja).
--   B. `crm_backfill_all_leads()` - petle zawezone do `current_tenant_id()`.
--   C. `join_us_link_and_backfill` - wiaze wylacznie subskrypcje bez konta.
--
-- IDEMPOTENTNA: CREATE OR REPLACE i bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/crm_newsletter_writers_bound_test.sql.
-- ============================================================================

-- A) PRZYJECIE ZAPROSZENIA BEZ GRANTU CRM DLA KLIENTA --------------------------
-- `accept_my_user_invitation` byla SECURITY INVOKER i czytala `profiles.email`,
-- do ktorej `authenticated` NIE MA prawa od 20260724090100 (REVOKE SELECT na
-- tabeli, przywrocone tylko kolumny publiczne). Kazde wywolanie z `useAuth`
-- konczylo sie `permission denied for table profiles`, polykanym przez
-- `console.warn` - zaproszenia nie byly oznaczane jako przyjete. Teraz to
-- SECURITY DEFINER zwiazana z wolajacym w ciele: konto = auth.uid(), najemca
-- i adres z JEGO profilu, adres zaproszenia = adres z JWT (warunek polityki
-- UPDATE, ktory dotad pilnowal zapisu). Lead CRM zaklada wewnatrz - jako
-- wlasciciel funkcji - wiec klient nie potrzebuje EXECUTE na
-- `crm_upsert_lead_from_profile`.
CREATE OR REPLACE FUNCTION public.accept_my_user_invitation()
RETURNS TABLE(invitation_id uuid, accepted_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_tenant_id uuid;
  v_invitation_id uuid;
  v_accepted_at timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(trim(p.email)), p.tenant_id
    INTO v_email, v_tenant_id
    FROM public.profiles p
   WHERE p.id = v_user_id;

  IF v_email IS NULL OR v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ui.id
    INTO v_invitation_id
    FROM public.user_invitations ui
   WHERE ui.tenant_id = v_tenant_id
     AND lower(trim(ui.email)) = v_email
     AND ui.auth_user_id = v_user_id
     -- Warunek dotad egzekwowany przez polityke UPDATE
     -- `invitation_recipient_accept_own`: adres zaproszenia = adres z JWT.
     AND lower(trim(ui.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
     AND ui.status IN ('pending'::public.invitation_status, 'sent'::public.invitation_status, 'failed'::public.invitation_status)
   ORDER BY ui.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_invitation_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.user_invitations
     SET status = 'accepted'::public.invitation_status,
         accepted_at = v_accepted_at,
         last_error = NULL
   WHERE id = v_invitation_id;

  PERFORM public.crm_upsert_lead_from_profile(v_user_id);

  RETURN QUERY SELECT v_invitation_id, v_accepted_at;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_upsert_lead_from_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_upsert_lead_from_profile(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.crm_upsert_lead_from_subscriber(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_upsert_lead_from_subscriber(uuid) TO service_role;

-- B) BACKFILL W NAJEMCY WOLAJACEGO ---------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_backfill_all_leads()
RETURNS TABLE(profiles_synced integer, subscribers_synced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid := public.current_tenant_id();
  _p int := 0;
  _s int := 0;
  r RECORD;
BEGIN
  IF _uid IS NULL OR NOT (
    public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- Rola jest tenantowa, wiec zakres pracy tez: wylacznie najemca wolajacego.
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT id FROM public.profiles
            WHERE tenant_id = _tenant AND email IS NOT NULL AND length(trim(email)) > 0 LOOP
    PERFORM public.crm_upsert_lead_from_profile(r.id);
    _p := _p + 1;
  END LOOP;

  FOR r IN SELECT id FROM public.newsletter_subscribers
            WHERE tenant_id = _tenant AND email IS NOT NULL AND length(trim(email)) > 0 LOOP
    PERFORM public.crm_upsert_lead_from_subscriber(r.id);
    _s := _s + 1;
  END LOOP;

  RETURN QUERY SELECT _p, _s;
END $$;

-- C) POWIAZANIE SUBSKRYPCJI TYLKO BEZ WLASCICIELA ------------------------------
CREATE OR REPLACE FUNCTION public.join_us_link_and_backfill(
  _user_id uuid,
  _tenant_id uuid,
  _email text,
  _first_name text,
  _last_name text,
  _country text,
  _linkedin text,
  _phone text,
  _company text,
  _position text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1) Powiaz subskrypcje (tenant_id, email) z kontem - wylacznie wiersz BEZ
  --    wlasciciela. Wiersz powiazany z innym kontem zostaje jego.
  UPDATE public.newsletter_subscribers
     SET user_id = _user_id,
         updated_at = now()
   WHERE tenant_id = _tenant_id
     AND lower(email) = lower(_email)
     AND user_id IS NULL;

  -- 2) Back-fill profilu - COALESCE tylko dla pustych/NULL wartosci.
  UPDATE public.profiles
     SET first_name      = COALESCE(NULLIF(first_name, ''),      NULLIF(_first_name, '')),
         last_name       = COALESCE(NULLIF(last_name, ''),       NULLIF(_last_name, '')),
         location        = COALESCE(NULLIF(location, ''),        NULLIF(_country, '')),
         linkedin_url    = COALESCE(NULLIF(linkedin_url, ''),    NULLIF(_linkedin, '')),
         phone           = COALESCE(NULLIF(phone, ''),           NULLIF(_phone, '')),
         current_company = COALESCE(NULLIF(current_company, ''), NULLIF(_company, '')),
         job_title       = COALESCE(NULLIF(job_title, ''),       NULLIF(_position, '')),
         updated_at      = now()
   WHERE id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.join_us_link_and_backfill(uuid, uuid, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_us_link_and_backfill(uuid, uuid, text, text, text, text, text, text, text, text)
  TO service_role;
