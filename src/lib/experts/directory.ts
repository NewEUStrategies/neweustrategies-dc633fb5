// Publiczny katalog ekspertów (/experts). Ekspert = konto z odznaką 'expert'
// oraz publicznym profilem autorskim (is_public). Zwraca wpisy z obszarami,
// programami i liczbą publikacji (lekki "dowód kompetencji") plus fasety.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExpertiseArea } from "./types";

const TTL = 2 * 60_000;

export interface ExpertDirectoryProgram {
  id: string;
  name_pl: string;
  name_en: string;
}

export interface ExpertDirectoryEntry {
  id: string;
  slug: string | null;
  display_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  company: string | null;
  verified_at: string | null;
  areas: ExpertiseArea[];
  programs: ExpertDirectoryProgram[];
  postCount: number;
}

export interface ExpertsDirectoryData {
  experts: ExpertDirectoryEntry[];
  facets: {
    areas: ExpertiseArea[];
    programs: ExpertDirectoryProgram[];
  };
}

export const expertsDirectoryQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "experts-directory"] as const,
    queryFn: async (): Promise<ExpertsDirectoryData> => {
      const { data: badgeRows, error: badgeErr } = await supabase
        .from("profile_badges")
        .select("user_id")
        .eq("badge", "expert");
      if (badgeErr) throw badgeErr;
      const expertIds = Array.from(
        new Set((badgeRows ?? []).map((b) => (b as { user_id: string }).user_id)),
      );
      if (expertIds.length === 0) {
        return { experts: [], facets: { areas: [], programs: [] } };
      }

      const [
        { data: profs, error: profErr },
        { data: aps, error: apErr },
        { data: areaLinks },
        { data: memberLinks },
        { data: postRows },
      ] = await Promise.all([
        supabase
          .from("profiles_public")
          .select("id, slug, display_name, avatar_url, verified_at")
          .in("id", expertIds),
        supabase
          .from("author_profiles")
          .select("user_id, job_title, company, is_public")
          .in("user_id", expertIds),
        supabase
          .from("expert_expertise_areas")
          .select("user_id, sort_order, area:expertise_areas(id, slug, name_pl, name_en)")
          .in("user_id", expertIds)
          .order("sort_order", { ascending: true }),
        supabase
          .from("program_members")
          .select("user_id, sort_order, program:programs(id, name_pl, name_en)")
          .in("user_id", expertIds)
          .order("sort_order", { ascending: true }),
        supabase
          .from("posts")
          .select("author_id")
          .in("author_id", expertIds)
          .eq("status", "published")
          .is("deleted_at", null),
      ]);
      if (profErr) throw profErr;
      if (apErr) throw apErr;

      // Tylko eksperci z publicznym profilem autorskim.
      type ApLite = { job_title: string | null; company: string | null };
      const publicApByUser = new Map<string, ApLite>();
      for (const row of (aps ?? []) as Record<string, unknown>[]) {
        if (row.is_public === true) {
          publicApByUser.set(row.user_id as string, {
            job_title: (row.job_title as string | null) ?? null,
            company: (row.company as string | null) ?? null,
          });
        }
      }

      const areasByUser = new Map<string, ExpertiseArea[]>();
      for (const row of (areaLinks ?? []) as Record<string, unknown>[]) {
        const uid = row.user_id as string;
        const a = row.area as Record<string, unknown> | null;
        if (!a) continue;
        const list = areasByUser.get(uid) ?? [];
        list.push({
          id: a.id as string,
          slug: a.slug as string,
          name_pl: a.name_pl as string,
          name_en: a.name_en as string,
        });
        areasByUser.set(uid, list);
      }

      const programsByUser = new Map<string, ExpertDirectoryProgram[]>();
      for (const row of (memberLinks ?? []) as Record<string, unknown>[]) {
        const uid = row.user_id as string;
        const p = row.program as Record<string, unknown> | null;
        if (!p) continue;
        const list = programsByUser.get(uid) ?? [];
        list.push({
          id: p.id as string,
          name_pl: p.name_pl as string,
          name_en: p.name_en as string,
        });
        programsByUser.set(uid, list);
      }

      const postCountByUser = new Map<string, number>();
      for (const row of (postRows ?? []) as { author_id: string | null }[]) {
        if (!row.author_id) continue;
        postCountByUser.set(row.author_id, (postCountByUser.get(row.author_id) ?? 0) + 1);
      }

      const experts: ExpertDirectoryEntry[] = ((profs ?? []) as Record<string, unknown>[])
        .filter((p) => publicApByUser.has(p.id as string))
        .map((p) => {
          const id = p.id as string;
          const ap = publicApByUser.get(id)!;
          return {
            id,
            slug: (p.slug as string | null) ?? null,
            display_name: (p.display_name as string | null) ?? null,
            avatar_url: (p.avatar_url as string | null) ?? null,
            job_title: ap.job_title,
            company: ap.company,
            verified_at: (p.verified_at as string | null) ?? null,
            areas: areasByUser.get(id) ?? [],
            programs: programsByUser.get(id) ?? [],
            postCount: postCountByUser.get(id) ?? 0,
          };
        })
        .sort((a, b) =>
          (a.display_name ?? "").localeCompare(b.display_name ?? "", undefined, {
            sensitivity: "base",
          }),
        );

      // Fasety zredukowane do wartości obecnych wśród widocznych ekspertów.
      const areaMap = new Map<string, ExpertiseArea>();
      const progMap = new Map<string, ExpertDirectoryProgram>();
      for (const e of experts) {
        for (const a of e.areas) areaMap.set(a.id, a);
        for (const pr of e.programs) progMap.set(pr.id, pr);
      }

      return {
        experts,
        facets: {
          areas: [...areaMap.values()].sort((a, b) =>
            a.name_pl.localeCompare(b.name_pl, undefined, { sensitivity: "base" }),
          ),
          programs: [...progMap.values()].sort((a, b) =>
            a.name_pl.localeCompare(b.name_pl, undefined, { sensitivity: "base" }),
          ),
        },
      };
    },
    staleTime: TTL,
  });
