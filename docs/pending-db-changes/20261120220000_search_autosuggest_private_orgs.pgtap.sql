-- pgTAP: podpowiedzi wyszukiwarki bez firm członkowskich - przenieść do
-- supabase/tests/search_autosuggest_private_orgs_test.sql razem z migracją
-- 20261120220000_search_autosuggest_private_orgs.sql.
--
-- Zakres:
--   1. Gość nie dostaje nazw `member_organizations` w podpowiedziach.
--   2. Usunięta strona opublikowana nie wraca w podpowiedziach.
--   3. Opublikowana strona nadal wraca (regresja).
--   4. Gość nie ma EXECUTE na eksporcie skanów leadów; admin-UI (authenticated) ma.
BEGIN;
SELECT plan(5);

INSERT INTO public.member_organizations (id, tenant_id, name, slug, status)
VALUES ('f1111111-1111-1111-1111-1111111100c1', public.public_tenant_id(),
        'Zzqx Sekretna Firma', 'zzqx-sekretna-firma', 'active');
INSERT INTO public.pages (id, tenant_id, slug, title_pl, title_en, status, deleted_at)
VALUES
  ('f1111111-1111-1111-1111-1111111100d1', public.public_tenant_id(), 'zzqx-usunieta',
   'Zzqx Usunieta', 'Zzqx Deleted', 'published', now()),
  ('f1111111-1111-1111-1111-1111111100d2', public.public_tenant_id(), 'zzqx-widoczna',
   'Zzqx Widoczna', 'Zzqx Visible', 'published', NULL);

SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.search_autosuggest('zzqx', 20) WHERE kind = 'company'),
  0, 'gość nie widzi firm członkowskich');
SELECT is(
  (SELECT count(*)::int FROM public.search_autosuggest('zzqx', 20)
    WHERE id = 'f1111111-1111-1111-1111-1111111100d1'),
  0, 'usunięta strona nie wraca w podpowiedziach');
SELECT is(
  (SELECT count(*)::int FROM public.search_autosuggest('zzqx', 20)
    WHERE id = 'f1111111-1111-1111-1111-1111111100d2'),
  1, 'opublikowana strona nadal wraca');

RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_event_lead_scans_export(uuid, uuid)', 'EXECUTE'),
  'anon bez EXECUTE na eksporcie skanów leadów');
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_event_lead_scans_export(uuid, uuid)', 'EXECUTE'),
  'authenticated zachowuje EXECUTE (bramka admina w funkcji)');

SELECT * FROM finish();
ROLLBACK;
