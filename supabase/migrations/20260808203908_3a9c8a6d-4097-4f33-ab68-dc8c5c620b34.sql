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

  source_label  text CHECK (source_label IS NULL OR char_length(source_label) <= 160),
  published_on  date,
  mime_type     text CHECK (mime_type IS NULL OR char_length(mime_type) <= 120),
  byte_size     bigint CHECK (byte_size IS NULL OR byte_size >= 0),

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

  vote_count    integer NOT NULL DEFAULT 0,

  search_vector tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('public.nes_polish', coalesce(body, '')), 'A') ||
                  setweight(to_tsvector('public.nes_polish', coalesce(answer_body, '')), 'B')
                ) STORED,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

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