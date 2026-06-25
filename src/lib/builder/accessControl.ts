// Pure helpers + React hook for evaluating widget/column/section access gates.
import { useAuth } from "@/hooks/useAuth";
import type { AccessControlSettings, AccessRole } from "./types";

export interface AccessContext {
  isAuthenticated: boolean;
  roles: AccessRole[];
}

export function evaluateAccess(
  rule: AccessControlSettings | undefined,
  ctx: AccessContext,
): boolean {
  if (!rule) return true;
  const auth = rule.auth ?? "any";
  if (auth === "guest" && ctx.isAuthenticated) return false;
  if (auth === "user" && !ctx.isAuthenticated) return false;

  const required = rule.roles ?? [];
  if (required.length === 0) return true;
  // Roles only apply to authenticated visitors.
  if (!ctx.isAuthenticated) return false;
  const mode = rule.rolesMode ?? "any";
  if (mode === "all") return required.every((r) => ctx.roles.includes(r));
  return required.some((r) => ctx.roles.includes(r));
}

export function useAccessContext(): AccessContext {
  const { session, roles } = useAuth();
  return { isAuthenticated: !!session, roles: roles as AccessRole[] };
}

export function useAccessAllowed(rule: AccessControlSettings | undefined): boolean {
  const ctx = useAccessContext();
  return evaluateAccess(rule, ctx);
}

export function isAccessConfigured(rule: AccessControlSettings | undefined): boolean {
  if (!rule) return false;
  if (rule.auth && rule.auth !== "any") return true;
  if (rule.roles && rule.roles.length > 0) return true;
  return false;
}
