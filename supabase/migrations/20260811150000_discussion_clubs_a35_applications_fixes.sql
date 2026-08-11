-- ============================================================================
-- A35: ZGLOSZENIA DO KLUBOW - Z ETYKIETY BEZ SKUTKOW W DOMKNIETA SCIEZKE
--
-- Audyt 2026-08-11 (docs/AUDYT_KLUBY_ZGLOSZENIA_PROFIL_CRM_2026-08-11.md)
-- pokazal, ze cala funkcjonalnosc zgloszen PRO+ nie dzialala w ZADNYM
-- przypadku, a to, co mialo dzialac po jej naprawieniu, nie mialo skutkow.
-- Ta migracja zamyka osiem rzeczy, ktore lacza sie w jedna sciezke:
-- "wyslij zgloszenie -> zobacz jego status -> komisja decyduje -> decyzja ma
-- konsekwencje -> dane osoby sa w eksporcie i gina razem z kontem".
--
-- 1) `source_type = 'club_application'` lamalo CHECK na `crm_leads`, a oba
--    zapisy (`club_applications` + `crm_leads`) siedza w jednej transakcji
--    jednej funkcji, wiec wyjatek z drugiego wycofywal pierwszy. CHECK jest
--    liczony na wierszu PROPONOWANYM do wstawienia, wiec `ON CONFLICT DO
--    UPDATE` nie ratowal nawet powracajacego kandydata - to jest ta czesc,
--    ktora przy czytaniu kodu wyglada na bezpieczna.
--
-- 2) `accepted` bylo etykieta bez konsekwencji: bez czlonkostwa, bez
--    powiadomienia, bez sladu w profilu. Wszystkie klocki (`club_members`
--    z `invite_source = 'auto'`, `club_notify`, semantyka back-fillu
--    z `join_us_link_and_backfill`) istnialy i zaden nie byl podlaczony.
--
-- 3) CRM dostawal lead ubozszy niz lead z formularza kontaktowego, bo
--    funkcja pisala surowy INSERT obok kanonicznej `crm_upsert_from_form`
--    (gubione: `country`, `linkedin_url`, `company_id`, `source_count`,
--    `aliases`). Sama podmiana na kanoniczna funkcje to jednak REGRES:
--    ona nie rusza `source_type` ani `marketing_consent`, wiec po niej MUSI
--    isc jawny UPDATE. Dlatego CRM jest tu dwoma krokami, nie jednym.
--
-- 4) Bramka planu nie zagladala w `clubs.min_tier_rank`, wiec PRO mogl zostac
--    przyjety do klubu, do ktorego `club_capabilities` nigdy go nie wpusci.
--
-- 5) Kandydat nie widzial wlasnego zgloszenia (GRANT i polityka RLS byly
--    nadane pod konsumenta, ktorego nie napisano), a `club_applications` -
--    najbogatszy zbior danych osobowych w calym module - byl poza eksportem
--    RODO i nie mial sciezki anonimizacji.
--
-- CZEGO TU NIE MA SWIADOMIE. Zadnego `emit_domain_event` - zdarzenie bez
-- konsumenta nie jest neutralne, a decyzja komisji juz zostawia slad
-- (`reviewed_by`/`reviewed_at`) i powiadomienie. Zadnego dotykania
-- `phone_norm` ani scoringu CRM - robia to triggery `crm_leads`
-- (`crm_normalize_lead`, `crm_leads_sync_phone_norm_trg`,
-- `trg_score_on_lead_change`), a dublowanie ich bylo pierwotnym bledem
-- pierwszej wersji audytu.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1) crm_leads.source_type: 'club_application' wchodzi do zbioru dozwolonych
--
-- Ograniczenie z 20260722094744 powstalo przed modulem klubow i nigdy nie
-- zostalo rozszerzone. Wybieramy rozszerzenie, a nie wartosc z istniejacego
-- zbioru, bo `source_type` ma indeks `crm_leads_tenant_source_type_idx` i jest
-- naturalnym wymiarem raportu "skad przyszedl lead"; `club_applied_at`
-- odpowiada na inne pytanie ("kiedy") i zostaje filtrem raportowym dla leadow,
-- ktore weszly do CRM wczesniej z innego zrodla (patrz A3, krok 2).
--
-- ADD CONSTRAINT waliduje wiersze istniejace, ale zbior jest nadzbiorem
-- poprzedniego, wiec zaden wiersz nie moze go naruszyc.
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_source_type_check;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_source_type_check
  CHECK (source_type IN ('registered','paid_subscriber','event_participant',
    'speaker','expert','contact_form','newsletter','manual','club_application'));

