-- pgTAP: rejestr dokumentow rozliczeniowych - zbior stanow i migawka write-once
-- (migracje 20260723151000 i 20261012110000, audyt INV-04 i INV-07).
--
-- INV-04. Zapis przepisywal stan operatora doslownie, z domyslnym `pending`,
-- ktorego CHECK tabeli nie zna - zakup jednorazowy padal na 23514 i znikal
-- z rejestru. Strona TS ma teraz jeden zbior (`BILLING_DOCUMENT_STATUSES`,
-- parytet z migracja: `billingDocumentsDbCheck.test.ts`); tu baza dowodzi,
-- ze CALY ten zbior przechodzi, `pending` nie, a duplikat to 23505 (jedyny
-- blad, ktory kod traktuje jako wyscig, a nie awarie).
--
-- INV-07. Kopia PDF czytala nabywce i sprzedawce na zywo. Migawka jest
-- zamrazana raz (`UPDATE ... WHERE buyer_snapshot IS NULL`) i od tej chwili
-- nie zmienia jej zaden UPDATE (trigger write-once, 42501).
--
-- ZWROT (20261012122000). Pelny zwrot zamowienia oznacza jego dokument jako
-- `refunded` (linia stanu PDF), zwrot czesciowy i dokument `void` - bez zmian.
BEGIN;
SELECT plan(15);

INSERT INTO public.tenants (id, slug, name) VALUES
  ('b1d0c000-0000-4000-8000-0000000000a1', 'bdoc-snapshot-a', 'Billing Doc Snapshot A');

SELECT lives_ok(
  $$INSERT INTO public.billing_documents (tenant_id, user_id, provider_document_id, status) VALUES
      ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_paid', 'paid'),
      ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_open', 'open'),
      ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_void', 'void'),
      ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_refunded', 'refunded')$$,
  'CHECK statusu przyjmuje caly zbior BILLING_DOCUMENT_STATUSES');

SELECT throws_ok(
  $$INSERT INTO public.billing_documents (tenant_id, user_id, provider_document_id, status)
    VALUES ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_pending', 'pending')$$,
  '23514', NULL,
  'dawny domyslny `pending` jest odrzucany - stad mapowanie w billingDocumentStatus');

SELECT throws_ok(
  $$INSERT INTO public.billing_documents (tenant_id, user_id, provider_document_id, status)
    VALUES ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_paid', 'paid')$$,
  '23505', NULL,
  'powtorzony dokument operatora to 23505 - jedyny blad traktowany jako wyscig');

SELECT throws_ok(
  $$INSERT INTO public.billing_documents
      (tenant_id, user_id, provider_document_id, buyer_snapshot, seller_snapshot, billing_plane)
    VALUES ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_plane',
            '{"name": "Kupujacy"}', '{"name": "Sprzedawca"}', 'mor')$$,
  '23514', NULL,
  'plaszczyzna spoza CheckoutBillingPlane jest odrzucana');

SELECT throws_ok(
  $$INSERT INTO public.billing_documents (tenant_id, user_id, provider_document_id, buyer_snapshot)
    VALUES ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_partial',
            '{"name": "Kupujacy"}')$$,
  '23514', NULL,
  'polowa migawki (nabywca bez sprzedawcy i plaszczyzny) jest odrzucana');

SELECT throws_ok(
  $$INSERT INTO public.billing_documents
      (tenant_id, user_id, provider_document_id, buyer_snapshot, seller_snapshot, billing_plane)
    VALUES ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_noname',
            '{"taxId": "PL1130000000"}', '{"name": "Sprzedawca"}', 'managed')$$,
  '23514', NULL,
  'strona dokumentu bez nazwy jest odrzucana');

-- Zamrozenie migawki wiersza sprzed migracji - dokladnie zapytanie z
-- `freezeBillingDocumentSnapshot`.
UPDATE public.billing_documents
   SET buyer_snapshot = '{"name": "Kovács Kft."}',
       seller_snapshot = '{"name": "New European Strategies"}',
       billing_plane = 'merchant'
 WHERE provider_document_id = 'bdoc_paid'
   AND tenant_id = 'b1d0c000-0000-4000-8000-0000000000a1'
   AND buyer_snapshot IS NULL;

