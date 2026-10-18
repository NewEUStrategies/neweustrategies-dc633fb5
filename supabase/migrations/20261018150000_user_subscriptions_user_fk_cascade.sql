-- ============================================================================
-- RODO: uprawnienia `user_subscriptions` znikają razem z kontem.
--
-- DEFEKT. `user_subscriptions.user_id` to `uuid NOT NULL` BEZ klucza obcego
-- (20260601051732). Usunięcie konta (`deleteMyAccount` -> `auth.admin.
-- deleteUser`, panel, CLI) zostawia więc wiersze uprawnień z SUROWYM
-- identyfikatorem osoby - bez podstawy prawnej i bez terminu (art. 5 ust. 1
-- lit. e i art. 17 RODO). Ani `anonymize_accounting_evidence_for_user()`, ani
-- trigger `on_auth_user_deleted_retain_accounting` tej tabeli nie dotykają.
-- To ten sam wzorzec błędu, który 20260805090100 zamknął dla `user_purchases`:
-- brak FK nie pojawia się na żadnej liście „miejsc, gdzie CASCADE niszczy
-- dowody", więc nikt go nie widzi.
--
-- DECYZJA: CASCADE, nie SET NULL + anonimizacja. Wiersz uprawnienia nie jest
-- dowodem księgowym:
--   * lustro operatora `subscriptions` (identyfikator subskrypcji, cena,
--     okres) od założenia kasuje się kaskadowo z kontem (20260729072626);
--   * dowodami zostają `payment_orders` (pseudonim, retencja 5 lat) oraz
--     `billing_documents`, których `subscription_id` odpina się
--     (`ON DELETE SET NULL`, 20260723151000) - dokument przeżywa uprawnienie;
--   * `user_purchases` zostaje zanonimizowane, bo niesie KWOTĘ zakupu;
--     `user_subscriptions` kwoty nie ma.
--
-- KOLEJNOŚĆ:
--   1) wiersze osierocone (konto już nie istnieje) są usuwane - inaczej
--      `ADD CONSTRAINT` się nie powiedzie, a naruszenie zostałoby w danych;
--   2) klucz obcy `ON DELETE CASCADE` - strukturalna gwarancja także dla
--      kasowania konta poza aplikacją.
-- Indeks `idx_user_subs_user` (20260601051732) obsługuje kaskadę.
--
-- SKUTKI UBOCZNE: kaskada nie odpala `trg_user_subscriptions_emit_events` ani
-- `user_subscriptions_notify_trg` (oba AFTER INSERT/UPDATE). `SET NULL` na
-- `billing_documents.subscription_id` nie zmienia `status`, więc emiter
-- dokumentów milczy, a `billing_documents_snapshot_write_once` pilnuje innych
-- kolumn. Zapis uprawnienia dla konta usuniętego w trakcie dostawy webhooka
-- dostaje teraz 23503 - `syncEntitlementState` i `grantEntitlement` traktują
-- je jak „właściciela już nie ma" (bez ponowień), tak jak zapis
-- `subscriptions` w dyspozytorze.
--
-- IDEMPOTENTNA: drugi przebieg nie znajduje osieroconych wierszy, a FK jest
-- zdejmowany i zakładany od nowa.
-- DOWÓD: supabase/tests/user_subscriptions_user_fk_cascade_test.sql.
-- ============================================================================

DELETE FROM public.user_subscriptions us
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = us.user_id);

ALTER TABLE public.user_subscriptions
  DROP CONSTRAINT IF EXISTS user_subscriptions_user_id_fkey;
ALTER TABLE public.user_subscriptions
  ADD CONSTRAINT user_subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT user_subscriptions_user_id_fkey ON public.user_subscriptions IS
  'Uprawnienie znika z kontem (RODO art. 17). Dowody księgowe: payment_orders (pseudonim) i billing_documents (subscription_id -> SET NULL).';
