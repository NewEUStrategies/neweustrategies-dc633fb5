-- ============================================================================
-- LINK PODAROWANY: DARCZYNCA MUSI MIEC DOSTEP DO TRESCI, KTORA DARUJE
-- (audyt billingowy SUB-06).
--
-- DEFEKT (najnowsze definicje: 20260806205328_8865e928-...sql):
--   * `create_gift_link` sprawdzal kwalifikowalnosc (`can_share_full_article()`
--     - przy domyslnym eligibility='registered' KAZDE konto najemcy) i to, czy
--     wpis jest za paywallem (mode members/paid), ale NIE to, czy tworca sam ma
--     do niego dostep (`has_content_access`).
--   * `redeem_gift_link` dla `auth.uid() = created_by` zwracal reason='owner'
--     i pelne body bez zadnego warunku.
--   Skutek: darmowe konto generowalo link do 10 platnych artykulow miesiecznie
--   i czytalo je samo jako "wlasciciel" - poza licznikiem meteringu - a do tego
--   rozdawalo po 5 otwarc na link.
--
-- ZMIANA:
--   1. `create_gift_link` - po bramce "wpis za paywallem" wymaga
--      `has_content_access('post', _post_id)` tworcy; inaczej
--      `gift_access_required`. To jest DOKLADNIE ta bramka, ktora wydaje body
--      (get_entity_content): dla 'paid' - zakup, plan, ranga albo premium_content
--      w najemcy tresci; dla 'members' - konto w najemcy (+ ranga przy
--      min_tier_rank). Odblokowanie "na licznik" (metering) NIE jest dostepem -
--      inaczej link mnozylby darmowy limit.
--   2. `redeem_gift_link` - galaz wlasciciela tylko z biezacym dostepem.
--      Tworca, ktory dostep stracil (koniec subskrypcji, zawieszone miejsce),
--      dostaje valid=false / reason='owner_no_access' BEZ body i BEZ zuzycia
--      slotu - nie "spada" do sciezki odbiorcy, bo to bylby znow prezent dla
--      samego siebie, tylko oplacony budzetem wlasnego linku. Odbiorcy linku
--      wydanego, gdy tworca mial dostep, czytaja dalej w granicach budzetu
--      (prezent zostal wydany uczciwie).
--   3. `gift_article_state` - popover nie obiecuje linku, ktorego serwer nie
--      wyda: brak dostepu tworcy = can_gift=false, requires_subscription=true
--      (ta sama faza UI co przy eligibility='subscribers').
--
--   4. DANE ZASTANE - `gift_links_revoke_without_creator_access()` (wolana raz
--      nizej): link wydany przed ta poprawka przez konto BEZ dostepu do
--      darowanej tresci byl dalej wazny dla KAZDEGO odbiorcy - w tym dla
--      samego tworcy po wylogowaniu (anon z nowym `_visitor_id` z localStorage
--      wpadal w sciezke odbiorcy i zuzywal slot). Zmiany 1-3 zamykaja wylacznie
--      galaz wlasciciela, wiec bez tego kroku luka trwalaby do konca TTL
--      linku - a przy link_ttl_days=0 i max_redemptions_per_link=0 na zawsze.
--      Krok cofa (revoked_at = now()) kazdy AKTYWNY link, ktorego tworca W
--      CHWILI MIGRACJI nie przechodzi `has_content_access` dla tego wpisu -
--      ta sama bramka, ktora od teraz pilnuje tworzenia. Odbiorca dostaje
--      reason='revoked' (bez body), takze ten, ktory juz zuzyl slot.
--
--      SWIADOMY KOMPROMIS (decyzja produktowa do PR): dane nie odrozniaja
--      darmowego konta, ktore wydalo link z luki, od bylego subskrybenta,
--      ktoremu dostep wygasl PO uczciwym wydaniu linku. Krok cofa oba -
--      odbiorcy linkow bylych subskrybentow traca prezent przed TTL (domyslnie
--      najwyzej 30 dni, wiec strata jest ograniczona). Po migracji regula
--      z punktu 2 wraca w pelni: link uczciwie wydany nie jest cofany, gdy
--      tworca pozniej traci dostep. Slad cofniecia: gift_events 'revoked'
--      z actor_id NULL (system, nie tworca).
--
-- DOMYSLNE eligibility='registered' ZOSTAJE: po tej zmianie "kazde konto" moze
-- darowac wylacznie to, co samo czyta - tresc 'members' (konto w najemcy ma do
-- niej dostep z definicji) albo 'paid' z wlasnym uprawnieniem. Przelaczenie na
-- 'subscribers' pozostaje decyzja redakcji, nie warunkiem bezpieczenstwa.
--
-- Sygnatury i typy zwracane bez zmian - CREATE OR REPLACE, granty powtorzone
-- jawnie (jak w 20260806205328). Nowa funkcja korekty danych - tylko
-- service_role.
-- IDEMPOTENTNA (krok danych dotyka wylacznie linkow bez revoked_at, drugi
-- przebieg nie ma czego cofnac). DOWOD: supabase/tests/gift_link_creator_access_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Stan popovera: uprawnienie liczy tez dostep do TEGO wpisu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_article_state(_post_id uuid)
RETURNS TABLE (
  enabled boolean,
  can_gift boolean,
  requires_auth boolean,
  requires_subscription boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  existing_code text,
  expires_at timestamptz,
  eligibility text,
  max_redemptions integer,
  redemption_count integer,
  redemptions_remaining integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_settings public.gift_article_settings%ROWTYPE;
  v_enabled boolean := true;
  v_limit integer := 10;
  v_cap integer := 5;
  v_eligibility text := public.gift_share_eligibility();
  v_used integer := 0;
  v_link public.post_gift_links%ROWTYPE;
BEGIN
  SELECT * INTO v_settings FROM public.gift_article_settings s WHERE s.tenant_id = v_tenant;
  IF FOUND THEN
    v_enabled := v_settings.enabled;
    v_limit := v_settings.monthly_limit;
    v_cap := v_settings.max_redemptions_per_link;
  END IF;
  IF NOT v_enabled THEN
    RETURN QUERY SELECT false, false, false, false, 0, 0, 0,
      NULL::text, NULL::timestamptz, v_eligibility, 0, 0, 0;
    RETURN;
  END IF;
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT true, false, true, false, 0, v_limit, 0,
      NULL::text, NULL::timestamptz, v_eligibility, v_cap, 0, v_cap;
    RETURN;
  END IF;
  IF NOT public.can_share_full_article() THEN
    RETURN QUERY SELECT
      true,
      false,
      v_eligibility <> 'subscribers',
      v_eligibility = 'subscribers',
      0, v_limit, 0, NULL::text, NULL::timestamptz, v_eligibility, v_cap, 0, v_cap;
    RETURN;
  END IF;
  -- Dar wymaga wlasnego dostepu do wpisu (lustro bramki create_gift_link).
  -- Faza "requiresSubscription": droga wyjscia to plan, nie logowanie.
  IF NOT public.has_content_access('post'::public.access_entity_type, _post_id) THEN
    RETURN QUERY SELECT true, false, false, true, 0, v_limit, 0,
      NULL::text, NULL::timestamptz, v_eligibility, v_cap, 0, v_cap;
    RETURN;
  END IF;
  SELECT count(DISTINCT l.post_id)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = (date_trunc('month', now()))::date;
  SELECT * INTO v_link
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.post_id = _post_id
     AND l.created_by = v_uid
     AND l.revoked_at IS NULL
     AND (l.expires_at IS NULL OR l.expires_at > now());
  RETURN QUERY SELECT
    true,
    true,
    false,
    false,
    v_used,
    v_limit,
    CASE WHEN v_limit > 0 THEN GREATEST(v_limit - v_used, 0) ELSE NULL::integer END,
    v_link.code,
    v_link.expires_at,
    v_eligibility,
    COALESCE(v_link.max_redemptions, v_cap),
    COALESCE(v_link.redemption_count, 0),
    CASE
      WHEN COALESCE(v_link.max_redemptions, v_cap) > 0
        THEN GREATEST(COALESCE(v_link.max_redemptions, v_cap) - COALESCE(v_link.redemption_count, 0), 0)
      ELSE NULL::integer
    END;
END $$;

REVOKE ALL ON FUNCTION public.gift_article_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_article_state(uuid) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) Utworzenie linku: tworca musi sam przechodzic bramke tresci.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_gift_link(_post_id uuid)
RETURNS TABLE (
  code text,
  expires_at timestamptz,
  used integer,
  monthly_limit integer,
  remaining integer,
  max_redemptions integer,
  redemption_count integer,
  redemptions_remaining integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_settings public.gift_article_settings%ROWTYPE;
  v_enabled boolean := true;
  v_limit integer := 10;
  v_ttl integer := 30;
  v_cap integer := 5;
  v_used integer := 0;
  v_carry integer := 0;
  v_existing public.post_gift_links%ROWTYPE;
  v_new public.post_gift_links%ROWTYPE;
  v_period date := (date_trunc('month', now()))::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'gift_auth_required';
  END IF;
  SELECT * INTO v_settings FROM public.gift_article_settings s WHERE s.tenant_id = v_tenant;
  IF FOUND THEN
    v_enabled := v_settings.enabled;
    v_limit := v_settings.monthly_limit;
    v_ttl := v_settings.link_ttl_days;
    v_cap := v_settings.max_redemptions_per_link;
  END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION 'gift_disabled';
  END IF;
  IF NOT public.can_share_full_article() THEN
    IF public.gift_share_eligibility() = 'subscribers' THEN
      RAISE EXCEPTION 'gift_subscription_required';
    END IF;
    RAISE EXCEPTION 'gift_auth_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = _post_id
       AND p.tenant_id = v_tenant
       AND p.status = 'published'
       AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'gift_post_not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.content_access ca
     WHERE ca.entity_type = 'post'
       AND ca.entity_id = _post_id
       AND ca.mode IN ('members', 'paid')
  ) THEN
    RAISE EXCEPTION 'gift_post_not_gated';
  END IF;
  -- Darowac mozna tylko to, co sie samemu czyta: ta sama bramka, ktora wydaje
  -- body (najemca i warstwa tresci, zakup, plan). Bez tego darmowe konto
  -- tworzylo linki do platnych tresci i czytalo je przez galaz wlasciciela.
  IF NOT public.has_content_access('post'::public.access_entity_type, _post_id) THEN
    RAISE EXCEPTION 'gift_access_required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gift:' || v_uid::text));
  SELECT * INTO v_existing
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.post_id = _post_id
     AND l.created_by = v_uid
     AND l.revoked_at IS NULL;
  SELECT count(DISTINCT l.post_id)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = v_period;
  IF v_existing.id IS NOT NULL
     AND (v_existing.expires_at IS NULL OR v_existing.expires_at > now()) THEN
    RETURN QUERY SELECT
      v_existing.code,
      v_existing.expires_at,
      v_used,
      v_limit,
      CASE WHEN v_limit > 0 THEN GREATEST(v_limit - v_used, 0) ELSE NULL::integer END,
      v_existing.max_redemptions,
      v_existing.redemption_count,
      CASE
        WHEN v_existing.max_redemptions > 0
          THEN GREATEST(v_existing.max_redemptions - v_existing.redemption_count, 0)
        ELSE NULL::integer
      END;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.post_gift_links SET revoked_at = now() WHERE id = v_existing.id;
  END IF;
  IF v_limit > 0
     AND v_used >= v_limit
     AND NOT EXISTS (
       SELECT 1 FROM public.post_gift_links l
        WHERE l.tenant_id = v_tenant
          AND l.created_by = v_uid
          AND l.post_id = _post_id
          AND l.period_month = v_period
     ) THEN
    RAISE EXCEPTION 'gift_limit_reached';
  END IF;
  SELECT COALESCE(MAX(l.redemption_count), 0) INTO v_carry
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.post_id = _post_id
     AND l.period_month = v_period;
  INSERT INTO public.post_gift_links (
    tenant_id, post_id, created_by, expires_at, max_redemptions, redemption_count
  )
  VALUES (
    v_tenant,
    _post_id,
    v_uid,
    CASE WHEN v_ttl > 0 THEN now() + make_interval(days => v_ttl) END,
    GREATEST(COALESCE(v_cap, 5), 0),
    v_carry
  )
  RETURNING * INTO v_new;
  SELECT count(DISTINCT l.post_id)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = v_period;
  RETURN QUERY SELECT
    v_new.code,
    v_new.expires_at,
    v_used,
    v_limit,
    CASE WHEN v_limit > 0 THEN GREATEST(v_limit - v_used, 0) ELSE NULL::integer END,
    v_new.max_redemptions,
    v_new.redemption_count,
    CASE
      WHEN v_new.max_redemptions > 0
        THEN GREATEST(v_new.max_redemptions - v_new.redemption_count, 0)
      ELSE NULL::integer
    END;
