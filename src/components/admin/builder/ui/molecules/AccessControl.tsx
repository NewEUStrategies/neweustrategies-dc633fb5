// Molecule: configures auth/role-based visibility for a widget, column, or section.
// Mirrors the structure used by VisibilityControl so the Advanced tab feels coherent.
import type { AdvancedSettings, AccessAuthMode, AccessRole, AccessRolesMode } from "@/lib/builder/types";
import { Lock, Globe, Users, ShieldCheck } from "@/lib/lucide-shim";

interface Props {
  value: AdvancedSettings | undefined;
  onChange: (mut: (a: AdvancedSettings) => void) => void;
}

const AUTH_OPTIONS: Array<[AccessAuthMode, React.ComponentType<{ className?: string }>, string, string]> = [
  ["any", Users, "Wszyscy", "Brak ograniczeń (domyślnie)"],
  ["guest", Unlock, "Goście", "Tylko niezalogowani"],
  ["user", Lock, "Zalogowani", "Tylko zalogowani użytkownicy"],
];

const ROLE_OPTIONS: Array<[AccessRole, string]> = [
  ["admin", "Admin"],
  ["editor", "Editor"],
  ["author", "Author"],
];

export function AccessControl({ value, onChange }: Props) {
  const access = value?.access;
  const authMode: AccessAuthMode = access?.auth ?? "any";
  const roles = access?.roles ?? [];
  const rolesMode: AccessRolesMode = access?.rolesMode ?? "any";
  const rolesDisabled = authMode === "guest";

  const setAuth = (mode: AccessAuthMode) => {
    onChange((a) => {
      const prev = a.access ?? {};
      const next = { ...prev, auth: mode };
      if (mode === "guest") {
        next.roles = undefined;
        next.rolesMode = undefined;
      }
      a.access = normalize(next);
    });
  };

  const toggleRole = (r: AccessRole) => {
    onChange((a) => {
      const prev = a.access ?? {};
      const set = new Set(prev.roles ?? []);
      if (set.has(r)) set.delete(r);
      else set.add(r);
      a.access = normalize({ ...prev, roles: Array.from(set) });
    });
  };

  const setRolesMode = (m: AccessRolesMode) => {
    onChange((a) => {
      const prev = a.access ?? {};
      a.access = normalize({ ...prev, rolesMode: m });
    });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {AUTH_OPTIONS.map(([mode, Icon, label, hint]) => {
          const active = authMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setAuth(mode)}
              title={hint}
              className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded border text-[10px] transition ${
                active
                  ? "bg-brand/10 border-brand text-foreground"
                  : "bg-muted/30 border-border hover:bg-muted text-muted-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className={`space-y-1.5 ${rolesDisabled ? "opacity-40 pointer-events-none" : ""}`}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="w-3 h-3" />
          <span>Wymagane role</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {ROLE_OPTIONS.map(([r, label]) => {
            const checked = roles.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => toggleRole(r)}
                className={`px-2 py-1 rounded border text-[10px] transition ${
                  checked
                    ? "bg-brand/10 border-brand text-foreground"
                    : "bg-muted/30 border-border hover:bg-muted text-muted-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {roles.length > 1 && (
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-muted-foreground">Wymóg:</span>
            <button
              type="button"
              onClick={() => setRolesMode("any")}
              className={`px-2 py-0.5 rounded border ${rolesMode === "any" ? "bg-brand/10 border-brand" : "bg-muted/30 border-border"}`}
            >
              dowolna
            </button>
            <button
              type="button"
              onClick={() => setRolesMode("all")}
              className={`px-2 py-0.5 rounded border ${rolesMode === "all" ? "bg-brand/10 border-brand" : "bg-muted/30 border-border"}`}
            >
              wszystkie
            </button>
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Reguły dotyczą publicznych stron. W edytorze widget jest zawsze widoczny.
      </p>
    </div>
  );
}

function normalize(a: NonNullable<AdvancedSettings["access"]>): AdvancedSettings["access"] {
  const next: NonNullable<AdvancedSettings["access"]> = {};
  if (a.auth && a.auth !== "any") next.auth = a.auth;
  if (a.roles && a.roles.length > 0) {
    next.roles = a.roles;
    if (a.rolesMode === "all") next.rolesMode = "all";
  }
  if (!next.auth && !next.roles) return undefined;
  return next;
}
