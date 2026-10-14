-- ============================================================================
-- WYPIS Z MAILA WYCOFUJE TEZ ZGODE MARKETINGOWA UCZESTNIKA WYDARZEN
-- (REG-14, JEDNOSTKA B3).
--
-- DEFEKT: `email_unsubscribe_by_token` (20261002190100:45-164) wypisuje adres
--   z newslettera i stawia blokade `unsubscribe` na liscie wykluczen, ale
--   NIE dotyka zgody marketingowej osoby wydarzen o tym adresie
--   (`event_people.consent_marketing_at`) ani jej odbicia w CRM
--   (`crm_leads.marketing_consent`, wpisanego przez most wydarzen). Klikniecie
--   "wypisz mnie" w stopce maila zostawialo wiec aktywna zgode organizatora
--   wydarzen, a most CRM podtrzymywal ja przy kolejnym wywolaniu - wycofanie
--   z art. 7 ust. 3 RODO nie bylo rownie latwe jak udzielenie.
--
-- ZMIANA 20261012 (REG-14): cialo z 20261002190100:45-164 bez zmian poza
--   JEDNYM wywolaniem `_event_consent_withdraw_by_email(najemca, adres,
--   'unsubscribe_link')` (rejestr zgod A2, 20261012130700) PO udanej blokadzie
--   - w tej samej transakcji: wpis 'withdrawn' w ksiedze (dowod
--   `unsubscribe_link`), zgaszona projekcja, zastapione otwarte linki DOI
--   z marketingiem, CRM `marketing_consent = false` + wiersz given=false.
--   Adres bez osoby wydarzen to no-op. Sygnatura, ksztalt odpowiedzi
--   i granty (tylko service_role) bez zmian.
--
-- CZEGO TO NIE ZAMYKA: wypis wycofuje wylacznie MARKETING - zgoda na
--   udostepnianie danych partnerom wydarzenia nie dotyczy poczty, wiec
--   zostaje (wycofuje sie ja kluczem samoobslugi albo w ustawieniach konta).
--   Plik celowo bez znacznika wlaczenia do harnessu wydarzen i bez funkcji
--   `public.event_*`: harness wydarzen nie ma tabel poczty (blokady, tokeny
--   globalne) - dowodem jest pgTAP na pelnym schemacie.
--
-- KOLEJNOSC WDROZENIA: po 20261012130700 (funkcje rejestru). Wzgledem kodu
--   dowolna (sygnatura i odpowiedz bez zmian).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT.
-- DOWOD: supabase/tests/event_consent_confirm_withdraw_test.sql (wypis
--   z maila gasi zgode osoby i w CRM, wpis ksiegi unsubscribe_link).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Wypis jednym kliknięciem - wspólny dla tokenu globalnego i per subskrybent
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_unsubscribe_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_email text;
  v_tenant uuid;
  v_global boolean := false;
  v_subscriber uuid;
  v_status text;
  v_claimed boolean := false;
  v_result jsonb;
