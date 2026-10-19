-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S1, 3/5): ZDARZENIA KUPONÓW I KAMPANII KUPONOWYCH,
-- PRZEJŚCIA STATUSU KAMPANII Z PANELU, STATUS `sent` WYŁĄCZNIE Z SERWERA.
--
-- DEFEKT
--   1. Kupony, kampanie kuponowe i realizacje nie emitują zdarzeń - hub
--      (konwersja, przychód z kuponów) i druga karta panelu widzą stan
--      z cache.
--   2. Panel ustawia kampanii kuponowej `status = 'sent'` sam, ZARAZ po
--      utworzeniu kampanii newslettera (P04) - zanim cokolwiek wyszło. Status
--      kłamał, a ponowne kliknięcie wysyłało drugi mail z kodem. Każdy
--      `authenticated` z rolą redakcji mógł też ręcznie przestawić status
--      i podpiętą kampanię newslettera zwykłym UPDATE z przeglądarki.
--
-- ZMIANA
--   A. `tg_b2b_coupons_emit` - `coupon.changed.v1`, agregat `coupon`, payload
--      `{coupon_id, op, source}` (bez kodu kuponu), `source` = `metadata.source`
--      albo `campaign`/`manual`. UPDATE emituje tylko przy zmianie kolumn
--      biznesowych (bez `updated_at`, `redemptions_count`, `metadata` - licznik
--      realizacji ma własne zdarzenie, a `metadata` niesie przypisanie kodu
--      odbiorcy przy wysyłce). D-S1-07: kupon KAMPANII emituje najwyżej RAZ
--      na transakcję i kampanię (`bulk_generate_coupons_for_campaign` wstawia
--      do 10 000 kodów pętlą - bez tego jedna generacja = 10 000 zdarzeń
--      w realtime każdej otwartej karty); zdarzenie zbiorcze niesie
--      dodatkowo `campaign_id`. Znacznik transakcyjny to JEDNO ustawienie
--      `hub.coupon_emit_campaigns` (lista identyfikatorów kampanii,
--      `set_config(..., true)` - znika z końcem transakcji). Nazwa per
--      kampania z myślnikami UUID jest w PG 16 niedozwolona (22023 „invalid
--      configuration parameter name"), stąd lista zamiast klucza
--      `hub.coupon_emit.<uuid>`. Kupon bez kampanii emituje per wiersz.
--   B. `tg_b2b_coupon_campaigns_emit` - `coupon_campaign.changed.v1`, agregat
--      `coupon_campaign`, `{campaign_id, status, op}`; UPDATE tylko przy
--      zmianie kolumn biznesowych (bez `updated_at`, `metadata`).
--   C. `tg_b2b_coupon_redemptions_emit` - AFTER INSERT, `coupon.redeemed.v1`,
--      agregat `coupon`, `aggregate_id = coupon_id`, `{coupon_id,
--      redemption_id, order_id}`, aktor = `user_id` realizacji.
--   D. RPC `admin_coupon_campaign_set_status(p_campaign_id, p_status,
--      p_expected_updated_at)` (panel; admin/editor, najemca z sesji = RLS
--      `b2b_coupon_campaigns_staff_all`). Przejścia panelu: `draft|generated|
--      sent -> archived`, `archived -> generated` (gdy są kody) albo
--      `archived -> draft` (gdy kodów brak). `p_status = 'sent'` -> 42501
--      `status_sent_server_only` dla każdej roli poza `service_role`
--      (serwer wysyłki ustawia `sent` dopiero po zakończonej wysyłce;
--      `service_role` przechodzi WYŁĄCZNIE `generated -> sent`). Ten sam
--      status = no-op. CAS: `p_expected_updated_at` różne od bieżącego (także
--      NULL) -> 40001 `stale_write`. Kody: 22023 `invalid_status`,
--      `invalid_transition:<z>-><do>`; P0002 `campaign_not_found` (także
--      kampania innego najemcy - nie zdradzamy jej istnienia).
--   E. D-S1-06, granty kolumnowe: `authenticated` traci tabelowe UPDATE na
--      `b2b_coupon_campaigns` i dostaje UPDATE na JAWNEJ liście kolumn - bez
--      `status`, `newsletter_campaign_id`, `id`, `tenant_id`, `created_at`,
--      `created_by`. Status zmienia wyłącznie RPC z pkt D (SECURITY DEFINER),
--      generacja kodów (`bulk_generate_coupons_for_campaign`, SECURITY
--      DEFINER - dalej ustawia `generated`) i serwer (`service_role`).
--      UWAGA: nowa kolumna tabeli NIE dostaje grantu sama - trzeba ją
--      dopisać do listy niżej (pgTAP `coupon_events_test` ma test
--      kompletności, który to wyłapie).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090500. Granty kolumnowe łamią STARY panel
-- kuponów (bezpośredni UPDATE `status`/`newsletter_campaign_id` z
-- przeglądarki) - wdrażać razem z kodem S1 (panel woła RPC z pkt D, a
-- kampanię newslettera tworzy `createCouponNewsletterCampaign`).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe sygnatury), DROP TRIGGER IF
-- EXISTS + CREATE TRIGGER, REVOKE/GRANT (także kolumnowe) bezstanowe. Zero DDL
-- kolumn i tabel.
-- DOWÓD: supabase/tests/coupon_events_test.sql (3 typy, payload bez kodu,
-- 50 kodów kampanii w jednej transakcji = 1 zdarzenie, samo `metadata` = 0,
-- przejścia RPC, `sent` tylko serwer, 40001, cudzy najemca, kompletność
-- grantów kolumnowych).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Kupony.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_b2b_coupons_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.b2b_coupons%ROWTYPE;
  v_marks text;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['updated_at', 'redemptions_count', 'metadata'])
       = (to_jsonb(OLD) - ARRAY['updated_at', 'redemptions_count', 'metadata']) THEN
    RETURN NULL;
  END IF;

  v_payload := jsonb_build_object(
    'coupon_id', v_row.id,
    'op', lower(TG_OP),
    'source', COALESCE(
      v_row.metadata ->> 'source',
      CASE WHEN v_row.campaign_id IS NOT NULL THEN 'campaign' ELSE 'manual' END)
  );

  IF v_row.campaign_id IS NOT NULL THEN
    -- Jedno zdarzenie na kampanię i transakcję (D-S1-07). Ustawienie lokalne
    -- transakcji: kolejna transakcja zaczyna od pustej listy.
    v_marks := COALESCE(current_setting('hub.coupon_emit_campaigns', true), '');
    IF strpos(v_marks, v_row.campaign_id::text) > 0 THEN
      RETURN NULL;
    END IF;
    PERFORM set_config('hub.coupon_emit_campaigns', v_marks || ',' || v_row.campaign_id::text, true);
    v_payload := v_payload || jsonb_build_object('campaign_id', v_row.campaign_id);
  END IF;

  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'coupon', v_row.id::text, 'coupon.changed.v1', v_payload
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    v_row.tenant_id, 'tg_b2b_coupons_emit', 'coupon.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_b2b_coupons_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_b2b_coupons_emit() IS
  'Hub S1: coupon.changed.v1 {coupon_id, op, source[, campaign_id]} bez kodu; kupon kampanii najwyżej raz na transakcję i kampanię (D-S1-07); updated_at/redemptions_count/metadata nie emitują.';

