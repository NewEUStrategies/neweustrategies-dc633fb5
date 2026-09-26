-- Fundament funkcji organizatora: przelaczniki cfp/seating, segment CRM event_cfp,
-- stan mostu event_person_crm_links, ranga segmentow _crm_source_type_rank,
-- most _event_person_crm_sync (osoba wydarzenia -> kontakt CRM, nigdy nie rzuca)
-- i ponowienie admin_event_person_crm_retry.
-- Blizniak: supabase/migrations/20260926090000_event_organizer_foundation.sql
-- (tam pelne uzasadnienie: RODO, przekazanie do partnerskiego CRM, kontrakt osi czasu).

-- ----------------------------------------------------------------------------
-- 1) PRZELACZNIKI MODULOW: + cfp, seating
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_features_save(p_event_id uuid, p_features jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_in jsonb := COALESCE(p_features, '{}'::jsonb);
  v_current jsonb;
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_keys text[] := ARRAY[
    'pages', 'registration', 'tickets', 'sessions', 'meetings', 'onsite', 'sponsors',
    'cfp', 'seating'
  ];
BEGIN
  SELECT e.features INTO v_current
  FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  FOREACH v_key IN ARRAY v_keys LOOP
    IF v_in ? v_key THEN
      IF jsonb_typeof(v_in->v_key) <> 'boolean' THEN
        RAISE EXCEPTION 'invalid_feature: % must be true or false', v_key;
      END IF;
      -- Zapisujemy WYLACZNIE wylaczenia. Klucz `true` jest wartoscia domyslna,
      -- a zapisany zamrazalby dzisiejszy zbior modulow: wydarzenie przestalo
      -- by dostawac moduly dodane pozniej.
      IF NOT (v_in->>v_key)::boolean THEN
        v_out := v_out || jsonb_build_object(v_key, false);
      END IF;
    -- Klucz pominiety w payloadzie zachowuje dzisiejszy stan: ekran moze
    -- wyslac jeden przelacznik i nie wlaczyc przy okazji pozostalych.
    ELSIF (v_current->>v_key) = 'false' THEN
      v_out := v_out || jsonb_build_object(v_key, false);
    END IF;
  END LOOP;

  UPDATE public.events e
  SET features = v_out, updated_at = now()
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_features_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_features_save(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_features_save(uuid, jsonb) IS
  'Przelaczniki modulow wydarzenia (pages, registration, tickets, sessions, meetings, onsite, sponsors, cfp, seating). Biala lista kluczy, zapisywane sa wylacznie WYLACZENIA - klucz nieobecny znaczy modul wlaczony, wiec nowy modul nie znika wydarzeniom sprzed jego powstania.';

-- ----------------------------------------------------------------------------
-- 2) SEGMENT KONTAKTU: + event_cfp
--
-- Ostatni blok `ADD CONSTRAINT crm_leads_source_type_check` w posortowanych
-- migracjach jest zrodlem prawdy dla testu kontraktu - lista musi zawierac
-- WSZYSTKIE dotychczasowe wartosci.
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_source_type_check;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_source_type_check
  CHECK (source_type IN ('registered','paid_subscriber','event_participant',
    'speaker','expert','contact_form','newsletter','manual','club_application',
    'careers','event_cfp'));

-- ----------------------------------------------------------------------------
-- 3) STAN MOSTU PER OSOBA WYDARZENIA
--
-- KLUCZ `(tenant_id, person_id)`: jedna osoba wydarzenia ma jeden kontakt CRM
-- (tozsamoscia obu jest e-mail w granicach najemcy). Klucz obcy do
-- `event_people` jest ZLOZONY i kaskadowy - usuniecie osoby zabiera stan mostu.
-- Klucz obcy do `crm_leads` jest ZLOZONY z forma kolumnowa PG15
-- `ON DELETE SET NULL (crm_lead_id)`: zwykle SET NULL na kluczu zlozonym
-- zerowaloby tez `tenant_id NOT NULL` i blokowalo usuniecie kontaktu w CRM.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_person_crm_links (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  crm_lead_id uuid,
  sync_status text NOT NULL DEFAULT 'skipped',
  last_error text,
  last_source_type text,
  last_source_label text,
  last_tags text[] NOT NULL DEFAULT '{}'::text[],
  last_create boolean NOT NULL DEFAULT true,
  synced_at timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_person_crm_links_pkey PRIMARY KEY (tenant_id, person_id),
  CONSTRAINT event_person_crm_links_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_person_crm_links_lead_fk FOREIGN KEY (tenant_id, crm_lead_id)
    REFERENCES public.crm_leads (tenant_id, id) ON DELETE SET NULL (crm_lead_id),
  CONSTRAINT event_person_crm_links_sync_status_values
    CHECK (sync_status IN ('ok', 'error', 'skipped')),
  CONSTRAINT event_person_crm_links_last_error_len
    CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT event_person_crm_links_last_source_type_len
    CHECK (last_source_type IS NULL OR char_length(last_source_type) <= 64),
  CONSTRAINT event_person_crm_links_last_source_label_len
    CHECK (last_source_label IS NULL OR char_length(last_source_label) <= 200)
);

