-- events-harness: include
-- ============================================================================
-- ZAPIS NA WYDARZENIE - POPRAWKI PO PRZEGLADZIE R38 (CZESC 1): ZNAKI STERUJACE
-- ODRZUCANE PRZED WYSZUKANIEM OSOBY, `submitted_profile` MIERZONY DLA KAZDEGO,
-- NOWA OSOBA ODPORNA NA WYSCIG DWOCH PIERWSZYCH ZAPISOW.
--
-- DEFEKT (latest: `_event_register`, 20261012140000_event_register_core.sql:211-887)
--   1. REG-04 (wyrocznia kartoteki). Sufity pol liczyly znaki, ale nie
--      odrzucaly znakow sterujacych. W tekscie jsonb kazdy z nich rosnie do
--      szesciu znakow (`\u0001`), wiec 200 x U+0001 w firmie i 492 w profilu
--      przechodzily walidacje, a `submitted_profile` (galaz „osoba istnieje,
--      wolajacy nie jest wlascicielem", :739-758) przekraczal CHECK
--      `event_registrations_submitted_profile_shape` (4000 znakow). Adres
--      znany kartotece najemcy dostawal `unknown`, swiezy i juz zapisany -
--      `check_email`: 12 prob na 10 minut z jednego adresu IP odpowiadalo, czy
--      adres jest w kartotece (prelegent, CFP, import, CRM).
--   2. Wyscig pierwszych zapisow nowego adresu (:666-671, :717-727): obie
--      sesje widzialy brak osoby i obie ja wstawialy; druga trafiala
--      w `event_people_tenant_email_uniq`, a wejscie (20261012140100:164-173)
--      zamienialo KAZDE naruszenie unikalnosci na „juz zapisany" bez
--      zgloszenia - przegladarka mowila „sprawdz skrzynke", a zapisu i maila
--      nie bylo.
--
-- ZMIANA
--   A. `_event_text_has_control(text)` - JEDNA regula znakow sterujacych
--      (U+0001..U+001F, U+007F..U+009F; U+0000 nie istnieje w `text`).
--      Jawny zakres zamiast klasy `[[:cntrl:]]`: klasa zalezy od LC_CTYPE bazy,
--      a TS (`hasControlCharacters`) musi liczyc dokladnie to samo.
--   B. `_event_register` (CREATE OR REPLACE na ciele 20261012140000, zmiany
--      oznaczone `ZMIANA 20261012 (R38...)`): znak sterujacy w imieniu,
--      nazwisku, adresie, telefonie, stanowisku, firmie albo profilu to odmowa
--      kodem pola (`invalid_name`, `invalid_email`, `invalid_phone`,
--      `invalid_job_title`, `invalid_company`, `invalid_social_url`) PRZED
--      wyszukaniem osoby; `submitted_profile` skladany i mierzony tamze dla
--      kazdego wolajacego; nowa osoba wstawiana przy wyszukaniu przez
--      `ON CONFLICT (tenant_id, email_norm) WHERE email_norm IS NOT NULL DO
--      NOTHING`, a przegrany wyscigu bierze osobe zwyciezcy pod blokada
--      i idzie sciezka osoby istniejacej.
--   Mapowanie naruszen unikalnosci w wejsciu (tylko zgloszenie = „juz
--   zapisany") - 20261012180100.
--
-- CZEGO TO NIE ZAMYKA: kanal czasowy „utworzono" kontra „juz zapisany"
-- (ok. 2,5 ms w bazie, pojedynczy strzal na adres - opisany w notatce
-- jednostki FIX-R38). Znaki niewidoczne spoza kategorii Cc (U+200B, U+2028)
-- nie sa odrzucane - nie zmieniaja dlugosci tekstu jsonb, wiec nie otwieraja
-- wyroczni; to kwestia jakosci danych, nie bezpieczenstwa.
--
-- KOLEJNOSC WDROZENIA: dowolna (kod TS z ta sama regula idzie w tej samej
-- zmianie; stary front dostaje te same kody odmow, ktore juz tlumaczy).
-- Musi wejsc PRZED 20261012190000 (naprawa REG-01 jako ostatni zapis
-- `event_people.user_id`) - slot 20261012180000 to gwarantuje.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_register_oracle_followups_test.sql,
--   scripts/events-harness/runtime_test.d/21_register_oracle_followups.sql
--   (wyscig dwoch sesji dblink).
-- ============================================================================

-- A) JEDNA REGULA ZNAKOW STERUJACYCH -------------------------------------------
-- IMMUTABLE i bez SECURITY DEFINER: czyta wylacznie argument. NULL -> false
-- (pole puste nie zawiera niczego).
CREATE OR REPLACE FUNCTION public._event_text_has_control(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_text ~ '[\u0001-\u001f\u007f-\u009f]', false);
$$;
REVOKE ALL ON FUNCTION public._event_text_has_control(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_text_has_control(text) TO service_role;

COMMENT ON FUNCTION public._event_text_has_control(text) IS
  'R38/REG-04: czy tekst zawiera znak sterujacy (U+0001..U+001F, U+007F..U+009F) - jedna regula dla zapisu, gosci grupy i zaproszen; lustro TS hasControlCharacters (registrationFieldLimits.ts). NULL = false. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- B) RDZEN ZAPISU -------------------------------------------------------------------
-- Cialo z 20261012140000:211-887; zmiany oznaczone `ZMIANA 20261012 (R38...)`.
CREATE OR REPLACE FUNCTION public._event_register(
  p_tenant uuid,
  p_uid uuid,
  p_ip_subject text,
  p_user_agent text,
  p_payload jsonb,
  p_issue_confirmation boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  -- ZMIANA 20261012 (REG-04): najemca i konto z ARGUMENTOW. Serwer zna je
  -- z zaufanego hosta i zweryfikowanej sesji; klient z kluczem serwisowym nie
  -- niesie hosta, wiec `public_tenant_id()` wskazalby najemce domyslnego.
  v_tenant uuid := p_tenant;
  v_uid uuid := p_uid;
  v_event public.events;
  v_ticket public.event_ticket_types;
  v_person public.event_people;
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid;
  v_ticket_id uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_phone text := NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '');
  v_job text := NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '');
  v_social text := NULLIF(btrim(COALESCE(p_payload->>'social_profile_url', '')), '');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_marketing boolean := lower(COALESCE(p_payload->>'consent_marketing', '')) IN ('true', 't', '1');
  v_partner boolean := lower(COALESCE(p_payload->>'consent_partner_sharing', '')) IN ('true', 't', '1');
  v_data_ok boolean := lower(COALESCE(p_payload->>'consent_data_processing', '')) IN ('true', 't', '1');
  v_access_code text := upper(btrim(COALESCE(p_payload->>'access_code', '')));
  v_reveal_code text := upper(btrim(COALESCE(p_payload->>'reveal_code', '')));
  v_lang_raw text := lower(btrim(COALESCE(p_payload->>'lang', '')));
  v_version_raw text := btrim(COALESCE(p_payload->>'consent_text_version', ''));
  -- ZMIANA 20261012 (REG-14): dowod adresu i przegladarki WYLACZNIE
  -- z argumentow serwera. `ip_hash` i `user_agent` z ladunku sa ignorowane.
  -- CHECK `event_term_acceptances_ip_hash_shape` przyjmuje gole hex, wiec do
  -- akceptacji regulaminu idzie czesc po `ip:`.
  v_ip_hex text := substring(p_ip_subject from '^ip:([0-9a-f]{32})$');
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), 400);
  v_lang text;
  v_text_version integer;
  v_purposes text[] := ARRAY[]::text[];
  v_text_purpose text;
  v_accepted uuid[];
  v_active_tickets integer;
  v_event_json jsonb;
  v_verified boolean;
  v_owner boolean;
  v_new_person boolean;
  v_bind_uid uuid;
  v_existing_id uuid;
  v_submitted jsonb;
  v_submitted_profile jsonb;
  v_missing text[];
  v_verdict text;
  v_status text;
  v_decision_source text;
  v_group_id uuid;
  v_seats_left integer;
  v_position integer;
  v_token text;
  v_manage text;
  v_reg_id uuid;
  v_price integer := 0;
  v_payment text := 'not_required';
  v_quote_until timestamptz;
  v_consent_token text;
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: registration payload must be a JSON object';
  END IF;

  IF length(p_payload::text) > 65536 THEN
    RAISE EXCEPTION 'payload_too_large: registration payload exceeds 64 kB';
  END IF;

  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  -- ZMIANA 20261012 (REG-04, AGENTS.md): SUFITY POL - te same liczby co
  -- CHECK-i `event_people` i `REGISTRATION_FIELD_LIMITS` (TS). Za dlugie pole
  -- to ODMOWA, nigdy przyciecie - i odmowa przed jakimkolwiek odczytem, wiec
  -- nowa i istniejaca osoba dostaja ten sam kod (wczesniej przekroczenie
  -- padalo dopiero na CHECK-u wstawianego wiersza, a nie na aktualizacji).
  IF v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are required';
  END IF;
  IF char_length(v_first) > 80 OR char_length(v_last) > 80 THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are at most 80 characters';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid e-mail address is required';
  END IF;
  IF char_length(v_email) > 320 THEN
    RAISE EXCEPTION 'invalid_email: the e-mail address is at most 320 characters';
  END IF;

  IF v_phone IS NOT NULL AND char_length(v_phone) NOT BETWEEN 4 AND 40 THEN
    RAISE EXCEPTION 'invalid_phone: the phone number has 4 to 40 characters';
  END IF;
  IF v_job IS NOT NULL AND char_length(v_job) > 160 THEN
    RAISE EXCEPTION 'invalid_job_title: the job title is at most 160 characters';
  END IF;
  IF v_company IS NOT NULL AND char_length(v_company) > 200 THEN
    RAISE EXCEPTION 'invalid_company: the organisation name is at most 200 characters';
  END IF;

  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;

  IF v_social IS NOT NULL AND (v_social !~ '^https://' OR char_length(v_social) > 500) THEN
    RAISE EXCEPTION 'invalid_social_url: the profile address must start with https:// and have at most 500 characters';
  END IF;

  -- ZMIANA 20261012 (R38, REG-04): ZNAKI STERUJACE (C0, DEL, C1) to odmowa
  -- kodem POLA, tu - zanim baza w ogole spojrzy na adres. Wczesniej
  -- przechodzily sufity (jeden znak), ale w tekscie jsonb `submitted_profile`
  -- kazdy rosl do szesciu (`\u0001`), wiec CHECK 4000 znakow pekal WYLACZNIE
  -- na galezi „osoba istnieje, wolajacy nie jest wlascicielem": znany adres
  -- dostawal `unknown`, swiezy - `check_email`. Ta sama regula co TS
  -- (`hasControlCharacters`, REGISTRATION_FIELD_LIMITS) i goscie grupy.
  IF public._event_text_has_control(v_first) OR public._event_text_has_control(v_last) THEN
    RAISE EXCEPTION 'invalid_name: names cannot contain control characters';
  END IF;
  IF public._event_text_has_control(v_email) THEN
    RAISE EXCEPTION 'invalid_email: the e-mail address cannot contain control characters';
  END IF;
  IF public._event_text_has_control(v_phone) THEN
    RAISE EXCEPTION 'invalid_phone: the phone number cannot contain control characters';
  END IF;
  IF public._event_text_has_control(v_job) THEN
    RAISE EXCEPTION 'invalid_job_title: the job title cannot contain control characters';
  END IF;
  IF public._event_text_has_control(v_company) THEN
    RAISE EXCEPTION 'invalid_company: the organisation name cannot contain control characters';
  END IF;
  IF public._event_text_has_control(v_social) THEN
    RAISE EXCEPTION 'invalid_social_url: the profile address cannot contain control characters';
  END IF;

  -- ZMIANA 20261012 (R38, REG-04): `submitted_profile` SKLADANY I MIERZONY TU,
  -- dla KAZDEGO wolajacego, a nie dopiero na galezi cudzej kartoteki. Galaz
  -- osoby istniejacej nie moze juz upasc tam, gdzie galaz nowej osoby
  -- przechodzi. Bez znakow sterujacych najgorszy przypadek (cudzyslowy
  -- i ukosniki - po dwa znaki w tekscie jsonb, wszystkie pola na sufitach) to
  -- okolo 2,2 tys. znakow, wiec ta odmowa jest dzis nieosiagalna - pilnuje
  -- jedynie, zeby przyszla zmiana sufitow nie otworzyla wyroczni na nowo.
  v_submitted := jsonb_strip_nulls(jsonb_build_object(
    'first_name', v_first,
    'last_name', v_last,
    'phone', v_phone,
    'job_title', v_job,
    'company_text', v_company,
    'social_profile_url', v_social));
  IF char_length(v_submitted::text) > 4000 THEN
    RAISE EXCEPTION 'invalid_payload: the submitted profile exceeds 4000 characters';
  END IF;

  -- Kod dostepu i kod odslaniajacy maja w bazie najwyzej 64 znaki - dluzszy
  -- nie moze niczego otworzyc, a przyciety moglby trafic w cudzy.
  IF char_length(v_access_code) > 64 OR char_length(v_reveal_code) > 64 THEN
    RAISE EXCEPTION 'invalid_payload: access and reveal codes have at most 64 characters';
  END IF;

  -- ZMIANA 20261012 (REG-14): jezyk formularza i wersja tekstow zgod, ktore
  -- osoba widziala. Brak = `pl` i obowiazujaca wersja; nieznana wersja albo
  -- jezyk to blad wolajacego (formularz wysyla obie wartosci zawsze).
  v_lang := CASE WHEN v_lang_raw = '' THEN 'pl' ELSE v_lang_raw END;
  IF v_lang NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_payload: lang must be pl or en';
  END IF;
  IF v_version_raw = '' THEN
    SELECT t.version INTO v_text_version
      FROM public.event_consent_texts t
     WHERE t.purpose = 'data_processing' AND t.lang = v_lang AND t.retired_at IS NULL;
  ELSIF v_version_raw ~ '^[0-9]{1,6}$' THEN
    v_text_version := v_version_raw::integer;
  ELSE
    RAISE EXCEPTION 'invalid_payload: consent_text_version must be a positive integer';
  END IF;

  IF v_marketing THEN
    v_purposes := v_purposes || 'marketing'::text;
  END IF;
  IF v_partner THEN
    v_purposes := v_purposes || 'partner_sharing'::text;
  END IF;
  BEGIN
    PERFORM public._event_consent_text_check('data_processing', v_text_version, v_lang);
    FOREACH v_text_purpose IN ARRAY v_purposes LOOP
      PERFORM public._event_consent_text_check(v_text_purpose, v_text_version, v_lang);
    END LOOP;
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'invalid_payload: consent text version % (%) is unknown',
      COALESCE(v_text_version::text, '?'), v_lang;
  END;

  -- ZMIANA 20261012 (REG-04): BEZ `rate_limit_hit` kluczowanego ladunkiem.
  -- Kubelki adresu i konta liczy wejscie (`event_register_for_client`) PRZED
  -- rdzeniem i poza jego podtransakcja - odmowa ich nie cofa.

  v_event_id := CASE
    WHEN COALESCE(p_payload->>'event_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'event_id')::uuid
    ELSE NULL
  END;
  v_ticket_id := CASE
    WHEN COALESCE(p_payload->>'ticket_type_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'ticket_type_id')::uuid
    ELSE NULL
  END;

  IF v_event_id IS NULL AND v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id or event_slug is required';
  END IF;

  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_accepted
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'accepted_term_ids') = 'array'
        THEN p_payload->'accepted_term_ids'
      ELSE '[]'::jsonb
    END
  ) AS t(x)
  WHERE x ~ '^[0-9a-fA-F-]{36}$';

  -- KOLEJNOSC BLOKAD: wydarzenie -> bilet -> osoba. Kazdy zapisujacy miejsca
  -- bierze najpierw wydarzenie (decyzja D11), wiec rownolegle zapisy na to
  -- samo wydarzenie ida jeden po drugim.
  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    )
  FOR UPDATE;

  IF v_event.id IS NULL OR v_event.status <> 'published' THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF v_event.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_cancelled: the event has been cancelled';
  END IF;

  -- ZMIANA 20261012 (REG-13, D7): po koncu wydarzenia zapisu nie ma. Ta sama
  -- regula co `event_page_header` i strona wydarzenia: koniec, a bez konca
  -- - start.
  IF COALESCE(v_event.ends_at, v_event.starts_at) < now() THEN
    RAISE EXCEPTION 'event_ended: the event has already ended';
  END IF;

  IF v_event.registration_mode = 'none' THEN
    RAISE EXCEPTION 'registration_disabled: this event does not take registrations';
  END IF;

  IF v_event.registration_mode = 'external' THEN
    RAISE EXCEPTION 'registration_external: registration runs in an external tool';
  END IF;

  IF v_event.rsvp_opens_at IS NOT NULL
     AND v_event.rsvp_opens_at > now()
     AND NOT (
       v_event.early_rsvp_rank IS NOT NULL
       AND public.has_tier_rank(v_event.early_rsvp_rank)
     ) THEN
    RAISE EXCEPTION 'registration_not_open: registration has not opened yet';
  END IF;

  IF v_event.visibility = 'members'
     AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN
    RAISE EXCEPTION 'membership_required: this event is open to members only';
  END IF;

  v_event_json := jsonb_build_object(
    'id', v_event.id,
    'slug', v_event.slug,
    'title_pl', v_event.title_pl,
    'title_en', v_event.title_en,
    'starts_at', v_event.starts_at
  );

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  IF v_ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event.id
    FOR UPDATE;

    IF v_ticket.id IS NULL OR NOT v_ticket.is_active THEN
      RAISE EXCEPTION 'not_found: ticket does not exist for this event';
    END IF;

    -- ZMIANA 20261012 (REG-05, D6): BILET UKRYTY BEZ KODU DOSTEPU otwiera
    -- WYLACZNIE wazny kod odslaniajacy (`reveals_hidden`). Bez kodu - ta sama
    -- odmowa co dla biletu, ktorego nie ma, i to ZANIM padnie cokolwiek
    -- o oknie sprzedazy czy progu czlonkostwa (inaczej odpowiedz zdradzalaby,
    -- ze bilet istnieje). Zly kod to pudlo: straznik przed porownaniem, licznik
    -- biletu, konta i adresu, odpowiedz WARTOSCIA (wyjatek wycofalby licznik).
    IF v_ticket.is_hidden AND v_ticket.access_code_hash IS NULL THEN
      IF v_reveal_code = '' THEN
        RAISE EXCEPTION 'not_found: ticket does not exist for this event';
      END IF;
      PERFORM public._access_code_probe_guard(v_ticket.id, v_uid, p_ip_subject);
      IF NOT public._event_reveal_coupon_covers(v_tenant, v_event.id, v_ticket.id, v_reveal_code) THEN
        PERFORM public._access_code_probe_miss(v_ticket.id, v_uid, p_ip_subject);
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
      END IF;
    END IF;

    IF v_ticket.sales_from IS NOT NULL AND now() < v_ticket.sales_from THEN
      RAISE EXCEPTION 'ticket_not_on_sale: sales for this ticket have not started';
    END IF;
    IF v_ticket.sales_to IS NOT NULL AND now() > v_ticket.sales_to THEN
      RAISE EXCEPTION 'ticket_sales_ended: sales for this ticket are closed';
    END IF;
    IF v_ticket.min_tier_rank > 0 AND NOT public.has_tier_rank(v_ticket.min_tier_rank) THEN
      RAISE EXCEPTION 'ticket_tier_required: this ticket requires a higher membership tier';
    END IF;
    -- Kod dostepu porownujemy po skrocie: jawnego kodu nie ma w bazie, a wielkosc
    -- liter nie moze decydowac o wpuszczeniu na wydarzenie. Pudlo wraca
    -- wartoscia i jest zliczone (20261007140400).
    -- ZMIANA 20261012 (REG-04): straznik i licznik dostaja solony skrot adresu
    -- od serwera - pudla z jednego adresu licza sie takze bez konta.
    IF v_ticket.access_code_hash IS NOT NULL THEN
      IF v_access_code = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_access_code');
      END IF;
      PERFORM public._access_code_probe_guard(v_ticket.id, v_uid, p_ip_subject);
      IF encode(digest(v_access_code, 'sha256'), 'hex') <> v_ticket.access_code_hash THEN
        PERFORM public._access_code_probe_miss(v_ticket.id, v_uid, p_ip_subject);
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_access_code');
      END IF;
    END IF;
    -- CENA WEJSCIOWKI (2026-08-28): platny bilet czeka na wplate, bez kodu QR.
    v_price := COALESCE(public._event_ticket_price_now(
      v_ticket.price_cents, v_ticket.early_bird_price_cents,
      v_ticket.early_bird_until, v_ticket.price_schedule), 0);
    IF v_price > 0 THEN
      v_payment := 'unpaid';
      -- ZMIANA 20261012 (REG-13, D7): platnej wejsciowki nie sprzedajemy po
      -- starcie wydarzenia - kasa (`_event_ticket_checkout_quote`,
      -- `event_finished`) i tak by jej nie przyjela, a zgloszenie bez szansy
      -- na wplate to slepa uliczka dla uczestnika i szum dla organizatora.
      IF v_event.starts_at IS NOT NULL AND v_event.starts_at < now() THEN
        RAISE EXCEPTION 'ticket_sales_ended: paid tickets are not sold after the event starts';
      END IF;
      -- KROK PIENIEDZY WYMAGA KONTA (2026-08-30): paragon i droga zwrotu
      -- naleza do konta, wiec konto musi byc PRZED powstaniem wiersza.
      IF v_uid IS NULL THEN
        RAISE EXCEPTION 'payment_account_required: a paid ticket requires an account';
      END IF;
      -- ZMIANA 20261012 (REG-01, D1): ...i to konto musi miec POTWIERDZONY
      -- adres zgloszenia. Platne miejsce trzyma pieniadze konta, a kasa liczy
      -- benefit planu osobie zgloszenia - konto nie zaklada platnego
      -- zgloszenia na cudza skrzynke.
      IF NOT public._event_uid_owns_email(v_uid, v_email) THEN
        RAISE EXCEPTION 'account_email_required: a paid ticket is registered to the confirmed e-mail of your account';
      END IF;
    END IF;

    v_group_id := v_ticket.group_id;
  ELSIF v_active_tickets > 0 THEN
    RAISE EXCEPTION 'ticket_required: this event sells tickets - pick one';
  END IF;

  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_event.id AND g.is_default;
  END IF;

  IF v_event.registration_mode = 'form' THEN
    SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[])
    INTO v_missing
    FROM public.event_registration_fields f
    WHERE f.tenant_id = v_tenant
      AND f.event_id = v_event.id
      AND f.is_active
      AND f.is_required
      AND f.field_type <> 'consent'
      AND NOT public._event_answer_matches('not_empty', 'null'::jsonb, v_answers -> f.key);

    IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
      RAISE EXCEPTION 'missing_required_fields: %', array_to_string(v_missing, ',');
    END IF;

    -- Zgoda obowiazkowa musi byc PRAWDA, nie tylko obecna: brak zaznaczenia to
    -- brak zgody, a puste pole i "false" znacza tu dokladnie to samo.
    SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[])
    INTO v_missing
    FROM public.event_registration_fields f
    WHERE f.tenant_id = v_tenant
      AND f.event_id = v_event.id
      AND f.is_active
      AND f.is_required
      AND f.field_type = 'consent'
      AND NOT public._event_answer_matches('is_true', 'null'::jsonb, v_answers -> f.key);

    IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
      RAISE EXCEPTION 'missing_required_consents: %', array_to_string(v_missing, ',');
    END IF;
  END IF;

  SELECT COALESCE(array_agg(tr.key ORDER BY tr.sort_order, tr.key), ARRAY[]::text[])
  INTO v_missing
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.is_required
    AND tr.display IN ('registration', 'registration_and_access')
    AND NOT (tr.id = ANY (v_accepted));

  IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'terms_required: %', array_to_string(v_missing, ',');
  END IF;

  -- ZMIANA 20261012 (REG-04, D3): KOLEJNOSC BEZ WYROCZNI.
  -- Zweryfikowany wolajacy (potwierdzony adres konta = adres zgloszenia) pyta
  -- o SWOJ adres, wiec dostaje „juz zapisany" od razu - przed pojemnoscia,
  -- bo to dla niego lepsza odpowiedz niz „brak miejsc".
  -- Kazdy inny dostaje werdykt, status i pojemnosc liczone ZANIM baza
  -- w ogole spojrzy na adres: `sold_out` jest ten sam dla adresu zapisanego
  -- i swiezego. Wydarzenie jest zablokowane (FOR UPDATE), wiec ten odczyt
  -- i zapis nizej to jedna chwila.
  v_verified := public._event_uid_owns_email(v_uid, v_email);
  IF v_verified THEN
    SELECT r.id INTO v_existing_id
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     WHERE r.tenant_id = v_tenant
       AND r.event_id = v_event.id
       AND p.email_norm = v_email
       AND r.status NOT IN ('cancelled', 'rejected')
     LIMIT 1;
  END IF;

  IF v_existing_id IS NULL THEN
    v_verdict := public._event_registration_verdict(v_tenant, v_event.id, v_answers);

    IF v_verdict = 'reject' THEN
      v_status := 'rejected';
      v_decision_source := 'automatic_rule';
    ELSIF v_verdict = 'approval' THEN
      v_status := 'pending';
    ELSIF v_verdict = 'auto_approve' THEN
      v_status := 'approved';
      v_decision_source := 'automatic_rule';
    ELSE
      v_status := CASE WHEN v_event.registration_flow = 'approval' THEN 'pending' ELSE 'approved' END;
      v_decision_source := CASE WHEN v_status = 'approved' THEN 'system' ELSE NULL END;
    END IF;

    IF v_ticket.id IS NOT NULL AND v_ticket.requires_approval AND v_status = 'approved' THEN
      v_status := 'pending';
      v_decision_source := NULL;
    END IF;

    -- NIEZAPLACONY BILET NIE TRZYMA MIEJSCA W PULI: `pending` znaczy
    -- „zgloszenie istnieje, miejsce nie jest zajete"; NA CO czeka, mowi
    -- `payment_status`, nie `status`.
    IF v_payment = 'unpaid' AND v_status = 'approved' THEN
      v_status := 'pending';
      v_decision_source := NULL;
    END IF;

    IF v_status = 'approved' THEN
      v_seats_left := public._event_seats_left(v_tenant, v_event.id, v_ticket.id);
      IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
        IF v_ticket.id IS NOT NULL AND NOT v_ticket.waitlist_enabled THEN
          RAISE EXCEPTION 'sold_out: no seats left and the waiting list is closed';
        END IF;
        v_status := 'waitlist';
        v_decision_source := 'capacity';
        v_position := public._event_next_waitlist_position(v_tenant, v_event.id);
      END IF;
    END IF;

    -- Dopiero teraz osoba - pod blokada, bo ponizej moze byc jej zapis.
    SELECT p.* INTO v_person
      FROM public.event_people p
     WHERE p.tenant_id = v_tenant AND p.email_norm = v_email
     FOR UPDATE;
    v_new_person := v_person.id IS NULL;

    -- ZMIANA 20261012 (R38): NOWA OSOBA ODPORNA NA WYSCIG. Dwa pierwsze zapisy
    -- tego samego adresu (dwie karty, dwa wydarzenia najemcy) widzialy brak
    -- osoby i oba ja wstawialy; drugi trafial w `event_people_tenant_email_uniq`,
    -- a wejscie robilo z tego „juz zapisany" BEZ zgloszenia i bez maila -
    -- zapis znikal. Teraz wstawienie czeka na rownolegly zapis (ON CONFLICT na
    -- tym samym indeksie) i, gdy tamten wygral, bierze jego osobe pod blokada
    -- i idzie sciezka osoby ISTNIEJACEJ (wlasciciel albo `submitted_profile`).
    -- Dane z formularza i konto (wylacznie `_event_bind_uid_for_email`, D1)
    -- jak dotad; zgody NIE ida tu kolumnami - wylacznie przez rejestr nizej.
    IF v_new_person THEN
      INSERT INTO public.event_people (
        tenant_id, user_id, email, first_name, last_name, phone, job_title,
        company_text, social_profile_url, source, created_by
      ) VALUES (
        v_tenant, public._event_bind_uid_for_email(v_tenant, v_uid, v_email), v_email,
        v_first, v_last, v_phone, v_job, v_company, v_social, 'self_registration', v_uid
      )
      ON CONFLICT (tenant_id, email_norm) WHERE email_norm IS NOT NULL DO NOTHING
      RETURNING * INTO v_person;

      IF v_person.id IS NULL THEN
        SELECT p.* INTO v_person
          FROM public.event_people p
         WHERE p.tenant_id = v_tenant AND p.email_norm = v_email
         FOR UPDATE;
        -- Rownolegly zapis wstawil osobe i ja usunal - nie ma na czym oprzec
        -- zgloszenia. Glowa spoza kontraktu = `unknown` w wejsciu (awaria).
        IF v_person.id IS NULL THEN
          RAISE EXCEPTION 'person_conflict: the contact record changed concurrently';
        END IF;
        v_new_person := false;
      END IF;
    END IF;

    IF NOT v_new_person THEN
      SELECT r.id INTO v_existing_id
        FROM public.event_registrations r
       WHERE r.tenant_id = v_tenant
         AND r.event_id = v_event.id
         AND r.person_id = v_person.id
         AND r.status NOT IN ('cancelled', 'rejected')
       LIMIT 1;
    END IF;
  END IF;

  -- JUZ ZAPISANY: odpowiedz bez JEDNEGO zapisu (wczesniej najpierw szla
  -- aktualizacja osoby, a potem wyjatek). Dane odbiorcy z KARTOTEKI - mail
  -- trafia do wlasciciela adresu, nie do tego, kto wpisal formularz.
  IF v_existing_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'ok', true,
             'outcome', 'already_registered',
             'verified', v_verified,
             'registration_id', r.id,
             'status', r.status,
             'recipient', jsonb_build_object(
               'email', p.email,
               'first_name', p.first_name,
               'lang', public._event_registration_lang(v_tenant, r.id)),
             'event', v_event_json)
      INTO v_out
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     WHERE r.tenant_id = v_tenant AND r.id = v_existing_id;
    RETURN v_out;
  END IF;

  -- ZMIANA 20261012 (REG-01, REG-02, D1/D4): KTO MOZE ZMIENIAC KARTOTEKE.
  -- Wlasciciel = konto juz dowiazane do osoby albo konto z POTWIERDZONYM jej
  -- adresem, gdy osoba nie ma jeszcze konta. Nowa osoba ma wlasciciela tylko
  -- przy potwierdzonym adresie. Konto zapisuje sie w `user_id` WYLACZNIE przez
  -- `_event_bind_uid_for_email` (inwariant D1).
  v_owner := COALESCE(
    v_uid IS NOT NULL
    AND (v_person.user_id = v_uid OR (v_person.user_id IS NULL AND v_verified)),
    false);
  v_bind_uid := public._event_bind_uid_for_email(v_tenant, v_uid, v_email);

  -- Nowa osoba jest juz w kartotece (wstawiona przy wyszukaniu, z danymi
  -- z formularza) - zmienia sie tylko osoba istniejaca, i tylko przez
  -- wlasciciela.
  IF v_new_person THEN
    NULL;
  ELSIF v_owner THEN
    UPDATE public.event_people p SET
      user_id = COALESCE(p.user_id, v_bind_uid),
      first_name = v_first,
      last_name = v_last,
      phone = COALESCE(v_phone, p.phone),
      job_title = COALESCE(v_job, p.job_title),
      company_text = COALESCE(v_company, p.company_text),
      social_profile_url = COALESCE(v_social, p.social_profile_url)
    WHERE p.id = v_person.id AND p.tenant_id = v_tenant
    RETURNING * INTO v_person;
  ELSE
    -- Ktos inny niz wlasciciel: kartoteka zostaje NIETKNIETA (imie,
    -- nazwisko, telefon, firma, zgody, wycofanie, konto). To, co przyslal,
    -- trafia do zgloszenia do wgladu organizatora - tylko gdy sie rozni.
    -- `v_submitted` zlozony i zmierzony przed wyszukaniem (ZMIANA R38).
    IF NOT (jsonb_strip_nulls(jsonb_build_object(
              'first_name', v_person.first_name,
              'last_name', v_person.last_name,
              'phone', v_person.phone,
              'job_title', v_person.job_title,
              'company_text', v_person.company_text,
              'social_profile_url', v_person.social_profile_url)) @> v_submitted) THEN
      v_submitted_profile := v_submitted;
    END IF;
  END IF;

  -- KOD QR JEST PRZEPUSTKA, WIEC NIE POWSTAJE PRZED PLATNOSCIA (status
  -- `pending` + `payment_status = 'unpaid'`; wyprowadza z tego
  -- `admin_event_registration_decide` akcja `paid`).
  IF v_status = 'approved' AND v_payment <> 'unpaid' THEN
    v_token := public._event_new_qr_token();
  END IF;
  v_manage := public._event_new_qr_token();

  -- ZMIANA 20261012 (REG-16, D8): zgloszenie nieoplacone pamieta OFERTE -
  -- cene z chwili zapisu, walute i termin (72 h, nie dalej niz start).
  -- Odczyt wylacznie przez `_event_registration_unit_price`.
  IF v_payment = 'unpaid' THEN
    v_quote_until := LEAST(now() + public._event_registration_quote_ttl(), v_event.starts_at);
  END IF;

  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source,
    decided_at, decision_source, qr_token_hash, qr_issued_at,
    manage_token_hash, waitlist_position, payment_status, created_by,
    quoted_price_cents, quoted_currency, quote_valid_until,
    submitted_profile, lang
  ) VALUES (
    v_tenant, v_event.id, v_person.id, v_ticket.id, v_group_id, v_status,
    CASE WHEN v_event.registration_mode = 'form' THEN 'form' ELSE 'rsvp' END,
    v_answers, 'self_registration',
    CASE WHEN v_decision_source IS NOT NULL THEN now() END,
    v_decision_source,
    CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex') END,
    CASE WHEN v_token IS NOT NULL THEN now() END,
    encode(digest(v_manage, 'sha256'), 'hex'),
    v_position,
    v_payment,
    v_uid,
    CASE WHEN v_payment = 'unpaid' THEN v_price END,
    CASE WHEN v_payment = 'unpaid' THEN v_ticket.currency END,
    v_quote_until,
    v_submitted_profile,
    -- Jezyk formularza mowi o osobie tylko wtedy, gdy wypelnila go ona sama
    -- (nowa osoba albo wlasciciel); inaczej jezyk z kaskady
    -- `_event_registration_lang` (profil, newsletter).
    CASE WHEN v_new_person OR v_owner THEN v_lang END
  )
  RETURNING id INTO v_reg_id;

  INSERT INTO public.event_term_acceptances (
    tenant_id, term_id, person_id, registration_id, version, ip_hash, user_agent
  )
  SELECT v_tenant, tr.id, v_person.id, v_reg_id, tr.version, v_ip_hex, v_user_agent
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.id = ANY (v_accepted)
  ON CONFLICT (tenant_id, term_id, person_id, version) DO NOTHING;

  -- ZMIANA 20261012 (REG-02, REG-14, D5): ZGODY WYLACZNIE PRZEZ REJESTR (A2).
  -- Przetwarzanie danych: wpis `confirmed` z formularza; projekcja w kartotece
  -- tylko dla nowej osoby albo wlasciciela (cudzej kartoteki nie zmieniamy).
  PERFORM public._event_person_consents_confirm(
    v_tenant, v_person.id, ARRAY['data_processing']::text[], 'registration_form',
    v_event.id, v_reg_id, NULL, v_text_version, v_lang, p_ip_subject, v_user_agent,
    v_uid, 'event_register', v_new_person OR v_owner);
  -- Marketing i partnerzy: od razu tylko kanalem zweryfikowanym (wlasciciel
  -- bez globalnego wycofania). Kazdy inny przypadek - wpisy `pending` i link
  -- double opt-in na adres osoby; wycofanie zdejmuje wylacznie ten link.
  IF cardinality(v_purposes) > 0 THEN
    IF v_owner AND v_person.consent_withdrawn_at IS NULL THEN
      PERFORM public._event_person_consents_confirm(
        v_tenant, v_person.id, v_purposes, 'verified_account',
        v_event.id, v_reg_id, NULL, v_text_version, v_lang, p_ip_subject, v_user_agent,
        v_uid, 'event_register', true);
    ELSE
      v_consent_token := public._event_consent_issue_confirmation(
        v_tenant, v_person.id, v_purposes, v_event.id, v_reg_id,
        v_text_version, v_lang, p_ip_subject, v_user_agent);
    END IF;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_event.id,
      'person_id', v_person.id,
      'status', v_status,
      'ticket_type_id', v_ticket.id,
      'source', 'self_registration'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'created',
    'verified', v_verified,
    'registration_id', v_reg_id,
    'event_id', v_event.id,
    'person_id', v_person.id,
    'status', v_status,
    'decision_source', v_decision_source,
    'waitlist_position', v_position,
    'ticket_type_id', v_ticket.id,
    'group_id', v_group_id,
    'qr_token', v_token,
    'manage_token', v_manage,
    'payment_status', v_payment,
    'payment_required', (v_payment = 'unpaid'),
    'amount_cents', CASE WHEN v_payment = 'unpaid' THEN v_price END,
    'currency', CASE WHEN v_payment = 'unpaid' THEN v_ticket.currency END,
    'quote_valid_until', v_quote_until,
    'account_linked', COALESCE(v_uid IS NOT NULL AND v_person.user_id = v_uid, false),
    'consent_confirmation_required', (v_consent_token IS NOT NULL),
    'consent_confirmation', CASE
      WHEN COALESCE(p_issue_confirmation, false) AND v_consent_token IS NOT NULL THEN
        jsonb_build_object('token', v_consent_token, 'purposes', to_jsonb(v_purposes), 'lang', v_lang)
    END,
    'recipient', jsonb_build_object(
      'email', v_person.email,
      'first_name', v_person.first_name,
      'lang', public._event_registration_lang(v_tenant, v_reg_id)),
    'event', v_event_json
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_register(uuid, uuid, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_register(uuid, uuid, text, text, jsonb, boolean) TO service_role;

COMMENT ON FUNCTION public._event_register(uuid, uuid, text, text, jsonb, boolean) IS
  'Rdzen zapisu na wydarzenie (REG-01/02/04/05/13/14/16, R38). Najemca, konto, solony skrot adresu (ip:<32 hex>) i przegladarka z argumentow - ladunek nigdy nie niesie tozsamosci ani dowodu. Sufity i znaki sterujace (_event_text_has_control) odrzucane kodem pola, a submitted_profile mierzony PRZED wyszukaniem osoby - znany i swiezy adres nie roznia sie odpowiedzia. Kolejnosc D3: zweryfikowany (potwierdzony adres konta = adres) dostaje already_registered od razu, kazdy inny po pojemnosci. Nowa osoba wstawiana ON CONFLICT (tenant_id, email_norm) - przegrany wyscigu idzie sciezka osoby istniejacej. Kartoteke zmienia tylko wlasciciel, inaczej submitted_profile. Zgody przez rejestr A2 (marketing/partnerzy od razu tylko dla wlasciciela bez wycofania, inaczej pending + link DOI zwracany przy p_issue_confirmation). Wynik: wartosc z outcome created|already_registered albo {ok:false,error} dla pudel kodu; pozostale odmowy to wyjatek kod: ogon. Tylko service_role i wejscia (event_register_for_client, event_register).';
