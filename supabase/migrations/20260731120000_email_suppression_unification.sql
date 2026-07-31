-- ============================================================================
-- Poczta wychodząca: JEDNA lista wykluczeń, JEDEN dren kolejki, runner ON.
--
-- PRZYCZYNA ŹRÓDŁOWA. Platforma miała DWIE niezależne listy wykluczeń:
--
--   * public.email_suppressions  (migracja 20260725120000) - kanoniczna:
--     tenant-scoped, 7 powodów, blokady trwałe i czasowe z eskalacją soft ->
--     hard, historia zdarzeń, zdejmowanie blokady, synchronizacja z listą
--     subskrybentów. Zasilana webhookiem dostarczalności Resend, czytana przez
--     wysyłkę kampanii.
--
--   * public.suppressed_emails   (migracja 20260728154925) - zaszłość:
--     bez tenanta, 3 powody, bez wygaśnięcia i bez odblokowania. Zasilana
--     endpointem /email/unsubscribe i webhookiem /lovable/email/suppression,
--     czytana przez wysyłkę transakcyjną i digesty.
--
-- Skutek był dokładnie odwrotny do zamierzonego: twarde odbicie zapisane przez
-- webhook Resend NIE zatrzymywało poczty transakcyjnej (ta patrzyła w drugą
-- tabelę), a wypis jednym kliknięciem NIE zatrzymywał kampanii (ta patrzyła w
-- pierwszą). Dwie połowicznie niewidome listy zamiast jednej higieny wysyłki -
-- czyli dokładnie ten sygnał, po którym Google i Microsoft obniżają reputację
-- domeny nadawczej (wytyczne dla nadawców masowych: wskaźnik zgłoszeń spamu
-- poniżej 0,30%, docelowo poniżej 0,10%, oraz natychmiastowe zaprzestanie
-- wysyłki na adresy, które zgłosiły spam albo trwale odbiły).
--
-- Ta migracja domyka trzy rzeczy:
--
--   1) Kanonizacja listy: rekordy zaszłości przenoszone do email_suppressions,
--      a nazwa `suppressed_emails` zostaje jako WIDOK zgodności (security
--      invoker + INSTEAD OF), którego zapisy przechodzą przez
--      email_record_suppression. Żadna ścieżka - także dopisana w przyszłości
--      przez generator - nie może już utworzyć drugiej listy.
--
--   2) Rozwiązywanie tenanta dla adresu bez kontekstu żądania
--      (email_resolve_tenant_for_address) - poczta transakcyjna i wypisy
--      działają na service_role, gdzie sesji użytkownika po prostu nie ma,
--      a lista wykluczeń jest tenant-scoped.
--
--   3) Runner zadań tła: DOMYŚLNIE WŁĄCZONY z adresem bazowym wyliczanym z
--      domeny tenanta domyślnego + telemetria ostatniego ticku i głębokość
--      kolejek pgmq. Wcześniej `enabled` startowało na false z pustym
--      base_url, więc świeże wdrożenie nie wysyłało NICZEGO w tle: ani
--      zaplanowanych kampanii, ani digestów, ani - po dodaniu drenu -
--      kolejki transakcyjnej. Kolejka rosła, a operator musiał odkryć
--      przełącznik w panelu, żeby poczta w ogóle wyszła.
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tenant dla adresu e-mail (bez kontekstu żądania)
--
-- Lista wykluczeń jest tenant-scoped, a wypis / webhook / mail transakcyjny
-- biegną na service_role, więc nie mają ani sesji, ani nagłówka hosta. Kolejność
-- rozstrzygania idzie od najpewniejszego sygnału do najsłabszego i NIGDY nie
-- zgaduje przy niejednoznaczności inaczej niż na tenanta domyślnego:
--
--   (a) jednoznaczny subskrybent newslettera z tym adresem,
--   (b) jednoznaczne konto (profiles) z tym adresem,
--   (c) tenant domyślny (tenants.is_default), a w instalacji jednotenantowej -
--       ten jedyny tenant.
--
-- Blokada na tenancie domyślnym jest bezpieczna: to zawsze zawężenie wysyłki,
-- nigdy jej rozszerzenie. Osobna funkcja (nie inline w triggerze), bo pytają o
-- to trzy różne ścieżki i chcemy jedną definicję zachowania.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_default_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT t.id FROM public.tenants t WHERE t.is_default LIMIT 1),
    (SELECT t.id FROM public.tenants t
      WHERE (SELECT count(*) FROM public.tenants) = 1 LIMIT 1)
  );
