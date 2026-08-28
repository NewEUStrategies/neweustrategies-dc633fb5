-- ============================================================
-- 1) USUNIECIE MARTWYCH FUNKCJI (duplikaty istniejacych sciezek)
-- ============================================================
-- admin_event_ticket_package_save byl wczesniejszym wariantem zapisu pakietu;
-- aplikacja korzysta z admin_event_package_upsert. Dwa zapisy tej samej tabeli
-- to dwie rozne walidacje - zostaje jeden.
DROP FUNCTION IF EXISTS public.admin_event_ticket_package_save(jsonb);

-- event_ad_placements duplikowal odczyt ad_placements, ktory aplikacja robi
-- bezposrednio przez Data API z politykami RLS.
DROP FUNCTION IF EXISTS public.event_ad_placements(text, text);

-- ============================================================
-- 2) PANEL: LISTA NADAN UPRAWNIEN DO STAWKI
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_event_audience_grants_list(jsonb);
CREATE FUNCTION public.admin_event_audience_grants_list(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  id uuid,
  audience text,
  user_id uuid,
  person_id uuid,
  company_id uuid,
  event_id uuid,
  subject_email text,
  subject_name text,
  company_name text,
  event_title text,
  evidence text,
  valid_from timestamptz,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_audience text := NULLIF(lower(btrim(COALESCE(p_payload->>'audience', ''))), '');
  v_include_revoked boolean := COALESCE((NULLIF(p_payload->>'include_revoked', ''))::boolean, false);
  v_search text := NULLIF(lower(btrim(COALESCE(p_payload->>'search', ''))), '');
BEGIN
  RETURN QUERY
  SELECT
    g.id, g.audience, g.user_id, g.person_id, g.company_id, g.event_id,
    COALESCE(lower(btrim(u.email)), lower(btrim(pe.email))),
    btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')),
    c.name,
    e.title,
    g.evidence, g.valid_from, g.valid_until, g.revoked_at, g.created_at,
    CASE
      WHEN g.revoked_at IS NOT NULL THEN 'revoked'
      WHEN g.valid_until IS NOT NULL AND g.valid_until <= now() THEN 'expired'
      WHEN g.valid_from > now() THEN 'scheduled'
      ELSE 'active'
    END
  FROM public.event_audience_grants g
  LEFT JOIN auth.users u ON u.id = g.user_id
  LEFT JOIN public.event_people pe ON pe.id = g.person_id AND pe.tenant_id = g.tenant_id
  LEFT JOIN public.crm_companies c ON c.id = g.company_id AND c.tenant_id = g.tenant_id
  LEFT JOIN public.events e ON e.id = g.event_id AND e.tenant_id = g.tenant_id
  WHERE g.tenant_id = v_tenant
    AND (v_event_id IS NULL OR g.event_id = v_event_id)
    AND (v_audience IS NULL OR g.audience = v_audience)
    AND (v_include_revoked OR g.revoked_at IS NULL)
    AND (
      v_search IS NULL
      OR lower(COALESCE(u.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(pe.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(c.name, '')) LIKE '%' || v_search || '%'
      OR lower(g.evidence) LIKE '%' || v_search || '%'
    )
  ORDER BY g.created_at DESC, g.id
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_audience_grants_list(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_audience_grants_list(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_audience_grants_list(jsonb) IS
  'Lista nadan stawek dla panelu. Stan wyliczany (active/scheduled/expired/revoked) - wiersze nie sa kasowane, bo to slad audytowy.';

-- ============================================================
-- 3) OFERTA PAKIETOW GRUPOWYCH WIDZIANA PRZEZ KUPUJACEGO
-- ============================================================
DROP FUNCTION IF EXISTS public.event_packages_offer(text);
CREATE FUNCTION public.event_packages_offer(p_slug text)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  ticket_type_id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  audience text,
  requires_verification boolean,
  seats integer,
  price_cents integer,
  currency text,
  packages_left integer,
  sales_from timestamptz,
  sales_to timestamptz,
  min_tier_rank integer,
  qualifies boolean,
  sort_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._caller_tenant();
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = p_slug;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.event_id, p.ticket_type_id, p.key,
    p.name_pl, p.name_en, p.description_pl, p.description_en,
    p.audience, p.requires_verification, p.seats, p.price_cents, p.currency,
    CASE WHEN p.quota IS NULL THEN NULL ELSE GREATEST(p.quota - p.sold_count, 0) END,
    p.sales_from, p.sales_to, p.min_tier_rank,
    CASE
      WHEN p.audience IN ('public', 'member') OR NOT p.requires_verification THEN true
      ELSE public.event_audience_qualifies(p.audience)
    END,
    p.sort_order
  FROM public.event_ticket_packages p
  WHERE p.tenant_id = v_tenant
    AND p.event_id = v_event_id
    AND p.is_active
  ORDER BY p.sort_order, p.created_at, p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.event_packages_offer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_packages_offer(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_packages_offer(text) IS
  'Oferta pakietow grupowych wydarzenia dla ZALOGOWANEGO kupujacego wraz z flaga kwalifikacji do stawki. Cena wiazaca liczy event_admission_quote.';

-- ============================================================
-- 4) MOJE ZAMOWIENIA PAKIETOWE
-- ============================================================
DROP FUNCTION IF EXISTS public.event_my_package_orders();
CREATE FUNCTION public.event_my_package_orders()
RETURNS TABLE (
  id uuid,
  event_id uuid,
  event_slug text,
  event_title text,
  package_id uuid,
  package_name_pl text,
  package_name_en text,
  status text,
  seats_total integer,
  seats_free integer,
  seats_invited integer,
  seats_assigned integer,
  amount_cents integer,
  discount_cents integer,
  currency text,
  buyer_email text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id, o.event_id, e.slug, e.title, o.package_id, p.name_pl, p.name_en,
    o.status, o.seats_total,
    COALESCE(s.free, 0), COALESCE(s.invited, 0), COALESCE(s.assigned, 0),
    o.amount_cents, o.discount_cents, o.currency, o.buyer_email, o.created_at
  FROM public.event_package_orders o
  JOIN public.events e ON e.id = o.event_id AND e.tenant_id = o.tenant_id
  JOIN public.event_ticket_packages p ON p.id = o.package_id AND p.tenant_id = o.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE x.revoked_at IS NULL AND x.registration_id IS NULL AND x.invite_email IS NULL
      )::integer AS free,
      count(*) FILTER (
        WHERE x.revoked_at IS NULL AND x.registration_id IS NULL AND x.invite_email IS NOT NULL
      )::integer AS invited,
      count(*) FILTER (
        WHERE x.revoked_at IS NULL AND x.registration_id IS NOT NULL
      )::integer AS assigned
    FROM public.event_package_seats x
    WHERE x.package_order_id = o.id AND x.tenant_id = o.tenant_id
  ) s ON true
  WHERE o.tenant_id = v_tenant
    AND o.buyer_user_id = v_uid
  ORDER BY o.created_at DESC, o.id;
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_package_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_package_orders() TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_package_orders() IS
  'Zamowienia pakietowe ZALOGOWANEGO kupujacego. Zawsze filtr buyer_user_id = auth.uid() - funkcja nie przyjmuje cudzego identyfikatora.';

-- ============================================================
-- 5) MIEJSCA W MOIM ZAMOWIENIU
-- ============================================================
DROP FUNCTION IF EXISTS public.event_my_package_seats(uuid);
CREATE FUNCTION public.event_my_package_seats(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  package_order_id uuid,
  invite_email text,
  invite_name text,
  invite_sent_at timestamptz,
  invite_expires_at timestamptz,
  attendee_name text,
  assigned_at timestamptz,
  revoked_at timestamptz,
  state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_package_orders o
    WHERE o.id = p_order_id AND o.tenant_id = v_tenant AND o.buyer_user_id = v_uid
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.package_order_id, s.invite_email, s.invite_name,
    s.invite_sent_at, s.invite_expires_at,
    btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')),
    s.assigned_at, s.revoked_at,
    CASE
      WHEN s.revoked_at IS NOT NULL THEN 'revoked'
      WHEN s.registration_id IS NOT NULL THEN 'assigned'
      WHEN s.invite_email IS NOT NULL THEN 'invited'
      ELSE 'free'
    END
  FROM public.event_package_seats s
  LEFT JOIN public.event_registrations r
    ON r.id = s.registration_id AND r.tenant_id = s.tenant_id
  LEFT JOIN public.event_people pe
    ON pe.id = r.person_id AND pe.tenant_id = s.tenant_id
  WHERE s.tenant_id = v_tenant AND s.package_order_id = p_order_id
  ORDER BY s.created_at, s.id;
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_package_seats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_package_seats(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_package_seats(uuid) IS
  'Miejsca w zamowieniu pakietowym widziane przez kupujacego. Token zaproszenia NIE wraca - baza trzyma sam skrot.';
