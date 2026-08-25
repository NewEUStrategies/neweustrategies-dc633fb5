-- LADUNEK MAILA O ZGLOSZENIU NA WYDARZENIE
--
-- PO CO OSOBNA FUNKCJA, SKORO PANEL MA JUZ `admin_event_registrations_list`.
-- Bo lista NIE ODDAJE JEZYKA ODBIORCY, a mail bez jezyka to mail wyslany po
-- polsku do kogos, kto zapisal sie po angielsku. Lista oddaje tez wiersz po
-- wierszu wszystko, czego potrzebuje TABELA (statusy, filtry, liczniki), a nie
-- to, czego potrzebuje WYSYLKA (adres, imie, jezyk, najemca, tytul wydarzenia
-- i termin w jego strefie). To sa dwa rozne kontrakty i sklejenie ich znaczyloby,
-- ze kazda zmiana kolumny w tabeli panelu rusza sciezke poczty.
--
-- JEZYK ODBIORCY - TRZY ZRODLA, W TEJ KOLEJNOSCI. Preferencja z profilu
-- (`profiles.prefs`), potem jezyk zapisu do newslettera dla tego samego adresu,
-- na koncu polski. Uczestnik BEZ KONTA nie ma profilu, wiec dla niego liczy sie
-- wylacznie drugie zrodlo - i to jest cala roznica miedzy „mail po polsku do
-- Belga" a „mail po angielsku do Belga".
--
-- STATUS WRACA RAZEM Z LADUNKIEM, ZEBY WARSTWA WYSYLKI MOGLA SIE WYCOFAC.
-- Miedzy klikniecem „powiadom" a wysylka organizator moze zmienic decyzje;
-- funkcja wysylajaca porownuje status z ladunku z tym, o ktorym mysli, ze
-- powiadamia, i milczy przy rozjezdzie. Ten sam wzorzec, co
-- `admin_club_application_notify_payload`.
--
-- BRAMKA ROLI JEST TUTAJ, NIE W SERWEROWEJ FUNKCJI TANSTACKA.
-- `assert_editor_tenant()` wiaze najemce z ROLA WOLAJACEGO, a nie z naglowkiem
-- hosta - dlatego redaktor najemcy A nie odczyta adresu uczestnika najemcy B,
-- nawet podrabiajac naglowek.

DROP FUNCTION IF EXISTS public.admin_event_registration_notify_payload(jsonb);
CREATE FUNCTION public.admin_event_registration_notify_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_out jsonb;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: registration_id is required';
  END IF;

  SELECT jsonb_build_object(
    'registration_id', r.id,
    'tenant_id', r.tenant_id,
    'status', r.status,
    'decision_note', r.decision_note,
    'waitlist_position', r.waitlist_position,
    'promoted_at', r.promoted_at,
    'waitlist_notified_at', r.waitlist_notified_at,
    'email', p.email,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'lang', COALESCE(
      CASE
        WHEN lower(NULLIF(pr.prefs->>'language', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'language')
        WHEN lower(NULLIF(pr.prefs->>'lang', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'lang')
        ELSE NULL
      END,
      (
        SELECT lower(ns.language)
        FROM public.newsletter_subscribers ns
        WHERE ns.tenant_id = r.tenant_id
          AND lower(ns.email) = lower(p.email)
          AND lower(ns.language) IN ('pl', 'en')
        LIMIT 1
      ),
      'pl'
    ),
    'event_id', e.id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone,
    'event_location', e.location,
    'ticket_name_pl', tt.name_pl,
    'ticket_name_en', tt.name_en
  )
  INTO v_out
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  JOIN public.events e
    ON e.id = r.event_id AND e.tenant_id = r.tenant_id
  LEFT JOIN public.profiles pr
    ON pr.id = p.user_id AND pr.tenant_id = r.tenant_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND r.id = v_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this organisation';
  END IF;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_notify_payload(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_notify_payload(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_notify_payload(jsonb) IS
  'Dane JEDNEGO zgloszenia potrzebne do wyslania maila: adres, imie, JEZYK odbiorcy (profil -> newsletter -> pl), najemca, status w chwili odczytu oraz tytul i termin wydarzenia. Kontrakt wysylki, osobny od kontraktu tabeli panelu. Bramka: assert_editor_tenant().';


-- ---------------------------------------------------------------------------
-- WLASNE POTWIERDZENIE UCZESTNIKA
--
-- Gosc BEZ KONTA ma dostac potwierdzenie zapisu, a warstwa wysylajaca musi
-- najpierw poznac jego adres i jezyk. Nie ma tu bramki roli i byc nie moze -
-- ten czlowiek nie ma konta w serwisie. Zamiast roli stoi ten sam sekret, co
-- przy rezygnacji: `manage_token`. Kto go zna, moze juz dzis ODWOLAC ten zapis
-- (`event_registration_cancel`), wiec oddanie mu wlasnego adresu i imienia nie
-- podnosi niczyich uprawnien - a bez tego jedyna droga do potwierdzenia byloby
-- reczne wysylanie maili przez organizatora.
--
-- FUNKCJA JEST STABLE I NIC NIE ZAPISUJE. Nie stempluje, nie liczy prob i nie
-- wysyla - oddaje ladunek. Wysylka (z idempotencja i lista wykluczen) zostaje
-- po stronie potoku poczty, tak samo jak dla sciezki administracyjnej.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.event_registration_notify_payload(jsonb);
CREATE FUNCTION public.event_registration_notify_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL OR v_manage IS NULL THEN
    RAISE EXCEPTION 'invalid_request: manage_token is required';
  END IF;

  SELECT jsonb_build_object(
    'registration_id', r.id,
    'tenant_id', r.tenant_id,
    'status', r.status,
    'decision_note', NULL,
    'waitlist_position', r.waitlist_position,
    'email', p.email,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'lang', COALESCE(
      CASE
        WHEN lower(NULLIF(pr.prefs->>'language', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'language')
        WHEN lower(NULLIF(pr.prefs->>'lang', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'lang')
        ELSE NULL
      END,
      (
        SELECT lower(ns.language)
        FROM public.newsletter_subscribers ns
        WHERE ns.tenant_id = r.tenant_id
          AND lower(ns.email) = lower(p.email)
          AND lower(ns.language) IN ('pl', 'en')
        LIMIT 1
      ),
      'pl'
    ),
    'event_id', e.id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone,
    'event_location', e.location,
    'ticket_name_pl', tt.name_pl,
    'ticket_name_en', tt.name_en
  )
  INTO v_out
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  JOIN public.events e
    ON e.id = r.event_id AND e.tenant_id = r.tenant_id
  LEFT JOIN public.profiles pr
    ON pr.id = p.user_id AND pr.tenant_id = r.tenant_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND r.manage_token_hash IS NOT NULL
    AND r.manage_token_hash = encode(digest(v_manage, 'sha256'), 'hex');

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_notify_payload(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_notify_payload(jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_notify_payload(jsonb) IS
  'Dane WLASNEGO zgloszenia po kluczu manage_token: adres, imie, jezyk, najemca, status oraz tytul i termin wydarzenia. Uwierzytelnienie tym samym sekretem, co event_registration_cancel - kto zna klucz, moze juz odwolac ten zapis, wiec odczyt wlasnych danych nie podnosi uprawnien. Uzasadnienie odmowy NIE wychodzi ta droga. Plaszczyzna tresci - zero has_role().';