$fn$;

REVOKE ALL ON FUNCTION public.email_default_tenant_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_default_tenant_id() TO service_role;

CREATE OR REPLACE FUNCTION public.email_resolve_tenant_for_address(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_tenant uuid;
  v_count integer;
BEGIN
  IF v_email = '' THEN
    RETURN public.email_default_tenant_id();
  END IF;

  SELECT count(DISTINCT ns.tenant_id) INTO v_count
    FROM public.newsletter_subscribers ns
   WHERE lower(ns.email) = v_email;
  IF v_count = 1 THEN
    SELECT DISTINCT ns.tenant_id INTO v_tenant
      FROM public.newsletter_subscribers ns
     WHERE lower(ns.email) = v_email;
    RETURN v_tenant;
  END IF;

  SELECT count(DISTINCT p.tenant_id) INTO v_count
    FROM public.profiles p
   WHERE lower(p.email) = v_email AND p.tenant_id IS NOT NULL;
  IF v_count = 1 THEN
    SELECT DISTINCT p.tenant_id INTO v_tenant
      FROM public.profiles p
     WHERE lower(p.email) = v_email AND p.tenant_id IS NOT NULL;
    RETURN v_tenant;
  END IF;

  RETURN public.email_default_tenant_id();
END;
$fn$;

COMMENT ON FUNCTION public.email_resolve_tenant_for_address(text) IS
  'Tenant dla adresu e-mail poza kontekstem żądania (wypis, webhook, mail transakcyjny): jednoznaczny subskrybent -> jednoznaczne konto -> tenant domyślny.';

REVOKE ALL ON FUNCTION public.email_resolve_tenant_for_address(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_resolve_tenant_for_address(text) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Przeniesienie zaszłości do listy kanonicznej
--
-- Mapowanie powodów: 3-wartościowa domena starej tabeli jest podzbiorem nowej
-- ('bounce' bez klasy odbicia traktujemy jak twarde - stara tabela nie miała
-- wygaśnięcia, więc taki wpis ZAWSZE blokował bezterminowo i tak też musi
-- zachowywać się po migracji; osłabienie do soft_bounce cicho odblokowałoby
-- adresy, które przez lata były wykluczone).
--
-- Powaga blokady nigdy nie spada: gdy adres jest już na liście kanonicznej z
-- mocniejszym powodem, wpis zaszłości go nie nadpisuje (DO NOTHING).
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE
  v_moved integer := 0;
BEGIN
  IF to_regclass('public.suppressed_emails') IS NULL THEN
    RAISE NOTICE 'suppressed_emails nie istnieje - nie ma czego przenosić.';
    RETURN;
  END IF;
  -- Po ponownym uruchomieniu migracji `suppressed_emails` jest już WIDOKIEM na
  -- listę kanoniczną; przenoszenie z widoku do jego własnej tabeli źródłowej
  -- byłoby bez sensu (i bez skutku).
  IF (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.suppressed_emails'::regclass) <> 'r' THEN
    RAISE NOTICE 'suppressed_emails jest już widokiem zgodności - przenoszenie pominięte.';
    RETURN;
  END IF;

  INSERT INTO public.email_suppressions (
    tenant_id, email, reason, scope, source, provider, diagnostic,
    first_seen_at, last_seen_at, meta
  )
  SELECT
    public.email_resolve_tenant_for_address(se.email),
    lower(btrim(se.email)),
    CASE se.reason
      WHEN 'complaint'   THEN 'complaint'
      WHEN 'bounce'      THEN 'hard_bounce'
      WHEN 'unsubscribe' THEN 'unsubscribe'
      ELSE 'manual'
    END,
    'permanent',
    'import',
    'resend',
    'migracja 20260731120000: przeniesienie z suppressed_emails',
    se.created_at,
    se.created_at,
    jsonb_build_object('legacy_table', 'suppressed_emails', 'legacy_reason', se.reason)
      || COALESCE(se.metadata, '{}'::jsonb)
  FROM public.suppressed_emails se
  WHERE lower(btrim(se.email)) <> ''
    AND position('@' in se.email) > 0
    AND public.email_resolve_tenant_for_address(se.email) IS NOT NULL
  ON CONFLICT (tenant_id, email_norm) DO NOTHING;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'Przeniesiono % adresów z suppressed_emails do email_suppressions.', v_moved;

  -- Kopia bezpieczeństwa surowych wierszy: mapowanie powodów jest jednostronne
  -- (3 -> 7 wartości), więc oryginał zostaje do audytu, dopóki operator go nie
  -- usunie. Tabela jest service-role-only i nikt jej nie czyta w kodzie.
  EXECUTE 'CREATE TABLE IF NOT EXISTS public.suppressed_emails_legacy_backup
             AS TABLE public.suppressed_emails';
  EXECUTE 'ALTER TABLE public.suppressed_emails_legacy_backup ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON public.suppressed_emails_legacy_backup FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT ALL ON public.suppressed_emails_legacy_backup TO service_role';
  EXECUTE 'DROP TABLE public.suppressed_emails';
END $mig$;

COMMENT ON TABLE public.email_suppressions IS
  'JEDYNA lista adresów wykluczonych z wysyłki (bounce/complaint/unsubscribe/manual), wspólna dla kampanii, poczty transakcyjnej, digestów i wypisów. Aktywna blokada = released_at IS NULL AND (expires_at IS NULL OR expires_at > now()).';

-- ----------------------------------------------------------------------------
-- 3) Widok zgodności `suppressed_emails`
--
-- Nazwa zostaje, ale jest już tylko cienką projekcją listy kanonicznej:
--   * odczyt pokazuje wyłącznie AKTYWNE blokady (wygasłe i zdjęte przestają
--     blokować - stara tabela tego nie umiała),
--   * zapis idzie przez email_record_suppression, więc dziedziczy eskalację,
--     pierwszeństwo powagi i synchronizację z listą subskrybentów,
--   * DELETE odblokowuje (released_at), zamiast fizycznie usuwać ślad.
--
-- security_invoker = true jest tu WARUNKIEM BEZPIECZEŃSTWA, nie stylem: bez
-- niego widok czytałby dane jako właściciel i obszedłby RLS tabeli źródłowej,
-- czyli wystawiłby adresy (PII) wszystkich tenantów każdemu zalogowanemu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.suppressed_emails
  WITH (security_invoker = true) AS
  SELECT
    es.id,
    es.email_norm AS email,
    -- Domena zaszłości ma 3 wartości; mapujemy w tę stronę bezstratnie dla
    -- konsumentów, którzy pytają tylko "czy wolno wysłać".
    CASE
      WHEN es.reason = 'complaint' THEN 'complaint'
      WHEN es.reason = 'unsubscribe' THEN 'unsubscribe'
      ELSE 'bounce'
    END AS reason,
    es.meta AS metadata,
    es.created_at
  FROM public.email_suppressions es
  WHERE es.released_at IS NULL
    AND (es.expires_at IS NULL OR es.expires_at > now());

COMMENT ON VIEW public.suppressed_emails IS
  'PRZESTARZAŁE - widok zgodności nad public.email_suppressions (migracja 20260731120000). Nowy kod używa email_suppressions / email_record_suppression / email_filter_suppressed. Widok pokazuje wyłącznie aktywne blokady, a zapisy przechodzą przez email_record_suppression.';

REVOKE ALL ON public.suppressed_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppressed_emails TO service_role;

CREATE OR REPLACE FUNCTION public.tg_suppressed_emails_compat_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email text;
  v_reason text;
  v_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Odblokowanie zamiast usunięcia: historia blokady jest materiałem
    -- dowodowym przy sporze o zgodę marketingową.
    UPDATE public.email_suppressions
       SET released_at = now(), expires_at = now()
     WHERE email_norm = lower(btrim(OLD.email))
       AND released_at IS NULL;
    RETURN OLD;
  END IF;

  v_email := lower(btrim(COALESCE(NEW.email, '')));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  v_reason := CASE COALESCE(NEW.reason, 'bounce')
    WHEN 'bounce'      THEN 'hard_bounce'
    WHEN 'complaint'   THEN 'complaint'
    WHEN 'unsubscribe' THEN 'unsubscribe'
    ELSE 'manual'
  END;

  v_tenant := public.email_resolve_tenant_for_address(v_email);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no_tenant_for_address' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.email_record_suppression(
    p_tenant => v_tenant,
    p_email => v_email,
    p_reason => v_reason,
    p_source => 'system',
    p_provider => 'compat',
    p_meta => jsonb_build_object('via', 'suppressed_emails_view')
              || COALESCE(NEW.metadata, '{}'::jsonb)
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS suppressed_emails_compat_insert ON public.suppressed_emails;
CREATE TRIGGER suppressed_emails_compat_insert
  INSTEAD OF INSERT ON public.suppressed_emails
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppressed_emails_compat_write();

DROP TRIGGER IF EXISTS suppressed_emails_compat_update ON public.suppressed_emails;
CREATE TRIGGER suppressed_emails_compat_update
  INSTEAD OF UPDATE ON public.suppressed_emails
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppressed_emails_compat_write();

DROP TRIGGER IF EXISTS suppressed_emails_compat_delete ON public.suppressed_emails;
CREATE TRIGGER suppressed_emails_compat_delete
  INSTEAD OF DELETE ON public.suppressed_emails
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppressed_emails_compat_write();

-- ----------------------------------------------------------------------------
-- 4) Wypis z listy: jedna operacja domykająca oba światy
--
-- Wypis MUSI zrobić dwie rzeczy naraz: postawić blokadę na liście kanonicznej
-- (żeby zamilkła też poczta transakcyjna marketingowa i digesty) oraz zdjąć
-- subskrypcję newslettera. Trigger tg_email_suppression_sync_subscriber robi
-- drugie po pierwszym, ale wypis zna też token, więc oznaczamy go jako użyty w
-- tej samej transakcji - inaczej ponowne kliknięcie w link z maila
-- wyglądałoby jak nowy wypis.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_unsubscribe_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_email text;
  v_tenant uuid;
  v_claimed boolean := false;
BEGIN
  IF v_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_token');
  END IF;

  -- (a) Token globalny poczty systemowej (email_unsubscribe_tokens).
  UPDATE public.email_unsubscribe_tokens
     SET used_at = now()
   WHERE token = v_token AND used_at IS NULL
   RETURNING lower(btrim(email)) INTO v_email;
  v_claimed := v_email IS NOT NULL;

  IF NOT v_claimed THEN
    -- Token już zużyty: adres nadal wypisujemy (idempotencja), ale mówimy o tym
    -- wywołującemu, żeby UI pokazało "już wypisany" zamiast "wypisano".
    SELECT lower(btrim(email)) INTO v_email
      FROM public.email_unsubscribe_tokens WHERE token = v_token;
  END IF;

  -- (b) Token per subskrybent newslettera (kampanie, RFC 8058 one-click).
  IF v_email IS NULL THEN
    SELECT lower(btrim(ns.email)), ns.tenant_id INTO v_email, v_tenant
      FROM public.newsletter_subscribers ns
     WHERE ns.unsubscribe_token = v_token
     LIMIT 1;
    v_claimed := v_email IS NOT NULL;
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_token');
  END IF;

  v_tenant := COALESCE(v_tenant, public.email_resolve_tenant_for_address(v_email));
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tenant');
  END IF;

  PERFORM public.email_record_suppression(
    p_tenant => v_tenant,
    p_email => v_email,
    p_reason => 'unsubscribe',
    p_source => 'system',
    p_provider => 'self_service',
    p_meta => jsonb_build_object('channel', 'unsubscribe_link')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_unsubscribed', NOT v_claimed,
    'tenant_id', v_tenant);
END;
$fn$;

COMMENT ON FUNCTION public.email_unsubscribe_by_token(text) IS
  'Wypis jednym kliknięciem: zużywa token (globalny lub per subskrybent), stawia blokadę unsubscribe na liście kanonicznej i - przez trigger - zdejmuje subskrypcję. Idempotentny.';

REVOKE ALL ON FUNCTION public.email_unsubscribe_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe_by_token(text) TO service_role;

-- ----------------------------------------------------------------------------
-- 5) Runner zadań tła: domyślnie włączony + telemetria
--
-- Wysyłka w tle (zaplanowane kampanie, digesty, push, dren kolejki
-- transakcyjnej) jest domyślnym oczekiwanym zachowaniem platformy pocztowej,
-- nie funkcją opcjonalną: kolejka bez drenu nie "czeka", ona po cichu
-- przekracza TTL i wiadomości lądują w DLQ. Przełącznik zostaje jako
-- kill switch, ale startuje w pozycji "włączone".
-- ----------------------------------------------------------------------------
ALTER TABLE public.job_runner_settings ALTER COLUMN enabled SET DEFAULT true;

