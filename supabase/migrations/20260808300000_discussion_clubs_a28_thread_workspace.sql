-- ============================================================================
-- Kluby dyskusyjne - etap A28: PRZESTRZEN ROBOCZA WATKU
--
-- CO SIE ZMIENIA W MODELU MENTALNYM. Do A27 watek byl POSTEM Z ODPOWIEDZIAMI:
-- tresc otwierajaca, drzewo wypowiedzi, reakcje. To wystarcza forum. Nie
-- wystarcza klubowi, w ktorym watek jest JEDNOSTKA PRACY - zbiera ludzi,
-- zrodla, terminy, pytania i rozstrzygniecia wokol jednej sprawy przez
-- tygodnie. Kazda z tych rzeczy zyla dotad poza platforma: dokumenty w
-- zalacznikach do maila, terminy w cudzych kalendarzach, pytania do
-- prowadzacego w wiadomosciach prywatnych. Wracaly do watku jako link, ktory
-- za trzy miesiace juz nie dzialal.
--
-- A28 daje kazdemu watkowi SZKIELET, ktory nie zalezy od jego rodzaju:
--
--   * DOKUMENTY   - zrodla i materialy z metadanymi (kto, kiedy, skad),
--   * HARMONOGRAM - terminy w czasie; ten sam zbior zasila liste i kalendarz,
--   * PYTANIA     - kolejka Q&A z glosowaniem na waznosc i jedna odpowiedzia,
--   * GLOSOWANIA  - wiele ankiet na watek, na istniejacym silniku `polls`,
--   * POWIAZANIA  - krawedzie do innych watkow z NAZWANA relacja,
--   * UCZESTNICY  - kto realnie wniosl wklad, policzone z tresci,
--   * DANE        - szereg czasowy pod wizualizacje,
--   * SZUKANIE    - jedno pole po calej przestrzeni watku.
--
-- CZTERY DECYZJE, KTORE TRZYMAJA TO W RYZACH:
--
-- 1) ZERO NOWEJ OSI AUTORYZACJI. Kazde RPC tej migracji zaczyna sie od
--    `club_thread_access()`, ktore pyta `club_capabilities()`. Nie ma tu
--    zadnego wlasnego pojecia "kto moze" - bo drugi model uprawnien obok
--    istniejacego rozjezdza sie z nim w pierwszym tygodniu i wtedy dziura
--    w jednym z nich jest niewidoczna z drugiego.
--
-- 2) ANONIMOWOSC JEST FUNKCJA PROJEKCJI (V1 par. 1.2), tak samo jak w A3.
--    author_id zapisujemy zawsze - odpowiedzialnosc i moderacja musza dzialac.
--    RPC odczytowe go NIE ZWRACAJA w trybie chatham. Dotyczy to takze ROLI
--    KLUBOWEJ w liscie uczestnikow: "prowadzacy" przy jednym z czterech
--    aliasow to wystarczajacy sygnal, zeby zdjac anonimowosc z calego watku.
--
-- 3) GLOSOWANIE REUZYWA `polls`. Ta sama decyzja, co w A20 i z tego samego
--    powodu: drugi silnik ankiet obok istniejacego rozjedzie sie z nim.
--    Zmiana wobec A20 jest jedna - kolumna `club_threads.poll_id` niosla
--    DOKLADNIE JEDNA ankiete i tylko dla rodzaju 'poll'. Tabela laczaca
--    zdejmuje oba ograniczenia, nie ruszajac tamtej kolumny (widok watku
--    nadal ja czyta, klienci nadal dzialaja).
--
-- 4) LICZNIKI SA LICZONE, NIE DENORMALIZOWANE. To jest odwrotnie niz
--    w `club_threads.reply_count` - i celowo. Tamten licznik renderuje sie
--    w KAZDYM wierszu listy tematow, wiec COUNT(*) per wiersz byl nie do
--    przyjecia. Te liczniki renderuja sie w JEDNEJ przestrzeni JEDNEGO watku,
--    ktora ma dziesiatki, nie miliony wierszy - a kazdy denormalizowany
--    licznik to trigger, ktory kiedys sie rozjedzie z prawda.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) DOKUMENTY WATKU
--
-- Nie "zalaczniki". Zalacznik jest plikiem doczepionym do wypowiedzi i ginie
-- razem z nia w archiwum. Dokument watku jest POZYCJA BIBLIOGRAFICZNA: ma
-- zrodlo, date wydania i osobe, ktora go wniosla - czyli to, co po roku
-- decyduje, czy da sie z tej dyskusji cokolwiek odtworzyc.
--
-- `url` jest nullowalny, bo rodzaj 'note' to notatka bez pliku (streszczenie
-- ustalen, cytat z posiedzenia). CHECK ponizej pilnuje, ze wszystko POZA
-- notatka ma dokad prowadzic - inaczej lista zrodel wypelnia sie pozycjami,
-- ktorych nie da sie otworzyc.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_thread_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  thread_id     uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  added_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  kind          text NOT NULL DEFAULT 'document'
                CHECK (kind IN ('document', 'dataset', 'link', 'note', 'recording')),
  title         text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
  description   text CHECK (description IS NULL OR char_length(description) <= 2000),
  url           text CHECK (url IS NULL OR char_length(url) <= 2000),

  -- Wydawca, nie autor wpisu: "Rada UE", "Eurostat", "KE - DG COMP".
  source_label  text CHECK (source_label IS NULL OR char_length(source_label) <= 160),
  -- Data DOKUMENTU, nie data dodania. Rozporzadzenie z 2019 dodane dzisiaj
  -- ma stac w bibliografii pod 2019.
  published_on  date,
  mime_type     text CHECK (mime_type IS NULL OR char_length(mime_type) <= 120),
  byte_size     bigint CHECK (byte_size IS NULL OR byte_size >= 0),

  -- Wyroznienie redakcyjne: "to jest TEN dokument, od ktorego sie zaczyna".
  is_primary    boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'visible'
                CHECK (status IN ('visible', 'hidden', 'deleted')),

  search_vector tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('public.nes_polish', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('public.nes_polish', coalesce(description, '')), 'B') ||
                  setweight(to_tsvector('public.nes_polish', coalesce(source_label, '')), 'C')
                ) STORED,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_thread_documents_url_required
    CHECK (kind = 'note' OR NULLIF(btrim(COALESCE(url, '')), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS club_thread_documents_thread_idx
  ON public.club_thread_documents (thread_id, status, is_primary DESC, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS club_thread_documents_search_idx
  ON public.club_thread_documents USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS club_thread_documents_tenant_idx
  ON public.club_thread_documents (tenant_id, club_id);

COMMENT ON TABLE public.club_thread_documents IS
  'Biblioteka zrodel watku. Pozycja bibliograficzna (zrodlo, data wydania, kto wniosl), a nie zalacznik do wypowiedzi.';
COMMENT ON COLUMN public.club_thread_documents.published_on IS
  'Data DOKUMENTU, nie data dodania do watku - bibliografia ma porzadkowac sie po wydaniu.';

-- ----------------------------------------------------------------------------
-- 2) HARMONOGRAM
--
-- JEDEN zbior danych, DWIE prezentacje: lista chronologiczna i siatka
-- miesiaca. Osobna tabela "wydarzen kalendarza" obok "kamieni milowych"
-- gwarantuje, ze po pol roku polowa terminow bedzie tylko w jednej z nich.
--
-- `event_id` jest szwem do modulu wydarzen: spotkanie klubu, ktore ma
-- rejestracje, stream i nagranie, ZYJE w `events` - tutaj stoi wylacznie
-- jego odnosnik. Duplikat opisu spotkania w dwoch tabelach rozjedzie sie
-- przy pierwszej zmianie godziny.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_thread_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id      uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_id     uuid REFERENCES public.events(id) ON DELETE SET NULL,

  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
  description  text CHECK (description IS NULL OR char_length(description) <= 2000),

  kind         text NOT NULL DEFAULT 'milestone'
               CHECK (kind IN ('milestone', 'meeting', 'deadline', 'publication',
                               'vote', 'consultation')),
  status       text NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned', 'active', 'done', 'cancelled')),

  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz,
  -- Termin calodniowy ("konsultacje zamykaja sie 14 wrzesnia") kontra godzina
  -- ("spotkanie o 17:00"). Bez tej flagi klient musialby zgadywac ze strefy
  -- czasowej, a zgadywanie konczy sie terminem przesunietym o dobe.
  all_day      boolean NOT NULL DEFAULT false,
  location     text CHECK (location IS NULL OR char_length(location) <= 240),
  url          text CHECK (url IS NULL OR char_length(url) <= 2000),

  sort_order   integer NOT NULL DEFAULT 0,

  search_vector tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('public.nes_polish', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('public.nes_polish', coalesce(description, '')), 'B')
                ) STORED,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_thread_milestones_span CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS club_thread_milestones_thread_idx
  ON public.club_thread_milestones (thread_id, starts_at, id);
CREATE INDEX IF NOT EXISTS club_thread_milestones_calendar_idx
  ON public.club_thread_milestones (club_id, starts_at);
CREATE INDEX IF NOT EXISTS club_thread_milestones_search_idx
  ON public.club_thread_milestones USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS club_thread_milestones_tenant_idx
  ON public.club_thread_milestones (tenant_id, club_id);

COMMENT ON TABLE public.club_thread_milestones IS
  'Harmonogram watku. JEDEN zbior zasila liste i kalendarz - osobna tabela wydarzen kalendarza rozjechalaby sie z lista w pol roku.';
COMMENT ON COLUMN public.club_thread_milestones.event_id IS
  'Szew do modulu wydarzen: spotkanie z rejestracja zyje w public.events, tutaj stoi jego odnosnik, nie kopia opisu.';

-- ----------------------------------------------------------------------------
-- 3) PYTANIA (Q&A)
--
-- DLACZEGO TO NIE JEST ODPOWIEDZ W DRZEWIE. Odpowiedz jest glosem w dyskusji -
-- rownym innym glosom, sortowanym chronologicznie, bez stanu. Pytanie ma
-- ADRESATA i STAN: albo padla na nie odpowiedz, albo nie. Wrzucone do drzewa
-- ginie w trzydziestu wypowiedziach i nikt nigdy nie zobaczy, ze zostalo bez
-- odpowiedzi - a to jest dokladnie ta informacja, ktorej klub potrzebuje
-- (V1 par. 5.2: watek bez odpowiedzi to porazka klubu, nie neutralny stan).
--
-- Glosowanie na waznosc jest po to, zeby prowadzacy wiedzial, OD KTOREGO
-- pytania zaczac, gdy ma dziesiec minut i dwadziescia pytan.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_thread_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  thread_id     uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  author_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  body          text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 5 AND 2000),
  is_anonymous  boolean NOT NULL DEFAULT false,

  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'answered', 'declined', 'hidden')),

  answer_body   text CHECK (answer_body IS NULL OR char_length(btrim(answer_body)) BETWEEN 1 AND 10000),
  answered_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at   timestamptz,

  -- Denormalizacja z triggera - jedyna w tej migracji. Uzasadnienie: sort
  -- "najwazniejsze" czyta ja przy KAZDYM otwarciu panelu pytan, a liczenie
  -- COUNT(*) per pytanie zamienia dwadziescia pytan w dwadziescia podzapytan.
  vote_count    integer NOT NULL DEFAULT 0,

  search_vector tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('public.nes_polish', coalesce(body, '')), 'A') ||
                  setweight(to_tsvector('public.nes_polish', coalesce(answer_body, '')), 'B')
                ) STORED,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Stan 'answered' bez tresci odpowiedzi jest klamstwem interfejsu.
  CONSTRAINT club_thread_questions_answer_pair
    CHECK (status <> 'answered' OR NULLIF(btrim(COALESCE(answer_body, '')), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS club_thread_questions_thread_idx
  ON public.club_thread_questions (thread_id, status, vote_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS club_thread_questions_search_idx
  ON public.club_thread_questions USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS club_thread_questions_tenant_idx
  ON public.club_thread_questions (tenant_id, club_id);

COMMENT ON TABLE public.club_thread_questions IS
  'Kolejka Q&A watku. Pytanie ma STAN (bez odpowiedzi / z odpowiedzia) - dlatego nie jest odpowiedzia w drzewie, gdzie stan nie istnieje i brak reakcji jest niewidoczny.';

CREATE TABLE IF NOT EXISTS public.club_thread_question_votes (
  question_id uuid NOT NULL REFERENCES public.club_thread_questions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS club_thread_question_votes_user_idx
  ON public.club_thread_question_votes (user_id, question_id);

COMMENT ON TABLE public.club_thread_question_votes IS
  'Glos na waznosc pytania. Klucz glowny (pytanie, osoba) czyni podwojny glos niemozliwym w MODELU, a nie w warstwie aplikacji.';

-- ----------------------------------------------------------------------------
-- 4) POWIAZANIA MIEDZY WATKAMI
--
-- Kotwica (`club_threads.anchor_*`) laczy watek z TRESCIA PLATFORMY - aktem
-- prawnym, wpisem, wydarzeniem. Nie laczy watku z WATKIEM, a to jest inna
-- relacja i innej sily: "ten watek jest kontynuacja tamtego", "ten watek
-- przeczy tamtemu". Bez tego dyskusja z maja i jej ciag dalszy z wrzesnia sa
-- dwoma niepowiazanymi ekranami.
--
-- Relacja jest NAZWANA i SKIEROWANA. "Powiazane" bez nazwy relacji to zbior
-- linkow, z ktorego nie wynika nic; "przeczy" niesie informacje, ktorej nie
-- da sie odczytac z samego sasiedztwa.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_thread_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  thread_id         uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  related_thread_id uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  relation          text NOT NULL DEFAULT 'context'
                    CHECK (relation IN ('continues', 'supersedes', 'contradicts',
                                        'supports', 'duplicates', 'context')),
  note              text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_thread_links_not_self CHECK (thread_id <> related_thread_id),
  CONSTRAINT club_thread_links_unique UNIQUE (thread_id, related_thread_id)
);

CREATE INDEX IF NOT EXISTS club_thread_links_thread_idx
  ON public.club_thread_links (thread_id, relation);
CREATE INDEX IF NOT EXISTS club_thread_links_reverse_idx
  ON public.club_thread_links (related_thread_id);
CREATE INDEX IF NOT EXISTS club_thread_links_tenant_idx
  ON public.club_thread_links (tenant_id, club_id);

COMMENT ON TABLE public.club_thread_links IS
  'Krawedz watek->watek z NAZWANA relacja. Kotwica laczy watek z trescia platformy; to laczy watek z watkiem, czego kotwica nie robi.';

-- ----------------------------------------------------------------------------
-- 5) GLOSOWANIA WATKU
--
-- A20 dalo watkowi JEDNA ankiete i tylko rodzajowi 'poll'. To wystarcza
-- sondazowi, nie wystarcza dyskusji, ktora po trzech tygodniach potrzebuje
-- rozstrzygniecia w trzech sprawach naraz. Tabela laczaca zdejmuje oba
-- ograniczenia i NIE RUSZA kolumny `club_threads.poll_id` - widok watku nadal
-- ja czyta, a klienci sprzed tej migracji dzialaja bez zmian.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_thread_polls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  thread_id  uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  poll_id    uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label      text CHECK (label IS NULL OR char_length(label) <= 200),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_thread_polls_unique UNIQUE (thread_id, poll_id)
);

