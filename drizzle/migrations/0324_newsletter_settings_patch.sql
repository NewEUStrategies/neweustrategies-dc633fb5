-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S1, 2/5): ZAPIS USTAWIEŃ NEWSLETTERA GRUPAMI KOLUMN
-- Z OCHRONĄ PRZED NADPISANIEM, ZDARZENIE ZMIANY USTAWIEŃ, POWRÓT PO WYPISIE.
--
-- DEFEKT
--   1. Pięciu pisarzy `newsletter_settings` (przegląd, treść popupu,
--      przełącznik popupu, pola rejestracji, kreator) zapisuje CAŁY wiersz
--      ze swojego szkicu. Dwie karty panelu = ostatni zapis wygrywa i po
--      cichu cofa zmiany drugiej karty (lost update). Nic nie sprawdza też,
--      czy edytor pisze tylko kolumny swojej sekcji.
--   2. Zmiana ustawień newslettera nie emituje zdarzenia, więc hub i inne
--      karty widzą stan z cache.
--   3. Powrót subskrybenta po wypisie (ponowny zapis, potwierdzenie double
--      opt-in, zdjęcie blokady przez operatora) nie ma zdarzenia - lejek
--      i ścieżki nie odróżniają go od zwykłej zmiany wiersza.
--   4. Emiter subskrybentów połyka błędy bez śladu (`RETURN NEW` w handlerze).
--
-- ZMIANA
--   A. RPC `admin_newsletter_settings_patch(p_group, p_patch, p_expected_updated_at)`
--      (panel; bramka `is_admin_or_editor()` - autor 42501; najemca
--      `current_tenant_id()`, nigdy z parametru):
--        * `p_group` wybiera BIAŁĄ LISTĘ kolumn edytora (blok
--          `newsletter-groups` niżej - czyta go test parytetu TS
--          `NEWSLETTER_SETTINGS_GROUPS`); klucz spoza grupy odrzuca CAŁY
--          patch: 22023 `column_not_in_group:<kol>`; nieznana grupa 22023
--          `unknown_group`; patch niebędący obiektem 22023 `invalid_patch`;
--          wartość nie do zrzutowania na typ kolumny 22023 `invalid_value:<kol>`;
--        * CAS na `updated_at` wiersza: token różny od bieżącego -> 40001
--          `stale_write` (klient pobiera świeży wiersz i scala po kolumnach
--          patchu - D-S1-03). Brak wiersza i token NULL -> INSERT dla
--          najemcy (domyślne kolumn + patch); równoległy INSERT -> 40001;
--        * zapisywane są WYŁĄCZNIE kolumny, których wartość się zmienia
--          (dwie karty edytujące różne grupy nie nadpisują sobie kolumn),
--          plus `updated_by = auth.uid()`; patch bez zmian nie robi UPDATE;
--        * zwraca `{"updated_at": <timestamptz>, "changed": [<kolumny>]}`.
--      Dynamiczny SQL WYŁĄCZNIE na nazwach z białej listy (`format('%I')`
--      po walidacji); wartości idą parametrem (`jsonb_populate_record`), nie
--      sklejaniem tekstu.
--   B. `tg_newsletter_settings_emit` - `newsletter_settings.changed.v1`
--      `{op, keys}` (nazwy zmienionych kolumn, bez wartości; jak emitery
--      ustawień z 20261020100000), agregat `newsletter_settings`,
--      `aggregate_id = tenant_id`.
--   C. Redefinicja `tg_newsletter_subscribers_emit_events` (CIALO-Z
--      20260711220607): ciało przepisane 1:1 - payloady `subscribed`,
--      `confirmed`, `unsubscribed` BEZ ZMIAN (czytają je przepisy automatyzacji
--      i router integracji; PII w nich to zgłoszenie do I9) - plus OSOBNY
--      warunek `newsletter_subscriber.resubscribed.v1` `{subscriber_id, source,
--      user_id}`: przejście DO `subscribed|confirmed` ze stanu wypisanego.
--      Powrót w repo wygląda trojako i każdy wariant jest pokryty:
--        * `subscribeToNewsletter` bez double opt-in: upsert `status =
--          'subscribed'` BEZ zerowania `unsubscribed_at` (OLD.status =
--          'unsubscribed');
--        * z double opt-in: najpierw `pending` (unsubscribed_at zostaje),
--          potem potwierdzenie `pending -> subscribed` (OLD.unsubscribed_at
--          IS NOT NULL) - zdarzenie powstaje przy POTWIERDZENIU, nie przy
--          samym zgłoszeniu;
--        * `email_suppression_release(p_resubscribe => true)`: `unsubscribed
--          -> subscribed` z wyzerowaniem `unsubscribed_at`.
--      Warunek wymaga zmiany statusu, więc zwykłe UPDATE-y wiersza
--      subskrybenta, który kiedyś się wypisał, nie emitują ponownie.
--      Handler zapisuje ślad awarii (`_log_emit_error`, kontrakt Z-02).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090500 i 20261020100000. Klient (S1/T2:
-- `usePatchNewsletterSettings`) woła RPC dopiero po wdrożeniu; do tego czasu
-- stare zapisy pełnym wierszem działają bez zmian (RPC niczego nie odbiera).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (redefinicja z CIALO-Z + dwie nowe
-- sygnatury), DROP TRIGGER IF EXISTS + CREATE TRIGGER, bezstanowe REVOKE/GRANT.
-- Zero DDL kolumn i tabel.
-- DOWÓD: supabase/tests/newsletter_settings_patch_test.sql (biała lista per
-- grupa, 40001, sekwencja grup A->B bez nadpisania, INSERT przy braku wiersza,
-- role, izolacja najemców, `keys`, `resubscribed` raz przy powrocie, regresja
-- trzech istniejących payloadów).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Zapis grupą kolumn z CAS.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_newsletter_settings_patch(
  p_group text,
  p_patch jsonb,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_allowed text[];
  v_key text;
  v_row public.newsletter_settings%ROWTYPE;
  v_new public.newsletter_settings%ROWTYPE;
  v_changed text[];
  v_updated_at timestamptz;
BEGIN
  IF NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Grupy = biała lista kolumn per EDYTOR (mogą się nakładać: przełącznik
  -- popupu jest i w przeglądzie, i w treści popupu). Każda kolumna tabeli
  -- poza `tenant_id`, `updated_at`, `updated_by` należy do co najmniej
  -- jednej grupy - nowa kolumna bez grupy jest niezapisywalna z panelu
  -- (test parytetu TS i pgTAP to wychwytują). Format linii czyta test
  -- parytetu `NEWSLETTER_SETTINGS_GROUPS`; lista w kodzie poniżej jest
  -- identyczna.
  -- newsletter-groups:begin
  --   overview: enabled, mode, double_opt_in, sender_name, sender_email, popup_enabled, popup_trigger, popup_delay_seconds, popup_scroll_percent, popup_frequency_days
  --   popup: popup_enabled, popup_trigger, popup_delay_seconds, popup_scroll_percent, popup_frequency_days, popup_cover_url, popup_title_pl, popup_title_en, popup_description_pl, popup_description_en, popup_cta_pl, popup_cta_en, popup_layout, popup_side_image_url, popup_extended_fields, popup_require_terms, popup_terms_html_pl, popup_terms_html_en, popup_mailing_lists, popup_showcase_images, popup_showcase_brand_pl, popup_showcase_brand_en, popup_showcase_tagline_pl, popup_showcase_tagline_en, popup_showcase_rotate_ms, popup_showcase_side, popup_showcase_grad_from, popup_showcase_grad_to, popup_showcase_show_brand, popup_showcase_show_caption, popup_showcase_show_dots, popup_fields, popup_design, popup_note_pl, popup_note_en, popup_require_privacy, popup_privacy_html_pl, popup_privacy_html_en, popup_bg_color, popup_text_color, popup_muted_color, popup_accent_color, popup_accent_text_color, popup_overlay_color, popup_border_radius_px, popup_eyebrow_pl, popup_eyebrow_en
  --   registration: popup_fields
  --   builder: inline_doc, popup_doc
  --   inline: heading_pl, heading_en, description_pl, description_en, policy_html_pl, policy_html_en, success_message_pl, success_message_en
  -- newsletter-groups:end
  v_allowed := CASE p_group
    WHEN 'overview' THEN ARRAY[
      'enabled', 'mode', 'double_opt_in', 'sender_name', 'sender_email', 'popup_enabled',
      'popup_trigger', 'popup_delay_seconds', 'popup_scroll_percent', 'popup_frequency_days']
    WHEN 'popup' THEN ARRAY[
      'popup_enabled', 'popup_trigger', 'popup_delay_seconds', 'popup_scroll_percent',
      'popup_frequency_days', 'popup_cover_url', 'popup_title_pl', 'popup_title_en',
      'popup_description_pl', 'popup_description_en', 'popup_cta_pl', 'popup_cta_en',
      'popup_layout', 'popup_side_image_url', 'popup_extended_fields', 'popup_require_terms',
      'popup_terms_html_pl', 'popup_terms_html_en', 'popup_mailing_lists', 'popup_showcase_images',
      'popup_showcase_brand_pl', 'popup_showcase_brand_en', 'popup_showcase_tagline_pl',
      'popup_showcase_tagline_en', 'popup_showcase_rotate_ms', 'popup_showcase_side',
      'popup_showcase_grad_from', 'popup_showcase_grad_to', 'popup_showcase_show_brand',
      'popup_showcase_show_caption', 'popup_showcase_show_dots', 'popup_fields', 'popup_design',
      'popup_note_pl', 'popup_note_en', 'popup_require_privacy', 'popup_privacy_html_pl',
      'popup_privacy_html_en', 'popup_bg_color', 'popup_text_color', 'popup_muted_color',
      'popup_accent_color', 'popup_accent_text_color', 'popup_overlay_color',
      'popup_border_radius_px', 'popup_eyebrow_pl', 'popup_eyebrow_en']
    WHEN 'registration' THEN ARRAY['popup_fields']
    WHEN 'builder' THEN ARRAY['inline_doc', 'popup_doc']
    WHEN 'inline' THEN ARRAY[
      'heading_pl', 'heading_en', 'description_pl', 'description_en', 'policy_html_pl',
      'policy_html_en', 'success_message_pl', 'success_message_en']
  END;
  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'unknown_group' USING ERRCODE = '22023';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_patch' USING ERRCODE = '22023';
  END IF;

  -- Cały patch albo nic: pierwsza (alfabetycznie) kolumna spoza grupy
  -- odrzuca zapis, zanim cokolwiek zostanie dotknięte.
  SELECT k INTO v_key
    FROM jsonb_object_keys(p_patch) AS k
   WHERE NOT (k = ANY (v_allowed))
   ORDER BY k
   LIMIT 1;
  IF v_key IS NOT NULL THEN
    RAISE EXCEPTION 'column_not_in_group:%', v_key USING ERRCODE = '22023';
  END IF;

  -- Rzutowanie per kolumna: błąd typu wskazuje KONKRETNĄ kolumnę zamiast
  -- ogólnego 22P02 z całego wiersza.
  FOR v_key IN SELECT k FROM jsonb_object_keys(p_patch) AS k ORDER BY k LOOP
    BEGIN
      PERFORM jsonb_populate_record(
        NULL::public.newsletter_settings, jsonb_build_object(v_key, p_patch -> v_key));
    EXCEPTION WHEN data_exception THEN
      RAISE EXCEPTION 'invalid_value:%', v_key USING ERRCODE = '22023';
    END;
  END LOOP;

  SELECT * INTO v_row FROM public.newsletter_settings WHERE tenant_id = v_tenant FOR UPDATE;

  IF NOT FOUND THEN
    -- Token przy braku wiersza = klient widział wiersz, którego już nie ma.
    IF p_expected_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = '40001';
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_changed FROM jsonb_object_keys(p_patch) AS k;
    IF v_changed IS NULL THEN
      RETURN jsonb_build_object('updated_at', NULL, 'changed', '[]'::jsonb);
    END IF;
    -- Kolumny spoza patchu biorą DEFAULT tabeli (pierwszy zapis najemcy).
    v_new := jsonb_populate_record(NULL::public.newsletter_settings, p_patch);
    BEGIN
      EXECUTE format(
        'INSERT INTO public.newsletter_settings (tenant_id, updated_by, %s) SELECT $1, $2, %s RETURNING updated_at',
        (SELECT string_agg(format('%I', c), ', ' ORDER BY c) FROM unnest(v_changed) AS c),
        (SELECT string_agg(format('($3).%I', c), ', ' ORDER BY c) FROM unnest(v_changed) AS c))
        USING v_tenant, auth.uid(), v_new
        INTO v_updated_at;
    EXCEPTION WHEN unique_violation THEN
      -- Równoległy pierwszy zapis innej karty: ten klient pracował na
      -- stanie „brak wiersza", który właśnie przestał być prawdą.
      RAISE EXCEPTION 'stale_write' USING ERRCODE = '40001';
    END;
    RETURN jsonb_build_object('updated_at', v_updated_at, 'changed', to_jsonb(v_changed));
  END IF;

  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = '40001';
  END IF;

  v_new := jsonb_populate_record(v_row, p_patch);
  SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
    FROM jsonb_each(to_jsonb(v_new)) AS n
   WHERE p_patch ? n.key
     AND n.value IS DISTINCT FROM to_jsonb(v_row) -> n.key;
  IF v_changed IS NULL THEN
    RETURN jsonb_build_object('updated_at', v_row.updated_at, 'changed', '[]'::jsonb);
  END IF;

  -- Tylko zmienione kolumny: kolumny innych grup zostają nietknięte, więc
  -- równoległy edytor innej sekcji nie traci swojego zapisu.
  EXECUTE format(
    'UPDATE public.newsletter_settings SET updated_by = $2, %s WHERE tenant_id = $3 RETURNING updated_at',
    (SELECT string_agg(format('%I = ($1).%I', c, c), ', ' ORDER BY c) FROM unnest(v_changed) AS c))
    USING v_new, auth.uid(), v_tenant
    INTO v_updated_at;

  RETURN jsonb_build_object('updated_at', v_updated_at, 'changed', to_jsonb(v_changed));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_settings_patch(text, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_settings_patch(text, jsonb, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_settings_patch(text, jsonb, timestamptz) IS
  'Hub S1: zapis ustawień newslettera grupą kolumn (biała lista per edytor) z CAS na updated_at (40001 stale_write); admin/editor, najemca z sesji. Zwraca {updated_at, changed}.';

-- ----------------------------------------------------------------------------
-- B. Zdarzenie zmiany ustawień newslettera.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_newsletter_settings_emit()
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
    NEW.tenant_id, 'newsletter_settings', NEW.tenant_id::text, 'newsletter_settings.changed.v1',
    jsonb_build_object('op', lower(TG_OP), 'keys', v_keys)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_newsletter_settings_emit', 'newsletter_settings.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_newsletter_settings_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_newsletter_settings_emit() IS
  'Hub S1: newsletter_settings.changed.v1 {op, keys} - keys = nazwy zmienionych kolumn (bez wartości); UPDATE bez zmiany nie emituje.';

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_newsletter_settings_emit ON public.newsletter_settings;
CREATE TRIGGER trg_newsletter_settings_emit
  AFTER INSERT OR UPDATE ON public.newsletter_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_newsletter_settings_emit();
RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- C. Emiter subskrybentów: ciało 1:1 + powrót po wypisie + ślad awarii.
-- Wyzwalacz `trg_newsletter_subscribers_emit_events` (AFTER INSERT OR UPDATE)
-- zostaje bez zmian - podmiana ciała funkcji nie bierze blokady na gorącej
-- tabeli subskrybentów.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260711220607
CREATE OR REPLACE FUNCTION public.tg_newsletter_subscribers_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Typ zdarzenia w toku - trafia do śladu awarii, gdy emisja padnie.
  v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_type := 'newsletter_subscriber.subscribed.v1';
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'newsletter_subscriber', NEW.id::text,
      'newsletter_subscriber.subscribed.v1',
      jsonb_build_object(
        'email', NEW.email, 'first_name', NEW.first_name,
        'last_name', NEW.last_name, 'language', NEW.language,
        'status', NEW.status, 'source', NEW.source
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
      v_type := 'newsletter_subscriber.confirmed.v1';
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'newsletter_subscriber', NEW.id::text,
        'newsletter_subscriber.confirmed.v1',
        jsonb_build_object(
          'email', NEW.email, 'first_name', NEW.first_name,
          'last_name', NEW.last_name, 'language', NEW.language,
          'source', NEW.source
        )
      );
    ELSIF NEW.unsubscribed_at IS NOT NULL AND OLD.unsubscribed_at IS NULL THEN
      v_type := 'newsletter_subscriber.unsubscribed.v1';
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'newsletter_subscriber', NEW.id::text,
        'newsletter_subscriber.unsubscribed.v1',
        jsonb_build_object('email', NEW.email)
      );
    END IF;

    -- Powrót po wypisie - OSOBNY warunek, nie gałąź ELSIF: potwierdzenie
    -- double opt-in po wcześniejszym wypisie jest jednocześnie `confirmed`
    -- i `resubscribed`, a ścieżki reagują na oba. Wymagana zmiana statusu,
    -- bo `unsubscribed_at` zostaje w wierszu po powrocie (zapis publiczny go
    -- nie zeruje) - bez tego każdy późniejszy UPDATE emitowałby ponownie.
    -- Payload bez PII (I8): identyfikatory i źródło zapisu.
    IF NEW.status IN ('subscribed', 'confirmed')
       AND NEW.status IS DISTINCT FROM OLD.status
       AND (OLD.status = 'unsubscribed' OR OLD.unsubscribed_at IS NOT NULL) THEN
      v_type := 'newsletter_subscriber.resubscribed.v1';
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'newsletter_subscriber', NEW.id::text,
        'newsletter_subscriber.resubscribed.v1',
        jsonb_build_object('subscriber_id', NEW.id, 'source', NEW.source, 'user_id', NEW.user_id)
      );
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_newsletter_subscribers_emit_events',
    COALESCE(v_type, 'newsletter_subscriber.unknown'), SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_newsletter_subscribers_emit_events() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_newsletter_subscribers_emit_events() IS
  'Emiter newsletter_subscriber.{subscribed,confirmed,unsubscribed}.v1 (payloady bez zmian od 20260711220607) + resubscribed.v1 {subscriber_id, source, user_id} przy przejściu ze stanu wypisanego do subscribed|confirmed (hub S1). Awaria -> domain_event_emit_errors.';
