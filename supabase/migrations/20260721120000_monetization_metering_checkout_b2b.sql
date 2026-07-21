-- =============================================================================
-- Monetyzacja (3 filary):
--
--   1) METERING PAYWALLA - "N darmowych artykułów / miesiąc". Dotychczasowa
--      bramka była binarna (uprawniony/nie); metering dodaje standardowy lejek
--      konwersji prasy cyfrowej: anonim -> rejestracja (limit dla konta
--      bezpłatnego) -> subskrypcja. Egzekwowanie WYŁĄCZNIE serwerowe, tą samą
--      ścieżką co get_entity_content (SECURITY DEFINER; treść nigdy nie trafia
--      do nieuprawnionego klienta inaczej niż przez świadome, policzone
--      "odblokowanie na licznik").
--
--   2) USTAWIENIA CHECKOUTU - kody promocyjne (kupony Stripe), Stripe Tax,
--      zbieranie NIP/VAT (tax_id_collection) i faktury dla płatności
--      jednorazowych. Sam checkout czyta te flagi serwerowo
--      (lib/billing/checkout.functions.ts) - klient niczego nie wymusi.
--
--   3) SAMOOBSŁUGA B2B - zaproszenia mailowe do miejsc w organizacji
--      (invited_by / last_invited_at + ponowienie zaproszenia) oraz realny
--      produkt enterprise: warstwy członkostwa z flagą `premium_content`
--      odblokowują artykuły płatne (site licence dla miejsc organizacji).
--
-- Wszystko tenant-scoped + RLS; funkcje SECURITY DEFINER z jawnym search_path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a) Ustawienia meteringu (singleton per tenant).
--     Konfiguracja jest jawna (bez sekretów) - paywall po stronie publicznej
--     potrzebuje jej do copy CTA ("zarejestruj się, aby czytać N artykułów"),
--     więc SELECT dostają anon+authenticated; zapis tylko staff.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metering_settings (
  tenant_id uuid PRIMARY KEY DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  -- Limit dla ZALOGOWANEGO konta bezpłatnego (rdzeń lejka "z rejestracją").
  member_monthly_limit integer NOT NULL DEFAULT 3
    CHECK (member_monthly_limit BETWEEN 0 AND 1000),
  -- Limit dla anonima (0 = twarda ściana rejestracji; >0 = flexible sampling).
  anon_monthly_limit integer NOT NULL DEFAULT 0
    CHECK (anon_monthly_limit BETWEEN 0 AND 1000),
  -- Które tryby bramki biorą udział w meteringu przy polityce 'inherit'.
  meter_paid boolean NOT NULL DEFAULT true,
  meter_members boolean NOT NULL DEFAULT true,
  -- Widoczność licznika "pozostało X z N" nad artykułem.
  show_counter boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.metering_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "metering settings public read" ON public.metering_settings;
CREATE POLICY "metering settings public read"
  ON public.metering_settings FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "metering settings staff write" ON public.metering_settings;
CREATE POLICY "metering settings staff write"
  ON public.metering_settings FOR ALL
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

GRANT SELECT ON public.metering_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metering_settings TO authenticated;
GRANT ALL ON public.metering_settings TO service_role;

DROP TRIGGER IF EXISTS trg_metering_settings_updated ON public.metering_settings;
CREATE TRIGGER trg_metering_settings_updated
  BEFORE UPDATE ON public.metering_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 1b) Polityka meteringu per wpis/strona - na regule dostępu (content_access),
--     czyli DOKŁADNIE tym samym wierszu, który edytują: pane w edytorze wpisu,
--     pane w edytorze strony i panel admina. Jedno źródło = pełna synchronizacja.
--       inherit - wg globalnych przełączników trybów,
--       metered - zawsze uczestniczy (dopóki metering włączony),
--       exempt  - nigdy (twarda ściana, np. raporty premium).
-- -----------------------------------------------------------------------------
ALTER TABLE public.content_access
  ADD COLUMN IF NOT EXISTS metering_policy text NOT NULL DEFAULT 'inherit'
    CHECK (metering_policy IN ('inherit', 'metered', 'exempt'));

