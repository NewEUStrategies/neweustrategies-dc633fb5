// Reputacja społeczności: poziomy liczone z punktów kontrybucji (RPC
// get_contributor_leaderboard / get_my_reputation; wagi w migracji
// 20260721152000) + katalog poziomów PL/EN. Progi to czysta prezentacja -
// jedno źródło prawdy dla tablicy kontrybutorów, profilu i chipów.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReputationLevelKey = "observer" | "participant" | "voice" | "expert" | "pillar";

export interface ReputationLevel {
  key: ReputationLevelKey;
  /** Minimalna liczba punktów otwierająca poziom. */
  min: number;
  pl: string;
  en: string;
}

/** Rosnąco po progach - levelForPoints wybiera ostatni osiągnięty. */
export const REPUTATION_LEVELS: readonly ReputationLevel[] = [
  { key: "observer", min: 0, pl: "Obserwator", en: "Observer" },
  { key: "participant", min: 50, pl: "Uczestnik", en: "Participant" },
  { key: "voice", min: 150, pl: "Głos społeczności", en: "Community voice" },
  { key: "expert", min: 400, pl: "Ekspert społeczności", en: "Community expert" },
  { key: "pillar", min: 1000, pl: "Filar społeczności", en: "Community pillar" },
] as const;

export function levelForPoints(points: number): ReputationLevel {
  const safe = Number.isFinite(points) ? Math.max(0, points) : 0;
  let current = REPUTATION_LEVELS[0];
  for (const level of REPUTATION_LEVELS) {
    if (safe >= level.min) current = level;
  }
  return current;
}

export function nextLevelFor(points: number): ReputationLevel | null {
  const safe = Number.isFinite(points) ? Math.max(0, points) : 0;
  return REPUTATION_LEVELS.find((level) => level.min > safe) ?? null;
}

/** Postęp 0..1 do następnego poziomu (1 dla najwyższego). */
export function progressToNextLevel(points: number): number {
  const safe = Number.isFinite(points) ? Math.max(0, points) : 0;
  const current = levelForPoints(safe);
  const next = nextLevelFor(safe);
  if (!next) return 1;
  const span = next.min - current.min;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (safe - current.min) / span));
}

export function levelName(level: ReputationLevel, lang: string): string {
  return lang === "en" ? level.en : level.pl;
}

/** Źródła punktów raportowane przez breakdown RPC (wagi w migracji). */
export type ReputationSourceKey =
  | "qa_answered"
  | "qa_approved"
  | "qa_votes_received"
  | "events_attended"
  | "comments"
  | "poll_votes"
  | "submissions_accepted"
  | "badge_expert"
  | "badge_contributor"
  | "badge_verified";

export interface ReputationBreakdownEntry {
  count: number;
  points: number;
}

export type ReputationBreakdown = Partial<Record<ReputationSourceKey, ReputationBreakdownEntry>>;

function parseBreakdown(raw: unknown): ReputationBreakdown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ReputationBreakdown = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    out[key as ReputationSourceKey] = {
      count: typeof entry.count === "number" ? entry.count : 0,
      points: typeof entry.points === "number" ? entry.points : 0,
    };
  }
  return out;
}

export interface LeaderboardEntry {
  position: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  slug: string | null;
  points: number;
  breakdown: ReputationBreakdown;
}

/**
 * Tablica kontrybutorów: wyłącznie profile z opt-in katalogu (discoverable)
 * i bez kont redakcyjnych - prywatność egzekwuje RPC, nie klient.
 */
export async function fetchContributorLeaderboard(
  days: number,
  limit = 20,
): Promise<LeaderboardEntry[]> {
  // `as never`: RPC z migracji 20260721152000, jeszcze nie w wygenerowanych
  // typach - do usunięcia przy regeneracji types.ts.
  const { data, error } = await supabase.rpc(
    "get_contributor_leaderboard" as never,
    { p_days: days, p_limit: limit } as never,
  );
  if (error) throw error;
  // RPC zwraca board_position ('position' to słowo zarezerwowane w RETURNS TABLE).
  const rows = (data ?? []) as unknown as Array<
    Omit<LeaderboardEntry, "breakdown" | "position"> & {
      board_position: number;
      breakdown: unknown;
    }
  >;
  return rows.map(({ board_position, breakdown, ...row }) => ({
    ...row,
    position: board_position,
    breakdown: parseBreakdown(breakdown),
  }));
}

export function useContributorLeaderboard(
  days: number,
  limit = 20,
  enabled = true,
): UseQueryResult<LeaderboardEntry[]> {
  return useQuery({
    queryKey: ["contributor-leaderboard", days, limit],
    queryFn: () => fetchContributorLeaderboard(days, limit),
    enabled,
    staleTime: 60_000,
  });
}

export interface MyReputation {
  points: number;
  breakdown: ReputationBreakdown;
  window_days: number;
  board_visible: boolean;
  position: number | null;
}

/** Własny wynik - widoczny także bez opt-in do tablicy (bez pozycji). */
export async function fetchMyReputation(days: number): Promise<MyReputation> {
  // `as never`: RPC z migracji 20260721152000, jeszcze nie w wygenerowanych
  // typach - do usunięcia przy regeneracji types.ts.
  const { data, error } = await supabase.rpc(
    "get_my_reputation" as never,
    { p_days: days } as never,
  );
  if (error) throw error;
  const obj = (data ?? {}) as Record<string, unknown>;
  return {
    points: typeof obj.points === "number" ? obj.points : 0,
    breakdown: parseBreakdown(obj.breakdown),
    window_days: typeof obj.window_days === "number" ? obj.window_days : days,
    board_visible: obj.board_visible === true,
    position: typeof obj.position === "number" ? obj.position : null,
  };
}

export function useMyReputation(
  days: number,
  userId: string | undefined,
): UseQueryResult<MyReputation> {
  return useQuery({
    queryKey: ["my-reputation", days, userId ?? "anon"],
    queryFn: () => fetchMyReputation(days),
    enabled: !!userId,
    staleTime: 60_000,
  });
}
