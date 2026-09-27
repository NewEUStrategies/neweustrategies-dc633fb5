-- Most CRM: stan per intencja (event_person_crm_links.pending_errors - blad jednej
-- intencji nie znika pod inna, ponowienie powtarza kazda czekajaca) i os czasu bez
-- duplikatow (jeden wpis na akcje i odnosnik).
-- Blizniak: supabase/migrations/20260927001400_event_person_crm_intents.sql
-- (tam pelne uzasadnienie). Bez wpisu w meta/_journal.json - kolejnosc wdrozenia
-- w scripts/deploy-order/produkcja.txt.

-- ----------------------------------------------------------------------------
-- 1) STAN PER INTENCJA: kolumna, komentarze i wpisy dla dzisiejszych bledow
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_person_crm_links
  ADD COLUMN IF NOT EXISTS pending_errors jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT event_person_crm_links_pending_errors_object
    CHECK (jsonb_typeof(pending_errors) = 'object');

COMMENT ON COLUMN public.event_person_crm_links.pending_errors IS
  'Nierozwiazane bledy per intencja: klucz = etykieta zrodla (event:<slug>:<intencja>), wartosc = {error, source_type, tags, create, attempt_at, audit_action, audit_meta}. Wpis zdejmuje wylacznie udana albo pominieta ta sama intencja; admin_event_person_crm_retry powtarza kazdy wpis.';

COMMENT ON TABLE public.event_person_crm_links IS
  'Stan mostu osoba wydarzenia -> kontakt CRM: ktory kontakt, wynik ostatniej proby, intencja do ponowienia i nierozwiazane bledy per intencja (pending_errors). Zapis wylacznie przez _event_person_crm_sync; odczyt admin/super_admin najemcy.';

COMMENT ON COLUMN public.event_person_crm_links.sync_status IS
  'ok = kontakt zsynchronizowany; error = co najmniej jedna intencja czeka na ponowienie (pending_errors), last_* opisuja najnowszy z tych bledow; skipped = pominieto (last_error: email_missing albo lead_not_found przy p_create = false).';

-- Dzisiejsze bledy (jedna intencja na osobe - wiecej stan nie pamietal).
UPDATE public.event_person_crm_links k
   SET pending_errors = jsonb_build_object(
         COALESCE(k.last_source_label, ''),
         jsonb_build_object(
           'error', k.last_error,
           'source_type', k.last_source_type,
           'tags', to_jsonb(k.last_tags),
           'create', k.last_create,
           'attempt_at', k.last_attempt_at,
           'audit_action', NULL,
           'audit_meta', '{}'::jsonb
         )
       )
 WHERE k.sync_status = 'error'
   AND k.pending_errors = '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 2) MOST: stan per intencja i os czasu bez duplikatow