-- content_access ma kolumnowe granty (20260711102330) - nowa kolumna wymaga
-- jawnego SELECT, inaczej edytory staff jej nie odczytają.
GRANT SELECT (metering_policy) ON public.content_access TO anon, authenticated;

-- Publiczny widok reguły dostępu: dokładamy metering_policy (na końcu listy -
-- CREATE OR REPLACE VIEW dopuszcza wyłącznie dopisanie kolumn na końcu).
CREATE OR REPLACE VIEW public.content_access_public
WITH (security_invoker = off) AS
SELECT
  id,
  tenant_id,
  entity_type,
  entity_id,
  mode,
  plan_ids,
  one_time_price_cents,
  one_time_currency,
  teaser_pl,
  teaser_en,
  created_at,
  updated_at,
  metering_policy
FROM public.content_access
WHERE tenant_id = public_tenant_id();

GRANT SELECT ON public.content_access_public TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1c) Zużycie licznika. Wiersz = "ta tożsamość odblokowała ten byt w tym
--     miesiącu". Ponowne czytanie tego samego artykułu NIE zużywa limitu
--     (unikalność per byt/miesiąc). Brak dostępu klienckiego - wyłącznie
--     funkcje SECURITY DEFINER.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metered_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_id uuid,
  entity_type public.access_entity_type NOT NULL,
  entity_id uuid NOT NULL,
  period_month date NOT NULL DEFAULT (date_trunc('month', now()))::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL)
);

-- Idempotencja odblokowań (osobno dla kont i anonimów).
CREATE UNIQUE INDEX IF NOT EXISTS metered_views_user_entity_uniq
  ON public.metered_views (tenant_id, user_id, entity_type, entity_id, period_month)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS metered_views_visitor_entity_uniq
  ON public.metered_views (tenant_id, visitor_id, entity_type, entity_id, period_month)
  WHERE user_id IS NULL;
-- Zliczanie zużycia w miesiącu.
CREATE INDEX IF NOT EXISTS metered_views_user_period_idx
  ON public.metered_views (tenant_id, user_id, period_month)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS metered_views_visitor_period_idx
  ON public.metered_views (tenant_id, visitor_id, period_month)
  WHERE user_id IS NULL;

ALTER TABLE public.metered_views ENABLE ROW LEVEL SECURITY;
-- Brak polityk = brak dostępu klienckiego; definer i service_role wystarczą.
REVOKE ALL ON public.metered_views FROM anon, authenticated;
GRANT ALL ON public.metered_views TO service_role;

