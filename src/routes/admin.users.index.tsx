import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Eye,
  UserCog,
  Mail,
  Users as UsersIcon,
  Search,
  X,
} from "lucide-react";
import { impersonateUser } from "@/lib/admin/impersonation";
import { InviteUserDialog } from "@/components/admin/users/InviteUserDialog";
import { TeamImportDialog } from "@/components/admin/users/TeamImportDialog";

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

interface SubscriptionInfo {
  user_id: string;
  plan_name: string;
  status: string;
}

// Roles a user can be switched to. `super_admin` may only be granted by a
// super_admin - enforced both here (option hidden) and in the DB function.
const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "editor", "author", "user"];

// Kolejność wyświetlania grup (od najwyższych uprawnień w dół).
const ROLE_ORDER: readonly Role[] = ["super_admin", "admin", "editor", "author", "user"];

type SortKey = "display_name" | "email" | "role" | "created_at";
type SortDir = "asc" | "desc";
type GroupBy = "none" | "role" | "sub_plan" | "sub_status";
type RoleFilter = Role | "all" | "none";
type SubStatus = "pending" | "active" | "refunded" | "canceled";
type StatusFilter = SubStatus | "all" | "none";

const SUB_STATUSES: readonly SubStatus[] = ["active", "pending", "refunded", "canceled"];

function statusLabel(lang: string, s: SubStatus): string {
  const pl: Record<SubStatus, string> = {
    active: "Aktywna",
    pending: "Oczekująca",
    refunded: "Zwrócona",
    canceled: "Anulowana",
  };
  const en: Record<SubStatus, string> = {
    active: "Active",
    pending: "Pending",
    refunded: "Refunded",
    canceled: "Canceled",
  };
  return (lang === "pl" ? pl : en)[s];
}

function statusVariant(s: SubStatus): "default" | "secondary" | "outline" | "destructive" {
  if (s === "active") return "default";
  if (s === "pending") return "secondary";
  if (s === "canceled") return "outline";
  return "destructive";
}

function roleLabel(t: (k: string, o?: Record<string, unknown>) => string, r: Role): string {
  return t(`admin.users.roles.${r}`, {
    defaultValue:
      r === "super_admin"
        ? "Super admin"
        : r.charAt(0).toUpperCase() + r.slice(1),
  });
}

function primaryRole(roles: Role[]): Role {
  for (const r of ROLE_ORDER) if (roles.includes(r)) return r;
  return "user";
}

