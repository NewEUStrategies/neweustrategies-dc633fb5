import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { updatePost, deletePost } from "@/lib/content.functions";
import { migratePostToBlocks } from "@/lib/posts-migrate.functions";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useAutosave } from "@/hooks/useAutosave";
import { AutosaveBar } from "@/components/admin/AutosaveBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PostEditor } from "@/components/admin/PostEditor";
import { PageParentSelect } from "@/components/admin/PageParentSelect";
import { Builder } from "@/components/admin/builder/Builder";
import type { BuilderDocument } from "@/lib/builder/types";
import { ArrowLeft, Save, Trash2, ArrowRight, FileText, Settings as SettingsIcon, Layers } from "@/lib/lucide-shim";
import { PostBlockEditor } from "@/components/admin/blocks/PostBlockEditor";
import type { LocalizedBlocks, BlocksDoc } from "@/lib/blocks/types";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { getLayoutSet, findLayout, mergeOverrides, pickLayoutId } from "@/lib/postLayouts";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { LayoutPreview } from "@/components/admin/LayoutPreview";
import { LayoutScaffold } from "@/components/admin/blocks/LayoutScaffold";
import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";
import { CustomMetaValuesEditor } from "@/components/admin/CustomMetaValuesEditor";
import { RelatedOverrideEditor } from "@/components/admin/RelatedOverrideEditor";
import { toast } from "sonner";
import { invalidateWidgetCaches, emitWidgetCacheInvalidate } from "@/lib/builder/widgetCacheInvalidation";

export const Route = createFileRoute("/admin/posts/$slug")({
  component: EditPost,
});

type PostStatus = "draft" | "published" | "archived";
type EditorType = "blocks" | "richtext" | "markdown" | "builder";

import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";

interface PostForm {
  id: string;
  slug: string;
  status: PostStatus;
  editor: EditorType;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  content_pl: string | null;
  content_en: string | null;
  cover_image_url: string | null;
  read_minutes: number | null;
  published_at: string | null;
  builder_data: BuilderDocument | null;
  blocks_data: LocalizedBlocks | null;
  parent_page_id: string;
  post_format: PostFormat;
  layout_overrides: LayoutOverrides | null;
  takeaways_pl: string[];
  takeaways_en: string[];
  custom_meta: Record<string, string> | null;
  related_override: Record<string, unknown> | null;
}



interface CategoryOpt { id: string; name_pl: string; name_en: string }
interface TagOpt { id: string; name: string }

