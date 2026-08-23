-- ============================================================================
-- Event Builder, etap 1: FUNDAMENT MODELU WYDARZENIA
--
-- CO TU WCHODZI I DLACZEGO W TEJ KOLEJNOSCI
--
-- 1) KATALOG RODZAJOW WYDARZEN (`event_types`) - per organizacja, nie globalny.
--    Dzisiaj rodzaj wydarzenia to kolumna `events.kind` z CHECK-iem na szesc
--    wartosci zakutych w migracji `20260713093000_events_module.sql`. To znaczy,
--    ze dodanie siodmego rodzaju ("Śniadanie prasowe", "Wizyta studyjna") wymaga
--    MIGRACJI, a nie decyzji redaktora - i ze kazda organizacja na platformie
--    musi miec dokladnie te same szesc. Katalog przenosi te decyzje do panelu,
--    zachowujac `kind` jako kolumne zgodnosci (widgety `event-list`,
--    `event-countdown` i `eventKindLabel()` czytaja ja dalej bez zmian).
--
-- 2) DOMYSLNE USTAWIENIA W KATALOGU, a nie w kodzie formularza. Rodzaj niesie
--    wartosci startowe nowego wydarzenia (format, tryb rejestracji, pojemnosc,
--    czas trwania, prog warstwy, zasada Chatham House). Bez tego kazde nowe
--    wydarzenie zaczyna od zera i redaktor powtarza te same siedem decyzji.
--
-- 3) KOLUMNY CYKLU ZYCIA (`published_at`, `cancelled_at`). Do dzis daty
--    publikacji NIE BYLO NIGDZIE poza szyna `domain_events` - a `prune_domain_events()`
--    ja kasuje po ~90 dniach. Pulpit wydarzenia nie mial wiec skad wziac zdania
--    "opublikowano 3 tygodnie temu", a raport roczny gubil wydarzenia sprzed
--    kwartalu. Stempel na wierszu jest odporny na retencje szyny.
--
-- 4) KOLUMNY PRZEPLYWU (`format`, `registration_mode`, `registration_flow`,
--    `guest_mode`, `external_registration_url`). Rozdzielaja trzy rzeczy, ktore
--    dzis siedza w jednym `kind`: GDZIE sie dzieje (format), JAK sie zapisac
--    (tryb) i CZY zapis wymaga akceptacji (przeplyw). `guest_mode` odpowiada na
--    pytanie, ktore w module wydarzen nie mialo dotad zadnej reprezentacji: co
--    widzi osoba NIEZAREJESTROWANA na wydarzenie (nie: niezalogowana).
--
-- 5) `root_page_id` + `branding` - zaczep frontu wydarzenia. Front jest
--    poddrzewem `pages` (patrz docs/PROJEKT_FRONT_WYDARZENIA_2026-08-23.md §2),
--    wiec wydarzenie musi umiec wskazac swoja strone glowna, a marka wydarzenia
--    (kolory, logo) musi miec nosnik niezalezny od motywu serwisu.
--
-- IZOLACJA NAJEMCOW. Katalog jest scisle per `tenant_id`:
--   * odczyt publiczny wiaze wiersz z `COALESCE(_caller_tenant(), public_tenant_id())`
--     - dokladnie wzorzec `club_topics` po korekcie z 20260816090000, gdzie
--       `USING (true)` odslanialo katalogi wszystkich organizacji;
--   * zapis wylacznie przez RPC z bramka `assert_admin_tenant()` (rola admin
--     W TENANCIE DOMOWYM), nigdy po naglowku hosta;
--   * kazda funkcja SECURITY DEFINER skaluje dane po tenancie wolajacego, wiec
--     bramka `check:sql-tenant-scope` nie ma czego zapalic.
--
-- FORWARD-ONLY I IDEMPOTENTNOSC. Wszystkie ALTER-y sa `IF NOT EXISTS`, seed ma
-- `ON CONFLICT DO NOTHING`, a backfille sa warunkowe (`WHERE ... IS NULL`), zeby
-- powtorny przebieg na bazie czesciowo zmigrowanej nie nadpisal decyzji redakcji.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Katalog rodzajow wydarzen
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'CalendarDays',
  accent_color text,
  default_format text NOT NULL DEFAULT 'onsite',
  default_registration_mode text NOT NULL DEFAULT 'rsvp',
  default_registration_flow text NOT NULL DEFAULT 'instant',
  default_guest_mode text NOT NULL DEFAULT 'teaser',
  default_capacity integer,
  default_duration_minutes integer,
  default_min_tier_rank integer NOT NULL DEFAULT 0,
  default_chatham_house boolean NOT NULL DEFAULT false,
  requires_ticket boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_types_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_types_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_types_desc_pl_len CHECK (char_length(description_pl) <= 500),
  CONSTRAINT event_types_desc_en_len CHECK (char_length(description_en) <= 500),
  CONSTRAINT event_types_icon_len CHECK (char_length(btrim(icon)) BETWEEN 1 AND 64),
  -- Kolor akcentu jest wstrzykiwany do CSS jako zmienna, wiec musi byc
  -- literalem heksadecymalnym - nie `red`, nie `var(--x)`, nie `url(...)`.
  CONSTRAINT event_types_accent_hex CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT event_types_format_values CHECK (default_format IN ('onsite', 'online', 'hybrid')),
  CONSTRAINT event_types_reg_mode_values CHECK (default_registration_mode IN ('rsvp', 'form', 'external', 'none')),
  CONSTRAINT event_types_reg_flow_values CHECK (default_registration_flow IN ('instant', 'approval')),
  CONSTRAINT event_types_guest_mode_values CHECK (default_guest_mode IN ('hidden', 'teaser', 'full')),
  CONSTRAINT event_types_capacity_positive CHECK (default_capacity IS NULL OR default_capacity > 0),
  -- Gorna granica to tydzien: wartosc wyzsza znaczy pomylke jednostki
  -- (minuty kontra godziny), a nie realny czas trwania sesji.
  CONSTRAINT event_types_duration_range CHECK (default_duration_minutes IS NULL OR default_duration_minutes BETWEEN 5 AND 10080),
  CONSTRAINT event_types_tier_rank_nonneg CHECK (default_min_tier_rank >= 0),
  CONSTRAINT event_types_tenant_key_unique UNIQUE (tenant_id, key)
);

