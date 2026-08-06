-- ============================================================================
-- FIX (P1): „Zapytanie do eksperta" - JEDNA generacja zamiast dwóch równoległych.
--
-- STAN ZASTANY. Ta funkcja żyła w repo w DWÓCH generacjach nazw, z których
-- klient wołał tę BEZ poprawek bezpieczeństwa:
--
--   generacja „inmail"  (wołana przez src/lib/chat/useExpertRequests.ts):
--     my_inmail_quota, send_expert_inmail, resolve_expert_inmail,
--     list_my_inmails, admin_list_inmails                → tabela expert_inmails
--   generacja „expert_request" (NIEwołana z UI):
--     my_expert_request_quota, send_expert_request, …     → tabela expert_requests
--
-- Poprawki bezpieczeństwa z 20260724090500 wylądowały WYŁĄCZNIE w generacji
-- nieużywanej, więc produkcja - czyli ścieżka klienta - została z dwiema dziurami:
--
--   (1) OBEJŚCIE PULI MIESIĘCZNEJ pętlą „wyślij → anuluj → wyślij". Licznik
--       liczył `status <> 'cancelled'`, a anulowanie jest dostępne nadawcy wprost
--       z UI (/profile/expert-requests, skrzynka „Wysłane"). Efekt: warstwa Plus
--       z pulą 2 wysyłała dowolnie wiele zapytań - limit sprzedawany w cenniku był
--       fikcją. NAPRAWA: pula liczy WSZYSTKIE wysłane w bieżącym miesiącu
--       kalendarzowym, niezależnie od późniejszego statusu (anulowanie jest
--       wycofaniem zapytania, nie zwrotem puli).
--   (2) WYŚCIG TOCTOU: count-check-insert bez blokady, więc dwa równoległe
--       wywołania przy pozostałej puli 1 wstawiały dwa rekordy. NAPRAWA:
--       pg_advisory_xact_lock per nadawca serializuje jego wysyłki (konwencja
--       repo: `gift:` w 20260724090600, `expert_request:` w 20260724090500).
--
-- (3) ROZJAZD ŚWIATÓW (42P01 na świeżej bazie). 20260723180000 robi
--     `ALTER TABLE expert_inmails RENAME TO expert_requests` i DROP-uje 5 funkcji
--     „inmail", ale późniejsze migracje (20260724115134, 20260724130000)
--     odtwarzają `send_expert_inmail` pod STARĄ nazwą tabeli. Produkcja tego nie
--     widzi, bo blok z RENAME siedzi w pliku o zdublowanej wersji i nigdy się nie
--     wykonał (patrz nagłówek 20260728212941). Na ŚWIEŻEJ bazie rename JEST
--     stosowany, więc: `send_expert_inmail` rzuca 42P01 przy wywołaniu, a cztery
--     pozostałe RPC klienta w ogóle nie istnieją (PGRST202). Cała funkcja jest
--     tam martwa - i pozostanie martwa w każdym nowym środowisku (CI e2e, staging,
--     kolejna instancja), dopóki oba światy nie zbiegną się do jednego kształtu.
--
-- DECYZJE TEJ MIGRACJI (żeby klasa błędu nie wróciła):
--
--   * JEDNA RELACJA FIZYCZNA: `public.expert_inmails`. Ta nazwa jest w produkcji
--     i w zrzucie typów (src/integrations/supabase/types.ts), więc zbieżność
--     osiągamy BEZ DDL na żywej tabeli - to świeża baza cofa rename. Nazwa
--     domenowa („expert request") żyje w API i UI; nazwa fizyczna to fakt
--     produkcyjny. Ewentualny rename tabeli na produkcji to osobna decyzja
--     operatora (wymaga regeneracji zrzutu typów) - poza zakresem naprawy.
--   * JEDNA IMPLEMENTACJA: logika mieszka w funkcjach o nazwach DOMENOWYCH
--     (`*_expert_request*`). Nazwy „inmail" zostają jako CIENKIE delegaty (jedno
--     `SELECT`), bo to je woła klient - dzięki temu wdrożenie nie jest sprzęgnięte
--     z deployem frontu, a obie generacje NIE MOGĄ się już rozjechać: nie ma
--     drugiego ciała, w którym dałoby się zapomnieć poprawki.
--   * PULA: kanoniczna jest LICZBA `membership_tiers.features.expert_request_quota`
--     (edytowalna per tenant w /admin/membership, pokazywana w cenniku). Dawne
--     flagi boolowskie `chat_inmail_quota_2/5` działają jako PODŁOGA
--     (GREATEST), więc żaden tenant nie traci puli już przyznanej - także taki,
--     którego progi nigdy nie dostały klucza liczbowego (0 = funkcja wyłączona).
--   * TENANT: wszystkie ścieżki (RPC + polityki RLS) wiążą wiersz z tenantem
--     domowym wołającego. Wcześniej `list_my_inmails`, `resolve_expert_inmail`
--     i polityki RLS ufały wyłącznie `sender_id`/`recipient_id`, więc konto po
--     dryfie tenanta (profil przepięty do B, wiersze w A) czytało i domykało
--     zapytania obszaru roboczego innej firmy.
--   * MASZYNA STANÓW: `cancel`/`decline`/`approve` wyłącznie z `pending`,
--     `answered` z `pending`/`approved`. Bez tego nadawca mógł anulować zapytanie
--     JUŻ zatwierdzone (z żywą konwersacją), a admin cofać status w tę i we w tę.
--   * ANTYSPAM per odbiorca (5 / 24 h) - inwariant z migracji założycielskiej
--     20260723090707, zgubiony po drodze; jedyny limit dla warstw „bezpośrednich"
--     (pula 100000). i18n ma dla niego komunikat od początku
--     (`expertRequest.error.rateLimit`).
--
-- Idempotentna. Bezpieczna dla obu światów: na produkcji nie rusza tabeli, tylko
-- podmienia ciała funkcji i polityki; na świeżej bazie dodatkowo cofa rename.
-- ============================================================================

-- ── 1) Zbieżność relacji fizycznej ──────────────────────────────────────────
-- Na produkcji tabela nazywa się `expert_inmails` (rename nigdy nie wjechał), na
-- świeżej bazie `expert_requests`. Po tym bloku w OBU światach jest dokładnie
-- jedna relacja: `expert_inmails` - i dopiero dzięki temu resztę migracji da się
-- napisać STATYCZNIE (bez dynamicznego SQL-a), czyli tak, żeby widziały ją bramki
-- CI analizujące treść migracji.
DO $expert_req$
DECLARE
  v_has_inmails  boolean;
  v_has_requests boolean;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = 'expert_inmails'),
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = 'expert_requests')
    INTO v_has_inmails, v_has_requests;

  IF v_has_inmails AND v_has_requests THEN
    -- Dwie tabele z danymi = scalenie wierszy, czyli decyzja operatora, nie
    -- migracji. Zatrzymujemy się GŁOŚNO, zamiast po cichu wybrać jedną.
    RAISE EXCEPTION
      'expert_request: istnieją OBIE tabele (expert_inmails i expert_requests) - scalenie danych wymaga decyzji operatora';
  END IF;

  IF NOT v_has_inmails AND NOT v_has_requests THEN
    RAISE EXCEPTION
      'expert_request: brak tabeli expert_inmails/expert_requests - łańcuch migracji jest przerwany';
  END IF;

  IF v_has_requests THEN
    ALTER TABLE public.expert_requests RENAME TO expert_inmails;
  END IF;
