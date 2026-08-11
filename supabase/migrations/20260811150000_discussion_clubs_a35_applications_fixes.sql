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
--
-- ============================================================================
-- NAKLADANIE, NIE ZASTEPOWANIE - dlaczego ta migracja wyglada tak, a nie inaczej
-- ============================================================================
--
-- Migracja `20260811114031_2ce402fd-1ab0-463d-9313-d39f34eac7f1.sql` (dalej:
-- "114031") niezaleznie zaimplementowala CZESC tego samego zakresu i wyszla
-- WCZESNIEJ tego samego dnia. Dodala:
--
--   * kolumny `club_applications`: `crm_lead_id`, `crm_sync_status`,
--     `crm_synced_at`, `crm_last_attempt_at`, `crm_error`, `notified_status`,
--     `notified_at`, `notify_error` (+ CHECK `crm_sync_status`),
--   * status `needs_info` w `club_applications_status_chk`,
--   * `club_application_crm_sync(uuid)` - wydzielona sciezka CRM, wolana
--     zarowno przez `club_apply_submit`, jak i `admin_club_application_crm_retry`,
--   * `admin_club_application_notify_payload` + `admin_club_application_mark_notified`
--     - kanal MAILOWY, uruchamiany RECZNIE przyciskiem w panelu,
--   * wlasne, nowsze wersje `club_apply_submit`,
--     `admin_club_application_set_status` i `admin_club_applications_list`.
--
-- Ta migracja ma PÓŹNIEJSZY znacznik czasu, wiec kazde `CREATE OR REPLACE` na
-- tych trzech funkcjach jest tu ostatnim slowem. Pierwsza wersja A35 pisala je
-- od zera i przez to CICHO WYCOFYWALA prace 114031 - kolumny zostawaly
-- w tabeli, ale nikt ich nie zapisywal, wiec panel pokazywalby wieczne
-- `crm_sync_status = 'pending'` i puste `notified_*`.
--
-- Dlatego dla KAZDEJ funkcji, ktora 114031 zdefiniowala, punktem wyjscia jest
-- CIALO Z 114031, do ktorego dokladane sa poprawki A35. Miejsca, w ktorych to
-- widac, sa oznaczone komentarzem `-- [114031]`.
--
-- Czego 114031 NIE naprawilo (i dlatego zostaje tutaj w calosci):
-- `crm_leads_source_type_check` nadal nie zna `'club_application'`, wiec ICH
-- `club_application_crm_sync` wywalalo sie dokladnie tak samo jak poprzednik -
-- z ta roznica, ze blad ladowal w `crm_error` zamiast wywracac formularz.
-- Znalezisko 1.1 stalo dalej, tylko cichsze.
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
-- `needs_info` JEST STATUSEM OTWARTYM - [114031] dodalo go do
-- `club_applications_status_chk` i ta migracja musi rozstrzygnac, po ktorej
-- stronie granicy lezy. Dowod z ICH kodu, nie z domyslu:
--   * `applicationNotify.functions.ts` daje mu CTA `/club/apply` i szablon
--     `club_application_more_info` - to prosba "uzupelnij", nie decyzja,
--   * `ClubApplicationsInbox.tsx` maluje go tym samym kolorem co `review`
--     (`statusTone`), a etykieta i18n brzmi "Do uzupelnienia" / "Needs details".
-- Komisja WCIAZ czeka, wiec drugie zgloszenie tej samej specjalizacji byloby
-- dwoma otwartymi watkami o jednej osobie - dokladnie tym, czemu ten indeks ma
-- zapobiegac. Gdyby `needs_info` byl statusem zamknietym, kandydat proszony
-- o uzupelnienie skladalby nowe zgloszenie zamiast poprawiac istniejace,
-- a `admin_note` komisji zostawalby przy wierszu, ktorego nikt juz nie czyta.
--
-- DROP przed CREATE, bo `CREATE UNIQUE INDEX IF NOT EXISTS` NIE zmienia
-- warunku istniejacego indeksu - na bazie, na ktorej wczesniejsza wersja tej
-- migracji juz sie wykonala, `needs_info` po cichu zostalby poza warunkiem.
--
-- Back-fillu deduplikujacego nie ma, bo nie ma czego deduplikowac: do A1
-- KAZDA wysylka konczyla sie wycofaniem transakcji albo (po 114031) zapisem
-- zgloszenia bez leada, wiec tabela nie zawiera wierszy z produkcji.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.club_applications_open_unique_idx;
CREATE UNIQUE INDEX club_applications_open_unique_idx
  ON public.club_applications (user_id, specialization_slug)
  WHERE status IN ('pending', 'review', 'needs_info');

