// Warstwa danych widgetow prelegentow (speakers / event-schedule / dialog
// profilu prelegenta). Publiczna projekcja pochodzi z RPC get_public_speakers
// (SECURITY DEFINER, tenant z public_tenant_id(), wylacznie kolumny publiczne:
// profiles + author_profiles + profile_badges + speaker_profiles +
// event_speakers). Modul jest OSOBNY od widokow, zeby rejestr prefetchu SSR
// (lib/builder/prefetch.ts) widzial te same queryOptions co klient - klucz
// jest niezalezny od migawki, wiec streamowany widget nie refetchuje po
// hydratacji.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { edgeTtlCache } from "@/lib/ssrCache";

export type Lang = "pl" | "en";

/** Publiczny wiersz prelegenta - znormalizowany ksztalt dla UI. */
export interface PublicSpeakerRow {
  user_id: string;
  slug: string | null;
  display_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  company: string | null;
  headline_pl: string | null;
  headline_en: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  topics_pl: string[];
  topics_en: string[];
  languages: string[];
  talks_count: number;
  rating: number;
  reviews_count: number;
  is_expert: boolean;
  has_speaker_profile: boolean;
  sort_order: number;
}

export type SpeakersSource = "manual" | "directory" | "event";

export interface SpeakersInput {
  source: SpeakersSource;
  eventId: string;
  userIds: string[];
  limit: number;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const strArrOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Zrodlo danych widgetu speakers (legacy content bez pola = manual). */
export function speakersSource(c: WidgetContent): SpeakersSource {
  const raw = strOf(c.source);
  return raw === "directory" || raw === "event" ? raw : "manual";
}

/** Znormalizowany input zapytania - pochodna wylacznie tresci widgetu. */
export function speakersInput(c: WidgetContent): SpeakersInput {
  return {
    source: speakersSource(c),
    eventId: strOf(c.eventId),
    userIds: [],
    limit: Math.max(1, Math.min(200, Math.round(numOf(c.limit, 24)))),
  };
}

/** Mapowanie surowego wiersza RPC na znormalizowany ksztalt (unit-testowalne). */
export function mapSpeakerRow(raw: Record<string, unknown>): PublicSpeakerRow {
  return {
    user_id: strOf(raw.user_id),
    slug: strOf(raw.slug) || null,
    display_name: strOf(raw.display_name) || null,
    avatar_url: strOf(raw.avatar_url) || null,
    job_title: strOf(raw.job_title) || null,
    company: strOf(raw.company) || null,
    headline_pl: strOf(raw.headline_pl) || null,
    headline_en: strOf(raw.headline_en) || null,
    bio_pl: strOf(raw.bio_pl) || null,
    bio_en: strOf(raw.bio_en) || null,
    topics_pl: strArrOf(raw.topics_pl),
    topics_en: strArrOf(raw.topics_en),
    languages: strArrOf(raw.languages),
    talks_count: Math.max(0, numOf(raw.talks_count)),
    rating: Math.min(5, Math.max(0, numOf(raw.rating))),
    reviews_count: Math.max(0, numOf(raw.reviews_count)),
    is_expert: raw.is_expert === true,
    has_speaker_profile: raw.has_speaker_profile === true,
    sort_order: numOf(raw.sort_order),
  };
}

/**
 * Wywolanie RPC get_public_speakers. Rzutowanie przez `unknown`, bo funkcja
 * pochodzi z migracji 20260727200000, a wygenerowane typy Supabase nie zostaly
 * jeszcze odswiezone (ustalony idiom - patrz popular_post_ids w postListQuery).
 */
async function fetchPublicSpeakers(input: {
  eventId: string | null;
  userIds: string[] | null;
  limit: number;
}): Promise<PublicSpeakerRow[]> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: { p_event_id: string | null; p_user_ids: string[] | null; p_limit: number },
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )("get_public_speakers", {
    p_event_id: input.eventId,
    p_user_ids: input.userIds && input.userIds.length ? input.userIds : null,
    p_limit: input.limit,
  });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map(mapSpeakerRow)
    .filter((row) => row.user_id !== "");
}

/** Prelegenci widgetu speakers (source: directory | event). */
export const speakersQueryOptions = (c: WidgetContent, _lang: Lang) => {
  const input = speakersInput(c);
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.speakers, input] as const,
    queryFn: () =>
      // Tryb "event" bez wybranego wydarzenia = stan nieskonfigurowany:
      // pusta lista (widget pokazuje empty state), a NIE pelny katalog
      // (p_event_id NULL przelaczylby RPC w tryb katalogu).
      input.source === "event" && !input.eventId
        ? Promise.resolve([] as PublicSpeakerRow[])
        : edgeTtlCache(`builder:speakers:${JSON.stringify(input)}`, 60_000, () =>
            fetchPublicSpeakers({
              eventId: input.source === "event" ? input.eventId : null,
              userIds: null,
              limit: input.limit,
            }),
          ),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};

/**
 * Prelegenci wskazani po user_id (sesje agendy w event-schedule). Lista id
 * jest sortowana w kluczu, zeby kolejnosc w tresci nie unieważniala cache.
 */
export const speakersByIdsQueryOptions = (userIds: string[]) => {
  const ids = Array.from(new Set(userIds)).sort();
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.speakersByIds, ids] as const,
    queryFn: () =>
      ids.length === 0
        ? Promise.resolve([] as PublicSpeakerRow[])
        : edgeTtlCache(`builder:speakers-by-ids:${ids.join(",")}`, 60_000, () =>
            fetchPublicSpeakers({ eventId: null, userIds: ids, limit: 200 }),
          ),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};

/** Pojedynczy profil prelegenta (dialog profilu). */
export const speakerProfileQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.publicSpeakerProfile, userId] as const,
    queryFn: async (): Promise<PublicSpeakerRow | null> => {
      if (!userId) return null;
      const rows = await fetchPublicSpeakers({ eventId: null, userIds: [userId], limit: 1 });
      return rows[0] ?? null;
    },
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });

/** Wystapienie prelegenta (opublikowane wydarzenie, na ktorym mowi/mowil). */
export interface SpeakerEngagement {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  starts_at: string;
  kind: string;
  location: string | null;
}

/**
 * Wystapienia prelegenta: klienckie zlaczenie event_speakers -> events (oba
 * publicznie czytelne przez RLS), bez dodatkowego RPC. Zwraca opublikowane
 * wydarzenia posortowane od najnowszych.
 */
async function fetchSpeakerEngagements(
  userId: string,
  limit: number,
): Promise<SpeakerEngagement[]> {
  const { data: links, error: linksError } = await supabase
    .from("event_speakers")
    .select("event_id")
    .eq("user_id", userId);
  if (linksError) throw linksError;
  const eventIds = (links ?? []).map((r: { event_id: string }) => r.event_id);
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from("events")
    .select("id, slug, title_pl, title_en, starts_at, kind, location")
    .in("id", eventIds)
    .eq("status", "published")
    .order("starts_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SpeakerEngagement[];
}

export const speakerEngagementsQueryOptions = (userId: string, limit = 8) =>
  queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.publicSpeakerEngagements, userId, limit] as const,
    queryFn: () => (userId ? fetchSpeakerEngagements(userId, limit) : Promise.resolve([])),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
