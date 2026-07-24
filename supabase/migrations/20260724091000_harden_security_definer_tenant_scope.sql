-- ============================================================================
-- P1 (bezpieczenstwo, izolacja tenantow): utwardzenie SECURITY DEFINER, ktore
-- SKALUJA DANE po public_tenant_id(), a AUTORYZUJA po has_role()/is_staff().
--
-- PRZYCZYNA ZRODLOWA (powtarzalna):
--   * current_tenant_id() = SELECT tenant_id FROM profiles WHERE id = auth.uid()
--     -> tenant DOMOWY wolajacego z sesji (nie do podrobienia z klienta).
--   * public_tenant_id() = z naglowka x-tenant-host, ktory ustawia klient
--     (src/integrations/supabase/tenant-host-fetch.ts - a wrecz "nie nadpisuje
--     jawnie ustawionego naglowka"). Brak walidacji trusted-proxy => curl albo
--     supabase.rpc() moze podac DOWOLNY host, wiec public_tenant_id() jest
--     wartoscia KONTROLOWANA PRZEZ ATAKUJACEGO.
--   * has_role()/is_staff() sprawdzaja role w tenancie DOMOWYM (current_tenant_id()).
--
-- Gdy funkcja SECURITY DEFINER (RLS pominiete) skaluje dane po public_tenant_id(),
-- a bramkuje po has_role() (tenant domowy), admin/edytor tenanta A moze podrobic
-- x-tenant-host = domena tenanta B, przejsc bramke roli (rola w A) i odczytac lub
-- zapisac dane tenanta B. Wektor potwierdzony w monetization_dashboard (wyciek
-- przychodu miedzy tenantami) - to sama klasa bledu w wielu funkcjach.
--
-- ZASADA NAPRAWY: dla operacji UPRZYWILEJOWANYCH (bramka roli) tenant danych musi
-- pochodzic z current_tenant_id() (tenant domowy), a nie z naglowka. Wtedy podrobienie
-- x-tenant-host nie ma zadnego efektu (dane zawsze w tenancie domowym), a legalne
-- uzycie (admin pracuje we wlasnym tenancie) dziala bez zmian.
--
-- (A) PELNY SWAP public_tenant_id() -> current_tenant_id() (funkcje czysto stafowe;
--     naglowek nie ma prawa wplywac na zakres danych):
--       - monetization_dashboard      (P1-7: wyciek przychodu; pulpit admina)
--       - b2b_coupons_analytics       (analityka kuponow B2B; admin/editor)
--       - metering_impact_preview     (symulacja limitu meteringu; admin)
--       - get_user_monthly_metering_count (odczyt cudzych licznikow; staff/support)
--       - bulk_generate_coupons_for_campaign (generacja kuponow; straznik tenanta)
--       - publish_qa_session_summary  (publikacja tresci redakcyjnej z sesji Q&A)
--
-- (B) KANDYDACI tej samej klasy bez public_tenant_id() - funkcje pobieraja wiersz
--     po id BEZ filtra tenanta i autoryzuja has_role(admin) (tenant domowy), wiec
--     admin A moze operowac na wierszu tenanta B. Wiazemy galaz admina z
--     current_tenant_id() (galaz wlasciciela organizacji zostaje bez zmian):
--       - org_add_seat          (admin A dodawal miejsca w organizacji tenanta B)
--       - org_touch_seat_invite (admin A czytal e-mail zaproszenia i ponawial
--                                zaproszenie na miejscu tenanta B)
--
-- (C) SCIEZKI PUBLICZNE/CZLONKOWSKIE (GRANT ... TO anon lub plan czlonkowski),
--     gdzie public_tenant_id() jest POPRAWNY dla plaszczyzny tresci (ranga warstwy
--     liczy current_membership_tier() per przegladany host). Zostaje public_tenant_id()
--     dla sciezki czlonka, ale OBEJSCIE STAFOWE (v_staff) wiazemy z tenantem wiersza
--     (= current_tenant_id()), zeby staff tenanta A na cudzej domenie byl traktowany
--     jak zwykly gosc (bramka rangi), a nie omijal publikacji/rangi cudzego tenanta:
--       - authorize_resource_download (pobranie materialu z biblioteki czlonkowskiej)
--       - get_event_access            (URL wejscia/nagrania wydarzenia)
--       - get_poll_results            (wyniki ankiety spolecznosci)
--     Te trzy pozostaja na jawnej liscie dozwolonych w lincie inwariantu
--     (scripts/check-sql-tenant-scope.ts) jako "public paths", bo has_role() jest
--     tam ZWIAZANE z current_tenant_id().
--
-- Migracja forward-only, idempotentna (CREATE OR REPLACE - sama definicja funkcji;
-- podpisy i granty bez zmian). Bramka pgTAP: security_definer_tenant_scope_test.sql.
-- ============================================================================

-- public.monetization_dashboard/4
CREATE OR REPLACE FUNCTION public.monetization_dashboard(
  _from timestamptz DEFAULT (now() - interval '30 days'),
  _to timestamptz DEFAULT now(),
  _plan_id uuid DEFAULT NULL,
  _organization_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' STABLE AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  WITH mv AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE user_id IS NOT NULL)::int AS members,
           count(*) FILTER (WHERE user_id IS NULL)::int AS anonymous
    FROM public.metered_views
    WHERE tenant_id = v_tenant AND created_at >= _from AND created_at <= _to
  ), ev AS (
    SELECT
      count(*) FILTER (WHERE outcome='consumed')::int AS consumed,
      count(*) FILTER (WHERE outcome='denied')::int AS denied,
      count(*) FILTER (WHERE outcome='requires_registration')::int AS reg_wall
    FROM public.metering_event_log
    WHERE tenant_id = v_tenant AND occurred_at >= _from AND occurred_at <= _to
  ), orders AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status='paid')::int AS paid,
           coalesce(sum(amount_cents) FILTER (WHERE status='paid'),0)::bigint AS revenue_cents
    FROM public.payment_orders
    WHERE tenant_id = v_tenant
      AND created_at >= _from AND created_at <= _to
      AND (_plan_id IS NULL OR plan_id = _plan_id)
  ), coupons AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE active)::int AS active,
           coalesce(sum(redemptions_count),0)::int AS redemptions
    FROM public.b2b_coupons
    WHERE tenant_id = v_tenant
      AND (_organization_id IS NULL OR organization_id = _organization_id)
  ), redemptions AS (
    SELECT count(*)::int AS in_range,
           coalesce(sum(applied_cents),0)::bigint AS discount_cents
    FROM public.b2b_coupon_redemptions r
    WHERE r.tenant_id = v_tenant
      AND r.created_at >= _from AND r.created_at <= _to
      AND (_organization_id IS NULL
           OR EXISTS (SELECT 1 FROM public.b2b_coupons c
                       WHERE c.id = r.coupon_id AND c.organization_id = _organization_id))
  ), cs AS (
    SELECT to_jsonb(cs.*) AS settings
    FROM public.checkout_settings cs
    WHERE cs.tenant_id = v_tenant
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'metered_views', (SELECT to_jsonb(mv) FROM mv),
    'metering_events', (SELECT to_jsonb(ev) FROM ev),
    'orders', (SELECT to_jsonb(orders) FROM orders),
    'coupons', (SELECT to_jsonb(coupons) FROM coupons),
    'redemptions', (SELECT to_jsonb(redemptions) FROM redemptions),
    'checkout_settings', COALESCE((SELECT settings FROM cs), '{}'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

-- public.b2b_coupons_analytics/2
CREATE OR REPLACE FUNCTION public.b2b_coupons_analytics(_from TIMESTAMPTZ, _to TIMESTAMPTZ)
RETURNS TABLE(
  coupon_id UUID, code TEXT, name TEXT,
  redemptions BIGINT, revenue_cents BIGINT, discount_cents_total BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.code, c.name,
    COUNT(r.id)::BIGINT,
    COALESCE(SUM(r.applied_cents),0)::BIGINT,
    COALESCE(SUM(r.original_cents - r.applied_cents),0)::BIGINT
  FROM public.b2b_coupons c
  LEFT JOIN public.b2b_coupon_redemptions r
    ON r.coupon_id = c.id
   AND r.tenant_id = c.tenant_id
   AND r.created_at BETWEEN _from AND _to
  WHERE c.tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role))
  GROUP BY c.id, c.code, c.name
  ORDER BY COUNT(r.id) DESC
  LIMIT 100;
$$;

-- public.metering_impact_preview/1
CREATE OR REPLACE FUNCTION public.metering_impact_preview(_proposed_member_limit integer)
RETURNS TABLE (
  total_members bigint,
  members_blocked bigint,
  members_warning bigint,
  members_safe bigint,
  total_anon bigint,
  anon_blocked bigint,
  avg_used numeric,
  max_used integer,
  total_views bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_month date := date_trunc('month', now())::date;
  v_limit integer := GREATEST(0, LEAST(1000, COALESCE(_proposed_member_limit, 0)));
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'editor')
    OR public.has_role(auth.uid(), 'tenant_admin')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT user_id, COUNT(*)::int AS used
      FROM public.metered_views
     WHERE tenant_id = v_tenant
       AND period_month = v_month
       AND user_id IS NOT NULL
     GROUP BY user_id
  ),
  anon AS (
    SELECT visitor_id, COUNT(*)::int AS used
      FROM public.metered_views
     WHERE tenant_id = v_tenant
       AND period_month = v_month
       AND user_id IS NULL
       AND visitor_id IS NOT NULL
     GROUP BY visitor_id
  )
  SELECT
    (SELECT COUNT(*) FROM members),
    (SELECT COUNT(*) FROM members WHERE v_limit > 0 AND used >= v_limit),
    (SELECT COUNT(*) FROM members WHERE v_limit > 0 AND used > 0 AND used < v_limit),
    (SELECT COUNT(*) FROM members WHERE v_limit = 0 OR used = 0),
    (SELECT COUNT(*) FROM anon),
    (SELECT COUNT(*) FROM anon WHERE v_limit > 0 AND used >= v_limit),
    COALESCE((SELECT ROUND(AVG(used)::numeric, 2) FROM members), 0)::numeric,
    COALESCE((SELECT MAX(used) FROM members), 0)::int,
    (SELECT COUNT(*) FROM public.metered_views
      WHERE tenant_id = v_tenant AND period_month = v_month);
