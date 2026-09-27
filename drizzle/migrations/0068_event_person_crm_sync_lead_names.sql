-- Most CRM: nowy kontakt zakladany z imieniem i nazwiskiem (crm_lead.created.v1
-- niesie je do HubSpot) + komentarze obiektow fundamentu, ktorych brak w zapisie 0066.
-- Adres zalozony rownolegle (ON CONFLICT) = kontakt istniejacy: newsletter i zgoda
-- nietkniete (v_created z RETURNING, ponowny odczyt FOR UPDATE).
-- Blizniak: supabase/migrations/20260927000900_event_person_crm_sync_lead_names.sql
-- (tam pelne uzasadnienie).

-- ----------------------------------------------------------------------------
-- 1) MOST: OSOBA WYDARZENIA -> KONTAKT CRM (nowy kontakt z imieniem i nazwiskiem)
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

          IF p_audit_action IS NOT NULL THEN
            INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
            VALUES (
              p_tenant,
              auth.uid(),
              p_audit_action,
              'crm_lead',
              v_lead,
              CASE WHEN jsonb_typeof(p_audit_meta) = 'object' THEN p_audit_meta ELSE '{}'::jsonb END
                || jsonb_build_object('source_label', v_label, 'person_id', p_person_id)
            );
          END IF;

          v_status := 'ok';
        END IF;
      END IF;
    END IF;

    INSERT INTO public.event_person_crm_links AS k (
      tenant_id, person_id, crm_lead_id, sync_status, last_error,
      last_source_type, last_source_label, last_tags, last_create, synced_at, last_attempt_at
    ) VALUES (
      p_tenant, p_person_id, v_lead, v_status, v_reason,
      v_type, v_label, v_tags, v_create,
      CASE WHEN v_status = 'ok' THEN now() END, now()
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
      last_attempt_at = EXCLUDED.last_attempt_at;

    RETURN v_lead;
  EXCEPTION WHEN OTHERS THEN
    v_err := left(SQLERRM, 500);
    -- Zapis bledu tez moze sie nie udac (np. uszkodzona tabela stanu) - wtedy
    -- zostaje tylko NULL, ale transakcja wolajacego nadal zyje.
    BEGIN
      INSERT INTO public.event_person_crm_links AS k (
        tenant_id, person_id, sync_status, last_error,
        last_source_type, last_source_label, last_tags, last_create, last_attempt_at
      ) VALUES (
        p_tenant, p_person_id, 'error', v_err,
        v_type, v_label, v_tags, v_create, now()
      )
      ON CONFLICT (tenant_id, person_id) DO UPDATE SET
        sync_status = 'error',
        last_error = EXCLUDED.last_error,
        last_source_type = EXCLUDED.last_source_type,
        last_source_label = EXCLUDED.last_source_label,
        last_tags = EXCLUDED.last_tags,
        last_create = EXCLUDED.last_create,
        last_attempt_at = EXCLUDED.last_attempt_at;
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
  'Jedyne wejscie modulu Wydarzen do crm_leads: kontakt po e-mailu (nowy zaklada most z imieniem i nazwiskiem, zeby crm_lead.created.v1 je niosl; dalej crm_upsert_from_form bez scalania po nazwisku), segment tylko w gore (_crm_source_type_rank), tagi bez duplikatow, zgoda marketingowa wylacznie z dowodu (event_people.consent_marketing_at bez wycofania) + wiersz crm_consent_log, newsletter_status NULL wylacznie dla kontaktu zalozonego przez to wywolanie (adres zalozony rownolegle = kontakt istniejacy, newsletter nietkniety), wpis osi czasu event.*. Nigdy nie rzuca - blad zostaje w event_person_crm_links. Wolane z innych funkcji SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- 2) KOMENTARZE, KTORYCH BRAK W ZAPISIE 0066 (panel Lovable pominal COMMENT ON)
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION public.admin_event_features_save(uuid, jsonb) IS
  'Przelaczniki modulow wydarzenia (pages, registration, tickets, sessions, meetings, onsite, sponsors, cfp, seating). Biala lista kluczy, zapisywane sa wylacznie WYLACZENIA - klucz nieobecny znaczy modul wlaczony, wiec nowy modul nie znika wydarzeniom sprzed jego powstania.';

COMMENT ON TABLE public.event_person_crm_links IS
  'Stan mostu osoba wydarzenia -> kontakt CRM: ktory kontakt, wynik ostatniej proby i intencja ostatniego wywolania (do ponowienia). Zapis wylacznie przez _event_person_crm_sync; odczyt admin/super_admin najemcy.';

COMMENT ON COLUMN public.event_person_crm_links.sync_status IS
  'ok = kontakt zsynchronizowany; error = proba sie nie udala (last_error); skipped = pominieto (last_error: email_missing albo lead_not_found przy p_create = false).';

COMMENT ON COLUMN public.event_person_crm_links.last_error IS
  'Przyczyna ostatniego stanu innego niz ok: kod pominiecia (email_missing, lead_not_found), kod lead_conflict_lost (kontakt zalozony rownolegle zniknal zaraz po konflikcie) albo SQLERRM (maks. 500 znakow).';

COMMENT ON COLUMN public.event_person_crm_links.last_tags IS
  'Tagi ostatniego wywolania - ponowienie dokleja je jeszcze raz (scalanie tagow jest idempotentne).';

COMMENT ON FUNCTION public._crm_source_type_rank(text) IS
  'Ranga segmentu crm_leads.source_type: manual 10 < contact_form = newsletter 20 < registered 30 < event_participant 40 < event_cfp 50 < speaker 60 < club_application = careers = expert 70 < paid_subscriber 90; nieznany/NULL = 0. Segment zmienia sie tylko na wyzsza range.';

COMMENT ON FUNCTION public.admin_event_person_crm_retry(uuid) IS
  'Ponowienie synchronizacji osoby wydarzenia z CRM z zapisana intencja ostatniego wywolania. Bramka: assert_event_admin_tenant(). Zwraca id kontaktu albo NULL (stan w event_person_crm_links).';