ALTER TABLE public.job_runner_settings
  ADD COLUMN IF NOT EXISTS last_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_tick_status text,
  ADD COLUMN IF NOT EXISTS last_tick_error text,
  ADD COLUMN IF NOT EXISTS tick_count bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.job_runner_settings.enabled IS
  'Kill switch runnera zadań tła. Domyślnie WŁĄCZONY - dren kolejki pocztowej i wysyłka zaplanowana nie mogą zależeć od ręcznego przełączenia.';
COMMENT ON COLUMN public.job_runner_settings.base_url IS
  'Nadpisanie publicznego adresu aplikacji. Puste = wyliczany z domeny tenanta domyślnego (job_runner_base_url()).';
COMMENT ON COLUMN public.job_runner_settings.last_tick_at IS
  'Moment ostatniego ticku wysłanego przez cron - dowód, że automat żyje.';

-- Wiersz singletona istnieje od migracji 20260713170000 z enabled=false.
-- Włączamy go TYLKO gdy nikt go nie konfigurował (pusty base_url): operator,
-- który świadomie wyłączył skonfigurowany runner, ma base_url ustawiony i jego
-- decyzji nie ruszamy.
UPDATE public.job_runner_settings
   SET enabled = true
 WHERE id = 1
   AND enabled = false
   AND COALESCE(btrim(base_url), '') = '';

