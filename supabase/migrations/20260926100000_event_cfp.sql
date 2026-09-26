-- ============================================================================
-- NABOR PRELEGENTOW (CALL FOR SPEAKERS): ZGLOSZENIA, OCENA RECENZENTOW,
-- DECYZJA ORGANIZATORA I PANEL PRELEGENTA.
--
-- BLIZNIAK drizzle/migrations/0057_event_cfp.sql - ten sam SQL wykonywalny
-- (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
-- (nazwy public.admin_event_* / FUNCTION public.event_*( wciagaja plik do
-- events-harness)
--
-- PO CO
--   Organizator ogloszal nabor prelegentow poza aplikacja (formularz w obcym
--   narzedziu, arkusz ocen, mail do kazdego zglaszajacego) i potem RECZNIE
--   przepisywal przyjetych do rejestru prelegentow, agendy i CRM. Ten plik
--   stawia caly obieg w jednym miejscu:
--     zgloszenie (prelegent z kontem) -> ocena (recenzenci, takze w ciemno)
--     -> decyzja (organizator) -> przyjecie (rejestr prelegentow, szkic sesji,
--     grupa i zapis prelegenta) -> potwierdzenie (prelegent) -> panel
--     prelegenta (profil sceniczny, wystapienia, materialy).
--
-- CO ROBI
--   1) Tabele (wszystkie z `tenant_id`, kluczami obcymi ZLOZONYMI po
--      `(tenant_id, event_id)`, RLS wlaczonym, polityka odczytu WYLACZNIE
--      admin/super_admin najemcy i BEZ zadnej polityki zapisu - zapis tylko
--      przez funkcje SECURITY DEFINER ponizej):
--        event_cfp_settings            - jeden wiersz na wydarzenie (stan
--                                        naboru, okno, teksty, formaty,
--                                        sciezki, limity, zasady oceny,
--                                        grupa i bilet przyjetego prelegenta);
--        event_cfp_fields              - wlasne pytania formularza zgloszenia;
--        event_cfp_submissions         - zgloszenia z pelnym sladem decyzji;
--        event_cfp_submission_speakers - wystepujacy (zglaszajacy + wspolprelegenci);
--        event_cfp_reviewers           - recenzenci (konta), zakres sciezek,
--                                        wglad w tozsamosc przy ocenie w ciemno;
--        event_cfp_reviews             - oceny (jedna na zgloszenie i recenzenta);
--        event_speaker_materials       - materialy prelegenta jako ADRESY https.
--   2) Plaszczyzna panelu (`assert_event_admin_tenant()`): ustawienia,
--      pytania, lista zgloszen z agregatami ocen, szczegol, decyzja,
--      przyjecie z zapisem do rejestru prelegentow, recenzenci, ladunek
--      powiadomienia, materialy.
--   3) Plaszczyzna tresci (`public_tenant_id()`, anon + zalogowani):
--      `event_cfp_public(slug)` - czy nabor jest otwarty, okno, teksty,
--      formaty, sciezki i pytania (TYLKO wydarzenia opublikowane).
--   4) Plaszczyzna wlasna (`public_tenant_id()` + `auth.uid()`): szkic,
--      wyslanie, wycofanie, odpowiedz na przyjecie, moje zgloszenia, panel
--      prelegenta, profil sceniczny, materialy. Wyjatek: ladunek maila
--      "zgloszenie przyjete" (`event_cfp_submission_notice`) wola funkcja
--      serwerowa BEZ naglowka hosta - najemce bierze z wiersza, ktorego
--      wlasnoscia (`event_people.user_id = auth.uid()`) wolajacy sie wykazal.
--   5) Plaszczyzna recenzenta (`public_tenant_id()` + czlonkostwo
--      w `event_cfp_reviewers`): kolejka, odczyt i zapis oceny.
--   6) Wspolny kawalek rejestru prelegentow: `_event_speaker_roster_add`
--      (dopisanie nakladki do rejestru wydarzenia) - uzywa go i przyjecie
--      zgloszenia, i `admin_event_speaker_upsert` (przepisany z 20260924140000
--      bez zmiany zachowania). Przyjety prelegent trafia do TEGO SAMEGO
--      lancucha `event_people -> speaker_profiles -> event_speaker_entries
--      -> event_session_speakers`, nie do rownoleglego rejestru.
--   7) Eksport RODO wolajacego (`event_cfp_export_my_data`): zgloszenia,
--      materialy, role i wlasne oceny recenzenta dla paczki danych osobowych
--      (`src/lib/profile/export.functions.ts`). Najemca z profilu wolajacego,
--      jak `club_export_my_data`.
--
-- DECYZJE, KTORE WARTO ZNAC
--   * OTWARCIE NABORU ROZSTRZYGA BAZA. `status = 'open'` ORAZ okno
--     `opens_at <= now() < closes_at` ORAZ wydarzenie opublikowane - nigdy
--     zegar przegladarki (strona publiczna jest w pamieci krawedzi do doby).
--   * ZGLASZAJACY MA KONTO. Osoba jest wiazana z `auth.uid()` jak w
--     `event_register`: po `event_people.user_id`, potem po adresie KONTA
--     (`auth.users.email`, nie adresie z formularza), inaczej nowa kartoteka
--     `source = 'self_registration'` ze stemplem przetwarzania danych.
--   * WSPOLPRELEGENCI NIE DOSTAJA KARTOTEKI PRZED DECYZJA. Zglaszajacy podaje
--     ich dane, ale `event_people` (kartoteka CALEGO najemcy) powstaje dopiero
--     przy PRZYJECIU, z reki organizatora (`source = 'organizer'`, jak
--     `admin_event_speaker_upsert`). Odrzucone zgloszenie nie zostawia wiec
--     w kartotece osob trzecich, ktore nigdy nie mialy z organizatorem
--     kontaktu - i dopiero wtedy trafiaja tez do CRM.
--   * LIMIT ZGLOSZEN (`max_per_submitter`) liczony POD BLOKADA wiersza
--     ustawien - dwa rownolegle szkice nie przeskocza limitu.
--   * OCENA W CIEMNO ukrywa tozsamosc wystepujacych w kolejce i w podgladzie
--     recenzenta, chyba ze recenzent ma `can_see_identity`. Recenzent NIGDY
--     nie ocenia zgloszenia, w ktorym sam wystepuje.
--   * PIERWSZA OCENA przestawia `submitted` na `under_review` (bez sladu
--     decyzji czlowieka - `decided_*` zostaje nietkniete).
--   * ODRZUCENIE WYMAGA NOTATKI (CHECK, jak przy zapisach).
--   * PRELEGENT WIDZI tylko `feedback_to_speaker` i liczbe ocen; srednia
--     pojawia sie po decyzji. Pojedyncze oceny i komentarze recenzentow
--     zostaja u organizatora.
--   * MATERIALY TO ADRESY https (bez wrzutu plikow w tej wersji). Zmiana
--     adresu lub tytulu przez prelegenta zdejmuje publikacje - organizator
--     zatwierdza material jeszcze raz.
--   * ZDANIA OSI CZASU CRM po polsku sa zapisane sekwencjami `U&'...\XXXX'`,
--     bo plik migracji jest czystym ASCII (wymog blizniaka drizzle).
--
-- CRM (most `_event_person_crm_sync` z 20260926090000)
--   * wyslanie: zglaszajacy -> segment `event_cfp`, etykieta
--     `event:<slug>:cfp`, tagi `event:<slug>`, `cfp:submitted`, pole
--     `cfp_title`, kontakt MOZE powstac, wpis osi czasu `event.cfp.submitted`;
--   * decyzja / odpowiedz / wycofanie: TYLKO wzbogacenie istniejacego kontaktu
--     (`p_create = false`), tag `cfp:<status>`, wpis `event.cfp.<status>`;
--   * przyjecie: KAZDY wystepujacy -> segment `speaker`, tagi `event:<slug>`,
--     `speaker` (+ `cfp:accepted` u zglaszajacego), kontakt moze powstac,
--     `speaker_profiles.crm_lead_id` uzupelniany, gdy pusty.
--   Oceny, notatki recenzentow i notatka decyzji NIGDY nie ida do CRM.
--
-- CZEGO NIE ZMIENIA
--   * zachowania `admin_event_speaker_upsert` (ten sam wynik, wspolny ogon);
--   * polityk i kolumn tabel innych modulow; kartoteki `event_people`
--     (wartosci `source` bez zmian);
--   * potoku kodow biletow: zapis prelegenta powstaje jako `approved`,
--     `registration_mode = 'form'`, `payment_status = 'not_required'`, wiec
--     bilet z kodem QR wysyla istniejace zadanie `event-ticket-codes`.
--
-- IDEMPOTENCJA
--   CREATE TABLE IF NOT EXISTS, indeksy IF NOT EXISTS, DROP POLICY/TRIGGER
--   IF EXISTS + CREATE, CREATE OR REPLACE FUNCTION.
--
-- KOLEJNOSC WDROZENIA
--   Po 20260926090000 (most CRM, segment `event_cfp`).
--
-- Testy: scripts/events-harness/runtime_test.d/42_cfp.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) USTAWIENIA NABORU (jeden wiersz na wydarzenie)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_cfp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  opens_at timestamptz,
  closes_at timestamptz,
  intro_pl text NOT NULL DEFAULT '',
  intro_en text NOT NULL DEFAULT '',
  guidelines_pl text NOT NULL DEFAULT '',
  guidelines_en text NOT NULL DEFAULT '',
  formats jsonb NOT NULL DEFAULT '[]'::jsonb,
  track_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  max_per_submitter integer NOT NULL DEFAULT 3,
  allow_co_speakers boolean NOT NULL DEFAULT true,
  review_blind boolean NOT NULL DEFAULT false,
  score_max integer NOT NULL DEFAULT 5,
  review_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_reviews integer NOT NULL DEFAULT 2,
  speaker_group_id uuid,
  speaker_ticket_type_id uuid,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_cfp_settings_status_values CHECK (status IN ('draft', 'open', 'closed')),
  CONSTRAINT event_cfp_settings_window_order
    CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at),
  CONSTRAINT event_cfp_settings_texts_len CHECK (
    char_length(intro_pl) <= 8000 AND char_length(intro_en) <= 8000
    AND char_length(guidelines_pl) <= 8000 AND char_length(guidelines_en) <= 8000
  ),
  CONSTRAINT event_cfp_settings_formats_shape CHECK (jsonb_typeof(formats) = 'array'),
  CONSTRAINT event_cfp_settings_criteria_shape CHECK (jsonb_typeof(review_criteria) = 'array'),
  CONSTRAINT event_cfp_settings_max_per_submitter_range CHECK (max_per_submitter BETWEEN 1 AND 20),
  CONSTRAINT event_cfp_settings_score_max_range CHECK (score_max BETWEEN 3 AND 10),
  CONSTRAINT event_cfp_settings_min_reviews_range CHECK (min_reviews BETWEEN 0 AND 20),
  CONSTRAINT event_cfp_settings_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_cfp_settings_event_unique UNIQUE (tenant_id, event_id),
  CONSTRAINT event_cfp_settings_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_cfp_settings_group_fk FOREIGN KEY (tenant_id, event_id, speaker_group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE SET NULL (speaker_group_id),
  CONSTRAINT event_cfp_settings_ticket_fk FOREIGN KEY (tenant_id, event_id, speaker_ticket_type_id)
    REFERENCES public.event_ticket_types (tenant_id, event_id, id)
    ON DELETE SET NULL (speaker_ticket_type_id)
);

COMMENT ON TABLE public.event_cfp_settings IS
  'Ustawienia naboru prelegentow jednego wydarzenia: stan (draft/open/closed), okno, teksty PL/EN, formaty, dozwolone sciezki, limity, zasady oceny, grupa i bilet przyjetego prelegenta. Zapis wylacznie przez admin_event_cfp_settings_save.';
COMMENT ON COLUMN public.event_cfp_settings.status IS
  'draft = nabor niewidoczny; open = przyjmuje zgloszenia w oknie opens_at..closes_at; closed = widoczny, ale zamkniety. Otwarcie liczy baza (_event_cfp_is_open), nie przegladarka.';
COMMENT ON COLUMN public.event_cfp_settings.formats IS
  'Formy wystapienia: tablica {key, label_pl, label_en, duration_min}. Pusta = zgloszenie bez wyboru formy.';
COMMENT ON COLUMN public.event_cfp_settings.track_ids IS
  'Sciezki do wyboru w zgloszeniu (podzbior event_tracks). Pusta = zgloszenie bez sciezki.';
COMMENT ON COLUMN public.event_cfp_settings.review_criteria IS
  'Kryteria oceny: tablica {key, label_pl, label_en, weight 1..10}. Wynik wazony = srednia wazona ocen kryteriow.';
COMMENT ON COLUMN public.event_cfp_settings.speaker_group_id IS
  'Grupa, do ktorej trafia przyjety prelegent (domyslnie zaseedowana grupa speakers).';
COMMENT ON COLUMN public.event_cfp_settings.speaker_ticket_type_id IS
  'Bilet zapisu tworzonego przyjetemu prelegentowi (opcjonalny).';

DROP TRIGGER IF EXISTS event_cfp_settings_touch_updated_at ON public.event_cfp_settings;
CREATE TRIGGER event_cfp_settings_touch_updated_at
  BEFORE UPDATE ON public.event_cfp_settings
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2) WLASNE PYTANIA FORMULARZA ZGLOSZENIA
--
-- Osobna tabela, a nie kolumna "przeznaczenie" w event_registration_fields:
-- formularz zapisu i `event_register` nie filtruja po przeznaczeniu, wiec
-- pytanie naboru wypadloby w formularzu zapisu i blokowalo zapisy.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_cfp_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  field_type text NOT NULL,
  label_pl text NOT NULL,
  label_en text NOT NULL,
  help_pl text NOT NULL DEFAULT '',
  help_en text NOT NULL DEFAULT '',
  is_required boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_cfp_fields_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_cfp_fields_field_type_values CHECK (field_type IN (
    'text', 'textarea', 'select', 'multiselect', 'checkbox', 'url', 'number'
  )),
  CONSTRAINT event_cfp_fields_label_pl_len CHECK (char_length(btrim(label_pl)) BETWEEN 1 AND 200),
  CONSTRAINT event_cfp_fields_label_en_len CHECK (char_length(btrim(label_en)) BETWEEN 1 AND 200),
  CONSTRAINT event_cfp_fields_help_len CHECK (char_length(help_pl) <= 500 AND char_length(help_en) <= 500),
  CONSTRAINT event_cfp_fields_options_shape CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT event_cfp_fields_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_cfp_fields_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_cfp_fields_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_cfp_fields IS
  'Pytania formularza zgloszenia do naboru prelegentow. Odpowiedzi leza w event_cfp_submissions.answers po kluczu. Zapis wylacznie przez admin_event_cfp_field_upsert / _delete / _fields_reorder.';

CREATE INDEX IF NOT EXISTS event_cfp_fields_event_order_idx
  ON public.event_cfp_fields (tenant_id, event_id, sort_order, key);

DROP TRIGGER IF EXISTS event_cfp_fields_touch_updated_at ON public.event_cfp_fields;
CREATE TRIGGER event_cfp_fields_touch_updated_at
  BEFORE UPDATE ON public.event_cfp_fields
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3) ZGLOSZENIA
--
-- Klucze obce do sciezki, sesji i nakladki scenicznej sa ZLOZONE z forma
-- kolumnowa `ON DELETE SET NULL (kolumna)`: zwykle SET NULL na kluczu zlozonym
-- zerowaloby tez `tenant_id NOT NULL` i blokowalo usuniecie sesji czy sciezki.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_cfp_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  person_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  title_pl text NOT NULL DEFAULT '',
  title_en text NOT NULL DEFAULT '',
  abstract_pl text NOT NULL DEFAULT '',
  abstract_en text NOT NULL DEFAULT '',
  talk_language text NOT NULL DEFAULT 'pl',
  notify_lang text NOT NULL DEFAULT 'pl',
  format_key text,
  duration_min integer,
  track_id uuid,
  topics text[] NOT NULL DEFAULT '{}'::text[],
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  withdrawn_at timestamptz,
  confirmed_at timestamptz,
  declined_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  feedback_to_speaker text NOT NULL DEFAULT '',
  speaker_profile_id uuid,
  session_id uuid,
  notified_status text,
  notified_at timestamptz,
  notify_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_cfp_submissions_status_values CHECK (status IN (
    'draft', 'submitted', 'under_review', 'changes_requested', 'accepted',
    'waitlisted', 'rejected', 'withdrawn', 'confirmed', 'declined'
  )),
  CONSTRAINT event_cfp_submissions_talk_language_values CHECK (talk_language IN ('pl', 'en')),
  CONSTRAINT event_cfp_submissions_notify_lang_values CHECK (notify_lang IN ('pl', 'en')),
  CONSTRAINT event_cfp_submissions_titles_len
    CHECK (char_length(title_pl) <= 200 AND char_length(title_en) <= 200),
  CONSTRAINT event_cfp_submissions_abstracts_len
    CHECK (char_length(abstract_pl) <= 4000 AND char_length(abstract_en) <= 4000),
  CONSTRAINT event_cfp_submissions_duration_range
    CHECK (duration_min IS NULL OR duration_min BETWEEN 5 AND 480),
  CONSTRAINT event_cfp_submissions_topics_len CHECK (cardinality(topics) <= 10),
  CONSTRAINT event_cfp_submissions_answers_object CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT event_cfp_submissions_note_len
    CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  CONSTRAINT event_cfp_submissions_feedback_len CHECK (char_length(feedback_to_speaker) <= 4000),
  CONSTRAINT event_cfp_submissions_rejection_has_note CHECK (
    status <> 'rejected' OR char_length(btrim(COALESCE(decision_note, ''))) >= 3
  ),
  CONSTRAINT event_cfp_submissions_submitted_dated
    CHECK (status = 'draft' OR submitted_at IS NOT NULL),
  CONSTRAINT event_cfp_submissions_decision_dated
    CHECK (decided_by IS NULL OR decided_at IS NOT NULL),
  CONSTRAINT event_cfp_submissions_notified_status_values CHECK (
    notified_status IS NULL OR notified_status IN ('accepted', 'rejected', 'changes_requested')
  ),
  CONSTRAINT event_cfp_submissions_notify_error_len
    CHECK (notify_error IS NULL OR char_length(notify_error) <= 500),
  CONSTRAINT event_cfp_submissions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_cfp_submissions_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_cfp_submissions_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_cfp_submissions_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_cfp_submissions_track_fk FOREIGN KEY (tenant_id, event_id, track_id)
    REFERENCES public.event_tracks (tenant_id, event_id, id) ON DELETE SET NULL (track_id),
  CONSTRAINT event_cfp_submissions_session_fk FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE SET NULL (session_id),
  CONSTRAINT event_cfp_submissions_profile_fk FOREIGN KEY (tenant_id, speaker_profile_id)
    REFERENCES public.speaker_profiles (tenant_id, id) ON DELETE SET NULL (speaker_profile_id)
);

COMMENT ON TABLE public.event_cfp_submissions IS
  'Zgloszenia do naboru prelegentow: tresc (PL/EN), forma, sciezka, odpowiedzi, slad decyzji organizatora, informacja zwrotna dla prelegenta, wynik (nakladka, sesja) i stan powiadomienia. Zapis wylacznie przez RPC naboru.';
COMMENT ON COLUMN public.event_cfp_submissions.status IS
  'draft -> submitted -> under_review -> (changes_requested | waitlisted | rejected | accepted); accepted -> confirmed | declined; withdrawn = wycofane przez prelegenta.';
COMMENT ON COLUMN public.event_cfp_submissions.notify_lang IS
  'Jezyk interfejsu zglaszajacego w chwili zapisu - w nim idzie poczta o zgloszeniu. Jezyk WYSTAPIENIA to talk_language.';
COMMENT ON COLUMN public.event_cfp_submissions.decision_note IS
  'Notatka organizatora do decyzji (wewnetrzna). Odrzucenie wymaga co najmniej 3 znakow. Nie trafia do CRM ani do prelegenta.';
COMMENT ON COLUMN public.event_cfp_submissions.feedback_to_speaker IS
  'Informacja zwrotna dla prelegenta - jedyny tekst oceny, ktory prelegent widzi.';