-- -----------------------------------------------------------------------------
-- 1d) Stan licznika (bez konsumowania) - dla banera i wariantów paywalla.
--     Anonim identyfikuje się kluczem gościa (uuid z localStorage); miękki
--     licznik z natury jest resetowalny po stronie klienta - twardą walutą
--     lejka jest limit KONTA (wymaga rejestracji), i ten egzekwujemy po
--     auth.uid(), nie po czymkolwiek podanym przez klienta.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.metering_state(_visitor_id uuid DEFAULT NULL)
RETURNS TABLE (
  enabled boolean,
  monthly_limit integer,
  used integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_settings public.metering_settings%ROWTYPE;
  v_limit integer := 0;
  v_used integer := 0;
  v_period date := (date_trunc('month', now()))::date;
BEGIN
  SELECT * INTO v_settings FROM public.metering_settings ms WHERE ms.tenant_id = v_tenant;
  IF NOT FOUND OR NOT v_settings.enabled THEN
    RETURN QUERY SELECT false, 0, 0, 0, false, false;
    RETURN;
  END IF;

  IF v_uid IS NOT NULL THEN
    v_limit := v_settings.member_monthly_limit;
    SELECT count(*)::integer INTO v_used
      FROM public.metered_views mv
     WHERE mv.tenant_id = v_tenant AND mv.user_id = v_uid AND mv.period_month = v_period;
  ELSIF _visitor_id IS NOT NULL THEN
    v_limit := v_settings.anon_monthly_limit;
    SELECT count(*)::integer INTO v_used
      FROM public.metered_views mv
     WHERE mv.tenant_id = v_tenant AND mv.user_id IS NULL
       AND mv.visitor_id = _visitor_id AND mv.period_month = v_period;
  ELSE
    v_limit := v_settings.anon_monthly_limit;
  END IF;

  RETURN QUERY SELECT
    true,
    v_limit,
    v_used,
    GREATEST(v_limit - v_used, 0),
    (v_uid IS NULL AND v_settings.anon_monthly_limit <= 0),
    v_settings.show_counter;
END $$;

REVOKE ALL ON FUNCTION public.metering_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.metering_state(uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1e) Konsumpcja licznika + wydanie treści. Jedyna poza get_entity_content
--     droga, którą zabramkowana treść może opuścić bazę - i tak samo jak tam:
--     ponownie egzekwuje tenant + published + not-deleted. Zwraca zawsze jeden
--     wiersz ze stanem licznika; body tylko przy granted=true.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_metered_view(
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _visitor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  granted boolean,
  consumed boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_settings public.metering_settings%ROWTYPE;
  v_mode public.access_mode;
  v_policy text;
  v_rule_tenant uuid;
  v_limit integer := 0;
  v_used integer := 0;
  v_already boolean := false;
  v_insert_count integer := 0;
  v_requires_registration boolean := false;
  v_show_counter boolean := false;
  v_content_pl text;
  v_content_en text;
  v_builder jsonb;
  v_blocks jsonb;
  v_body_found boolean := false;
BEGIN
  -- Media nie mają body do wydania tą drogą.
  IF _entity_type = 'media' THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT ca.mode, ca.metering_policy, ca.tenant_id
    INTO v_mode, v_policy, v_rule_tenant
    FROM public.content_access ca
   WHERE ca.entity_type = _entity_type AND ca.entity_id = _entity_id;

  -- Brak reguły / treść publiczna / tryb hasłowy / inna instancja tenant -
  -- metering nie ma tu nic do roboty (public idzie zwykłą ścieżką, hasło ma
  -- własny, osobny odblokowywacz).
  IF NOT FOUND OR v_mode = 'public' OR v_mode = 'password' OR v_rule_tenant IS DISTINCT FROM v_tenant THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_settings FROM public.metering_settings ms WHERE ms.tenant_id = v_tenant;
  IF NOT FOUND OR NOT v_settings.enabled OR v_policy = 'exempt' THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  v_show_counter := v_settings.show_counter;

  -- Osłona przed wyścigiem: uprawniony wołający (subskrypcja/zakup/organizacja)
  -- dostaje body bez zużywania licznika. Zawsze dokładnie jeden wiersz.
  IF public.has_content_access(_entity_type, _entity_id) THEN
    SELECT b.content_pl, b.content_en, b.builder_data, b.blocks_data
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.get_entity_content(_entity_type, _entity_id) b;
    v_body_found := FOUND;
    RETURN QUERY SELECT v_body_found, false, 0, 0, 0, false, v_show_counter,
      v_content_pl, v_content_en, v_builder, v_blocks;
    RETURN;
  END IF;

  -- Polityka 'inherit' respektuje globalne przełączniki trybów; 'metered'
  -- wymusza udział niezależnie od nich.
  IF v_policy = 'inherit' THEN
    IF v_mode = 'paid' AND NOT v_settings.meter_paid THEN
      RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    IF v_mode = 'members' AND NOT v_settings.meter_members THEN
      RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
  END IF;

  -- Tożsamość i limit: konto (auth.uid) albo klucz gościa.
  IF v_uid IS NOT NULL THEN
    v_limit := v_settings.member_monthly_limit;
  ELSE
    v_limit := v_settings.anon_monthly_limit;
    v_requires_registration := v_settings.anon_monthly_limit <= 0;
    IF _visitor_id IS NULL OR v_requires_registration THEN
      RETURN QUERY SELECT false, false, 0, v_limit, GREATEST(v_limit, 0), true, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
  END IF;

  -- Zużycie w bieżącym miesiącu + czy TEN byt już odblokowano (ponowne
  -- czytanie nie kosztuje).
  IF v_uid IS NOT NULL THEN
    SELECT count(*)::integer,
           bool_or(mv.entity_type = _entity_type AND mv.entity_id = _entity_id)
      INTO v_used, v_already
      FROM public.metered_views mv
     WHERE mv.tenant_id = v_tenant AND mv.user_id = v_uid
       AND mv.period_month = (date_trunc('month', now()))::date;
  ELSE
    SELECT count(*)::integer,
           bool_or(mv.entity_type = _entity_type AND mv.entity_id = _entity_id)
      INTO v_used, v_already
      FROM public.metered_views mv
     WHERE mv.tenant_id = v_tenant AND mv.user_id IS NULL AND mv.visitor_id = _visitor_id
       AND mv.period_month = (date_trunc('month', now()))::date;
  END IF;
  v_already := COALESCE(v_already, false);

  IF NOT v_already THEN
    IF v_used >= v_limit THEN
      -- Limit wyczerpany: stan licznika bez body (paywall pokaże wariant
      -- "wykorzystano X z N").
      RETURN QUERY SELECT false, false, v_used, v_limit, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    -- ON CONFLICT DO NOTHING: równoległe żądanie tego samego bytu nie dubluje
    -- wiersza ani nie wysadza transakcji.
    INSERT INTO public.metered_views (tenant_id, user_id, visitor_id, entity_type, entity_id)
    VALUES (v_tenant, v_uid, CASE WHEN v_uid IS NULL THEN _visitor_id ELSE NULL END,
            _entity_type, _entity_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_insert_count = ROW_COUNT;
    IF v_insert_count > 0 THEN
      v_used := v_used + 1;
    END IF;
  END IF;

  -- Wydanie body - identyczne ograniczenia jak get_entity_content.
  IF _entity_type = 'post' THEN
    SELECT p.content_pl, p.content_en, p.builder_data, p.blocks_data
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.posts p
     WHERE p.id = _entity_id AND p.tenant_id = v_tenant
       AND p.status = 'published' AND p.deleted_at IS NULL;
    v_body_found := FOUND;
  ELSE
    SELECT pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.pages pg
     WHERE pg.id = _entity_id AND pg.tenant_id = v_tenant
       AND pg.status = 'published' AND pg.deleted_at IS NULL;
    v_body_found := FOUND;
  END IF;

  IF NOT v_body_found THEN
    RETURN QUERY SELECT false, false, v_used, v_limit, GREATEST(v_limit - v_used, 0), false,
      v_show_counter, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    (NOT v_already AND v_insert_count > 0),
    v_used,
    v_limit,
    GREATEST(v_limit - v_used, 0),
    false,
    v_show_counter,
    v_content_pl, v_content_en, v_builder, v_blocks;
END $$;

REVOKE ALL ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid, uuid) IS
  'Metered paywall: wydaje body zabramkowanego wpisu/strony w zamian za slot '
  'miesięcznego limitu (metering_settings). Idempotentne per byt/miesiąc; '
  'uprawnieni (has_content_access) dostają body bez zużycia. Zwraca zawsze stan '
  'licznika (used/limit/remaining) dla banera i wariantów paywalla.';

-- -----------------------------------------------------------------------------
-- 2) Ustawienia checkoutu (kupony / Stripe Tax / NIP / faktury) - singleton
--    per tenant, czytany serwerowo przy tworzeniu sesji Stripe.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkout_settings (
  tenant_id uuid PRIMARY KEY DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Pole "kod promocyjny" w Stripe Checkout (kupony definiuje się w Stripe).
  allow_promotion_codes boolean NOT NULL DEFAULT true,
  -- Stripe Tax: automatyczne naliczanie VAT wg lokalizacji kupującego.
  automatic_tax boolean NOT NULL DEFAULT false,
  -- Zbieranie NIP/VAT ID w Checkout (trafia na fakturę Stripe).
  tax_id_collection boolean NOT NULL DEFAULT true,
  billing_address_collection text NOT NULL DEFAULT 'auto'
    CHECK (billing_address_collection IN ('auto', 'required')),
  -- Faktura Stripe także dla płatności jednorazowych (subskrypcje mają zawsze).
  invoice_creation boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.checkout_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checkout settings public read" ON public.checkout_settings;
CREATE POLICY "checkout settings public read"
  ON public.checkout_settings FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "checkout settings staff write" ON public.checkout_settings;
CREATE POLICY "checkout settings staff write"
  ON public.checkout_settings FOR ALL
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

GRANT SELECT ON public.checkout_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkout_settings TO authenticated;
GRANT ALL ON public.checkout_settings TO service_role;

DROP TRIGGER IF EXISTS trg_checkout_settings_updated ON public.checkout_settings;
CREATE TRIGGER trg_checkout_settings_updated
  BEFORE UPDATE ON public.checkout_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3a) B2B: metadane zaproszeń na miejscach organizacji. Dotąd dodanie miejsca
--     nie zostawiało śladu "kto i kiedy zaprosił" i nie dawało punktu zaczepu
--     dla ponowienia maila.
-- -----------------------------------------------------------------------------
ALTER TABLE public.organization_seats
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_invited_at timestamptz;

-- org_add_seat: identyczna logika i zabezpieczenia co 20260714130000 (auth,
-- role, format e-maila, limit pod blokadą wiersza, auto-claim istniejącego
-- konta) + stempel zaproszenia (invited_by / last_invited_at).
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;
  IF p_role NOT IN ('owner', 'member') THEN RAISE EXCEPTION 'orgs: invalid role'; END IF;
  IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'orgs: invalid email';
  END IF;

  SELECT * INTO v_org FROM public.member_organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;

  IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.is_org_owner(p_org)) THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  -- Tylko admin redakcji może mintować miejsce 'owner' (owner nie rozmnaża owners).
  IF p_role = 'owner' AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
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

