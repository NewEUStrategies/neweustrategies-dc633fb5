DO $$
DECLARE
  r record;
  v_n integer;
BEGIN
  FOR r IN SELECT p.id, p.tenant_id, p.quota FROM public.event_ticket_packages p LOOP
    SELECT count(*)::integer INTO v_n FROM public.event_package_orders o
    WHERE o.tenant_id = r.tenant_id AND o.package_id = r.id AND o.status IN ('pending', 'paid');
    IF r.quota IS NOT NULL AND v_n > r.quota THEN
      RAISE NOTICE 'package % (tenant %) has % live orders over quota %', r.id, r.tenant_id, v_n, r.quota;
      UPDATE public.event_ticket_packages p SET quota = v_n, sold_count = v_n
      WHERE p.id = r.id AND p.tenant_id = r.tenant_id;
    ELSE
      UPDATE public.event_ticket_packages p SET sold_count = v_n
      WHERE p.id = r.id AND p.tenant_id = r.tenant_id AND p.sold_count <> v_n;
    END IF;
  END LOOP;
  FOR r IN SELECT t.id, t.tenant_id, t.event_id, t.quota FROM public.event_ticket_types t LOOP
    SELECT count(*)::integer INTO v_n FROM public.event_registrations x
    WHERE x.tenant_id = r.tenant_id AND x.ticket_type_id = r.id
      AND x.status IN ('approved', 'attended', 'no_show');
    v_n := v_n + public._event_package_seats_held(r.tenant_id, r.event_id, r.id);
    IF r.quota IS NOT NULL AND v_n > r.quota THEN
      RAISE NOTICE 'ticket type % (tenant %) holds % seats over quota %', r.id, r.tenant_id, v_n, r.quota;
      UPDATE public.event_ticket_types t SET quota = v_n, sold_count = v_n
      WHERE t.id = r.id AND t.tenant_id = r.tenant_id;
    ELSE
      UPDATE public.event_ticket_types t SET sold_count = v_n
      WHERE t.id = r.id AND t.tenant_id = r.tenant_id AND t.sold_count <> v_n;
    END IF;
  END LOOP;
END $$;