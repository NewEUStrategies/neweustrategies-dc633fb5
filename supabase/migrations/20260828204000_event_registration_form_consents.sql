-- ============================================================================
-- `event_registration_form`: FORMULARZ NIE ODDAWAL POL ZGODY, A ZAPIS ICH WYMAGAL.
--
-- events-harness: include
--
-- CO BYLO ZLE (P1, PRZEBIEG ZABLOKOWANY - nie estetyka)
--
-- Migracja `20260827220945` rozdzielila formularz zapisu na dwie listy: pytania
-- kwalifikacyjne (`fields`) i zgody (`field_type = 'consent'`). Rozdzial jest
-- sluszny - zgoda stoi w formularzu ponizej regulaminow, a nie posrod pytan.
-- Wykonano jednak POLOWE tej zmiany: zapytanie o `fields` dostalo warunek
-- `AND f.field_type <> 'consent'`, a druga lista nie powstala i klucza `consents`
-- nie bylo w odpowiedzi wcale (`20260828051054`, linie 511 i 578-583).
--
-- W tej samej chwili `event_register` zaczal WYMAGAC, zeby kazde aktywne
-- i wymagane pole typu `consent` bylo zaznaczone:
--     RAISE EXCEPTION 'missing_required_consents: %', ...
--
-- Zlozenie tych dwoch faktow zamyka zapisy na gluchy zamek. Redaktor dodaje
-- w studiu wymagana zgode (nic go przed tym nie ostrzega), po czym:
--   * formularz publiczny NIE POKAZUJE tego pola - nie przyszlo w odpowiedzi,
--   * walidacja klienta go nie widzi - `isAnswered` chodzi po `form.fields`,
--   * serwer odrzuca KAZDA probe zapisu,
--   * a kod bledu `missing_required_consents` nie ma klucza tlumaczenia, wiec
--     uczestnik widzi generyczne „cos poszlo nie tak".
-- Wydarzenie przestaje przyjmowac zgloszenia i nic nie wskazuje przyczyny.
--
-- CO ROBI TA MIGRACJA
--
-- Dopisuje BRAKUJACA POLOWE: druga liste o tej samej projekcji, filtrowana na
-- `field_type = 'consent'`, oddawana jako klucz `consents`. Reszta ciala -
-- warunki otwarcia zapisow, bilety, regulaminy, liczba miejsc - jest
-- przeniesiona BEZ ZMIAN, znak w znak.
--
-- Klucz `fields` ZOSTAJE bez zgod. Sklejenie obu list z powrotem byloby
-- cofnieciem swiadomej decyzji o ukladzie formularza, a nie naprawa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.event_registration_form(p_event_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events;
  v_slug text := NULLIF(btrim(COALESCE(p_event_slug, '')), '');
  v_seats_left integer;
  v_reason text;
  v_fields jsonb;
  v_consents jsonb;
  v_tickets jsonb;
  v_terms jsonb;
  v_active_tickets integer;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_seats_left := public._event_seats_left(v_tenant, v_event.id, NULL);

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  v_reason := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL
      AND v_event.rsvp_opens_at > now()
      AND NOT (
        v_event.early_rsvp_rank IS NOT NULL
        AND public.has_tier_rank(v_event.early_rsvp_rank)
      ) THEN 'registration_not_open'
    WHEN v_event.visibility = 'members'
      AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN 'membership_required'
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'
    ELSE NULL
  END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'key', f.key,
    'field_type', f.field_type,
    'label_pl', f.label_pl,
    'label_en', f.label_en,
    'help_pl', f.help_pl,
    'help_en', f.help_en,
    'is_required', f.is_required,
    'options', f.options,
    'sort_order', f.sort_order
  ) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_fields
  FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant
    AND f.event_id = v_event.id
    AND f.is_active
    AND f.field_type <> 'consent';

  -- ZGODY. Ta sama tabela, ta sama projekcja, INNY ekran: pola zgody stoja
  -- w formularzu ponizej regulaminow, a nie posrod pytan kwalifikacyjnych.
  -- Podzial byl juz w kodzie (`f.field_type <> 'consent'` powyzej) - brakowalo
  -- wylacznie DRUGIEJ POLOWY, czyli tego zapytania i klucza w odpowiedzi.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'key', f.key,
    'field_type', f.field_type,
    'label_pl', f.label_pl,
    'label_en', f.label_en,
    'help_pl', f.help_pl,
    'help_en', f.help_en,
    'is_required', f.is_required,
    'options', f.options,
    'sort_order', f.sort_order
  ) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_consents
  FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant
    AND f.event_id = v_event.id
    AND f.is_active
    AND f.field_type = 'consent';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'key', t.key,
    'name_pl', t.name_pl,
    'name_en', t.name_en,
    'description_pl', t.description_pl,
    'description_en', t.description_en,
    'price_cents', t.price_cents,
    'effective_price_cents', public._event_ticket_price_now(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule),
    'phase', public._event_ticket_phase(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule, now()),
    'benefits_pl', to_jsonb(t.benefits_pl),
    'benefits_en', to_jsonb(t.benefits_en),
    'requires_access_code', (t.access_code_hash IS NOT NULL),
    'access_code_hint', t.access_code_hint,
    'currency', t.currency,
    'requires_approval', t.requires_approval,
    'min_tier_rank', t.min_tier_rank,
    'sales_from', t.sales_from,
    'sales_to', t.sales_to,
    'seats_left', public._event_seats_left(v_tenant, v_event.id, t.id),
    'availability', CASE
      WHEN t.sales_from IS NOT NULL AND now() < t.sales_from THEN 'scheduled'
      WHEN t.sales_to IS NOT NULL AND now() > t.sales_to THEN 'ended'
      WHEN t.quota IS NOT NULL AND t.sold_count >= t.quota THEN 'sold_out'
      ELSE 'on_sale'
    END,
    'tier_locked', (t.min_tier_rank > 0 AND NOT public.has_tier_rank(t.min_tier_rank)),
    'sort_order', t.sort_order
  ) ORDER BY t.sort_order, t.key), '[]'::jsonb)
  INTO v_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tr.id,
    'key', tr.key,
    'label_pl', tr.label_pl,
    'label_en', tr.label_en,
    'body_pl', tr.body_pl,
    'body_en', tr.body_en,
    'external_url', tr.external_url,
    'is_required', tr.is_required,
    'version', tr.version,
    'sort_order', tr.sort_order
  ) ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
  INTO v_terms
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.display IN ('registration', 'registration_and_access');

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'timezone', v_event.timezone,
      'registration_mode', v_event.registration_mode,
      'registration_flow', v_event.registration_flow,
      'external_registration_url', v_event.external_registration_url,
      'capacity', v_event.capacity,
      'seats_left', v_seats_left,
      'rsvp_opens_at', v_event.rsvp_opens_at
    ),
    'is_open', (v_reason IS NULL),
    'closed_reason', v_reason,
    'fields', v_fields,
    'consents', v_consents,
    'tickets', v_tickets,
    'terms', v_terms
  );
END;
$$;
COMMENT ON FUNCTION public.event_registration_form(text) IS
  'Formularz zapisu dla strony publicznej: wydarzenie, stan otwarcia, pytania kwalifikacyjne (fields), ZGODY (consents), bilety i regulaminy. Klucz consents byl brakujaca polowa rozdzialu z 20260827220945 - bez niego wymagana zgoda blokowala zapisy na gluchy zamek.';
