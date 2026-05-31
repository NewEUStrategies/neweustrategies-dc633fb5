import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { updatePage, deletePage } from "@/lib/content.functions";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useAutosave } from "@/hooks/useAutosave";
import { AutosaveBar } from "@/components/admin/AutosaveBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PostEditor } from "@/components/admin/PostEditor";
import { Builder } from "@/components/admin/builder/Builder";
import type { BuilderDocument } from "@/lib/builder/types";
import { ArrowLeft, Save, Trash2, ArrowRight, FileText, Settings as SettingsIcon } from "@/lib/lucide-shim";
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
  const update$ = useServerFn(updatePage);
  const delete$ = useServerFn(deletePage);

  const { data: page, isLoading } = useQuery({
    queryKey: ["page", id],
    queryFn: async (): Promise<PageForm> => {
      const { data, error } = await supabase.from("pages").select("*").eq("id", id).single();
      if (error) throw error;
      return data as PageForm;
    },
  });

  const history = useUndoRedo<PageForm | null>(null);
  const form = history.state;
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"details" | "content">("details");

  useEffect(() => { if (page) history.reset(page); }, [page, history.reset]);

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

  const saveFn = useCallback(async (snapshot: PageForm | null) => {
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
          content_pl: snapshot.content_pl,
          content_en: snapshot.content_en,
          cover_image_url: snapshot.cover_image_url,
          builder_data: snapshot.builder_data,
        },
      },
    });
    qc.invalidateQueries({ queryKey: ["admin-pages"] });
    qc.invalidateQueries({ queryKey: ["page", id] });
  }, [id, update$, qc]);

  const autosave = useAutosave({ value: form, enabled: !!form, save: saveFn });

  if (isLoading || !form) return <div className="text-sm text-muted-foreground">...</div>;

  const set = <K extends keyof PageForm>(k: K, v: PageForm[K]) =>
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
      navigate({ to: "/admin/pages" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const metaCard = (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold inline-flex items-center gap-2 mb-1">
        <SettingsIcon className="w-4 h-4" /> Ustawienia strony
      </h3>
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
            <SelectItem value="builder">Visual Builder (Elementor)</SelectItem>
            <SelectItem value="richtext">Rich text (legacy)</SelectItem>
            <SelectItem value="markdown">Markdown (legacy)</SelectItem>
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
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {step === "details" ? (
          <Link to="/admin/pages" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> {t("admin.back")}
          </Link>
        ) : (
          <button onClick={() => setStep("details")} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Szczegóły strony
          </button>
        )}
        <div className="flex items-center gap-2">
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
                <h2 className="text-lg font-display font-semibold mb-1">Szczegóły strony</h2>
                <p className="text-xs text-muted-foreground">
                  Uzupełnij tytuł strony w obu językach. Po zapisaniu przejdź do kroku „Treść”, by edytować zawartość.
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
              </div>
              <div className="flex justify-end pt-2 border-t border-border">
                <Button onClick={() => setStep("content")} disabled={!form.title_pl.trim() && !form.title_en.trim()}>
                  Przejdź do edycji treści <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
          <aside className="space-y-5">{metaCard}</aside>
        </div>
      ) : (
        <div className="space-y-5">
          {form.editor === "builder" ? (
            <PageBuilderPane form={form} set={set} />
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

function PageBuilderPane({ form, set }: { form: { builder_data: BuilderDocument | null }; set: (k: "builder_data", v: BuilderDocument) => void }) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  return <Builder value={form.builder_data} onChange={(v) => set("builder_data", v)} lang={lang} onLangChange={setLang} />;
}

