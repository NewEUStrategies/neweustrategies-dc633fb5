ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

CREATE TEMP TABLE program_policy_repoint AS
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       p.polname AS policy_name,
       p.polpermissive,
       p.polcmd,
       COALESCE((
         SELECT string_agg(
           CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(role_oid)) END,
           ', ' ORDER BY role_oid
         )
         FROM unnest(p.polroles) AS role_oid
       ), 'PUBLIC') AS roles_sql,
       pg_get_expr(p.polqual, p.polrelid) AS using_sql,
       pg_get_expr(p.polwithcheck, p.polrelid) AS check_sql
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname = ANY (ARRAY[
     'research_program_members',
     'research_program_projects',
     'research_program_partners',
     'research_program_items'
   ])
   AND (
     COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '\mresearch_programs\M'
     OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '\mresearch_programs\M'
   );

DO $policy_repoint$
DECLARE
  v record;
  v_command text;
  v_sql text;
BEGIN
  FOR v IN SELECT * FROM program_policy_repoint ORDER BY table_name, policy_name
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', v.policy_name, v.schema_name, v.table_name);
    v_command := CASE v.polcmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      ELSE 'ALL'
    END;
    v_sql := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      v.policy_name,
      v.schema_name,
      v.table_name,
      CASE WHEN v.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      v_command,
      v.roles_sql
    );
    IF v.using_sql IS NOT NULL THEN
      v_sql := v_sql || format(
        ' USING (%s)',
        replace(v.using_sql, 'research_programs', 'programs')
      );
    END IF;
    IF v.check_sql IS NOT NULL THEN
      v_sql := v_sql || format(
        ' WITH CHECK (%s)',
        replace(v.check_sql, 'research_programs', 'programs')
      );
    END IF;
    EXECUTE v_sql;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_policy p
     WHERE p.polrelid = ANY (ARRAY[
       'public.research_program_members'::regclass,
       'public.research_program_projects'::regclass,
       'public.research_program_partners'::regclass,
       'public.research_program_items'::regclass
     ])
       AND (
         COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '\mresearch_programs\M'
         OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '\mresearch_programs\M'
       )
  ) THEN
    RAISE EXCEPTION 'policy migration incomplete: research_programs dependency remains';
  END IF;
END
$policy_repoint$;

DROP TABLE program_policy_repoint;