COMMENT ON TABLE public.event_person_crm_links IS
  'Stan mostu osoba wydarzenia -> kontakt CRM: ktory kontakt, wynik ostatniej proby i intencja ostatniego wywolania (do ponowienia). Zapis wylacznie przez _event_person_crm_sync; odczyt admin/super_admin najemcy.';
COMMENT ON COLUMN public.event_person_crm_links.sync_status IS
  'ok = kontakt zsynchronizowany; error = proba sie nie udala (last_error); skipped = pominieto (last_error: email_missing albo lead_not_found przy p_create = false).';
COMMENT ON COLUMN public.event_person_crm_links.last_error IS
  'Przyczyna ostatniego stanu innego niz ok: kod pominiecia albo SQLERRM (maks. 500 znakow).';
COMMENT ON COLUMN public.event_person_crm_links.last_tags IS
  'Tagi ostatniego wywolania - ponowienie dokleja je jeszcze raz (scalanie tagow jest idempotentne).';

CREATE INDEX IF NOT EXISTS event_person_crm_links_lead_idx
  ON public.event_person_crm_links (tenant_id, crm_lead_id)
  WHERE crm_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_person_crm_links_error_idx
  ON public.event_person_crm_links (tenant_id, last_attempt_at DESC)
  WHERE sync_status = 'error';

DROP TRIGGER IF EXISTS event_person_crm_links_touch_updated_at ON public.event_person_crm_links;
CREATE TRIGGER event_person_crm_links_touch_updated_at
  BEFORE UPDATE ON public.event_person_crm_links
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

REVOKE ALL ON public.event_person_crm_links FROM anon, authenticated;
GRANT SELECT ON public.event_person_crm_links TO authenticated;
GRANT ALL ON public.event_person_crm_links TO service_role;
ALTER TABLE public.event_person_crm_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_person_crm_links_staff_read" ON public.event_person_crm_links;
CREATE POLICY "event_person_crm_links_staff_read"
  ON public.event_person_crm_links FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );
-- Zapis: BRAK polityki klienckiej - wylacznie przez SECURITY DEFINER.

