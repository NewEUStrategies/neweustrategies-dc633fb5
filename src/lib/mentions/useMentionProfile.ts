// Lekki podgląd osoby po slugu - dla dymka nad @wzmianką i nad pozycją listy
// podpowiedzi. Czytamy z `profiles_public` (publiczna projekcja bez PII,
// izolowana tenantem przez RLS widoku), a nie z pełnego huba eksperta: dymek
// potrzebuje pięciu pól, a nie materiałów, faset i mediów.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MentionProfilePreview {
  slug: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  verified: boolean;
}

const COLS =
  "slug, display_name, first_name, last_name, avatar_url, job_title, current_company, specialization, bio_pl, bio_en, verified_at";

function trimText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, max);
}

export function useMentionProfile(slug: string | null, lang: "pl" | "en", enabled: boolean) {
  return useQuery({
    queryKey: ["club", "mention-profile", slug, lang] as const,
    enabled: enabled && typeof slug === "string" && slug.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<MentionProfilePreview | null> => {
      if (slug === null) return null;
      const { data, error } = await supabase
        .from("profiles_public")
        .select(COLS)
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      if (data === null) return null;
      const row = data as Record<string, unknown>;
      const name =
        trimText(row.display_name, 120) ??
        trimText([row.first_name, row.last_name].filter(Boolean).join(" "), 120) ??
        slug;
      return {
        slug,
        name,
        avatarUrl: trimText(row.avatar_url, 2048),
        jobTitle: trimText(row.job_title, 120) ?? trimText(row.specialization, 120),
        company: trimText(row.current_company, 120),
        bio: trimText(lang === "en" ? row.bio_en : row.bio_pl, 240),
        verified: typeof row.verified_at === "string" && row.verified_at.length > 0,
      };
    },
  });
}
