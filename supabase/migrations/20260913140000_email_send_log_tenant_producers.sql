-- ============================================================================
-- email_send_log: DRUGA LINIA OBRONY DLA NAJEMCY WIERSZA (trigger + backfill)
-- ============================================================================
--
-- PO CO TA MIGRACJA.
--
-- Migracja 20260913101000 dała dziennikowi kolumnę `tenant_id` (bez DEFAULT,
-- bez triggera), zrobiła jednorazowy backfill ZASTANYCH wierszy i zapowiedziała
-- etap (ii): „ścieżki zapisu zaczynają kolumnę wypełniać przy insercie".
-- Równolegle raport poczty systemowej (`fetchSystemEmailReport`) zaczął filtrować
-- dziennik RÓWNOŚCIOWO po tej kolumnie. Dopóki etap (ii) nie jest domknięty,
-- te dwie rzeczy dają razem panel, który pokazuje wyłącznie ZAMROŻONĄ HISTORIĘ:
-- każdy wiersz powstały po wdrożeniu - pending, sent, failed, suppressed, dlq -
-- ma `tenant_id IS NULL` i nie spełnia predykatu dla ŻADNEGO najemcy. Operator
-- traci diagnostykę poczty dokładnie w dniu, w którym zaczyna być potrzebna.
--
-- Aplikacja domyka to w swoich dwóch modułach: `transactional.server.ts`
-- (pięć wstawek) i `queueDrain.server.ts` (`logSend`, jedna wstawka na pięciu
-- ścieżkach wyniku) zapisują teraz najemcę, którego JUŻ ZNAJĄ - tego samego,
-- w którego kontekście przeszła brama listy wykluczeń, który jedzie w ładunku
-- kolejki i którym tagowana jest wysyłka u dostawcy.
--
-- Zostają jednak producenci, którzy najemcy NIE ZNAJĄ ANI TROCHĘ:
--   * `/platform/email/auth/webhook` - hook Supabase Auth. Przy rejestracji
--     profilu jeszcze nie ma, a jedyna wskazówka (`redirect_to`) jest wejściem
--     z zewnątrz, więc byłaby WSKAZÓWKĄ wymagającą mapowania na `tenants.domain`,
--     nigdy autoryzacją (decyzja zapisana w 20260913101000, punkt 3);
--   * `/platform/email/transactional/send` - siedem wstawek na ścieżce, która
--     woła bramę wykluczeń BEZ podanego najemcy.
-- Dla nich jedyną obroną jest baza. Trigger BEFORE INSERT rozstrzyga najemcę
-- z adresu odbiorcy - i robi to także wtedy, gdy jutro ktoś dopisze ósmego
-- producenta i zapomni o kolumnie. Warstwa aplikacji jest tu optymalizacją
-- i źródłem lepszej odpowiedzi; warstwa bazy jest gwarancją.
--
-- CZY RAPORT MA POKAZYWAĆ WIERSZE Z `tenant_id IS NULL`. NIE - i to jest
-- rozstrzygnięcie, nie przeoczenie. Argument za pokazywaniem („inaczej operator
-- traci diagnostykę") przestaje obowiązywać dokładnie dlatego, że ta migracja
-- istnieje: po niej wiersz bez najemcy to nie „zwykły nowy wiersz", tylko adres,
-- którego NIE MA w żadnym `newsletter_subscribers` ani `profiles` albo który
-- siedzi w DWÓCH organizacjach naraz. Pokazanie go komukolwiek znaczy pokazanie
-- cudzego adresu e-mail adminowi, który nie ma do niego prawa - a przy adresie
-- obecnym w dwóch organizacjach pokazanie go OBU. `OR tenant_id IS NULL`
-- w filtrze albo w polityce byłoby więc furtką „wiersz bez najemcy widzi każdy",
-- czyli tą samą klasą dziury, którą 20260913101000 zamyka. Ślad nie ginie:
-- czyta go `service_role` i dren kolejki. Fail closed, nie „pokaż wszystkim".

-- ----------------------------------------------------------------------------
-- 1. Rozstrzyganie najemcy z adresu odbiorcy - JEDNA definicja kaskady.
--
-- PO CO OSOBNA FUNKCJA, a nie ciało triggera: tej samej kaskady potrzebuje
-- trigger (wiersze nowe) ORAZ backfill z punktu 3 (wiersze dopisane między
-- 20260913101000 a tą migracją). Gdyby logika żyła w dwóch miejscach, rozjechałyby
-- się przy pierwszej korekcie - a rozjazd tutaj znaczy „część wierszy w złym
-- najemcy". Ten sam wzorzec i to samo uzasadnienie co
-- `payment_webhook_event_tenant` w 20260913100000.
--
-- DLACZEGO NIE `email_resolve_tenant_for_address()`. PUŁAPKA opisana w tamtej
-- migracji: ten resolver NIGDY nie zwraca NULL - przy braku rozstrzygnięcia
-- oddaje najemcę DOMYŚLNEGO (20260731120000:97 i :119). W triggerze dziennika
-- znaczyłoby to, że każdy nierozstrzygalny adres - w tym każdy jednorazowy
-- odbiorca formularza kontaktowego i każdy adres obecny w dwóch organizacjach -
-- ląduje na własność admina najemcy domyślnego. Ten sam wyciek wróciłby
-- „legalnie, zgodnie z RLS", tyle że w jedną stronę. Dlatego kaskada kończy się
-- na NULL-u, dokładnie tak jak backfill w 20260913101000.
--
-- KASKADA: (a) jednoznaczny subskrybent newslettera, (b) jednoznaczne konto
-- w `profiles`, (c) NULL. „Jednoznaczny" znaczy `count(DISTINCT tenant_id) = 1`:
-- adres obecny w dwóch organizacjach nie daje odpowiedzi, więc nie udajemy, że
-- daje. Kolejność (a) przed (b) odwzorowuje gałęzie resolvera - dziennik poczty
-- jest w przeważającej części ruchem newsletterowym.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_send_log_tenant_for_address(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_tenant uuid;
  v_count integer;
BEGIN
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  -- (a) jednoznaczny subskrybent newslettera
  SELECT count(DISTINCT ns.tenant_id) INTO v_count
    FROM public.newsletter_subscribers ns
   WHERE lower(btrim(ns.email)) = v_email;
  IF v_count = 1 THEN
    SELECT DISTINCT ns.tenant_id INTO v_tenant
      FROM public.newsletter_subscribers ns
     WHERE lower(btrim(ns.email)) = v_email;
    RETURN v_tenant;
  END IF;

  -- (b) jednoznaczne konto
  SELECT count(DISTINCT p.tenant_id) INTO v_count
    FROM public.profiles p
   WHERE lower(btrim(p.email)) = v_email AND p.tenant_id IS NOT NULL;
  IF v_count = 1 THEN
    SELECT DISTINCT p.tenant_id INTO v_tenant
      FROM public.profiles p
     WHERE lower(btrim(p.email)) = v_email AND p.tenant_id IS NOT NULL;
    RETURN v_tenant;
  END IF;

  -- (c) nie wiadomo. NULL, a NIE najemca domyślny - patrz nagłówek.
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.email_send_log_tenant_for_address(text) IS
  'Najemca wiersza dziennika poczty rozstrzygnięty z adresu odbiorcy: jednoznaczny subskrybent -> jednoznaczne konto -> NULL. Świadomie BEZ fallbacku na najemcę domyślnego (inaczej nierozstrzygalne adresy stałyby się własnością admina tenanta domyślnego).';

REVOKE ALL ON FUNCTION public.email_send_log_tenant_for_address(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_send_log_tenant_for_address(text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Trigger wiążący - wyłącznie dla wierszy, które przyszły BEZ najemcy.
--
-- Kaskada rusza WYŁĄCZNIE przy `NEW.tenant_id IS NULL`: producent, który najemcę
-- ZNA, ma pierwszeństwo i nie płaci za dwa zapytania. Jego odpowiedź jest przy tym
-- LEPSZA od kaskady - webhook płatności zna najemcę wprost z subskrypcji,
-- a kaskada zgaduje po adresie, który może należeć do dwóch organizacji.
-- Trigger ma domykać lukę, a nie nadpisywać wiedzę.
--
-- TYLKO `BEFORE INSERT`. Wiersz dziennika jest niezmienny z założenia: kolejne
-- stany tej samej wiadomości to kolejne WIERSZE o tym samym `message_id`
-- (`pending` -> `sent`/`dlq`), a nie UPDATE. Trigger na UPDATE byłby martwym
-- kodem, który przy pierwszej korekcie schematu zacząłby przewiązywać wiersze
-- bez niczyjej intencji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_email_send_log_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.email_send_log_tenant_for_address(NEW.recipient_email);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS email_send_log_bind_tenant ON public.email_send_log;
CREATE TRIGGER email_send_log_bind_tenant
  BEFORE INSERT ON public.email_send_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_email_send_log_bind_tenant();

-- ----------------------------------------------------------------------------
-- 3. Backfill ogona - wiersze dopisane MIĘDZY 20260913101000 a tą migracją.
--
-- Backfill tamtej migracji był jednorazowy i objął wyłącznie wiersze ZASTANE.
-- Wdrożenie nie jest atomowe: między jedną migracją a drugą dziennik rósł dalej,
-- a producenci pisali bez kolumny. Bez tego kroku zostałaby dziura w historii
-- panelu - tym bardziej myląca, że wąska i niedatowana.
--
-- Ten sam UPDATE jest też siatką bezpieczeństwa dla samego siebie: jest
-- idempotentny (rusza wyłącznie `tenant_id IS NULL`) i używa TEJ SAMEJ funkcji
-- co trigger, więc nie ma wersji „backfillowej" i „triggerowej" kaskady.
--
-- Wiersze, których kaskada nie rozstrzygnie, zostają z NULL-em - świadomie,
-- z uzasadnieniem z nagłówka. Nie ma tu najemcy, któremu WOLNO je pokazać.
-- ----------------------------------------------------------------------------
WITH resolved AS (
  SELECT l.id,
         public.email_send_log_tenant_for_address(l.recipient_email) AS tenant_id
    FROM public.email_send_log l
   WHERE l.tenant_id IS NULL
)
UPDATE public.email_send_log AS l
   SET tenant_id = r.tenant_id
  FROM resolved r
 WHERE r.id = l.id
   AND r.tenant_id IS NOT NULL;

-- `auth_email_events` NIE MA surowego adresu (tylko `recipient_masked`
-- i `recipient_domain`), więc kaskada po adresie jest tam niemożliwa z definicji.
-- Jedyne uczciwe źródło to `message_id` wspólny z dziennikiem wysyłek - który
-- właśnie dostał najemcę wyżej. Powtórzenie tego kroku po backfillu ogona jest
-- konieczne: wiersz dziennika związany dopiero teraz nie miał czym związać
-- swojego zdarzenia w 20260913101000.
UPDATE public.auth_email_events AS e
   SET tenant_id = l.tenant_id
  FROM public.email_send_log AS l
 WHERE e.message_id = l.message_id
   AND l.tenant_id IS NOT NULL
   AND e.tenant_id IS NULL;

COMMENT ON COLUMN public.email_send_log.tenant_id IS
  'Najemca, do którego należy wpis dziennika. JEST predykatem polityki email_send_log_admin_select ORAZ jawnego filtru w fetchSystemEmailReport (klient service_role omija RLS, więc każde zapytanie spod niego musi filtrować po tej kolumnie JAWNIE). Wartość podaje producent (gate.tenantId / tenant_id z ładunku kolejki), a gdy jej nie zna - trigger email_send_log_bind_tenant kaskadą po adresie odbiorcy. NULL = adres nierozstrzygalny albo obecny w dwóch organizacjach: wiersz jest wtedy świadomie niewidoczny dla ról klienckich.';
