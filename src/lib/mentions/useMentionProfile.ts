// Lekki podgląd celu @wzmianki - osoby albo firmy. Czytamy przez publiczny,
// tenant-scoped RPC, który oddaje tylko pola do wizytówki (bez PII i notatek CRM).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MentionProfilePreview {
  kind: "person" | "organization";
  id: string;
  slug: string;
  name: string;
  avatarUrl: string | null;
  logoUrl: string | null;
  jobTitle: string | null;
  company: string | null;
  website: string | null;
  bio: string | null;
  verified: boolean;
}

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
      const { data, error } = await supabase.rpc("get_mention_target", { _slug: slug });
      if (error) throw error;
      const row = data?.[0];
      if (row === undefined) return null;
      const kind = row.kind === "organization" ? "organization" : "person";
      const name = trimText(row.label, 120) ?? slug;
      const subtitle = trimText(row.subtitle, 120);
      return {
        kind,
        id: row.id,
        slug,
        name,
        avatarUrl: trimText(row.avatar_url, 2048),
        logoUrl: trimText(row.logo_url, 2048),
        jobTitle: kind === "person" ? subtitle : null,
        company: kind === "person" ? null : subtitle,
        website: trimText(row.website, 2048),
        bio: null,
        verified: row.verified === true,
      };
    },
  });
}
