-- events-harness: include
-- Darmowe zamowienia biletowe (kod 100%, TIX-13a) - ponowienie rozliczenia.
--
-- PO CO. Zamowienie biletu za zero rozlicza kasa (`settleFreeTicketOrder`) w tym
-- samym zadaniu, ktore je zaklada - bez operatora platnosci, a wiec bez webhooka,
-- ktory ponawia rozliczenie po bledzie. Blad po ksiegowaniu (`status = 'paid'`,
-- a potem np. `payments_apply_event_ticket_outcome` albo zajecie miejsca RSVP)
-- zostawial kod zuzyty, a kupujacego bez biletu - i bez zadnej drogi naprawy.
--
-- Ta funkcja wskazuje zamowienia do ponownego rozliczenia; rozlicza je tick zadan
-- (`runEventTicketLifecycle`) ta sama, idempotentna sciezka co webhook
-- (RPC dla tego samego zamowienia, klucze idempotencji maili, dzwonki na
-- `newly_settled`). Kryterium to FAKTY, nie dodatkowy znacznik:
--   * `pending` - kasa nie doszla do ksiegowania (pierwszy zapis rozliczenia);
--   * `paid` bez zgloszenia przypietego do zamowienia, bez RSVP `going` na
--     wydarzenie i bez znacznika odmowy (`ticket_refusal`) - rozliczenie
--     urwalo sie po ksiegowaniu.
-- Okno: starsze niz 2 minuty (nie scigamy sie z kasa, ktora wciaz rozlicza)
-- i mlodsze niz 7 dni (zamowienie sprzed tygodnia to sprawa dla czlowieka).
-- Zamowienie anulowane (pelna sala - kod wrocil) nie jest juz `pending`/`paid`.

CREATE OR REPLACE FUNCTION public._event_free_ticket_orders_unsettled(p_limit integer DEFAULT 20)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT o.id
  FROM public.payment_orders o
  WHERE o.provider = 'coupon'
    AND o.kind = 'one_time'
    AND o.amount_cents = 0
    AND o.status IN ('pending', 'paid')
    AND o.user_id IS NOT NULL
    AND COALESCE(o.metadata, '{}'::jsonb) ? 'event_id'
    AND COALESCE(o.metadata, '{}'::jsonb) ? 'coupon_id'
    AND o.created_at < now() - interval '2 minutes'
    AND o.created_at > now() - interval '7 days'
    AND (
      o.status = 'pending'
      OR (
        NOT (COALESCE(o.metadata, '{}'::jsonb) ? 'ticket_refusal')
        AND NOT EXISTS (
          SELECT 1 FROM public.event_registrations r
          WHERE r.payment_order_id = o.id AND r.tenant_id = o.tenant_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.event_rsvps v
          WHERE v.tenant_id = o.tenant_id
            AND v.user_id = o.user_id
            AND v.event_id::text = o.metadata->>'event_id'
            AND v.status = 'going'
        )
      )
    )
  ORDER BY o.created_at
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$$;

REVOKE ALL ON FUNCTION public._event_free_ticket_orders_unsettled(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_free_ticket_orders_unsettled(integer) TO service_role;

COMMENT ON FUNCTION public._event_free_ticket_orders_unsettled(integer) IS
  'Darmowe zamowienia biletowe (kod 100%) bez sladu rozliczenia: pending albo paid bez zgloszenia, RSVP going i odmowy; starsze niz 2 min, mlodsze niz 7 dni. Rozlicza je ponownie tick zadan (TIX-13a).';