CREATE INDEX IF NOT EXISTS club_thread_polls_thread_idx
  ON public.club_thread_polls (thread_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS club_thread_polls_tenant_idx
  ON public.club_thread_polls (tenant_id, club_id);

COMMENT ON TABLE public.club_thread_polls IS
  'Wiele glosowan na watek, na silniku public.polls. Kolumna club_threads.poll_id zostaje nietknieta - klienci sprzed A28 dzialaja bez zmian.';

-- ----------------------------------------------------------------------------
-- 6) RLS: deny-all, dostep wylacznie przez RPC
--
-- Ta sama doktryna, co w A1-A5: tabele modulu nie maja grantow dla klienta,
-- wiec `supabase.from("club_thread_documents")` zwraca pusty zbior nawet
-- adminowi. Cala autoryzacja zyje w SECURITY DEFINER, w jednym miejscu.
-- ----------------------------------------------------------------------------
ALTER TABLE public.club_thread_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_thread_milestones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_thread_questions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_thread_question_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_thread_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_thread_polls          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.club_thread_documents      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_thread_milestones     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_thread_questions      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_thread_question_votes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_thread_links          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_thread_polls          FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.club_thread_documents      TO service_role;
GRANT ALL ON public.club_thread_milestones     TO service_role;
GRANT ALL ON public.club_thread_questions      TO service_role;
GRANT ALL ON public.club_thread_question_votes TO service_role;
GRANT ALL ON public.club_thread_links          TO service_role;
GRANT ALL ON public.club_thread_polls          TO service_role;

-- Tenant pochodzi z KLUBU, nie z sesji piszacego. Ten sam trigger, co na
-- grupach, czlonkach, watkach i odpowiedziach - wiersz przypiety do innego
-- tenantu niz jego klub jest nieosiagalny przez KONSTRUKCJE, a nie przez
-- dyscypline autora RPC.
DROP TRIGGER IF EXISTS club_thread_documents_pin_tenant_tg ON public.club_thread_documents;
CREATE TRIGGER club_thread_documents_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_thread_documents
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_thread_milestones_pin_tenant_tg ON public.club_thread_milestones;
CREATE TRIGGER club_thread_milestones_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_thread_milestones
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_thread_questions_pin_tenant_tg ON public.club_thread_questions;
CREATE TRIGGER club_thread_questions_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_thread_questions
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_thread_links_pin_tenant_tg ON public.club_thread_links;
CREATE TRIGGER club_thread_links_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_thread_links
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_thread_polls_pin_tenant_tg ON public.club_thread_polls;
CREATE TRIGGER club_thread_polls_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_thread_polls
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_thread_documents_set_updated_tg ON public.club_thread_documents;
CREATE TRIGGER club_thread_documents_set_updated_tg BEFORE UPDATE ON public.club_thread_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_thread_milestones_set_updated_tg ON public.club_thread_milestones;
CREATE TRIGGER club_thread_milestones_set_updated_tg BEFORE UPDATE ON public.club_thread_milestones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_thread_questions_set_updated_tg ON public.club_thread_questions;
CREATE TRIGGER club_thread_questions_set_updated_tg BEFORE UPDATE ON public.club_thread_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Glos na pytanie: tenant z PYTANIA (glosujacy moze byc z innego kontekstu
-- hosta, wiersz nalezy do klubu). Trigger wlasny, bo tabela nie ma club_id -
-- klucz glowny (pytanie, osoba) i tak wiaze ja z klubem przez pytanie.
CREATE OR REPLACE FUNCTION public.club_question_vote_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT q.tenant_id INTO v_tenant
    FROM public.club_thread_questions q WHERE q.id = NEW.question_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: unknown question %', NEW.question_id USING ERRCODE = '23503';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.club_question_vote_pin_tenant() IS
  'Przypina tenant glosu do tenantu PYTANIA. Tabela glosow nie ma club_id, wiec club_child_pin_tenant() jej nie obsluzy.';

DROP TRIGGER IF EXISTS club_thread_question_votes_pin_tenant_tg
  ON public.club_thread_question_votes;
