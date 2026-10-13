-- CZESC 2/2 MIGRACJI 20261012130200_event_ticket_tax_profile.sql
-- migration-split: part 2/2 of 20261012130200_event_ticket_tax_profile.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 20261012130200_event_ticket_tax_profile.sql,
-- potem 20261012130201_event_ticket_tax_profile_part2.sql .. 20261012130201_event_ticket_tax_profile_part2.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.
-- events-harness: include

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
  v_exempt_basis text;
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
  v_np boolean;
  v_np_basis text;
  v_rc boolean;
  v_sources_gross bigint := 0;
  v_all_paid boolean := true;
  v_lines_gross bigint;
  v_fx_basis date;
  v_fx public.nbp_exchange_rates;
  v_summary jsonb;
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
  IF v_inv.kind = 'correction' THEN
    SELECT * INTO v_target FROM public.event_invoices i
     WHERE i.id = v_inv.corrects_invoice_id AND i.tenant_id = p_tenant
     FOR UPDATE;
  END IF;
  -- TIX-09: podstawa zwolnienia - szkic (bilet/pakiet) > faktura korygowana
  -- (korekta, takze tworzona automatycznie przy zwrocie, dziedziczy podstawe,
  -- z ktora faktura wyszla) > ustawienia najemcy jako ostatni szczebel.
  v_exempt_basis := COALESCE(NULLIF(btrim(v_inv.vat_exempt_basis), ''),
                             NULLIF(btrim(v_target.vat_exempt_basis), ''),
                             COALESCE(btrim(v_settings.vat_exempt_basis), ''));
  IF v_exempt AND v_exempt_basis = '' THEN
    RAISE EXCEPTION 'vat_exempt_basis_required: exempt lines need the legal basis in issuer settings'
      USING ERRCODE = '22023';
  END IF;
  -- ZMIANA (INV-12): stawka "np" wymaga podstawy prawnej (szkic > faktura
  -- korygowana > ustawienia wystawcy), a odwrotne obciazenie - nabywcy-firmy
  -- spoza Polski, samych pozycji "np" i (nabywca z UE) waznej weryfikacji VIES
  -- tego samego numeru z ostatnich 30 dni. Korekta dziedziczy decyzje faktury.
  v_np := EXISTS (SELECT 1 FROM public.event_invoice_lines l
                   WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant AND l.vat_rate = 'np');
  v_np_basis := COALESCE(NULLIF(btrim(v_inv.np_basis), ''), NULLIF(btrim(v_target.np_basis), ''),
                         btrim(v_settings.vat_np_basis));
  IF v_np AND v_np_basis = '' THEN
    RAISE EXCEPTION 'vat_np_basis_required: lines outside the scope of Polish VAT need the legal basis'
      USING ERRCODE = '22023';
  END IF;
  v_rc := CASE
    WHEN v_inv.kind = 'correction' AND v_inv.reverse_charge IS NULL THEN COALESCE(v_target.reverse_charge, false)
    ELSE COALESCE(public._event_invoice_reverse_charge(p_tenant, v_inv.id), false)
  END;
  IF v_rc AND (NOT (v_buyer->>'is_company')::boolean OR v_buyer->>'country' = 'PL'
               OR EXISTS (SELECT 1 FROM public.event_invoice_lines l
                           WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant AND l.vat_rate <> 'np')) THEN
    RAISE EXCEPTION 'reverse_charge_invalid: reverse charge needs a foreign company buyer and only np lines'
      USING ERRCODE = '22023';
  END IF;
  IF v_rc AND v_inv.kind <> 'correction' AND public._event_invoice_eu_country(v_buyer->>'country')
     AND NOT (COALESCE(v_inv.buyer_vies_valid, false)
              AND v_inv.buyer_vies_subject = public._event_invoice_vies_subject(v_buyer->>'country', v_buyer->>'tax_id')
              AND v_inv.buyer_vies_checked_at >= now() - interval '30 days') THEN
    RAISE EXCEPTION 'vies_verification_required: verify the EU VAT number of the buyer in VIES first'
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
      -- ZMIANA (INV-14): oplacone zrodlo musi miec kwote, ktora wplynela.
      IF (v_now->>'paid')::boolean AND v_now->>'basis' IN ('price_list', 'price_list_net') THEN
        RAISE EXCEPTION 'payment_amount_unbooked: record the amount of the transfer before invoicing a paid order'
          USING ERRCODE = '22023';
      END IF;
      v_all_paid := v_all_paid AND (v_now->>'paid')::boolean;
      v_sources_gross := v_sources_gross + (v_now->>'gross')::bigint;
    END LOOP;
    -- ZMIANA (INV-14): faktura za OPLACONE zamowienia dokumentuje wplate -
    -- suma pozycji musi byc rowna kwocie, ktora wplynela (karta po zwrotach,
    -- wplata zaksiegowana, pakiet). Dawniej rozjazd byl tylko ostrzezeniem
    -- w edytorze, a faktura za przelew z rabatem wychodzila na cene z cennika.
    SELECT COALESCE(sum(l.gross_cents), 0)::bigint INTO v_lines_gross
      FROM public.event_invoice_lines l WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant;
    IF v_all_paid AND EXISTS (SELECT 1 FROM public.event_invoice_sources s
                               WHERE s.invoice_id = v_inv.id AND s.tenant_id = p_tenant)
       AND v_lines_gross <> v_sources_gross THEN
      RAISE EXCEPTION 'amount_mismatch: invoice lines (%) differ from the payments of its orders (%)',
        v_lines_gross, v_sources_gross USING ERRCODE = '22023';
    END IF;
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
    IF v_target.status IS DISTINCT FROM 'issued' THEN
      RAISE EXCEPTION 'correction_target_invalid: the corrected invoice is not issued'
        USING ERRCODE = '22023';
    END IF;
    -- ZMIANA (INV-17): korekta wskazuje numer KSeF faktury korygowanej; gdy
    -- faktura czeka na przyjecie w KSeF, numeru jeszcze nie ma.
    IF v_target.ksef_status = 'sent' THEN
      RAISE EXCEPTION 'correction_awaits_ksef: the corrected invoice still waits for its KSeF number'
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
  -- ZMIANA (INV-06): dokument VAT w walucie obcej = kurs sredni NBP z ostatniego
  -- dnia roboczego przed obowiazkiem podatkowym (art. 31a ust. 1-2) i VAT
  -- w PLN (art. 106e ust. 11). Korekta bierze kurs faktury korygowanej
  -- (art. 31a ust. 2b - kurs zastosowany pierwotnie). Brak kursu = odmowa,
  -- a nie przeliczenie po kursie biezacym; serwer pobiera tabele NBP na
  -- dzien wskazany w komunikacie (`fx_rate_required: <WALUTA> <RRRR-MM-DD>`).
  IF v_inv.currency <> 'PLN' AND v_inv.kind <> 'proforma' THEN
    IF v_inv.kind = 'correction' AND v_target.fx_rate IS NOT NULL THEN
      v_fx.mid := v_target.fx_rate;
      v_fx.table_no := v_target.fx_table_no;
      v_fx.effective_date := v_target.fx_effective_date;
    ELSE
      v_fx_basis := CASE
        WHEN v_inv.kind = 'correction'
          THEN public._event_invoice_fx_basis(v_target.issue_date, v_target.sale_date, v_target.paid_at)
        ELSE public._event_invoice_fx_basis(v_today, COALESCE(v_inv.sale_date, v_today), v_inv.paid_at)
      END;
      SELECT * INTO v_fx FROM public.nbp_exchange_rates r
       WHERE r.currency = v_inv.currency AND r.rate_date = v_fx_basis - 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'fx_rate_required: % %', v_inv.currency, to_char(v_fx_basis - 1, 'YYYY-MM-DD')
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  -- ZMIANA (INV-16): podsumowanie stawek od sumy w stawce, liczone NA NOWO
  -- (korekta zalezy od stanu po wczesniej wystawionych korektach), z VAT w PLN.
  v_summary := public._event_invoice_vat_summary(p_tenant, v_inv.id, v_fx.mid);

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
         -- TIX-09: podstawa ustalona wyzej (szkic > korygowana > najemca).
         vat_exempt_basis = CASE WHEN v_exempt THEN v_exempt_basis ELSE '' END,
         np_basis = CASE WHEN v_np THEN v_np_basis ELSE '' END,
         reverse_charge = v_rc,
         vat_summary = v_summary,
         net_cents = (SELECT COALESCE(sum((x.value->>'net_cents')::bigint), 0) FROM jsonb_array_elements(v_summary) x),
         vat_cents = (SELECT COALESCE(sum((x.value->>'vat_cents')::bigint), 0) FROM jsonb_array_elements(v_summary) x),
         gross_cents = (SELECT COALESCE(sum((x.value->>'gross_cents')::bigint), 0) FROM jsonb_array_elements(v_summary) x),
         fx_rate = v_fx.mid,
         fx_table_no = v_fx.table_no,
         fx_effective_date = v_fx.effective_date,
         vat_pln_cents = CASE WHEN v_fx.mid IS NULL THEN NULL ELSE
           (SELECT COALESCE(sum((x.value->>'vat_pln_cents')::bigint), 0) FROM jsonb_array_elements(v_summary) x) END,
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

