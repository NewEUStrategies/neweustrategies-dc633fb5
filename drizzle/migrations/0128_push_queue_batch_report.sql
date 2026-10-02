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