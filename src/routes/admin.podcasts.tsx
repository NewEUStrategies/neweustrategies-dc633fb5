import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
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
import { toast } from "sonner";
import {
  Plus,
  Save,
  Trash2,
  Mic,
  Search,
  Eye,
  Clock,
  Check,
  FileText,
  Settings,
} from "@/lib/lucide-shim";
import type { Podcast, PodcastSettings, PodcastStatus } from "@/lib/podcast/types";
import { parseDuration, formatDuration } from "@/lib/podcast/types";
import { PODCAST_FIELDS } from "@/lib/queries/podcasts";
import { useAuth } from "@/hooks/useAuth";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";
import { sanitizeHtml } from "@/lib/sanitize";

export const Route = createFileRoute("/admin/podcasts")({ component: Page });

type Row = Pick<
  Podcast,
  | "id"
  | "slug"
  | "title_pl"
  | "title_en"
  | "status"
  | "duration_seconds"
  | "episode_number"
  | "season"
  | "audio_url"
  | "cover_image_url"
> & { published_at: string | null };

function Page() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<Podcast | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PodcastStatus>("all");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ["admin", "podcasts"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(
          "id,slug,title_pl,title_en,status,duration_seconds,episode_number,season,audio_url,cover_image_url,published_at",
        )
        // Bez tego filtra „Usunięte" odcinki (soft-delete) zostawały na liście,
        // więc „Usuń" wyglądał jak brak reakcji.
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const stats = useMemo(() => {
    const list = rows ?? [];
    const total = list.length;
    const published = list.filter((r) => r.status === "published").length;
    const drafts = list.filter((r) => r.status === "draft").length;
    const totalSeconds = list.reduce((acc, r) => acc + (r.duration_seconds || 0), 0);
    return { total, published, drafts, totalSeconds };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.title_pl?.toLowerCase().includes(q) ||
        r.title_en?.toLowerCase().includes(q) ||
        r.slug?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const loadOne = useMutation({
    mutationFn: async (id: string): Promise<Podcast> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(PODCAST_FIELDS)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) throw error ?? new Error("Not found");
      return data as Podcast;
    },
    onSuccess: (d) => setEditing(d),
  });

  const newDraft = (): Podcast => ({
    id: "",
    tenant_id: "",
    slug: "",
    title_pl: "Nowy odcinek",
    title_en: "",
    excerpt_pl: "",
    excerpt_en: "",
    show_notes_pl: "",
    show_notes_en: "",
    transcript_pl: "",
    transcript_en: "",
    audio_url: "",
    duration_seconds: 0,
    episode_number: null,
    season: null,
    cover_image_url: null,
    status: "draft",
    published_at: null,
    author_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const save = useMutation({
    mutationFn: async (p: Podcast) => {
      const slug = (p.slug || p.title_pl)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug) throw new Error("Slug wymagany");
      if (!p.audio_url) throw new Error("URL audio wymagany");
      const payload = {
        slug,
        title_pl: p.title_pl,
        title_en: p.title_en,
        excerpt_pl: p.excerpt_pl,
        excerpt_en: p.excerpt_en,
        show_notes_pl: p.show_notes_pl,
        show_notes_en: p.show_notes_en,
        transcript_pl: p.transcript_pl,
        transcript_en: p.transcript_en,
        audio_url: p.audio_url,
        duration_seconds: p.duration_seconds,
        episode_number: p.episode_number,
        season: p.season,
        cover_image_url: p.cover_image_url,
        status: p.status,
        published_at:
          p.status === "published" ? (p.published_at ?? new Date().toISOString()) : p.published_at,
      };
      if (p.id) {
        const { error } = await supabase.from("podcasts").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error("Brak kontekstu tenanta");
        const { error } = await supabase
          .from("podcasts")
          .insert({ ...payload, tenant_id: tenantId });
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
      const { error } = await supabase
        .from("podcasts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
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
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mic className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-2xl leading-tight">Podcasty</h1>
              <p className="text-xs text-muted-foreground">
                Zarządzanie odcinkami, transkrypcjami i publikacją
              </p>
            </div>
          </div>
          {!editing && !showSettings && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowSettings(true)}>
                <Settings className="w-4 h-4 mr-2" />
                Ustawienia
              </Button>
              <Button onClick={() => setEditing(newDraft())}>
                <Plus className="w-4 h-4 mr-2" />
                Nowy odcinek
              </Button>
            </div>
          )}
        </div>

        {showSettings && !editing && <PodcastSettingsPane onClose={() => setShowSettings(false)} />}

        {!editing && !showSettings && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={Mic} label="Wszystkie" value={String(stats.total)} tone="default" />
              <StatCard
                icon={Check}
                label="Opublikowane"
                value={String(stats.published)}
                tone="success"
              />
              <StatCard
                icon={FileText}
                label="Szkice"
                value={String(stats.drafts)}
                tone="warning"
              />

              <StatCard
                icon={Clock}
                label="Łączny czas"
                value={formatDuration(stats.totalSeconds)}
                tone="default"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Szukaj odcinka…"
                  className="pl-8"
                />
              </div>
              <div className="flex items-center gap-1 p-1 rounded-md bg-muted/60 border border-border">
                {(["all", "published", "draft", "archived"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 text-xs rounded font-medium ${statusFilter === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {s === "all"
                      ? "Wszystkie"
                      : s === "published"
                        ? "Opublikowane"
                        : s === "draft"
                          ? "Szkice"
                          : "Archiwum"}
                  </button>
                ))}
              </div>
            </div>

            <section className="bg-card border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <tr>
                    <th className="text-left p-3 w-16"></th>
                    <th className="text-left p-3">Tytuł</th>
                    <th className="text-left p-3 w-24">S/E</th>
                    <th className="text-left p-3 w-24">Czas</th>
                    <th className="text-left p-3 w-32">Status</th>
                    <th className="text-left p-3 w-32">Publikacja</th>
                    <th className="p-3 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/60 hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-2">
                        {r.cover_image_url ? (
                          <img
                            src={r.cover_image_url}
                            alt=""
                            className="w-12 h-12 rounded-md object-cover border border-border"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center">
                            <Mic className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <button
                          className="hover:underline text-left font-medium"
                          onClick={() => loadOne.mutate(r.id)}
                        >
                          {r.title_pl || r.title_en || r.slug}
                        </button>
                        <div className="text-xs text-muted-foreground font-mono">{r.slug}</div>
                      </td>
                      <td className="p-3 text-xs tabular-nums">
                        {r.season ? `S${r.season}` : "-"}
                        {r.episode_number ? ` E${r.episode_number}` : ""}
                      </td>
                      <td className="p-3 text-xs tabular-nums">
                        {formatDuration(r.duration_seconds)}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {r.published_at ? new Date(r.published_at).toLocaleDateString() : "-"}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setConfirmId(r.id)}
                          className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          Usuń
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-muted-foreground">
                        {rows?.length
                          ? "Brak wyników dla wybranego filtra."
                          : "Brak odcinków. Dodaj pierwszy klikając „Nowy odcinek”."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}

        {editing && (
          <EditorPane
            p={editing}
            onCancel={() => setEditing(null)}
            onSave={(p) => save.mutate(p)}
            saving={save.isPending}
          />
        )}
      </div>

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć odcinek?</AlertDialogTitle>
            <AlertDialogDescription>
              Odcinek zostanie przeniesiony do usuniętych i zniknie z listy oraz ze strony
              publicznej. Tej operacji nie można cofnąć z panelu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmId) remove.mutate(confirmId);
                setConfirmId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Usuń
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}

function PodcastSettingsPane({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "podcast-settings"],
    queryFn: async (): Promise<PodcastSettings | null> => {
      const { data, error } = await supabase.from("podcast_settings").select("*").maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data ?? null) as PodcastSettings | null;
    },
  });

  const [form, setForm] = useState<Partial<PodcastSettings>>({});
  const merged: PodcastSettings = {
    tenant_id: tenantId ?? "",
    default_player_variant: form.default_player_variant ?? data?.default_player_variant ?? "full",
    autoplay_next: form.autoplay_next ?? data?.autoplay_next ?? false,
    show_speed_control: form.show_speed_control ?? data?.show_speed_control ?? true,
    spotify_url: form.spotify_url ?? data?.spotify_url ?? "",
    apple_url: form.apple_url ?? data?.apple_url ?? "",
    google_url: form.google_url ?? data?.google_url ?? "",
    rss_url: form.rss_url ?? data?.rss_url ?? "",
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Brak kontekstu tenanta");
      const payload = {
        tenant_id: tenantId,
        default_player_variant: merged.default_player_variant,
        autoplay_next: merged.autoplay_next,
        show_speed_control: merged.show_speed_control,
        spotify_url: merged.spotify_url || null,
        apple_url: merged.apple_url || null,
        google_url: merged.google_url || null,
        rss_url: merged.rss_url || null,
      };
      // Singleton per tenant (PK = tenant_id) - upsert, żeby pierwsze zapisanie
      // utworzyło wiersz (dotąd tabela nie miała żadnego writera w kodzie).
      const { error } = await supabase
        .from("podcast_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "podcast-settings"] });
      qc.invalidateQueries({ queryKey: ["podcast-settings"] });
      toast.success("Ustawienia zapisane");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Ładowanie ustawień…</div>;
  }

  return (
    <section className="bg-card border border-border rounded-lg p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg">Ustawienia podcastu</h2>
        <Button variant="ghost" onClick={onClose}>
          Wróć do listy
        </Button>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label>Domyślny wariant odtwarzacza</Label>
          <div className="flex gap-2">
            {(["full", "mini", "sticky"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setForm((f) => ({ ...f, default_player_variant: v }))}
                className={`px-3 py-1.5 text-xs rounded border ${merged.default_player_variant === v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
              >
                {v === "full" ? "Pełny" : v === "mini" ? "Mini" : "Przyklejony"}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 py-2">
          <span className="text-sm">Pokazuj kontrolę prędkości</span>
          <Switch
            checked={merged.show_speed_control}
            onCheckedChange={(v) => setForm((f) => ({ ...f, show_speed_control: v }))}
          />
        </label>

        <label className="flex items-center justify-between gap-4 py-2">
          <span className="text-sm">Autoodtwarzanie kolejnego odcinka</span>
          <Switch
            checked={merged.autoplay_next}
            onCheckedChange={(v) => setForm((f) => ({ ...f, autoplay_next: v }))}
          />
        </label>

        <div className="grid gap-1.5">
          <Label>Spotify URL</Label>
          <Input
            value={merged.spotify_url ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, spotify_url: e.target.value }))}
            placeholder="https://open.spotify.com/show/…"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Apple Podcasts URL</Label>
          <Input
            value={merged.apple_url ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, apple_url: e.target.value }))}
            placeholder="https://podcasts.apple.com/…"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Google / YouTube URL</Label>
          <Input
            value={merged.google_url ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, google_url: e.target.value }))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Zewnętrzny RSS (opcjonalnie)</Label>
          <Input
            value={merged.rss_url ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, rss_url: e.target.value }))}
            placeholder="Domyślnie: /podcast/rss.xml"
          />
          <p className="text-xs text-muted-foreground">
            Zostaw puste, aby używać wbudowanego kanału RSS: <code>/podcast/rss.xml</code>
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Anuluj
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          Zapisz ustawienia
        </Button>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: PodcastStatus }) {
  const map: Record<PodcastStatus, string> = {
    published: "bg-green-500/10 text-green-700 dark:text-green-400",
    draft: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    archived: "bg-muted text-muted-foreground",
  };
  const label: Record<PodcastStatus, string> = {
    published: "Opublikowany",
    draft: "Szkic",
    archived: "Archiwum",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}

type StatTone = "default" | "success" | "warning";
function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Mic;
  label: string;
  value: string;
  tone: StatTone;
}) {
  const toneCls =
    tone === "success"
      ? "bg-green-500/10 text-green-700 dark:text-green-400"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-primary/10 text-primary";
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-md flex items-center justify-center ${toneCls}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
          {label}
        </div>
        <div className="font-display text-xl tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}

function EditorPane({
  p,
  onSave,
  onCancel,
  saving,
}: {
  p: Podcast;
  onSave: (p: Podcast) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [d, setD] = useState<Podcast>(p);
  const [durStr, setDurStr] = useState(formatDuration(p.duration_seconds));
  const [previewLang, setPreviewLang] = useState<"pl" | "en">("pl");
  const upd = (patch: Partial<Podcast>) => setD({ ...d, ...patch });

  const previewTitle = previewLang === "pl" ? d.title_pl : d.title_en;
  const previewExcerpt = previewLang === "pl" ? d.excerpt_pl : d.excerpt_en;
  const previewNotes = sanitizeHtml(
    (previewLang === "pl" ? d.show_notes_pl : d.show_notes_en) ?? "",
  );
  const episodeLabel = [
    d.season ? `S${d.season}` : null,
    d.episode_number ? `E${d.episode_number}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
      <section className="bg-card border border-border rounded-lg p-5 space-y-5 min-w-0">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">{d.id ? "Edycja odcinka" : "Nowy odcinek"}</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel}>
              Anuluj
            </Button>
            <Button onClick={() => onSave(d)} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "…" : "Zapisz"}
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Slug</Label>
            <Input
              value={d.slug}
              onChange={(e) => upd({ slug: e.target.value })}
              placeholder="np. odcinek-1"
            />
          </div>
          <div>
            <Label>Status</Label>
            <select
              className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
              value={d.status}
              onChange={(e) => upd({ status: e.target.value as PodcastStatus })}
            >
              <option value="draft">Szkic</option>
              <option value="published">Opublikowany</option>
              <option value="archived">Archiwum</option>
            </select>
          </div>
        </div>

        <Tabs defaultValue="pl">
          <TabsList>
            <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
            <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
          </TabsList>
          <TabsContent value="pl" className="space-y-3 mt-4">
            <div>
              <Label>Tytuł</Label>
              <Input value={d.title_pl} onChange={(e) => upd({ title_pl: e.target.value })} />
            </div>
            <div>
              <Label>Zajawka</Label>
              <Textarea
                rows={2}
                value={d.excerpt_pl}
                onChange={(e) => upd({ excerpt_pl: e.target.value })}
              />
            </div>
            <div>
              <Label>Show notes (HTML)</Label>
              <Textarea
                rows={5}
                value={d.show_notes_pl}
                onChange={(e) => upd({ show_notes_pl: e.target.value })}
              />
            </div>
            <div>
              <Label>Transkrypcja</Label>
              <Textarea
                rows={5}
                value={d.transcript_pl}
                onChange={(e) => upd({ transcript_pl: e.target.value })}
              />
            </div>
          </TabsContent>
          <TabsContent value="en" className="space-y-3 mt-4">
            <div>
              <Label>Title</Label>
              <Input value={d.title_en} onChange={(e) => upd({ title_en: e.target.value })} />
            </div>
            <div>
              <Label>Excerpt</Label>
              <Textarea
                rows={2}
                value={d.excerpt_en}
                onChange={(e) => upd({ excerpt_en: e.target.value })}
              />
            </div>
            <div>
              <Label>Show notes (HTML)</Label>
              <Textarea
                rows={5}
                value={d.show_notes_en}
                onChange={(e) => upd({ show_notes_en: e.target.value })}
              />
            </div>
            <div>
              <Label>Transcript</Label>
              <Textarea
                rows={5}
                value={d.transcript_en}
                onChange={(e) => upd({ transcript_en: e.target.value })}
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Label>URL audio (mp3/m4a)</Label>
            <Input
              value={d.audio_url}
              onChange={(e) => upd({ audio_url: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div>
            <Label>Czas trwania</Label>
            <Input
              value={durStr}
              onChange={(e) => {
                setDurStr(e.target.value);
                upd({ duration_seconds: parseDuration(e.target.value) });
              }}
              placeholder="MM:SS lub H:MM:SS"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label>Sezon</Label>
            <Input
              type="number"
              value={d.season ?? ""}
              onChange={(e) => upd({ season: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div>
            <Label>Numer odcinka</Label>
            <Input
              type="number"
              value={d.episode_number ?? ""}
              onChange={(e) =>
                upd({ episode_number: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>
          <div>
            <Label>Okładka (URL)</Label>
            <Input
              value={d.cover_image_url ?? ""}
              onChange={(e) => upd({ cover_image_url: e.target.value || null })}
            />
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Publikuj od razu</div>
            <div className="text-xs text-muted-foreground">
              Ustawia status na „Opublikowany" i datę publikacji na teraz.
            </div>
          </div>
          <Switch
            checked={d.status === "published"}
            onCheckedChange={(v) =>
              upd({
                status: v ? "published" : "draft",
                published_at: v ? (d.published_at ?? new Date().toISOString()) : d.published_at,
              })
            }
          />
        </div>
      </section>

      <aside className="xl:sticky xl:top-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <Eye className="w-3.5 h-3.5" /> Podgląd na żywo
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPreviewLang("pl")}
              className={`px-2 py-1 text-xs rounded ${previewLang === "pl" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              PL
            </button>
            <button
              type="button"
              onClick={() => setPreviewLang("en")}
              className={`px-2 py-1 text-xs rounded ${previewLang === "en" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              EN
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-gradient-to-br from-muted/40 to-muted/10 p-4 space-y-4">
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="relative aspect-square bg-muted">
              {d.cover_image_url ? (
                <img src={d.cover_image_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Mic className="w-16 h-16 text-muted-foreground/40" />
                </div>
              )}
              {episodeLabel && (
                <span className="absolute top-3 left-3 px-2 py-1 rounded bg-background/90 backdrop-blur text-xs font-semibold tabular-nums">
                  {episodeLabel}
                </span>
              )}
              <span className="absolute top-3 right-3">
                <StatusBadge status={d.status} />
              </span>
            </div>
            <div className="p-4 space-y-2">
              <h3 className="font-display text-lg leading-tight">
                {previewTitle || (previewLang === "pl" ? "Tytuł odcinka" : "Episode title")}
              </h3>
              {previewExcerpt && (
                <p className="text-sm text-muted-foreground line-clamp-3">{previewExcerpt}</p>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                <Clock className="w-3 h-3" /> {formatDuration(d.duration_seconds)}
              </div>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
              Odtwarzacz
            </div>
            {d.audio_url ? (
              <PodcastPlayer
                src={d.audio_url}
                title={previewTitle || d.slug}
                initialDuration={d.duration_seconds}
                variant="full"
                lang={previewLang}
              />
            ) : (
              <div className="text-xs text-muted-foreground py-6 text-center bg-card border border-dashed border-border rounded-md">
                Dodaj URL audio, aby zobaczyć odtwarzacz.
              </div>
            )}
          </div>

          {previewNotes && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                Show notes
              </div>
              <div
                className="text-xs leading-relaxed bg-card border border-border rounded-md p-3 max-h-48 overflow-auto prose prose-sm dark:prose-invert [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: previewNotes }}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
