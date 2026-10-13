-- ============================================================================
-- ZGODA MARKETINGOWA: WYPIS GLOBALNY WE WSZYSTKICH NAJEMCACH, FORMULARZ
-- KONTAKTOWY BEZ ZGODY MARKETINGOWEJ, ODZNACZENIE W CRM ZATRZYMUJE MOST
-- (PRZEGLAD R12: USTALENIA 1, 5, 6; REG-02 / REG-14).
--
-- DEFEKT
--   1. `email_unsubscribe_by_token` (20261012130200:91, :158): token globalny
--      ze stopki kazdego maila systemowego nie niesie najemcy; najemca
--      rozstrzygany z adresu (`email_resolve_tenant_for_address` - newsletter,
--      profil, inaczej najemca domyslny). Uczestnik obszaru B bez newslettera
--      i profilu klikal „wypisz" i dostawal strone sukcesu, a wycofanie szlo do
--      obszaru domyslnego: w B zostawala zgoda w kartotece, ksiedze i CRM
--      (powtorzone: review/R12-identity-consents/p1_unsub_tenant.sql).
--   2. `contact_messages_to_lead()` (20260705182736): `crm_upsert_lead(...,
--      NEW.newsletter_opt_in, NEW.consent)` - osmy argument to `_marketing`,
--      a `NEW.consent` to wymagana zgoda na przetwarzanie danych. Anonim
--      wpisujacy cudzy adres w publiczny formularz kontaktowy wlaczal
--      `crm_leads.marketing_consent` (OR), takze po wycofaniu zgody
--      (p6_contact_resurrect.sql).
--   3. Odznaczenie zgody w CRM (src/lib/crm.functions.ts, `bulkUpdateCrmLeads`)
--      to goly UPDATE `crm_leads` bez wiersza `crm_consent_log` given=false
--      (rola authenticated nie moze go dopisac). Most wydarzen
--      (`_event_person_crm_sync`, 20261012100300:286-300) widzial dowod
--      z ksiegi i brak wiersza given=false - przy nastepnym wywolaniu
--      (zameldowanie, atrybucja, nabor, ponowienie) wlaczal zgode z powrotem
--      i dopisywal given=true (p3_crm_resurrect.sql).
--
-- ZMIANA 20261012 (R12)
--   A. `email_unsubscribe_by_token` (cialo z 20261012130200, zmiana
--      oznaczona): token globalny wycofuje marketing wydarzen
--      (`_event_consent_withdraw_by_email`, dowod `unsubscribe_link`)
--      w KAZDYM najemcy, ktory ma osobe o tym `email_norm` - wycofanie to
--      kierunek bezpieczny. Token subskrybenta - najemca wiersza, jak dotad.
--      Blokada `unsubscribe`, wypis z newslettera i ksztalt odpowiedzi - bez
--      zmian (najemca rozstrzygniety z adresu).
--   B. `contact_messages_to_lead()` - `_marketing = false`. Zgode marketingowa
--      w CRM stawia wylacznie zweryfikowany kanal: potwierdzenie double opt-in
--      newslettera (`newsletter_to_lead`, status `subscribed`; formularz
--      kontaktowy z zaznaczonym newsletterem wysyla link DOI), konto albo
--      DOI wydarzen (most z ksiegi). Wiersze `crm_consent_log` z formularza -
--      bez zmian (dowod tego, co zaznaczono).
--   C. `crm_leads_marketing_consent_withdraw(p_lead_ids uuid[])` (RPC
--      personelu CRM: admin/editor/super_admin w najemcy z profilu
--      wolajacego) - jednym zapytaniem `marketing_consent = false` i wiersz
--      `crm_consent_log` given=false (`consent_key = 'marketing'`,
--      `source_type = 'other'`, `form_id = 'crm_staff:withdraw'`,
--      `form_name = 'staff'`) dla kazdego kontaktu najemcy z listy. Most
--      wydarzen przestaje wtedy wskrzeszac zgode (warunek 20261012100300:
--      wiersz given=false nie starszy niz dowod). Najemca z
--      `current_tenant_id()`, nigdy z ladunku; kontakty innego najemcy sa
--      pomijane (0 zmian), a nie zdradzane.
--
-- CZEGO TO NIE ZAMYKA
--   * Odznaczenie w CRM nie zapisuje wycofania w ksiedze zgod wydarzen
--     (`event_consent_records` przyjmuje dowody uczestnika: manage_token,
--     account_settings, unsubscribe_link) - kartoteka wydarzen pokazuje dalej
--     zgode, ale CRM i most jej nie wskrzeszaja. Ponowne zaznaczenie zgody
--     w CRM to decyzja personelu, bez wiersza given=true (jak dotad).
--   * Krok workflow `create_crm_lead` z parametrem `marketing` (konfiguracja
--     personelu) moze wlaczyc zgode - poza zakresem przegladu.
--   * Blokada `unsubscribe` z tokenu globalnego zostaje w najemcy
--     rozstrzygnietym z adresu (zmiana blokad wplywa na poczte transakcyjna
--     innych najemcow - osobna decyzja; notatka R12-fix-notes.md).
--   Plik bez znacznika harnessu wydarzen: harness nie ma tabel poczty
--   i formularza kontaktowego - dowodem jest pgTAP na pelnym schemacie.
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD dla C (funkcja serwerowa przy
--   42883/PGRST202 wraca do dotychczasowego UPDATE); A i B - dowolna.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_identity_consents_r12_test.sql (token globalny
--   + uczestnik najemcy spoza domyslnego; formularz kontaktowy po wycofaniu;
--   odznaczenie personelu zatrzymuje most; obcy najemca pominiety),
--   src/lib/__tests__/crmFunctions.test.ts (odznaczenie przez RPC, okno wdrozenia).
-- ============================================================================

