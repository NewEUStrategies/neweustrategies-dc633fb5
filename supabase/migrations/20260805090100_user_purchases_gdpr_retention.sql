-- ============================================================================
-- P1 RODO: `user_purchases` przestaje przeżywać usunięcie konta z SUROWYM
-- identyfikatorem osoby.
--
-- PRZYCZYNA ŹRÓDŁOWA (audyt 05.08, §4.2). Migracja 20260803090002 domknęła
-- `payment_orders` wzorcowo: FK na `ON DELETE SET NULL`, pseudonim
-- `subject_ref`, allowlista metadanych, `retention_until`, purge, fail-closed
-- trigger na `auth.users`. Tabela SIOSTRZANA została pominięta - i pominięta
-- została z konkretnego powodu, który warto zapisać, bo to wzorzec błędu:
--
--   `user_purchases.user_id` to `uuid NOT NULL` **bez żadnego klucza obcego**
--   (20260601051732:105). Nigdy nie kaskadował, więc nigdy nie pojawił się na
--   liście „miejsc, gdzie CASCADE niszczy dowody". Audyt CASCADE go nie
--   widział, bo CASCADE tam nie było. A skoro FK nie było wcale, to po
--   `auth.admin.deleteUser()` wiersz ZOSTAJE z identyfikatorem usuniętego
--   użytkownika w postaci surowej - bez podstawy prawnej i bez terminu.
--
-- To DRUGI, PRZECIWNY kierunek naruszenia niż w `payment_orders`: tam groziło
-- zniszczenie dowodów księgowych (art. 74 ust. 2 uor), tu zostają osierocone
-- dane osobowe (art. 5 ust. 1 lit. e i art. 17 RODO). Jedna tabela
-- transakcyjna utwardzona, siostrzana nie.
--
-- CO ROBI TA MIGRACJA:
--
--   1) `user_id` staje się nullowalny i DOSTAJE klucz obcy - `ON DELETE SET
--      NULL`. Brak FK nie był „luźnym sprzężeniem", był brakiem gwarancji:
--      teraz nawet kasowanie konta poza aplikacją nie zostawi surowego
--      identyfikatora.
--   2) Kolumny retencyjne 1:1 jak w `payment_orders`: `subject_ref`
--      (ten sam pseudonim SHA-256, więc zakup i zamówienie tej samej osoby da
--      się uzgodnić w księgach bez danych osobowych), `anonymized_at`,
--      `retention_until`, `retention_hold`.
--   3) BACKFILL osieroconych wierszy: to, co już leży w bazie po usuniętych
--      kontach, jest anonimizowane (albo usuwane, jeśli nie ma wartości
--      dowodowej) ZANIM założymy FK - inaczej `ADD CONSTRAINT` by się wywalił,
--      a naruszenie zostałoby w danych.
--   4) `anonymize_user_purchases_for_user()` - ten sam podział co przy
--      zamówieniach: uprawnienie z pieniędzmi albo ze śladem u operatora
--      ZOSTAJE bez danych osobowych; darmowy grant bez wartości dowodowej
--      znika razem z kontem (minimalizacja, art. 5 ust. 1 lit. c RODO).
--   5) `anonymize_accounting_evidence_for_user()` - JEDEN punkt wejścia dla
--      obu tabel. Aplikacja i trigger `BEFORE DELETE ON auth.users` wołają
--      dokładnie to samo, w jednej instrukcji, więc nie istnieje stan
--      „zamówienia zanonimizowane, zakupy jeszcze nie".
--   6) `purge_expired_accounting_evidence()` + jeden wpis pg_cron dla obu
--      tabel (dotąd cron znał tylko zamówienia).
--
-- Wszystko idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Kolumny retencyjne (przed czymkolwiek innym - backfill ich potrzebuje).
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_purchases
  ADD COLUMN IF NOT EXISTS subject_ref text,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until date,
  ADD COLUMN IF NOT EXISTS retention_hold boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_purchases.subject_ref IS
  'Pseudonim nabywcy (ten sam SHA-256 co payment_orders.subject_ref) nadawany przy anonimizacji. Pozwala uzgodnić zakup z zamówieniem bez danych osobowych; nieodwracalny.';
COMMENT ON COLUMN public.user_purchases.anonymized_at IS
  'Moment anonimizacji po usunięciu konta. NULL = uprawnienie ma żywego właściciela.';
COMMENT ON COLUMN public.user_purchases.retention_until IS
  'Ostatni dzień obowiązkowego przechowywania (31.12 piątego roku po roku zakupu, art. 74 ust. 2 uor). Stemplowane triggerem.';
COMMENT ON COLUMN public.user_purchases.retention_hold IS
  'Blokada czyszczenia ponad okres ustawowy (kontrola, spór, chargeback). Ustawiana wyłącznie przez service_role.';