INSERT INTO public.job_runner_settings (id, enabled) VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

-- Adres bazowy: konfiguracja ma pierwszeństwo, a gdy jej nie ma - domena
-- tenanta domyślnego. Dzięki temu świeże wdrożenie z ustawioną domeną tickuje
-- bez ŻADNEJ konfiguracji, a wdrożenie bez domeny nadal da się skonfigurować
-- ręcznie w panelu.
CREATE OR REPLACE FUNCTION public.job_runner_base_url()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    NULLIF(btrim((SELECT s.base_url FROM public.job_runner_settings s WHERE s.id = 1)), ''),
    (SELECT 'https://' || t.domain
       FROM public.tenants t
      WHERE t.is_default AND COALESCE(btrim(t.domain), '') <> ''
      LIMIT 1),
    (SELECT 'https://' || t.domain
       FROM public.tenants t
      WHERE COALESCE(btrim(t.domain), '') <> ''
        AND (SELECT count(*) FROM public.tenants) = 1
      LIMIT 1)
  );
$fn$;

REVOKE ALL ON FUNCTION public.job_runner_base_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_runner_base_url() TO service_role;

-- Tick HTTP: adres z job_runner_base_url() + zapis telemetrii. Nadal
-- best-effort (błąd nie może wywalić crona), ale teraz KAŻDA próba pozostawia
-- ślad - "cisza w kolejce" przestaje być nierozstrzygalna między "cron nie
-- biegnie" i "cron biegnie, ale endpoint odrzuca".
CREATE OR REPLACE FUNCTION public.invoke_jobs_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cfg record;
  v_url text;
