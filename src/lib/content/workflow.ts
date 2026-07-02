// Editorial workflow domain logic (pure, framework-free - mirrored by the
// `enforce_post_workflow` DB trigger; see docs/ARCHITECTURE.md §2.7).
//
// Roles map to a single capability here: `canPublish` (admin / super_admin).
// Authors and editors write and submit for review; publishers approve,
// publish immediately or schedule. Keeping the decision table in one pure
// module lets the server functions, the post editor UI and the tests share
// the exact same rules.

export const POST_STATUSES = [
  "draft",
  "pending_review",
  "scheduled",
  "published",
  "archived",
] as const;

export type PostWorkflowStatus = (typeof POST_STATUSES)[number];

/** Statuses that only a publisher (admin / super_admin) may enter. */
export const PUBLISHER_ONLY_STATUSES: readonly PostWorkflowStatus[] = ["published", "scheduled"];

export interface WorkflowActor {
  /** admin or super_admin - may publish and schedule directly. */
  canPublish: boolean;
}

export type TransitionDenial = "requires_publisher" | "requires_publish_at";

export type TransitionResult = { ok: true } | { ok: false; reason: TransitionDenial };

export function isPostWorkflowStatus(value: string): value is PostWorkflowStatus {
  return (POST_STATUSES as readonly string[]).includes(value);
}

/**
 * Decide whether `actor` may move a post from `from` to `to`.
 * `publishAt` is required (non-null) for the `scheduled` target.
 * Re-saving without a status change is always allowed - only the transition
 * INTO a publisher-only status is gated, so an author can keep editing an
 * already-published post without demoting it.
 */
export function evaluateTransition(
  actor: WorkflowActor,
  from: PostWorkflowStatus,
  to: PostWorkflowStatus,
  publishAt?: string | null,
): TransitionResult {
  const entersPublisherOnly = PUBLISHER_ONLY_STATUSES.includes(to) && from !== to;
  if (entersPublisherOnly && !actor.canPublish) {
    return { ok: false, reason: "requires_publisher" };
  }
  if (to === "scheduled" && !publishAt) {
    return { ok: false, reason: "requires_publish_at" };
  }
  return { ok: true };
}

export interface StatusOption {
  value: PostWorkflowStatus;
  /** Selectable only by publishers; render disabled with a hint otherwise. */
  publisherOnly: boolean;
}

/** Status choices for the editor UI, in editorial order. */
export function statusOptionsFor(actor: WorkflowActor): StatusOption[] {
  return POST_STATUSES.map((value) => ({
    value,
    publisherOnly: PUBLISHER_ONLY_STATUSES.includes(value) && !actor.canPublish,
  }));
}

/**
 * ISO timestamp -> value for an <input type="datetime-local"> in the user's
 * local timezone ("YYYY-MM-DDTHH:mm"). Empty string for null/invalid input.
 */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value -> ISO timestamp (UTC). Null if empty/invalid. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