COMMENT ON TABLE public.event_types IS
  'Katalog rodzajow wydarzen per organizacja. `key` odwzorowuje legacy `events.kind`; kolumny `default_*` sa wartosciami startowymi nowego wydarzenia.';

CREATE INDEX IF NOT EXISTS event_types_tenant_active_idx
  ON public.event_types (tenant_id, is_active, sort_order, key);
CREATE INDEX IF NOT EXISTS event_types_key_idx
  ON public.event_types (key) WHERE is_active;

GRANT SELECT ON public.event_types TO anon;
GRANT SELECT ON public.event_types TO authenticated;
GRANT ALL ON public.event_types TO service_role;

ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;

-- Nazwy rodzajow sa trescia publiczna (widac je na liscie wydarzen i w filtrach
-- bez logowania), ale WYLACZNIE w obrebie jednej organizacji.
DROP POLICY IF EXISTS "event_types_public_read" ON public.event_types;
CREATE POLICY "event_types_public_read"
  ON public.event_types FOR SELECT
  TO anon, authenticated
  USING (tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id()));

DROP POLICY IF EXISTS "event_types_admin_insert" ON public.event_types;
CREATE POLICY "event_types_admin_insert"
  ON public.event_types FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public._caller_tenant()
  );

DROP POLICY IF EXISTS "event_types_admin_update" ON public.event_types;
CREATE POLICY "event_types_admin_update"
  ON public.event_types FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public._caller_tenant()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public._caller_tenant()
  );

DROP POLICY IF EXISTS "event_types_admin_delete" ON public.event_types;
CREATE POLICY "event_types_admin_delete"
  ON public.event_types FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public._caller_tenant()
    AND is_system = false
  );

DROP TRIGGER IF EXISTS event_types_touch_updated_at ON public.event_types;
CREATE TRIGGER event_types_touch_updated_at
  BEFORE UPDATE ON public.event_types
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Zasilenie katalogu: szesc rodzajow zgodnych z legacy CHECK-iem `events.kind`
--
-- Klucze SA IDENTYCZNE z wartosciami `events.kind`, bo tylko wtedy backfill
-- `event_type_id` da sie zrobic bez tabeli mapujacej, a widgety czytajace `kind`
-- nie zauwaza zmiany. `is_system = true` chroni je przed usunieciem: skasowany
-- rodzaj zabralby ze soba etykiete z archiwum wydarzen.
-- ----------------------------------------------------------------------------
INSERT INTO public.event_types (
  tenant_id, key, name_pl, name_en, description_pl, description_en,
  icon, default_format, default_registration_mode, default_duration_minutes,
  sort_order, is_system
)
SELECT
  t.id, d.key, d.name_pl, d.name_en, d.description_pl, d.description_en,
  d.icon, d.default_format, d.default_registration_mode, d.default_duration_minutes,
  d.sort_order, true
