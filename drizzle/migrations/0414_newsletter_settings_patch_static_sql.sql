-- migrations-mirror: supabase/migrations/20261117204500_newsletter_settings_patch_static_sql.sql
-- WYGENEROWANE przez `bun run migrations:mirror` z pliku wyzej - NIE EDYTUJ RECZNIE.
-- Zrodlo prawdy schematu: supabase/migrations. Ten plik to kopia dostawcza dla
-- migratora Drizzle platformy Lovable (drizzle.config.ts); bramka
-- check:migration-lanes pilnuje, ze jego SQL wykonywalny == zrodlo.

-- ============================================================================
-- USTAWIENIA NEWSLETTERA: ZAPIS GRUPĄ KOLUMN BEZ SQL SKŁADANEGO W LOCIE.
--
-- PRZYCZYNA (skan bezpieczeństwa, kontrola LOV.DB.FUNCTION_DEFINER_EXECUTABLE.V1)
--   `admin_newsletter_settings_patch` (20261020100100) jest SECURITY DEFINER,
--   ma EXECUTE dla `authenticated` i budowała INSERT/UPDATE przez
--   `EXECUTE format(...)` z nazw kolumn wziętych z kluczy patcha. Nazwy
--   przechodziły białą listę i `%I`, a wartości szły parametrem, więc
--   wstrzyknięcia nie było - ale bezpieczeństwo zależało od tego, czy KAŻDA
--   przyszła zmiana zachowa walidację przed sklejeniem tekstu. Funkcja
--   z prawami właściciela nie powinna nigdy wykonywać tekstu, na który ma
--   wpływ wołający.
--
-- ZMIANA (sygnatura, ACL, kody błędów i kształt wyniku bez zmian)
--   * Zero dynamicznego SQL. Zapis to jedno STATYCZNE `UPDATE` z jawną listą
--     kolumn `<kol> = v_new.<kol>`; `v_new` = wiersz zablokowany `FOR UPDATE`
--     z nałożonym patchem (`jsonb_populate_record`). Kolumny spoza patcha
--     dostają wartość, którą już mają pod blokadą, więc równoległy edytor
--     innej grupy nadal nie traci zapisu (CAS na `updated_at` bez zmian).
--   * Brak wiersza: statyczny `INSERT (tenant_id, updated_by)` zakłada wiersz
--     z DOMYŚLNYMI tabeli, a patch nakłada ten sam `UPDATE`. Skutek widoczny:
--     pierwszy zapis najemcy emituje `newsletter_settings.changed.v1` dwa
--     razy (`insert` z kolumnami domyślnymi, `update` z kolumnami patcha)
--     zamiast raz - konsumenci tylko unieważniają cache, więc to bezpieczne.
--   * Straż kompletności: po `UPDATE` wiersz musi być równy `v_new` (poza
--     `updated_at`/`updated_by`). Kolumna dodana do grupy bez dopisania do
--     listy `SET` odrzuca zapis kodem XX000 `unmapped_column` zamiast po
--     cichu zgubić wartość; pgTAP i test parytetu TS pilnują listy wcześniej.
--   * Bramka `is_admin_or_editor()`, najemca `current_tenant_id()` z sesji,
--     `search_path` przypięty - bez zmian.
--
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION + bezstanowe REVOKE/GRANT.
-- Zero DDL tabel i kolumn.
-- DOWÓD: supabase/tests/newsletter_settings_patch_test.sql,
-- src/lib/newsletter/__tests__/settingsQueries.groupsParity.test.ts.
-- ============================================================================

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
  v_inserted boolean := false;
  v_row public.newsletter_settings%ROWTYPE;
  v_new public.newsletter_settings%ROWTYPE;
  v_after public.newsletter_settings%ROWTYPE;
  v_changed text[];
