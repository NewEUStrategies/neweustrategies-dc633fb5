import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { updatePage, deletePage } from "@/lib/content.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PostEditor } from "@/components/admin/PostEditor";
import { Builder } from "@/components/admin/builder/Builder";
import type { BuilderDocument } from "@/lib/builder/types";
import { ArrowLeft, Save, Trash2 } from "@/lib/lucide-shim";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pages/$id")({
  component: EditPage,
});

type PageStatus = "draft" | "published" | "archived";
type EditorType = "richtext" | "markdown" | "builder";

interface PageForm {
  id: string;
  slug: string;
  status: PageStatus;
  editor: EditorType;
  title_pl: string;
  title_en: string;
  content_pl: string | null;
  content_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  builder_data: BuilderDocument | null;
}


function EditPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: page, isLoading } = useQuery({
    queryKey: ["page", id],
    queryFn: async (): Promise<PageForm> => {
      const { data, error } = await supabase.from("pages").select("*").eq("id", id).single();
      if (error) throw error;
      return data as PageForm;
    },
  });

  const [form, setForm] = useState<PageForm | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (page) setForm(page); }, [page]);

  if (isLoading || !form) return <div className="text-sm text-muted-foreground">...</div>;

  const set = <K extends keyof PageForm>(k: K, v: PageForm[K]) =>
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
            content_pl: form.content_pl,
            content_en: form.content_en,
            cover_image_url: form.cover_image_url,
            builder_data: form.builder_data,
          },
        },
      });
      qc.invalidateQueries({ queryKey: ["admin-pages"] });
      qc.invalidateQueries({ queryKey: ["page", id] });
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
      navigate({ to: "/admin/pages" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link to="/admin/pages" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
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
              <PageBuilderPane form={form} set={set} />
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
              <Select value={form.status} onValueChange={(v) => set("status", v as PageStatus)}>
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
              <Label>{t("admin.posts.cover")}</Label>
              <Input value={form.cover_image_url ?? ""} onChange={(e) => set("cover_image_url", e.target.value)} placeholder="https://..." />
              {form.cover_image_url && (
                <img src={form.cover_image_url} alt="" className="mt-2 rounded w-full h-24 object-cover" />
              )}
            </div>
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}

function PageBuilderPane({ form, set }: { form: { builder_data: BuilderDocument | null }; set: (k: "builder_data", v: BuilderDocument) => void }) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  return <Builder value={form.builder_data} onChange={(v) => set("builder_data", v)} lang={lang} onLangChange={setLang} />;
}

