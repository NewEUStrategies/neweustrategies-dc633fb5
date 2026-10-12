-- events-harness: include
-- ============================================================================
-- MOST WYDARZENIA -> CRM: ZGODA MARKETINGOWA Z KSIEGI, BEZ WSKRZESZANIA PO
-- WYCOFANIU (REG-02 / REG-14, CZESC 3 REJESTRU ZGOD).
--
-- DEFEKT: `_event_person_crm_sync` (20260927001400:101-500) uznawal za dowod
--   zgody sam stempel `event_people.consent_marketing_at` bez
--   `consent_withdrawn_at` (:303-304), a stempel stawial kazdy, kto wpisal
--   cudzy adres w formularz (REG-02). Zgoda kontaktu tylko rosla
--   (`marketing_consent = l.marketing_consent OR v_evidence`, :328), a wiersz
--   `crm_consent_log` (:334-345) mial tekst zmyslony przez most, bez wersji,
--   adresu IP i user agenta. Wycofanie zgody w CRM (staff, newsletter, link
--   wypisu) nie zatrzymywalo kolejnego wywolania mostu: stary stempel wracal
--   jako `marketing_consent = true` i nowy wiersz given=true.
--
-- ZMIANA 20261012 (REG-14) - cialo z 20260927001400:101-500 (zgodne bajt
--   w bajt z baza po odtworzeniu lancucha), zmienione WYLACZNIE w dwoch
--   miejscach oznaczonych w kodzie:
--   1. DOWOD ZGODY: stempel bez wycofania ORAZ
--      - najnowszy rozstrzygajacy wpis marketingu w `event_consent_records`
--        (wg `seq`) to 'confirmed' dla OBECNEGO adresu osoby (wycofanie
--        w ksiedze albo zmiana e-maila osoby gasi dowod), a gdy osoba nie ma
--        zadnego wpisu - zachowanie dotychczasowe (stempel sprzed ksiegi;
--        harness 14_crm_bridge zostaje zielony);
--      - brak w `crm_consent_log` wiersza given=false dla tego adresu
--        z chwili dowodu albo pozniejszej (wycofanie po stronie CRM) - poza
--        wierszami samego wycofania tej osoby z ksiegi, ktorych kolejnosc
--        wzgledem dowodu rozstrzyga juz `seq`.
--   2. WIERSZ REJESTRU ZGOD przy dowodzie z ksiegi: prawdziwy tekst wersji
--      (`event_consent_texts.body`), `consent_version`
--      'event-marketing-v<wersja>-<jezyk>', `form_name` 'evidence:<kanal>',
--      skrot IP, user agent i jezyk z wpisu. Bez wpisu ksiegi (i dla spadku
--      `legacy_single_opt_in`) - dotychczasowy tekst wskazujacy stempel.
--   Sygnatura, SECURITY DEFINER, search_path, REVOKE/GRANT i zachowanie poza
--   zgoda (kontakt, tagi, segment, os czasu, stan per intencja) bez zmian.
--
-- CZEGO TO NIE ZAMYKA: zgoda kontaktu nadal nie spada w moscie - spada
--   wylacznie przez `_event_person_consent_crm_withdraw` (20261012100200).
--   Przelacznik zgody w panelu CRM (src/lib/crm.functions.ts) nie pisze
--   wiersza given=false, wiec reczne odznaczenie przez personel nie zatrzyma
--   mostu, dopoki CRM tego nie loguje (opisane w raporcie, poza modulem).
--
-- KOLEJNOSC WDROZENIA: po 20261012100100 (ksiega, teksty). Dowolna wzgledem
--   kodu - sygnatura bez zmian.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT.
-- DOWOD: supabase/tests/event_consent_ledger_test.sql (wycofanie nie wraca do
--   CRM, wiersz z tekstem wersji), scripts/events-harness/runtime_test.d/
--   23_consent_ledger.sql, 14_crm_bridge.sql i 15_crm_bridge_intents.sql
--   (zachowanie dotychczasowe).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._event_person_crm_sync(
  p_tenant uuid,
  p_person_id uuid,
  p_source_type text,
  p_source_label text,
  p_tags text[] DEFAULT '{}'::text[],
  p_custom jsonb DEFAULT '{}'::jsonb,
  p_create boolean DEFAULT true,
  p_audit_action text DEFAULT NULL,
  p_audit_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text := left(NULLIF(btrim(COALESCE(p_source_type, '')), ''), 64);
  v_label text := left(NULLIF(btrim(COALESCE(p_source_label, '')), ''), 200);
  v_create boolean := COALESCE(p_create, true);
  v_tags text[];
  v_person public.event_people%ROWTYPE;
  v_email text;
  v_email_norm text;
  v_phone text;
  v_phone_norm text;
  v_linkedin text;
  v_company_name text;
  v_existing uuid;
  v_inserted uuid;
  v_created boolean := false;
  v_lead uuid;
  v_prev_consent boolean;
  -- ZMIANA 20261012 (REG-14): najnowszy rozstrzygajacy wpis marketingu w ksiedze,
  -- chwila dowodu i tekst wersji do rejestru zgod CRM.
  v_ledger public.event_consent_records%ROWTYPE;
  v_evidence_at timestamptz;
  v_text text;
  v_evidence boolean;
  v_status text;
  v_reason text;
  v_err text;
  v_meta jsonb := CASE WHEN jsonb_typeof(p_audit_meta) = 'object' THEN p_audit_meta ELSE '{}'::jsonb END;
  v_ref text;
  v_key text;
  v_pending jsonb;
  v_top_key text;
  v_top jsonb;
  v_row_status text;
  v_row_error text;
  v_row_type text;
  v_row_label text;
  v_row_tags text[];
  v_row_create boolean;
BEGIN
  -- Tagi zadania: przyciete, bez pustych, maks. 60 znakow, bez powtorzen,
  -- w kolejnosci pierwszego wystapienia.
  v_tags := ARRAY(
    SELECT s.tag
      FROM (
        SELECT left(btrim(u.raw), 60) AS tag, min(u.ord) AS ord
          FROM unnest(COALESCE(p_tags, '{}'::text[])) WITH ORDINALITY AS u(raw, ord)
         WHERE NULLIF(btrim(u.raw), '') IS NOT NULL
         GROUP BY left(btrim(u.raw), 60)
      ) s
     ORDER BY s.ord
  );
  -- Klucz intencji w `pending_errors`: etykieta zrodla wywolania.
  v_key := COALESCE(v_label, '');

  BEGIN
    -- Os czasu rozpoznaje typ "event" po prefiksie akcji - cudza akcja jest
    -- bledem wolajacego, wykrywanym ZANIM cokolwiek trafi do CRM.
    IF p_audit_action IS NOT NULL
       AND p_audit_action !~ '^event\.[a-z0-9_]+(\.[a-z0-9_]+)*$' THEN
      RAISE EXCEPTION 'invalid_audit_action: % is not an event.* action', p_audit_action;
    END IF;

    SELECT p.* INTO v_person
      FROM public.event_people p
     WHERE p.tenant_id = p_tenant AND p.id = p_person_id;
    IF NOT FOUND THEN
      -- Osoby nie ma w tym najemcy: nie ma tez do czego przypiac stanu mostu.
      RETURN NULL;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_tenant::text || ':event_person_crm:' || p_person_id::text, 0)
    );

    v_email := NULLIF(btrim(COALESCE(v_person.email, '')), '');
    v_email_norm := lower(v_email);

    IF v_email_norm IS NULL THEN
      v_status := 'skipped';
      v_reason := 'email_missing';
    ELSE
      -- Istniejacy kontakt blokowany od razu: nie zniknie miedzy tym odczytem
      -- a `crm_upsert_from_form` (ktora zalozylaby wtedy kontakt bez imion).
      SELECT l.id INTO v_existing
        FROM public.crm_leads l
       WHERE l.tenant_id = p_tenant AND l.email_norm = v_email_norm
       FOR UPDATE;

      IF v_existing IS NULL AND NOT v_create THEN
        v_status := 'skipped';
        v_reason := 'lead_not_found';
      ELSE
        -- Telefon cudzego kontaktu pomijamy: unikalny `(tenant_id, phone_norm)`
        -- wywrocilby cala synchronizacje na numerze centrali firmy.
        v_phone := NULLIF(btrim(COALESCE(v_person.phone, '')), '');
        v_phone_norm := NULLIF(regexp_replace(COALESCE(v_phone, ''), '[^0-9+]', '', 'g'), '');
        IF v_phone_norm IS NULL OR EXISTS (
          SELECT 1 FROM public.crm_leads l
           WHERE l.tenant_id = p_tenant
             AND l.phone_norm = v_phone_norm
             AND l.email_norm <> v_email_norm
        ) THEN
          v_phone := NULL;
        END IF;

        v_linkedin := CASE
          WHEN v_person.social_profile_url ~* '^https?://([a-z0-9-]+\.)*linkedin\.com/'
            THEN v_person.social_profile_url
        END;

        SELECT c.name INTO v_company_name
          FROM public.crm_companies c
         WHERE c.tenant_id = p_tenant AND c.id = v_person.company_id;
        v_company_name := COALESCE(v_company_name, NULLIF(btrim(COALESCE(v_person.company_text, '')), ''));

        -- NOWY KONTAKT ZAKLADA MOST - Z IMIENIEM I NAZWISKIEM. Wstawienie
        -- odpala `trg_crm_leads_emit_events`, a ten robi migawke
        -- `crm_lead.created.v1` Z WSTAWIANEGO WIERSZA. Tylko to zdarzenie
        -- niesie imie i nazwisko (`crm_lead.updated.v1` ma sam e-mail i etap),
        -- a `hubspotContactBody` czyta je wylacznie z ladunku zdarzenia - kontakt
        -- zalozony przez `crm_upsert_from_form` z NULL-owymi imionami zostawal
        -- w HubSpot bez nazwiska na zawsze. Telefon, stanowisko i LinkedIn
        -- wchodza od razu, zeby `crm_upsert_from_form` (dopasowanie PO E-MAILU,
        -- ten sam wiersz) nie dopisal ich jako aliasow; `source_count = 0`, bo
        -- jego sciezka aktualizacji dolicza pierwsze zrodlo.
        --
        -- RYWALIZACJA O TEN SAM ADRES. Miedzy odczytem wyzej a tym wstawieniem
        -- inna transakcja (np. zapis do newslettera przez `newsletter_to_lead`)
        -- moze zalozyc ten sam `(tenant_id, email_norm)`. ON CONFLICT DO NOTHING
        -- nic wtedy nie wstawia, a `RETURNING` nic nie oddaje - `v_created`
        -- mowi, czy wiersz zalozylo TO wywolanie. Jesli nie, wiersz jest cudzy:
        -- czytamy go ponownie z blokada i dalej traktujemy jak istniejacy
        -- kontakt (newsletter i zgoda nietkniete, pola tylko uzupelniane,
        -- segment tylko w gore). Wiersz, ktory zniknal zaraz po konflikcie,
        -- konczy wywolanie bledem w stanie mostu (ponowienie go zalozy) -
        -- zamiast kontaktu bez imion od `crm_upsert_from_form`.
        IF v_existing IS NULL THEN
          INSERT INTO public.crm_leads (
            tenant_id, email, email_norm, first_name, last_name,
            phone, phone_norm, position, linkedin_url, newsletter_status, source_count
          ) VALUES (
            p_tenant, v_email, v_email_norm,
            NULLIF(btrim(COALESCE(v_person.first_name, '')), ''),
            NULLIF(btrim(COALESCE(v_person.last_name, '')), ''),
            v_phone, NULLIF(regexp_replace(COALESCE(v_phone, ''), '[^0-9+]', '', 'g'), ''),
            NULLIF(btrim(COALESCE(v_person.job_title, '')), ''),
            v_linkedin, NULL, 0
          )
          ON CONFLICT (tenant_id, email_norm) DO NOTHING
          RETURNING id INTO v_inserted;
          v_created := v_inserted IS NOT NULL;

          IF NOT v_created THEN
            SELECT l.id INTO v_existing
              FROM public.crm_leads l
             WHERE l.tenant_id = p_tenant AND l.email_norm = v_email_norm
             FOR UPDATE;
          END IF;
        END IF;

        IF v_existing IS NULL AND NOT v_created THEN
          -- Rywal zniknal zaraz po konflikcie: bez wiersza `crm_upsert_from_form`
          -- zalozylaby kontakt bez imion. Stan `error` z kodem - ponowienie
          -- (`admin_event_person_crm_retry`) zalozy kontakt jak nowy.
          v_status := 'error';
          v_reason := 'lead_conflict_lost';
        ELSE
          -- Imie, nazwisko i firma jako NULL: bez nich `crm_upsert_from_form`
          -- nie scala po nazwisku i nie zaklada firmy z wolnego tekstu. Kontakt
          -- juz stoi (znaleziony albo zalozony wyzej), wiec funkcja dopasowuje go
          -- PO E-MAILU i dopisuje zrodlo, pola niestandardowe oraz licznik zrodel.
          v_lead := public.crm_upsert_from_form(
            _tenant => p_tenant,
            _email => v_email,
            _first_name => NULL,
            _last_name => NULL,
            _phone => v_phone,
            _company => NULL,
            _position => NULLIF(btrim(COALESCE(v_person.job_title, '')), ''),
            _linkedin => v_linkedin,
            _country => NULL,
            _source => v_label,
            _custom => CASE WHEN jsonb_typeof(p_custom) = 'object' THEN p_custom ELSE '{}'::jsonb END
          );

          SELECT l.marketing_consent INTO v_prev_consent
            FROM public.crm_leads l
           WHERE l.id = v_lead AND l.tenant_id = p_tenant
           FOR UPDATE;

          -- ZMIANA 20261012 (REG-14): dowod zgody z KSIEGI, nie z samego
          -- stempla. Stempel stawial kazdy, kto wpisal cudzy adres, a zgoda
          -- wycofana w CRM wracala przy nastepnym wywolaniu mostu.
          --   * najnowszy rozstrzygajacy wpis marketingu (wg `seq` - created_at
          --     jest stale w transakcji) musi byc 'confirmed' i dotyczyc
          --     OBECNEGO adresu osoby; osoba bez zadnego wpisu (stemple sprzed
          --     ksiegi, ktorych spadek nie objal) zachowuje regule dotychczasowa;
          --   * zadnego given=false w rejestrze zgod CRM dla tego adresu od
          --     chwili dowodu - poza wierszami wycofania tej osoby z ksiegi
          --     (form_id `event_consent:<kanal>`), bo te porzadkuje juz `seq`
          --     (wycofanie i ponowne potwierdzenie w jednej transakcji maja
          --     te sama chwile now()).
          SELECT r.* INTO v_ledger
            FROM public.event_consent_records r
           WHERE r.tenant_id = p_tenant
             AND r.person_id = p_person_id
             AND r.purpose = 'marketing'
             AND r.status IN ('confirmed', 'withdrawn')
           ORDER BY r.seq DESC
           LIMIT 1;

          v_evidence_at := COALESCE(v_ledger.created_at, v_person.consent_marketing_at);

          v_evidence := v_person.consent_marketing_at IS NOT NULL
                        AND v_person.consent_withdrawn_at IS NULL
                        AND (
                          v_ledger.id IS NULL
                          OR (v_ledger.status = 'confirmed' AND v_ledger.email_norm = v_email_norm)
                        )
                        AND NOT EXISTS (
                          SELECT 1
                            FROM public.crm_consent_log g
                           WHERE g.tenant_id = p_tenant
                             AND lower(g.email) = v_email_norm
                             AND g.consent_key = 'marketing'
                             AND NOT g.given
                             AND g.created_at >= v_evidence_at
                             AND NOT (
                               g.source_type = 'event'::public.crm_source_type
                               AND g.source_id = p_person_id
                               AND COALESCE(g.form_id, '') LIKE 'event\_consent:%'
                             )
                        );

          UPDATE public.crm_leads l SET
            first_name = COALESCE(NULLIF(l.first_name, ''), NULLIF(btrim(v_person.first_name), '')),
            last_name = COALESCE(NULLIF(l.last_name, ''), NULLIF(btrim(v_person.last_name), '')),
            company = CASE
              WHEN NULLIF(l.company, '') IS NULL
                   AND (l.company_id IS NULL OR l.company_id = v_person.company_id)
                THEN v_company_name
              ELSE l.company
            END,
            company_id = COALESCE(l.company_id, v_person.company_id),
            source_type = CASE
              WHEN public._crm_source_type_rank(v_type) > public._crm_source_type_rank(l.source_type)
                THEN v_type
              ELSE l.source_type
            END,
            tags = l.tags || ARRAY(
              SELECT t.tag
                FROM unnest(v_tags) WITH ORDINALITY AS t(tag, ord)
               WHERE NOT (t.tag = ANY (l.tags))
               ORDER BY t.ord
               LIMIT GREATEST(0, 60 - cardinality(l.tags))
            ),
            marketing_consent = l.marketing_consent OR v_evidence,
            newsletter_status = CASE WHEN v_created THEN NULL ELSE l.newsletter_status END,
            updated_at = now()
          WHERE l.id = v_lead AND l.tenant_id = p_tenant;

          IF v_evidence AND NOT v_prev_consent THEN
            -- ZMIANA 20261012 (REG-14): wiersz rejestru zgod niesie prawdziwy
            -- tekst, wersje, kanal, skrot IP i user agenta z ksiegi. Bez
            -- wpisu ksiegi i dla spadku (`legacy_single_opt_in`, bez tekstu)
            -- zostaje dotychczasowy opis wskazujacy stempel.
            IF v_ledger.id IS NOT NULL AND v_ledger.text_version IS NOT NULL THEN
              SELECT t.body INTO v_text
                FROM public.event_consent_texts t
               WHERE t.purpose = 'marketing'
                 AND t.version = v_ledger.text_version
                 AND t.lang = v_ledger.text_lang;
            END IF;

            INSERT INTO public.crm_consent_log (
              tenant_id, email, source_type, source_id, form_id, form_name,
              consent_key, consent_text, consent_version, given, ip, user_agent, lang
            ) VALUES (
              p_tenant, v_email, 'event'::public.crm_source_type, p_person_id, v_label,
              CASE WHEN v_ledger.id IS NOT NULL THEN 'evidence:' || v_ledger.evidence END,
              'marketing',
              COALESCE(
                v_text,
                format(
                  'Organizer marketing consent given by the event participant (event_people.consent_marketing_at = %s); copied to CRM by the event bridge from source %s.',
                  to_char(v_person.consent_marketing_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  COALESCE(v_label, 'event')
                )
              ),
              CASE
                WHEN v_text IS NOT NULL
                  THEN format('event-marketing-v%s-%s', v_ledger.text_version, v_ledger.text_lang)
              END,
              true,
              v_ledger.ip_subject,
              v_ledger.user_agent,
              v_ledger.text_lang
            );
          END IF;

          -- JEDNO ZDARZENIE = JEDEN WPIS OSI CZASU. Ponowne przeniesienie ze
          -- stoiska, druga odprawa po cofnieciu obecnosci albo ponowienie
          -- z panelu wolaja most z ta sama akcja dla tego samego zdarzenia.
          -- Wpis idzie tylko, gdy kontakt nie ma jeszcze wpisu tej akcji o tym
          -- samym odnosniku (zgloszenie, zgloszenie naboru, faktura, a gdy
          -- zadnego nie ma - wydarzenie), liczonym tak samo z metadanych
          -- wierszy, ktore produkcja juz zapisala. Wyscig wyklucza blokada
          -- doradcza osoby i FOR UPDATE na kontakcie wyzej.
          v_ref := COALESCE(v_meta->>'registration_id', v_meta->>'submission_id',
                            v_meta->>'invoice_id', v_meta->>'event_id');
          IF p_audit_action IS NOT NULL AND NOT EXISTS (
            SELECT 1
              FROM public.audit_log a
             WHERE a.tenant_id = p_tenant
               AND a.entity_type = 'crm_lead'
               AND a.entity_id = v_lead
               AND a.action = p_audit_action
               AND COALESCE(a.metadata->>'registration_id', a.metadata->>'submission_id',
                            a.metadata->>'invoice_id', a.metadata->>'event_id')
                   IS NOT DISTINCT FROM v_ref
          ) THEN
            INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
            VALUES (
              p_tenant,
              auth.uid(),
              p_audit_action,
              'crm_lead',
              v_lead,
              v_meta || jsonb_build_object('source_label', v_label, 'person_id', p_person_id)
            );
          END IF;

          v_status := 'ok';
        END IF;
      END IF;
    END IF;

    -- STAN PER INTENCJA. Jedna osoba ma jeden wiersz stanu, a wolaja most
    -- rozne intencje (nabor, przyjecie prelegenta, odprawa, faktura, stoisko).
    -- Nieudana intencja czeka w `pending_errors` pod swoja etykieta, az TA
    -- intencja sie uda albo zostanie pominieta - inna jej nie zmaze. Dopoki
    -- cokolwiek czeka, `sync_status = 'error'`, a `last_*` opisuja najnowszy
    -- nierozwiazany blad (to czyta panel); bez bledow - to wywolanie.
    SELECT k.pending_errors INTO v_pending
      FROM public.event_person_crm_links k
     WHERE k.tenant_id = p_tenant AND k.person_id = p_person_id
     FOR UPDATE;
    v_pending := COALESCE(v_pending, '{}'::jsonb) - v_key;
    v_row_status := v_status;
    v_row_error := v_reason;
    v_row_type := v_type;
    v_row_label := v_label;
    v_row_tags := v_tags;
    v_row_create := v_create;
    IF v_status = 'error' THEN
      v_pending := v_pending || jsonb_build_object(v_key, jsonb_build_object(
        'error', v_reason, 'source_type', v_type, 'tags', to_jsonb(v_tags), 'create', v_create,
        'attempt_at', clock_timestamp(), 'audit_action', p_audit_action, 'audit_meta', v_meta
      ));
    ELSE
      SELECT p.key, p.value INTO v_top_key, v_top
        FROM jsonb_each(v_pending) AS p
       ORDER BY (p.value->>'attempt_at')::timestamptz DESC NULLS LAST, p.key
       LIMIT 1;
      IF v_top IS NOT NULL THEN
        v_row_status := 'error';
        v_row_error := v_top->>'error';
        v_row_type := v_top->>'source_type';
        v_row_label := NULLIF(v_top_key, '');
        v_row_tags := ARRAY(
          SELECT jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(v_top->'tags') = 'array' THEN v_top->'tags' ELSE '[]'::jsonb END)
        );
        v_row_create := CASE
          WHEN jsonb_typeof(v_top->'create') = 'boolean' THEN (v_top->>'create')::boolean
          ELSE true
        END;
      END IF;
    END IF;

    INSERT INTO public.event_person_crm_links AS k (
      tenant_id, person_id, crm_lead_id, sync_status, last_error,
      last_source_type, last_source_label, last_tags, last_create, synced_at, last_attempt_at,
      pending_errors
    ) VALUES (
      p_tenant, p_person_id, v_lead, v_row_status, v_row_error,
      v_row_type, v_row_label, v_row_tags, v_row_create,
      CASE WHEN v_status = 'ok' THEN now() END, now(), v_pending
    )
    ON CONFLICT (tenant_id, person_id) DO UPDATE SET
      crm_lead_id = EXCLUDED.crm_lead_id,
      sync_status = EXCLUDED.sync_status,
      last_error = EXCLUDED.last_error,
      last_source_type = EXCLUDED.last_source_type,
      last_source_label = EXCLUDED.last_source_label,
      last_tags = EXCLUDED.last_tags,
      last_create = EXCLUDED.last_create,
      synced_at = COALESCE(EXCLUDED.synced_at, k.synced_at),
      last_attempt_at = EXCLUDED.last_attempt_at,
      pending_errors = EXCLUDED.pending_errors;

    RETURN v_lead;
  EXCEPTION WHEN OTHERS THEN
    v_err := left(SQLERRM, 500);
    -- Zapis bledu tez moze sie nie udac (np. uszkodzona tabela stanu) - wtedy
    -- zostaje tylko NULL, ale transakcja wolajacego nadal zyje. Wycofany blok
    -- zdjal tez blokade doradcza osoby - bierzemy ja ponownie przed odczytem
    -- i zapisem `pending_errors`, zeby nie zgubic bledu rownoleglej intencji.
    BEGIN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(p_tenant::text || ':event_person_crm:' || p_person_id::text, 0)
      );
      SELECT k.pending_errors INTO v_pending
        FROM public.event_person_crm_links k
       WHERE k.tenant_id = p_tenant AND k.person_id = p_person_id
       FOR UPDATE;
      v_pending := COALESCE(v_pending, '{}'::jsonb) || jsonb_build_object(v_key, jsonb_build_object(
        'error', v_err, 'source_type', v_type, 'tags', to_jsonb(v_tags), 'create', v_create,
        'attempt_at', clock_timestamp(), 'audit_action', p_audit_action, 'audit_meta', v_meta
      ));
      INSERT INTO public.event_person_crm_links AS k (
        tenant_id, person_id, sync_status, last_error,
        last_source_type, last_source_label, last_tags, last_create, last_attempt_at,
        pending_errors
      ) VALUES (
        p_tenant, p_person_id, 'error', v_err,
        v_type, v_label, v_tags, v_create, now(), v_pending
      )
      ON CONFLICT (tenant_id, person_id) DO UPDATE SET
        sync_status = 'error',
        last_error = EXCLUDED.last_error,
        last_source_type = EXCLUDED.last_source_type,
        last_source_label = EXCLUDED.last_source_label,
        last_tags = EXCLUDED.last_tags,
        last_create = EXCLUDED.last_create,
        last_attempt_at = EXCLUDED.last_attempt_at,
        pending_errors = EXCLUDED.pending_errors;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public._event_person_crm_sync(uuid, uuid, text, text, text[], jsonb, boolean, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_crm_sync(uuid, uuid, text, text, text[], jsonb, boolean, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public._event_person_crm_sync(uuid, uuid, text, text, text[], jsonb, boolean, text, jsonb) IS
  'Jedyne wejscie modulu Wydarzen do crm_leads: kontakt po e-mailu (nowy zaklada most z imieniem i nazwiskiem, zeby crm_lead.created.v1 je niosl; dalej crm_upsert_from_form bez scalania po nazwisku), segment tylko w gore (_crm_source_type_rank), tagi bez duplikatow, zgoda marketingowa wylacznie z dowodu: stempel event_people.consent_marketing_at bez wycofania ORAZ najnowszy wpis marketingu w event_consent_records = confirmed dla obecnego adresu (osoba bez wpisow: sam stempel) ORAZ brak given=false w crm_consent_log dla adresu od chwili dowodu (wycofanie nie wraca) + wiersz crm_consent_log z tekstem, wersja, kanalem, skrotem IP i user agentem z ksiegi, newsletter_status NULL wylacznie dla kontaktu zalozonego przez to wywolanie (adres zalozony rownolegle = kontakt istniejacy, newsletter nietkniety), wpis osi czasu event.* bez duplikatow (jeden na akcje i odnosnik: zgloszenie, zgloszenie naboru, faktura albo wydarzenie). Nigdy nie rzuca - blad zostaje w event_person_crm_links per intencja (pending_errors, klucz = etykieta zrodla); udana albo pominieta intencja zdejmuje wylacznie wlasny blad. Wolane z innych funkcji SECURITY DEFINER.';
