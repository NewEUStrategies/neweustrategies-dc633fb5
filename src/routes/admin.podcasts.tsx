import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Plus, Save, Trash2 } from "@/lib/lucide-shim";
import type { Podcast, PodcastStatus } from "@/lib/podcast/types";
import { parseDuration, formatDuration } from "@/lib/podcast/types";
import { PODCAST_FIELDS } from "@/lib/queries/podcasts";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/admin/podcasts")({ component: Page });

type Row = Pick<Podcast,
  "id" | "slug" | "title_pl" | "title_en" | "status" | "duration_seconds" | "episode_number" | "season" | "audio_url" | "cover_image_url"
> & { published_at: string | null };

function Page() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<Podcast | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["admin", "podcasts"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select("id,slug,title_pl,title_en,status,duration_seconds,episode_number,season,audio_url,cover_image_url,published_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const loadOne = useMutation({
    mutationFn: async (id: string): Promise<Podcast> => {
      const { data, error } = await supabase.from("podcasts").select(PODCAST_FIELDS).eq("id", id).maybeSingle();
      if (error || !data) throw error ?? new Error("Not found");
      return data as Podcast;
    },
    onSuccess: (d) => setEditing(d),
  });

  const newDraft = (): Podcast => ({
    id: "", tenant_id: "", slug: "", title_pl: "Nowy odcinek", title_en: "",
    excerpt_pl: "", excerpt_en: "", show_notes_pl: "", show_notes_en: "",
    transcript_pl: "", transcript_en: "",
    audio_url: "", duration_seconds: 0, episode_number: null, season: null,
    cover_image_url: null, status: "draft", published_at: null, author_id: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  const save = useMutation({
    mutationFn: async (p: Podcast) => {
      const slug = (p.slug || p.title_pl).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) throw new Error("Slug wymagany");
      if (!p.audio_url) throw new Error("URL audio wymagany");
      const payload = {
        slug,
        title_pl: p.title_pl, title_en: p.title_en,
        excerpt_pl: p.excerpt_pl, excerpt_en: p.excerpt_en,
        show_notes_pl: p.show_notes_pl, show_notes_en: p.show_notes_en,
        transcript_pl: p.transcript_pl, transcript_en: p.transcript_en,
        audio_url: p.audio_url,
        duration_seconds: p.duration_seconds,
        episode_number: p.episode_number, season: p.season,
        cover_image_url: p.cover_image_url,
        status: p.status,
        published_at: p.status === "published" ? (p.published_at ?? new Date().toISOString()) : p.published_at,
      };
      if (p.id) {
        const { error } = await supabase.from("podcasts").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error("Brak kontekstu tenanta");
        const { error } = await supabase.from("podcasts").insert({ ...payload, tenant_id: tenantId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "podcasts"] });
      qc.invalidateQueries({ queryKey: ["podcasts"] });
      toast.success("Zapisano");
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("podcasts").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "podcasts"] });
      toast.success("Usunięto");
    },
  });

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl">Podcasty</h1>
          <div className="flex gap-2">
            
            <Button onClick={() => setEditing(newDraft())}><Plus className="w-4 h-4 mr-2" />Nowy odcinek</Button>
          </div>
        </div>

        {editing ? <EditorPane p={editing} onCancel={() => setEditing(null)} onSave={(p) => save.mutate(p)} saving={save.isPending} /> : (
          <section className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2">Tytuł</th>
                  <th className="text-left p-2">Slug</th>
                  <th className="text-left p-2">S/E</th>
                  <th className="text-left p-2">Czas</th>
                  <th className="text-left p-2">Status</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="p-2">
                      <button className="hover:underline text-left" onClick={() => loadOne.mutate(r.id)}>{r.title_pl}</button>
                    </td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">{r.slug}</td>
                    <td className="p-2 text-xs">{r.season ? `S${r.season}` : ""}{r.episode_number ? ` E${r.episode_number}` : ""}</td>
                    <td className="p-2 text-xs tabular-nums">{formatDuration(r.duration_seconds)}</td>
                    <td className="p-2"><span className="text-xs px-2 py-0.5 rounded bg-muted">{r.status}</span></td>
                    <td className="p-2 text-right">
                      <button onClick={() => remove.mutate(r.id)} className="text-xs text-destructive hover:underline">
                        <Trash2 className="w-3 h-3 inline mr-1" />Usuń
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows?.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Brak odcinków.</td></tr>}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </AdminShell>
  );
}