-- ----------------------------------------------------------------------------
-- A2) Jedno OTWARTE zgloszenie na osobe i specjalizacje
--
-- Indeks jest zabezpieczeniem WYSCIGU (dwie rowoczesne wysylki), a nie
-- komunikatem - czytelna odmowe daje jawne sprawdzenie w `club_apply_submit`.
-- Warunek obejmuje wylacznie statusy otwarte: po decyzji komisji ponowne
-- zgloszenie tej samej specjalizacji jest zachowaniem dozwolonym (kandydat
-- mogl zmienic prace, zebrac dorobek, dostac inny plan).
--
-- Back-fillu deduplikujacego nie ma, bo nie ma czego deduplikowac: do A1
-- KAZDA wysylka konczyla sie wycofaniem transakcji, wiec tabela nie zawiera
-- ani jednego wiersza z produkcji.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS club_applications_open_unique_idx
  ON public.club_applications (user_id, specialization_slug)
  WHERE status IN ('pending', 'review');

COMMENT ON INDEX public.club_applications_open_unique_idx IS
  'Jedno otwarte zgloszenie na osobe i specjalizacje. Po decyzji komisji (accepted/rejected) ponowne zgloszenie jest dozwolone.';

-- Symetria polityk wlascicielskich (bramka check:sql-owner-tenant-scope).
-- `club_applications_select_admin` wiaze wiersz z tenantem PROFILU wolajacego,
-- a `club_applications_select_own` zostala przy golym `user_id = auth.uid()`.
-- Ta asymetria jest tym samym bledem, ktory audyt 2026-08-03 znalazl na
-- `author_profiles`: ten sam wiersz byl zapisywalny w tenancie domowym,
-- a odczytywalny w dowolnym kontekscie tenanta. Tutaj jeszcze nic nie
-- przecieka (odczyt idzie przez SECURITY DEFINER RPC), ale polityka jest
-- deklaracja i musi mowic to samo w obie strony.
DROP POLICY IF EXISTS club_applications_select_own ON public.club_applications;
CREATE POLICY club_applications_select_own
  ON public.club_applications FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- A3) club_apply_submit: bramki, walidacja i KANONICZNE wejscie do CRM