END $expert_req$;

-- Nazwy obiektów zależnych też muszą zbiec się do jednego kształtu - inaczej
-- każde późniejsze `DROP … IF EXISTS` trafiałoby tylko w jeden ze światów.
ALTER INDEX IF EXISTS expert_requests_tenant_idx    RENAME TO expert_inmails_tenant_idx;
ALTER INDEX IF EXISTS expert_requests_sender_idx    RENAME TO expert_inmails_sender_idx;
ALTER INDEX IF EXISTS expert_requests_recipient_idx RENAME TO expert_inmails_recipient_idx;
ALTER INDEX IF EXISTS expert_requests_status_idx    RENAME TO expert_inmails_status_idx;

-- Antyspam per odbiorca czyta (nadawca, odbiorca, czas) - bez tego indeksu
-- bramka 5/24 h skanuje wszystkie zapytania nadawcy.
CREATE INDEX IF NOT EXISTS expert_inmails_sender_recipient_idx
  ON public.expert_inmails (sender_id, recipient_id, created_at DESC);

-- Granty: klient CZYTA (pod RLS zawężonym do tenanta), ale NIE PISZE wprost.
-- Zapis przez Data API omijał maszynę stanów RPC: `PATCH {"status":"cancelled"}`
-- wycofywał zapytanie JUŻ zatwierdzone (z żywą konwersacją), a odbiorca mógł
-- postawić `answered` bez przejścia przez `approve`. Guard kolumnowy pilnuje
-- KOLUMN, nie PRZEJŚĆ - jedyną bramką przejść jest resolve_expert_request, więc
-- tabela przestaje przyjmować zapis od `authenticated`. Polityki UPDATE zostają
-- jako druga warstwa (gdyby grant kiedyś wrócił).
GRANT SELECT ON public.expert_inmails TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.expert_inmails FROM authenticated;
GRANT ALL ON public.expert_inmails TO service_role;
ALTER TABLE public.expert_inmails ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS expert_requests_set_updated_at ON public.expert_inmails;
DROP TRIGGER IF EXISTS expert_inmails_set_updated_at  ON public.expert_inmails;
CREATE TRIGGER expert_inmails_set_updated_at
  BEFORE UPDATE ON public.expert_inmails
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2) Polityki RLS: jeden kanoniczny zestaw, każda ścieżka wiąże tenanta ────
-- Zdejmujemy WSZYSTKIE nazwy historyczne z obu światów (42710 przy CREATE) -
-- polityki podróżują z tabelą, więc po rename siedzą już na `expert_inmails`.
DROP POLICY IF EXISTS "inmails: participants and admin can read"          ON public.expert_inmails;
DROP POLICY IF EXISTS "expert_requests: participants and admin can read"  ON public.expert_inmails;
DROP POLICY IF EXISTS "inmails: no direct insert"                         ON public.expert_inmails;
DROP POLICY IF EXISTS "expert_requests: no direct insert"                 ON public.expert_inmails;
DROP POLICY IF EXISTS "inmails: sender or admin may update"               ON public.expert_inmails;
DROP POLICY IF EXISTS "expert_requests: sender or admin may update"       ON public.expert_inmails;
DROP POLICY IF EXISTS "inmails: sender may cancel own request"            ON public.expert_inmails;
DROP POLICY IF EXISTS "inmails: recipient may respond"                    ON public.expert_inmails;
DROP POLICY IF EXISTS "inmails: admin may update"                         ON public.expert_inmails;
DROP POLICY IF EXISTS "expert_inmails: participants and admin may read"   ON public.expert_inmails;
DROP POLICY IF EXISTS "expert_inmails: no direct insert"                  ON public.expert_inmails;
DROP POLICY IF EXISTS "expert_inmails: sender may cancel own request"     ON public.expert_inmails;
DROP POLICY IF EXISTS "expert_inmails: recipient may respond"             ON public.expert_inmails;
DROP POLICY IF EXISTS "expert_inmails: admin may update"                  ON public.expert_inmails;

