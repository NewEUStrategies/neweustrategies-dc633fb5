-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S1, 1/5): ZDARZENIA ZMIAN USTAWIEŃ - LICZNIK,
-- KASA, RETENCJA, DOSTĘP DO TREŚCI, POWODY ODEJŚCIA.
--
-- DEFEKT
--   Pięć tabel ustawień modułów źródłowych (`metering_settings`,
--   `checkout_settings`, `retention_settings`, `content_access`,
--   `retention_reasons`) nie emituje żadnego zdarzenia domenowego. Zmiana
--   zapisana w module (np. limit licznika w paywallu albo reguła dostępu
--   wpisu) nie dociera do huba ani do innych otwartych kart - widzą stan
--   z cache aż do przeładowania. To łamie wymóg „zmiana w module X wpływa na
--   hub i odwrotnie": szyna zdarzeń jest jedynym kanałem inwalidacji między
--   modułami (mapa I0 ma już reguły dla tych typów, brakowało emiterów).
--
-- ZMIANA
--   Pięć emiterów AFTER (rejestr S1, `src/lib/ci/hubDelivery.ts`):
--     * `tg_metering_settings_emit`, `tg_checkout_settings_emit`,
--       `tg_retention_settings_emit` - AFTER INSERT OR UPDATE; agregat =
--       nazwa tabeli, `aggregate_id = tenant_id` (jeden wiersz na najemcę);
--       payload `{op, keys}`, gdzie `keys` to POSORTOWANE NAZWY kolumn,
--       których wartość się zmieniła (porównanie `to_jsonb(NEW)` z
--       `to_jsonb(OLD)` bez `updated_at`, `updated_by`). Przy INSERT `keys` =
--       kolumny z wartością (bez `id, tenant_id, created_at, updated_at,
--       updated_by`). UPDATE bez zmiany wartości NIE emituje - zapis pełnym
--       wierszem z panelu (dziś norma) nie może zalewać szyny.
--       DLACZEGO TYLKO NAZWY: payload jest czytany przez realtime każdej
--       otwartej karty panelu i przez silnik ścieżek; wartości ustawień nie
--       są tam potrzebne (inwalidacja dociąga stan z bazy), a niektóre z nich
--       nie powinny krążyć po kanale zdarzeń (I8).
--     * `tg_content_access_emit` - AFTER INSERT OR UPDATE OR DELETE; agregat
--       `content_access`, `aggregate_id` = id reguły; payload `{entity_type,
--       entity_id, mode, metering_policy, op}`. UPDATE emituje przy zmianie
--       DOWOLNEJ kolumny poza `updated_at` - także hasła i podpowiedzi, bo
--       zmieniają, kto widzi treść; samego hasła (skrótu) i podpowiedzi
--       w payloadzie nie ma.
--     * `tg_retention_reasons_emit` - AFTER INSERT OR UPDATE OR DELETE;
--       agregat `retention_reason`, id wiersza, payload `{reason_id, op}`;
--       UPDATE tylko przy zmianie kolumny innej niż `updated_at`.
--   Aktor = domyślny `emit_domain_event` (`auth.uid()` sesji zapisującej).
--   Obsługa błędu wg kontraktu Z-02: ciało emitera w `EXCEPTION WHEN OTHERS`
--   zapisuje ślad przez `_log_emit_error(<tenant>, '<emiter>', '<typ>',
--   SQLSTATE, SQLERRM)` i zwraca NULL - zapis biznesowy nigdy nie pada przez
--   szynę, ale awaria nie znika bez śladu.
--   Granty: wyzwalacze bez EXECUTE dla PUBLIC, anon, authenticated i
--   service_role (macierz §4.4: `tg_*` = wewnętrzne).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090500 (`_log_emit_error`) i po regułach
-- inwalidacji I0 (typy są już w `DOMAIN_EVENT_TYPES`). Klient nie wymaga
-- zmian - zdarzenia tylko dokładają inwalidację.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe sygnatury, bez CIALO-Z),
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER, bezstanowe REVOKE. Zero DDL
-- kolumn i tabel.
-- DOWÓD: supabase/tests/hub_settings_events_test.sql (realne wiersze
-- `domain_events`, UPDATE bez zmiany = zero zdarzeń, `keys` bez wartości,
-- awaria `emit_domain_event` -> wiersz w `domain_event_emit_errors`, zapis
-- źródłowy przechodzi); src/lib/realtime/__tests__/domainEventCatalog.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Licznik artykułów (`metering_settings`, jeden wiersz na najemcę).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_metering_settings_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_keys jsonb;
BEGIN
  -- Nazwy kolumn, nie wartości: przy INSERT wszystkie ustawione, przy UPDATE
  -- tylko te, których wartość faktycznie się zmieniła.
  SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key), '[]'::jsonb)
    INTO v_keys
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key NOT IN ('id', 'tenant_id', 'created_at', 'updated_at', 'updated_by')
     AND CASE WHEN v_old IS NULL THEN n.value <> 'null'::jsonb
              ELSE n.value IS DISTINCT FROM v_old -> n.key END;
  IF jsonb_array_length(v_keys) = 0 THEN
    RETURN NULL;
  END IF;
  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'metering_settings', NEW.tenant_id::text, 'metering_settings.changed.v1',
    jsonb_build_object('op', lower(TG_OP), 'keys', v_keys)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_metering_settings_emit', 'metering_settings.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_metering_settings_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_metering_settings_emit() IS
  'Hub S1: metering_settings.changed.v1 {op, keys} - keys = nazwy zmienionych kolumn (bez wartości); UPDATE bez zmiany nie emituje.';