SELECT is(
  (SELECT buyer_snapshot ->> 'name' FROM public.billing_documents WHERE provider_document_id = 'bdoc_paid'),
  'Kovács Kft.',
  'pierwsze pobranie PDF zamraza migawke');

-- Drugie, rownolegle pobranie z nowszym profilem: warunek nie trafia w wiersz.
UPDATE public.billing_documents
   SET buyer_snapshot = '{"name": "Dvořák s.r.o."}',
       seller_snapshot = '{"name": "New European Strategies"}',
       billing_plane = 'managed'
 WHERE provider_document_id = 'bdoc_paid'
   AND tenant_id = 'b1d0c000-0000-4000-8000-0000000000a1'
   AND buyer_snapshot IS NULL;

SELECT is(
  (SELECT buyer_snapshot ->> 'name' || '/' || billing_plane
     FROM public.billing_documents WHERE provider_document_id = 'bdoc_paid'),
  'Kovács Kft./merchant',
  'drugie zamrozenie nie nadpisuje migawki');

SELECT throws_ok(
  $$UPDATE public.billing_documents SET buyer_snapshot = '{"name": "Nowy Nabywca"}'
     WHERE provider_document_id = 'bdoc_paid'$$,
  '42501', NULL,
  'zapisanej migawki nie zmienia zaden UPDATE (write-once)');

SELECT lives_ok(
  $$UPDATE public.billing_documents SET status = 'refunded', number = 'FV/2026/10/0001'
     WHERE provider_document_id = 'bdoc_paid'$$,
  'pozostale pola dokumentu (stan, numer) nadal sie aktualizuja');

SELECT ok(
  NOT has_function_privilege('anon', 'public.billing_documents_snapshot_write_once()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.billing_documents_snapshot_write_once()', 'EXECUTE'),
  'funkcja triggera niedostepna dla klienta');

-- Zwrot zamowienia -> stan dokumentu. Oplacone zamowienie zaklada i zamyka
-- wylacznie serwer (straznik payment_orders czyta request.jwt.claim.role).
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency) VALUES
  ('b1d0c000-0000-4000-8000-0000000000f1', 'b1d0c000-0000-4000-8000-0000000000a1', NULL, 'subscription', 'paid', 4900, 'PLN'),
  ('b1d0c000-0000-4000-8000-0000000000f2', 'b1d0c000-0000-4000-8000-0000000000a1', NULL, 'subscription', 'paid', 4900, 'PLN');
INSERT INTO public.billing_documents (tenant_id, user_id, provider_document_id, status, order_id) VALUES
  ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_order_full', 'paid',
   'b1d0c000-0000-4000-8000-0000000000f1'),
  ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_order_part', 'paid',
   'b1d0c000-0000-4000-8000-0000000000f2'),
  ('b1d0c000-0000-4000-8000-0000000000a1', 'b1d0c000-0000-4000-8000-0000000000e1', 'bdoc_order_void', 'void',
   'b1d0c000-0000-4000-8000-0000000000f1');

UPDATE public.payment_orders SET refunded_amount_cents = 1000
 WHERE id = 'b1d0c000-0000-4000-8000-0000000000f2';
SELECT is(
  (SELECT status FROM public.billing_documents WHERE provider_document_id = 'bdoc_order_part'),
  'paid',
  'zwrot czesciowy (zamowienie dalej paid) nie zmienia stanu dokumentu');

UPDATE public.payment_orders SET status = 'refunded', refunded_amount_cents = 4900
 WHERE id = 'b1d0c000-0000-4000-8000-0000000000f1';
SELECT is(
  (SELECT status FROM public.billing_documents WHERE provider_document_id = 'bdoc_order_full'),
  'refunded',
  'pelny zwrot zamowienia oznacza jego dokument jako refunded - PDF nie drukuje "Zaplacono"');
SELECT is(
  (SELECT status FROM public.billing_documents WHERE provider_document_id = 'bdoc_order_void'),
  'void',
  'dokument void zostaje void (anulowany nie byl zaplacony)');

SELECT set_config('request.jwt.claim.role', '', true);

SELECT ok(
  NOT has_function_privilege('anon', 'public._billing_documents_follow_order_refund()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._billing_documents_follow_order_refund()', 'EXECUTE'),
  'funkcja triggera zwrotu niedostepna dla klienta');

SELECT * FROM finish();
ROLLBACK;