-- Odczyt: uczestnicy i admin, ale zawsze W GRANICACH tenanta domowego.
CREATE POLICY "expert_inmails: participants and admin may read"
  ON public.expert_inmails FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (sender_id = auth.uid() OR recipient_id = auth.uid()
         OR public.is_super_admin(auth.uid()))
  );

-- Zapis wyłącznie przez RPC (SECURITY DEFINER) - wstawka bezpośrednia zamknięta.
CREATE POLICY "expert_inmails: no direct insert"
  ON public.expert_inmails FOR INSERT TO authenticated WITH CHECK (false);

-- UPDATE rozbity na role (kolumny pilnuje trigger expert_inmails_guard_update
-- z 20260728212941 - RLS nie umie wyrazić „tylko te kolumny").
CREATE POLICY "expert_inmails: sender may cancel own request"
  ON public.expert_inmails FOR UPDATE TO authenticated
  USING      (tenant_id = current_tenant_id() AND sender_id = auth.uid())
  WITH CHECK (tenant_id = current_tenant_id() AND sender_id = auth.uid());

CREATE POLICY "expert_inmails: recipient may respond"
  ON public.expert_inmails FOR UPDATE TO authenticated
  USING      (tenant_id = current_tenant_id() AND recipient_id = auth.uid())
  WITH CHECK (tenant_id = current_tenant_id() AND recipient_id = auth.uid());

CREATE POLICY "expert_inmails: admin may update"
  ON public.expert_inmails FOR UPDATE TO authenticated
  USING      (tenant_id = current_tenant_id() AND public.is_super_admin(auth.uid()))
  WITH CHECK (tenant_id = current_tenant_id() AND public.is_super_admin(auth.uid()));

-- Guard kolumnowy (20260728212941) z JEDNĄ korektą: gałąź nadawcy zabraniała
-- ruszać `responded_at`, a wycofanie przez RPC właśnie ten stempel stawia -
-- „Wycofaj" w /profile/expert-requests kończyło się więc wyjątkiem, mimo że ta
-- sama zmiana statusu przez Data API przechodziła. Teraz stempel wolno postawić
-- WYŁĄCZNIE razem z przejściem na `cancelled`; pola wyniku (notatka admina,
-- powód odrzucenia, konwersacja, treść zapytania) zostają nietykalne.
CREATE OR REPLACE FUNCTION public.expert_inmails_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR public.is_super_admin(uid) THEN
    RETURN NEW;
  END IF;

  -- Kolumny tożsamości/własności są niezmienne dla każdego nie-admina.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expert_inmails: immutable columns cannot be changed';
  END IF;

  IF uid = OLD.recipient_id THEN
    -- Odbiorca decyduje o wyniku, ale nigdy nie pisze notatki admina.
    IF NEW.admin_note IS DISTINCT FROM OLD.admin_note THEN
      RAISE EXCEPTION 'expert_inmails: only admins can set admin_note';
    END IF;
    IF NEW.status NOT IN ('pending', 'approved', 'declined', 'answered') THEN
      RAISE EXCEPTION 'expert_inmails: invalid status transition for recipient';
    END IF;
    RETURN NEW;
  END IF;

  IF uid = OLD.sender_id THEN
    -- Nadawca może wyłącznie wycofać własne zapytanie.
    IF NEW.admin_note IS DISTINCT FROM OLD.admin_note
       OR NEW.decline_reason IS DISTINCT FROM OLD.decline_reason
       OR NEW.converted_conversation_id IS DISTINCT FROM OLD.converted_conversation_id
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.questions IS DISTINCT FROM OLD.questions
       OR NEW.expected_answers IS DISTINCT FROM OLD.expected_answers
       OR NEW.external_links IS DISTINCT FROM OLD.external_links THEN
      RAISE EXCEPTION 'expert_inmails: senders may only cancel their request';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'expert_inmails: senders may only cancel their request';
    END IF;
    -- Stempel rozstrzygnięcia tylko przy samym wycofaniu (nigdy „w powietrzu").
    IF NEW.responded_at IS DISTINCT FROM OLD.responded_at
       AND NOT (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') THEN
      RAISE EXCEPTION 'expert_inmails: senders may only cancel their request';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'expert_inmails: not allowed';
END;
$$;

-- Trigger zakładamy pod kanoniczną nazwą tabeli (na świeżej bazie
-- 20260728212941 założył go na `expert_requests`, więc podróżował z rename).
DROP TRIGGER IF EXISTS expert_inmails_guard_update ON public.expert_inmails;
CREATE TRIGGER expert_inmails_guard_update
  BEFORE UPDATE ON public.expert_inmails
  FOR EACH ROW EXECUTE FUNCTION public.expert_inmails_guard_update();

-- ── 3) Jedna implementacja: nazwy domenowe ──────────────────────────────────
-- DROP przed CREATE, bo w jednym świecie funkcje mają zwrotkę `SETOF
-- expert_requests`, w drugim nie istnieją wcale - `CREATE OR REPLACE` na taką
-- rozbieżność odpowiada „cannot change return type of existing function".
-- Wszystko w jednej transakcji migracji, więc klient nie widzi luki.
DROP FUNCTION IF EXISTS public.my_expert_request_quota();
DROP FUNCTION IF EXISTS public.send_expert_request(uuid, text, text, text[], text, text[]);
DROP FUNCTION IF EXISTS public.resolve_expert_request(uuid, text, text);
DROP FUNCTION IF EXISTS public.list_my_expert_requests(text);
DROP FUNCTION IF EXISTS public.admin_list_expert_requests(text, integer, integer);
DROP FUNCTION IF EXISTS public.my_inmail_quota();
DROP FUNCTION IF EXISTS public.send_expert_inmail(uuid, text, text, text[], text, text[]);
DROP FUNCTION IF EXISTS public.resolve_expert_inmail(uuid, text, text);
DROP FUNCTION IF EXISTS public.list_my_inmails(text);
DROP FUNCTION IF EXISTS public.admin_list_inmails(text, integer, integer);

-- 3a) Pula miesięczna - JEDNO źródło prawdy dla UI, bramki wysyłki i cennika.
CREATE OR REPLACE FUNCTION public.my_expert_request_quota()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_direct boolean := false;
  v_quota  integer := 0;
  v_legacy integer := 0;
  v_used   integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('quota', 0, 'used', 0, 'remaining', 0,
                              'unlimited', false, 'direct', false);
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('quota', 0, 'used', 0, 'remaining', 0,
                              'unlimited', false, 'direct', false);
  END IF;

  -- Rozstrzygnięcie po WSZYSTKICH aktywnych progach (nadania + subskrypcje)
  -- w tenancie domowym: najwyższa pula wygrywa.
  WITH keys AS (
    SELECT g.tier_key
      FROM public.membership_grants g
     WHERE g.user_id = v_uid AND g.tenant_id = v_tenant
       AND g.revoked_at IS NULL
       AND g.starts_at <= now()
       AND (g.expires_at IS NULL OR g.expires_at > now())
    UNION
    SELECT ap.tier_key
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
     WHERE us.user_id = v_uid AND us.tenant_id = v_tenant
       AND us.status::text IN ('active', 'trialing', 'past_due')
       AND ap.tier_key IS NOT NULL
  )
  SELECT
    COALESCE(bool_or(COALESCE((mt.features ->> 'chat_direct_gated')::boolean, false)), false),
    COALESCE(max(NULLIF(mt.features ->> 'expert_request_quota', '')::integer), 0),
    COALESCE(max(CASE
      WHEN COALESCE((mt.features ->> 'chat_inmail_quota_5')::boolean, false) THEN 5
      WHEN COALESCE((mt.features ->> 'chat_inmail_quota_2')::boolean, false) THEN 2
      ELSE 0
    END), 0)
  INTO v_direct, v_quota, v_legacy
  FROM keys k
  JOIN public.membership_tiers mt
    ON mt.tenant_id = v_tenant AND mt.key = k.tier_key;

  -- Klucz liczbowy jest kanoniczny; dawne flagi boolowskie są PODŁOGĄ, żeby
  -- ujednolicenie nie odebrało nikomu puli już przyznanej.
  v_quota := GREATEST(v_quota, v_legacy);

  -- Eksperci i administracja piszą wprost (relacja pozioma) - bez puli.
  IF public.is_super_admin(v_uid) OR public.is_expert_user(v_uid) THEN
    v_direct := true;
  END IF;

  -- (FIX 1) Pula liczy WSZYSTKIE wysłane w tym miesiącu, także anulowane -
  -- inaczej pętla „wyślij → anuluj → wyślij" zerowałaby licznik.
  SELECT count(*) INTO v_used
    FROM public.expert_inmails ei
   WHERE ei.sender_id = v_uid
     AND ei.tenant_id = v_tenant
     AND ei.created_at >= date_trunc('month', now());

  IF v_direct THEN
    RETURN jsonb_build_object('quota', 100000, 'used', v_used, 'remaining', 100000,
                              'unlimited', true, 'direct', true);
  END IF;

  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                            'remaining', GREATEST(v_quota - v_used, 0),
                            'unlimited', false, 'direct', false);