BEGIN
  IF NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Grupy = biała lista kolumn per EDYTOR (mogą się nakładać). Blok niżej
  -- czyta test parytetu TS `NEWSLETTER_SETTINGS_GROUPS`; lista w kodzie
  -- poniżej jest identyczna.
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

  -- Rzutowanie per kolumna: błąd typu wskazuje KONKRETNĄ kolumnę.
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
    IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch)) THEN
      RETURN jsonb_build_object('updated_at', NULL, 'changed', '[]'::jsonb);
    END IF;
    -- Pierwszy zapis najemcy: wiersz z DOMYŚLNYMI tabeli; patch nakłada
    -- niżej ten sam statyczny UPDATE co dla istniejącego wiersza.
    BEGIN
      INSERT INTO public.newsletter_settings (tenant_id, updated_by)
      VALUES (v_tenant, auth.uid())
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      -- Równoległy pierwszy zapis innej karty.
      RAISE EXCEPTION 'stale_write' USING ERRCODE = '40001';
    END;
    v_inserted := true;
  ELSIF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = '40001';
  END IF;

  v_new := jsonb_populate_record(v_row, p_patch);
  SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
    FROM jsonb_each(to_jsonb(v_new)) AS n
   WHERE p_patch ? n.key
     AND n.value IS DISTINCT FROM to_jsonb(v_row) -> n.key;

  IF v_changed IS NOT NULL THEN
    -- Statyczna lista kolumn (bez tenant_id, updated_at, updated_by).
    -- write-columns:begin
    UPDATE public.newsletter_settings
       SET updated_by = auth.uid(),
         heading_pl = v_new.heading_pl,
         heading_en = v_new.heading_en,
         description_pl = v_new.description_pl,
         description_en = v_new.description_en,
         policy_html_pl = v_new.policy_html_pl,
         policy_html_en = v_new.policy_html_en,
         success_message_pl = v_new.success_message_pl,
         success_message_en = v_new.success_message_en,
         double_opt_in = v_new.double_opt_in,
         enabled = v_new.enabled,
         popup_enabled = v_new.popup_enabled,
         popup_trigger = v_new.popup_trigger,
         popup_delay_seconds = v_new.popup_delay_seconds,
         popup_scroll_percent = v_new.popup_scroll_percent,
         popup_frequency_days = v_new.popup_frequency_days,
         popup_cover_url = v_new.popup_cover_url,
         popup_title_pl = v_new.popup_title_pl,
         popup_title_en = v_new.popup_title_en,
         popup_description_pl = v_new.popup_description_pl,
         popup_description_en = v_new.popup_description_en,
         popup_cta_pl = v_new.popup_cta_pl,
         popup_cta_en = v_new.popup_cta_en,
         popup_layout = v_new.popup_layout,
         popup_side_image_url = v_new.popup_side_image_url,
         popup_extended_fields = v_new.popup_extended_fields,
         popup_require_terms = v_new.popup_require_terms,
         popup_terms_html_pl = v_new.popup_terms_html_pl,
         popup_terms_html_en = v_new.popup_terms_html_en,
         popup_mailing_lists = v_new.popup_mailing_lists,
         popup_bg_color = v_new.popup_bg_color,
         popup_text_color = v_new.popup_text_color,
         popup_muted_color = v_new.popup_muted_color,
         popup_accent_color = v_new.popup_accent_color,
         popup_accent_text_color = v_new.popup_accent_text_color,
         popup_overlay_color = v_new.popup_overlay_color,
         popup_border_radius_px = v_new.popup_border_radius_px,
         popup_eyebrow_pl = v_new.popup_eyebrow_pl,
         popup_eyebrow_en = v_new.popup_eyebrow_en,
         mode = v_new.mode,
         inline_doc = v_new.inline_doc,
         popup_doc = v_new.popup_doc,
         sender_name = v_new.sender_name,
         sender_email = v_new.sender_email,
         popup_showcase_images = v_new.popup_showcase_images,
         popup_showcase_brand_pl = v_new.popup_showcase_brand_pl,
         popup_showcase_brand_en = v_new.popup_showcase_brand_en,
         popup_showcase_tagline_pl = v_new.popup_showcase_tagline_pl,
         popup_showcase_tagline_en = v_new.popup_showcase_tagline_en,
         popup_showcase_rotate_ms = v_new.popup_showcase_rotate_ms,
         popup_showcase_side = v_new.popup_showcase_side,
         popup_showcase_grad_from = v_new.popup_showcase_grad_from,
         popup_showcase_grad_to = v_new.popup_showcase_grad_to,
         popup_showcase_show_brand = v_new.popup_showcase_show_brand,
         popup_showcase_show_caption = v_new.popup_showcase_show_caption,
         popup_showcase_show_dots = v_new.popup_showcase_show_dots,
         popup_fields = v_new.popup_fields,
         popup_note_pl = v_new.popup_note_pl,
         popup_note_en = v_new.popup_note_en,
         popup_require_privacy = v_new.popup_require_privacy,
         popup_privacy_html_pl = v_new.popup_privacy_html_pl,
         popup_privacy_html_en = v_new.popup_privacy_html_en,
         popup_design = v_new.popup_design
     WHERE tenant_id = v_tenant
    RETURNING * INTO v_after;
    -- write-columns:end

    IF (to_jsonb(v_after) - ARRAY['updated_at', 'updated_by'])
       IS DISTINCT FROM (to_jsonb(v_new) - ARRAY['updated_at', 'updated_by']) THEN
      RAISE EXCEPTION 'unmapped_column' USING ERRCODE = 'XX000';
    END IF;
    v_row := v_after;
  END IF;

  IF v_inserted THEN
    -- Kontrakt pierwszego zapisu: `changed` = wszystkie kolumny patcha.
    SELECT array_agg(k ORDER BY k) INTO v_changed FROM jsonb_object_keys(p_patch) AS k;
  END IF;

  RETURN jsonb_build_object(
    'updated_at', v_row.updated_at,
    'changed', COALESCE(to_jsonb(v_changed), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_settings_patch(text, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_settings_patch(text, jsonb, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_settings_patch(text, jsonb, timestamptz) IS
  'Hub S1: zapis ustawień newslettera grupą kolumn (biała lista per edytor) z CAS na updated_at (40001 stale_write); admin/editor, najemca z sesji; statyczny SQL, bez dynamicznego wykonania. Zwraca {updated_at, changed}.';
