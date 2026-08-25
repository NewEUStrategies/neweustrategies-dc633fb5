-- KATALOG UCZESTNIKOW GIELDY SPOTKAN 1-1
--
-- PROBLEM, KTORY TO ZAMYKA. `event_meeting_invite` wymaga
-- `counterpart_registration_id`, a plaszczyzna uczestnika NIE MIALA CZYM go
-- wyprodukowac: `event_meeting_exchange` oddaje wylacznie wlasny zapis
-- i liczniki, a `event_meetings_mine` zna identyfikator kontrahenta dopiero
-- dla spotkania, ktore JUZ ISTNIEJE. Skutek: mozna bylo przelozyc rozmowe
-- z kims, kogo sie juz zna, i nie mozna bylo zaprosic nikogo nowego -
-- czyli gielda dzialala wszedzie poza pierwszym kontaktem.
--
-- KATALOG UZYWA TEJ SAMEJ REGULY, CO ZAPROSZENIE. Kazdy wiersz przechodzi
-- przez `_event_meeting_can_invite`, a nie przez wlasna, rownolegla wersje
-- warunkow. To jest jedyny sposob, zeby lista nie pokazala kogos, komu
-- `event_meeting_invite` zaraz odmowi - a odmowa po kliknieciu "Umow" jest
-- gorsza niz nieobecnosc na liscie.
--
-- WIDOCZNOSC UCZESTNIKOW MA JUZ MODEL W BAZIE I TO JEGO PIERWSZY KONSUMENT.
-- `event_groups.can_see_attendees` i `event_groups.attendee_visibility`
-- ('none' | 'own_group' | 'registered' | 'everyone') istnieja od migracji grup,
-- sa zapisywane przez panel i NIE BYLY DOTAD CZYTANE przez zadna regule.
-- Katalog czyta je wprost: bez `can_see_attendees` nie ma listy, `own_group`
-- zawezza ja do wlasnych grup, `registered`/`everyone` otwiera na wszystkich
-- zapisanych. Nie dokladamy wiec nowego pojecia widocznosci - wlaczamy to,
-- ktore juz jest.
--
-- ZGODA UCZESTNIKA JEST OSOBNA DZWIGNIA. `event_registrations.directory_opt_out`
-- to jedyne miejsce, w ktorym CZLOWIEK, a nie organizator, decyduje o swojej
-- obecnosci na liscie. Domyslnie `false`, bo obecnosc na gieldzie jest CELEM
-- zapisu na gielde, ale wypisanie sie musi byc mozliwe jednym kliknieciem
-- i bez proszenia organizatora.
--
-- CO KATALOG ODDAJE, A CZEGO NIE. Imie, nazwisko, stanowisko, firma i grupa -
-- czyli dokladnie to, co drukuje sie na identyfikatorze i co widac na sali.
-- ZERO danych kontaktowych: adres poczty i telefon naleza do sciezki zgody
-- partnerskiej (`event_lead_scans`), a nie do listy uczestnikow.

-- ---------------------------------------------------------------------------
-- 1. Dzwignia uczestnika
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS directory_opt_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_registrations.directory_opt_out IS
  'Uczestnik wypisal sie z katalogu gieldy spotkan. Ustawiane WYLACZNIE przez wlasciciela zapisu (event_meeting_directory_visibility_set); organizator nie ma tu przelacznika, bo to jest decyzja osoby, a nie wydarzenia.';

CREATE INDEX IF NOT EXISTS event_registrations_directory_idx
  ON public.event_registrations (tenant_id, event_id, status)
  WHERE directory_opt_out = false;

