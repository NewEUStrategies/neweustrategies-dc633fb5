// Public read-only research-program queries (anon-safe via RLS).
//
// A research program is a top-level container (CSIS/RUSI pattern), not a content
// category: it owns a thesis, scope, team, projects, curated content (flagship
// reports, podcasts, events), partners and contact details. "Latest
// publications" are NOT curated - they flow automatically from the linked
// category via post_categories. Curation only covers flagship reports,
// podcasts and events (there is no taxonomy for those).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BlogListItem } from "@/lib/queries/public";
import type { PublicEvent } from "@/lib/community/publicQueries";
import type { Podcast } from "@/lib/podcast/types";
import { normalizeQuestions, orderByIds, type ResearchQuestion } from "@/lib/programs/shape";

const TTL = 60_000;

export type { ResearchQuestion };

export interface Program {
  id: string;
  tenant_id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  tagline_pl: string | null;
  tagline_en: string | null;
  scope_pl: string | null;
  scope_en: string | null;
  research_questions: ResearchQuestion[];
  icon: string;
  accent_color: string;
  hero_image_url: string | null;
  category_id: string | null;
  contact_email: string | null;
  sort_order: number;
  status: string;
  updated_at: string;
  created_at: string;
}

export interface ProgramMember {
  program_id: string;
  profile_id: string;
  display_name: string;
  avatar_url: string | null;
  job_title: string | null;
  profile_slug: string | null;
  member_role_pl: string | null;
  member_role_en: string | null;
  is_lead: boolean;
  sort_order: number;
}

export interface ProgramProject {
  id: string;
  name_pl: string;
  name_en: string;
  summary_pl: string | null;
  summary_en: string | null;
  project_status: "planned" | "active" | "completed";
  url: string | null;
  sort_order: number;
}

export interface ProgramPartner {
  id: string;
  name: string;
  logo_url: string | null;
  url: string | null;
  sort_order: number;
}

export interface ProgramLanding {
  program: Program;
  lead: ProgramMember | null;
  team: ProgramMember[];
  projects: ProgramProject[];
  partners: ProgramPartner[];
  flagshipReports: BlogListItem[];
  latestPublications: BlogListItem[];
  podcasts: Podcast[];
  events: PublicEvent[];
}

const PROGRAM_FIELDS =
  "id,tenant_id,slug,name_pl,name_en,tagline_pl,tagline_en,scope_pl,scope_en," +
  "research_questions,icon,accent_color,hero_image_url,category_id,contact_email," +
  "sort_order,status,updated_at,created_at";

const POST_COLS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, author_id";

const PODCAST_FIELDS =
  "id,tenant_id,slug,title_pl,title_en,excerpt_pl,excerpt_en,show_notes_pl,show_notes_en," +
  "transcript_pl,transcript_en,audio_url,duration_seconds,episode_number,season," +
  "cover_image_url,status,published_at,author_id,created_at,updated_at";

const EVENT_COLUMNS =
  "id, slug, title_pl, title_en, description_pl, description_en, starts_at, ends_at, " +
  "timezone, location, kind, capacity, status, chatham_house, cover_url, host_user_id, " +
  "visibility, min_tier_rank";

function coerceProgram(row: Record<string, unknown>): Program {
  return {
    ...(row as unknown as Program),
    research_questions: normalizeQuestions(row.research_questions),
  };
}

/** Resolve public hrefs for post rows (mirrors the archive hydration). */
async function hydrateHref(rows: Array<Omit<BlogListItem, "href">>): Promise<BlogListItem[]> {
  if (rows.length === 0) return [];
  const parentIds = Array.from(new Set(rows.map((r) => r.parent_page_id)));
  const paths = new Map<string, string>();
  await Promise.all(
    parentIds.map(async (pid) => {
      const { data } = await supabase.rpc("page_full_path", { _page_id: pid });
      if (typeof data === "string") paths.set(pid, data);
    }),
  );
  return rows.map((r) => ({
    ...r,
    href: `/${paths.get(r.parent_page_id) ?? "blog"}/${r.slug}`,
  }));
}

// ---------- INDEX ----------------------------------------------------------

export const PROGRAMS_INDEX_LIMIT = 24;

export const latestProgramsQueryOptions = (limit = PROGRAMS_INDEX_LIMIT) =>
  queryOptions({
    queryKey: ["programs", "list", limit] as const,
    queryFn: async (): Promise<Program[]> => {
      const { data, error } = await supabase
        .from("research_programs")
        .select(PROGRAM_FIELDS)
        .eq("status", "published")
        .order("sort_order", { ascending: true })
        .order("name_pl", { ascending: true })
        .limit(Math.max(1, Math.min(limit, 100)));
      if (error) throw error;
      return (data ?? []).map((r) => coerceProgram(r as unknown as Record<string, unknown>));
    },
    staleTime: TTL,
  });

// ---------- DETAIL (full landing bundle) -----------------------------------

