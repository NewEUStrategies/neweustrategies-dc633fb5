// Revision snapshot domain logic (pure). The `content_revisions` table stores
// point-in-time copies of a post's content-bearing fields; this module decides
// WHAT goes into a snapshot and WHEN one is worth writing, so the server
// function and the tests share one source of truth.

/** Content-bearing post fields captured in a revision snapshot. */
export const REVISION_FIELDS = [
  "title_pl",
  "title_en",
  "excerpt_pl",
  "excerpt_en",
  "content_pl",
  "content_en",
  "blocks_data",
  "builder_data",
  "editor",
  "status",
  "cover_image_url",
  "read_minutes",
  "post_format",
  "layout_overrides",
  "takeaways_pl",
  "takeaways_en",
  "custom_meta",
  "related_override",
] as const;

export type RevisionField = (typeof REVISION_FIELDS)[number];

/**
 * Fields safe to write back on restore. Deliberately excludes `status`:
 * restoring old content must not silently unpublish or republish a post -
 * the workflow status stays as it is and is changed explicitly.
 */
export const RESTORABLE_FIELDS: readonly RevisionField[] = REVISION_FIELDS.filter(
  (f) => f !== "status",
);

/** Machine-readable revision notes; the UI translates known codes (PL/EN). */
export type RevisionNote = "autosave" | "pre_restore";

/** Keep at most this many revisions per entity (oldest pruned, best-effort). */
export const REVISION_KEEP_LIMIT = 50;

/** Skip a new autosave snapshot if the last one is younger than this. */
export const REVISION_MIN_INTERVAL_MS = 5 * 60_000;

/** True when an update payload touches any snapshot-worthy field. */
export function revisionTouches(updates: Record<string, unknown>): boolean {
  return REVISION_FIELDS.some((f) => f in updates);
}

/** Project a full post row onto the snapshot shape (unknown keys dropped). */
export function pickRevisionSnapshot(row: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of REVISION_FIELDS) {
    if (field in row) snapshot[field] = row[field];
  }
  return snapshot;
}

/** Project a snapshot onto the fields that may be written back on restore. */
export function pickRestorableFields(snapshot: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of RESTORABLE_FIELDS) {
    if (field in snapshot) fields[field] = snapshot[field];
  }
  return fields;
}

/**
 * Throttle: write a snapshot when there is none yet, when the last one is
 * older than `minIntervalMs`, or always when `force` (status transitions,
 * pre-restore backups - moments that must never be lost).
 */
export function shouldSnapshot(
  lastRevisionAtIso: string | null,
  nowMs: number,
  force = false,
  minIntervalMs: number = REVISION_MIN_INTERVAL_MS,
): boolean {
  if (force) return true;
  if (!lastRevisionAtIso) return true;
  const last = new Date(lastRevisionAtIso).getTime();
  if (Number.isNaN(last)) return true;
  return nowMs - last >= minIntervalMs;
}
