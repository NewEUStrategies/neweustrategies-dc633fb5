-- Domkniecie rejestracji grupowej i podatku biletu.
--
-- 1. event_registration_form oddaje limit grupy (group_max_size) i tryb podatku
--    (tax_mode) kazdego biletu. Bez tego formularz zakladal sztywne 10 osob,
--    a karta biletu nie wiedziala, ze w kasie dojdzie podatek.
--
-- 2. Bilet z kodem QR dla kazdej przyjetej osoby. Baza trzyma wylacznie skrot
--    kodu (qr_token_hash), a jawny kod istnieje tylko w chwili wydania - dotad
--    gubil go trigger grupy, ksiegowanie platnosci i decyzja organizatora.
--    Wydanie idzie w trzech krokach, zeby awaria wysylki NIE gubila biletu:
--      a) `_event_issue_ticket_codes` ZAJMUJE zgloszenie (ticket_code_claimed_at,
--         dzierzawa 15 min), rotuje kod i oddaje go serwerowi;
--      b) serwer wysyla mail;
--      c) `_event_ticket_code_confirm` odnotowuje wysylke (ticket_code_sent_at)
--         albo zwalnia zgloszenie do ponowienia.
--    Proces, ktory padl miedzy a) i c), zwalnia zgloszenie sam - po wygasnieciu
--    dzierzawy. `_event_ticket_codes_pending` podaje zgloszenia bez biletu
--    niezaleznie od tego, CO je przyjelo (platnosc, decyzja organizatora,
--    awans z rezerwy, zapis bezplatny) - zbiera je cron co minute.
--    Gosc grupy dostaje tez wlasny klucz samoobslugi (manage_token).

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS ticket_code_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS ticket_code_claimed_at timestamptz;

-- Zgloszenia przyjete PRZED ta migracja nie dostaja maila wstecz: cron nie
-- moze wyslac setek biletow na wydarzenia, o ktorych uczestnicy juz wiedza.
UPDATE public.event_registrations r
SET ticket_code_sent_at = COALESCE(r.qr_issued_at, r.updated_at, now())
WHERE r.ticket_code_sent_at IS NULL
  AND r.status IN ('approved', 'attended')
  AND r.payment_status IN ('paid', 'not_required');

CREATE INDEX IF NOT EXISTS event_registrations_ticket_code_pending_idx
  ON public.event_registrations (created_at)
  WHERE ticket_code_sent_at IS NULL AND status IN ('approved', 'attended');

CREATE OR REPLACE FUNCTION public.event_registration_form(p_event_slug text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
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
  SELECT * INTO v_event FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'not_found: event does not exist'; END IF;
  v_seats_left := public._event_seats_left(v_tenant, v_event.id, NULL);
  SELECT count(*)::integer INTO v_active_tickets FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;
  v_reason := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL AND v_event.rsvp_opens_at > now()
      AND NOT (v_event.early_rsvp_rank IS NOT NULL AND public.has_tier_rank(v_event.early_rsvp_rank)) THEN 'registration_not_open'
    WHEN v_event.visibility = 'members' AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN 'membership_required'
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'
    ELSE NULL END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id,'key', f.key,'field_type', f.field_type,'label_pl', f.label_pl,'label_en', f.label_en,'help_pl', f.help_pl,'help_en', f.help_en,'is_required', f.is_required,'options', f.options,'sort_order', f.sort_order) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_fields FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant AND f.event_id = v_event.id AND f.is_active AND f.field_type <> 'consent';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id,'key', f.key,'field_type', f.field_type,'label_pl', f.label_pl,'label_en', f.label_en,'help_pl', f.help_pl,'help_en', f.help_en,'is_required', f.is_required,'options', f.options,'sort_order', f.sort_order) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_consents FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant AND f.event_id = v_event.id AND f.is_active AND f.field_type = 'consent';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'key', t.key, 'name_pl', t.name_pl, 'name_en', t.name_en,
    'description_pl', t.description_pl, 'description_en', t.description_en,
    'price_cents', t.price_cents,
    'effective_price_cents', public._event_ticket_price_now(t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule),
    'phase', public._event_ticket_phase(t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule, now()),
    'benefits_pl', to_jsonb(t.benefits_pl), 'benefits_en', to_jsonb(t.benefits_en),
    'requires_access_code', (t.access_code_hash IS NOT NULL), 'access_code_hint', t.access_code_hint,
    'currency', t.currency, 'requires_approval', t.requires_approval, 'min_tier_rank', t.min_tier_rank,
    'sales_from', t.sales_from, 'sales_to', t.sales_to,
    'seats_left', public._event_seats_left(v_tenant, v_event.id, t.id),
    'availability', CASE
      WHEN t.sales_from IS NOT NULL AND now() < t.sales_from THEN 'scheduled'
      WHEN t.sales_to IS NOT NULL AND now() > t.sales_to THEN 'ended'
      WHEN t.quota IS NOT NULL AND t.sold_count >= t.quota THEN 'sold_out'
      ELSE 'on_sale' END,
    'tier_locked', (t.min_tier_rank > 0 AND NOT public.has_tier_rank(t.min_tier_rank)),
    'sort_order', t.sort_order,
    'is_hidden', t.is_hidden, 'show_price_label', t.show_price_label,
    'price_label_pl', t.price_label_pl, 'price_label_en', t.price_label_en,
    'group_registration_enabled', t.group_registration_enabled,
    'group_max_size', t.group_max_size,
    'tax_mode', t.tax_mode
  ) ORDER BY t.sort_order, t.key), '[]'::jsonb)
  INTO v_tickets FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', tr.id,'key', tr.key,'label_pl', tr.label_pl,'label_en', tr.label_en,'body_pl', tr.body_pl,'body_en', tr.body_en,'external_url', tr.external_url,'is_required', tr.is_required,'version', tr.version,'sort_order', tr.sort_order) ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
  INTO v_terms FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant AND tr.event_id = v_event.id AND tr.is_active AND tr.display IN ('registration', 'registration_and_access');
  RETURN jsonb_build_object(
    'event', jsonb_build_object('id', v_event.id,'slug', v_event.slug,'title_pl', v_event.title_pl,'title_en', v_event.title_en,'starts_at', v_event.starts_at,'ends_at', v_event.ends_at,'timezone', v_event.timezone,'registration_mode', v_event.registration_mode,'registration_flow', v_event.registration_flow,'external_registration_url', v_event.external_registration_url,'capacity', v_event.capacity,'seats_left', v_seats_left,'rsvp_opens_at', v_event.rsvp_opens_at),
    'is_open', (v_reason IS NULL), 'closed_reason', v_reason,
    'fields', v_fields, 'consents', v_consents, 'tickets', v_tickets, 'terms', v_terms);