FROM public.tenants t
CROSS JOIN (VALUES
  ('webinar', 'Webinar', 'Webinar',
   'Spotkanie online z prezentacja i pytaniami na czacie.',
   'Online session with a presentation and chat questions.',
   'Video', 'online', 'rsvp', 60, 10),
  ('briefing', 'Briefing', 'Briefing',
   'Krotkie omowienie biezacej sprawy dla waskiego grona.',
   'Short briefing on a current topic for a small group.',
   'FileText', 'online', 'rsvp', 45, 20),
  ('roundtable', 'Okragly stol', 'Roundtable',
   'Dyskusja przy stole z ograniczona liczba miejsc.',
   'Table discussion with a limited number of seats.',
   'Users', 'onsite', 'form', 120, 30),
  ('ama', 'Pytania i odpowiedzi', 'Ask me anything',
   'Sesja pytan do zaproszonego eksperta.',
   'Open question session with an invited expert.',
   'MessagesSquare', 'online', 'rsvp', 60, 40),
  ('in_person', 'Stacjonarne', 'In person',
   'Wydarzenie na miejscu, z rejestracja przy wejsciu.',
   'On-site event with check-in at the entrance.',
   'MapPin', 'onsite', 'form', 180, 50),
  ('hybrid', 'Hybrydowe', 'Hybrid',
   'Wydarzenie na miejscu z rownolegla transmisja online.',
   'On-site event with a parallel online stream.',
   'Radio', 'hybrid', 'form', 180, 60)
) AS d(key, name_pl, name_en, description_pl, description_en,
       icon, default_format, default_registration_mode, default_duration_minutes, sort_order)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Kolumny wydarzenia: rodzaj, przeplyw, cykl zycia, zaczep frontu
-- ----------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_type_id uuid REFERENCES public.event_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'onsite',
  ADD COLUMN IF NOT EXISTS registration_mode text NOT NULL DEFAULT 'rsvp',
  ADD COLUMN IF NOT EXISTS registration_flow text NOT NULL DEFAULT 'instant',
  ADD COLUMN IF NOT EXISTS guest_mode text NOT NULL DEFAULT 'teaser',
  ADD COLUMN IF NOT EXISTS external_registration_url text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS root_page_id uuid REFERENCES public.pages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.events.event_type_id IS
  'Rodzaj wydarzenia z katalogu `event_types`. NULL = wydarzenie sprzed wprowadzenia katalogu albo rodzaj usuniety.';
COMMENT ON COLUMN public.events.format IS
  'GDZIE sie dzieje: onsite / online / hybrid. Rozdzielone od `kind`, ktore mowi CZYM jest wydarzenie.';
COMMENT ON COLUMN public.events.registration_mode IS
  'JAK sie zapisac: rsvp (jeden klik) / form (formularz) / external (narzedzie zewnetrzne) / none (bez zapisow).';
COMMENT ON COLUMN public.events.registration_flow IS
  'CZY zapis wymaga akceptacji organizatora: instant / approval.';
COMMENT ON COLUMN public.events.guest_mode IS
  'Co widzi osoba NIEZAREJESTROWANA na wydarzenie: hidden (nic) / teaser (opis i agenda) / full (wszystko poza kontaktami).';
COMMENT ON COLUMN public.events.published_at IS
  'Stempel pierwszej publikacji. Odporny na retencje `domain_events` (prune_domain_events kasuje szyne po ~90 dniach).';
COMMENT ON COLUMN public.events.cancelled_at IS
  'Stempel odwolania. Ustawiany triggerem przy przejsciu statusu, nie przez klienta.';
COMMENT ON COLUMN public.events.root_page_id IS
  'Strona glowna frontu wydarzenia (poddrzewo `pages`). NULL = wydarzenie bez wlasnej strony, widoczne tylko na /events/<slug>.';
