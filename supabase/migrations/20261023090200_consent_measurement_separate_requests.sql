-- ============================================================================
-- ZGODA NA POMIAR OTWARĆ I KLIKNIĘĆ JAKO OSOBNE POLE (I9d-Y2b, 3/3): PROŚBY
-- O ZGODĘ - WERSJA TREŚCI POMIARU, ZAPIS PRZEZ JEDYNEGO PISARZA „TAK",
-- PROŚBY PO ZAPISIE (`origin = 'signup'`) Z WŁASNYM BUDŻETEM.
-- Decyzje właściciela 2026-10-23: D1 wariant (b), D2 - pomiar tylko dla
-- skrzynki potwierdzonej przez jej właściciela.
--
-- DEFEKT
--   1. Prośba z panelu i jej potwierdzenie (20261020162500) działają na
--      treści i wersji zgody na NEWSLETTER (a): potwierdzenie zapisuje wpis
--      `newsletter` „tak", a pomiar dopisywał usunięty już wyzwalacz
--      pakietowania - od 20261023090000 potwierdzenie nie dałoby pomiaru.
--   2. Kandydat z mailem prośby (a) już wysłanym („To jedyna wiadomość
--      w tej sprawie") wróciłby na listę przy nowej wersji treści.
--   3. Prośby po zapisie bez DOI (20261023090100) dzieliłyby z panelem okno
--      08:00-17:59 i dzienny limit wspólny z wygaszaniem Y1.
--
-- ZMIANA (projekt I9d-Y2b §3.A10, rozstrzygnięcia R1.9, R1.13)
--   A. `newsletter_measurement_confirm`: zapis WYŁĄCZNIE przez
--      `_email_measurement_grant` - kanał `measurement:signup` (prośba po
--      zapisie) albo `measurement:reconfirm` (panel), treść i wersja pola
--      pomiaru; bez wpisu `newsletter`. Kształt wyniku bez zmian.
--   B. `newsletter_measurement_claim(p_limit, p_origin)`: DROP + CREATE -
--      nowy parametr `p_origin` (NULL = oba pochodzenia, najpierw `signup`;
--      'signup' = tylko prośby po zapisie - krok TS woła tak POZA oknem
--      dziennym) i kolumna wyniku `origin`. Budżety: `panel` - wspólny z Y1
--      (200/dobę, `_newsletter_oneoff_mail_used` liczy tylko prośby panelu),
--      `signup` - własny 500/dobę (`_newsletter_measurement_signup_mail_used`;
--      lustro NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP). Nieaktualna prośba
--      (wypis, zgoda udzielona, „nie" pomiaru po prośbie) - `skipped`.
--   C. Kandydaci: wersja treści pomiaru; wykluczony, kto dostał mail prośby
--      w DOWOLNEJ wersji (queued/duplicate) albo sam odmówił (ostatnia
--      decyzja z kanału własnej odmowy). Wypis i retencja nie wykluczają.
--   D. Panel: podgląd i start w wersji treści pomiaru, liczniki tylko próśb
--      `origin = 'panel'`, start zapisuje `origin = 'panel'`.
--   E. Niewysłane prośby z wersją treści (a) - jednorazowo na wersję treści
--      pomiaru (zamiar admina zostaje; kolejka nie staje).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261023090000 i 20261023090100 (kolumna
-- `origin`). Krok TS (`jobs-tick`, I9d-Y2b) woła `p_origin` - stary krok
-- (tylko `p_limit`) działa dalej (oba pochodzenia w oknie).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, DROP FUNCTION IF EXISTS + CREATE,
-- UPDATE tylko niewysłanych próśb wersji (a) bez pary w nowej wersji
-- (powtórka = 0 wierszy), bezstanowe REVOKE/GRANT/COMMENT.
-- DOWÓD: supabase/tests/hub_i9d_y2b_measurement_separate_test.sql,
-- supabase/tests/hub_i9d_y2_reconfirm_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B1) Budżety dzienne jednorazowych maili.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162500; zmiana - z próśb o zgodę na pomiar liczy tylko
-- prośby z panelu (prośby po zapisie mają własny budżet).
-- CIALO-Z: 20261020162500
CREATE OR REPLACE FUNCTION public._newsletter_oneoff_mail_used(p_tenant uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ((SELECT count(*) FROM public.newsletter_sunset_requests q
            WHERE q.tenant_id = p_tenant
              AND (q.mailed_at > now() - interval '24 hours' OR (q.mailed_at IS NULL AND q.claimed_until > now())))
        + (SELECT count(*) FROM public.newsletter_measurement_requests r
            WHERE r.tenant_id = p_tenant AND r.origin = 'panel'
              AND ((r.mailed_at > now() - interval '24 hours' AND r.mail_outcome IN ('queued', 'duplicate'))
                   OR (r.mailed_at IS NULL AND r.claimed_until > now()))))::integer
$$;

-- Prośby po zapisie: wysłane w 24 h plus dzierżawy w toku (jak wyżej).
CREATE OR REPLACE FUNCTION public._newsletter_measurement_signup_mail_used(p_tenant uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer FROM public.newsletter_measurement_requests r
   WHERE r.tenant_id = p_tenant AND r.origin = 'signup'
     AND ((r.mailed_at > now() - interval '24 hours' AND r.mail_outcome IN ('queued', 'duplicate'))
          OR (r.mailed_at IS NULL AND r.claimed_until > now()))
$$;

REVOKE ALL ON FUNCTION public._newsletter_oneoff_mail_used(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._newsletter_measurement_signup_mail_used(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_oneoff_mail_used(uuid) IS
  'Wygaszanie i pomiar (I9d-Y1/Y2/Y2b): zużycie wspólnego dziennego budżetu jednorazowych maili najemcy - prośby wygaszania i prośby o zgodę na pomiar Z PANELU (wysłane w 24 h + dzierżawy w toku). Prośby po zapisie - osobny budżet. Wewnętrzna.';
COMMENT ON FUNCTION public._newsletter_measurement_signup_mail_used(uuid) IS
  'Zgoda i pomiar (I9d-Y2b): zużycie własnego dziennego budżetu próśb o zgodę na pomiar po zapisie (origin signup; wysłane w 24 h + dzierżawy w toku). Wewnętrzna.';

-- ----------------------------------------------------------------------------
-- C) Kandydaci do prośby z panelu.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162500; zmiana - wersja treści pomiaru, wykluczenie
-- adresów z mailem prośby w dowolnej wersji (R1.9) i ostatnia decyzja liczona
-- tylko z udzieleń i kanałów własnej odmowy (wypis, retencja - nie).
-- CIALO-Z: 20261020162500
CREATE OR REPLACE FUNCTION public._newsletter_measurement_candidates(p_tenant uuid)
RETURNS TABLE (subscriber_id uuid, suppressed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, public.email_is_suppressed(p_tenant, s.email)
    FROM public.newsletter_subscribers s
   WHERE s.tenant_id = p_tenant AND s.status IN ('subscribed', 'confirmed')
     AND NOT EXISTS (SELECT 1 FROM public.newsletter_measurement_requests r
                      WHERE r.subscriber_id = s.id
                        AND (r.consent_version = public._email_measurement_consent_version()
                             OR r.mail_outcome IN ('queued', 'duplicate')))
     AND NOT public._email_measurement_consent(p_tenant, s.email)
     AND COALESCE((SELECT c.given FROM public.crm_consent_log c
                    WHERE c.tenant_id = p_tenant AND lower(c.email) = lower(s.email)
                      AND c.consent_key = 'email_measurement'
                      AND (c.given OR c.form_id = ANY (public._email_measurement_refusal_channels()))
                    ORDER BY c.created_at DESC, c.given, c.id DESC LIMIT 1), true)
   ORDER BY s.created_at, s.id
$$;

REVOKE ALL ON FUNCTION public._newsletter_measurement_candidates(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_measurement_candidates(uuid) IS
  'Zgoda i pomiar (I9d-Y2b): kandydaci do prośby z panelu - aktywni subskrybenci najemcy bez zgody na pomiar, bez prośby w wersji treści pomiaru, bez maila prośby w dowolnej wersji, bez własnej odmowy (stopka, preferencje, konto, strona DOI); suppressed liczone osobno. Wewnętrzna.';

-- ----------------------------------------------------------------------------
-- D) Panel: podgląd i start (admin z sesji).
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162500; zmiana - wersja treści pomiaru, liczniki próśb
-- tylko z panelu.
-- CIALO-Z: 20261020162500
-- rpc-shape: admin_newsletter_measurement_preview (version, enabled, subscribers,
-- with_consent, candidates, suppressed, requested, pending, mailed, blocked,
-- skipped, failed, confirmed, daily_cap, last_requested_at)
CREATE OR REPLACE FUNCTION public.admin_newsletter_measurement_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro `newsletter_measurement_claim` (limit panelu i próby).
  c_daily_cap constant integer := 200;
  c_max_attempts constant integer := 5;
  v_tenant uuid := public._data_retention_admin_tenant();
  v_version text := public._email_measurement_consent_version();
  v_c record;
  v_r record;
  v_s record;
BEGIN
  SELECT count(*) FILTER (WHERE NOT x.suppressed) AS candidates,
         count(*) FILTER (WHERE x.suppressed) AS suppressed
    INTO v_c FROM public._newsletter_measurement_candidates(v_tenant) x;
  SELECT count(*) AS requested,
         count(*) FILTER (WHERE r.mailed_at IS NULL AND r.attempts < c_max_attempts) AS pending,
         count(*) FILTER (WHERE r.mail_outcome IN ('queued', 'duplicate')) AS mailed,
         count(*) FILTER (WHERE r.mail_outcome = 'suppressed') AS blocked,
         count(*) FILTER (WHERE r.mail_outcome = 'skipped') AS skipped,
         count(*) FILTER (WHERE r.mailed_at IS NULL AND r.attempts >= c_max_attempts) AS failed,
         count(*) FILTER (WHERE r.confirmed_at IS NOT NULL) AS confirmed,
         max(r.requested_at) AS last_requested_at
    INTO v_r FROM public.newsletter_measurement_requests r
   WHERE r.tenant_id = v_tenant AND r.consent_version = v_version AND r.origin = 'panel';
  SELECT count(*) AS subscribers,
         count(*) FILTER (WHERE public._email_measurement_consent(v_tenant, s.email)) AS with_consent
    INTO v_s FROM public.newsletter_subscribers s
   WHERE s.tenant_id = v_tenant AND s.status IN ('subscribed', 'confirmed');
  RETURN jsonb_build_object(
    'version', v_version,
    'enabled', public._newsletter_track_opens(v_tenant),
    'subscribers', v_s.subscribers, 'with_consent', v_s.with_consent,
    'candidates', v_c.candidates, 'suppressed', v_c.suppressed,
    'requested', v_r.requested, 'pending', v_r.pending, 'mailed', v_r.mailed, 'blocked', v_r.blocked,
    'skipped', v_r.skipped, 'failed', v_r.failed, 'confirmed', v_r.confirmed,
    'daily_cap', c_daily_cap, 'last_requested_at', v_r.last_requested_at);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_measurement_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_measurement_preview() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_measurement_preview() IS
  'Zgoda i pomiar (I9d-Y2b): podgląd „Poproś o zgodę na pomiar" - wersja treści POMIARU, przełącznik najemcy, aktywni subskrybenci, ze zgodą na pomiar, kandydaci (bez/na liście wyłączeń), stan próśb z PANELU w bieżącej wersji (zlecone, w kolejce, wysłane, zablokowane, pominięte, nieudane, potwierdzone), limit dzienny. Admin albo super_admin z sesji (42501).';

-- CIALO-Z: 20261020162500
-- rpc-shape: admin_newsletter_measurement_request (requested, version)
CREATE OR REPLACE FUNCTION public.admin_newsletter_measurement_request(p_expected integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._data_retention_admin_tenant();
  v_version text := public._email_measurement_consent_version();
  v_count integer;
  v_n integer := 0;
BEGIN
  IF p_expected IS NULL OR p_expected < 0 THEN
    RAISE EXCEPTION 'expected_invalid' USING ERRCODE = '22023';
  END IF;
  -- Jeden start naraz na najemcę (dwie karty panelu).
  PERFORM pg_advisory_xact_lock(hashtextextended('newsletter_measurement_request:' || v_tenant::text, 0));
  SELECT count(*) INTO v_count FROM public._newsletter_measurement_candidates(v_tenant) x WHERE NOT x.suppressed;
  -- Nigdy do większej grupy, niż admin zatwierdził w podglądzie.
  IF v_count > p_expected THEN
    RAISE EXCEPTION 'stale_preview' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, requested_by, origin)
  SELECT x.subscriber_id, v_version, v_tenant, auth.uid(), 'panel'
    FROM public._newsletter_measurement_candidates(v_tenant) x
   WHERE NOT x.suppressed
  ON CONFLICT (subscriber_id, consent_version) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_tenant, auth.uid(), 'newsletter.measurement_reconfirm_requested', 'newsletter_settings', v_tenant,
            jsonb_build_object('requested', v_n, 'consent_version', v_version));
  END IF;
  RETURN jsonb_build_object('requested', v_n, 'version', v_version);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_measurement_request(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_measurement_request(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_measurement_request(integer) IS
  'Zgoda i pomiar (I9d-Y2b): start „Poproś o zgodę na pomiar" - prośba (origin panel, wersja treści POMIARU) dla każdego kandydata spoza listy wyłączeń (jedna na wersję). p_expected = liczba z podglądu: więcej kandydatów = 40001 stale_preview, NULL/ujemna = 22023 expected_invalid. Audyt bez adresów. Admin albo super_admin z sesji.';

-- ----------------------------------------------------------------------------
-- B2) Wysyłka (krok TS): porcja z pochodzeniem.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162500; zmiana - parametr `p_origin`, kolumna `origin`,
-- osobne budżety pochodzeń (najpierw `signup`), `skipped` także po „nie"
-- pomiaru późniejszym niż prośba. Nowa lista parametrów = DROP + CREATE.
DROP FUNCTION IF EXISTS public.newsletter_measurement_claim(integer);
-- CIALO-Z: 20261020162500
-- rpc-shape: newsletter_measurement_claim (subscriber_id, tenant_id, email, lang,
-- first_name, nonce, consent_version, unsubscribe_token, attempt, origin)
CREATE OR REPLACE FUNCTION public.newsletter_measurement_claim(p_limit integer DEFAULT 50, p_origin text DEFAULT NULL)
RETURNS TABLE (
  subscriber_id uuid,
  tenant_id uuid,
  email text,
  lang text,
  first_name text,
  nonce uuid,
  consent_version text,
  unsubscribe_token text,
  attempt integer,
  origin text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Panel: lustro DATA_RETENTION_RULES.newsletterDailyCap (budżet wspólny
  -- z Y1). Po zapisie: lustro NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP
  -- (src/lib/privacy/measurementReconfirm.ts).
  c_daily_cap constant integer := 200;
  c_signup_daily_cap constant integer := 500;
  c_lease constant interval := interval '15 minutes';
  -- Po 5 nieudanych próbach prośba zostaje „nieudana" (podgląd w panelu).
  c_max_attempts constant integer := 5;
  v_left integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_origin text;
  v_tenant uuid;
  v_take integer;
  v_n integer;
BEGIN
  IF p_origin IS NOT NULL AND p_origin NOT IN ('panel', 'signup') THEN
    RAISE EXCEPTION 'origin_invalid' USING ERRCODE = '22023';
  END IF;
  FOREACH v_origin IN ARRAY CASE WHEN p_origin IS NULL THEN ARRAY['signup', 'panel'] ELSE ARRAY[p_origin] END LOOP
    FOR v_tenant IN
      SELECT DISTINCT r.tenant_id FROM public.newsletter_measurement_requests r
       WHERE r.origin = v_origin AND r.mailed_at IS NULL AND r.attempts < c_max_attempts
         AND (r.claimed_until IS NULL OR r.claimed_until < now())
       ORDER BY r.tenant_id
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(v_left, CASE WHEN v_origin = 'signup'
                                   THEN c_signup_daily_cap - public._newsletter_measurement_signup_mail_used(v_tenant)
                                   ELSE c_daily_cap - public._newsletter_oneoff_mail_used(v_tenant) END);
      CONTINUE WHEN v_take <= 0;
      -- Czoło kolejki: prośba nieaktualna (wypis, zgoda udzielona albo „nie"
      -- pomiaru po prośbie) - `skipped`, bez maila.
      WITH head AS (
        SELECT r.subscriber_id AS sid, r.consent_version AS ver FROM public.newsletter_measurement_requests r
         WHERE r.tenant_id = v_tenant AND r.origin = v_origin AND r.mailed_at IS NULL
           AND r.attempts < c_max_attempts AND (r.claimed_until IS NULL OR r.claimed_until < now())
         ORDER BY r.requested_at, r.subscriber_id
         LIMIT v_take
         FOR UPDATE OF r SKIP LOCKED
      )
      UPDATE public.newsletter_measurement_requests r
         SET mailed_at = now(), mail_outcome = 'skipped', claimed_until = NULL
        FROM head h JOIN public.newsletter_subscribers s ON s.id = h.sid
       WHERE r.subscriber_id = h.sid AND r.consent_version = h.ver
         AND (s.status NOT IN ('subscribed', 'confirmed') OR public._email_measurement_consent(v_tenant, s.email)
              OR EXISTS (SELECT 1 FROM public.crm_consent_log c
                          WHERE c.tenant_id = v_tenant AND lower(c.email) = lower(s.email)
                            AND c.consent_key = 'email_measurement' AND NOT c.given
                            AND c.created_at >= r.requested_at));
      RETURN QUERY
        WITH picked AS (
          SELECT r.subscriber_id AS sid, r.consent_version AS ver FROM public.newsletter_measurement_requests r
           WHERE r.tenant_id = v_tenant AND r.origin = v_origin AND r.mailed_at IS NULL
             AND r.attempts < c_max_attempts AND (r.claimed_until IS NULL OR r.claimed_until < now())
           ORDER BY r.requested_at, r.subscriber_id
           LIMIT v_take
           FOR UPDATE OF r SKIP LOCKED
        ), upd AS (
          UPDATE public.newsletter_measurement_requests r
             SET claimed_until = now() + c_lease, attempts = r.attempts + 1
            FROM picked p WHERE r.subscriber_id = p.sid AND r.consent_version = p.ver
          RETURNING r.subscriber_id AS sid, r.tenant_id AS tid, r.nonce AS n, r.consent_version AS ver,
                    r.requested_at AS req, r.attempts AS att, r.origin AS org
        )
        SELECT u.sid, u.tid, s.email, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END, s.first_name, u.n,
               u.ver, s.unsubscribe_token, u.att::integer, u.org
          FROM upd u JOIN public.newsletter_subscribers s ON s.id = u.sid
         ORDER BY u.req, u.sid;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_left := v_left - v_n;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_measurement_claim(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_measurement_claim(integer, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_measurement_claim(integer, text) IS
  'Zgoda i pomiar (I9d-Y2b): porcja próśb o zgodę na pomiar do wysłania - p_origin NULL = oba pochodzenia (najpierw signup), signup|panel = tylko to (inne - 22023 origin_invalid); budżet panelu 200/dobę wspólny z prośbami wygaszania, budżet próśb po zapisie 500/dobę; dzierżawa 15 min, maks. 5 prób; nieaktualne -> skipped. Wiersz: subskrybent, najemca, adres, język (pl|en), imię, nonce, wersja treści, token wypisu, próba, pochodzenie (panel|signup). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- A) Link potwierdzenia (jednorazowy) - zapis przez jedynego pisarza „tak".
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162500; zmiana - zamiast wpisu `newsletter` z treścią (a)
-- zgoda na pomiar z treścią i wersją pola pomiaru przez
-- `_email_measurement_grant` (kanał wg pochodzenia prośby).
-- CIALO-Z: 20261020162500
-- rpc-shape: newsletter_measurement_confirm (result, tenant_id, lang)
CREATE OR REPLACE FUNCTION public.newsletter_measurement_confirm(
  p_subscriber uuid, p_nonce uuid, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s public.newsletter_subscribers%ROWTYPE;
  v_r public.newsletter_measurement_requests%ROWTYPE;
  v_lang text;
  v_res text;
BEGIN
  IF p_subscriber IS NULL OR p_nonce IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.id = p_subscriber FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'gone');
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  SELECT * INTO v_r FROM public.newsletter_measurement_requests r
   WHERE r.subscriber_id = p_subscriber AND r.tenant_id = v_s.tenant_id AND r.nonce = p_nonce
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'invalid', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  IF v_r.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  IF v_s.status NOT IN ('subscribed', 'confirmed') THEN
    RETURN jsonb_build_object('result', 'inactive', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;

  UPDATE public.newsletter_measurement_requests r SET confirmed_at = now()
   WHERE r.subscriber_id = v_r.subscriber_id AND r.consent_version = v_r.consent_version;
  -- Zgoda na pomiar udzielona w międzyczasie (strona DOI, inny link) - link
  -- zużyty, bez drugiego wpisu (`already` z pisarza).
  v_res := public._email_measurement_grant(v_s.id, CASE WHEN v_r.origin = 'signup' THEN 'signup' ELSE 'reconfirm' END,
                                           p_ip, p_user_agent);
  IF v_res <> 'granted' THEN
    RETURN jsonb_build_object('result', v_res, 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  -- Kliknięcie w link z maila = zaangażowanie (wygaszanie Y1).
  PERFORM public._newsletter_engagement_touch(v_s.tenant_id, v_s.id, NULL, 'form', now());
  RETURN jsonb_build_object('result', 'confirmed', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) IS
  'Zgoda i pomiar (I9d-Y2b): link „Zgadzam się na pomiar" z prośby (nonce jednorazowy; podpis HMAC sprawdza serwer TS) - zgoda na pomiar przez _email_measurement_grant (kanał measurement:signup dla prośby po zapisie, measurement:reconfirm dla prośby z panelu; treść i wersja pola pomiaru, IP, UA), bez wpisu newsletter; znacznik zaangażowania. Wynik: confirmed | already | inactive | gone | invalid (+ tenant_id, lang). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- E) Kolejka z okresu (a): niewysłane prośby -> wersja treści pomiaru.
-- ----------------------------------------------------------------------------
-- Funkcja, nie anonimowy blok: pgTAP dowodzi reguły na fiksturze, a powtórka
-- migracji to 0 wierszy. Prośba wysłana albo potwierdzona zostaje (dowód).
CREATE OR REPLACE FUNCTION public._newsletter_measurement_requests_upgrade()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.newsletter_measurement_requests r
     SET consent_version = public._email_measurement_consent_version()
   WHERE r.consent_version = 'newsletter-2026-10-21' AND r.mailed_at IS NULL AND r.confirmed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.newsletter_measurement_requests r2
                      WHERE r2.subscriber_id = r.subscriber_id
                        AND r2.consent_version = public._email_measurement_consent_version());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_measurement_requests_upgrade() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_measurement_requests_upgrade() IS
  'Zgoda i pomiar (I9d-Y2b): niewysłane i niepotwierdzone prośby z wersją treści (a) newsletter-2026-10-21 -> wersja treści pomiaru (gdy subskrybent nie ma już prośby w tej wersji). Zwraca liczbę przepiętych; powtórka = 0. Wewnętrzna.';

SELECT public._newsletter_measurement_requests_upgrade();
