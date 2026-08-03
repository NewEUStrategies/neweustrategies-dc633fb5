-- ============================================================================
-- P1 - USUNIĘCIE KONTA (RODO) NIE MOŻE NISZCZYĆ DOWODÓW KSIĘGOWYCH.
--
-- PRZYCZYNA ŹRÓDŁOWA (audyt "Usunięcie konta (RODO)", punkt otwarty trzecie
-- wydanie z rzędu): `payment_orders.user_id` od definicji tabeli
-- (20260624172041) było `NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`.
-- Żadna późniejsza migracja tego nie ruszyła - 20260731220000 i 20260801135636
-- dotykają wyłącznie kolumny `environment`. Skutek: `auth.admin.deleteUser()`
-- z `deleteMyAccount` kasował KOMPLET zamówień użytkownika, czyli wewnętrzną
-- ewidencję transakcji, którą art. 74 ust. 2 ustawy o rachunkowości nakazuje
-- przechowywać 5 lat od początku roku następującego po roku obrotowym.
-- Realizacja prawa do usunięcia danych (art. 17 RODO) wygrywała z obowiązkiem
-- prawnym, którego art. 17 ust. 3 lit. b RODO wprost nie pozwala pominąć.
--
-- WZORZEC, KTÓRY JUŻ JEST W REPO: `billing_documents.order_id ON DELETE SET
-- NULL` (20260723151000) plus świadomy BRAK FK na `billing_documents.user_id`
-- ("dokumenty księgowe muszą przetrwać usunięcie konta"). Ta migracja rozciąga
-- ten sam kontrakt na `payment_orders`, tylko mocniej: zamiast trzymać surowy
-- identyfikator osoby, zostawiamy pseudonim jednokierunkowy.
--
-- CO ROBI TA MIGRACJA:
--
--   1) `user_id` przestaje być NOT NULL, a FK zmienia się na `ON DELETE SET
--      NULL`. To STRUKTURALNA gwarancja: nawet kasowanie konta poza aplikacją
--      (dashboard, CLI, `supabase.auth.admin`) nie zabierze już wiersza
--      zamówienia.
--
--   2) Kolumny retencyjne: `subject_ref` (pseudonim SHA-256 kupującego -
--      pozwala uzgodnić zamówienia tej samej osoby w księgach bez trzymania
--      jej identyfikatora), `anonymized_at`, `retention_until` (data, do której
--      dowód musi żyć) i `retention_hold` (blokada czyszczenia na czas kontroli
--      lub sporu).
--
--   3) `anonymize_payment_orders_for_user()` - jedno miejsce, które realizuje
--      "SET NULL + anonimizacja". Rozdziela dwa światy:
--        * zamówienia z jakimkolwiek śladem u operatora albo z zaksięgowaną
--          płatnością => ZOSTAJĄ, pozbawione danych osobowych (user_id NULL,
--          receipt_email NULL, metadane obcięte do minimum księgowego);
--        * porzucone szkice checkoutu, które nigdy nie dotarły do operatora
--          i nie mają zależnych dokumentów => USUWANE. Trzymanie ich 5 lat
--          nie ma podstawy prawnej i łamałoby minimalizację (art. 5 ust. 1
--          lit. c i e RODO).
--
--   4) Trigger `BEFORE DELETE ON auth.users` - ta sama funkcja odpala się,
--      gdy konto ginie poza ścieżką aplikacyjną. Fail-closed: gdy anonimizacja
--      nie przejdzie, kasowanie konta się nie udaje, bo cichy CASCADE to
--      dokładnie ten błąd, który zamykamy.
--
--   5) `purge_expired_payment_orders()` + wpis pg_cron - po wygaśnięciu okresu
--      retencji pseudonimizowany dowód znika. Bez tego "anonimizacja" byłaby
--      wieczystym składowaniem (art. 5 ust. 1 lit. e RODO).
--
--   6) REVOKE DELETE dla roli `authenticated` - tabela i tak nie ma polityki
--      DELETE, ale odebranie uprawnienia czyni retencję niezależną od RLS.
--
-- Wszystko idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) FK: CASCADE -> SET NULL. Zamówienie przeżywa właściciela.
-- ----------------------------------------------------------------------------
ALTER TABLE public.payment_orders
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_user_id_fkey;

ALTER TABLE public.payment_orders
  ADD CONSTRAINT payment_orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.payment_orders.user_id IS
  'Kupujący. NULL = konto usunięte, a zamówienie zostało jako dowód księgowy (art. 74 uor); tożsamość zredukowana do subject_ref. FK ON DELETE SET NULL - nigdy CASCADE.';

-- ----------------------------------------------------------------------------
-- 2) Kolumny retencyjne
-- ----------------------------------------------------------------------------
ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS subject_ref text,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until date,
  ADD COLUMN IF NOT EXISTS retention_hold boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payment_orders.subject_ref IS
  'Pseudonim kupującego (SHA-256 identyfikatora z separacją domeny) nadawany przy anonimizacji. Umożliwia uzgodnienie ksiąg bez danych osobowych; nieodwracalny.';
