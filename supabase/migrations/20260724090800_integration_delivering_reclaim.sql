-- ============================================================================
-- FIX (P1): osierocone dostawy integracji utkniete w statusie 'delivering'.
--
-- claim_integration_deliveries wybieral wylacznie status IN ('queued','failed'),
-- ustawial 'delivering' i inkrementowal attempts, ale NIE ustawial dzierzawy.
-- Jesli dispatcher zginal po claimie a przed finish_integration_delivery
-- (realne przy zabiciu dlugiego jobs-tick), wiersz zostawal 'delivering' NA
-- ZAWSZE - nigdy ponowiony ani oznaczony 'dead'.
--
-- Naprawa (wzorzec dzierzawy, jak lease kampanii newslettera): claim ustawia
-- next_attempt_at = now() + 5 min (dzierzawa) i wlacza do puli takze wiersze
-- 'delivering' z WYGASLA dzierzawa. Zdrowy dispatcher konczy dostawe (delivered
-- /failed) przed uplywem dzierzawy; martwy zostawia wiersz, ktory po 5 min jest
-- ponownie przejmowany. finish_integration_delivery bez zmian (delivered/failed
-- ustawiaja wlasny next_attempt_at, wiec nie sa re-claimowane przedwczesnie).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_integration_deliveries(p_limit integer DEFAULT 20)
RETURNS SETOF public.integration_deliveries
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.integration_deliveries d
     SET status = 'delivering',
         attempts = d.attempts + 1,
         -- Dzierzawa: jesli dispatcher zginie, po 5 min wiersz jest re-claimowany.
         next_attempt_at = now() + interval '5 minutes'
   WHERE d.id IN (
     SELECT i.id FROM public.integration_deliveries i
      WHERE i.status IN ('queued', 'failed', 'delivering')
        AND i.next_attempt_at <= now()
      ORDER BY i.next_attempt_at ASC
      LIMIT GREATEST(1, LEAST(p_limit, 100))
        FOR UPDATE SKIP LOCKED
   )
  RETURNING d.*;
END;
$$;