function EditPost() {
  const { slug: routeSlug } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tenantId = useRequiredTenant();
  const update$ = useServerFn(updatePost);
  const delete$ = useServerFn(deletePost);
  const migrate$ = useServerFn(migratePostToBlocks);
  const { data: globalLayout } = usePostLayoutSettings();

  const { data: post, isLoading } = useQuery({
    queryKey: ["post-by-slug", tenantId, routeSlug],
    enabled: !!tenantId,
    queryFn: async (): Promise<PostForm> => {
      const { data, error } = await supabase
        .from("posts").select("*")
        .eq("tenant_id", tenantId)
        .eq("slug", routeSlug)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data as PostForm;
    },
  });

  const id = post?.id ?? "";

  const { data: allCats } = useQuery({
    queryKey: ["categories", tenantId],
    queryFn: async (): Promise<CategoryOpt[]> => (await supabase.from("categories").select("id, name_pl, name_en").eq("tenant_id", tenantId).order("name_pl")).data ?? [],
  });
  const { data: allTags } = useQuery({
    queryKey: ["tags", tenantId],
    queryFn: async (): Promise<TagOpt[]> => (await supabase.from("tags").select("id, name").eq("tenant_id", tenantId).order("name")).data ?? [],
  });

  const { data: postCats } = useQuery({
    queryKey: ["post-cats", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("post_categories").select("category_id").eq("post_id", id)).data ?? [],
  });
  const { data: postTags } = useQuery({
    queryKey: ["post-tags", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("post_tags").select("tag_id").eq("post_id", id)).data ?? [],
  });

  const history = useUndoRedo<PostForm | null>(null);
  const form = history.state;
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Two-step flow: "details" shows metadata + titles + descriptions in both
  // languages; "content" opens the actual editor (builder / rich text).
  const [step, setStep] = useState<"details" | "content">("details");

  useEffect(() => { if (post) history.reset(post); }, [post, history.reset]);
  useEffect(() => { if (postCats) setSelectedCats(postCats.map((c) => c.category_id)); }, [postCats]);
  useEffect(() => { if (postTags) setSelectedTags(postTags.map((c) => c.tag_id)); }, [postTags]);

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z (or Ctrl+Y) = redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); history.undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); history.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.undo, history.redo]);

  const saveFn = useCallback(async (snapshot: PostForm | null) => {
    if (!snapshot) return;
    await update$({
      data: {
        id,
        fields: {
          slug: snapshot.slug,
          status: snapshot.status,
          editor: snapshot.editor,
          title_pl: snapshot.title_pl,
          title_en: snapshot.title_en,
          excerpt_pl: snapshot.excerpt_pl,
          excerpt_en: snapshot.excerpt_en,
          content_pl: snapshot.content_pl,
          content_en: snapshot.content_en,
          cover_image_url: snapshot.cover_image_url,
          read_minutes: snapshot.read_minutes,
          builder_data: snapshot.builder_data,
          blocks_data: snapshot.blocks_data as unknown as Record<string, unknown> | null,
          parent_page_id: snapshot.parent_page_id,
          post_format: snapshot.post_format,
          layout_overrides: snapshot.layout_overrides,
          takeaways_pl: snapshot.takeaways_pl ?? [],
          takeaways_en: snapshot.takeaways_en ?? [],
          custom_meta: snapshot.custom_meta ?? null,
          related_override: snapshot.related_override ?? null,
        },
        categories: selectedCats,
        tags: selectedTags,

      },
    });
    qc.invalidateQueries({ queryKey: ["admin-posts"] });
    qc.invalidateQueries({ queryKey: ["post-by-slug", tenantId, snapshot.slug] });
    // Refresh every widget cache that references posts (live sync across the site).
    invalidateWidgetCaches(qc);
    emitWidgetCacheInvalidate();
    if (snapshot.slug !== routeSlug) {
      navigate({ to: "/admin/posts/$slug", params: { slug: snapshot.slug }, replace: true });
    }
  }, [id, update$, selectedCats, selectedTags, qc, navigate, routeSlug, tenantId]);

  // Track tuple [form, cats, tags] for autosave so taxonomies persist too.
  const autoValue = useMemo(() => ({ form, cats: selectedCats, tags: selectedTags }),
    [form, selectedCats, selectedTags]);
  const autosave = useAutosave({
    value: autoValue, enabled: !!form,
    save: async (v) => { await saveFn(v.form); },
  });

  if (isLoading || !form) return <div className="text-sm text-muted-foreground">...</div>;

  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) =>
    history.set((f) => (f ? { ...f, [k]: v } : f), { coalesce: true });

  const pickImage = async (): Promise<string | null> => window.prompt("URL obrazka") ?? null;

  const save = async () => {
    setBusy(true);
    try {
      await autosave.flush();
      toast.success(t("admin.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!confirm(t("admin.confirmDelete"))) return;
    try {
      await delete$({ data: { id } });
      toast.success(t("admin.deleted"));
      navigate({ to: "/admin/posts" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const metaCard = (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold inline-flex items-center gap-2 mb-1">
        <SettingsIcon className="w-4 h-4" /> Ustawienia wpisu
      </h3>
      <div>
        <Label>{t("admin.posts.status")}</Label>
        <Select value={form.status} onValueChange={(v) => set("status", v as PostStatus)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">{t("admin.status.draft")}</SelectItem>
            <SelectItem value="published">{t("admin.status.published")}</SelectItem>
            <SelectItem value="archived">{t("admin.status.archived")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("admin.posts.editor")}</Label>
        <Select value={form.editor} onValueChange={(v) => set("editor", v as EditorType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="builder">{t("admin.posts.editorBuilder", { defaultValue: "Visual Builder (zalecane)" })}</SelectItem>
            <SelectItem value="richtext">{t("admin.posts.editorRichtext", { defaultValue: "Rich text (legacy)" })}</SelectItem>
            <SelectItem value="markdown">{t("admin.posts.editorMarkdown", { defaultValue: "Markdown (legacy)" })}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Slug</Label>
        <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} />
      </div>
      <PageParentSelect
        tenantId={tenantId}
        value={form.parent_page_id}
        onChange={(v) => v && set("parent_page_id", v)}
        label="Strona nadrzędna"
        noneLabel="- wybierz stronę -"
      />
      <div>
        <Label>{t("admin.posts.readMinutes")}</Label>
        <Input type="number" value={form.read_minutes ?? ""} onChange={(e) => set("read_minutes", e.target.value ? Number(e.target.value) : null)} />
      </div>
      <div>
        <Label>{t("admin.posts.cover")}</Label>
        <Input value={form.cover_image_url ?? ""} onChange={(e) => set("cover_image_url", e.target.value)} placeholder="https://..." />
        {form.cover_image_url && (
          <img src={form.cover_image_url} alt="" className="mt-2 rounded w-full h-24 object-cover" />
        )}
      </div>
    </div>
  );

  const ov: LayoutOverrides = (form.layout_overrides ?? {}) as LayoutOverrides;
  const setOv = (patch: Partial<LayoutOverrides>) => {
    const next = { ...ov, ...patch };
    // Drop empty object to null for cleanliness
    const hasAny = Object.values(next).some((v) => v !== undefined && v !== null && v !== "");
    set("layout_overrides", hasAny ? next : null);
  };
  const currentFormat: PostFormat = (ov.format ?? form.post_format ?? "standard") as PostFormat;
  const layoutSet = getLayoutSet(currentFormat);

  const layoutCard = (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold inline-flex items-center gap-2 mb-1">
        <Layers className="w-4 h-4" /> Layout wpisu
      </h3>
      <div>
        <Label>Format wpisu</Label>
        <Select value={form.post_format ?? "standard"} onValueChange={(v) => set("post_format", v as PostFormat)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="video">Video</SelectItem>
            <SelectItem value="audio">Audio</SelectItem>
            <SelectItem value="gallery">Gallery</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Layout (override)</Label>
        <Select
          value={ov.layout ?? "__inherit__"}
          onValueChange={(v) => setOv({ layout: v === "__inherit__" ? undefined : v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">- Użyj globalnego -</SelectItem>
            {layoutSet.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {globalLayout && (() => {
        const effective = mergeOverrides(globalLayout, ov);
        const layoutId = pickLayoutId(globalLayout, currentFormat, ov.layout);
        const preset = findLayout(currentFormat, layoutId);
        return (
          <div className="pt-2 border-t border-border space-y-1.5">
            <p className="text-xs text-muted-foreground">Podgląd na żywo</p>
            <LayoutPreview preset={preset} settings={effective} />
            <p className="text-[10px] text-muted-foreground">
              {preset.label} · format: {currentFormat}
              {ov.layout ? " · override" : " · z globalnych"}
            </p>
          </div>
        );
      })()}
      <div className="space-y-1.5 pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground mb-1">Nadpisz sekcje stopki (puste = z globalnych):</p>
        {([
          ["center_header", "Wyśrodkuj nagłówek"],
          ["show_post_tags_bar", "Pasek tagów"],
          ["show_sources_bar", "Pasek źródeł"],
          ["show_via_bar", "Pasek „via”"],
          ["show_author_card", "Karta autora"],
          ["show_prev_next", "Poprzedni / następny"],
          ["show_bottom_newsletter", "Newsletter pod wpisem"],
        ] as const).map(([key, label]) => {
          const val = ov[key];
          const tri = val === true ? "on" : val === false ? "off" : "inherit";
          return (
            <div key={key} className="flex items-center justify-between text-xs">
              <span>{label}</span>
              <Select value={tri} onValueChange={(v) => setOv({ [key]: v === "inherit" ? undefined : v === "on" } as Partial<LayoutOverrides>)}>
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Globalne</SelectItem>
                  <SelectItem value="on">Włącz</SelectItem>
                  <SelectItem value="off">Wyłącz</SelectItem>
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );

  const catsCard = (
    <div className="bg-card border border-border rounded-lg p-4">
      <Label className="mb-2 block">{t("admin.nav.categories")}</Label>
      <div className="space-y-1 max-h-48 overflow-auto">
        {allCats?.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedCats.includes(c.id)}
              onChange={(e) =>
                setSelectedCats((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))
              }
            />
            {c.name_pl} / {c.name_en}
          </label>
        ))}
        {!allCats?.length && <p className="text-xs text-muted-foreground">{t("admin.posts.noCats")}</p>}
      </div>
    </div>
  );

  const tagsCard = (
    <div className="bg-card border border-border rounded-lg p-4">
      <Label className="mb-2 block">{t("admin.nav.tags")}</Label>
      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-auto">
        {allTags?.map((tg) => {
          const active = selectedTags.includes(tg.id);
          return (
            <button
              key={tg.id}
              type="button"
              onClick={() =>
                setSelectedTags((s) => (active ? s.filter((x) => x !== tg.id) : [...s, tg.id]))
              }
              className={`px-2 py-1 text-xs rounded border transition ${active ? "bg-brand text-brand-foreground border-brand" : "bg-muted/30 border-border"}`}
            >
              {tg.name}
            </button>
          );
        })}
        {!allTags?.length && <p className="text-xs text-muted-foreground">{t("admin.posts.noTags")}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {step === "details" ? (
          <Link to="/admin/posts" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> {t("admin.back")}
          </Link>
        ) : (
          <button onClick={() => setStep("details")} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Szczegóły wpisu
          </button>
        )}
        <div className="flex items-center gap-2">
          {/* Step indicator */}
          <div className="hidden md:flex items-center gap-1 mr-2 text-xs">
            <button
              onClick={() => setStep("details")}
              className={`px-2 py-1 rounded inline-flex items-center gap-1 ${step === "details" ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`}
            >
              <SettingsIcon className="w-3.5 h-3.5" /> 1. Szczegóły
            </button>
            <span className="text-muted-foreground">→</span>
            <button
              onClick={() => setStep("content")}
              className={`px-2 py-1 rounded inline-flex items-center gap-1 ${step === "content" ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`}
            >
              <FileText className="w-3.5 h-3.5" /> 2. Treść
            </button>
          </div>
          <AutosaveBar
            status={autosave.status} error={autosave.error}
            canUndo={history.canUndo} canRedo={history.canRedo}
            onUndo={history.undo} onRedo={history.redo}
          />
          <Button variant="ghost" size="sm" onClick={del}><Trash2 className="w-4 h-4 mr-1 text-destructive" /> {t("admin.delete")}</Button>
          <Button onClick={save} disabled={busy}><Save className="w-4 h-4 mr-2" /> {busy ? "..." : t("admin.save")}</Button>
        </div>
      </div>

      {step === "details" ? (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-card border border-border rounded-lg p-5 space-y-5">
              <div>
                <h2 className="text-lg font-display font-semibold mb-1">Szczegóły wpisu</h2>
                <p className="text-xs text-muted-foreground">
                  Uzupełnij tytuł i opis w obu językach. Po zapisaniu przejdź do kroku „Treść”, by edytować treść właściwą.
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>{t("admin.posts.titleCol")} <span className="text-[10px] text-muted-foreground">(PL)</span></Label>
                  <Input value={form.title_pl} onChange={(e) => set("title_pl", e.target.value)} className="text-lg font-display" placeholder="Tytuł po polsku" />
                </div>
                <div>
                  <Label>{t("admin.posts.titleCol")} <span className="text-[10px] text-muted-foreground">(EN)</span></Label>
                  <Input value={form.title_en} onChange={(e) => set("title_en", e.target.value)} className="text-lg font-display" placeholder="Title in English" />
                </div>
                <div>
                  <Label>{t("admin.posts.excerpt")} <span className="text-[10px] text-muted-foreground">(PL)</span></Label>
                  <Textarea value={form.excerpt_pl ?? ""} onChange={(e) => set("excerpt_pl", e.target.value)} rows={4} placeholder="Krótki opis wpisu po polsku" />
                </div>
                <div>
                  <Label>{t("admin.posts.excerpt")} <span className="text-[10px] text-muted-foreground">(EN)</span></Label>
                  <Textarea value={form.excerpt_en ?? ""} onChange={(e) => set("excerpt_en", e.target.value)} rows={4} placeholder="Short excerpt in English" />
                </div>
              </div>

              <TakeawaysEditor
                pl={form.takeaways_pl ?? []}
                en={form.takeaways_en ?? []}
                onChange={(lang, next) => set(lang === "pl" ? "takeaways_pl" : "takeaways_en", next)}
              />

              <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Custom meta</h3>
                  <Link to="/admin/custom-meta" className="text-xs text-brand underline">Edytuj definicje</Link>
                </div>
                <CustomMetaValuesEditor
                  tenantId={tenantId}
                  lang="pl"
                  values={form.custom_meta}
                  onChange={(next) => set("custom_meta", next)}
                />
              </div>

              <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Powiązane wpisy - override</h3>
                  <Link to="/admin/related-posts" className="text-xs text-brand underline">Konfiguracja globalna</Link>
                </div>
                <RelatedOverrideEditor
                  value={form.related_override}
                  onChange={(next: Record<string, unknown> | null) => set("related_override", next)}
                />
              </div>

              <div className="flex justify-end pt-2 border-t border-border">
                <Button onClick={() => setStep("content")} disabled={!form.title_pl.trim() && !form.title_en.trim()}>
                  Przejdź do edycji treści <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
          <aside className="space-y-5">
            {metaCard}
            {layoutCard}
            {catsCard}
            {tagsCard}
            <AccessSettingsPane entityType="post" entityId={id} />
          </aside>
        </div>
      ) : (
        <div className="space-y-5">
          {form.editor === "builder" ? (
            <BuilderPane form={form} set={set} />
          ) : (
            <Tabs defaultValue="pl">
              <TabsList>
                <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
                <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
              </TabsList>
              <TabsContent value="pl" className="space-y-4 mt-4">
                <div>
                  <Label>{t("admin.posts.content")} (PL)</Label>
                  <PostEditor mode={form.editor === "markdown" ? "markdown" : "richtext"} value={form.content_pl ?? ""} onChange={(v) => set("content_pl", v)} onPickImage={pickImage} />
                </div>
              </TabsContent>
              <TabsContent value="en" className="space-y-4 mt-4">
                <div>
                  <Label>{t("admin.posts.content")} (EN)</Label>
                  <PostEditor mode={form.editor === "markdown" ? "markdown" : "richtext"} value={form.content_en ?? ""} onChange={(v) => set("content_en", v)} onPickImage={pickImage} />
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      )}
    </div>
  );
}

function BuilderPane({ form, set }: { form: { builder_data: BuilderDocument | null }; set: (k: "builder_data", v: BuilderDocument) => void }) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  return <Builder value={form.builder_data} onChange={(v) => set("builder_data", v)} lang={lang} onLangChange={setLang} />;
}

const MAX_TAKEAWAYS = 6;
const MAX_TAKEAWAY_LEN = 500;

function TakeawaysEditor({
  pl,
  en,
  onChange,
}: {
  pl: string[];
  en: string[];
  onChange: (lang: "pl" | "en", next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<"pl" | "en">("pl");
  const current = active === "pl" ? pl : en;

  const updateAt = (idx: number, value: string) => {
    const next = [...current];
    next[idx] = value.slice(0, MAX_TAKEAWAY_LEN);
    onChange(active, next);
  };
  const removeAt = (idx: number) => {
    const next = current.filter((_, i) => i !== idx);
    onChange(active, next);
  };
  const add = () => {
    if (current.length >= MAX_TAKEAWAYS) return;
    onChange(active, [...current, ""]);
  };

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">{t("post.takeaways.adminTitle")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t("post.takeaways.hint")}</p>
        </div>
        <Tabs value={active} onValueChange={(v) => setActive(v === "en" ? "en" : "pl")}>
          <TabsList>
            <TabsTrigger value="pl">PL ({pl.length}/{MAX_TAKEAWAYS})</TabsTrigger>
            <TabsTrigger value="en">EN ({en.length}/{MAX_TAKEAWAYS})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {current.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{t("post.takeaways.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {current.map((bullet, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
              <Textarea
                value={bullet}
                rows={2}
                maxLength={MAX_TAKEAWAY_LEN}
                placeholder={t("post.takeaways.placeholder", { n: i + 1 })}
                onChange={(e) => updateAt(i, e.target.value)}
                className="flex-1"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => removeAt(i)} aria-label={t("post.takeaways.remove")}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" onClick={add} disabled={current.length >= MAX_TAKEAWAYS}>
        + {t("post.takeaways.add")}
      </Button>
    </div>
  );
}


