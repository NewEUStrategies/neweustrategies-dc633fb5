-- ============================================================================
-- Serwerowe wymuszenie MFA dla staffu (P2) - rekomendacja audytu
-- (docs/AUDYT_PLATFORMY_2026-07-13.md, P1 #10: "egzekwować aal2").
--
-- has_verified_mfa(): czy wywołujący ma zweryfikowany drugi składnik.
-- requireStaff odrzuca sesje aal1 użytkowników, którzy MFA już włączyli -
-- kradziony token hasłowy przestaje wystarczać do mutacji staffu. Konta bez
-- MFA działają bez zmian (wymuszenie enrolmentu to decyzja polityki, nie kodu).
--
-- SECURITY DEFINER jest konieczny: auth.mfa_factors nie jest czytelne dla
-- roli authenticated. Funkcja zwraca wyłącznie boolean o WŁASNYM koncie
-- wywołującego (auth.uid()), więc niczego nie ujawnia.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_verified_mfa()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM auth.mfa_factors f
     WHERE f.user_id = auth.uid()
       AND f.status = 'verified'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_verified_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_verified_mfa() TO authenticated, service_role;
