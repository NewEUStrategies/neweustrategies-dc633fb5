-- ============================================================================
-- notification_push_queue: zbiorczy raport partii zadań push
-- ============================================================================
--
-- PO CO TA MIGRACJA.
--
-- Dyspozytor `processPushJobs` (src/lib/notifications/dispatch.server.ts)
-- finalizował każde zajęte zadanie OSOBNYM wywołaniem `report_push_job`
-- (20260713092000). Partia to do 100 zadań na tick, a tick biegnie co minutę -
-- czyli do 100 żądań PostgREST na minutę tylko po to, żeby przestawić status,
-- w falach po 12 równoległych round-tripów doliczanych do 25-sekundowego
-- budżetu ticku. `report_push_jobs` robi to samo JEDNĄ instrukcją UPDATE.
--
-- SEMANTYKA 1:1 Z `report_push_job`. Ta sama reguła statusu (ok -> 'sent';
-- dead albo wyczerpany limit 8 prób -> 'dead'; inaczej zostaje 'pending' na
-- retry z backoffem ustawionym już przy claimie), ten sam stempel `sent_at`.
-- Funkcja per zadanie ZOSTAJE: dyspozytor spada na nią, gdy wywołanie zbiorcze
-- zawiedzie (także w oknie wdrożenia, gdy kod wyprzedza tę migrację), bo
-- zbiorczy UPDATE jest "wszystko albo nic", a zadanie bez raportu idzie
-- ponownie, czyli odbiorca dostaje duplikat pusha.
--
-- DLACZEGO JSONB, NIE TRZY RÓWNOLEGŁE TABLICE. Element `{id, ok, dead}` nie
-- może się rozjechać z sąsiednim polem, a pozycyjne `bigint[]`/`boolean[]`
-- bez walidacji długości przesuwałyby werdykty na cudze zadania.
--
-- Duplikat `id` w jednym wywołaniu (dyspozytor go nie produkuje, ale UPDATE
-- ... FROM z dwoma dopasowaniami wybrałby wiersz arbitralnie) jest sklejany
-- przez GROUP BY z `bool_or` na obu flagach - ta sama zasada, co agregacja
-- per zadanie w dyspozytorze: dostarczenie na jakiekolwiek urządzenie
-- wygrywa, a bez dostarczenia wystarczy jeden trwały werdykt. `bool_or`, nie
-- DISTINCT ON, bo przy remisie na `ok` DISTINCT ON wybierałby `dead`
-- arbitralnie, czyli ten sam raport mógłby raz zabić zadanie, a raz nie.
-- Wejście niebędące tablicą to zero zmian, nie wyjątek.
--
-- Wyłącznie service_role, jak cała kolejka (claim_push_jobs, report_push_job).
-- Idempotentne: `CREATE OR REPLACE`; powtórzenie tego samego raportu daje ten
-- sam status.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_push_jobs(p_reports jsonb)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH r AS (
    SELECT x.id,
           bool_or(COALESCE(x.ok, false)) AS ok,
           bool_or(COALESCE(x.dead, false)) AS dead
      FROM jsonb_to_recordset(
             CASE WHEN jsonb_typeof(p_reports) = 'array' THEN p_reports ELSE '[]'::jsonb END
           ) AS x(id bigint, ok boolean, dead boolean)
     WHERE x.id IS NOT NULL
     GROUP BY x.id
  ),
  upd AS (
    UPDATE public.notification_push_queue q
       SET status = CASE
                      WHEN r.ok THEN 'sent'
                      WHEN r.dead OR q.attempts >= 8 THEN 'dead'
                      ELSE 'pending'
                    END,
           sent_at = CASE WHEN r.ok THEN now() ELSE q.sent_at END
      FROM r
     WHERE q.id = r.id
    RETURNING q.id
  )
  SELECT count(*)::integer FROM upd;
$$;

COMMENT ON FUNCTION public.report_push_jobs(jsonb) IS
  'Zbiorczy raport partii zadań push: p_reports = [{id, ok, dead}]. Semantyka statusu 1:1 z report_push_job (ok -> sent; dead albo attempts >= 8 -> dead; inaczej pending). Zwraca liczbę zaktualizowanych wierszy. Wyłącznie service_role.';

REVOKE ALL ON FUNCTION public.report_push_jobs(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_push_jobs(jsonb) TO service_role;
