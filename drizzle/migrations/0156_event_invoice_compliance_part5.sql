-- CZESC 5/7 MIGRACJI 20261012100000_event_invoice_compliance.sql
-- events-harness: include
--
-- Panel: szczegoly dokumentu z dziennikiem KSeF i potrzeba kursu (INV-02,
-- INV-06), edycja szkicu z podstawa "np" i decyzja o odwrotnym obciazeniu
-- (INV-12), ustawienia wystawcy z podstawa "np" (INV-12). Funkcje
-- przedeklarowane W CALOSCI; zmiany: `-- ZMIANA (INV-xx)`.

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
    'correction_hint', public._event_invoice_correction_hint(v_tenant, p_id),
    -- ZMIANA (INV-02): dziennik stanu KSeF (najnowsze na koncu).
    'ksef_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'from_status', k.from_status, 'to_status', k.to_status, 'from_number', k.from_number,
        'to_number', k.to_number, 'note', k.note, 'created_at', k.created_at
      ) ORDER BY k.created_at, k.id)
        FROM public.event_invoice_ksef_events k
       WHERE k.invoice_id = p_id AND k.tenant_id = v_tenant
    ), '[]'::jsonb),
    -- ZMIANA (INV-16): brutto w stawce stanu PRZED szkicem korekty (faktura +
    -- wystawione korekty) - podglad edytora liczy roznice jak baza.
    'rate_gross_before', CASE
      WHEN v_doc->'invoice'->>'kind' = 'correction' AND v_doc->'invoice'->>'status' = 'draft' THEN (
        SELECT COALESCE(jsonb_object_agg(g.vat_rate, g.gross_cents), '{}'::jsonb)
          FROM public._event_invoice_rate_gross(
                 v_tenant, NULLIF(v_doc->'invoice'->>'corrects_invoice_id', '')::uuid, NULL) AS g)
      ELSE '{}'::jsonb
    END,
    -- ZMIANA (INV-06): kurs, ktorego wymaga wystawienie szkicu (NULL = PLN,
    -- proforma albo kurs dziedziczony po fakturze korygowanej).
    'fx_need', (
      SELECT n.value FROM jsonb_array_elements(
        public.admin_event_invoice_fx_needs(jsonb_build_object('invoice_ids', jsonb_build_array(p_id)))
      ) AS n LIMIT 1
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_get(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_get(uuid) IS
  'Pelny dokument (pozycje, podsumowanie VAT, sprzedawca, zrodla, korekty, stan po korektach, podpowiedz korekty, dziennik KSeF, potrzebny kurs NBP) do edytora i PDF. Bramka: assert_event_admin_tenant().';

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
  v_np_basis text;
  v_rc boolean;
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
           crm_company_id = NULL,
           -- ZMIANA (INV-12): weryfikacja VIES dotyczy podmiotu - inny numer
           -- albo kraj nabywcy = weryfikacja do powtorzenia.
           buyer_vies_subject = CASE
             WHEN i.buyer_vies_subject = public._event_invoice_vies_subject(v_buyer->>'country', v_buyer->>'tax_id')
               THEN i.buyer_vies_subject END,
           buyer_vies_valid = CASE
             WHEN i.buyer_vies_subject = public._event_invoice_vies_subject(v_buyer->>'country', v_buyer->>'tax_id')
               THEN i.buyer_vies_valid END,
           buyer_vies_request_id = CASE
             WHEN i.buyer_vies_subject = public._event_invoice_vies_subject(v_buyer->>'country', v_buyer->>'tax_id')
               THEN i.buyer_vies_request_id END,
           buyer_vies_checked_at = CASE
             WHEN i.buyer_vies_subject = public._event_invoice_vies_subject(v_buyer->>'country', v_buyer->>'tax_id')
               THEN i.buyer_vies_checked_at END
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
  -- ZMIANA (INV-12): podstawa "np" dokumentu (pusta = z ustawien wystawcy)
  -- i jawna decyzja o odwrotnym obciazeniu (JSON null = automatycznie).
  v_np_basis := CASE WHEN p_payload ? 'np_basis' THEN btrim(COALESCE(p_payload->>'np_basis', ''))
                     ELSE v_inv.np_basis END;
  IF char_length(v_np_basis) > 300 THEN
    RAISE EXCEPTION 'invalid_np_basis: the legal basis has more than 300 characters' USING ERRCODE = '22023';
  END IF;
  v_rc := CASE WHEN p_payload ? 'reverse_charge' THEN (p_payload->>'reverse_charge')::boolean
               ELSE v_inv.reverse_charge END;
  UPDATE public.event_invoices i
     SET payment_method = v_method,
         locale = v_locale,
         note = v_note,
         np_basis = v_np_basis,
         reverse_charge = v_rc,
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
  'Edycja szkicu: nabywca (klucze pominiete = bez zmian; zmiana podmiotu kasuje weryfikacje VIES), daty sprzedazy i platnosci, sposob platnosci, jezyk, uwagi, podstawa "np", odwrotne obciazenie, pozycje (pelna lista). Bramka: assert_event_admin_tenant().';

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
     OR char_length(v_new->>'vat_exempt_basis') > 300 OR char_length(v_new->>'vat_np_basis') > 300
     OR char_length(v_new->>'footer_note') > 500 THEN
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
  -- ZMIANA (INV-12): domyslna stawka "np" bez podstawy prawnej wystawialaby
  -- dokumenty, ktore wystawienie i tak odrzuci.
  IF (v_new->>'default_vat_rate') = 'np' AND (v_new->>'vat_np_basis') = '' THEN
    RAISE EXCEPTION 'vat_np_basis_required: lines outside the scope of Polish VAT need the legal basis'
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
    default_vat_rate, vat_exempt_basis, vat_np_basis, footer_note, default_locale, updated_by
  ) VALUES (
    v_tenant, v_enabled, v_confirmed, CASE WHEN v_confirmed IS NOT NULL THEN auth.uid() END,
    v_new->>'seller_name', v_tax, v_new->>'seller_address', v_new->>'seller_postal_code',
    v_new->>'seller_city', v_country, lower(v_new->>'seller_email'), v_new->>'seller_phone',
    upper(regexp_replace(v_new->>'seller_bank_account', '[[:space:]]', '', 'g')),
    upper(v_new->>'seller_bank_swift'), upper(v_new->>'series_invoice'), upper(v_new->>'series_proforma'),
    upper(v_new->>'series_correction'), (v_new->>'payment_days')::integer, v_new->>'default_vat_rate',
    v_new->>'vat_exempt_basis', v_new->>'vat_np_basis', v_new->>'footer_note', v_new->>'default_locale',
    auth.uid()
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
    vat_np_basis = EXCLUDED.vat_np_basis,
    footer_note = EXCLUDED.footer_note,
    default_locale = EXCLUDED.default_locale,
    updated_by = EXCLUDED.updated_by;
  RETURN public._event_invoice_settings_json(v_tenant);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_settings_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_settings_save(jsonb) IS
  'Zapis danych wystawcy (klucz pominiety = bez zmian), z podstawami "zw" i "np". Wlaczenie wymaga kompletu danych sprzedawcy i jednorazowego potwierdzenia confirm_seller. Bramka: assert_event_admin_tenant().';

-- migration-split: part 5/7 of 20261012100000_event_invoice_compliance.sql