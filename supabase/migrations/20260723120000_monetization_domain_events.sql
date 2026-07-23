-- ============================================================================
-- SPÓJNOŚĆ MIĘDZY MODUŁAMI: monetyzacja wchodzi na szynę zdarzeń domenowych.
--
-- Dotychczas katalog cennika (warstwy/plany/segmenty/FAQ) i cykl życia
-- uprawnień (subskrypcje/nadania/organizacje/darowizny) zmieniały się "po
-- cichu": panel admina odświeżał wyłącznie własną kartę przeglądarki, webhook
-- Stripe zapisywał uprawnienia bez żadnego sygnału dla frontendu, a workflowy
-- i router integracji (HubSpot/Merydian/webhooki) w ogóle nie widziały tych
-- zdarzeń. Ta migracja domyka doktrynę z ARCHITECTURE.md §5: KAŻDY moduł
-- komunikuje zmiany przez domain_events.
--
-- Zakres:
--   1) emit_domain_event dostaje parametr p_actor_id - emitery wołane przez
--      service_role (webhook Stripe) przypisują zdarzenie właścicielowi
--      subskrypcji, więc kupujący dostaje inwalidację cache w czasie
--      rzeczywistym przez istniejącą politykę RLS "actor czyta swoje".
--   2) Emitery AFTER na: membership_tiers, access_plans, pricing_audiences,
--      pricing_faq_items (katalog) oraz user_subscriptions, membership_grants,
--      member_organizations, organization_seats, donations (cykl życia).
--   3) Spójność mostka plan->warstwa: access_plans.tier_key jest walidowany
--      triggerem (nieznany klucz = wyjątek), a zmiana/usunięcie klucza warstwy
--      kaskaduje/odpina plany - literówka nie może już po cichu odebrać
--      uprawnień (current_membership_tier źródło 1).
--
-- Wszystko idempotentne; emitery nigdy nie blokują zapisu źródłowego.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) emit_domain_event z jawnym aktorem. Stary 5-argumentowy wariant znika
--    (dwa przeciążenia = niejednoznaczność); wywołania 5-argumentowe istniejących
--    emiterów rozwiązują się na nowy wariant przez DEFAULT NULL -> auth.uid().
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_aggregate_type IS NULL OR p_aggregate_id IS NULL
     OR p_event_type IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.domain_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload,
    correlation_id, actor_id
  ) VALUES (
    p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    public.request_correlation_id(), COALESCE(p_actor_id, auth.uid())
  )
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emit_domain_event(uuid, text, text, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_domain_event(uuid, text, text, text, jsonb, uuid)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 2a) KATALOG CENNIKA: warstwy, plany, segmenty, FAQ. Edycje panelu są
--     niskowolumenowe, więc emitujemy każdą zmianę (jak crm_leads) - inne
--     karty staffu i publiczna strona /pricing odświeżają się bez F5.
--     Jeden typ zdarzenia per agregat (payload niesie op) - katalog typów
--     pozostaje zwarty, a konsumenci i tak inwalidują te same klucze.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_membership_tiers_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'membership_tier', v_row.id::text, 'membership_tier.changed.v1',
    jsonb_build_object(
      'op', lower(TG_OP), 'key', v_row.key, 'rank', v_row.rank,
      'active', v_row.active, 'is_default', v_row.is_default
    )
  );
  -- AFTER trigger: wynik ignorowany; NULL jest bezpieczny dla I/U/D.
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_tiers_emit_events ON public.membership_tiers;
CREATE TRIGGER trg_membership_tiers_emit_events
  AFTER INSERT OR UPDATE OR DELETE ON public.membership_tiers
  FOR EACH ROW EXECUTE FUNCTION public.tg_membership_tiers_emit_events();

CREATE OR REPLACE FUNCTION public.tg_access_plans_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'access_plan', v_row.id::text, 'access_plan.changed.v1',
    jsonb_build_object(
      'op', lower(TG_OP), 'tier_key', v_row.tier_key, 'interval', v_row.interval::text,
      'active', v_row.active, 'price_cents', v_row.price_cents, 'currency', v_row.currency
    )
  );
  -- AFTER trigger: wynik ignorowany; NULL jest bezpieczny dla I/U/D.
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_plans_emit_events ON public.access_plans;
CREATE TRIGGER trg_access_plans_emit_events
  AFTER INSERT OR UPDATE OR DELETE ON public.access_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_access_plans_emit_events();