BEGIN
  IF v_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_token');
  END IF;

  -- (a) Token globalny poczty systemowej (email_unsubscribe_tokens). Odczyt z
  -- blokadą wiersza zamiast UPDATE ... RETURNING: zużycie tokenu zapisujemy
  -- dopiero razem z blokadą, żeby wypis, który się nie udał, nie zostawiał
  -- tokenu „już użytego" (kolejny klik raportowałby fałszywe "już wypisany").
  SELECT lower(btrim(t.email)), t.used_at IS NULL
    INTO v_email, v_claimed
    FROM public.email_unsubscribe_tokens t
   WHERE t.token = v_token
   FOR UPDATE;
  v_global := FOUND;

  -- (b) Token per subskrybent newslettera (kampanie, RFC 8058 one-click).
  -- Blokada wiersza serializuje równoległe one-clicki (klient pocztowy potrafi
  -- POST-ować kilka razy) - drugi czeka i widzi już status `unsubscribed`.
  IF NOT v_global THEN
    SELECT ns.id, lower(btrim(ns.email)), ns.tenant_id, ns.status
      INTO v_subscriber, v_email, v_tenant, v_status
      FROM public.newsletter_subscribers ns
     WHERE ns.unsubscribe_token = v_token
     FOR UPDATE;
    -- "Już wypisany" mówi STAN wiersza, a nie fakt znalezienia tokenu.
    v_claimed := v_subscriber IS NOT NULL AND v_status IS DISTINCT FROM 'unsubscribed';
  END IF;

  IF COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_token');
  END IF;

  -- Tenant subskrybenta jest pewny (wiersz go niesie); dla tokenu globalnego
  -- rozstrzygamy jak wcześniej. Wszystko powyżej było odczytem, więc wczesny
  -- powrót niczego nie zostawia w połowie.
  v_tenant := COALESCE(v_tenant, public.email_resolve_tenant_for_address(v_email));
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tenant');
  END IF;

  -- Status PRZED blokadą: trigger synchronizacji (tg_email_suppression_sync_
  -- subscriber) widzi wtedy wiersz już wypisany i nic nie robi, a my zapisujemy
  -- świeży `unsubscribed_at` i unieważniamy token potwierdzenia (inaczej stary
  -- link z maila double opt-in reaktywowałby subskrypcję). Robimy to sami, bo
  -- trigger nie odpala przy mocniejszej blokadzie i połyka własne błędy.
  IF v_subscriber IS NOT NULL THEN
    IF v_claimed THEN
      UPDATE public.newsletter_subscribers
         SET status = 'unsubscribed',
             unsubscribed_at = now(),
             confirmation_token = NULL,
             confirmation_expires_at = NULL
       WHERE id = v_subscriber;
    END IF;
  ELSE
    -- Token globalny: wypis z poczty systemowej zdejmuje też subskrypcję
    -- newslettera tego adresu - w tym samym tenancie co blokada, ten sam
    -- warunek dopasowania co trigger synchronizacji.
    UPDATE public.newsletter_subscribers ns
       SET status = 'unsubscribed',
           unsubscribed_at = now(),
           confirmation_token = NULL,
           confirmation_expires_at = NULL
     WHERE ns.tenant_id = v_tenant
       AND lower(ns.email) = v_email
       AND ns.status <> 'unsubscribed';

    IF v_claimed THEN
      UPDATE public.email_unsubscribe_tokens
         SET used_at = now()
       WHERE token = v_token AND used_at IS NULL;
    END IF;
  END IF;

  -- Blokada stawiana ZAWSZE, także przy ponownym kliknięciu: dzięki temu
  -- wiersze wypisane przed tą poprawką (bez wpisu na liście) dostają go przy
  -- pierwszym powtórnym kliknięciu, a email_record_suppression sam pilnuje,
  -- żeby nie osłabić mocniejszej blokady.
  v_result := public.email_record_suppression(
    p_tenant => v_tenant,
    p_email => v_email,
    p_reason => 'unsubscribe',
    p_source => 'system',
    p_provider => 'self_service',
    p_subscriber => v_subscriber,
    p_meta => jsonb_build_object(
      'channel', 'unsubscribe_link',
      'token_kind', CASE WHEN v_global THEN 'global' ELSE 'newsletter' END)
  );

  -- Wypis bez blokady to dokładnie ten stan, który ta funkcja ma wykluczać.
  -- Wyjątek wycofuje status i zużycie tokenu z tej samej transakcji; wołający
  -- dostaje błąd (500), a klient pocztowy ponowi żądanie.
  IF COALESCE((v_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'suppression_not_recorded: %', COALESCE(v_result ->> 'error', 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  -- ZMIANA 20261012 (REG-14): ten sam adres jako osoba wydarzen najemcy traci
  -- zgode marketingowa - ksiega (dowod `unsubscribe_link`), projekcja i CRM.
  -- W TEJ SAMEJ transakcji co blokada: wypis jest spojny albo nie zmienia
  -- niczego. Adres bez kartoteki wydarzen to no-op (wynik false).
  PERFORM public._event_consent_withdraw_by_email(v_tenant, v_email, 'unsubscribe_link');

  RETURN jsonb_build_object(
    'ok', true,
    'already_unsubscribed', NOT v_claimed,
    'tenant_id', v_tenant);
END;
$fn$;

COMMENT ON FUNCTION public.email_unsubscribe_by_token(text) IS
  'Wypis jednym kliknieciem (token globalny lub per subskrybent): w JEDNEJ transakcji wypisuje subskrybenta (status + uniewaznienie tokenu potwierdzenia), zuzywa token globalny, stawia blokade unsubscribe w tenancie wlasciciela wiersza i (od 20261012133200, REG-14) wycofuje zgode marketingowa osoby wydarzen o tym adresie (_event_consent_withdraw_by_email, dowod unsubscribe_link: ksiega, projekcja, CRM). Nieudana blokada wycofuje calosc. Idempotentny; already_unsubscribed odzwierciedla stan sprzed wywolania.';

REVOKE ALL ON FUNCTION public.email_unsubscribe_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe_by_token(text) TO service_role;