export const programBySlugQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["programs", "landing", slug] as const,
    queryFn: async (): Promise<ProgramLanding | null> => {
      const { data: progRow, error: progErr } = await supabase
        .from("research_programs")
        .select(PROGRAM_FIELDS)
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (progErr) throw progErr;
      if (!progRow) return null;
      const program = coerceProgram(progRow as unknown as Record<string, unknown>);

      // Child collections + curated items, fetched in parallel.
      const [membersRes, projectsRes, partnersRes, itemsRes] = await Promise.all([
        supabase.rpc("get_program_members", { p_program_ids: [program.id] }),
        supabase
          .from("research_program_projects")
          .select("id,name_pl,name_en,summary_pl,summary_en,project_status,url,sort_order")
          .eq("program_id", program.id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("research_program_partners")
          .select("id,name,logo_url,url,sort_order")
          .eq("program_id", program.id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("research_program_items")
          .select("item_type,post_id,podcast_id,event_id,sort_order")
          .eq("program_id", program.id)
          .order("sort_order", { ascending: true }),
      ]);
      if (membersRes.error) throw membersRes.error;
      if (projectsRes.error) throw projectsRes.error;
      if (partnersRes.error) throw partnersRes.error;
      if (itemsRes.error) throw itemsRes.error;

      const teamRows = (membersRes.data ?? []) as unknown as ProgramMember[];
      const team = teamRows.map((m) => ({ ...m }));
      const lead = team.find((m) => m.is_lead) ?? null;

      const projects = (projectsRes.data ?? []) as unknown as ProgramProject[];
      const partners = (partnersRes.data ?? []) as unknown as ProgramPartner[];

      const items = (itemsRes.data ?? []) as Array<{
        item_type: string;
        post_id: string | null;
        podcast_id: string | null;
        event_id: string | null;
        sort_order: number;
      }>;
      const flagshipPostIds = items
        .filter((i) => i.item_type === "flagship_post" && i.post_id)
        .map((i) => i.post_id as string);
      const podcastIds = items
        .filter((i) => i.item_type === "podcast" && i.podcast_id)
        .map((i) => i.podcast_id as string);
      const eventIds = items
        .filter((i) => i.item_type === "event" && i.event_id)
        .map((i) => i.event_id as string);

      // Latest publications flow from the linked category (auto, not curated).
      const publicationPromise = (async (): Promise<BlogListItem[]> => {
        if (!program.category_id) return [];
        const { data: pivot, error: pivotErr } = await supabase
          .from("post_categories")
          .select("post_id")
          .eq("category_id", program.category_id);
        if (pivotErr) throw pivotErr;
        const ids = (pivot ?? []).map((r) => r.post_id as string);
        if (ids.length === 0) return [];
        const { data: rows, error } = await supabase
          .from("posts")
          .select(POST_COLS)
          .in("id", ids)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("published_at", { ascending: false })
          .limit(6);
        if (error) throw error;
        return hydrateHref((rows ?? []) as Array<Omit<BlogListItem, "href">>);
      })();

      const flagshipPromise = (async (): Promise<BlogListItem[]> => {
        if (flagshipPostIds.length === 0) return [];
        const { data: rows, error } = await supabase
          .from("posts")
          .select(POST_COLS)
          .in("id", flagshipPostIds)
          .eq("status", "published")
          .is("deleted_at", null);
        if (error) throw error;
        const hydrated = await hydrateHref((rows ?? []) as Array<Omit<BlogListItem, "href">>);
        // Preserve the curator's ordering (sort_order), not published_at.
        return orderByIds(hydrated, flagshipPostIds, (r) => r.id);
      })();

      const podcastPromise = (async (): Promise<Podcast[]> => {
        if (podcastIds.length === 0) return [];
        const { data: rows, error } = await supabase
          .from("podcasts")
          .select(PODCAST_FIELDS)
          .in("id", podcastIds)
          .eq("status", "published")
          .is("deleted_at", null);
        if (error) throw error;
        const list = (rows ?? []) as unknown as Podcast[];
        return orderByIds(list, podcastIds, (r) => r.id);
      })();

      const eventPromise = (async (): Promise<PublicEvent[]> => {
        if (eventIds.length === 0) return [];
        const { data: rows, error } = await supabase
          .from("events")
          .select(EVENT_COLUMNS)
          .in("id", eventIds)
          .eq("status", "published");
        if (error) throw error;
        const list = (rows ?? []) as unknown as PublicEvent[];
        return orderByIds(list, eventIds, (r) => r.id);
      })();

      const [latestPublications, flagshipReports, podcasts, events] = await Promise.all([
        publicationPromise,
        flagshipPromise,
        podcastPromise,
        eventPromise,
      ]);

      return {
        program,
        lead,
        team,
        projects,
        partners,
        flagshipReports,
        latestPublications,
        podcasts,
        events,
      };
    },
    staleTime: TTL,
    enabled: !!slug,
  });
