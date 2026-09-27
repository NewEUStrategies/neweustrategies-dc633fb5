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
--      formaty, sciezki i pytania (TYLKO wydarzenia opublikowane);
--      `event_speaker_materials_public(event_id)` - opublikowane materialy
--      prelegentow z listy wydarzenia.
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
--      jak `club_export_my_data`. Wspolprelegent jest rozpoznawany takze po
--      adresie KONTA wpisanym przez zglaszajacego (przed przyjeciem nie ma
--      jeszcze kartoteki).
--
-- DECYZJE, KTORE WARTO ZNAC
--   * OTWARCIE NABORU ROZSTRZYGA BAZA. `status = 'open'` ORAZ okno
--     `opens_at <= now() < closes_at` ORAZ wydarzenie opublikowane - nigdy
--     zegar przegladarki (strona publiczna jest w pamieci krawedzi do doby).
--   * ZGLASZAJACY MA KONTO. Osoba jest wiazana z `auth.uid()` jak w
--     `event_register`: po `event_people.user_id`, potem po adresie KONTA
--     (`auth.users.email`, nie adresie z formularza), inaczej nowa kartoteka
--     `source = 'self_registration'`.
--   * ZGODA NA PRZETWARZANIE DANYCH TYLKO Z JAWNEGO ZAZNACZENIA. Kazdy zapis
--     danych zglaszajacego wymaga `speaker.consent_data_processing = true`
--     (inaczej `consent_required`, jak w `event_register`) - stempel
--     `consent_data_processing_at` nigdy nie powstaje "z urzedu". Kartoteka
--     wspolprelegenta zakladana przy przyjeciu NIE dostaje stempla zgody: ta
--     osoba zadnej zgody nie wyrazila, dane wpisal zglaszajacy.
--   * ZGODA MARKETINGOWA: zaznaczenie ja nadaje, brak zaznaczenia jej nie
--     wycofuje (formularz mowi to wprost i nie udaje wycofania), a wczesniej
--     WYCOFANE zgody (`consent_withdrawn_at`) nie wracaja - ten stempel dotyczy
--     wszystkich zgod naraz, wiec jego skasowanie ozywiloby tez zgode na
--     przekazanie danych partnerom.
--   * PRZYJECIE NIE OGLASZA PRELEGENTA. Przyjecie zaklada kartoteki, nakladki,
--     czlonkostwo w grupie, zapis z biletem i szkic sesji z obsada, ale wpis na
--     PUBLICZNA liste prelegentow (`event_speaker_entries`) powstaje dopiero,
--     gdy prelegent POTWIERDZI udzial - tak, jak obiecuje mail o przyjeciu.
--     Wiersz wystepujacego pamieta, co przyjecie/potwierdzenie DODALO
--     (`added_*`), i dokladnie to jest cofane, gdy prelegent zrezygnuje, wycofa
--     przyjete zgloszenie albo organizator cofnie przyjecie (decyzja z
--     `accepted`/`confirmed` na `waitlisted`/`rejected`): zapis zostaje
--     anulowany, czlonkostwo i wpis na liscie znikaja, obsada sesji zgloszenia
--     jest zdejmowana. Rzeczy, ktore istnialy wczesniej (reczny wpis na liscie,
--     wlasny zapis uczestnika), zostaja nietkniete. Anulowany zapis zwalnia
--     tez zapisy konta na sesje, zakladki planu i RSVP
--     (`_event_participant_release`, jak pelny zwrot), a zapis przekazany juz
--     innej osobie (inny `person_id`) nie jest ruszany.
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
--     pojawia sie po decyzji i TYLKO wtedy, gdy zlozyly sie na nia co najmniej
--     dwie oceny (i nie mniej niz `min_reviews`) - srednia z jednej oceny to
--     ocena jednego recenzenta. Pojedyncze oceny i komentarze recenzentow
--     zostaja u organizatora.
--   * MATERIALY TO ADRESY https (bez wrzutu plikow w tej wersji). Zmiana
--     adresu lub tytulu przez prelegenta zdejmuje publikacje - organizator
--     zatwierdza material jeszcze raz. Opublikowane materialy czyta strona
--     wydarzenia (`event_speaker_materials_public`, dialog profilu prelegenta):
--     `public` kazdy, `registered` tylko osoba z zatwierdzonym zapisem;
--     materialu "tylko dla organizatorow" nie da sie opublikowac.
--   * NOWA DECYZJA KASUJE BLAD WYSYLKI. `notify_error` dotyczy maila
--     o POPRZEDNIEJ decyzji - po nowej decyzji panel ma pokazac "czeka na
--     wyslanie", a nie stary blad.
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
--   Po 20260926090000 (most CRM, segment `event_cfp`) i po 20260926153100
--   (`_event_participant_release` modulu uczestnika).
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
  speaker_profile_id uuid,
  added_roster_entry_id uuid,
  added_group_id uuid,
  added_registration_id uuid,
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
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_cfp_submission_speakers_profile_fk FOREIGN KEY (tenant_id, speaker_profile_id)
    REFERENCES public.speaker_profiles (tenant_id, id) ON DELETE SET NULL (speaker_profile_id),
  CONSTRAINT event_cfp_submission_speakers_entry_fk FOREIGN KEY (tenant_id, added_roster_entry_id)
    REFERENCES public.event_speaker_entries (tenant_id, id) ON DELETE SET NULL (added_roster_entry_id),
  CONSTRAINT event_cfp_submission_speakers_group_fk FOREIGN KEY (tenant_id, event_id, added_group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE SET NULL (added_group_id),
  CONSTRAINT event_cfp_submission_speakers_registration_fk FOREIGN KEY (tenant_id, added_registration_id)
    REFERENCES public.event_registrations (tenant_id, id) ON DELETE SET NULL (added_registration_id)
);

