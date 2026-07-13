// Pure notification-preference gating, extracted from NotificationsCenter.tsx.
// Type-only imports from useNotifications keep this module free of the Supabase
// client (so it is unit-testable and safe to import anywhere).
import type { NotificationKind, NotificationPreferences } from "./useNotifications";

/**
 * Kinds the user can toggle in settings. `security` is intentionally excluded:
 * security alerts are always delivered and rendered as an always-on switch.
 */
export const TOGGLEABLE_NOTIFICATION_KINDS = [
  "message",
  "comment",
  "follow",
  "subscription",
  "content",
  "tracker",
  "system",
] as const satisfies readonly NotificationKind[];

/**
 * Whether a notification kind is enabled for this user. `security` is always
 * enabled regardless of stored preferences; every other kind maps to its
 * `enabled_<kind>` flag. Unknown/missing flags default to enabled (fail-open),
 * matching the DEFAULT_NOTIFICATION_PREFERENCES seed.
 */
export function isNotificationKindEnabled(
  prefs: NotificationPreferences,
  kind: NotificationKind,
): boolean {
  if (kind === "security") return true;
  const value = prefs[`enabled_${kind}` as keyof NotificationPreferences];
  return typeof value === "boolean" ? value : true;
}
