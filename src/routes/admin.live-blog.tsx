// Admin route: zarządzanie wpisami Live Blog dla wybranego postu i bloku.
// URL: /admin/live-blog?postId=...&blockId=...&lang=pl
//
// Zamiast ręcznego wklejania UUID postu i "b_xxx" ID bloku (poprzednia wersja
// była konsolą deweloperską): wybór postu z listy i automatyczne wykrycie
// bloków typu "liveblog" w jego treści. Wpisy można też edytować, nie tylko
// przypinać/usuwać.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import "@/lib/i18n-admin-misc-routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRequiredTenant } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeHtml } from "@/lib/sanitize";
import { adminToast } from "@/lib/adminToasts";

interface SearchParams {
  postId?: string;
  blockId?: string;
  lang?: "pl" | "en";
}

export const Route = createFileRoute("/admin/live-blog")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    postId: typeof s.postId === "string" ? s.postId : undefined,
    blockId: typeof s.blockId === "string" ? s.blockId : undefined,
    lang: s.lang === "en" ? "en" : "pl",
  }),
  component: LiveBlogAdmin,
  head: () => ({ meta: [{ title: "Live Blog - Admin" }] }),
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">404</div>,
});

interface EntryRow {
  id: string;
  post_id: string;
  block_id: string;
  lang: "pl" | "en";
  title: string | null;
  body_html: string;
  pinned: boolean;
  occurred_at: string;
}

interface PostOption {
  id: string;
  slug: string;
  title: string;
}

interface LiveBlogBlockOption {
  id: string;
  label: string;
}

/** Znajdź bloki typu "liveblog" w dokumencie blocks_data postu (dowolny język). */
function findLiveBlogBlocks(blocksData: unknown): LiveBlogBlockOption[] {
  const found: LiveBlogBlockOption[] = [];
  const seen = new Set<string>();
  const scan = (doc: unknown) => {
    if (!doc || typeof doc !== "object") return;
    const blocks = (doc as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) return;
    let n = 0;
    for (const b of blocks) {
      if (!b || typeof b !== "object") continue;
      const type = (b as { type?: unknown }).type;
      const id = (b as { id?: unknown }).id;
      if (type === "liveblog" && typeof id === "string" && !seen.has(id)) {
        seen.add(id);
        n += 1;
        const data = (b as { data?: { title?: unknown } }).data;
        const title = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : "";
        found.push({ id, label: title || `Live blog #${n}` });
      }
    }
  };
  if (blocksData && typeof blocksData === "object") {
    const lb = blocksData as Record<string, unknown>;
    scan(lb.pl);
    scan(lb.en);
    // Płaski dokument (bez rozbicia na języki).
    if ("blocks" in lb) scan(lb);
  }
  return found;
}

