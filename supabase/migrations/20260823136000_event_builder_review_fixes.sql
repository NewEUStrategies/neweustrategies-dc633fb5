-- ============================================================================
-- Event Builder, etap 2c: TRZY DZIURY WYKRYTE W RECENZJI ETAPU 2
--
-- Recenzja pull requesta 285 wskazala trzy miejsca, w ktorych obietnica ekranu
-- rozjezdzala sie z tym, czego pilnuje baza. Wszystkie trzy sa w kodzie etapu 1
-- i 2, wiec naprawia je jedna migracja, zamiast czekac na kolejne etapy.
--
-- 1) SUPER ADMINISTRATOR ODBITY OD WLASNEGO MODULU.
--    `assert_editor_tenant()` z migracji 20260823130000 sprawdzala DOKLADNIE
--    role `admin` i `editor`. Tymczasem cala aplikacja - i klient (`useAuth`:
--    `isAdmin = isSuperAdmin || roles.includes("admin")`), i kilkaset polityk
--    w migracjach - trzyma inwariant SUPER_ADMIN >= ADMIN. Skutek: uzytkownik,
--    ktorego jedyna rola uprzywilejowana to `super_admin`, przechodzil bramke
--    ekranu, widzial liste wydarzen, a potem dostawal `forbidden: editor role
--    required` z KAZDEGO wywolania - lista, liczniki, tworzenie. Ekran obiecywal
--    dostep, ktorego baza nie dawala.
--
--    NIE ruszamy tu `assert_admin_tenant()`, ktora ma ten sam brak. Ta funkcja
--    jest wspolna dla 62 wywolan w calej aplikacji, wiec dodanie do niej
--    `super_admin` ROZSZERZA uprawnienia poza modul Wydarzen - to decyzja
--    wlasciciela produktu, nie skutek uboczny naprawy jednego modulu.
--
-- 2) RODZAJ Z ZAPISEM ZEWNETRZNYM NIE DAWAL SIE UZYC.
--    `event_types.default_registration_mode` dopuszcza `external`, a na `events`
--    stoi warunek `events_external_mode_requires_url`: tryb `external` wymaga
--    adresu. `admin_event_create` przepisywala tryb z rodzaju i NIE przepisywala
--    zadnego adresu, bo go nie przyjmowala. Kazda proba utworzenia wydarzenia
--    z takiego rodzaju konczyla sie naruszeniem warunku - czyli jedna z czterech
--    dopuszczalnych wartosci trybu byla martwa.
--
--    Naprawa przyjmuje `external_registration_url` w wejsciu i waliduje go
--    W BAZIE: adres jest wymagany dokladnie wtedy, gdy tryb go wymaga, i musi
--    byc adresem `https`. Walidacja jest tutaj, a nie tylko w formularzu, bo
--    tworzenie wydarzenia ma z zalozenia wiecej niz jedno wejscie (formularz,
--    import, klon, przyszly webhook) i kazde z nich musi dostac te sama odmowe.
--
-- 3) TRYB ZAPISOW BYL DEKLARACJA, NIE REGULA.
--    Kolumny `registration_mode` i `registration_flow` weszly migracja
--    20260823120000. `rsvp_event` - jedyna sciezka zapisu na wydarzenie - nie
--    czytala ich wcale. Wydarzenie z zapisami WYLACZONYMI przyjmowalo zapis
--    jednym klikiem, wydarzenie z formularzem kwalifikujacym omijalo formularz,
--    a wydarzenie wymagajace AKCEPTACJI organizatora potwierdzalo uczestnika
--    natychmiast. Panel pokazywal proces, ktorego nie bylo.
--
-- IZOLACJA NAJEMCOW. Bez zmian w zakresie skalowania. `assert_editor_tenant()`
-- nadal zwraca tenanta domowego wolajacego z `profiles`, `admin_event_create`
-- nadal wymaga rodzaju NALEZACEGO do tego tenanta, a `rsvp_event` pozostaje na
-- plaszczyznie tresci (`public_tenant_id()`) i nie dotyka `has_role()` ani
-- `is_staff()` - mieszanka tych dwoch swiatow w jednym ciele SECURITY DEFINER
-- pozwolilaby podszyc sie pod najemce naglowkiem Host.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Bramka staffa redakcyjnego z zachowanym inwariantem super administratora
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_editor_tenant()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  -- Rola `author` NIE wystarcza. `is_staff()` ja obejmuje, wiec swiadomie go tu
  -- nie uzywamy: autor moze pisac wpisy, ale nie widzi list zapisow na wydarzenia
  -- ani danych kontaktowych uczestnikow.
  --
  -- `is_super_admin()` jest tu OBOWIAZKOWY, nie uprzejmy: inwariant aplikacji
  -- mowi SUPER_ADMIN >= ADMIN, wiec bramka, ktora wpuszcza administratora
  -- i odbija super administratora, jest po prostu bledna. Ta sama funkcja
  -- pojawia sie w tej roli w migracjach 20260702090100 i 20260712102007.
  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'editor'::app_role)
    OR public.is_super_admin(v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden: editor role required';
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant';
  END IF;

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_editor_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_editor_tenant() TO authenticated, service_role;

COMMENT ON FUNCTION public.assert_editor_tenant() IS
  'Bramka staffa redakcyjnego modulu Wydarzen: admin, editor albo super_admin. Odrzuca role author. Zwraca tenanta domowego wolajacego. Inwariant super_admin >= admin jest tu jawny, bo klient (useAuth.isAdmin) tak samo go liczy.';

-- ----------------------------------------------------------------------------
-- 2) Tworzenie wydarzenia: adres zapisu zewnetrznego jako czesc kontraktu
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_type public.event_types;
  v_type_id uuid := NULLIF(p_payload->>'event_type_id', '')::uuid;
  v_title_pl text := btrim(COALESCE(p_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(p_payload->>'title_en', ''));
  v_starts_at timestamptz := NULLIF(p_payload->>'starts_at', '')::timestamptz;
  v_external_url text := NULLIF(btrim(COALESCE(p_payload->>'external_registration_url', '')), '');
  v_slug_base text;
  v_slug text;
  v_suffix integer := 1;
  v_kind text;
  v_ends_at timestamptz;
  v_id uuid;
BEGIN
  IF v_title_pl = '' OR v_title_en = '' THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'invalid_starts_at: start date is required';
  END IF;

  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'invalid_type: event type is required';
  END IF;

  -- Rodzaj MUSI nalezec do tenanta wolajacego. Bez tego warunku redaktor
  -- tenanta A zaseedowalby wydarzenie ustawieniami tenanta B, podajac obce id.
  SELECT * INTO v_type
  FROM public.event_types et
  WHERE et.id = v_type_id AND et.tenant_id = v_tenant;

  IF v_type.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event type does not exist in this tenant';
  END IF;

  IF NOT v_type.is_active THEN
    RAISE EXCEPTION 'event_type_inactive: type is disabled in this organisation';
  END IF;

  -- Tryb `external` znaczy: zapisy prowadzi obcy system. Warunek
  -- `events_external_mode_requires_url` na `events` wymaga wtedy adresu, wiec
  -- brak adresu nie jest tu „pustym polem" - jest wydarzeniem, ktorego nie da
  -- sie zapisac. Odmowa musi wiec przyjsc Z NAZWA POWODU, a nie jako naruszenie
  -- warunku bazy, bo z komunikatu o warunku formularz nie zbuduje zdania
  -- dla uzytkownika.
  IF v_type.default_registration_mode = 'external' THEN
    IF v_external_url IS NULL THEN
      RAISE EXCEPTION 'external_url_required: type registers externally and needs a url';
    END IF;
    -- Tylko `https`. Adres zapisow trafia do uczestnika jako odnosnik wychodzacy,
    -- a `http` i `javascript:` w tej roli to dwie rozne klasy szkody: pierwsza
    -- to dane zapisu przesylane jawnym tekstem, druga to wykonanie skryptu
    -- w kontekscie naszej strony.
    IF v_external_url !~* '^https://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'external_url_invalid: url must start with https';
    END IF;
    IF char_length(v_external_url) > 2048 THEN
      RAISE EXCEPTION 'external_url_invalid: url is too long';
    END IF;
  ELSE
    -- Adres podany przy trybie, ktory go nie uzywa, byloby martwym polem
    -- w bazie: nikt go nie czyta, a przy zmianie trybu nagle staje sie
    -- aktywnym odnosnikiem, ktorego nikt swiadomie nie zatwierdzil.
    v_external_url := NULL;
  END IF;

  -- Adres z tytulu polskiego: diakrytyki rozkladane (`unaccent` nie jest
  -- gwarantowane, wiec translate na pary), reszta na myslniki.
  v_slug_base := lower(translate(
    v_title_pl,
    'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
    'acelnoszzACELNOSZZ'
  ));
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(v_slug_base, '-');
  v_slug_base := left(v_slug_base, 110);

  -- Tytul zlozony wylacznie ze znakow niealfanumerycznych da pusty adres,
  -- a CHECK wymaga trzech znakow. Wtedy adres bierzemy z klucza rodzaju.
  IF char_length(v_slug_base) < 3 THEN
    v_slug_base := v_type.key;
  END IF;

  v_slug := v_slug_base;
  WHILE EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.slug = v_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_slug := left(v_slug_base, 110) || '-' || v_suffix::text;
  END LOOP;

  -- Legacy `kind` ma wlasny CHECK z szescioma wartosciami, wiec rodzaj
  -- redakcyjny poza tym zbiorem nie da sie w nia wpisac. Wtedy `kind` bierze
  -- wartosc najblizsza semantycznie formatowi, a zrodlem prawdy jest
  -- `event_type_id`.
  v_kind := CASE
    WHEN v_type.key IN ('webinar', 'briefing', 'roundtable', 'ama', 'in_person', 'hybrid')
      THEN v_type.key
    WHEN v_type.default_format = 'online' THEN 'webinar'
    WHEN v_type.default_format = 'hybrid' THEN 'hybrid'
    ELSE 'in_person'
  END;

  v_ends_at := CASE
    WHEN v_type.default_duration_minutes IS NULL THEN NULL
    ELSE v_starts_at + make_interval(mins => v_type.default_duration_minutes)
  END;

  INSERT INTO public.events (
    tenant_id, slug, title_pl, title_en, starts_at, ends_at,
    status, kind, event_type_id, format,
    registration_mode, registration_flow, guest_mode, external_registration_url,
    capacity, min_tier_rank, chatham_house,
    visibility, created_by
  ) VALUES (
    v_tenant, v_slug, v_title_pl, v_title_en, v_starts_at, v_ends_at,
    'draft', v_kind, v_type.id, v_type.default_format,
    v_type.default_registration_mode, v_type.default_registration_flow,
    v_type.default_guest_mode, v_external_url,
    v_type.default_capacity, v_type.default_min_tier_rank, v_type.default_chatham_house,
    -- Prog rangi wieksze od zera znaczy tresc czlonkowska - widocznosc musi za
    -- tym pojsc, inaczej wydarzenie jest publiczne i jednoczesnie progowane,
    -- czyli widoczne dla wszystkich i niedostepne dla wiekszosci.
    CASE WHEN v_type.default_min_tier_rank > 0 THEN 'members' ELSE 'public' END,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_create(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_create(jsonb) IS
  'Tworzy wydarzenie z domyslnych ustawien rodzaju. Wejscie: event_type_id, title_pl, title_en, starts_at oraz external_registration_url - wymagany wtedy i tylko wtedy, gdy rodzaj zapisuje uczestnikow w obcym systemie (tryb external). Odmowy nazwane: invalid_titles, invalid_starts_at, invalid_type, not_found, event_type_inactive, external_url_required, external_url_invalid.';

-- ----------------------------------------------------------------------------
-- 3) Zapis na wydarzenie respektuje tryb i przeplyw zapisow
--
-- Cialo funkcji pochodzi z migracji 20260822171037 i jest przepisane bez zmian
-- poza JEDNYM blokiem bramki trybu. Przepisujemy calosc, bo `CREATE OR REPLACE`
-- wymaga pelnej definicji - i dlatego kazda przyszla zmiana `rsvp_event` musi
-- startowac z TEJ wersji, nie z 20260822171037.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_prev text;
  v_going integer;
  v_waitlist integer;
  v_position integer;
  v_min_rank integer;
  v_result_status text := p_status;
  v_paid boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'events: authentication required';
  END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid status';
  END IF;
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND tenant_id = public.public_tenant_id()
     AND status = 'published'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'events: not found';
  END IF;

  -- BRAMKA TRYBU ZAPISOW. Kolumny `registration_mode` i `registration_flow`
  -- weszly migracja 20260823120000 i do tej pory NIKT ich nie czytal - panel
  -- zapisywal wybor organizatora, a ta funkcja i tak przyjmowala zapis jednym
  -- klikiem. Skutek byl dokladnie odwrotny do obietnicy ekranu: wydarzenie
  -- z zapisami WYLACZONYMI przyjmowalo zapisy, wydarzenie z formularzem
  -- kwalifikujacym omijalo formularz, a wydarzenie wymagajace AKCEPTACJI
  -- organizatora potwierdzalo uczestnika natychmiast.
  --
  -- Bramka obejmuje wylacznie `going`, czyli sam zapis. `interested` zostaje
  -- otwarte (to sygnal zainteresowania, nie rejestracja), a `cancelled` MUSI
  -- zostac otwarte zawsze - uczestnik, ktory zapisal sie przed zmiana trybu,
  -- nie moze zostac uwieziony we wlasnym zapisie.
  --
  -- Sciezki `form` i `approval` dostana wlasny przeplyw w module rejestracji
  -- (tabele zapisow, pytania kwalifikujace, kolejka decyzji). Do tego czasu
  -- odmowa z jawnym powodem jest JEDYNA poprawna odpowiedzia: cicha akceptacja
  -- oznaczalaby, ze organizator widzi w panelu proces, ktorego baza nie pilnuje.
  IF p_status = 'going' THEN
    IF v_event.registration_mode = 'none' THEN
      RAISE EXCEPTION 'events: registration disabled';
    ELSIF v_event.registration_mode = 'external' THEN
      RAISE EXCEPTION 'events: registration external';
    ELSIF v_event.registration_mode = 'form' THEN
      RAISE EXCEPTION 'events: registration form required';
    ELSIF v_event.registration_flow = 'approval' THEN
      RAISE EXCEPTION 'events: registration approval required';
    END IF;
  END IF;

  IF v_event.visibility = 'members' THEN
    IF v_event.kind = 'briefing' THEN
      IF NOT public.has_tier_feature('pro_briefings') THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    ELSE
      v_min_rank := GREATEST(COALESCE(v_event.min_tier_rank, 0), 1);
      IF NOT public.has_tier_rank(v_min_rank) THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    END IF;
  ELSIF NOT public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0)) THEN
    RAISE EXCEPTION 'events: membership required';
  END IF;
  IF v_event.chatham_house AND NOT public.has_tier_feature('chatham_house_events') THEN
    RAISE EXCEPTION 'events: chatham house membership required';
  END IF;
  IF p_status <> 'cancelled'
     AND v_event.rsvp_opens_at IS NOT NULL
     AND now() < v_event.rsvp_opens_at THEN
    IF v_event.early_rsvp_rank IS NULL
       OR NOT public.has_tier_rank(v_event.early_rsvp_rank) THEN
      RAISE EXCEPTION 'events: rsvp not open';
    END IF;
  END IF;
  SELECT er.status INTO v_prev
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;
  IF p_status = 'going'
     AND COALESCE(v_event.ticket_price_cents, 0) > 0
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.payment_orders po
       WHERE po.user_id = v_user
         AND po.status = 'paid'
         AND po.metadata ->> 'event_id' = p_event_id::text
    ) INTO v_paid;
    IF NOT v_paid AND NOT public.claim_included_event_ticket(p_event_id) THEN
      RAISE EXCEPTION 'events: ticket required';
    END IF;
  END IF;
  IF p_status = 'going'
     AND v_event.capacity IS NOT NULL
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT count(*) INTO v_going
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going';
    IF v_going >= v_event.capacity THEN
      v_result_status := 'waitlist';
    END IF;
  END IF;
  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, waitlisted_at)
  VALUES (
    v_event.tenant_id, p_event_id, v_user, v_result_status,
    CASE WHEN v_result_status = 'waitlist' THEN clock_timestamp() END
  )
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    waitlisted_at = CASE
      WHEN EXCLUDED.status = 'waitlist'
        THEN COALESCE(event_rsvps.waitlisted_at, clock_timestamp())
      ELSE NULL
    END,
    updated_at = now();
  IF v_prev = 'going' AND v_result_status <> 'going' THEN
    PERFORM public.promote_event_waitlist(p_event_id);
  END IF;
  IF p_status <> 'going' THEN
    PERFORM public.release_included_event_ticket(p_event_id, v_user);
  END IF;
  SELECT count(*) FILTER (WHERE er.status = 'going'),
         count(*) FILTER (WHERE er.status = 'waitlist')
    INTO v_going, v_waitlist
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id;
  IF v_result_status = 'waitlist' THEN
    SELECT count(*) INTO v_position
      FROM public.event_rsvps er
     WHERE er.event_id = p_event_id
       AND er.status = 'waitlist'
       AND er.waitlisted_at <= (
         SELECT mine.waitlisted_at
           FROM public.event_rsvps mine
          WHERE mine.event_id = p_event_id AND mine.user_id = v_user
       );
  END IF;
  RETURN jsonb_build_object(
    'status', v_result_status,
    'going', v_going,
    'waitlist', v_waitlist,
    'waitlist_position', v_position
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.rsvp_event(uuid, text) IS
  'Zapis uczestnika na wydarzenie na plaszczyznie tresci. Respektuje tryb zapisow (rsvp / form / external / none) i przeplyw (instant / approval): status going przechodzi wylacznie przy trybie rsvp z przeplywem instant. Statusy interested i cancelled sa otwarte niezaleznie od trybu - pierwszy jest sygnalem, drugi wycofaniem wlasnego zapisu. Odmowy nazwane: registration disabled, registration external, registration form required, registration approval required.';