-- ----------------------------------------------------------------------------
-- 4) KOLEJNOSC SEGMENTOW KONTAKTU (uzasadnienie w naglowku, pkt 4)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._crm_source_type_rank(p_source_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_source_type
    WHEN 'manual' THEN 10
    WHEN 'contact_form' THEN 20
    WHEN 'newsletter' THEN 20
    WHEN 'registered' THEN 30
    WHEN 'event_participant' THEN 40
    WHEN 'event_cfp' THEN 50
    WHEN 'speaker' THEN 60
    WHEN 'club_application' THEN 70
    WHEN 'careers' THEN 70
    WHEN 'expert' THEN 70
    WHEN 'paid_subscriber' THEN 90
    ELSE 0
  END
$$;

REVOKE ALL ON FUNCTION public._crm_source_type_rank(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_source_type_rank(text) TO service_role;

COMMENT ON FUNCTION public._crm_source_type_rank(text) IS
  'Ranga segmentu crm_leads.source_type: manual 10 < contact_form = newsletter 20 < registered 30 < event_participant 40 < event_cfp 50 < speaker 60 < club_application = careers = expert 70 < paid_subscriber 90; nieznany/NULL = 0. Segment zmienia sie tylko na wyzsza range.';

-- ----------------------------------------------------------------------------
-- 5) MOST: OSOBA WYDARZENIA -> KONTAKT CRM
--
-- Wejscie:
--   p_tenant, p_person_id - osoba (`event_people`) z najemcy, ktorego wolajacy
--     juz autoryzowal (admin: assert_event_admin_tenant(); plaszczyzna
--     publiczna: wiersz wydarzenia z public_tenant_id()).
--   p_source_type  - docelowy segment (`event_participant`, `event_cfp`,
--     `speaker`); stosowany tylko, gdy ma wyzsza range niz obecny.
--   p_source_label - wpis do `aliases.sources`, np. 'event:<slug>:cfp'.
--   p_tags         - doklejane do `crm_leads.tags` (bez duplikatow, kolejnosc
--     istniejacych zachowana, lacznie maks. 60 tagow po maks. 60 znakow).
--   p_custom       - `_custom` dla `crm_upsert_from_form` (aliases.custom).
--   p_create       - false = tylko wzbogac istniejacy kontakt, nigdy nie zakladaj.
--   p_audit_action, p_audit_meta - wpis osi czasu (kontrakt w naglowku).
-- Wynik: id kontaktu albo NULL. NIGDY nie rzuca.
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
      SELECT l.id INTO v_existing
        FROM public.crm_leads l
       WHERE l.tenant_id = p_tenant AND l.email_norm = v_email_norm;

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

        -- Imie, nazwisko i firma jako NULL: bez nich `crm_upsert_from_form`
        -- nie scala po nazwisku i nie zaklada firmy z wolnego tekstu.
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
          newsletter_status = CASE WHEN v_existing IS NULL THEN NULL ELSE l.newsletter_status END,
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
  'Jedyne wejscie modulu Wydarzen do crm_leads: kontakt po e-mailu (crm_upsert_from_form bez scalania po nazwisku), segment tylko w gore (_crm_source_type_rank), tagi bez duplikatow, zgoda marketingowa wylacznie z dowodu (event_people.consent_marketing_at bez wycofania) + wiersz crm_consent_log, newsletter_status NULL dla nowego kontaktu, wpis osi czasu event.*. Nigdy nie rzuca - blad zostaje w event_person_crm_links. Wolane z innych funkcji SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- 6) PONOWIENIE NIEUDANEJ SYNCHRONIZACJI (plaszczyzna panelu)
--
-- Powtarza ZAPISANA intencje ostatniego wywolania (segment, etykieta, tagi,
-- `p_create`). Pola niestandardowe (`p_custom`) i wpis osi czasu nie sa
-- powtarzane: pierwsze nie sa przechowywane poza CRM (to np. parametry
-- kampanii), a wpis osi czasu nalezy do zdarzenia biznesowego, nie do
-- ponowienia.
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
BEGIN
  SELECT k.* INTO v_link
    FROM public.event_person_crm_links k
   WHERE k.tenant_id = v_tenant AND k.person_id = p_person_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: no CRM sync is recorded for this person in this tenant';
  END IF;

  RETURN public._event_person_crm_sync(
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
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_person_crm_retry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_person_crm_retry(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_person_crm_retry(uuid) IS
  'Ponowienie synchronizacji osoby wydarzenia z CRM z zapisana intencja ostatniego wywolania. Bramka: assert_event_admin_tenant(). Zwraca id kontaktu albo NULL (stan w event_person_crm_links).';