function EditorPane({ p, onSave, onCancel, saving }: { p: Podcast; onSave: (p: Podcast) => void; onCancel: () => void; saving: boolean }) {
  const [d, setD] = useState<Podcast>(p);
  const [durStr, setDurStr] = useState(formatDuration(p.duration_seconds));
  const upd = (patch: Partial<Podcast>) => setD({ ...d, ...patch });

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>Slug</Label><Input value={d.slug} onChange={(e) => upd({ slug: e.target.value })} placeholder="np. odcinek-1" /></div>
        <div>
          <Label>Status</Label>
          <select className="w-full px-3 py-2 rounded border border-input bg-background text-sm" value={d.status} onChange={(e) => upd({ status: e.target.value as PodcastStatus })}>
            <option value="draft">Szkic</option><option value="published">Opublikowany</option><option value="archived">Archiwum</option>
          </select>
        </div>
      </div>
      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
          <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
        </TabsList>
        <TabsContent value="pl" className="space-y-3 mt-4">
          <div><Label>Tytuł</Label><Input value={d.title_pl} onChange={(e) => upd({ title_pl: e.target.value })} /></div>
          <div><Label>Zajawka</Label><Textarea rows={2} value={d.excerpt_pl} onChange={(e) => upd({ excerpt_pl: e.target.value })} /></div>
          <div><Label>Show notes (HTML)</Label><Textarea rows={5} value={d.show_notes_pl} onChange={(e) => upd({ show_notes_pl: e.target.value })} /></div>
          <div><Label>Transkrypcja</Label><Textarea rows={5} value={d.transcript_pl} onChange={(e) => upd({ transcript_pl: e.target.value })} /></div>
        </TabsContent>
        <TabsContent value="en" className="space-y-3 mt-4">
          <div><Label>Title</Label><Input value={d.title_en} onChange={(e) => upd({ title_en: e.target.value })} /></div>
          <div><Label>Excerpt</Label><Textarea rows={2} value={d.excerpt_en} onChange={(e) => upd({ excerpt_en: e.target.value })} /></div>
          <div><Label>Show notes (HTML)</Label><Textarea rows={5} value={d.show_notes_en} onChange={(e) => upd({ show_notes_en: e.target.value })} /></div>
          <div><Label>Transcript</Label><Textarea rows={5} value={d.transcript_en} onChange={(e) => upd({ transcript_en: e.target.value })} /></div>
        </TabsContent>
      </Tabs>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2"><Label>URL audio (mp3/m4a)</Label><Input value={d.audio_url} onChange={(e) => upd({ audio_url: e.target.value })} placeholder="https://…" /></div>
        <div><Label>Czas trwania</Label>
          <Input value={durStr} onChange={(e) => { setDurStr(e.target.value); upd({ duration_seconds: parseDuration(e.target.value) }); }} placeholder="MM:SS lub H:MM:SS" />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div><Label>Sezon</Label><Input type="number" value={d.season ?? ""} onChange={(e) => upd({ season: e.target.value ? Number(e.target.value) : null })} /></div>
        <div><Label>Numer odcinka</Label><Input type="number" value={d.episode_number ?? ""} onChange={(e) => upd({ episode_number: e.target.value ? Number(e.target.value) : null })} /></div>
        <div><Label>Okładka (URL)</Label><Input value={d.cover_image_url ?? ""} onChange={(e) => upd({ cover_image_url: e.target.value || null })} /></div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => onSave(d)} disabled={saving}><Save className="w-4 h-4 mr-2" />{saving ? "…" : "Zapisz"}</Button>
        <Button variant="outline" onClick={onCancel}>Anuluj</Button>
      </div>
    </section>
  );
}
