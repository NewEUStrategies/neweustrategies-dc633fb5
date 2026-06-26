import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, ArrowUpDown, Eye } from "lucide-react";

export const Route = createFileRoute("/admin/users")({
  component: Users,
});

type Role = "admin" | "editor" | "author";

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

type SortKey = "display_name" | "email" | "role" | "created_at";
type SortDir = "asc" | "desc";

function Users() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const tenantId = useRequiredTenant();
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["all-users", tenantId],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, email, avatar_url, cover_url, slug, bio, bio_pl, bio_en, twitter_url, linkedin_url, website_url, created_at, updated_at")
          .eq("tenant_id", tenantId),
        supabase.from("user_roles").select("user_id, role").eq("tenant_id", tenantId),
      ]);
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as Role),
      }));
    },
  });

  const sorted = useMemo(() => {
    const list = [...(data ?? [])];
    list.sort((a, b) => {
      let av: string = "";
      let bv: string = "";
      if (sortKey === "role") { av = a.roles[0] ?? ""; bv = b.roles[0] ?? ""; }
      else if (sortKey === "display_name") { av = (a.display_name ?? "").toLowerCase(); bv = (b.display_name ?? "").toLowerCase(); }
      else if (sortKey === "email") { av = (a.email ?? "").toLowerCase(); bv = (b.email ?? "").toLowerCase(); }
      else { av = a.created_at; bv = b.created_at; }
      const r = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? r : -r;
    });
    return list;
  }, [data, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "created_at" ? "desc" : "asc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="inline w-3 h-3 ml-1 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="inline w-3 h-3 ml-1" /> : <ArrowDown className="inline w-3 h-3 ml-1" />;
  };

  const changeRole = async (uid: string, role: Role) => {
    await supabase.from("user_roles").delete().eq("user_id", uid).eq("tenant_id", tenantId);
    const { error } = await supabase.from("user_roles").insert({ user_id: uid, role, tenant_id: tenantId });
    if (error) { toast.error(error.message); return; }
    toast.success(t("admin.saved"));
    qc.invalidateQueries({ queryKey: ["all-users"] });
  };

  const active = sorted.find((u) => u.id === openId) ?? null;
  const locale = i18n.language === "pl" ? "pl-PL" : "en-US";

  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-6">{t("admin.users.title")}</h1>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3 cursor-pointer select-none" onClick={() => toggleSort("display_name")}>
                {t("admin.users.name")}<SortIcon k="display_name" />
              </th>
              <th className="text-left p-3 cursor-pointer select-none" onClick={() => toggleSort("email")}>
                Email<SortIcon k="email" />
              </th>
              <th className="text-left p-3 cursor-pointer select-none" onClick={() => toggleSort("role")}>
                {t("admin.users.role")}<SortIcon k="role" />
              </th>
              <th className="text-left p-3 cursor-pointer select-none" onClick={() => toggleSort("created_at")}>
                {t("admin.users.created")}<SortIcon k="created_at" />
              </th>
              <th className="text-right p-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id} className="border-t border-border hover:bg-muted/20 cursor-pointer" onClick={() => setOpenId(u.id)}>
                <td className="p-3 font-medium">
                  <div className="flex items-center gap-2">
                    {u.avatar_url ? <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" /> : <div className="w-7 h-7 rounded-full bg-muted" />}
                    {u.display_name ?? "-"}
                  </div>
                </td>
                <td className="p-3 text-muted-foreground">{u.email}</td>
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  {u.id === user?.id ? (
                    <Badge>{u.roles[0] ?? "-"}</Badge>
                  ) : (
                    <Select value={u.roles[0] ?? ""} onValueChange={(v) => changeRole(u.id, v as Role)}>
                      <SelectTrigger className="w-32"><SelectValue placeholder="-" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="author">Author</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString(locale)}</td>
                <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(u.id)}><Eye className="w-4 h-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle>{active.display_name ?? active.email ?? active.id}</DialogTitle>
              </DialogHeader>
              {active.cover_url && <img src={active.cover_url} alt="" className="w-full h-40 object-cover rounded-md" />}
              <div className="flex items-center gap-4">
                {active.avatar_url ? <img src={active.avatar_url} alt="" className="w-20 h-20 rounded-full object-cover" /> : <div className="w-20 h-20 rounded-full bg-muted" />}
                <div className="space-y-1">
                  <div className="text-lg font-semibold">{active.display_name ?? "-"}</div>
                  <div className="text-sm text-muted-foreground">{active.email}</div>
                  <div className="flex gap-1">{active.roles.map((r) => <Badge key={r}>{r}</Badge>)}</div>
                </div>
              </div>
              <Field label="ID" value={active.id} mono />
              <Field label="Slug" value={active.slug} />
              <Field label={t("admin.users.created")} value={new Date(active.created_at).toLocaleString(locale)} />
              {active.updated_at && <Field label="Updated" value={new Date(active.updated_at).toLocaleString(locale)} />}
              <Field label="Bio" value={active.bio} multiline />
              <Field label="Bio (PL)" value={active.bio_pl} multiline />
              <Field label="Bio (EN)" value={active.bio_en} multiline />
              <Field label="Website" value={active.website_url} link />
              <Field label="Twitter" value={active.twitter_url} link />
              <Field label="LinkedIn" value={active.linkedin_url} link />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, mono, multiline, link }: { label: string; value: string | null; mono?: boolean; multiline?: boolean; link?: boolean }) {
  if (!value) return null;
  return (
    <div className="border-t border-border pt-3">
      <div className="text-xs uppercase text-muted-foreground mb-1">{label}</div>
      {link ? (
        <a href={value} target="_blank" rel="noreferrer" className="text-sm text-primary underline break-all">{value}</a>
      ) : (
        <div className={`text-sm ${mono ? "font-mono text-xs" : ""} ${multiline ? "whitespace-pre-wrap" : ""} break-words`}>{value}</div>
      )}
    </div>
  );
}
