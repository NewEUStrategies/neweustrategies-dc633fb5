import { describe, it, expect } from "vitest";
import { buildCommentTree, canReplyToComment, MAX_COMMENT_DEPTH } from "../tree";
import type { CommentWithAuthor } from "../api";

function c(overrides: Partial<CommentWithAuthor> & { id: string }): CommentWithAuthor {
  return {
    id: overrides.id,
    post_id: overrides.post_id ?? "post-1",
    user_id: overrides.user_id ?? "user-1",
    parent_id: overrides.parent_id ?? null,
    body: overrides.body ?? "body",
    status: overrides.status ?? "approved",
    created_at: overrides.created_at ?? "2026-01-01T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-01-01T10:00:00.000Z",
    edited_at: overrides.edited_at ?? null,
    tenant_id: overrides.tenant_id ?? "tenant-1",
    author: overrides.author ?? null,
  };
}

describe("buildCommentTree", () => {
  it("groups direct replies under their parent, keeping top-level order", () => {
    const tree = buildCommentTree([
      c({ id: "r1" }),
      c({ id: "r1a", parent_id: "r1" }),
      c({ id: "r2" }),
    ]);
    expect(tree.map((n) => n.comment.id)).toEqual(["r1", "r2"]);
    expect(tree[0].children.map((r) => r.id)).toEqual(["r1a"]);
    expect(tree[1].children).toEqual([]);
  });

  it("enforces the one-level nesting cap: a reply-to-a-reply (grandchild) is dropped", () => {
    const tree = buildCommentTree([
      c({ id: "root" }),
      c({ id: "child", parent_id: "root" }),
      c({ id: "grandchild", parent_id: "child" }),
    ]);
    // grandchild has no rendered slot at depth 2 and must not surface anywhere.
    expect(tree).toHaveLength(1);
    expect(tree[0].comment.id).toBe("root");
    expect(tree[0].children.map((r) => r.id)).toEqual(["child"]);
    const allIds = tree.flatMap((n) => [n.comment.id, ...n.children.map((ch) => ch.id)]);
    expect(allIds).not.toContain("grandchild");
  });

  it("returns an empty tree for no rows", () => {
    expect(buildCommentTree([])).toEqual([]);
  });
});

describe("canReplyToComment", () => {
  it("caps replies at one level", () => {
    expect(MAX_COMMENT_DEPTH).toBe(1);
  });

  it("allows replying to a top-level comment only when the discussion is open", () => {
    expect(canReplyToComment(0, true)).toBe(true);
    expect(canReplyToComment(0, false)).toBe(false);
  });

  it("never allows replying to an existing reply, even when open", () => {
    expect(canReplyToComment(1, true)).toBe(false);
    expect(canReplyToComment(2, true)).toBe(false);
  });
});