function LiveBlogAdmin() {
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const lang: "pl" | "en" = search.lang ?? "pl";

  // Lista postów do wyboru (kolumny nie-gated - bez treści).
  const { data: posts = [] } = useQuery({
    queryKey: ["admin", "live-blog", "posts", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<PostOption[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, title_pl, title_en, slug")
        .eq("tenant_id", tenantId!)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title_pl || p.title_en || p.slug,
      }));
    },
  });

  const selectedPost = posts.find((p) => p.id === search.postId);
  const selectedSlug = selectedPost?.slug;

  // Bloki live-blog wybranego postu (przez SECURITY DEFINER RPC - blocks_data
  // jest niedostępne bezpośrednim selectem dla roli authenticated). RPC
  // przyjmuje slug postu.
  const { data: blockOptions = [], isLoading: blocksLoading } = useQuery({
    queryKey: ["admin", "live-blog", "blocks", selectedSlug],
    enabled: !!selectedSlug,
    queryFn: async (): Promise<LiveBlogBlockOption[]> => {
      const { data, error } = await supabase.rpc("get_post_for_edit", {
        _slug: selectedSlug!,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return findLiveBlogBlocks((row as { blocks_data?: unknown } | null)?.blocks_data);
    },
  });

  // Deep-link z edytora bloku niesie tylko blockId (edytor bloku nie zna id
  // postu). Po wczytaniu bloków wybranego postu: zachowany blockId spoza tego
  // postu czyścimy, a gdy blockId nie wybrano i post ma dokładnie jeden blok
  // live blog - wybieramy go automatycznie.
  useEffect(() => {
    if (!search.postId || blocksLoading) return;
    if (search.blockId && !blockOptions.some((b) => b.id === search.blockId)) {
      void navigate({ search: (p: SearchParams) => ({ ...p, blockId: undefined }) });
      return;
    }
    if (!search.blockId && blockOptions.length === 1) {
      const only = blockOptions[0].id;
      void navigate({ search: (p: SearchParams) => ({ ...p, blockId: only }) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.postId, search.blockId, blocksLoading, blockOptions]);

  const enabled = !!search.postId && !!search.blockId;
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["liveBlogEntries", search.postId, search.blockId, lang] as const,
    enabled,
    queryFn: async (): Promise<EntryRow[]> => {
      const { data, error } = await supabase
        .from("live_blog_entries")
        .select("id, post_id, block_id, lang, title, body_html, pinned, occurred_at")
        .eq("post_id", search.postId!)
        .eq("block_id", search.blockId!)
        .eq("lang", lang)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EntryRow[];
    },
  });

  const [draft, setDraft] = useState({ title: "", body_html: "", pinned: false });
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const selectedPostTitle = useMemo(() => selectedPost?.title ?? "", [selectedPost]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["liveBlogEntries"] });

  const addEntry = async () => {
    if (!enabled) return toast.error(adminToast.error());
    if (!draft.body_html.trim()) return toast.error(adminToast.emptyContent());
    const { error } = await supabase.from("live_blog_entries").insert({
      tenant_id: tenantId,
      post_id: search.postId!,
      block_id: search.blockId!,
      lang,
      title: draft.title || null,
      body_html: draft.body_html,
      pinned: draft.pinned,
      occurred_at: new Date().toISOString(),
    });
    if (error) return toast.error(error.message);
    setDraft({ title: "", body_html: "", pinned: false });
    toast.success(adminToast.added());
    refresh();
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.body_html.trim()) return toast.error(adminToast.emptyContent());
    const { error } = await supabase
      .from("live_blog_entries")
      .update({ title: editing.title || null, body_html: editing.body_html })
      .eq("id", editing.id);
    if (error) return toast.error(error.message);
    setEditing(null);
    toast.success(adminToast.saved());
    refresh();
  };

  const togglePin = async (e: EntryRow) => {
    const { error } = await supabase
      .from("live_blog_entries")
      .update({ pinned: !e.pinned })
      .eq("id", e.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("live_blog_entries").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(adminToast.deleted());
    refresh();
  };

  const setSearch = (patch: Partial<SearchParams>) =>
    navigate({ search: (p: SearchParams) => ({ ...p, ...patch }) });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl">{t("adminMiscRoutes.liveBlog.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("adminMiscRoutes.liveBlog.intro")}</p>
      </header>

      <section className="rounded-md border p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Post</Label>
            <Select
              value={search.postId ?? ""}
              // blockId celowo NIE jest czyszczony: deep-link z edytora bloku
              // niesie tylko blockId - walidacja/auto-wybór w efekcie powyżej.
              onValueChange={(v) => setSearch({ postId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("adminMiscRoutes.liveBlog.selectPost")} />
              </SelectTrigger>
              <SelectContent>
                {posts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("adminMiscRoutes.liveBlog.block")}</Label>
            <Select
              value={search.blockId ?? ""}
              onValueChange={(v) => setSearch({ blockId: v })}
              disabled={!search.postId || blocksLoading || blockOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !search.postId
                      ? t("adminMiscRoutes.liveBlog.phSelectPostFirst")
                      : blocksLoading
                        ? t("adminMiscRoutes.liveBlog.phLoading")
                        : blockOptions.length === 0
                          ? t("adminMiscRoutes.liveBlog.phNoBlocks")
                          : t("adminMiscRoutes.liveBlog.phSelectBlock")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {blockOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("adminMiscRoutes.liveBlog.language")}</Label>
            <Select value={lang} onValueChange={(v) => setSearch({ lang: v as "pl" | "en" })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pl">PL</SelectItem>
                <SelectItem value="en">EN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {search.postId && blockOptions.length === 0 && !blocksLoading && (
          <p className="text-xs text-muted-foreground">
            {t("adminMiscRoutes.liveBlog.noBlockWarning", { title: selectedPostTitle })}
          </p>
        )}
      </section>

      {enabled && (
        <section className="rounded-md border p-4 space-y-3">
          <h2 className="font-medium">{t("adminMiscRoutes.liveBlog.newEntry")}</h2>
          <div>
            <Label>{t("adminMiscRoutes.liveBlog.titleOptional")}</Label>
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div>
            <Label>{t("adminMiscRoutes.liveBlog.contentLabel")}</Label>
            <Textarea
              rows={5}
              value={draft.body_html}
              onChange={(e) => setDraft({ ...draft, body_html: e.target.value })}
              placeholder="<p>...</p>"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={draft.pinned}
              onCheckedChange={(v) => setDraft({ ...draft, pinned: v })}
            />
            <span className="text-sm">{t("adminMiscRoutes.liveBlog.pinned")}</span>
          </div>
          <Button onClick={addEntry}>{t("adminMiscRoutes.liveBlog.publish")}</Button>
        </section>
      )}

      {enabled && (
        <section className="space-y-3">
          <h2 className="font-medium">
            {t("adminMiscRoutes.liveBlog.entries", { count: entries.length })}
            {isLoading && t("adminMiscRoutes.liveBlog.loadingSuffix")}
          </h2>
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <time className="text-xs font-mono text-muted-foreground">
                      {new Date(e.occurred_at).toLocaleString("pl-PL")}
                    </time>
                    {e.pinned && (
                      <span className="text-[10px] uppercase text-amber-600">
                        {t("adminMiscRoutes.liveBlog.pinnedBadge")}
                      </span>
                    )}
                    {e.title && <strong>{e.title}</strong>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(e)}>
                      {t("adminMiscRoutes.liveBlog.edit")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => togglePin(e)}>
                      {e.pinned
                        ? t("adminMiscRoutes.liveBlog.unpin")
                        : t("adminMiscRoutes.liveBlog.pin")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setConfirmId(e.id)}>
                      {t("adminMiscRoutes.liveBlog.remove")}
                    </Button>
                  </div>
                </div>
                {editing?.id === e.id ? (
                  <div className="space-y-2">
                    <Input
                      value={editing.title ?? ""}
                      onChange={(ev) => setEditing({ ...editing, title: ev.target.value })}
                      placeholder={t("adminMiscRoutes.liveBlog.titleOptional")}
                    />
                    <Textarea
                      rows={4}
                      value={editing.body_html}
                      onChange={(ev) => setEditing({ ...editing, body_html: ev.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit}>
                        {t("common.save")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(e.body_html) }}
                  />
                )}
              </li>
            ))}
            {entries.length === 0 && !isLoading && (
              <li className="text-sm text-muted-foreground">
                {t("adminMiscRoutes.liveBlog.empty")}
              </li>
            )}
          </ul>
        </section>
      )}

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminMiscRoutes.liveBlog.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminMiscRoutes.liveBlog.confirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmId) void remove(confirmId);
                setConfirmId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("adminMiscRoutes.liveBlog.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
