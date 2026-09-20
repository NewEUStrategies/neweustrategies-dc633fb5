-- Limit kuponu na użytkownika i kwota dzienna anonimowej wysyłki CV (bliźniak
-- pasa drizzle `0027_coupon_per_user_limit_and_cv_upload_quota`).
--
-- PO CO BLIŹNIAK. Obie poprawki pojechały wyłącznie pasem drizzle. W bazie
-- odtworzonej z `supabase/migrations/` kod „raz na osobę" nadal daje się
-- realizować w pętli z jednego konta, a polityka `career_cv_public_upload`
-- nadal przyjmuje od anonima dowolną liczbę plików.
--
-- POWTÓRNE WYKONANIE JEST BEZPIECZNE: `CREATE OR REPLACE FUNCTION`,
-- `CREATE INDEX IF NOT EXISTS` oraz `DROP POLICY IF EXISTS` + `CREATE POLICY`.
-- A. Kupony B2B (plan/subskrypcja): limit na UŻYTKOWNIKA.
--
-- `validate_b2b_coupon`/`redeem_b2b_coupon` pilnowały tylko globalnego
-- `max_redemptions`, więc kod „raz na osobę" dawał się realizować w pętli przez
-- jedno konto. Przepływ biletowy (20260824080000) ma już ten sam warunek -
-- tutaj domykamy go dla checkoutu planów.

CREATE OR REPLACE FUNCTION public.validate_b2b_coupon(
  _code text, _plan_id uuid, _amount_cents integer, _currency text
) RETURNS TABLE(
  ok boolean, error text, coupon_id uuid, discount_cents integer,
  final_cents integer, label text, discount_kind text, discount_percent integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' STABLE AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_disc integer := 0;
  v_norm text := upper(trim(coalesce(_code,'')));
  v_used_by_user integer := 0;
BEGIN
  IF v_norm = '' THEN
    RETURN QUERY SELECT false,'empty_code'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN QUERY SELECT false,'invalid_amount'::text,NULL::uuid,0,coalesce(_amount_cents,0),NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  SELECT * INTO c FROM public.b2b_coupons
    WHERE tenant_id = public.public_tenant_id() AND upper(code) = v_norm;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'not_found'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF NOT c.active THEN
    RETURN QUERY SELECT false,'inactive'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.valid_from IS NOT NULL AND now() < c.valid_from THEN
    RETURN QUERY SELECT false,'not_yet_valid'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN
    RETURN QUERY SELECT false,'expired'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.max_redemptions IS NOT NULL AND c.redemptions_count >= c.max_redemptions THEN
    RETURN QUERY SELECT false,'limit_reached'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.max_redemptions_per_user IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.user_id = auth.uid();
    IF v_used_by_user >= c.max_redemptions_per_user THEN
      RETURN QUERY SELECT false,'per_user_limit_reached'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
    END IF;
  END IF;
  IF array_length(c.plan_ids,1) IS NOT NULL AND _plan_id IS NOT NULL
     AND NOT (_plan_id = ANY(c.plan_ids)) THEN
    RETURN QUERY SELECT false,'plan_not_eligible'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.discount_kind = 'percent' THEN
    v_disc := (_amount_cents * COALESCE(c.discount_percent,0)) / 100;
  ELSE
    IF c.currency IS NOT NULL AND upper(c.currency) <> upper(_currency) THEN
      RETURN QUERY SELECT false,'currency_mismatch'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
    END IF;
    v_disc := LEAST(COALESCE(c.discount_cents,0),_amount_cents);
  END IF;
  RETURN QUERY SELECT true,NULL::text,c.id,v_disc,GREATEST(_amount_cents-v_disc,0),c.name,c.discount_kind,c.discount_percent;
END $$;
GRANT EXECUTE ON FUNCTION public.validate_b2b_coupon(text,uuid,integer,text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.redeem_b2b_coupon(
  _coupon_id uuid, _order_id uuid, _applied_cents integer,
  _original_cents integer, _currency text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_per_user integer;
  v_used_by_user integer := 0;
BEGIN
  -- Limit na użytkownika sprawdzamy PRZED inkrementacją licznika kampanii,
  -- żeby odrzucona próba nie zjadała globalnej puli.
  SELECT max_redemptions_per_user INTO v_per_user
    FROM public.b2b_coupons
   WHERE id = _coupon_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_per_user IS NOT NULL THEN
    IF auth.uid() IS NULL THEN RETURN false; END IF;
    SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = _coupon_id AND r.user_id = auth.uid();
    IF v_used_by_user >= v_per_user THEN RETURN false; END IF;
  END IF;

  UPDATE public.b2b_coupons
     SET redemptions_count = redemptions_count + 1, updated_at = now()
   WHERE id = _coupon_id AND tenant_id = v_tenant AND active
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions)
     AND (valid_from IS NULL OR now() >= valid_from)
     AND (valid_until IS NULL OR now() <= valid_until);
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.b2b_coupon_redemptions
    (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency)
  VALUES
    (v_tenant, _coupon_id, _order_id, auth.uid(), _applied_cents, _original_cents, _currency);
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.redeem_b2b_coupon(uuid,uuid,integer,integer,text) TO authenticated;

CREATE INDEX IF NOT EXISTS b2b_coupon_redemptions_coupon_user_idx
  ON public.b2b_coupon_redemptions (coupon_id, user_id);

-- B. Bucket `career-cv`: anonimowa wysyłka CV z dziennym limitem na najemcę.
--
-- Polityka `career_cv_public_upload` pozwalała anonimowi wgrać dowolną liczbę
-- plików do `<tenant>/uploads/<cokolwiek>/`. Dokładamy dwa ograniczenia w RLS:
-- katalog trzeciego poziomu MUSI być dzisiejszą datą UTC, a liczba obiektów w
-- tym katalogu jest ograniczona (kwota dzienna na najemcę). Licznik czyta
-- `storage.objects` przez funkcję SECURITY DEFINER, bo anonim nie ma prawa
-- SELECT na tej tabeli, i skanuje najwyżej `limit` wierszy.

CREATE OR REPLACE FUNCTION public.career_cv_upload_quota_ok(_tenant uuid, _day text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM (
      SELECT 1
        FROM storage.objects o
       WHERE o.bucket_id = 'career-cv'
         AND o.name LIKE _tenant::text || '/uploads/' || _day || '/%'
       LIMIT 200
    ) t
    OFFSET 199
  );
$$;
REVOKE ALL ON FUNCTION public.career_cv_upload_quota_ok(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.career_cv_upload_quota_ok(uuid, text) TO anon, authenticated;
COMMENT ON FUNCTION public.career_cv_upload_quota_ok(uuid, text) IS
  'Kwota dzienna anonimowej wysyłki CV: true dopóki katalog <tenant>/uploads/<data> ma mniej niż 200 obiektów.';

DROP POLICY IF EXISTS "career_cv_public_upload" ON storage.objects;
CREATE POLICY "career_cv_public_upload"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'career-cv'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[1] = public.public_tenant_id()::text
  AND (storage.foldername(name))[2] = 'uploads'
  AND (storage.foldername(name))[3] = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  AND public.career_cv_upload_quota_ok(
        public.public_tenant_id(),
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      )
);