CREATE TRIGGER club_thread_question_votes_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_thread_question_votes
  FOR EACH ROW EXECUTE FUNCTION public.club_question_vote_pin_tenant();

-- Licznik glosow - jedyna denormalizacja tej migracji (uzasadnienie przy
-- kolumnie `vote_count`).
CREATE OR REPLACE FUNCTION public.club_question_votes_sync_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_question uuid := COALESCE(NEW.question_id, OLD.question_id);
BEGIN
  UPDATE public.club_thread_questions q
     SET vote_count = (
           SELECT count(*)::int FROM public.club_thread_question_votes v
            WHERE v.question_id = v_question
         )
   WHERE q.id = v_question;
  RETURN NULL;
END; $$;

COMMENT ON FUNCTION public.club_question_votes_sync_count() IS
  'Utrzymuje club_thread_questions.vote_count. Sort "najwazniejsze" czyta ten licznik przy kazdym otwarciu panelu pytan.';

DROP TRIGGER IF EXISTS club_thread_question_votes_sync_tg ON public.club_thread_question_votes;
CREATE TRIGGER club_thread_question_votes_sync_tg
  AFTER INSERT OR DELETE ON public.club_thread_question_votes
  FOR EACH ROW EXECUTE FUNCTION public.club_question_votes_sync_count();

-- ============================================================================
-- 7) JEDEN SZEW AUTORYZACJI
--
-- Kazde RPC tej migracji zaczyna sie tutaj. Powod jest ten sam, dla ktorego
-- A12 wyniosl `club_thread_seam_context` z trzech triggerow do jednej funkcji:
-- dwadziescia kopii tej samej bramki to dwadziescia miejsc, ktore musza sie
-- zgadzac - i beda sie zgadzac dokladnie do pierwszej poprawki w jednym z nich.
--
-- Funkcja jest wewnetrzna (service_role). Wolana z ciala innej funkcji
-- SECURITY DEFINER dziala na uprawnieniach WLASCICIELA, wiec klient nie
-- potrzebuje do niej grantu - i nie dostaje go, zeby nie dalo sie odpytywac
-- zdolnosci cudzego watku poza kontekstem, w ktorym maja sens.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_thread_access(p_thread_id uuid)
RETURNS TABLE (
  thread_id        uuid,
  club_id          uuid,
  group_id         uuid,
  tenant_id        uuid,
  author_id        uuid,
  attribution_mode text,
  is_locked        boolean,
  hide_identity    boolean,
  can_read         boolean,
  can_reply        boolean,
  can_moderate     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.club_id, t.group_id, t.tenant_id, t.author_id,
    attr.mode,
    (t.locked_at IS NOT NULL OR t.status IN ('locked', 'hidden', 'deleted')),
    -- Tozsamosci NIE ujawniamy takze wtedy, gdy sam watek jest anonimowy:
    -- klub moze byc 'attributed', a konkretny watek zalozony pod aliasem.
    (t.is_anonymous OR attr.mode = 'chatham'),
    cap.can_read,
    -- Wklad do przestrzeni roboczej idzie ta sama bramka, co odpowiedz:
    -- kto moze sie wypowiedziec, ten moze wniesc zrodlo i zadac pytanie.
    (cap.can_reply AND t.locked_at IS NULL AND t.status NOT IN ('locked', 'hidden', 'deleted')),
    cap.can_moderate
  FROM public.club_threads t
  JOIN public.club_groups g ON g.id = t.group_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL (SELECT COALESCE(g.attribution_mode, c.attribution_mode) AS mode) attr
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE t.id = p_thread_id
$$;

COMMENT ON FUNCTION public.club_thread_access(uuid) IS
  'Jedyna bramka przestrzeni roboczej watku. Kazde RPC A28 zaczyna sie tutaj - drugi model uprawnien obok club_capabilities rozjechalby sie z nim w pierwszym tygodniu.';

REVOKE EXECUTE ON FUNCTION public.club_thread_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_thread_access(uuid) TO service_role;

-- ============================================================================
-- 8) ODCZYT: UCZESTNICY
--
-- "Kto tu jest" liczone z TRESCI, nie z listy czlonkow klubu. Czlonek, ktory
-- nic nie napisal, nie jest uczestnikiem TEGO watku - a wlasnie ta roznica
-- jest cala wartoscia panelu.
--
-- REGULA CHATHAM HOUSE W TYM MIEJSCU JEST OSTRZEJSZA NIZ GDZIE INDZIEJ. Poza
-- imieniem chowamy takze ROLE KLUBOWA: "prowadzacy" przy jednym z czterech
-- aliasow wystarczy, zeby zdjac anonimowosc z calego watku. Alias jest
-- salowany per watek (A3), wiec nie da sie skorelowac tej samej osoby miedzy
-- watkami.
--
-- ANONIMOWOSC JEST LICZONA PER WPIS, NIE PER OSOBA - i to jest najwazniejsza
-- decyzja tej funkcji. Osoba moze miec w jednym watku trzy wypowiedzi jawne
-- i jedna anonimowa (klub w trybie 'anonymous_allowed'). Zsumowanie ich
-- w JEDNYM wierszu z jej imieniem przypisaloby jej anonimowa wypowiedz
-- czarno na bialym - czyli zlamaloby dokladnie te ochrone, ktora wlaczyla,
-- klikajac "opublikuj anonimowo".
--
-- Dlatego grupujemy po (osoba, anonimowosc wpisu): ta sama osoba moze
-- wystapic DWA RAZY - raz z imieniem i licznikiem wpisow jawnych, raz pod
-- aliasem watku z licznikiem anonimowych. Z zewnatrz sa nierozroznialne, bo
-- wiersz aliasowy nie niesie ani identyfikatora, ani roli, ani stanowiska.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_thread_participants(
  p_thread_id uuid,
  p_limit     integer DEFAULT 50
)
RETURNS TABLE (
  participant_key    text,
  user_id            uuid,
  display_name       text,
  avatar_url         text,
  profile_slug       text,
  alias              text,
  club_role          text,
  is_thread_author   boolean,
  reply_count        integer,
  question_count     integer,
  document_count     integer,
  reactions_received integer,
  stance             text,
  first_at           timestamptz,
  last_at            timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  ),
  -- Wklad zbieramy z czterech zrodel, KAZDE ze swoja wlasna flaga anonimowosci.
  -- Autor watku wchodzi z licznikiem wypowiedzi zero - inaczej osoba, ktora
  -- otworzyla dyskusje i nie wrocila, znikalaby z listy uczestnikow wlasnej
  -- dyskusji.
  contributions AS (
    SELECT
      t.author_id AS uid,
      (acc.hide_identity OR t.is_anonymous) AS anon,
      true  AS author_post,
      0 AS replies, 0 AS questions, 0 AS documents, 0 AS reactions,
      t.created_at AS at
      FROM acc JOIN public.club_threads t ON t.id = acc.thread_id
     WHERE t.author_id IS NOT NULL
    UNION ALL
    SELECT r.author_id, (acc.hide_identity OR r.is_anonymous), false,
           1, 0, 0, r.reaction_count, r.created_at
      FROM acc JOIN public.club_replies r ON r.thread_id = acc.thread_id
     WHERE r.status IN ('visible', 'pending') AND r.author_id IS NOT NULL
    UNION ALL
    SELECT q.author_id, (acc.hide_identity OR q.is_anonymous), false,
           0, 1, 0, 0, q.created_at
      FROM acc JOIN public.club_thread_questions q ON q.thread_id = acc.thread_id
     WHERE q.status <> 'hidden' AND q.author_id IS NOT NULL
    UNION ALL
    -- Zrodlo nie ma wlasnej flagi: wniesienie dokumentu nie jest aktem
    -- anonimowym, wiec chowa je wylacznie tryb chatham calego watku.
    SELECT d.added_by, acc.hide_identity, false,
           0, 0, 1, 0, d.created_at
      FROM acc JOIN public.club_thread_documents d ON d.thread_id = acc.thread_id
     WHERE d.status = 'visible' AND d.added_by IS NOT NULL
  ),
  -- Grupowanie po (osoba, anonimowosc) - patrz naglowek sekcji. To jest
  -- jedyny powod, dla ktorego `anon` jest w kluczu grupowania.
  rolled AS (
    SELECT
      uid,
      anon,
      bool_or(author_post)  AS author_post,
      sum(replies)::int     AS replies,
      sum(questions)::int   AS questions,
      sum(documents)::int   AS documents,
      sum(reactions)::int   AS reactions,
      min(at)               AS first_at,
      max(at)               AS last_at
    FROM contributions
    GROUP BY uid, anon
  )
  SELECT
    -- Klucz listy: identyfikator dla wierszy jawnych, alias dla anonimowych.
    -- Identyfikator NIGDY nie trafia do klucza wiersza aliasowego - klucz idzie
    -- do atrybutu w DOM, wiec byloby to ujawnienie przez tylne drzwi.
    CASE WHEN rolled.anon
         THEN 'alias:' || public.club_author_alias(acc.thread_id, rolled.uid)
         ELSE 'user:' || rolled.uid::text END,
    CASE WHEN rolled.anon THEN NULL ELSE rolled.uid END,
    CASE WHEN rolled.anon THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN rolled.anon OR p.hide_avatar THEN NULL ELSE p.avatar_url END,
    CASE WHEN rolled.anon THEN NULL ELSE p.slug END,
    CASE WHEN rolled.anon
         THEN public.club_author_alias(acc.thread_id, rolled.uid) ELSE NULL END,
    -- Rola takze pod ochrona - patrz naglowek sekcji.
    CASE WHEN rolled.anon THEN NULL
         ELSE public.club_effective_member_role(cm.role, cm.role_expires_at) END,
    -- Znacznik autora laduje na tym wierszu, ktory NIESIE post otwierajacy -
    -- jawnym albo aliasowym. Alias autora i tak stoi juz nad trescia watku,
    -- wiec nie ujawnia niczego nowego.
    rolled.author_post,
    rolled.replies, rolled.questions, rolled.documents, rolled.reactions,
    -- Stanowisko jest deklaracja IMIENNA (jedna na osobe i watek), wiec stoi
    -- wylacznie przy wierszu jawnym - przy aliasie wiazaloby anonimowy wklad
    -- z publiczna deklaracja tej samej osoby.
    CASE WHEN rolled.anon THEN NULL ELSE st.stance END,
    rolled.first_at,
    rolled.last_at
  FROM acc
  JOIN rolled ON true
  LEFT JOIN public.profiles p ON p.id = rolled.uid
  LEFT JOIN public.club_members cm
         ON cm.club_id = acc.club_id AND cm.user_id = rolled.uid AND cm.status = 'active'
  LEFT JOIN public.club_stances st
         ON st.thread_id = acc.thread_id AND st.user_id = rolled.uid
  ORDER BY rolled.author_post DESC, rolled.replies DESC, rolled.last_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