CREATE INDEX IF NOT EXISTS event_cfp_submissions_event_status_idx
  ON public.event_cfp_submissions (tenant_id, event_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS event_cfp_submissions_person_idx
  ON public.event_cfp_submissions (tenant_id, person_id, event_id);

DROP TRIGGER IF EXISTS event_cfp_submissions_touch_updated_at ON public.event_cfp_submissions;
CREATE TRIGGER event_cfp_submissions_touch_updated_at
  BEFORE UPDATE ON public.event_cfp_submissions
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4) WYSTEPUJACY W ZGLOSZENIU
--
-- Zglaszajacy (`is_primary`) ma `person_id` od poczatku. Wspolprelegent to
-- dane wpisane przez zglaszajacego; `person_id` dostaje dopiero przy
-- przyjeciu (patrz naglowek pliku, "wspolprelegenci nie dostaja kartoteki").
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_cfp_submission_speakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  person_id uuid,
  is_primary boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'speaker',
  sort_order integer NOT NULL DEFAULT 0,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  job_title text,
  company_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_cfp_submission_speakers_role_values
    CHECK (role IN ('speaker', 'moderator', 'panelist', 'host')),
  CONSTRAINT event_cfp_submission_speakers_primary_has_person
    CHECK (NOT is_primary OR person_id IS NOT NULL),
  CONSTRAINT event_cfp_submission_speakers_names_len CHECK (
    char_length(btrim(first_name)) BETWEEN 1 AND 80 AND char_length(btrim(last_name)) BETWEEN 1 AND 80
  ),
  CONSTRAINT event_cfp_submission_speakers_email_shape CHECK (
    email IS NULL OR (char_length(email) <= 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$')
  ),
  CONSTRAINT event_cfp_submission_speakers_job_len CHECK (job_title IS NULL OR char_length(job_title) <= 160),
  CONSTRAINT event_cfp_submission_speakers_company_len
    CHECK (company_text IS NULL OR char_length(company_text) <= 200),
  CONSTRAINT event_cfp_submission_speakers_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_cfp_submission_speakers_person_unique UNIQUE (tenant_id, submission_id, person_id),
  CONSTRAINT event_cfp_submission_speakers_submission_fk FOREIGN KEY (tenant_id, event_id, submission_id)
    REFERENCES public.event_cfp_submissions (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_cfp_submission_speakers_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_cfp_submission_speakers IS
  'Wystepujacy w zgloszeniu: zglaszajacy (is_primary, person_id od razu) i wspolprelegenci (dane wpisane przez zglaszajacego, person_id nadawany przy przyjeciu). Zapis wylacznie przez RPC naboru.';

CREATE UNIQUE INDEX IF NOT EXISTS event_cfp_submission_speakers_primary_uniq
  ON public.event_cfp_submission_speakers (tenant_id, submission_id) WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS event_cfp_submission_speakers_email_uniq
  ON public.event_cfp_submission_speakers (tenant_id, submission_id, lower(email))
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_cfp_submission_speakers_person_idx
  ON public.event_cfp_submission_speakers (tenant_id, person_id) WHERE person_id IS NOT NULL;

DROP TRIGGER IF EXISTS event_cfp_submission_speakers_touch_updated_at ON public.event_cfp_submission_speakers;
CREATE TRIGGER event_cfp_submission_speakers_touch_updated_at
  BEFORE UPDATE ON public.event_cfp_submission_speakers
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5) RECENZENCI (konta; grupy wydarzenia to plaszczyzna uczestnika, nie
--    organizatora - recenzent czyta dane osobowe zglaszajacych)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_cfp_reviewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  can_see_identity boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_cfp_reviewers_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_cfp_reviewers_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_cfp_reviewers_event_user_unique UNIQUE (tenant_id, event_id, user_id),
  CONSTRAINT event_cfp_reviewers_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_cfp_reviewers IS
  'Recenzenci naboru prelegentow: konto, zakres sciezek (pusty = wszystkie), wglad w tozsamosc przy ocenie w ciemno, aktywnosc. Zapis wylacznie przez admin_event_cfp_reviewer_set / _remove.';

CREATE INDEX IF NOT EXISTS event_cfp_reviewers_user_idx
  ON public.event_cfp_reviewers (tenant_id, user_id);

DROP TRIGGER IF EXISTS event_cfp_reviewers_touch_updated_at ON public.event_cfp_reviewers;
CREATE TRIGGER event_cfp_reviewers_touch_updated_at
  BEFORE UPDATE ON public.event_cfp_reviewers
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6) OCENY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_cfp_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall integer,
  recommendation text,
  comment_private text NOT NULL DEFAULT '',
  comment_to_speaker text NOT NULL DEFAULT '',
  conflict_of_interest boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_cfp_reviews_scores_object CHECK (jsonb_typeof(scores) = 'object'),
  CONSTRAINT event_cfp_reviews_overall_range CHECK (overall IS NULL OR overall BETWEEN 1 AND 10),
  CONSTRAINT event_cfp_reviews_recommendation_values CHECK (
    recommendation IS NULL OR recommendation IN ('accept', 'maybe', 'reject', 'abstain')
  ),
  CONSTRAINT event_cfp_reviews_comments_len
    CHECK (char_length(comment_private) <= 4000 AND char_length(comment_to_speaker) <= 4000),
  CONSTRAINT event_cfp_reviews_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_cfp_reviews_submission_reviewer_unique UNIQUE (tenant_id, submission_id, reviewer_id),
  CONSTRAINT event_cfp_reviews_submission_fk FOREIGN KEY (tenant_id, event_id, submission_id)
    REFERENCES public.event_cfp_submissions (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_cfp_reviews_reviewer_fk FOREIGN KEY (tenant_id, event_id, reviewer_id)
    REFERENCES public.event_cfp_reviewers (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_cfp_reviews IS
  'Ocena zgloszenia przez recenzenta: oceny kryteriow 1..score_max, ocena ogolna, rekomendacja, komentarz prywatny i sugestia dla prelegenta, konflikt interesow. Nigdy nie trafia do CRM. Zapis wylacznie przez event_cfp_review_save.';

CREATE INDEX IF NOT EXISTS event_cfp_reviews_submission_idx
  ON public.event_cfp_reviews (tenant_id, submission_id);
CREATE INDEX IF NOT EXISTS event_cfp_reviews_reviewer_idx
  ON public.event_cfp_reviews (tenant_id, reviewer_id);

DROP TRIGGER IF EXISTS event_cfp_reviews_touch_updated_at ON public.event_cfp_reviews;
CREATE TRIGGER event_cfp_reviews_touch_updated_at
  BEFORE UPDATE ON public.event_cfp_reviews
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 7) MATERIALY PRELEGENTA (adresy https; wrzut plikow poza ta wersja)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_speaker_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  speaker_profile_id uuid NOT NULL,
  submission_id uuid,
  session_id uuid,
  kind text NOT NULL DEFAULT 'link',
  title_pl text NOT NULL DEFAULT '',
  title_en text NOT NULL DEFAULT '',
  url text NOT NULL,
  visibility text NOT NULL DEFAULT 'organizers',
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_speaker_materials_kind_values
    CHECK (kind IN ('slides', 'document', 'video', 'link')),
  CONSTRAINT event_speaker_materials_visibility_values
    CHECK (visibility IN ('organizers', 'registered', 'public')),
  CONSTRAINT event_speaker_materials_titles_len CHECK (
    char_length(title_pl) <= 200 AND char_length(title_en) <= 200
    AND (char_length(btrim(title_pl)) > 0 OR char_length(btrim(title_en)) > 0)
  ),
  CONSTRAINT event_speaker_materials_url_https
    CHECK (url ~* '^https://[^\s]{3,}$' AND char_length(url) <= 2008),
  CONSTRAINT event_speaker_materials_published_dated
    CHECK (NOT is_published OR published_at IS NOT NULL),
  CONSTRAINT event_speaker_materials_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_speaker_materials_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_speaker_materials_profile_fk FOREIGN KEY (tenant_id, speaker_profile_id)
    REFERENCES public.speaker_profiles (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_speaker_materials_submission_fk FOREIGN KEY (tenant_id, event_id, submission_id)
    REFERENCES public.event_cfp_submissions (tenant_id, event_id, id) ON DELETE SET NULL (submission_id),
  CONSTRAINT event_speaker_materials_session_fk FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE SET NULL (session_id)
);

COMMENT ON TABLE public.event_speaker_materials IS
  'Materialy prelegenta dla wydarzenia (prezentacja, dokument, nagranie, odnosnik) jako adresy https. Prelegent dodaje i zmienia wlasne; publikacje zatwierdza organizator. Zapis wylacznie przez RPC.';

CREATE INDEX IF NOT EXISTS event_speaker_materials_event_idx
  ON public.event_speaker_materials (tenant_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_speaker_materials_profile_idx
  ON public.event_speaker_materials (tenant_id, speaker_profile_id, event_id);

DROP TRIGGER IF EXISTS event_speaker_materials_touch_updated_at ON public.event_speaker_materials;
CREATE TRIGGER event_speaker_materials_touch_updated_at
  BEFORE UPDATE ON public.event_speaker_materials
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 8) GRANTY I RLS: odczyt wylacznie admin/super_admin najemcy, zapis
--    wylacznie przez SECURITY DEFINER (brak polityk zapisu).
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.event_cfp_settings FROM anon, authenticated;
REVOKE ALL ON public.event_cfp_fields FROM anon, authenticated;
REVOKE ALL ON public.event_cfp_submissions FROM anon, authenticated;
REVOKE ALL ON public.event_cfp_submission_speakers FROM anon, authenticated;
REVOKE ALL ON public.event_cfp_reviewers FROM anon, authenticated;
REVOKE ALL ON public.event_cfp_reviews FROM anon, authenticated;
REVOKE ALL ON public.event_speaker_materials FROM anon, authenticated;

GRANT SELECT ON public.event_cfp_settings TO authenticated;
GRANT SELECT ON public.event_cfp_fields TO authenticated;
GRANT SELECT ON public.event_cfp_submissions TO authenticated;
GRANT SELECT ON public.event_cfp_submission_speakers TO authenticated;
GRANT SELECT ON public.event_cfp_reviewers TO authenticated;
GRANT SELECT ON public.event_cfp_reviews TO authenticated;
GRANT SELECT ON public.event_speaker_materials TO authenticated;

GRANT ALL ON public.event_cfp_settings TO service_role;
GRANT ALL ON public.event_cfp_fields TO service_role;
GRANT ALL ON public.event_cfp_submissions TO service_role;
GRANT ALL ON public.event_cfp_submission_speakers TO service_role;
GRANT ALL ON public.event_cfp_reviewers TO service_role;
GRANT ALL ON public.event_cfp_reviews TO service_role;
GRANT ALL ON public.event_speaker_materials TO service_role;

ALTER TABLE public.event_cfp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cfp_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cfp_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cfp_submission_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cfp_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cfp_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_speaker_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_cfp_settings_staff_read" ON public.event_cfp_settings;
CREATE POLICY "event_cfp_settings_staff_read"
  ON public.event_cfp_settings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_cfp_fields_staff_read" ON public.event_cfp_fields;
CREATE POLICY "event_cfp_fields_staff_read"
  ON public.event_cfp_fields FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_cfp_submissions_staff_read" ON public.event_cfp_submissions;
CREATE POLICY "event_cfp_submissions_staff_read"
  ON public.event_cfp_submissions FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_cfp_submission_speakers_staff_read" ON public.event_cfp_submission_speakers;
CREATE POLICY "event_cfp_submission_speakers_staff_read"
  ON public.event_cfp_submission_speakers FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_cfp_reviewers_staff_read" ON public.event_cfp_reviewers;
CREATE POLICY "event_cfp_reviewers_staff_read"
  ON public.event_cfp_reviewers FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_cfp_reviews_staff_read" ON public.event_cfp_reviews;
CREATE POLICY "event_cfp_reviews_staff_read"
  ON public.event_cfp_reviews FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_speaker_materials_staff_read" ON public.event_speaker_materials;
CREATE POLICY "event_speaker_materials_staff_read"
  ON public.event_speaker_materials FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );
-- Zapis: BRAK polityk klienckich - wylacznie przez SECURITY DEFINER ponizej.

-- ----------------------------------------------------------------------------
-- 9) FUNKCJE POMOCNICZE (wewnetrzne: tylko service_role i inne definery)
-- ----------------------------------------------------------------------------

-- Otwarcie naboru: stan `open` I okno czasowe. Zegar jest zegarem BAZY.
CREATE OR REPLACE FUNCTION public._event_cfp_is_open(
  p_status text, p_opens_at timestamptz, p_closes_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_status = 'open', false)
     AND (p_opens_at IS NULL OR now() >= p_opens_at)
     AND (p_closes_at IS NULL OR now() < p_closes_at)
$$;