-- ----------------------------------------------------------------------------
-- B. Kampanie kuponowe.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_b2b_coupon_campaigns_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.b2b_coupon_campaigns%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['updated_at', 'metadata'])
       = (to_jsonb(OLD) - ARRAY['updated_at', 'metadata']) THEN
    RETURN NULL;
  END IF;
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'coupon_campaign', v_row.id::text, 'coupon_campaign.changed.v1',
    jsonb_build_object('campaign_id', v_row.id, 'status', v_row.status, 'op', lower(TG_OP))
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    v_row.tenant_id, 'tg_b2b_coupon_campaigns_emit', 'coupon_campaign.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_b2b_coupon_campaigns_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_b2b_coupon_campaigns_emit() IS
  'Hub S1: coupon_campaign.changed.v1 {campaign_id, status, op}; UPDATE tylko przy zmianie kolumn biznesowych (bez updated_at, metadata).';

-- ----------------------------------------------------------------------------
-- C. Realizacje kuponów.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_b2b_coupon_redemptions_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'coupon', NEW.coupon_id::text, 'coupon.redeemed.v1',
    jsonb_build_object('coupon_id', NEW.coupon_id, 'redemption_id', NEW.id, 'order_id', NEW.order_id),
    NEW.user_id
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_b2b_coupon_redemptions_emit', 'coupon.redeemed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_b2b_coupon_redemptions_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_b2b_coupon_redemptions_emit() IS
  'Hub S1: coupon.redeemed.v1 {coupon_id, redemption_id, order_id}, agregat coupon = coupon_id, aktor = user_id realizacji.';

