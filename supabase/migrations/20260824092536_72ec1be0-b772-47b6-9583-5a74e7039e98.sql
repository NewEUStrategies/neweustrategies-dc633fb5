ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_tenant_id_key UNIQUE (tenant_id, id);

CREATE TABLE IF NOT EXISTS public.event_sponsor_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  rank integer NOT NULL DEFAULT 0,
  accent_color text,
  logo_size text NOT NULL DEFAULT 'md',
  max_companies integer,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_tiers_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_sponsor_tiers_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_sponsor_tiers_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_sponsor_tiers_desc_pl_len CHECK (char_length(description_pl) <= 1000),
  CONSTRAINT event_sponsor_tiers_desc_en_len CHECK (char_length(description_en) <= 1000),
  CONSTRAINT event_sponsor_tiers_rank_range CHECK (rank BETWEEN 0 AND 1000),
  CONSTRAINT event_sponsor_tiers_accent_hex
    CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT event_sponsor_tiers_logo_size_values CHECK (logo_size IN ('sm', 'md', 'lg')),
  CONSTRAINT event_sponsor_tiers_max_companies_positive
    CHECK (max_companies IS NULL OR max_companies > 0),
  CONSTRAINT event_sponsor_tiers_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsor_tiers_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_sponsor_tiers_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_sponsor_tiers_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_tiers IS
  'Poziomy sponsorskie jednego wydarzenia. Zapis wylacznie przez admin_event_sponsor_tier_save; klucz jest niezmienny po zapisie.';
COMMENT ON COLUMN public.event_sponsor_tiers.rank IS
  'Wysokosc w hierarchii handlowej (wyzsza liczba = wyzszy poziom). Steruje kolejnoscia grup na stronie publicznej. Rowna ranga dwoch poziomow jest dozwolona - rozstrzyga wtedy sort_order.';
COMMENT ON COLUMN public.event_sponsor_tiers.max_companies IS
  'Limit sprzedazowy poziomu. Egzekwowany blokada wiersza w admin_event_sponsor_save; liczy WSZYSTKIE przypiecia, takze nieopublikowane - miejsce jest sprzedane w chwili przypiecia.';
COMMENT ON COLUMN public.event_sponsor_tiers.logo_size IS
  'Rozmiar logotypu sprzedany razem z pakietem: sm / md / lg. Te same trzy wartosci co SponsorTierSize w src/lib/events/sponsors.ts.';
COMMENT ON COLUMN public.event_sponsor_tiers.is_active IS
  'Wylaczony poziom znika z selektu w formularzu przypiecia, ale NIE znika ze strony - grupa logotypow juz opublikowana zostaje (wzorzec event_tracks.is_active).';

CREATE INDEX IF NOT EXISTS event_sponsor_tiers_event_rank_idx
  ON public.event_sponsor_tiers (tenant_id, event_id, rank DESC, sort_order, key);

DROP TRIGGER IF EXISTS event_sponsor_tiers_touch_updated_at ON public.event_sponsor_tiers;
CREATE TRIGGER event_sponsor_tiers_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_tiers
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_sponsor_tiers TO anon;
GRANT SELECT ON public.event_sponsor_tiers TO authenticated;
GRANT ALL ON public.event_sponsor_tiers TO service_role;

ALTER TABLE public.event_sponsor_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_sponsor_tiers_public_read" ON public.event_sponsor_tiers;
CREATE POLICY "event_sponsor_tiers_public_read"
  ON public.event_sponsor_tiers FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_sponsor_tiers.event_id
        AND e.tenant_id = event_sponsor_tiers.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sponsor_tiers_staff_read" ON public.event_sponsor_tiers;
