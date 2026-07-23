
-- Add expert-network benefits to Essential/Plus/Pro tiers (idempotent).
DO $$
DECLARE
  reader_benefit jsonb := '{"pl":"Dołączenie do sieci eksperckiej New European Strategies - Twój profil w ekosystemie analityków, praktyków i decydentów","en":"Join the New European Strategies expert network - your profile in an ecosystem of analysts, practitioners and decision-makers"}'::jsonb;
  member_benefit jsonb := '{"pl":"Interakcje z członkami sieci eksperckiej - komentarze, dyskusje i obserwowanie profili","en":"Interact with members of the expert network - comments, discussions and profile follows"}'::jsonb;
  pro_benefit jsonb := '{"pl":"3 bezpośrednie zapytania do eksperta miesięcznie (Expert Request) - z kontynuacją korespondencji po akceptacji","en":"3 direct expert requests per month - with conversation continuation once accepted"}'::jsonb;
BEGIN
  -- Essential
  UPDATE public.membership_tiers
  SET benefits = jsonb_build_array(reader_benefit) || COALESCE(benefits, '[]'::jsonb)
  WHERE key = 'reader'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(benefits,'[]'::jsonb)) e
      WHERE e->>'pl' = reader_benefit->>'pl'
    );

  -- Plus
  UPDATE public.membership_tiers
  SET benefits = jsonb_build_array(member_benefit) || COALESCE(benefits, '[]'::jsonb)
  WHERE key = 'member'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(benefits,'[]'::jsonb)) e
      WHERE e->>'pl' = member_benefit->>'pl'
    );

  -- Pro
  UPDATE public.membership_tiers
  SET benefits = jsonb_build_array(pro_benefit) || COALESCE(benefits, '[]'::jsonb)
  WHERE key = 'pro'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(benefits,'[]'::jsonb)) e
      WHERE e->>'pl' = pro_benefit->>'pl'
    );
END $$;