$$;

COMMENT ON FUNCTION public.club_thread_participants(uuid, integer) IS
  'Uczestnicy watku liczeni z TRESCI (wypowiedzi, pytania, zrodla), nie z listy czlonkow klubu. Grupuje po (osoba, anonimowosc WPISU), wiec wklad jawny i anonimowy tej samej osoby stoi w dwoch nierozroznialnych wierszach. W trybie chatham chowa takze ROLE - "prowadzacy" przy aliasie deanonimizuje watek.';

REVOKE EXECUTE ON FUNCTION public.club_thread_participants(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_participants(uuid, integer)
  TO anon, authenticated, service_role;

-- ============================================================================
-- 9) ODCZYT: SPIS TRESCI PRZESTRZENI
--
-- Jedno wywolanie na cala belke zakladek. Osiem zapytan liczacych po jednym
-- liczniku to osiem round-tripow, zanim czytelnik zobaczy, ze w watku nie ma
-- ZADNEGO dokumentu - a wlasnie ta informacja decyduje, czy w ogole klika.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_thread_workspace(p_thread_id uuid)
RETURNS TABLE (
  thread_id          uuid,
  document_count     integer,
  milestone_count    integer,
  upcoming_count     integer,
  question_count     integer,
  open_question_count integer,
  poll_count         integer,
  open_poll_count    integer,
  link_count         integer,
  participant_count  integer,
  reply_count        integer,
  next_milestone_at  timestamptz,
  can_contribute     boolean,
  can_curate         boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    acc.thread_id,
    (SELECT count(*)::int FROM public.club_thread_documents d
      WHERE d.thread_id = acc.thread_id AND d.status = 'visible'),
    (SELECT count(*)::int FROM public.club_thread_milestones m
      WHERE m.thread_id = acc.thread_id AND m.status <> 'cancelled'),
    (SELECT count(*)::int FROM public.club_thread_milestones m
      WHERE m.thread_id = acc.thread_id AND m.status IN ('planned', 'active')
        AND COALESCE(m.ends_at, m.starts_at) >= now()),
    (SELECT count(*)::int FROM public.club_thread_questions q
      WHERE q.thread_id = acc.thread_id AND q.status <> 'hidden'),
    (SELECT count(*)::int FROM public.club_thread_questions q
      WHERE q.thread_id = acc.thread_id AND q.status = 'open'),
    (SELECT count(*)::int FROM public.club_thread_polls tp
      WHERE tp.thread_id = acc.thread_id),
    (SELECT count(*)::int FROM public.club_thread_polls tp
      JOIN public.polls p ON p.id = tp.poll_id
      WHERE tp.thread_id = acc.thread_id AND p.status = 'open'
        AND (p.ends_at IS NULL OR p.ends_at > now())),
    -- Krawedzie licza sie W OBIE STRONY: watek wskazany przez inny jest
    -- powiazany tak samo mocno, jak ten, ktory wskazuje.
    (SELECT count(*)::int FROM public.club_thread_links l
      WHERE l.thread_id = acc.thread_id OR l.related_thread_id = acc.thread_id),
    -- Uczestnicy liczeni PRZEZ TE SAMA funkcje, ktora rysuje liste, a nie
    -- z denormalizowanego `club_threads.participant_count`. Tamten licznik
    -- zna wylacznie autorow odpowiedzi, a panel zbiera takze pytajacych,
    -- wnoszacych zrodla i - osobnym wierszem - wklad anonimowy tej samej
    -- osoby. Odznaka "7" nad lista dziewieciu wierszy to dokladnie ten rodzaj
    -- rozjazdu, ktory kaze czytelnikowi przestac ufac licznikom.
    (SELECT count(*)::int FROM public.club_thread_participants(acc.thread_id, 200)),
    t.reply_count,
    (SELECT min(m.starts_at) FROM public.club_thread_milestones m
      WHERE m.thread_id = acc.thread_id AND m.status IN ('planned', 'active')
        AND m.starts_at >= now()),
    acc.can_reply,
    acc.can_moderate
  FROM acc
  JOIN public.club_threads t ON t.id = acc.thread_id
$$;

COMMENT ON FUNCTION public.club_thread_workspace(uuid) IS
  'Spis tresci przestrzeni roboczej watku: liczniki wszystkich paneli i dwie flagi uprawnien w JEDNYM wywolaniu. Pusty zbior = brak prawa odczytu watku.';

REVOKE EXECUTE ON FUNCTION public.club_thread_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_workspace(uuid)
  TO anon, authenticated, service_role;

-- ============================================================================
-- 10) ODCZYT: DOKUMENTY, HARMONOGRAM, PYTANIA, POWIAZANIA, GLOSOWANIA
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_thread_documents_list(
  p_thread_id uuid,
  p_kind      text DEFAULT NULL,
  p_limit     integer DEFAULT 100
)
RETURNS TABLE (
  id            uuid,
  kind          text,
  title         text,
  description   text,
  url           text,
  source_label  text,
  published_on  date,
  mime_type     text,
  byte_size     bigint,
  is_primary    boolean,
  sort_order    integer,
  added_by_id   uuid,
  added_by_name text,
  added_by_slug text,
  created_at    timestamptz,
  can_edit      boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    d.id, d.kind, d.title, d.description, d.url, d.source_label,
    d.published_on, d.mime_type, d.byte_size, d.is_primary, d.sort_order,
    CASE WHEN acc.hide_identity THEN NULL ELSE d.added_by END,
    CASE WHEN acc.hide_identity THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN acc.hide_identity THEN NULL ELSE p.slug END,
    d.created_at,
    -- Redakcja wlasnej pozycji albo moderacja. Liczona TU, a nie w kliencie:
    -- pod regula Chatham House `added_by` nie wychodzi z RPC, wiec klient nie
    -- ma jak porownac autorstwa i przycisk zniknalby wlascicielowi wpisu.
    (acc.can_moderate OR (d.added_by IS NOT NULL AND d.added_by = auth.uid()))
  FROM acc
  JOIN public.club_thread_documents d ON d.thread_id = acc.thread_id
  LEFT JOIN public.profiles p ON p.id = d.added_by
  WHERE (d.status = 'visible' OR (d.status = 'hidden' AND acc.can_moderate))
    AND (p_kind IS NULL OR d.kind = p_kind)
  ORDER BY d.is_primary DESC, d.sort_order, d.published_on DESC NULLS LAST, d.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
$$;

COMMENT ON FUNCTION public.club_thread_documents_list(uuid, text, integer) IS
  'Biblioteka zrodel watku. can_edit liczone po stronie bazy, bo w trybie chatham klient nie widzi added_by i nie mialby jak rozpoznac wlasnej pozycji.';

REVOKE EXECUTE ON FUNCTION public.club_thread_documents_list(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_documents_list(uuid, text, integer)
  TO anon, authenticated, service_role;

-- Harmonogram. `p_from`/`p_to` obsluguja siatke miesiaca w kalendarzu; bez nich
-- zwraca caly harmonogram watku (widok listy).
CREATE OR REPLACE FUNCTION public.club_thread_milestones_list(
  p_thread_id uuid,
  p_from      timestamptz DEFAULT NULL,
  p_to        timestamptz DEFAULT NULL,
  p_limit     integer DEFAULT 200
)
RETURNS TABLE (
  id           uuid,
  kind         text,
  status       text,
  title        text,
  description  text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  all_day      boolean,
  location     text,
  url          text,
  sort_order   integer,
  event_id     uuid,
  event_slug   text,
  owner_id     uuid,
  owner_name   text,
  owner_slug   text,
  created_at   timestamptz,
  can_edit     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    m.id, m.kind, m.status, m.title, m.description,
    m.starts_at, m.ends_at, m.all_day, m.location, m.url, m.sort_order,
    m.event_id, e.slug,
    -- Wlasciciel terminu to funkcja organizacyjna, nie glos w dyskusji -
    -- ale w trybie chatham nadal nie wolno go pokazac, bo laczy nazwisko
    -- z watkiem.
    CASE WHEN acc.hide_identity THEN NULL ELSE m.owner_id END,
    CASE WHEN acc.hide_identity THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN acc.hide_identity THEN NULL ELSE p.slug END,
    m.created_at,
    acc.can_moderate
  FROM acc
  JOIN public.club_thread_milestones m ON m.thread_id = acc.thread_id
  LEFT JOIN public.profiles p ON p.id = m.owner_id
  LEFT JOIN public.events e ON e.id = m.event_id
  WHERE (p_from IS NULL OR COALESCE(m.ends_at, m.starts_at) >= p_from)
    AND (p_to IS NULL OR m.starts_at <= p_to)
  ORDER BY m.starts_at, m.sort_order, m.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
$$;

COMMENT ON FUNCTION public.club_thread_milestones_list(uuid, timestamptz, timestamptz, integer) IS
  'Harmonogram watku. Zakres p_from/p_to zasila siatke miesiaca; bez niego zwraca caly harmonogram (widok listy). Jeden zbior, dwie prezentacje.';

REVOKE EXECUTE ON FUNCTION
  public.club_thread_milestones_list(uuid, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.club_thread_milestones_list(uuid, timestamptz, timestamptz, integer)
  TO anon, authenticated, service_role;

-- Pytania. Sort domyslny to 'top' - prowadzacy z dziesiecioma minutami ma
-- zaczac od tego, co ludzi obchodzi najbardziej, a nie od tego, co przyszlo
-- pierwsze.
CREATE OR REPLACE FUNCTION public.club_thread_questions_list(
  p_thread_id uuid,
  p_status    text DEFAULT NULL,
  p_sort      text DEFAULT 'top',
  p_limit     integer DEFAULT 100
)
RETURNS TABLE (
  id             uuid,
  body           text,
  status         text,
  answer_body    text,
  answered_at    timestamptz,
  answered_by_id uuid,
  answered_by_name text,
  vote_count     integer,
  my_vote        boolean,
  author_id      uuid,
  author_name    text,
  author_avatar  text,
  author_slug    text,
  author_alias   text,
  created_at     timestamptz,
  can_answer     boolean,
  can_edit       boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    q.id, q.body, q.status, q.answer_body, q.answered_at,
    -- Odpowiadajacy jest WIDOCZNY takze w trybie chatham i to jest swiadome:
    -- odpowiedz prowadzacego na pytanie jest aktem oficjalnym, a anonimowa
    -- "odpowiedz klubu" nie zobowiazuje nikogo do niczego. Chroniona jest
    -- tozsamosc PYTAJACEGO, bo to on ryzykuje.
    q.answered_by,
    COALESCE(NULLIF(btrim(pa.display_name), ''), 'User'),
    q.vote_count,
    EXISTS (SELECT 1 FROM public.club_thread_question_votes v
             WHERE v.question_id = q.id AND v.user_id = auth.uid()),
    CASE WHEN acc.hide_identity OR q.is_anonymous THEN NULL ELSE q.author_id END,
    CASE WHEN acc.hide_identity OR q.is_anonymous THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN acc.hide_identity OR q.is_anonymous OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN acc.hide_identity OR q.is_anonymous THEN NULL ELSE p.slug END,
    CASE WHEN acc.hide_identity OR q.is_anonymous
         THEN public.club_author_alias(acc.thread_id, q.author_id) ELSE NULL END,
    q.created_at,
    -- Na pytanie odpowiada moderacja albo autor watku: to jego dyskusja
    -- i on jest adresatem pytan, nawet gdy nie moderuje klubu.
    (acc.can_moderate OR (acc.author_id IS NOT NULL AND acc.author_id = auth.uid())),
    (acc.can_moderate OR (q.author_id IS NOT NULL AND q.author_id = auth.uid()))
  FROM acc
  JOIN public.club_thread_questions q ON q.thread_id = acc.thread_id
  LEFT JOIN public.profiles p ON p.id = q.author_id
  LEFT JOIN public.profiles pa ON pa.id = q.answered_by
  WHERE (q.status <> 'hidden' OR acc.can_moderate)
    AND (p_status IS NULL OR q.status = p_status)
  ORDER BY
    CASE WHEN p_sort = 'top' THEN q.vote_count END DESC NULLS LAST,
    CASE WHEN p_sort = 'unanswered' AND q.status = 'open' THEN 0 ELSE 1 END,
    q.created_at DESC,
    q.id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 300))
$$;

COMMENT ON FUNCTION public.club_thread_questions_list(uuid, text, text, integer) IS
  'Kolejka Q&A. Chroniona jest tozsamosc PYTAJACEGO; odpowiadajacy jest jawny takze w trybie chatham, bo anonimowa odpowiedz klubu nie zobowiazuje nikogo.';

REVOKE EXECUTE ON FUNCTION public.club_thread_questions_list(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_questions_list(uuid, text, text, integer)
  TO anon, authenticated, service_role;

-- Powiazane watki. Krawedz czytamy W OBIE STRONY, bo relacja "kontynuuje"
-- jest tak samo warta pokazania z obu koncow - z drugiego jako "poprzedza".
-- Widocznosc drugiego konca liczy jego WLASNE club_capabilities: watek
-- z klubu, do ktorego czytelnik nie nalezy, nie moze wyciec przez krawedz.
CREATE OR REPLACE FUNCTION public.club_thread_links_list(p_thread_id uuid)
RETURNS TABLE (
  id            uuid,
  relation      text,
  direction     text,
  note          text,
  thread_id     uuid,
  thread_slug   text,
  title         text,
  kind          text,
  status        text,
  club_slug     text,
  club_name_pl  text,
  club_name_en  text,
  reply_count   integer,
  last_reply_at timestamptz,
  created_at    timestamptz,
  can_remove    boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  ),
  edges AS (
    SELECT l.id, l.relation, 'outgoing'::text AS direction, l.note,
           l.related_thread_id AS other_id, l.created_at
      FROM acc JOIN public.club_thread_links l ON l.thread_id = acc.thread_id
    UNION ALL
    SELECT l.id, l.relation, 'incoming'::text, l.note,
           l.thread_id, l.created_at
      FROM acc JOIN public.club_thread_links l ON l.related_thread_id = acc.thread_id
  )
  SELECT
    e.id, e.relation, e.direction, e.note,
    t.id, t.slug, t.title, t.kind, t.status,
    c.slug, c.name_pl, c.name_en,
    t.reply_count, t.last_reply_at, e.created_at,
    acc.can_moderate
  FROM edges e
  CROSS JOIN acc
  JOIN public.club_threads t ON t.id = e.other_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) other_cap
  WHERE other_cap.can_read
    AND t.status IN ('open', 'resolved', 'dormant', 'locked')
  ORDER BY e.created_at DESC
$$;

COMMENT ON FUNCTION public.club_thread_links_list(uuid) IS
  'Powiazane watki w OBIE strony. Widocznosc drugiego konca liczy jego wlasne club_capabilities - krawedz nie moze wyciec watku z klubu, do ktorego czytelnik nie ma wstepu.';

REVOKE EXECUTE ON FUNCTION public.club_thread_links_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_links_list(uuid)
  TO anon, authenticated, service_role;

-- Glosowania watku. Zwraca IDENTYFIKATORY ankiet - tresci i glosowania
-- dostarcza istniejaca warstwa `polls` (get_poll_results / vote_poll), ktorej
-- ta migracja nie dubluje.
CREATE OR REPLACE FUNCTION public.club_thread_polls_list(p_thread_id uuid)
RETURNS TABLE (
  id          uuid,
  poll_id     uuid,
  label       text,
  sort_order  integer,
  question_pl text,
  question_en text,
  poll_status text,
  ends_at     timestamptz,
  created_at  timestamptz,
  can_remove  boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  )
  SELECT
    tp.id, tp.poll_id, tp.label, tp.sort_order,
    p.question_pl, p.question_en, p.status, p.ends_at, tp.created_at,
    acc.can_moderate
  FROM acc
  JOIN public.club_thread_polls tp ON tp.thread_id = acc.thread_id
  JOIN public.polls p ON p.id = tp.poll_id
  ORDER BY tp.sort_order, tp.created_at
$$;

COMMENT ON FUNCTION public.club_thread_polls_list(uuid) IS
  'Glosowania wpiete w watek. Zwraca identyfikatory - tresc i oddanie glosu obsluguje istniejaca warstwa polls, ktorej ta migracja nie dubluje.';

REVOKE EXECUTE ON FUNCTION public.club_thread_polls_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_polls_list(uuid)
  TO anon, authenticated, service_role;

-- ============================================================================
-- 11) ODCZYT: WYSZUKIWARKA WEWNETRZNA
--
-- Wyszukiwarka klubowa (`club_search`, A7) odpowiada na pytanie "w KTORYM
-- watku o tym mowiono". Ta odpowiada na inne: "GDZIE W TYM watku". Po trzech
-- miesiacach i dwustu wypowiedziach to jest roznica miedzy odnalezieniem
-- ustalenia a przeczytaniem calosci od nowa.
--
-- Cztery sekcje w jednym wyniku, bo czytelnik szuka TRESCI, a nie sekcji -
-- i nie wie z gory, czy termin padl w wypowiedzi, w opisie zrodla, czy
-- w nazwie terminu.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_thread_search(
  p_thread_id uuid,
  p_query     text,
  p_limit     integer DEFAULT 30
)
RETURNS TABLE (
  section      text,
  item_id      uuid,
  title        text,
  snippet      text,
  occurred_at  timestamptz,
  author_label text,
  rank         real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  ),
  q AS (
    SELECT websearch_to_tsquery('public.nes_polish', btrim(COALESCE(p_query, ''))) AS tsq
  ),
  hits AS (
    SELECT
      'reply'::text AS section, r.id AS item_id,
      NULL::text AS title,
      ts_headline('public.nes_polish', r.body, q.tsq,
                  'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1') AS snippet,
      r.created_at AS occurred_at,
      CASE WHEN acc.hide_identity OR r.is_anonymous
           THEN public.club_author_alias(acc.thread_id, r.author_id)
           ELSE COALESCE(NULLIF(btrim(pr.display_name), ''), 'User') END AS author_label,
      ts_rank(r.search_vector, q.tsq) AS rank
    FROM acc CROSS JOIN q
    JOIN public.club_replies r ON r.thread_id = acc.thread_id
    LEFT JOIN public.profiles pr ON pr.id = r.author_id
    WHERE r.status IN ('visible', 'pending') AND r.search_vector @@ q.tsq

    UNION ALL

    SELECT 'document', d.id, d.title,
           ts_headline('public.nes_polish',
                       COALESCE(d.description, d.source_label, d.title), q.tsq,
                       'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1'),
           d.created_at,
           CASE WHEN acc.hide_identity THEN NULL
                ELSE COALESCE(NULLIF(btrim(pd.display_name), ''), 'User') END,
           ts_rank(d.search_vector, q.tsq)
    FROM acc CROSS JOIN q
    JOIN public.club_thread_documents d ON d.thread_id = acc.thread_id
    LEFT JOIN public.profiles pd ON pd.id = d.added_by
    WHERE d.status = 'visible' AND d.search_vector @@ q.tsq

    UNION ALL

    SELECT 'milestone', m.id, m.title,
           ts_headline('public.nes_polish', COALESCE(m.description, m.title), q.tsq,
                       'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1'),
           m.starts_at, NULL,
           ts_rank(m.search_vector, q.tsq)
    FROM acc CROSS JOIN q
    JOIN public.club_thread_milestones m ON m.thread_id = acc.thread_id
    WHERE m.search_vector @@ q.tsq

    UNION ALL

    SELECT 'question', qq.id, NULL,
           ts_headline('public.nes_polish', qq.body, q.tsq,
                       'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1'),
           qq.created_at,
           CASE WHEN acc.hide_identity OR qq.is_anonymous
                THEN public.club_author_alias(acc.thread_id, qq.author_id)
                ELSE COALESCE(NULLIF(btrim(pq.display_name), ''), 'User') END,
           ts_rank(qq.search_vector, q.tsq)
    FROM acc CROSS JOIN q
    JOIN public.club_thread_questions qq ON qq.thread_id = acc.thread_id
    LEFT JOIN public.profiles pq ON pq.id = qq.author_id
    WHERE qq.status <> 'hidden' AND qq.search_vector @@ q.tsq
  )
  SELECT section, item_id, title, snippet, occurred_at, author_label, rank
  FROM hits
  -- Pusta fraza daje pusty tsquery, ktory nie dopasowuje niczego - zbior
  -- wychodzi pusty bez zadnego warunku dodatkowego.
  ORDER BY rank DESC, occurred_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100))