CREATE POLICY "event_sponsor_tiers_staff_read"
  ON public.event_sponsor_tiers FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_sponsor_tier_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  tier_id uuid NOT NULL,
  label_pl text NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_tier_benefits_label_pl_len
    CHECK (char_length(btrim(label_pl)) BETWEEN 1 AND 200),
  CONSTRAINT event_sponsor_tier_benefits_label_en_len
    CHECK (char_length(btrim(label_en)) BETWEEN 1 AND 200),
  CONSTRAINT event_sponsor_tier_benefits_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsor_tier_benefits_tier_fk
    FOREIGN KEY (tenant_id, event_id, tier_id)
    REFERENCES public.event_sponsor_tiers (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_tier_benefits_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_tier_benefits IS
  'Swiadczenia jednego poziomu sponsorskiego, pozycja po pozycji, w obu jezykach. Zapis wsadowo przez admin_event_sponsor_tier_save (cala lista poziomu naraz).';

CREATE INDEX IF NOT EXISTS event_sponsor_tier_benefits_tier_idx
  ON public.event_sponsor_tier_benefits (tenant_id, tier_id, sort_order);
CREATE INDEX IF NOT EXISTS event_sponsor_tier_benefits_event_idx
  ON public.event_sponsor_tier_benefits (tenant_id, event_id);

DROP TRIGGER IF EXISTS event_sponsor_tier_benefits_touch_updated_at
  ON public.event_sponsor_tier_benefits;
CREATE TRIGGER event_sponsor_tier_benefits_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_tier_benefits
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_sponsor_tier_benefits TO anon;
GRANT SELECT ON public.event_sponsor_tier_benefits TO authenticated;
GRANT ALL ON public.event_sponsor_tier_benefits TO service_role;

ALTER TABLE public.event_sponsor_tier_benefits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_sponsor_tier_benefits_public_read"
  ON public.event_sponsor_tier_benefits;
CREATE POLICY "event_sponsor_tier_benefits_public_read"
  ON public.event_sponsor_tier_benefits FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_sponsor_tiers t
      JOIN public.events e
        ON e.id = t.event_id AND e.tenant_id = t.tenant_id
      WHERE t.id = event_sponsor_tier_benefits.tier_id
        AND t.tenant_id = event_sponsor_tier_benefits.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sponsor_tier_benefits_staff_read"
  ON public.event_sponsor_tier_benefits;
CREATE POLICY "event_sponsor_tier_benefits_staff_read"
  ON public.event_sponsor_tier_benefits FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  company_id uuid NOT NULL,
  tier_id uuid,
  role text NOT NULL DEFAULT 'sponsor',
  booth_label text,
  sort_order integer NOT NULL DEFAULT 100,
  is_published boolean NOT NULL DEFAULT false,
  snapshot_name text NOT NULL,
  snapshot_logo_url text,
  snapshot_description_pl text NOT NULL DEFAULT '',
  snapshot_description_en text NOT NULL DEFAULT '',
  snapshot_website text,
  snapshot_country text,
  snapshot_source text NOT NULL DEFAULT 'crm',
  snapshot_taken_at timestamptz NOT NULL DEFAULT now(),
  internal_note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsors_role_values
    CHECK (role IN ('sponsor', 'partner', 'media_partner', 'exhibitor')),
  CONSTRAINT event_sponsors_snapshot_source_values
    CHECK (snapshot_source IN ('crm', 'manual')),
  CONSTRAINT event_sponsors_snapshot_name_len
    CHECK (char_length(btrim(snapshot_name)) BETWEEN 1 AND 200),
  CONSTRAINT event_sponsors_snapshot_country_len
    CHECK (snapshot_country IS NULL OR char_length(btrim(snapshot_country)) BETWEEN 2 AND 120),
  CONSTRAINT event_sponsors_snapshot_desc_pl_len
    CHECK (char_length(snapshot_description_pl) <= 2000),
  CONSTRAINT event_sponsors_snapshot_desc_en_len
    CHECK (char_length(snapshot_description_en) <= 2000),
  CONSTRAINT event_sponsors_snapshot_logo_shape
    CHECK (snapshot_logo_url IS NULL OR snapshot_logo_url ~ '^(https?://|/)'),
  CONSTRAINT event_sponsors_snapshot_website_shape
    CHECK (
      snapshot_website IS NULL
      OR (snapshot_website ~ '^https?://' AND char_length(snapshot_website) <= 500)
    ),
  CONSTRAINT event_sponsors_booth_label_len
    CHECK (booth_label IS NULL OR char_length(btrim(booth_label)) BETWEEN 1 AND 40),
  CONSTRAINT event_sponsors_internal_note_len
    CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000),
  CONSTRAINT event_sponsors_published_sponsor_needs_tier
    CHECK (is_published = false OR role <> 'sponsor' OR tier_id IS NOT NULL),
  CONSTRAINT event_sponsors_event_company_unique UNIQUE (tenant_id, event_id, company_id),
  CONSTRAINT event_sponsors_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsors_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_sponsors_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsors_company_fk FOREIGN KEY (tenant_id, company_id)
    REFERENCES public.crm_companies (tenant_id, id),
  CONSTRAINT event_sponsors_tier_fk FOREIGN KEY (tenant_id, event_id, tier_id)
    REFERENCES public.event_sponsor_tiers (tenant_id, event_id, id)
);