-- ----------------------------------------------------------------------------
-- 2) Stempel retencji - jedno źródło prawdy dla nowych i zmienianych wierszy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_user_purchases_stamp_retention()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.retention_until := public.accounting_retention_until(
    COALESCE(NEW.purchased_at, now())
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_user_purchases_stamp_retention() IS
  'Stempluje user_purchases.retention_until datą końca ustawowej retencji dowodu (art. 74 ust. 2 uor).';

DROP TRIGGER IF EXISTS user_purchases_stamp_retention ON public.user_purchases;
CREATE TRIGGER user_purchases_stamp_retention
  BEFORE INSERT OR UPDATE ON public.user_purchases
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_purchases_stamp_retention();

UPDATE public.user_purchases
   SET retention_until = public.accounting_retention_until(purchased_at)
 WHERE retention_until IS NULL;

-- ----------------------------------------------------------------------------
-- 3) `user_id`: nullowalny + FK ON DELETE SET NULL.
--
-- Kolejność jest istotna. Najpierw zdejmujemy NOT NULL, potem sprzątamy
-- wiersze wskazujące na konta, których już nie ma (inaczej `ADD CONSTRAINT`
-- odmówi), a dopiero na czystych danych zakładamy klucz obcy.
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_purchases
  ALTER COLUMN user_id DROP NOT NULL;

-- (a) Osierocone darmowe granty: zero kwoty, zero śladu u operatora - zero
--     wartości dowodowej. Trzymanie ich pięć lat nie ma podstawy prawnej.
DELETE FROM public.user_purchases p
 WHERE p.user_id IS NOT NULL
   AND COALESCE(p.amount_cents, 0) <= 0
   AND p.external_ref IS NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

-- (b) Osierocone uprawnienia z substancją księgową: zostają, pozbawione
--     identyfikatora osoby. Data anonimizacji jest nieznana (konto zniknęło
--     kiedyś w przeszłości), więc stemplujemy chwilę naprawy - to pierwszy
--     moment, w którym system o niej wie.
UPDATE public.user_purchases p
   SET user_id       = NULL,
       subject_ref   = public.accounting_subject_ref(p.user_id),
       anonymized_at = COALESCE(p.anonymized_at, now())
 WHERE p.user_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

ALTER TABLE public.user_purchases
  DROP CONSTRAINT IF EXISTS user_purchases_user_id_fkey;

ALTER TABLE public.user_purchases
  ADD CONSTRAINT user_purchases_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.user_purchases.user_id IS
  'Nabywca. NULL = konto usunięte, a uprawnienie zostało jako dowód księgowy (art. 74 uor); tożsamość zredukowana do subject_ref. FK ON DELETE SET NULL - nigdy CASCADE, nigdy bez FK.';

-- Kształt wiersza po anonimizacji jest niepodważalny - dokładnie jak w
-- payment_orders: pseudonim bez identyfikatora, nigdy jedno bez drugiego.
ALTER TABLE public.user_purchases
  DROP CONSTRAINT IF EXISTS user_purchases_anonymized_shape_chk;