function Users() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isSuperAdmin } = useAuth();
  const tenantId = useRequiredTenant();
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [subFilter, setSubFilter] = useState<string>("all"); // "all" | "none" | plan name
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("role");

  const { data } = useQuery({
    queryKey: ["all-users", tenantId],
    queryFn: async (): Promise<UserRow[]> => {
      const { data: rows, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (rows ?? []).map((r) => ({ ...r, roles: (r.roles ?? []) as Role[] }));
    },
  });

  // Subskrypcje: użyte do filtrowania i grupowania po poziomie dostępu.
  // RLS na user_subscriptions dopuszcza admina tenanta.
  const { data: subs } = useQuery({
    queryKey: ["all-user-subscriptions", tenantId],
    queryFn: async (): Promise<SubscriptionInfo[]> => {
      const { data: rows, error } = await supabase
        .from("user_subscriptions")
        .select("user_id, status, current_period_end, canceled_at, access_plans!inner(name_pl, name_en)")
        .eq("tenant_id", tenantId)
        .order("started_at", { ascending: false });
      if (error) {
        // Brak dostępu do widoku nie powinien blokować listy użytkowników.
        console.warn("[admin/users] subscriptions read failed", error.message);
        return [];
      }
      const lang = i18n.language === "pl" ? "pl" : "en";
      return (rows ?? []).map((r) => {
        const plan = (r as unknown as {
          access_plans: { name_pl: string; name_en: string } | null;
        }).access_plans;
        return {
          user_id: r.user_id,
          status: r.status as SubStatus,
          plan_name: (lang === "pl" ? plan?.name_pl : plan?.name_en) ?? plan?.name_en ?? "-",
        };
      });
    },
  });

  // Priorytet statusów - najnowszy wpis po started_at DESC wchodzi do mapy,
  // ale gdy istnieje aktywna, promujemy ją nad pending/canceled/refunded.
  const subMap = useMemo(() => {
    const m = new Map<string, SubscriptionInfo>();
    const priority: Record<SubStatus, number> = {
      active: 4,
      pending: 3,
      canceled: 2,
      refunded: 1,
    };
    for (const s of subs ?? []) {
      const cur = m.get(s.user_id);
      if (!cur || priority[s.status as SubStatus] > priority[cur.status as SubStatus]) {
        m.set(s.user_id, s);
      }
    }
    return m;
  }, [subs]);




  const planOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of subs ?? []) set.add(s.plan_name);
    return Array.from(set).sort();
  }, [subs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((u) => {
      if (q) {
        const hay = `${u.display_name ?? ""} ${u.email ?? ""} ${u.slug ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (roleFilter !== "all") {
        if (roleFilter === "none") {
          if (u.roles.length > 0) return false;
        } else if (!u.roles.includes(roleFilter)) {
          return false;
        }
      }
      if (subFilter !== "all") {
        const s = subMap.get(u.id);
        if (subFilter === "none") {
          if (s) return false;
        } else if (s?.plan_name !== subFilter) {
          return false;
        }
      }
      if (statusFilter !== "all") {
        const s = subMap.get(u.id);
        if (statusFilter === "none") {
          if (s) return false;
        } else if ((s?.status as SubStatus | undefined) !== statusFilter) {
          return false;
        }
      }
      return true;
    });
  }, [data, search, roleFilter, subFilter, statusFilter, subMap]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let av = "";
      let bv = "";
      if (sortKey === "role") {
        av = primaryRole(a.roles);
        bv = primaryRole(b.roles);
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
  }, [filtered, sortKey, sortDir]);

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "__all__", label: "", rows: sorted }];
    if (groupBy === "role") {
      const buckets = new Map<Role, UserRow[]>();
      for (const u of sorted) {
        const r = primaryRole(u.roles);
        const arr = buckets.get(r) ?? [];
        arr.push(u);
        buckets.set(r, arr);
      }
      return ROLE_ORDER.filter((r) => buckets.has(r)).map((r) => ({
        key: r,
        label: roleLabel(t, r),
        rows: buckets.get(r) ?? [],
      }));
    }
    // subscription
    const buckets = new Map<string, UserRow[]>();
    for (const u of sorted) {
      const s = subMap.get(u.id);
      const key = s?.plan_name ?? "__none__";
      const arr = buckets.get(key) ?? [];
      arr.push(u);
      buckets.set(key, arr);
    }
    const keys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({
      key: k,
      label:
        k === "__none__"
          ? i18n.language === "pl"
            ? "Bez subskrypcji"
            : "No subscription"
          : k,
      rows: buckets.get(k) ?? [],
    }));
  }, [sorted, groupBy, subMap, t, i18n.language]);

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

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setSubFilter("all");
  };
  const filtersActive = search !== "" || roleFilter !== "all" || subFilter !== "all";
  const totalCount = data?.length ?? 0;
  const resultsCount = sorted.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="font-display text-3xl font-bold">{t("admin.users.title")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/users/invitations">
              <Mail className="w-4 h-4 mr-1" />
              {i18n.language === "pl" ? "Zaproszenia" : "Invitations"}
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <UsersIcon className="w-4 h-4 mr-1" />
            {i18n.language === "pl" ? "Import zespołu z /o-nas" : "Import team from /o-nas"}
          </Button>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Mail className="w-4 h-4 mr-1" />
            {i18n.language === "pl" ? "Zaproś użytkownika" : "Invite user"}
          </Button>
        </div>
      </div>

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onDone={() => qc.invalidateQueries({ queryKey: ["all-users"] })}
      />
      <TeamImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        pageSlug="o-nas"
        onDone={() => qc.invalidateQueries({ queryKey: ["all-users"] })}
      />

      {/* Toolbar: search + filters + grouping */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              i18n.language === "pl"
                ? "Szukaj po nazwie, e-mailu, slug…"
                : "Search name, email, slug…"
            }
            className="pl-7 h-8 text-xs"
          />
        </div>

        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {i18n.language === "pl" ? "Wszystkie role" : "All roles"}
            </SelectItem>
            {ROLE_ORDER.map((r) => (
              <SelectItem key={r} value={r}>
                {roleLabel(t, r)}
              </SelectItem>
            ))}
            <SelectItem value="none">
              {i18n.language === "pl" ? "Bez roli" : "No role"}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={subFilter} onValueChange={setSubFilter}>
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {i18n.language === "pl" ? "Wszystkie subskrypcje" : "All subscriptions"}
            </SelectItem>
            <SelectItem value="none">
              {i18n.language === "pl" ? "Bez subskrypcji" : "No subscription"}
            </SelectItem>
            {planOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">
              {i18n.language === "pl" ? "Bez grupowania" : "No grouping"}
            </SelectItem>
            <SelectItem value="role">
              {i18n.language === "pl" ? "Grupuj wg roli" : "Group by role"}
            </SelectItem>
            <SelectItem value="subscription">
              {i18n.language === "pl" ? "Grupuj wg subskrypcji" : "Group by subscription"}
            </SelectItem>
          </SelectContent>
        </Select>

        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">
            <X className="w-3.5 h-3.5 mr-1" />
            {i18n.language === "pl" ? "Wyczyść" : "Clear"}
          </Button>
        )}

        <div className="ml-auto text-muted-foreground tabular-nums">
          {resultsCount === totalCount ? resultsCount : `${resultsCount} / ${totalCount}`}
        </div>
      </div>

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
              <th className="text-left p-3">
                {i18n.language === "pl" ? "Subskrypcja" : "Subscription"}
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
            {groups.map((g) => (
              <Fragment key={g.key}>
                {groupBy !== "none" && (
                  <tr className="bg-muted/40 border-t border-border">
                    <td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                      {g.label}
                      <span className="ml-2 text-[10px] font-normal opacity-70 tabular-nums">
                        {g.rows.length}
                      </span>
                    </td>
                  </tr>
                )}
                {g.rows.map((u) => {
                  const sub = subMap.get(u.id);
                  return (
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
                          <Badge>{roleLabel(t, primaryRole(u.roles))}</Badge>
                        ) : (
                          <Select
                            value={primaryRole(u.roles)}
                            onValueChange={(v) => changeRole(u.id, v as Role)}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue placeholder="-" />
                            </SelectTrigger>
                            <SelectContent>
                              {isSuperAdmin && (
                                <SelectItem value="super_admin">
                                  {roleLabel(t, "super_admin")}
                                </SelectItem>
                              )}
                              {ASSIGNABLE_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {roleLabel(t, r)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="p-3">
                        {sub ? (
                          <Badge variant="outline" className="font-normal">
                            {sub.plan_name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
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
                                await impersonateUser(
                                  u.id,
                                  u.display_name ?? u.email ?? u.id,
                                );
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
                          onClick={() =>
                            navigate({ to: "/admin/users/$id", params: { id: u.id } })
                          }
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                  {i18n.language === "pl" ? "Brak wyników" : "No results"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