REVOKE ALL ON FUNCTION public._event_cfp_is_open(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_is_open(text, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public._event_cfp_is_open(text, timestamptz, timestamptz) IS
  'Czy nabor przyjmuje zgloszenia: status open i now() w oknie [opens_at, closes_at). Zegar bazy, nigdy przegladarki.';

-- Faza naboru dla ekranow: none (brak/szkic), scheduled (otwarty, okno
-- jeszcze nie ruszylo), open, closed (zamkniety albo okno minelo).
CREATE OR REPLACE FUNCTION public._event_cfp_phase(
  p_status text, p_opens_at timestamptz, p_closes_at timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_status IS NULL OR p_status = 'draft' THEN 'none'
    WHEN p_status = 'closed' THEN 'closed'
    WHEN p_closes_at IS NOT NULL AND now() >= p_closes_at THEN 'closed'
    WHEN p_opens_at IS NOT NULL AND now() < p_opens_at THEN 'scheduled'
    ELSE 'open'
  END
$$;

REVOKE ALL ON FUNCTION public._event_cfp_phase(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_phase(text, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public._event_cfp_phase(text, timestamptz, timestamptz) IS
  'Faza naboru dla ekranow: none | scheduled | open | closed. Liczona zegarem bazy.';

-- Etykieta stanu zgloszenia w zdaniu osi czasu CRM. Polskie litery jako
-- sekwencje U& - plik migracji jest czystym ASCII.
CREATE OR REPLACE FUNCTION public._event_cfp_status_label(p_status text, p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_lang = 'en' THEN
    CASE p_status
      WHEN 'submitted' THEN 'submitted'
      WHEN 'under_review' THEN 'under review'
      WHEN 'changes_requested' THEN 'changes requested'
      WHEN 'accepted' THEN 'accepted'
      WHEN 'waitlisted' THEN 'waiting list'
      WHEN 'rejected' THEN 'rejected'
      WHEN 'withdrawn' THEN 'withdrawn by the speaker'
      WHEN 'confirmed' THEN 'confirmed by the speaker'
      WHEN 'declined' THEN 'declined by the speaker'
      ELSE p_status
    END
  ELSE
    CASE p_status
      WHEN 'submitted' THEN U&'zg\0142oszone'
      WHEN 'under_review' THEN 'w ocenie'
      WHEN 'changes_requested' THEN U&'pro\015Bba o poprawki'
      WHEN 'accepted' THEN U&'przyj\0119te'
      WHEN 'waitlisted' THEN 'lista rezerwowa'
      WHEN 'rejected' THEN 'odrzucone'
      WHEN 'withdrawn' THEN 'wycofane przez prelegenta'
      WHEN 'confirmed' THEN 'potwierdzone przez prelegenta'
      WHEN 'declined' THEN U&'odwo\0142ane przez prelegenta'
      ELSE p_status
    END
  END
$$;

REVOKE ALL ON FUNCTION public._event_cfp_status_label(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_status_label(text, text) TO service_role;

COMMENT ON FUNCTION public._event_cfp_status_label(text, text) IS
  'Etykieta stanu zgloszenia (pl/en) do zdania osi czasu CRM.';

-- Metadane wpisu osi czasu CRM (kontrakt typu "event": event_id, event_slug,
-- event_title_pl/en, summary_pl/en + identyfikatory naboru). Bez ocen, bez
-- notatek - tylko to, co wolno zobaczyc redaktorowi CRM.
CREATE OR REPLACE FUNCTION public._event_cfp_audit_meta(
  p_tenant uuid, p_submission_id uuid, p_status text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'event_id', e.id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'submission_id', s.id,
    'cfp_status', p_status,
    'summary_pl', CASE WHEN p_status = 'submitted'
      THEN format(U&'Zg\0142oszenie wyst\0105pienia: %s (%s)',
                  COALESCE(NULLIF(btrim(s.title_pl), ''), s.title_en), e.title_pl)
      ELSE format(U&'Nab\00F3r prelegent\00F3w - %s: %s (%s)',
                  public._event_cfp_status_label(p_status, 'pl'),
                  COALESCE(NULLIF(btrim(s.title_pl), ''), s.title_en), e.title_pl)
    END,
    'summary_en', CASE WHEN p_status = 'submitted'
      THEN format('Talk submitted: %s (%s)',
                  COALESCE(NULLIF(btrim(s.title_en), ''), s.title_pl), e.title_en)
      ELSE format('Call for speakers - %s: %s (%s)',
                  public._event_cfp_status_label(p_status, 'en'),
                  COALESCE(NULLIF(btrim(s.title_en), ''), s.title_pl), e.title_en)
    END
  )
  FROM public.event_cfp_submissions s
  JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
  WHERE s.tenant_id = p_tenant AND s.id = p_submission_id
$$;

REVOKE ALL ON FUNCTION public._event_cfp_audit_meta(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_audit_meta(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_cfp_audit_meta(uuid, uuid, text) IS
  'Metadane wpisu osi czasu CRM dla zgloszenia (kontrakt typu event). Bez ocen i notatek.';

-- Zapis stanu zgloszenia do CRM przez most f0. Zglaszajacy: wzbogacenie
-- istniejacego kontaktu (p_create = false) - kontakt zaklada wylacznie
-- wyslanie zgloszenia i przyjecie.
CREATE OR REPLACE FUNCTION public._event_cfp_crm_status(p_tenant uuid, p_submission_id uuid, p_status text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person uuid;
  v_slug text;
BEGIN
  SELECT s.person_id, e.slug INTO v_person, v_slug
    FROM public.event_cfp_submissions s
    JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
   WHERE s.tenant_id = p_tenant AND s.id = p_submission_id;
  IF v_person IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public._event_person_crm_sync(
    p_tenant,
    v_person,
    'event_cfp',
    'event:' || v_slug || ':cfp',
    ARRAY['event:' || v_slug, 'cfp:' || p_status],
    '{}'::jsonb,
    false,
    'event.cfp.' || p_status,
    public._event_cfp_audit_meta(p_tenant, p_submission_id, p_status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_crm_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_crm_status(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_cfp_crm_status(uuid, uuid, text) IS
  'Tag cfp:<status> i wpis osi czasu event.cfp.<status> u zglaszajacego - tylko istniejacy kontakt CRM (p_create = false). Nigdy nie rzuca (most).';

-- Agregaty ocen jednego zgloszenia. Ocena z konfliktem interesow nie liczy sie
-- do sredniej ani do rekomendacji; wynik wazony liczony z BIEZACYCH kryteriow.
CREATE OR REPLACE FUNCTION public._event_cfp_review_summary(p_tenant uuid, p_submission_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH crit AS (
    SELECT COALESCE(cs.review_criteria, '[]'::jsonb) AS criteria
      FROM public.event_cfp_submissions sub
      LEFT JOIN public.event_cfp_settings cs
        ON cs.tenant_id = sub.tenant_id AND cs.event_id = sub.event_id
     WHERE sub.tenant_id = p_tenant AND sub.id = p_submission_id
  ), rv AS (
    SELECT r.overall, r.recommendation, r.conflict_of_interest,
      (SELECT sum((r.scores ->> (c ->> 'key'))::numeric * (c ->> 'weight')::numeric)
              / NULLIF(sum((c ->> 'weight')::numeric), 0)
         FROM crit, jsonb_array_elements(crit.criteria) c
        WHERE jsonb_typeof(r.scores -> (c ->> 'key')) = 'number') AS weighted
      FROM public.event_cfp_reviews r
     WHERE r.tenant_id = p_tenant AND r.submission_id = p_submission_id
  )
  SELECT jsonb_build_object(
    'reviews_count', count(*) FILTER (WHERE NOT rv.conflict_of_interest AND rv.overall IS NOT NULL),
    'reviews_total', count(*),
    'conflicts_count', count(*) FILTER (WHERE rv.conflict_of_interest),
    'overall_avg', round(avg(rv.overall) FILTER (WHERE NOT rv.conflict_of_interest), 2),
    'weighted_avg', round(avg(rv.weighted) FILTER (WHERE NOT rv.conflict_of_interest), 2),
    'recommendations', jsonb_build_object(
      'accept', count(*) FILTER (WHERE rv.recommendation = 'accept' AND NOT rv.conflict_of_interest),
      'maybe', count(*) FILTER (WHERE rv.recommendation = 'maybe' AND NOT rv.conflict_of_interest),
      'reject', count(*) FILTER (WHERE rv.recommendation = 'reject' AND NOT rv.conflict_of_interest),
      'abstain', count(*) FILTER (WHERE rv.recommendation = 'abstain' AND NOT rv.conflict_of_interest)
    )
  )
  FROM rv
$$;

REVOKE ALL ON FUNCTION public._event_cfp_review_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_review_summary(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_review_summary(uuid, uuid) IS
  'Agregaty ocen zgloszenia: liczba ocen, srednia ogolna, srednia wazona kryteriow, rekomendacje. Oceny z konfliktem interesow poza srednimi.';

-- Odpowiedzi na pytania: zostaja tylko klucze AKTYWNYCH pytan, wartosc
-- w ksztalcie typu pytania (tekst, liczba, adres https, wybor z opcji, tak/nie).
-- Pusta odpowiedz = brak klucza. Zly ksztalt = `invalid_answers: <klucz>`.
CREATE OR REPLACE FUNCTION public._event_cfp_clean_answers(
  p_tenant uuid, p_event_id uuid, p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_field record;
  v_value jsonb;
  v_kind text;
  v_text text;
  v_values text[];
  v_allowed text[];
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) = 'null' THEN
    RETURN v_out;
  END IF;
  IF jsonb_typeof(p_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;
  IF length(p_answers::text) > 60000 THEN
    RAISE EXCEPTION 'invalid_answers: answers are too long';
  END IF;

  FOR v_field IN
    SELECT f.key, f.field_type, f.options
      FROM public.event_cfp_fields f
     WHERE f.tenant_id = p_tenant AND f.event_id = p_event_id AND f.is_active
  LOOP
    v_value := p_answers -> v_field.key;
    v_kind := COALESCE(jsonb_typeof(v_value), 'null');
    CONTINUE WHEN v_kind = 'null';
    SELECT COALESCE(array_agg(o ->> 'value'), ARRAY[]::text[]) INTO v_allowed
      FROM jsonb_array_elements(v_field.options) o;

    IF v_field.field_type = 'multiselect' THEN
      IF v_kind <> 'array' THEN
        RAISE EXCEPTION 'invalid_answers: % expects a list', v_field.key;
      END IF;
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_values
        FROM jsonb_array_elements_text(v_value) x
       WHERE btrim(x) <> '';
      IF NOT (v_values <@ v_allowed) THEN
        RAISE EXCEPTION 'invalid_answers: % has an unknown option', v_field.key;
      END IF;
      IF cardinality(v_values) > 0 THEN
        v_out := v_out || jsonb_build_object(v_field.key, to_jsonb(v_values));
      END IF;
    ELSIF v_field.field_type = 'checkbox' THEN
      IF v_kind = 'boolean' THEN
        v_out := v_out || jsonb_build_object(v_field.key, v_value);
      ELSIF v_kind = 'string' AND lower(btrim(v_value #>> '{}')) IN ('true', 'false') THEN
        v_out := v_out || jsonb_build_object(v_field.key, lower(btrim(v_value #>> '{}'))::boolean);
      ELSIF NOT (v_kind = 'string' AND btrim(v_value #>> '{}') = '') THEN
        RAISE EXCEPTION 'invalid_answers: % expects yes or no', v_field.key;
      END IF;
    ELSE
      IF v_kind NOT IN ('string', 'number') THEN
        RAISE EXCEPTION 'invalid_answers: % expects text', v_field.key;
      END IF;
      v_text := btrim(v_value #>> '{}');
      CONTINUE WHEN v_text = '';
      IF v_field.field_type = 'number' THEN
        IF v_text !~ '^-?[0-9]{1,12}([.][0-9]{1,6})?$' THEN
          RAISE EXCEPTION 'invalid_answers: % expects a number', v_field.key;
        END IF;
        v_out := v_out || jsonb_build_object(v_field.key, v_text::numeric);
      ELSIF v_field.field_type = 'url' THEN
        IF v_text !~* '^https://[^\s]{3,}$' OR char_length(v_text) > 2008 THEN
          RAISE EXCEPTION 'invalid_answers: % expects an https address', v_field.key;
        END IF;
        v_out := v_out || jsonb_build_object(v_field.key, v_text);
      ELSIF v_field.field_type = 'select' THEN
        IF NOT (v_text = ANY (v_allowed)) THEN
          RAISE EXCEPTION 'invalid_answers: % has an unknown option', v_field.key;
        END IF;
        v_out := v_out || jsonb_build_object(v_field.key, v_text);
      ELSE
        IF char_length(v_text) > (CASE WHEN v_field.field_type = 'textarea' THEN 4000 ELSE 500 END) THEN
          RAISE EXCEPTION 'invalid_answers: % is too long', v_field.key;
        END IF;
        v_out := v_out || jsonb_build_object(v_field.key, v_text);
      END IF;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_clean_answers(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_clean_answers(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public._event_cfp_clean_answers(uuid, uuid, jsonb) IS
  'Odpowiedzi zgloszenia przyciete do aktywnych pytan i sprawdzone wzgledem typu pytania. Blad: invalid_answers.';

-- Osoba zglaszajacego (wzorzec `event_register`): po koncie, potem po adresie
-- KONTA, inaczej nowa kartoteka. Adres z formularza nie decyduje o tozsamosci.
CREATE OR REPLACE FUNCTION public._event_cfp_resolve_person(
  p_tenant uuid, p_uid uuid, p_speaker jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person uuid;
  v_owner uuid;
  v_email text;
  v_speaker jsonb := CASE WHEN jsonb_typeof(p_speaker) = 'object' THEN p_speaker ELSE '{}'::jsonb END;
  v_first text := NULLIF(btrim(COALESCE(v_speaker->>'first_name', '')), '');
  v_last text := NULLIF(btrim(COALESCE(v_speaker->>'last_name', '')), '');
  v_job text := NULLIF(btrim(COALESCE(v_speaker->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(v_speaker->>'company_text', '')), '');
  v_marketing boolean := COALESCE(v_speaker->'consent_marketing' = 'true'::jsonb, false);
BEGIN
  IF (v_first IS NOT NULL AND char_length(v_first) > 80)
     OR (v_last IS NOT NULL AND char_length(v_last) > 80)
     OR (v_job IS NOT NULL AND char_length(v_job) > 160)
     OR (v_company IS NOT NULL AND char_length(v_company) > 200) THEN
    RAISE EXCEPTION 'invalid_speaker: speaker details are too long';
  END IF;

  SELECT p.id INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.user_id = p_uid;

  IF v_person IS NULL THEN
    SELECT NULLIF(lower(btrim(u.email)), '') INTO v_email FROM auth.users u WHERE u.id = p_uid;
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'email_required: the account has no e-mail address';
    END IF;
    SELECT p.id, p.user_id INTO v_person, v_owner
      FROM public.event_people p
     WHERE p.tenant_id = p_tenant AND p.email_norm = v_email;
    IF v_person IS NOT NULL AND v_owner IS NOT NULL AND v_owner <> p_uid THEN
      RAISE EXCEPTION 'email_in_use: this e-mail belongs to another account';
    END IF;
  END IF;

  IF v_person IS NULL THEN
    IF v_first IS NULL OR v_last IS NULL THEN
      RAISE EXCEPTION 'invalid_name: first name and last name are required';
    END IF;
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, job_title, company_text,
      source, consent_data_processing_at, consent_marketing_at, created_by
    ) VALUES (
      p_tenant, p_uid, v_email, v_first, v_last, v_job, v_company,
      'self_registration', now(), CASE WHEN v_marketing THEN now() END, p_uid
    )
    RETURNING id INTO v_person;
  ELSE
    UPDATE public.event_people p SET
      user_id = COALESCE(p.user_id, p_uid),
      first_name = COALESCE(v_first, p.first_name),
      last_name = COALESCE(v_last, p.last_name),
      job_title = CASE WHEN v_speaker ? 'job_title' THEN v_job ELSE p.job_title END,
      company_text = CASE WHEN v_speaker ? 'company_text' THEN v_company ELSE p.company_text END,
      consent_data_processing_at = COALESCE(p.consent_data_processing_at, now()),
      consent_marketing_at = CASE
        WHEN v_marketing THEN COALESCE(p.consent_marketing_at, now())
        ELSE p.consent_marketing_at
      END,
      consent_withdrawn_at = CASE WHEN v_marketing THEN NULL ELSE p.consent_withdrawn_at END
    WHERE p.tenant_id = p_tenant AND p.id = v_person;
  END IF;

  RETURN v_person;
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) IS
  'Kartoteka zglaszajacego: po event_people.user_id, potem po adresie konta (auth.users.email), inaczej nowa osoba self_registration. Zgoda marketingowa tylko z jawnego zaznaczenia.';

-- Nakladka sceniczna osoby: nakladka KONTA, jesli osoba ma konto i taka
-- nakladka juz istnieje (ta sama osoba nie dostaje drugiej karty), inaczej
-- nakladka osoby (tryb `admin_event_speaker_upsert` bez konta).
CREATE OR REPLACE FUNCTION public._event_speaker_overlay_for_person(p_tenant uuid, p_person_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_profile uuid;
BEGIN
  SELECT p.user_id INTO v_user
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person_id;

  IF v_user IS NOT NULL THEN
    SELECT sp.id INTO v_profile
      FROM public.speaker_profiles sp
     WHERE sp.tenant_id = p_tenant AND sp.user_id = v_user;
    IF v_profile IS NOT NULL THEN
      RETURN v_profile;
    END IF;
  END IF;

  INSERT INTO public.speaker_profiles AS sp (tenant_id, person_id)
  VALUES (p_tenant, p_person_id)
  ON CONFLICT (tenant_id, person_id) WHERE person_id IS NOT NULL DO UPDATE
    SET updated_at = now()
  RETURNING sp.id INTO v_profile;
  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public._event_speaker_overlay_for_person(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_speaker_overlay_for_person(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_speaker_overlay_for_person(uuid, uuid) IS
  'Nakladka sceniczna osoby: istniejaca nakladka konta osoby albo nakladka osoby (speaker_profiles.person_id).';

-- Dopisanie nakladki do rejestru prelegentow wydarzenia (na koniec listy).
-- Wspolny ogon `admin_event_speaker_upsert` i przyjecia zgloszenia.
CREATE OR REPLACE FUNCTION public._event_speaker_roster_add(
  p_tenant uuid, p_event_id uuid, p_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort integer;
  v_entry uuid;
BEGIN
  SELECT COALESCE(MAX(en.sort_order) + 1, 0) INTO v_sort
    FROM public.event_speaker_entries en
   WHERE en.tenant_id = p_tenant AND en.event_id = p_event_id;

  INSERT INTO public.event_speaker_entries AS en (
    tenant_id, event_id, speaker_profile_id, sort_order
  ) VALUES (p_tenant, p_event_id, p_profile_id, v_sort)
  ON CONFLICT (tenant_id, event_id, speaker_profile_id) DO UPDATE
    SET updated_at = now()
  RETURNING en.id INTO v_entry;
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public._event_speaker_roster_add(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_speaker_roster_add(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_speaker_roster_add(uuid, uuid, uuid) IS
  'Wpis nakladki do rejestru prelegentow wydarzenia (event_speaker_entries) na koncu listy; powtorzenie nie dubluje wpisu.';

-- Ten sam kontrakt, co w 20260924140000; ogon (dopisanie do rejestru) idzie
-- przez wspolny `_event_speaker_roster_add`.
CREATE OR REPLACE FUNCTION public.admin_event_speaker_upsert(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant     uuid := public.assert_event_admin_tenant();
  v_uid        uuid := auth.uid();
  v_event_id   uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_user_id    uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_person_id  uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_group_id   uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_email      text := NULLIF(btrim(p_payload->>'email'), '');
  v_first      text := NULLIF(btrim(p_payload->>'first_name'), '');
  v_last       text := NULLIF(btrim(p_payload->>'last_name'), '');
  v_profile_id uuid;
  v_entry_id   uuid;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: event_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles pr
       WHERE pr.id = v_user_id AND pr.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'event_speakers: profile not found in tenant' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, user_id)
    VALUES (v_tenant, v_user_id)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;
  ELSE
    IF v_person_id IS NULL THEN
      IF v_first IS NULL OR v_last IS NULL THEN
        RAISE EXCEPTION 'event_speakers: first_name and last_name are required'
          USING ERRCODE = '22023';
      END IF;

      IF v_email IS NOT NULL THEN
        SELECT pe.id INTO v_person_id
          FROM public.event_people pe
         WHERE pe.tenant_id = v_tenant
           AND pe.email_norm = lower(btrim(v_email));
      END IF;
    END IF;

    IF v_person_id IS NULL THEN
      INSERT INTO public.event_people (
        tenant_id, email, first_name, last_name, phone, job_title,
        company_text, social_profile_url, photo_url, bio_pl, bio_en,
        source, consent_data_processing_at, created_by
      ) VALUES (
        v_tenant, v_email, v_first, v_last,
        NULLIF(btrim(p_payload->>'phone'), ''),
        NULLIF(btrim(p_payload->>'job_title'), ''),
        NULLIF(btrim(p_payload->>'company_text'), ''),
        NULLIF(btrim(p_payload->>'social_profile_url'), ''),
        NULLIF(btrim(p_payload->>'photo_url'), ''),
        NULLIF(btrim(p_payload->>'bio_pl'), ''),
        NULLIF(btrim(p_payload->>'bio_en'), ''),
        'organizer', now(), v_uid
      )
      RETURNING id INTO v_person_id;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.event_people pe
         WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant
      ) THEN
        RAISE EXCEPTION 'event_speakers: person not found in tenant' USING ERRCODE = '42501';
      END IF;

      UPDATE public.event_people pe SET
        first_name         = COALESCE(v_first, pe.first_name),
        last_name          = COALESCE(v_last, pe.last_name),
        email              = COALESCE(v_email, pe.email),
        phone              = COALESCE(NULLIF(btrim(p_payload->>'phone'), ''), pe.phone),
        job_title          = COALESCE(NULLIF(btrim(p_payload->>'job_title'), ''), pe.job_title),
        company_text       = COALESCE(NULLIF(btrim(p_payload->>'company_text'), ''), pe.company_text),
        social_profile_url = COALESCE(NULLIF(btrim(p_payload->>'social_profile_url'), ''), pe.social_profile_url),
        photo_url          = COALESCE(NULLIF(btrim(p_payload->>'photo_url'), ''), pe.photo_url),
        bio_pl             = COALESCE(NULLIF(btrim(p_payload->>'bio_pl'), ''), pe.bio_pl),
        bio_en             = COALESCE(NULLIF(btrim(p_payload->>'bio_en'), ''), pe.bio_en),
        consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now())
      WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant;
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, person_id)
    VALUES (v_tenant, v_person_id)
    ON CONFLICT (tenant_id, person_id) WHERE person_id IS NOT NULL DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;

    IF v_group_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.event_groups g
         WHERE g.id = v_group_id AND g.tenant_id = v_tenant AND g.event_id = v_event_id
      ) THEN
        RAISE EXCEPTION 'event_speakers: group not found in event' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.event_group_members (tenant_id, event_id, group_id, person_id, added_by)
      VALUES (v_tenant, v_event_id, v_group_id, v_person_id, v_uid)
      ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
    END IF;
  END IF;

  UPDATE public.speaker_profiles sp SET
    headline_pl = COALESCE(NULLIF(btrim(p_payload->>'headline_pl'), ''), sp.headline_pl),
    headline_en = COALESCE(NULLIF(btrim(p_payload->>'headline_en'), ''), sp.headline_en),
    topics_pl   = CASE WHEN p_payload ? 'topics_pl'
                       THEN public._event_speaker_text_array(p_payload->'topics_pl')
                       ELSE sp.topics_pl END,
    topics_en   = CASE WHEN p_payload ? 'topics_en'
                       THEN public._event_speaker_text_array(p_payload->'topics_en')
                       ELSE sp.topics_en END,
    languages   = CASE WHEN p_payload ? 'languages'
                       THEN public._event_speaker_text_array(p_payload->'languages')
                       ELSE sp.languages END,
    is_public   = COALESCE((p_payload->>'is_public')::boolean, sp.is_public),
    card_photo_url    = CASE WHEN p_payload ? 'card_photo_url'
                             THEN NULLIF(btrim(p_payload->>'card_photo_url'), '')
                             ELSE sp.card_photo_url END,
    card_cta_label_pl = CASE WHEN p_payload ? 'card_cta_label_pl'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_pl'), '')
                             ELSE sp.card_cta_label_pl END,
    card_cta_label_en = CASE WHEN p_payload ? 'card_cta_label_en'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_en'), '')
                             ELSE sp.card_cta_label_en END,
    card_cta_url      = CASE WHEN p_payload ? 'card_cta_url'
                             THEN NULLIF(btrim(p_payload->>'card_cta_url'), '')
                             ELSE sp.card_cta_url END,
    card_cta_color    = CASE WHEN p_payload ? 'card_cta_color'
                             THEN lower(NULLIF(btrim(p_payload->>'card_cta_color'), ''))
                             ELSE sp.card_cta_color END
  WHERE sp.id = v_profile_id AND sp.tenant_id = v_tenant;

  v_entry_id := public._event_speaker_roster_add(v_tenant, v_event_id, v_profile_id);

  RETURN jsonb_build_object(
    'entry_id', v_entry_id,
    'speaker_profile_id', v_profile_id,
    'person_id', v_person_id,
    'user_id', v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_upsert(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speaker_upsert(jsonb) IS
  'Zaklada prelegenta i podpina go do wydarzenia w JEDNYM zapisie. Tryb osoby (bez user_id): dopasowanie/zalozenie event_people po email_norm + nakladka speaker_profiles(person_id) + wpis event_speaker_entries (_event_speaker_roster_add). Tryb konta (user_id): nakladka speaker_profiles(user_id) + wpis. Pola karty (card_*) po obecnosci klucza. Zgody: wylacznie consent_data_processing_at, source=organizer. Bramka: assert_event_admin_tenant().';

-- Liczba calkowita z jsonb (liczba albo napis z cyframi); cokolwiek innego = NULL.
CREATE OR REPLACE FUNCTION public._event_cfp_jsonb_int(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_value) IN ('number', 'string')
         AND btrim(p_value #>> '{}') ~ '^-?[0-9]{1,9}$'
      THEN btrim(p_value #>> '{}')::integer
  END
$$;

REVOKE ALL ON FUNCTION public._event_cfp_jsonb_int(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_jsonb_int(jsonb) TO service_role;

COMMENT ON FUNCTION public._event_cfp_jsonb_int(jsonb) IS
  'Liczba calkowita z wartosci jsonb (liczba albo napis z cyframi), inaczej NULL.';

-- Stan ustawien naboru dla panelu: wiersz albo wartosci domyslne (bez zapisu)
-- oraz listy wyboru (sciezki, sale, grupy, bilety) - ekran ustawien i okno
-- przyjecia nie potrzebuja czterech osobnych zapytan.
CREATE OR REPLACE FUNCTION public._event_cfp_settings_payload(p_tenant uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'event_id', e.id,
    'event_slug', e.slug,
    'event_status', e.status,
    'event_timezone', e.timezone,
    'exists', s.id IS NOT NULL,
    'status', COALESCE(s.status, 'draft'),
    'phase', public._event_cfp_phase(s.status, s.opens_at, s.closes_at),
    'is_open', e.status = 'published' AND public._event_cfp_is_open(s.status, s.opens_at, s.closes_at),
    'opens_at', s.opens_at,
    'closes_at', s.closes_at,
    'intro_pl', COALESCE(s.intro_pl, ''),
    'intro_en', COALESCE(s.intro_en, ''),
    'guidelines_pl', COALESCE(s.guidelines_pl, ''),
    'guidelines_en', COALESCE(s.guidelines_en, ''),
    'formats', COALESCE(s.formats, '[]'::jsonb),
    'track_ids', to_jsonb(COALESCE(s.track_ids, '{}'::uuid[])),
    'max_per_submitter', COALESCE(s.max_per_submitter, 3),
    'allow_co_speakers', COALESCE(s.allow_co_speakers, true),
    'review_blind', COALESCE(s.review_blind, false),
    'score_max', COALESCE(s.score_max, 5),
    'review_criteria', COALESCE(s.review_criteria, '[]'::jsonb),
    'min_reviews', COALESCE(s.min_reviews, 2),
    'speaker_group_id', CASE WHEN s.id IS NULL THEN (
        SELECT g.id FROM public.event_groups g
         WHERE g.tenant_id = e.tenant_id AND g.event_id = e.id AND g.key = 'speakers'
      ) ELSE s.speaker_group_id END,
    'speaker_ticket_type_id', s.speaker_ticket_type_id,
    'updated_at', s.updated_at,
    'options', jsonb_build_object(
      'tracks', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', t.id, 'key', t.key, 'name_pl', t.name_pl, 'name_en', t.name_en,
          'is_active', t.is_active) ORDER BY t.sort_order, t.key), '[]'::jsonb)
          FROM public.event_tracks t
         WHERE t.tenant_id = e.tenant_id AND t.event_id = e.id
      ),
      'rooms', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'capacity', r.capacity,
          'is_active', r.is_active) ORDER BY r.sort_order, r.name), '[]'::jsonb)
          FROM public.event_rooms r
         WHERE r.tenant_id = e.tenant_id AND r.event_id = e.id
      ),
      'groups', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', g.id, 'key', g.key, 'name_pl', g.name_pl, 'name_en', g.name_en)
          ORDER BY g.sort_order, g.key), '[]'::jsonb)
          FROM public.event_groups g
         WHERE g.tenant_id = e.tenant_id AND g.event_id = e.id
      ),
      'tickets', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', tt.id, 'key', tt.key, 'name_pl', tt.name_pl, 'name_en', tt.name_en,
          'is_active', tt.is_active) ORDER BY tt.sort_order, tt.key), '[]'::jsonb)
          FROM public.event_ticket_types tt
         WHERE tt.tenant_id = e.tenant_id AND tt.event_id = e.id
      )
    )
  )
  FROM public.events e
  LEFT JOIN public.event_cfp_settings s ON s.tenant_id = e.tenant_id AND s.event_id = e.id
  WHERE e.tenant_id = p_tenant AND e.id = p_event_id
$$;

REVOKE ALL ON FUNCTION public._event_cfp_settings_payload(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_settings_payload(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_settings_payload(uuid, uuid) IS
  'Ustawienia naboru (albo wartosci domyslne bez zapisu) z faza i listami wyboru dla panelu.';

-- ----------------------------------------------------------------------------
-- 10) PANEL: USTAWIENIA NABORU
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_settings_get(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  RETURN public._event_cfp_settings_payload(v_tenant, p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_settings_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_settings_get(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_settings_get(uuid) IS
  'Ustawienia naboru prelegentow wydarzenia (albo wartosci domyslne) z listami wyboru. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_settings_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_row public.event_cfp_settings%ROWTYPE;
  v_status text;
  v_opens timestamptz;
  v_closes timestamptz;
  v_formats jsonb;
  v_criteria jsonb;
  v_tracks uuid[];
  v_limit integer;
  v_score_max integer;
  v_min_reviews integer;
  v_group uuid;
  v_ticket uuid;
  v_item jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_key text;
  v_label_pl text;
  v_label_en text;
  v_number integer;
  v_top_score integer;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_cfp_settings (tenant_id, event_id, speaker_group_id, updated_by)
  VALUES (
    v_tenant, v_event_id,
    (SELECT g.id FROM public.event_groups g
      WHERE g.tenant_id = v_tenant AND g.event_id = v_event_id AND g.key = 'speakers'),
    auth.uid()
  )
  ON CONFLICT (tenant_id, event_id) DO NOTHING;

  SELECT s.* INTO v_row
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id
   FOR UPDATE;

  v_status := CASE WHEN p_payload ? 'status' THEN p_payload->>'status' ELSE v_row.status END;
  IF v_status IS NULL OR v_status NOT IN ('draft', 'open', 'closed') THEN
    RAISE EXCEPTION 'invalid_status: status must be draft, open or closed';
  END IF;

  BEGIN
    v_opens := CASE WHEN p_payload ? 'opens_at'
      THEN NULLIF(btrim(COALESCE(p_payload->>'opens_at', '')), '')::timestamptz ELSE v_row.opens_at END;
    v_closes := CASE WHEN p_payload ? 'closes_at'
      THEN NULLIF(btrim(COALESCE(p_payload->>'closes_at', '')), '')::timestamptz ELSE v_row.closes_at END;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_window: dates are not valid timestamps';
  END;
  IF v_opens IS NOT NULL AND v_closes IS NOT NULL AND v_closes <= v_opens THEN
    RAISE EXCEPTION 'invalid_window: closes_at must be after opens_at';
  END IF;

  IF char_length(COALESCE(p_payload->>'intro_pl', '')) > 8000
     OR char_length(COALESCE(p_payload->>'intro_en', '')) > 8000
     OR char_length(COALESCE(p_payload->>'guidelines_pl', '')) > 8000
     OR char_length(COALESCE(p_payload->>'guidelines_en', '')) > 8000 THEN
    RAISE EXCEPTION 'invalid_texts: texts are limited to 8000 characters';
  END IF;

  IF p_payload ? 'formats' THEN
    IF jsonb_typeof(p_payload->'formats') IS DISTINCT FROM 'array'
       OR jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'formats') = 'array'
                                  THEN p_payload->'formats' ELSE '[]'::jsonb END) > 20 THEN
      RAISE EXCEPTION 'invalid_formats: formats must be a list of at most 20 items';
    END IF;
    v_formats := '[]'::jsonb;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'formats') LOOP
      v_key := btrim(COALESCE(v_item->>'key', ''));
      v_label_pl := btrim(COALESCE(v_item->>'label_pl', ''));
      v_label_en := btrim(COALESCE(v_item->>'label_en', ''));
      v_number := public._event_cfp_jsonb_int(v_item->'duration_min');
      IF jsonb_typeof(v_item) <> 'object'
         OR v_key !~ '^[a-z][a-z0-9_]{1,48}$'
         OR v_key = ANY (v_keys)
         OR char_length(v_label_pl) NOT BETWEEN 1 AND 80
         OR char_length(v_label_en) NOT BETWEEN 1 AND 80
         OR v_number IS NULL OR v_number NOT BETWEEN 5 AND 480 THEN
        RAISE EXCEPTION 'invalid_formats: each format needs a unique key, both labels and 5-480 minutes';
      END IF;
      v_keys := v_keys || v_key;
      v_formats := v_formats || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'label_pl', v_label_pl, 'label_en', v_label_en, 'duration_min', v_number));
    END LOOP;
  ELSE
    v_formats := v_row.formats;
  END IF;

  IF p_payload ? 'review_criteria' THEN
    IF jsonb_typeof(p_payload->'review_criteria') IS DISTINCT FROM 'array'
       OR jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'review_criteria') = 'array'
                                  THEN p_payload->'review_criteria' ELSE '[]'::jsonb END) > 10 THEN
      RAISE EXCEPTION 'invalid_criteria: criteria must be a list of at most 10 items';
    END IF;
    v_criteria := '[]'::jsonb;
    v_keys := ARRAY[]::text[];
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'review_criteria') LOOP
      v_key := btrim(COALESCE(v_item->>'key', ''));
      v_label_pl := btrim(COALESCE(v_item->>'label_pl', ''));
      v_label_en := btrim(COALESCE(v_item->>'label_en', ''));
      v_number := public._event_cfp_jsonb_int(v_item->'weight');
      IF jsonb_typeof(v_item) <> 'object'
         OR v_key !~ '^[a-z][a-z0-9_]{1,48}$'
         OR v_key = ANY (v_keys)
         OR char_length(v_label_pl) NOT BETWEEN 1 AND 80
         OR char_length(v_label_en) NOT BETWEEN 1 AND 80
         OR v_number IS NULL OR v_number NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'invalid_criteria: each criterion needs a unique key, both labels and a weight 1-10';
      END IF;
      v_keys := v_keys || v_key;
      v_criteria := v_criteria || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'label_pl', v_label_pl, 'label_en', v_label_en, 'weight', v_number));
    END LOOP;
  ELSE
    v_criteria := v_row.review_criteria;
  END IF;

  IF p_payload ? 'track_ids' THEN
    IF jsonb_typeof(p_payload->'track_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_tracks: track_ids must be a list';
    END IF;
    BEGIN
      SELECT COALESCE(array_agg(DISTINCT x::uuid), ARRAY[]::uuid[]) INTO v_tracks
        FROM jsonb_array_elements_text(p_payload->'track_ids') x;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_tracks: track_ids must be identifiers';
    END;
    IF EXISTS (
      SELECT 1 FROM unnest(v_tracks) tid
       WHERE NOT EXISTS (
         SELECT 1 FROM public.event_tracks t
          WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.id = tid
       )
    ) THEN
      RAISE EXCEPTION 'invalid_tracks: every track must belong to this event';
    END IF;
  ELSE
    v_tracks := v_row.track_ids;
  END IF;

  v_limit := CASE WHEN p_payload ? 'max_per_submitter'
    THEN public._event_cfp_jsonb_int(p_payload->'max_per_submitter') ELSE v_row.max_per_submitter END;
  IF v_limit IS NULL OR v_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_limit: max_per_submitter must be 1-20';
  END IF;

  v_score_max := CASE WHEN p_payload ? 'score_max'
    THEN public._event_cfp_jsonb_int(p_payload->'score_max') ELSE v_row.score_max END;
  IF v_score_max IS NULL OR v_score_max NOT BETWEEN 3 AND 10 THEN
    RAISE EXCEPTION 'invalid_score_max: score_max must be 3-10';
  END IF;
  SELECT max(GREATEST(
           COALESCE(r.overall, 0),
           COALESCE((SELECT max((v.value #>> '{}')::numeric)::integer
                       FROM jsonb_each(r.scores) v
                      WHERE jsonb_typeof(v.value) = 'number'), 0)))
    INTO v_top_score
    FROM public.event_cfp_reviews r
   WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id;
  IF COALESCE(v_top_score, 0) > v_score_max THEN
    RAISE EXCEPTION 'score_max_below_reviews: existing reviews use scores up to %', v_top_score;
  END IF;

  v_min_reviews := CASE WHEN p_payload ? 'min_reviews'
    THEN public._event_cfp_jsonb_int(p_payload->'min_reviews') ELSE v_row.min_reviews END;
  IF v_min_reviews IS NULL OR v_min_reviews NOT BETWEEN 0 AND 20 THEN
    RAISE EXCEPTION 'invalid_min_reviews: min_reviews must be 0-20';
  END IF;

  IF p_payload ? 'speaker_group_id' THEN
    v_group := NULLIF(p_payload->>'speaker_group_id', '')::uuid;
    IF v_group IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_groups g
       WHERE g.tenant_id = v_tenant AND g.event_id = v_event_id AND g.id = v_group
    ) THEN
      RAISE EXCEPTION 'invalid_group: the group does not belong to this event';
    END IF;
  ELSE
    v_group := v_row.speaker_group_id;
  END IF;

  IF p_payload ? 'speaker_ticket_type_id' THEN
    v_ticket := NULLIF(p_payload->>'speaker_ticket_type_id', '')::uuid;
    IF v_ticket IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_ticket_types t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.id = v_ticket
    ) THEN
      RAISE EXCEPTION 'invalid_ticket: the ticket does not belong to this event';
    END IF;
  ELSE
    v_ticket := v_row.speaker_ticket_type_id;
  END IF;

  UPDATE public.event_cfp_settings s SET
    status = v_status,
    opens_at = v_opens,
    closes_at = v_closes,
    intro_pl = CASE WHEN p_payload ? 'intro_pl' THEN COALESCE(p_payload->>'intro_pl', '') ELSE s.intro_pl END,
    intro_en = CASE WHEN p_payload ? 'intro_en' THEN COALESCE(p_payload->>'intro_en', '') ELSE s.intro_en END,
    guidelines_pl = CASE WHEN p_payload ? 'guidelines_pl'
      THEN COALESCE(p_payload->>'guidelines_pl', '') ELSE s.guidelines_pl END,
    guidelines_en = CASE WHEN p_payload ? 'guidelines_en'
      THEN COALESCE(p_payload->>'guidelines_en', '') ELSE s.guidelines_en END,
    formats = v_formats,
    track_ids = v_tracks,
    max_per_submitter = v_limit,
    allow_co_speakers = CASE WHEN jsonb_typeof(p_payload->'allow_co_speakers') = 'boolean'
      THEN (p_payload->>'allow_co_speakers')::boolean ELSE s.allow_co_speakers END,
    review_blind = CASE WHEN jsonb_typeof(p_payload->'review_blind') = 'boolean'
      THEN (p_payload->>'review_blind')::boolean ELSE s.review_blind END,
    score_max = v_score_max,
    review_criteria = v_criteria,
    min_reviews = v_min_reviews,
    speaker_group_id = v_group,
    speaker_ticket_type_id = v_ticket,
    updated_by = auth.uid()
  WHERE s.tenant_id = v_tenant AND s.id = v_row.id;

  RETURN public._event_cfp_settings_payload(v_tenant, v_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_settings_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_settings_save(jsonb) IS
  'Zapis ustawien naboru prelegentow (PATCH po obecnosci klucza). Waliduje okno, formaty, kryteria, sciezki, limity, grupe i bilet. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 11) PANEL: PYTANIA FORMULARZA ZGLOSZENIA
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_fields_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  key text,
  field_type text,
  label_pl text,
  label_en text,
  help_pl text,
  help_en text,
  is_required boolean,
  options jsonb,
  sort_order integer,
  is_active boolean,
  answers_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  RETURN QUERY
  SELECT f.id, f.key, f.field_type, f.label_pl, f.label_en, f.help_pl, f.help_en,
         f.is_required, f.options, f.sort_order, f.is_active,
         (SELECT count(*)::integer FROM public.event_cfp_submissions s
           WHERE s.tenant_id = f.tenant_id AND s.event_id = f.event_id AND s.answers ? f.key)
    FROM public.event_cfp_fields f
   WHERE f.tenant_id = v_tenant AND f.event_id = p_event_id
   ORDER BY f.sort_order, f.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_fields_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_fields_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_fields_list(uuid) IS
  'Pytania formularza zgloszenia z liczba zgloszen, ktore na nie odpowiedzialy. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_field_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_cfp_fields%ROWTYPE;
  v_event_id uuid;
  v_key text;
  v_type text;
  v_label_pl text;
  v_label_en text;
  v_help_pl text;
  v_help_en text;
  v_options jsonb := '[]'::jsonb;
  v_option jsonb;
  v_values text[] := ARRAY[]::text[];
  v_value text;
  v_sort integer;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT f.* INTO v_row
      FROM public.event_cfp_fields f
     WHERE f.tenant_id = v_tenant AND f.id = v_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: question does not exist in this tenant';
    END IF;
    v_event_id := v_row.event_id;
    IF p_payload ? 'key' AND btrim(COALESCE(p_payload->>'key', '')) <> v_row.key THEN
      RAISE EXCEPTION 'key_immutable: the key of an existing question cannot change';
    END IF;
    v_key := v_row.key;
  ELSE
    v_event_id := NULLIF(p_payload->>'event_id', '')::uuid;
    IF v_event_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;
    v_key := btrim(COALESCE(p_payload->>'key', ''));
    IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
      RAISE EXCEPTION 'invalid_key: key must be 2-49 lowercase letters, digits or underscores';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id AND f.key = v_key
    ) THEN
      RAISE EXCEPTION 'key_taken: another question already uses this key';
    END IF;
  END IF;

  v_type := CASE WHEN p_payload ? 'field_type' THEN p_payload->>'field_type' ELSE v_row.field_type END;
  IF v_type IS NULL OR v_type NOT IN ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'url', 'number') THEN
    RAISE EXCEPTION 'invalid_field_type: unknown question type';
  END IF;

  v_label_pl := CASE WHEN p_payload ? 'label_pl' THEN btrim(COALESCE(p_payload->>'label_pl', '')) ELSE v_row.label_pl END;
  v_label_en := CASE WHEN p_payload ? 'label_en' THEN btrim(COALESCE(p_payload->>'label_en', '')) ELSE v_row.label_en END;
  IF char_length(COALESCE(v_label_pl, '')) NOT BETWEEN 1 AND 200
     OR char_length(COALESCE(v_label_en, '')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_labels: both labels are required (up to 200 characters)';
  END IF;

  v_help_pl := CASE WHEN p_payload ? 'help_pl' THEN btrim(COALESCE(p_payload->>'help_pl', '')) ELSE COALESCE(v_row.help_pl, '') END;
  v_help_en := CASE WHEN p_payload ? 'help_en' THEN btrim(COALESCE(p_payload->>'help_en', '')) ELSE COALESCE(v_row.help_en, '') END;
  IF char_length(v_help_pl) > 500 OR char_length(v_help_en) > 500 THEN
    RAISE EXCEPTION 'invalid_help: help texts are limited to 500 characters';
  END IF;

  IF v_type IN ('select', 'multiselect') THEN
    v_option := CASE WHEN p_payload ? 'options' THEN p_payload->'options' ELSE COALESCE(v_row.options, '[]'::jsonb) END;
    IF jsonb_typeof(v_option) IS DISTINCT FROM 'array'
       OR jsonb_array_length(CASE WHEN jsonb_typeof(v_option) = 'array' THEN v_option ELSE '[]'::jsonb END)
          NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'invalid_options: a choice question needs 1-50 options';
    END IF;
    FOR v_option IN SELECT value FROM jsonb_array_elements(v_option) LOOP
      v_value := btrim(COALESCE(v_option->>'value', ''));
      IF jsonb_typeof(v_option) <> 'object'
         OR v_value !~ '^[a-z0-9][a-z0-9_-]{0,48}$'
         OR v_value = ANY (v_values)
         OR char_length(btrim(COALESCE(v_option->>'label_pl', ''))) NOT BETWEEN 1 AND 120
         OR char_length(btrim(COALESCE(v_option->>'label_en', ''))) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'invalid_options: every option needs a unique value and both labels';
      END IF;
      v_values := v_values || v_value;
      v_options := v_options || jsonb_build_array(jsonb_build_object(
        'value', v_value,
        'label_pl', btrim(v_option->>'label_pl'),
        'label_en', btrim(v_option->>'label_en')));
    END LOOP;
  END IF;

  IF v_id IS NULL THEN
    v_sort := public._event_cfp_jsonb_int(p_payload->'sort_order');
    IF v_sort IS NULL THEN
      SELECT COALESCE(max(f.sort_order), 0) + 10 INTO v_sort
        FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id;
    END IF;
    INSERT INTO public.event_cfp_fields (
      tenant_id, event_id, key, field_type, label_pl, label_en, help_pl, help_en,
      is_required, options, sort_order, is_active
    ) VALUES (
      v_tenant, v_event_id, v_key, v_type, v_label_pl, v_label_en, v_help_pl, v_help_en,
      COALESCE(CASE WHEN jsonb_typeof(p_payload->'is_required') = 'boolean'
        THEN (p_payload->>'is_required')::boolean END, false),
      v_options, v_sort,
      COALESCE(CASE WHEN jsonb_typeof(p_payload->'is_active') = 'boolean'
        THEN (p_payload->>'is_active')::boolean END, true)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_cfp_fields f SET
      field_type = v_type,
      label_pl = v_label_pl,
      label_en = v_label_en,
      help_pl = v_help_pl,
      help_en = v_help_en,
      is_required = CASE WHEN jsonb_typeof(p_payload->'is_required') = 'boolean'
        THEN (p_payload->>'is_required')::boolean ELSE f.is_required END,
      options = v_options,
      sort_order = COALESCE(public._event_cfp_jsonb_int(p_payload->'sort_order'), f.sort_order),
      is_active = CASE WHEN jsonb_typeof(p_payload->'is_active') = 'boolean'
        THEN (p_payload->>'is_active')::boolean ELSE f.is_active END
    WHERE f.tenant_id = v_tenant AND f.id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_field_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_field_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_field_upsert(jsonb) IS
  'Pytanie formularza zgloszenia: zalozenie albo zmiana (PATCH po obecnosci klucza, klucz niezmienny). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_field_delete(p_field_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  DELETE FROM public.event_cfp_fields f WHERE f.tenant_id = v_tenant AND f.id = p_field_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: question does not exist in this tenant';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_field_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_field_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_field_delete(uuid) IS
  'Usuniecie pytania formularza zgloszenia (odpowiedzi w zgloszeniach zostaja). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_fields_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_ids uuid[];
  v_count integer;
BEGIN
  IF v_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF jsonb_typeof(p_payload->'ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_order: ids must be a list';
  END IF;
  BEGIN
    SELECT COALESCE(array_agg(x::uuid ORDER BY o), ARRAY[]::uuid[]) INTO v_ids
      FROM jsonb_array_elements_text(p_payload->'ids') WITH ORDINALITY AS a(x, o);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_order: ids must be identifiers';
  END;
  SELECT count(*) INTO v_count
    FROM public.event_cfp_fields f
   WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id;
  IF cardinality(v_ids) <> v_count
     OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> v_count
     OR EXISTS (
       SELECT 1 FROM unnest(v_ids) x
        WHERE NOT EXISTS (
          SELECT 1 FROM public.event_cfp_fields f
           WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id AND f.id = x
        )
     ) THEN
    RAISE EXCEPTION 'invalid_order: ids must list every question of this event exactly once';
  END IF;
  UPDATE public.event_cfp_fields f SET sort_order = a.o * 10
    FROM unnest(v_ids) WITH ORDINALITY AS a(fid, o)
   WHERE f.tenant_id = v_tenant AND f.event_id = v_event_id AND f.id = a.fid;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_fields_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_fields_reorder(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_fields_reorder(jsonb) IS
  'Nowa kolejnosc pytan formularza zgloszenia (pelna lista identyfikatorow). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 12) PANEL: LISTA, LICZNIKI I SZCZEGOL ZGLOSZEN
--
-- Szkic (`draft`) jest prywatny dla zglaszajacego - panel go nie listuje,
-- licznik podaje tylko ile ich jest.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_submissions_list(p_payload jsonb)
RETURNS TABLE (
  id uuid,
  status text,
  title_pl text,
  title_en text,
  talk_language text,
  format_key text,
  duration_min integer,
  track_id uuid,
  track_name_pl text,
  track_name_en text,
  speaker_name text,
  speaker_email text,
  speakers_count integer,
  submitted_at timestamptz,
  decided_at timestamptz,
  updated_at timestamptz,
  reviews_count integer,
  overall_avg numeric,
  weighted_avg numeric,
  recommendations jsonb,
  notified_status text,
  session_id uuid,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_status text := NULLIF(btrim(COALESCE(p_payload->>'status', '')), '');
  v_track uuid := NULLIF(p_payload->>'track_id', '')::uuid;
  v_q text := lower(NULLIF(btrim(COALESCE(p_payload->>'q', '')), ''));
  v_sort text := COALESCE(NULLIF(p_payload->>'sort', ''), 'recent');
  v_limit integer := LEAST(GREATEST(COALESCE(public._event_cfp_jsonb_int(p_payload->'limit'), 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(public._event_cfp_jsonb_int(p_payload->'offset'), 0), 0);
BEGIN
  IF v_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN (
    'submitted', 'under_review', 'changes_requested', 'accepted', 'waitlisted',
    'rejected', 'withdrawn', 'confirmed', 'declined'
  ) THEN
    RAISE EXCEPTION 'invalid_status: unknown submission status filter';
  END IF;
  IF v_sort NOT IN ('recent', 'score', 'title') THEN
    RAISE EXCEPTION 'invalid_payload: sort must be recent, score or title';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT s.id, s.status, s.title_pl, s.title_en, s.talk_language, s.format_key, s.duration_min,
           s.track_id, t.name_pl AS track_name_pl, t.name_en AS track_name_en,
           btrim(p.first_name || ' ' || p.last_name) AS speaker_name,
           p.email AS speaker_email,
           (SELECT count(*)::integer FROM public.event_cfp_submission_speakers sp
             WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id) AS speakers_count,
           s.submitted_at, s.decided_at, s.updated_at,
           public._event_cfp_review_summary(s.tenant_id, s.id) AS summary,
           s.notified_status, s.session_id
      FROM public.event_cfp_submissions s
      JOIN public.event_people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
      LEFT JOIN public.event_tracks t
        ON t.tenant_id = s.tenant_id AND t.event_id = s.event_id AND t.id = s.track_id
     WHERE s.tenant_id = v_tenant
       AND s.event_id = v_event_id
       AND s.status <> 'draft'
       AND (v_status IS NULL OR s.status = v_status)
       AND (v_track IS NULL OR s.track_id = v_track)
       AND (
         v_q IS NULL
         OR strpos(lower(s.title_pl || ' ' || s.title_en || ' ' || p.first_name || ' '
                         || p.last_name || ' ' || COALESCE(p.email, '')), v_q) > 0
         OR EXISTS (
           SELECT 1 FROM public.event_cfp_submission_speakers sp
            WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id
              AND strpos(lower(sp.first_name || ' ' || sp.last_name || ' ' || COALESCE(sp.email, '')), v_q) > 0
         )
       )
  )
  SELECT b.id, b.status, b.title_pl, b.title_en, b.talk_language, b.format_key, b.duration_min,
         b.track_id, b.track_name_pl, b.track_name_en, b.speaker_name, b.speaker_email,
         b.speakers_count, b.submitted_at, b.decided_at, b.updated_at,
         (b.summary->>'reviews_count')::integer,
         (b.summary->>'overall_avg')::numeric,
         (b.summary->>'weighted_avg')::numeric,
         b.summary->'recommendations',
         b.notified_status, b.session_id,
         (count(*) OVER ())::integer
    FROM base b
   ORDER BY
     CASE WHEN v_sort = 'score' THEN COALESCE((b.summary->>'weighted_avg')::numeric,
                                              (b.summary->>'overall_avg')::numeric) END DESC NULLS LAST,
     CASE WHEN v_sort = 'title' THEN lower(COALESCE(NULLIF(btrim(b.title_pl), ''), b.title_en)) END ASC,
     b.submitted_at DESC NULLS LAST,
     b.id
   LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submissions_list(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submissions_list(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submissions_list(jsonb) IS
  'Lista zgloszen naboru (bez szkicow) z filtrami stan/sciezka/szukaj, stronicowaniem i agregatami ocen. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_submissions_counts(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_min integer;
  v_out jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  SELECT COALESCE(max(cs.min_reviews), 2) INTO v_min
    FROM public.event_cfp_settings cs
   WHERE cs.tenant_id = v_tenant AND cs.event_id = p_event_id;

  SELECT jsonb_build_object(
    'total', count(*) FILTER (WHERE s.status <> 'draft'),
    'draft', count(*) FILTER (WHERE s.status = 'draft'),
    'submitted', count(*) FILTER (WHERE s.status = 'submitted'),
    'under_review', count(*) FILTER (WHERE s.status = 'under_review'),
    'changes_requested', count(*) FILTER (WHERE s.status = 'changes_requested'),
    'accepted', count(*) FILTER (WHERE s.status = 'accepted'),
    'waitlisted', count(*) FILTER (WHERE s.status = 'waitlisted'),
    'rejected', count(*) FILTER (WHERE s.status = 'rejected'),
    'withdrawn', count(*) FILTER (WHERE s.status = 'withdrawn'),
    'confirmed', count(*) FILTER (WHERE s.status = 'confirmed'),
    'declined', count(*) FILTER (WHERE s.status = 'declined'),
    'needs_reviews', count(*) FILTER (
      WHERE s.status IN ('submitted', 'under_review')
        AND (public._event_cfp_review_summary(s.tenant_id, s.id)->>'reviews_count')::integer < v_min
    ),
    'min_reviews', v_min
  ) INTO v_out
  FROM public.event_cfp_submissions s
  WHERE s.tenant_id = v_tenant AND s.event_id = p_event_id;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submissions_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submissions_counts(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submissions_counts(uuid) IS
  'Liczniki zgloszen naboru per stan oraz liczba zgloszen z mniejsza niz min_reviews liczba ocen. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_submission_detail(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_sub public.event_cfp_submissions%ROWTYPE;
BEGIN
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = p_submission_id AND s.status <> 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;

  RETURN jsonb_build_object(
    'submission', to_jsonb(v_sub),
    'event', (
      SELECT jsonb_build_object(
        'id', e.id, 'slug', e.slug, 'title_pl', e.title_pl, 'title_en', e.title_en,
        'timezone', e.timezone, 'starts_at', e.starts_at, 'ends_at', e.ends_at)
        FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_sub.event_id
    ),
    'person', (
      SELECT jsonb_build_object(
        'id', p.id, 'user_id', p.user_id, 'first_name', p.first_name, 'last_name', p.last_name,
        'email', p.email, 'phone', p.phone, 'job_title', p.job_title,
        'company_text', p.company_text, 'consent_marketing_at', p.consent_marketing_at,
        'consent_withdrawn_at', p.consent_withdrawn_at)
        FROM public.event_people p WHERE p.tenant_id = v_tenant AND p.id = v_sub.person_id
    ),
    'speakers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', sp.id, 'person_id', sp.person_id, 'is_primary', sp.is_primary, 'role', sp.role,
        'sort_order', sp.sort_order, 'first_name', sp.first_name, 'last_name', sp.last_name,
        'email', sp.email, 'job_title', sp.job_title, 'company_text', sp.company_text,
        'crm', CASE WHEN k.person_id IS NULL THEN NULL ELSE jsonb_build_object(
          'sync_status', k.sync_status, 'crm_lead_id', k.crm_lead_id, 'last_error', k.last_error,
          'synced_at', k.synced_at, 'last_attempt_at', k.last_attempt_at) END
      ) ORDER BY sp.is_primary DESC, sp.sort_order, sp.created_at), '[]'::jsonb)
        FROM public.event_cfp_submission_speakers sp
        LEFT JOIN public.event_person_crm_links k
          ON k.tenant_id = sp.tenant_id AND k.person_id = sp.person_id
       WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id
    ),
    'fields', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', f.key, 'field_type', f.field_type, 'label_pl', f.label_pl, 'label_en', f.label_en,
        'options', f.options, 'is_active', f.is_active) ORDER BY f.sort_order, f.key), '[]'::jsonb)
        FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_sub.event_id
    ),
    'reviews', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reviewer_id', r.reviewer_id, 'user_id', rv.user_id,
        'reviewer_name', COALESCE(NULLIF(btrim(pr.display_name), ''),
                                  NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), ''),
                                  ''),
        'scores', r.scores, 'overall', r.overall, 'recommendation', r.recommendation,
        'comment_private', r.comment_private, 'comment_to_speaker', r.comment_to_speaker,
        'conflict_of_interest', r.conflict_of_interest, 'updated_at', r.updated_at
      ) ORDER BY r.updated_at DESC), '[]'::jsonb)
        FROM public.event_cfp_reviews r
        JOIN public.event_cfp_reviewers rv
          ON rv.tenant_id = r.tenant_id AND rv.event_id = r.event_id AND rv.id = r.reviewer_id
        LEFT JOIN public.profiles pr ON pr.id = rv.user_id
       WHERE r.tenant_id = v_tenant AND r.submission_id = v_sub.id
    ),
    'summary', public._event_cfp_review_summary(v_tenant, v_sub.id),
    'settings', (
      SELECT jsonb_build_object(
        'score_max', COALESCE(max(cs.score_max), 5),
        'review_criteria', COALESCE((array_agg(cs.review_criteria))[1], '[]'::jsonb),
        'min_reviews', COALESCE(max(cs.min_reviews), 2),
        'formats', COALESCE((array_agg(cs.formats))[1], '[]'::jsonb))
        FROM public.event_cfp_settings cs
       WHERE cs.tenant_id = v_tenant AND cs.event_id = v_sub.event_id
    ),
    'track', (
      SELECT jsonb_build_object('id', t.id, 'name_pl', t.name_pl, 'name_en', t.name_en)
        FROM public.event_tracks t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_sub.event_id AND t.id = v_sub.track_id
    ),
    'session', (
      SELECT jsonb_build_object(
        'id', ses.id, 'title_pl', ses.title_pl, 'title_en', ses.title_en,
        'starts_at', ses.starts_at, 'ends_at', ses.ends_at, 'status', ses.status)
        FROM public.event_sessions ses
       WHERE ses.tenant_id = v_tenant AND ses.event_id = v_sub.event_id AND ses.id = v_sub.session_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submission_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submission_detail(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submission_detail(uuid) IS
  'Szczegol zgloszenia dla organizatora: tresc, odpowiedzi, wystepujacy ze stanem CRM, oceny z komentarzami prywatnymi, agregaty, powiazana sesja. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 13) PANEL: DECYZJA
--
-- Przyjecie ma osobna funkcje (wpis do rejestru prelegentow), tu zapadaja
-- pozostale decyzje. Ta sama decyzja powtorzona zmienia notatke i informacje
-- zwrotna oraz stempel decyzji - czyli pozwala wyslac poprawiony mail.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_submission_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_status text := NULLIF(btrim(COALESCE(p_payload->>'status', '')), '');
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_note text;
  v_feedback text;
  v_at timestamptz := now();
BEGIN
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('under_review', 'changes_requested', 'waitlisted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status: decision must be under_review, changes_requested, waitlisted or rejected';
  END IF;
  IF v_sub.status NOT IN ('submitted', 'under_review', 'changes_requested', 'waitlisted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_transition: a % submission cannot be decided', v_sub.status;
  END IF;

  v_note := CASE WHEN p_payload ? 'decision_note'
    THEN NULLIF(btrim(COALESCE(p_payload->>'decision_note', '')), '') ELSE v_sub.decision_note END;
  v_feedback := CASE WHEN p_payload ? 'feedback_to_speaker'
    THEN btrim(COALESCE(p_payload->>'feedback_to_speaker', '')) ELSE v_sub.feedback_to_speaker END;
  IF char_length(COALESCE(v_note, '')) > 2000 OR char_length(v_feedback) > 4000 THEN
    RAISE EXCEPTION 'invalid_note: note up to 2000 and feedback up to 4000 characters';
  END IF;
  IF v_status = 'rejected' AND char_length(COALESCE(v_note, '')) < 3 THEN
    RAISE EXCEPTION 'note_required: a rejection needs an internal note';
  END IF;

  UPDATE public.event_cfp_submissions s SET
    status = v_status,
    decision_note = v_note,
    feedback_to_speaker = v_feedback,
    decided_by = auth.uid(),
    decided_at = v_at
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.decided.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id, 'status', v_status),
    auth.uid()
  );
  PERFORM public._event_cfp_crm_status(v_tenant, v_id, v_status);

  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'decided_at', v_at);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submission_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submission_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submission_decide(jsonb) IS
  'Decyzja o zgloszeniu (w ocenie / prosba o poprawki / lista rezerwowa / odrzucenie z notatka). Tag cfp:<status> w istniejacym kontakcie CRM. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 14) PANEL: PRZYJECIE ZGLOSZENIA
--
-- Kazdy wystepujacy: kartoteka (wspolprelegent dopiero teraz), nakladka
-- sceniczna, wpis do rejestru prelegentow wydarzenia, grupa prelegentow,
-- opcjonalnie zapis `approved` z biletem prelegenta, kontakt CRM `speaker`.
-- Opcjonalnie szkic sesji z obsada. Wszystko w JEDNEJ transakcji: kolizja
-- sali albo sesja poza oknem wydarzenia cofa cale przyjecie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_submission_accept(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_register boolean := COALESCE(CASE WHEN jsonb_typeof(p_payload->'register') = 'boolean'
    THEN (p_payload->>'register')::boolean END, true);
  v_schedule jsonb := CASE WHEN jsonb_typeof(p_payload->'schedule') = 'object' THEN p_payload->'schedule' END;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_settings public.event_cfp_settings%ROWTYPE;
  v_sp record;
  v_person uuid;
  v_profile uuid;
  v_primary_profile uuid;
  v_lead uuid;
  v_reg uuid;
  v_group uuid;
  v_cast jsonb := '[]'::jsonb;
  v_regs integer := 0;
  v_enrolled integer := 0;
  v_starts timestamptz;
  v_ends timestamptz;
  v_room uuid;
  v_track uuid;
  v_format text;
  v_session uuid;
  v_note text;
  v_feedback text;
  v_at timestamptz := now();
BEGIN
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;
  IF v_sub.status NOT IN ('submitted', 'under_review', 'changes_requested', 'waitlisted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_transition: a % submission cannot be accepted', v_sub.status;
  END IF;

  SELECT e.* INTO v_event FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_sub.event_id;
  SELECT cs.* INTO v_settings
    FROM public.event_cfp_settings cs
   WHERE cs.tenant_id = v_tenant AND cs.event_id = v_sub.event_id;

  v_note := CASE WHEN p_payload ? 'decision_note'
    THEN NULLIF(btrim(COALESCE(p_payload->>'decision_note', '')), '') ELSE v_sub.decision_note END;
  v_feedback := CASE WHEN p_payload ? 'feedback_to_speaker'
    THEN btrim(COALESCE(p_payload->>'feedback_to_speaker', '')) ELSE v_sub.feedback_to_speaker END;
  IF char_length(COALESCE(v_note, '')) > 2000 OR char_length(v_feedback) > 4000 THEN
    RAISE EXCEPTION 'invalid_note: note up to 2000 and feedback up to 4000 characters';
  END IF;

  -- Plan sesji sprawdzany PRZED jakimkolwiek zapisem.
  IF v_schedule IS NOT NULL THEN
    BEGIN
      v_starts := NULLIF(btrim(COALESCE(v_schedule->>'starts_at', '')), '')::timestamptz;
      v_ends := NULLIF(btrim(COALESCE(v_schedule->>'ends_at', '')), '')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_schedule: start and end must be timestamps';
    END;
    IF v_starts IS NULL OR v_ends IS NULL OR v_ends <= v_starts
       OR v_ends > v_starts + interval '48 hours' THEN
      RAISE EXCEPTION 'invalid_schedule: the session needs a start before its end (at most 48 hours)';
    END IF;
    v_room := NULLIF(v_schedule->>'room_id', '')::uuid;
    IF v_room IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_rooms r
       WHERE r.tenant_id = v_tenant AND r.event_id = v_sub.event_id AND r.id = v_room
    ) THEN
      RAISE EXCEPTION 'room_not_found: the room does not belong to this event';
    END IF;
    v_track := CASE WHEN v_schedule ? 'track_id'
      THEN NULLIF(v_schedule->>'track_id', '')::uuid ELSE v_sub.track_id END;
    IF v_track IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_tracks t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_sub.event_id AND t.id = v_track
    ) THEN
      RAISE EXCEPTION 'track_not_found: the track does not belong to this event';
    END IF;
    v_format := COALESCE(NULLIF(v_schedule->>'format', ''), 'onsite');
    IF v_format NOT IN ('onsite', 'online', 'hybrid') THEN
      RAISE EXCEPTION 'invalid_format: format must be onsite, online or hybrid';
    END IF;
  END IF;

  v_group := v_settings.speaker_group_id;

  FOR v_sp IN
    SELECT sp.*
      FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_id
     ORDER BY sp.is_primary DESC, sp.sort_order, sp.created_at, sp.id
  LOOP
    v_person := v_sp.person_id;
    IF v_person IS NULL THEN
      IF v_sp.email IS NOT NULL THEN
        SELECT p.id INTO v_person
          FROM public.event_people p
         WHERE p.tenant_id = v_tenant AND p.email_norm = lower(btrim(v_sp.email));
      END IF;
      IF v_person IS NULL THEN
        INSERT INTO public.event_people (
          tenant_id, email, first_name, last_name, job_title, company_text,
          source, consent_data_processing_at, created_by
        ) VALUES (
          v_tenant, v_sp.email, v_sp.first_name, v_sp.last_name, v_sp.job_title, v_sp.company_text,
          'organizer', now(), v_uid
        )
        RETURNING id INTO v_person;
      END IF;
      -- Ta sama osoba wpisana dwa razy (np. zglaszajacy podal swoj adres jako
      -- wspolprelegenta) wystepuje raz.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.event_cfp_submission_speakers o
         WHERE o.tenant_id = v_tenant AND o.submission_id = v_id AND o.person_id = v_person
      );
      UPDATE public.event_cfp_submission_speakers sp SET person_id = v_person
       WHERE sp.tenant_id = v_tenant AND sp.id = v_sp.id;
    END IF;

    v_profile := public._event_speaker_overlay_for_person(v_tenant, v_person);
    PERFORM public._event_speaker_roster_add(v_tenant, v_sub.event_id, v_profile);
    v_enrolled := v_enrolled + 1;
    IF v_sp.is_primary THEN
      v_primary_profile := v_profile;
    END IF;
    IF NOT v_cast @> jsonb_build_array(jsonb_build_object('profile', v_profile)) THEN
      v_cast := v_cast || jsonb_build_array(jsonb_build_object(
        'profile', v_profile, 'role', v_sp.role, 'order', jsonb_array_length(v_cast)));
    END IF;

    IF v_group IS NOT NULL THEN
      INSERT INTO public.event_group_members (tenant_id, event_id, group_id, person_id, added_by)
      VALUES (v_tenant, v_sub.event_id, v_group, v_person, v_uid)
      ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
    END IF;

    IF v_register AND NOT EXISTS (
      SELECT 1 FROM public.event_registrations r
       WHERE r.tenant_id = v_tenant AND r.event_id = v_sub.event_id AND r.person_id = v_person
         AND r.status NOT IN ('cancelled', 'rejected')
    ) THEN
      INSERT INTO public.event_registrations (
        tenant_id, event_id, person_id, ticket_type_id, group_id, status,
        registration_mode, answers, source, decided_by, decided_at, decision_source, created_by
      ) VALUES (
        v_tenant, v_sub.event_id, v_person, v_settings.speaker_ticket_type_id,
        COALESCE(v_group, (
          SELECT g.id FROM public.event_groups g
           WHERE g.tenant_id = v_tenant AND g.event_id = v_sub.event_id AND g.is_default)),
        'approved', 'form', '{}'::jsonb, 'invitation', v_uid, v_at, 'organizer', v_uid
      )
      RETURNING id INTO v_reg;
      v_regs := v_regs + 1;
      PERFORM public.emit_domain_event(
        v_tenant,
        'event_registration',
        v_reg::text,
        'event.registration.created.v1',
        jsonb_build_object('event_id', v_sub.event_id, 'person_id', v_person,
                           'status', 'approved', 'source', 'invitation'),
        v_uid
      );
    END IF;

    v_lead := public._event_person_crm_sync(
      v_tenant,
      v_person,
      'speaker',
      'event:' || v_event.slug || ':speaker',
      CASE WHEN v_sp.is_primary
        THEN ARRAY['event:' || v_event.slug, 'speaker', 'cfp:accepted']
        ELSE ARRAY['event:' || v_event.slug, 'speaker'] END,
      '{}'::jsonb,
      true,
      'event.cfp.accepted',
      public._event_cfp_audit_meta(v_tenant, v_id, 'accepted')
    );
    IF v_lead IS NOT NULL THEN
      UPDATE public.speaker_profiles sp SET crm_lead_id = COALESCE(sp.crm_lead_id, v_lead)
       WHERE sp.tenant_id = v_tenant AND sp.id = v_profile;
    END IF;
  END LOOP;

  IF v_schedule IS NOT NULL THEN
    BEGIN
      INSERT INTO public.event_sessions (
        tenant_id, event_id, track_id, room_id, title_pl, title_en,
        description_pl, description_en, starts_at, ends_at, format, status, created_by
      ) VALUES (
        v_tenant, v_sub.event_id, v_track, v_room,
        COALESCE(NULLIF(btrim(v_sub.title_pl), ''), btrim(v_sub.title_en)),
        COALESCE(NULLIF(btrim(v_sub.title_en), ''), btrim(v_sub.title_pl)),
        COALESCE(NULLIF(btrim(v_sub.abstract_pl), ''), btrim(v_sub.abstract_en)),
        COALESCE(NULLIF(btrim(v_sub.abstract_en), ''), btrim(v_sub.abstract_pl)),
        v_starts, v_ends, v_format, 'draft', v_uid
      )
      RETURNING id INTO v_session;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'room_conflict: the room already has a session at this time';
    END;
    INSERT INTO public.event_session_speakers (
      tenant_id, event_id, session_id, speaker_profile_id, role, sort_order
    )
    SELECT v_tenant, v_sub.event_id, v_session, (c->>'profile')::uuid, c->>'role',
           ((c->>'order')::integer + 1) * 10
      FROM jsonb_array_elements(v_cast) c;
  END IF;

  UPDATE public.event_cfp_submissions s SET
    status = 'accepted',
    decision_note = v_note,
    feedback_to_speaker = v_feedback,
    decided_by = v_uid,
    decided_at = v_at,
    speaker_profile_id = v_primary_profile,
    session_id = COALESCE(v_session, s.session_id)
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.decided.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id,
                       'status', 'accepted', 'session_id', v_session),
    v_uid
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'status', 'accepted',
    'decided_at', v_at,
    'speaker_profile_id', v_primary_profile,
    'session_id', v_session,
    'speakers_enrolled', v_enrolled,
    'registrations_created', v_regs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submission_accept(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submission_accept(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submission_accept(jsonb) IS
  'Przyjecie zgloszenia: wystepujacy do rejestru prelegentow (event_people -> speaker_profiles -> event_speaker_entries), grupa prelegentow, opcjonalny zapis approved z biletem prelegenta, kontakt CRM speaker, opcjonalny szkic sesji z obsada. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 15) PANEL: POWIADOMIENIE O DECYZJI (ladunek dla funkcji serwerowej)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_notify_payload(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'submission_id', s.id,
    'tenant_id', s.tenant_id,
    'event_id', s.event_id,
    'status', s.status,
    'notice', CASE WHEN s.status IN ('accepted', 'rejected', 'changes_requested') THEN s.status END,
    'decided_at', s.decided_at,
    'email', p.email,
    'first_name', p.first_name,
    'lang', s.notify_lang,
    'title_pl', s.title_pl,
    'title_en', s.title_en,
    'feedback_to_speaker', s.feedback_to_speaker,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone,
    'session_starts_at', ses.starts_at,
    'notified_status', s.notified_status,
    'notified_at', s.notified_at
  ) INTO v_out
  FROM public.event_cfp_submissions s
  JOIN public.event_people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
  JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
  LEFT JOIN public.event_sessions ses
    ON ses.tenant_id = s.tenant_id AND ses.event_id = s.event_id AND ses.id = s.session_id
  WHERE s.tenant_id = v_tenant AND s.id = p_submission_id AND s.status <> 'draft';
  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_notify_payload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_notify_payload(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_notify_payload(uuid) IS
  'Ladunek maila o decyzji w naborze (adres, jezyk, tytuly, informacja zwrotna, stempel decyzji). Granica autoryzacji dla funkcji serwerowej. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_mark_notified(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'submission_id', '')::uuid;
  v_status text := NULLIF(p_payload->>'status', '');
  v_error text := left(NULLIF(btrim(COALESCE(p_payload->>'error', '')), ''), 500);
BEGIN
  IF v_status IS NULL OR v_status NOT IN ('accepted', 'rejected', 'changes_requested') THEN
    RAISE EXCEPTION 'invalid_status: status must be accepted, rejected or changes_requested';
  END IF;
  UPDATE public.event_cfp_submissions s SET
    notified_status = CASE WHEN v_error IS NULL THEN v_status ELSE s.notified_status END,
    notified_at = CASE WHEN v_error IS NULL THEN now() ELSE s.notified_at END,
    notify_error = v_error
  WHERE s.tenant_id = v_tenant AND s.id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;
  RETURN v_error IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_mark_notified(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_mark_notified(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_mark_notified(jsonb) IS
  'Wynik wysylki maila o decyzji: stempel notified_status/notified_at albo notify_error. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 16) PANEL: RECENZENCI
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_reviewers_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  track_ids uuid[],
  can_see_identity boolean,
  is_active boolean,
  reviews_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  RETURN QUERY
  SELECT rv.id, rv.user_id,
         COALESCE(NULLIF(btrim(pr.display_name), ''),
                  NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), ''),
                  ''),
         pr.avatar_url, rv.track_ids, rv.can_see_identity, rv.is_active,
         (SELECT count(*)::integer FROM public.event_cfp_reviews r
           WHERE r.tenant_id = rv.tenant_id AND r.reviewer_id = rv.id),
         rv.created_at
    FROM public.event_cfp_reviewers rv
    LEFT JOIN public.profiles pr ON pr.id = rv.user_id AND pr.tenant_id = rv.tenant_id
   WHERE rv.tenant_id = v_tenant AND rv.event_id = p_event_id
   ORDER BY rv.is_active DESC, rv.created_at, rv.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_reviewers_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_reviewers_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_reviewers_list(uuid) IS
  'Recenzenci naboru z nazwa konta, zakresem sciezek i liczba ocen. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_reviewer_set(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_user uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_tracks uuid[];
  v_id uuid;
BEGIN
  IF v_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles pr WHERE pr.id = v_user AND pr.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'reviewer_not_found: the account does not belong to this tenant';
  END IF;

  IF p_payload ? 'track_ids' THEN
    IF jsonb_typeof(p_payload->'track_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_tracks: track_ids must be a list';
    END IF;
    BEGIN
      SELECT COALESCE(array_agg(DISTINCT x::uuid), ARRAY[]::uuid[]) INTO v_tracks
        FROM jsonb_array_elements_text(p_payload->'track_ids') x;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_tracks: track_ids must be identifiers';
    END;
    IF EXISTS (
      SELECT 1 FROM unnest(v_tracks) tid
       WHERE NOT EXISTS (
         SELECT 1 FROM public.event_tracks t
          WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.id = tid
       )
    ) THEN
      RAISE EXCEPTION 'invalid_tracks: every track must belong to this event';
    END IF;
  END IF;

  INSERT INTO public.event_cfp_reviewers AS rv (
    tenant_id, event_id, user_id, track_ids, can_see_identity, is_active, added_by
  ) VALUES (
    v_tenant, v_event_id, v_user, COALESCE(v_tracks, ARRAY[]::uuid[]),
    COALESCE(CASE WHEN jsonb_typeof(p_payload->'can_see_identity') = 'boolean'
      THEN (p_payload->>'can_see_identity')::boolean END, false),
    COALESCE(CASE WHEN jsonb_typeof(p_payload->'is_active') = 'boolean'
      THEN (p_payload->>'is_active')::boolean END, true),
    auth.uid()
  )
  ON CONFLICT (tenant_id, event_id, user_id) DO UPDATE SET
    track_ids = COALESCE(v_tracks, rv.track_ids),
    can_see_identity = CASE WHEN jsonb_typeof(p_payload->'can_see_identity') = 'boolean'
      THEN (p_payload->>'can_see_identity')::boolean ELSE rv.can_see_identity END,
    is_active = CASE WHEN jsonb_typeof(p_payload->'is_active') = 'boolean'
      THEN (p_payload->>'is_active')::boolean ELSE rv.is_active END
  RETURNING rv.id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_reviewer_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_reviewer_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_reviewer_set(jsonb) IS
  'Dodanie albo zmiana recenzenta (konto najemcy; zakres sciezek, wglad w tozsamosc, aktywnosc - PATCH po obecnosci klucza). Bramka: assert_event_admin_tenant().';

-- Recenzent z ocenami NIE jest usuwany (oceny zniklyby kaskada) - tylko
-- dezaktywowany. Bez ocen znika calkiem.
CREATE OR REPLACE FUNCTION public.admin_event_cfp_reviewer_remove(p_reviewer_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  PERFORM 1 FROM public.event_cfp_reviewers rv
   WHERE rv.tenant_id = v_tenant AND rv.id = p_reviewer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: reviewer does not exist in this tenant';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_cfp_reviews r
     WHERE r.tenant_id = v_tenant AND r.reviewer_id = p_reviewer_id
  ) THEN
    UPDATE public.event_cfp_reviewers rv SET is_active = false
     WHERE rv.tenant_id = v_tenant AND rv.id = p_reviewer_id;
    RETURN 'deactivated';
  END IF;
  DELETE FROM public.event_cfp_reviewers rv WHERE rv.tenant_id = v_tenant AND rv.id = p_reviewer_id;
  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_reviewer_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_reviewer_remove(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_reviewer_remove(uuid) IS
  'Usuniecie recenzenta bez ocen (deleted) albo dezaktywacja recenzenta z ocenami (deactivated). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 17) PANEL: MATERIALY PRELEGENTOW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_materials_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  speaker_profile_id uuid,
  speaker_name text,
  submission_id uuid,
  session_id uuid,
  kind text,
  title_pl text,
  title_en text,
  url text,
  visibility text,
  is_published boolean,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  RETURN QUERY
  SELECT m.id, m.speaker_profile_id,
         COALESCE(
           NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), ''),
           NULLIF(btrim(pr.display_name), ''),
           ''),
         m.submission_id, m.session_id, m.kind, m.title_pl, m.title_en, m.url,
         m.visibility, m.is_published, m.published_at, m.created_at, m.updated_at
    FROM public.event_speaker_materials m
    JOIN public.speaker_profiles sp ON sp.tenant_id = m.tenant_id AND sp.id = m.speaker_profile_id
    LEFT JOIN public.event_people pe ON pe.tenant_id = sp.tenant_id AND pe.id = sp.person_id
    LEFT JOIN public.profiles pr ON pr.id = sp.user_id AND pr.tenant_id = sp.tenant_id
   WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id
   ORDER BY m.is_published, m.updated_at DESC, m.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_materials_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_materials_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_materials_list(uuid) IS
  'Materialy prelegentow wydarzenia (najpierw czekajace na publikacje). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_material_publish(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_publish boolean;
BEGIN
  IF jsonb_typeof(p_payload->'is_published') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid_payload: is_published must be true or false';
  END IF;
  v_publish := (p_payload->>'is_published')::boolean;
  UPDATE public.event_speaker_materials m SET
    is_published = v_publish,
    published_at = CASE WHEN v_publish THEN now() END,
    published_by = CASE WHEN v_publish THEN auth.uid() END
  WHERE m.tenant_id = v_tenant AND m.id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: material does not exist in this tenant';
  END IF;
  RETURN v_publish;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_material_publish(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_material_publish(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_material_publish(jsonb) IS
  'Publikacja albo wycofanie publikacji materialu prelegenta. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 18) PLASZCZYZNA TRESCI: STRONA NABORU (anon + zalogowani)
--
-- Tylko wydarzenia opublikowane. Nabor w szkicu nie zdradza tekstow - strona
-- dostaje wylacznie `phase = 'none'`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_cfp_public(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_phase text;
BEGIN
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id;
  v_phase := public._event_cfp_phase(v_s.status, v_s.opens_at, v_s.closes_at);

  IF v_phase = 'none' THEN
    RETURN jsonb_build_object(
      'event_id', v_event.id, 'event_slug', v_event.slug, 'timezone', v_event.timezone,
      'phase', 'none', 'is_open', false);
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'phase', v_phase,
    'is_open', v_phase = 'open',
    'opens_at', v_s.opens_at,
    'closes_at', v_s.closes_at,
    'intro_pl', v_s.intro_pl,
    'intro_en', v_s.intro_en,
    'guidelines_pl', v_s.guidelines_pl,
    'guidelines_en', v_s.guidelines_en,
    'formats', v_s.formats,
    'allow_co_speakers', v_s.allow_co_speakers,
    'max_per_submitter', v_s.max_per_submitter,
    'tracks', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', t.id, 'key', t.key, 'name_pl', t.name_pl, 'name_en', t.name_en)
        ORDER BY t.sort_order, t.key), '[]'::jsonb)
        FROM public.event_tracks t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active
         AND t.id = ANY (v_s.track_ids)
    ),
    'fields', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'field_type', f.field_type,
        'label_pl', f.label_pl, 'label_en', f.label_en,
        'help_pl', f.help_pl, 'help_en', f.help_en,
        'is_required', f.is_required, 'options', f.options, 'sort_order', f.sort_order)
        ORDER BY f.sort_order, f.key), '[]'::jsonb)
        FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_event.id AND f.is_active
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_cfp_public(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_public(text) IS
  'Publiczna strona naboru prelegentow: faza (none/scheduled/open/closed), okno, teksty, formy, sciezki i pytania. Tylko wydarzenia opublikowane; szkic naboru nie zdradza tresci. Najemca z public_tenant_id().';

-- ----------------------------------------------------------------------------
-- 19) PLASZCZYZNA WLASNA: SZKIC I WYSLANIE ZGLOSZENIA
-- ----------------------------------------------------------------------------

-- Wlasne zgloszenie wolajacego (po kartotece z `user_id = auth.uid()`).
CREATE OR REPLACE FUNCTION public._event_cfp_own_submission(
  p_tenant uuid, p_uid uuid, p_submission_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id
    FROM public.event_cfp_submissions s
    JOIN public.event_people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
   WHERE s.tenant_id = p_tenant AND s.id = p_submission_id AND p.user_id = p_uid
$$;

REVOKE ALL ON FUNCTION public._event_cfp_own_submission(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_own_submission(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_own_submission(uuid, uuid, uuid) IS
  'Identyfikator zgloszenia, jesli nalezy do osoby z kontem p_uid w najemcy p_tenant; inaczej NULL.';

CREATE OR REPLACE FUNCTION public.event_cfp_submission_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_allowed boolean;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_person uuid;
  v_count integer;
  v_title_pl text;
  v_title_en text;
  v_abstract_pl text;
  v_abstract_en text;
  v_language text;
  v_lang text;
  v_format text;
  v_duration integer;
  v_track uuid;
  v_topics text[];
  v_answers jsonb;
  v_role text;
  v_item jsonb;
  v_first text;
  v_last text;
  v_email text;
  v_emails text[] := ARRAY[]::text[];
  v_order integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to submit a talk';
  END IF;
  SELECT r.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_cfp_save', v_tenant::text || ':' || v_uid::text, 60, 10) r;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'rate_limited: too many changes, try again in a few minutes';
  END IF;

  IF v_id IS NULL THEN
    SELECT e.* INTO v_event
      FROM public.events e
     WHERE e.tenant_id = v_tenant AND e.slug = NULLIF(p_payload->>'slug', '') AND e.status = 'published';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: event does not exist';
    END IF;
    SELECT s.* INTO v_s
      FROM public.event_cfp_settings s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id
     FOR UPDATE;
    IF NOT FOUND OR NOT public._event_cfp_is_open(v_s.status, v_s.opens_at, v_s.closes_at) THEN
      RAISE EXCEPTION 'cfp_closed: the call for speakers is not open';
    END IF;
    v_person := public._event_cfp_resolve_person(v_tenant, v_uid, p_payload->'speaker');
    SELECT count(*) INTO v_count
      FROM public.event_cfp_submissions s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id AND s.person_id = v_person
       AND s.status <> 'withdrawn';
    IF v_count >= v_s.max_per_submitter THEN
      RAISE EXCEPTION 'limit_reached: at most % submissions per person', v_s.max_per_submitter;
    END IF;
    INSERT INTO public.event_cfp_submissions (tenant_id, event_id, person_id, created_by)
    VALUES (v_tenant, v_event.id, v_person, v_uid)
    RETURNING * INTO v_sub;
    INSERT INTO public.event_cfp_submission_speakers (
      tenant_id, event_id, submission_id, person_id, is_primary, role, sort_order,
      first_name, last_name, email, job_title, company_text
    )
    SELECT v_tenant, v_event.id, v_sub.id, p.id, true, 'speaker', 0,
           p.first_name, p.last_name, NULLIF(btrim(COALESCE(p.email, '')), ''), p.job_title, p.company_text
      FROM public.event_people p
     WHERE p.tenant_id = v_tenant AND p.id = v_person;
  ELSE
    IF public._event_cfp_own_submission(v_tenant, v_uid, v_id) IS NULL THEN
      RAISE EXCEPTION 'not_found: submission does not exist';
    END IF;
    SELECT s.* INTO v_sub
      FROM public.event_cfp_submissions s
     WHERE s.tenant_id = v_tenant AND s.id = v_id
     FOR UPDATE;
    IF v_sub.status NOT IN ('draft', 'changes_requested') THEN
      RAISE EXCEPTION 'not_editable: a % submission cannot be changed', v_sub.status;
    END IF;
    SELECT e.* INTO v_event FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_sub.event_id;
    SELECT s.* INTO v_s
      FROM public.event_cfp_settings s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_sub.event_id;
    IF v_sub.status = 'draft' AND NOT (
      v_event.status = 'published' AND public._event_cfp_is_open(v_s.status, v_s.opens_at, v_s.closes_at)
    ) THEN
      RAISE EXCEPTION 'cfp_closed: the call for speakers is not open';
    END IF;
    IF p_payload ? 'speaker' THEN
      v_person := public._event_cfp_resolve_person(v_tenant, v_uid, p_payload->'speaker');
      UPDATE public.event_cfp_submission_speakers sp SET
        first_name = p.first_name,
        last_name = p.last_name,
        job_title = p.job_title,
        company_text = p.company_text
        FROM public.event_people p
       WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id AND sp.is_primary
         AND p.tenant_id = v_tenant AND p.id = v_sub.person_id;
    END IF;
  END IF;

  v_title_pl := CASE WHEN p_payload ? 'title_pl' THEN btrim(COALESCE(p_payload->>'title_pl', '')) ELSE v_sub.title_pl END;
  v_title_en := CASE WHEN p_payload ? 'title_en' THEN btrim(COALESCE(p_payload->>'title_en', '')) ELSE v_sub.title_en END;
  IF char_length(v_title_pl) > 200 OR char_length(v_title_en) > 200 THEN
    RAISE EXCEPTION 'invalid_title: titles are limited to 200 characters';
  END IF;
  v_abstract_pl := CASE WHEN p_payload ? 'abstract_pl' THEN btrim(COALESCE(p_payload->>'abstract_pl', '')) ELSE v_sub.abstract_pl END;
  v_abstract_en := CASE WHEN p_payload ? 'abstract_en' THEN btrim(COALESCE(p_payload->>'abstract_en', '')) ELSE v_sub.abstract_en END;
  IF char_length(v_abstract_pl) > 4000 OR char_length(v_abstract_en) > 4000 THEN
    RAISE EXCEPTION 'invalid_abstract: abstracts are limited to 4000 characters';
  END IF;
  v_language := CASE WHEN p_payload ? 'talk_language' THEN p_payload->>'talk_language' ELSE v_sub.talk_language END;
  IF v_language IS NULL OR v_language NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_language: the talk language must be pl or en';
  END IF;
  v_lang := CASE WHEN p_payload->>'notify_lang' IN ('pl', 'en') THEN p_payload->>'notify_lang' ELSE v_sub.notify_lang END;

  v_format := CASE WHEN p_payload ? 'format_key' THEN NULLIF(btrim(COALESCE(p_payload->>'format_key', '')), '') ELSE v_sub.format_key END;
  v_duration := NULL;
  IF v_format IS NOT NULL THEN
    SELECT public._event_cfp_jsonb_int(f -> 'duration_min') INTO v_duration
      FROM jsonb_array_elements(COALESCE(v_s.formats, '[]'::jsonb)) f
     WHERE f ->> 'key' = v_format;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_format: unknown format for this call';
    END IF;
  END IF;

  v_track := CASE WHEN p_payload ? 'track_id' THEN NULLIF(p_payload->>'track_id', '')::uuid ELSE v_sub.track_id END;
  IF v_track IS NOT NULL AND NOT (v_track = ANY (COALESCE(v_s.track_ids, '{}'::uuid[]))) THEN
    RAISE EXCEPTION 'invalid_track: the track is not open for submissions';
  END IF;

  IF p_payload ? 'topics' THEN
    IF jsonb_typeof(p_payload->'topics') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_topics: topics must be a list';
    END IF;
    v_topics := public._event_speaker_text_array(p_payload->'topics');
    IF cardinality(v_topics) > 10 OR EXISTS (SELECT 1 FROM unnest(v_topics) x WHERE char_length(x) > 60) THEN
      RAISE EXCEPTION 'invalid_topics: at most 10 topics of up to 60 characters';
    END IF;
  ELSE
    v_topics := v_sub.topics;
  END IF;

  v_answers := CASE WHEN p_payload ? 'answers'
    THEN public._event_cfp_clean_answers(v_tenant, v_sub.event_id, p_payload->'answers') ELSE v_sub.answers END;

  IF p_payload ? 'role' THEN
    v_role := p_payload->>'role';
    IF v_role IS NULL OR v_role NOT IN ('speaker', 'moderator', 'panelist', 'host') THEN
      RAISE EXCEPTION 'invalid_role: unknown speaker role';
    END IF;
    UPDATE public.event_cfp_submission_speakers sp SET role = v_role
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id AND sp.is_primary;
  END IF;

  IF p_payload ? 'co_speakers' THEN
    IF jsonb_typeof(p_payload->'co_speakers') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_speakers: co_speakers must be a list';
    END IF;
    IF jsonb_array_length(p_payload->'co_speakers') > 0 AND NOT COALESCE(v_s.allow_co_speakers, true) THEN
      RAISE EXCEPTION 'co_speakers_disabled: this call accepts single-speaker talks only';
    END IF;
    IF jsonb_array_length(p_payload->'co_speakers') > 5 THEN
      RAISE EXCEPTION 'too_many_speakers: at most 5 co-speakers';
    END IF;
    SELECT ARRAY[lower(btrim(COALESCE(sp.email, '')))] INTO v_emails
      FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id AND sp.is_primary;
    DELETE FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id AND NOT sp.is_primary;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'co_speakers') LOOP
      v_first := btrim(COALESCE(v_item->>'first_name', ''));
      v_last := btrim(COALESCE(v_item->>'last_name', ''));
      v_email := NULLIF(lower(btrim(COALESCE(v_item->>'email', ''))), '');
      v_role := COALESCE(NULLIF(v_item->>'role', ''), 'speaker');
      v_order := v_order + 1;
      IF jsonb_typeof(v_item) <> 'object'
         OR char_length(v_first) NOT BETWEEN 1 AND 80
         OR char_length(v_last) NOT BETWEEN 1 AND 80
         OR (v_email IS NOT NULL AND (
               char_length(v_email) > 320
               OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
               OR v_email = ANY (v_emails)))
         OR char_length(btrim(COALESCE(v_item->>'job_title', ''))) > 160
         OR char_length(btrim(COALESCE(v_item->>'company_text', ''))) > 200
         OR v_role NOT IN ('speaker', 'moderator', 'panelist', 'host') THEN
        RAISE EXCEPTION 'invalid_speakers: co-speaker % needs a name, a unique valid e-mail and a known role', v_order;
      END IF;
      IF v_email IS NOT NULL THEN
        v_emails := v_emails || v_email;
      END IF;
      INSERT INTO public.event_cfp_submission_speakers (
        tenant_id, event_id, submission_id, is_primary, role, sort_order,
        first_name, last_name, email, job_title, company_text
      ) VALUES (
        v_tenant, v_sub.event_id, v_sub.id, false, v_role, v_order,
        v_first, v_last, v_email,
        NULLIF(btrim(COALESCE(v_item->>'job_title', '')), ''),
        NULLIF(btrim(COALESCE(v_item->>'company_text', '')), '')
      );
    END LOOP;
  END IF;

  UPDATE public.event_cfp_submissions s SET
    title_pl = v_title_pl,
    title_en = v_title_en,
    abstract_pl = v_abstract_pl,
    abstract_en = v_abstract_en,
    talk_language = v_language,
    notify_lang = v_lang,
    format_key = v_format,
    duration_min = v_duration,
    track_id = v_track,
    topics = v_topics,
    answers = v_answers
  WHERE s.tenant_id = v_tenant AND s.id = v_sub.id;

  RETURN jsonb_build_object('id', v_sub.id, 'status', v_sub.status, 'event_id', v_sub.event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_save(jsonb) IS
  'Szkic zgloszenia prelegenta: zalozenie (nabor otwarty, limit pod blokada ustawien, kartoteka po koncie) albo zmiana szkicu / zgloszenia z prosba o poprawki (PATCH po obecnosci klucza). Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_submission_submit(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_allowed boolean;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_missing text[];
  v_at timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to submit a talk';
  END IF;
  SELECT r.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_cfp_submit', v_tenant::text || ':' || v_uid::text, 20, 10) r;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'rate_limited: too many attempts, try again in a few minutes';
  END IF;
  IF public._event_cfp_own_submission(v_tenant, v_uid, v_id) IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;
  IF v_sub.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'not_editable: a % submission cannot be submitted again', v_sub.status;
  END IF;
  SELECT e.* INTO v_event FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_sub.event_id;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_sub.event_id;
  IF v_sub.status = 'draft' AND NOT (
    v_event.status = 'published' AND public._event_cfp_is_open(v_s.status, v_s.opens_at, v_s.closes_at)
  ) THEN
    RAISE EXCEPTION 'cfp_closed: the call for speakers is not open';
  END IF;

  IF char_length(v_sub.title_pl) < 2 AND char_length(v_sub.title_en) < 2 THEN
    RAISE EXCEPTION 'missing_title: the talk needs a title';
  END IF;
  IF char_length(v_sub.abstract_pl) < 20 AND char_length(v_sub.abstract_en) < 20 THEN
    RAISE EXCEPTION 'missing_abstract: the talk needs an abstract of at least 20 characters';
  END IF;
  -- Forma i sciezka sprawdzane wobec BIEZACYCH ustawien: organizator mogl je
  -- zmienic miedzy zapisem szkicu a wyslaniem.
  IF jsonb_array_length(COALESCE(v_s.formats, '[]'::jsonb)) > 0 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_s.formats) f WHERE f->>'key' = v_sub.format_key
  ) THEN
    RAISE EXCEPTION 'missing_format: pick a format';
  END IF;
  IF cardinality(COALESCE(v_s.track_ids, '{}'::uuid[])) > 0
     AND (v_sub.track_id IS NULL OR NOT (v_sub.track_id = ANY (v_s.track_ids))) THEN
    RAISE EXCEPTION 'missing_track: pick a track';
  END IF;
  IF NOT COALESCE(v_s.allow_co_speakers, true) AND EXISTS (
    SELECT 1 FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_id AND NOT sp.is_primary
  ) THEN
    RAISE EXCEPTION 'co_speakers_disabled: this call accepts single-speaker talks only';
  END IF;

  SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[]) INTO v_missing
    FROM public.event_cfp_fields f
   WHERE f.tenant_id = v_tenant AND f.event_id = v_sub.event_id AND f.is_active AND f.is_required
     AND NOT public._event_answer_matches(
       CASE WHEN f.field_type = 'checkbox' THEN 'is_true' ELSE 'not_empty' END,
       'null'::jsonb, v_sub.answers -> f.key);
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'missing_required_fields: %', array_to_string(v_missing, ',');
  END IF;

  UPDATE public.event_cfp_submissions s SET
    status = 'submitted',
    submitted_at = v_at
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.submitted.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id, 'status', 'submitted'),
    v_uid
  );
  PERFORM public._event_person_crm_sync(
    v_tenant,
    v_sub.person_id,
    'event_cfp',
    'event:' || v_event.slug || ':cfp',
    ARRAY['event:' || v_event.slug, 'cfp:submitted'],
    jsonb_build_object('cfp_title', COALESCE(NULLIF(v_sub.title_pl, ''), v_sub.title_en)),
    true,
    'event.cfp.submitted',
    public._event_cfp_audit_meta(v_tenant, v_id, 'submitted')
  );

  RETURN jsonb_build_object('id', v_id, 'status', 'submitted', 'submitted_at', v_at);
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_submit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_submit(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_submit(jsonb) IS
  'Wyslanie szkicu (nabor otwarty) albo ponowne wyslanie po prosbie o poprawki: tytul, streszczenie, forma, sciezka, wymagane odpowiedzi. Kontakt CRM event_cfp. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_submission_withdraw(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_sub public.event_cfp_submissions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your submissions';
  END IF;
  IF public._event_cfp_own_submission(v_tenant, v_uid, v_id) IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;

  -- Szkic nikt poza zglaszajacym nie widzial - znika bez sladu.
  IF v_sub.status = 'draft' THEN
    DELETE FROM public.event_cfp_submissions s WHERE s.tenant_id = v_tenant AND s.id = v_id;
    RETURN jsonb_build_object('id', v_id, 'status', 'deleted');
  END IF;
  IF v_sub.status IN ('withdrawn', 'rejected', 'declined') THEN
    RAISE EXCEPTION 'invalid_transition: a % submission cannot be withdrawn', v_sub.status;
  END IF;

  UPDATE public.event_cfp_submissions s SET
    status = 'withdrawn',
    withdrawn_at = now()
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.withdrawn.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id, 'status', 'withdrawn'),
    v_uid
  );
  PERFORM public._event_cfp_crm_status(v_tenant, v_id, 'withdrawn');

  RETURN jsonb_build_object('id', v_id, 'status', 'withdrawn');
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_withdraw(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_withdraw(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_withdraw(jsonb) IS
  'Wycofanie wlasnego zgloszenia (szkic znika calkiem). Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_submission_respond(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your submissions';
  END IF;
  IF jsonb_typeof(p_payload->'confirm') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid_payload: confirm must be true or false';
  END IF;
  IF public._event_cfp_own_submission(v_tenant, v_uid, v_id) IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;
  IF v_sub.status <> 'accepted' THEN
    RAISE EXCEPTION 'invalid_transition: only an accepted submission can be confirmed or declined';
  END IF;

  v_status := CASE WHEN (p_payload->>'confirm')::boolean THEN 'confirmed' ELSE 'declined' END;
  UPDATE public.event_cfp_submissions s SET
    status = v_status,
    confirmed_at = CASE WHEN v_status = 'confirmed' THEN now() ELSE s.confirmed_at END,
    declined_at = CASE WHEN v_status = 'declined' THEN now() ELSE s.declined_at END
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.confirmed.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id, 'status', v_status),
    v_uid
  );
  PERFORM public._event_cfp_crm_status(v_tenant, v_id, v_status);

  RETURN jsonb_build_object('id', v_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_respond(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_respond(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_respond(jsonb) IS
  'Odpowiedz prelegenta na przyjecie: potwierdzenie albo odwolanie udzialu. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

-- Ladunek maila "zgloszenie otrzymane" dla funkcji serwerowej. Klient
-- serwerowy nie niesie naglowka hosta, wiec najemca pochodzi z wiersza,
-- ktorego wlasnoscia wolajacy sie wykazal (`event_people.user_id = auth.uid()`).
CREATE OR REPLACE FUNCTION public.event_cfp_submission_notice(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your submissions';
  END IF;
  SELECT jsonb_build_object(
    'submission_id', s.id,
    'tenant_id', s.tenant_id,
    'event_id', s.event_id,
    'status', s.status,
    'submitted_at', s.submitted_at,
    'email', p.email,
    'first_name', p.first_name,
    'lang', s.notify_lang,
    'title_pl', s.title_pl,
    'title_en', s.title_en,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone
  ) INTO v_out
  FROM public.event_cfp_submissions s
  JOIN public.event_people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
  JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
  WHERE s.id = p_submission_id AND p.user_id = v_uid;
  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_notice(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_notice(uuid) IS
  'Ladunek maila potwierdzajacego wyslanie zgloszenia - wylacznie dla wlasciciela (event_people.user_id = auth.uid()); najemca z wiersza.';

-- ----------------------------------------------------------------------------
-- 20) PLASZCZYZNA WLASNA: MOJE ZGLOSZENIA I PANEL PRELEGENTA
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_my_cfp_submissions(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_person public.event_people%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your submissions';
  END IF;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id;
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.user_id = v_uid;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'max_per_submitter', COALESCE(v_s.max_per_submitter, 3),
    'score_max', COALESCE(v_s.score_max, 5),
    'person', CASE WHEN v_person.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_person.id, 'first_name', v_person.first_name, 'last_name', v_person.last_name,
      'email', v_person.email, 'job_title', v_person.job_title, 'company_text', v_person.company_text,
      'consent_marketing', v_person.consent_marketing_at IS NOT NULL AND v_person.consent_withdrawn_at IS NULL)
    END,
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status,
        'title_pl', s.title_pl, 'title_en', s.title_en,
        'abstract_pl', s.abstract_pl, 'abstract_en', s.abstract_en,
        'talk_language', s.talk_language, 'format_key', s.format_key,
        'duration_min', s.duration_min, 'track_id', s.track_id,
        'topics', to_jsonb(s.topics), 'answers', s.answers,
        'submitted_at', s.submitted_at, 'withdrawn_at', s.withdrawn_at,
        'confirmed_at', s.confirmed_at, 'declined_at', s.declined_at,
        'updated_at', s.updated_at, 'session_id', s.session_id,
        'feedback_to_speaker', CASE
          WHEN s.status IN ('changes_requested', 'accepted', 'waitlisted', 'rejected', 'confirmed', 'declined')
            THEN s.feedback_to_speaker ELSE '' END,
        'speakers', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'is_primary', sp.is_primary, 'role', sp.role, 'sort_order', sp.sort_order,
            'first_name', sp.first_name, 'last_name', sp.last_name, 'email', sp.email,
            'job_title', sp.job_title, 'company_text', sp.company_text)
            ORDER BY sp.is_primary DESC, sp.sort_order), '[]'::jsonb)
            FROM public.event_cfp_submission_speakers sp
           WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id
        ),
        'review_summary', jsonb_build_object(
          'reviews_count', (public._event_cfp_review_summary(s.tenant_id, s.id)->>'reviews_count')::integer,
          'overall_avg', CASE
            WHEN s.status IN ('accepted', 'waitlisted', 'rejected', 'confirmed', 'declined')
              THEN public._event_cfp_review_summary(s.tenant_id, s.id)->'overall_avg'
            ELSE 'null'::jsonb END
        )
      ) ORDER BY s.created_at DESC), '[]'::jsonb)
        FROM public.event_cfp_submissions s
       WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id AND s.person_id = v_person.id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_cfp_submissions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_cfp_submissions(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_cfp_submissions(text) IS
  'Wlasne zgloszenia na wydarzenie (takze szkice) z informacja zwrotna po decyzji i zagregowana - nigdy pojedyncza - ocena. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

-- Nakladka sceniczna wolajacego wpisana do rejestru prelegentow wydarzenia.
CREATE OR REPLACE FUNCTION public._event_my_speaker_profile(p_tenant uuid, p_uid uuid, p_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sp.id
    FROM public.speaker_profiles sp
    JOIN public.event_speaker_entries en
      ON en.tenant_id = sp.tenant_id AND en.speaker_profile_id = sp.id AND en.event_id = p_event_id
   WHERE sp.tenant_id = p_tenant
     AND (
       sp.user_id = p_uid
       OR sp.person_id IN (
         SELECT p.id FROM public.event_people p WHERE p.tenant_id = p_tenant AND p.user_id = p_uid
       )
     )
   ORDER BY (sp.user_id = p_uid) DESC NULLS LAST, en.created_at
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public._event_my_speaker_profile(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_my_speaker_profile(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_my_speaker_profile(uuid, uuid, uuid) IS
  'Nakladka sceniczna konta p_uid (po speaker_profiles.user_id albo event_people.user_id) wpisana do rejestru prelegentow wydarzenia; inaczej NULL.';

CREATE OR REPLACE FUNCTION public.event_my_speaker_panel(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_person public.event_people%ROWTYPE;
  v_profile uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to open the speaker panel';
  END IF;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.user_id = v_uid;
  v_profile := public._event_my_speaker_profile(v_tenant, v_uid, v_event.id);

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'is_reviewer', EXISTS (
      SELECT 1 FROM public.event_cfp_reviewers rv
       WHERE rv.tenant_id = v_tenant AND rv.event_id = v_event.id AND rv.user_id = v_uid AND rv.is_active
    ),
    'submissions_count', (
      SELECT count(*)::integer FROM public.event_cfp_submissions s
       WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id AND s.person_id = v_person.id
    ),
    'person', CASE WHEN v_person.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_person.id, 'first_name', v_person.first_name, 'last_name', v_person.last_name)
    END,
    'profile', (
      SELECT jsonb_build_object(
        'speaker_profile_id', sp.id,
        'headline_pl', sp.headline_pl, 'headline_en', sp.headline_en,
        'bio_pl', sp.bio_pl, 'bio_en', sp.bio_en,
        'topics_pl', to_jsonb(COALESCE(sp.topics_pl, '{}'::text[])),
        'topics_en', to_jsonb(COALESCE(sp.topics_en, '{}'::text[])),
        'languages', to_jsonb(COALESCE(sp.languages, '{}'::text[])),
        'card_photo_url', sp.card_photo_url,
        'is_public', sp.is_public)
        FROM public.speaker_profiles sp
       WHERE sp.tenant_id = v_tenant AND sp.id = v_profile
    ),
    'sessions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'session_id', ses.id, 'title_pl', ses.title_pl, 'title_en', ses.title_en,
        'starts_at', ses.starts_at, 'ends_at', ses.ends_at, 'status', ses.status,
        'format', ses.format, 'role', ss.role, 'room_name', r.name,
        'track_name_pl', t.name_pl, 'track_name_en', t.name_en)
        ORDER BY ses.starts_at, ses.id), '[]'::jsonb)
        FROM public.event_session_speakers ss
        JOIN public.event_sessions ses
          ON ses.tenant_id = ss.tenant_id AND ses.event_id = ss.event_id AND ses.id = ss.session_id
        LEFT JOIN public.event_rooms r
          ON r.tenant_id = ses.tenant_id AND r.event_id = ses.event_id AND r.id = ses.room_id
        LEFT JOIN public.event_tracks t
          ON t.tenant_id = ses.tenant_id AND t.event_id = ses.event_id AND t.id = ses.track_id
       WHERE ss.tenant_id = v_tenant AND ss.event_id = v_event.id
         AND ss.speaker_profile_id = v_profile AND ses.status <> 'cancelled'
    ),
    'materials', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'title_pl', m.title_pl, 'title_en', m.title_en,
        'url', m.url, 'visibility', m.visibility, 'is_published', m.is_published,
        'submission_id', m.submission_id, 'session_id', m.session_id, 'updated_at', m.updated_at)
        ORDER BY m.created_at, m.id), '[]'::jsonb)
        FROM public.event_speaker_materials m
       WHERE m.tenant_id = v_tenant AND m.event_id = v_event.id AND m.speaker_profile_id = v_profile
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_speaker_panel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_speaker_panel(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_speaker_panel(text) IS
  'Panel prelegenta wydarzenia: nakladka sceniczna z rejestru, wystapienia (bez odwolanych; szkic = wstepnie), materialy, liczba zgloszen i czy wolajacy jest recenzentem. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_speaker_profile_set(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_profile uuid;
  v_topics_pl text[];
  v_topics_en text[];
  v_languages text[];
  v_photo text := NULLIF(btrim(COALESCE(p_payload->>'card_photo_url', '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to edit your speaker profile';
  END IF;
  SELECT e.id INTO v_event_id
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = NULLIF(p_payload->>'slug', '') AND e.status = 'published';
  v_profile := public._event_my_speaker_profile(v_tenant, v_uid, v_event_id);
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not_speaker: you are not a speaker of this event';
  END IF;

  IF char_length(COALESCE(p_payload->>'headline_pl', '')) > 200
     OR char_length(COALESCE(p_payload->>'headline_en', '')) > 200
     OR char_length(COALESCE(p_payload->>'bio_pl', '')) > 4000
     OR char_length(COALESCE(p_payload->>'bio_en', '')) > 4000
     OR (v_photo IS NOT NULL AND (v_photo !~ '^https://[^\s]{3,}$' OR char_length(v_photo) > 2048)) THEN
    RAISE EXCEPTION 'invalid_profile: headline up to 200, bio up to 4000 characters, photo as https address';
  END IF;
  IF p_payload ? 'topics_pl' THEN
    v_topics_pl := public._event_speaker_text_array(p_payload->'topics_pl');
  END IF;
  IF p_payload ? 'topics_en' THEN
    v_topics_en := public._event_speaker_text_array(p_payload->'topics_en');
  END IF;
  IF p_payload ? 'languages' THEN
    v_languages := ARRAY(SELECT lower(x) FROM unnest(public._event_speaker_text_array(p_payload->'languages')) x);
  END IF;
  IF cardinality(COALESCE(v_topics_pl, '{}')) > 12 OR cardinality(COALESCE(v_topics_en, '{}')) > 12
     OR EXISTS (SELECT 1 FROM unnest(COALESCE(v_topics_pl, '{}') || COALESCE(v_topics_en, '{}')) x
                 WHERE char_length(x) > 60)
     OR cardinality(COALESCE(v_languages, '{}')) > 10
     OR EXISTS (SELECT 1 FROM unnest(COALESCE(v_languages, '{}')) x WHERE x !~ '^[a-z]{2}$') THEN
    RAISE EXCEPTION 'invalid_profile: at most 12 topics of up to 60 characters and 10 two-letter languages';
  END IF;

  UPDATE public.speaker_profiles sp SET
    headline_pl = CASE WHEN p_payload ? 'headline_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'headline_pl', '')), '') ELSE sp.headline_pl END,
    headline_en = CASE WHEN p_payload ? 'headline_en' THEN NULLIF(btrim(COALESCE(p_payload->>'headline_en', '')), '') ELSE sp.headline_en END,
    bio_pl = CASE WHEN p_payload ? 'bio_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_pl', '')), '') ELSE sp.bio_pl END,
    bio_en = CASE WHEN p_payload ? 'bio_en' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_en', '')), '') ELSE sp.bio_en END,
    topics_pl = COALESCE(v_topics_pl, sp.topics_pl),
    topics_en = COALESCE(v_topics_en, sp.topics_en),
    languages = COALESCE(v_languages, sp.languages),
    card_photo_url = CASE WHEN p_payload ? 'card_photo_url' THEN v_photo ELSE sp.card_photo_url END
  WHERE sp.tenant_id = v_tenant AND sp.id = v_profile;

  RETURN jsonb_build_object('speaker_profile_id', v_profile, 'event_id', v_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_speaker_profile_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_speaker_profile_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_speaker_profile_set(jsonb) IS
  'Prelegent zmienia WLASNA nakladke sceniczna (naglowek, nota, tematy, jezyki, zdjecie karty) - tylko gdy jest w rejestrze prelegentow wydarzenia. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_speaker_material_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_speaker_materials%ROWTYPE;
  v_event_id uuid;
  v_profile uuid;
  v_kind text;
  v_title_pl text;
  v_title_en text;
  v_url text;
  v_visibility text;
  v_submission uuid;
  v_session uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your materials';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT m.* INTO v_row
      FROM public.event_speaker_materials m
     WHERE m.tenant_id = v_tenant AND m.id = v_id
     FOR UPDATE;
    IF NOT FOUND OR public._event_my_speaker_profile(v_tenant, v_uid, v_row.event_id)
                    IS DISTINCT FROM v_row.speaker_profile_id THEN
      RAISE EXCEPTION 'not_found: material does not exist';
    END IF;
    v_event_id := v_row.event_id;
    v_profile := v_row.speaker_profile_id;
  ELSE
    SELECT e.id INTO v_event_id
      FROM public.events e
     WHERE e.tenant_id = v_tenant AND e.slug = NULLIF(p_payload->>'slug', '') AND e.status = 'published';
    v_profile := public._event_my_speaker_profile(v_tenant, v_uid, v_event_id);
    IF v_profile IS NULL THEN
      RAISE EXCEPTION 'not_speaker: you are not a speaker of this event';
    END IF;
    IF (SELECT count(*) FROM public.event_speaker_materials m
         WHERE m.tenant_id = v_tenant AND m.event_id = v_event_id AND m.speaker_profile_id = v_profile) >= 20 THEN
      RAISE EXCEPTION 'too_many_materials: at most 20 materials per event';
    END IF;
  END IF;

  v_kind := CASE WHEN p_payload ? 'kind' THEN p_payload->>'kind' ELSE COALESCE(v_row.kind, 'link') END;
  IF v_kind IS NULL OR v_kind NOT IN ('slides', 'document', 'video', 'link') THEN
    RAISE EXCEPTION 'invalid_kind: kind must be slides, document, video or link';
  END IF;
  v_title_pl := CASE WHEN p_payload ? 'title_pl' THEN btrim(COALESCE(p_payload->>'title_pl', '')) ELSE COALESCE(v_row.title_pl, '') END;
  v_title_en := CASE WHEN p_payload ? 'title_en' THEN btrim(COALESCE(p_payload->>'title_en', '')) ELSE COALESCE(v_row.title_en, '') END;
  IF char_length(v_title_pl) > 200 OR char_length(v_title_en) > 200
     OR (v_title_pl = '' AND v_title_en = '') THEN
    RAISE EXCEPTION 'invalid_title: a material needs a title of up to 200 characters';
  END IF;
  v_url := CASE WHEN p_payload ? 'url' THEN btrim(COALESCE(p_payload->>'url', '')) ELSE v_row.url END;
  IF v_url IS NULL OR v_url !~* '^https://[^\s]{3,}$' OR char_length(v_url) > 2008 THEN
    RAISE EXCEPTION 'invalid_url: the material must be an https address';
  END IF;
  v_visibility := CASE WHEN p_payload ? 'visibility' THEN p_payload->>'visibility' ELSE COALESCE(v_row.visibility, 'organizers') END;
  IF v_visibility IS NULL OR v_visibility NOT IN ('organizers', 'registered', 'public') THEN
    RAISE EXCEPTION 'invalid_visibility: visibility must be organizers, registered or public';
  END IF;
  v_submission := CASE WHEN p_payload ? 'submission_id' THEN NULLIF(p_payload->>'submission_id', '')::uuid ELSE v_row.submission_id END;
  IF v_submission IS NOT NULL AND (
    public._event_cfp_own_submission(v_tenant, v_uid, v_submission) IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.event_cfp_submissions s
                    WHERE s.tenant_id = v_tenant AND s.id = v_submission AND s.event_id = v_event_id)
  ) THEN
    RAISE EXCEPTION 'invalid_submission: the submission is not yours';
  END IF;
  v_session := CASE WHEN p_payload ? 'session_id' THEN NULLIF(p_payload->>'session_id', '')::uuid ELSE v_row.session_id END;
  IF v_session IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_session_speakers ss
     WHERE ss.tenant_id = v_tenant AND ss.event_id = v_event_id AND ss.session_id = v_session
       AND ss.speaker_profile_id = v_profile
  ) THEN
    RAISE EXCEPTION 'invalid_session: you do not speak in this session';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_speaker_materials (
      tenant_id, event_id, speaker_profile_id, submission_id, session_id,
      kind, title_pl, title_en, url, visibility, created_by
    ) VALUES (
      v_tenant, v_event_id, v_profile, v_submission, v_session,
      v_kind, v_title_pl, v_title_en, v_url, v_visibility, v_uid
    )
    RETURNING id INTO v_id;
  ELSE
    -- Zmieniona tresc wraca do zatwierdzenia - organizator publikowal INNY material.
    UPDATE public.event_speaker_materials m SET
      kind = v_kind,
      title_pl = v_title_pl,
      title_en = v_title_en,
      url = v_url,
      visibility = v_visibility,
      submission_id = v_submission,
      session_id = v_session,
      is_published = CASE
        WHEN m.url <> v_url OR m.title_pl <> v_title_pl OR m.title_en <> v_title_en
             OR m.visibility <> v_visibility THEN false
        ELSE m.is_published END,
      published_at = CASE
        WHEN m.url <> v_url OR m.title_pl <> v_title_pl OR m.title_en <> v_title_en
             OR m.visibility <> v_visibility THEN NULL
        ELSE m.published_at END
    WHERE m.tenant_id = v_tenant AND m.id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_speaker_material_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_speaker_material_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_speaker_material_upsert(jsonb) IS
  'Prelegent dodaje albo zmienia WLASNY material (adres https). Zmiana tresci zdejmuje publikacje. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_speaker_material_delete(p_material_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_row public.event_speaker_materials%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your materials';
  END IF;
  SELECT m.* INTO v_row
    FROM public.event_speaker_materials m
   WHERE m.tenant_id = v_tenant AND m.id = p_material_id
   FOR UPDATE;
  IF NOT FOUND OR public._event_my_speaker_profile(v_tenant, v_uid, v_row.event_id)
                  IS DISTINCT FROM v_row.speaker_profile_id THEN
    RAISE EXCEPTION 'not_found: material does not exist';
  END IF;
  DELETE FROM public.event_speaker_materials m WHERE m.tenant_id = v_tenant AND m.id = p_material_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_speaker_material_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_speaker_material_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_speaker_material_delete(uuid) IS
  'Prelegent usuwa WLASNY material. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

