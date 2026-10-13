-- CZESC 6/7 MIGRACJI 20261012100000_event_invoice_compliance.sql
-- events-harness: include
--
-- INV-15: termin prosby o fakture od POZNIEJSZEJ z dat - zaplaty albo
--         wykonania uslugi (zakonczenia wydarzenia).
-- INV-05: zwrot (albo odwolanie nieoplaconego zamowienia) po wystawieniu
--         faktury tworzy SZKIC KOREKTY i alarm dla administratorow najemcy.
--         Dotad komentarz w SQL mowil wprost "korekty nic nie wystawia samo",
--         a zwroty automatyczne (odrzucenie zgloszenia, outbox, webhook) nie
--         dotykaly faktur - nabywca dalej mial VAT do odliczenia.

-- ----------------------------------------------------------------------------
-- INV-15. TERMIN PROSBY. Art. 106b ust. 3 ustawy o VAT liczy trzy miesiace od
-- konca miesiaca, w ktorym wykonano usluge ALBO otrzymano zaplate. Bilet
-- oplacony w styczniu na wydarzenie w czerwcu dawal dotad termin do konca
-- kwietnia - zanim usluga w ogole zostala wykonana. Liczymy od pozniejszej
-- z dat (interpretacja korzystna dla nabywcy; organizator moze wystawic
-- fakture takze po terminie, wiec dluzsze okno niczego nie lamie).
-- Bez zaplaty - bez terminu (jak dotad).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_invoice_request_deadline(p_paid timestamptz, p_service timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_paid IS NULL THEN NULL::date ELSE
    (date_trunc('month', greatest(p_paid, COALESCE(p_service, p_paid)) AT TIME ZONE 'Europe/Warsaw')
      + interval '4 months' - interval '1 day')::date
  END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_request_deadline(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_request_deadline(timestamptz, timestamptz) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_request_deadline(timestamptz, timestamptz) IS
  'Ostatni dzien prosby o fakture: koniec trzeciego miesiaca po miesiacu pozniejszej z dat zaplaty i wykonania uslugi (NULL bez zaplaty).';

CREATE OR REPLACE FUNCTION public.event_invoice_request_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_registration uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_package_order uuid := NULLIF(p_payload->>'package_order_id', '')::uuid;
  v_event_id uuid;
  v_paid_at timestamptz;
  v_card uuid;
  v_lead uuid;
  v_buyer jsonb;
  v_id uuid;
  v_status text;
  v_requested_by uuid;
  v_allowed boolean;
  v_src jsonb;
  v_service timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to request an invoice' USING ERRCODE = '42501';
  END IF;
  IF (v_registration IS NULL) = (v_package_order IS NULL) THEN
    RAISE EXCEPTION 'invalid_source: pick a registration or a package order' USING ERRCODE = '22023';
  END IF;
  SELECT r.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_invoice_request', v_tenant::text || ':' || v_uid::text, 20, 60) AS r;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'rate_limited: too many invoice requests' USING ERRCODE = '54000';
  END IF;
  -- Organizator, ktory nie wystawia faktur, nie dostaje prosb, na ktore nie
  -- odpowie (kupujacy czekalby na dokument, ktory nie powstanie).
  IF NOT EXISTS (SELECT 1 FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant AND s.enabled) THEN
    RAISE EXCEPTION 'invoicing_disabled: the organizer does not issue invoices' USING ERRCODE = '22023';
  END IF;
  -- CEL PROSBY: zapis prowadzacego grupy - chyba ze gosc placi SAM. Wlasnosc:
  -- `_event_invoice_registration_owner` (zamowienie z karty - platnik; bez
  -- niego - osoba zapisu albo zalozyciel samodzielnego zapisu, nigdy
  -- pracownik, ktory wpisal zapis).
  IF v_registration IS NOT NULL THEN
    SELECT CASE
             WHEN r.group_lead_registration_id IS NULL OR r.payment_status = 'unpaid' THEN r.id
             WHEN public._event_invoice_registration_source(v_tenant, r.id, '23')->>'block' IS NULL THEN r.id
             ELSE r.group_lead_registration_id
           END
      INTO v_lead
      FROM public.event_registrations r
     WHERE r.id = v_registration AND r.tenant_id = v_tenant;
    v_src := public._event_invoice_registration_source(v_tenant, v_lead, '23');
    IF v_src IS NOT NULL AND v_src->>'status' NOT IN ('cancelled', 'rejected')
       AND v_src->>'payment_status' IN ('paid', 'partially_refunded', 'unpaid')
       AND public._event_invoice_registration_owner(v_tenant, v_lead, v_uid) THEN
      v_event_id := (v_src->>'event_id')::uuid;
      v_paid_at := NULLIF(v_src->>'paid_at', '')::timestamptz;
      v_card := NULLIF(v_src->>'payment_order_id', '')::uuid;
    END IF;
    v_registration := v_lead;
  ELSE
    SELECT o.event_id, o.paid_at,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded') THEN po.id END
      INTO v_event_id, v_paid_at, v_card
      FROM public.event_package_orders o
      LEFT JOIN public.payment_orders po ON po.id = o.payment_order_id AND po.tenant_id = o.tenant_id
     WHERE o.id = v_package_order AND o.tenant_id = v_tenant AND o.buyer_user_id = v_uid
       AND o.status IN ('pending', 'paid');
  END IF;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: order does not exist or is not yours' USING ERRCODE = '42501';
  END IF;
  -- Miejsce z puli planu bez zamowienia: nikt nie zaplacil, faktury nie bedzie.
  IF v_src->>'block' = 'plan_ticket' THEN
    RAISE EXCEPTION 'source_plan_ticket: a membership plan ticket covers this seat - nothing was paid'
      USING ERRCODE = '22023';
  END IF;
  -- ZMIANA (INV-15): termin od pozniejszej z dat zaplaty i zakonczenia wydarzenia.
  SELECT COALESCE(e.ends_at, e.starts_at) INTO v_service
    FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant;
  IF (now() AT TIME ZONE 'Europe/Warsaw')::date > public._event_invoice_request_deadline(v_paid_at, v_service) THEN
    RAISE EXCEPTION 'request_window_closed: invoice can be requested until the end of the third month after payment or the event'
      USING ERRCODE = '22023';
  END IF;
  -- Zamowienie oplacone karta, za ktore organizator nie moze wystawic wlasnej
  -- faktury (tryb operatora, faktura Stripe, niepewna plaszczyzna): dokument
  -- wystawia operator platnosci - prosba bylaby obietnica bez pokrycia.
  IF v_card IS NOT NULL AND public._event_invoice_card_block(v_tenant, v_card) IS NOT NULL THEN
    RAISE EXCEPTION 'operator_invoice: the payment operator issues the invoice for this card payment'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_invoice_sources s
     WHERE s.tenant_id = v_tenant AND s.covers AND s.released_at IS NULL
       AND (s.registration_id = v_registration OR s.package_order_id = v_package_order)
  ) THEN
    RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
  END IF;
  v_buyer := public._event_invoice_buyer_clean(p_payload->'buyer');

  SELECT q.id, q.status, q.requested_by INTO v_id, v_status, v_requested_by
    FROM public.event_invoice_requests q
   WHERE q.tenant_id = v_tenant AND q.status <> 'cancelled'
     AND (q.registration_id = v_registration OR q.package_order_id = v_package_order)
   FOR UPDATE;
  IF v_status = 'invoiced' THEN
    RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
  END IF;
  -- Prosbe zlozona przez INNE konto (platnik i uczestnik to dwa konta tego
  -- samego zamowienia) zmienia i wycofuje wylacznie jej autor.
  IF v_id IS NOT NULL AND v_requested_by IS NOT NULL AND v_requested_by <> v_uid THEN
    RAISE EXCEPTION 'request_foreign: another person already requested an invoice for this order'
      USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.event_invoice_requests (
      tenant_id, event_id, source_kind, registration_id, package_order_id, buyer_is_company,
      buyer_name, buyer_tax_id, buyer_country, buyer_address, buyer_postal_code, buyer_city,
      buyer_email, po_number, recipient_name, recipient_address, requested_by
    ) VALUES (
      v_tenant, v_event_id, CASE WHEN v_registration IS NOT NULL THEN 'registration' ELSE 'package_order' END,
      v_registration, v_package_order, (v_buyer->>'is_company')::boolean, v_buyer->>'name',
      v_buyer->>'tax_id', v_buyer->>'country', v_buyer->>'address', v_buyer->>'postal_code',
      v_buyer->>'city', v_buyer->>'email', v_buyer->>'po_number', v_buyer->>'recipient_name',
      v_buyer->>'recipient_address', v_uid
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_invoice_requests q
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
           requested_by = v_uid,
           crm_company_id = NULL
     WHERE q.id = v_id AND q.tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.event_invoice_request_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_invoice_request_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.event_invoice_request_save(jsonb) IS
  'Prosba kupujacego o fakture do WLASNEGO zapisu albo zamowienia pakietu; tylko gdy organizator fakturuje, zamowienie z karty nie nalezy do operatora i miejsca nie pokrywa bilet z puli planu; termin do konca trzeciego miesiaca po pozniejszej z dat zaplaty i wydarzenia; cudzej prosby nie przejmuje. Plaszczyzna: public_tenant_id() + auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_invoice_sources()
RETURNS TABLE(
  source_kind text,
  source_id uuid,
  event_id uuid,
  event_slug text,
  event_title_pl text,
  event_title_en text,
  label_pl text,
  label_en text,
  seats integer,
  gross_cents bigint,
  currency text,
  payment_state text,
  paid_at timestamptz,
  request_deadline date,
  can_request boolean,
  request_block text,
  request_id uuid,
  request_status text,
  buyer_is_company boolean,
  buyer_name text,
  buyer_tax_id text,
  buyer_country text,
  buyer_address text,
  buyer_postal_code text,
  buyer_city text,
  buyer_email text,
  po_number text,
  invoice_id uuid,
  invoice_number text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_enabled boolean;
  v_rate text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  SELECT s.enabled, s.default_vat_rate INTO v_enabled, v_rate
    FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant;
  RETURN QUERY
  WITH src AS (
    SELECT 'registration'::text AS kind, r.id AS sid, r.event_id AS eid,
           x.src->>'name_pl' AS lpl, x.src->>'name_en' AS len,
           (x.src->>'seats')::integer AS nseats,
           (x.src->>'gross')::bigint AS ngross,
           NULLIF(x.src->>'payment_order_id', '')::uuid AS card,
           x.src->>'currency' AS cur,
           CASE WHEN r.payment_status = 'unpaid' THEN 'unpaid' ELSE 'paid' END AS pstate,
           NULLIF(x.src->>'paid_at', '')::timestamptz AS pat, r.created_at AS cat
      FROM public.event_registrations r
      LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
      CROSS JOIN LATERAL (
        SELECT public._event_invoice_registration_source(v_tenant, r.id, COALESCE(v_rate, '23')) AS src
      ) AS x
     WHERE r.tenant_id = v_tenant
       AND (p.user_id = v_uid OR r.created_by = v_uid OR o.user_id = v_uid)
       AND r.status NOT IN ('cancelled', 'rejected')
       AND r.payment_status IN ('paid', 'partially_refunded', 'unpaid')
       AND x.src->>'block' IS NULL
       AND public._event_invoice_registration_owner(v_tenant, r.id, v_uid)
    UNION ALL
    SELECT 'package_order'::text, o.id, o.event_id, k.name_pl, k.name_en, o.seats_total,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded')
                THEN (po.amount_cents - COALESCE(po.refunded_amount_cents, 0))::bigint
                ELSE o.amount_cents::bigint END,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded') THEN po.id END,
           o.currency,
           CASE WHEN o.status = 'paid' THEN 'paid' ELSE 'unpaid' END, o.paid_at, o.created_at
      FROM public.event_package_orders o
      JOIN public.event_ticket_packages k ON k.id = o.package_id AND k.tenant_id = o.tenant_id
      LEFT JOIN public.payment_orders po ON po.id = o.payment_order_id AND po.tenant_id = o.tenant_id
     WHERE o.tenant_id = v_tenant AND o.buyer_user_id = v_uid AND o.status IN ('pending', 'paid')
  ),
  own AS (
    SELECT s.*, e.slug, e.title_pl, e.title_en, q.*,
           inv.id AS inv_id, inv.number AS inv_number, inv.status AS inv_status,
           -- ZMIANA (INV-15): od pozniejszej z dat zaplaty i wydarzenia.
           public._event_invoice_request_deadline(s.pat, COALESCE(e.ends_at, e.starts_at)) AS deadline,
           -- Prosba INNEGO konta (drugi wlasciciel zamowienia): bez jej danych.
           (q.q_id IS NOT NULL AND q.q_by IS NOT NULL AND q.q_by <> v_uid) AS foreign_request
      FROM src s
      JOIN public.events e ON e.id = s.eid AND e.tenant_id = v_tenant
      LEFT JOIN LATERAL (
        SELECT x.id AS q_id, x.status AS q_status, x.requested_by AS q_by,
               x.buyer_is_company AS q_company, x.buyer_name AS q_name, x.buyer_tax_id AS q_tax,
               x.buyer_country AS q_country, x.buyer_address AS q_address,
               x.buyer_postal_code AS q_postal, x.buyer_city AS q_city, x.buyer_email AS q_email,
               x.po_number AS q_po
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
  ),
  decided AS (
    SELECT w.*,
           CASE
             WHEN w.inv_id IS NOT NULL THEN 'invoiced'
             WHEN NOT COALESCE(v_enabled, false) THEN 'disabled'
             WHEN w.foreign_request THEN 'other_requester'
             WHEN w.deadline IS NOT NULL AND v_today > w.deadline THEN 'window_closed'
             WHEN w.card IS NOT NULL AND public._event_invoice_card_block(v_tenant, w.card) IS NOT NULL
               THEN 'operator_invoice'
           END AS block
      FROM own w
  )
  SELECT d.kind, d.sid, d.eid, d.slug, d.title_pl, d.title_en, d.lpl, d.len, d.nseats, d.ngross,
         d.cur, d.pstate, d.pat, d.deadline,
         d.block IS NULL, d.block,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_id END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_status END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_company END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_name END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_tax END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_country END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_address END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_postal END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_city END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_email END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_po END,
         CASE WHEN d.inv_status = 'issued' THEN d.inv_id END,
         CASE WHEN d.inv_status = 'issued' THEN d.inv_number END,
         d.cat
    FROM decided d
   ORDER BY d.cat DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.event_my_invoice_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_invoice_sources() TO authenticated, service_role;
COMMENT ON FUNCTION public.event_my_invoice_sources() IS
  'Wlasne zamowienia wydarzen (kupujacy wg _event_invoice_registration_owner, pakiety; bez miejsc z puli planu) z kwota wg _event_invoice_registration_source, prosba o fakture, terminem prosby (od pozniejszej z dat zaplaty i wydarzenia), powodem braku prosby (request_block) i wystawiona faktura. Plaszczyzna: public_tenant_id() + auth.uid().';

-- ----------------------------------------------------------------------------
-- INV-05. KOREKTA - rdzen wspolny dla panelu i automatu po zwrocie.
-- Cialo `admin_event_invoice_correction_create` z 20260927000203 bez zmian
-- regul; najemca i autor przychodza z bramki (panel) albo z wiersza zwrotu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_invoice_correction_build(
  p_tenant uuid, p_actor uuid, p_invoice uuid, p_mode text, p_reason text, p_changes jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode text := COALESCE(NULLIF(p_mode, ''), 'full');
  v_reason text := left(btrim(COALESCE(p_reason, '')), 500);
  v_changes jsonb := CASE WHEN jsonb_typeof(p_changes) = 'array' THEN p_changes ELSE '[]'::jsonb END;
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
   WHERE i.id = p_invoice AND i.tenant_id = p_tenant
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
              WHERE c.tenant_id = p_tenant AND c.corrects_invoice_id = v_inv.id
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
    p_tenant, v_inv.event_id, v_inv.event_slug, v_inv.event_title_pl, v_inv.event_title_en,
    'correction', 'draft', v_inv.sale_date, v_inv.payment_method, v_inv.currency,
    v_inv.buyer_is_company, v_inv.buyer_name, v_inv.buyer_tax_id, v_inv.buyer_country,
    v_inv.buyer_address, v_inv.buyer_postal_code, v_inv.buyer_city, v_inv.buyer_email,
    v_inv.po_number, v_inv.recipient_name, v_inv.recipient_address, v_inv.buyer_user_id,
    v_inv.buyer_person_id, v_inv.crm_company_id, v_inv.id, v_mode, v_reason, v_inv.locale, '',
    p_actor
  )
  RETURNING id INTO v_new;

  -- Podstawa korekty to STAN PO WYSTAWIONYCH KOREKTACH (_event_invoice_current_lines),
  -- nie pierwotne pozycje faktury: pozycja "przed" odwraca biezacy stan
  -- kotwicy, a pozycja "po" niesie nowy. Pelna korekta odwraca caly stan.
  FOR v_cur IN SELECT x.value FROM jsonb_array_elements(public._event_invoice_current_lines(p_tenant, v_inv.id)) AS x
  LOOP
    v_anchor := (v_cur->>'line_id')::uuid;
    v_cur_qty := (v_cur->>'quantity')::integer;
    v_cur_unit := (v_cur->>'unit_gross_cents')::bigint;
    v_cur_rate := v_cur->>'vat_rate';
    IF v_mode = 'full' THEN
      IF v_cur_qty > 0 THEN
        PERFORM public._event_invoice_add_line(p_tenant, v_new, v_cur->>'description', v_cur->>'unit',
          -v_cur_qty, v_cur_unit, v_cur_rate, NULLIF(v_cur->>'ticket_type_id', '')::uuid, v_anchor);
        v_changed := v_changed + 1;
      END IF;
    ELSE
      v_change := NULL;
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
            PERFORM public._event_invoice_add_line(p_tenant, v_new, v_cur->>'description', v_cur->>'unit',
              -v_cur_qty, v_cur_unit, v_cur_rate, NULLIF(v_cur->>'ticket_type_id', '')::uuid, v_anchor);
          END IF;
          IF v_qty > 0 THEN
            PERFORM public._event_invoice_add_line(p_tenant, v_new, v_cur->>'description', v_cur->>'unit',
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
    SELECT 1 FROM public._event_invoice_state(p_tenant, v_inv.id, v_new) AS st WHERE st.quantity <> 0
  ) THEN
    RAISE EXCEPTION 'correction_use_full: the correction reverses the whole invoice - use a full correction'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._event_invoice_recalc(p_tenant, v_new);
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_correction_build(uuid, uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_correction_build(uuid, uuid, uuid, text, text, jsonb)
  TO service_role;
COMMENT ON FUNCTION public._event_invoice_correction_build(uuid, uuid, uuid, text, text, jsonb) IS
  'Szkic korekty liczony od STANU PO WYSTAWIONYCH KOREKTACH (pelna albo para przed/po dla wybranych pozycji) - rdzen panelu i automatu po zwrocie.';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_correction_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN public._event_invoice_correction_build(
    v_tenant, auth.uid(), NULLIF(p_payload->>'invoice_id', '')::uuid, p_payload->>'mode',
    p_payload->>'reason', p_payload->'lines'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_correction_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_correction_create(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_correction_create(jsonb) IS
  'Szkic korekty wystawionej faktury liczonej od STANU PO WYSTAWIONYCH KOREKTACH: pelne odwrocenie albo zmiana wybranych pozycji (para przed/po). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- INV-05. CO ZOSTALO ZE SPRZEDAZY ZA WYSTAWIONA FAKTURA - po pieniadzach.
-- Kazde aktywne zrodlo: zamowienie z karty = kwota po zwrotach (nie wiecej
-- niz zafakturowano), zapis bez karty zwrocony albo odwolany NIEOPLACONY = 0,
-- zapis czesciowo zwrocony bez karty = kwota nieznana (do recznej korekty),
-- pakiet zwrocony albo anulowany = 0. Zapis odwolany, za ktory organizator
-- ZATRZYMAL pieniadze, nie wymaga korekty (to inaczej niz podpowiedz w panelu,
-- ktora ostrzega szerzej). Ubytek pomniejszamy o to, co zdjely juz
-- wystawione korekty.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_invoice_refund_shortfall(p_tenant uuid, p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source public.event_invoice_sources;
  v_valid bigint;
  v_valid_total bigint := 0;
  v_shortfall bigint := 0;
  v_manual boolean := false;
  v_refunded boolean := false;
  v_money bigint;
  v_refunded_cents bigint;
  v_status text;
  v_pay text;
  v_corrected bigint;
BEGIN
  FOR v_source IN
    SELECT * FROM public.event_invoice_sources s
     WHERE s.invoice_id = p_invoice AND s.tenant_id = p_tenant AND s.covers AND s.released_at IS NULL
  LOOP
    v_valid := v_source.gross_cents;
    IF v_source.payment_order_id IS NOT NULL THEN
      SELECT (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint,
             COALESCE(o.refunded_amount_cents, 0)::bigint
        INTO v_money, v_refunded_cents
        FROM public.payment_orders o
       WHERE o.id = v_source.payment_order_id AND o.tenant_id = p_tenant;
      v_valid := least(v_source.gross_cents, greatest(COALESCE(v_money, 0), 0));
      v_refunded := v_refunded OR COALESCE(v_refunded_cents, 0) > 0;
    ELSIF v_source.source_kind = 'registration' THEN
      SELECT r.status, r.payment_status INTO v_status, v_pay
        FROM public.event_registrations r
       WHERE r.id = v_source.registration_id AND r.tenant_id = p_tenant;
      IF v_pay = 'refunded' THEN
        v_valid := 0;
        v_refunded := true;
      ELSIF v_status IN ('cancelled', 'rejected') AND v_pay = 'unpaid' THEN
        v_valid := 0;
      ELSIF v_pay = 'partially_refunded' THEN
        v_manual := true;
        v_refunded := true;
      END IF;
    ELSE
      SELECT o.status INTO v_status
        FROM public.event_package_orders o
       WHERE o.id = v_source.package_order_id AND o.tenant_id = p_tenant;
      IF v_status IS NULL OR v_status IN ('refunded', 'cancelled') THEN
        v_valid := 0;
        v_refunded := v_refunded OR v_status = 'refunded';
      END IF;
    END IF;
    v_valid_total := v_valid_total + v_valid;
    v_shortfall := v_shortfall + (v_source.gross_cents - v_valid);
  END LOOP;
  SELECT -COALESCE(sum(c.gross_cents), 0)::bigint INTO v_corrected
    FROM public.event_invoices c
   WHERE c.tenant_id = p_tenant AND c.corrects_invoice_id = p_invoice AND c.status = 'issued';
  RETURN jsonb_build_object(
    'needed', greatest(v_shortfall - v_corrected, 0),
    'valid_total', v_valid_total,
    'manual', v_manual,
    'refunded', v_refunded
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_refund_shortfall(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_refund_shortfall(uuid, uuid) TO service_role;

-- Szkic korekty po zwrocie (jeden na fakture - drugi szkic blokuje
-- `correction_exists`). Pelna, gdy ze sprzedazy nic nie zostalo; czesciowa,
-- gdy ubytek to JEDNOZNACZNIE k miejsc jednej pozycji (typowo: zwrot za
-- goscia grupy); inaczej - alarm o korekcie recznej. Alarm do administratorow
-- najemcy w kazdym przypadku, w ktorym faktura wymaga dzialania. NIGDY nie
-- rzuca: wola sie z triggerow zwrotu, a zwrot pieniedzy jest wazniejszy niz
-- dokument (blad = alarm o korekcie recznej).
CREATE OR REPLACE FUNCTION public._event_invoice_refund_followup(p_tenant uuid, p_invoice uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
  v_need jsonb;
  v_needed bigint;
  v_action text := 'none';
  v_draft uuid;
  v_line jsonb;
  v_candidates integer := 0;
  v_pick jsonb;
  v_en boolean;
  v_href text;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = p_invoice AND i.tenant_id = p_tenant AND i.kind = 'invoice' AND i.status = 'issued';
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  v_need := public._event_invoice_refund_shortfall(p_tenant, p_invoice);
  v_needed := (v_need->>'needed')::bigint;
  IF v_needed <= 0 AND NOT (v_need->>'manual')::boolean THEN
    RETURN 'none';
  END IF;
  v_en := v_inv.locale = 'en';
  BEGIN
    IF EXISTS (SELECT 1 FROM public.event_invoices c
                WHERE c.tenant_id = p_tenant AND c.corrects_invoice_id = p_invoice AND c.status = 'draft') THEN
      v_action := 'draft_exists';
    ELSIF (v_need->>'manual')::boolean THEN
      v_action := 'manual';
    ELSIF (v_need->>'valid_total')::bigint = 0 THEN
      v_draft := public._event_invoice_correction_build(
        p_tenant, NULL, p_invoice, 'full',
        CASE WHEN v_en THEN 'Refund after the invoice was issued' ELSE 'Zwrot platnosci po wystawieniu faktury' END,
        '[]'::jsonb);
      v_action := 'draft_full';
    ELSE
      FOR v_line IN
        SELECT x.value FROM jsonb_array_elements(public._event_invoice_current_lines(p_tenant, p_invoice)) AS x
         WHERE (x.value->>'quantity')::integer > 0 AND (x.value->>'unit_gross_cents')::bigint > 0
           AND v_needed % (x.value->>'unit_gross_cents')::bigint = 0
           AND v_needed / (x.value->>'unit_gross_cents')::bigint <= (x.value->>'quantity')::integer
      LOOP
        v_candidates := v_candidates + 1;
        v_pick := v_line;
      END LOOP;
      IF v_candidates = 1 THEN
        v_draft := public._event_invoice_correction_build(
          p_tenant, NULL, p_invoice, 'partial',
          CASE WHEN v_en THEN 'Refund after the invoice was issued' ELSE 'Zwrot platnosci po wystawieniu faktury' END,
          jsonb_build_array(jsonb_build_object(
            'line_id', v_pick->>'line_id',
            'quantity', (v_pick->>'quantity')::integer - (v_needed / (v_pick->>'unit_gross_cents')::bigint)::integer
          )));
        v_action := 'draft_partial';
      ELSE
        v_action := 'manual';
      END IF;
    END IF;
    -- Zwrot pieniedzy juz sie dokonal - korekta dokumentuje zwrot wykonany.
    IF v_draft IS NOT NULL AND (v_need->>'refunded')::boolean THEN
      UPDATE public.event_invoices i SET paid_at = now()
       WHERE i.id = v_draft AND i.tenant_id = p_tenant AND i.status = 'draft';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_action := 'manual';
    v_draft := NULL;
  END;
  v_href := '/admin/events/' || COALESCE(v_inv.event_id::text, '') || '/registration/invoices?invoice=' || p_invoice::text;
  PERFORM public._tenant_admins_alert(
    p_tenant,
    CASE WHEN v_action LIKE 'draft_%' AND v_action <> 'draft_exists'
      THEN 'Zwrot po fakturze ' || v_inv.number || ' - szkic korekty do wystawienia'
      ELSE 'Zwrot po fakturze ' || v_inv.number || ' - wymagana korekta' END,
    CASE WHEN v_action LIKE 'draft_%' AND v_action <> 'draft_exists'
      THEN 'Refund after invoice ' || v_inv.number || ' - credit note draft ready'
      ELSE 'Refund after invoice ' || v_inv.number || ' - credit note required' END,
    CASE v_action
      WHEN 'draft_exists' THEN 'Faktura ma juz otwarty szkic korekty - uzupelnij go o ten zwrot i wystaw.'
      WHEN 'manual' THEN 'Nie da sie jednoznacznie ustalic pozycji korekty - utworz korekte recznie (art. 106j ustawy o VAT).'
      ELSE 'Przygotowalismy szkic korekty (art. 106j ustawy o VAT) - sprawdz go i wystaw.' END,
    CASE v_action
      WHEN 'draft_exists' THEN 'The invoice already has an open credit note draft - add this refund to it and issue it.'
      WHEN 'manual' THEN 'The correction lines cannot be determined unambiguously - create the credit note manually.'
      ELSE 'We prepared a credit note draft - review and issue it.' END,
    v_href
  );
  RETURN v_action;
EXCEPTION WHEN OTHERS THEN
  RETURN 'error';
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_refund_followup(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_refund_followup(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_refund_followup(uuid, uuid) IS
  'Po zwrocie albo odwolaniu nieoplaconego zamowienia: szkic korekty (pelnej albo o jednoznaczne miejsca) i alarm do administratorow najemcy; nigdy nie rzuca. Zwraca: none, draft_full, draft_partial, draft_exists, manual, error.';

-- Triggery: kazda sciezka zwrotu (webhook operatora, zwrot samoobslugowy,
-- outbox po odrzuceniu, akcja `refund` w panelu, anulowanie pakietu) konczy
-- sie zmiana jednego z tych trzech wierszy - wiec tu, a nie w TS.
CREATE OR REPLACE FUNCTION public._tg_event_invoice_refund_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice uuid;
BEGIN
  FOR v_invoice IN
    SELECT DISTINCT s.invoice_id
      FROM public.event_invoice_sources s
      JOIN public.event_invoices i ON i.id = s.invoice_id AND i.tenant_id = s.tenant_id
     WHERE s.tenant_id = NEW.tenant_id AND s.covers AND s.released_at IS NULL
       AND i.kind = 'invoice' AND i.status = 'issued'
       AND CASE TG_TABLE_NAME
             WHEN 'payment_orders' THEN s.payment_order_id = NEW.id
             WHEN 'event_registrations' THEN s.registration_id = NEW.id
             ELSE s.package_order_id = NEW.id
           END
  LOOP
    PERFORM public._event_invoice_refund_followup(NEW.tenant_id, v_invoice);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'event invoice refund follow-up failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_invoice_refund_followup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_orders_zz_invoice_refund ON public.payment_orders;
CREATE TRIGGER payment_orders_zz_invoice_refund
  AFTER UPDATE OF status, refunded_amount_cents ON public.payment_orders
  FOR EACH ROW
  WHEN (NEW.refunded_amount_cents > OLD.refunded_amount_cents
        OR (NEW.status::text = 'refunded' AND OLD.status::text IS DISTINCT FROM 'refunded'))
  EXECUTE FUNCTION public._tg_event_invoice_refund_followup();

DROP TRIGGER IF EXISTS event_registrations_zz_invoice_refund ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_invoice_refund
  AFTER UPDATE OF status, payment_status ON public.event_registrations
  FOR EACH ROW
  WHEN ((NEW.payment_status IN ('refunded', 'partially_refunded')
         AND NEW.payment_status IS DISTINCT FROM OLD.payment_status)
        OR (NEW.status IN ('cancelled', 'rejected') AND OLD.status NOT IN ('cancelled', 'rejected')
            AND NEW.payment_status = 'unpaid'))
  EXECUTE FUNCTION public._tg_event_invoice_refund_followup();

DROP TRIGGER IF EXISTS event_package_orders_zz_invoice_refund ON public.event_package_orders;
CREATE TRIGGER event_package_orders_zz_invoice_refund
  AFTER UPDATE OF status ON public.event_package_orders
  FOR EACH ROW
  WHEN (NEW.status IN ('refunded', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public._tg_event_invoice_refund_followup();

-- migration-split: part 6/7 of 20261012100000_event_invoice_compliance.sql