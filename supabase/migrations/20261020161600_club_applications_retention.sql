-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y1, 2/8): RETENCJA DANYCH - ZGŁOSZENIA DO
-- KLUBÓW (Z-I9c-01, kategoria `club_applications`). Decyzja właściciela
-- 2026-10-20: odrzucone - anonimizacja 24 mies. po decyzji (zakres 12-36),
-- przyjęte - 24 mies. od końca członkostwa, oczekujące - nigdy automatycznie.
-- Podstawa: RODO art. 6 ust. 1 lit. b i f, art. 5 ust. 1 lit. e.
--
-- Znacznik niżej jest DYREKTYWĄ dla scripts/pg-harness/run.sh: migracja
-- dotyka `public.club_members`/`public.club_applications` razem z retencją
-- huba (`data_retention_*`, pseudonim konta), których atrapa harnessu klubów
-- nie ma. Dowód - pgTAP na komplecie migracji.
-- pg-harness: exclude
--
-- DEFEKT
--   1. Zgłoszenie do klubu (dane kontaktowe, teksty własne, notatka komisji)
--      żyje bez końca, także odrzucone i po wyjściu z klubu.
--   2. „Koniec członkostwa" nie ma daty: wyjście ustawia `status = 'left'`,
--      ban - `'banned'`, admin może skasować wiersz członkostwa, a usunięcie
--      klubu ustawia w zgłoszeniu `club_id = NULL` (kaskada SET NULL).
--   3. Panel pozwala zmienić status zgłoszenia osoby bez konta (usuniętej
--      albo zanonimizowanej): przyjęcie kończyło się surowym 23503
--      (`club_members.user_id` -> `auth.users`), odrzucenie wysyłało
--      powiadomienie do nieistniejącego konta.
--
-- ZMIANA (DECYZJE WYKONAWCZE orkiestratora I9d, opis w dzienniku §21.22)
--   A. „Odrzucone/wycofane" = `rejected` (statusu „wycofane" w schemacie nie
--      ma); `pending`/`review`/`needs_info` = oczekujące - nigdy kandydat.
--   B. `club_members.ended_at` - koniec członkostwa: wyzwalacz BEFORE
--      stempluje `now()` przy przejściu w `left`/`banned` (z `left` w `banned`
--      data zostaje), czyści przy powrocie (`active`/`pending`/`invited`).
--      Uzupełnienie wsteczne: `ended_at = updated_at` dla `left`/`banned` -
--      wyzwalacz `set_updated_at` przesuwa `updated_at` przy każdej zmianie,
--      a licznik nieprzeczytanych podbija tylko członków aktywnych, więc dla
--      wyjścia to najlepsze przybliżenie (późniejsza zmiana może je tylko
--      opóźnić - bezpieczny kierunek).
--   C. Usunięte członkostwo (admin, kaskada klubu albo konta) - data w
--      ZGŁOSZENIU: `club_applications.membership_ended_at` (wyzwalacz AFTER
--      DELETE na `club_members`; nowe członkostwo ją czyści). Tabela
--      pomocnicza po (klub, osoba) gubiłaby skasowany klub (zgłoszenie ma
--      wtedy `club_id = NULL`), dlatego wyzwalacz BEFORE UPDATE OF club_id
--      zgłoszenia stempluje datę także przy odłączeniu od klubu. Uzupełnienie
--      wsteczne: przyjęte zgłoszenie bez wiersza członkostwa -> `now()`
--      (chwili skasowania nie da się odtworzyć - 24 mies. biegną od wdrożenia,
--      nigdy wcześniej niż wynika z decyzji).
--   D. `_data_retention_club_candidates` / `_data_retention_club_applications`
--      - kandydaci: odrzucone z decyzją starszą niż okres; przyjęte bez
--      członkostwa trwającego, z końcem członkostwa starszym niż okres
--      (`ended_at`, data w zgłoszeniu, a gdy członkostwa nigdy nie było -
--      decyzja). Wykonanie: `_club_applications_anonymize` (20261020161500,
--      osobny pseudonim na konto). Podgląd liczy.
--   E. `admin_club_application_set_status` (CIALO-Z niżej) - zgłoszenie
--      zanonimizowane albo osoby bez konta: `application_anonymized` przed
--      jakąkolwiek zmianą (status, członkostwo, profil, powiadomienie).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020161500 (`_club_applications_anonymize`).
-- Kategoria wchodzi do katalogu w 20261020162200 (rdzeń); do tego czasu
-- funkcje D czekają nieużywane.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP/CREATE TRIGGER, uzupełnienie tylko wierszy z NULL, bezstanowe
-- REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9d_club_applications_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B/C) Kolumny końca członkostwa (gorące tabele klubów - limit blokady).
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';
ALTER TABLE public.club_members ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.club_applications ADD COLUMN IF NOT EXISTS membership_ended_at timestamptz;
-- Limit blokady zostaje do końca uzupełnienia wstecznego: wyzwalacze
-- (CREATE/ENABLE/DISABLE TRIGGER) też biorą blokadę tabeli.

