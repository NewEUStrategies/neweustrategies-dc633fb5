import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2 } from "@/lib/lucide-shim";
import { deletePost, bulkDeletePosts, bulkUpdatePosts } from "@/lib/content.functions";
import { toast } from "sonner";
import { BulkActionsBar, type BulkStatus } from "@/components/admin/BulkActionsBar";

export const Route = createFileRoute("/admin/posts")({
  component: PostsLayout,
});

function PostsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path !== "/admin/posts") return <Outlet />;
  return <PostsList />;
}

function PostsList() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? "pl";
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const del$ = useServerFn(deletePost);
  const bulkDel$ = useServerFn(bulkDeletePosts);
  const bulkUpd$ = useServerFn(bulkUpdatePosts);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: posts, isLoading } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-posts", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, status, published_at, updated_at, author_id")
        .eq("tenant_id", tenantId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const allIds = useMemo(() => posts?.map((p) => p.id) ?? [], [posts]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  };
  const clear = () => setSelected(new Set());

  const del = async (id: string) => {
    if (!confirm(t("admin.confirmDelete"))) return;
    try {
      await del$({ data: { id } });
      toast.success(t("admin.deleted"));
      qc.invalidateQueries({ queryKey: ["admin-posts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onBulkDelete = async () => {
    try {
      const ids = [...selected];
      await bulkDel$({ data: { ids } });
      toast.success(`Usunięto ${ids.length}`);
      clear();
      qc.invalidateQueries({ queryKey: ["admin-posts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onBulkStatus = async (status: BulkStatus) => {
    try {
      const ids = [...selected];
      await bulkUpd$({ data: { ids, status } });
      toast.success(`Zaktualizowano ${ids.length}`);
      clear();
      qc.invalidateQueries({ queryKey: ["admin-posts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("admin.posts.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{posts?.length ?? 0} {t("admin.posts.count")}</p>
        </div>
        <Link to="/admin/posts/new">
          <Button><Plus className="w-4 h-4 mr-2" /> {t("admin.posts.new")}</Button>
        </Link>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <BulkActionsBar
          count={selected.size}
          onClear={clear}
          onApplyStatus={onBulkStatus}
          onDelete={onBulkDelete}
        />
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">…</div>
        ) : !posts?.length ? (
          <div className="p-12 text-center text-muted-foreground">{t("admin.posts.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 w-8">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Zaznacz wszystkie"
                  />
                </th>
                <th className="text-left p-3">{t("admin.posts.titleCol")}</th>
                <th className="text-left p-3">{t("admin.posts.status")}</th>
                <th className="text-left p-3 hidden md:table-cell">{t("admin.posts.updated")}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className={`border-t border-border hover:bg-muted/20 ${selected.has(p.id) ? "bg-muted/30" : ""}`}>
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleOne(p.id)}
                      aria-label="Zaznacz"
                    />
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{(lang === "en" ? p.title_en : p.title_pl) || <span className="italic text-muted-foreground">- bez tytułu -</span>}</div>
                    <div className="text-xs text-muted-foreground">{p.slug}</div>
                  </td>
                  <td className="p-3">
                    <Badge variant={p.status === "published" ? "default" : p.status === "draft" ? "secondary" : "outline"}>
                      {t(`admin.status.${p.status}`)}
                    </Badge>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground text-xs">
                    {new Date(p.updated_at).toLocaleString(lang)}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Link to="/admin/posts/$id" params={{ id: p.id }}>
                        <Button size="sm" variant="ghost"><Pencil className="w-4 h-4" /></Button>
                      </Link>
                      <Button size="sm" variant="ghost" onClick={() => del(p.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