END $$;

REVOKE ALL ON FUNCTION public.create_gift_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_gift_link(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Realizacja linku: galaz wlasciciela tylko z biezacym dostepem.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_gift_link(
  _post_id uuid,
  _code text,
  _visitor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  valid boolean,
  reason text,
  redemption_count integer,
  max_redemptions integer,
  redemptions_remaining integer,
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
  v_link public.post_gift_links%ROWTYPE;
  v_cap integer := 0;
  v_count integer := 0;
  v_key text;
  v_reason text := 'ok';
  v_seen boolean := false;
BEGIN
  SELECT * INTO v_link
    FROM public.post_gift_links l
   WHERE l.code = _code
     AND l.tenant_id = v_tenant
     AND l.post_id = _post_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid'::text, 0, 0, 0,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  v_cap := GREATEST(COALESCE(v_link.max_redemptions, 0), 0);
  v_count := COALESCE(v_link.redemption_count, 0);
  IF EXISTS (
    SELECT 1 FROM public.content_access ca
     WHERE ca.entity_type = 'post'
       AND ca.entity_id = _post_id
       AND ca.mode = 'password'
  ) THEN
    RETURN QUERY SELECT false, 'invalid'::text, v_count, v_cap, 0,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked'::text, v_count, v_cap, 0,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'expired'::text, v_count, v_cap, 0,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  IF v_uid IS NOT NULL AND v_uid = v_link.created_by THEN
    -- Wlasciciel czyta przez wlasny link WYLACZNIE z biezacym dostepem do
    -- tresci. Bez niego: odmowa bez body i bez slotu - zadnego "spadku" do
    -- sciezki odbiorcy, ktora bylaby prezentem dla samego siebie.
    IF NOT public.has_content_access('post'::public.access_entity_type, _post_id) THEN
      RETURN QUERY SELECT false, 'owner_no_access'::text, v_count, v_cap,
        CASE WHEN v_cap > 0 THEN GREATEST(v_cap - v_count, 0) ELSE NULL::integer END,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    v_reason := 'owner';
  ELSIF public.has_content_access('post'::public.access_entity_type, _post_id) THEN
    v_reason := 'entitled';
  ELSE
    v_key := CASE
      WHEN v_uid IS NOT NULL THEN 'u:' || v_uid::text
      WHEN _visitor_id IS NOT NULL THEN 'v:' || _visitor_id::text
      ELSE NULL
    END;
    PERFORM pg_advisory_xact_lock(hashtext('gift:redeem:' || v_link.id::text));
    IF v_key IS NOT NULL THEN
      UPDATE public.post_gift_redemptions r
         SET last_seen_at = now(), hits = r.hits + 1
       WHERE r.link_id = v_link.id
         AND r.recipient_key = v_key;
      v_seen := FOUND;
    END IF;
    IF NOT v_seen THEN
      SELECT l.redemption_count INTO v_count
        FROM public.post_gift_links l
       WHERE l.id = v_link.id
         FOR UPDATE;
      IF v_cap > 0 AND v_count >= v_cap THEN
        INSERT INTO public.gift_events (
          tenant_id, link_id, post_id, event_type, actor_id, code, metadata
        )
        VALUES (
          v_tenant, v_link.id, _post_id, 'exhausted', v_uid, v_link.code,
          jsonb_build_object('cap', v_cap, 'count', v_count)
        );
        RETURN QUERY SELECT false, 'exhausted'::text, v_count, v_cap, 0,
          NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
        RETURN;
      END IF;
      IF v_key IS NOT NULL THEN
        INSERT INTO public.post_gift_redemptions (
          tenant_id, link_id, post_id, recipient_key, recipient_id
        )
        VALUES (v_tenant, v_link.id, _post_id, v_key, v_uid)
        ON CONFLICT (link_id, recipient_key) DO NOTHING;
      END IF;
      UPDATE public.post_gift_links l
         SET redemption_count = l.redemption_count + 1,
             last_redeemed_at = now()
       WHERE l.id = v_link.id
      RETURNING l.redemption_count INTO v_count;
    ELSE
      SELECT l.redemption_count INTO v_count
        FROM public.post_gift_links l
       WHERE l.id = v_link.id;
    END IF;
  END IF;
  RETURN QUERY
    SELECT
      true,
      v_reason,
      v_count,
      v_cap,
      CASE WHEN v_cap > 0 THEN GREATEST(v_cap - v_count, 0) ELSE NULL::integer END,
      p.content_pl,
      p.content_en,
      p.builder_data,
      p.blocks_data
    FROM public.posts p
   WHERE p.id = _post_id
     AND p.tenant_id = v_tenant
     AND p.status = 'published'
     AND p.deleted_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.redeem_gift_link(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_gift_link(uuid, text, uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.gift_article_state(uuid) IS
  'Stan popovera udostepniania: enabled / uprawnienie (eligibility ORAZ wlasny dostep '
  'do wpisu - has_content_access) / limit miesieczny (liczony po ARTYKULACH) + '
  'istniejacy link wraz z budzetem klikniec. Czysty odczyt - nic nie tworzy i nie konsumuje.';

COMMENT ON FUNCTION public.create_gift_link(uuid) IS
  'Get-or-create linku do pelnego artykulu. Wymaga can_share_full_article(), tresci ZA '
  'PAYWALLEM (mode members/paid) i wlasnego dostepu tworcy (has_content_access). Zamraza '
  'budzet klikniec na linku i przenosi zuzycie przy rotacji. Bledy: gift_auth_required / '
  'gift_disabled / gift_subscription_required / gift_post_not_found / gift_post_not_gated / '
  'gift_access_required / gift_limit_reached.';

COMMENT ON FUNCTION public.redeem_gift_link(uuid, text, uuid) IS
  'Odblokowanie artykulu linkiem. Zwraca reason: ok | owner | owner_no_access | entitled | '
  'invalid | revoked | expired | exhausted. Slot budzetu zuzywa wylacznie NOWY odbiorca '
  '(dedup po link + tozsamosc: konto albo uuid goscia); darczynca z biezacym dostepem i '
  'czytelnik z wlasnym uprawnieniem nie konsumuja budzetu, darczynca bez dostepu nie '
  'dostaje body (owner_no_access).';

-- ----------------------------------------------------------------------------
-- 4) Dane zastane: cofniecie linkow, ktorych tworca nie ma dostepu do tresci.
--
-- `has_content_access` czyta tozsamosc z auth.uid() (claims JWT), a najemce
-- z reguly TRESCI (content_access.tenant_id), nie z hosta - wiec werdykt
-- "czy tworca czyta ten wpis" liczymy, podstawiajac tworce jako podmiot JWT
-- na czas JEDNEGO sprawdzenia. auth.uid() czyta `request.jwt.claims`, a
-- starszy klucz `request.jwt.claim.sub` ma pierwszenstwo - podstawiamy go
-- wiec WYLACZNIE wtedy, gdy wolajacy go ustawil (pusty napis w tym kluczu
-- zaslanialby claims w czesci implementacji auth.uid()). Oba sa
-- PRZYWRACANE przed jakimkolwiek zapisem: trigger audytu
-- (gift_links_audit_tg) zapisuje actor_id = auth.uid(), a cofniecie robi
-- system, nie tworca - i tozsamosc wolajacego nie moze "przeciec" do reszty
-- jego transakcji. Blad w petli przerywa cala funkcje (migracja nie
-- przechodzi polowicznie), a wycofanie transakcji cofa tez set_config.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_links_revoke_without_creator_access()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claims text := current_setting('request.jwt.claims', true);
  v_claim_sub text := current_setting('request.jwt.claim.sub', true);
  v_link record;
  v_doomed uuid[] := ARRAY[]::uuid[];
  v_revoked integer := 0;
BEGIN
  FOR v_link IN
    SELECT l.id, l.created_by, l.post_id
      FROM public.post_gift_links l
     WHERE l.revoked_at IS NULL
       AND (l.expires_at IS NULL OR l.expires_at > now())
  LOOP
    IF COALESCE(v_claim_sub, '') <> '' THEN
      PERFORM set_config('request.jwt.claim.sub', v_link.created_by::text, true);
    END IF;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_link.created_by, 'role', 'authenticated')::text, true);
    IF NOT public.has_content_access('post'::public.access_entity_type, v_link.post_id) THEN
      v_doomed := v_doomed || v_link.id;
    END IF;
  END LOOP;

  -- Tozsamosc wolajacego wraca PRZED zapisem (actor_id audytu = system).
  IF COALESCE(v_claim_sub, '') <> '' THEN
    PERFORM set_config('request.jwt.claim.sub', v_claim_sub, true);
  END IF;
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);

  UPDATE public.post_gift_links l
     SET revoked_at = now()
   WHERE l.id = ANY (v_doomed)
     AND l.revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;
  RETURN v_revoked;
END $$;

REVOKE ALL ON FUNCTION public.gift_links_revoke_without_creator_access()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_links_revoke_without_creator_access() TO service_role;

COMMENT ON FUNCTION public.gift_links_revoke_without_creator_access() IS
  'Jednorazowa korekta danych (audyt SUB-06): cofa aktywne linki podarunkowe, ktorych tworca '
  'w chwili wywolania nie ma has_content_access do darowanego wpisu (linki wydane przed '
  'bramka tworzenia). Swiadomie obejmuje tez bylych subskrybentow z wygaslym dostepem - '
  'dane ich nie odrozniaja. Przywraca tozsamosc wolajacego przed zapisem; zwraca liczbe '
  'cofnietych linkow. Idempotentna. Tylko service_role.';

DO $$
DECLARE
  v_revoked integer;
BEGIN
  v_revoked := public.gift_links_revoke_without_creator_access();
  RAISE NOTICE 'gift links: revoked % link(s) whose creator lacks access to the gifted post', v_revoked;
END $$;