ALTER TABLE public.user_purchases
  ADD CONSTRAINT user_purchases_anonymized_shape_chk CHECK (
    (anonymized_at IS NULL AND subject_ref IS NULL)
    OR (anonymized_at IS NOT NULL AND subject_ref IS NOT NULL AND user_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS user_purchases_subject_ref_idx
  ON public.user_purchases (subject_ref) WHERE subject_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_purchases_retention_idx
  ON public.user_purchases (retention_until) WHERE anonymized_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4) Anonimizacja przy usuwaniu konta.
--
-- UNIQUE (user_id, entity_type, entity_id) nie stoi na drodze: w indeksie
-- unikalnym NULL nie równa się NULL, więc wiele zanonimizowanych wierszy na to
-- samo entity współistnieje bez kolizji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_user_purchases_for_user(p_user_id uuid)
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

  -- (a) Darmowy grant bez śladu u operatora: nic nie zaksięgował, nic nie
  --     dowodzi. Znika razem z kontem.
  DELETE FROM public.user_purchases p
   WHERE p.user_id = p_user_id
     AND COALESCE(p.amount_cents, 0) <= 0
     AND p.external_ref IS NULL;
  GET DIAGNOSTICS v_discarded = ROW_COUNT;

  -- (b) Wszystko pozostałe to dowód zakupu - zostaje bez danych osobowych.
  --     `entity_type`/`entity_id` NIE są danymi osobowymi po odcięciu
  --     identyfikatora: bez `user_id` wskazują wyłącznie przedmiot transakcji,
  --     a bez nich wiersz przestałby być dowodem czegokolwiek.
  UPDATE public.user_purchases p
     SET user_id       = NULL,
         subject_ref   = public.accounting_subject_ref(p_user_id),
         anonymized_at = COALESCE(p.anonymized_at, now())
   WHERE p.user_id = p_user_id;
  GET DIAGNOSTICS v_retained = ROW_COUNT;

  RETURN jsonb_build_object('retained', v_retained, 'discarded', v_discarded);
END;
$$;

COMMENT ON FUNCTION public.anonymize_user_purchases_for_user(uuid) IS
  'Realizuje "SET NULL + anonimizacja" dla uprawnień zakupowych usuwanego konta: dowody zakupu zostają bez danych osobowych, darmowe granty są usuwane. Zwraca {retained, discarded}.';

REVOKE EXECUTE ON FUNCTION public.anonymize_user_purchases_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_purchases_for_user(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 5) JEDEN punkt wejścia dla całej retencji konta.
--
-- Dlaczego łącznie, a nie dwa wywołania z aplikacji: anonimizacja musi być
-- niepodzielna. Dwa osobne RPC to dwie transakcje, a między nimi stan, w
-- którym zamówienia są już pseudonimizowane, a zakupy wciąż noszą surowy
-- identyfikator - i awaria w tym oknie zostawia naruszenie w danych. Jedna
-- funkcja = jedna transakcja = albo całość, albo nic.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_accounting_evidence_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders jsonb;
  v_purchases jsonb;
BEGIN
  v_orders := public.anonymize_payment_orders_for_user(p_user_id);
  v_purchases := public.anonymize_user_purchases_for_user(p_user_id);

  RETURN jsonb_build_object(
    'orders', v_orders,
    'purchases', v_purchases,
    -- Płaskie pola dla zgodności ze starym kontraktem {retained, discarded},
    -- który znaczył „zamówienia". Nowi konsumenci czytają gałęzie wyżej.
    'retained', COALESCE((v_orders ->> 'retained')::int, 0),
    'discarded', COALESCE((v_orders ->> 'discarded')::int, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.anonymize_accounting_evidence_for_user(uuid) IS
  'Pełna retencja dowodów przy usuwaniu konta: payment_orders + user_purchases w JEDNEJ transakcji. Zwraca {orders:{retained,discarded}, purchases:{retained,discarded}, retained, discarded}.';

REVOKE EXECUTE ON FUNCTION public.anonymize_accounting_evidence_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_accounting_evidence_for_user(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Siatka bezpieczeństwa: konto usunięte POZA aplikacją.
--    Ta sama funkcja triggera, teraz obejmująca obie tabele.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_auth_user_deleted_retain_accounting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.anonymize_accounting_evidence_for_user(OLD.id);
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.tg_auth_user_deleted_retain_accounting() IS
  'BEFORE DELETE na auth.users: anonimizuje zamówienia I uprawnienia zakupowe zanim zniknie konto, także przy usunięciu poza aplikacją (dashboard, CLI, skrypty).';

DROP TRIGGER IF EXISTS on_auth_user_deleted_retain_accounting ON auth.users;
CREATE TRIGGER on_auth_user_deleted_retain_accounting
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_auth_user_deleted_retain_accounting();

-- ----------------------------------------------------------------------------
-- 7) Czyszczenie po wygaśnięciu retencji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_user_purchases()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.user_purchases p
   WHERE p.anonymized_at IS NOT NULL
     AND p.user_id IS NULL
     AND p.retention_hold = false
     AND p.retention_until IS NOT NULL
     AND p.retention_until < current_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_user_purchases() IS
  'Usuwa zanonimizowane uprawnienia zakupowe po upływie ustawowego okresu retencji (art. 5 ust. 1 lit. e RODO). Pomija wiersze z retention_hold.';

REVOKE EXECUTE ON FUNCTION public.purge_expired_user_purchases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_user_purchases() TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_accounting_evidence()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders integer := public.purge_expired_payment_orders();
  v_purchases integer := public.purge_expired_user_purchases();
BEGIN
  RETURN jsonb_build_object('orders', v_orders, 'purchases', v_purchases);
END;
$$;

COMMENT ON FUNCTION public.purge_expired_accounting_evidence() IS
  'Nocne czyszczenie retencji dla obu tabel dowodowych (payment_orders + user_purchases). Wejście wpisu pg_cron.';

REVOKE EXECUTE ON FUNCTION public.purge_expired_accounting_evidence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_accounting_evidence() TO service_role;

-- Jeden wpis crona dla obu tabel. Stary wpis (tylko zamówienia) usuwamy, żeby
-- ta sama praca nie chodziła dwa razy w tej samej minucie.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    BEGIN
      PERFORM cron.unschedule('purge-expired-payment-orders');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'no legacy purge job to unschedule';
    END;
    PERFORM cron.schedule('purge-expired-accounting-evidence', '35 3 * * *',
      'SELECT public.purge_expired_accounting_evidence()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - accounting retention purged only on demand';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 8) Retencja niezależna od RLS. `authenticated` ma na tej tabeli SELECT
--    i INSERT (20260601051732:118) i żadnej polityki zapisu - ale prawo do
--    kasowania/zmiany dowodu nie ma po co istnieć nawet teoretycznie.
-- ----------------------------------------------------------------------------
REVOKE DELETE, UPDATE, TRUNCATE ON public.user_purchases FROM authenticated;
REVOKE ALL ON public.user_purchases FROM anon;

COMMENT ON TABLE public.user_purchases IS
  'Uprawnienia zakupowe (dostęp jednorazowy do treści/wydarzenia). Dowód księgowy: przeżywa usunięcie konta (user_id ON DELETE SET NULL + anonimizacja do subject_ref), znika dopiero po retention_until.';
