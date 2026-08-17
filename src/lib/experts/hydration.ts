// Hydratacja danych eksperta do treści widgetów (jedno źródło prawdy).
//
// Używają jej edytory `team-member` oraz `author-profile-card`: po wybraniu
// osoby kopiujemy dane do `content`, więc renderer nie robi już żadnej sieci,
// a redakcja może nadpisać dowolne pole ręcznie.
//
// Dwa źródła `author_profiles` scalane priorytetem:
//  1) admin_get_author_profile() (SECURITY DEFINER) - pełny wiersz z
//     contact_email, ale WYŁĄCZNIE dla admina tego samego tenanta;
//  2) fallback dla staffu bez roli admin (editor/author): publiczna projekcja
//     author_profiles_public, żeby hydratacja nie gubiła stanowiska, bio i
//     socjali - bez kolumn kontaktowych. Tabela bazowa nie ma już polityk
//     odczytu anon/authenticated (20260817120000), więc bezpośredni select
//     widziałby wyłącznie wiersz własny.
import { supabase } from "@/integrations/supabase/client";
import { adminGetAuthorProfile } from "@/lib/experts/adminAuthorProfileRpc";

export interface ExpertHydration {
  authorId: string;
  authorSlug: string | null;
  photo: string | null;
  name: string | null;
  positionPl: string | null;
  positionEn: string | null;
  bioPl: string | null;
  bioEn: string | null;
  email: string | null;
  x: string | null;
  linkedin: string | null;
  website: string | null;
}

export async function fetchExpertHydration(userId: string): Promise<ExpertHydration | null> {
  const [{ data: prof, error: profErr }, adminRes, publicRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, slug, display_name, avatar_url, bio_pl, bio_en, twitter_url, linkedin_url, website_url",
      )
      .eq("id", userId)
      .maybeSingle(),
    adminGetAuthorProfile(userId).maybeSingle(),
    supabase
      .from("author_profiles_public")
      .select("job_title, website_url, x_url, linkedin_url, full_bio_pl, full_bio_en")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profErr) throw profErr;
  if (adminRes.error && publicRes.error) throw adminRes.error;
  if (!prof) return null;
  const p = prof as Record<string, unknown>;
  const a = (adminRes.data ?? publicRes.data ?? {}) as Record<string, unknown>;
  const pick = (...vals: unknown[]): string | null => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
    return null;
  };
  return {
    authorId: p.id as string,
    authorSlug: (p.slug as string | null) ?? null,
    photo: pick(p.avatar_url),
    name: pick(p.display_name),
    positionPl: pick(a.job_title),
    positionEn: pick(a.job_title),
    bioPl: pick(a.full_bio_pl, p.bio_pl),
    bioEn: pick(a.full_bio_en, p.bio_en),
    email: pick(a.contact_email),
    x: pick(a.x_url, p.twitter_url),
    linkedin: pick(a.linkedin_url, p.linkedin_url),
    website: pick(a.website_url, p.website_url),
  };
}