-- ----------------------------------------------------------------------------
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

          v_evidence := v_person.consent_marketing_at IS NOT NULL
                        AND v_person.consent_withdrawn_at IS NULL;

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
            INSERT INTO public.crm_consent_log (
              tenant_id, email, source_type, source_id, form_id, form_name,
              consent_key, consent_text, consent_version, given, ip, user_agent, lang
            ) VALUES (
              p_tenant, v_email, 'event'::public.crm_source_type, p_person_id, v_label, NULL,
              'marketing',
              format(
                'Organizer marketing consent given by the event participant (event_people.consent_marketing_at = %s); copied to CRM by the event bridge from source %s.',
                to_char(v_person.consent_marketing_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                COALESCE(v_label, 'event')
              ),
              NULL, true, NULL, NULL, NULL
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
  'Jedyne wejscie modulu Wydarzen do crm_leads: kontakt po e-mailu (nowy zaklada most z imieniem i nazwiskiem, zeby crm_lead.created.v1 je niosl; dalej crm_upsert_from_form bez scalania po nazwisku), segment tylko w gore (_crm_source_type_rank), tagi bez duplikatow, zgoda marketingowa wylacznie z dowodu (event_people.consent_marketing_at bez wycofania) + wiersz crm_consent_log, newsletter_status NULL wylacznie dla kontaktu zalozonego przez to wywolanie (adres zalozony rownolegle = kontakt istniejacy, newsletter nietkniety), wpis osi czasu event.* bez duplikatow (jeden na akcje i odnosnik: zgloszenie, zgloszenie naboru, faktura albo wydarzenie). Nigdy nie rzuca - blad zostaje w event_person_crm_links per intencja (pending_errors, klucz = etykieta zrodla); udana albo pominieta intencja zdejmuje wylacznie wlasny blad. Wolane z innych funkcji SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- 3) PONOWIENIE: kazda czekajaca intencja
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_person_crm_retry(p_person_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_link public.event_person_crm_links%ROWTYPE;
  r record;
BEGIN
  SELECT k.* INTO v_link
    FROM public.event_person_crm_links k
   WHERE k.tenant_id = v_tenant AND k.person_id = p_person_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: no CRM sync is recorded for this person in this tenant';
  END IF;

  IF v_link.pending_errors <> '{}'::jsonb THEN
    -- Kazda nierozwiazana intencja osobno, od najstarszej: nieudane przyjecie
    -- prelegenta nie ginie pod pozniejsza odprawa. Wpis osi czasu intencji
    -- jest powtarzany - bez tego zdarzenie, ktorego zapis sie nie udal, nie
    -- mialoby wpisu wcale, a most i tak go nie dubluje (ta sama akcja
    -- i odnosnik). Pola niestandardowe (`p_custom`) nie sa przechowywane.
    FOR r IN
      SELECT p.key, p.value
        FROM jsonb_each(v_link.pending_errors) AS p
       ORDER BY (p.value->>'attempt_at')::timestamptz NULLS FIRST, p.key
    LOOP
      PERFORM public._event_person_crm_sync(
        v_tenant,
        p_person_id,
        r.value->>'source_type',
        NULLIF(r.key, ''),
        ARRAY(
          SELECT jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(r.value->'tags') = 'array' THEN r.value->'tags' ELSE '[]'::jsonb END)
        ),
        '{}'::jsonb,
        CASE
          WHEN jsonb_typeof(r.value->'create') = 'boolean' THEN (r.value->>'create')::boolean
          ELSE v_link.last_create
        END,
        r.value->>'audit_action',
        CASE
          WHEN jsonb_typeof(r.value->'audit_meta') = 'object' THEN r.value->'audit_meta'
          ELSE '{}'::jsonb
        END
      );
    END LOOP;
  ELSE
    -- Nic nie czeka: powtorka zapisanej intencji ostatniego wywolania.
    PERFORM public._event_person_crm_sync(
      v_tenant,
      p_person_id,
      v_link.last_source_type,
      v_link.last_source_label,
      v_link.last_tags,
      '{}'::jsonb,
      v_link.last_create,
      NULL,
      '{}'::jsonb
    );
  END IF;

  RETURN (
    SELECT k.crm_lead_id
      FROM public.event_person_crm_links k
     WHERE k.tenant_id = v_tenant AND k.person_id = p_person_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_person_crm_retry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_person_crm_retry(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_person_crm_retry(uuid) IS
  'Ponowienie synchronizacji osoby wydarzenia z CRM: kazda intencja czekajaca w pending_errors (od najstarszej, z jej segmentem, tagami, p_create i wpisem osi czasu - most go nie dubluje), a gdy nic nie czeka - zapisana intencja ostatniego wywolania. Bramka: assert_event_admin_tenant(). Zwraca biezace id kontaktu z event_person_crm_links albo NULL (stan w event_person_crm_links).';

-- ----------------------------------------------------------------------------
-- 4) PRZENIESIENIE ZE STOISK: wynik z wlasnego wywolania, bez wlasnej kontroli
--    duplikatow (cialo z 20260927000501)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_lead_scans_push_to_crm(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(COALESCE(p_payload->>'event_id', ''), '')::uuid;
  v_sponsor_id uuid := NULLIF(COALESCE(p_payload->>'sponsor_id', ''), '')::uuid;
  -- Strona: kursor (ostatnia osoba poprzedniej strony) i rozmiar 1..500.
  v_after uuid := NULLIF(COALESCE(p_payload->>'after_person_id', ''), '')::uuid;
  v_limit integer := CASE
    WHEN jsonb_typeof(p_payload->'limit') = 'number'
      THEN LEAST(500, GREATEST(1, floor((p_payload->>'limit')::numeric)))::integer
    ELSE 500
  END;
  v_last uuid;
  v_has_more boolean := false;
  v_event public.events%ROWTYPE;
  v_label text;
  r record;
  v_email text;
  v_consent boolean;
  v_existing boolean;
  v_lead uuid;
  v_persons integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_no_email integer := 0;
  v_no_consent integer := 0;
  v_failed integer := 0;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF v_sponsor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id AND s.id = v_sponsor_id
  ) THEN
    RAISE EXCEPTION 'sponsor_not_found: the sponsor does not exist in this event';
  END IF;

  v_label := 'event:' || v_event.slug || ':sponsor_lead';

  FOR r IN
    SELECT l.person_id,
           array_agg(DISTINCT s.company_id ORDER BY s.company_id) AS company_ids,
           array_agg(DISTINCT s.id ORDER BY s.id) AS sponsor_ids,
           string_agg(DISTINCT s.snapshot_name, ', ' ORDER BY s.snapshot_name) AS sponsor_names
      FROM public.event_lead_scans l
      JOIN public.event_sponsors s ON s.tenant_id = l.tenant_id AND s.id = l.sponsor_id
     WHERE l.tenant_id = v_tenant AND l.event_id = v_event_id
       AND (v_sponsor_id IS NULL OR l.sponsor_id = v_sponsor_id)
       AND (v_after IS NULL OR l.person_id > v_after)
     GROUP BY l.person_id
     ORDER BY l.person_id
     LIMIT v_limit
  LOOP
    v_persons := v_persons + 1;
    v_last := r.person_id;

    SELECT lower(NULLIF(btrim(COALESCE(p.email, '')), '')),
           (p.consent_marketing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL)
      INTO v_email, v_consent
      FROM public.event_people p
     WHERE p.tenant_id = v_tenant AND p.id = r.person_id;

    v_existing := v_email IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.crm_leads c WHERE c.tenant_id = v_tenant AND c.email_norm = v_email
    );

    -- Ponowne przeniesienie tej samej osoby nie zasmieca osi czasu CRM:
    -- most pisze jeden wpis na akcje i wydarzenie (takze po odprawie albo
    -- innej intencji pomiedzy przeniesieniami).
    v_lead := public._event_person_crm_sync(
      v_tenant,
      r.person_id,
      'event_participant',
      v_label,
      ARRAY['event:' || v_event.slug]
        || ARRAY(SELECT 'sponsor_lead:' || c::text FROM unnest(r.company_ids) AS c),
      '{}'::jsonb,
      COALESCE(v_consent, false),
      'event.sponsor_lead.pushed',
      jsonb_build_object(
        'event_id', v_event.id,
        'event_slug', v_event.slug,
        'event_title_pl', v_event.title_pl,
        'event_title_en', v_event.title_en,
        'summary_pl', format(
          U&'Kontakt zebrany na stoisku (%s) podczas wydarzenia "%s" przeniesiony do CRM',
          r.sponsor_names, v_event.title_pl
        ),
        'summary_en', format(
          'Contact collected at the booth (%s) during "%s" moved to CRM',
          r.sponsor_names, v_event.title_en
        ),
        'sponsor_ids', to_jsonb(r.sponsor_ids)
      )
    );

    IF v_lead IS NOT NULL THEN
      IF v_existing THEN
        v_updated := v_updated + 1;
      ELSE
        v_created := v_created + 1;
      END IF;
    -- Wynik TEGO wywolania, nie stan calej osoby: `sync_status = 'error'`
    -- moze nalezec do innej intencji (np. nieudanego przyjecia prelegenta),
    -- a przeniesienie bez zgody i bez kontaktu jest tylko pominiete.
    ELSIF v_email IS NULL THEN
      v_no_email := v_no_email + 1;
    ELSIF EXISTS (
      SELECT 1
        FROM public.event_person_crm_links k
       WHERE k.tenant_id = v_tenant AND k.person_id = r.person_id
         AND k.pending_errors ? v_label
    ) THEN
      v_failed := v_failed + 1;
    ELSE
      v_no_consent := v_no_consent + 1;
    END IF;
  END LOOP;

  -- Czy za ta strona zostal ktos jeszcze (ten sam zbior co petla).
  v_has_more := v_last IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.event_lead_scans l
      JOIN public.event_sponsors s ON s.tenant_id = l.tenant_id AND s.id = l.sponsor_id
     WHERE l.tenant_id = v_tenant AND l.event_id = v_event_id
       AND (v_sponsor_id IS NULL OR l.sponsor_id = v_sponsor_id)
       AND l.person_id > v_last
  );

  RETURN jsonb_build_object(
    'persons', v_persons,
    'created', v_created,
    'updated', v_updated,
    'skipped_no_email', v_no_email,
    'skipped_no_consent', v_no_consent,
    'failed', v_failed,
    'has_more', v_has_more,
    'next_after', CASE WHEN v_has_more THEN v_last END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) IS
  'Jawne przeniesienie kontaktow zebranych na stoiskach do CRM: {event_id, sponsor_id?, after_person_id?, limit? (1..500, domyslnie 500)} - strona osob po person_id rosnaco. Przez most _event_person_crm_sync: nowy kontakt WYLACZNIE ze zgoda marketingowa organizatora (p_create = dowod), inaczej tylko wzbogacenie istniejacego; segment event_participant, tagi event:<slug> i sponsor_lead:<id firmy>; notatki i oceny sponsora nie ida do CRM. Zwraca {persons, created, updated, skipped_no_email, skipped_no_consent, failed, has_more, next_after} - klient wola dalej z after_person_id = next_after, dopoki has_more. Bramka: assert_event_admin_tenant().';
