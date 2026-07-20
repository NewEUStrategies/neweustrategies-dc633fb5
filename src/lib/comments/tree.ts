// Pure comment-tree assembly, extracted from CommentsSection.tsx so the
// nesting cap and the can-reply rule are unit-testable in isolation.
// The tree is recursive up to MAX_COMMENT_DEPTH; rows nested deeper than the
// cap are dropped at assembly - the same limit the DB trigger
// `comments_before_insert` enforces on INSERT.
import type { CommentWithAuthor } from "./api";

/** Maximum node depth rendered/allowed. 0 = top level, 2 = trzecie piętro. */
export const MAX_COMMENT_DEPTH = 2;

export interface CommentTreeNode {
  comment: CommentWithAuthor;
  children: CommentTreeNode[];
}

/**
 * Build a recursive tree from a flat, oldest-first comment list. Top-level
 * comments become roots; replies attach under their parents down to
 * MAX_COMMENT_DEPTH. Anything deeper (or orphaned - parent outside the
 * fetched window) has no rendered slot and is omitted.
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
  const attach = (comment: CommentWithAuthor, depth: number): CommentTreeNode => ({
    comment,
    children:
      depth >= MAX_COMMENT_DEPTH
        ? []
        : (byParent.get(comment.id) ?? []).map((child) => attach(child, depth + 1)),
  });
  return roots.map((c) => attach(c, 0));
}

/**
 * A comment accepts replies while its depth is below the cap and the
 * discussion is open - a reply lands at depth + 1, so nodes at
 * MAX_COMMENT_DEPTH are never repliable.
 */
export function canReplyToComment(depth: number, commentsOpen: boolean): boolean {
  return commentsOpen && depth < MAX_COMMENT_DEPTH;
}
