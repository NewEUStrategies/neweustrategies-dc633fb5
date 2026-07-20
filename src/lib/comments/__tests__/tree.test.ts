import { describe, it, expect } from "vitest";
import { buildCommentTree, canReplyToComment, MAX_COMMENT_DEPTH } from "../tree";
import type { CommentWithAuthor } from "../api";

function c(overrides: Partial<CommentWithAuthor> & { id: string }): CommentWithAuthor {
  return {
    id: overrides.id,
    post_id: overrides.post_id ?? "post-1",
    user_id: overrides.user_id === undefined ? "user-1" : overrides.user_id,
    author_name: overrides.author_name ?? null,
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

/** Wszystkie id w drzewie (dowolna głębokość). */
function flatIds(tree: ReturnType<typeof buildCommentTree>): string[] {
  const out: string[] = [];
  const walk = (nodes: ReturnType<typeof buildCommentTree>) => {
    for (const n of nodes) {
      out.push(n.comment.id);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

describe("buildCommentTree", () => {
  it("groups direct replies under their parent, keeping top-level order", () => {
    const tree = buildCommentTree([
      c({ id: "r1" }),
      c({ id: "r1a", parent_id: "r1" }),
      c({ id: "r2" }),
    ]);
    expect(tree.map((n) => n.comment.id)).toEqual(["r1", "r2"]);
    expect(tree[0].children.map((n) => n.comment.id)).toEqual(["r1a"]);
    expect(tree[1].children).toEqual([]);
  });

  it("nests replies recursively down to MAX_COMMENT_DEPTH (three tiers)", () => {
    const tree = buildCommentTree([
      c({ id: "root" }),
      c({ id: "child", parent_id: "root" }),
      c({ id: "grandchild", parent_id: "child" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((n) => n.comment.id)).toEqual(["child"]);
    expect(tree[0].children[0].children.map((n) => n.comment.id)).toEqual(["grandchild"]);
  });

  it("drops rows nested beyond the cap (fourth tier has no rendered slot)", () => {
    const tree = buildCommentTree([
      c({ id: "root" }),
      c({ id: "d1", parent_id: "root" }),
      c({ id: "d2", parent_id: "d1" }),
      c({ id: "d3", parent_id: "d2" }),
    ]);
    const ids = flatIds(tree);
    expect(ids).toEqual(["root", "d1", "d2"]);
    expect(ids).not.toContain("d3");
  });

  it("drops orphans whose parent is outside the fetched window", () => {
    const tree = buildCommentTree([c({ id: "root" }), c({ id: "lost", parent_id: "missing" })]);
    expect(flatIds(tree)).toEqual(["root"]);
  });

  it("keeps guest rows (user_id null, author_name signed) in the tree", () => {
    const tree = buildCommentTree([
      c({ id: "root" }),
      c({ id: "guest", parent_id: "root", user_id: null, author_name: "Gość Testowy" }),
    ]);
    expect(tree[0].children[0].comment.author_name).toBe("Gość Testowy");
  });

  it("returns an empty tree for no rows", () => {
    expect(buildCommentTree([])).toEqual([]);
  });
});

describe("canReplyToComment", () => {
  it("caps thread depth at two reply tiers", () => {
    expect(MAX_COMMENT_DEPTH).toBe(2);
  });

  it("allows replying below the cap only when the discussion is open", () => {
    expect(canReplyToComment(0, true)).toBe(true);
    expect(canReplyToComment(1, true)).toBe(true);
    expect(canReplyToComment(0, false)).toBe(false);
    expect(canReplyToComment(1, false)).toBe(false);
  });

  it("never allows replying at or beyond the cap, even when open", () => {
    expect(canReplyToComment(2, true)).toBe(false);
    expect(canReplyToComment(3, true)).toBe(false);
  });
});