REVOKE EXECUTE ON FUNCTION public.org_add_seat(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_add_seat(uuid, text, text) TO authenticated, service_role;

-- Ponowienie zaproszenia: właściciel/admin stempluje last_invited_at na
-- NIEODEBRANYM miejscu; zwraca e-mail i nazwę organizacji dla warstwy
-- mailowej. Miejsce już odebrane nie ma czego ponawiać.
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

  IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.is_org_owner(v_seat.org_id)) THEN
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

REVOKE EXECUTE ON FUNCTION public.org_touch_seat_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_touch_seat_invite(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3b) Site licence: warstwa członkostwa z flagą features.premium_content
--     odblokowuje artykuły płatne. To domyka produkt enterprise - miejsce w
--     organizacji (tier corporate/partner) czyta treści premium bez osobnych
--     subskrypcji per user; działa też dla członkostw indywidualnych (copy
--     warstwy 'member' od zawsze obiecuje "Wszystkie analizy premium").
--     Ten sam has_content_access zasila get_entity_content ORAZ metering
--     (uprawnieni nie zużywają licznika).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_content_access(
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode access_mode;
  v_plans uuid[];
  v_tenant uuid;
  v_uid uuid := auth.uid();
BEGIN
  SELECT mode, plan_ids, tenant_id INTO v_mode, v_plans, v_tenant
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF v_mode = 'members' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = v_uid AND p.tenant_id = v_tenant
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_purchases
     WHERE user_id = v_uid
       AND entity_type = _entity_type
       AND entity_id = _entity_id
       AND status = 'active'
  ) THEN
    RETURN true;
  END IF;

  IF array_length(v_plans, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_subscriptions
     WHERE user_id = v_uid
       AND plan_id = ANY (v_plans)
       AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  -- Site licence: aktywna warstwa (subskrypcja / nadanie / miejsce w
  -- organizacji) z features.premium_content = true otwiera treści płatne.
  IF public.user_has_tier_feature(v_uid, 'premium_content') THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

-- Flaga premium_content dla istniejących warstw z obietnicą "wszystkie analizy
-- premium" (member/pro/corporate/partner); nie nadpisuje ręcznych zmian admina
-- (dokłada klucz tylko tam, gdzie go nie ma).
UPDATE public.membership_tiers
   SET features = features || jsonb_build_object('premium_content', true)
 WHERE key IN ('member', 'pro', 'corporate', 'partner')
   AND NOT (features ? 'premium_content');

-- Seed dla NOWYCH tenantów: identyczny z 20260714130000, plus premium_content
-- w features warstw member/pro/corporate/partner (spójnie z powyższym UPDATE,
-- żeby świeży tenant nie dostawał warstw bez flagi site licence).
CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         v.benefits, v.features, v.is_default, v.sort_order
    FROM (VALUES
      ('reader', 0,
       'Konto bezpłatne', 'Free account',
       'Zapisywanie i personalizacja: zakładki, obserwowanie tematów i udział w dyskusjach.',
       'Saving and personalisation: bookmarks, topic follows and joining the discussion.',
       '[{"pl":"Zapisywanie materiałów i lista do przeczytania","en":"Saved items and a reading list"},
         {"pl":"Personalizacja: zainteresowania i obserwowane tematy","en":"Personalisation: interests and followed topics"},
         {"pl":"Udział w dyskusjach i ankietach","en":"Join discussions and polls"}]'::jsonb,
       '{}'::jsonb, true, 0),
      ('supporter', 5,
       'Wspierający', 'Supporter',
       'Darowizna wspiera niezależność instytutu; wspierający otrzymują dedykowane aktualizacje.',
       'A donation supports the institute''s independence; supporters receive dedicated updates.',
       '[{"pl":"Wszystko z konta bezpłatnego","en":"Everything in the free account"},
         {"pl":"Aktualizacje i podsumowania dla wspierających","en":"Supporter updates and briefings"},
         {"pl":"Status wspierającego przez 12 miesięcy od darowizny","en":"Supporter status for 12 months after a donation"}]'::jsonb,
       '{"supporter_updates": true}'::jsonb, false, 5),
      ('member', 10,
       'Członek indywidualny', 'Individual member',
       'Zamknięte treści i wydarzenia: pełny dostęp do analiz, briefingów i biblioteki materiałów.',
       'Closed content and events: full access to analyses, briefings and the members'' library.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},
         {"pl":"Wydarzenia i briefingi dla członków","en":"Member events and briefings"},
         {"pl":"Pierwszeństwo rejestracji na wydarzenia","en":"Priority event registration"},
         {"pl":"Biblioteka materiałów do pobrania","en":"Downloadable members'' library"},
         {"pl":"Nagrania z wydarzeń","en":"Event recordings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 10),
      ('pro', 20,
       'Członek ekspercki', 'Expert member',
       'Dla ekspertów i profesjonalistów public affairs: wszystko z członkostwa indywidualnego plus grupy robocze.',
       'For experts and public-affairs professionals: everything in individual membership plus working groups.',
       '[{"pl":"Wszystko z członkostwa indywidualnego","en":"Everything in individual membership"},
         {"pl":"Udział w grupach roboczych","en":"Participation in working groups"},
         {"pl":"Priorytet pytań w sesjach Q&A","en":"Priority in expert Q&A"},
         {"pl":"Zamknięte briefingi eksperckie","en":"Closed-door expert briefings"},
         {"pl":"Tracker legislacyjny z alertami","en":"Legislative tracker with alerts"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 20),
      ('corporate', 30,
       'Członek korporacyjny', 'Corporate member',
       'Dla instytucji i firm: wiele kont dla zespołu oraz briefingi i wydarzenia dla członków.',
       'For institutions and companies: multiple team seats plus member briefings and events.',
       '[{"pl":"Wiele kont dla zespołu (miejsca w organizacji)","en":"Multiple team accounts (organisation seats)"},
         {"pl":"Wszystko z członkostwa eksperckiego","en":"Everything in expert membership"},
         {"pl":"Briefingi i wydarzenia dla członków","en":"Member briefings and events"},
         {"pl":"Wspólna biblioteka materiałów","en":"Shared members'' library"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "premium_content": true}'::jsonb,
       false, 30),
      ('partner', 40,
       'Partner strategiczny', 'Strategic partner',
       'Relacja instytucjonalna: partnerstwo programowe, dedykowane briefingi i wspólne projekty.',
       'An institutional relationship: programme partnership, dedicated briefings and joint projects.',
       '[{"pl":"Wszystko z członkostwa korporacyjnego","en":"Everything in corporate membership"},
         {"pl":"Relacja instytucjonalna i wspólne projekty","en":"Institutional relationship and joint projects"},
         {"pl":"Dedykowane briefingi dla partnera","en":"Dedicated partner briefings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "strategic_partner": true, "premium_content": true}'::jsonb,
       false, 40)
    ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features, is_default, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;