CREATE OR REPLACE FUNCTION public.tg_pricing_audiences_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'pricing_audience', v_row.id::text, 'pricing_audience.changed.v1',
    jsonb_build_object('op', lower(TG_OP), 'key', v_row.key, 'active', v_row.active)
  );
  -- AFTER trigger: wynik ignorowany; NULL jest bezpieczny dla I/U/D.
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pricing_audiences_emit_events ON public.pricing_audiences;
CREATE TRIGGER trg_pricing_audiences_emit_events
  AFTER INSERT OR UPDATE OR DELETE ON public.pricing_audiences
  FOR EACH ROW EXECUTE FUNCTION public.tg_pricing_audiences_emit_events();

CREATE OR REPLACE FUNCTION public.tg_pricing_faq_items_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'pricing_faq', v_row.id::text, 'pricing_faq.changed.v1',
    jsonb_build_object('op', lower(TG_OP), 'audience_key', v_row.audience_key)
  );
  -- AFTER trigger: wynik ignorowany; NULL jest bezpieczny dla I/U/D.
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pricing_faq_items_emit_events ON public.pricing_faq_items;
CREATE TRIGGER trg_pricing_faq_items_emit_events
  AFTER INSERT OR UPDATE OR DELETE ON public.pricing_faq_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_pricing_faq_items_emit_events();

-- ----------------------------------------------------------------------------
-- 2b) CYKL ŻYCIA UPRAWNIEŃ. Aktor = właściciel wiersza (NIE auth.uid()):
--     zapisy robi service_role (webhook), a polityka RLS
--     domain_events_actor_select daje właścicielowi natychmiastową
--     inwalidację cache (warstwa, paywall, profil) w otwartej karcie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_user_subscriptions_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier_key text;
BEGIN
  SELECT ap.tier_key INTO v_tier_key
    FROM public.access_plans ap WHERE ap.id = NEW.plan_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'subscription', NEW.id::text, 'subscription.started.v1',
      jsonb_build_object(
        'user_id', NEW.user_id, 'plan_id', NEW.plan_id, 'tier_key', v_tier_key,
        'status', NEW.status::text, 'current_period_end', NEW.current_period_end
      ),
      NEW.user_id
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'subscription', NEW.id::text, 'subscription.status_changed.v1',
        jsonb_build_object(
          'user_id', NEW.user_id, 'plan_id', NEW.plan_id, 'tier_key', v_tier_key,
          'old_status', OLD.status::text, 'new_status', NEW.status::text
        ),
        NEW.user_id
      );
    ELSIF NEW.canceled_at IS DISTINCT FROM OLD.canceled_at
       OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end THEN
      -- Cancel-at-period-end / wznowienie / przedłużenie okresu (renewal).
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'subscription', NEW.id::text, 'subscription.updated.v1',
        jsonb_build_object(
          'user_id', NEW.user_id, 'plan_id', NEW.plan_id, 'tier_key', v_tier_key,
          'status', NEW.status::text,
          'cancel_scheduled', NEW.canceled_at IS NOT NULL,
          'current_period_end', NEW.current_period_end
        ),
        NEW.user_id
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_subscriptions_emit_events ON public.user_subscriptions;
CREATE TRIGGER trg_user_subscriptions_emit_events
  AFTER INSERT OR UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_subscriptions_emit_events();

CREATE OR REPLACE FUNCTION public.tg_membership_grants_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'membership_grant', NEW.id::text, 'membership_grant.granted.v1',
      jsonb_build_object(
        'op', 'granted', 'user_id', NEW.user_id, 'tier_key', NEW.tier_key,
        'source', NEW.source, 'expires_at', NEW.expires_at
      ),
      NEW.user_id
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'membership_grant', NEW.id::text, 'membership_grant.revoked.v1',
        jsonb_build_object('user_id', NEW.user_id, 'tier_key', NEW.tier_key, 'source', NEW.source),
        NEW.user_id
      );
    ELSIF NEW.revoked_at IS NULL AND (
      NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR NEW.tier_key IS DISTINCT FROM OLD.tier_key
      OR OLD.revoked_at IS NOT NULL
    ) THEN
      -- Przedłużenie (np. kolejna darowizna) albo przywrócenie nadania.
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'membership_grant', NEW.id::text, 'membership_grant.granted.v1',
        jsonb_build_object(
          'op', 'extended', 'user_id', NEW.user_id, 'tier_key', NEW.tier_key,
          'source', NEW.source, 'expires_at', NEW.expires_at
        ),
        NEW.user_id
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_grants_emit_events ON public.membership_grants;
CREATE TRIGGER trg_membership_grants_emit_events
  AFTER INSERT OR UPDATE ON public.membership_grants
  FOR EACH ROW EXECUTE FUNCTION public.tg_membership_grants_emit_events();

