-- CZESC 3/7 MIGRACJI 20261012100000_event_invoice_compliance.sql
-- events-harness: include
--
-- Zapis jako zrodlo z ZAKSIEGOWANA wplata (INV-14) i wystawienie z nowymi
-- regulami: kurs NBP i VAT w PLN (INV-06), podstawa "np", odwrotne
-- obciazenie i VIES (INV-12), kwota pozycji = wplata (INV-14), korekta
-- faktury czekajacej na KSeF (INV-17), podsumowanie od sumy w stawce
-- (INV-16). Funkcje przedeklarowane W CALOSCI; zmiany: `-- ZMIANA (INV-xx)`.

-- ----------------------------------------------------------------------------
-- ZAPIS JAKO ZRODLO (cialo z 20260927000201 + wplata zaksiegowana).
-- ZMIANA (INV-14): zapis oplacony POZA kasa z wplata zaksiegowana przez
-- organizatora (`paid_amount_cents`) ma kwote = wplata (`basis = 'booked'`),
-- a nie cene z cennika - kod rabatowy albo cena uzgodniona przelewem trafia
-- na fakture tak, jak wplynela. Oplacony zapis bez zaksiegowanej kwoty
-- zostaje przy cenniku (`price_list`), ale wystawienie faktury za niego
-- odmawia (`payment_amount_unbooked`, `_event_invoice_issue_core`).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_invoice_registration_source(
  p_tenant uuid, p_registration_id uuid, p_rate text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_lead_order uuid;
  v_block text;
  v_guests integer := 0;
  v_seats integer;
  v_gross bigint;
  v_unit bigint;
  v_units jsonb;
  v_coupon bigint := 0;
  v_lead_w bigint := 0;
  v_guest_w bigint := 0;
  v_total_w bigint := 0;
  v_lead_part bigint;
  v_booked boolean;
BEGIN
  SELECT r.id, r.event_id, r.person_id, r.group_lead_registration_id, r.status, r.payment_status,
         r.payment_order_id, r.ticket_type_id,
         COALESCE(r.paid_at, o.paid_at) AS paid_at,
         p.user_id AS holder_user_id, o.user_id AS payer_user_id,
         COALESCE(t.name_pl, '') AS name_pl, COALESCE(t.name_en, '') AS name_en,
         COALESCE(o.currency, r.paid_amount_currency, t.currency, 'PLN') AS currency,
         (o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded')) AS via_card,
         (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS order_gross,
         COALESCE(o.metadata, '{}'::jsonb) AS meta,
         t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule,
         COALESCE(t.tax_mode, 'inclusive') AS tax_mode,
         r.paid_amount_cents
    INTO v
    FROM public.event_registrations r
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    LEFT JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
   WHERE r.id = p_registration_id AND r.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_booked := NOT v.via_card AND v.paid_amount_cents IS NOT NULL
              AND v.payment_status IN ('paid', 'partially_refunded');

  IF v.group_lead_registration_id IS NOT NULL THEN
    SELECT l.payment_order_id INTO v_lead_order
      FROM public.event_registrations l
     WHERE l.id = v.group_lead_registration_id AND l.tenant_id = p_tenant;
    IF NOT (v.via_card AND v.payment_order_id IS DISTINCT FROM v_lead_order) THEN
      v_block := 'not_lead';
    END IF;
  ELSE
    -- Goscie rozliczani przez prowadzacego: bez wlasnego zamowienia z karty
    -- (gosc z wlasnym zamowieniem to osobne zrodlo), otwarci, nie zwroceni.
    SELECT count(*)::integer INTO v_guests
      FROM public.event_registrations g
      LEFT JOIN public.payment_orders go ON go.id = g.payment_order_id AND go.tenant_id = g.tenant_id
     WHERE g.group_lead_registration_id = v.id AND g.tenant_id = p_tenant
       AND g.status NOT IN ('cancelled', 'rejected')
       AND g.payment_status IN ('paid', 'partially_refunded', 'unpaid')
       AND NOT (go.id IS NOT NULL AND go.status::text IN ('paid', 'refunded')
                AND g.payment_order_id IS DISTINCT FROM v.payment_order_id);
  END IF;
  IF v_block IS NULL
     AND (v.status IN ('cancelled', 'rejected')
          OR v.payment_status NOT IN ('paid', 'partially_refunded', 'unpaid')) THEN
    v_block := 'closed';
  END IF;

  IF v.via_card AND v.order_gross IS NOT NULL THEN
    v_gross := v.order_gross;
    v_seats := CASE
      WHEN COALESCE(v.meta->>'quantity', '') ~ '^[0-9]{1,5}$' AND (v.meta->>'quantity')::integer >= 1
        THEN (v.meta->>'quantity')::integer
      ELSE 1 + v_guests
    END;
    IF v.meta->>'plan_benefit' IN ('included', 'discount')
       AND COALESCE(v.meta->>'lead_unit_cents', '') ~ '^[0-9]{1,9}$'
       AND COALESCE(v.meta->>'guest_unit_cents', '') ~ '^[0-9]{1,9}$' THEN
      IF COALESCE(v.meta->>'coupon_discount_per_seat_cents', '') ~ '^[0-9]{1,9}$' THEN
        v_coupon := (v.meta->>'coupon_discount_per_seat_cents')::bigint;
      END IF;
      v_lead_w := greatest((v.meta->>'lead_unit_cents')::bigint - v_coupon, 0);
      v_guest_w := greatest((v.meta->>'guest_unit_cents')::bigint - v_coupon, 0);
      v_total_w := v_lead_w + v_guest_w * (v_seats - 1);
    END IF;
    IF v_total_w > 0 AND v_gross > 0 THEN
      -- Czesc prowadzacego: zaokraglenie polowkowe, reszta to goscie.
      v_lead_part := (2 * v_gross * v_lead_w + v_total_w) / (2 * v_total_w);
      v_units := '[]'::jsonb;
      IF v_lead_part > 0 THEN
        v_units := v_units || jsonb_build_array(jsonb_build_object('qty', 1, 'gross', v_lead_part));
      END IF;
      IF v_seats > 1 AND v_gross - v_lead_part > 0 THEN
        v_units := v_units || jsonb_build_array(jsonb_build_object('qty', v_seats - 1, 'gross', v_gross - v_lead_part));
      END IF;
    ELSE
      v_units := jsonb_build_array(jsonb_build_object('qty', v_seats, 'gross', v_gross));
    END IF;
  ELSE
    v_seats := 1 + v_guests - CASE
      WHEN v.group_lead_registration_id IS NULL AND EXISTS (
        SELECT 1 FROM public.plan_ticket_claims c
         WHERE c.tenant_id = p_tenant AND c.registration_id = v.id AND c.released_at IS NULL
      ) THEN 1 ELSE 0 END;
    -- ZMIANA (INV-14): niezerowa zaksiegowana wplata to sprzedaz, nawet gdy
    -- prowadzacego pokrywa bilet z puli planu (zaplacono za gosci) - miejsc
    -- co najmniej jedno. Wplata 0 zl niczego nie sprzedaje.
    IF v_booked AND v.paid_amount_cents > 0 THEN
      v_seats := greatest(v_seats, 1);
    END IF;
    IF v_block IS NULL AND v_seats < 1 THEN
      v_block := 'plan_ticket';
    END IF;
    IF v_booked THEN
      v_gross := v.paid_amount_cents;
    ELSE
      v_unit := COALESCE(CASE
        WHEN v.payment_status = 'unpaid'
          THEN public._event_ticket_price_now(v.price_cents, v.early_bird_price_cents, v.early_bird_until,
                                              v.price_schedule)
        ELSE (public._event_ticket_phase(v.price_cents, v.early_bird_price_cents, v.early_bird_until,
                                         v.price_schedule, COALESCE(v.paid_at, now()))->>'price_cents')::integer
      END, 0)::bigint;
      IF v.tax_mode = 'exclusive' THEN
        v_unit := public._event_invoice_gross_from_net(v_unit, p_rate);
      END IF;
      v_gross := v_unit * greatest(v_seats, 0);
    END IF;
    v_units := jsonb_build_array(jsonb_build_object('qty', greatest(v_seats, 0), 'gross', v_gross));
  END IF;

  RETURN jsonb_build_object(
    'id', v.id,
    'event_id', v.event_id,
    'person_id', v.person_id,
    'lead_id', v.group_lead_registration_id,
    'status', v.status,
    'payment_status', v.payment_status,
    'block', v_block,
    'admission', CASE
      WHEN v.status = 'waitlist' THEN 'waitlisted'
      WHEN v.status IN ('draft', 'pending') THEN 'awaitingDecision'
      ELSE 'seated'
    END,
    -- Kupujacy zamowienia z karty to PLATNIK (po przekazaniu biletu osoba
    -- zapisu jest kim innym), bez zamowienia - osoba zapisu.
    'user_id', CASE WHEN v.via_card THEN v.payer_user_id ELSE v.holder_user_id END,
    'via_card', v.via_card,
    'payment_order_id', CASE WHEN v.via_card THEN v.payment_order_id END,
    'ticket_type_id', v.ticket_type_id,
    'name_pl', v.name_pl,
    'name_en', v.name_en,
    'currency', v.currency,
    'paid', v.payment_status IN ('paid', 'partially_refunded'),
    'paid_at', v.paid_at,
    'seats', v_seats,
    'gross', v_gross,
    'units', v_units,
    'basis', CASE
      WHEN v.via_card AND v.order_gross IS NOT NULL THEN 'order'
      WHEN v_booked THEN 'booked'
      WHEN v.tax_mode = 'exclusive' THEN 'price_list_net'
      ELSE 'price_list'
    END
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) TO service_role;
COMMENT ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) IS
  'Zapis jako zrodlo dokumentu (bez wyjatkow): block (not_lead, closed, plan_ticket albo NULL), miejsca, kwota i grupy pozycji (zamowienie z karty wg metadata.quantity i benefitu planu, wplata zaksiegowana przez organizatora, inaczej cena fazy sprzedazy), karta, platnik, admission, basis (order/booked/price_list/price_list_net).';

-- ----------------------------------------------------------------------------
-- WYSTAWIENIE (cialo z 20260927000202 + reguly audytu).
-- ----------------------------------------------------------------------------
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
  IF v_exempt AND btrim(v_settings.vat_exempt_basis) = '' THEN
    RAISE EXCEPTION 'vat_exempt_basis_required: exempt lines need the legal basis in issuer settings'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.kind = 'correction' THEN
    SELECT * INTO v_target FROM public.event_invoices i
     WHERE i.id = v_inv.corrects_invoice_id AND i.tenant_id = p_tenant
     FOR UPDATE;
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
         vat_exempt_basis = CASE WHEN v_exempt THEN v_settings.vat_exempt_basis ELSE '' END,
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
REVOKE ALL ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) IS
  'Wystawienie szkicu: walidacja (wystawca, nabywca, zw/np, odwrotne obciazenie + VIES, MoR, kwota = wplata, korekta), kurs NBP i VAT w PLN, podsumowanie od sumy w stawce, numer bez luk, migawka sprzedawcy, KSeF pending, prosby -> invoiced, pelna korekta zwalnia zrodla, CRM, event_invoice.issued.v1.';

-- migration-split: part 3/7 of 20261012100000_event_invoice_compliance.sql