-- A) WYPIS Z MAILA ------------------------------------------------------------------
-- Cialo z 20261012130200:44-163; zmiana oznaczona `ZMIANA 20261012 (R12...)`.
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
  v_event_tenant uuid;
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
  --
  -- ZMIANA 20261012 (R12, REG-14): token GLOBALNY (stopka poczty systemowej,
  -- w tym kazdego maila wydarzenia) nie niesie najemcy, a najemca rozstrzygany
  -- z adresu (newsletter, profil, inaczej domyslny) nie musi byc najemca
  -- wydarzenia - uczestnik obszaru B bez newslettera i profilu wypisywal sie
  -- w obszarze domyslnym, a jego zgoda w B zostawala. Wycofanie to kierunek
  -- bezpieczny, wiec token globalny wycofuje marketing wydarzen w KAZDYM
  -- najemcy, ktory ma osobe o tym adresie (stala kolejnosc - blokady osob
  -- w tym samym porzadku co rownolegly wypis). Token subskrybenta newslettera
  -- niesie najemce wiersza - wycofanie tylko tam, jak dotad.
  IF v_global THEN
    FOR v_event_tenant IN
      SELECT DISTINCT p.tenant_id
        FROM public.event_people p
       WHERE p.email_norm = v_email
       ORDER BY p.tenant_id
    LOOP
      PERFORM public._event_consent_withdraw_by_email(v_event_tenant, v_email, 'unsubscribe_link');
    END LOOP;
  ELSE
    PERFORM public._event_consent_withdraw_by_email(v_tenant, v_email, 'unsubscribe_link');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_unsubscribed', NOT v_claimed,
    'tenant_id', v_tenant);
END;
$fn$;

COMMENT ON FUNCTION public.email_unsubscribe_by_token(text) IS
  'Wypis jednym kliknieciem (token globalny lub per subskrybent): w JEDNEJ transakcji wypisuje subskrybenta (status + uniewaznienie tokenu potwierdzenia), zuzywa token globalny, stawia blokade unsubscribe w tenancie wlasciciela wiersza i (od 20261012130200, REG-14) wycofuje zgode marketingowa osoby wydarzen o tym adresie (_event_consent_withdraw_by_email, dowod unsubscribe_link: ksiega, projekcja, CRM) - dla tokenu globalnego w KAZDYM najemcy z osoba o tym adresie (R12), dla tokenu subskrybenta w jego najemcy. Nieudana blokada wycofuje calosc. Idempotentny; already_unsubscribed odzwierciedla stan sprzed wywolania.';

