-- events-harness: include
-- ============================================================================
-- SCALENIE Z MAIN (PR #504), RUNDA 4, CZ. 1: ZGODA PARTNERSKA PER ZGLOSZENIE =
-- REG-02/REG-04/REG-14, D2/D4/D5 (REG) + OPS-01 (main).
--
-- POCHODZENIE
--   * REG: 20261012140100 (D2) - `event_register(jsonb)` jest wrapperem
--     zgodnosci na rdzen `_event_register`, TYLKO service_role (przegladarka
--     zapisuje przez `submitEventRegistration` -> `event_register_for_client`);
--     20261012130700 (A2, D5) - jedyne udzielenie (`_event_person_consents_
--     confirm`) i jedyne wycofanie (`_event_person_consents_withdraw`) zgod
--     marketingu i partnerow: ksiega append-only, projekcja w `event_people`,
--     zgoda skuteczna tylko kanalem zweryfikowanym (konto D1 albo link DOI),
--     formularz NIGDY nie czysci `consent_withdrawn_at`.
--   * main: 20261013110000 (fundament OPS-01: `event_registrations.
--     consent_partner_sharing_at` / `consent_partner_withdrawn_at`,
--     `_event_partner_consent_at` - jedyne zrodlo prawdy czytelnikow),
--     20261013110100 (pisarze: `event_register(jsonb)` - cialo legacy
--     z 20261007140400 stemplujace zgloszenie przy KAZDYM zaznaczeniu
--     i czyszczace wycofanie przy zaznaczonym marketingu,
--     `_event_partner_consent_carry_withdrawal`), 20261013110200 (czytelnicy:
--     skan leada, link sponsora, eksport, raporty, statystyki),
--     20261013110400 (wycofanie per wydarzenie: klucz samoobslugi i panel).
--
-- DEFEKT (stan po samym scaleniu)
--   * replay (nazwy): 20261013110100 biegnie PO 20261012140100 - jego cialo
--     legacy wygrywa: `event_register` znow czyta `ip_hash`/`user_agent`
--     z ladunku jako dowod zgody, zmienia istniejaca osobe przy
--     niezweryfikowanym zapisie (D4) i ujawnia poswiadczenia (D3) - ACL zostaje
--     service_role (CREATE OR REPLACE), ale wrapper przestaje byc wrapperem;
--   * produkcja (main wdrozony): wrapper REG wygrywa, ale rdzen REG nie zna
--     zgody per zgloszenie - zgoda udzielona po REG (konto albo DOI) trafia
--     tylko do projekcji osoby, ktorej czytelnicy main juz nie czytaja (lead
--     bez tozsamosci mimo zgody); wycofanie celu `partner_sharing` z rejestru
--     (klucz, konto, link wypisu) NIE stempluje zgloszen, wiec przy
--     zachowanym marketingu (`consent_withdrawn_at` NULL) sponsor dalej
--     dostaje e-mail i telefon (WYCIEK - wycofanie bez skutku);
--   * w obu kolejnosciach: DOI zdejmujacy globalne wycofanie (`consent_
--     withdrawn_at = NULL`) wskrzesza stara zgode partnerska wczesniejszych
--     zgloszen, bo nic nie przenosi wycofania na zgloszenia (main robi to
--     w swoim `event_register` - ktorego REG nie uzywa).
--
-- ZMIANA (unia; najnowsze ciala, zmiany oznaczone "ZMIANA (scalenie z main,
--   OPS-01 ...)")
--   * `event_register(jsonb)` = wrapper REG 20261012140100 bez zmian, granty
--     D2 (REVOKE PUBLIC, anon, authenticated; GRANT service_role). Intencja
--     main (zgoda NA TO wydarzenie w zgloszeniu, wycofanie nie znika przy
--     kolejnym zapisie) realizuje rejestr ponizej - jedna sciezka dla
--     `event_register_for_client` i wrappera.
--   * `_event_person_consents_confirm` - cialo REG 20261012130700 +
--     (a) przed zdjeciem globalnego wycofania przez DOI:
--     `_event_partner_consent_carry_withdrawal` (main 20261013110100);
--     (b) zgoda `partner_sharing` udzielona ZWERYFIKOWANYM kanalem stempluje
--     `consent_partner_sharing_at` zgloszenia, przy ktorym ja zebrano
--     (`p_registration`: zapis kontem D1, link DOI wydany dla zgloszenia);
--     zgoda juz skuteczna zachowuje date nadania. Niezweryfikowane
--     zaznaczenie stempla NIE daje (D5 zaostrza regule main: main stemplowal
--     kazde zaznaczenie - to otwieraloby dane sponsorom bez weryfikacji).
--   * `_event_person_consents_withdraw` - cialo REG 20261012130700 + wycofanie
--     `partner_sharing` stempluje `consent_partner_withdrawn_at` na KAZDYM
--     zgloszeniu osoby ze skuteczna zgoda (stempel nadania zostaje).
--   Wycofanie per wydarzenie z main (`event_registration_partner_consent_
--   withdraw`, `admin_..._partner_consent_withdraw`) zostaje bez zmian: zaweza
--   zgode do zgloszen JEDNEGO wydarzenia i nie dotyka rejestru osoby (wpis
--   ksiegi oznaczalby wycofanie wszystkich wydarzen).
--
-- CZEGO TO NIE ZAMYKA. Zgloszenia ostemplowane przez cialo main
--   (`event_register` z 20261013110100) miedzy wdrozeniem main a REG zostaja
--   jak sa - ten sam status co zgody legacy w rejestrze (`legacy_single_opt_in`,
--   20261012130600). Strona samoobslugi pokazuje dwie drogi wycofania: per
--   wydarzenie (karta main) i z rejestru (gniazdo zgod REG).
-- KOLEJNOSC WDROZENIA: PO wszystkich migracjach main i REG (sortuje sie po
--   20261013112700 i 20261012190100), PRZED 20261013900900. Wzgledem kodu:
--   NAJPIERW KOD dla wrappera (przegladarka i tak go juz nie wola - D2).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/reg_main_merge_test.sql (H1-H6), harness
--   33_partner_consent_per_registration.sql (main), 23_consent_ledger.sql,
--   26_consent_confirm_withdraw.sql, 20_registration.sql (REG),
--   supabase/tests/event_consent_ledger_test.sql, event_consent_writers_test.sql.
-- ============================================================================

-- A) WRAPPER ZGODNOSCI (D2) -----------------------------------------------------
-- Cialo z 20261012140100 (REG) bez zmian.