-- ---------------------------------------------------------------------------
-- 2. Widocznosc katalogu dla wolajacego
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public._event_meeting_directory_scope(uuid, uuid, uuid);
CREATE FUNCTION public._event_meeting_directory_scope(
  _tenant uuid,
  _event_id uuid,
  _registration_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- NAJSZERSZA widocznosc z grup wolajacego. Uczestnik bywa w dwoch grupach
  -- (np. "Prelegenci" i "Partnerzy"); zawezenie do najwezszej odebraloby mu
  -- to, co daje druga grupa, a organizator nie ma jak tego przewidziec.
  -- Grupa bez `can_see_attendees` nie wnosi nic - CHECK w tabeli pilnuje, ze
  -- ma wtedy `attendee_visibility = 'none'`.
  SELECT COALESCE(
    (
      SELECT CASE max(
        CASE g.attendee_visibility
          WHEN 'everyone' THEN 3
          WHEN 'registered' THEN 2
          WHEN 'own_group' THEN 1
          ELSE 0
        END
      )
        WHEN 3 THEN 'everyone'
        WHEN 2 THEN 'registered'
        WHEN 1 THEN 'own_group'
        ELSE 'none'
      END
      FROM public._event_meeting_groups(_tenant, _event_id, _registration_id) AS mg(group_id)
      JOIN public.event_groups g
        ON g.id = mg.group_id AND g.tenant_id = _tenant
      WHERE g.can_see_attendees
    ),
    'none'
  );
$$;

REVOKE ALL ON FUNCTION public._event_meeting_directory_scope(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_directory_scope(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_meeting_directory_scope(uuid, uuid, uuid) IS
  'Najszersza widocznosc uczestnikow z grup wolajacego: none | own_group | registered | everyone. Pierwszy konsument kolumn event_groups.can_see_attendees i attendee_visibility. Pomocnik wewnetrzny.';

-- ---------------------------------------------------------------------------
-- 3. Katalog
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.event_meeting_directory(jsonb);
CREATE FUNCTION public.event_meeting_directory(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_q text := NULLIF(btrim(COALESCE(p_payload->>'q', '')), '');
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 24), 1), 100);
  v_offset integer := GREATEST(COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0), 0);
  v_event public.events;
  v_me uuid;
  v_opt_out boolean := false;
  v_enabled boolean;
  v_visibility text;
  v_scope text;
  v_blocked text;
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to browse the participant list';
  END IF;

  IF v_tenant IS NULL OR (v_slug IS NULL AND v_event_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: event_slug or event_id is required';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    );

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT s.is_enabled, s.visibility INTO v_enabled, v_visibility
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event.id);

  IF v_me IS NOT NULL THEN
    SELECT r.directory_opt_out INTO v_opt_out
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.id = v_me;
  END IF;

  -- Powody sa STOPNIOWANE, bo kazdy ma inne nastepne dzialanie: "gielda
  -- wylaczona" znaczy czekaj, "nie jestes zapisany" znaczy zapisz sie,
  -- "twoja grupa nie widzi listy" znaczy napisz do organizatora.
  v_blocked := CASE
    WHEN v_visibility IS NULL OR NOT v_enabled THEN 'meetings_disabled'
    WHEN v_visibility = 'disabled' THEN 'exchange_rule_closed'
    WHEN v_me IS NULL THEN 'requester_not_participating'
    ELSE NULL
  END;

  IF v_blocked IS NULL THEN
    v_scope := public._event_meeting_directory_scope(v_tenant, v_event.id, v_me);
    IF v_scope = 'none' THEN
      v_blocked := 'directory_hidden';
    END IF;
  END IF;

  IF v_blocked IS NULL THEN
    -- JEDNA INSTRUKCJA, DWA WYNIKI. Wspolne wyrazenie tabelaryczne (`WITH`)
    -- zyje wylacznie w obrebie SWOJEJ instrukcji, wiec policzenie calosci
    -- osobnym `SELECT ... FROM candidates` po prostu nie widzialoby tej nazwy.
    -- Liczba i strona wychodza wiec razem - a przy okazji z JEDNEGO przebiegu
    -- predykatu, ktory dla kazdego wiersza wola `_event_meeting_can_invite`.
    WITH candidates AS (
      SELECT
        r.id AS registration_id,
        p.first_name,
        p.last_name,
        p.job_title,
        COALESCE(NULLIF(btrim(p.company_text), ''), co.name) AS company
      FROM public.event_registrations r
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.crm_companies co
        ON co.tenant_id = p.tenant_id AND co.id = p.company_id
      WHERE r.tenant_id = v_tenant
        AND r.event_id = v_event.id
        AND r.id <> v_me
        AND r.status IN ('approved', 'attended')
        AND r.directory_opt_out = false
        -- Ta sama regula, co przy zaproszeniu - patrz naglowek migracji.
        AND public._event_meeting_can_invite(v_tenant, v_event.id, v_me, r.id) IS NULL
        AND (
          v_scope <> 'own_group'
          OR EXISTS (
            SELECT 1
            FROM public._event_meeting_groups(v_tenant, v_event.id, r.id) AS theirs(group_id)
            WHERE theirs.group_id IN (
              SELECT mine.group_id
              FROM public._event_meeting_groups(v_tenant, v_event.id, v_me) AS mine(group_id)
            )
          )
        )
        AND (
          v_group_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public._event_meeting_groups(v_tenant, v_event.id, r.id) AS theirs(group_id)
            WHERE theirs.group_id = v_group_id
          )
        )
        AND (
          v_q IS NULL
          OR p.full_name_norm LIKE '%' || lower(btrim(v_q)) || '%'
          OR lower(COALESCE(NULLIF(btrim(p.company_text), ''), co.name, '')) LIKE
             '%' || lower(btrim(v_q)) || '%'
        )
    ),
    totals AS (
      SELECT count(*)::integer AS n FROM candidates
    ),
    page AS (
      SELECT c.*
      FROM candidates c
      ORDER BY c.last_name, c.first_name, c.registration_id
      LIMIT v_limit OFFSET v_offset
    )
    SELECT
      (SELECT t.n FROM totals t),
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'registration_id', pg.registration_id,
              'first_name', pg.first_name,
              'last_name', pg.last_name,
              'job_title', pg.job_title,
              'company', pg.company,
              'groups', (
                SELECT COALESCE(jsonb_agg(
                  jsonb_build_object(
                    'id', g.id,
                    'name_pl', g.name_pl,
                    'name_en', g.name_en,
                    'color', g.color
                  ) ORDER BY g.sort_order, g.name_pl
                ), '[]'::jsonb)
                FROM public._event_meeting_groups(v_tenant, v_event.id, pg.registration_id)
                  AS mg(group_id)
                JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = v_tenant
              ),
              -- Czy ten czlowiek zglosil KIEDYKOLWIEK okno dostepnosci. Bez tego
              -- lista wyglada jednakowo, a zaproszenie do kogos bez ani jednego
              -- wolnego terminu jest z gory nieskuteczne.
              'has_availability', EXISTS (
                SELECT 1 FROM public.event_meeting_availability a
                WHERE a.tenant_id = v_tenant
                  AND a.event_id = v_event.id
                  AND a.registration_id = pg.registration_id
                  AND a.is_open
              ),
              -- Stan rozmowy MIEDZY NAMI: zywe zaproszenie albo przyjete
              -- spotkanie zamienia przycisk "Zapros" na odnosnik do terminarza.
              'meeting_status', (
                SELECT m.status
                FROM public.event_meetings m
                WHERE m.tenant_id = v_tenant
                  AND m.event_id = v_event.id
                  AND m.pair_low = LEAST(v_me, pg.registration_id)
                  AND m.pair_high = GREATEST(v_me, pg.registration_id)
                  AND m.status IN ('invited', 'accepted')
                ORDER BY m.starts_at
                LIMIT 1
              )
            ) ORDER BY pg.last_name, pg.first_name, pg.registration_id
          )
          FROM page pg
        ),
        '[]'::jsonb
      )
    INTO v_total, v_rows;
  END IF;

  RETURN jsonb_build_object(
    'blocked', v_blocked,
    'visibility', v_visibility,
    'scope', COALESCE(v_scope, 'none'),
    'my_registration_id', v_me,
    'directory_opt_out', v_opt_out,
    'total_count', v_total,
    'rows', v_rows,
    'groups', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name_pl', g.name_pl,
          'name_en', g.name_en,
          'color', g.color
        ) ORDER BY g.sort_order, g.name_pl
      ), '[]'::jsonb)
      FROM public.event_groups g
      WHERE g.tenant_id = v_tenant
        AND g.event_id = v_event.id
        AND g.can_meet
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_directory(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_directory(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_directory(jsonb) IS
  'Katalog uczestnikow gieldy dla zalogowanego uczestnika: {"event_slug"|"event_id", "q", "group_id", "limit", "offset"}. Kazdy wiersz przechodzi przez te sama regule, co event_meeting_invite, wiec lista nie pokazuje nikogo, komu zaproszenie zaraz odmowi. Zakres per widz z event_groups.attendee_visibility, wypisanie sie z event_registrations.directory_opt_out. Bez danych kontaktowych. Plaszczyzna tresci - zero has_role().';

-- ---------------------------------------------------------------------------
-- 4. Wypisanie sie z katalogu
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.event_meeting_directory_visibility_set(jsonb);
CREATE FUNCTION public.event_meeting_directory_visibility_set(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_listed boolean := (NULLIF(p_payload->>'listed', ''))::boolean;
  v_event public.events;
  v_me uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to change your listing';
  END IF;

  IF v_tenant IS NULL OR (v_slug IS NULL AND v_event_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: event_slug or event_id is required';
  END IF;

  IF v_listed IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: listed must be true or false';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    );

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  -- Wlasny zapis wyszukujemy tym samym pomocnikiem, co reszta gieldy: to on
  -- wie, ze zapis nalezy do OSOBY powiazanej z kontem, a nie do konta.
  v_me := public._event_meeting_caller_registration(v_tenant, v_event.id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'requester_not_participating: you are not registered for this event';
  END IF;

  UPDATE public.event_registrations r
  SET directory_opt_out = NOT v_listed,
      updated_at = now()
  WHERE r.tenant_id = v_tenant AND r.id = v_me;

  RETURN jsonb_build_object('registration_id', v_me, 'listed', v_listed);
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_directory_visibility_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_directory_visibility_set(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_directory_visibility_set(jsonb) IS
  'Wlasciciel zapisu wlacza albo wylacza swoja obecnosc w katalogu gieldy: {"event_slug"|"event_id", "listed": bool}. Jedyna droga zapisu do event_registrations.directory_opt_out z plaszczyzny uczestnika.';