REVOKE ALL ON FUNCTION public.email_unsubscribe_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe_by_token(text) TO service_role;

-- B) FORMULARZ KONTAKTOWY -> CRM ------------------------------------------------------
-- Cialo z 20260705182736 (zgodne bajt w bajt z baza po replayu; `search_path`
-- jak w bazie: public, pg_temp); zmiana oznaczona.
CREATE OR REPLACE FUNCTION public.contact_messages_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_first text;
  v_last  text;
  v_item  jsonb;
  v_source_type crm_source_type;
BEGIN
  v_first := coalesce(NEW.first_name, nullif(split_part(coalesce(NEW.name, ''), ' ', 1), ''));
  v_last  := coalesce(
    NEW.last_name,
    nullif(substring(NEW.name from position(' ' in coalesce(NEW.name, '')) + 1), ''),
    nullif(NEW.name, v_first)
  );

  -- Upsert lead (always forwards phone/company when present on NEW.*)
  --
  -- ZMIANA 20261012 (R12, REG-02/REG-14): `_marketing` = false. Osmym
  -- argumentem szla zgoda na PRZETWARZANIE DANYCH (`NEW.consent`, wymagana do
  -- odpowiedzi na wiadomosc), a `crm_upsert_lead` robi z niej
  -- `marketing_consent = marketing_consent OR _marketing` - dowolna osoba,
  -- wpisujac cudzy adres w publiczny formularz, wlaczala kontaktowi zgode
  -- marketingowa (takze po jego wycofaniu, wiersz given=false nic nie
  -- znaczyl). Niezweryfikowany formularz nie daje zgody marketingowej:
  -- zaznaczenie newslettera uruchamia double opt-in (contact.functions.ts),
  -- a zgode w CRM stawia dopiero potwierdzenie (`newsletter_to_lead`,
  -- status `subscribed`). `newsletter_status = 'pending'` - jak dotad.
  PERFORM public.crm_upsert_lead(
    NEW.tenant_id, NEW.email,
    v_first, v_last,
    NEW.phone, NEW.company,
    NEW.newsletter_opt_in, false
  );

  -- Map form_type to consent-log source_type
  v_source_type := CASE
    WHEN NEW.form_type = 'newsletter' THEN 'newsletter'::crm_source_type
    ELSE 'contact_form'::crm_source_type
  END;

  -- 1) Rich consents captured on the form (array of {key,text,version,given,lang})
  IF NEW.consents IS NOT NULL AND jsonb_typeof(NEW.consents) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.consents)
    LOOP
      IF (v_item ? 'key') AND (v_item ? 'text') THEN
        INSERT INTO public.crm_consent_log (
          tenant_id, email, source_type, source_id, form_id, form_name,
          consent_key, consent_text, consent_version, given, ip, user_agent, lang
        ) VALUES (
          NEW.tenant_id, NEW.email, v_source_type, NEW.id, NEW.form_id, NEW.form_name,
          v_item->>'key',
          v_item->>'text',
          NULLIF(v_item->>'version',''),
          COALESCE((v_item->>'given')::boolean, true),
          NEW.ip, NEW.user_agent, COALESCE(v_item->>'lang', NEW.lang)
        );
      END IF;
    END LOOP;
  END IF;

  -- 2) Fallback: RODO / newsletter flags (only if not already logged via consents[])
  IF NEW.consent = true AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.consents, '[]'::jsonb)) x
     WHERE x->>'key' = 'rodo'
  ) THEN
    INSERT INTO public.crm_consent_log (
      tenant_id, email, source_type, source_id, form_id, form_name,
      consent_key, consent_text, given, ip, user_agent, lang
    ) VALUES (
      NEW.tenant_id, NEW.email, v_source_type, NEW.id, NEW.form_id, NEW.form_name,
      'rodo',
      'Wyrażam zgodę na przetwarzanie moich danych osobowych zgodnie z Polityką prywatności.',
      true, NEW.ip, NEW.user_agent, NEW.lang
    );
  END IF;

  IF NEW.newsletter_opt_in = true AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.consents, '[]'::jsonb)) x
     WHERE x->>'key' = 'newsletter'
  ) THEN
    INSERT INTO public.crm_consent_log (
      tenant_id, email, source_type, source_id, form_id, form_name,
      consent_key, consent_text, given, ip, user_agent, lang
    ) VALUES (
      NEW.tenant_id, NEW.email, v_source_type, NEW.id, NEW.form_id, NEW.form_name,
      'newsletter',
      'Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych.',
      true, NEW.ip, NEW.user_agent, NEW.lang
    );
  END IF;

  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.contact_messages_to_lead() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_messages_to_lead() TO service_role;