CREATE OR REPLACE FUNCTION public.event_register(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  v := public._event_register(public.public_tenant_id(), auth.uid(), NULL, NULL, p_payload, false);
  IF v->>'outcome' = 'already_registered' THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;
  -- Pudlo kodu wraca wartoscia `{ok:false, error}`, jak dotad.
  IF v->>'outcome' IS DISTINCT FROM 'created' THEN
    RETURN v;
  END IF;
  RETURN v - ARRAY['ok', 'outcome', 'verified', 'recipient', 'event', 'consent_confirmation']::text[];
END;
$$;

REVOKE ALL ON FUNCTION public.event_register(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_register(jsonb) TO service_role;

COMMENT ON FUNCTION public.event_register(jsonb) IS
  'Wrapper zgodnosci zapisu na wydarzenie - TYLKO service_role (od 20261012140100; dotad anon). Najemca z hosta, konto z JWT, bez skrotu adresu i bez kubelka; ten sam rdzen _event_register. already_registered jako wyjatek, pudlo kodu jako {ok:false,error}. Przegladarka zapisuje przez submitEventRegistration -> event_register_for_client. Zgoda partnerska per zgloszenie (OPS-01) przez rejestr zgod (_event_person_consents_confirm) - tylko kanalem zweryfikowanym (D5). Unia 20261013900700.';

-- B) UDZIELENIE ZGODY (rejestr A2 + zgloszenie) ---------------------------------
-- Cialo z 20261012130700 (REG). ZMIANA (scalenie z main, OPS-01) oznaczona.

CREATE OR REPLACE FUNCTION public._event_person_consents_confirm(
  p_tenant uuid,
  p_person uuid,
  p_purposes text[],
  p_evidence text,
  p_event uuid,
  p_registration uuid,
  p_confirmation uuid,
  p_text_version integer,
  p_lang text,
  p_ip_subject text,
  p_user_agent text,
  p_actor uuid,
  p_source text,
  p_project boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_purposes text[];
  v_purpose text;
  v_person public.event_people%ROWTYPE;
  v_conf public.event_consent_confirmations%ROWTYPE;
  v_event uuid := p_event;
  v_reg_event uuid;
  v_version integer := p_text_version;
  v_lang text := p_lang;
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), 400);
  v_source text := left(NULLIF(btrim(COALESCE(p_source, '')), ''), 200);
  v_grants boolean;