COMMENT ON INDEX public.club_applications_open_unique_idx IS
  'Jedno otwarte zgloszenie na osobe i specjalizacje. Otwarte = pending, review, needs_info (komisja czeka na uzupelnienie). Po decyzji komisji (accepted/rejected) ponowne zgloszenie jest dozwolone.';

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
-- A3) club_apply_submit: bramki i walidacja NA CIELE Z [114031]
--
-- Punkt wyjscia to ich wersja, nie moja. Ich wklad, ktory tu zostaje bez
-- zmiany znaczenia:
--   * sciezka CRM jest WYDZIELONA do `club_application_crm_sync(p_id)` i wolana
--     przez `PERFORM` w bloku `EXCEPTION WHEN OTHERS` - blad synchronizacji NIE
--     wywraca formularza, tylko laduje jako widoczny `crm_sync_status='error'`
--     + `crm_error`. To lepsza decyzja niz moja pierwotna (CRM inline, wyjatek
--     wywracal cale zgloszenie), wiec DRUGIEJ sciezki CRM tu nie ma - naprawa
--     leada siedzi w calosci w `club_application_crm_sync` (A3b).
--
-- Co dokladam:
--   * `club_tier_too_low` - prog WLASNY klubu przez `club_capabilities`,
--   * `years_invalid` - regex PRZED rzutowaniem `::integer`,
--   * `duplicate_open` - jawna, czytelna odmowa dla drugiego otwartego zgloszenia.
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
  v_err text;
  v_club_id uuid;
  v_reason text;
  v_years_raw text;
  v_years integer;
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
  -- Zbior statusow MUSI byc ten sam co w warunku indeksu - patrz A2.
  IF EXISTS (
    SELECT 1 FROM public.club_applications a
     WHERE a.user_id = v_uid
       AND a.specialization_slug = v_spec
       AND a.status IN ('pending', 'review', 'needs_info')
  ) THEN
    RAISE EXCEPTION 'duplicate_open';
  END IF;

  INSERT INTO public.club_applications (
    tenant_id, user_id, specialization_slug, club_id,
    first_name, last_name, email, phone, company, job_position, seniority, industry,
    country, city, linkedin_url, years_experience, expertise, languages,
    motivation, goals, contribution, availability, referral_source,
    consent, marketing_consent, tier_key, tier_rank, lang
  ) VALUES (
    v_tenant, v_uid, v_spec, v_club_id,
    left(btrim(COALESCE(p->>'first_name','')), 60),
    left(btrim(COALESCE(p->>'last_name','')), 80),
    left(v_email, 254),
    left(btrim(COALESCE(p->>'phone','')), 32),
    left(btrim(COALESCE(p->>'company','')), 120),
    left(btrim(COALESCE(p->>'job_position','')), 120),
    left(btrim(COALESCE(p->>'seniority','')), 60),
    left(btrim(COALESCE(p->>'industry','')), 60),
    left(btrim(COALESCE(p->>'country','')), 80),
    left(btrim(COALESCE(p->>'city','')), 80),
    left(btrim(COALESCE(p->>'linkedin_url','')), 200),
    v_years,
    left(btrim(COALESCE(p->>'expertise','')), 500),
    left(btrim(COALESCE(p->>'languages','')), 200),
    left(v_txt, 2000),
    left(btrim(COALESCE(p->>'goals','')), 1000),
    left(btrim(COALESCE(p->>'contribution','')), 1000),
    left(btrim(COALESCE(p->>'availability','')), 120),
    left(btrim(COALESCE(p->>'referral_source','')), 120),
    true,
    COALESCE((p->>'marketing_consent')::boolean, false),
    COALESCE(v_key, ''), COALESCE(v_rank, 0),
    CASE WHEN COALESCE(p->>'lang','pl') = 'en' THEN 'en' ELSE 'pl' END
  )
  RETURNING id INTO v_id;

  -- [114031] Sciezka CRM w calosci po ich stronie: jedno wolanie wspolnej
  -- funkcji, blad ksiegowany w kolumnach synchronizacji zamiast wywracania
  -- formularza. Nie dubluj tego - naprawa jakosci leada jest w A3b.
  BEGIN
    PERFORM public.club_application_crm_sync(v_id);
  EXCEPTION WHEN OTHERS THEN
    v_err := left(SQLERRM, 500);
    UPDATE public.club_applications
       SET crm_sync_status = 'error',
           crm_error = v_err,
           crm_last_attempt_at = now()
     WHERE id = v_id;
  END;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_apply_submit(jsonb) IS
  'Zgloszenie do klubu: bramka planu globalna i wlasna klubu, walidacja pol, jedno otwarte zgloszenie na specjalizacje (pending/review/needs_info). Wejscie do CRM idzie przez club_application_crm_sync - blad synchronizacji nie wywraca formularza, laduje w crm_sync_status/crm_error.';