END;
$function$;

-- a) Zajecie i wydanie: zgloszenie wskazane przez serwer oraz jego goscie.
-- Tylko miejsca przyjete i rozliczone, jeszcze bez wyslanego biletu i bez
-- zywej dzierzawy - rownolegly proces nie zrotuje kodu, ktory wlasnie idzie
-- mailem. Wylacznie service_role: wynik niesie jawne kody.
CREATE OR REPLACE FUNCTION public._event_issue_ticket_codes(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  v_root public.event_registrations;
  r record;
  v_qr text;
  v_manage text;
  v_claim timestamptz := clock_timestamp();
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_root FROM public.event_registrations reg
  WHERE reg.id = p_registration_id;
  IF v_root.id IS NULL THEN RETURN v_out; END IF;

  FOR r IN
    SELECT reg.id, reg.tenant_id, reg.manage_token_hash,
           (reg.group_lead_registration_id IS NOT NULL) AS is_guest,
           p.email, p.first_name,
           lp.first_name AS lead_first_name, lp.last_name AS lead_last_name,
           e.slug AS event_slug, e.title_pl AS event_title_pl, e.title_en AS event_title_en,
           e.starts_at AS event_starts_at, e.timezone AS event_timezone, e.location AS event_location,
           tt.name_pl AS ticket_name_pl, tt.name_en AS ticket_name_en,
           COALESCE(
             CASE
               WHEN lower(NULLIF(pr.prefs->>'language', '')) IN ('pl', 'en')
                 THEN lower(pr.prefs->>'language')
               WHEN lower(NULLIF(pr.prefs->>'lang', '')) IN ('pl', 'en')
                 THEN lower(pr.prefs->>'lang')
               ELSE NULL
             END,
             (
               SELECT lower(ns.language)
               FROM public.newsletter_subscribers ns
               WHERE ns.tenant_id = reg.tenant_id
                 AND lower(ns.email) = lower(p.email)
                 AND lower(ns.language) IN ('pl', 'en')
               LIMIT 1
             ),
             'pl'
           ) AS lang
    FROM public.event_registrations reg
    JOIN public.event_people p ON p.id = reg.person_id AND p.tenant_id = reg.tenant_id
    JOIN public.events e ON e.id = reg.event_id AND e.tenant_id = reg.tenant_id
    LEFT JOIN public.profiles pr ON pr.id = p.user_id AND pr.tenant_id = reg.tenant_id
    LEFT JOIN public.event_ticket_types tt ON tt.id = reg.ticket_type_id AND tt.tenant_id = reg.tenant_id
    LEFT JOIN public.event_registrations lr
      ON lr.id = reg.group_lead_registration_id AND lr.tenant_id = reg.tenant_id
    LEFT JOIN public.event_people lp ON lp.id = lr.person_id AND lp.tenant_id = lr.tenant_id
    WHERE reg.tenant_id = v_root.tenant_id
      AND (reg.id = v_root.id OR reg.group_lead_registration_id = v_root.id)
      AND reg.status IN ('approved', 'attended')
      AND reg.payment_status IN ('paid', 'not_required')
      AND reg.ticket_code_sent_at IS NULL
      AND (reg.ticket_code_claimed_at IS NULL
           OR reg.ticket_code_claimed_at < now() - interval '15 minutes')
    ORDER BY (reg.id = v_root.id) DESC, reg.created_at, reg.id
    FOR UPDATE OF reg
  LOOP
    v_qr := public._event_new_qr_token();
    -- Klucz samoobslugi wydajemy gosciowi grupy (przy kazdym zajeciu - klucz
    -- z nieudanej wysylki nigdzie nie dotarl) i temu, kto go nie ma. Klucza
    -- z `event_register` nie rotujemy: uniewaznilby link z potwierdzenia zapisu.
    v_manage := CASE WHEN r.is_guest OR r.manage_token_hash IS NULL
                     THEN public._event_new_qr_token() END;
    UPDATE public.event_registrations reg SET
      qr_token_hash = encode(digest(v_qr, 'sha256'), 'hex'),
      qr_issued_at = now(),
      manage_token_hash = CASE WHEN v_manage IS NOT NULL
        THEN encode(digest(v_manage, 'sha256'), 'hex') ELSE reg.manage_token_hash END,
      ticket_code_claimed_at = v_claim,
      updated_at = now()
    WHERE reg.id = r.id AND reg.tenant_id = v_root.tenant_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'registration_id', r.id,
      'tenant_id', r.tenant_id,
      'claimed_at', v_claim,
      'is_guest', r.is_guest,
      'qr_token', v_qr,
      'manage_token', v_manage,
      'email', r.email,
      'first_name', r.first_name,
      'lang', r.lang,
      'lead_first_name', CASE WHEN r.is_guest THEN r.lead_first_name END,
      'lead_last_name', CASE WHEN r.is_guest THEN r.lead_last_name END,
      'event_slug', r.event_slug,
      'event_title_pl', r.event_title_pl,
      'event_title_en', r.event_title_en,
      'event_starts_at', r.event_starts_at,
      'event_timezone', r.event_timezone,
      'event_location', r.event_location,
      'ticket_name_pl', r.ticket_name_pl,
      'ticket_name_en', r.ticket_name_en));
  END LOOP;

  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public._event_issue_ticket_codes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_issue_ticket_codes(uuid) TO service_role;