END $$;
REVOKE ALL ON FUNCTION public.my_expert_request_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_expert_request_quota() TO authenticated, service_role;
COMMENT ON FUNCTION public.my_expert_request_quota() IS
  'Miesięczna pula „Zapytań do eksperta" (quota/used/remaining/unlimited/direct) per tenant. Pula = GREATEST(features.expert_request_quota, dawne chat_inmail_quota_2/5); `used` liczy WSZYSTKIE wysłane w bieżącym miesiącu, także anulowane.';

-- 3b) Wysyłka: bramki + serializacja + pula.
CREATE OR REPLACE FUNCTION public.send_expert_request(
  p_recipient_id uuid,
  p_subject text,
  p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_tenant      uuid;
  v_peer_tenant uuid;
  v_new_id      uuid;
  v_link        text;
  v_q           jsonb;
  v_quota       integer;
  v_used        integer;
  v_recent      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'expert_request: authentication required';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_uid THEN
    RAISE EXCEPTION 'expert_request: invalid recipient';
  END IF;

  -- (FIX 2) Serializacja per nadawca: count-check-insert staje się atomowy.
  -- Kolizja hasha z innym nadawcą jest nieszkodliwa (chwilowa serializacja).
  PERFORM pg_advisory_xact_lock(hashtext('expert_request:' || v_uid::text));

  SELECT tenant_id INTO v_tenant      FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_recipient_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'expert_request: recipient not available';
  END IF;

  IF NOT public.is_gated_recipient(p_recipient_id) THEN
    RAISE EXCEPTION 'expert_request: recipient is not gated';
  END IF;

  -- Odbiorca wyłączył przyjmowanie zapytań (self opt-out, 20260724130000).
  IF NOT COALESCE(
       (SELECT p.expert_requests_enabled FROM public.profiles p WHERE p.id = p_recipient_id),
       true) THEN
    RAISE EXCEPTION 'expert_request: recipient not accepting requests';
  END IF;

  -- Funkcja wyłączona globalnie dla tenanta (site_settings.community_modules).
  IF NOT COALESCE(
       (SELECT (s.value ->> 'expert_requests_enabled')::boolean
          FROM public.site_settings s
         WHERE s.key = 'community_modules' AND s.tenant_id = v_tenant),
       true) THEN
    RAISE EXCEPTION 'expert_request: feature disabled';
  END IF;

  IF char_length(coalesce(p_subject, '')) < 5 OR char_length(coalesce(p_subject, '')) > 140 THEN
    RAISE EXCEPTION 'expert_request: subject length';
  END IF;
  IF char_length(coalesce(p_reason, '')) < 20 OR char_length(coalesce(p_reason, '')) > 2000 THEN
    RAISE EXCEPTION 'expert_request: reason length';
  END IF;
  IF p_questions IS NOT NULL AND array_length(p_questions, 1) > 5 THEN
    RAISE EXCEPTION 'expert_request: too many questions';
  END IF;
  IF p_external_links IS NOT NULL AND array_length(p_external_links, 1) > 3 THEN
    RAISE EXCEPTION 'expert_request: too many links';
  END IF;
  IF p_external_links IS NOT NULL THEN
    FOREACH v_link IN ARRAY p_external_links LOOP
      IF v_link !~* '^https?://' THEN
        RAISE EXCEPTION 'expert_request: invalid link';
      END IF;
    END LOOP;
  END IF;

  v_q     := public.my_expert_request_quota();
  v_quota := COALESCE((v_q ->> 'quota')::integer, 0);
  v_used  := COALESCE((v_q ->> 'used')::integer, 0);

  IF v_quota <= 0 THEN
    RAISE EXCEPTION 'expert_request: tier disabled';
  END IF;

  -- Pula miesięczna kalendarzowa (reset 1. dnia miesiąca).
  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'expert_request: monthly quota exceeded';
  END IF;

  -- Antyspam per odbiorca: także dla warstw „bezpośrednich" z pulą 100000.
  SELECT count(*) INTO v_recent
    FROM public.expert_inmails ei
   WHERE ei.sender_id = v_uid
     AND ei.recipient_id = p_recipient_id
     AND ei.created_at > now() - interval '24 hours';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'expert_request: rate limit';
  END IF;

  INSERT INTO public.expert_inmails
    (tenant_id, sender_id, recipient_id, subject, reason, questions,
     expected_answers, external_links)
  VALUES
    (v_tenant, v_uid, p_recipient_id, btrim(p_subject), btrim(p_reason),
     COALESCE(p_questions, ARRAY[]::text[]),
     NULLIF(btrim(coalesce(p_expected_answers, '')), ''),
     COALESCE(p_external_links, ARRAY[]::text[]))
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;
REVOKE ALL ON FUNCTION public.send_expert_request(uuid, text, text, text[], text, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_expert_request(uuid, text, text, text[], text, text[])
  TO authenticated;
COMMENT ON FUNCTION public.send_expert_request(uuid, text, text, text[], text, text[]) IS
  'Wysyła „Zapytanie do eksperta". Bramki: ten sam tenant, odbiorca ekspert/VIP z włączonym przyjmowaniem, moduł włączony w tenancie, walidacja treści, pula miesięczna (anulowane liczą się) i antyspam 5/24 h per odbiorca. Wysyłki jednego nadawcy serializuje pg_advisory_xact_lock.';

-- 3c) Rozstrzygnięcie zapytania (odbiorca / nadawca / admin) + maszyna stanów.
CREATE OR REPLACE FUNCTION public.resolve_expert_request(
  p_request_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_tenant   uuid;
  v_row      public.expert_inmails%ROWTYPE;
  v_is_admin boolean;
  v_key      text;
  v_conv     uuid;
  v_status   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'expert_request: authentication required';
  END IF;
  IF p_action NOT IN ('approve', 'decline', 'answered', 'cancel') THEN
    RAISE EXCEPTION 'expert_request: invalid action';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;

  SELECT * INTO v_row FROM public.expert_inmails WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expert_request: not found';
  END IF;

  -- Granica obszaru roboczego: SECURITY DEFINER omija RLS, więc tenant musi być
  -- sprawdzony W CIELE - inaczej konto po dryfie tenanta domyka cudze zapytania.
  IF v_tenant IS NULL OR v_row.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'expert_request: not found';
  END IF;

  v_is_admin := public.is_super_admin(v_uid);

  IF p_action = 'cancel' THEN
    IF v_uid <> v_row.sender_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'expert_request: forbidden';
    END IF;
    -- Wycofać można TYLKO zapytanie oczekujące. Anulowanie nie zwraca puli.
    IF v_row.status <> 'pending' THEN
      RAISE EXCEPTION 'expert_request: invalid status transition';
    END IF;
    -- Notatkę administracyjną pisze WYŁĄCZNIE admin (guard kolumnowy trzyma to
    -- także dla ścieżki Data API) - nadawca wycofuje bez notatki.
    UPDATE public.expert_inmails
       SET status = 'cancelled', responded_at = now(),
           admin_note = CASE WHEN v_is_admin THEN COALESCE(p_note, admin_note) ELSE admin_note END
     WHERE id = p_request_id;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  IF v_uid <> v_row.recipient_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'expert_request: forbidden';
  END IF;

  IF p_action = 'decline' THEN
    IF v_row.status <> 'pending' THEN
      RAISE EXCEPTION 'expert_request: invalid status transition';
    END IF;
    UPDATE public.expert_inmails
       SET status = 'declined', responded_at = now(),
           decline_reason = COALESCE(p_note, decline_reason)
     WHERE id = p_request_id;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  -- approve: z oczekującego; answered: z oczekującego albo już zatwierdzonego.
  IF p_action = 'approve' AND v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'expert_request: invalid status transition';
  END IF;
  IF p_action = 'answered' AND v_row.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'expert_request: invalid status transition';
  END IF;

  v_key := v_row.tenant_id::text || ':'
        || LEAST(v_row.sender_id, v_row.recipient_id)::text || ':'
        || GREATEST(v_row.sender_id, v_row.recipient_id)::text;

  SELECT id INTO v_conv FROM public.conversations WHERE direct_key = v_key;
  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (tenant_id, kind, direct_key, created_by)
    VALUES (v_row.tenant_id, 'direct', v_key, v_row.recipient_id)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO UPDATE SET updated_at = now()
    RETURNING id INTO v_conv;
    INSERT INTO public.conversation_participants (conversation_id, tenant_id, user_id)
    VALUES (v_conv, v_row.tenant_id, v_row.sender_id),
           (v_conv, v_row.tenant_id, v_row.recipient_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  v_status := CASE WHEN p_action = 'answered' THEN 'answered' ELSE 'approved' END;

  UPDATE public.expert_inmails
     SET status = v_status,
         responded_at = now(),
         admin_note = CASE WHEN v_is_admin THEN COALESCE(p_note, admin_note) ELSE admin_note END,
         converted_conversation_id = v_conv
   WHERE id = p_request_id;

  RETURN jsonb_build_object('status', v_status, 'conversation_id', v_conv);
END $$;
REVOKE ALL ON FUNCTION public.resolve_expert_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_expert_request(uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.resolve_expert_request(uuid, text, text) IS
  'Rozstrzyga „Zapytanie do eksperta" (approve/decline/answered/cancel) w granicach tenanta wołającego. Przejścia: cancel/decline/approve wyłącznie z pending, answered z pending/approved. Zatwierdzenie zakłada bezpośrednią konwersację.';

-- 3d) Skrzynki: własna (nadane/otrzymane) i administracyjna.
CREATE OR REPLACE FUNCTION public.list_my_expert_requests(p_box text DEFAULT 'received')
RETURNS SETOF public.expert_inmails
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT ei.*
    FROM public.expert_inmails ei
   WHERE ei.tenant_id = public.current_tenant_id()
     AND ((p_box = 'sent'     AND ei.sender_id    = auth.uid())
       OR (p_box = 'received' AND ei.recipient_id = auth.uid()))
   ORDER BY ei.created_at DESC
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.list_my_expert_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_expert_requests(text) TO authenticated;
COMMENT ON FUNCTION public.list_my_expert_requests(text) IS
  'Skrzynka „Zapytań do eksperta" zalogowanego użytkownika (p_box: sent|received), zawężona do jego tenanta domowego.';

CREATE OR REPLACE FUNCTION public.admin_list_expert_requests(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS SETOF public.expert_inmails
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'expert_request: forbidden';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'expert_request: forbidden';
  END IF;

  RETURN QUERY
    SELECT ei.*
      FROM public.expert_inmails ei
     WHERE ei.tenant_id = v_tenant
       AND (p_status IS NULL OR ei.status = p_status)
     ORDER BY ei.created_at DESC
     OFFSET GREATEST(p_offset, 0)
     LIMIT LEAST(GREATEST(p_limit, 1), 500);
END $$;
REVOKE ALL ON FUNCTION public.admin_list_expert_requests(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_expert_requests(text, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.admin_list_expert_requests(text, integer, integer) IS
  'Moderacja „Zapytań do eksperta" dla super admina, zawężona do jego tenanta domowego.';

-- ── 4) Nazwy „inmail": CIENKIE delegaty (kontrakt wywołań klienta) ───────────
-- Zero logiki, zero SECURITY DEFINER: cała autoryzacja i bramki zostają
-- w funkcjach domenowych. To jedyny sposób, żeby dwie generacje nazw NIE MOGŁY
-- się już rozjechać - nie ma drugiego ciała, w którym dałoby się zapomnieć
-- poprawki. Nazwy parametrów są celowo nietknięte: woła je klient
-- (src/lib/chat/useExpertRequests.ts) argumentami nazwanymi przez PostgREST.
CREATE OR REPLACE FUNCTION public.my_inmail_quota()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT public.my_expert_request_quota();
$$;
REVOKE ALL ON FUNCTION public.my_inmail_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_inmail_quota() TO authenticated, service_role;
COMMENT ON FUNCTION public.my_inmail_quota() IS
  'Delegat zgodności nazw → public.my_expert_request_quota(). Kontrakt wywołań klienta; logika mieszka w funkcji domenowej.';

CREATE OR REPLACE FUNCTION public.send_expert_inmail(
  p_recipient_id uuid,
  p_subject text,
  p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT public.send_expert_request(
    p_recipient_id, p_subject, p_reason, p_questions, p_expected_answers, p_external_links);
$$;
REVOKE ALL ON FUNCTION public.send_expert_inmail(uuid, text, text, text[], text, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_expert_inmail(uuid, text, text, text[], text, text[])
  TO authenticated;
COMMENT ON FUNCTION public.send_expert_inmail(uuid, text, text, text[], text, text[]) IS
  'Delegat zgodności nazw → public.send_expert_request(...). Kontrakt wywołań klienta; bramki i pula mieszkają w funkcji domenowej.';

CREATE OR REPLACE FUNCTION public.resolve_expert_inmail(
  p_inmail_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT public.resolve_expert_request(p_inmail_id, p_action, p_note);
$$;
REVOKE ALL ON FUNCTION public.resolve_expert_inmail(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_expert_inmail(uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.resolve_expert_inmail(uuid, text, text) IS
  'Delegat zgodności nazw → public.resolve_expert_request(...). Kontrakt wywołań klienta.';

CREATE OR REPLACE FUNCTION public.list_my_inmails(p_box text DEFAULT 'received')
RETURNS SETOF public.expert_inmails
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT * FROM public.list_my_expert_requests(p_box);
$$;
REVOKE ALL ON FUNCTION public.list_my_inmails(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_inmails(text) TO authenticated;
COMMENT ON FUNCTION public.list_my_inmails(text) IS
  'Delegat zgodności nazw → public.list_my_expert_requests(p_box). Kontrakt wywołań klienta.';

CREATE OR REPLACE FUNCTION public.admin_list_inmails(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS SETOF public.expert_inmails
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT * FROM public.admin_list_expert_requests(p_status, p_limit, p_offset);
$$;
REVOKE ALL ON FUNCTION public.admin_list_inmails(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_inmails(text, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.admin_list_inmails(text, integer, integer) IS
  'Delegat zgodności nazw → public.admin_list_expert_requests(...). Kontrakt wywołań klienta.';

COMMENT ON TABLE public.expert_inmails IS
  'Sformalizowane „Zapytania do eksperta" (nazwa fizyczna zastana z generacji „inMail"; nazwa domenowa: expert request). Zapis wyłącznie przez RPC send_expert_request/resolve_expert_request; RLS i RPC wiążą wiersz z tenantem domowym wołającego.';