BEGIN
  SELECT enabled, secret INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled THEN
    RETURN;
  END IF;

  v_url := public.job_runner_base_url();
  IF COALESCE(btrim(v_url), '') = '' THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(),
           last_tick_status = 'skipped',
           last_tick_error = 'no_base_url'
     WHERE id = 1;
    RETURN;
  END IF;

  -- pg_net może nie istnieć (środowiska bez rozszerzenia) - fail-open.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(),
           last_tick_status = 'skipped',
           last_tick_error = 'pg_net_unavailable'
     WHERE id = 1;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/api/public/jobs-tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jobs-secret', cfg.secret
    ),
    timeout_milliseconds := 25000
  );

  UPDATE public.job_runner_settings
     SET last_tick_at = now(),
         last_tick_status = 'dispatched',
         last_tick_error = NULL,
         tick_count = tick_count + 1
   WHERE id = 1;
EXCEPTION WHEN OTHERS THEN
  -- Tick jest best-effort; błąd HTTP/konfiguracji nie może wysypać crona, ale
  -- musi być widoczny w panelu.
  BEGIN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(),
           last_tick_status = 'error',
           last_tick_error = left(SQLERRM, 500)
     WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_jobs_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_jobs_tick() TO service_role;

-- Harmonogram jest tworzony przez migrację 20260713170000; powtarzamy go tutaj,
-- bo `cron.schedule` nadpisuje job o tej samej nazwie i wdrożenie, które
-- zgubiło zadanie (restore bazy, przeinstalowanie pg_cron), samo je odtworzy.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostępny - jobs-tick nie zostanie zaplanowany.';
    RETURN;
  END IF;
  PERFORM cron.schedule('jobs-tick', '* * * * *', 'SELECT public.invoke_jobs_tick()');
