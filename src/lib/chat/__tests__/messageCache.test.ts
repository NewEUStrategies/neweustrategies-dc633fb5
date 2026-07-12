import { describe, it, expect } from "vitest";
import {
  singlePageData,
  upsertMessageInCache,
  removeMessageFromCache,
  canEditMessage,
  EDIT_WINDOW_MS,
  type MessagesData,
} from "../messageCache";
import type { ChatMessage } from "../types";

function msg(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    id: overrides.id,
    conversation_id: overrides.conversation_id ?? "conv-1",
    tenant_id: overrides.tenant_id ?? "tenant-1",
    sender_id: overrides.sender_id ?? "user-1",
    kind: overrides.kind ?? "text",
    body: overrides.body ?? "hello",
    attachment_path: overrides.attachment_path ?? null,
    attachment_name: overrides.attachment_name ?? null,
    attachment_mime: overrides.attachment_mime ?? null,
    attachment_size: overrides.attachment_size ?? null,
    attachment_duration: overrides.attachment_duration ?? null,
    reply_to_id: overrides.reply_to_id ?? null,
    edited_at: overrides.edited_at ?? null,
    deleted_at: overrides.deleted_at ?? null,
    expires_at: overrides.expires_at ?? null,
    created_at: overrides.created_at ?? "2026-01-01T10:00:00.000Z",
    pending: overrides.pending,
    failed: overrides.failed,
  };
}

function data(rows: ChatMessage[]): MessagesData {
  return { pages: [{ rows, nextCursor: null }], pageParams: [null] };
}

describe("singlePageData", () => {
  it("wraps a single message into one page with a null cursor", () => {
    const d = singlePageData(msg({ id: "m1" }));
    expect(d.pages).toHaveLength(1);
    expect(d.pages[0].rows).toHaveLength(1);
    expect(d.pages[0].rows[0].id).toBe("m1");
    expect(d.pages[0].nextCursor).toBeNull();
    expect(d.pageParams).toEqual([null]);
  });
});

describe("upsertMessageInCache", () => {
  it("returns undefined when there is no cache", () => {
    expect(upsertMessageInCache(undefined, msg({ id: "m1" }))).toBeUndefined();
  });

  it("replaces an existing row by id and clears pending", () => {
    const d = data([msg({ id: "m1", body: "old", pending: true })]);
    const out = upsertMessageInCache(d, msg({ id: "m1", body: "new" }));
    const rows = out!.pages[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("new");
    expect(rows[0].pending).toBe(false);
  });

  it("prepends a missing message (newest first) by default", () => {
    const d = data([msg({ id: "m1" })]);
    const out = upsertMessageInCache(d, msg({ id: "m2" }));
    expect(out!.pages[0].rows.map((r) => r.id)).toEqual(["m2", "m1"]);
  });

  it("does not insert a missing message when insertIfMissing is false", () => {
    const d = data([msg({ id: "m1" })]);
    const out = upsertMessageInCache(d, msg({ id: "ghost" }), { insertIfMissing: false });
    expect(out!.pages[0].rows.map((r) => r.id)).toEqual(["m1"]);
  });

  it("replaces the optimistic twin with the server row when it is not yet present", () => {
    const d = data([msg({ id: "pending-x", body: "typed", pending: true })]);
    const out = upsertMessageInCache(d, msg({ id: "s1", body: "typed" }), {
      replaceId: "pending-x",
    });
    const rows = out!.pages[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("s1");
    expect(rows[0].pending).toBe(false);
  });

  it("dedups: drops the optimistic twin when the server row already exists (realtime-echo race)", () => {
    // Realtime INSERT already added the server row; then the HTTP onSuccess
    // arrives carrying the same id plus the temp id to reconcile.
    const d = data([
      msg({ id: "s1", body: "hi" }),
      msg({ id: "pending-x", body: "hi", pending: true }),
    ]);
    const out = upsertMessageInCache(d, msg({ id: "s1", body: "hi" }), { replaceId: "pending-x" });
    const rows = out!.pages[0].rows;
    expect(rows.map((r) => r.id)).toEqual(["s1"]);
    expect(rows.some((r) => r.pending)).toBe(false);
  });
});

describe("removeMessageFromCache", () => {
  it("removes the matching row across pages", () => {
    const d: MessagesData = {
      pages: [
        { rows: [msg({ id: "a" }), msg({ id: "b" })], nextCursor: null },
        { rows: [msg({ id: "c" })], nextCursor: null },
      ],
      pageParams: [null, null],
    };
    const out = removeMessageFromCache(d, "b");
    expect(out!.pages[0].rows.map((r) => r.id)).toEqual(["a"]);
    expect(out!.pages[1].rows.map((r) => r.id)).toEqual(["c"]);
  });

  it("returns undefined when there is no cache", () => {
    expect(removeMessageFromCache(undefined, "x")).toBeUndefined();
  });
});

describe("canEditMessage / EDIT_WINDOW_MS", () => {
  const me = "user-1";

  it("exposes a 5-minute window", () => {
    expect(EDIT_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("allows editing an own, fresh text message", () => {
    const m = msg({ id: "m1", sender_id: me, created_at: new Date().toISOString() });
    expect(canEditMessage(m, me)).toBe(true);
  });

  it("rejects another user's message", () => {
    const m = msg({ id: "m1", sender_id: "someone-else", created_at: new Date().toISOString() });
    expect(canEditMessage(m, me)).toBe(false);
  });

  it("rejects non-text kinds", () => {
    const m = msg({ id: "m1", sender_id: me, kind: "image", created_at: new Date().toISOString() });
    expect(canEditMessage(m, me)).toBe(false);
  });

  it("rejects deleted, pending or failed messages", () => {
    const base = { id: "m1", sender_id: me, created_at: new Date().toISOString() };
    expect(canEditMessage(msg({ ...base, deleted_at: new Date().toISOString() }), me)).toBe(false);
    expect(canEditMessage(msg({ ...base, pending: true }), me)).toBe(false);
    expect(canEditMessage(msg({ ...base, failed: true }), me)).toBe(false);
  });

  it("rejects a message older than the edit window", () => {
    const old = new Date(Date.now() - EDIT_WINDOW_MS - 1000).toISOString();
    const m = msg({ id: "m1", sender_id: me, created_at: old });
    expect(canEditMessage(m, me)).toBe(false);
  });
});
