// Publiczny profil CV autora — dane pochodzą z tabel `profile_experiences`,
// `profile_education`, `profile_skills`, `profile_awards`, `profile_hobbies`.
// Wszystkie mają publiczne polityki SELECT (anon), więc renderujemy je
// bezpośrednio przez klienta publikacyjnego.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const TTL = 5 * 60_000;

export interface AuthorExperience {
  id: string;
  role_title: string | null;
  company: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean | null;
  description: string | null;
  logo_url: string | null;
}

export interface AuthorEducation {
  id: string;
  school: string | null;
  degree: string | null;
  field: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  logo_url: string | null;
}

export interface AuthorSkill {
  id: string;
  label: string;
  level: number | null;
  category: string | null;
}

export interface AuthorAward {
  id: string;
  title: string;
  issuer: string | null;
  awarded_at: string | null;
  description: string | null;
  icon: string | null;
  url: string | null;
  kind: string | null;
}

export interface AuthorHobby {
  id: string;
  label: string;
  icon: string | null;
}

export interface AuthorCv {
  experiences: AuthorExperience[];
  education: AuthorEducation[];
  skills: AuthorSkill[];
  awards: AuthorAward[];
  hobbies: AuthorHobby[];
}

export const authorCvQueryOptions = (userId: string | null | undefined) =>
  queryOptions({
    queryKey: ["public", "author-cv", userId ?? "none"] as const,
    queryFn: async (): Promise<AuthorCv> => {
      if (!userId) return { experiences: [], education: [], skills: [], awards: [], hobbies: [] };
      const [exp, edu, sk, aw, ho] = await Promise.all([
        supabase
          .from("profile_experiences")
          .select(
            "id, role_title, company, location, start_date, end_date, is_current, description, logo_url",
          )
          .eq("user_id", userId)
          .order("sort_order", { ascending: true })
          .order("start_date", { ascending: false }),
        supabase
          .from("profile_education")
          .select("id, school, degree, field, start_date, end_date, description, logo_url")
          .eq("user_id", userId)
          .order("sort_order", { ascending: true })
          .order("start_date", { ascending: false }),
        supabase
          .from("profile_skills")
          .select("id, label, level, category")
          .eq("user_id", userId)
          .order("sort_order", { ascending: true })
          .order("label", { ascending: true }),
        supabase
          .from("profile_awards")
          .select("id, title, issuer, awarded_at, description, icon, url, kind")
          .eq("user_id", userId)
          .order("sort_order", { ascending: true })
          .order("awarded_at", { ascending: false }),
        supabase
          .from("profile_hobbies")
          .select("id, label, icon")
          .eq("user_id", userId)
          .order("sort_order", { ascending: true })
          .order("label", { ascending: true }),
      ]);
      return {
        experiences: (exp.data ?? []) as AuthorExperience[],
        education: (edu.data ?? []) as AuthorEducation[],
        skills: (sk.data ?? []) as AuthorSkill[],
        awards: (aw.data ?? []) as AuthorAward[],
        hobbies: (ho.data ?? []) as AuthorHobby[],
      };
    },
    staleTime: TTL,
  });
