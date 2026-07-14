-- Admin/super_admin muszą móc edytować pola profilu (bio_pl, bio_en) innych
-- użytkowników w swoim tenancie, żeby edytor autora w /admin/users/$id mógł
-- zapisywać kanoniczne bio. Dopasowany wzorzec do istniejącej polityki
-- "Admins can manage tenant author profiles".
CREATE POLICY "Admins can update tenant profiles"
ON public.profiles
FOR UPDATE
USING (
  (public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role))
  AND tenant_id = (
    SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
  )
)
WITH CHECK (
  (public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role))
  AND tenant_id = (
    SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);