$$;

COMMENT ON FUNCTION public.club_thread_search(uuid, text, integer) IS
  'Wyszukiwanie WEWNATRZ watku po czterech sekcjach naraz. club_search odpowiada "w ktorym watku"; ta funkcja - "gdzie w tym watku".';

REVOKE EXECUTE ON FUNCTION public.club_thread_search(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_search(uuid, text, integer)
  TO anon, authenticated, service_role;

-- ============================================================================
-- 12) ODCZYT: SZEREG CZASOWY POD WIZUALIZACJE
--
-- DLACZEGO TO LICZY BAZA, SKORO `ClubThreadPulse` LICZY W KLIENCIE. Puls
-- rysuje sie z odpowiedzi, ktore i tak sa na ekranie - i to jest poprawne.
-- Ale lista odpowiedzi jest UCIETA (`club.repliesTruncated`), a przestrzen
-- robocza ma cztery zrodla zdarzen zamiast jednego. Wykres liczony z ucietej
-- probki pokazywalby spadek aktywnosci tam, gdzie skonczyla sie strona.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_thread_insights(
  p_thread_id uuid,
  p_buckets   integer DEFAULT 24
)
RETURNS TABLE (
  bucket_index integer,
  bucket_start timestamptz,
  bucket_end   timestamptz,
  replies      integer,
  questions    integer,
  documents    integer,
  milestones   integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT * FROM public.club_thread_access(p_thread_id) WHERE can_read
  ),
  span AS (
    SELECT
      t.created_at AS from_at,
      GREATEST(now(), t.created_at + interval '1 hour') AS to_at,
      GREATEST(1, LEAST(COALESCE(p_buckets, 24), 96)) AS n
    FROM acc JOIN public.club_threads t ON t.id = acc.thread_id
  ),
  grid AS (
    SELECT
      i AS bucket_index,
      span.from_at + ((span.to_at - span.from_at) * i / span.n)       AS bucket_start,
      span.from_at + ((span.to_at - span.from_at) * (i + 1) / span.n) AS bucket_end
    FROM span, generate_series(0, span.n - 1) AS i
  )
  SELECT
    g.bucket_index, g.bucket_start, g.bucket_end,
    (SELECT count(*)::int FROM acc, public.club_replies r
      WHERE r.thread_id = acc.thread_id AND r.status IN ('visible', 'pending')
        AND r.created_at >= g.bucket_start AND r.created_at < g.bucket_end),
    (SELECT count(*)::int FROM acc, public.club_thread_questions q
      WHERE q.thread_id = acc.thread_id AND q.status <> 'hidden'
        AND q.created_at >= g.bucket_start AND q.created_at < g.bucket_end),
    (SELECT count(*)::int FROM acc, public.club_thread_documents d
      WHERE d.thread_id = acc.thread_id AND d.status = 'visible'
        AND d.created_at >= g.bucket_start AND d.created_at < g.bucket_end),
    (SELECT count(*)::int FROM acc, public.club_thread_milestones m
      WHERE m.thread_id = acc.thread_id AND m.status <> 'cancelled'
        AND m.starts_at >= g.bucket_start AND m.starts_at < g.bucket_end)
  FROM grid g
  ORDER BY g.bucket_index