BEGIN
  IF p_tenant IS NULL OR p_person IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and person are required';
  END IF;
  IF p_purposes IS NULL OR cardinality(p_purposes) = 0 OR EXISTS (
       SELECT 1 FROM unnest(p_purposes) AS u(x)
        WHERE u.x IS NULL OR u.x NOT IN ('data_processing', 'marketing', 'partner_sharing')
     ) THEN
    RAISE EXCEPTION 'invalid_consent_purpose: purposes must be data_processing, marketing or partner_sharing';
  END IF;
  v_purposes := ARRAY(SELECT DISTINCT u.x FROM unnest(p_purposes) AS u(x) ORDER BY 1);
  -- Udzielic mozna tylko tymi kanalami. Formularz (`registration_form`)
  -- przechodzi te bramke, ale ksiega przyjmie go WYLACZNIE dla
  -- `data_processing` - CHECK `event_consent_records_verified_grant` odrzuci
  -- marketing i partnerow z formularza niezaleznie od tego, kto wola.
  -- Spadek (`legacy_single_opt_in`) pisze tylko migracja.
  IF p_evidence IS NULL OR p_evidence NOT IN ('registration_form', 'verified_account', 'email_double_opt_in') THEN
    RAISE EXCEPTION 'invalid_consent_evidence: % cannot grant a consent', COALESCE(p_evidence, 'NULL');
  END IF;
  IF p_ip_subject IS NOT NULL AND p_ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;

  -- DOI: dowodem jest link z maila, wiec musi istniec w tym najemcy, nalezec do
  -- tej osoby, byc juz ostemplowany jako potwierdzony (RPC potwierdzenia
  -- stempluje go przed wywolaniem) i obejmowac kazdy udzielany cel. Tekst
  -- i jezyk wpisu bierzemy z linku - to on byl pokazany przy wydaniu.
  IF p_evidence = 'email_double_opt_in' THEN
    SELECT c.* INTO v_conf
      FROM public.event_consent_confirmations c
     WHERE c.tenant_id = p_tenant AND c.id = p_confirmation;
    IF NOT FOUND
       OR v_conf.person_id <> p_person
       OR v_conf.confirmed_at IS NULL
       OR NOT (v_purposes <@ v_conf.purposes) THEN
      RAISE EXCEPTION 'invalid_payload: double opt-in requires a confirmed link of this person covering every purpose';
    END IF;
    IF v_version IS NULL AND v_lang IS NULL THEN
      v_version := v_conf.text_version;
      v_lang := v_conf.text_lang;
    ELSIF v_version IS DISTINCT FROM v_conf.text_version OR v_lang IS DISTINCT FROM v_conf.text_lang THEN
      RAISE EXCEPTION 'invalid_payload: double opt-in text differs from the confirmed link';
    END IF;
  END IF;

  FOREACH v_purpose IN ARRAY v_purposes LOOP
    PERFORM public._event_consent_text_check(v_purpose, v_version, v_lang);
  END LOOP;

  -- Blokada wiersza osoby: projekcja i decyzja o wycofaniu na jednym obrazie
  -- (rownolegle wycofanie czeka albo widzi juz nasz wpis). NO KEY: zmieniamy
  -- wylacznie kolumny zgod, wiec nie blokujemy kontroli kluczy obcych
  -- (rownolegly zapis zgloszenia tej osoby nie czeka na rejestr zgod).
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: person does not exist';
  END IF;
  IF v_person.email_norm IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: person has no e-mail address';
  END IF;

  -- DOI potwierdza SKRZYNKE, do ktorej poszedl mail. Gdy organizator zmienil
  -- w miedzyczasie adres osoby albo link potwierdzono po terminie, link nie
  -- jest dowodem dla obecnej kartoteki. RPC potwierdzenia (B3) odrzuca oba
  -- przypadki wczesniej jako `expired`; tu druga linia obrony, zeby zaden
  -- przyszly wolajacy nie udzielil zgody nie tej skrzynce.
  IF p_evidence = 'email_double_opt_in'
     AND (v_conf.email_norm <> v_person.email_norm OR v_conf.confirmed_at > v_conf.expires_at) THEN
    RAISE EXCEPTION 'invalid_payload: double opt-in link was issued for another address or confirmed after expiry';
  END IF;

  -- Zgloszenie musi nalezec do tej osoby, a wydarzenie - do zgloszenia: wpis
  -- ksiegi nie moze wskazywac cudzego zapisu jako okolicznosci zgody.
  IF p_registration IS NOT NULL THEN
    SELECT r.event_id INTO v_reg_event
      FROM public.event_registrations r
     WHERE r.tenant_id = p_tenant AND r.id = p_registration AND r.person_id = p_person;
    IF NOT FOUND OR (v_event IS NOT NULL AND v_event <> v_reg_event) THEN
      RAISE EXCEPTION 'invalid_payload: registration does not belong to the person';
    END IF;
    v_event := v_reg_event;
  END IF;

  v_grants := v_purposes && ARRAY['marketing', 'partner_sharing']::text[];

  -- Marketing i partnerzy zawsze z projekcja: wpis 'confirmed' bez stempla
  -- w kartotece rozjechalby ksiege z tym, co czytaja sponsorzy i most CRM.
  -- Pominiecie projekcji ma sens wylacznie dla zgody na przetwarzanie danych.
  IF v_grants AND NOT COALESCE(p_project, true) THEN
    RAISE EXCEPTION 'invalid_payload: marketing and partner consents are always projected';
  END IF;

  -- LEPKIE WYCOFANIE. Osoba, ktora wycofala wszystko, odzyskuje zgode
  -- marketingu/partnerow tylko klikajac link z maila. Zaznaczenie pola przez
  -- zalogowanego wlasciciela nie wystarcza - wolajacy sprawdza stan wczesniej
  -- i wydaje link DOI zamiast tego wywolania.
  IF v_grants AND p_evidence = 'verified_account' AND v_person.consent_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'consent_withdrawn_requires_reconfirmation: this person withdrew consents; only the e-mail confirmation link can restore them';
  END IF;

  INSERT INTO public.event_consent_records (
    tenant_id, person_id, event_id, registration_id, confirmation_id, email_norm,
    purpose, status, evidence, text_version, text_lang, ip_subject, user_agent,
    actor_user_id, source
  )
  SELECT p_tenant, p_person, v_event, p_registration, p_confirmation, v_person.email_norm,
         u.x, 'confirmed', p_evidence, v_version, v_lang, p_ip_subject, v_user_agent,
         p_actor, v_source
    FROM unnest(v_purposes) AS u(x)
   ORDER BY u.x;

  -- PROJEKCJA. `p_project = false` zostawia sam wpis ksiegi - tak wolajacy
  -- zapisuje zgode na przetwarzanie danych osoby, ktorej kartoteki nie wolno mu
  -- zmieniac (niezweryfikowany zapis na istniejaca osobe, REG-02 / D4).
  IF COALESCE(p_project, true) THEN
    -- ZMIANA (scalenie z main, OPS-01 z 20261013110100): zanim DOI zdejmie
    -- GLOBALNE wycofanie osoby, wycofanie przechodzi na jej zgloszenia ze
    -- zgoda partnerska nie pozniejsza niz ono (`consent_partner_withdrawn_at`).
    -- Bez tego wyczyszczenie `consent_withdrawn_at` wskrzesiloby stara zgode
    -- partnerska kazdego wczesniejszego zgloszenia (czytelnicy main pytaja
    -- `_event_partner_consent_at`, ktory porownuje ze stemplem osoby).
    IF v_grants AND p_evidence = 'email_double_opt_in' AND v_person.consent_withdrawn_at IS NOT NULL THEN
      PERFORM public._event_partner_consent_carry_withdrawal(p_tenant, p_person);
    END IF;

    -- Wyjscie z GLOBALNEGO wycofania dociera tu wylacznie z DOI (kanal konta
    -- odpada wyzej, formularz nie przejdzie CHECK-a ksiegi). Cele spoza linku
    -- zostaja wyzerowane: stary stempel sprzed wycofania nie wraca.
    UPDATE public.event_people p SET
      consent_data_processing_at = CASE
        WHEN 'data_processing' = ANY (v_purposes) THEN COALESCE(p.consent_data_processing_at, now())
        ELSE p.consent_data_processing_at
      END,
      consent_marketing_at = CASE
        WHEN v_grants AND p.consent_withdrawn_at IS NOT NULL THEN
          CASE WHEN 'marketing' = ANY (v_purposes) THEN now() END
        WHEN 'marketing' = ANY (v_purposes) THEN COALESCE(p.consent_marketing_at, now())
        ELSE p.consent_marketing_at
      END,
      consent_partner_sharing_at = CASE
        WHEN v_grants AND p.consent_withdrawn_at IS NOT NULL THEN
          CASE WHEN 'partner_sharing' = ANY (v_purposes) THEN now() END
        WHEN 'partner_sharing' = ANY (v_purposes) THEN COALESCE(p.consent_partner_sharing_at, now())
        ELSE p.consent_partner_sharing_at
      END,
      consent_withdrawn_at = CASE
        WHEN v_grants AND p_evidence = 'email_double_opt_in' THEN NULL
        ELSE p.consent_withdrawn_at
      END
     WHERE p.tenant_id = p_tenant AND p.id = p_person;

    -- ZMIANA (scalenie z main, OPS-01 z 20261013110000/110100): zgoda
    -- partnerska jest per ZGLOSZENIE - o przekazaniu danych partnerowi
    -- wydarzenia rozstrzyga `_event_partner_consent_at` (stempel zgloszenia),
    -- a stempel osoby zostaje historyczny. Zgode udzielona ZWERYFIKOWANYM
    -- kanalem (konto D1 albo link DOI - D5) stemplujemy na zgloszeniu, przy
    -- ktorym ja zebrano (formularz zapisu, link wydany dla tego zgloszenia).
    -- Niezweryfikowany zapis z zaznaczona zgoda partnerska NIE dostaje stempla
    -- (main stemplowal kazde zaznaczenie) - dopiero klikniecie linku z maila.
    -- Zgoda juz skuteczna w tym zgloszeniu zachowuje date nadania (dowod).
    IF 'partner_sharing' = ANY (v_purposes) AND p_registration IS NOT NULL THEN
      UPDATE public.event_registrations r
         SET consent_partner_sharing_at = CASE
               WHEN r.consent_partner_sharing_at IS NOT NULL
                AND (r.consent_partner_withdrawn_at IS NULL
                     OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at)
               THEN r.consent_partner_sharing_at
               ELSE now()
             END
       WHERE r.tenant_id = p_tenant
         AND r.id = p_registration
         AND r.person_id = p_person;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._event_person_consents_confirm(
  uuid, uuid, text[], text, uuid, uuid, uuid, integer, text, text, text, uuid, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_consents_confirm(
  uuid, uuid, text[], text, uuid, uuid, uuid, integer, text, text, text, uuid, text, boolean
) TO service_role;

COMMENT ON FUNCTION public._event_person_consents_confirm(
  uuid, uuid, text[], text, uuid, uuid, uuid, integer, text, text, text, uuid, text, boolean
) IS
  'Wewnetrzna (service_role i funkcje SECURITY DEFINER). Jedyne udzielenie zgody uczestnika: wpis confirmed w event_consent_records na kazdy cel + projekcja w event_people (p_project = false: sam wpis). Kanaly: registration_form (wylacznie data_processing - CHECK ksiegi), verified_account (wolajacy sprawdzil potwierdzony adres konta = adres osoby; przy consent_withdrawn_at RAISE consent_withdrawn_requires_reconfirmation), email_double_opt_in (link tej osoby potwierdzony przed wygasnieciem, wydany na jej obecny adres; zdejmuje wycofanie - najpierw przenosi je na zgloszenia (_event_partner_consent_carry_withdrawal) - i zeruje cele spoza linku). Zgoda partner_sharing stempluje consent_partner_sharing_at zgloszenia p_registration (OPS-01; zgoda juz skuteczna zachowuje date). Tozsamosc i adres IP wylacznie z argumentow serwera, nigdy z ladunku. Unia 20261013900700.';

-- C) WYCOFANIE (rejestr A2 + zgloszenia) ----------------------------------------
-- Cialo z 20261012130700 (REG). ZMIANA (scalenie z main, OPS-01) oznaczona.

