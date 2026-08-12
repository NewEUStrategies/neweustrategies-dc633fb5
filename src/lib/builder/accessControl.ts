// Pure helpers + React hook for evaluating widget/column/section access gates.
import { useAuth } from "@/hooks/useAuth";
import type { AccessAuthMode, AccessControlSettings, AccessRole, AccessRolesMode } from "./types";

export interface AccessContext {
  isAuthenticated: boolean;
  roles: AccessRole[];
}

/**
 * Context of a caller with no session. This is everything the PUBLIC plane can
 * know on the server: the Supabase session lives in localStorage, so an SSR
 * render is anonymous by construction (see fetchGatedBody in lib/queries/public).
 */
export const GUEST_ACCESS_CONTEXT: AccessContext = { isAuthenticated: false, roles: [] };

const AUTH_MODES: readonly AccessAuthMode[] = ["any", "guest", "user"];
const ROLES_MODES: readonly AccessRolesMode[] = ["any", "all"];

export function evaluateAccess(
  rule: AccessControlSettings | undefined,
  ctx: AccessContext,
): boolean {
  if (!rule) return true;
  const auth = rule.auth ?? "any";
  const mode = rule.rolesMode ?? "any";
  const required = rule.roles ?? [];
  // Rules come out of a jsonb column, so a value outside the union means the
  // gate was written by something this build cannot read (newer writer, legacy
  // migration, hand-edited row). An unreadable gate resolves to HIDDEN - the
  // opposite default would publish exactly the content someone tried to gate.
  if (!AUTH_MODES.includes(auth) || !ROLES_MODES.includes(mode) || !Array.isArray(required)) {
    return false;
  }
  if (auth === "guest" && ctx.isAuthenticated) return false;
  if (auth === "user" && !ctx.isAuthenticated) return false;

  if (required.length === 0) return true;
  // Roles only apply to authenticated visitors.
  if (!ctx.isAuthenticated) return false;
  if (mode === "all") return required.every((r) => ctx.roles.includes(r));
  return required.some((r) => ctx.roles.includes(r));
}

export function useAccessContext(): AccessContext {
  const { session, roles } = useAuth();
  return { isAuthenticated: !!session, roles: roles as AccessRole[] };
}

type JsonRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is JsonRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function accessRuleOf(node: JsonRecord): AccessControlSettings | undefined {
  const advanced = node.advanced;
  if (!isRecord(advanced)) return undefined;
  return isRecord(advanced.access) ? (advanced.access as AccessControlSettings) : undefined;
}

/**
 * Removes every node `ctx` may not see from a RAW builder document (jsonb as it
 * arrives from the database - shape is not guaranteed, so this must not depend
 * on the document being schema-valid).
 *
 * The walk is key-agnostic instead of following `sections -> children/columns`:
 * `advanced.access` exists on builder nodes only (types.ts), and any nesting a
 * hand-written traversal did not anticipate would silently ship gated nodes
 * again - the exact failure this function exists to prevent. Every node lives
 * in an array, so only array items are ever dropped; the document root itself
 * is never removed.
 *
 * Unchanged subtrees are returned by identity (never mutated), so a document
 * without gates costs a walk instead of a full clone on every SSR body fetch.
 */
export function stripInaccessibleNodes(doc: unknown, ctx: AccessContext): unknown {
  if (Array.isArray(doc)) {
    let changed = false;
    const kept: unknown[] = [];
    for (const item of doc) {
      if (isRecord(item) && !evaluateAccess(accessRuleOf(item), ctx)) {
        changed = true;
        continue;
      }
      const next = stripInaccessibleNodes(item, ctx);
      if (next !== item) changed = true;
      kept.push(next);
    }
    return changed ? kept : doc;
  }
  if (isRecord(doc)) {
    let changed = false;
    const out: JsonRecord = {};
    for (const [key, value] of Object.entries(doc)) {
      const next = stripInaccessibleNodes(value, ctx);
      if (next !== value) changed = true;
      out[key] = next;
    }
    return changed ? out : doc;
  }
  return doc;
}