$$;

COMMENT ON FUNCTION public.club_thread_insights(uuid, integer) IS
  'Szereg czasowy czterech rodzajow zdarzen watku. Liczony w bazie, bo lista odpowiedzi w kliencie jest ucieta - wykres z ucietej probki klamie o spadku aktywnosci.';

REVOKE EXECUTE ON FUNCTION public.club_thread_insights(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_insights(uuid, integer)
  TO anon, authenticated, service_role;

-- ============================================================================
-- 13) ZAPIS
--
-- Wzorzec jest wszedzie ten sam: bramka z `club_thread_access()`, walidacja
-- slownika, zapis, wpis do dziennika moderacji tam, gdzie akcja jest aktem
-- kuratorskim. Bledy sa STALYMI LITERALAMI po angielsku - klient mapuje je na
-- kod slownikowy i dopiero z kodu sklada zdanie w jezyku uzytkownika (ta sama
-- droga, co `toClubInviteError`).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_thread_document_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_thread uuid := NULLIF(p_payload->>'thread_id', '')::uuid;
  v_acc    record;
  v_row    public.club_thread_documents%ROWTYPE;
  v_kind   text := COALESCE(NULLIF(btrim(p_payload->>'kind'), ''), 'document');
BEGIN
  -- Redakcja przychodzi z samym id, wiec watek dociagamy z wiersza.
  IF v_thread IS NULL AND v_id IS NOT NULL THEN
    SELECT d.thread_id INTO v_thread FROM public.club_thread_documents d WHERE d.id = v_id;
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_thread);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;

  IF v_kind NOT IN ('document', 'dataset', 'link', 'note', 'recording') THEN
    RAISE EXCEPTION 'clubs: unknown document kind' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    IF NOT v_acc.can_reply THEN
      RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.club_thread_documents (
      club_id, thread_id, added_by, kind, title, description, url,
      source_label, published_on, mime_type, byte_size, is_primary, sort_order
    ) VALUES (
      v_acc.club_id, v_thread, auth.uid(), v_kind,
      btrim(p_payload->>'title'),
      NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'source_label', '')), ''),
      NULLIF(p_payload->>'published_on', '')::date,
      NULLIF(btrim(COALESCE(p_payload->>'mime_type', '')), ''),
      NULLIF(p_payload->>'byte_size', '')::bigint,
      -- Wyroznienie jest aktem kuratorskim, wiec zostaje przy moderacji.
      (v_acc.can_moderate AND COALESCE((p_payload->>'is_primary')::boolean, false)),
      COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 0)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  END IF;

  SELECT * INTO v_row FROM public.club_thread_documents WHERE id = v_id;
  IF NOT FOUND OR v_row.thread_id <> v_thread THEN
    RAISE EXCEPTION 'clubs: document not found' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_acc.can_moderate OR (v_row.added_by IS NOT NULL AND v_row.added_by = auth.uid())) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Obecnosc klucza znaczy "zmien", brak klucza znaczy "nie ruszaj" - ta sama
  -- umowa, co w admin_club_upsert. Bez niej kazdy zapis czesciowy kasowalby
  -- pola, ktorych formularz akurat nie mial na ekranie.
  UPDATE public.club_thread_documents SET
    kind         = CASE WHEN p_payload ? 'kind' THEN v_kind ELSE kind END,
    title        = CASE WHEN p_payload ? 'title' THEN btrim(p_payload->>'title') ELSE title END,
    description  = CASE WHEN p_payload ? 'description'
                        THEN NULLIF(btrim(COALESCE(p_payload->>'description', '')), '')
                        ELSE description END,
    url          = CASE WHEN p_payload ? 'url'
                        THEN NULLIF(btrim(COALESCE(p_payload->>'url', '')), '') ELSE url END,
    source_label = CASE WHEN p_payload ? 'source_label'
                        THEN NULLIF(btrim(COALESCE(p_payload->>'source_label', '')), '')
                        ELSE source_label END,
    published_on = CASE WHEN p_payload ? 'published_on'
                        THEN NULLIF(p_payload->>'published_on', '')::date ELSE published_on END,
    mime_type    = CASE WHEN p_payload ? 'mime_type'
                        THEN NULLIF(btrim(COALESCE(p_payload->>'mime_type', '')), '')
                        ELSE mime_type END,
    byte_size    = CASE WHEN p_payload ? 'byte_size'
                        THEN NULLIF(p_payload->>'byte_size', '')::bigint ELSE byte_size END,
    is_primary   = CASE WHEN p_payload ? 'is_primary' AND v_acc.can_moderate
                        THEN COALESCE((p_payload->>'is_primary')::boolean, false)
                        ELSE is_primary END,
    sort_order   = CASE WHEN p_payload ? 'sort_order'
                        THEN COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 0)
                        ELSE sort_order END,
    status       = CASE WHEN p_payload ? 'status' AND v_acc.can_moderate
                        AND p_payload->>'status' IN ('visible', 'hidden')
                        THEN p_payload->>'status' ELSE status END
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_document_upsert(jsonb) IS
  'Dodaje albo redaguje zrodlo watku. Obecnosc klucza w payloadzie = "zmien", brak = "nie ruszaj". Wyroznienie is_primary zostaje przy moderacji.';