COMMENT ON COLUMN public.payment_orders.anonymized_at IS
  'Moment anonimizacji po usunięciu konta. NULL = zamówienie ma żywego właściciela.';
COMMENT ON COLUMN public.payment_orders.retention_until IS
  'Ostatni dzień obowiązkowego przechowywania (31.12 piątego roku po roku transakcji, art. 74 ust. 2 uor). Stemplowane triggerem.';
COMMENT ON COLUMN public.payment_orders.retention_hold IS
  'Blokada czyszczenia ponad okres ustawowy (kontrola skarbowa, spór, chargeback). Ustawiana wyłącznie przez service_role.';

-- Kształt wiersza po anonimizacji jest niepodważalny: pseudonim bez
-- identyfikatora, nigdy jedno bez drugiego.
ALTER TABLE public.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_anonymized_shape_chk;
ALTER TABLE public.payment_orders
  ADD CONSTRAINT payment_orders_anonymized_shape_chk CHECK (
    (anonymized_at IS NULL AND subject_ref IS NULL)
    OR (anonymized_at IS NOT NULL AND subject_ref IS NOT NULL AND user_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS payment_orders_subject_ref_idx
  ON public.payment_orders (subject_ref) WHERE subject_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_orders_retention_idx
  ON public.payment_orders (retention_until) WHERE anonymized_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) Funkcje pomocnicze - deterministyczne, więc trigger i backfill liczą
--    dokładnie to samo.
-- ----------------------------------------------------------------------------

-- Art. 74 ust. 2 uor liczy 5 lat od POCZĄTKU roku następującego po roku
-- obrotowym, więc dowód z roku R żyje do 31.12 roku R+5. Rok obrotowy
-- rozstrzygamy w strefie siedziby (Europe/Warsaw), a nie w UTC - transakcja
-- z 31.12 o 23:30 czasu lokalnego należy do roku, w którym ją zaksięgowano.
CREATE OR REPLACE FUNCTION public.accounting_retention_until(p_at timestamptz)
RETURNS date
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT make_date(EXTRACT(YEAR FROM (p_at AT TIME ZONE 'Europe/Warsaw'))::int + 5, 12, 31);
$$;

COMMENT ON FUNCTION public.accounting_retention_until(timestamptz) IS
  'Data końca ustawowej retencji dowodu księgowego z podanej chwili (art. 74 ust. 2 uor): 31.12 piątego roku po roku obrotowym.';

-- Pseudonim kupującego. Separacja domeny w prefiksie, żeby ten sam
-- identyfikator w innym kontekście nie dał tego samego skrótu. UUID ma ~122
-- bity entropii, więc skrót jest praktycznie nieodwracalny, a jednocześnie
-- stabilny - wszystkie zamówienia jednej osoby dostają ten sam pseudonim.
CREATE OR REPLACE FUNCTION public.accounting_subject_ref(p_user_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT encode(sha256(convert_to('nes:accounting-subject:v1:' || p_user_id::text, 'utf8')), 'hex');
$$;

COMMENT ON FUNCTION public.accounting_subject_ref(uuid) IS
  'Jednokierunkowy pseudonim kupującego używany w zanonimizowanych dowodach księgowych.';

-- Metadane obcinamy ALLOWLISTĄ, nie czarną listą: nowy klucz z danymi
-- osobowymi dodany kiedyś w checkoucie ma wypaść domyślnie, a nie przetrwać,
-- bo nikt nie pamiętał dopisać go do wyjątków. Substancja księgowa (kwota,
-- waluta, daty, identyfikatory u operatora) i tak siedzi w kolumnach.
CREATE OR REPLACE FUNCTION public.accounting_metadata_minimum(p_metadata jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    FROM jsonb_each(COALESCE(p_metadata, '{}'::jsonb)) AS entry
   WHERE entry.key IN (
     'label',
     'event_id',
     'quantity',
     'coupon_code',
     'coupon_id',
     'coupon_discount_cents',
     'original_amount_cents'
   );
$$;

COMMENT ON FUNCTION public.accounting_metadata_minimum(jsonb) IS
  'Metadane zamówienia obcięte allowlistą do kluczy o znaczeniu księgowym - używane przy anonimizacji.';

-- ----------------------------------------------------------------------------
-- 4) Stempel retencji - jedno źródło prawdy dla nowych i zmienianych wierszy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_payment_orders_stamp_retention()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Zawsze przeliczamy: `paid_at` bywa stemplowane dopiero webhookiem, a data
  -- retencji musi wtedy przeskoczyć na rok faktycznego zaksięgowania.
  NEW.retention_until := public.accounting_retention_until(
    COALESCE(NEW.paid_at, NEW.created_at, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_orders_stamp_retention ON public.payment_orders;
CREATE TRIGGER payment_orders_stamp_retention
  BEFORE INSERT OR UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_orders_stamp_retention();

-- Backfill istniejących wierszy (trigger nie dotknie ich sam z siebie).
UPDATE public.payment_orders
   SET retention_until = public.accounting_retention_until(COALESCE(paid_at, created_at))
 WHERE retention_until IS NULL;

-- ----------------------------------------------------------------------------
-- 5) Anonimizacja przy usuwaniu konta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_payment_orders_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retained integer := 0;
  v_discarded integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('retained', 0, 'discarded', 0);
  END IF;

  -- (a) Porzucone szkice checkoutu: nigdy nie dotarły do operatora, nic nie
  --     zaksięgowały i nic od nich nie wisi. Zero wartości dowodowej, więc
  --     zostają usunięte razem z kontem.
  DELETE FROM public.payment_orders o
   WHERE o.user_id = p_user_id
     AND o.paid_at IS NULL
     AND o.provider_intent_id IS NULL
     AND o.provider_session_id IS NULL
     AND o.provider_subscription_id IS NULL
     AND o.status IN ('pending', 'failed', 'canceled')
     AND NOT EXISTS (
       SELECT 1 FROM public.billing_documents bd WHERE bd.order_id = o.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.b2b_coupon_redemptions r WHERE r.order_id = o.id
     );
  GET DIAGNOSTICS v_discarded = ROW_COUNT;

  -- (b) Wszystko pozostałe to dowód księgowy albo transakcja, która wciąż może
  --     się rozstrzygnąć u operatora. Zostaje - bez danych osobowych.
  UPDATE public.payment_orders o
     SET user_id       = NULL,
         subject_ref   = public.accounting_subject_ref(p_user_id),
         anonymized_at = COALESCE(o.anonymized_at, now()),
         receipt_email = NULL,
         metadata      = public.accounting_metadata_minimum(o.metadata),
         updated_at    = now()
   WHERE o.user_id = p_user_id;
  GET DIAGNOSTICS v_retained = ROW_COUNT;

  RETURN jsonb_build_object('retained', v_retained, 'discarded', v_discarded);
END;
$$;

COMMENT ON FUNCTION public.anonymize_payment_orders_for_user(uuid) IS
  'Realizuje "SET NULL + anonimizacja" dla zamówień usuwanego konta: dowody księgowe zostają bez danych osobowych, porzucone szkice checkoutu są usuwane. Zwraca {retained, discarded}.';

REVOKE EXECUTE ON FUNCTION public.anonymize_payment_orders_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_payment_orders_for_user(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Siatka bezpieczeństwa: konto usunięte POZA aplikacją.
--
-- Ścieżka aplikacyjna woła anonimizację jawnie przed `deleteUser`, więc tutaj
-- UPDATE trafia w zero wierszy. Trigger istnieje dla dashboardu, CLI i skryptów
-- - fail-closed, bo cicha utrata dowodów to dokładnie ten błąd, który zamykamy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_auth_user_deleted_retain_accounting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.anonymize_payment_orders_for_user(OLD.id);
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.tg_auth_user_deleted_retain_accounting() IS
  'BEFORE DELETE na auth.users: anonimizuje zamówienia zanim zniknie konto, także przy usunięciu poza aplikacją.';

DROP TRIGGER IF EXISTS on_auth_user_deleted_retain_accounting ON auth.users;
CREATE TRIGGER on_auth_user_deleted_retain_accounting
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_auth_user_deleted_retain_accounting();

-- ----------------------------------------------------------------------------
-- 7) Czyszczenie po wygaśnięciu retencji.
--
-- Dotyczy WYŁĄCZNIE wierszy zanonimizowanych - historia żywego klienta nie
-- wyparowuje mu po pięciu latach z panelu. `retention_hold` wstrzymuje
-- czyszczenie na czas kontroli lub sporu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_payment_orders()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.payment_orders o
   WHERE o.anonymized_at IS NOT NULL
     AND o.user_id IS NULL
     AND o.retention_hold = false
     AND o.retention_until IS NOT NULL
     AND o.retention_until < current_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_payment_orders() IS
  'Usuwa zanonimizowane zamówienia po upływie ustawowego okresu retencji (art. 5 ust. 1 lit. e RODO). Pomija wiersze z retention_hold.';

REVOKE EXECUTE ON FUNCTION public.purge_expired_payment_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_payment_orders() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('purge-expired-payment-orders', '35 3 * * *',
      'SELECT public.purge_expired_payment_orders()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - expired payment_orders purged only on demand';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 8) Retencja niezależna od RLS: rola `authenticated` nie ma po co kasować
--    zamówień (nigdy nie było polityki DELETE - teraz nie ma też grantu).
-- ----------------------------------------------------------------------------
REVOKE DELETE ON public.payment_orders FROM authenticated;

COMMENT ON TABLE public.payment_orders IS
  'Ewidencja transakcji (subskrypcje, zakupy jednorazowe, bilety). Dowód księgowy: przeżywa usunięcie konta (user_id ON DELETE SET NULL + anonimizacja), znika dopiero po retention_until.';
