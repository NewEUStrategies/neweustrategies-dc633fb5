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
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Undo2, X, Search } from "@/lib/lucide-shim";
import {
  deletePost,
  bulkDeletePosts,
  bulkUpdatePosts,
  restorePosts,
  purgePosts,
} from "@/lib/content.functions";
import { bulkMigratePostsToBlocks } from "@/lib/posts-migrate.functions";
import { toast } from "sonner";
import { BulkActionsBar, type BulkStatus } from "@/components/admin/BulkActionsBar";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import {
  AdminListToolbar,
  type StatusFilter,
  type LangFilter,
} from "@/components/admin/molecules/AdminListToolbar";
import { LangCoverageBadges } from "@/components/admin/atoms/LangCoverageBadges";
import { useTenantAuthors, authorLabel } from "@/components/admin/hooks/useTenantAuthors";

export const Route = createFileRoute("/admin/posts")({
  component: PostsLayout,
});

function PostsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path !== "/admin/posts") return <Outlet />;
  return <PostsList />;
}

type View = "active" | "trash";

function PostsList() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? "pl";
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const del$ = useServerFn(deletePost);
  const bulkDel$ = useServerFn(bulkDeletePosts);
  const bulkUpd$ = useServerFn(bulkUpdatePosts);
  const restore$ = useServerFn(restorePosts);
  const purge$ = useServerFn(purgePosts);
  const migrate$ = useServerFn(bulkMigratePostsToBlocks);
  const [view, setView] = useState<View>("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [langFilter, setLangFilter] = useState<LangFilter>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [trashFrom, setTrashFrom] = useState("");
  const [trashTo, setTrashTo] = useState("");

  const authorsQ = useTenantAuthors(tenantId);
  const authorMap = useMemo(
    () => new Map((authorsQ.data ?? []).map((a) => [a.id, a])),
    [authorsQ.data],
  );

  const { data: posts, isLoading } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-posts", tenantId, view],
    queryFn: async () => {
      let q = supabase
        .from("posts")
        .select(
          "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, status, published_at, updated_at, author_id, deleted_at",
        )
        .eq("tenant_id", tenantId!)
        .order(view === "trash" ? "deleted_at" : "updated_at", { ascending: false });
      q = view === "trash" ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const { data: trashCount } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-posts-trash-count", tenantId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .not("deleted_at", "is", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const isTrash = view === "trash";

  const coverageOf = (p: { title_pl: string | null; title_en: string | null }) => ({
    pl: !!(p.title_pl && p.title_pl.trim()),
    en: !!(p.title_en && p.title_en.trim()),
  });

  const filteredPosts = useMemo(() => {
    if (!posts) return [];
    const q = search.trim().toLowerCase();
    const fromTs = trashFrom ? new Date(trashFrom).getTime() : null;
    const toTs = trashTo ? new Date(trashTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    return posts.filter((p) => {
      if (q) {
        const t1 = (p.title_pl ?? "").toLowerCase();
        const t2 = (p.title_en ?? "").toLowerCase();
        const s = (p.slug ?? "").toLowerCase();
        if (!t1.includes(q) && !t2.includes(q) && !s.includes(q)) return false;
      }
      if (!isTrash && statusFilter !== "all" && p.status !== statusFilter) return false;
      if (authorFilter !== "all" && p.author_id !== authorFilter) return false;
      if (langFilter !== "all") {
        const c = coverageOf(p);
        if (langFilter === "complete" && !(c.pl && c.en)) return false;
        if (langFilter === "missing_any" && c.pl && c.en) return false;
        if (langFilter === "pl_only" && !(c.pl && !c.en)) return false;
        if (langFilter === "en_only" && !(c.en && !c.pl)) return false;
      }
      if (isTrash && (fromTs !== null || toTs !== null)) {
        const d = p.deleted_at ? new Date(p.deleted_at).getTime() : 0;
        if (fromTs !== null && d < fromTs) return false;
        if (toTs !== null && d > toTs) return false;
      }
      return true;
    });
  }, [posts, isTrash, search, statusFilter, langFilter, authorFilter, trashFrom, trashTo]);

  const allIds = useMemo(() => filteredPosts.map((p) => p.id), [filteredPosts]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const clear = () => setSelected(new Set());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-posts"] });
    qc.invalidateQueries({ queryKey: ["admin-posts-trash-count"] });
  };

  const titleOf = (p: { title_pl: string | null; title_en: string | null; slug: string }) =>
    (lang === "en" ? p.title_en : p.title_pl) || p.slug;

  const del = (id: string, title: string) => {
    setConfirmState({
      title: "Przenieść do kosza?",
      description: `Wpis "${title}" zostanie przeniesiony do kosza. Możesz go później przywrócić.`,
      confirmLabel: "Przenieś do kosza",
      destructive: true,
      onConfirm: async () => {
        try {
          await del$({ data: { id } });
          toast.success("Przeniesiono do kosza");
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const onBulkDelete = () => {
    const ids = [...selected];
    setConfirmState({
      title: `Przenieść do kosza ${ids.length} wpisów?`,
      description: "Zaznaczone wpisy zostaną przeniesione do kosza.",
      confirmLabel: "Przenieś do kosza",
      destructive: true,
      onConfirm: async () => {
        try {
          await bulkDel$({ data: { ids } });
          toast.success(`Przeniesiono do kosza: ${ids.length}`);
          clear();
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const onBulkStatus = async (status: BulkStatus) => {
    try {
      const ids = [...selected];
      await bulkUpd$({ data: { ids, status } });
      toast.success(`Zaktualizowano ${ids.length}`);
      clear();
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const restoreOne = (id: string, title: string) => {
    setConfirmState({
      title: "Przywrócić wpis?",
      description: `"${title}" zostanie przywrócony z kosza.`,
      confirmLabel: "Przywróć",
      onConfirm: async () => {
        try {
          await restore$({ data: { ids: [id] } });
          toast.success("Przywrócono");
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };
  const purgeOne = (id: string, title: string) => {
    setConfirmState({
      title: "Usunąć trwale?",
      description: `"${title}" zostanie nieodwracalnie usunięty. Tej operacji nie można cofnąć.`,
      confirmLabel: "Usuń trwale",
      destructive: true,
      onConfirm: async () => {
        try {
          await purge$({ data: { ids: [id] } });
          toast.success("Usunięto trwale");
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };
  const onBulkRestore = () => {
    const ids = [...selected];
    setConfirmState({
      title: `Przywrócić ${ids.length} wpisów?`,
      description: "Zaznaczone wpisy zostaną przywrócone z kosza.",
      confirmLabel: "Przywróć",
      onConfirm: async () => {
        try {
          await restore$({ data: { ids } });
          toast.success(`Przywrócono: ${ids.length}`);
          clear();
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };
  const onBulkMigrate = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const res = await migrate$({ data: { ids } });
      toast.success(`Skonwertowano: ${res.migrated}/${res.total}`);
      clear();
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const onBulkPurge = () => {
    const ids = [...selected];
    setConfirmState({
      title: `Usunąć trwale ${ids.length} wpisów?`,
      description: "Zaznaczone wpisy zostaną nieodwracalnie usunięte. Tej operacji nie można cofnąć.",
      confirmLabel: "Usuń trwale",
      destructive: true,
      onConfirm: async () => {
        try {
          await purge$({ data: { ids } });
          toast.success(`Usunięto trwale: ${ids.length}`);
          clear();
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("admin.posts.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{filteredPosts.length} {t("admin.posts.count")}</p>
        </div>
        <Link to="/admin/posts/new">
          <Button><Plus className="w-4 h-4 mr-2" /> {t("admin.posts.new")}</Button>
        </Link>
      </div>

      <Tabs value={view} onValueChange={(v) => { setView(v as View); clear(); }} className="mb-4">
        <TabsList>
          <TabsTrigger value="active">Wszystkie</TabsTrigger>
          <TabsTrigger value="trash">
            Kosz{typeof trashCount === "number" && trashCount > 0 ? ` (${trashCount})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isTrash && (
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Szukaj po tytule lub slugu…"
              value={trashSearch}
              onChange={(e) => setTrashSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground mb-1">Usunięto od</label>
            <Input type="date" value={trashFrom} onChange={(e) => setTrashFrom(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground mb-1">Usunięto do</label>
            <Input type="date" value={trashTo} onChange={(e) => setTrashTo(e.target.value)} />
          </div>
          {(trashSearch || trashFrom || trashTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setTrashSearch(""); setTrashFrom(""); setTrashTo(""); }}>
              <X className="w-4 h-4 mr-1" /> Wyczyść
            </Button>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isTrash ? (
          selected.size > 0 ? (
            <div className="flex items-center gap-2 p-2 border-b border-border bg-muted/30 text-sm">
              <span className="px-2">Zaznaczono: {selected.size}</span>
              <Button size="sm" variant="outline" onClick={onBulkRestore}>
                <Undo2 className="w-4 h-4 mr-2" /> Przywróć
              </Button>
              <Button size="sm" variant="destructive" onClick={onBulkPurge}>
                <Trash2 className="w-4 h-4 mr-2" /> Usuń trwale
              </Button>
              <Button size="sm" variant="ghost" onClick={clear} className="ml-auto">
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : null
        ) : (
          <BulkActionsBar
            count={selected.size}
            onClear={clear}
            onApplyStatus={onBulkStatus}
            onDelete={onBulkDelete}
            onMigrateToBlocks={onBulkMigrate}
          />
        )}
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">…</div>
        ) : !filteredPosts.length ? (
          <div className="p-12 text-center text-muted-foreground">
            {isTrash ? (posts?.length ? "Brak wyników dla filtrów" : "Kosz jest pusty") : t("admin.posts.empty")}
          </div>
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
                <th className="text-left p-3 hidden md:table-cell">
                  {isTrash ? "Usunięto" : t("admin.posts.updated")}
                </th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPosts.map((p) => (
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
                    {new Date((isTrash && p.deleted_at) ? p.deleted_at : p.updated_at).toLocaleString(lang)}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      {isTrash ? (
                        <>
                          <Button size="sm" variant="ghost" title="Przywróć" onClick={() => restoreOne(p.id, titleOf(p))}>
                            <Undo2 className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Usuń trwale" onClick={() => purgeOne(p.id, titleOf(p))}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Link to="/admin/posts/$id" params={{ id: p.id }}>
                            <Button size="sm" variant="ghost"><Pencil className="w-4 h-4" /></Button>
                          </Link>
                          <Button size="sm" variant="ghost" title="Do kosza" onClick={() => del(p.id, titleOf(p))}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog state={confirmState} onOpenChange={(o) => { if (!o) setConfirmState(null); }} />
    </div>
  );
}