COMMENT ON TABLE public.event_sponsors IS
  'Przypiecie firmy z kartoteki (crm_companies) do wydarzenia razem z MIGAWKA prezentacji. Zapis wylacznie przez admin_event_sponsor_save; migawka odswiezana jawnie przez admin_event_sponsor_snapshot_refresh.';
COMMENT ON COLUMN public.event_sponsors.company_id IS
  'Firma w kartotece. Jedno zrodlo prawdy o firmie - modul NIE tworzy drugiego rejestru. Usuniecie firmy uzytej tutaj jest odrzucane (NO ACTION), bo przypiecie jest dokumentem sponsoringu.';
COMMENT ON COLUMN public.event_sponsors.snapshot_name IS
  'Nazwa POKAZANA na stronie wydarzenia. Kolumna wlasna, nie odczyt z kartoteki: strona archiwalna ma pokazywac stan z dnia wydarzenia, a nie biezaca nazwe po przebrandowaniu.';
COMMENT ON COLUMN public.event_sponsors.snapshot_description_pl IS
  'Opis REDAKCYJNY sponsora. Kartoteka nie ma zrodla opisu, wiec odswiezenie migawki tego pola NIGDY nie nadpisuje.';
COMMENT ON COLUMN public.event_sponsors.snapshot_description_en IS
  'Opis redakcyjny w wersji angielskiej. Jak snapshot_description_pl: powstaje w panelu wydarzenia, odswiezenie migawki go nie rusza.';
COMMENT ON COLUMN public.event_sponsors.snapshot_source IS
  'Skad wzieta jest migawka: crm (kopia kartoteki - roznica znaczy rozjazd) albo manual (swiadome nadpisanie - roznica jest zamierzona).';
COMMENT ON COLUMN public.event_sponsors.snapshot_taken_at IS
  'Kiedy migawka byla ostatnio zapisana. Odpowiada na pytanie "z ktorego dnia jest ten logotyp", ktorego rozjazd sam nie tlumaczy.';
COMMENT ON COLUMN public.event_sponsors.booth_label IS
  'Numer albo nazwa stanowiska wystawienniczego. Wolny tekst, bo numeracja hali nalezy do obiektu, nie do naszego schematu.';
COMMENT ON COLUMN public.event_sponsors.internal_note IS
  'Notatka wewnetrzna organizatora. NIE wychodzi zadnym publicznym RPC ani zadna polityka publiczna.';

CREATE INDEX IF NOT EXISTS event_sponsors_event_order_idx
  ON public.event_sponsors (tenant_id, event_id, sort_order, id);
CREATE INDEX IF NOT EXISTS event_sponsors_tier_idx
  ON public.event_sponsors (tenant_id, tier_id, sort_order)
  WHERE tier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_sponsors_published_idx
  ON public.event_sponsors (tenant_id, event_id, sort_order)
  WHERE is_published;
CREATE INDEX IF NOT EXISTS event_sponsors_company_idx
  ON public.event_sponsors (tenant_id, company_id);

DROP TRIGGER IF EXISTS event_sponsors_touch_updated_at ON public.event_sponsors;
CREATE TRIGGER event_sponsors_touch_updated_at
  BEFORE UPDATE ON public.event_sponsors
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT ALL ON public.event_sponsors TO service_role;

ALTER TABLE public.event_sponsors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_sponsors_public_read" ON public.event_sponsors;
CREATE POLICY "event_sponsors_public_read"
  ON public.event_sponsors FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND is_published
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_sponsors.event_id
        AND e.tenant_id = event_sponsors.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sponsors_staff_read" ON public.event_sponsors;
CREATE POLICY "event_sponsors_staff_read"
  ON public.event_sponsors FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

