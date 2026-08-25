DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.crm_companies'::regclass
      AND conname = 'crm_companies_tenant_id_key'
  ) THEN
    ALTER TABLE public.crm_companies
      ADD CONSTRAINT crm_companies_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT crm_companies_tenant_id_key ON public.crm_companies IS
  'Tozsamosc firmy w granicach najemcy. Cel kluczy obcych zlozonych (tenant_id, company_id) - uniemozliwia wskazanie firmy innego najemcy.';

CREATE TABLE IF NOT EXISTS public.event_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  email_norm text GENERATED ALWAYS AS (NULLIF(lower(btrim(email)), '')) STORED,
  first_name text NOT NULL,
  last_name text NOT NULL,
  full_name_norm text GENERATED ALWAYS AS
    (lower(btrim(btrim(first_name) || ' ' || btrim(last_name)))) STORED,
  phone text,
  job_title text,
  company_text text,
  company_id uuid,
  social_profile_url text,
  source text NOT NULL DEFAULT 'self_registration',
  notes text,
  consent_data_processing_at timestamptz,
  consent_marketing_at timestamptz,
  consent_partner_sharing_at timestamptz,
  consent_withdrawn_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_people_first_name_len
    CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 80),
  CONSTRAINT event_people_last_name_len
    CHECK (char_length(btrim(last_name)) BETWEEN 1 AND 80),
  CONSTRAINT event_people_email_shape CHECK (
    email IS NULL
    OR btrim(email) = ''
    OR btrim(email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
  ),
  CONSTRAINT event_people_email_len CHECK (email IS NULL OR char_length(email) <= 320),
  CONSTRAINT event_people_phone_len CHECK (phone IS NULL OR char_length(btrim(phone)) BETWEEN 4 AND 40),
  CONSTRAINT event_people_job_title_len CHECK (job_title IS NULL OR char_length(job_title) <= 160),
  CONSTRAINT event_people_company_text_len CHECK (company_text IS NULL OR char_length(company_text) <= 200),
  CONSTRAINT event_people_social_url_https
    CHECK (social_profile_url IS NULL OR social_profile_url ~ '^https://'),
  CONSTRAINT event_people_notes_len CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT event_people_source_values CHECK (source IN (
    'self_registration', 'invitation', 'organizer', 'import', 'crm', 'partner', 'scan'
  )),
  CONSTRAINT event_people_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_people_company_tenant_fkey
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES public.crm_companies (tenant_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_people IS
  'Kartoteka osob najemcy dla modulu Wydarzen. Osoba istnieje BEZ konta w auth.users; user_id jest opcjonalnym dowiazaniem zapinanym przy pierwszym zapisie zalogowanego. Adres poczty unikalny w granicach najemcy.';

COMMENT ON COLUMN public.event_people.user_id IS
  'Opcjonalne dowiazanie do konta. NULL = uczestnik bez konta (21 z 21 prelegentow w danych referencyjnych). Dopinane przez event_register(), gdy adres sie zgadza.';

COMMENT ON COLUMN public.event_people.email_norm IS
  'Klucz dopasowania osoby (lower+btrim, pusty napis na NULL). Zrodlo unikalnosci w granicach najemcy.';

COMMENT ON COLUMN public.event_people.company_text IS
  'Nazwa firmy podana przez uczestnika. Zostaje po dopasowaniu do CRM - dowod, co czlowiek naprawde napisal.';

COMMENT ON COLUMN public.event_people.company_id IS
  'Firma z rejestru CRM (crm_companies). Klucz obcy ZLOZONY po (tenant_id, company_id), wiec nie da sie wskazac firmy obcego najemcy.';

COMMENT ON COLUMN public.event_people.source IS
  'Zrodlo pozyskania: self_registration | invitation | organizer | import | crm | partner | scan.';

COMMENT ON COLUMN public.event_people.consent_data_processing_at IS
  'Stempel zgody na przetwarzanie danych. Warunek obslugi zapisu - event_register() go wymaga.';

COMMENT ON COLUMN public.event_people.consent_partner_sharing_at IS
  'Stempel zgody na przekazanie danych partnerowi (skan badge na stoisku). NIE MOZE blokowac zatwierdzenia zapisu - inaczej jest zgoda pozorna.';

COMMENT ON COLUMN public.event_people.consent_withdrawn_at IS
  'Stempel wycofania zgod. Osobna kolumna, nie skasowanie stempla nadania - dowod potrzebuje obu dat.';

CREATE UNIQUE INDEX IF NOT EXISTS event_people_tenant_email_uniq
  ON public.event_people (tenant_id, email_norm) WHERE email_norm IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_people_tenant_user_uniq
  ON public.event_people (tenant_id, user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_people_tenant_name_idx
  ON public.event_people (tenant_id, last_name, first_name);

CREATE INDEX IF NOT EXISTS event_people_tenant_company_idx
  ON public.event_people (tenant_id, company_id) WHERE company_id IS NOT NULL;

GRANT SELECT ON public.event_people TO authenticated;

GRANT ALL ON public.event_people TO service_role;

ALTER TABLE public.event_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_people_staff_read" ON public.event_people;

CREATE POLICY "event_people_staff_read"
  ON public.event_people FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_people_self_read" ON public.event_people;

CREATE POLICY "event_people_self_read"
  ON public.event_people FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND user_id = (SELECT auth.uid())
  );

DROP TRIGGER IF EXISTS event_people_touch_updated_at ON public.event_people;

CREATE TRIGGER event_people_touch_updated_at
  BEFORE UPDATE ON public.event_people
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  color text,
  attendee_visibility text NOT NULL DEFAULT 'registered',
  can_see_attendees boolean NOT NULL DEFAULT true,
  can_meet boolean NOT NULL DEFAULT false,
  can_chat boolean NOT NULL DEFAULT true,
  can_lead_retrieval boolean NOT NULL DEFAULT false,
  can_see_recording boolean NOT NULL DEFAULT true,
  min_tier_rank integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 100,
  is_default boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_groups_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_groups_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_groups_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_groups_desc_pl_len CHECK (char_length(description_pl) <= 500),
  CONSTRAINT event_groups_desc_en_len CHECK (char_length(description_en) <= 500),
  CONSTRAINT event_groups_color_hex CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT event_groups_visibility_values
    CHECK (attendee_visibility IN ('none', 'own_group', 'registered', 'everyone')),
  CONSTRAINT event_groups_visibility_consistent
    CHECK (can_see_attendees OR attendee_visibility = 'none'),
  CONSTRAINT event_groups_tier_rank_nonneg CHECK (min_tier_rank >= 0),
  CONSTRAINT event_groups_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_groups_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_groups_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_groups IS
  'Grupy uczestnikow wydarzenia z uprawnieniami. Uprawnienia sa kolumnami logicznymi (nie jsonb), bo kazde jest predykatem czytanym przez SQL.';

COMMENT ON COLUMN public.event_groups.attendee_visibility IS
  'Zasieg widocznosci uczestnikow: none | own_group | registered | everyone. Wlacznikiem jest can_see_attendees, ta kolumna jest zasiegiem.';

COMMENT ON COLUMN public.event_groups.is_default IS
  'Grupa przypisywana zapisowi bez biletu. Dokladnie jedna na wydarzenie (indeks event_groups_default_uniq).';

COMMENT ON COLUMN public.event_groups.is_system IS
  'Grupa zaseedowana przez modul (uczestnicy, prelegenci, organizatorzy). Nie da sie jej usunac - zabralaby etykiete z archiwum zapisow.';

CREATE UNIQUE INDEX IF NOT EXISTS event_groups_default_uniq
  ON public.event_groups (tenant_id, event_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS event_groups_event_order_idx
  ON public.event_groups (tenant_id, event_id, sort_order, key);

GRANT SELECT ON public.event_groups TO authenticated;

GRANT ALL ON public.event_groups TO service_role;

ALTER TABLE public.event_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_groups_staff_read" ON public.event_groups;

CREATE POLICY "event_groups_staff_read"
  ON public.event_groups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_groups_touch_updated_at ON public.event_groups;

CREATE TRIGGER event_groups_touch_updated_at
  BEFORE UPDATE ON public.event_groups
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  quota integer,
  sold_count integer NOT NULL DEFAULT 0,
  sales_from timestamptz,
  sales_to timestamptz,
  min_tier_rank integer NOT NULL DEFAULT 0,
  requires_approval boolean NOT NULL DEFAULT false,
  group_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_ticket_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_ticket_types_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_ticket_types_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_ticket_types_desc_pl_len CHECK (char_length(description_pl) <= 1000),
  CONSTRAINT event_ticket_types_desc_en_len CHECK (char_length(description_en) <= 1000),
  CONSTRAINT event_ticket_types_price_nonneg CHECK (price_cents >= 0),
  CONSTRAINT event_ticket_types_currency_values CHECK (currency IN ('PLN', 'EUR')),
  CONSTRAINT event_ticket_types_quota_positive CHECK (quota IS NULL OR quota > 0),
  CONSTRAINT event_ticket_types_sold_nonneg CHECK (sold_count >= 0),
  CONSTRAINT event_ticket_types_sold_within_quota
    CHECK (quota IS NULL OR sold_count <= quota),
  CONSTRAINT event_ticket_types_sales_window
    CHECK (sales_from IS NULL OR sales_to IS NULL OR sales_to > sales_from),
  CONSTRAINT event_ticket_types_tier_rank_nonneg CHECK (min_tier_rank >= 0),
  CONSTRAINT event_ticket_types_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_ticket_types_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_ticket_types_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_ticket_types_group_fkey
    FOREIGN KEY (tenant_id, event_id, group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_ticket_types IS
  'Bilety wydarzenia. Ustawiane per wydarzenie - nie ma globalnego cennika. Bilet NADAJE GRUPE (group_id). Status sprzedazy nie jest kolumna: wynika z okna, puli i is_active.';

COMMENT ON COLUMN public.event_ticket_types.price_cents IS
  'Cena w najmniejszej jednostce waluty. 0 = wejsciowka bezplatna z pula i oknem sprzedazy (inny stan niz brak biletu).';

COMMENT ON COLUMN public.event_ticket_types.quota IS
  'Pula miejsc. NULL = bez limitu. Serializacja przez FOR UPDATE na tym wierszu w kazdym RPC zajmujacym miejsce.';

COMMENT ON COLUMN public.event_ticket_types.sold_count IS
  'Liczba zajetych miejsc (zapisy w statusie approved / attended / no_show). Utrzymywana triggerem przeliczajacym, nie inkrementacja.';

COMMENT ON COLUMN public.event_ticket_types.group_id IS
  'Grupa nadawana zapisowi z tym biletem. Klucz obcy po (tenant_id, event_id, group_id) - grupa musi byc z TEGO wydarzenia.';

COMMENT ON COLUMN public.event_ticket_types.requires_approval IS
  'Bilet wymaga akceptacji organizatora nawet gdy wydarzenie ma tryb natychmiastowy (np. wejsciowka prasowa).';

CREATE INDEX IF NOT EXISTS event_ticket_types_event_order_idx
  ON public.event_ticket_types (tenant_id, event_id, sort_order, key);

CREATE INDEX IF NOT EXISTS event_ticket_types_event_active_idx
  ON public.event_ticket_types (tenant_id, event_id) WHERE is_active;

GRANT SELECT ON public.event_ticket_types TO authenticated;

GRANT ALL ON public.event_ticket_types TO service_role;

ALTER TABLE public.event_ticket_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_ticket_types_staff_read" ON public.event_ticket_types;

CREATE POLICY "event_ticket_types_staff_read"
  ON public.event_ticket_types FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_ticket_types_touch_updated_at ON public.event_ticket_types;

CREATE TRIGGER event_ticket_types_touch_updated_at
  BEFORE UPDATE ON public.event_ticket_types
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_registration_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  label_pl text NOT NULL,
  label_en text NOT NULL,
  help_pl text NOT NULL DEFAULT '',
  help_en text NOT NULL DEFAULT '',
  is_required boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 100,
  is_qualifying boolean NOT NULL DEFAULT false,
  qualify_operator text NOT NULL DEFAULT 'none',
  qualify_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  qualify_outcome text NOT NULL DEFAULT 'approval',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_registration_fields_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_registration_fields_label_pl_len
    CHECK (char_length(btrim(label_pl)) BETWEEN 1 AND 200),
  CONSTRAINT event_registration_fields_label_en_len
    CHECK (char_length(btrim(label_en)) BETWEEN 1 AND 200),
  CONSTRAINT event_registration_fields_help_pl_len CHECK (char_length(help_pl) <= 500),
  CONSTRAINT event_registration_fields_help_en_len CHECK (char_length(help_en) <= 500),
  CONSTRAINT event_registration_fields_type_values CHECK (field_type IN (
    'text', 'textarea', 'select', 'multiselect', 'checkbox', 'switch',
    'number', 'date', 'file', 'consent'
  )),
  CONSTRAINT event_registration_fields_options_array
    CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT event_registration_fields_options_required CHECK (
    field_type NOT IN ('select', 'multiselect')
    OR jsonb_array_length(options) > 0
  ),
  CONSTRAINT event_registration_fields_operator_values CHECK (qualify_operator IN (
    'none', 'equals', 'not_equals', 'in', 'not_in',
    'gte', 'lte', 'is_true', 'is_false', 'not_empty'
  )),
  CONSTRAINT event_registration_fields_outcome_values
    CHECK (qualify_outcome IN ('auto_approve', 'approval', 'reject')),
  CONSTRAINT event_registration_fields_qualify_complete
    CHECK (NOT is_qualifying OR qualify_operator <> 'none'),
  CONSTRAINT event_registration_fields_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_registration_fields_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_registration_fields IS
  'Definicja pol formularza zapisu per wydarzenie, wraz z regula kwalifikujaca. Typ `consent` idzie do event_term_acceptances (wersja, dowod), nie do answers.';

COMMENT ON COLUMN public.event_registration_fields.qualify_outcome IS
  'Co sie stanie, GDY predykat trafi: auto_approve | approval | reject. Pierwszenstwo: reject > approval > auto_approve.';

COMMENT ON COLUMN public.event_registration_fields.qualify_value IS
  'Wartosc oczekiwana predykatu. Skalar dla equals/gte/lte, tablica dla in/not_in, nieuzywana dla is_true/is_false/not_empty.';

COMMENT ON COLUMN public.event_registration_fields.options IS
  'Opcje listy: tablica obiektow { value, label_pl, label_en }. Tablica, bo kolejnosc opcji jest trescia redakcyjna.';

CREATE INDEX IF NOT EXISTS event_registration_fields_event_order_idx
  ON public.event_registration_fields (tenant_id, event_id, sort_order, key);

CREATE INDEX IF NOT EXISTS event_registration_fields_qualifying_idx
  ON public.event_registration_fields (tenant_id, event_id)
  WHERE is_active AND is_qualifying;

GRANT SELECT ON public.event_registration_fields TO authenticated;

GRANT ALL ON public.event_registration_fields TO service_role;

ALTER TABLE public.event_registration_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_registration_fields_staff_read" ON public.event_registration_fields;

CREATE POLICY "event_registration_fields_staff_read"
  ON public.event_registration_fields FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_registration_fields_touch_updated_at ON public.event_registration_fields;

CREATE TRIGGER event_registration_fields_touch_updated_at
  BEFORE UPDATE ON public.event_registration_fields
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  person_id uuid NOT NULL,
  ticket_type_id uuid,
  group_id uuid,
  status text NOT NULL DEFAULT 'pending',
  registration_mode text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'self_registration',
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_source text,
  decision_note text,
  qr_token_hash text,
  qr_issued_at timestamptz,
  manage_token_hash text,
  waitlist_position integer,
  waitlist_notified_at timestamptz,
  promoted_at timestamptz,
  cancelled_at timestamptz,
  attended_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_registrations_status_values CHECK (status IN (
    'draft', 'pending', 'approved', 'rejected', 'waitlist',
    'cancelled', 'attended', 'no_show'
  )),
  CONSTRAINT event_registrations_mode_values CHECK (registration_mode IN ('rsvp', 'form')),
  CONSTRAINT event_registrations_answers_object CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT event_registrations_source_values CHECK (source IN (
    'self_registration', 'invitation', 'organizer', 'import', 'crm', 'partner', 'scan'
  )),
  CONSTRAINT event_registrations_decision_source_values CHECK (
    decision_source IS NULL
    OR decision_source IN ('organizer', 'automatic_rule', 'capacity', 'system')
  ),
  CONSTRAINT event_registrations_decision_dated
    CHECK (decided_by IS NULL OR decided_at IS NOT NULL),
  CONSTRAINT event_registrations_decision_sourced
    CHECK (decided_at IS NULL OR decision_source IS NOT NULL),
  CONSTRAINT event_registrations_rejection_has_reason CHECK (
    status <> 'rejected'
    OR decision_source IS DISTINCT FROM 'organizer'
    OR char_length(btrim(COALESCE(decision_note, ''))) >= 3
  ),
  CONSTRAINT event_registrations_note_len
    CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  CONSTRAINT event_registrations_waitlist_position_positive
    CHECK (waitlist_position IS NULL OR waitlist_position > 0),
  CONSTRAINT event_registrations_waitlist_position_scoped
    CHECK (waitlist_position IS NULL OR status = 'waitlist'),
  CONSTRAINT event_registrations_qr_shape CHECK (
    qr_token_hash IS NULL OR qr_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT event_registrations_qr_dated
    CHECK (qr_token_hash IS NULL OR qr_issued_at IS NOT NULL),
  CONSTRAINT event_registrations_manage_shape CHECK (
    manage_token_hash IS NULL OR manage_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT event_registrations_cancelled_dated
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT event_registrations_attended_dated
    CHECK (status <> 'attended' OR attended_at IS NOT NULL),
  CONSTRAINT event_registrations_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_registrations_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_registrations_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_registrations_person_fkey
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_registrations_ticket_fkey
    FOREIGN KEY (tenant_id, event_id, ticket_type_id)
    REFERENCES public.event_ticket_types (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_registrations_group_fkey
    FOREIGN KEY (tenant_id, event_id, group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_registrations IS
  'Zapis osoby na wydarzenie: osiem stanow cyklu zycia, tryb zapisu, bilet, grupa, odpowiedzi formularza, slad decyzji i HASZ tokenu QR. Jeden aktywny zapis na osobe i wydarzenie.';

COMMENT ON COLUMN public.event_registrations.registration_mode IS
  'Tryb zapisu utrwalony w chwili zapisu (rsvp | form). Wydarzenie moze zmienic tryb pozniej - zgloszenie pamieta swoj.';

COMMENT ON COLUMN public.event_registrations.decision_source IS
  'Na jakiej podstawie zapadla decyzja: organizer | automatic_rule | capacity | system. Bez tego nie da sie odroznic odrzucenia przez czlowieka od odrzucenia przez regule.';

COMMENT ON COLUMN public.event_registrations.qr_token_hash IS
  'SHA-256 tokenu wejsciowego. Wartosc jawna wraca w odpowiedzi RPC dokladnie raz, w chwili zatwierdzenia - zrzut tabeli nie daje wstepu.';

COMMENT ON COLUMN public.event_registrations.manage_token_hash IS
  'SHA-256 uchwytu samoobslugowego. Pozwala osobie BEZ konta podejrzec i anulowac wlasne zgloszenie od pierwszej sekundy - takze zgloszenie oczekujace, ktore tokenu wejsciowego nie ma.';

COMMENT ON COLUMN public.event_registrations.waitlist_position IS
  'Pozycja w kolejce rezerwowej. Unikalna wsrod wierszy waitlist danego wydarzenia; czyszczona przy zmianie statusu (CHECK waitlist_position_scoped).';

COMMENT ON COLUMN public.event_registrations.waitlist_notified_at IS
  'Stempel powiadomienia o awansie z rezerwy. Ustawiany, gdy powiadomienie w aplikacji naprawde powstalo; dla osoby bez konta stempluje go admin_event_registration_mark_notified() po wyslaniu wiadomosci.';

COMMENT ON COLUMN public.event_registrations.answers IS
  'Odpowiedzi na pola formularza, po kluczu pola. Zgody NIE trafiaja tutaj - ida do event_term_acceptances z wersja.';

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_active_uniq
  ON public.event_registrations (tenant_id, event_id, person_id)
  WHERE status NOT IN ('cancelled', 'rejected');

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_waitlist_order_uniq
  ON public.event_registrations (tenant_id, event_id, waitlist_position)
  WHERE status = 'waitlist';

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_qr_uniq
  ON public.event_registrations (tenant_id, qr_token_hash)
  WHERE qr_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_manage_uniq
  ON public.event_registrations (tenant_id, manage_token_hash)
  WHERE manage_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_registrations_event_status_idx
  ON public.event_registrations (tenant_id, event_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS event_registrations_event_ticket_idx
  ON public.event_registrations (tenant_id, event_id, ticket_type_id)
  WHERE ticket_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_registrations_person_idx
  ON public.event_registrations (tenant_id, person_id, created_at DESC);

GRANT SELECT ON public.event_registrations TO authenticated;

GRANT ALL ON public.event_registrations TO service_role;

ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_registrations_staff_read" ON public.event_registrations;

CREATE POLICY "event_registrations_staff_read"
  ON public.event_registrations FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_registrations_self_read" ON public.event_registrations;

CREATE POLICY "event_registrations_self_read"
  ON public.event_registrations FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.event_people p
      WHERE p.id = event_registrations.person_id
        AND p.tenant_id = event_registrations.tenant_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DROP TRIGGER IF EXISTS event_registrations_touch_updated_at ON public.event_registrations;

CREATE TRIGGER event_registrations_touch_updated_at
  BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  group_id uuid NOT NULL,
  person_id uuid NOT NULL,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_group_members_unique UNIQUE (tenant_id, group_id, person_id),
  CONSTRAINT event_group_members_group_fkey
    FOREIGN KEY (tenant_id, event_id, group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_group_members_person_fkey
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE
);