--
-- Kolejnosc bramek jest czescia kontraktu z klientem: `clubApplyErrorCode()`
-- dopasowuje kody po `message.includes`, a interfejs podswietla pole, ktore
-- kod nazywa. Dlatego bramka planu klubu stoi PRZED walidacja pol formularza -
-- osobie, ktora nie wejdzie do wybranego klubu, nie kazemy najpierw poprawiac
-- motywacji.
--
-- `years_experience` bylo jedynym polem rzutowanym bez oslony: `::integer` na
-- tekscie od wolajacego dawal 22P02, ktorego klient nie umie zmapowac i
-- pokazywal "sprobuj ponownie" na bledzie deterministycznym. Rzutowanie idzie
-- teraz DOPIERO po regexie.
--
-- CRM to dwa kroki i kolejnosc jest obowiazkowa. Krok 1 (`crm_upsert_from_form`)
-- daje deduplikacje, `company_id`, `country`, `linkedin_url`, `aliases`
-- i `source_count`. Krok 2 dopisuje to, czego kanoniczna funkcja nie rusza:
-- `source_type` oraz zgode marketingowa - zawsze W GORE (`OR`), nigdy w dol,
-- bo zgoda wycofana w profilu nie moze wrocic przez formularz klubowy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_apply_submit(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_rank integer;
  v_key text;
  v_id uuid;
  v_email text;
  v_spec text;
  v_txt text;
  v_club_id uuid;
  v_reason text;
  v_years_raw text;
  v_years integer;
  v_first text;
  v_last text;
  v_phone text;
  v_company text;
  v_position text;
  v_country text;
  v_linkedin text;
  v_marketing boolean;
  v_lead uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- Prog globalny "zgloszenia od PRO w gore". Ranga sumuje subskrypcje, granty
  -- reczne i seaty organizacji, wiec PRO z kazdego zrodla przechodzi jednakowo.
  -- Literal 20 jest wiazany z klientem bramka `clubPlanTierParity`.
  SELECT rank, key INTO v_rank, v_key FROM public.current_membership_tier();
  IF COALESCE(v_rank, 0) < 20 THEN
    RAISE EXCEPTION 'pro_required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;

  v_spec := NULLIF(btrim(COALESCE(p->>'specialization_slug', '')), '');
  IF v_spec IS NULL THEN
    RAISE EXCEPTION 'specialization_required';
  END IF;

  -- Prog WLASNY klubu. `club_capabilities` jest w tym module jedynym zrodlem
  -- prawdy o dostepie; bez tej bramki komisja mogla przyjac PRO do klubu VIP,
  -- a kandydat i tak zobaczylby zamkniete drzwi przy pierwszym wejsciu.
  -- Wskazanie klubu jest opcjonalne - zgloszenie "do specjalizacji" zostaje
  -- dozwolone i nie ma wtedy czego sprawdzac.
  v_club_id := NULLIF(btrim(COALESCE(p->>'club_id', '')), '')::uuid;
  IF v_club_id IS NOT NULL THEN
    SELECT reason INTO v_reason
      FROM public.club_capabilities(v_club_id, NULL, v_uid);
    IF v_reason = 'tier_too_low' THEN
      RAISE EXCEPTION 'club_tier_too_low';
    END IF;
  END IF;

  IF COALESCE((p->>'consent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'consent_required';
  END IF;

  v_email := lower(btrim(COALESCE(p->>'email', '')));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'email_required';
  END IF;

  v_txt := btrim(COALESCE(p->>'motivation', ''));
  IF length(v_txt) < 20 THEN
    RAISE EXCEPTION 'motivation_required';
  END IF;

  -- Regex PRZED rzutowaniem: inaczej "dwadziescia lat" konczy sie bledem
  -- skladni typu integer, ktory na kliencie wyglada jak awaria serwera.
  -- Gorny prog 70 jest ta sama regula, ktora pilnuje formularz.
  v_years_raw := NULLIF(btrim(COALESCE(p->>'years_experience', '')), '');
  IF v_years_raw IS NOT NULL THEN
    IF v_years_raw !~ '^\d{1,2}$' THEN
      RAISE EXCEPTION 'years_invalid';
    END IF;
    v_years := v_years_raw::integer;
    IF v_years > 70 THEN
      RAISE EXCEPTION 'years_invalid';
    END IF;
  END IF;

  -- Jawne sprawdzenie duplikatu daje komunikat; indeks z A2 lapie wyscig.
  IF EXISTS (
    SELECT 1 FROM public.club_applications a
     WHERE a.user_id = v_uid
       AND a.specialization_slug = v_spec
       AND a.status IN ('pending', 'review')
  ) THEN
    RAISE EXCEPTION 'duplicate_open';
  END IF;

  -- Pola wspolne dla zgloszenia i dla CRM licza sie raz - inaczej dwa zapisy
  -- moglyby sie rozjechac na obcinaniu dlugosci.
  v_first := left(btrim(COALESCE(p->>'first_name', '')), 60);
  v_last := left(btrim(COALESCE(p->>'last_name', '')), 80);
  v_phone := left(btrim(COALESCE(p->>'phone', '')), 32);
  v_company := left(btrim(COALESCE(p->>'company', '')), 120);
  v_position := left(btrim(COALESCE(p->>'job_position', '')), 120);
  v_country := left(btrim(COALESCE(p->>'country', '')), 80);
  v_linkedin := left(btrim(COALESCE(p->>'linkedin_url', '')), 200);
  v_marketing := COALESCE((p->>'marketing_consent')::boolean, false);

  INSERT INTO public.club_applications (
    tenant_id, user_id, specialization_slug, club_id,
    first_name, last_name, email, phone, company, job_position, seniority, industry,
    country, city, linkedin_url, years_experience, expertise, languages,
    motivation, goals, contribution, availability, referral_source,
    consent, marketing_consent, tier_key, tier_rank, lang
  ) VALUES (
    v_tenant, v_uid, v_spec, v_club_id,
    v_first, v_last, left(v_email, 254), v_phone, v_company, v_position,
    left(btrim(COALESCE(p->>'seniority','')), 60),
    left(btrim(COALESCE(p->>'industry','')), 60),
    v_country,
    left(btrim(COALESCE(p->>'city','')), 80),
    v_linkedin, v_years,
    left(btrim(COALESCE(p->>'expertise','')), 500),
    left(btrim(COALESCE(p->>'languages','')), 200),
    left(v_txt, 2000),
    left(btrim(COALESCE(p->>'goals','')), 1000),
    left(btrim(COALESCE(p->>'contribution','')), 1000),
    left(btrim(COALESCE(p->>'availability','')), 120),
    left(btrim(COALESCE(p->>'referral_source','')), 120),
    true,
    v_marketing,
    COALESCE(v_key, ''), COALESCE(v_rank, 0),
    CASE WHEN COALESCE(p->>'lang','pl') = 'en' THEN 'en' ELSE 'pl' END
  )
  RETURNING id INTO v_id;

  -- Krok 1: kanoniczne wejscie leada z formularza.
  v_lead := public.crm_upsert_from_form(
    v_tenant, v_email,
    NULLIF(v_first, ''), NULLIF(v_last, ''), NULLIF(v_phone, ''),
    NULLIF(v_company, ''), NULLIF(v_position, ''), NULLIF(v_linkedin, ''),
    NULLIF(v_country, ''), 'club_application'
  );

  -- Krok 2: to, czego kanoniczna funkcja nie rusza. `IF v_lead IS NOT NULL`,
  -- bo `crm_upsert_from_form` zwraca NULL przy pustym e-mailu - tu nie moze do
  -- tego dojsc (bramka `email_required` wyzej), ale zaleznosc od cudzej funkcji
  -- nie jest miejscem na zaklad.
  IF v_lead IS NOT NULL THEN
    UPDATE public.crm_leads l
       SET source_type = 'club_application',
           marketing_consent = l.marketing_consent OR v_marketing,
           club_applied_at = now(),
           club_application_count = l.club_application_count + 1,
           club_specializations = (
             SELECT ARRAY(
               SELECT DISTINCT s
                 FROM unnest(l.club_specializations || ARRAY[v_spec]) AS s
             )
           ),
           last_activity_at = now(),
           updated_at = now()
     WHERE l.id = v_lead;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_apply_submit(jsonb) IS
  'Zgloszenie do klubu: bramka planu globalna i wlasna klubu, walidacja pol, jedno otwarte zgloszenie na specjalizacje, wejscie do CRM przez crm_upsert_from_form + jawny UPDATE zrodla i zgody (zgoda tylko w gore).';

REVOKE ALL ON FUNCTION public.club_apply_submit(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.club_apply_submit(jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- A4) admin_club_application_set_status: decyzja ma konsekwencje
--
-- Trzy skutki `accepted` w jednym przejsciu: czlonkostwo, profil,
-- powiadomienie. Back-fill wlasnie TUTAJ, a nie przy wysylce - do profilu
-- widocznego w sieci kontaktow wchodzi tylko to, co komisja zaakceptowala.
--
-- BAN NIE JEST ZDEJMOWANY. To powtorka bledu naprawionego w A19 (akceptacja
-- starego zaproszenia kasowala bana): `ON CONFLICT DO UPDATE SET status =
-- 'active'` bezwarunkowo wpuszczalo zbanowanego z powrotem. Warunek jest
-- wiec jawnie po statusie, ktory MOZE wrocic do 'active'.
--
-- Zgloszenie moze nie wskazywac klubu (`club_id IS NULL`) - wtedy nie ma czego
-- utworzyc, ale back-fill i powiadomienie dzialaja bez zmian: decyzja komisji
-- dotyczy specjalizacji, przypisanie do klubu jest osobnym krokiem redakcji.
--
-- IDEMPOTENCJA. Ponowne `accepted` nie duplikuje czlonkostwa (ON CONFLICT),
-- nie nadpisuje wypelnionych pol profilu (COALESCE/NULLIF) i nie wysyla
-- drugiego powiadomienia - to ostatnie pilnuje porownanie ze statusem
-- pobranym PRZED zapisem. Skutki po stronie danych powtarzamy swiadomie:
-- jesli poprzednie przejscie przerwalo sie w polowie, drugie klikniecie ma je
-- domknac, a nie zamilczec.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_application_set_status(
  p_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_actor uuid := auth.uid();
  v_app public.club_applications%ROWTYPE;
  v_old text;
  v_club public.clubs%ROWTYPE;
  v_href text := '/club';
BEGIN
  IF p_status NOT IN ('pending','review','accepted','rejected') THEN
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
  v_old := v_app.status;

  UPDATE public.club_applications
     SET status = p_status,
         admin_note = COALESCE(left(btrim(p_note), 2000), admin_note),
         reviewed_by = v_actor,
         reviewed_at = now()
   WHERE id = v_app.id;

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

    -- Back-fill TYLKO pustych pol, semantyka `join_us_link_and_backfill`.
    -- Skalowanie po tenancie, zeby admin jednego tenanta nie pisal do profilu
    -- z drugiego, gdyby dane sie rozjechaly.
    UPDATE public.profiles
       SET first_name      = COALESCE(NULLIF(first_name, ''),      NULLIF(v_app.first_name, '')),
           last_name       = COALESCE(NULLIF(last_name, ''),       NULLIF(v_app.last_name, '')),
           phone           = COALESCE(NULLIF(phone, ''),           NULLIF(v_app.phone, '')),
           current_company = COALESCE(NULLIF(current_company, ''), NULLIF(v_app.company, '')),
           job_title       = COALESCE(NULLIF(job_title, ''),       NULLIF(v_app.job_position, '')),
           location        = COALESCE(NULLIF(location, ''),        NULLIF(v_app.country, '')),
           linkedin_url    = COALESCE(NULLIF(linkedin_url, ''),    NULLIF(v_app.linkedin_url, '')),
           updated_at      = now()
     WHERE id = v_app.user_id
       AND tenant_id = v_tenant;
  END IF;

  -- Powiadomienie wylacznie przy FAKTYCZNEJ zmianie decyzji. `club_notify`
  -- samo odsiewa powiadomienie o wlasnym dzialaniu, wiec redaktor
  -- rozpatrujacy wlasne zgloszenie nie dostaje wiadomosci od siebie.
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
  'Decyzja komisji: status + notatka, a przy accepted takze czlonkostwo (ON CONFLICT nie zdejmuje bana), back-fill pustych pol profilu i powiadomienie. Powiadomienie tylko przy faktycznej zmianie statusu; reszta skutkow jest idempotentna.';

REVOKE ALL ON FUNCTION public.admin_club_application_set_status(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_application_set_status(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- A5) admin_club_applications_list: nazwa klubu w obu jezykach
--
-- Reszta modulu konsekwentnie oddaje `name_pl` i `name_en` i wybiera w widoku;
-- ta jedna skrzynka oddawala `c.name_pl AS club_name`, wiec admin w EN czytal
-- polskie nazwy.
--
-- ZMIANA KSZTALTU ZWROTU = DROP + CREATE. Sam `CREATE OR REPLACE` nie zmieni
-- listy kolumn zwracanych, a bez DROP-a przy odtwarzaniu bazy od zera zostaloby
-- drugie przeciazenie (42723).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_applications_list(text, uuid, text, text, integer);

CREATE OR REPLACE FUNCTION public.admin_club_applications_list(
  p_specialization text DEFAULT NULL,
  p_club_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  id uuid, created_at timestamptz, user_id uuid, specialization_slug text,
  club_id uuid, club_name_pl text, club_name_en text,
  first_name text, last_name text, email text,
  phone text, company text, job_position text, seniority text, industry text,
  country text, city text, linkedin_url text, years_experience integer,
  expertise text, languages text, motivation text, goals text, contribution text,
  availability text, referral_source text, marketing_consent boolean,
  tier_key text, tier_rank integer, status text, admin_note text,
  reviewed_at timestamptz, lang text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.created_at, a.user_id, a.specialization_slug,
         a.club_id, c.name_pl AS club_name_pl, c.name_en AS club_name_en,
         a.first_name, a.last_name, a.email,
         a.phone, a.company, a.job_position, a.seniority, a.industry,
         a.country, a.city, a.linkedin_url, a.years_experience,
         a.expertise, a.languages, a.motivation, a.goals, a.contribution,
         a.availability, a.referral_source, a.marketing_consent,
         a.tier_key, a.tier_rank, a.status, a.admin_note,
         a.reviewed_at, a.lang
    FROM public.club_applications a
    LEFT JOIN public.clubs c ON c.id = a.club_id
   WHERE a.tenant_id = public.assert_admin_tenant()
     AND (p_specialization IS NULL OR a.specialization_slug = p_specialization)
     AND (p_club_id IS NULL OR a.club_id = p_club_id)
     AND (p_status IS NULL OR a.status = p_status)
     AND (
       p_search IS NULL OR btrim(p_search) = ''
       OR a.email ILIKE '%' || btrim(p_search) || '%'
       OR (a.first_name || ' ' || a.last_name) ILIKE '%' || btrim(p_search) || '%'
       OR a.company ILIKE '%' || btrim(p_search) || '%'
     )
   ORDER BY a.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

COMMENT ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) IS
  'Skrzynka zgloszen dla admina tenanta. Nazwa klubu wychodzi w obu jezykach - wybor jezyka nalezy do widoku, nie do bazy.';

REVOKE ALL ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- A6) club_export_my_data: zgloszenia wchodza do eksportu RODO
--
-- `club_applications` to najbogatszy zbior danych osobowych w calym module
-- i jednoczesnie wzorcowy przyklad danych DOSTARCZONYCH przez osobe (art. 20
-- RODO): opisala w nim sama siebie. Eksport oddawal komplet aktywnosci
-- klubowej i pomijal formularz.
--
-- `admin_note` NIE WYCHODZI. To notatka komisji o kandydacie, nie dana przez
-- niego dostarczona; jej ujawnienie przez eksport zamienilo by wewnetrzna
-- ocene w kanal komunikacji z kandydatem. Status decyzji owszem wychodzi -
-- bez niego eksport nie mowilby, co sie ze zgloszeniem stalo.
--
-- Cala dotychczasowa tresc funkcji zostaje bez zmian - to CREATE OR REPLACE,
-- wiec pominiecie ktorejkolwiek sekcji usunelo by ja z eksportu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_export_my_data(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  -- Sufit wierszy przychodzi z warstwy aplikacji (ROW_LIMIT eksportu), ale
  -- bramka jest tutaj: eksport ma byc plikiem, nie zrzutem bazy, a parametr
  -- jedzie od klienta.
  v_limit  integer := greatest(1, least(COALESCE(p_limit, 2000), 5000));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: profile not found' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    -- Czlonkostwa: rola, kadencja, tryb powiadomien, akceptacja regulaminu,
    -- zrodlo zaproszenia i powod bana. Powod bana jest DANA OSOBY, ktorej
    -- dotyczy - zatajenie go w eksporcie bylo poprzednio jedynym sposobem,
    -- w jaki mogla sie o nim nie dowiedziec.
    'club_memberships', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug            AS club_slug,
            c.name_pl         AS club_name_pl,
            c.name_en         AS club_name_en,
            m.role,
            m.status,
            m.notify_level,
            m.role_expires_at,
            m.rules_accepted_at,
            m.invite_source,
            m.banned_reason,
            m.joined_at,
            m.last_read_at,
            m.unread_count,
            m.created_at,
            m.updated_at
          FROM public.club_members m
          JOIN public.clubs c ON c.id = m.club_id
         WHERE m.user_id = v_uid
           AND m.tenant_id = v_tenant
           AND c.tenant_id = v_tenant
         ORDER BY m.joined_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Zgloszenia do klubow: dane zawodowe, motywacja, cele i wklad, ktory
    -- osoba sama opisala, plus decyzja komisji. Bez `admin_note`.
    'club_applications', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            a.specialization_slug,
            c.name_pl AS club_name_pl,
            c.name_en AS club_name_en,
            a.first_name,
            a.last_name,
            a.email,
            a.phone,
            a.company,
            a.job_position,
            a.seniority,
            a.industry,
            a.country,
            a.city,
            a.linkedin_url,
            a.years_experience,
            a.expertise,
            a.languages,
            a.motivation,
            a.goals,
            a.contribution,
            a.availability,
            a.referral_source,
            a.consent,
            a.marketing_consent,
            a.tier_key,
            a.tier_rank,
            a.status,
            a.reviewed_at,
            a.created_at,
            a.lang
          FROM public.club_applications a
          LEFT JOIN public.clubs c ON c.id = a.club_id
         WHERE a.user_id = v_uid
           AND a.tenant_id = v_tenant
         ORDER BY a.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Tematy autorstwa wywolujacego - z trescia, bo art. 20 mowi o danych
    -- DOSTARCZONYCH przez osobe, a tresc wpisu jest tego przykladem wzorcowym.
    'club_threads_authored', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            th.id,
            c.slug   AS club_slug,
            g.slug   AS group_slug,
            th.slug  AS thread_slug,
            th.title,
            th.body,
            th.kind,
            th.status,
            th.is_anonymous,
            th.anchor_type,
            th.anchor_id,
            th.pinned_at,
            th.locked_at,
            th.reply_count,
            th.participant_count,
            th.reaction_count,
            th.last_reply_at,
            th.created_at,
            th.updated_at,
            th.edited_at,
            th.edit_count
          FROM public.club_threads th
          JOIN public.clubs c       ON c.id = th.club_id
          JOIN public.club_groups g ON g.id = th.group_id
         WHERE th.author_id = v_uid
           AND th.tenant_id = v_tenant
         ORDER BY th.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Odpowiedzi autorstwa wywolujacego. `thread_id` + `parent_id` zostaja,
    -- zeby dalo sie odtworzyc miejsce wypowiedzi w drzewie bez cudzych tresci.
    'club_replies_authored', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            r.id,
            c.slug  AS club_slug,
            r.thread_id,
            th.slug AS thread_slug,
            r.parent_id,
            r.depth,
            r.body,
            r.is_anonymous,
            r.status,
            r.reaction_count,
            r.created_at,
            r.updated_at,
            r.edited_at,
            r.edit_count
          FROM public.club_replies r
          JOIN public.clubs c        ON c.id = r.club_id
          JOIN public.club_threads th ON th.id = r.thread_id
         WHERE r.author_id = v_uid
           AND r.tenant_id = v_tenant
         ORDER BY r.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Stanowiska: deklaracja poparcia lub sprzeciwu wraz z uzasadnieniem.
    -- To opinia polityczna zapisana imiennie, wiec tym bardziej musi byc
    -- w eksporcie osoby, ktorej dotyczy.
    'club_stances', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            s.thread_id,
            th.slug AS thread_slug,
            th.title AS thread_title,
            c.slug  AS club_slug,
            s.stance,
            s.rationale,
            s.created_at,
            s.updated_at
          FROM public.club_stances s
          JOIN public.club_threads th ON th.id = s.thread_id
          JOIN public.clubs c         ON c.id = s.club_id
         WHERE s.user_id = v_uid
           AND s.tenant_id = v_tenant
         ORDER BY s.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_reactions', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug AS club_slug,
            rx.target_type,
            rx.target_id,
            rx.kind,
            rx.created_at
          FROM public.club_reactions rx
          JOIN public.clubs c ON c.id = rx.club_id
         WHERE rx.user_id = v_uid
           AND rx.tenant_id = v_tenant
         ORDER BY rx.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Subskrypcje watkow. Tabela nie ma `tenant_id` (klucz to para
    -- watek+osoba), wiec skalowanie idzie przez watek - inaczej wpis z innego
    -- tenanta przeciekalby do pliku.
    'club_thread_subscriptions', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            sub.thread_id,
            th.slug  AS thread_slug,
            th.title AS thread_title,
            c.slug   AS club_slug,
            sub.state,
            sub.created_at
          FROM public.club_thread_subscriptions sub
          JOIN public.club_threads th ON th.id = sub.thread_id
          JOIN public.clubs c         ON c.id = th.club_id
         WHERE sub.user_id = v_uid
           AND th.tenant_id = v_tenant
         ORDER BY sub.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Zaproszenia SKIEROWANE DO wywolujacego. `inviter_id` nie wychodzi -
    -- tozsamosc zapraszajacego jest jego dana, a tresc zaproszenia i tak
    -- pokazuje, czego dotyczylo.
    'club_invitations_received', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug AS club_slug,
            g.slug AS group_slug,
            i.club_role,
            i.message,
            i.status,
            i.created_at,
            i.responded_at,
            i.expires_at
          FROM public.club_invitations i
          JOIN public.clubs c            ON c.id = i.club_id
          LEFT JOIN public.club_groups g ON g.id = i.group_id
         WHERE i.invitee_id = v_uid
           AND i.tenant_id = v_tenant
         ORDER BY i.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.club_export_my_data(integer) IS
  'Eksport RODO modulu klubow: zgloszenia, czlonkostwa, tematy, odpowiedzi, stanowiska, reakcje, subskrypcje i zaproszenia WYWOLUJACEGO. Tabele klubowe sa RLS deny-all, wiec eksport nie ma innej drogi niz to RPC. Cudze wypowiedzi i notatki komisji (admin_note) sa wylaczeniem swiadomym (art. 15 ust. 4 RODO).';

REVOKE EXECUTE ON FUNCTION public.club_export_my_data(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_export_my_data(integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- A7) Anonimizacja zgloszen przy usunieciu konta
--
-- `club_applications.user_id` nie ma FK do `auth.users` (konwencja repo dla
-- schematu zarzadzanego), wiec nie ma kaskady: po usunieciu konta wiersz
-- zostawal w calosci - z nazwiskiem, telefonem i pracodawca - przypisany do
-- nieistniejacego uzytkownika.
--
-- Wiersz zostaje, bo bez niego znika historia decyzji komisji i statystyka
-- naboru (ile zgloszen na specjalizacje, jaki byl plan kandydatow). Ginie
-- wszystko, co wskazuje na osobe: identyfikatory bezposrednie, opis
-- pracodawcy i stanowiska oraz cala tresc wolna. Zostaja wymiary zbiorcze
-- (specjalizacja, kraj, branza, seniority, plan, status, daty) - nie mowia,
-- KTO to byl.
--
-- `admin_note` tez ginie: to swobodny tekst o konkretnej osobie, ktory po
-- usunieciu konta nie ma juz zadnego celu przetwarzania.
--
-- `user_id` zostaje jako pseudonim, bo kolumna jest NOT NULL, a zmiana tego
-- pociagnelaby za soba typy i klientow; po usunieciu konta nie wskazuje on na
-- zaden istniejacy podmiot.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_club_applications_for_user(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.club_applications
     SET first_name      = '',
         last_name       = '',
         email           = '',
         phone           = '',
         linkedin_url    = '',
         city            = '',
         company         = '',
         job_position    = '',
         motivation      = '',
         goals           = '',
         contribution    = '',
         expertise       = '',
         referral_source = '',
         admin_note      = '',
         updated_at      = now()
   WHERE user_id = _user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.anonymize_club_applications_for_user(uuid) IS
  'Usuwa dane osobowe ze zgloszen klubowych usuwanego konta, zostawiajac wiersz statystyczny (specjalizacja, status, plan, daty). Zwraca liczbe zanonimizowanych wierszy.';

REVOKE EXECUTE ON FUNCTION public.anonymize_club_applications_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_club_applications_for_user(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- A8) club_my_applications: kandydat widzi wlasne zgloszenie
--
-- GRANT SELECT i polityka `club_applications_select_own` byly nadane pod
-- konsumenta, ktorego nie napisano. Bez tego widoku jedyna racjonalna reakcja
-- na tygodnien ciszy jest wyslanie zgloszenia drugi raz - i przy braku
-- deduplikacji (A2) po prostu sie udawalo.
--
-- Wychodzi minimum, ktore odpowiada na pytanie "co sie dzieje z moim
-- zgloszeniem": kiedy zlozone, do czego, w jakim klubie, w jakim stanie,
-- kiedy rozpatrzone. `admin_note` NIE WYCHODZI - patrz A6.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_my_applications()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  specialization_slug text,
  club_id uuid,
  club_name_pl text,
  club_name_en text,
  status text,
  reviewed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.created_at, a.specialization_slug,
         a.club_id, c.name_pl AS club_name_pl, c.name_en AS club_name_en,
         a.status, a.reviewed_at
    FROM public.club_applications a
    LEFT JOIN public.clubs c ON c.id = a.club_id
   WHERE a.user_id = auth.uid()
   ORDER BY a.created_at DESC
   LIMIT 50;
$$;

COMMENT ON FUNCTION public.club_my_applications() IS
  'Wlasne zgloszenia wywolujacego: status i daty, bez notatki komisji. Piecdziesiat najnowszych - to lista w formularzu, nie archiwum.';

REVOKE ALL ON FUNCTION public.club_my_applications() FROM public;
GRANT EXECUTE ON FUNCTION public.club_my_applications() TO authenticated;
