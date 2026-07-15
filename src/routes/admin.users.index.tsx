import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, ArrowUpDown, Eye, UserCog, Mail, Users as UsersIcon } from "lucide-react";
import { impersonateUser } from "@/lib/admin/impersonation";
import { InviteUserDialog } from "@/components/admin/users/InviteUserDialog";
import { TeamImportDialog } from "@/components/admin/users/TeamImportDialog";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/users/")({
  component: Users,
});

type Role = "super_admin" | "admin" | "editor" | "author" | "user";

interface UserRow {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  slug: string | null;
  bio: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  created_at: string;
  updated_at: string | null;
  roles: Role[];
}

// Roles a user can be switched to. `super_admin` may only be granted by a
// super_admin - enforced both here (option hidden) and in the DB function.
const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "editor", "author", "user"];

type SortKey = "display_name" | "email" | "role" | "created_at";
type SortDir = "asc" | "desc";

function Users() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isSuperAdmin } = useAuth();
  const tenantId = useRequiredTenant();
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data } = useQuery({
    queryKey: ["all-users", tenantId],
    queryFn: async (): Promise<UserRow[]> => {
      // admin_list_users is the only path that exposes e-mail addresses:
      // SECURITY DEFINER, gated on admin/super_admin, scoped to the caller's
      // tenant. The profiles column grants no longer include `email`.
      const { data: rows, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (rows ?? []).map((r) => ({ ...r, roles: (r.roles ?? []) as Role[] }));
    },
  });

  const sorted = useMemo(() => {
    const list = [...(data ?? [])];
    list.sort((a, b) => {
      let av: string = "";
      let bv: string = "";
      if (sortKey === "role") {
        av = a.roles[0] ?? "";
        bv = b.roles[0] ?? "";
      } else if (sortKey === "display_name") {
        av = (a.display_name ?? "").toLowerCase();
        bv = (b.display_name ?? "").toLowerCase();
      } else if (sortKey === "email") {
        av = (a.email ?? "").toLowerCase();
        bv = (b.email ?? "").toLowerCase();
      } else {
        av = a.created_at;
        bv = b.created_at;
      }
      const r = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? r : -r;
    });
    return list;
  }, [data, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "created_at" ? "desc" : "asc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="inline w-3 h-3 ml-1 opacity-50" />;
    return sortDir === "asc" ? (
      <ArrowUp className="inline w-3 h-3 ml-1" />
    ) : (
      <ArrowDown className="inline w-3 h-3 ml-1" />
    );
  };

  const changeRole = async (uid: string, role: Role) => {
    // Atomic + audited: change_user_role replaces the role set in ONE
    // transaction (no delete/insert window that could strip every role) and
    // writes a role_audit_log entry. Direct user_roles writes are revoked.
    const { error } = await supabase.rpc("change_user_role", {
      _target_user_id: uid,
      _new_role: role,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("admin.saved"));
    qc.invalidateQueries({ queryKey: ["all-users"] });
  };

  const locale = i18n.language === "pl" ? "pl-PL" : "en-US";

  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-6">{t("admin.users.title")}</h1>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th
                className="text-left p-3 cursor-pointer select-none"
                onClick={() => toggleSort("display_name")}
              >
                {t("admin.users.name")}
                <SortIcon k="display_name" />
              </th>
              <th
                className="text-left p-3 cursor-pointer select-none"
                onClick={() => toggleSort("email")}
              >
                Email
                <SortIcon k="email" />
              </th>
              <th
                className="text-left p-3 cursor-pointer select-none"
                onClick={() => toggleSort("role")}
              >
                {t("admin.users.role")}
                <SortIcon k="role" />
              </th>
              <th
                className="text-left p-3 cursor-pointer select-none"
                onClick={() => toggleSort("created_at")}
              >
                {t("admin.users.created")}
                <SortIcon k="created_at" />
              </th>
              <th className="text-right p-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr
                key={u.id}
                className="border-t border-border hover:bg-muted/20 cursor-pointer"
                onClick={() => navigate({ to: "/admin/users/$id", params: { id: u.id } })}
              >
                <td className="p-3 font-medium">
                  <div className="flex items-center gap-2">
                    {u.avatar_url ? (
                      <img
                        src={u.avatar_url}
                        alt=""
                        className="w-7 h-7 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-muted" />
                    )}
                    {u.display_name ?? "-"}
                  </div>
                </td>
                <td className="p-3 text-muted-foreground">{u.email}</td>
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  {u.id === user?.id ? (
                    <Badge>{u.roles[0] ?? "-"}</Badge>
                  ) : (
                    <Select
                      value={u.roles[0] ?? ""}
                      onValueChange={(v) => changeRole(u.id, v as Role)}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder="-" />
                      </SelectTrigger>
                      <SelectContent>
                        {isSuperAdmin && <SelectItem value="super_admin">Super admin</SelectItem>}
                        {ASSIGNABLE_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {t(`admin.users.roles.${r}`, {
                              defaultValue: r.charAt(0).toUpperCase() + r.slice(1),
                            })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString(locale)}
                </td>
                <td
                  className="p-3 text-right whitespace-nowrap"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isSuperAdmin && u.id !== user?.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={
                        i18n.language === "pl"
                          ? "Zaloguj jako tego użytkownika"
                          : "Sign in as this user"
                      }
                      onClick={async () => {
                        try {
                          await impersonateUser(u.id, u.display_name ?? u.email ?? u.id);
                          toast.success(
                            i18n.language === "pl"
                              ? "Tryb podglądu aktywny"
                              : "Impersonation active",
                          );
                          window.location.assign("/profile");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Error");
                        }
                      }}
                    >
                      <UserCog className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate({ to: "/admin/users/$id", params: { id: u.id } })}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
