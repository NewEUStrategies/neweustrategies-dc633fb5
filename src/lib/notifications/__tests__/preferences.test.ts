import { describe, it, expect } from "vitest";
import { TOGGLEABLE_NOTIFICATION_KINDS, isNotificationKindEnabled } from "../preferences";
import type { NotificationPreferences } from "../useNotifications";

const prefs: NotificationPreferences = {
  enabled_message: true,
  enabled_comment: false,
  enabled_follow: true,
  enabled_subscription: false,
  enabled_content: true,
  enabled_system: true,
  enabled_security: true,
  enabled_tracker: true,
  enabled_connection: true,
  auto_mark_on_open: true,
  group_by_conversation: true,
  read_receipts_enabled: true,
  typing_indicators_enabled: true,
  show_online_status: true,
  allow_messages_from: "everyone",
  allow_connections_from: "everyone",
  push_enabled: false,
  email_digest: "off",
  chat_bell_enabled: true,
};

describe("TOGGLEABLE_NOTIFICATION_KINDS", () => {
  it("lists the user-toggleable kinds and excludes security", () => {
    expect([...TOGGLEABLE_NOTIFICATION_KINDS]).toEqual([
      "message",
      "comment",
      "follow",
      "connection",
      "subscription",
      "content",
      "tracker",
      "system",
    ]);
    expect(TOGGLEABLE_NOTIFICATION_KINDS).not.toContain("security");
  });
});

describe("isNotificationKindEnabled", () => {
  it("gates each kind on its enabled_<kind> flag", () => {
    expect(isNotificationKindEnabled(prefs, "message")).toBe(true);
    expect(isNotificationKindEnabled(prefs, "comment")).toBe(false);
    expect(isNotificationKindEnabled(prefs, "subscription")).toBe(false);
    expect(isNotificationKindEnabled(prefs, "content")).toBe(true);
  });

  it("always reports security as enabled, regardless of the stored flag", () => {
    expect(isNotificationKindEnabled(prefs, "security")).toBe(true);
    const off = { ...prefs, enabled_security: false };
    expect(isNotificationKindEnabled(off, "security")).toBe(true);
  });
});
