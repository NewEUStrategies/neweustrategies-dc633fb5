-- ============================================================================
-- endorse_skill: najemca poparcia z UMIEJĘTNOŚCI, nie z wołającego
-- ============================================================================
--
-- PO CO TA MIGRACJA. Ustalenie z przeglądu PR #365 (Codex, P1), potwierdzone
-- odtworzeniem na pełnym schemacie.
--
-- 20260914200000 kazało poparciom podążać za profilem adresata - właśnie po to,
-- żeby najemca poparcia zgadzał się z najemcą umiejętności, pod którą ono wisi.
-- Ale `endorse_skill()` potrafi ten rozjazd utworzyć NA NOWO, już po
-- przeniesieniu konta:
--
--   * czyta umiejętność zapytaniem BEZ filtra najemcy (SECURITY DEFINER omija
--     RLS), więc znajduje ją także po przeprowadzce adresata;
--   * bramką jest `_are_connected()`, które też nie filtruje po najemcy, a
--     zaakceptowane `user_connections` sprzed przeniesienia nie są
--     unieważniane;
--   * wstawia wiersz z `tenant_id := _caller_tenant()`, czyli najemcą
--     WYSTAWIAJĄCEGO.
--
-- ODTWORZONE: wystawca, który został w najemcy X i zna identyfikator
-- umiejętności sprzed przeprowadzki, tworzy poparcie z `tenant_id` = X pod
-- umiejętnością, która stoi już w Y. `endorse_read` wiąże
-- `tenant_id = current_tenant_id()`, więc adresat tego poparcia NIE WIDZI, a
-- powstał zapis w obszarze, do którego jego treść już nie należy.
--
-- CO ROBIMY. Dokładnie to, co robi już BLIŹNIACZY RPC tej samej rodziny -
-- `write_recommendation` (20260813). Tamten porównuje najemcę autora z najemcą
-- właściciela profilu i jawnie odrzuca `tenant_mismatch`, ze skądinąd tym samym
-- uzasadnieniem w komentarzu: "Rekomendacja miedzy tenantami bylaby niewidoczna
-- (lista jest skalowana tenantem wlasciciela profilu), wiec odrzucamy ja
-- jawnie". `endorse_skill()` jako jedyne w tej rodzinie nie zostało do tego
-- wzorca doprowadzone.
--
-- Najemca wstawianego wiersza pochodzi teraz z UMIEJĘTNOŚCI, a nie z
-- wołającego - czyli jest poprawny NAWET gdyby bramkę kiedyś poluzowano.
-- Sama bramka jest jawnym błędem, a nie cichym "skill not found": zgodnie z
-- bliźniakiem i dlatego, że ta funkcja i tak ujawnia istnienie umiejętności
-- ("skill not found" dla dowolnego UUID), więc osobny komunikat niczego nowego
-- nie zdradza, a bardzo pomaga w diagnozie.
--
-- ZAKRES CELOWO WĄSKI. Nie unieważniamy tu nieaktualnych `user_connections`
-- przy przeniesieniu konta, choć to drugi możliwy sposób zamknięcia tej dziury.
-- Połączenia to osobny moduł z własnymi regułami przejść stanów
-- (20260717123000), a `_are_connected()` ma więcej konsumentów niż ten jeden
-- RPC - zmiana tam jest osobną decyzją, nie skutkiem ubocznym naprawy najemcy
-- poparć. Ta migracja zamyka wektor w miejscu, w którym powstaje wiersz.
--
-- Idempotentne.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.endorse_skill(p_skill_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_recipient UUID;
  v_tenant    UUID;
  v_id        UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  -- Najemca bierze się z UMIEJĘTNOŚCI, nie z wołającego.
  SELECT user_id, tenant_id INTO v_recipient, v_tenant
    FROM public.profile_skills
   WHERE id = p_skill_id;
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'skill not found'; END IF;
  IF v_recipient = auth.uid() THEN RAISE EXCEPTION 'cannot endorse own skill'; END IF;

  -- Bramka najemcy PRZED bramką połączenia: zaakceptowane połączenie sprzed
  -- przeniesienia konta nie jest unieważniane, więc samo w sobie nie dowodzi
  -- już, że obie strony dzielą obszar roboczy.
  IF v_tenant IS DISTINCT FROM public._caller_tenant() THEN
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT public._are_connected(auth.uid(), v_recipient) THEN
    RAISE EXCEPTION 'must be connected';
  END IF;

  INSERT INTO public.profile_skill_endorsements
    (tenant_id, skill_id, recipient_id, endorser_id)
  VALUES (v_tenant, p_skill_id, v_recipient, auth.uid())
  ON CONFLICT (skill_id, endorser_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

COMMENT ON FUNCTION public.endorse_skill(uuid) IS
  'Poparcie umiejętności. Najemca wiersza pochodzi z UMIEJĘTNOŚCI (nie z wołającego), a wołający z innego najemcy jest odrzucany jako tenant_mismatch - inaczej zaakceptowane połączenie sprzed przeniesienia konta pozwalało utworzyć poparcie w starym obszarze pod umiejętnością, która stoi już w nowym, i adresat go nie widział. Ten sam kontrakt co write_recommendation.';

-- Sprzątnięcie wierszy, które zdążyły powstać rozjechane: poparcie należy do
-- najemcy swojej umiejętności. `IS DISTINCT FROM` czyni to idempotentnym.
UPDATE public.profile_skill_endorsements e
   SET tenant_id = s.tenant_id
  FROM public.profile_skills s
 WHERE s.id = e.skill_id
   AND e.tenant_id IS DISTINCT FROM s.tenant_id;
