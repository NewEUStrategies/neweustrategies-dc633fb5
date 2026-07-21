-- ============================================================================
-- Integracje wychodzące: domyślne tenant_id/created_by przy INSERT z panelu.
--
-- Panel /admin/integrations wstawia endpoint bez tenant_id (komentarz w UI
-- zakładał trigger pinujący), ale kolumna jest NOT NULL bez DEFAULT - insert
-- kończył się błędem. Domyślne wartości spinają kontrakt z RLS:
-- policy integration_endpoints_staff_all wymusza tenant_id = current_tenant_id(),
-- więc DEFAULT current_tenant_id() jest jedyną wartością, jaką staff może zapisać.
-- ============================================================================

ALTER TABLE public.integration_endpoints
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id(),
  ALTER COLUMN created_by SET DEFAULT auth.uid();
