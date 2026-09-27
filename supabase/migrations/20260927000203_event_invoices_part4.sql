-- CZESC 4/5 MIGRACJI 20260927000200_event_invoices.sql
-- migration-split: part 4/5 of 20260927000200_event_invoices.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 20260927000200_event_invoices.sql,
-- potem 20260927000201_event_invoices_part2.sql .. 20260927000204_event_invoices_part5.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.
-- events-harness: include

CREATE OR REPLACE FUNCTION public.admin_event_invoice_settings_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_cur jsonb;
  v_new jsonb;
  v_enabled boolean;
  v_country text;
  v_tax text;
  v_confirmed timestamptz;
BEGIN
  v_cur := public._event_invoice_settings_json(v_tenant);
  -- Klucz pominiety = bez zmian; napis przyciety; JSON null = pusty napis.
  SELECT jsonb_object_agg(k.key, CASE
           WHEN NOT (COALESCE(p_payload, '{}'::jsonb) ? k.key) THEN v_cur->k.key
           WHEN jsonb_typeof(p_payload->k.key) = 'string' THEN to_jsonb(btrim(p_payload->>k.key))
           WHEN jsonb_typeof(p_payload->k.key) = 'null' THEN to_jsonb(''::text)
           ELSE p_payload->k.key END)
    INTO v_new
    FROM jsonb_object_keys(v_cur) AS k(key);
  v_enabled := COALESCE(NULLIF(v_new->>'enabled', '')::boolean, false);
  v_country := upper(COALESCE(v_new->>'seller_country', ''));
  IF v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_country: country must be an ISO 3166 alpha-2 code' USING ERRCODE = '22023';
  END IF;
  v_tax := public._event_invoice_tax_id_normalize(v_new->>'seller_tax_id', v_country);
  IF v_tax IS NULL THEN
    RAISE EXCEPTION 'invalid_tax_id: tax identifier is not valid for the country' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_new->>'seller_name') > 200 OR char_length(v_new->>'seller_address') > 200
     OR char_length(v_new->>'seller_postal_code') > 20 OR char_length(v_new->>'seller_city') > 100
     OR char_length(v_new->>'seller_email') > 254 OR char_length(v_new->>'seller_phone') > 40
     OR char_length(v_new->>'seller_bank_account') > 64 OR char_length(v_new->>'seller_bank_swift') > 20
     OR char_length(v_new->>'vat_exempt_basis') > 300 OR char_length(v_new->>'footer_note') > 500 THEN
    RAISE EXCEPTION 'invalid_settings: a text field is too long' USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'seller_email') <> ''
     AND (v_new->>'seller_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: invoice e-mail address is not valid' USING ERRCODE = '22023';
  END IF;
  IF upper(v_new->>'series_invoice') !~ '^[A-Z0-9]{1,10}$'
     OR upper(v_new->>'series_proforma') !~ '^[A-Z0-9]{1,10}$'
     OR upper(v_new->>'series_correction') !~ '^[A-Z0-9]{1,10}$' THEN
    RAISE EXCEPTION 'invalid_series: a series prefix has 1-10 letters or digits' USING ERRCODE = '22023';
  END IF;
  IF upper(v_new->>'series_invoice') IN (upper(v_new->>'series_proforma'), upper(v_new->>'series_correction'))
     OR upper(v_new->>'series_proforma') = upper(v_new->>'series_correction') THEN
    RAISE EXCEPTION 'series_not_distinct: invoice, proforma and correction series must differ'
      USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'payment_days') !~ '^[0-9]{1,3}$' OR (v_new->>'payment_days')::integer > 120 THEN
    RAISE EXCEPTION 'invalid_payment_days: payment term is 0-120 days' USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'default_vat_rate') NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
    RAISE EXCEPTION 'invalid_vat_rate: unknown VAT rate' USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'default_locale') NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_locale: document language is pl or en' USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'default_vat_rate') = 'zw' AND (v_new->>'vat_exempt_basis') = '' THEN
    RAISE EXCEPTION 'vat_exempt_basis_required: exempt lines need the legal basis in issuer settings'
      USING ERRCODE = '22023';
  END IF;
  v_confirmed := NULLIF(v_cur->>'confirmed_at', '')::timestamptz;
  IF v_enabled THEN
    IF (v_new->>'seller_name') = '' OR v_tax = '' OR (v_new->>'seller_address') = ''
       OR (v_new->>'seller_postal_code') = '' OR (v_new->>'seller_city') = '' THEN
      RAISE EXCEPTION 'seller_incomplete: issuer name, tax id and address are required'
        USING ERRCODE = '22023';
    END IF;
    IF v_confirmed IS NULL AND COALESCE(NULLIF(p_payload->>'confirm_seller', '')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'seller_confirmation_required: confirm that the organizer is the seller'
        USING ERRCODE = '22023';
    END IF;
    v_confirmed := COALESCE(v_confirmed, now());
  END IF;

  INSERT INTO public.event_invoice_settings AS s (
    tenant_id, enabled, confirmed_at, confirmed_by, seller_name, seller_tax_id, seller_address,
    seller_postal_code, seller_city, seller_country, seller_email, seller_phone, seller_bank_account,
    seller_bank_swift, series_invoice, series_proforma, series_correction, payment_days,
    default_vat_rate, vat_exempt_basis, footer_note, default_locale, updated_by
  ) VALUES (
    v_tenant, v_enabled, v_confirmed, CASE WHEN v_confirmed IS NOT NULL THEN auth.uid() END,
    v_new->>'seller_name', v_tax, v_new->>'seller_address', v_new->>'seller_postal_code',
    v_new->>'seller_city', v_country, lower(v_new->>'seller_email'), v_new->>'seller_phone',
    upper(regexp_replace(v_new->>'seller_bank_account', '[[:space:]]', '', 'g')),
    upper(v_new->>'seller_bank_swift'), upper(v_new->>'series_invoice'), upper(v_new->>'series_proforma'),
    upper(v_new->>'series_correction'), (v_new->>'payment_days')::integer, v_new->>'default_vat_rate',
    v_new->>'vat_exempt_basis', v_new->>'footer_note', v_new->>'default_locale', auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    confirmed_at = EXCLUDED.confirmed_at,
    confirmed_by = COALESCE(s.confirmed_by, EXCLUDED.confirmed_by),
    seller_name = EXCLUDED.seller_name,
    seller_tax_id = EXCLUDED.seller_tax_id,
    seller_address = EXCLUDED.seller_address,
    seller_postal_code = EXCLUDED.seller_postal_code,
    seller_city = EXCLUDED.seller_city,
    seller_country = EXCLUDED.seller_country,
    seller_email = EXCLUDED.seller_email,
    seller_phone = EXCLUDED.seller_phone,
    seller_bank_account = EXCLUDED.seller_bank_account,
    seller_bank_swift = EXCLUDED.seller_bank_swift,
    series_invoice = EXCLUDED.series_invoice,
    series_proforma = EXCLUDED.series_proforma,
    series_correction = EXCLUDED.series_correction,
    payment_days = EXCLUDED.payment_days,
    default_vat_rate = EXCLUDED.default_vat_rate,
    vat_exempt_basis = EXCLUDED.vat_exempt_basis,
    footer_note = EXCLUDED.footer_note,
    default_locale = EXCLUDED.default_locale,
    updated_by = EXCLUDED.updated_by;
  RETURN public._event_invoice_settings_json(v_tenant);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_settings_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_settings_save(jsonb) IS
  'Zapis danych wystawcy (klucz pominiety = bez zmian). Wlaczenie wymaga kompletu danych sprzedawcy i jednorazowego potwierdzenia confirm_seller. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_candidates(p_event_id uuid)
RETURNS TABLE(
  source_kind text,
  source_id uuid,
  person_name text,
  person_email text,
  company_text text,
  label_pl text,
  label_en text,
  ticket_type_id uuid,
  seats integer,
  gross_cents bigint,
  currency text,
  payment_state text,
  paid_via text,
  amount_source text,
  paid_at timestamptz,
  created_at timestamptz,
  request_id uuid,
  request_status text,
  buyer_is_company boolean,
  buyer_name text,
  buyer_tax_id text,
  buyer_email text,
  invoice_id uuid,
  invoice_number text,
  invoice_status text,
  proforma_id uuid,
  proforma_number text,
  tax_key text,
  admission text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  -- Bilet z cena netto (VAT doliczany) pokazujemy w brutto wg domyslnej
  -- stawki wystawcy - ta sama stawka trafi na szkic, jesli jej nie zmienic.
  v_rate text := COALESCE(
    (SELECT s.default_vat_rate FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant), '23');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH src AS (
    -- Zapisy: kwota, miejsca i odmowa z _event_invoice_registration_source
    -- (ta sama regula co szkic). Gosc grupy trafia tu tylko z WLASNYM
    -- zamowieniem z karty; zapis z puli planu (nikt nie zaplacil) i gosc
    -- rozliczony przez prowadzacego odpadaja.
    SELECT 'registration'::text AS kind, r.id AS sid,
           btrim(p.first_name || ' ' || p.last_name) AS pname, COALESCE(p.email, '') AS pemail,
           COALESCE(NULLIF(btrim(p.company_text), ''), c.name, '') AS ctext,
           x.src->>'name_pl' AS lpl, x.src->>'name_en' AS len, r.ticket_type_id AS tt,
           (x.src->>'seats')::integer AS nseats,
           (x.src->>'gross')::bigint AS ngross,
           x.src->>'currency' AS cur,
           r.payment_status AS pstate,
           CASE WHEN (x.src->>'via_card')::boolean THEN 'card' ELSE 'transfer' END AS via,
           x.src->>'basis' AS basis,
           NULLIF(x.src->>'paid_at', '')::timestamptz AS pat, r.created_at AS cat,
           CASE WHEN r.payment_status IN ('paid', 'partially_refunded') THEN x.src->>'admission'
                ELSE 'seated' END AS adm
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.crm_companies c ON c.id = p.company_id AND c.tenant_id = p.tenant_id
      CROSS JOIN LATERAL (
        SELECT public._event_invoice_registration_source(v_tenant, r.id, v_rate) AS src
      ) AS x
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND (r.group_lead_registration_id IS NULL OR r.payment_order_id IS NOT NULL)
       AND r.status NOT IN ('cancelled', 'rejected')
       AND r.payment_status IN ('paid', 'partially_refunded', 'unpaid')
       AND x.src->>'block' IS NULL
    UNION ALL
    SELECT 'package_order'::text, o.id, o.buyer_name, o.buyer_email, COALESCE(c.name, ''),
           k.name_pl, k.name_en, NULL::uuid, o.seats_total,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded')
                THEN (po.amount_cents - COALESCE(po.refunded_amount_cents, 0))::bigint
                ELSE o.amount_cents::bigint END,
           o.currency,
           CASE WHEN o.status = 'paid' THEN 'paid' ELSE 'unpaid' END,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded') THEN 'card' ELSE 'transfer' END,
           'order', o.paid_at, o.created_at, 'seated'
      FROM public.event_package_orders o
      JOIN public.event_ticket_packages k ON k.id = o.package_id AND k.tenant_id = o.tenant_id
      LEFT JOIN public.crm_companies c ON c.id = o.company_id AND c.tenant_id = o.tenant_id
      LEFT JOIN public.payment_orders po ON po.id = o.payment_order_id AND po.tenant_id = o.tenant_id
     WHERE o.tenant_id = v_tenant AND o.event_id = p_event_id AND o.status IN ('pending', 'paid')
  )
  SELECT s.kind, s.sid, s.pname, s.pemail, s.ctext, s.lpl, s.len, s.tt, s.nseats, s.ngross,
         s.cur, s.pstate, s.via, s.basis, s.pat, s.cat,
         q.id, q.status, q.buyer_is_company, q.buyer_name, q.buyer_tax_id, q.buyer_email,
         inv.id, inv.number, inv.status,
         pro.id, pro.number,
         NULLIF(public._event_invoice_tax_key(q.buyer_tax_id), ''),
         s.adm
    FROM src s
    LEFT JOIN LATERAL (
      SELECT x.id, x.status, x.buyer_is_company, x.buyer_name, x.buyer_tax_id, x.buyer_email
        FROM public.event_invoice_requests x
       WHERE x.tenant_id = v_tenant AND x.status <> 'cancelled'
         AND (x.registration_id = s.sid OR x.package_order_id = s.sid)
       ORDER BY x.created_at DESC LIMIT 1
    ) AS q ON true
    LEFT JOIN LATERAL (
      SELECT i.id, i.number, i.status FROM public.event_invoice_sources es
        JOIN public.event_invoices i ON i.id = es.invoice_id AND i.tenant_id = es.tenant_id
       WHERE es.tenant_id = v_tenant AND es.covers AND es.released_at IS NULL
         AND (es.registration_id = s.sid OR es.package_order_id = s.sid)
       LIMIT 1
    ) AS inv ON true
    LEFT JOIN LATERAL (
      SELECT i.id, i.number FROM public.event_invoice_sources es
        JOIN public.event_invoices i ON i.id = es.invoice_id AND i.tenant_id = es.tenant_id
       WHERE es.tenant_id = v_tenant AND i.kind = 'proforma' AND i.status <> 'cancelled'
         AND (es.registration_id = s.sid OR es.package_order_id = s.sid)
       ORDER BY i.created_at DESC LIMIT 1
    ) AS pro ON true
   ORDER BY NULLIF(public._event_invoice_tax_key(q.buyer_tax_id), '') NULLS LAST,
            lower(COALESCE(q.buyer_name, s.pname)), s.cat;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_candidates(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_candidates(uuid) IS
  'Zamowienia wydarzenia do zafakturowania (zapisy prowadzacych grupy, goscie z wlasnym zamowieniem z karty, pakiety; bez miejsc z puli planu) z kwota wg _event_invoice_registration_source, prosba, aktywna faktura, proforma i miejscem oplaconego zapisu (admission); sortowane po znormalizowanym NIP. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoices_list(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  kind text,
  status text,
  number text,
  issue_date date,
  sale_date date,
  due_date date,
  currency text,
  net_cents bigint,
  vat_cents bigint,
  gross_cents bigint,
  buyer_is_company boolean,
  buyer_name text,
  buyer_tax_id text,
  buyer_email text,
  ksef_status text,
  ksef_number text,
  paid_at timestamptz,
  corrects_invoice_id uuid,
  corrects_number text,
  correction_mode text,
  source_proforma_id uuid,
  converted_invoice_id uuid,
  source_count integer,
  locale text,
  created_at timestamptz,
  issued_at timestamptz,
  cancelled_at timestamptz,
  correction_hint text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT i.id, i.kind, i.status, i.number, i.issue_date, i.sale_date, i.due_date, i.currency,
         i.net_cents, i.vat_cents, i.gross_cents, i.buyer_is_company, i.buyer_name, i.buyer_tax_id,
         i.buyer_email, i.ksef_status, i.ksef_number, i.paid_at, i.corrects_invoice_id, c.number,
         i.correction_mode, i.source_proforma_id,
         (SELECT f.id FROM public.event_invoices f
           WHERE f.tenant_id = v_tenant AND f.source_proforma_id = i.id AND f.status <> 'cancelled'
           LIMIT 1),
         (SELECT count(*)::integer FROM public.event_invoice_sources s
           WHERE s.invoice_id = i.id AND s.tenant_id = v_tenant),
         i.locale, i.created_at, i.issued_at, i.cancelled_at,
         public._event_invoice_correction_hint(v_tenant, i.id)
    FROM public.event_invoices i
    LEFT JOIN public.event_invoices c ON c.id = i.corrects_invoice_id AND c.tenant_id = i.tenant_id
   WHERE i.tenant_id = v_tenant AND i.event_id = p_event_id
   ORDER BY i.created_at DESC, i.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoices_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoices_list(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoices_list(uuid) IS
  'Dokumenty wydarzenia (szkice, faktury, proformy, korekty) z podpowiedzia korekty (correction_hint: zwrot, odwolanie, mniej miejsc po wystawieniu). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_doc jsonb;
BEGIN
  v_doc := public._event_invoice_document(v_tenant, p_id);
  IF v_doc IS NULL THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  RETURN v_doc || jsonb_build_object(
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'source_kind', s.source_kind, 'registration_id', s.registration_id,
        'package_order_id', s.package_order_id, 'payment_order_id', s.payment_order_id,
        'seats', s.seats, 'gross_cents', s.gross_cents, 'paid_at', s.paid_at, 'covers', s.covers,
        'released_at', s.released_at
      ) ORDER BY s.created_at, s.id)
      FROM public.event_invoice_sources s WHERE s.invoice_id = p_id AND s.tenant_id = v_tenant
    ), '[]'::jsonb),
    'corrections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'status', c.status,
                                          'correction_mode', c.correction_mode)
                       ORDER BY c.created_at)
        FROM public.event_invoices c
       WHERE c.corrects_invoice_id = p_id AND c.tenant_id = v_tenant
    ), '[]'::jsonb),
    -- Podstawa kolejnej korekty: pozycje PO wystawionych korektach.
    'current_lines', CASE
      WHEN v_doc->'invoice'->>'kind' = 'invoice' AND v_doc->'invoice'->>'status' = 'issued'
        THEN public._event_invoice_current_lines(v_tenant, p_id)
      ELSE '[]'::jsonb
    END,
    -- Sprzedaz skurczyla sie po wystawieniu (zwrot, odwolanie, mniej miejsc).
    'correction_hint', public._event_invoice_correction_hint(v_tenant, p_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_get(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_get(uuid) IS
  'Pelny dokument (pozycje, podsumowanie VAT, sprzedawca, zrodla, korekty, stan po korektach, podpowiedz korekty) do edytora i PDF. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_draft_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN public._event_invoice_draft_build(v_tenant, auth.uid(), p_payload);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_draft_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_draft_create(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_draft_create(jsonb) IS
  'Szkic faktury/proformy z jednego albo WIELU zamowien (zbiorcza). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_draft_update(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_inv public.event_invoices;
  v_buyer jsonb;
  v_method text;
  v_locale text;
  v_note text;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = v_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'not_draft: only a draft can be edited' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payload->'buyer') = 'object' THEN
    v_buyer := public._event_invoice_buyer_clean(public._event_invoice_buyer_json(v_inv) || (p_payload->'buyer'));
    UPDATE public.event_invoices i
       SET buyer_is_company = (v_buyer->>'is_company')::boolean,
           buyer_name = v_buyer->>'name',
           buyer_tax_id = v_buyer->>'tax_id',
           buyer_country = v_buyer->>'country',
           buyer_address = v_buyer->>'address',
           buyer_postal_code = v_buyer->>'postal_code',
           buyer_city = v_buyer->>'city',
           buyer_email = v_buyer->>'email',
           po_number = v_buyer->>'po_number',
           recipient_name = v_buyer->>'recipient_name',
           recipient_address = v_buyer->>'recipient_address',
           crm_company_id = NULL
     WHERE i.id = v_id AND i.tenant_id = v_tenant;
  END IF;
  v_method := CASE WHEN p_payload ? 'payment_method' THEN p_payload->>'payment_method' ELSE v_inv.payment_method END;
  IF v_method IS NULL OR v_method NOT IN ('card', 'transfer', 'other') THEN
    RAISE EXCEPTION 'invalid_payment_method: payment method is card, transfer or other'
      USING ERRCODE = '22023';
  END IF;
  v_locale := CASE WHEN p_payload ? 'locale' THEN p_payload->>'locale' ELSE v_inv.locale END;
  IF v_locale IS NULL OR v_locale NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_locale: document language is pl or en' USING ERRCODE = '22023';
  END IF;
  v_note := CASE WHEN p_payload ? 'note' THEN btrim(COALESCE(p_payload->>'note', '')) ELSE v_inv.note END;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'invalid_note: note has more than 1000 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_invoices i
     SET payment_method = v_method,
         locale = v_locale,
         note = v_note,
         sale_date = CASE WHEN p_payload ? 'sale_date' THEN NULLIF(p_payload->>'sale_date', '')::date
                          ELSE i.sale_date END,
         due_date = CASE WHEN p_payload ? 'due_date' THEN NULLIF(p_payload->>'due_date', '')::date
                         ELSE i.due_date END,
         paid_at = CASE WHEN p_payload ? 'paid_at' AND i.kind <> 'proforma'
                        THEN NULLIF(p_payload->>'paid_at', '')::timestamptz ELSE i.paid_at END,
         correction_reason = CASE WHEN i.kind = 'correction' AND p_payload ? 'correction_reason'
                                  THEN left(btrim(COALESCE(p_payload->>'correction_reason', '')), 500)
                                  ELSE i.correction_reason END
   WHERE i.id = v_id AND i.tenant_id = v_tenant;
  IF p_payload ? 'lines' THEN
    PERFORM public._event_invoice_replace_lines(v_tenant, v_id, v_inv.kind, p_payload->'lines');
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_draft_update(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_draft_update(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_draft_update(jsonb) IS
  'Edycja szkicu: nabywca (klucze pominiete = bez zmian), daty sprzedazy i platnosci, sposob platnosci, jezyk, uwagi, pozycje (pelna lista). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_issue(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN public._event_invoice_issue_core(v_tenant, auth.uid(), p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_issue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_issue(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_issue(uuid) IS
  'Wystawienie szkicu (numer bez luk, migawki, CRM, zdarzenie). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_issue_pending(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_collective boolean := COALESCE(NULLIF(p_payload->>'collective', '')::boolean, false);
  v_group record;
  v_draft uuid;
  v_result jsonb;
  v_issued jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant AND s.enabled) THEN
    RAISE EXCEPTION 'invoicing_disabled: complete and confirm the issuer settings first'
      USING ERRCODE = '22023';
  END IF;
  FOR v_group IN
    SELECT (array_agg(q.id ORDER BY q.created_at, q.id))[1] AS buyer_request,
           array_agg(q.id ORDER BY q.created_at, q.id) AS request_ids,
           jsonb_agg(jsonb_build_object('kind', q.source_kind,
                                        'id', COALESCE(q.registration_id, q.package_order_id))
                     ORDER BY q.created_at, q.id) AS sources
      FROM public.event_invoice_requests q
      LEFT JOIN public.event_package_orders o ON o.id = q.package_order_id AND o.tenant_id = q.tenant_id
      LEFT JOIN LATERAL (
        SELECT public._event_invoice_registration_source(v_tenant, q.registration_id, '23') AS src
         WHERE q.registration_id IS NOT NULL
      ) AS x ON true
     WHERE q.tenant_id = v_tenant AND q.event_id = v_event_id AND q.status = 'pending'
       -- Masowo WYLACZNIE zamowienia oplacone Z MIEJSCEM. Wplata bez miejsca
       -- (kolejka po wyczerpaniu puli, bilet czekajacy na decyzje -
       -- 20260926180000) moze jeszcze skonczyc sie odrzuceniem i zwrotem, a
       -- faktura z jednego klikniecia wymagalaby wtedy recznej korekty. Taki
       -- zapis organizator fakturuje swiadomie ze szkicu (np. zaliczkowo) -
       -- kandydaci oznaczaja go plakietka. Pomijamy tez zapisy, ktorych szkic
       -- i tak by odmowil (miejsce z puli planu, gosc rozliczony przez
       -- prowadzacego, zapis zamkniety) - nie sa bledem partii.
       AND ((x.src->>'block' IS NULL AND (x.src->>'paid')::boolean AND x.src->>'admission' = 'seated')
            OR o.status = 'paid')
       AND NOT EXISTS (
         SELECT 1 FROM public.event_invoice_sources s
          WHERE s.tenant_id = v_tenant AND s.covers AND s.released_at IS NULL
            AND (s.registration_id = q.registration_id OR s.package_order_id = q.package_order_id)
       )
     GROUP BY CASE
       WHEN v_collective AND q.buyer_is_company AND q.buyer_tax_id <> ''
         THEN 'tax:' || public._event_invoice_tax_key(q.buyer_tax_id) || ':' || q.buyer_country
       ELSE 'request:' || q.id::text
     END
     ORDER BY min(q.created_at)
  LOOP
    BEGIN
      v_draft := public._event_invoice_draft_build(v_tenant, auth.uid(), jsonb_build_object(
        'event_id', v_event_id,
        'kind', 'invoice',
        'aggregate', CASE WHEN v_collective THEN 'per_ticket_type' ELSE 'per_source' END,
        'request_id', v_group.buyer_request,
        'sources', v_group.sources
      ));
      v_result := public._event_invoice_issue_core(v_tenant, auth.uid(), v_draft);
      v_issued := v_issued || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_result->>'id', 'number', v_result->>'number',
        'request_ids', to_jsonb(v_group.request_ids)
      ));
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'request_ids', to_jsonb(v_group.request_ids),
        'code', split_part(SQLERRM, ':', 1)
      ));
    END;
  END LOOP;
  RETURN jsonb_build_object('issued', v_issued, 'failed', v_failed);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_issue_pending(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_issue_pending(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_issue_pending(jsonb) IS
  'Wystawia faktury ze wszystkich oczekujacych prosb o OPLACONE zamowienia wydarzenia z miejscem (bez wplat w kolejce i czekajacych na decyzje, bez miejsc z puli planu): jedna na prosbe albo zbiorcza per NIP (collective). Blad jednej grupy nie wycofuje pozostalych. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_cancel(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_reason text := left(btrim(COALESCE(p_payload->>'reason', '')), 500);
  v_inv public.event_invoices;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = v_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'already_cancelled: the document is already cancelled' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'issued' AND v_reason = '' THEN
    RAISE EXCEPTION 'reason_required: cancelling an issued document needs a reason' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'issued' AND v_inv.kind <> 'proforma' AND v_inv.ksef_status IN ('sent', 'accepted') THEN
    RAISE EXCEPTION 'ksef_locked: a document sent to KSeF can only be corrected' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_invoices c
              WHERE c.tenant_id = v_tenant AND c.corrects_invoice_id = v_inv.id AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'has_corrections: cancel the corrections of this invoice first' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'issued' AND v_inv.kind = 'correction' AND v_inv.correction_mode = 'full' THEN
    RAISE EXCEPTION 'correction_locked: a full correction cannot be cancelled once issued'
      USING ERRCODE = '22023';
  END IF;
  -- Kazda korekta liczy sie od stanu po POPRZEDNICH. Anulowanie wczesniejszej
  -- korekty przy wystawionej pozniejszej rozjechaloby stan faktury (pozniejsza
  -- odwracala pozycje, ktorych juz by nie bylo) - anulowac wolno tylko
  -- ostatnio wystawiona. Remis czasu = odmowa (bezpieczniej).
  IF v_inv.status = 'issued' AND v_inv.kind = 'correction' AND EXISTS (
    SELECT 1 FROM public.event_invoices c
     WHERE c.tenant_id = v_tenant AND c.corrects_invoice_id = v_inv.corrects_invoice_id
       AND c.id <> v_inv.id AND c.status = 'issued' AND c.issued_at >= v_inv.issued_at
  ) THEN
    RAISE EXCEPTION 'correction_not_latest: only the latest correction of an invoice can be cancelled'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_invoice_sources s
     SET released_at = now()
   WHERE s.invoice_id = v_inv.id AND s.tenant_id = v_tenant AND s.released_at IS NULL;
  UPDATE public.event_invoice_requests q
     SET status = 'pending', invoice_id = NULL
   WHERE q.tenant_id = v_tenant AND q.invoice_id = v_inv.id AND q.status = 'invoiced';
  UPDATE public.event_invoices i
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
   WHERE i.id = v_inv.id AND i.tenant_id = v_tenant;
  PERFORM public.emit_domain_event(
    v_tenant,
    'event_invoice',
    v_inv.id::text,
    'event_invoice.cancelled.v1',
    jsonb_build_object('event_id', v_inv.event_id, 'invoice_id', v_inv.id, 'kind', v_inv.kind),
    auth.uid()
  );
  RETURN v_inv.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_cancel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_cancel(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_cancel(jsonb) IS
  'Anulowanie szkicu, proformy albo dokumentu przed KSeF (z powodem); zwalnia zamowienia i przywraca prosby do oczekujacych. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_correction_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'invoice_id', '')::uuid;
  v_mode text := COALESCE(NULLIF(p_payload->>'mode', ''), 'full');
  v_reason text := left(btrim(COALESCE(p_payload->>'reason', '')), 500);
  v_changes jsonb := CASE WHEN jsonb_typeof(p_payload->'lines') = 'array' THEN p_payload->'lines'
                          ELSE '[]'::jsonb END;
  v_inv public.event_invoices;
  v_new uuid;
  v_cur jsonb;
  v_anchor uuid;
  v_cur_qty integer;
  v_cur_unit bigint;
  v_cur_rate text;
  v_change jsonb;
  v_qty integer;
  v_unit bigint;
  v_rate text;
  v_changed integer := 0;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = v_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.kind <> 'invoice' OR v_inv.status <> 'issued' THEN
    RAISE EXCEPTION 'correction_target_invalid: only an issued invoice can be corrected'
      USING ERRCODE = '22023';
  END IF;
  IF v_mode NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'invalid_correction_mode: a correction is full or partial' USING ERRCODE = '22023';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'reason_required: a correction needs a reason' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_invoices c
              WHERE c.tenant_id = v_tenant AND c.corrects_invoice_id = v_inv.id
                AND (c.status = 'draft' OR (c.status = 'issued' AND c.correction_mode = 'full'))) THEN
    RAISE EXCEPTION 'correction_exists: finish the open correction or the invoice is fully corrected'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.event_invoices (
    tenant_id, event_id, event_slug, event_title_pl, event_title_en, kind, status, sale_date,
    payment_method, currency, buyer_is_company, buyer_name, buyer_tax_id, buyer_country,
    buyer_address, buyer_postal_code, buyer_city, buyer_email, po_number, recipient_name,
    recipient_address, buyer_user_id, buyer_person_id, crm_company_id, corrects_invoice_id,
    correction_mode, correction_reason, locale, note, created_by
  ) VALUES (
    v_tenant, v_inv.event_id, v_inv.event_slug, v_inv.event_title_pl, v_inv.event_title_en,
    'correction', 'draft', v_inv.sale_date, v_inv.payment_method, v_inv.currency,
    v_inv.buyer_is_company, v_inv.buyer_name, v_inv.buyer_tax_id, v_inv.buyer_country,
    v_inv.buyer_address, v_inv.buyer_postal_code, v_inv.buyer_city, v_inv.buyer_email,
    v_inv.po_number, v_inv.recipient_name, v_inv.recipient_address, v_inv.buyer_user_id,
    v_inv.buyer_person_id, v_inv.crm_company_id, v_inv.id, v_mode, v_reason, v_inv.locale, '',
    auth.uid()
  )
  RETURNING id INTO v_new;

  -- Podstawa korekty to STAN PO WYSTAWIONYCH KOREKTACH (_event_invoice_current_lines),
  -- nie pierwotne pozycje faktury: pozycja "przed" odwraca biezacy stan
  -- kotwicy, a pozycja "po" niesie nowy. Pelna korekta odwraca caly stan.
  FOR v_cur IN SELECT x.value FROM jsonb_array_elements(public._event_invoice_current_lines(v_tenant, v_inv.id)) AS x
  LOOP
    v_anchor := (v_cur->>'line_id')::uuid;
    v_cur_qty := (v_cur->>'quantity')::integer;
    v_cur_unit := (v_cur->>'unit_gross_cents')::bigint;
    v_cur_rate := v_cur->>'vat_rate';
    IF v_mode = 'full' THEN
      IF v_cur_qty > 0 THEN
        PERFORM public._event_invoice_add_line(v_tenant, v_new, v_cur->>'description', v_cur->>'unit',
          -v_cur_qty, v_cur_unit, v_cur_rate, NULLIF(v_cur->>'ticket_type_id', '')::uuid, v_anchor);
        v_changed := v_changed + 1;
      END IF;
    ELSE
      SELECT x.value INTO v_change FROM jsonb_array_elements(v_changes) AS x
       WHERE x.value->>'line_id' = v_anchor::text
       LIMIT 1;
      IF v_change IS NOT NULL THEN
        v_qty := COALESCE(NULLIF(v_change->>'quantity', '')::integer, v_cur_qty);
        v_unit := COALESCE(NULLIF(v_change->>'unit_gross_cents', '')::bigint, v_cur_unit);
        v_rate := COALESCE(NULLIF(v_change->>'vat_rate', ''), v_cur_rate);
        IF v_qty < 0 OR v_qty > 10000 OR v_unit < 0 OR v_unit > 100000000
           OR v_rate NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
          RAISE EXCEPTION 'invalid_line: corrected quantity, price or rate is out of range'
            USING ERRCODE = '22023';
        END IF;
        IF (v_cur_qty > 0 AND (v_qty <> v_cur_qty OR v_unit <> v_cur_unit OR v_rate <> v_cur_rate))
           OR (v_cur_qty = 0 AND v_qty > 0) THEN
          IF v_cur_qty > 0 THEN
            PERFORM public._event_invoice_add_line(v_tenant, v_new, v_cur->>'description', v_cur->>'unit',
              -v_cur_qty, v_cur_unit, v_cur_rate, NULLIF(v_cur->>'ticket_type_id', '')::uuid, v_anchor);
          END IF;
          IF v_qty > 0 THEN
            PERFORM public._event_invoice_add_line(v_tenant, v_new, v_cur->>'description', v_cur->>'unit',
              v_qty, v_unit, v_rate, NULLIF(v_cur->>'ticket_type_id', '')::uuid, v_anchor);
          END IF;
          v_changed := v_changed + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF v_changed = 0 THEN
    RAISE EXCEPTION 'correction_empty: the correction changes no line' USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'partial' AND NOT EXISTS (
    SELECT 1 FROM public._event_invoice_state(v_tenant, v_inv.id, v_new) AS st WHERE st.quantity <> 0
  ) THEN
    RAISE EXCEPTION 'correction_use_full: the correction reverses the whole invoice - use a full correction'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._event_invoice_recalc(v_tenant, v_new);
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_correction_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_correction_create(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_correction_create(jsonb) IS
  'Szkic korekty wystawionej faktury liczonej od STANU PO WYSTAWIONYCH KOREKTACH: pelne odwrocenie albo zmiana wybranych pozycji (para przed/po). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_from_proforma(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_pro public.event_invoices;
  v_new uuid;
  v_source public.event_invoice_sources;
  v_resolved jsonb := '[]'::jsonb;
  v_rate text;
  v_all_paid boolean;
  v_all_card boolean;
  v_paid_at timestamptz;
BEGIN
  SELECT * INTO v_pro FROM public.event_invoices i
   WHERE i.id = p_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_pro.kind <> 'proforma' OR v_pro.status <> 'issued' THEN
    RAISE EXCEPTION 'not_proforma: only an issued proforma can become an invoice' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_invoices f
              WHERE f.tenant_id = v_tenant AND f.source_proforma_id = v_pro.id AND f.status <> 'cancelled') THEN
    RAISE EXCEPTION 'proforma_already_converted: this proforma already has an invoice' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_invoice_sources s
      JOIN public.event_invoice_sources a
        ON a.tenant_id = s.tenant_id AND a.covers AND a.released_at IS NULL
       AND (a.registration_id = s.registration_id OR a.package_order_id = s.package_order_id)
     WHERE s.invoice_id = v_pro.id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
  END IF;

  -- ZRODLA Z BIEZACEGO STANU, nie kopia migawki proformy: miedzy proforma
  -- a faktura kupujacy zwykle placi (przelewem albo karta, np. z kuponem na
  -- inna kwote). Karta i faktyczna kwota trafiaja na szkic, wiec przy
  -- wystawieniu dziala regula operatora (_event_invoice_card_block), a edytor
  -- pokazuje rozjazd pozycji z kwota zamowien.
  v_rate := COALESCE((SELECT l.vat_rate FROM public.event_invoice_lines l
                       WHERE l.invoice_id = v_pro.id AND l.tenant_id = v_tenant
                       ORDER BY l.position LIMIT 1), '23');
  FOR v_source IN
    SELECT * FROM public.event_invoice_sources s
     WHERE s.invoice_id = v_pro.id AND s.tenant_id = v_tenant
     ORDER BY s.created_at, s.id
  LOOP
    IF COALESCE(v_source.registration_id, v_source.package_order_id) IS NULL THEN
      RAISE EXCEPTION 'source_changed: an order of this proforma no longer exists' USING ERRCODE = '22023';
    END IF;
    v_resolved := v_resolved || jsonb_build_array(public._event_invoice_resolve_source(
      v_tenant, v_pro.event_id, v_source.source_kind,
      COALESCE(v_source.registration_id, v_source.package_order_id), v_rate, v_pro.locale
    ));
  END LOOP;
  SELECT bool_and((x.value->>'paid')::boolean), bool_and((x.value->>'via_card')::boolean),
         max(NULLIF(x.value->>'paid_at', '')::timestamptz)
    INTO v_all_paid, v_all_card, v_paid_at
    FROM jsonb_array_elements(v_resolved) AS x;
  v_paid_at := COALESCE(v_pro.paid_at, CASE WHEN v_all_paid THEN v_paid_at END);

  INSERT INTO public.event_invoices (
    tenant_id, event_id, event_slug, event_title_pl, event_title_en, kind, status, sale_date,
    payment_method, paid_at, currency, buyer_is_company, buyer_name, buyer_tax_id, buyer_country,
    buyer_address, buyer_postal_code, buyer_city, buyer_email, po_number, recipient_name,
    recipient_address, buyer_user_id, buyer_person_id, crm_company_id, source_proforma_id, locale,
    note, created_by
  ) VALUES (
    v_tenant, v_pro.event_id, v_pro.event_slug, v_pro.event_title_pl, v_pro.event_title_en,
    'invoice', 'draft', COALESCE((v_paid_at AT TIME ZONE 'Europe/Warsaw')::date, v_pro.sale_date),
    CASE WHEN v_all_card THEN 'card' ELSE v_pro.payment_method END, v_paid_at, v_pro.currency,
    v_pro.buyer_is_company, v_pro.buyer_name,
    v_pro.buyer_tax_id, v_pro.buyer_country, v_pro.buyer_address, v_pro.buyer_postal_code,
    v_pro.buyer_city, v_pro.buyer_email, v_pro.po_number, v_pro.recipient_name,
    v_pro.recipient_address, v_pro.buyer_user_id, v_pro.buyer_person_id, v_pro.crm_company_id,
    v_pro.id, v_pro.locale, v_pro.note, auth.uid()
  )
  RETURNING id INTO v_new;

  INSERT INTO public.event_invoice_sources (
    tenant_id, invoice_id, source_kind, registration_id, package_order_id, payment_order_id,
    person_id, seats, gross_cents, paid_at, covers
  )
  SELECT v_tenant, v_new, x.value->>'kind',
         CASE WHEN x.value->>'kind' = 'registration' THEN (x.value->>'id')::uuid END,
         CASE WHEN x.value->>'kind' = 'package_order' THEN (x.value->>'id')::uuid END,
         NULLIF(x.value->>'payment_order_id', '')::uuid,
         NULLIF(x.value->>'person_id', '')::uuid,
         (x.value->>'source_seats')::integer, (x.value->>'gross')::bigint,
         NULLIF(x.value->>'paid_at', '')::timestamptz, true
    FROM jsonb_array_elements(v_resolved) AS x;

  INSERT INTO public.event_invoice_lines (
    tenant_id, invoice_id, position, description, unit, quantity, unit_gross_cents, unit_net_cents,
    vat_rate, net_cents, vat_cents, gross_cents, ticket_type_id
  )
  SELECT v_tenant, v_new, l.position, l.description, l.unit, l.quantity, l.unit_gross_cents,
         l.unit_net_cents, l.vat_rate, l.net_cents, l.vat_cents, l.gross_cents, l.ticket_type_id
    FROM public.event_invoice_lines l
   WHERE l.invoice_id = v_pro.id AND l.tenant_id = v_tenant;
  PERFORM public._event_invoice_recalc(v_tenant, v_new);
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_from_proforma(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_from_proforma(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_from_proforma(uuid) IS
  'Szkic faktury koncowej z wystawionej proformy (te same pozycje i nabywca, zamowienia w BIEZACYM stanie: karta, kwota, zaplata). Bramka: assert_event_admin_tenant().';
