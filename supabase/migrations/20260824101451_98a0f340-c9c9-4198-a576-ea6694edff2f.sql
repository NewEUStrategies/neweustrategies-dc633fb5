CREATE TABLE IF NOT EXISTS public.event_badge_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  name text NOT NULL,
  paper_format text NOT NULL DEFAULT 'a6',
  width_mm numeric(6, 2),
  height_mm numeric(6, 2),
  orientation text NOT NULL DEFAULT 'portrait',
  double_fold boolean NOT NULL DEFAULT false,
  background_color text,
  background_image_url text,
  show_qr boolean NOT NULL DEFAULT true,
  qr_size_mm numeric(5, 2) NOT NULL DEFAULT 25.00,
  elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_badge_templates_name_len
    CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT event_badge_templates_paper_format_values CHECK (paper_format IN (
    'a4', 'a5', 'a6', 'a7', 'badge_90x54', 'badge_100x150', 'custom'
  )),
  CONSTRAINT event_badge_templates_orientation_values
    CHECK (orientation IN ('portrait', 'landscape')),
  CONSTRAINT event_badge_templates_custom_dimensions CHECK (
    (paper_format = 'custom' AND width_mm IS NOT NULL AND height_mm IS NOT NULL)
    OR (paper_format <> 'custom' AND width_mm IS NULL AND height_mm IS NULL)
  ),
  CONSTRAINT event_badge_templates_dimensions_range CHECK (
    (width_mm IS NULL OR width_mm BETWEEN 20 AND 420)
    AND (height_mm IS NULL OR height_mm BETWEEN 20 AND 420)
  ),
  CONSTRAINT event_badge_templates_qr_size_range
    CHECK (qr_size_mm BETWEEN 10 AND 100),
  CONSTRAINT event_badge_templates_background_hex
    CHECK (background_color IS NULL OR background_color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT event_badge_templates_background_url_shape CHECK (
    background_image_url IS NULL OR background_image_url ~ '^(https?://|/)'
  ),
  CONSTRAINT event_badge_templates_elements_array
    CHECK (jsonb_typeof(elements) = 'array' AND jsonb_array_length(elements) <= 40),
  CONSTRAINT event_badge_templates_version_positive CHECK (version >= 1),
  CONSTRAINT event_badge_templates_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_badge_templates_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_badge_templates_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_badge_templates IS
  'Szablon identyfikatora wydarzenia: format fizyczny w milimetrach, uklad blokow jako tablica jsonb, tlo, kod QR i WERSJA. Zapis wylacznie przez admin_event_badge_template_save.';
COMMENT ON COLUMN public.event_badge_templates.name IS
  'Etykieta wewnetrzna dla redakcji, jednojezyczna - uczestnik jej nie widzi (ta sama decyzja co event_rooms.name).';
COMMENT ON COLUMN public.event_badge_templates.paper_format IS
  'a4 | a5 | a6 | a7 | badge_90x54 | badge_100x150 | custom. Format nazwany jest skrotem do pary milimetrow; custom wymaga width_mm i height_mm jawnie (CHECK custom_dimensions).';
COMMENT ON COLUMN public.event_badge_templates.double_fold IS
  'Kartka zlozona na pol na smyczy - druga polowa jest odbiciem lustrzanym, zeby napis byl czytelny z obu stron.';
COMMENT ON COLUMN public.event_badge_templates.elements IS
  'Tablica blokow ukladanych PIONOWO. Rodzaje: text | field | image | qr | sponsors | spacer. Pola: first_name | last_name | full_name | company | job_title | ticket_name | group_name | event_title | event_dates. Walidacja per element w admin_event_badge_template_save - bez swobodnego XY, bo XY gwarantuje, ze dlugie nazwisko kiedys wyjdzie za krawedz.';
COMMENT ON COLUMN public.event_badge_templates.version IS
  'Wersja UKLADU. Rosnie, gdy zmienia sie cokolwiek widoczne na kartce; nie rosnie przy zmianie samej nazwy szablonu. Rejestr wydrukow zapisuje wersje, wiec przedruk da sie odroznic od pierwszego wydania.';

CREATE UNIQUE INDEX IF NOT EXISTS event_badge_templates_default_uniq
  ON public.event_badge_templates (tenant_id, event_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS event_badge_templates_event_name_uniq
  ON public.event_badge_templates (tenant_id, event_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS event_badge_templates_event_idx
  ON public.event_badge_templates (tenant_id, event_id, name);

GRANT SELECT ON public.event_badge_templates TO authenticated;
GRANT ALL ON public.event_badge_templates TO service_role;

ALTER TABLE public.event_badge_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_badge_templates_staff_read" ON public.event_badge_templates;
CREATE POLICY "event_badge_templates_staff_read"
  ON public.event_badge_templates FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_badge_templates_touch_updated_at ON public.event_badge_templates;
CREATE TRIGGER event_badge_templates_touch_updated_at
  BEFORE UPDATE ON public.event_badge_templates
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_badge_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  person_id uuid NOT NULL,
  registration_id uuid,
  template_id uuid,
  template_version integer NOT NULL,
  copies integer NOT NULL DEFAULT 1,
  reason text NOT NULL DEFAULT 'first_issue',
  printed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id uuid,
  printed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT event_badge_prints_reason_values CHECK (reason IN (
    'first_issue', 'reprint_lost', 'reprint_damaged', 'data_correction', 'bulk_preprint'
  )),
  CONSTRAINT event_badge_prints_copies_range CHECK (copies BETWEEN 1 AND 20),
  CONSTRAINT event_badge_prints_version_positive CHECK (template_version >= 1),
  CONSTRAINT event_badge_prints_note_len CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT event_badge_prints_actor_exactly_one
    CHECK (num_nonnulls(printed_by, device_id) = 1),
  CONSTRAINT event_badge_prints_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_badge_prints_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_badge_prints_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_badge_prints_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id),
  CONSTRAINT event_badge_prints_template_fk
    FOREIGN KEY (tenant_id, event_id, template_id)
    REFERENCES public.event_badge_templates (tenant_id, event_id, id),
  CONSTRAINT event_badge_prints_device_fk FOREIGN KEY (tenant_id, device_id)
    REFERENCES public.event_scanner_devices (tenant_id, id)
);

COMMENT ON TABLE public.event_badge_prints IS
  'Rejestr wydrukow identyfikatora: kto, kiedy, ktora osoba, ktora WERSJA szablonu, ile kopii i z jakiego powodu. Bez tej tabeli nie da sie odpowiedziec, czy identyfikator zostal wydany. Dziennik - wiersze dopisywane.';
COMMENT ON COLUMN public.event_badge_prints.template_version IS
  'Wersja szablonu w chwili wydruku. Kopia, nie wskazanie: szablon bedzie edytowany, a kartka juz wyszla z drukarki.';
COMMENT ON COLUMN public.event_badge_prints.reason IS
  'first_issue | reprint_lost | reprint_damaged | data_correction | bulk_preprint. Powod decyduje o rozliczeniu - pierwsze wydanie jest w cenie, przedruk bywa platny, poprawka danych jest bledem organizatora.';

CREATE INDEX IF NOT EXISTS event_badge_prints_person_idx
  ON public.event_badge_prints (tenant_id, event_id, person_id, printed_at DESC);
CREATE INDEX IF NOT EXISTS event_badge_prints_event_time_idx
  ON public.event_badge_prints (tenant_id, event_id, printed_at DESC);
CREATE INDEX IF NOT EXISTS event_badge_prints_template_idx
  ON public.event_badge_prints (tenant_id, template_id) WHERE template_id IS NOT NULL;

GRANT SELECT ON public.event_badge_prints TO authenticated;
GRANT ALL ON public.event_badge_prints TO service_role;

ALTER TABLE public.event_badge_prints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_badge_prints_staff_read" ON public.event_badge_prints;
CREATE POLICY "event_badge_prints_staff_read"
  ON public.event_badge_prints FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_lead_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid NOT NULL,
  person_id uuid NOT NULL,
  registration_id uuid,
  checkpoint_id uuid,
  device_id uuid,
  scanned_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  first_scanned_at timestamptz NOT NULL DEFAULT now(),
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  scan_count integer NOT NULL DEFAULT 1,
  note text,
  interest_rating smallint,
  consent_snapshot_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_lead_scans_note_len CHECK (note IS NULL OR char_length(note) <= 2000),
  CONSTRAINT event_lead_scans_rating_range
    CHECK (interest_rating IS NULL OR interest_rating BETWEEN 1 AND 5),
  CONSTRAINT event_lead_scans_count_positive CHECK (scan_count >= 1),
  CONSTRAINT event_lead_scans_time_order CHECK (last_scanned_at >= first_scanned_at),
  CONSTRAINT event_lead_scans_actor_exactly_one
    CHECK (num_nonnulls(scanned_by_user_id, device_id) = 1),
  CONSTRAINT event_lead_scans_sponsor_person_unique
    UNIQUE (tenant_id, sponsor_id, person_id),
  CONSTRAINT event_lead_scans_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_lead_scans_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_lead_scans_sponsor_fk FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_lead_scans_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_lead_scans_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id),
  CONSTRAINT event_lead_scans_checkpoint_fk
    FOREIGN KEY (tenant_id, event_id, checkpoint_id)
    REFERENCES public.event_checkpoints (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_lead_scans_device_fk FOREIGN KEY (tenant_id, device_id)
    REFERENCES public.event_scanner_devices (tenant_id, id)
);

