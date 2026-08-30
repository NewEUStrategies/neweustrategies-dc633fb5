DO $$
DECLARE
  r record;
  v_path text;
  v_fixed int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           (SELECT cfg
              FROM unnest(p.proconfig) AS cfg
             WHERE cfg LIKE 'search_path=%'
             LIMIT 1) AS search_path_cfg
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proconfig IS NOT NULL
     ORDER BY 1
  LOOP
    CONTINUE WHEN r.search_path_cfg IS NULL;

    v_path := substring(r.search_path_cfg FROM 13);

    CONTINUE WHEN btrim(v_path) = '' OR btrim(v_path) IN ('''''', '""');

    IF v_path ILIKE '%pg_temp%' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER FUNCTION %s SET search_path = %s, pg_temp', r.sig, v_path);
    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'search_path/pg_temp: dopisano do % funkcji, % juz bylo bezpiecznych',
    v_fixed, v_skipped;
END $$;