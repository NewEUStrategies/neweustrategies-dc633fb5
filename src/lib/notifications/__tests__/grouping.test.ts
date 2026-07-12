import { describe, it, expect } from "vitest";
import { groupNotifications } from "../grouping";
import type { NotificationRow } from "../useNotifications";

const CONV = "11111111-1111-1111-1111-111111111111";

function n(overrides: Partial<NotificationRow> & { id: string }): NotificationRow {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "message",
    href: overrides.href ?? null,
    read_at: overrides.read_at ?? null,
    created_at: overrides.created_at ?? "2026-01-01T10:00:00.000Z",
    tenant_id: overrides.tenant_id ?? "tenant-1",
    user_id: overrides.user_id ?? "user-1",
    title_pl: overrides.title_pl ?? "Tytuł",
    title_en: overrides.title_en ?? null,
    body_pl: overrides.body_pl ?? null,
    body_en: overrides.body_en ?? null,
    icon: overrides.icon ?? null,
  };
}

describe("groupNotifications", () => {
  it("collapses message notifications of one conversation into a single group", () => {
    const groups = groupNotifications(
      [
        n({ id: "a", href: `/messages?c=${CONV}`, read_at: null }),
        n({ id: "b", href: `/messages?c=${CONV}`, read_at: null }),
      ],
      { groupByConversation: true },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].isConversation).toBe(true);
    expect(groups[0].isSingle).toBe(false);
    expect(groups[0].conversationId).toBe(CONV);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(groups[0].unreadCount).toBe(2);
    expect(groups[0].key).toBe(`conv:${CONV}`);
  });

  it("counts only unread rows in unreadCount", () => {
    const groups = groupNotifications(
      [
        n({ id: "a", href: `/messages?c=${CONV}`, read_at: "2026-01-01T11:00:00.000Z" }),
        n({ id: "b", href: `/messages?c=${CONV}`, read_at: null }),
      ],
      { groupByConversation: true },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].unreadCount).toBe(1);
  });

  it("keeps non-message kinds as their own single groups", () => {
    const groups = groupNotifications(
      [n({ id: "c", kind: "comment", href: "/blog/post#comments" })],
      {
        groupByConversation: true,
      },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].isConversation).toBe(false);
    expect(groups[0].isSingle).toBe(true);
    expect(groups[0].key).toBe("n:c");
  });

  it("does not collapse when groupByConversation is false", () => {
    const groups = groupNotifications(
      [n({ id: "a", href: `/messages?c=${CONV}` }), n({ id: "b", href: `/messages?c=${CONV}` })],
      { groupByConversation: false },
    );
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.isConversation === false)).toBe(true);
  });

  it("treats a message notification with an unparseable href as a single group", () => {
    const groups = groupNotifications([n({ id: "a", href: "/messages" })], {
      groupByConversation: true,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].isConversation).toBe(false);
    expect(groups[0].conversationId).toBeNull();
  });
});
