import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  component: Users,
});

type Role = "admin" | "editor" | "author";

interface UserRow {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  roles: Role[];
}

function Users() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const tenantId = useRequiredTenant();

  const { data } = useQuery({
    queryKey: ["all-users", tenantId],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, display_name, email, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role").eq("tenant_id", tenantId),
      ]);
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as Role),
      }));
    },
  });

  const changeRole = async (uid: string, role: Role) => {
    await supabase.from("user_roles").delete().eq("user_id", uid).eq("tenant_id", tenantId);
    const { error } = await supabase.from("user_roles").insert({ user_id: uid, role, tenant_id: tenantId });
    if (error) { toast.error(error.message); return; }
    toast.success(t("admin.saved"));
    qc.invalidateQueries({ queryKey: ["all-users"] });
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-6">{t("admin.nav.users")}</h1>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">{t("admin.users.name")}</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">{t("admin.users.role")}</th>
              <th className="text-left p-3">{t("admin.users.created")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="p-3 font-medium">{u.display_name}</td>
                <td className="p-3 text-muted-foreground">{u.email}</td>
                <td className="p-3">
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
                <td className="p-3 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
