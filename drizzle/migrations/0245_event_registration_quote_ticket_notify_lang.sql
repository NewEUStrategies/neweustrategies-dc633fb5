CREATE OR REPLACE FUNCTION public._tg_event_registration_quote_follows_ticket()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id
     AND NEW.quoted_price_cents IS NOT DISTINCT FROM OLD.quoted_price_cents
     AND NEW.quoted_currency IS NOT DISTINCT FROM OLD.quoted_currency
     AND NEW.quote_valid_until IS NOT DISTINCT FROM OLD.quote_valid_until THEN
    NEW.quoted_price_cents := NULL;
    NEW.quoted_currency := NULL;
    NEW.quote_valid_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_registration_quote_follows_ticket() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_registration_quote_follows_ticket() IS
  'R38/REG-16 (D8): oferta ceny zgloszenia nalezy do biletu - zmiana ticket_type_id kasuje quoted_price_cents/quoted_currency/quote_valid_until (cena wraca do biezacej ceny nowego biletu), chyba ze ten sam UPDATE sam ustawia oferte. Wyzwalacz event_registrations_02_quote_follows_ticket.';

DROP TRIGGER IF EXISTS event_registrations_02_quote_follows_ticket ON public.event_registrations;
CREATE TRIGGER event_registrations_02_quote_follows_ticket
  BEFORE UPDATE OF ticket_type_id ON public.event_registrations
  FOR EACH ROW
  WHEN (OLD.ticket_type_id IS DISTINCT FROM NEW.ticket_type_id)
  EXECUTE FUNCTION public._tg_event_registration_quote_follows_ticket();

CREATE OR REPLACE FUNCTION public.event_registration_notify_payload_for_tenant(_tenant_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_key record;
  v_out jsonb;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant is required';
  END IF;
  IF v_manage IS NULL THEN
    RAISE EXCEPTION 'invalid_request: manage_token is required';
  END IF;

  SELECT k.registration_id, k.verdict
    INTO v_key
    FROM public._event_manage_token_resolve(_tenant_id, v_manage, 'contact') k;

  IF v_key.verdict = 'expired' THEN
    RAISE EXCEPTION 'manage_expired: this management link expired when the event ended';
  ELSIF v_key.verdict IS DISTINCT FROM 'ok' THEN
    -- 'closed' i 'not_found' celowo tym samym kodem: zamkniete zgloszenie nie
    -- oddaje danych kontaktowych i nie potwierdza, ze klucz kiedys dzialal.
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  SELECT jsonb_build_object(
    'registration_id', r.id,
    'tenant_id', r.tenant_id,
    'status', r.status,
    'waitlist_position', r.waitlist_position,
    'email', p.email,
    'first_name', p.first_name,
    -- ZMIANA 20261012 (R38): jezyk ZGLOSZENIA (formularz wypelniony po
    -- angielsku = potwierdzenie po angielsku), potem profil, newsletter,
    -- prowadzacy grupy, `pl` - ta sama kaskada co dostawa zapisu (mail DOI,
    -- „juz zapisany"), wiec jedno zgloszenie dostaje maile w jednym jezyku.
    'lang', public._event_registration_lang(r.tenant_id, r.id),
    'event_id', e.id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone,
    'event_location', e.location,
    'ticket_name_pl', tt.name_pl,
    'ticket_name_en', tt.name_en
  )
  INTO v_out
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  JOIN public.events e
    ON e.id = r.event_id AND e.tenant_id = r.tenant_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
  WHERE r.tenant_id = _tenant_id
    AND r.id = v_key.registration_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_notify_payload_for_tenant(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_registration_notify_payload_for_tenant(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_registration_notify_payload_for_tenant(uuid, jsonb) IS
  'REG-17: dane WLASNEGO zgloszenia do maila po kluczu manage_token, najemca z argumentu (serwer: zaufany host). Klucz przez _event_manage_token_resolve(contact): po koncu wydarzenia manage_expired, po anulowaniu/odrzuceniu not_found. Bez decision_note i last_name. lang z _event_registration_lang (jezyk zgloszenia -> profil -> newsletter -> prowadzacy grupy -> pl; R38). Tylko service_role.';