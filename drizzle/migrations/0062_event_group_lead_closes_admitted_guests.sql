CREATE OR REPLACE FUNCTION public._tg_event_group_follow_lead_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_restamp boolean;
  v_freed uuid[];
BEGIN
  IF NEW.status = 'approved'
     AND OLD.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled') THEN
    PERFORM public._event_group_admit_guests(NEW, OLD);
  ELSIF NEW.status IN ('rejected', 'cancelled') THEN
    v_restamp := NEW.status = 'rejected' OR NEW.decided_at IS DISTINCT FROM OLD.decided_at;

    SELECT array_agg(r.ticket_type_id ORDER BY r.created_at, r.id) INTO v_freed
    FROM (
      SELECT g.ticket_type_id, g.created_at, g.id
      FROM public.event_registrations g
      WHERE g.tenant_id = NEW.tenant_id
        AND g.group_lead_registration_id = NEW.id
        AND g.status = 'approved'
      ORDER BY g.created_at, g.id
      FOR UPDATE
    ) r;

    UPDATE public.event_registrations r SET
      status = NEW.status,
      decision_note = CASE
        WHEN v_restamp THEN COALESCE(NEW.decision_note, r.decision_note)
        ELSE r.decision_note
      END,
      decided_by = CASE WHEN v_restamp THEN NEW.decided_by END,
      decided_at = now(),
      decision_source = CASE
        WHEN v_restamp THEN COALESCE(NEW.decision_source, 'system')
        ELSE 'system'
      END,
      cancelled_at = CASE
        WHEN NEW.status = 'cancelled' THEN NEW.cancelled_at
        ELSE r.cancelled_at
      END,
      waitlist_position = NULL,
      qr_token_hash = NULL,
      qr_issued_at = NULL,
      updated_at = now()
    WHERE r.tenant_id = NEW.tenant_id
      AND r.group_lead_registration_id = NEW.id
      AND r.status IN ('draft', 'pending', 'waitlist', 'approved');

    PERFORM public._event_group_promote_freed(NEW.tenant_id, NEW.event_id, v_freed);
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_group_follow_lead_status() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_group_follow_lead_status() IS
  'Kaskada statusu prowadzacego grupy na gosci: zatwierdzenie przyjmuje gosci rozliczonych (albo stawia ich w kolejce, gdy brak miejsca) i przywraca gosci zamknietych razem z prowadzacym (_event_group_admit_guests), odrzucenie i anulowanie zamyka gosci czekajacych i przyjetych (kod QR przestaje wpuszczac; attended/no_show zostaja) - ze sladem decydujacego tylko wtedy, gdy ta instrukcja stemplowala decyzje prowadzacego - i promuje kolejke za zwolnione miejsca. Nieoplaconych gosci przyjmuje trigger platnosci.';

CREATE OR REPLACE FUNCTION public._event_group_promote_freed(
  p_tenant uuid,
  p_event_id uuid,
  p_ticket_types uuid[]
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  f record;
  v_n integer := 0;
BEGIN
  FOR f IN
    SELECT t.ticket_type_id, count(*)::integer AS seats
    FROM unnest(p_ticket_types) AS t(ticket_type_id)
    GROUP BY t.ticket_type_id
    ORDER BY t.ticket_type_id NULLS LAST
  LOOP
    v_n := v_n + COALESCE((public._event_waitlist_promote(
      p_tenant, p_event_id, f.ticket_type_id, f.seats)->>'promoted')::integer, 0);
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[]) IS
  'Awans z kolejki rezerwowej za miejsca zwolnione przez gosci grupy: jeden element tablicy = jedno zwolnione miejsce danego biletu (NULL = bez cennika). Osobno dla kazdego biletu, przez _event_waitlist_promote (kontrola miejsc pod blokada). Zwraca liczbe awansowanych.';

CREATE OR REPLACE FUNCTION public._event_apply_outcome_to_group(p_lead_id uuid, p_order_id uuid, p_outcome text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  g public.event_registrations;
  v_lead public.event_registrations;
  v_tenant uuid;
  v_token text;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_lead FROM public.event_registrations l WHERE l.id = p_lead_id;
  v_tenant := v_lead.tenant_id;

  FOR g IN SELECT * FROM public.event_registrations r
    WHERE r.group_lead_registration_id = p_lead_id AND r.tenant_id = v_tenant
    ORDER BY r.created_at, r.id
    FOR UPDATE LOOP
    IF p_outcome IN ('refunded', 'partial_refund')
       AND g.payment_status NOT IN ('paid', 'partially_refunded') THEN
      CONTINUE;
    END IF;
    IF p_outcome = 'paid' THEN
      IF g.status IN ('cancelled','rejected') THEN CONTINUE; END IF;
      IF g.status IN ('draft','pending','waitlist') THEN
        UPDATE public.event_registrations r SET
          payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
          paid_at = COALESCE(r.paid_at, now()),
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = v_tenant;
        UPDATE public.event_ticket_types t SET sold_count = c.cnt
        FROM (
          SELECT count(*)::integer AS cnt
          FROM public.event_registrations x
          WHERE x.tenant_id = v_tenant
            AND x.ticket_type_id = g.ticket_type_id
            AND x.status IN ('approved', 'attended', 'no_show')
        ) c
        WHERE t.id = g.ticket_type_id AND t.tenant_id = v_tenant AND t.sold_count <> c.cnt;
        PERFORM public._event_group_admit_guest(v_lead, g);
      ELSE
        v_token := public._event_new_qr_token();
        UPDATE public.event_registrations r SET
          payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
          paid_at = COALESCE(r.paid_at, now()),
          waitlist_position = NULL,
          decided_at = COALESCE(r.decided_at, now()),
          decision_source = COALESCE(r.decision_source, 'system'),
          qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
          qr_issued_at = COALESCE(r.qr_issued_at, now()),
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = v_tenant;
      END IF;
    ELSIF p_outcome = 'refunded' THEN
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'refunded', paid_at = NULL,
        status = 'cancelled', cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
    ELSIF p_outcome = 'partial_refund' THEN
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'partially_refunded', updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
    ELSE
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'unpaid', updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant AND r.payment_status <> 'paid';
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) IS
  'Wynik platnosci prowadzacego na gosciach grupy: paid rozlicza czekajacych i przyjmuje ich z kontrola miejsc (_event_group_admit_guest - miejsce albo kolejka, takze na sciezce Stripe), przyjetym tylko rozlicza; refunded anuluje oplaconych; partial_refund i unpaid tylko rozliczaja. Zamowienie trafia do goscia tylko, gdy wynik je przyniosl.';