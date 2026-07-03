import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Save, Trash2, ChevronUp, ChevronDown } from "@/lib/lucide-shim";
import { useAuth } from "@/hooks/useAuth";
import {
  newStoryPage,
  safeParsePages,
  type StoryPage,
  type WebStory,
  type WebStoryStatus,
} from "@/lib/web-stories/types";

export const Route = createFileRoute("/admin/web-stories")({ component: Page });

type Row = Pick<WebStory, "id" | "slug" | "title_pl" | "title_en" | "status" | "cover_url"> & {
  published_at: string | null;
};

function Page() {
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
      if (!slug) throw new Error("Slug wymagany");
      if (!s.pages.length) throw new Error("Dodaj co najmniej jedną stronę");
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
        if (!tenantId) throw new Error("Brak kontekstu tenanta");
        const { error } = await supabase
          .from("web_stories")
          .insert({ ...payload, tenant_id: tenantId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "web-stories"] });
      qc.invalidateQueries({ queryKey: ["web-stories"] });
      toast.success("Zapisano");
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
      toast.success("Usunięto");
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
            Nowa historia
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
                  <th className="text-left p-2">Tytuł</th>
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
                          if (confirm("Usunąć historię?")) remove.mutate(r.id);
                        }}
                        className="text-xs text-destructive hover:underline"
                      >
                        <Trash2 className="w-3 h-3 inline mr-1" />
                        Usuń
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows?.length && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      Brak historii.
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
    <section className="bg-card border border-border rounded-lg p-5 space-y-5 max-w-5xl">
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <Label>Slug</Label>
          <Input
            value={d.slug}
            onChange={(e) => upd({ slug: e.target.value })}
            placeholder="moja-historia"
          />
        </div>
        <div>
          <Label>Status</Label>
          <select
            className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
            value={d.status}
            onChange={(e) => upd({ status: e.target.value as WebStoryStatus })}
          >
            <option value="draft">Szkic</option>
            <option value="published">Opublikowany</option>
            <option value="archived">Archiwum</option>
          </select>
        </div>
        <div>
          <Label>Okładka (URL)</Label>
          <Input
            value={d.cover_url ?? ""}
            onChange={(e) => upd({ cover_url: e.target.value || null })}
          />
        </div>
      </div>

      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">🇵🇱 PL</TabsTrigger>
          <TabsTrigger value="en">🇬🇧 EN</TabsTrigger>
        </TabsList>
        <TabsContent value="pl" className="space-y-3 mt-4">
          <div>
            <Label>Tytuł</Label>
            <Input value={d.title_pl} onChange={(e) => upd({ title_pl: e.target.value })} />
          </div>
          <div>
            <Label>Opis</Label>
            <Textarea
              rows={2}
              value={d.description_pl}
              onChange={(e) => upd({ description_pl: e.target.value })}
            />
          </div>
        </TabsContent>
        <TabsContent value="en" className="space-y-3 mt-4">
          <div>
            <Label>Title</Label>
            <Input value={d.title_en} onChange={(e) => upd({ title_en: e.target.value })} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={2}
              value={d.description_en}
              onChange={(e) => upd({ description_en: e.target.value })}
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Strony historii ({d.pages.length})</h2>
          <Button size="sm" variant="outline" onClick={addPage}>
            <Plus className="w-4 h-4 mr-1" />
            Dodaj stronę
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
                  #{i + 1} {p.title_pl || p.title_en || "(brak tytułu)"}
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
                  <Label>Tło</Label>
                  <select
                    className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                    value={cur.background}
                    onChange={(e) =>
                      updPage(activePage, { background: e.target.value as StoryPage["background"] })
                    }
                  >
                    <option value="image">Obraz</option>
                    <option value="video">Wideo</option>
                    <option value="color">Kolor</option>
                  </select>
                </div>
                <div>
                  <Label>Pozycja tekstu</Label>
                  <select
                    className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                    value={cur.text_position}
                    onChange={(e) =>
                      updPage(activePage, {
                        text_position: e.target.value as StoryPage["text_position"],
                      })
                    }
                  >
                    <option value="top">Góra</option>
                    <option value="center">Środek</option>
                    <option value="bottom">Dół</option>
                  </select>
                </div>
                <div>
                  <Label>Wyrównanie</Label>
                  <select
                    className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                    value={cur.text_align}
                    onChange={(e) =>
                      updPage(activePage, { text_align: e.target.value as StoryPage["text_align"] })
                    }
                  >
                    <option value="left">Lewo</option>
                    <option value="center">Środek</option>
                    <option value="right">Prawo</option>
                  </select>
                </div>
              </div>

              {cur.background === "color" ? (
                <div>
                  <Label>Kolor tła</Label>
                  <Input
                    type="color"
                    value={cur.color}
                    onChange={(e) => updPage(activePage, { color: e.target.value })}
                  />
                </div>
              ) : (
                <>
                  <div>
                    <Label>URL {cur.background === "video" ? "wideo" : "obrazu"}</Label>
                    <Input
                      value={cur.media_url}
                      onChange={(e) => updPage(activePage, { media_url: e.target.value })}
                    />
                  </div>
                  {cur.background === "video" && (
                    <div>
                      <Label>Poster (opcjonalny)</Label>
                      <Input
                        value={cur.poster_url}
                        onChange={(e) => updPage(activePage, { poster_url: e.target.value })}
                      />
                    </div>
                  )}
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tytuł PL</Label>
                  <Input
                    value={cur.title_pl}
                    onChange={(e) => updPage(activePage, { title_pl: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Tytuł EN</Label>
                  <Input
                    value={cur.title_en}
                    onChange={(e) => updPage(activePage, { title_en: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Podpis PL</Label>
                  <Textarea
                    rows={2}
                    value={cur.caption_pl}
                    onChange={(e) => updPage(activePage, { caption_pl: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Podpis EN</Label>
                  <Textarea
                    rows={2}
                    value={cur.caption_en}
                    onChange={(e) => updPage(activePage, { caption_en: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>CTA PL</Label>
                  <Input
                    value={cur.cta_label_pl}
                    onChange={(e) => updPage(activePage, { cta_label_pl: e.target.value })}
                    placeholder="Czytaj więcej"
                  />
                </div>
                <div>
                  <Label>CTA EN</Label>
                  <Input
                    value={cur.cta_label_en}
                    onChange={(e) => updPage(activePage, { cta_label_en: e.target.value })}
                    placeholder="Read more"
                  />
                </div>
                <div>
                  <Label>Link CTA</Label>
                  <Input
                    value={cur.cta_href}
                    onChange={(e) => updPage(activePage, { cta_href: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
              </div>

              <div className="w-40">
                <Label>Czas wyświetlania (s)</Label>
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
          {saving ? "…" : "Zapisz"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Anuluj
        </Button>
      </div>
    </section>
  );
}