REVOKE EXECUTE ON FUNCTION public.club_thread_document_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_document_upsert(jsonb)
  TO authenticated, service_role;

-- Usuniecie jest MIEKKIE. Zrodlo cytowane w dyskusji, ktore znika bez sladu,
-- zostawia wypowiedzi odwolujace sie do niczego.
CREATE OR REPLACE FUNCTION public.club_thread_document_remove(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_documents%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: document not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_acc.can_moderate OR (v_row.added_by IS NOT NULL AND v_row.added_by = auth.uid())) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_thread_documents SET status = 'deleted' WHERE id = p_document_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_document_remove(uuid) IS
  'Miekkie usuniecie zrodla. Twarde kasowanie zostawialoby wypowiedzi cytujace pozycje, ktorej nie ma.';

REVOKE EXECUTE ON FUNCTION public.club_thread_document_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_document_remove(uuid)
  TO authenticated, service_role;

-- Harmonogram prowadzi MODERACJA. To nie jest oszczednosc uprawnien, tylko
-- semantyka: termin wpisany przez dowolnego czlonka jest sugestia, a kalendarz
-- pelen cudzych sugestii przestaje byc harmonogramem.
CREATE OR REPLACE FUNCTION public.club_thread_milestone_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_thread uuid := NULLIF(p_payload->>'thread_id', '')::uuid;
  v_acc    record;
  v_row    public.club_thread_milestones%ROWTYPE;
  v_kind   text := COALESCE(NULLIF(btrim(p_payload->>'kind'), ''), 'milestone');
  v_status text := COALESCE(NULLIF(btrim(p_payload->>'status'), ''), 'planned');