-- ----------------------------------------------------------------------------
-- 2. Ustawienia kasy (`checkout_settings`).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_checkout_settings_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_keys jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key), '[]'::jsonb)
    INTO v_keys
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key NOT IN ('id', 'tenant_id', 'created_at', 'updated_at', 'updated_by')
     AND CASE WHEN v_old IS NULL THEN n.value <> 'null'::jsonb
              ELSE n.value IS DISTINCT FROM v_old -> n.key END;
  IF jsonb_array_length(v_keys) = 0 THEN
    RETURN NULL;
  END IF;
  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'checkout_settings', NEW.tenant_id::text, 'checkout_settings.changed.v1',
    jsonb_build_object('op', lower(TG_OP), 'keys', v_keys)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_checkout_settings_emit', 'checkout_settings.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_checkout_settings_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_checkout_settings_emit() IS
  'Hub S1: checkout_settings.changed.v1 {op, keys} - keys = nazwy zmienionych kolumn (bez wartości); UPDATE bez zmiany nie emituje.';

-- ----------------------------------------------------------------------------
-- 3. Ustawienia retencji (`retention_settings`).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_retention_settings_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_keys jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key), '[]'::jsonb)
    INTO v_keys
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key NOT IN ('id', 'tenant_id', 'created_at', 'updated_at', 'updated_by')
     AND CASE WHEN v_old IS NULL THEN n.value <> 'null'::jsonb
              ELSE n.value IS DISTINCT FROM v_old -> n.key END;
  IF jsonb_array_length(v_keys) = 0 THEN
    RETURN NULL;
  END IF;
  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'retention_settings', NEW.tenant_id::text, 'retention_settings.changed.v1',
    jsonb_build_object('op', lower(TG_OP), 'keys', v_keys)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_retention_settings_emit', 'retention_settings.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_retention_settings_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_retention_settings_emit() IS
  'Hub S1: retention_settings.changed.v1 {op, keys} - keys = nazwy zmienionych kolumn (bez wartości); UPDATE bez zmiany nie emituje.';

-- ----------------------------------------------------------------------------
-- 4. Reguła dostępu do treści (`content_access`, wiersz na encję).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_content_access_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.content_access%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  -- Sam „dotyk" wiersza (zapis tych samych wartości, nowy `updated_at`) nie
  -- zmienia dostępu. Każda inna kolumna - także skrót hasła i podpowiedź -
  -- zmienia, kto widzi treść, więc emituje.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NULL;
  END IF;
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'content_access', v_row.id::text, 'content_access.changed.v1',
    jsonb_build_object(
      'entity_type', v_row.entity_type,
      'entity_id', v_row.entity_id,
      'mode', v_row.mode,
      'metering_policy', v_row.metering_policy,
      'op', lower(TG_OP)
    )
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    v_row.tenant_id, 'tg_content_access_emit', 'content_access.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_content_access_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_content_access_emit() IS
  'Hub S1: content_access.changed.v1 {entity_type, entity_id, mode, metering_policy, op} - bez hasła i podpowiedzi; UPDATE emituje przy zmianie dowolnej kolumny poza updated_at.';

-- ----------------------------------------------------------------------------
-- 5. Powody odejścia (`retention_reasons`).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_retention_reasons_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.retention_reasons%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NULL;
  END IF;
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'retention_reason', v_row.id::text, 'retention_reason.changed.v1',
    jsonb_build_object('reason_id', v_row.id, 'op', lower(TG_OP))
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    v_row.tenant_id, 'tg_retention_reasons_emit', 'retention_reason.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_retention_reasons_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_retention_reasons_emit() IS
  'Hub S1: retention_reason.changed.v1 {reason_id, op}; UPDATE emituje przy zmianie kolumny innej niż updated_at.';

-- ----------------------------------------------------------------------------
-- Wyzwalacze. `content_access` jest gorąca (czyta ją każdy odczyt wpisu za
-- paywallem): CREATE TRIGGER bierze blokadę SHARE ROW EXCLUSIVE, więc przy
-- zajętej tabeli migracja ma paść szybko (55P03 i ponowienie pliku), a nie
-- ustawić się w kolejce przed ruchem czytelników.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_metering_settings_emit ON public.metering_settings;
CREATE TRIGGER trg_metering_settings_emit
  AFTER INSERT OR UPDATE ON public.metering_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_metering_settings_emit();

DROP TRIGGER IF EXISTS trg_checkout_settings_emit ON public.checkout_settings;
CREATE TRIGGER trg_checkout_settings_emit
  AFTER INSERT OR UPDATE ON public.checkout_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_checkout_settings_emit();

DROP TRIGGER IF EXISTS trg_retention_settings_emit ON public.retention_settings;
CREATE TRIGGER trg_retention_settings_emit
  AFTER INSERT OR UPDATE ON public.retention_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_retention_settings_emit();

DROP TRIGGER IF EXISTS trg_content_access_emit ON public.content_access;
CREATE TRIGGER trg_content_access_emit
  AFTER INSERT OR UPDATE OR DELETE ON public.content_access
  FOR EACH ROW EXECUTE FUNCTION public.tg_content_access_emit();

DROP TRIGGER IF EXISTS trg_retention_reasons_emit ON public.retention_reasons;
CREATE TRIGGER trg_retention_reasons_emit
  AFTER INSERT OR UPDATE OR DELETE ON public.retention_reasons
  FOR EACH ROW EXECUTE FUNCTION public.tg_retention_reasons_emit();

RESET lock_timeout;