CREATE OR REPLACE FUNCTION public.tg_member_organizations_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'organization', NEW.id::text, 'organization.updated.v1',
    jsonb_build_object(
      'op', lower(TG_OP), 'name', NEW.name, 'tier_key', NEW.tier_key,
      'status', NEW.status, 'seats_limit', NEW.seats_limit
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_organizations_emit_events ON public.member_organizations;
CREATE TRIGGER trg_member_organizations_emit_events
  AFTER INSERT OR UPDATE ON public.member_organizations
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_organizations_emit_events();

CREATE OR REPLACE FUNCTION public.tg_organization_seats_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  -- Aktor: przy odbiorze miejsca właściciel wiersza (user_id), przy
  -- zaproszeniu/usunięciu zapraszający (auth.uid() przez fallback emitera).
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'org_seat', v_row.id::text, 'org_seat.changed.v1',
    jsonb_build_object(
      'op', lower(TG_OP), 'org_id', v_row.org_id, 'role', v_row.role,
      'claimed', v_row.claimed_at IS NOT NULL
    ),
    v_row.user_id
  );
  -- AFTER trigger: wynik ignorowany; NULL jest bezpieczny dla I/U/D.
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_seats_emit_events ON public.organization_seats;
CREATE TRIGGER trg_organization_seats_emit_events
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_seats
  FOR EACH ROW EXECUTE FUNCTION public.tg_organization_seats_emit_events();

-- Darowizny: payload bez e-maila darczyńcy (prywatność); status wspierającego
-- i tak propaguje osobne zdarzenie membership_grant.* z triggera
-- donations_grant_supporter.
CREATE OR REPLACE FUNCTION public.tg_donations_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status = 'paid')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid') THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'donation', NEW.id::text, 'donation.recorded.v1',
      jsonb_build_object(
        'user_id', NEW.user_id, 'amount_cents', NEW.amount_cents, 'currency', NEW.currency
      ),
      NEW.user_id
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM 'refunded' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'donation', NEW.id::text, 'donation.refunded.v1',
      jsonb_build_object(
        'user_id', NEW.user_id, 'amount_cents', NEW.amount_cents, 'currency', NEW.currency
      ),
      NEW.user_id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_donations_emit_events ON public.donations;
CREATE TRIGGER trg_donations_emit_events
  AFTER INSERT OR UPDATE ON public.donations
  FOR EACH ROW EXECUTE FUNCTION public.tg_donations_emit_events();

-- ----------------------------------------------------------------------------
-- 3) Spójność mostka plan -> warstwa. access_plans.tier_key to tekst (bez FK);
--    literówka lub skasowana warstwa oznaczały cichą utratę uprawnień
--    (current_membership_tier źródło 1 nie znajdowało warstwy). Triggery
--    zamiast FK: precyzyjny komunikat błędu dla panelu, kaskada zmiany klucza
--    i odpięcie planów po usunięciu warstwy (plan zostaje widoczny jako
--    "bez warstwy" w sekcji planów osieroconych - nic nie znika ze strony).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_access_plans_validate_tier_key()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tier_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membership_tiers mt
     WHERE mt.tenant_id = NEW.tenant_id AND mt.key = NEW.tier_key
  ) THEN
    RAISE EXCEPTION 'unknown_tier_key: %', NEW.tier_key USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_plans_validate_tier_key ON public.access_plans;
CREATE TRIGGER trg_access_plans_validate_tier_key
  BEFORE INSERT OR UPDATE OF tier_key, tenant_id ON public.access_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_access_plans_validate_tier_key();

CREATE OR REPLACE FUNCTION public.tg_membership_tiers_cascade_key()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN
    UPDATE public.access_plans
       SET tier_key = NEW.key
     WHERE tenant_id = OLD.tenant_id AND tier_key = OLD.key;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.access_plans
       SET tier_key = NULL
     WHERE tenant_id = OLD.tenant_id AND tier_key = OLD.key;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_tiers_cascade_key ON public.membership_tiers;
CREATE TRIGGER trg_membership_tiers_cascade_key
  AFTER UPDATE OF key OR DELETE ON public.membership_tiers
  FOR EACH ROW EXECUTE FUNCTION public.tg_membership_tiers_cascade_key();

-- Sprzątanie zastanych rozjazdów: plan wskazujący nieistniejącą warstwę
-- traktujemy jak plan bez warstwy (dokładnie tak widzi go RPC uprawnień).
UPDATE public.access_plans ap
   SET tier_key = NULL
 WHERE ap.tier_key IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key
   );