REVOKE ALL ON FUNCTION public.club_apply_submit(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.club_apply_submit(jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- A3b) club_application_crm_sync: KANONICZNE wejscie do CRM
--
-- Cialo pochodzi z [114031]; wymieniony jest wylacznie sposob zapisu leada.
-- Zostaje bez zmian ICH ksiegowanie - `crm_lead_id`, `crm_sync_status='ok'`,
-- `crm_synced_at`, `crm_last_attempt_at`, `crm_error=NULL`, `updated_at` -
-- oraz to, ze funkcja RZUCA wyjatek przy porazce. Gałąź bledu (`'error'` +
-- `crm_error`) siedzi u WOLAJACYCH (`club_apply_submit`,
-- `admin_club_application_crm_retry`) i wlasnie dlatego nie wolno tutaj
-- niczego tlumic.
--
-- ICH surowy `INSERT ... ON CONFLICT` gubil to, co kanoniczna
-- `crm_upsert_from_form` robi za nas: dopasowanie po imieniu i nazwisku, gdy
-- e-mail sie zmienil, `company_id` (katalog firm), `country`, `linkedin_url`,
-- `aliases` (historia adresow, telefonow, zrodel) i `source_count`. Lead
-- z formularza klubowego byl przez to ubozszy niz lead z formularza kontaktowego.
--
-- CRM to dwa kroki i kolejnosc jest obowiazkowa. Krok 1 daje deduplikacje
-- i komplet pol. Krok 2 dopisuje to, czego kanoniczna funkcja NIE RUSZA:
-- `source_type` oraz zgode marketingowa - zawsze W GORE (`OR`), nigdy w dol,
-- bo zgoda wycofana w profilu nie moze wrocic przez formularz klubowy.
-- `phone_norm` i scoring zostaja triggerom `crm_leads`.
--
-- `club_applied_at` liczy PIERWSZE zgloszenie (`COALESCE` po istniejacej
-- wartosci) - tak jak ICH `ON CONFLICT DO UPDATE`. Nadpisywanie go `now()`
-- przy kazdym ponowieniu zamienialoby "kiedy przyszedl z klubu" w "kiedy
-- ostatnio klikneto Ponow".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_application_crm_sync(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.club_applications%ROWTYPE;
  v_lead uuid;
BEGIN
  SELECT * INTO a FROM public.club_applications WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Krok 1: kanoniczne wejscie leada z formularza.
  v_lead := public.crm_upsert_from_form(
    a.tenant_id, lower(btrim(COALESCE(a.email, ''))),
    NULLIF(btrim(COALESCE(a.first_name, '')), ''),
    NULLIF(btrim(COALESCE(a.last_name, '')), ''),
    NULLIF(btrim(COALESCE(a.phone, '')), ''),
    NULLIF(btrim(COALESCE(a.company, '')), ''),
    NULLIF(btrim(COALESCE(a.job_position, '')), ''),
    NULLIF(btrim(COALESCE(a.linkedin_url, '')), ''),
    NULLIF(btrim(COALESCE(a.country, '')), ''),
    'club_application'
  );

  -- `crm_upsert_from_form` zwraca NULL przy pustym e-mailu. Zamiast zapisac
  -- `crm_sync_status='ok'` z pustym `crm_lead_id` (czyli sklamac panelowi)
  -- rzucamy wyjatek - wolajacy odlozy to jako `crm_error`. Dotyczy to zgloszen
  -- po anonimizacji konta (A7 zeruje `email`), na ktorych ponowienie z panelu
  -- nie ma juz kogo zapisac w CRM.
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'crm_email_required';
  END IF;

  -- Krok 2: to, czego kanoniczna funkcja nie rusza.
  UPDATE public.crm_leads l
     SET source_type = 'club_application',
         marketing_consent = l.marketing_consent OR COALESCE(a.marketing_consent, false),
         club_applied_at = COALESCE(l.club_applied_at, COALESCE(a.created_at, now())),
         club_application_count = COALESCE(l.club_application_count, 0) + 1,
         club_specializations = (
           SELECT ARRAY(
             SELECT DISTINCT s
               FROM unnest(l.club_specializations || ARRAY[a.specialization_slug]) AS s
           )
         ),
         last_activity_at = now(),
         updated_at = now()
   WHERE l.id = v_lead;

  -- [114031] Ksiegowanie synchronizacji - 1:1 z ich wersja.
  UPDATE public.club_applications
     SET crm_lead_id = v_lead,
         crm_sync_status = 'ok',
         crm_synced_at = now(),
         crm_last_attempt_at = now(),
         crm_error = NULL,
         updated_at = now()
   WHERE id = p_id;

  RETURN v_lead;
END;
$$;

COMMENT ON FUNCTION public.club_application_crm_sync(uuid) IS
  'Synchronizacja jednego zgloszenia z CRM: crm_upsert_from_form (dedup, firma, kraj, LinkedIn, aliasy) + jawny UPDATE zrodla i zgody (zgoda tylko w gore). Ksieguje crm_lead_id/crm_sync_status/crm_synced_at/crm_last_attempt_at/crm_error. Rzuca wyjatek przy porazce - galaz bledu jest u wolajacego.';

REVOKE ALL ON FUNCTION public.club_application_crm_sync(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- A4) admin_club_application_set_status: decyzja ma konsekwencje
--
-- Cialo wyjsciowe z [114031]. Ich wklad, ktory tu zostaje:
--   * `needs_info` w zbiorze dozwolonych statusow,
--   * czyszczenie `notify_error` przy kazdej zmianie statusu (panel ma
--     pokazywac, ze dla NOWEGO statusu mail jeszcze nie wyszedl),
--   * `notified_status` / `notified_at` NIE sa tu ruszane - pisze je
--     `admin_club_application_mark_notified` po faktycznej wysylce.
--
-- DWA KANALY, NIE JEDEN DUBEL. `club_notify` ponizej to powiadomienie
-- W APLIKACJI (dzwonek, `notifications.kind='club'`). Kanal MAILOWY jest
-- osobny i zostaje w calosci po stronie panelu: przycisk w
-- `ClubApplicationsInbox.tsx` -> `applicationNotify.functions.ts` ->
-- `admin_club_application_notify_payload` + `admin_club_application_mark_notified`.
-- Jest URUCHAMIANY RECZNIE, celowo - mail do kandydata z uzasadnieniem komisji
-- nie moze wychodzic automatem przy kazdym kliknieciu statusu. Te dwie sciezki
-- NIE SA dubletem i zadna z nich nie powinna byc "porzadkowana" do drugiej.
--
-- Trzy skutki `accepted` w jednym przejsciu: czlonkostwo, profil,
-- powiadomienie w aplikacji. Back-fill wlasnie TUTAJ, a nie przy wysylce - do
-- profilu widocznego w sieci kontaktow wchodzi tylko to, co komisja
-- zaakceptowala.
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
--
-- B3 - TELEFON. `profiles_phone_chk` dopuszcza `^[+0-9 ()\-]{6,32}$`, a
-- `PHONE_RE` formularza dopuszcza takze `.` i `/`. Numer "+48 600.100.200"
-- przechodzil walidacje, ladowal w `club_applications` i przy `accepted`
-- wywracal CALA AKCEPTACJE naruszeniem CHECK - czlonkostwo i powiadomienie
-- gineły razem z transakcja przez format telefonu. Formularza NIE zwezamy
-- (dane moga juz istniec): numer jest tu normalizowany do znakow, ktore CHECK
-- zna, i zapisywany TYLKO jesli po normalizacji nadal pasuje. Inaczej telefon
-- jest pomijany, a pozostale pola uzupelniaja sie normalnie.
--
-- B6 - COFNIECIE DECYZJI. Indeks z A2 obejmuje statusy otwarte, wiec powrot
-- `accepted`/`rejected` -> `pending`/`review`/`needs_info` przy INNYM otwartym
-- zgloszeniu tej samej osoby i specjalizacji konczyl sie surowym `23505`
-- z wnetrza RPC - kodem, ktorego klient nie mapuje, czyli "unknown" w panelu.
-- `UPDATE` jest wiec obudowany blokiem, ktory zamienia go na `duplicate_open`:
-- ten sam kod, ktory panel juz zna z wysylki zgloszenia.
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
  'Decyzja komisji: status (w tym needs_info) + notatka + zerowanie notify_error, a przy accepted takze czlonkostwo (ON CONFLICT nie zdejmuje bana), back-fill pustych pol profilu (telefon normalizowany do profiles_phone_chk albo pomijany) i powiadomienie W APLIKACJI. Kanal mailowy jest osobny i recznie uruchamiany z panelu (notify_payload/mark_notified) - to nie dublet. Cofniecie decyzji przy innym otwartym zgloszeniu daje duplicate_open, nie surowe 23505.';

REVOKE ALL ON FUNCTION public.admin_club_application_set_status(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_application_set_status(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- A5) admin_club_applications_list: nazwa klubu w obu jezykach
--
-- Kolumny wyjsciowe pochodza z [114031] - komplet 40 pozycji, razem z ICH
-- `crm_lead_id`, `crm_sync_status`, `crm_synced_at`, `crm_last_attempt_at`,
-- `crm_error`, `notified_status`, `notified_at`, `notify_error`. Bez nich panel
-- straciłby chip stanu synchronizacji, przycisk ponowienia i slad wysylki maila.
--
-- Zmieniona jest DOKLADNIE JEDNA rzecz: `club_name text` (czyli `c.name_pl`)
-- ustepuje miejsca parze `club_name_pl` + `club_name_en` NA TEJ SAMEJ POZYCJI.
-- Reszta modulu konsekwentnie oddaje obie nazwy i wybiera w widoku; ta jedna
-- skrzynka oddawala polskie nazwy takze adminowi pracujacemu po angielsku.
--
-- ZMIANA KSZTALTU ZWROTU = DROP + CREATE. Sam `CREATE OR REPLACE` nie zmieni
-- listy kolumn zwracanych (42P13), a bez DROP-a przy odtwarzaniu bazy od zera
-- zostaloby drugie przeciazenie (42723).
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
  reviewed_at timestamptz, lang text,
  crm_lead_id uuid, crm_sync_status text, crm_synced_at timestamptz,
  crm_last_attempt_at timestamptz, crm_error text,
  notified_status text, notified_at timestamptz, notify_error text
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
         a.reviewed_at, a.lang,
         a.crm_lead_id, a.crm_sync_status, a.crm_synced_at, a.crm_last_attempt_at, a.crm_error,
         a.notified_status, a.notified_at, a.notify_error
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
  'Skrzynka zgloszen dla admina tenanta. Nazwa klubu wychodzi w obu jezykach - wybor jezyka nalezy do widoku, nie do bazy. Kolumny crm_* i notified_* niesie panel: stan synchronizacji z CRM i slad wysylki maila.';

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
-- kiedy rozpatrzone. `admin_note` NIE WYCHODZI - patrz A6. Kolumny `crm_*`
-- i `notified_*` z [114031] tez NIE wychodza - to kuchnia redakcji, nie
-- informacja dla kandydata.
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


-- ============================================================================
-- A9) Wskrzeszone przeciazenia: trzy funkcje modulu mialy po dwa warianty
-- ============================================================================
--
-- ZNALEZIONE PRZEZ NOWA ASERCJE Z A35 (runtime_test.sql, punkt 0), nie przez
-- czlowieka - i to jest caly sens wpiecia harnessu do CI. Poza zakresem audytu
-- zgloszen, ale zostawienie tego znaczyloby, ze nowa bramka jest czerwona
-- od pierwszego dnia, czyli bezwartosciowa.
--
-- MECHANIZM. Zawsze ten sam: pozniejsza migracja odtworzyla KROTSZY wariant,
-- ktory wczesniejsza celowo dropnela, zastepujac go dluzszym. `CREATE OR
-- REPLACE` nie zastepuje funkcji o INNEJ liczbie argumentow - tworzy drugie
-- przeciazenie. Historia:
--
--   admin_club_thread_create: 20260807163132 tworzy 6-arg; 20260808092623
--     dropuje 6-arg i tworzy 7-arg (z p_topic); a7 (20260808100000) tworzy
--     6-arg PONOWNIE. Stan koncowy: 6-arg + 7-arg.
--   club_threads_list: 20260808092623 tworzy 10-arg (z p_topic); a26
--     (20260808280000) tworzy 9-arg. Stan koncowy: 9-arg + 10-arg.
--   club_create_thread: analogicznie 9-arg obok zywego 12-arg.
--
-- KTORY WARIANT JEST ZYWY - dowod z wywolan klienta (src/lib/clubs/api.ts):
--   club_threads_list      -> 10 argumentow nazwanych, z p_topic   (linia ~545)
--   club_create_thread     -> 12 argumentow, z p_icon i p_attribution_mode (~659)
--   admin_club_thread_create -> 7 argumentow, z p_topic            (~937)
-- Krotszy wariant w kazdej parze jest wiec pozostaloscia, nie kontraktem.
--
-- DLACZEGO TO GROZNE, a nie tylko brzydkie. supabase-js usuwa z ciala zapytania
-- pola `undefined`, a klient przekazuje opcjonalne argumenty wlasnie jako
-- `params.x ?? undefined`. Wywolanie bez tematu wysyla wiec KROTSZY zestaw nazw,
-- ktory pasuje do OBU przeciazen - a to udokumentowana pulapka PostgREST
-- (PGRST203, "could not choose the best candidate function"). Nie twierdze, ze
-- awaria byla obserwowana na produkcji; twierdze, ze dwa przeciazenia z
-- domyslnymi ogonami to dokladnie ten stan, ktory ja wywoluje.
--
-- BEZPIECZENSTWO DROPU. Kazde ocalale przeciazenie ma DEFAULT na argumentach,
-- ktorych brakuje w wariancie usuwanym (p_topic DEFAULT NULL, p_icon DEFAULT
-- NULL, p_attribution_mode DEFAULT NULL), wiec KAZDE dotychczasowe wywolanie -
-- takze to z krotszym zestawem - nadal sie rozwiaze, tylko juz jednoznacznie.
-- Nie usuwamy zadnej funkcjonalnosci, usuwamy niejednoznacznosc.
--
-- ----------------------------------------------------------------------------
-- B2: DLACZEGO PO KAZDYM DROP-ie STOI CREATE OR REPLACE OCALALEGO WARIANTU
-- ----------------------------------------------------------------------------
-- Bramka `check:sql-rpc-contract` (`src/lib/ci/rpcContract.ts`) indeksuje
-- `DROP FUNCTION` po SAMEJ NAZWIE, bez sygnatury (`droppedFunctions`, ~174-188).
-- Definicje "zywe" wybiera potem porownaniem NAZWY PLIKU:
--
--     dropped.get(name) === undefined || droppedIn <= def.file
--
-- Trzy DROP-y powyzej maja wiec dla bramki znaczenie "cala funkcja usunieta
-- w 20260811150000", a poniewaz ten plik jest PÓŹNIEJSZY niz ostatnie
-- definicje ocalalych wariantow (20260808092623, 20260809140300,
-- 20260811074733), wszystkie trzy nazwy wypadaly ze stanu koncowego. Klient
-- (`src/lib/clubs/api.ts`) je wola, wiec bramka raportowala trzy razy
-- "✗ Klient wola RPC, ktorych nie ma w stanie koncowym migracji" - i to nie
-- byl falszywy alarm w sensie technicznym: bramka nie ma sposobu, zeby
-- odroznic drop przeciazenia od dropu funkcji.
--
-- Naprawa idzie wzorcem, ktory bramka ZNA I NAZYWA (rpcContract.ts ~228-230:
-- "przy DROP i CREATE w TYM SAMYM pliku wygrywa CREATE, bo taki jest wzorzec
-- repo") - a nie oslabieniem asercji. Ciala ponizej sa PRZEPISANE 1:1
-- z ostatnich definicji, razem z GRANT-ami; `CREATE OR REPLACE` o identycznej
-- sygnaturze i identycznym kszalcie zwrotu jest na zywej bazie operacja
-- pusta znaczeniowo, a dla bramki - dowodem, ze funkcja zostaje.
--
-- Alternatywa "dropuj po nazwie bez sygnatury" nie istnieje: `DROP FUNCTION
-- public.club_threads_list` bez listy typow w PostgreSQL 16 dziala tylko dla
-- funkcji o JEDNYM przeciazeniu, czyli dokladnie nie w tym przypadku.

-- --- admin_club_thread_create: dropujemy 6-arg, odtwarzamy 7-arg -------------
-- Cialo 1:1 z 20260808092623_b6af3421-a806-4ddd-a5cc-87d9c2a0a93f.sql:186-268.
DROP FUNCTION IF EXISTS public.admin_club_thread_create(uuid, text, text, uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.admin_club_thread_create(
  p_group_id uuid,
  p_title text,
  p_body text,
  p_author_id uuid DEFAULT NULL::uuid,
  p_kind text DEFAULT 'discussion'::text,
  p_pinned boolean DEFAULT false,
  p_topic text DEFAULT NULL::text
)
 RETURNS TABLE(thread_id uuid, thread_slug text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_group  public.club_groups%ROWTYPE;
  v_author uuid;
  v_slug   text;
  v_base   text;
  v_n      integer := 0;
  v_id     uuid;
  v_topic  text := NULLIF(btrim(COALESCE(p_topic, '')), '');
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('discussion','question','position','resource','announcement','poll') THEN
    RAISE EXCEPTION 'clubs: invalid thread kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF NOT public.club_topic_valid(v_topic) THEN
    RAISE EXCEPTION 'clubs: invalid topic %', v_topic USING ERRCODE = '22023';
  END IF;
  SELECT g.* INTO v_group
    FROM public.club_groups g JOIN public.clubs c ON c.id = g.club_id
   WHERE g.id = p_group_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  v_author := COALESCE(p_author_id, v_uid);
  IF p_author_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.club_members m
       WHERE m.club_id = v_group.club_id AND m.user_id = p_author_id AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'clubs: author must be an active member of this club'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  v_base := btrim(COALESCE(NULLIF(regexp_replace(
              lower(unaccent(btrim(p_title))), '[^a-z0-9]+', '-', 'g'), ''), 'temat'), '-');
  v_base := left(v_base, 60);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.club_threads t
                 WHERE t.club_id = v_group.club_id AND t.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  END LOOP;
  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, slug, title, body, kind, status,
    pinned_at, posted_by_admin_id, topic
  ) VALUES (
    v_tenant, v_group.club_id, p_group_id, v_author, v_slug,
    btrim(p_title), btrim(p_body), p_kind, 'open',
    CASE WHEN p_pinned THEN now() ELSE NULL END,
    CASE WHEN p_author_id IS NOT NULL AND p_author_id <> v_uid THEN v_uid ELSE NULL END,
    v_topic
  )
  RETURNING club_threads.id INTO v_id;
  IF p_author_id IS NOT NULL AND p_author_id <> v_uid THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (
      v_tenant, v_group.club_id, v_uid, 'post_on_behalf', 'thread', v_id,
      'temat w imieniu: ' || v_author::text
    );
  END IF;
  thread_id := v_id; thread_slug := v_slug;
  RETURN NEXT;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.admin_club_thread_create(uuid,text,text,uuid,text,boolean,text) TO authenticated, service_role;

-- --- club_threads_list: dropujemy 9-arg, odtwarzamy 10-arg -------------------
-- Cialo 1:1 z 20260809140300_d1101d9f-886e-46ca-b986-b44357479dfc.sql:242-358.
DROP FUNCTION IF EXISTS public.club_threads_list(
  uuid, uuid, text, text, text, integer, text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.club_threads_list(p_club_id uuid, p_group_id uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'hot'::text, p_kind text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_status text DEFAULT NULL::text, p_anchored boolean DEFAULT NULL::boolean, p_unread_only boolean DEFAULT false, p_topic text DEFAULT NULL::text)
RETURNS TABLE(id uuid, slug text, title text, kind text, status text, group_id uuid, group_name_pl text, group_name_en text, anchor_type text, anchor_id text, anchor_label text, is_anonymous boolean, author_id uuid, author_name text, author_avatar text, author_slug text, author_alias text, posted_by_admin_name text, reply_count integer, participant_count integer, reaction_count integer, insightful_count integer, pinned_at timestamp with time zone, last_reply_at timestamp with time zone, created_at timestamp with time zone, hotness numeric, is_unread boolean, cursor_value text, excerpt text, topic text, icon text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH sort AS (
    SELECT CASE
             WHEN p_sort IN ('new', 'unanswered', 'top', 'mine', 'subscribed')
               THEN p_sort
             ELSE 'hot'
           END AS mode
  ),
  cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, p_group_id, auth.uid())
  ),
  seen AS (
    SELECT m.last_read_at
      FROM public.club_members m
     WHERE m.club_id = p_club_id
       AND auth.uid() IS NOT NULL
       AND m.user_id = auth.uid()
  ),
  visible AS (
    SELECT t.*, g.name_pl AS g_pl, g.name_en AS g_en,
           COALESCE(g.attribution_mode, cl.attribution_mode) AS attribution,
           (auth.uid() IS NOT NULL
            AND t.author_id IS DISTINCT FROM auth.uid()
            AND COALESCE(t.last_reply_at, t.created_at)
                > COALESCE((SELECT last_read_at FROM seen), '-infinity'::timestamptz)
           ) AS unread,
           (CASE WHEN t.pinned_at IS NOT NULL AND s.mode IN ('hot', 'new')
                 THEN '1' ELSE '0' END) AS pin_key
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
      JOIN public.clubs cl ON cl.id = t.club_id
      CROSS JOIN cap
      CROSS JOIN sort s
     WHERE t.club_id = p_club_id
       AND cap.can_read
       AND (p_group_id IS NULL OR t.group_id = p_group_id)
       AND (p_kind IS NULL OR t.kind = p_kind)
       AND (NULLIF(btrim(COALESCE(p_topic, '')), '') IS NULL
            OR t.topic = btrim(p_topic))
       AND (t.status IN ('open','resolved','dormant','locked')
            OR cap.can_moderate
            OR (t.status = 'pending' AND t.author_id = auth.uid()))
       AND (g.status NOT IN ('draft','archived') OR cap.can_manage)
       AND (p_status IS NULL OR t.status = p_status)
       AND (p_anchored IS NULL OR (t.anchor_id IS NOT NULL) = p_anchored)
       AND (s.mode <> 'unanswered' OR t.reply_count = 0)
       AND (s.mode <> 'top' OR t.created_at > now() - interval '30 days')
       AND (s.mode <> 'mine'
            OR (auth.uid() IS NOT NULL AND t.author_id = auth.uid()))
       AND (s.mode <> 'subscribed'
            OR EXISTS (SELECT 1 FROM public.club_thread_subscriptions cs
                        WHERE cs.thread_id = t.id
                          AND cs.user_id = auth.uid()
                          AND cs.state = 'subscribed'))
  ),
  filtered AS (
    SELECT v.* FROM visible v
     WHERE NOT COALESCE(p_unread_only, false) OR v.unread
  ),
  keyed AS (
    SELECT f.*,
           f.pin_key || '|' ||
           CASE s.mode
             WHEN 'new' THEN
               to_char(COALESCE(f.last_reply_at, f.created_at), 'YYYYMMDDHH24MISSMS')
             WHEN 'subscribed' THEN
               to_char(COALESCE(f.last_reply_at, f.created_at), 'YYYYMMDDHH24MISSMS')
             WHEN 'unanswered' THEN to_char(f.created_at, 'YYYYMMDDHH24MISSMS')
             WHEN 'mine' THEN to_char(f.created_at, 'YYYYMMDDHH24MISSMS')
             WHEN 'top' THEN lpad(GREATEST(f.reaction_count, 0)::text, 10, '0')
             ELSE to_char(f.hotness, 'FM0000000000.0000000000')
           END || '|' || f.id::text AS ckey
      FROM filtered f
      CROSS JOIN sort s
  ),
  page AS (
    SELECT k.* FROM keyed k
     WHERE p_cursor IS NULL OR k.ckey < p_cursor
     ORDER BY k.ckey DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  )
  SELECT
    k.id, k.slug, k.title, k.kind, k.status,
    k.group_id, k.g_pl, k.g_en,
    k.anchor_type, k.anchor_id,
    public.club_anchor_label(k.anchor_type, k.anchor_id),
    k.is_anonymous,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE k.author_id END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''),
                       NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User') END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham'
         THEN public.club_author_alias(k.id, k.author_id) ELSE NULL END,
    NULLIF(btrim(pa.display_name), ''),
    k.reply_count, k.participant_count, k.reaction_count,
    COALESCE((SELECT count(*)::int FROM public.club_reactions rx
               WHERE rx.target_type = 'thread' AND rx.target_id = k.id
                 AND rx.kind = 'insightful'), 0),
    k.pinned_at, k.last_reply_at, k.created_at, k.hotness, k.unread, k.ckey,
    left(k.body, 280),
    k.topic,
    k.icon
  FROM page k
  LEFT JOIN public.profiles p ON p.id = k.author_id
  LEFT JOIN public.profiles pa ON pa.id = k.posted_by_admin_id
  ORDER BY k.ckey DESC
$function$;

GRANT EXECUTE ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer, text, boolean, boolean, text) TO anon, authenticated, service_role;

-- --- club_create_thread: dropujemy 9-arg, odtwarzamy 12-arg ------------------
-- Cialo 1:1 z 20260811074733_c88c1f25-7ad3-4bfe-8dc4-ee5bd6c25f19.sql:1-182.
DROP FUNCTION IF EXISTS public.club_create_thread(
  uuid, text, text, text, boolean, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.club_create_thread(p_group_id uuid, p_title text, p_body text, p_kind text DEFAULT 'discussion'::text, p_anonymous boolean DEFAULT false, p_anchor_type text DEFAULT NULL::text, p_anchor_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_lock_replies boolean DEFAULT false, p_topic text DEFAULT NULL::text, p_icon text DEFAULT NULL::text, p_attribution_mode text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, slug text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_group     public.club_groups%ROWTYPE;
  v_club      public.clubs%ROWTYPE;
  v_caps      record;
  v_attr      text;
  v_mod       text;
  v_status    text;
  v_slug      text;
  v_base      text;
  v_n         integer := 0;
  v_recent    integer;
  v_id        uuid;
  v_key       text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_topic     text := NULLIF(btrim(COALESCE(p_topic, '')), '');
  v_icon      text := NULLIF(btrim(lower(COALESCE(p_icon, ''))), '');
  v_prior     jsonb;
  v_thread_attr text := NULLIF(btrim(lower(COALESCE(p_attribution_mode, ''))), '');
  v_base_attr text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('discussion','question','position','resource','announcement','poll') THEN
    RAISE EXCEPTION 'clubs: invalid thread kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF NOT public.club_topic_valid(v_topic) THEN
    RAISE EXCEPTION 'clubs: invalid topic %', v_topic USING ERRCODE = '22023';
  END IF;
  IF v_icon IS NOT NULL AND (v_icon !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_icon) > 48) THEN
    RAISE EXCEPTION 'clubs: invalid icon %', v_icon USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group FROM public.club_groups g WHERE g.id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_club FROM public.clubs c WHERE c.id = v_group.club_id;

  IF v_key IS NOT NULL THEN
    SELECT ci.result INTO v_prior
      FROM public.command_idempotency ci
     WHERE ci.tenant_id = v_club.tenant_id
       AND ci.idempotency_key = v_key
       AND ci.command = 'club_create_thread'
       AND ci.status = 'succeeded';
    IF v_prior IS NOT NULL THEN
      id := (v_prior->>'id')::uuid;
      slug := v_prior->>'slug';
      status := v_prior->>'status';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_group.club_id, p_group_id, v_uid);
  IF NOT COALESCE(v_caps.can_post_thread, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'announcement' AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: announcement requires moderator' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_lock_replies, false) AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: locking replies requires moderator' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'resource' AND NULLIF(btrim(COALESCE(p_anchor_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'clubs: resource requires an anchor' USING ERRCODE = '22023';
  END IF;

  v_base_attr := COALESCE(v_group.attribution_mode, v_club.attribution_mode);

  IF v_thread_attr IS NOT NULL THEN
    IF v_thread_attr NOT IN ('attributed','chatham','anonymous_allowed') THEN
      RAISE EXCEPTION 'clubs: invalid attribution mode %', v_thread_attr USING ERRCODE = '22023';
    END IF;
    IF v_base_attr = 'chatham' AND v_thread_attr <> 'chatham'
       AND NOT COALESCE(v_caps.can_moderate, false) THEN
      RAISE EXCEPTION 'clubs: attribution cannot be relaxed' USING ERRCODE = '42501';
    END IF;
    IF v_base_attr = 'attributed' AND v_thread_attr <> 'attributed'
       AND NOT COALESCE(v_caps.can_moderate, false) THEN
      RAISE EXCEPTION 'clubs: anonymous posting disabled' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_attr := COALESCE(v_thread_attr, v_base_attr);
  IF p_anonymous AND v_attr = 'attributed' THEN
    RAISE EXCEPTION 'clubs: anonymous posting disabled' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('club_create_thread:' || v_uid::text));

  IF v_key IS NOT NULL THEN
    SELECT ci.result INTO v_prior
      FROM public.command_idempotency ci
     WHERE ci.tenant_id = v_club.tenant_id
       AND ci.idempotency_key = v_key
       AND ci.command = 'club_create_thread'
       AND ci.status = 'succeeded';
    IF v_prior IS NOT NULL THEN
      id := (v_prior->>'id')::uuid;
      slug := v_prior->>'slug';
      status := v_prior->>'status';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT count(*)::int INTO v_recent FROM public.club_threads
   WHERE author_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'clubs: thread rate limit' USING ERRCODE = '42901';
  END IF;

  v_mod := COALESCE(v_group.moderation_mode, v_club.moderation_mode);
  v_status := CASE
    WHEN v_caps.can_moderate THEN 'open'
    WHEN v_mod = 'pre' THEN 'pending'
    WHEN v_mod = 'trusted' AND v_caps.reason = 'pre_moderation' THEN 'pending'
    ELSE 'open'
  END;

  v_base := NULLIF(regexp_replace(
              lower(unaccent(btrim(p_title))), '[^a-z0-9]+', '-', 'g'
            ), '');
  v_base := btrim(COALESCE(v_base, 'temat'), '-');
  v_base := left(v_base, 60);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.club_threads
                 WHERE club_id = v_group.club_id AND club_threads.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  END LOOP;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, slug, title, body, kind, status,
    is_anonymous, anchor_type, anchor_id, topic, icon, locked_at, attribution_mode
  ) VALUES (
    v_club.tenant_id, v_group.club_id, p_group_id, v_uid, v_slug,
    btrim(p_title), btrim(p_body), p_kind, v_status,
    COALESCE(p_anonymous, false),
    NULLIF(p_anchor_type, ''), NULLIF(btrim(COALESCE(p_anchor_id, '')), ''),
    COALESCE(v_topic, NULLIF(btrim(COALESCE(v_club.policy_area, '')), '')),
    v_icon,
    CASE WHEN COALESCE(p_lock_replies, false) THEN now() ELSE NULL END,
    v_thread_attr
  )
  RETURNING club_threads.id INTO v_id;

  IF v_key IS NOT NULL THEN
    INSERT INTO public.command_idempotency (
      tenant_id, idempotency_key, command, actor_id, status, result, completed_at
    ) VALUES (
      v_club.tenant_id, v_key, 'club_create_thread', v_uid, 'succeeded',
      jsonb_build_object('id', v_id, 'slug', v_slug, 'status', v_status), now()
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;

  id := v_id; slug := v_slug; status := v_status;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) IS
  'Zakladanie watku. p_attribution_mode ustawia anonimowosc UCZESTNIKOW rozmowy; wolno wylacznie zaostrzyc zasade dziedziczona z dzialu, poluzowanie wymaga prowadzenia klubu. Definicja jawna (wczesniej skladana dynamicznie) - patrz bramka check:rpc-contract.';

REVOKE EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) TO authenticated, service_role;


-- ============================================================================
-- A10) Szew anonimizacji: funkcja z A7 dostaje wolajacego
-- ============================================================================
--
-- Weryfikacja A35 wykazala, ze A7 domykala 6.2 POZORNIE: funkcja istniala,
-- byla przetestowana i nikt jej nie wolal. Audyt mowil o braku SCIEZKI, nie
-- o braku narzedzia - wiec dopoki nie ma wolajacego, znalezisko stoi.
--
-- SPRAWDZONA PRAWDA O TYM REPO (teza "wszystkie funkcje anonimizujace sa
-- rownie martwe" jest NIEPRAWDZIWA). Sciezka usuniecia konta jest
-- dwuwarstwowa i obie warstwy zbiegaja sie w JEDNEJ funkcji triggerowej:
--   * kod serwerowy: DataRightsSection.tsx -> deleteMyAccount
--     (src/lib/account.functions.ts:64) -> retainAccountingEvidence()
--     -> accountingRetention.server.ts:82, PRZED auth.admin.deleteUser;
--   * trigger bazodanowy: on_auth_user_deleted_retain_accounting
--     BEFORE DELETE ON auth.users -> tg_auth_user_deleted_retain_accounting()
--     (20260805114540_*.sql:120-134).
-- `auth.admin.deleteUser` wystepuje w src/ dokladnie raz, nie ma edge
-- functions ani panelowego kasowania kont.
--
-- DLACZEGO TRIGGER, A NIE anonymize_accounting_evidence_for_user. Tamta
-- funkcja jest ksiegowa: zwraca jsonb o kształcie {orders, purchases,
-- retained, discarded} i jej nazwa obiecuje dowody ksiegowe. Wpychanie tam
-- zgloszen klubowych zabrudzilo by kontrakt. Trigger jest natomiast wprost
-- "co zrobic, gdy konto znika", wiec to jego miejsce - i lapie KAZDA sciezke
-- usuniecia, takze recznego DELETE w bazie, ktory server fn omija.
--
-- Kolejnosc: ksiegowosc pierwsza, bo byla tu pierwsza i jej wynik nie zalezy
-- od klubow. Wyjatek z anonimizacji klubowej NIE MOZE wywrocic usuniecia
-- konta - prawo do bycia zapomnianym nie moze zalezec od modulu spolecznego -
-- wiec lapiemy go i zostawiamy wiersz do sprzatniecia, zamiast blokowac DELETE.

CREATE OR REPLACE FUNCTION public.tg_auth_user_deleted_retain_accounting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.anonymize_accounting_evidence_for_user(OLD.id);
  BEGIN
    PERFORM public.anonymize_club_applications_for_user(OLD.id);
  EXCEPTION WHEN OTHERS THEN
    -- Swiadomie ciche: usuniecie konta ma sie udac nawet, gdy modul klubowy
    -- jest w trakcie migracji albo tabela chwilowo nie istnieje.
    NULL;
  END;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.tg_auth_user_deleted_retain_accounting() IS
  'BEFORE DELETE ON auth.users: anonimizuje dowody ksiegowe ORAZ zgloszenia klubowe. Drugie w bloku EXCEPTION - prawo do usuniecia konta nie moze zalezec od modulu spolecznego.';