COMMENT ON TABLE public.event_lead_scans IS
  'Lead zebrany przez sponsora na stoisku. Tabela NIE ZAWIERA danych kontaktowych - trzyma wskazanie osoby i wlasne dane sponsora. Jedyna droga do kontaktu prowadzi przez event_lead_scans_list z warunkiem ZYWEJ zgody w klauzuli WHERE.';
COMMENT ON COLUMN public.event_lead_scans.sponsor_id IS
  'Przypiecie sponsora do TEGO wydarzenia, nie firma z kartoteki. Ta sama firma sponsoruje wiele wydarzen, a leady jednego nie moga wyciec do obslugi stoiska na drugim.';
COMMENT ON COLUMN public.event_lead_scans.consent_snapshot_at IS
  'DOWOD zgody z chwili skanu. Nie jest warunkiem dostepu - warunkiem jest stan ZYWY w event_people (nadanie bez wycofania), czytany w klauzuli WHERE funkcji odczytu.';
COMMENT ON COLUMN public.event_lead_scans.interest_rating IS
  'Ocena zainteresowania 1-5. Skala liczbowa, bo jej jedynym zastosowaniem jest kolejnosc telefonow po wydarzeniu.';
COMMENT ON COLUMN public.event_lead_scans.scan_count IS
  'Ile razy sponsor zeskanowal te osobe. Powtorny skan nie tworzy drugiego leada - dwa wiersze znaczylyby dwie osoby w eksporcie do CRM.';

CREATE INDEX IF NOT EXISTS event_lead_scans_sponsor_idx
  ON public.event_lead_scans (tenant_id, sponsor_id, last_scanned_at DESC);
CREATE INDEX IF NOT EXISTS event_lead_scans_event_idx
  ON public.event_lead_scans (tenant_id, event_id, last_scanned_at DESC);
CREATE INDEX IF NOT EXISTS event_lead_scans_person_idx
  ON public.event_lead_scans (tenant_id, person_id);

GRANT SELECT ON public.event_lead_scans TO authenticated;
GRANT ALL ON public.event_lead_scans TO service_role;

ALTER TABLE public.event_lead_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_lead_scans_staff_read" ON public.event_lead_scans;
CREATE POLICY "event_lead_scans_staff_read"
  ON public.event_lead_scans FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_lead_scans_touch_updated_at ON public.event_lead_scans;
CREATE TRIGGER event_lead_scans_touch_updated_at
  BEFORE UPDATE ON public.event_lead_scans
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();