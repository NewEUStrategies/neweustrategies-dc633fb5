import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isProfileBadgeKind, type ProfileBadgeKind } from "@/lib/profile/badgeCatalog";

export const BADGE_GRANT_SOURCES = [
  "manual",
  "reputation",
  "contributor_submission",
  "system",
] as const;

export type BadgeGrantSource = (typeof BADGE_GRANT_SOURCES)[number];

export interface AdminBadgeRow extends Omit<
  Database["public"]["Tables"]["profile_badges"]["Row"],
  "badge" | "grant_source"
> {
  badge: ProfileBadgeKind;
  grant_source: BadgeGrantSource;
  member_display_name: string | null;
  member_email: string | null;
  member_avatar_url: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isBadgeGrantSource(value: unknown): value is BadgeGrantSource {
  return typeof value === "string" && (BADGE_GRANT_SOURCES as readonly string[]).includes(value);
}

function requireUuid(value: string, field: string): string {
  const normalized = value.trim();
  if (!UUID_RE.test(normalized)) throw new Error(`${field}: invalid UUID`);
  return normalized;
}

function normalizeNote(note: string | undefined): string | null {
  const normalized = note?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > 500) throw new Error("Badge note cannot exceed 500 characters");
  return normalized;
}

export async function fetchBadges(limit = 300): Promise<AdminBadgeRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const { data, error } = await supabase.rpc("admin_list_profile_badges", {
    p_limit: safeLimit,
  });
  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    if (!isProfileBadgeKind(row.badge) || !isBadgeGrantSource(row.grant_source)) return [];
    return [{ ...row, badge: row.badge, grant_source: row.grant_source }];
  });
}

export async function grantBadge(
  userId: string,
  badge: ProfileBadgeKind,
  note?: string,
): Promise<string> {
  if (!isProfileBadgeKind(badge)) throw new Error("Unsupported badge kind");
  const { data, error } = await supabase.rpc("admin_grant_profile_badge", {
    p_user_id: requireUuid(userId, "userId"),
    p_badge: badge,
    p_note: normalizeNote(note) ?? undefined,
  });
  if (error) throw error;
  if (!data) throw new Error("Badge grant was not persisted");
  return data;
}

export async function revokeBadge(id: string): Promise<void> {
  const { data, error } = await supabase.rpc("admin_revoke_profile_badge", {
    p_badge_id: requireUuid(id, "badgeId"),
  });
  if (error) throw error;
  if (!data) throw new Error("Badge was not found in the active tenant");
}

export async function revokeUserBadge(userId: string, badge: ProfileBadgeKind): Promise<void> {
  if (!isProfileBadgeKind(badge)) throw new Error("Unsupported badge kind");
  const { data, error } = await supabase.rpc("admin_revoke_user_profile_badge", {
    p_user_id: requireUuid(userId, "userId"),
    p_badge: badge,
  });
  if (error) throw error;
  if (!data) throw new Error("Badge was not found in the active tenant");
}
