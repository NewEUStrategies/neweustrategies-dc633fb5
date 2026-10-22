-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S3, 1/5): ZDARZENIE REJESTRACJI KONTA -
-- `account.registered.v1` Z ŹRÓDŁEM ZAPISU.
--
-- DEFEKT
--   1. Lejek czytelnika nie ma faktu „powstało konto". Rejestracja zostawia
--      wiersz `profiles` (trigger `handle_new_user`), ale nie emituje żadnego
--      zdarzenia domenowego - hub, CRM i ścieżki (S5: „powitanie nowego
--      konta") nie mają czego słuchać, a lista członków w innych kartach
--      panelu odświeża się dopiero po przeładowaniu.
--   2. Atrybucja rejestracji jest martwa (P16): `signup_source` z metadanych
--      konta (`buildSignupMetadata`: auth_page, login_popup, popup, club_gate,
--      register_widget) ląduje wyłącznie w `auth.users.raw_user_meta_data`,
--      którego nie czyta żaden raport - „skąd przychodzą konta" nie ma
--      odpowiedzi.
--
-- ZMIANA
--   `tg_profiles_account_registered_emit` - AFTER INSERT ON `profiles`
--   (rejestr S3 w `src/lib/ci/hubDelivery.ts`, rodzaj `trigger`):
--     * agregat `account`, `aggregate_id` = id konta; BEZ aktora
--       (`p_suppress_actor`): rejestrację wykonuje GoTrue bez sesji
--       użytkownika, a polityka `domain_events` daje aktorowi odczyt
--       „własnych" zdarzeń - konto jest w `aggregate_id` i `payload.user_id`;
--     * payload BEZ PII: `user_id`, `signup_source` (BIAŁA LISTA - wartość
--       spoza listy albo brak to `unknown`, bo payload czyta cały staff
--       najemcy, a metadane konta pisze klient: dowolny napis z formularza
--       nie może wejść na szynę), `marketing_opt_in` (tylko `true`/`false`;
--       nieczytelna wartość = `false`, jak zgoda niewyrażona),
--       `has_attribution` (czy metadane niosą klucz atrybucji kampanii - UTM
--       albo `attribution`; same wartości UTM zostają w koncie);
--     * lista źródeł = `SIGNUP_SOURCES` w `src/lib/revenue/funnel/funnelStages.ts`
--       (test parytetu czyta tę migrację).
--   Awaria szyny nie przerywa rejestracji: ciało w `EXCEPTION WHEN OTHERS`
--   zapisuje ślad przez `_log_emit_error(…, SQLSTATE, SQLERRM)` (kontrakt
--   Z-02) i zwraca NULL. Wyzwalacz nie ma EXECUTE dla żadnej roli API.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090500 (`_log_emit_error`). Typ zdarzenia
-- i reguła inwalidacji są w katalogu I0 (`DOMAIN_EVENT_TYPES`). Kod klienta
-- nie wymaga zmian - zdarzenie tylko dokłada inwalidację i fakt lejka.
-- `profiles` jest gorącą tabelą: CREATE TRIGGER pod `lock_timeout`.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowa sygnatura, bez CIALO-Z),
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER, bezstanowe REVOKE.
-- DOWÓD: supabase/tests/account_registered_event_test.sql (realny wiersz
-- `domain_events`, biała lista źródeł, brak PII w payloadzie, awaria szyny
-- nie przerywa INSERT), src/lib/revenue/funnel/__tests__/funnelStages.test.ts
-- (parytet listy źródeł z tą migracją).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_profiles_account_registered_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb;
  v_source text;
  v_opt_in boolean;
  v_attribution boolean;
BEGIN
  -- Metadane rejestracji żyją w koncie auth, nie w profilu. Ten sam wiersz
  -- przeczytał przed chwilą `handle_new_user`, więc jest już widoczny w tej
  -- transakcji.
  SELECT u.raw_user_meta_data INTO v_meta FROM auth.users u WHERE u.id = NEW.id;
  v_meta := COALESCE(v_meta, '{}'::jsonb);

  v_source := v_meta ->> 'signup_source';
  IF v_source IS NULL OR v_source NOT IN (
    'auth_page', 'login_popup', 'popup', 'club_gate', 'register_widget',
    'paywall', 'pricing', 'checkout', 'club_apply', 'join_us_form'
  ) THEN
    v_source := 'unknown';
  END IF;

  -- Zgoda marketingowa tylko jako jawne `true` - napis albo brak klucza to
  -- zgoda NIEwyrażona (RODO: domniemanie zgody nie istnieje).
  v_opt_in := lower(COALESCE(v_meta ->> 'marketing_opt_in', '')) = 'true';
  v_attribution := v_meta ?| ARRAY['utm_source', 'utm_medium', 'utm_campaign', 'attribution'];

  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'account', NEW.id::text, 'account.registered.v1',
    jsonb_build_object(
      'user_id', NEW.id,
      'signup_source', v_source,
      'marketing_opt_in', v_opt_in,
      'has_attribution', v_attribution
    ),
    p_suppress_actor => true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_profiles_account_registered_emit', 'account.registered.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_profiles_account_registered_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_profiles_account_registered_emit() IS
  'Hub S3: account.registered.v1 {user_id, signup_source (biała lista, inaczej unknown), marketing_opt_in, has_attribution} - bez PII; awaria szyny -> domain_event_emit_errors, rejestracja przechodzi.';

SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_profiles_account_registered_emit ON public.profiles;
CREATE TRIGGER trg_profiles_account_registered_emit
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_account_registered_emit();

RESET lock_timeout;
