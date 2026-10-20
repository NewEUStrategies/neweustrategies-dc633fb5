-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b-A2, 1/3): RODO LEJKA PO USUNIĘCIU KONTA -
-- PSEUDONIM ZASTĘPCZY W `paywall_hits` I DZIENNIKU LICZNIKA (Z-I9b-03).
-- Polecenie właściciela 2026-10-20 („zastosuj" dla Z-I9b-03/04/05).
--
-- DEFEKT
--   1. `paywall_hits.user_id` (I0, pisarz S3 `record_paywall_hit`) nie ma
--      klucza obcego - po usunięciu konta w wierszach lejka zostaje SUROWY
--      uid. Ten sam uid jest wejściem pseudonimu dowodów księgowych
--      (`payment_orders.subject_ref` = SHA-256 ze stałego przedrostka i uid,
--      20260803090002), więc surowy uid w lejku łączy historię czytania
--      z zachowanym dokumentem sprzedaży, czyli z nabywcą.
--   2. Ten sam problem w `metering_event_log` (dziennik licznika artykułów,
--      pisarz S3 `log_metering_event`): `user_id` bez klucza obcego, a obok
--      `visitor_id` - identyfikator przeglądarki zalogowanego czytelnika.
--
-- ZMIANA
--   A. `_hub_erasure_surrogate()` - pseudonim zastępczy: losowy UUID
--      (`gen_random_uuid()`, 122 bity losowe) z cyfrą wersji 8 (RFC 9562,
--      wersja „custom"). Jeden na usuwane konto, losowany przy usunięciu,
--      BEZ zapisu mapowania - po usunięciu konta nikt nie powiąże go z osobą.
--      Wersja 8 odróżnia pseudonim od uid kont (GoTrue nadaje wersję 4), więc
--      domknięcie wstecz (3/3) nie bierze pseudonimu za osierocone konto
--      i powtórka niczego nie zmienia.
--   B. `_funnel_erase_account(uid, pseudonim)`:
--      * `paywall_hits.user_id` -> pseudonim. Lejek S3 liczy konta przez
--        `count(DISTINCT user_id)` (`_funnel_counts`: `paywall_hit_accounts`,
--        `active_accounts`, `paywall_reasons`, `admin_revenue_access_inventory`
--        `hits_30d`), a NIE przez złączenie z `auth.users`/`profiles` - NULL
--        zgubiłby konto z liczników zamkniętych okresów (i złamałby CHECK
--        „dokładnie jeden podmiot"), pseudonim liczy je dalej raz. Kolumn
--        przeglądarki (`visitor_hash`) wiersz konta nie ma (CHECK), IP i UA
--        tabela nie przechowuje;
--      * `metering_event_log.user_id` -> pseudonim, `visitor_id` -> NULL
--        (identyfikator przeglądarki łączyłby wiersz z wierszami gościa tej
--        samej przeglądarki). Panel monetyzacji liczy tu zdarzenia według
--        wyniku - liczby bez zmian.
--   Wywołanie: wyzwalacz usunięcia konta i domknięcie wstecz (3/3) - jeden
--   pseudonim konta wspólny dla lejka, zdarzeń domenowych i dziennika audytu.
--   PSCR (konwersja paywalla): mianownik (konta z uderzeniem) zostaje;
--   licznik łączy uderzenie z zamówieniem po koncie, a moduł rozliczeń
--   zeruje `payment_orders.user_id` przy usunięciu (SET NULL sprzed huba),
--   więc konwersja usuniętego konta znika z licznika - tak jak przed A2.
--   Zachowanie jej wymagałoby pseudonimu na dowodzie księgowym, który
--   identyfikuje nabywcę (fakturze) - anonimowość lejka wygrywa (motyw 26).
--
-- KOLEJNOŚĆ WDROŻENIA: po I0 (`paywall_hits`) i S3; przed 20261020160700
-- (wyzwalacz i domknięcie wstecz wołają tę funkcję). Zero DDL tabel.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- bezstanowe REVOKE. Funkcja zmienia wyłącznie wiersze z uid konta - po
-- redakcji uid nie występuje, więc powtórka zwraca 0.
-- DOWÓD: supabase/tests/hub_i9b_account_erasure_sweep_test.sql (uid nie
-- występuje w żadnej kolumnie tabel z przeglądu; `paywall_hit_accounts`,
-- `paywall_hits`, `paywall_reasons`, `active_accounts` zamkniętego okresu
-- bez zmian; pseudonim wersji 8, wspólny dla lejka i zdarzeń).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Pseudonim zastępczy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._hub_erasure_surrogate()
RETURNS uuid
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $$
  -- Pozycja 15 tekstu UUID to cyfra wersji (xxxxxxxx-xxxx-Vxxx-…).
  SELECT overlay(gen_random_uuid()::text PLACING '8' FROM 15 FOR 1)::uuid
$$;

REVOKE ALL ON FUNCTION public._hub_erasure_surrogate() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_erasure_surrogate() IS
  'Hub I9b-A2 (RODO): pseudonim zastępczy usuniętego konta - losowy UUID z wersją 8 (RFC 9562 „custom"), bez zapisu mapowania. Wersja 8 odróżnia go od uid kont (v4). Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- B) Lejek i dziennik licznika jednego konta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._funnel_erase_account(p_user_id uuid, p_surrogate uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
  v_n integer;
BEGIN
  IF p_user_id IS NULL OR p_surrogate IS NULL THEN
    RETURN 0;
  END IF;

  -- Jeden wiersz na (doba, konto, treść, wariant): pseudonim jest unikalny
  -- dla konta, więc indeks częściowy `paywall_hits_user_uidx` nie zderza się
  -- z niczym, a `count(DISTINCT user_id)` liczy konto raz, jak przed usunięciem.
  UPDATE public.paywall_hits ph
     SET user_id = p_surrogate
   WHERE ph.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.metering_event_log l
     SET user_id = p_surrogate,
         visitor_id = NULL
   WHERE l.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_rows + v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._funnel_erase_account(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._funnel_erase_account(uuid, uuid) IS
  'Hub I9b-A2 (RODO Z-I9b-03): po usunięciu konta paywall_hits.user_id i metering_event_log.user_id -> pseudonim zastępczy konta (liczniki lejka zamkniętych okresów bez zmian), visitor_id dziennika licznika -> NULL. Wewnętrzny: bez EXECUTE dla ról API.';