COMMENT ON COLUMN public.club_members.ended_at IS
  'Retencja danych (I9d): chwila końca członkostwa - przejście w left/banned (wyzwalacz), NULL dla członkostwa trwającego. Od niej biegnie okres kategorii club_applications dla przyjętych zgłoszeń.';
COMMENT ON COLUMN public.club_applications.membership_ended_at IS
  'Retencja danych (I9d): koniec członkostwa, którego wiersza już nie ma (skasowane członkostwo, usunięty klub) - stempel wyzwalacza; NULL, gdy członkostwo trwa albo opisuje je club_members.ended_at.';

-- Stempel końca na wierszu członkostwa. BEFORE, więc bez drugiego UPDATE.
CREATE OR REPLACE FUNCTION public.tg_club_members_membership_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('left', 'banned') THEN
    -- Z `left` w `banned` (i powtórny zapis tego samego statusu) koniec się
    -- nie przesuwa - członkostwo skończyło się przy pierwszym wyjściu.
    IF TG_OP = 'UPDATE' AND OLD.status IN ('left', 'banned') THEN
      NEW.ended_at := COALESCE(OLD.ended_at, NEW.ended_at, now());
    ELSE
      NEW.ended_at := now();
    END IF;
  ELSE
    NEW.ended_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_club_members_membership_end() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS club_members_membership_end_tg ON public.club_members;
CREATE TRIGGER club_members_membership_end_tg
  BEFORE INSERT OR UPDATE OF status ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_members_membership_end();

-- Członkostwo skasowane albo założone na nowo: data w przyjętym zgłoszeniu
-- tej osoby do tego klubu. SECURITY DEFINER - kasuje też klient przez RLS,
-- a zgłoszenia nie ma w jego uprawnieniach zapisu.
CREATE OR REPLACE FUNCTION public.tg_club_members_membership_gone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.club_applications a
       SET membership_ended_at = COALESCE(OLD.ended_at, now())
     WHERE a.club_id = OLD.club_id AND a.user_id = OLD.user_id
       AND a.status = 'accepted' AND a.membership_ended_at IS NULL;
    RETURN OLD;
  END IF;
  IF NEW.status IN ('active', 'pending', 'invited') THEN
    UPDATE public.club_applications a
       SET membership_ended_at = NULL
     WHERE a.club_id = NEW.club_id AND a.user_id = NEW.user_id
       AND a.status = 'accepted' AND a.membership_ended_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_club_members_membership_gone() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS club_members_membership_gone_tg ON public.club_members;
CREATE TRIGGER club_members_membership_gone_tg
  AFTER INSERT OR DELETE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_members_membership_gone();