-- ----------------------------------------------------------------------------
-- D. Przejścia statusu kampanii kuponowej.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_coupon_campaign_set_status(
  p_campaign_id uuid,
  p_status text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- `role` = rola ustawiona przez PostgREST/SET ROLE (SECURITY DEFINER jej
  -- nie zmienia) - konwencja repo dla ścieżek wyłącznie serwisowych.
  v_service boolean := current_setting('role', true) = 'service_role';
  v_tenant uuid;
  v_row public.b2b_coupon_campaigns%ROWTYPE;
  v_allowed boolean;
  v_updated_at timestamptz;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('draft', 'generated', 'sent', 'archived') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  -- `sent` znaczy „wysyłka się odbyła" - ustawia go wyłącznie serwer po
  -- zakończonej wysyłce, nigdy przycisk w panelu (defekt P04).
  IF p_status = 'sent' AND NOT v_service THEN
    RAISE EXCEPTION 'status_sent_server_only' USING ERRCODE = '42501';
  END IF;

  IF NOT v_service THEN
    IF NOT public.is_admin_or_editor() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    v_tenant := public.current_tenant_id();
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_row
    FROM public.b2b_coupon_campaigns c
   WHERE c.id = p_campaign_id
     AND (v_service OR c.tenant_id = v_tenant)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = '40001';
  END IF;
  IF v_row.status = p_status THEN
    RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'updated_at', v_row.updated_at);
  END IF;

  v_allowed := CASE
    WHEN v_service THEN v_row.status = 'generated' AND p_status = 'sent'
    WHEN p_status = 'archived' THEN v_row.status IN ('draft', 'generated', 'sent')
    -- Przywrócenie z archiwum wraca do stanu, który wynika z danych: są kody
    -- -> `generated`, nie ma -> `draft` (nigdy `sent` - patrz wyżej).
    WHEN v_row.status = 'archived' AND p_status = 'generated' THEN v_row.generated_count > 0
    WHEN v_row.status = 'archived' AND p_status = 'draft' THEN v_row.generated_count = 0
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid_transition:%->%', v_row.status, p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.b2b_coupon_campaigns
     SET status = p_status
   WHERE id = v_row.id
  RETURNING updated_at INTO v_updated_at;

  RETURN jsonb_build_object('id', v_row.id, 'status', p_status, 'updated_at', v_updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_coupon_campaign_set_status(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_coupon_campaign_set_status(uuid, text, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_coupon_campaign_set_status(uuid, text, timestamptz) IS
  'Hub S1: przejścia statusu kampanii kuponowej z panelu (archiwizacja/przywrócenie) z CAS na updated_at (40001); sent wyłącznie service_role (generated -> sent), inaczej 42501 status_sent_server_only.';

-- ----------------------------------------------------------------------------
-- Wyzwalacze i granty kolumnowe. `b2b_coupons` czyta każda kasa z kodem
-- rabatowym, a realizacje powstają przy płatności - blokada przy CREATE
-- TRIGGER/GRANT ma paść szybko (55P03), a nie kolejkować ruch kasy.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_b2b_coupons_emit ON public.b2b_coupons;
CREATE TRIGGER trg_b2b_coupons_emit
  AFTER INSERT OR UPDATE OR DELETE ON public.b2b_coupons
  FOR EACH ROW EXECUTE FUNCTION public.tg_b2b_coupons_emit();

DROP TRIGGER IF EXISTS trg_b2b_coupon_campaigns_emit ON public.b2b_coupon_campaigns;
CREATE TRIGGER trg_b2b_coupon_campaigns_emit
  AFTER INSERT OR UPDATE OR DELETE ON public.b2b_coupon_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_b2b_coupon_campaigns_emit();

DROP TRIGGER IF EXISTS trg_b2b_coupon_redemptions_emit ON public.b2b_coupon_redemptions;
CREATE TRIGGER trg_b2b_coupon_redemptions_emit
  AFTER INSERT ON public.b2b_coupon_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_b2b_coupon_redemptions_emit();

-- D-S1-06. Lista JAWNA, nie „wszystkie poza": nowa kolumna nie może dostać
-- prawa zapisu z przeglądarki przez przypadek - ale też bez wpisu tutaj panel
-- nie zapisze jej wcale (test kompletności w pgTAP przypomni o dopisaniu).
REVOKE UPDATE ON TABLE public.b2b_coupon_campaigns FROM authenticated;
GRANT UPDATE (
  name, description, prefix, code_length, code_count, generated_count,
  discount_kind, discount_percent, discount_cents, currency, max_redemptions_per_code,
  valid_from, valid_until, plan_ids, grants_tier_key, grants_duration_days,
  newsletter_segment, metadata, updated_at, event_ids, ticket_type_ids, package_ids,
  max_redemptions_per_user, audience
) ON public.b2b_coupon_campaigns TO authenticated;

RESET lock_timeout;
