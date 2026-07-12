// Pure comment-tree assembly, extracted from CommentsSection.tsx so the
// one-level nesting cap and the can-reply rule are unit-testable in isolation.
// Behavior is identical to the previous inline `buildTree`: replies are kept
// adjacent to their parent for a stable 1-level tree, and any row whose parent
// is itself a reply (a grandchild) is dropped by the assembly - this IS the
// nesting cap the DB trigger `comments_before_insert` also enforces.
import type { CommentWithAuthor } from "./api";

/** Maximum reply depth rendered/allowed. 0 = top level, 1 = one reply level. */
export const MAX_COMMENT_DEPTH = 1;

export interface CommentTreeNode {
  comment: CommentWithAuthor;
  children: CommentWithAuthor[];
}

/**
 * Build a one-level tree from a flat, oldest-first comment list. Top-level
 * comments become roots; direct replies become their `children`. Replies to a
 * reply (grandchildren) have no rendered slot and are omitted - the one-level
 * nesting cap.
 */
export function buildCommentTree(rows: CommentWithAuthor[]): CommentTreeNode[] {
  const byParent = new Map<string, CommentWithAuthor[]>();
  const roots: CommentWithAuthor[] = [];
  for (const r of rows) {
    if (r.parent_id) {
      const arr = byParent.get(r.parent_id) ?? [];
      arr.push(r);
      byParent.set(r.parent_id, arr);
    } else {
      roots.push(r);
    }
  }
  return roots.map((c) => ({ comment: c, children: byParent.get(c.id) ?? [] }));
}

/**
 * A comment accepts replies only at the top level (depth 0) and only while the
 * discussion is open. Depth >= MAX_COMMENT_DEPTH (i.e. an existing reply) is
 * never repliable, which keeps the tree one level deep.
 */
export function canReplyToComment(depth: number, commentsOpen: boolean): boolean {
  return commentsOpen && depth < MAX_COMMENT_DEPTH;
}
