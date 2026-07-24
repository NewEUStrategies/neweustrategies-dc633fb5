DROP FUNCTION IF EXISTS public.rate_limit_hit(text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  _scope text,
  _subject text,
  _max integer,
  _window_minutes integer DEFAULT 1
)
RETURNS TABLE(allowed boolean, hits integer, bucket_start timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_window_minutes integer := GREATEST(1, COALESCE(_window_minutes, 1));
  v_bucket_seconds integer := v_window_minutes * 60;
  v_start timestamptz := to_timestamp(
    (floor(extract(epoch FROM now()) / v_bucket_seconds) * v_bucket_seconds)::double precision
  );
  v_count integer;
BEGIN
  IF _scope IS NULL OR length(_scope) = 0 OR _subject IS NULL OR length(_subject) = 0 THEN
    RAISE EXCEPTION 'rate_limit_hit: scope/subject required';
  END IF;

  INSERT INTO public.rate_limits AS rl (scope, subject_id, window_start, count)
  VALUES (_scope, _subject, v_start, 1)
  ON CONFLICT (scope, subject_id, window_start)
  DO UPDATE SET count = rl.count + 1
  RETURNING rl.count INTO v_count;

  RETURN QUERY SELECT (v_count <= GREATEST(1, _max)), v_count, v_start;
END;
$function$;

DROP POLICY IF EXISTS billing_documents_owner_select ON public.billing_documents;
CREATE POLICY billing_documents_owner_select
  ON public.billing_documents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "donations own read" ON public.donations;
CREATE POLICY "donations own read"
  ON public.donations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "cv owner read" ON storage.objects;
CREATE POLICY "cv owner read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'cv'
    AND (storage.foldername(name))[1] = current_tenant_id()::text
    AND (storage.foldername(name))[2] = 'users'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );

DROP POLICY IF EXISTS "cv owner delete" ON storage.objects;
CREATE POLICY "cv owner delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'cv'
    AND (storage.foldername(name))[1] = current_tenant_id()::text
    AND (storage.foldername(name))[2] = 'users'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );