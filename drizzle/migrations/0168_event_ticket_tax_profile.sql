ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS vat_rate text,
  ADD COLUMN IF NOT EXISTS vat_exempt_basis text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_tax_code text;
ALTER TABLE public.event_ticket_packages
  ADD COLUMN IF NOT EXISTS vat_rate text,
  ADD COLUMN IF NOT EXISTS vat_exempt_basis text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_tax_code text;
DO $$ BEGIN
  ALTER TABLE public.event_ticket_types ADD CONSTRAINT event_ticket_types_vat_rate_values
    CHECK (vat_rate IS NULL OR vat_rate IN ('23', '8', '5', '0', 'zw', 'np'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_ticket_types ADD CONSTRAINT event_ticket_types_vat_exempt_basis_len
    CHECK (char_length(vat_exempt_basis) <= 300);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_ticket_types ADD CONSTRAINT event_ticket_types_stripe_tax_code_shape
    CHECK (stripe_tax_code IS NULL OR stripe_tax_code ~ '^txcd_[0-9]{8}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_ticket_packages ADD CONSTRAINT event_ticket_packages_vat_rate_values
    CHECK (vat_rate IS NULL OR vat_rate IN ('23', '8', '5', '0', 'zw', 'np'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_ticket_packages ADD CONSTRAINT event_ticket_packages_vat_exempt_basis_len
    CHECK (char_length(vat_exempt_basis) <= 300);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_ticket_packages ADD CONSTRAINT event_ticket_packages_stripe_tax_code_shape
    CHECK (stripe_tax_code IS NULL OR stripe_tax_code ~ '^txcd_[0-9]{8}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON COLUMN public.event_ticket_types.vat_rate IS
  'Stawka VAT biletu na fakturze (23/8/5/0/zw/np). NULL = domyslna stawka najemcy (event_invoice_settings.default_vat_rate).';
COMMENT ON COLUMN public.event_ticket_types.vat_exempt_basis IS
  'Podstawa prawna zwolnienia dla stawki zw (np. art. 43 ust. 1 pkt 29 ustawy o VAT). Pusta = podstawa z ustawien najemcy.';
COMMENT ON COLUMN public.event_ticket_types.stripe_tax_code IS
  'Kod podatkowy produktu Stripe (txcd_########) przekazywany do price_data.product_data.tax_code sesji biletu - Stripe Tax liczy z niego stawke zgodna z faktura.';
CREATE OR REPLACE FUNCTION public.event_ticket_public_options(p_ticket_type_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'tax_mode', t.tax_mode,
    'group_registration_enabled', t.group_registration_enabled,
    'group_max_size', t.group_max_size,
    'vat_rate', t.vat_rate,
    'stripe_tax_code', t.stripe_tax_code)
  FROM public.event_ticket_types t
  WHERE t.id = p_ticket_type_id AND t.tenant_id = public.public_tenant_id() AND t.is_active;
$function$;
CREATE OR REPLACE FUNCTION public.admin_event_ticket_tax_profile(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id,
      'vat_rate', t.vat_rate,
      'vat_exempt_basis', t.vat_exempt_basis,
      'stripe_tax_code', t.stripe_tax_code
    ) ORDER BY t.sort_order, t.id)
    FROM public.event_ticket_types t
    WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_event_ticket_tax_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_tax_profile(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.admin_event_ticket_set_tax_profile(p_ticket_id uuid, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_rate text := NULLIF(btrim(COALESCE(p_payload->>'vat_rate', '')), '');
  v_basis text := btrim(COALESCE(p_payload->>'vat_exempt_basis', ''));
  v_code text := NULLIF(btrim(COALESCE(p_payload->>'stripe_tax_code', '')), '');
BEGIN
  IF v_rate IS NOT NULL AND v_rate NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
    RAISE EXCEPTION 'invalid_vat_rate: unknown VAT rate' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_basis) > 300 THEN
    RAISE EXCEPTION 'invalid_exempt_basis: the legal basis has more than 300 characters' USING ERRCODE = '22023';
  END IF;
  IF v_code IS NOT NULL AND v_code !~ '^txcd_[0-9]{8}$' THEN
    RAISE EXCEPTION 'invalid_tax_code: the Stripe tax code looks like txcd_12345678' USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_ticket_types t SET
    vat_rate = v_rate,
    vat_exempt_basis = v_basis,
    stripe_tax_code = v_code,
    updated_at = now()
  WHERE t.id = p_ticket_id AND t.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: ticket does not exist in this tenant';
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_event_ticket_set_tax_profile(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_set_tax_profile(uuid, jsonb) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.admin_event_package_terms(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'admit_before_payment', p.admit_before_payment,
      'payment_terms_days', p.payment_terms_days,
      'max_open_orders_per_buyer', p.max_open_orders_per_buyer,
      'vat_rate', p.vat_rate,
      'vat_exempt_basis', p.vat_exempt_basis,
      'stripe_tax_code', p.stripe_tax_code
    ) ORDER BY p.sort_order, p.key)
    FROM public.event_ticket_packages p
    WHERE p.tenant_id = v_tenant AND p.event_id = p_event_id
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_event_package_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_terms(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.admin_event_package_upsert(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_ticket_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_seats integer := (NULLIF(p_payload->>'seats', ''))::integer;
  v_sold integer;
  v_rate text := NULLIF(btrim(COALESCE(p_payload->>'vat_rate', '')), '');
  v_basis text := btrim(COALESCE(p_payload->>'vat_exempt_basis', ''));
  v_code text := NULLIF(btrim(COALESCE(p_payload->>'stripe_tax_code', '')), '');
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT p.event_id, p.sold_count INTO v_event_id, v_sold
    FROM public.event_ticket_packages p
    WHERE p.id = v_id AND p.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: package does not exist in this tenant';
    END IF;
  END IF;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;
  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;
  IF v_ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: ticket does not exist for this event';
  END IF;
  IF v_rate IS NOT NULL AND v_rate NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
    RAISE EXCEPTION 'invalid_vat_rate: unknown VAT rate' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_basis) > 300 THEN
    RAISE EXCEPTION 'invalid_exempt_basis: the legal basis has more than 300 characters' USING ERRCODE = '22023';
  END IF;
  IF v_code IS NOT NULL AND v_code !~ '^txcd_[0-9]{8}$' THEN
    RAISE EXCEPTION 'invalid_tax_code: the Stripe tax code looks like txcd_12345678' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NOT NULL THEN
    UPDATE public.event_ticket_packages p SET
      ticket_type_id = COALESCE(v_ticket_id, p.ticket_type_id),
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), p.description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), p.description_en),
      audience = COALESCE(NULLIF(p_payload->>'audience', ''), p.audience),
      seats = COALESCE(v_seats, p.seats),
      price_cents = COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, p.price_cents),
      currency = COALESCE(NULLIF(p_payload->>'currency', ''), p.currency),
      quota = CASE
        WHEN p_payload ? 'quota' THEN (NULLIF(p_payload->>'quota', ''))::integer
        ELSE p.quota
      END,
      sales_from = CASE
        WHEN p_payload ? 'sales_from' THEN (NULLIF(p_payload->>'sales_from', ''))::timestamptz
        ELSE p.sales_from
      END,
      sales_to = CASE
        WHEN p_payload ? 'sales_to' THEN (NULLIF(p_payload->>'sales_to', ''))::timestamptz
        ELSE p.sales_to
      END,
      min_tier_rank = COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, p.min_tier_rank),
      requires_verification = COALESCE(
        (NULLIF(p_payload->>'requires_verification', ''))::boolean, p.requires_verification),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, p.is_active),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, p.sort_order),
      admit_before_payment = CASE
        WHEN p_payload ? 'admit_before_payment'
          THEN COALESCE((NULLIF(p_payload->>'admit_before_payment', ''))::boolean, false)
        ELSE p.admit_before_payment
      END,
      payment_terms_days = CASE
        WHEN p_payload ? 'payment_terms_days'
          THEN COALESCE((NULLIF(p_payload->>'payment_terms_days', ''))::integer, 14)
        ELSE p.payment_terms_days
      END,
      max_open_orders_per_buyer = CASE
        WHEN p_payload ? 'max_open_orders_per_buyer'
          THEN (NULLIF(p_payload->>'max_open_orders_per_buyer', ''))::integer
        ELSE p.max_open_orders_per_buyer
      END,
      vat_rate = CASE WHEN p_payload ? 'vat_rate' THEN v_rate ELSE p.vat_rate END,
      vat_exempt_basis = CASE
        WHEN p_payload ? 'vat_exempt_basis' THEN v_basis
        ELSE p.vat_exempt_basis
      END,
      stripe_tax_code = CASE WHEN p_payload ? 'stripe_tax_code' THEN v_code ELSE p.stripe_tax_code END
    WHERE p.id = v_id AND p.tenant_id = v_tenant;
    RETURN v_id;
  END IF;
  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;
  IF v_ticket_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: ticket_type_id is required';
  END IF;
  INSERT INTO public.event_ticket_packages (
    tenant_id, event_id, ticket_type_id, key, name_pl, name_en,
    description_pl, description_en, audience, seats, price_cents, currency,
    quota, sales_from, sales_to, min_tier_rank, requires_verification,
    is_active, sort_order,
    admit_before_payment, payment_terms_days, max_open_orders_per_buyer,
    vat_rate, vat_exempt_basis, stripe_tax_code
  ) VALUES (
    v_tenant, v_event_id, v_ticket_id, v_key, v_name_pl, v_name_en,
    btrim(COALESCE(p_payload->>'description_pl', '')),
    btrim(COALESCE(p_payload->>'description_en', '')),
    COALESCE(NULLIF(p_payload->>'audience', ''), 'company'),
    COALESCE(v_seats, 2),
    COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, 0),
    COALESCE(NULLIF(p_payload->>'currency', ''), 'PLN'),
    (NULLIF(p_payload->>'quota', ''))::integer,
    (NULLIF(p_payload->>'sales_from', ''))::timestamptz,
    (NULLIF(p_payload->>'sales_to', ''))::timestamptz,
    COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'requires_verification', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'admit_before_payment', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'payment_terms_days', ''))::integer, 14),
    CASE WHEN p_payload ? 'max_open_orders_per_buyer'
         THEN (NULLIF(p_payload->>'max_open_orders_per_buyer', ''))::integer ELSE 3 END,
    v_rate,
    v_basis,
    v_code
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public._event_invoice_source_tax_profile(p_tenant uuid, p_kind text, p_id uuid)
RETURNS TABLE(vat_rate text, vat_exempt_basis text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(pk.vat_rate, t.vat_rate),
         COALESCE(NULLIF(btrim(pk.vat_exempt_basis), ''), NULLIF(btrim(t.vat_exempt_basis), ''))
    FROM (SELECT 1) AS one
    LEFT JOIN public.event_registrations r
      ON p_kind = 'registration' AND r.id = p_id AND r.tenant_id = p_tenant
    LEFT JOIN public.event_package_orders po
      ON p_kind = 'package_order' AND po.id = p_id AND po.tenant_id = p_tenant
    LEFT JOIN public.event_ticket_packages pk
      ON pk.id = po.package_id AND pk.tenant_id = p_tenant
    LEFT JOIN public.event_ticket_types t
      ON t.id = COALESCE(r.ticket_type_id, pk.ticket_type_id) AND t.tenant_id = p_tenant;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_source_tax_profile(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_source_tax_profile(uuid, text, uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._event_invoice_draft_build(p_tenant uuid, p_actor uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settings public.event_invoice_settings;
  v_event record;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_kind text := COALESCE(NULLIF(p_payload->>'kind', ''), 'invoice');
  v_aggregate text := COALESCE(NULLIF(p_payload->>'aggregate', ''), 'per_source');
  v_sources jsonb := COALESCE(p_payload->'sources', '[]'::jsonb);
  v_locale text;
  v_rate text;
  v_item jsonb;
  v_skind text;
  v_sid uuid;
  v_seen uuid[] := '{}';
  v_resolved jsonb := '[]'::jsonb;
  v_currency text;
  v_buyer jsonb;
  v_request public.event_invoice_requests;
  v_request_id uuid := NULLIF(p_payload->>'request_id', '')::uuid;
  v_buyer_user uuid;
  v_buyer_person uuid;
  v_all_paid boolean;
  v_all_card boolean;
  v_paid_at timestamptz;
  v_payment_method text;
  v_sale_date date;
  v_invoice uuid;
  v_units jsonb := '[]'::jsonb;
  v_u bigint;
  v_r integer;
  v_group jsonb;
  v_qty integer;
  v_line record;
  v_ord integer := 0;
  v_note text := btrim(COALESCE(p_payload->>'note', ''));
  v_rate_forced boolean := NULLIF(p_payload->>'vat_rate', '') IS NOT NULL;
  v_line_rate text;
  v_src_rate text;
  v_src_basis text;
  v_basis text := '';
BEGIN
  SELECT * INTO v_settings FROM public.event_invoice_settings s WHERE s.tenant_id = p_tenant;
  IF NOT FOUND OR NOT v_settings.enabled THEN
    RAISE EXCEPTION 'invoicing_disabled: complete and confirm the issuer settings first'
      USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('invoice', 'proforma') THEN
    RAISE EXCEPTION 'invalid_kind: a draft is an invoice or a proforma' USING ERRCODE = '22023';
  END IF;
  IF v_aggregate NOT IN ('per_source', 'per_ticket_type') THEN
    RAISE EXCEPTION 'invalid_aggregate: lines are per source or per ticket type' USING ERRCODE = '22023';
  END IF;
  v_locale := COALESCE(NULLIF(p_payload->>'locale', ''), v_settings.default_locale);
  IF v_locale NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_locale: document language is pl or en' USING ERRCODE = '22023';
  END IF;
  v_rate := COALESCE(NULLIF(p_payload->>'vat_rate', ''), v_settings.default_vat_rate);
  IF v_rate NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
    RAISE EXCEPTION 'invalid_vat_rate: unknown VAT rate' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'invalid_note: note has more than 1000 characters' USING ERRCODE = '22023';
  END IF;
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.starts_at INTO v_event
    FROM public.events e
   WHERE e.id = v_event_id AND e.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(CASE WHEN jsonb_typeof(v_sources) = 'array' THEN jsonb_array_length(v_sources) END, 0) = 0 THEN
    RAISE EXCEPTION 'no_sources: pick at least one order' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_sources) > 200 THEN
    RAISE EXCEPTION 'too_many_sources: one document covers at most 200 orders' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_sources) LOOP
    v_skind := v_item->>'kind';
    v_sid := NULLIF(v_item->>'id', '')::uuid;
    IF v_sid IS NULL OR v_skind IS NULL OR v_skind NOT IN ('registration', 'package_order') THEN
      RAISE EXCEPTION 'invalid_source: a source is a registration or a package order'
        USING ERRCODE = '22023';
    END IF;
    IF v_sid = ANY (v_seen) THEN
      RAISE EXCEPTION 'duplicate_source: the same order was picked twice' USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || v_sid;
    SELECT p.vat_rate, p.vat_exempt_basis INTO v_src_rate, v_src_basis
      FROM public._event_invoice_source_tax_profile(p_tenant, v_skind, v_sid) AS p;
    v_line_rate := CASE WHEN v_rate_forced THEN v_rate ELSE COALESCE(v_src_rate, v_rate) END;
    v_resolved := v_resolved || jsonb_build_array(
      public._event_invoice_resolve_source(p_tenant, v_event_id, v_skind, v_sid, v_line_rate, v_locale)
        || jsonb_build_object('tix_vat_rate', v_line_rate, 'tix_exempt_basis', v_src_basis)
    );
    IF v_kind = 'invoice' AND EXISTS (
      SELECT 1 FROM public.event_invoice_sources s
       WHERE s.tenant_id = p_tenant AND s.covers AND s.released_at IS NULL
         AND (s.registration_id = v_sid OR s.package_order_id = v_sid)
    ) THEN
      RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
    END IF;
  END LOOP;
  IF (
    SELECT count(DISTINCT CASE
             WHEN q.buyer_tax_id <> ''
               THEN 'tax:' || public._event_invoice_tax_key(q.buyer_tax_id) || ':' || q.buyer_country
             ELSE 'request:' || q.id::text
           END)
      FROM public.event_invoice_requests q
     WHERE q.tenant_id = p_tenant AND q.status = 'pending'
       AND (q.registration_id = ANY (v_seen) OR q.package_order_id = ANY (v_seen))
  ) > 1 THEN
    RAISE EXCEPTION 'buyer_mismatch: the picked orders carry invoice requests of different buyers'
      USING ERRCODE = '22023';
  END IF;
  SELECT min(x.value->>'currency') INTO v_currency FROM jsonb_array_elements(v_resolved) AS x;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_resolved) AS x WHERE x.value->>'currency' <> v_currency)
     OR v_currency NOT IN ('PLN', 'EUR') THEN
    RAISE EXCEPTION 'currency_mismatch: orders of one document share one currency (PLN or EUR)'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payload->'buyer') = 'object' THEN
    v_buyer := public._event_invoice_buyer_clean(p_payload->'buyer');
  END IF;
  IF v_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.event_invoice_requests q
     WHERE q.id = v_request_id AND q.tenant_id = p_tenant AND q.status = 'pending'
       AND (q.registration_id = ANY (v_seen) OR q.package_order_id = ANY (v_seen));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'request_not_found: pending invoice request of these orders does not exist'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT * INTO v_request FROM public.event_invoice_requests q
     WHERE q.tenant_id = p_tenant AND q.status = 'pending'
       AND (q.registration_id = ANY (v_seen) OR q.package_order_id = ANY (v_seen))
     ORDER BY q.created_at, q.id
     LIMIT 1;
  END IF;
  IF v_buyer IS NULL AND v_request.id IS NOT NULL THEN
    v_buyer := jsonb_build_object(
      'is_company', v_request.buyer_is_company, 'name', v_request.buyer_name,
      'tax_id', v_request.buyer_tax_id, 'country', v_request.buyer_country,
      'address', v_request.buyer_address, 'postal_code', v_request.buyer_postal_code,
      'city', v_request.buyer_city, 'email', v_request.buyer_email,
      'po_number', v_request.po_number, 'recipient_name', v_request.recipient_name,
      'recipient_address', v_request.recipient_address
    );
  END IF;
  IF v_request.id IS NULL THEN
    v_buyer_person := NULLIF(v_resolved->0->>'person_id', '')::uuid;
    v_buyer_user := NULLIF(v_resolved->0->>'user_id', '')::uuid;
  ELSE
    SELECT NULLIF(x.value->>'person_id', '')::uuid, NULLIF(x.value->>'user_id', '')::uuid
      INTO v_buyer_person, v_buyer_user
      FROM jsonb_array_elements(v_resolved) AS x
     WHERE x.value->>'id' = COALESCE(v_request.registration_id, v_request.package_order_id)::text;
    v_buyer_user := COALESCE(v_request.requested_by, v_buyer_user);
  END IF;
  IF v_buyer IS NULL THEN
    SELECT jsonb_build_object(
      'is_company', false,
      'name', btrim(COALESCE(o.buyer_name, p.first_name || ' ' || p.last_name, '')),
      'tax_id', '', 'country', 'PL', 'address', '', 'postal_code', '', 'city', '',
      'email', lower(btrim(COALESCE(o.buyer_email, p.email, ''))),
      'po_number', '', 'recipient_name', '', 'recipient_address', ''
    ) INTO v_buyer
      FROM (SELECT 1) AS one
      LEFT JOIN public.event_people p ON p.id = v_buyer_person AND p.tenant_id = p_tenant
      LEFT JOIN public.event_package_orders o
        ON o.id = NULLIF(v_resolved->0->>'id', '')::uuid AND o.tenant_id = p_tenant
       AND v_resolved->0->>'kind' = 'package_order';
  END IF;
  SELECT bool_and((x.value->>'paid')::boolean), bool_and((x.value->>'via_card')::boolean),
         max(NULLIF(x.value->>'paid_at', '')::timestamptz)
    INTO v_all_paid, v_all_card, v_paid_at
    FROM jsonb_array_elements(v_resolved) AS x;
  v_payment_method := COALESCE(NULLIF(p_payload->>'payment_method', ''),
                               CASE WHEN v_all_card THEN 'card' ELSE 'transfer' END);
  IF v_payment_method NOT IN ('card', 'transfer', 'other') THEN
    RAISE EXCEPTION 'invalid_payment_method: payment method is card, transfer or other'
      USING ERRCODE = '22023';
  END IF;
  v_sale_date := COALESCE(
    NULLIF(p_payload->>'sale_date', '')::date,
    CASE WHEN v_all_paid AND v_paid_at IS NOT NULL THEN (v_paid_at AT TIME ZONE 'Europe/Warsaw')::date END,
    (v_event.starts_at AT TIME ZONE 'Europe/Warsaw')::date
  );
  INSERT INTO public.event_invoices (
    tenant_id, event_id, event_slug, event_title_pl, event_title_en, kind, status, sale_date,
    due_date, payment_method, paid_at, currency, buyer_is_company, buyer_name, buyer_tax_id,
    buyer_country, buyer_address, buyer_postal_code, buyer_city, buyer_email, po_number,
    recipient_name, recipient_address, buyer_user_id, buyer_person_id, locale, note, created_by
  ) VALUES (
    p_tenant, v_event.id, v_event.slug, v_event.title_pl, v_event.title_en, v_kind, 'draft', v_sale_date,
    NULLIF(p_payload->>'due_date', '')::date, v_payment_method,
    CASE WHEN v_kind = 'invoice' AND v_all_paid THEN v_paid_at END, v_currency,
    COALESCE((v_buyer->>'is_company')::boolean, false), COALESCE(v_buyer->>'name', ''),
    COALESCE(v_buyer->>'tax_id', ''), COALESCE(NULLIF(v_buyer->>'country', ''), 'PL'),
    COALESCE(v_buyer->>'address', ''), COALESCE(v_buyer->>'postal_code', ''),
    COALESCE(v_buyer->>'city', ''), COALESCE(v_buyer->>'email', ''),
    COALESCE(v_buyer->>'po_number', ''), COALESCE(v_buyer->>'recipient_name', ''),
    COALESCE(v_buyer->>'recipient_address', ''), v_buyer_user, v_buyer_person, v_locale, v_note, p_actor
  )
  RETURNING id INTO v_invoice;
  INSERT INTO public.event_invoice_sources (
    tenant_id, invoice_id, source_kind, registration_id, package_order_id, payment_order_id,
    person_id, seats, gross_cents, paid_at, covers
  )
  SELECT p_tenant, v_invoice, x.value->>'kind',
         CASE WHEN x.value->>'kind' = 'registration' THEN (x.value->>'id')::uuid END,
         CASE WHEN x.value->>'kind' = 'package_order' THEN (x.value->>'id')::uuid END,
         NULLIF(x.value->>'payment_order_id', '')::uuid,
         NULLIF(x.value->>'person_id', '')::uuid,
         (x.value->>'source_seats')::integer, (x.value->>'gross')::bigint,
         NULLIF(x.value->>'paid_at', '')::timestamptz, v_kind = 'invoice'
    FROM jsonb_array_elements(v_resolved) AS x;
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(v_resolved) AS x LOOP
    v_line_rate := v_item->>'tix_vat_rate';
    v_src_basis := NULLIF(v_item->>'tix_exempt_basis', '');
    IF v_line_rate = 'zw' AND v_basis = '' AND v_src_basis IS NOT NULL THEN
      v_basis := v_src_basis;
    END IF;
    FOR v_group IN
      SELECT g.value FROM jsonb_array_elements(v_item->'units') AS g
       WHERE (g.value->>'qty')::integer > 0
    LOOP
      v_ord := v_ord + 1;
      v_qty := (v_group->>'qty')::integer;
      v_u := (v_group->>'gross')::bigint / v_qty;
      v_r := ((v_group->>'gross')::bigint - v_u * v_qty)::integer;
      v_units := v_units || jsonb_build_array(jsonb_build_object(
        'ord', v_ord * 2, 'item', v_item->>'item', 'label', v_item->>'label', 'unit', v_item->>'unit',
        'ticket_type_id', v_item->>'ticket_type_id', 'vat_rate', v_line_rate,
        'qty', v_qty - v_r, 'unit_gross', v_u
      ));
      IF v_r > 0 THEN
        v_units := v_units || jsonb_build_array(jsonb_build_object(
          'ord', v_ord * 2 + 1, 'item', v_item->>'item', 'label', v_item->>'label',
          'unit', v_item->>'unit', 'ticket_type_id', v_item->>'ticket_type_id',
          'vat_rate', v_line_rate,
          'qty', v_r, 'unit_gross', v_u + 1
        ));
      END IF;
    END LOOP;
  END LOOP;
  FOR v_line IN
    SELECT u.label, u.unit, u.ticket_type_id, u.vat_rate, sum(u.qty)::integer AS qty, u.unit_gross
      FROM jsonb_to_recordset(v_units) AS u(
        ord integer, item text, label text, unit text, ticket_type_id uuid, vat_rate text,
        qty integer, unit_gross bigint
      )
     GROUP BY CASE WHEN v_aggregate = 'per_ticket_type' THEN u.item ELSE u.ord::text END,
              u.label, u.unit, u.ticket_type_id, u.vat_rate, u.unit_gross
     ORDER BY min(u.ord)
  LOOP
    PERFORM public._event_invoice_add_line(
      p_tenant, v_invoice, left(v_line.label, 300), v_line.unit, v_line.qty, v_line.unit_gross,
      v_line.vat_rate, v_line.ticket_type_id
    );
  END LOOP;
  IF v_basis <> '' THEN
    UPDATE public.event_invoices i SET vat_exempt_basis = left(v_basis, 300)
    WHERE i.id = v_invoice AND i.tenant_id = p_tenant;
  END IF;
  PERFORM public._event_invoice_recalc(p_tenant, v_invoice);
  RETURN v_invoice;
END;
$function$;