COMMENT ON FUNCTION public.contact_messages_to_lead() IS
  'Trigger contact_messages -> CRM: kontakt (crm_upsert_lead, newsletter_status pending przy zaznaczeniu newslettera) i wiersze crm_consent_log z formularza. Od 20261012180900 (R12) NIE nadaje crm_leads.marketing_consent - formularz jest niezweryfikowany; zgode marketingowa w CRM stawia potwierdzenie double opt-in newslettera (newsletter_to_lead).';

-- C) ODZNACZENIE ZGODY MARKETINGOWEJ PRZEZ PERSONEL CRM ----------------------------------
-- Jedno zapytanie: kontakty najemcy wolajacego z listy dostaja
-- `marketing_consent = false`, a KAZDY z nich wiersz given=false w rejestrze
-- zgod - takze kontakt juz odznaczony (wiersz z ta chwila zatrzymuje most
-- wydarzen i przyszly import, gdyby zgoda wrocila ze starszego dowodu).
-- Wynik: liczba kontaktow najemcy objetych zmiana.
CREATE OR REPLACE FUNCTION public.crm_leads_marketing_consent_withdraw(p_lead_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_count integer;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: CRM staff role required';
  END IF;
  -- Ta sama bramka co polityka „Staff update leads" (has_role wiaze role
  -- z najemca z profilu - `current_tenant_id()`).
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'editor')
          OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden: CRM staff role required';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) = 0 THEN
    RETURN 0;
  END IF;
  -- Sufit jak walidator zbiorczej edycji (500 identyfikatorow).
  IF cardinality(p_lead_ids) > 500 THEN
    RAISE EXCEPTION 'invalid_payload: at most 500 contacts at once';
  END IF;

  WITH changed AS (
    UPDATE public.crm_leads l
       SET marketing_consent = false,
           updated_at = now()
     WHERE l.tenant_id = v_tenant
       AND l.id = ANY (p_lead_ids)
    RETURNING l.id, COALESCE(NULLIF(btrim(l.email), ''), l.email_norm) AS email
  )
  INSERT INTO public.crm_consent_log (
    tenant_id, email, source_type, source_id, form_id, form_name,
    consent_key, consent_text, consent_version, given, ip, user_agent, lang
  )
  SELECT v_tenant, c.email, 'other'::public.crm_source_type, c.id,
         'crm_staff:withdraw', 'staff',
         'marketing',
         'Marketing consent withdrawn in the CRM by staff (manual change, e.g. on the contact''s request).',
         NULL, false, NULL, NULL, NULL
    FROM changed c
   WHERE c.email IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) IS
  'R12 (REG-14): personel CRM (admin/editor/super_admin w najemcy z profilu) odznacza zgode marketingowa kontaktow ({p_lead_ids}, najwyzej 500): marketing_consent = false i wiersz crm_consent_log given=false (consent_key marketing, form_id crm_staff:withdraw, form_name staff) dla kazdego kontaktu najemcy - most wydarzen nie wskrzesza wtedy zgody. Kontakty innego najemcy pomijane. Zwraca liczbe objetych kontaktow. Najemca z current_tenant_id(), nigdy z ladunku.';