-- ----------------------------------------------------------------------------
-- 21) PLASZCZYZNA RECENZENTA
--
-- Czlonkostwo w `event_cfp_reviewers` (aktywne) jest cala bramka - recenzent
-- nie musi byc personelem ani uczestnikiem. Ocenia zgloszenia wyslane
-- (submitted / under_review / changes_requested / waitlisted) z zakresu
-- swoich sciezek, NIGDY takie, w ktorych sam wystepuje (po koncie albo po
-- adresie konta wpisanym jako wspolprelegent).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_cfp_reviewable(
  p_tenant uuid, p_uid uuid, p_reviewer_id uuid, p_submission_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.event_cfp_submissions s
      JOIN public.event_cfp_reviewers rv
        ON rv.tenant_id = s.tenant_id AND rv.event_id = s.event_id AND rv.id = p_reviewer_id
     WHERE s.tenant_id = p_tenant
       AND s.id = p_submission_id
       AND rv.is_active
       AND rv.user_id = p_uid
       AND s.status IN ('submitted', 'under_review', 'changes_requested', 'waitlisted')
       AND (cardinality(rv.track_ids) = 0 OR s.track_id = ANY (rv.track_ids))
       AND NOT EXISTS (
         SELECT 1
           FROM public.event_cfp_submission_speakers sp
           LEFT JOIN public.event_people p ON p.tenant_id = sp.tenant_id AND p.id = sp.person_id
          WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id
            AND (
              p.user_id = p_uid
              OR lower(sp.email) = (SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = p_uid)
            )
       )
  )