-- Faktura z proformy (20261012100600 part7, INV-14) z poprawkami TIX-09:
-- przebudowa pozycji z wplat bierze stawke KAZDEGO zrodla (dawniej stawke
-- pierwszej pozycji proformy dla wszystkich - bilet zw i bilet 8% wychodzily
-- po 8%), a nowy szkic przejmuje podstawe zwolnienia proformy. Reszta bez zmian.
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
  v_line_rate text;  -- TIX-09
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
    note, created_by, vat_exempt_basis
  ) VALUES (
    v_tenant, v_pro.event_id, v_pro.event_slug, v_pro.event_title_pl, v_pro.event_title_en,
    'invoice', 'draft', COALESCE((v_paid_at AT TIME ZONE 'Europe/Warsaw')::date, v_pro.sale_date),
    CASE WHEN v_all_card THEN 'card' ELSE v_pro.payment_method END, v_paid_at, v_pro.currency,
    v_pro.buyer_is_company, v_pro.buyer_name,
    v_pro.buyer_tax_id, v_pro.buyer_country, v_pro.buyer_address, v_pro.buyer_postal_code,
    v_pro.buyer_city, v_pro.buyer_email, v_pro.po_number, v_pro.recipient_name,
    v_pro.recipient_address, v_pro.buyer_user_id, v_pro.buyer_person_id, v_pro.crm_company_id,
    v_pro.id, v_pro.locale, v_pro.note, auth.uid(),
    -- TIX-09: podstawa zwolnienia z biletu/pakietu, z ktora wyszla proforma.
    v_pro.vat_exempt_basis
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
      -- TIX-09: stawka pozycji tego zrodla - jak na proformie (pozycja tego
      -- biletu albo tej nazwy), inaczej profil zrodla, na koncu stawka
      -- pierwszej pozycji. Dawniej KAZDA pozycja dostawala stawke pierwszej.
      v_line_rate := COALESCE(
        (SELECT l.vat_rate FROM public.event_invoice_lines l
          WHERE l.invoice_id = v_pro.id AND l.tenant_id = v_tenant
            AND CASE WHEN NULLIF(v_item->>'ticket_type_id', '') IS NOT NULL
                     THEN l.ticket_type_id = (v_item->>'ticket_type_id')::uuid
                     ELSE l.description = left(v_item->>'label', 300) END
          ORDER BY l.position LIMIT 1),
        (SELECT p.vat_rate FROM public._event_invoice_source_tax_profile(
           v_tenant, v_item->>'kind', (v_item->>'id')::uuid) AS p),
        v_rate);
      FOR v_group IN
        SELECT g.value FROM jsonb_array_elements(v_item->'units') AS g
         WHERE (g.value->>'qty')::integer > 0
      LOOP
        v_qty := (v_group->>'qty')::integer;
        v_u := (v_group->>'gross')::bigint / v_qty;
        v_r := ((v_group->>'gross')::bigint - v_u * v_qty)::integer;
        IF v_qty - v_r > 0 THEN
          PERFORM public._event_invoice_add_line(
            v_tenant, v_new, left(v_item->>'label', 300), v_item->>'unit', v_qty - v_r, v_u, v_line_rate,
            NULLIF(v_item->>'ticket_type_id', '')::uuid);
        END IF;
        IF v_r > 0 THEN
          PERFORM public._event_invoice_add_line(
            v_tenant, v_new, left(v_item->>'label', 300), v_item->>'unit', v_r, v_u + 1, v_line_rate,
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
