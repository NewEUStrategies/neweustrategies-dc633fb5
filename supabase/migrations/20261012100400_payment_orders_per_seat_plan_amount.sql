-- Kwota zamówienia planu rozliczanego za miejsce (audyt PAY-01).
--
-- Obie kasy liczą teraz kwotę zamówienia z WIERSZA PLANU razem z liczbą
-- miejsc (`planCheckoutPricing`: Zespół = stawka za miejsce x miejsca, z progiem
-- wolumenowym). Strażnik wstawienia z 20260730175806 porównywał kwotę z ceną
-- JEDNEGO miejsca, więc zamówienie na dwa miejsca kończyło się wyjątkiem
-- „amount_cents exceeds plan price" - błąd serwera zamiast wyceny.
--
-- Pułap dla planu za miejsce to cena miejsca x 100, czyli górny limit miejsc
-- w jednym zamówieniu (`MAX_PLAN_SEATS` w planPricing.ts, ten sam co limit
-- pozycji sesji). Stawka progu wolumenowego jest zawsze niższa od podstawowej,
-- więc ten pułap obejmuje także zamówienia po progu. Rozliczanie za miejsce ma
-- w katalogu wyłącznie warstwa `team` (`BILLING_CATALOG`, `perSeat: true`).
-- Pozostałe plany zachowują dotychczasowy pułap: cena planu.
--
-- Ciało funkcji poza tym jednym warunkiem jest identyczne z 20260730175806.
CREATE OR REPLACE FUNCTION public.payment_orders_secure_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  plan_row public.access_plans%ROWTYPE;
  plan_cap bigint;
BEGIN
  -- Service role (webhooki, narzędzia serwerowe) omija walidację.
  IF current_setting('role', true) = 'service_role'
     OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Wymuszenie bezpiecznego stanu początkowego dla zamówień użytkownika.
  NEW.status := 'pending';
  NEW.provider_session_id := NULL;
  NEW.provider_intent_id := NULL;
  NEW.invoice_url := NULL;
  NEW.paid_at := NULL;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'payment_orders.user_id must match auth.uid()';
  END IF;

  -- Waluta: kod ISO 4217, znormalizowany do wielkich liter.
  NEW.currency := upper(coalesce(NEW.currency, ''));
  IF NEW.currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'payment_orders.currency must be a 3-letter ISO code';
  END IF;

  -- Kwota: nieujemna i w rozsądnym zakresie (ochrona przed śmieciowymi rekordami).
  IF NEW.amount_cents IS NULL OR NEW.amount_cents < 0 OR NEW.amount_cents > 100000000 THEN
    RAISE EXCEPTION 'payment_orders.amount_cents out of allowed range';
  END IF;

  -- Plan musi należeć do tenanta wywołującego i być aktywny.
  IF NEW.plan_id IS NOT NULL THEN
    SELECT * INTO plan_row
      FROM public.access_plans
     WHERE id = NEW.plan_id
       AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment_orders.plan_id does not belong to this tenant';
    END IF;
    IF NOT plan_row.active THEN
      RAISE EXCEPTION 'payment_orders.plan_id refers to an inactive plan';
    END IF;
    -- Kwota nie może przewyższać ceny planu w jego walucie - dla planu za
    -- miejsce ceny 100 miejsc (patrz nagłówek). Rabaty (kupony) obniżają
    -- kwotę i pozostają dozwolone; przeliczenie na inną walutę prezentacji
    -- odbywa się poza tym warunkiem.
    plan_cap := plan_row.price_cents::bigint
      * CASE WHEN plan_row.tier_key = 'team' THEN 100 ELSE 1 END;
    IF NEW.currency = upper(plan_row.currency) AND NEW.amount_cents > plan_cap THEN
      RAISE EXCEPTION 'payment_orders.amount_cents exceeds plan price';
    END IF;
  END IF;

  -- Spójność referencji do encji (bilet/wydarzenie itp.).
  IF NEW.entity_id IS NOT NULL AND NEW.entity_type IS NULL THEN
    RAISE EXCEPTION 'payment_orders.entity_type is required when entity_id is set';
  END IF;

  RETURN NEW;
END;
$function$;