-- Usunięcie klubu: kaskada SET NULL na `club_id` zgłoszenia może przyjść
-- przed kaskadą członkostwa albo po niej (kolejność wyzwalaczy kluczy obcych
-- nie jest kontraktem) - stempel przy odłączeniu działa w obu kolejnościach.
CREATE OR REPLACE FUNCTION public.tg_club_applications_club_detached()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.club_id IS NOT NULL AND NEW.club_id IS NULL AND NEW.status = 'accepted'
     AND NEW.membership_ended_at IS NULL THEN
    NEW.membership_ended_at := COALESCE(
      (SELECT m.ended_at FROM public.club_members m WHERE m.club_id = OLD.club_id AND m.user_id = NEW.user_id),
      now());
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_club_applications_club_detached() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS club_applications_club_detached_tg ON public.club_applications;
CREATE TRIGGER club_applications_club_detached_tg
  BEFORE UPDATE OF club_id ON public.club_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_applications_club_detached();

-- Uzupełnienie wsteczne (B, C) bez przesuwania `updated_at` - stempel jest
-- metadaną retencji, nie zmianą członkostwa ani zgłoszenia (wzór
-- 20261012121000). Wyzwalacze dotyku wracają w tym samym bloku.
DO $$
DECLARE
  v_members boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.club_members'::regclass
                                  AND tgname = 'club_members_set_updated_tg' AND NOT tgisinternal);
  v_apps boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.club_applications'::regclass
                               AND tgname = 'club_applications_touch_updated_at' AND NOT tgisinternal);
BEGIN
  IF v_members THEN
    EXECUTE 'ALTER TABLE public.club_members DISABLE TRIGGER club_members_set_updated_tg';
  END IF;
  UPDATE public.club_members m SET ended_at = m.updated_at
   WHERE m.status IN ('left', 'banned') AND m.ended_at IS NULL;
  IF v_members THEN
    EXECUTE 'ALTER TABLE public.club_members ENABLE TRIGGER club_members_set_updated_tg';
  END IF;

  IF v_apps THEN
    EXECUTE 'ALTER TABLE public.club_applications DISABLE TRIGGER club_applications_touch_updated_at';
  END IF;
  UPDATE public.club_applications a SET membership_ended_at = now()
   WHERE a.status = 'accepted' AND a.membership_ended_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.club_id = a.club_id AND m.user_id = a.user_id);
  IF v_apps THEN
    EXECUTE 'ALTER TABLE public.club_applications ENABLE TRIGGER club_applications_touch_updated_at';
  END IF;
END $$;
RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- D) Kandydaci i funkcja kategorii.
-- ----------------------------------------------------------------------------
-- Jedna definicja kandydata dla wykonania i podglądu. Zgłoszenie
-- z pseudonimem (wersja 8) jest już zanonimizowane. Członkostwo trwające
-- (`active`/`pending`/`invited`) chroni każde przyjęte zgłoszenie tej osoby
-- do klubu.
CREATE OR REPLACE FUNCTION public._data_retention_club_candidates(p_tenant uuid, p_cutoff timestamptz, p_limit integer)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id
    FROM public.club_applications a
    LEFT JOIN public.club_members m ON m.club_id = a.club_id AND m.user_id = a.user_id
   WHERE a.tenant_id = p_tenant
     AND substr(a.user_id::text, 15, 1) <> '8'
     AND ((a.status = 'rejected' AND COALESCE(a.reviewed_at, a.created_at) < p_cutoff)
          OR (a.status = 'accepted'
              AND CASE WHEN m.id IS NOT NULL
                       THEN m.status IN ('left', 'banned') AND COALESCE(m.ended_at, m.updated_at) < p_cutoff
                       ELSE COALESCE(a.membership_ended_at, a.reviewed_at, a.created_at) < p_cutoff
                  END))
   ORDER BY a.created_at, a.id
   LIMIT GREATEST(p_limit, 0)
$$;