COMMENT ON TABLE public.event_cfp_submission_speakers IS
  'Wystepujacy w zgloszeniu: zglaszajacy (is_primary, person_id od razu) i wspolprelegenci (dane wpisane przez zglaszajacego, person_id nadawany przy przyjeciu). Zapis wylacznie przez RPC naboru.';
COMMENT ON COLUMN public.event_cfp_submission_speakers.speaker_profile_id IS
  'Nakladka sceniczna tej osoby uzyta przy przyjeciu (obsada sesji, wpis na liste po potwierdzeniu).';
COMMENT ON COLUMN public.event_cfp_submission_speakers.added_roster_entry_id IS
  'Wpis na publicznej liscie prelegentow DODANY przez potwierdzenie tego zgloszenia (NULL = wpis istnial wczesniej albo jeszcze go nie ma). Cofany przy rezygnacji, wycofaniu i cofnieciu przyjecia.';
COMMENT ON COLUMN public.event_cfp_submission_speakers.added_group_id IS
  'Grupa, do ktorej przyjecie DOPISALO osobe (NULL = byla w niej wczesniej). Cofane razem z przyjeciem.';
COMMENT ON COLUMN public.event_cfp_submission_speakers.added_registration_id IS
  'Zapis z biletem prelegenta UTWORZONY przez przyjecie (NULL = osoba miala juz aktywny zapis). Anulowany razem z przyjeciem.';

CREATE UNIQUE INDEX IF NOT EXISTS event_cfp_submission_speakers_primary_uniq
  ON public.event_cfp_submission_speakers (tenant_id, submission_id) WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS event_cfp_submission_speakers_email_uniq
  ON public.event_cfp_submission_speakers (tenant_id, submission_id, lower(email))
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_cfp_submission_speakers_person_idx
  ON public.event_cfp_submission_speakers (tenant_id, person_id) WHERE person_id IS NOT NULL;
-- Indeksy pod klucze obce z SET NULL: usuniecie wpisu, zapisu albo nakladki
-- szuka wierszy wystepujacych po tych kolumnach.
CREATE INDEX IF NOT EXISTS event_cfp_submission_speakers_profile_idx
  ON public.event_cfp_submission_speakers (tenant_id, speaker_profile_id)
  WHERE speaker_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_cfp_submission_speakers_entry_idx
  ON public.event_cfp_submission_speakers (tenant_id, added_roster_entry_id)
  WHERE added_roster_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_cfp_submission_speakers_registration_idx
  ON public.event_cfp_submission_speakers (tenant_id, added_registration_id)
  WHERE added_registration_id IS NOT NULL;

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

-- migration-split: part 1/6 of 20260927000100_event_cfp.sql
-- CIAG DALSZY: 20260927000101_event_cfp_part2.sql .. 20260927000105_event_cfp_part6.sql
-- (scripts/split-migration.ts, limit wdrozenia Lovable). SQL wykonywalny
-- czesci 1..6 sklejonych po kolei == SQL tej migracji sprzed podzialu.
-- events-harness: include