CREATE OR REPLACE FUNCTION public._event_person_consents_withdraw(
  p_tenant uuid,
  p_person uuid,
  p_purposes text[],
  p_evidence text,
  p_ip_subject text,
  p_user_agent text,
  p_actor uuid,
  p_source text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_purposes text[];
  v_person public.event_people%ROWTYPE;
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), 400);
  v_source text := left(NULLIF(btrim(COALESCE(p_source, '')), ''), 200);
  v_changed boolean;
  v_both boolean;
  v_superseded integer;
  v_reg_withdrawn integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_person IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and person are required';
  END IF;
  IF p_purposes IS NULL OR cardinality(p_purposes) = 0 OR EXISTS (
       SELECT 1 FROM unnest(p_purposes) AS u(x)
        WHERE u.x IS NULL OR u.x NOT IN ('marketing', 'partner_sharing')
     ) THEN
    RAISE EXCEPTION 'invalid_consent_purpose: only marketing and partner_sharing can be withdrawn';
  END IF;
  v_purposes := ARRAY(SELECT DISTINCT u.x FROM unnest(p_purposes) AS u(x) ORDER BY 1);
  IF p_evidence IS NULL OR p_evidence NOT IN ('manage_token', 'account_settings', 'unsubscribe_link') THEN
    RAISE EXCEPTION 'invalid_consent_evidence: % cannot withdraw a consent', COALESCE(p_evidence, 'NULL');
  END IF;
  IF p_ip_subject IS NOT NULL AND p_ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person
   FOR NO KEY UPDATE;
  -- Wycofanie nigdy nie rzuca z braku osoby: link wypisu i klucz samoobslugi
  -- moga przezyc kartoteke (usuniecie danych). Nie ma czego wycofac.
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_changed := ('marketing' = ANY (v_purposes) AND v_person.consent_marketing_at IS NOT NULL)
            OR ('partner_sharing' = ANY (v_purposes) AND v_person.consent_partner_sharing_at IS NOT NULL);
  IF 'marketing' = ANY (v_purposes) AND v_person.email_norm IS NOT NULL THEN
    v_changed := v_changed OR EXISTS (
      SELECT 1 FROM public.crm_leads l
       WHERE l.tenant_id = p_tenant AND l.email_norm = v_person.email_norm AND l.marketing_consent
    );
  END IF;

  -- Wycofanie zapisujemy ZAWSZE, takze gdy nic nie bylo aktywne: to dowod
  -- zadania osoby i punkt odciecia dla mostu CRM.
  INSERT INTO public.event_consent_records (
    tenant_id, person_id, email_norm, purpose, status, evidence,
    ip_subject, user_agent, actor_user_id, source
  )
  SELECT p_tenant, p_person, v_person.email_norm, u.x, 'withdrawn', p_evidence,
         p_ip_subject, v_user_agent, p_actor, v_source
    FROM unnest(v_purposes) AS u(x)
   ORDER BY u.x;

  -- GLOBALNE WYCOFANIE (`consent_withdrawn_at`) = po tym wpisie NAJNOWSZY
  -- rozstrzygajacy wpis obu celow to 'withdrawn'. Liczy sie stan ksiegi, nie
  -- sam zakres tego zadania: "wypisz z marketingu" dzis i "nie udostepniaj
  -- partnerom" jutro to tez wycofanie wszystkiego. Cel, na ktory osoba nigdy
  -- sie nie zgodzila, nie ma wpisu - wycofanie samego marketingu go nie
  -- dotyka i nie blokuje pozniejszej zgody kanalem konta.
  v_both := NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY['marketing', 'partner_sharing']::text[]) AS g(purpose)
     WHERE COALESCE((
             SELECT r.status
               FROM public.event_consent_records r
              WHERE r.tenant_id = p_tenant
                AND r.person_id = p_person
                AND r.purpose = g.purpose
                AND r.status IN ('confirmed', 'withdrawn')
              ORDER BY r.seq DESC
              LIMIT 1
           ), 'none') <> 'withdrawn'
  );

  UPDATE public.event_people p SET
    consent_marketing_at = CASE
      WHEN 'marketing' = ANY (v_purposes) THEN NULL
      ELSE p.consent_marketing_at
    END,
    consent_partner_sharing_at = CASE
      WHEN 'partner_sharing' = ANY (v_purposes) THEN NULL
      ELSE p.consent_partner_sharing_at
    END,
    consent_withdrawn_at = CASE
      WHEN v_both THEN COALESCE(p.consent_withdrawn_at, now())
      ELSE p.consent_withdrawn_at
    END
   WHERE p.tenant_id = p_tenant AND p.id = p_person;

  -- ZMIANA (scalenie z main, OPS-01 z 20261013110000/110400): czytelnicy
  -- zgody partnerskiej (skan leada, link sponsora, eksport, lista zgloszen)
  -- pytaja `_event_partner_consent_at`, czyli stempla ZGLOSZENIA. Wycofanie
  -- celu `partner_sharing` z rejestru (klucz, konto, link wypisu) dotyczy
  -- osoby, wiec stempluje wycofanie na KAZDYM jej zgloszeniu ze skuteczna
  -- zgoda - takze gdy marketing zostaje (globalny `consent_withdrawn_at`
  -- tego nie pokryje). Stempla nadania nie kasujemy (dowod potrzebuje obu dat).
  IF 'partner_sharing' = ANY (v_purposes) THEN
    UPDATE public.event_registrations r
       SET consent_partner_withdrawn_at = now()
     WHERE r.tenant_id = p_tenant
       AND r.person_id = p_person
       AND r.consent_partner_sharing_at IS NOT NULL
       AND (r.consent_partner_withdrawn_at IS NULL
            OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at);
    GET DIAGNOSTICS v_reg_withdrawn = ROW_COUNT;
  END IF;

  -- Otwarty link DOI, ktory obejmuje choc jeden wycofywany cel, przestaje
  -- dzialac w calosci: stary mail nie moze cofnac swiezego wycofania.
  UPDATE public.event_consent_confirmations c
     SET superseded_at = now()
   WHERE c.tenant_id = p_tenant
     AND c.person_id = p_person
     AND c.confirmed_at IS NULL
     AND c.superseded_at IS NULL
     AND c.purposes && v_purposes;
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  IF 'marketing' = ANY (v_purposes) THEN
    PERFORM public._event_person_consent_crm_withdraw(
      p_tenant, p_person, p_evidence, p_ip_subject, v_user_agent
    );
  END IF;

  RETURN v_changed OR v_superseded > 0 OR v_reg_withdrawn > 0;
END;
$$;

REVOKE ALL ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text) IS
  'Wewnetrzna (service_role i funkcje SECURITY DEFINER). Jedyne wycofanie zgod marketing/partner_sharing: wpisy withdrawn (kanaly manage_token, account_settings, unsubscribe_link), zerowanie kolumn celow w event_people, consent_withdrawn_at gdy oba cele sa w ksiedze wycofane, zastapienie otwartych linkow DOI z tymi celami, dla marketingu _event_person_consent_crm_withdraw, dla partner_sharing consent_partner_withdrawn_at na kazdym zgloszeniu osoby ze skuteczna zgoda (OPS-01). Zwraca true, gdy cos bylo aktywne (projekcja, zgoda w CRM, zgoda zgloszenia albo otwarty link); false, gdy osoby nie ma albo nic nie bylo aktywne. Wolajacy nie ujawnia wyniku klientowi. Unia 20261013900700.';
