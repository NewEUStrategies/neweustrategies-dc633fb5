import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus, Save, Trash2, ChevronUp, ChevronDown } from "@/lib/lucide-shim";
import { useAuth } from "@/hooks/useAuth";
import "@/lib/i18n-admin-misc-routes";
import {
  newStoryPage,
  safeParsePages,
  type StoryPage,
  type WebStory,
  type WebStoryStatus,
} from "@/lib/web-stories/types";
import { adminToast } from "@/lib/adminToasts";

export const Route = createFileRoute("/admin/web-stories")({ component: Page });

type Row = Pick<WebStory, "id" | "slug" | "title_pl" | "title_en" | "status" | "cover_url"> & {
  published_at: string | null;
};

function Page() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<WebStory | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["admin", "web-stories"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("web_stories")
        .select("id,slug,title_pl,title_en,status,cover_url,published_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const loadOne = useMutation({
    mutationFn: async (id: string): Promise<WebStory> => {
      const { data, error } = await supabase
        .from("web_stories")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) throw error ?? new Error("Not found");
      return { ...data, status: data.status as WebStoryStatus, pages: safeParsePages(data.pages) };
    },
    onSuccess: (d) => setEditing(d),
  });

  const newDraft = (): WebStory => ({
    id: "",
    tenant_id: tenantId ?? "",
    slug: "",
    title_pl: "Nowa historia",
    title_en: "",
    description_pl: "",
    description_en: "",
    cover_url: null,
    pages: [newStoryPage()],
    status: "draft",
    published_at: null,
    author_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const save = useMutation({
    mutationFn: async (s: WebStory) => {
      const slug = (s.slug || s.title_pl)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug) throw new Error(t("adminMiscRoutes.webStories.errSlug"));
      if (!s.pages.length) throw new Error(t("adminMiscRoutes.webStories.errPages"));
      const payload = {
        slug,
        title_pl: s.title_pl,
        title_en: s.title_en,
        description_pl: s.description_pl,
        description_en: s.description_en,
        cover_url: s.cover_url,
        pages: s.pages,
        status: s.status,
        published_at:
          s.status === "published" ? (s.published_at ?? new Date().toISOString()) : s.published_at,
      };
      if (s.id) {
        const { error } = await supabase.from("web_stories").update(payload).eq("id", s.id);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error(t("adminMiscRoutes.webStories.errTenant"));
        const { error } = await supabase
          .from("web_stories")
          .insert({ ...payload, tenant_id: tenantId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "web-stories"] });
      qc.invalidateQueries({ queryKey: ["web-stories"] });
      toast.success(adminToast.saved());
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("web_stories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "web-stories"] });
      toast.success(adminToast.deleted());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl">Web Stories</h1>
          <Button onClick={() => setEditing(newDraft())}>
            <Plus className="w-4 h-4 mr-2" />
            {t("adminMiscRoutes.webStories.newStory")}
          </Button>
        </div>

        {editing ? (
          <Editor
            s={editing}
            onCancel={() => setEditing(null)}
            onSave={(s) => save.mutate(s)}
            saving={save.isPending}
          />
        ) : (
          <section className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2 w-12"></th>
                  <th className="text-left p-2">{t("adminMiscRoutes.webStories.colTitle")}</th>
                  <th className="text-left p-2">Slug</th>
                  <th className="text-left p-2">Status</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="p-2">
                      {r.cover_url ? (
                        <img src={r.cover_url} alt="" className="w-10 h-14 object-cover rounded" />
                      ) : (
                        <div className="w-10 h-14 bg-muted rounded" />
                      )}
                    </td>
                    <td className="p-2">
                      <button
                        className="hover:underline text-left"
                        onClick={() => loadOne.mutate(r.id)}
                      >
                        {r.title_pl}
                      </button>
                    </td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">{r.slug}</td>
                    <td className="p-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-muted">{r.status}</span>
                    </td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => {
                          if (confirm(t("adminMiscRoutes.webStories.confirmRemove")))
                            remove.mutate(r.id);
                        }}
                        className="text-xs text-destructive hover:underline"
                      >
                        <Trash2 className="w-3 h-3 inline mr-1" />
                        {t("adminMiscRoutes.webStories.remove")}
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows?.length && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      {t("adminMiscRoutes.webStories.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </AdminShell>
  );
}

function Editor({
  s,
  onSave,
  onCancel,
  saving,
}: {
  s: WebStory;
  onSave: (s: WebStory) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState<WebStory>(s);
  const [activePage, setActivePage] = useState(0);
  const upd = (patch: Partial<WebStory>) => setD({ ...d, ...patch });
  const updPage = (i: number, patch: Partial<StoryPage>) => {
    const next = [...d.pages];
    next[i] = { ...next[i], ...patch };
    setD({ ...d, pages: next });
  };
  const movePage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.pages.length) return;
    const next = [...d.pages];
    [next[i], next[j]] = [next[j], next[i]];
    setD({ ...d, pages: next });
    setActivePage(j);
  };
  const addPage = () => {
    setD({ ...d, pages: [...d.pages, newStoryPage()] });
    setActivePage(d.pages.length);
  };
  const delPage = (i: number) => {
    if (d.pages.length <= 1) return;
    const next = d.pages.filter((_, k) => k !== i);
    setD({ ...d, pages: next });
    setActivePage(Math.max(0, Math.min(i, next.length - 1)));
  };

  const cur = d.pages[activePage];

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-5">
      <div className="grid sm:grid-cols-3 gap-3">
        <FloatingInput
          label="Slug"
          value={d.slug}
          onChange={(e) => upd({ slug: e.target.value })}
        />
        <div>
          <Label>Status</Label>
          <select
            className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
            value={d.status}
            onChange={(e) => upd({ status: e.target.value as WebStoryStatus })}
          >
            <option value="draft">{t("adminMiscRoutes.webStories.statusDraft")}</option>
            <option value="published">{t("adminMiscRoutes.webStories.statusPublished")}</option>
            <option value="archived">{t("adminMiscRoutes.webStories.statusArchived")}</option>
          </select>
        </div>
        <FloatingInput
          label={t("adminMiscRoutes.webStories.cover")}
          value={d.cover_url ?? ""}
          onChange={(e) => upd({ cover_url: e.target.value || null })}
        />
      </div>

      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">🇵🇱 PL</TabsTrigger>
          <TabsTrigger value="en">🇬🇧 EN</TabsTrigger>
        </TabsList>
        <TabsContent value="pl" className="space-y-3 mt-4">
          <FloatingInput
            label={t("adminMiscRoutes.webStories.title")}
            value={d.title_pl}
            onChange={(e) => upd({ title_pl: e.target.value })}
          />
          <FloatingTextarea
            label={t("adminMiscRoutes.webStories.description")}
            rows={2}
            value={d.description_pl}
            onChange={(e) => upd({ description_pl: e.target.value })}
          />
        </TabsContent>
        <TabsContent value="en" className="space-y-3 mt-4">
          <FloatingInput
            label="Title"
            value={d.title_en}
            onChange={(e) => upd({ title_en: e.target.value })}
          />
          <FloatingTextarea
            label="Description"
            rows={2}
            value={d.description_en}
            onChange={(e) => upd({ description_en: e.target.value })}
          />
        </TabsContent>
      </Tabs>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">
            {t("adminMiscRoutes.webStories.storyPages", { count: d.pages.length })}
          </h2>
          <Button size="sm" variant="outline" onClick={addPage}>
            <Plus className="w-4 h-4 mr-1" />
            {t("adminMiscRoutes.webStories.addPage")}
          </Button>
        </div>

        <div className="grid grid-cols-[200px_1fr] gap-4">
          <ul className="space-y-1 text-sm">
            {d.pages.map((p, i) => (
              <li
                key={p.id}
                className={`flex items-center gap-1 rounded border ${i === activePage ? "border-primary bg-primary/5" : "border-border"} p-1`}
              >
                <button
                  className="flex-1 text-left px-2 py-1 truncate"
                  onClick={() => setActivePage(i)}
                >
                  #{i + 1} {p.title_pl || p.title_en || t("adminMiscRoutes.webStories.noTitle")}
                </button>
                <button
                  aria-label="Up"
                  className="p-1 hover:bg-muted rounded"
                  onClick={() => movePage(i, -1)}
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  aria-label="Down"
                  className="p-1 hover:bg-muted rounded"
                  onClick={() => movePage(i, 1)}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button
                  aria-label="Delete"
                  className="p-1 hover:bg-destructive/10 rounded text-destructive"
                  onClick={() => delPage(i)}
                  disabled={d.pages.length <= 1}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>

          {cur && (
            <div className="space-y-3 border border-border rounded-lg p-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>{t("adminMiscRoutes.webStories.background")}</Label>
                  <select
                    className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                    value={cur.background}
                    onChange={(e) =>
                      updPage(activePage, { background: e.target.value as StoryPage["background"] })
                    }
                  >
                    <option value="image">{t("adminMiscRoutes.webStories.bgImage")}</option>
                    <option value="video">{t("adminMiscRoutes.webStories.bgVideo")}</option>
                    <option value="color">{t("adminMiscRoutes.webStories.bgColor")}</option>
                  </select>
                </div>
                <div>
                  <Label>{t("adminMiscRoutes.webStories.textPosition")}</Label>
                  <select
                    className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                    value={cur.text_position}
                    onChange={(e) =>
                      updPage(activePage, {
                        text_position: e.target.value as StoryPage["text_position"],
                      })
                    }
                  >
                    <option value="top">{t("adminMiscRoutes.webStories.posTop")}</option>
                    <option value="center">{t("adminMiscRoutes.webStories.posCenter")}</option>
                    <option value="bottom">{t("adminMiscRoutes.webStories.posBottom")}</option>
                  </select>
                </div>
                <div>
                  <Label>{t("adminMiscRoutes.webStories.align")}</Label>
                  <select
                    className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                    value={cur.text_align}
                    onChange={(e) =>
                      updPage(activePage, { text_align: e.target.value as StoryPage["text_align"] })
                    }
                  >
                    <option value="left">{t("adminMiscRoutes.webStories.alignLeft")}</option>
                    <option value="center">{t("adminMiscRoutes.webStories.alignCenter")}</option>
                    <option value="right">{t("adminMiscRoutes.webStories.alignRight")}</option>
                  </select>
                </div>
              </div>

              {cur.background === "color" ? (
                <div>
                  <Label>{t("adminMiscRoutes.webStories.bgColorLabel")}</Label>
                  <AdminColorPicker
                    value={cur.color}
                    onChange={(v) => updPage(activePage, { color: v ?? "#000000" })}
                    allowTransparent={false}
                    allowReset={false}
                  />
                </div>
              ) : (
                <>
                  <FloatingInput
                    label={
                      cur.background === "video"
                        ? t("adminMiscRoutes.webStories.mediaUrlVideo")
                        : t("adminMiscRoutes.webStories.mediaUrlImage")
                    }
                    value={cur.media_url}
                    onChange={(e) => updPage(activePage, { media_url: e.target.value })}
                  />
                  {cur.background === "video" && (
                    <FloatingInput
                      label={t("adminMiscRoutes.webStories.poster")}
                      value={cur.poster_url}
                      onChange={(e) => updPage(activePage, { poster_url: e.target.value })}
                    />
                  )}
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <FloatingInput
                  label={t("adminMiscRoutes.webStories.titlePl")}
                  value={cur.title_pl}
                  onChange={(e) => updPage(activePage, { title_pl: e.target.value })}
                />
                <FloatingInput
                  label={t("adminMiscRoutes.webStories.titleEn")}
                  value={cur.title_en}
                  onChange={(e) => updPage(activePage, { title_en: e.target.value })}
                />
                <FloatingTextarea
                  label={t("adminMiscRoutes.webStories.captionPl")}
                  rows={2}
                  value={cur.caption_pl}
                  onChange={(e) => updPage(activePage, { caption_pl: e.target.value })}
                />
                <FloatingTextarea
                  label={t("adminMiscRoutes.webStories.captionEn")}
                  rows={2}
                  value={cur.caption_en}
                  onChange={(e) => updPage(activePage, { caption_en: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <FloatingInput
                  label="CTA PL"
                  value={cur.cta_label_pl}
                  onChange={(e) => updPage(activePage, { cta_label_pl: e.target.value })}
                />
                <FloatingInput
                  label="CTA EN"
                  value={cur.cta_label_en}
                  onChange={(e) => updPage(activePage, { cta_label_en: e.target.value })}
                />
                <FloatingInput
                  label={t("adminMiscRoutes.webStories.ctaLink")}
                  value={cur.cta_href}
                  onChange={(e) => updPage(activePage, { cta_href: e.target.value })}
                />
              </div>

              <div className="w-40">
                <Label>{t("adminMiscRoutes.webStories.duration")}</Label>
                <Input
                  type="number"
                  min={2}
                  max={30}
                  value={cur.duration_seconds}
                  onChange={(e) =>
                    updPage(activePage, {
                      duration_seconds: Math.max(2, Math.min(30, Number(e.target.value) || 6)),
                    })
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 pt-2 border-t border-border">
        <Button onClick={() => onSave(d)} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? "…" : t("common.save")}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </section>
  );
}