END $$;

-- public.get_user_monthly_metering_count/1
CREATE OR REPLACE FUNCTION public.get_user_monthly_metering_count(_user_id uuid)
RETURNS TABLE (
  used integer,
  monthly_limit integer,
  remaining integer,
  period_month date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_limit integer;
  v_used integer;
  v_period date := date_trunc('month', now())::date;
BEGIN
  -- Tylko staff może odczytywać cudze liczniki.
  IF _user_id <> auth.uid()
     AND NOT (has_role(auth.uid(), 'admin'::app_role)
              OR has_role(auth.uid(), 'editor'::app_role)
              OR has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT ms.member_monthly_limit
    INTO v_limit
    FROM public.metering_settings ms
   WHERE ms.tenant_id = v_tenant;
  v_limit := COALESCE(v_limit, 5);

  SELECT count(*)::int
    INTO v_used
    FROM public.metered_views mv
   WHERE mv.tenant_id = v_tenant
     AND mv.user_id = _user_id
     AND mv.period_month = v_period;
  v_used := COALESCE(v_used, 0);

  used := v_used;
  monthly_limit := v_limit;
  remaining := GREATEST(v_limit - v_used, 0);
  period_month := v_period;
  RETURN NEXT;
END;
$$;

-- public.bulk_generate_coupons_for_campaign/1
CREATE OR REPLACE FUNCTION public.bulk_generate_coupons_for_campaign(_campaign_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c public.b2b_coupon_campaigns%ROWTYPE;
  _uid UUID := auth.uid();
  _i INTEGER := 0;
  _created INTEGER := 0;
  _code TEXT;
  _alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  _tries INTEGER;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO _c FROM public.b2b_coupon_campaigns WHERE id = _campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF _c.tenant_id <> public.current_tenant_id() THEN RAISE EXCEPTION 'wrong_tenant'; END IF;
  IF NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'editor'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _c.status <> 'draft' THEN RAISE EXCEPTION 'campaign_already_generated'; END IF;

  WHILE _i < _c.code_count LOOP
    _tries := 0;
    LOOP
      _code := COALESCE(NULLIF(_c.prefix,''),'') ||
        (SELECT string_agg(substr(_alphabet, 1 + floor(random()*length(_alphabet))::int, 1),'')
         FROM generate_series(1, _c.code_length));
      BEGIN
        INSERT INTO public.b2b_coupons(
          tenant_id, code, name, discount_kind, discount_percent, discount_cents, currency,
          active, max_redemptions, valid_from, valid_until, plan_ids,
          campaign_id, grants_tier_key, grants_duration_days, newsletter_segment,
          created_by, metadata
        ) VALUES (
          _c.tenant_id, _code, _c.name, _c.discount_kind, _c.discount_percent, _c.discount_cents, _c.currency,
          true, _c.max_redemptions_per_code, _c.valid_from, _c.valid_until, _c.plan_ids,
          _c.id, _c.grants_tier_key, _c.grants_duration_days, _c.newsletter_segment,
          _uid, jsonb_build_object('campaign', _c.name)
        );
        _created := _created + 1;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        _tries := _tries + 1;
        IF _tries > 5 THEN RAISE EXCEPTION 'code_collision_limit'; END IF;
      END;
    END LOOP;
    _i := _i + 1;
  END LOOP;

  UPDATE public.b2b_coupon_campaigns
     SET status = 'generated', generated_count = _created, updated_at = now()
   WHERE id = _campaign_id;

  RETURN _created;
END;
$$;

-- public.publish_qa_session_summary/2
CREATE OR REPLACE FUNCTION public.publish_qa_session_summary(
  p_session_id uuid,
  p_publish boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session public.qa_sessions%ROWTYPE;
  v_staff boolean;
  v_q record;
  v_n integer := 0;
  v_body_pl text := '';
  v_body_en text := '';
  v_author_pl text;
  v_author_en text;
  v_slug text;
  v_post_id uuid;
  v_parent_page uuid;
  v_was_published boolean := false;
  v_status public.post_status;
  v_notified uuid[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'qa: authentication required';
  END IF;

  SELECT * INTO v_session
    FROM public.qa_sessions
   WHERE id = p_session_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qa: session not found';
  END IF;

  v_staff := public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role);
  IF NOT v_staff AND v_session.host_user_id <> v_user THEN
    RAISE EXCEPTION 'qa: not allowed';
  END IF;

  -- Publikacja przechodzi przez workflow redakcyjny (trigger
  -- enforce_post_workflow i tak by ją zatrzymał - tu czytelny błąd domenowy).
  IF p_publish AND NOT public.can_publish_content(v_user) THEN
    RAISE EXCEPTION 'qa: publish requires editorial role';
  END IF;

  -- Podsumowanie ma sens od fazy odpowiadania; szkic/otwarta sesja to za wcześnie.
  IF v_session.status NOT IN ('answering', 'closed') THEN
    RAISE EXCEPTION 'qa: session not summarizable';
  END IF;

  -- Wstęp sesji otwiera wpis (jeśli istnieje).
  IF COALESCE(btrim(v_session.intro_pl), '') <> '' THEN
    v_body_pl := public.qa_text_to_html(v_session.intro_pl);
  END IF;
  IF COALESCE(btrim(v_session.intro_en), '') <> '' THEN
    v_body_en := public.qa_text_to_html(v_session.intro_en);
  END IF;

  -- Porządek jak na stronie sesji: głosy społeczności > starszeństwo.
  FOR v_q IN
    SELECT q.body, q.answer_body, q.author_display, q.is_anonymous, q.user_id
      FROM public.qa_questions q
      LEFT JOIN LATERAL (
        SELECT count(*) AS votes
          FROM public.qa_question_votes qv
         WHERE qv.question_id = q.id
      ) v ON true
     WHERE q.session_id = p_session_id
       AND q.status = 'answered'
       AND COALESCE(btrim(q.answer_body), '') <> ''
     ORDER BY v.votes DESC, q.created_at ASC
     LIMIT 200
  LOOP
    v_n := v_n + 1;
    v_author_pl := CASE
      WHEN v_q.is_anonymous OR COALESCE(btrim(v_q.author_display), '') = ''
        THEN 'Anonimowo'
      ELSE public.qa_escape_html(v_q.author_display)
    END;
    v_author_en := CASE
      WHEN v_q.is_anonymous OR COALESCE(btrim(v_q.author_display), '') = ''
        THEN 'Anonymous'
      ELSE public.qa_escape_html(v_q.author_display)
    END;

    v_body_pl := v_body_pl
      || '<h3>Pytanie ' || v_n || '</h3>'
      || '<blockquote>' || public.qa_text_to_html(v_q.body)
      || '<p><cite>- ' || v_author_pl || '</cite></p></blockquote>'
      || public.qa_text_to_html(v_q.answer_body);
    v_body_en := v_body_en
      || '<h3>Question ' || v_n || '</h3>'
      || '<blockquote>' || public.qa_text_to_html(v_q.body)
      || '<p><cite>- ' || v_author_en || '</cite></p></blockquote>'
      || public.qa_text_to_html(v_q.answer_body);

    v_notified := array_append(v_notified, v_q.user_id);
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'qa: no answered questions';
  END IF;

  v_slug := 'qa-' || v_session.slug || '-podsumowanie';

  -- Idempotentny upsert: najpierw wpis spięty z sesją, potem slug w tenancie.
  v_post_id := v_session.post_id;
  IF v_post_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.id = v_post_id) THEN
    v_post_id := NULL;
  END IF;
  IF v_post_id IS NULL THEN
    SELECT p.id INTO v_post_id
      FROM public.posts p
     WHERE p.tenant_id = v_session.tenant_id AND p.slug = v_slug;
  END IF;

  IF v_post_id IS NULL THEN
    -- Wpisy żyją pod stroną-rodzicem (posts.parent_page_id NOT NULL) -
    -- kanonicznie strona "blog" tenanta, awaryjnie najstarsza strona główna.
    SELECT pg.id INTO v_parent_page
      FROM public.pages pg
     WHERE pg.tenant_id = v_session.tenant_id
       AND pg.slug = 'blog'
       AND pg.parent_id IS NULL
       AND pg.deleted_at IS NULL
     ORDER BY pg.created_at ASC
     LIMIT 1;
    IF v_parent_page IS NULL THEN
      SELECT pg.id INTO v_parent_page
        FROM public.pages pg
       WHERE pg.tenant_id = v_session.tenant_id
         AND pg.parent_id IS NULL
         AND pg.deleted_at IS NULL
       ORDER BY pg.created_at ASC
       LIMIT 1;
    END IF;
    IF v_parent_page IS NULL THEN
      RAISE EXCEPTION 'qa: no parent page for summary post';
    END IF;

    INSERT INTO public.posts (
      tenant_id, slug, parent_page_id, author_id, status, editor,
      title_pl, title_en, excerpt_pl, excerpt_en, content_pl, content_en,
      published_at
    )
    VALUES (
      v_session.tenant_id,
      v_slug,
      v_parent_page,
      COALESCE(v_session.host_user_id, v_user),
      CASE WHEN p_publish THEN 'published' ELSE 'draft' END::public.post_status,
      'richtext'::public.editor_type,
      'Q&A: ' || v_session.title_pl || ' - podsumowanie',
      'Q&A: ' || v_session.title_en || ' - recap',
      'Najważniejsze pytania społeczności i odpowiedzi eksperta z sesji Q&A.',
      'The community''s top questions and the expert''s answers from the Q&A session.',
      v_body_pl,
      v_body_en,
      CASE WHEN p_publish THEN now() END
    )
    RETURNING id INTO v_post_id;
  ELSE
    SELECT p.status = 'published' INTO v_was_published
      FROM public.posts p WHERE p.id = v_post_id;
    UPDATE public.posts
       SET title_pl = 'Q&A: ' || v_session.title_pl || ' - podsumowanie',
           title_en = 'Q&A: ' || v_session.title_en || ' - recap',
           content_pl = v_body_pl,
           content_en = v_body_en,
           -- Publikacja jest jednokierunkowa: odświeżenie treści nie cofa
           -- opublikowanego wpisu do szkicu.
           status = CASE
             WHEN p_publish OR v_was_published THEN 'published'::public.post_status
             ELSE status
           END,
           published_at = CASE
             WHEN p_publish OR v_was_published THEN COALESCE(published_at, now())
             ELSE published_at
           END,
           deleted_at = NULL,
           updated_at = now()
     WHERE id = v_post_id;
  END IF;

  UPDATE public.qa_sessions
     SET post_id = v_post_id, updated_at = now()
   WHERE id = p_session_id;

  SELECT p.status INTO v_status FROM public.posts p WHERE p.id = v_post_id;

  -- Powiadom autorów odpowiedzianych pytań przy pierwszej publikacji -
  -- ich pytanie właśnie stało się częścią opublikowanej treści.
  IF p_publish AND NOT v_was_published THEN
    PERFORM public.enqueue_notification(
      u.user_id,
      'content',
      'Podsumowanie sesji Q&A jest już dostępne',
      'The Q&A session recap is now available',
      v_session.title_pl,
      v_session.title_en,
      '/post/' || v_slug,
      'BookOpenCheck'
    )
    FROM (SELECT DISTINCT unnest(v_notified) AS user_id) u
    WHERE u.user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'post_id', v_post_id,
    'slug', v_slug,
    'status', v_status,
    'questions', v_n
  );
END;
$$;

-- public.org_add_seat/3
CREATE OR REPLACE FUNCTION public.org_add_seat(p_org uuid, p_email text, p_role text DEFAULT 'member')
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org public.member_organizations%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_user uuid;
  v_used integer;
  v_id uuid;
  v_tenant_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;
  IF p_role NOT IN ('owner', 'member') THEN RAISE EXCEPTION 'orgs: invalid role'; END IF;
  IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'orgs: invalid email';
  END IF;

  SELECT * INTO v_org FROM public.member_organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;

  -- Autoryzacja admina redakcji WYLACZNIE we wlasnym tenancie domowym:
  -- has_role() jest scope'owane do current_tenant_id(), wiec bez zwiazania
  -- z tenantem organizacji admin tenanta A z podrobionym x-tenant-host
  -- moglby dodac miejsce w organizacji tenanta B. Wlasciciel organizacji
  -- (is_org_owner) autoryzuje sie posiadanym miejscem 'owner', niezaleznie
  -- od naglowka.
  v_tenant_admin := public.has_role(v_uid, 'admin'::app_role)
                    AND v_org.tenant_id = public.current_tenant_id();
  IF NOT (v_tenant_admin OR public.is_org_owner(p_org)) THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  -- Tylko admin redakcji może mintować miejsce 'owner' (owner nie rozmnaża owners).
  IF p_role = 'owner' AND NOT v_tenant_admin THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  IF v_org.status <> 'active' THEN RAISE EXCEPTION 'orgs: organization inactive'; END IF;

  SELECT count(*) INTO v_used FROM public.organization_seats WHERE org_id = p_org;
  IF v_used >= v_org.seats_limit THEN RAISE EXCEPTION 'orgs: seats limit reached'; END IF;

  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;

  INSERT INTO public.organization_seats
    (tenant_id, org_id, invited_email, user_id, role, claimed_at, invited_by, last_invited_at)
  VALUES
    (v_org.tenant_id, p_org, v_email, v_user, p_role,
     CASE WHEN v_user IS NULL THEN NULL ELSE now() END,
     v_uid, now())
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'orgs: seat exists';
END $$;

-- public.org_touch_seat_invite/1
CREATE OR REPLACE FUNCTION public.org_touch_seat_invite(p_seat uuid)
RETURNS TABLE (seat_id uuid, invited_email text, org_name text, last_invited_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_seat public.organization_seats%ROWTYPE;
  v_org public.member_organizations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;

  SELECT * INTO v_seat FROM public.organization_seats WHERE id = p_seat FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;

  -- Admin redakcji autoryzuje sie WYLACZNIE we wlasnym tenancie domowym
  -- (has_role() jest scope'owane do current_tenant_id()); inaczej admin tenanta
  -- A z podrobionym x-tenant-host moglby odczytac e-mail zaproszenia i ponowic
  -- zaproszenie na miejscu tenanta B. Wlasciciel organizacji bez zmian.
  IF NOT ((public.has_role(v_uid, 'admin'::app_role)
           AND v_seat.tenant_id = public.current_tenant_id())
          OR public.is_org_owner(v_seat.org_id)) THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  IF v_seat.claimed_at IS NOT NULL OR v_seat.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'orgs: seat already claimed';
  END IF;

  SELECT * INTO v_org FROM public.member_organizations WHERE id = v_seat.org_id;
  IF NOT FOUND OR v_org.status <> 'active' THEN
    RAISE EXCEPTION 'orgs: organization inactive';
  END IF;

  UPDATE public.organization_seats os
     SET last_invited_at = now()
   WHERE os.id = p_seat;

  RETURN QUERY
    SELECT v_seat.id, v_seat.invited_email, v_org.name, now()::timestamptz;
END $$;

-- public.authorize_resource_download/1
CREATE OR REPLACE FUNCTION public.authorize_resource_download(p_resource uuid)
RETURNS TABLE (file_path text, file_name text, mime_type text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_res public.member_resources%ROWTYPE;
  v_staff boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'resources: authentication required';
  END IF;
  SELECT * INTO v_res FROM public.member_resources
   WHERE id = p_resource
     AND tenant_id = COALESCE(public.public_tenant_id(), public.current_tenant_id());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resources: not found';
  END IF;
  v_staff := (public.has_role(v_user, 'admin'::app_role)
             OR public.has_role(v_user, 'editor'::app_role))
             AND v_res.tenant_id = public.current_tenant_id();
  IF NOT v_res.published AND NOT v_staff THEN
    RAISE EXCEPTION 'resources: not found';
  END IF;
  IF NOT v_staff AND NOT public.has_tier_rank(v_res.min_tier_rank) THEN
    RAISE EXCEPTION 'resources: tier required';
  END IF;

  INSERT INTO public.resource_downloads (tenant_id, resource_id, user_id)
  VALUES (v_res.tenant_id, v_res.id, v_user);

  RETURN QUERY SELECT v_res.file_path, v_res.file_name, v_res.mime_type;
END;
$$;

-- public.get_event_access/1
CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (
  can_join boolean,
  join_url text,
  can_watch boolean,
  recording_url text,
  reason text,
  watch_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_allowed boolean;
  v_can_watch boolean;
  v_rsvp text;
BEGIN
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found', 'not_found';
    RETURN;
  END IF;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'auth_required' END;
    RETURN;
  END IF;

  v_staff := (public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role))
          AND v_event.tenant_id = public.current_tenant_id();
  SELECT er.status INTO v_rsvp
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  -- Ta sama bramka co w rsvp_event: members-briefing wymaga flagi
  -- pro_briefings; pozostałe members - efektywnej rangi (min. 1).
  IF v_staff THEN
    v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'tier_required' END;
    RETURN;
  END IF;

  -- Nagrania: benefit warstwy (flaga recordings), nie sama ranga wydarzenia -
  -- URL nie opuszcza bazy bez uprawnienia.
  v_can_watch := v_event.recording_url IS NOT NULL
             AND (v_staff OR public.has_tier_feature('recordings'));

  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_can_watch,
    CASE WHEN v_can_watch THEN v_event.recording_url END,
    CASE
      WHEN v_rsvp = 'going' OR v_staff THEN 'ok'
      WHEN v_rsvp = 'waitlist' THEN 'waitlisted'
      ELSE 'rsvp_required'
    END,
    CASE
      WHEN v_event.recording_url IS NULL THEN 'none'
      WHEN v_can_watch THEN 'ok'
      ELSE 'tier_required'
    END;
END;
$$;

-- public.get_poll_results/1
CREATE OR REPLACE FUNCTION public.get_poll_results(p_poll_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_poll public.polls%ROWTYPE;
  v_my integer;
  v_staff boolean := false;
  v_counts jsonb;
  v_total integer;
BEGIN
  SELECT * INTO v_poll
    FROM public.polls
   WHERE id = p_poll_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_poll.status = 'draft' THEN
    RAISE EXCEPTION 'polls: not found';
  END IF;

  IF v_user IS NOT NULL THEN
    SELECT option_idx INTO v_my
      FROM public.poll_votes WHERE poll_id = p_poll_id AND user_id = v_user;
    v_staff := (public.has_role(v_user, 'admin'::app_role)
            OR public.has_role(v_user, 'editor'::app_role))
            AND v_poll.tenant_id = public.current_tenant_id();
  END IF;

  IF v_my IS NULL AND v_poll.status <> 'closed' AND NOT v_staff THEN
    RETURN jsonb_build_object('visible', false, 'my_vote', NULL);
  END IF;

  SELECT COALESCE(jsonb_object_agg(idx::text, cnt), '{}'::jsonb),
         COALESCE(sum(cnt), 0)::integer
    INTO v_counts, v_total
    FROM (
      SELECT option_idx AS idx, count(*)::integer AS cnt
        FROM public.poll_votes
       WHERE poll_id = p_poll_id
       GROUP BY option_idx
    ) c;

  RETURN jsonb_build_object(
    'visible', true,
    'my_vote', v_my,
    'total', v_total,
    'counts', v_counts
  );
END;
$$;