BEGIN
  IF v_thread IS NULL AND v_id IS NOT NULL THEN
    SELECT m.thread_id INTO v_thread FROM public.club_thread_milestones m WHERE m.id = v_id;
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_thread);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_kind NOT IN ('milestone', 'meeting', 'deadline', 'publication', 'vote', 'consultation') THEN
    RAISE EXCEPTION 'clubs: unknown milestone kind' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('planned', 'active', 'done', 'cancelled') THEN
    RAISE EXCEPTION 'clubs: unknown milestone status' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.club_thread_milestones (
      club_id, thread_id, created_by, owner_id, event_id, title, description,
      kind, status, starts_at, ends_at, all_day, location, url, sort_order
    ) VALUES (
      v_acc.club_id, v_thread, auth.uid(),
      NULLIF(p_payload->>'owner_id', '')::uuid,
      NULLIF(p_payload->>'event_id', '')::uuid,
      btrim(p_payload->>'title'),
      NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
      v_kind, v_status,
      (p_payload->>'starts_at')::timestamptz,
      NULLIF(p_payload->>'ends_at', '')::timestamptz,
      COALESCE((p_payload->>'all_day')::boolean, false),
      NULLIF(btrim(COALESCE(p_payload->>'location', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''),
      COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 0)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  END IF;

  SELECT * INTO v_row FROM public.club_thread_milestones WHERE id = v_id;
  IF NOT FOUND OR v_row.thread_id <> v_thread THEN
    RAISE EXCEPTION 'clubs: milestone not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_thread_milestones SET
    title       = CASE WHEN p_payload ? 'title' THEN btrim(p_payload->>'title') ELSE title END,
    description = CASE WHEN p_payload ? 'description'
                       THEN NULLIF(btrim(COALESCE(p_payload->>'description', '')), '')
                       ELSE description END,
    kind        = CASE WHEN p_payload ? 'kind' THEN v_kind ELSE kind END,
    status      = CASE WHEN p_payload ? 'status' THEN v_status ELSE status END,
    starts_at   = CASE WHEN p_payload ? 'starts_at'
                       THEN (p_payload->>'starts_at')::timestamptz ELSE starts_at END,
    ends_at     = CASE WHEN p_payload ? 'ends_at'
                       THEN NULLIF(p_payload->>'ends_at', '')::timestamptz ELSE ends_at END,
    all_day     = CASE WHEN p_payload ? 'all_day'
                       THEN COALESCE((p_payload->>'all_day')::boolean, false) ELSE all_day END,
    location    = CASE WHEN p_payload ? 'location'
                       THEN NULLIF(btrim(COALESCE(p_payload->>'location', '')), '') ELSE location END,
    url         = CASE WHEN p_payload ? 'url'
                       THEN NULLIF(btrim(COALESCE(p_payload->>'url', '')), '') ELSE url END,
    owner_id    = CASE WHEN p_payload ? 'owner_id'
                       THEN NULLIF(p_payload->>'owner_id', '')::uuid ELSE owner_id END,
    event_id    = CASE WHEN p_payload ? 'event_id'
                       THEN NULLIF(p_payload->>'event_id', '')::uuid ELSE event_id END,
    sort_order  = CASE WHEN p_payload ? 'sort_order'
                       THEN COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 0)
                       ELSE sort_order END
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_milestone_upsert(jsonb) IS
  'Zaklada albo redaguje pozycje harmonogramu. Prawo ma MODERACJA: termin wpisany przez dowolnego czlonka jest sugestia, a kalendarz sugestii przestaje byc harmonogramem.';

REVOKE EXECUTE ON FUNCTION public.club_thread_milestone_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_milestone_upsert(jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_milestone_remove(p_milestone_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_milestones%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_milestones WHERE id = p_milestone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: milestone not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.club_thread_milestones WHERE id = p_milestone_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_milestone_remove(uuid) IS
  'Kasuje pozycje harmonogramu. Twarde, nie miekkie: odwolany termin ma status cancelled, a wpis skasowany to wpis pomylkowy.';

REVOKE EXECUTE ON FUNCTION public.club_thread_milestone_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_milestone_remove(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_question_ask(
  p_thread_id uuid,
  p_body      text,
  p_anonymous boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc  record;
  v_mode text;
  v_id   uuid;
BEGIN
  SELECT * INTO v_acc FROM public.club_thread_access(p_thread_id);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF NOT v_acc.can_reply THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  v_mode := v_acc.attribution_mode;
  IF p_anonymous AND v_mode NOT IN ('anonymous_allowed', 'chatham') THEN
    RAISE EXCEPTION 'clubs: anonymous not allowed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_thread_questions (club_id, thread_id, author_id, body, is_anonymous)
  VALUES (v_acc.club_id, p_thread_id, auth.uid(), btrim(p_body),
          COALESCE(p_anonymous, false))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_question_ask(uuid, text, boolean) IS
  'Zadaje pytanie w watku. Anonimowosc dopuszczalna wylacznie tam, gdzie tryb atrybucji klubu na nia pozwala - inaczej baza odrzuca zapis, zamiast obiecywac ochrone, ktorej nie ma.';

REVOKE EXECUTE ON FUNCTION public.club_thread_question_ask(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_question_ask(uuid, text, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_question_answer(
  p_question_id uuid,
  p_body        text,
  p_status      text DEFAULT 'answered'
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_questions%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: question not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  -- Autor watku odpowiada na pytania do SWOJEJ dyskusji takze wtedy, gdy nie
  -- moderuje klubu - jest ich adresatem.
  IF NOT (v_acc.can_moderate
          OR (v_acc.author_id IS NOT NULL AND v_acc.author_id = auth.uid())) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('answered', 'declined', 'open', 'hidden') THEN
    RAISE EXCEPTION 'clubs: unknown question status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'answered' AND NULLIF(btrim(COALESCE(p_body, '')), '') IS NULL THEN
    RAISE EXCEPTION 'clubs: answer body required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.club_thread_questions SET
    answer_body = NULLIF(btrim(COALESCE(p_body, '')), ''),
    status      = p_status,
    answered_by = CASE WHEN p_status = 'answered' THEN auth.uid() ELSE NULL END,
    answered_at = CASE WHEN p_status = 'answered' THEN now() ELSE NULL END
  WHERE id = p_question_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_question_answer(uuid, text, text) IS
  'Odpowiada na pytanie albo zmienia jego stan. Prawo ma moderacja ORAZ autor watku - to do niego pytania sa kierowane.';

REVOKE EXECUTE ON FUNCTION public.club_thread_question_answer(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_question_answer(uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_question_vote(
  p_question_id uuid,
  p_on          boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.club_thread_questions%ROWTYPE;
  v_acc   record;
  v_count integer;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: question not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'clubs: auth required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_on, true) THEN
    INSERT INTO public.club_thread_question_votes (question_id, user_id, tenant_id)
    VALUES (p_question_id, auth.uid(), v_row.tenant_id)
    ON CONFLICT (question_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.club_thread_question_votes
     WHERE question_id = p_question_id AND user_id = auth.uid();
  END IF;

  SELECT vote_count INTO v_count FROM public.club_thread_questions WHERE id = p_question_id;
  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.club_thread_question_vote(uuid, boolean) IS
  'Glos na waznosc pytania. Zwraca licznik PO zapisie, zeby klient nie musial zgadywac wyniku wyscigu dwoch glosow.';

REVOKE EXECUTE ON FUNCTION public.club_thread_question_vote(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_question_vote(uuid, boolean)
  TO authenticated, service_role;

-- Powiazanie zaklada MODERACJA i tylko miedzy watkami, ktore wolno jej
-- CZYTAC. Bez tego drugiego warunku krawedz byla kanalem wycieku: link
-- z watku publicznego do watku z klubu 'secret' ujawnialby jego istnienie.
CREATE OR REPLACE FUNCTION public.club_thread_link_add(
  p_thread_id         uuid,
  p_related_thread_id uuid,
  p_relation          text DEFAULT 'context',
  p_note              text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc   record;
  v_other record;
  v_id    uuid;
BEGIN
  IF p_thread_id = p_related_thread_id THEN
    RAISE EXCEPTION 'clubs: cannot link thread to itself' USING ERRCODE = '22023';
  END IF;
  IF p_relation NOT IN ('continues', 'supersedes', 'contradicts', 'supports',
                        'duplicates', 'context') THEN
    RAISE EXCEPTION 'clubs: unknown relation' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(p_thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_other FROM public.club_thread_access(p_related_thread_id);
  IF NOT FOUND OR NOT v_other.can_read THEN
    RAISE EXCEPTION 'clubs: thread not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.club_thread_links (
    club_id, thread_id, related_thread_id, created_by, relation, note
  ) VALUES (
    v_acc.club_id, p_thread_id, p_related_thread_id, auth.uid(), p_relation,
    NULLIF(btrim(COALESCE(p_note, '')), '')
  )
  ON CONFLICT (thread_id, related_thread_id) DO UPDATE
    SET relation = EXCLUDED.relation, note = EXCLUDED.note
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_link_add(uuid, uuid, text, text) IS
  'Laczy dwa watki nazwana relacja. Drugi koniec musi byc CZYTELNY dla zakladajacego - inaczej krawedz ujawnialaby istnienie watku z klubu secret.';

REVOKE EXECUTE ON FUNCTION public.club_thread_link_add(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_link_add(uuid, uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_link_remove(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_links%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: link not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.club_thread_links WHERE id = p_link_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_link_remove(uuid) IS
  'Zdejmuje powiazanie miedzy watkami. Prawo po stronie watku, ktory krawedz zalozyl.';

REVOKE EXECUTE ON FUNCTION public.club_thread_link_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_link_remove(uuid)
  TO authenticated, service_role;

-- Glosowanie zakladane Z WATKU. Jedna transakcja tworzy ankiete I krawedz -
-- rozdzielenie zostawialoby przy bledzie sierote (ankieta bez watku).
-- Ta sama decyzja, co w `admin_club_poll_create` (A20).
CREATE OR REPLACE FUNCTION public.club_thread_poll_create(
  p_thread_id   uuid,
  p_question_pl text,
  p_question_en text,
  p_options     jsonb,
  p_ends_at     timestamptz DEFAULT NULL,
  p_label       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc  record;
  v_poll uuid;
BEGIN
  SELECT * INTO v_acc FROM public.club_thread_access(p_thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_options) <> 'array'
     OR jsonb_array_length(p_options) NOT BETWEEN 2 AND 8 THEN
    RAISE EXCEPTION 'clubs: poll needs 2-8 options' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.polls (
    tenant_id, question_pl, question_en, options, status, ends_at, created_by
  ) VALUES (
    v_acc.tenant_id, btrim(p_question_pl), btrim(p_question_en), p_options,
    'open', p_ends_at, auth.uid()
  )
  RETURNING id INTO v_poll;

  INSERT INTO public.club_thread_polls (club_id, thread_id, poll_id, created_by, label, sort_order)
  VALUES (
    v_acc.club_id, p_thread_id, v_poll, auth.uid(),
    NULLIF(btrim(COALESCE(p_label, '')), ''),
    (SELECT COALESCE(max(sort_order), -1) + 1
       FROM public.club_thread_polls WHERE thread_id = p_thread_id)
  );

  RETURN v_poll;
END;
$$;

COMMENT ON FUNCTION public.club_thread_poll_create(uuid, text, text, jsonb, timestamptz, text) IS
  'Zaklada glosowanie w watku: ankieta w polls + krawedz w JEDNEJ transakcji. Rozdzielenie zostawialoby przy bledzie ankiete-sierote.';

REVOKE EXECUTE ON FUNCTION
  public.club_thread_poll_create(uuid, text, text, jsonb, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.club_thread_poll_create(uuid, text, text, jsonb, timestamptz, text)
  TO authenticated, service_role;

-- Odpiecie kasuje KRAWEDZ, nie ankiete. Oddane glosy zostaja - kasowanie
-- cudzych glosow przy porzadkowaniu watku byloby utrata danych, a nie
-- porzadkowaniem.
CREATE OR REPLACE FUNCTION public.club_thread_poll_detach(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.club_thread_polls%ROWTYPE;
  v_acc record;
BEGIN
  SELECT * INTO v_row FROM public.club_thread_polls WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: poll link not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_acc FROM public.club_thread_access(v_row.thread_id);
  IF NOT FOUND OR NOT v_acc.can_moderate THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.club_thread_polls WHERE id = p_link_id;
END;
$$;

COMMENT ON FUNCTION public.club_thread_poll_detach(uuid) IS
  'Odpina glosowanie od watku. Kasuje krawedz, NIE ankiete - oddane glosy nie znikaja przy porzadkowaniu watku.';

REVOKE EXECUTE ON FUNCTION public.club_thread_poll_detach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_poll_detach(uuid)
  TO authenticated, service_role;

-- ============================================================================
-- 14) SZWY MIEDZYMODULOWE
--
-- Dokument i termin sa TRESCIA PLATFORMY, nie prywatna notatka watku. Graf
-- powiazan ma o nich wiedziec, zeby strona aktu prawnego mogla pokazac
-- "omawiane w klubie X, ze zrodlami" bez znajomosci modulu klubow.
--
-- Trigger, nie wstawka w RPC - ta sama decyzja i to samo uzasadnienie, co
-- w A12: sciezek zapisu bedzie wiecej niz jedna, a piec wstawek musialoby sie
-- zgadzac dokladnie do pierwszej nowej sciezki.
--
-- Awaria szyny NIE MOZE wywrocic zapisu (doktryna z tg_comments_cohesion),
-- stad przechwycenie wyjatku na koncu.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_club_thread_documents_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public.club_thread_seam_context(NEW.thread_id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  PERFORM public.add_cross_reference(
    NEW.tenant_id, 'club_thread', NEW.thread_id::text,
    'club_thread_document', NEW.id::text, 'cites',
    CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.added_by END
  );

  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'club_thread', NEW.thread_id::text, 'club_thread.document_added.v1',
    -- Payload bez tytulu i adresu: `domain_events` czyta caly staff tenantu,
    -- a czlonkostwo w klubie to inna bramka niz rola redakcyjna.
    jsonb_build_object('club_id', v_ctx.club_id, 'document_id', NEW.id, 'kind', NEW.kind),
    -- SZOSTA pozycja to AKTOR (A17). Nie warunkujemy go tutaj po `hide_actor`:
    -- tlumienie robi argument nazwany ponizej, a warunek na tej pozycji
    -- wygladalby jak flaga - czyli jak blad, ktory A16/A17 naprawialy.
    NEW.added_by,
    p_suppress_actor => v_ctx.hide_actor
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_club_thread_documents_seams() IS
  'Szyna dla zrodel watku: krawedz w grafie powiazan + zdarzenie domenowe. Klub secret nie emituje nic, tryb chatham emituje bez aktora.';

DROP TRIGGER IF EXISTS club_thread_documents_seams_tg ON public.club_thread_documents;
CREATE TRIGGER club_thread_documents_seams_tg
  AFTER INSERT ON public.club_thread_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_thread_documents_seams();

CREATE OR REPLACE FUNCTION public.tg_club_thread_milestones_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public.club_thread_seam_context(NEW.thread_id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  -- Krawedz do wydarzenia powstaje TYLKO wtedy, gdy termin faktycznie
  -- wskazuje na wydarzenie platformy. Krawedz do NULL-a to wiersz smieciowy
  -- w grafie, ktory potem trzeba odsiewac w kazdym zapytaniu.
  IF NEW.event_id IS NOT NULL THEN
    PERFORM public.add_cross_reference(
      NEW.tenant_id, 'club_thread', NEW.thread_id::text,
      'event', NEW.event_id::text, 'scheduled_with',
      CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.created_by END
    );
  END IF;

  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'club_thread', NEW.thread_id::text, 'club_thread.milestone_set.v1',
    jsonb_build_object(
      'club_id', v_ctx.club_id, 'milestone_id', NEW.id,
      'kind', NEW.kind, 'status', NEW.status, 'starts_at', NEW.starts_at
    ),
    -- Aktor na SZOSTEJ pozycji, tlumienie argumentem nazwanym - patrz komentarz
    -- w szynie dokumentow.
    NEW.created_by,
    p_suppress_actor => v_ctx.hide_actor
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_club_thread_milestones_seams() IS
  'Szyna dla harmonogramu watku. Krawedz do wydarzenia powstaje wylacznie przy realnym event_id - krawedz do NULL-a jest smieciem w grafie.';

DROP TRIGGER IF EXISTS club_thread_milestones_seams_tg ON public.club_thread_milestones;
CREATE TRIGGER club_thread_milestones_seams_tg
  AFTER INSERT OR UPDATE OF starts_at, status, event_id ON public.club_thread_milestones
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_thread_milestones_seams();
