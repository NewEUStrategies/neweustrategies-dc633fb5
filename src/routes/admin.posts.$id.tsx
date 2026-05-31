import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { updatePost, deletePost } from "@/lib/content.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PostEditor } from "@/components/admin/PostEditor";
import { Builder } from "@/components/admin/builder/Builder";
import type { BuilderDocument } from "@/lib/builder/types";
import { ArrowLeft, Save, Trash2 } from "@/lib/lucide-shim";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/posts/$id")({
  component: EditPost,
});

type PostStatus = "draft" | "published" | "archived";
type EditorType = "richtext" | "markdown" | "builder";

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
}

interface CategoryOpt { id: string; name_pl: string; name_en: string }
interface TagOpt { id: string; name: string }

function EditPost() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tenantId = useRequiredTenant();

  const { data: post, isLoading } = useQuery({
    queryKey: ["post", id],
    queryFn: async (): Promise<PostForm> => {
      const { data, error } = await supabase.from("posts").select("*").eq("id", id).single();
      if (error) throw error;
      return data as PostForm;
    },
  });

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
    queryFn: async () => (await supabase.from("post_categories").select("category_id").eq("post_id", id)).data ?? [],
  });
  const { data: postTags } = useQuery({
    queryKey: ["post-tags", id],
    queryFn: async () => (await supabase.from("post_tags").select("tag_id").eq("post_id", id)).data ?? [],
  });

  const [form, setForm] = useState<PostForm | null>(null);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (post) setForm(post); }, [post]);
  useEffect(() => { if (postCats) setSelectedCats(postCats.map((c) => c.category_id)); }, [postCats]);
  useEffect(() => { if (postTags) setSelectedTags(postTags.map((c) => c.tag_id)); }, [postTags]);

  if (isLoading || !form) return <div className="text-sm text-muted-foreground">...</div>;

  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const pickImage = async (): Promise<string | null> => window.prompt("URL obrazka") ?? null;

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await update$({
        data: {
          id,
          fields: {
            slug: form.slug,
            status: form.status,
            editor: form.editor,
            title_pl: form.title_pl,
            title_en: form.title_en,
            excerpt_pl: form.excerpt_pl,
            excerpt_en: form.excerpt_en,
            content_pl: form.content_pl,
            content_en: form.content_en,
            cover_image_url: form.cover_image_url,
            read_minutes: form.read_minutes,
            builder_data: form.builder_data,
          },
          categories: selectedCats,
          tags: selectedTags,
        },
      });

      qc.invalidateQueries({ queryKey: ["admin-posts"] });
      qc.invalidateQueries({ queryKey: ["post", id] });
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link to="/admin/posts" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> {t("admin.back")}
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={del}><Trash2 className="w-4 h-4 mr-1 text-destructive" /> {t("admin.delete")}</Button>
          <Button onClick={save} disabled={busy}><Save className="w-4 h-4 mr-2" /> {busy ? "..." : t("admin.save")}</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className={form.editor === "builder" ? "lg:col-span-3 space-y-5" : "lg:col-span-2 space-y-5"}>
          {form.editor === "builder" ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("admin.posts.titleCol")} (PL)</Label>
                  <Input value={form.title_pl} onChange={(e) => set("title_pl", e.target.value)} className="text-lg font-display" />
                </div>
                <div>
                  <Label>{t("admin.posts.titleCol")} (EN)</Label>
                  <Input value={form.title_en} onChange={(e) => set("title_en", e.target.value)} className="text-lg font-display" />
                </div>
              </div>
              <BuilderPane form={form} set={set} />
            </>
          ) : (
            <Tabs defaultValue="pl">
              <TabsList>
                <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
                <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
              </TabsList>
              <TabsContent value="pl" className="space-y-4 mt-4">
                <div>
                  <Label>{t("admin.posts.titleCol")} (PL)</Label>
                  <Input value={form.title_pl} onChange={(e) => set("title_pl", e.target.value)} className="text-xl font-display" />
                </div>
                <div>
                  <Label>{t("admin.posts.excerpt")} (PL)</Label>
                  <Textarea value={form.excerpt_pl ?? ""} onChange={(e) => set("excerpt_pl", e.target.value)} rows={3} />
                </div>
                <div>
                  <Label>{t("admin.posts.content")} (PL)</Label>
                  <PostEditor mode={form.editor === "markdown" ? "markdown" : "richtext"} value={form.content_pl ?? ""} onChange={(v) => set("content_pl", v)} onPickImage={pickImage} />
                </div>
              </TabsContent>
              <TabsContent value="en" className="space-y-4 mt-4">
                <div>
                  <Label>{t("admin.posts.titleCol")} (EN)</Label>
                  <Input value={form.title_en} onChange={(e) => set("title_en", e.target.value)} className="text-xl font-display" />
                </div>
                <div>
                  <Label>{t("admin.posts.excerpt")} (EN)</Label>
                  <Textarea value={form.excerpt_en ?? ""} onChange={(e) => set("excerpt_en", e.target.value)} rows={3} />
                </div>
                <div>
                  <Label>{t("admin.posts.content")} (EN)</Label>
                  <PostEditor mode={form.editor === "markdown" ? "markdown" : "richtext"} value={form.content_en ?? ""} onChange={(v) => set("content_en", v)} onPickImage={pickImage} />
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>

        {form.editor !== "builder" && (
        <aside className="space-y-5">
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
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
                  <SelectItem value="richtext">Rich text</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="builder">Drag &amp; Drop Builder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} />
            </div>
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
        </aside>
        )}
      </div>
    </div>
  );
}

function BuilderPane({ form, set }: { form: { builder_data: BuilderDocument | null }; set: (k: "builder_data", v: BuilderDocument) => void }) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  return <Builder value={form.builder_data} onChange={(v) => set("builder_data", v)} lang={lang} onLangChange={setLang} />;
}

