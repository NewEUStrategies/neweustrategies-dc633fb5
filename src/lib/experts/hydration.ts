// Hydratacja danych eksperta do treści widgetów (jedno źródło prawdy).
//
// Używają jej edytory `team-member` oraz `author-profile-card`: po wybraniu
// osoby kopiujemy dane do `content`, więc renderer nie robi już żadnej sieci,
// a redakcja może nadpisać dowolne pole ręcznie.
//
// Trzy źródła `author_profiles` scalane priorytetem:
//  1) admin_get_author_profile() (SECURITY DEFINER) - pełny wiersz z
//     contact_email, ale WYŁĄCZNIE dla admina tego samego tenanta;
//  2) własny wiersz z tabeli bazowej (polityka "Owners can view own author
//     profile") - autor/editor hydrujący SWOJĄ kartę widzi stanowisko i bio
//     także PRZED publikacją profilu; dla cudzych wierszy RLS zwraca pusty
//     zbiór (nie błąd), bo tabela nie ma już polityk odczytu publicznego
//     (20260817120000);
//  3) publiczna projekcja author_profiles_public - profile opublikowane,
//     bez kolumn kontaktowych.
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
  const [{ data: prof, error: profErr }, adminRes, ownRes, publicRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, slug, display_name, avatar_url, bio_pl, bio_en, twitter_url, linkedin_url, website_url",
      )
      .eq("id", userId)
      .maybeSingle(),
    adminGetAuthorProfile(userId).maybeSingle(),
    supabase
      .from("author_profiles")
      .select("job_title, website_url, x_url, linkedin_url, full_bio_pl, full_bio_en")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("author_profiles_public")
      .select("job_title, website_url, x_url, linkedin_url, full_bio_pl, full_bio_en")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profErr) throw profErr;
  if (adminRes.error && publicRes.error) throw adminRes.error;
  if (!prof) return null;

  // Nakładka autorska z trzech ścieżek o RÓŻNYCH projekcjach: pełny wiersz
  // RPC admina, własny wiersz z tabeli (kolumny bezpieczne) albo publiczna
  // projekcja - stąd wszystkie pola opcjonalne, a contact_email obecny
  // wyłącznie w pierwszej. Kształt pilnowany przez kompilator, bez rzutowań.
  const overlay: {
    job_title?: string | null;
    website_url?: string | null;
    x_url?: string | null;
    linkedin_url?: string | null;
    full_bio_pl?: string | null;
    full_bio_en?: string | null;
    contact_email?: string | null;
  } = adminRes.data ?? ownRes.data ?? publicRes.data ?? {};

  const pick = (...vals: (string | null | undefined)[]): string | null => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
    return null;
  };
  return {
    authorId: prof.id,
    authorSlug: prof.slug,
    photo: pick(prof.avatar_url),
    name: pick(prof.display_name),
    positionPl: pick(overlay.job_title),
    positionEn: pick(overlay.job_title),
    bioPl: pick(overlay.full_bio_pl, prof.bio_pl),
    bioEn: pick(overlay.full_bio_en, prof.bio_en),
    email: pick(overlay.contact_email),
    x: pick(overlay.x_url, prof.twitter_url),
    linkedin: pick(overlay.linkedin_url, prof.linkedin_url),
    website: pick(overlay.website_url, prof.website_url),
  };
}