REVOKE SELECT ON public.event_sponsors FROM anon;
REVOKE SELECT ON public.event_sponsors FROM authenticated;
GRANT SELECT (
  id, tenant_id, event_id, company_id, tier_id, role, booth_label, sort_order,
  is_published, snapshot_name, snapshot_logo_url, snapshot_description_pl,
  snapshot_description_en, snapshot_website, snapshot_country, snapshot_source,
  snapshot_taken_at, created_at, updated_at
) ON public.event_sponsors TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.event_sponsor_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'primary',
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_contacts_role_values
    CHECK (role IN ('primary', 'marketing', 'billing', 'onsite')),
  CONSTRAINT event_sponsor_contacts_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsor_contacts_unique UNIQUE (tenant_id, sponsor_id, lead_id),
  CONSTRAINT event_sponsor_contacts_sponsor_fk
    FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_contacts_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_contacts_lead_fk FOREIGN KEY (tenant_id, lead_id)
    REFERENCES public.crm_leads (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_contacts IS
  'Osoby z kartoteki (crm_leads) obslugujace przypiecie sponsora na tym wydarzeniu. Dane osoby czytane NA ZYWO z kartoteki - migawki tu nie ma swiadomie. Zapis wsadowo przez admin_event_sponsor_contacts_set.';
COMMENT ON COLUMN public.event_sponsor_contacts.role IS
  'Rola przy TYM przypieciu: primary (osoba decyzyjna) / marketing / billing (rozliczenia) / onsite (obsluga na miejscu).';

CREATE INDEX IF NOT EXISTS event_sponsor_contacts_sponsor_idx
  ON public.event_sponsor_contacts (tenant_id, sponsor_id, sort_order);
CREATE INDEX IF NOT EXISTS event_sponsor_contacts_lead_idx
  ON public.event_sponsor_contacts (tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS event_sponsor_contacts_event_idx
  ON public.event_sponsor_contacts (tenant_id, event_id);

DROP TRIGGER IF EXISTS event_sponsor_contacts_touch_updated_at ON public.event_sponsor_contacts;
CREATE TRIGGER event_sponsor_contacts_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_contacts
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_sponsor_contacts TO authenticated;
GRANT ALL ON public.event_sponsor_contacts TO service_role;

ALTER TABLE public.event_sponsor_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_sponsor_contacts_staff_read" ON public.event_sponsor_contacts;
CREATE POLICY "event_sponsor_contacts_staff_read"
  ON public.event_sponsor_contacts FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_sponsor_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  kind text NOT NULL DEFAULT 'document',
  url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_materials_kind_values
    CHECK (kind IN ('document', 'presentation', 'video', 'link', 'logo_pack')),
  CONSTRAINT event_sponsor_materials_title_pl_len
    CHECK (char_length(btrim(title_pl)) BETWEEN 2 AND 160),
  CONSTRAINT event_sponsor_materials_title_en_len
    CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 160),
  CONSTRAINT event_sponsor_materials_url_shape CHECK (url ~ '^(https?://|/)'),
  CONSTRAINT event_sponsor_materials_url_len CHECK (char_length(url) <= 1000),
  CONSTRAINT event_sponsor_materials_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsor_materials_sponsor_fk
    FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_materials_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_materials IS
  'Materialy sponsora pod zakladke "Materialy" na stronie wydarzenia. Publiczne dopiero gdy material I przypiecie sa opublikowane. Zapis przez admin_event_sponsor_material_save.';
COMMENT ON COLUMN public.event_sponsor_materials.kind IS
  'Rodzaj pozycji: document / presentation / video / link / logo_pack. Steruje ikona i zachowaniem odnosnika, dlatego jest ograniczony CHECK-iem, a nie wolnym tekstem.';
COMMENT ON COLUMN public.event_sponsor_materials.is_published IS
  'Publikacja POZYCJI. Material wychodzi na strone tylko razem z opublikowanym przypieciem sponsora - patrz polityka event_sponsor_materials_public_read.';

CREATE INDEX IF NOT EXISTS event_sponsor_materials_sponsor_idx
  ON public.event_sponsor_materials (tenant_id, sponsor_id, sort_order);
CREATE INDEX IF NOT EXISTS event_sponsor_materials_event_published_idx
  ON public.event_sponsor_materials (tenant_id, event_id, sort_order)
  WHERE is_published;

DROP TRIGGER IF EXISTS event_sponsor_materials_touch_updated_at
  ON public.event_sponsor_materials;
CREATE TRIGGER event_sponsor_materials_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_materials
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_sponsor_materials TO anon;
GRANT SELECT ON public.event_sponsor_materials TO authenticated;
GRANT ALL ON public.event_sponsor_materials TO service_role;

ALTER TABLE public.event_sponsor_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_sponsor_materials_public_read"
  ON public.event_sponsor_materials;
CREATE POLICY "event_sponsor_materials_public_read"
  ON public.event_sponsor_materials FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND is_published
    AND EXISTS (
      SELECT 1
      FROM public.event_sponsors s
      JOIN public.events e
        ON e.id = s.event_id AND e.tenant_id = s.tenant_id
      WHERE s.id = event_sponsor_materials.sponsor_id
        AND s.tenant_id = event_sponsor_materials.tenant_id
        AND s.is_published
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sponsor_materials_staff_read"
  ON public.event_sponsor_materials;
CREATE POLICY "event_sponsor_materials_staff_read"
  ON public.event_sponsor_materials FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );