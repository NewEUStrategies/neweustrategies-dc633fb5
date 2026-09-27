-- CZESC 3/5 MIGRACJI 0058_event_invoices.sql
-- migration-split: part 3/5 of 0058_event_invoices.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 0058_event_invoices.sql,
-- potem 0058_event_invoices_part2.sql .. 0058_event_invoices_part5.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.

-- Budowa szkicu z zamowien (pojedynczy albo ZBIORCZY). Wolaja:
-- admin_event_invoice_draft_create i admin_event_invoice_issue_pending.
CREATE OR REPLACE FUNCTION public._event_invoice_draft_build(p_tenant uuid, p_actor uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    v_resolved := v_resolved || jsonb_build_array(
      public._event_invoice_resolve_source(p_tenant, v_event_id, v_skind, v_sid, v_rate, v_locale)
    );
    IF v_kind = 'invoice' AND EXISTS (
      SELECT 1 FROM public.event_invoice_sources s
       WHERE s.tenant_id = p_tenant AND s.covers AND s.released_at IS NULL
         AND (s.registration_id = v_sid OR s.package_order_id = v_sid)
    ) THEN
      RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
    END IF;
  END LOOP;

  -- Faktura zbiorcza dla JEDNEGO nabywcy. Oczekujace prosby zrodel od roznych
  -- nabywcow (inny NIP albo osoba prywatna) wystawienie oznaczyloby jako
  -- zafakturowane na danych jednego z nich - drugi nabywca zostalby bez
  -- faktury i bez mozliwosci poproszenia o nia. Odmawiamy.
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

  -- Nabywca: jawny z panelu > wskazana prosba > najstarsza oczekujaca prosba
  -- wsrod zrodel > dane osoby z pierwszego zrodla (szkic do uzupelnienia).
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

  -- Jednostki: kwota zrodla dzielona na miejsca; reszta z dzielenia na
  -- osobnej pozycji (u + 1 grosz), zeby ilosc x cena = wartosc.
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(v_resolved) AS x LOOP
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
        'ticket_type_id', v_item->>'ticket_type_id',
        'qty', v_qty - v_r, 'unit_gross', v_u
      ));
      IF v_r > 0 THEN
        v_units := v_units || jsonb_build_array(jsonb_build_object(
          'ord', v_ord * 2 + 1, 'item', v_item->>'item', 'label', v_item->>'label',
          'unit', v_item->>'unit', 'ticket_type_id', v_item->>'ticket_type_id',
          'qty', v_r, 'unit_gross', v_u + 1
        ));
      END IF;
    END LOOP;
  END LOOP;

  FOR v_line IN
    SELECT u.label, u.unit, u.ticket_type_id, sum(u.qty)::integer AS qty, u.unit_gross
      FROM jsonb_to_recordset(v_units) AS u(
        ord integer, item text, label text, unit text, ticket_type_id uuid, qty integer, unit_gross bigint
      )
     GROUP BY CASE WHEN v_aggregate = 'per_ticket_type' THEN u.item ELSE u.ord::text END,
              u.label, u.unit, u.ticket_type_id, u.unit_gross
     ORDER BY min(u.ord)
  LOOP
    PERFORM public._event_invoice_add_line(
      p_tenant, v_invoice, left(v_line.label, 300), v_line.unit, v_line.qty, v_line.unit_gross,
      v_rate, v_line.ticket_type_id
    );
  END LOOP;
  PERFORM public._event_invoice_recalc(p_tenant, v_invoice);
  RETURN v_invoice;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_draft_build(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_draft_build(uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_invoice_draft_build(uuid, uuid, jsonb) IS
  'Szkic faktury/proformy z zamowien wydarzenia (zapisy prowadzacych grupy, zamowienia pakietow): nabywca z panelu, prosby albo osoby; pozycje per zrodlo albo per rodzaj biletu.';

-- Powiazanie nabywcy z kartoteka CRM przy wystawieniu. NIGDY nie rzuca:
-- awaria kartoteki nie moze zablokowac dokumentu.
CREATE OR REPLACE FUNCTION public._event_invoice_crm_link(p_tenant uuid, p_actor uuid, p_invoice uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
  v_company uuid;
  v_key text;
  v_meta jsonb;
  v_action text;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
  v_action := CASE v_inv.kind
    WHEN 'proforma' THEN 'event.invoice.proforma_issued'
    WHEN 'correction' THEN 'event.invoice.correction_issued'
    ELSE 'event.invoice.issued'
  END;
  v_meta := jsonb_build_object(
    'event_id', v_inv.event_id,
    'event_slug', v_inv.event_slug,
    'event_title_pl', v_inv.event_title_pl,
    'event_title_en', v_inv.event_title_en,
    'summary_pl', CASE v_inv.kind WHEN 'proforma' THEN 'Proforma ' WHEN 'correction' THEN 'Korekta '
                  ELSE 'Faktura ' END || COALESCE(v_inv.number, '') || ' - ' || v_inv.event_title_pl,
    'summary_en', CASE v_inv.kind WHEN 'proforma' THEN 'Proforma ' WHEN 'correction' THEN 'Credit note '
                  ELSE 'Invoice ' END || COALESCE(v_inv.number, '') || ' - ' || v_inv.event_title_en,
    'invoice_id', v_inv.id,
    'invoice_kind', v_inv.kind,
    'number', v_inv.number,
    'gross_cents', v_inv.gross_cents,
    'currency', v_inv.currency
  );

  BEGIN
    IF v_inv.buyer_is_company AND btrim(v_inv.buyer_name) <> '' THEN
      v_company := v_inv.crm_company_id;
      v_key := public._event_invoice_tax_key(v_inv.buyer_tax_id);
      IF v_company IS NULL AND v_key <> '' THEN
        SELECT c.id INTO v_company
          FROM public.crm_companies c
         WHERE c.tenant_id = p_tenant AND c.tax_id IS NOT NULL
           AND public._event_invoice_tax_key(c.tax_id) = v_key
         ORDER BY c.created_at, c.id
         LIMIT 1;
      END IF;
      IF v_company IS NULL THEN
        SELECT m.id INTO v_company FROM public.crm_ensure_member_company(p_tenant, v_inv.buyer_name, p_actor) AS m;
        -- Dopasowanie po NAZWIE ignoruje NIP (klucz nazwy zdejmuje forme
        -- prawna): "Globex" z NIP-em A trafilby do "Globex Sp. z o.o." z NIP-em
        -- B - przychod i os czasu innego podmiotu. Firma z INNYM niepustym
        -- NIP-em to inny podmiot: zakladamy nowa z nazwa i NIP-em nabywcy.
        -- Blokada doradcza `crm_ensure_member_company` trwa do konca
        -- transakcji, wiec rownolegle wystawienie czeka; po niej ponownie
        -- szukamy po NIP-ie, zeby nie zalozyc tej samej firmy dwa razy.
        IF v_company IS NOT NULL AND v_key <> '' AND EXISTS (
          SELECT 1 FROM public.crm_companies c
           WHERE c.id = v_company AND c.tenant_id = p_tenant
             AND btrim(COALESCE(c.tax_id, '')) <> ''
             AND public._event_invoice_tax_key(c.tax_id) <> v_key
        ) THEN
          v_company := NULL;
          SELECT c.id INTO v_company
            FROM public.crm_companies c
           WHERE c.tenant_id = p_tenant AND c.tax_id IS NOT NULL
             AND public._event_invoice_tax_key(c.tax_id) = v_key
           ORDER BY c.created_at, c.id
           LIMIT 1;
          IF v_company IS NULL THEN
            INSERT INTO public.crm_companies (tenant_id, name, tax_id, created_by)
            VALUES (p_tenant, btrim(v_inv.buyer_name), v_inv.buyer_tax_id, p_actor)
            RETURNING id INTO v_company;
          END IF;
        END IF;
      END IF;
      IF v_company IS NOT NULL THEN
        UPDATE public.crm_companies c
           SET tax_id = COALESCE(NULLIF(btrim(c.tax_id), ''), NULLIF(v_inv.buyer_tax_id, '')),
               address = COALESCE(NULLIF(btrim(c.address), ''), NULLIF(v_inv.buyer_address, '')),
               postal_code = COALESCE(NULLIF(btrim(c.postal_code), ''), NULLIF(v_inv.buyer_postal_code, '')),
               city = COALESCE(NULLIF(btrim(c.city), ''), NULLIF(v_inv.buyer_city, '')),
               country = COALESCE(NULLIF(btrim(c.country), ''), NULLIF(v_inv.buyer_country, '')),
               email = COALESCE(NULLIF(btrim(c.email), ''), NULLIF(v_inv.buyer_email, ''))
         WHERE c.id = v_company AND c.tenant_id = p_tenant;
        UPDATE public.event_invoices i SET crm_company_id = v_company
         WHERE i.id = p_invoice AND i.tenant_id = p_tenant AND i.crm_company_id IS NULL;
        UPDATE public.event_invoice_requests q SET crm_company_id = v_company
         WHERE q.tenant_id = p_tenant AND q.crm_company_id IS NULL
           AND (q.registration_id IN (SELECT s.registration_id FROM public.event_invoice_sources s
                                        WHERE s.invoice_id = p_invoice AND s.tenant_id = p_tenant)
                OR q.package_order_id IN (SELECT s.package_order_id FROM public.event_invoice_sources s
                                           WHERE s.invoice_id = p_invoice AND s.tenant_id = p_tenant));
        UPDATE public.event_package_orders o SET company_id = v_company
         WHERE o.tenant_id = p_tenant AND o.company_id IS NULL
           AND o.id IN (SELECT s.package_order_id FROM public.event_invoice_sources s
                         WHERE s.invoice_id = p_invoice AND s.tenant_id = p_tenant);
        INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
        VALUES (p_tenant, p_actor, v_action, 'crm_company', v_company, v_meta);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_company := NULL;
  END;

  IF v_inv.buyer_person_id IS NOT NULL AND v_inv.kind <> 'correction' THEN
    PERFORM public._event_person_crm_sync(
      p_tenant, v_inv.buyer_person_id, 'event_participant',
      'event:' || v_inv.event_slug || ':invoice', ARRAY['event:' || v_inv.event_slug],
      '{}'::jsonb, true, v_action, v_meta
    );
  END IF;
  RETURN v_company;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_crm_link(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_crm_link(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_crm_link(uuid, uuid, uuid) IS
  'Firma nabywcy w CRM (NIP, potem nazwa), uzupelnienie WYLACZNIE pustych pol, wpis osi czasu firmy i most osoby kupujacej. Nigdy nie rzuca.';

-- Wystawienie: numer, migawka sprzedawcy, stan KSeF, prosby, CRM, zdarzenie.
CREATE OR REPLACE FUNCTION public._event_invoice_issue_core(p_tenant uuid, p_actor uuid, p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
  v_target public.event_invoices;
  v_settings public.event_invoice_settings;
  v_buyer jsonb;
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_series text;
  v_num record;
  v_due date;
  v_exempt boolean;
  v_source public.event_invoice_sources;
  v_now jsonb;
  v_card uuid;
  v_block text;
  v_bad integer;
  v_open integer;
  v_open_anchors integer;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = p_invoice AND i.tenant_id = p_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'not_draft: only a draft can be issued' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_settings FROM public.event_invoice_settings s WHERE s.tenant_id = p_tenant;
  IF NOT FOUND OR NOT v_settings.enabled THEN
    RAISE EXCEPTION 'invoicing_disabled: complete and confirm the issuer settings first'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_invoice_lines l
                  WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'no_lines: a document needs at least one line' USING ERRCODE = '22023';
  END IF;
  v_buyer := public._event_invoice_buyer_clean(public._event_invoice_buyer_json(v_inv));
  v_exempt := EXISTS (SELECT 1 FROM public.event_invoice_lines l
                       WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant AND l.vat_rate = 'zw');
  IF v_exempt AND btrim(v_settings.vat_exempt_basis) = '' THEN
    RAISE EXCEPTION 'vat_exempt_basis_required: exempt lines need the legal basis in issuer settings'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.kind <> 'correction' AND v_inv.gross_cents < 0 THEN
    RAISE EXCEPTION 'negative_total: only a correction can have a negative total' USING ERRCODE = '22023';
  END IF;
  -- ZRODLA SPRAWDZANE NA NOWO. Szkic (takze z proformy) moze powstac przed
  -- zaplata karta albo przed zwrotem; migawka zrodla z chwili szkicu nie
  -- wystarcza. Zamowienie z karty, ktorego organizator nie moze fakturowac
  -- (_event_invoice_card_block), blokuje wystawienie; zrodlo zmienione od
  -- szkicu (nowe zamowienie z karty, inna kwota zamowienia, zamowienie
  -- usuniete) tez - organizator tworzy szkic od nowa na aktualnych danych.
  IF v_inv.kind = 'invoice' THEN
    FOR v_source IN
      SELECT * FROM public.event_invoice_sources s
       WHERE s.invoice_id = v_inv.id AND s.tenant_id = p_tenant
       ORDER BY s.created_at, s.id
    LOOP
      IF COALESCE(v_source.registration_id, v_source.package_order_id) IS NULL THEN
        RAISE EXCEPTION 'source_changed: an order of this draft changed - create the draft again'
          USING ERRCODE = '22023';
      END IF;
      v_now := public._event_invoice_resolve_source(
        p_tenant, v_inv.event_id, v_source.source_kind,
        COALESCE(v_source.registration_id, v_source.package_order_id),
        v_settings.default_vat_rate, v_inv.locale
      );
      v_card := NULLIF(v_now->>'payment_order_id', '')::uuid;
      v_block := CASE WHEN v_card IS NOT NULL THEN public._event_invoice_card_block(p_tenant, v_card) END;
      IF v_block = 'mor_seller_conflict' THEN
        RAISE EXCEPTION 'mor_seller_conflict: card orders of the managed checkout are sold by the payment operator'
          USING ERRCODE = '22023';
      ELSIF v_block = 'operator_invoice_enabled' THEN
        RAISE EXCEPTION 'operator_invoice_enabled: the checkout already issues invoices for card payments'
          USING ERRCODE = '22023';
      ELSIF v_block = 'billing_plane_unknown' THEN
        RAISE EXCEPTION 'billing_plane_unknown: checkout settings changed after this card order'
          USING ERRCODE = '22023';
      END IF;
      IF v_card IS DISTINCT FROM v_source.payment_order_id
         OR ((v_card IS NOT NULL OR v_source.source_kind = 'package_order')
             AND (v_now->>'gross')::bigint <> v_source.gross_cents) THEN
        RAISE EXCEPTION 'source_changed: an order of this draft changed - create the draft again'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    -- Jeden nabywca (patrz _event_invoice_draft_build) - takze przy wystawieniu.
    IF (
      SELECT count(DISTINCT CASE
               WHEN q.buyer_tax_id <> ''
                 THEN 'tax:' || public._event_invoice_tax_key(q.buyer_tax_id) || ':' || q.buyer_country
               ELSE 'request:' || q.id::text
             END)
        FROM public.event_invoice_requests q
        JOIN public.event_invoice_sources s
          ON s.tenant_id = q.tenant_id AND s.invoice_id = v_inv.id
         AND (s.registration_id = q.registration_id OR s.package_order_id = q.package_order_id)
       WHERE q.tenant_id = p_tenant AND q.status = 'pending'
    ) > 1 THEN
      RAISE EXCEPTION 'buyer_mismatch: the picked orders carry invoice requests of different buyers'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_inv.kind = 'correction' THEN
    SELECT * INTO v_target FROM public.event_invoices i
     WHERE i.id = v_inv.corrects_invoice_id AND i.tenant_id = p_tenant
     FOR UPDATE;
    IF v_target.status IS DISTINCT FROM 'issued' THEN
      RAISE EXCEPTION 'correction_target_invalid: the corrected invoice is not issued'
        USING ERRCODE = '22023';
    END IF;
    -- STAN PO KOREKCIE musi byc czysty (patrz _event_invoice_state): bez
    -- ujemnych ilosci, bez resztek netto, najwyzej jedna grupa na kotwice,
    -- netto grupy = netto z jej brutto. Pelna korekta zeruje CALY stan (tylko
    -- wtedy zwalnia zamowienia do ponownego zafakturowania); korekta czesciowa
    -- zerujaca wszystko musi byc pelna, zeby zamowienia nie zostaly
    -- zablokowane na fakturze o wartosci zero.
    SELECT count(*) FILTER (
             WHERE st.quantity < 0
                OR (st.quantity = 0 AND st.net_cents <> 0)
                OR (st.quantity > 0
                    AND st.net_cents <> public._event_invoice_net_from_gross(st.gross_cents, st.vat_rate))),
           count(*) FILTER (WHERE st.quantity > 0),
           count(DISTINCT st.anchor_id) FILTER (WHERE st.quantity > 0)
      INTO v_bad, v_open, v_open_anchors
      FROM public._event_invoice_state(p_tenant, v_target.id, v_inv.id) AS st;
    IF v_bad > 0 OR v_open > v_open_anchors OR (v_inv.correction_mode = 'full' AND v_open > 0) THEN
      RAISE EXCEPTION 'correction_inconsistent: the correction does not match the current state of the invoice'
        USING ERRCODE = '22023';
    END IF;
    IF v_inv.correction_mode = 'partial' AND v_open = 0 THEN
      RAISE EXCEPTION 'correction_use_full: the correction reverses the whole invoice - use a full correction'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  v_due := COALESCE(v_inv.due_date,
                    v_today + CASE WHEN v_inv.paid_at IS NOT NULL THEN 0 ELSE v_settings.payment_days END);
  IF v_due < v_today THEN
    RAISE EXCEPTION 'invalid_due_date: due date is before the issue date' USING ERRCODE = '22023';
  END IF;

  v_series := CASE v_inv.kind
    WHEN 'proforma' THEN v_settings.series_proforma
    WHEN 'correction' THEN v_settings.series_correction
    ELSE v_settings.series_invoice
  END;
  SELECT * INTO v_num FROM public._event_invoice_next_number(p_tenant, v_series, v_today);

  UPDATE public.event_invoices i
     SET status = 'issued',
         series = v_series,
         period = v_num.out_period,
         seq = v_num.out_seq,
         number = v_num.out_number,
         issue_date = v_today,
         due_date = v_due,
         sale_date = COALESCE(i.sale_date, v_today),
         buyer_is_company = (v_buyer->>'is_company')::boolean,
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
         seller = public._event_invoice_seller_json(p_tenant),
         vat_exempt_basis = CASE WHEN v_exempt THEN v_settings.vat_exempt_basis ELSE '' END,
         ksef_status = CASE
           WHEN i.kind <> 'proforma' AND v_settings.seller_country = 'PL' THEN 'pending'
           ELSE 'not_applicable' END,
         issued_at = now(),
         issued_by = p_actor
   WHERE i.id = v_inv.id AND i.tenant_id = p_tenant;

  IF v_inv.kind = 'invoice' THEN
    UPDATE public.event_invoice_requests q
       SET status = 'invoiced', invoice_id = v_inv.id
     WHERE q.tenant_id = p_tenant AND q.status = 'pending'
       AND (q.registration_id IN (SELECT s.registration_id FROM public.event_invoice_sources s
                                    WHERE s.invoice_id = v_inv.id AND s.tenant_id = p_tenant)
            OR q.package_order_id IN (SELECT s.package_order_id FROM public.event_invoice_sources s
                                       WHERE s.invoice_id = v_inv.id AND s.tenant_id = p_tenant));
  ELSIF v_inv.kind = 'correction' AND v_inv.correction_mode = 'full' THEN
    UPDATE public.event_invoice_sources s
       SET released_at = now()
     WHERE s.invoice_id = v_target.id AND s.tenant_id = p_tenant AND s.released_at IS NULL;
    UPDATE public.event_invoice_requests q
       SET status = 'pending', invoice_id = NULL
     WHERE q.tenant_id = p_tenant AND q.invoice_id = v_target.id AND q.status = 'invoiced';
  END IF;

  PERFORM public._event_invoice_crm_link(p_tenant, p_actor, v_inv.id);

  PERFORM public.emit_domain_event(
    p_tenant,
    'event_invoice',
    v_inv.id::text,
    'event_invoice.issued.v1',
    jsonb_build_object('event_id', v_inv.event_id, 'invoice_id', v_inv.id, 'kind', v_inv.kind),
    p_actor
  );
  RETURN jsonb_build_object(
    'id', v_inv.id, 'number', v_num.out_number, 'kind', v_inv.kind, 'event_id', v_inv.event_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) IS
  'Wystawienie szkicu: walidacja (wystawca, nabywca, zw, MoR, korekta), numer bez luk, migawka sprzedawcy, KSeF pending, prosby -> invoiced, pelna korekta zwalnia zrodla, CRM, event_invoice.issued.v1.';

CREATE OR REPLACE FUNCTION public._event_invoice_correction_hint(p_tenant uuid, p_invoice uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
  v_source public.event_invoice_sources;
  v_now jsonb;
  v_status text;
  v_money bigint;
  v_seats integer;
  v_valid bigint;
  v_reason text;
  v_rank integer := 0;
  v_shortfall bigint := 0;
  v_corrected bigint;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status <> 'issued' THEN
    RETURN NULL;
  END IF;
  FOR v_source IN
    SELECT * FROM public.event_invoice_sources s
     WHERE s.invoice_id = v_inv.id AND s.tenant_id = p_tenant AND s.covers AND s.released_at IS NULL
  LOOP
    v_valid := v_source.gross_cents;
    v_reason := NULL;
    IF v_source.source_kind = 'registration' THEN
      v_now := public._event_invoice_registration_source(p_tenant, v_source.registration_id, '23');
      IF v_now IS NULL OR v_now->>'status' IN ('cancelled', 'rejected') OR v_now->>'payment_status' = 'refunded' THEN
        v_valid := 0;
        v_reason := 'source_closed';
      ELSIF v_source.payment_order_id IS NOT NULL THEN
        SELECT (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint INTO v_money
          FROM public.payment_orders o
         WHERE o.id = v_source.payment_order_id AND o.tenant_id = p_tenant;
        IF COALESCE(v_money, 0) < v_source.gross_cents THEN
          v_valid := greatest(COALESCE(v_money, 0), 0);
          v_reason := 'refunded';
        END IF;
      ELSE
        v_seats := CASE WHEN v_now->>'block' IS NULL THEN (v_now->>'seats')::integer ELSE 0 END;
        IF v_seats < v_source.seats THEN
          v_valid := (v_source.gross_cents * greatest(v_seats, 0) + v_source.seats - 1) / v_source.seats;
          v_reason := 'seats_reduced';
        END IF;
      END IF;
    ELSE
      SELECT o.status INTO v_status
        FROM public.event_package_orders o
       WHERE o.id = v_source.package_order_id AND o.tenant_id = p_tenant;
      IF v_status IS NULL OR v_status NOT IN ('pending', 'paid') THEN
        v_valid := 0;
        v_reason := 'source_closed';
      ELSIF v_source.payment_order_id IS NOT NULL THEN
        SELECT (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint INTO v_money
          FROM public.payment_orders o
         WHERE o.id = v_source.payment_order_id AND o.tenant_id = p_tenant;
        IF COALESCE(v_money, 0) < v_source.gross_cents THEN
          v_valid := greatest(COALESCE(v_money, 0), 0);
          v_reason := 'refunded';
        END IF;
      END IF;
    END IF;
    v_shortfall := v_shortfall + (v_source.gross_cents - v_valid);
    v_rank := greatest(v_rank, CASE v_reason WHEN 'source_closed' THEN 3 WHEN 'refunded' THEN 2
                                             WHEN 'seats_reduced' THEN 1 ELSE 0 END);
  END LOOP;
  SELECT -COALESCE(sum(c.gross_cents), 0)::bigint INTO v_corrected
    FROM public.event_invoices c
   WHERE c.tenant_id = p_tenant AND c.corrects_invoice_id = v_inv.id AND c.status = 'issued';
  IF v_shortfall <= 0 OR v_shortfall <= v_corrected THEN
    RETURN NULL;
  END IF;
  RETURN CASE v_rank WHEN 3 THEN 'source_closed' WHEN 2 THEN 'refunded' ELSE 'seats_reduced' END;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_correction_hint(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_correction_hint(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_correction_hint(uuid, uuid) IS
  'Podpowiedz korekty wystawionej faktury: source_closed (zapis/pakiet odwolany albo zwrocony), refunded (zwrot z karty) albo seats_reduced (mniej miejsc na zapisie z cennika), gdy ubytek sprzedazy przekracza to, co zdjely wystawione korekty; inaczej NULL.';

-- Dokument w ksztalcie do podgladu, PDF i szczegolow (panel i kupujacy).
CREATE OR REPLACE FUNCTION public._event_invoice_document(p_tenant uuid, p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'invoice', to_jsonb(v_inv) - 'seller' - 'tenant_id' - 'created_by' - 'issued_by' - 'cancelled_by',
    'seller', COALESCE(v_inv.seller, public._event_invoice_seller_json(p_tenant)),
    -- Stopka wystawionego dokumentu pochodzi z MIGAWKI sprzedawcy (z chwili
    -- wystawienia) - zmiana stopki w ustawieniach nie moze zmieniac tresci
    -- wydanych juz faktur. Biezace ustawienia wylacznie dla szkicu.
    'footer_note', CASE
      WHEN v_inv.seller IS NOT NULL THEN COALESCE(v_inv.seller->>'footer_note', '')
      ELSE COALESCE((SELECT s.footer_note FROM public.event_invoice_settings s
                      WHERE s.tenant_id = p_tenant), '')
    END,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'position', l.position, 'description', l.description, 'unit', l.unit,
        'quantity', l.quantity, 'unit_gross_cents', l.unit_gross_cents,
        'unit_net_cents', l.unit_net_cents, 'vat_rate', l.vat_rate, 'net_cents', l.net_cents,
        'vat_cents', l.vat_cents, 'gross_cents', l.gross_cents, 'ticket_type_id', l.ticket_type_id,
        'corrects_line_id', l.corrects_line_id
      ) ORDER BY l.position)
      FROM public.event_invoice_lines l WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant
    ), '[]'::jsonb),
    'vat_summary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'vat_rate', x.vat_rate, 'net_cents', x.net, 'vat_cents', x.vat, 'gross_cents', x.gross
      ) ORDER BY x.vat_rate)
      FROM (
        SELECT l.vat_rate, sum(l.net_cents) AS net, sum(l.vat_cents) AS vat, sum(l.gross_cents) AS gross
          FROM public.event_invoice_lines l
         WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant
         GROUP BY l.vat_rate
      ) AS x
    ), '[]'::jsonb),
    'corrects', (
      SELECT jsonb_build_object('id', c.id, 'number', c.number, 'issue_date', c.issue_date,
                                'sale_date', c.sale_date)
        FROM public.event_invoices c
       WHERE c.id = v_inv.corrects_invoice_id AND c.tenant_id = p_tenant
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_document(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_document(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. PLASZCZYZNA PANELU (assert_event_admin_tenant).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_invoice_settings_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN public._event_invoice_settings_json(v_tenant);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_settings_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_settings_get() TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_settings_get() IS
  'Dane wystawcy faktur wydarzen najemcy (brak wiersza = domyslne, wylaczone). Bramka: assert_event_admin_tenant().';