$$;

REVOKE ALL ON FUNCTION public._event_cfp_reviewable(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_reviewable(uuid, uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_reviewable(uuid, uuid, uuid, uuid) IS
  'Czy aktywny recenzent moze ocenic zgloszenie: stan do oceny, zakres sciezek, brak udzialu recenzenta w zgloszeniu.';

CREATE OR REPLACE FUNCTION public.event_cfp_review_queue(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_rv public.event_cfp_reviewers%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_identity boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to review submissions';
  END IF;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT rv.* INTO v_rv
    FROM public.event_cfp_reviewers rv
   WHERE rv.tenant_id = v_tenant AND rv.event_id = v_event.id AND rv.user_id = v_uid AND rv.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_reviewer: you are not a reviewer of this call';
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id;
  v_identity := NOT COALESCE(v_s.review_blind, false) OR v_rv.can_see_identity;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'identity_visible', v_identity,
    'score_max', COALESCE(v_s.score_max, 5),
    'review_criteria', COALESCE(v_s.review_criteria, '[]'::jsonb),
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status,
        'title_pl', s.title_pl, 'title_en', s.title_en,
        'talk_language', s.talk_language, 'format_key', s.format_key,
        'duration_min', s.duration_min, 'track_id', s.track_id,
        'track_name_pl', t.name_pl, 'track_name_en', t.name_en,
        'submitted_at', s.submitted_at,
        'speakers', CASE WHEN v_identity THEN (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'first_name', sp.first_name, 'last_name', sp.last_name, 'role', sp.role,
            'job_title', sp.job_title, 'company_text', sp.company_text)
            ORDER BY sp.is_primary DESC, sp.sort_order), '[]'::jsonb)
            FROM public.event_cfp_submission_speakers sp
           WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id
        ) ELSE NULL END,
        'my_review', (
          SELECT jsonb_build_object(
            'id', r.id, 'overall', r.overall, 'recommendation', r.recommendation,
            'conflict_of_interest', r.conflict_of_interest, 'updated_at', r.updated_at)
            FROM public.event_cfp_reviews r
           WHERE r.tenant_id = s.tenant_id AND r.submission_id = s.id AND r.reviewer_id = v_rv.id
        )
      ) ORDER BY s.submitted_at, s.id), '[]'::jsonb)
        FROM public.event_cfp_submissions s
        LEFT JOIN public.event_tracks t
          ON t.tenant_id = s.tenant_id AND t.event_id = s.event_id AND t.id = s.track_id
       WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id
         AND public._event_cfp_reviewable(v_tenant, v_uid, v_rv.id, s.id)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_review_queue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_review_queue(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_review_queue(text) IS
  'Kolejka recenzenta: zgloszenia do oceny z zakresu jego sciezek, bez wlasnych, z tozsamoscia ukryta przy ocenie w ciemno (chyba ze can_see_identity). Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_review_get(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_rv public.event_cfp_reviewers%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_identity boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to review submissions';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = p_submission_id;
  SELECT rv.* INTO v_rv
    FROM public.event_cfp_reviewers rv
   WHERE rv.tenant_id = v_tenant AND rv.event_id = v_sub.event_id AND rv.user_id = v_uid AND rv.is_active;
  IF v_rv.id IS NULL OR NOT public._event_cfp_reviewable(v_tenant, v_uid, v_rv.id, p_submission_id) THEN
    RAISE EXCEPTION 'not_found: submission is not in your review queue';
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_sub.event_id;
  v_identity := NOT COALESCE(v_s.review_blind, false) OR v_rv.can_see_identity;

  RETURN jsonb_build_object(
    'submission', jsonb_build_object(
      'id', v_sub.id, 'event_id', v_sub.event_id, 'status', v_sub.status,
      'title_pl', v_sub.title_pl, 'title_en', v_sub.title_en,
      'abstract_pl', v_sub.abstract_pl, 'abstract_en', v_sub.abstract_en,
      'talk_language', v_sub.talk_language, 'format_key', v_sub.format_key,
      'duration_min', v_sub.duration_min, 'track_id', v_sub.track_id,
      'topics', to_jsonb(v_sub.topics), 'answers', v_sub.answers,
      'submitted_at', v_sub.submitted_at),
    'identity_visible', v_identity,
    'speakers', CASE WHEN v_identity THEN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'first_name', sp.first_name, 'last_name', sp.last_name, 'role', sp.role,
        'job_title', sp.job_title, 'company_text', sp.company_text, 'is_primary', sp.is_primary)
        ORDER BY sp.is_primary DESC, sp.sort_order), '[]'::jsonb)
        FROM public.event_cfp_submission_speakers sp
       WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id
    ) ELSE NULL END,
    'fields', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', f.key, 'field_type', f.field_type, 'label_pl', f.label_pl, 'label_en', f.label_en,
        'options', f.options) ORDER BY f.sort_order, f.key), '[]'::jsonb)
        FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_sub.event_id AND f.is_active
    ),
    'formats', COALESCE(v_s.formats, '[]'::jsonb),
    'track', (
      SELECT jsonb_build_object('id', t.id, 'name_pl', t.name_pl, 'name_en', t.name_en)
        FROM public.event_tracks t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_sub.event_id AND t.id = v_sub.track_id
    ),
    'score_max', COALESCE(v_s.score_max, 5),
    'review_criteria', COALESCE(v_s.review_criteria, '[]'::jsonb),
    'review', (
      SELECT jsonb_build_object(
        'id', r.id, 'scores', r.scores, 'overall', r.overall, 'recommendation', r.recommendation,
        'comment_private', r.comment_private, 'comment_to_speaker', r.comment_to_speaker,
        'conflict_of_interest', r.conflict_of_interest, 'updated_at', r.updated_at)
        FROM public.event_cfp_reviews r
       WHERE r.tenant_id = v_tenant AND r.submission_id = v_sub.id AND r.reviewer_id = v_rv.id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_review_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_review_get(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_review_get(uuid) IS
  'Zgloszenie do oceny z kryteriami i wlasna ocena recenzenta (tozsamosc ukryta przy ocenie w ciemno). Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_review_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_submission uuid := NULLIF(p_payload->>'submission_id', '')::uuid;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_rv public.event_cfp_reviewers%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_max integer;
  v_keys text[];
  v_scores jsonb := '{}'::jsonb;
  v_entry record;
  v_value integer;
  v_overall integer;
  v_recommendation text := NULLIF(p_payload->>'recommendation', '');
  v_conflict boolean := COALESCE(CASE WHEN jsonb_typeof(p_payload->'conflict_of_interest') = 'boolean'
    THEN (p_payload->>'conflict_of_interest')::boolean END, false);
  v_private text := btrim(COALESCE(p_payload->>'comment_private', ''));
  v_to_speaker text := btrim(COALESCE(p_payload->>'comment_to_speaker', ''));
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to review submissions';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_submission
   FOR UPDATE;
  SELECT rv.* INTO v_rv
    FROM public.event_cfp_reviewers rv
   WHERE rv.tenant_id = v_tenant AND rv.event_id = v_sub.event_id AND rv.user_id = v_uid AND rv.is_active;
  IF v_rv.id IS NULL OR NOT public._event_cfp_reviewable(v_tenant, v_uid, v_rv.id, v_submission) THEN
    RAISE EXCEPTION 'not_found: submission is not in your review queue';
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_sub.event_id;
  v_max := COALESCE(v_s.score_max, 5);
  SELECT COALESCE(array_agg(c->>'key'), ARRAY[]::text[]) INTO v_keys
    FROM jsonb_array_elements(COALESCE(v_s.review_criteria, '[]'::jsonb)) c;

  IF v_recommendation IS NOT NULL AND v_recommendation NOT IN ('accept', 'maybe', 'reject', 'abstain') THEN
    RAISE EXCEPTION 'invalid_recommendation: recommendation must be accept, maybe, reject or abstain';
  END IF;

  IF p_payload ? 'scores' AND jsonb_typeof(p_payload->'scores') IS DISTINCT FROM 'null' THEN
    IF jsonb_typeof(p_payload->'scores') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_scores: scores must be an object';
    END IF;
    FOR v_entry IN SELECT key, value FROM jsonb_each(p_payload->'scores') LOOP
      CONTINUE WHEN jsonb_typeof(v_entry.value) = 'null';
      v_value := public._event_cfp_jsonb_int(v_entry.value);
      IF NOT (v_entry.key = ANY (v_keys)) OR v_value IS NULL OR v_value NOT BETWEEN 1 AND v_max THEN
        RAISE EXCEPTION 'invalid_scores: every score must be a known criterion scored 1-%', v_max;
      END IF;
      v_scores := v_scores || jsonb_build_object(v_entry.key, v_value);
    END LOOP;
  END IF;

  IF jsonb_typeof(p_payload->'overall') IN ('number', 'string') THEN
    v_overall := public._event_cfp_jsonb_int(p_payload->'overall');
    IF v_overall IS NULL OR v_overall NOT BETWEEN 1 AND v_max THEN
      RAISE EXCEPTION 'invalid_score: the overall score must be 1-%', v_max;
    END IF;
  END IF;
  IF v_overall IS NULL AND NOT v_conflict AND v_recommendation IS DISTINCT FROM 'abstain' THEN
    RAISE EXCEPTION 'score_required: give an overall score, abstain or declare a conflict of interest';
  END IF;
  IF char_length(v_private) > 4000 OR char_length(v_to_speaker) > 4000 THEN
    RAISE EXCEPTION 'invalid_comment: comments are limited to 4000 characters';
  END IF;

  INSERT INTO public.event_cfp_reviews AS r (
    tenant_id, event_id, submission_id, reviewer_id, scores, overall, recommendation,
    comment_private, comment_to_speaker, conflict_of_interest
  ) VALUES (
    v_tenant, v_sub.event_id, v_submission, v_rv.id, v_scores, v_overall, v_recommendation,
    v_private, v_to_speaker, v_conflict
  )
  ON CONFLICT (tenant_id, submission_id, reviewer_id) DO UPDATE SET
    scores = EXCLUDED.scores,
    overall = EXCLUDED.overall,
    recommendation = EXCLUDED.recommendation,
    comment_private = EXCLUDED.comment_private,
    comment_to_speaker = EXCLUDED.comment_to_speaker,
    conflict_of_interest = EXCLUDED.conflict_of_interest
  RETURNING r.id INTO v_id;

  -- Pierwsza ocena rusza zgloszenie z kolejki "wyslane" do "w ocenie" - bez
  -- sladu decyzji czlowieka.
  IF v_sub.status = 'submitted' THEN
    UPDATE public.event_cfp_submissions s SET status = 'under_review'
     WHERE s.tenant_id = v_tenant AND s.id = v_submission;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_review',
    v_id::text,
    'event_cfp_review.saved.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_submission, 'review_id', v_id),
    v_uid
  );

  RETURN jsonb_build_object('id', v_id, 'submission_id', v_submission);
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_review_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_review_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_review_save(jsonb) IS
  'Zapis oceny recenzenta (kryteria 1..score_max, ocena ogolna, rekomendacja, komentarze, konflikt interesow). Pierwsza ocena przestawia submitted na under_review. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

-- ----------------------------------------------------------------------------
-- 22) EKSPORT RODO: DANE NABORU WOLAJACEGO
--
-- Eksport danych osobowych (`src/lib/profile/export.functions.ts`) sklada
-- paczke z sekcji; tabele naboru maja wylacznie polityki odczytu dla
-- administratora, wiec zapytanie `.from("event_cfp_*")` z klienta uzytkownika
-- oddaloby PUSTKE wygladajaca jak "nie korzystam". Jedno RPC SECURITY DEFINER
-- (wzorzec `club_export_my_data`) oddaje dane wolajacego, rozbite w TS na
-- sekcje manifestu:
--   * `event_cfp_submissions` - zgloszenia, ktore wolajacy wyslal albo w ktorych
--     jest wpisany jako prelegent (karta uczestnika z `event_people.user_id`):
--     tresc, odpowiedzi, stany i daty, informacja zwrotna po decyzji,
--     zagregowana ocena po decyzji. Wspolprelegenci: imie, nazwisko i rola -
--     BEZ adresu e-mail, stanowiska i firmy (dane kontaktowe innych osob,
--     art. 15 ust. 4 RODO);
--   * `event_speaker_materials` - materialy nakladek scenicznych wolajacego;
--   * `event_cfp_reviewer_roles` - role recenzenta w naborach;
--   * `event_cfp_reviews_written` - WLASNE oceny recenzenta (tresc autorska
--     wolajacego), z tytulem zgloszenia bez danych prelegentow.
-- NIE wychodza: notatka wewnetrzna decyzji (`decision_note`) i pojedyncze oceny
-- recenzentow o zgloszeniu wolajacego - wewnetrzna ocena pisana przez inne
-- osoby (wylaczenie `event_cfp_assessments` w manifescie).
--
-- Najemca z profilu wolajacego (jak `club_export_my_data`): eksport biegnie po
-- stronie serwera i nie niesie naglowka hosta.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.event_cfp_export_my_data(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  -- Sufit przychodzi z warstwy aplikacji, bramka jest tutaj: eksport ma byc
  -- plikiem, nie zrzutem bazy.
  v_limit integer := greatest(1, least(COALESCE(p_limit, 2000), 5000));
  v_people uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to export your data';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: profile does not exist';
  END IF;
  SELECT COALESCE(array_agg(p.id), '{}'::uuid[]) INTO v_people
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.user_id = v_uid;

  RETURN jsonb_build_object(
    'event_cfp_submissions', (
      SELECT COALESCE(jsonb_agg(t.doc ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT s.created_at, jsonb_build_object(
            'event_slug', e.slug, 'event_title_pl', e.title_pl, 'event_title_en', e.title_en,
            'status', s.status,
            'is_submitter', s.person_id = ANY (v_people),
            'my_roles', (
              SELECT COALESCE(jsonb_agg(ss.role ORDER BY ss.sort_order), '[]'::jsonb)
                FROM public.event_cfp_submission_speakers ss
               WHERE ss.tenant_id = s.tenant_id AND ss.submission_id = s.id
                 AND ss.person_id = ANY (v_people)
            ),
            'title_pl', s.title_pl, 'title_en', s.title_en,
            'abstract_pl', s.abstract_pl, 'abstract_en', s.abstract_en,
            'talk_language', s.talk_language, 'notify_lang', s.notify_lang,
            'format_key', s.format_key, 'duration_min', s.duration_min,
            'track_name_pl', tr.name_pl, 'track_name_en', tr.name_en,
            'topics', to_jsonb(s.topics), 'answers', s.answers,
            'co_speakers', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'first_name', ss.first_name, 'last_name', ss.last_name, 'role', ss.role)
                ORDER BY ss.sort_order), '[]'::jsonb)
                FROM public.event_cfp_submission_speakers ss
               WHERE ss.tenant_id = s.tenant_id AND ss.submission_id = s.id
                 AND (ss.person_id IS NULL OR NOT ss.person_id = ANY (v_people))
            ),
            'feedback_to_speaker', CASE
              WHEN s.status IN ('changes_requested', 'accepted', 'waitlisted', 'rejected', 'confirmed', 'declined')
                THEN s.feedback_to_speaker ELSE '' END,
            -- Ocena zbiorcza jak w panelu prelegenta: liczba ocen zawsze,
            -- srednia dopiero po decyzji - nigdy pojedyncze oceny.
            'review_summary', jsonb_build_object(
              'reviews_count', (public._event_cfp_review_summary(s.tenant_id, s.id)->>'reviews_count')::integer,
              'overall_avg', CASE
                WHEN s.status IN ('accepted', 'waitlisted', 'rejected', 'confirmed', 'declined')
                  THEN public._event_cfp_review_summary(s.tenant_id, s.id)->'overall_avg'
                ELSE 'null'::jsonb END
            ),
            'submitted_at', s.submitted_at, 'decided_at', s.decided_at,
            'withdrawn_at', s.withdrawn_at, 'confirmed_at', s.confirmed_at,
            'declined_at', s.declined_at,
            'created_at', s.created_at, 'updated_at', s.updated_at
          ) AS doc
            FROM public.event_cfp_submissions s
            JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
            LEFT JOIN public.event_tracks tr ON tr.tenant_id = s.tenant_id AND tr.id = s.track_id
           WHERE s.tenant_id = v_tenant
             AND (
               s.person_id = ANY (v_people)
               OR EXISTS (
                 SELECT 1 FROM public.event_cfp_submission_speakers ss
                  WHERE ss.tenant_id = s.tenant_id AND ss.submission_id = s.id
                    AND ss.person_id = ANY (v_people)
               )
             )
           ORDER BY s.created_at DESC
           LIMIT v_limit
        ) t
    ),
    'event_speaker_materials', (
      SELECT COALESCE(jsonb_agg(t.doc ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT m.created_at, jsonb_build_object(
            'event_slug', e.slug, 'kind', m.kind,
            'title_pl', m.title_pl, 'title_en', m.title_en, 'url', m.url,
            'visibility', m.visibility, 'is_published', m.is_published,
            'published_at', m.published_at,
            'created_at', m.created_at, 'updated_at', m.updated_at
          ) AS doc
            FROM public.event_speaker_materials m
            JOIN public.events e ON e.tenant_id = m.tenant_id AND e.id = m.event_id
            JOIN public.speaker_profiles sp ON sp.tenant_id = m.tenant_id AND sp.id = m.speaker_profile_id
           WHERE m.tenant_id = v_tenant
             AND (sp.user_id = v_uid OR sp.person_id = ANY (v_people))
           ORDER BY m.created_at DESC
           LIMIT v_limit
        ) t
    ),
    'event_cfp_reviewer_roles', (
      SELECT COALESCE(jsonb_agg(t.doc ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT rv.created_at, jsonb_build_object(
            'event_slug', e.slug, 'event_title_pl', e.title_pl, 'event_title_en', e.title_en,
            'is_active', rv.is_active, 'can_see_identity', rv.can_see_identity,
            'track_names', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object('name_pl', tr.name_pl, 'name_en', tr.name_en)
                ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
                FROM public.event_tracks tr
               WHERE tr.tenant_id = rv.tenant_id AND tr.id = ANY (rv.track_ids)
            ),
            'created_at', rv.created_at, 'updated_at', rv.updated_at
          ) AS doc
            FROM public.event_cfp_reviewers rv
            JOIN public.events e ON e.tenant_id = rv.tenant_id AND e.id = rv.event_id
           WHERE rv.tenant_id = v_tenant AND rv.user_id = v_uid
           ORDER BY rv.created_at DESC
           LIMIT v_limit
        ) t
    ),
    'event_cfp_reviews_written', (
      SELECT COALESCE(jsonb_agg(t.doc ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT r.created_at, jsonb_build_object(
            'event_slug', e.slug,
            'submission_title_pl', s.title_pl, 'submission_title_en', s.title_en,
            'scores', r.scores, 'overall', r.overall, 'recommendation', r.recommendation,
            'comment_private', r.comment_private, 'comment_to_speaker', r.comment_to_speaker,
            'conflict_of_interest', r.conflict_of_interest,
            'created_at', r.created_at, 'updated_at', r.updated_at
          ) AS doc
            FROM public.event_cfp_reviews r
            JOIN public.event_cfp_reviewers rv ON rv.tenant_id = r.tenant_id AND rv.id = r.reviewer_id
            JOIN public.event_cfp_submissions s ON s.tenant_id = r.tenant_id AND s.id = r.submission_id
            JOIN public.events e ON e.tenant_id = r.tenant_id AND e.id = r.event_id
           WHERE r.tenant_id = v_tenant AND rv.user_id = v_uid
           ORDER BY r.created_at DESC
           LIMIT v_limit
        ) t
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_export_my_data(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_export_my_data(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_export_my_data(integer) IS
  'Eksport RODO naboru prelegentow WOLAJACEGO: zgloszenia (wlasne i z jego udzialem), materialy prelegenta, role i wlasne oceny recenzenta. Bez notatki decyzji, cudzych ocen i danych kontaktowych wspolprelegentow (art. 15 ust. 4 RODO). Najemca z profilu wolajacego, tozsamosc z auth.uid().';