END $$;

-- ----------------------------------------------------------------------------
-- 6) Głębokość kolejek pocztowych (obserwowalność drenu)
--
-- Panel admina musi umieć odpowiedzieć na pytanie "czy poczta wychodzi?"
-- inaczej niż przez zgadywanie. Rosnąca długość kolejki przy żywym ticku =
-- dren pada; długość zero przy pustym logu = nikt nic nie nadał.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_queue_depth()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_queue text;
  v_len bigint;
BEGIN
  IF to_regnamespace('pgmq') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pgmq_unavailable');
  END IF;
  FOREACH v_queue IN ARRAY ARRAY[
    'auth_emails', 'transactional_emails', 'auth_emails_dlq', 'transactional_emails_dlq'
  ] LOOP
    BEGIN
      SELECT m.queue_length INTO v_len FROM pgmq.metrics(v_queue) m;
      v_out := v_out || jsonb_build_object(v_queue, COALESCE(v_len, 0));
    EXCEPTION WHEN OTHERS THEN
      -- Kolejka może nie istnieć (świeża baza) - zero jest poprawną odpowiedzią.
      v_out := v_out || jsonb_build_object(v_queue, 0);
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'queues', v_out);
END;
$fn$;

REVOKE ALL ON FUNCTION public.email_queue_depth() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_depth() TO service_role;

-- ----------------------------------------------------------------------------
-- 7) Log wysyłek: indeks pod gorące zapytania drenu
--
-- Dren pyta o dwie rzeczy dla każdej porcji: „czy ta wiadomość ma już wiersz
-- 'sent'" (ochrona przed podwójną wysyłką po wygaśnięciu VT) i „ile razy
-- naprawdę nie udało się jej wysłać" (budżet ponowień). Oba zapytania filtrują
-- po (message_id, status), a log rośnie o kilka wierszy na wiadomość.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS email_send_log_message_status_idx
  ON public.email_send_log (message_id, status);
