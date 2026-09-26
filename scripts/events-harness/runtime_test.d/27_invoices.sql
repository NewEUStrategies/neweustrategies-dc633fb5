\echo '== 27 faktury wydarzen (szkic) =='
BEGIN;
SELECT pg_temp.assert(to_regclass('public.event_invoices') IS NOT NULL, 'tabela faktur istnieje');
ROLLBACK;
