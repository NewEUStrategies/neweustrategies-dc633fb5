-- ============================================================================
-- Kandydaci zamiatarki dziennika płatności liczeni W BAZIE (PAY-08, przegląd
-- 3.1, 3.2 i 3.3).
--
-- CO BYŁO ZŁE. Zamiatarka (`sweepWebhookEvents`, webhookReplay.server.ts)
-- czytała 100 NAJSTARSZYCH wierszy `failed`/`received` po `created_at`
-- i dopiero w aplikacji sprawdzała, czy minął ich odstęp. Trzy skutki:
--   * 3.2 - setka starszych wierszy czekających na odstęp zasłaniała każdy
--     nowszy wiersz do wzięcia (także realizację opłaconego zamówienia), aż
--     starsze dobiły do sufitu prób (~21 h),
--   * 3.1 - porzucone `received` nie miały odstępu wykładniczego: obsługa
--     ginąca za każdym razem była przejmowana co 5 minut i wyczerpywała
--     sufit ośmiu prób w ~40 minut, powtarzając skutki sprzed awarii,
--   * 3.3 - horyzont 3 dób liczył się od utworzenia WIERSZA, więc stare
--     zdarzenie z późno utworzonym wierszem (naprawa z uzgadniania do 30 dni
--     wstecz, pierwsza udana dostawa po dobach 503) wracało do automatu.
--
-- CO ROBI FUNKCJA. Zwraca WYŁĄCZNIE wiersze do wzięcia teraz, najdłużej
-- czekające najpierw:
--   * `failed`   - ostatnia próba (processed_at -> last_retried_at ->
--                  created_at) + base * 2^retry_count <= now(),
--   * `received` - ostatnie przejęcie (last_retried_at -> created_at)
--                  + max(okno porzucenia, base * 2^retry_count) < now(),
--   * retry_count < sufit prób,
--   * czas ZDARZENIA (occurred_at, bez niego created_at) w horyzoncie -
--     z wyjątkiem SYNTETYCZNYCH napraw uzgadniania (`reconcile_…`): te są
--     budowane ze stanu operatora odczytanego W CHWILI naprawy (sesja,
--     subskrypcja), a `occurred_at` niesie czas zakupu dla `paid_at`; ich
--     wiek liczy się od utworzenia wiersza. Odtworzenie prawdziwego starego
--     zdarzenia (`evt_…`) z naprawy idzie do człowieka.
-- Reguły (sufit, odstęp, okno, horyzont) przychodzą PARAMETRAMI z
-- `webhookReplay.server.ts` - stałe żyją w jednym miejscu, a ta sama reguła
-- w TypeScripcie (`isDueForSweep`) jest jej specyfikacją z testem.
--
-- SECURITY INVOKER + EXECUTE wyłącznie dla service_role: zamiatarka biegnie
-- w aplikacji kluczem serwisowym; klient nie ma tu czego szukać (dziennik
-- jest zamknięty RLS-em).
--
-- Indeks częściowy na otwartych wierszach: horyzont liczony od czasu
-- zdarzenia nie korzysta już z indeksu `created_at`, a otwartych wierszy jest
-- garstka wobec całego dziennika.
-- ============================================================================

CREATE INDEX IF NOT EXISTS payment_webhook_events_sweep_open_idx
  ON public.payment_webhook_events (created_at)
  WHERE status IN ('failed', 'received');

CREATE OR REPLACE FUNCTION public.payment_webhook_sweep_candidates(
  p_limit integer,
  p_max_attempts integer,
  p_backoff_base_ms bigint,
  p_stuck_after_ms bigint,
  p_horizon_ms bigint
)
RETURNS TABLE (
  id uuid,
  event_id text,
  event_type text,
  environment text,
  occurred_at timestamptz,
  status text,
  created_at timestamptz,
  last_retried_at timestamptz,
  processed_at timestamptz,
  retry_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH open_rows AS (
    SELECT w.id, w.event_id, w.event_type, w.environment, w.occurred_at, w.status,
           w.created_at, w.last_retried_at, w.processed_at, w.retry_count,
           CASE
             WHEN w.status = 'failed' THEN
               COALESCE(w.processed_at, w.last_retried_at, w.created_at)
                 + make_interval(secs => p_backoff_base_ms::double precision
                                         * power(2::double precision, w.retry_count) / 1000)
             ELSE
               COALESCE(w.last_retried_at, w.created_at)
                 + make_interval(secs => GREATEST(
                     p_stuck_after_ms::double precision,
                     p_backoff_base_ms::double precision
                       * power(2::double precision, w.retry_count)
                   ) / 1000)
           END AS due_at
      FROM public.payment_webhook_events w
     WHERE w.status IN ('failed', 'received')
       AND w.retry_count < GREATEST(p_max_attempts, 0)
       AND CASE
             WHEN w.event_id LIKE 'reconcile\_%' THEN w.created_at
             ELSE COALESCE(w.occurred_at, w.created_at)
           END >= now() - make_interval(secs => p_horizon_ms::double precision / 1000)
  )
  SELECT o.id, o.event_id, o.event_type, o.environment, o.occurred_at, o.status,
         o.created_at, o.last_retried_at, o.processed_at, o.retry_count
    FROM open_rows o
   WHERE (o.status = 'failed' AND o.due_at <= now())
      OR (o.status = 'received' AND o.due_at < now())
   ORDER BY o.due_at, o.created_at, o.id
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 500));
$fn$;

REVOKE ALL ON FUNCTION public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint)
  TO service_role;

COMMENT ON FUNCTION public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint) IS
  'Zamiatarka dziennika platnosci: wiersze failed/received do wziecia TERAZ (odstep wykladniczy, sufit prob, horyzont od occurred_at), najdluzej czekajace najpierw. Tylko service_role.';
