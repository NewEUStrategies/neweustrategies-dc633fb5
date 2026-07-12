// Pure conversation-list math: archive split, mute parsing ('infinity' from
// PostgREST) - the hazards a UI click-through would not catch.
import { describe, it, expect } from "vitest";
import { isMuted, mutedUntilMs, splitArchived } from "../useConversations";
import type { ConversationView, ParticipantRow } from "../types";

function participant(overrides: Partial<ParticipantRow>): ParticipantRow {
  return {
    id: overrides.id ?? "cp-1",
    conversation_id: overrides.conversation_id ?? "conv-1",
    user_id: overrides.user_id ?? "user-1",
    tenant_id: overrides.tenant_id ?? "tenant-1",
    unread_count: overrides.unread_count ?? 0,
    last_read_at: overrides.last_read_at ?? null,
    last_delivered_at: overrides.last_delivered_at ?? null,
    pinned_at: overrides.pinned_at ?? null,
    archived_at: overrides.archived_at ?? null,
    muted_until: overrides.muted_until ?? null,
    cleared_before: overrides.cleared_before ?? null,
    created_at: overrides.created_at ?? "2026-01-01T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-01-01T10:00:00.000Z",
  };
}

function view(me: Partial<ParticipantRow>, id = "conv-1"): ConversationView {
  return {
    conversation: {
      id,
      tenant_id: "tenant-1",
      kind: "direct",
      created_by: "user-1",
      created_at: "2026-01-01T10:00:00.000Z",
      updated_at: "2026-01-01T10:00:00.000Z",
      direct_key: null,
      last_message_at: null,
      last_message_kind: null,
      last_message_preview: null,
      last_message_sender: null,
      message_ttl_seconds: null,
    },
    me: participant(me),
    peers: [],
  };
}

describe("mutedUntilMs", () => {
  it("parses ISO timestamps and passes null through", () => {
    expect(mutedUntilMs(null)).toBeNull();
    expect(mutedUntilMs("2026-01-01T10:00:00.000Z")).toBe(Date.parse("2026-01-01T10:00:00.000Z"));
  });
  it("maps PostgREST's 'infinity' literal to +Infinity (mute forever)", () => {
    expect(mutedUntilMs("infinity")).toBe(Number.POSITIVE_INFINITY);
  });
  it("returns null for garbage instead of NaN poisoning comparisons", () => {
    expect(mutedUntilMs("not-a-date")).toBeNull();
  });
});

describe("isMuted", () => {
  const now = Date.parse("2026-01-01T10:00:00.000Z");
  it("is false without a mute or after it lapsed", () => {
    expect(isMuted(view({}), now)).toBe(false);
    expect(isMuted(view({ muted_until: "2026-01-01T09:00:00.000Z" }), now)).toBe(false);
  });
  it("is true for future windows and forever-mutes", () => {
    expect(isMuted(view({ muted_until: "2026-01-01T11:00:00.000Z" }), now)).toBe(true);
    expect(isMuted(view({ muted_until: "infinity" }), now)).toBe(true);
  });
});

describe("splitArchived", () => {
  it("partitions views by the caller's archived_at flag, preserving order", () => {
    const a = view({}, "conv-a");
    const b = view({ archived_at: "2026-01-01T10:00:00.000Z" }, "conv-b");
    const c = view({}, "conv-c");
    const { active, archived } = splitArchived([a, b, c]);
    expect(active.map((v) => v.conversation.id)).toEqual(["conv-a", "conv-c"]);
    expect(archived.map((v) => v.conversation.id)).toEqual(["conv-b"]);
  });
});
