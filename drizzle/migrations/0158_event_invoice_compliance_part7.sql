-- CZESC 7/7 MIGRACJI 20261012100000_event_invoice_compliance.sql
-- events-harness: include
--
-- INV-14: PROFORMA -> FAKTURA z kwota, ktora faktycznie wplynela.
--
-- PRZYCZYNA. Faktura koncowa kopiowala pozycje proformy. Miedzy proforma
-- a zaplata kupujacy czesto placi inna kwote (kod rabatowy w kasie, cena
-- uzgodniona przelewem), a pozycje proformy zostawaly - faktura za 99,00 zl
-- wychodzila na 123,00 zl, a edytor pokazywal jedynie ostrzezenie. Teraz
-- wystawienie i tak odmawia rozjazdu (`amount_mismatch`, czesc 3), wiec
-- szkic faktury od razu bierze pozycje z WPLAT, gdy wszystkie zamowienia sa
-- oplacone i suma proformy sie z nimi nie zgadza: te same grupy miejsc
-- i ten sam podzial reszty co `_event_invoice_draft_build` (n-r po u oraz
-- r po u+1 grosza), stawka proformy. Gdy kwoty sie zgadzaja (albo cos jest
-- jeszcze nieoplacone) - pozycje proformy jak dotad.
-- Cialo z 20260927000203; zmiany oznacza `-- ZMIANA (INV-14)`.

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
  v_paid_gross bigint;
  v_pro_gross bigint;
  v_item jsonb;
  v_group jsonb;
  v_qty integer;
  v_u bigint;
  v_r integer;
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
  -- wystawieniu dziala regula operatora (_event_invoice_card_block).
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
         max(NULLIF(x.value->>'paid_at', '')::timestamptz), COALESCE(sum((x.value->>'gross')::bigint), 0)
    INTO v_all_paid, v_all_card, v_paid_at, v_paid_gross
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

  SELECT COALESCE(sum(l.gross_cents), 0)::bigint INTO v_pro_gross
    FROM public.event_invoice_lines l WHERE l.invoice_id = v_pro.id AND l.tenant_id = v_tenant;
  IF COALESCE(v_all_paid, false) AND v_paid_gross <> v_pro_gross THEN
    -- ZMIANA (INV-14): pozycje z wplat (grupy miejsc zrodla, reszta grosza
    -- na drugiej pozycji), bo faktura dokumentuje to, co wplynelo.
    FOR v_item IN SELECT x.value FROM jsonb_array_elements(v_resolved) AS x LOOP
      FOR v_group IN
        SELECT g.value FROM jsonb_array_elements(v_item->'units') AS g
         WHERE (g.value->>'qty')::integer > 0
      LOOP
        v_qty := (v_group->>'qty')::integer;
        v_u := (v_group->>'gross')::bigint / v_qty;
        v_r := ((v_group->>'gross')::bigint - v_u * v_qty)::integer;
        IF v_qty - v_r > 0 THEN
          PERFORM public._event_invoice_add_line(
            v_tenant, v_new, left(v_item->>'label', 300), v_item->>'unit', v_qty - v_r, v_u, v_rate,
            NULLIF(v_item->>'ticket_type_id', '')::uuid);
        END IF;
        IF v_r > 0 THEN
          PERFORM public._event_invoice_add_line(
            v_tenant, v_new, left(v_item->>'label', 300), v_item->>'unit', v_r, v_u + 1, v_rate,
            NULLIF(v_item->>'ticket_type_id', '')::uuid);
        END IF;
      END LOOP;
    END LOOP;
  ELSE
    INSERT INTO public.event_invoice_lines (
      tenant_id, invoice_id, position, description, unit, quantity, unit_gross_cents, unit_net_cents,
      vat_rate, net_cents, vat_cents, gross_cents, ticket_type_id
    )
    SELECT v_tenant, v_new, l.position, l.description, l.unit, l.quantity, l.unit_gross_cents,
           l.unit_net_cents, l.vat_rate, l.net_cents, l.vat_cents, l.gross_cents, l.ticket_type_id
      FROM public.event_invoice_lines l
     WHERE l.invoice_id = v_pro.id AND l.tenant_id = v_tenant;
  END IF;
  PERFORM public._event_invoice_recalc(v_tenant, v_new);
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_from_proforma(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_from_proforma(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_from_proforma(uuid) IS
  'Szkic faktury koncowej z wystawionej proformy (nabywca z proformy, zamowienia w BIEZACYM stanie; pozycje z proformy albo - gdy wszystko oplacone i suma sie rozni - z faktycznych wplat). Bramka: assert_event_admin_tenant().';

-- migration-split: part 7/7 of 20261012100000_event_invoice_compliance.sql