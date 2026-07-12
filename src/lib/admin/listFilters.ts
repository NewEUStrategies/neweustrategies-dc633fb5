// Shared helper for the admin content lists (posts, pages) that moved from
// client-side filtering of a full fetch to server-side PostgREST filtering +
// pagination. `escapeLike` strips LIKE wildcards and PostgREST .or()
// metacharacters so a user's search phrase can never inject extra filter
// conditions (same guard as src/lib/mcp/tools/search-posts.ts and
// src/lib/crm.functions.ts).
export const escapeLike = (s: string): string => s.replace(/[%_,()"\\]/g, "");