REVOKE ALL ON FUNCTION public._data_retention_club_candidates(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._data_retention_club_applications(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_execute THEN
    v_n := public._club_applications_anonymize(
      ARRAY(SELECT c FROM public._data_retention_club_candidates(p_tenant, p_cutoff, p_limit) c), NULL);
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_n
      FROM public._data_retention_club_candidates(p_tenant, p_cutoff, p_limit);
  END IF;
  RETURN jsonb_build_object('affected', v_n, 'backlog', v_n >= p_limit, 'cutoff', p_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION public._data_retention_club_applications(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._data_retention_club_applications(uuid, timestamptz, boolean, integer) IS
  'Retencja danych (I9d, kategoria club_applications): odrzucone zgłoszenia po okresie od decyzji i przyjęte po okresie od końca członkostwa -> anonimizacja (_club_applications_anonymize); oczekujące nigdy. Podgląd liczy. Wewnętrzny.';

-- ----------------------------------------------------------------------------
-- E) Decyzja komisji: zgłoszenie bez osoby nie zmienia statusu.
-- ----------------------------------------------------------------------------
-- Ciało 1:1 z 20260811150000 (najemca z sesji `assert_admin_tenant`, FOR
-- UPDATE, B6 `duplicate_open`, członkostwo, uzupełnienie profilu,
-- powiadomienie); zmiana: odmowa `application_anonymized` przed zapisem
-- i `pg_temp` w ścieżce wyszukiwania.
-- CIALO-Z: 20260811150000
CREATE OR REPLACE FUNCTION public.admin_club_application_set_status(
  p_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_actor uuid := auth.uid();
  v_app public.club_applications%ROWTYPE;
  v_old text;
  v_club public.clubs%ROWTYPE;
  v_href text := '/club';
  v_phone text;
BEGIN
  -- [114031] `needs_info` jest pelnoprawnym statusem decyzji komisji.
  IF p_status NOT IN ('pending','review','accepted','rejected','needs_info') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  -- FOR UPDATE: dwoje redaktorow klikajacych jednoczesnie nie moze obojgu
  -- zobaczyc starego statusu i wyslac dwoch powiadomien o tej samej decyzji.
  SELECT * INTO v_app FROM public.club_applications
   WHERE id = p_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- ZMIANA I9d: zgłoszenie zanonimizowane (pseudonim konta, wersja 8) albo
  -- osoby, której konta już nie ma - decyzja nie ma adresata: przyjęcie
  -- dałoby 23503 na członkostwie, odrzucenie - powiadomienie do nikogo.
  IF substr(v_app.user_id::text, 15, 1) = '8'
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_app.user_id) THEN
    RAISE EXCEPTION 'application_anonymized';
  END IF;
  v_old := v_app.status;

  -- B6: naruszenie indeksu z A2 dostaje kod, ktory klient zna.
  BEGIN
    UPDATE public.club_applications
       SET status = p_status,
           admin_note = COALESCE(left(btrim(p_note), 2000), admin_note),
           reviewed_by = v_actor,
           reviewed_at = now(),
           notify_error = NULL,
           updated_at = now()
     WHERE id = v_app.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_open';
  END;

  IF v_app.club_id IS NOT NULL THEN
    SELECT * INTO v_club FROM public.clubs
     WHERE id = v_app.club_id AND tenant_id = v_tenant;
    IF FOUND THEN
      v_href := '/club/' || v_club.slug;
    END IF;
  END IF;

  IF p_status = 'accepted' THEN
    IF v_club.id IS NOT NULL THEN
      INSERT INTO public.club_members (
        tenant_id, club_id, user_id, role, status, invite_source, invited_by
      ) VALUES (
        v_tenant, v_club.id, v_app.user_id, 'member', 'active', 'auto', v_actor
      )
      ON CONFLICT (club_id, user_id) DO UPDATE
        SET status = CASE WHEN club_members.status IN ('left','pending','invited')
                          THEN 'active' ELSE club_members.status END;
    END IF;

    -- B3: telefon do postaci, ktora zna `profiles_phone_chk`; jesli nie pasuje
    -- nawet po odsianiu obcych znakow - pomijamy go, nie wywracamy akceptacji.
    v_phone := NULLIF(regexp_replace(COALESCE(v_app.phone, ''), '[^+0-9 ()-]', '', 'g'), '');
    IF v_phone IS NOT NULL AND v_phone !~ '^[+0-9 ()-]{6,32}$' THEN
      v_phone := NULL;
    END IF;

    -- Back-fill TYLKO pustych pol, semantyka `join_us_link_and_backfill`.
    -- Skalowanie po tenancie, zeby admin jednego tenanta nie pisal do profilu
    -- z drugiego, gdyby dane sie rozjechaly.
    UPDATE public.profiles
       SET first_name      = COALESCE(NULLIF(first_name, ''),      NULLIF(v_app.first_name, '')),
           last_name       = COALESCE(NULLIF(last_name, ''),       NULLIF(v_app.last_name, '')),
           phone           = COALESCE(NULLIF(phone, ''),           v_phone),
           current_company = COALESCE(NULLIF(current_company, ''), NULLIF(v_app.company, '')),
           job_title       = COALESCE(NULLIF(job_title, ''),       NULLIF(v_app.job_position, '')),
           location        = COALESCE(NULLIF(location, ''),        NULLIF(v_app.country, '')),
           linkedin_url    = COALESCE(NULLIF(linkedin_url, ''),    NULLIF(v_app.linkedin_url, '')),
           updated_at      = now()
     WHERE id = v_app.user_id
       AND tenant_id = v_tenant;
  END IF;

  -- Powiadomienie W APLIKACJI wylacznie przy FAKTYCZNEJ zmianie decyzji.
  -- `club_notify` samo odsiewa powiadomienie o wlasnym dzialaniu, wiec redaktor
  -- rozpatrujacy wlasne zgloszenie nie dostaje wiadomosci od siebie.
  --
  -- `needs_info` NIE MA tu galezi swiadomie: prosba o uzupelnienie ma sens
  -- tylko z trescia (CZEGO brakuje), a ta jest w szablonie
  -- `club_application_more_info` kanalu mailowego [114031], uruchamianego
  -- recznie z panelu. Dzwonek bez tresci kazalby kandydatowi zgadywac.
  IF v_old IS DISTINCT FROM p_status THEN
    IF p_status = 'accepted' THEN
      PERFORM public.club_notify(
        v_app.user_id, v_actor,
        'Zgłoszenie do klubu przyjęte', 'Club application accepted',
        COALESCE(NULLIF(v_club.name_pl, ''), v_app.specialization_slug),
        COALESCE(NULLIF(v_club.name_en, ''), NULLIF(v_club.name_pl, ''), v_app.specialization_slug),
        v_href
      );
    ELSIF p_status = 'rejected' THEN
      PERFORM public.club_notify(
        v_app.user_id, v_actor,
        'Zgłoszenie do klubu rozpatrzone', 'Club application reviewed',
        'Tym razem bez przyjęcia. Zgłoszenie możesz złożyć ponownie.',
        'Not accepted this time. You can apply again.',
        v_href
      );
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_club_application_set_status(uuid, text, text) IS
  'Decyzja komisji: status (w tym needs_info) + notatka + zerowanie notify_error, a przy accepted takze czlonkostwo (ON CONFLICT nie zdejmuje bana), back-fill pustych pol profilu (telefon normalizowany do profiles_phone_chk albo pomijany) i powiadomienie W APLIKACJI. Kanal mailowy jest osobny i recznie uruchamiany z panelu (notify_payload/mark_notified) - to nie dublet. Cofniecie decyzji przy innym otwartym zgloszeniu daje duplicate_open, nie surowe 23505. I9d: zgloszenie zanonimizowane albo osoby bez konta -> application_anonymized (bez zadnej zmiany).';

REVOKE ALL ON FUNCTION public.admin_club_application_set_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_application_set_status(uuid, text, text) TO authenticated, service_role;
