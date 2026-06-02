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

      <Tabs value={view} onValueChange={(v) => { setView(v as View); clear(); }} className="mb-3">
        <TabsList className="h-8">
          <TabsTrigger value="active" className="text-xs h-7">{t("admin.list.tabs.all", { defaultValue: "Wszystkie" })}</TabsTrigger>
          <TabsTrigger value="trash" className="text-xs h-7">
            {t("admin.list.tabs.trash", { defaultValue: "Kosz" })}{typeof trashCount === "number" && trashCount > 0 ? ` (${trashCount})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AdminListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t("admin.list.searchPosts", { defaultValue: "Szukaj wpisów…" })}
        status={statusFilter}
        onStatus={setStatusFilter}
        hideStatus={isTrash}
        lang={langFilter}
        onLang={setLangFilter}
        author={authorFilter}
        onAuthor={setAuthorFilter}
        authors={authorsQ.data ?? []}
        resultsCount={filteredPosts.length}
        totalCount={posts?.length}
      />

      {isTrash && (
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-muted-foreground mb-1">{t("admin.list.deletedFrom", { defaultValue: "Usunięto od" })}</label>
            <Input type="date" value={trashFrom} onChange={(e) => setTrashFrom(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-muted-foreground mb-1">{t("admin.list.deletedTo", { defaultValue: "Usunięto do" })}</label>
            <Input type="date" value={trashTo} onChange={(e) => setTrashTo(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isTrash ? (
          selected.size > 0 ? (
            <div className="flex items-center gap-2 p-2 border-b border-border bg-muted/30 text-xs">
              <span className="px-2">{t("admin.list.selected", { defaultValue: "Zaznaczono" })}: {selected.size}</span>
              <Button size="sm" variant="outline" onClick={onBulkRestore} className="h-7 text-xs">
                <Undo2 className="w-3.5 h-3.5 mr-1.5" /> {t("admin.list.restore", { defaultValue: "Przywróć" })}
              </Button>
              <Button size="sm" variant="destructive" onClick={onBulkPurge} className="h-7 text-xs">
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {t("admin.list.purge", { defaultValue: "Usuń trwale" })}
              </Button>
              <Button size="sm" variant="ghost" onClick={clear} className="ml-auto h-7">
                <X className="w-3.5 h-3.5" />
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
          <div className="p-8 text-center text-muted-foreground text-xs">…</div>
        ) : !filteredPosts.length ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            {isTrash
              ? (posts?.length ? t("admin.list.noResults", { defaultValue: "Brak wyników dla filtrów" }) : t("admin.list.trashEmpty", { defaultValue: "Kosz jest pusty" }))
              : (posts?.length ? t("admin.list.noResults", { defaultValue: "Brak wyników dla filtrów" }) : t("admin.posts.empty"))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
                <tr>
                  <th className="p-2 w-8">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label={t("admin.list.selectAll", { defaultValue: "Zaznacz wszystkie" })}
                    />
                  </th>
                  <th className="text-left p-2">{t("admin.posts.titleCol")}</th>
                  <th className="text-left p-2 w-[110px]">{t("admin.list.lang.col", { defaultValue: "Języki" })}</th>
                  <th className="text-left p-2 w-[120px]">{t("admin.list.author.col", { defaultValue: "Autor" })}</th>
                  <th className="text-left p-2 w-[110px]">{t("admin.posts.status")}</th>
                  <th className="text-left p-2 w-[150px] hidden md:table-cell">
                    {isTrash ? t("admin.list.deletedAt", { defaultValue: "Usunięto" }) : t("admin.posts.updated")}
                  </th>
                  <th className="p-2 w-[90px]" />
                </tr>
              </thead>
              <tbody>
                {filteredPosts.map((p) => {
                  const cov = coverageOf(p);
                  const author = p.author_id ? authorMap.get(p.author_id) : null;
                  return (
                    <tr key={p.id} className={`border-t border-border hover:bg-muted/20 ${selected.has(p.id) ? "bg-muted/30" : ""}`}>
                      <td className="p-2">
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={() => toggleOne(p.id)}
                          aria-label={t("admin.list.select", { defaultValue: "Zaznacz" })}
                        />
                      </td>
                      <td className="p-2">
                        <div className="font-medium text-[13px] truncate max-w-[420px]">
                          {(lang === "en" ? p.title_en : p.title_pl) || (lang === "en" ? p.title_pl : p.title_en) || <span className="italic text-muted-foreground">- {t("admin.list.untitled", { defaultValue: "bez tytułu" })} -</span>}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[420px]">/{p.slug}</div>
                      </td>
                      <td className="p-2">
                        <LangCoverageBadges
                          pl={cov.pl}
                          en={cov.en}
                          missingTitlePl={t("admin.list.lang.missingPl", { defaultValue: "Brak wersji PL" })}
                          missingTitleEn={t("admin.list.lang.missingEn", { defaultValue: "Brak wersji EN" })}
                        />
                      </td>
                      <td className="p-2 text-muted-foreground truncate max-w-[140px]" title={authorLabel(author)}>
                        {authorLabel(author)}
                      </td>
                      <td className="p-2">
                        <Badge variant={p.status === "published" ? "default" : p.status === "draft" ? "secondary" : "outline"} className="text-[10px] py-0 px-1.5">
                          {t(`admin.status.${p.status}`)}
                        </Badge>
                      </td>
                      <td className="p-2 hidden md:table-cell text-muted-foreground text-[11px] tabular-nums">
                        {new Date((isTrash && p.deleted_at) ? p.deleted_at : p.updated_at).toLocaleString(lang)}
                      </td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-0.5">
                          {isTrash ? (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title={t("admin.list.restore", { defaultValue: "Przywróć" })} onClick={() => restoreOne(p.id, titleOf(p))}>
                                <Undo2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title={t("admin.list.purge", { defaultValue: "Usuń trwale" })} onClick={() => purgeOne(p.id, titleOf(p))}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Link to="/admin/posts/$id" params={{ id: p.id }}>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
                              </Link>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title={t("admin.list.toTrash", { defaultValue: "Do kosza" })} onClick={() => del(p.id, titleOf(p))}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>


      <ConfirmDialog state={confirmState} onOpenChange={(o) => { if (!o) setConfirmState(null); }} />
    </div>
  );
}