-- c) Wynik wysylki. `p_claimed_at` wiaze potwierdzenie z TYM zajeciem: proces,
-- ktorego dzierzawa wygasla i ktory zostal wyprzedzony, nie odnotuje wysylki
-- kodu, ktory juz nie obowiazuje. Nieudana wysylka zwalnia zgloszenie od razu.
CREATE OR REPLACE FUNCTION public._event_ticket_code_confirm(
  p_registration_id uuid, p_claimed_at timestamptz, p_sent boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  UPDATE public.event_registrations reg SET
    ticket_code_sent_at = CASE WHEN p_sent THEN now() ELSE NULL END,
    ticket_code_claimed_at = CASE WHEN p_sent THEN reg.ticket_code_claimed_at ELSE NULL END,
    updated_at = now()
  WHERE reg.id = p_registration_id
    AND reg.ticket_code_claimed_at = p_claimed_at
    AND reg.ticket_code_sent_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_code_confirm(uuid, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_code_confirm(uuid, timestamptz, boolean) TO service_role;

-- Zgloszenia czekajace na bilet - dla crona. Wszystkie drogi przyjecia
-- (platnosc, decyzja organizatora, awans z rezerwy, zapis bezplatny) koncza
-- sie tym samym stanem wiersza, wiec jedno zapytanie lapie kazda z nich.
-- Tylko zapis formularzowy i wydarzenia, ktore sie jeszcze nie skonczyly.
CREATE OR REPLACE FUNCTION public._event_ticket_codes_pending(p_limit integer DEFAULT 50)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE(array_agg(q.id ORDER BY q.created_at), ARRAY[]::uuid[])
  FROM (
    SELECT reg.id, reg.created_at
    FROM public.event_registrations reg
    JOIN public.events e ON e.id = reg.event_id AND e.tenant_id = reg.tenant_id
    WHERE reg.ticket_code_sent_at IS NULL
      AND reg.status IN ('approved', 'attended')
      AND reg.payment_status IN ('paid', 'not_required')
      AND reg.registration_mode = 'form'
      AND (reg.ticket_code_claimed_at IS NULL
           OR reg.ticket_code_claimed_at < now() - interval '15 minutes')
      AND COALESCE(e.ends_at, e.starts_at + interval '1 day') > now()
    ORDER BY reg.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  ) q;
$$;
REVOKE ALL ON FUNCTION public._event_ticket_codes_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_codes_pending(integer) TO service_role;