COMMENT ON COLUMN public.events.branding IS
  'Marka wydarzenia (kolory, logotypy) niezalezna od motywu serwisu. Kontrakt kluczy zyje w src/lib/events/branding.ts.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_format_values'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_format_values CHECK (format IN ('onsite', 'online', 'hybrid'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_registration_mode_values'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_registration_mode_values
      CHECK (registration_mode IN ('rsvp', 'form', 'external', 'none'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_registration_flow_values'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_registration_flow_values
      CHECK (registration_flow IN ('instant', 'approval'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_guest_mode_values'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_guest_mode_values
      CHECK (guest_mode IN ('hidden', 'teaser', 'full'));
  END IF;

  -- Adres zewnetrznej rejestracji jedzie do atrybutu href, wiec musi byc https.
  -- Wymog jest tez warunkowy: tryb `external` bez adresu to przycisk w nikad.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_external_registration_url_https'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_external_registration_url_https
      CHECK (external_registration_url IS NULL OR external_registration_url ~ '^https://');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_external_mode_requires_url'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_external_mode_requires_url
      CHECK (registration_mode <> 'external' OR external_registration_url IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS events_event_type_idx
  ON public.events (tenant_id, event_type_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS events_root_page_idx
  ON public.events (root_page_id) WHERE root_page_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Backfill: rodzaj i format istniejacych wydarzen
--
-- Warunkowy (`IS NULL`), zeby powtorny przebieg nie nadpisal decyzji redakcji.
-- Mapowanie formatu wynika z semantyki `kind`: webinar i AMA dzieja sie online,
-- hybrid jest hybrydowy, reszta domyslnie na miejscu.
-- ----------------------------------------------------------------------------
UPDATE public.events e
SET event_type_id = et.id
FROM public.event_types et
WHERE e.event_type_id IS NULL
  AND et.tenant_id = e.tenant_id
  AND et.key = e.kind;

UPDATE public.events
SET format = CASE kind
    WHEN 'webinar' THEN 'online'
    WHEN 'ama' THEN 'online'
    WHEN 'briefing' THEN 'online'
    WHEN 'hybrid' THEN 'hybrid'
    ELSE 'onsite'
  END
WHERE format = 'onsite'
  AND kind IN ('webinar', 'ama', 'briefing', 'hybrid');

-- Data publikacji z szyny zdarzen, dopoki jeszcze tam jest. Bierzemy
-- NAJSTARSZE `event.published.v1` - wydarzenie moglo byc publikowane
-- i wycofywane wielokrotnie, a stempel opisuje PIERWSZE wyjscie na swiat.
UPDATE public.events e
SET published_at = de.first_published
FROM (
  SELECT aggregate_id, min(created_at) AS first_published
  FROM public.domain_events
  WHERE aggregate_type = 'event' AND event_type = 'event.published.v1'
  GROUP BY aggregate_id
) de
WHERE e.published_at IS NULL
  AND de.aggregate_id = e.id::text;

-- Wydarzenia opublikowane przed wprowadzeniem szyny nie maja zdarzenia; ich
-- stempel jest nieodtwarzalny, wiec bierzemy `created_at` jako DOLNE ograniczenie
-- (lepsze niz NULL, ktory na pulpicie znaczy "nigdy nie publikowane").
UPDATE public.events
SET published_at = created_at
WHERE published_at IS NULL AND status = 'published';

UPDATE public.events e
SET cancelled_at = de.last_cancelled
FROM (
  SELECT aggregate_id, max(created_at) AS last_cancelled
  FROM public.domain_events
  WHERE aggregate_type = 'event' AND event_type = 'event.cancelled.v1'
  GROUP BY aggregate_id
) de
WHERE e.cancelled_at IS NULL
  AND de.aggregate_id = e.id::text;

UPDATE public.events
SET cancelled_at = updated_at
WHERE cancelled_at IS NULL AND status = 'cancelled';

-- ----------------------------------------------------------------------------
-- 5. Trigger cyklu zycia: stempel publikacji i odwolania
--
-- BEFORE UPDATE, zeby wartosc byla w wierszu jeszcze przed AFTER-owym
-- `events_status_notify` - inaczej powiadomienie i webhook widzialyby NULL
-- w kolumnie, ktora wlasnie opisuje ich powod.
--
-- `published_at` ustawiamy TYLKO gdy jest puste: powtorna publikacja po
-- wycofaniu nie klamie o dacie premiery. `cancelled_at` nadpisujemy, bo istotne
-- jest OSTATNIE odwolanie, a przywrocenie wydarzenia je czysci.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_events_stamp_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;

  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    NEW.cancelled_at := now();
  END IF;

  IF NEW.status <> 'cancelled' AND OLD.status = 'cancelled' THEN
    NEW.cancelled_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_stamp_lifecycle ON public.events;
CREATE TRIGGER events_stamp_lifecycle
  BEFORE UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_events_stamp_lifecycle();

-- Wydarzenie utworzone od razu jako `published` (import, klon poprzedniej
-- edycji) nie przechodzi przez UPDATE, wiec potrzebuje wlasnej galezi.
CREATE OR REPLACE FUNCTION public.tg_events_stamp_lifecycle_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_stamp_lifecycle_insert ON public.events;
CREATE TRIGGER events_stamp_lifecycle_insert
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_events_stamp_lifecycle_insert();

-- ----------------------------------------------------------------------------
-- 6. Publiczny odczyt aktywnych rodzajow (filtry na liscie wydarzen, selekt
--    w kreatorze). Wiazanie z najemca IDENTYCZNE jak w polityce - SECURITY
--    DEFINER omija RLS, wiec bez tego warunku funkcja odslanialaby katalogi
--    wszystkich organizacji (dokladnie regresja z 20260816090000).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_types_active()
RETURNS TABLE (
  id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  icon text,
  accent_color text,
  default_format text,
  default_registration_mode text,
  default_registration_flow text,
  default_guest_mode text,
  default_capacity integer,
  default_duration_minutes integer,
  default_min_tier_rank integer,
  default_chatham_house boolean,
  requires_ticket boolean,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    et.id, et.key, et.name_pl, et.name_en, et.description_pl, et.description_en,
    et.icon, et.accent_color, et.default_format, et.default_registration_mode,
    et.default_registration_flow, et.default_guest_mode, et.default_capacity,
    et.default_duration_minutes, et.default_min_tier_rank, et.default_chatham_house,
    et.requires_ticket, et.sort_order
  FROM public.event_types et
  WHERE et.is_active
    AND et.tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id())
  ORDER BY et.sort_order, et.key;
$$;

REVOKE ALL ON FUNCTION public.event_types_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_types_active() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_types_active() IS
  'Aktywne rodzaje wydarzen tenanta wolajacego (anon: tenant z naglowka hosta). Zrodlo selektu w kreatorze i filtrow na liscie.';

-- ----------------------------------------------------------------------------
-- 7. Panel: lista rodzajow z licznikiem uzycia
--
-- Licznik jest ROZBITY na wszystkie i opublikowane. Redaktor kasujacy rodzaj
-- musi wiedziec nie tylko, ze "cos go uzywa", ale czy to szkice (do przepiecia
-- w minute), czy wydarzenia zywe na produkcji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_types_list()
RETURNS TABLE (
  id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  icon text,
  accent_color text,
  default_format text,
  default_registration_mode text,
  default_registration_flow text,
  default_guest_mode text,
  default_capacity integer,
  default_duration_minutes integer,
  default_min_tier_rank integer,
  default_chatham_house boolean,
  requires_ticket boolean,
  sort_order integer,
  is_active boolean,
  is_system boolean,
  events_count integer,
  published_events_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT
    et.id, et.key, et.name_pl, et.name_en, et.description_pl, et.description_en,
    et.icon, et.accent_color, et.default_format, et.default_registration_mode,
    et.default_registration_flow, et.default_guest_mode, et.default_capacity,
    et.default_duration_minutes, et.default_min_tier_rank, et.default_chatham_house,
    et.requires_ticket, et.sort_order, et.is_active, et.is_system,
    COALESCE(u.total, 0)::integer,
    COALESCE(u.published, 0)::integer
  FROM public.event_types et
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE ev.status = 'published')::integer AS published
    FROM public.events ev
    WHERE ev.tenant_id = v_tenant
      AND (ev.event_type_id = et.id OR (ev.event_type_id IS NULL AND ev.kind = et.key))
  ) u ON true
  WHERE et.tenant_id = v_tenant
  ORDER BY et.sort_order, et.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_types_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_types_list() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_types_list() IS
  'Katalog rodzajow wydarzen dla panelu, z licznikiem uzycia (wszystkie i opublikowane). Bramka: assert_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 8. Panel: dodanie i edycja rodzaju
--
-- Payload jest jsonb, a nie 18 parametrami pozycyjnymi: katalog ma osiemnascie
-- pol redakcyjnych i bedzie ich mial wiecej, a kazde dodane pole w sygnaturze
-- pozycyjnej to NOWA funkcja w bazie (Postgres przeciaza po sygnaturze), stary
-- klient wolajacy poprzednia i dwa granty do utrzymania. Wzorzec przejety
-- z `admin_club_specialization_upsert(jsonb)`.
--
-- KLUCZ JEST NIEZMIENNY PO ZAPISIE. Zmieniony klucz osierocilby wydarzenia
-- czytajace legacy `events.kind` - w edycji pole jest ignorowane, nie
-- odrzucane, zeby klient mogl odeslac caly wiersz bez filtrowania.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_type_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_exists boolean;
BEGIN
  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: both names are required';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT true INTO v_exists
    FROM public.event_types et
    WHERE et.id = v_id AND et.tenant_id = v_tenant;

    IF v_exists IS NOT TRUE THEN
      RAISE EXCEPTION 'not_found: event type does not exist in this tenant';
    END IF;

    UPDATE public.event_types SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), description_en),
      icon = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'icon', '')), ''), icon),
      accent_color = CASE
        WHEN p_payload ? 'accent_color'
          THEN NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), '')
        ELSE accent_color
      END,
      default_format = COALESCE(NULLIF(p_payload->>'default_format', ''), default_format),
      default_registration_mode =
        COALESCE(NULLIF(p_payload->>'default_registration_mode', ''), default_registration_mode),
      default_registration_flow =
        COALESCE(NULLIF(p_payload->>'default_registration_flow', ''), default_registration_flow),
      default_guest_mode =
        COALESCE(NULLIF(p_payload->>'default_guest_mode', ''), default_guest_mode),
      default_capacity = CASE
        WHEN p_payload ? 'default_capacity' THEN (NULLIF(p_payload->>'default_capacity', ''))::integer
        ELSE default_capacity
      END,
      default_duration_minutes = CASE
        WHEN p_payload ? 'default_duration_minutes'
          THEN (NULLIF(p_payload->>'default_duration_minutes', ''))::integer
        ELSE default_duration_minutes
      END,
      default_min_tier_rank =
        COALESCE((NULLIF(p_payload->>'default_min_tier_rank', ''))::integer, default_min_tier_rank),
      default_chatham_house =
        COALESCE((NULLIF(p_payload->>'default_chatham_house', ''))::boolean, default_chatham_house),
      requires_ticket =
        COALESCE((NULLIF(p_payload->>'requires_ticket', ''))::boolean, requires_ticket),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active)
    WHERE id = v_id AND tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  INSERT INTO public.event_types (
    tenant_id, key, name_pl, name_en, description_pl, description_en, icon, accent_color,
    default_format, default_registration_mode, default_registration_flow, default_guest_mode,
    default_capacity, default_duration_minutes, default_min_tier_rank, default_chatham_house,
    requires_ticket, sort_order, is_active, is_system
  ) VALUES (
    v_tenant, v_key, v_name_pl, v_name_en,
    COALESCE(btrim(p_payload->>'description_pl'), ''),
    COALESCE(btrim(p_payload->>'description_en'), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_payload->>'icon', '')), ''), 'CalendarDays'),
    NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), ''),
    COALESCE(NULLIF(p_payload->>'default_format', ''), 'onsite'),
    COALESCE(NULLIF(p_payload->>'default_registration_mode', ''), 'rsvp'),
    COALESCE(NULLIF(p_payload->>'default_registration_flow', ''), 'instant'),
    COALESCE(NULLIF(p_payload->>'default_guest_mode', ''), 'teaser'),
    (NULLIF(p_payload->>'default_capacity', ''))::integer,
    (NULLIF(p_payload->>'default_duration_minutes', ''))::integer,
    COALESCE((NULLIF(p_payload->>'default_min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'default_chatham_house', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'requires_ticket', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_type_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_type_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_type_upsert(jsonb) IS
  'Dodanie albo edycja rodzaju wydarzenia. Klucz jest niezmienny po zapisie. Bramka: assert_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 9. Panel: przelacznik dostepnosci rodzaju
--
-- Wylaczenie jest ODWRACALNE i nie rusza wydarzen - rodzaj znika z kreatora,
-- ale istniejace wydarzenia zachowuja etykiete. To dlatego wylaczenie jest
-- osobna operacja od usuniecia, a nie jego lagodniejsza wersja.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_type_set_active(_id uuid, _is_active boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
BEGIN
  UPDATE public.event_types
  SET is_active = _is_active
  WHERE id = _id AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event type does not exist in this tenant';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_type_set_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_type_set_active(uuid, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. Panel: usuniecie rodzaju - tylko gdy nikt go nie uzywa
--
-- Dwie niezalezne blokady, obie po stronie DANYCH, a nie widoku przycisku:
--   * wpis systemowy nie kasuje sie nigdy (zabralby etykiete z archiwum);
--   * wpis uzywany nie kasuje sie, dopoki cokolwiek go uzywa - liczymy TAKZE
--     wydarzenia bez `event_type_id`, ktore trzymaja rodzaj w legacy `kind`,
--     bo to dokladnie te wiersze, ktore zostalyby bez nazwy rodzaju.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_type_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_key text;
  v_is_system boolean;
  v_used integer;
BEGIN
  SELECT et.key, et.is_system INTO v_key, v_is_system
  FROM public.event_types et
  WHERE et.id = _id AND et.tenant_id = v_tenant;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'not_found: event type does not exist in this tenant';
  END IF;

  IF v_is_system THEN
    RAISE EXCEPTION 'event_type_system: system types cannot be deleted';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.events ev
  WHERE ev.tenant_id = v_tenant
    AND (ev.event_type_id = _id OR (ev.event_type_id IS NULL AND ev.kind = v_key));

  IF v_used > 0 THEN
    RAISE EXCEPTION 'event_type_in_use: % event(s) still use this type', v_used;
  END IF;

  DELETE FROM public.event_types WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_type_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_type_delete(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 11. Panel: przepiecie wydarzen z jednego rodzaju na inny
--
-- Bez tej operacji "rodzaj w uzyciu" jest pulapka bez wyjscia: redaktor widzi
-- blokade usuniecia i licznik 40 wydarzen, ale zeby je przepiac musialby otworzyc
-- czterdziesci formularzy. Operacja jest jawna, policzalna z gory (licznik
-- z `admin_event_types_list`) i skalowana po tenancie w obie strony.
--
-- Aktualizuje TAKZE legacy `kind`, bo widgety publiczne czytaja ta kolumne -
-- przepiecie samego `event_type_id` zostawiloby wydarzenie z nowa nazwa w panelu
-- i stara na stronie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_type_reassign(_from_id uuid, _to_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_from_key text;
  v_to_key text;
  v_moved integer;
BEGIN
  IF _from_id = _to_id THEN
    RAISE EXCEPTION 'invalid_target: source and target types are the same';
  END IF;

  SELECT et.key INTO v_from_key
  FROM public.event_types et WHERE et.id = _from_id AND et.tenant_id = v_tenant;
  IF v_from_key IS NULL THEN
    RAISE EXCEPTION 'not_found: source event type does not exist in this tenant';
  END IF;

  SELECT et.key INTO v_to_key
  FROM public.event_types et WHERE et.id = _to_id AND et.tenant_id = v_tenant;
  IF v_to_key IS NULL THEN
    RAISE EXCEPTION 'not_found: target event type does not exist in this tenant';
  END IF;

  -- Legacy `kind` ma wlasny CHECK z szescioma wartosciami, wiec nowy rodzaj
  -- redakcyjny nie da sie w nia wpisac. Przepisujemy ja TYLKO gdy klucz
  -- docelowy nalezy do legacy zbioru; w przeciwnym razie zostaje stara wartosc
  -- jako historyczna, a zrodlem prawdy jest `event_type_id`.
  UPDATE public.events
  SET event_type_id = _to_id,
      kind = CASE
        WHEN v_to_key IN ('webinar', 'briefing', 'roundtable', 'ama', 'in_person', 'hybrid')
          THEN v_to_key
        ELSE kind
      END
  WHERE tenant_id = v_tenant
    AND (event_type_id = _from_id OR (event_type_id IS NULL AND kind = v_from_key));

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_type_reassign(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_type_reassign(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_type_reassign(uuid, uuid) IS
  'Przepina wszystkie wydarzenia z rodzaju _from_id na _to_id w tenancie wolajacego i zwraca liczbe przepietych wierszy.';
