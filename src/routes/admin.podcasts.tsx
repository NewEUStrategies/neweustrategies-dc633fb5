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
import { Upload, Loader2, GripVertical, ListTree } from "lucide-react";
import type {
  Podcast,
  PodcastSettings,
  PodcastStatus,
  PodcastShow,
  PodcastChapter,
  PodcastQuote,
  PodcastResource,
} from "@/lib/podcast/types";
import {
  parseDuration,
  formatDuration,
  parseChapters,
  parseQuotes,
  parseResources,
} from "@/lib/podcast/types";
import { PODCAST_FIELDS, PODCAST_SHOW_FIELDS } from "@/lib/queries/podcasts";
import { useAuth } from "@/hooks/useAuth";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { FieldLabel } from "@/components/profile/FieldLabel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { sanitizeHtml } from "@/lib/sanitize";
import { adminToast } from "@/lib/adminToasts";

/** Auto-detect an audio file's duration by loading its metadata in the browser. */
function detectAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !url) return resolve(null);
    const audio = new Audio();
    const done = (v: number | null) => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("error", onErr);
      resolve(v);
    };
    const onMeta = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    const onErr = () => done(null);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("error", onErr);
    audio.preload = "metadata";
    audio.src = url;
  });
}

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
  | "show_id"
> & { published_at: string | null };

/** Uczestnik w edytorze; profile_id albo display_name (jedno wymagane). */
interface PersonDraft {
  id?: string;
  profile_id: string | null;
  display_name: string;
  role: "host" | "guest";
  url: string;
}

interface CategoryOption {
  id: string;
  name_pl: string;
  name_en: string;
}

interface ProfileOption {
  id: string;
  display_name: string | null;
  slug: string | null;
}

interface EpisodeBundle {
  episode: Podcast;
  chapters: PodcastChapter[];
  quotes: PodcastQuote[];
  resources: PodcastResource[];
  people: PersonDraft[];
}

type View = "episodes" | "settings" | "shows";

function Page() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<Podcast | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PodcastStatus>("all");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [view, setView] = useState<View>("episodes");

  const { data: rows } = useQuery({
    queryKey: ["admin", "podcasts"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(
          "id,slug,title_pl,title_en,status,duration_seconds,episode_number,season,audio_url,cover_image_url,published_at,show_id",
        )
        // Bez tego filtra „Usunięte" odcinki (soft-delete) zostawały na liście,
        // więc „Usuń" wyglądał jak brak reakcji.
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // Programy - do etykiet na liście odcinków i selektora w edytorze.
  const { data: shows } = useQuery({
    queryKey: ["admin", "podcast-shows"],
    queryFn: async (): Promise<PodcastShow[]> => {
      const { data, error } = await supabase
        .from("podcast_shows")
        .select(PODCAST_SHOW_FIELDS)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("title_pl", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PodcastShow[];
    },
  });

  const showTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of shows ?? []) m.set(s.id, s.title_pl || s.title_en || s.slug);
    return m;
  }, [shows]);

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
    show_id: null,
    category_id: null,
    chapters: [],
    quotes: [],
    resources: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const save = useMutation({
    mutationFn: async (bundle: EpisodeBundle) => {
      const { episode: p, chapters, quotes, resources, people } = bundle;
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
        show_id: p.show_id,
        category_id: p.category_id,
        // Zapisujemy tylko poprawne wpisy (parsery odsiewają śmieci/puste).
        chapters: parseChapters(chapters),
        quotes: parseQuotes(quotes),
        resources: parseResources(resources),
        published_at:
          p.status === "published" ? (p.published_at ?? new Date().toISOString()) : p.published_at,
      };

      if (!tenantId) throw new Error("Brak kontekstu tenanta");
      let episodeId = p.id;
      if (episodeId) {
        const { error } = await supabase.from("podcasts").update(payload).eq("id", episodeId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("podcasts")
          .insert({ ...payload, tenant_id: tenantId })
          .select("id")
          .single();
        if (error) throw error;
        episodeId = (data as { id: string }).id;
      }

      // Uczestnicy w osobnej tabeli: strategia „zastąp wszystko" - usuń istniejące
      // i wstaw bieżącą listę (proste i deterministyczne dla edytora admina).
      const { error: delError } = await supabase
        .from("podcast_episode_people")
        .delete()
        .eq("episode_id", episodeId);
      if (delError) throw delError;

      const cleanPeople = people
        .map((person, idx) => ({
          tenant_id: tenantId,
          episode_id: episodeId,
          profile_id: person.profile_id,
          display_name: person.display_name.trim(),
          role: person.role,
          url: person.url.trim() || null,
          sort_order: idx,
        }))
        // Wiersz musi mieć profil albo nazwisko (odpowiednik CHECK w DB).
        .filter((person) => person.profile_id || person.display_name);
      if (cleanPeople.length > 0) {
        const { error: insError } = await supabase
          .from("podcast_episode_people")
          .insert(cleanPeople);
        if (insError) throw insError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "podcasts"] });
      qc.invalidateQueries({ queryKey: ["podcasts"] });
      qc.invalidateQueries({ queryKey: ["podcast-people"] });
      toast.success(adminToast.saved());
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
      toast.success(adminToast.deleted());
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
                Sieć programów: serie, odcinki, prowadzący i transkrypcje
              </p>
            </div>
          </div>
          {!editing && view === "episodes" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setView("shows")}>
                <ListTree className="w-4 h-4 mr-2" />
                Programy
              </Button>
              <Button variant="outline" onClick={() => setView("settings")}>
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

        {view === "settings" && !editing && (
          <PodcastSettingsPane onClose={() => setView("episodes")} />
        )}

        {view === "shows" && !editing && <ShowsPane onClose={() => setView("episodes")} />}

        {view === "episodes" && !editing && (
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
                  className="pl-9"
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
                    <th className="text-left p-3 w-40">Program</th>
                    <th className="text-left p-3 w-24">S/E</th>
                    <th className="text-left p-3 w-24">Czas</th>
                    <th className="text-left p-3 w-32">Status</th>
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
                      <td className="p-3 text-xs text-muted-foreground">
                        {r.show_id ? (showTitleById.get(r.show_id) ?? "—") : "—"}
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
            shows={shows ?? []}
            onCancel={() => setEditing(null)}
            onSave={(bundle) => save.mutate(bundle)}
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

// ============================================================================
// Programy (serie)
// ============================================================================

function ShowsPane({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<PodcastShow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: shows } = useQuery({
    queryKey: ["admin", "podcast-shows"],
    queryFn: async (): Promise<PodcastShow[]> => {
      const { data, error } = await supabase
        .from("podcast_shows")
        .select(PODCAST_SHOW_FIELDS)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("title_pl", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PodcastShow[];
    },
  });

  const newShow = (): PodcastShow => ({
    id: "",
    tenant_id: "",
    slug: "",
    title_pl: "Nowy program",
    title_en: "",
    description_pl: "",
    description_en: "",
    cover_image_url: null,
    spotify_url: null,
    apple_url: null,
    youtube_url: null,
    sort_order: (shows?.length ?? 0) + 1,
    status: "draft",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const save = useMutation({
    mutationFn: async (s: PodcastShow) => {
      const slug = (s.slug || s.title_pl)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug) throw new Error("Slug wymagany");
      const payload = {
        slug,
        title_pl: s.title_pl,
        title_en: s.title_en,
        description_pl: s.description_pl,
        description_en: s.description_en,
        cover_image_url: s.cover_image_url,
        spotify_url: s.spotify_url || null,
        apple_url: s.apple_url || null,
        youtube_url: s.youtube_url || null,
        sort_order: s.sort_order,
        status: s.status,
      };
      if (s.id) {
        const { error } = await supabase.from("podcast_shows").update(payload).eq("id", s.id);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error("Brak kontekstu tenanta");
        const { error } = await supabase
          .from("podcast_shows")
          .insert({ ...payload, tenant_id: tenantId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "podcast-shows"] });
      qc.invalidateQueries({ queryKey: ["podcast-shows"] });
      toast.success(adminToast.saved());
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("podcast_shows")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "podcast-shows"] });
      qc.invalidateQueries({ queryKey: ["podcast-shows"] });
      toast.success(adminToast.deleted());
    },
  });

  if (editing) {
    return (
      <ShowEditor
        s={editing}
        onCancel={() => setEditing(null)}
        onSave={(s) => save.mutate(s)}
        saving={save.isPending}
      />
    );
  }

  return (
    <section className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg">Programy podcastowe</h2>
          <p className="text-xs text-muted-foreground">
            Serie grupujące odcinki. Każdy program ma własną stronę i kanał RSS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditing(newShow())}>
            <Plus className="w-4 h-4 mr-2" />
            Nowy program
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Wróć do odcinków
          </Button>
        </div>
      </div>

      {(shows ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Brak programów. Utwórz pierwszy, aby pogrupować odcinki w serie.
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {(shows ?? []).map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
            >
              {s.cover_image_url ? (
                <img
                  src={s.cover_image_url}
                  alt=""
                  className="w-12 h-12 rounded-md object-cover border border-border"
                />
              ) : (
                <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center">
                  <Mic className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <button
                  className="font-medium hover:underline text-left"
                  onClick={() => setEditing(s)}
                >
                  {s.title_pl || s.title_en || s.slug}
                </button>
                <div className="text-xs text-muted-foreground font-mono">{s.slug}</div>
              </div>
              <StatusBadge status={s.status} />
              <button
                onClick={() => setConfirmId(s.id)}
                className="text-xs text-destructive hover:underline inline-flex items-center gap-1 ml-2"
              >
                <Trash2 className="w-3 h-3" />
                Usuń
              </button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć program?</AlertDialogTitle>
            <AlertDialogDescription>
              Program zniknie z katalogu i ze stron publicznych. Odcinki pozostaną, ale stracą
              przypisanie do tej serii.
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
    </section>
  );
}

function ShowEditor({
  s,
  onSave,
  onCancel,
  saving,
}: {
  s: PodcastShow;
  onSave: (s: PodcastShow) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [d, setD] = useState<PodcastShow>(s);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const upd = (patch: Partial<PodcastShow>) => setD((prev) => ({ ...prev, ...patch }));

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg">{d.id ? "Edycja programu" : "Nowy program"}</h2>
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
            placeholder="np. gra-mocarstw"
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
            <Label>Opis</Label>
            <Textarea
              rows={3}
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
              rows={3}
              value={d.description_en}
              onChange={(e) => upd({ description_en: e.target.value })}
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>Okładka</Label>
          <div className="flex gap-2">
            <Input
              value={d.cover_image_url ?? ""}
              onChange={(e) => upd({ cover_image_url: e.target.value || null })}
              placeholder="https://… lub wgraj obraz"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setCoverPickerOpen(true)}
              title="Wgraj / wybierz okładkę"
            >
              <Upload className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div>
          <Label>Kolejność</Label>
          <Input
            type="number"
            value={d.sort_order}
            onChange={(e) => upd({ sort_order: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <Label>Spotify URL</Label>
          <Input
            value={d.spotify_url ?? ""}
            onChange={(e) => upd({ spotify_url: e.target.value })}
            placeholder="https://open.spotify.com/show/…"
          />
        </div>
        <div>
          <Label>Apple URL</Label>
          <Input
            value={d.apple_url ?? ""}
            onChange={(e) => upd({ apple_url: e.target.value })}
            placeholder="https://podcasts.apple.com/…"
          />
        </div>
        <div>
          <Label>YouTube URL</Label>
          <Input
            value={d.youtube_url ?? ""}
            onChange={(e) => upd({ youtube_url: e.target.value })}
          />
        </div>
      </div>

      <MediaPickerDialog
        open={coverPickerOpen}
        onOpenChange={setCoverPickerOpen}
        onPick={(url) => upd({ cover_image_url: url })}
        accept="image"
        title="Wybierz lub wgraj okładkę programu"
      />
    </section>
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
    // autoplay_next: kolumna istnieje w DB, ale żaden odtwarzacz jej nie
    // konsumuje (brak kolejki/utrzymywanego playera między stronami), więc nie
    // wystawiamy martwego przełącznika. Zapisujemy stałą wartość domyślną.
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
      toast.success(adminToast.settingsSaved());
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Ładowanie ustawień…</div>;
  }

  return (
    <TooltipProvider>
      <section className="bg-card border border-border rounded-lg p-6 space-y-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Ustawienia podcastu</h2>
          <Button variant="ghost" onClick={onClose}>
            Wróć do listy
          </Button>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <FieldLabel tip="Pełny: duży odtwarzacz z okładką i pełnymi kontrolkami. Mini: kompaktowy pasek. Przyklejony: odtwarzacz przyklejony do dołu ekranu podczas przewijania.">
              Domyślny wariant odtwarzacza
            </FieldLabel>
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
    </TooltipProvider>
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
  shows,
  onSave,
  onCancel,
  saving,
}: {
  p: Podcast;
  shows: PodcastShow[];
  onSave: (bundle: EpisodeBundle) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [d, setD] = useState<Podcast>(p);
  const [durStr, setDurStr] = useState(formatDuration(p.duration_seconds));
  const [previewLang, setPreviewLang] = useState<"pl" | "en">("pl");
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [detectingDuration, setDetectingDuration] = useState(false);
  const [chapters, setChapters] = useState<PodcastChapter[]>(() => parseChapters(p.chapters));
  const [quotes, setQuotes] = useState<PodcastQuote[]>(() => parseQuotes(p.quotes));
  const [resources, setResources] = useState<PodcastResource[]>(() => parseResources(p.resources));
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const upd = (patch: Partial<Podcast>) => setD((prev) => ({ ...prev, ...patch }));

  // Kategorie (specjalizacje) do przypięcia odcinka.
  const { data: categories } = useQuery({
    queryKey: ["admin", "podcast-categories"],
    queryFn: async (): Promise<CategoryOption[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name_pl, name_en")
        .order("name_pl");
      if (error) throw error;
      return (data ?? []) as CategoryOption[];
    },
  });

  // Profile do wyboru prowadzących/gości (link do strony eksperta).
  const { data: profiles } = useQuery({
    queryKey: ["admin", "podcast-profiles"],
    queryFn: async (): Promise<ProfileOption[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, slug")
        .order("display_name")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ProfileOption[];
    },
  });

  // Uczestnicy istniejącego odcinka: wczytujemy raz i inicjalizujemy stan.
  useQuery({
    queryKey: ["admin", "podcast-people", p.id],
    enabled: !!p.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("podcast_episode_people")
        .select("id, profile_id, display_name, role, url, sort_order")
        .eq("episode_id", p.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        profile_id: string | null;
        display_name: string;
        role: string;
        url: string | null;
        sort_order: number;
      }>;
      setPeople(
        rows.map((r) => ({
          id: r.id,
          profile_id: r.profile_id,
          display_name: r.display_name ?? "",
          role: r.role === "host" ? "host" : "guest",
          url: r.url ?? "",
        })),
      );
      return rows;
    },
  });

  // Wybór/wgranie pliku audio: ustaw URL i automatycznie wykryj czas trwania.
  const onAudioPicked = async (url: string) => {
    upd({ audio_url: url });
    setDetectingDuration(true);
    const secs = await detectAudioDuration(url);
    setDetectingDuration(false);
    if (secs != null && secs > 0) {
      upd({ duration_seconds: secs });
      setDurStr(formatDuration(secs));
      toast.success(`Wykryto czas trwania: ${formatDuration(secs)}`);
    }
  };

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
    <TooltipProvider>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
        <section className="bg-card border border-border rounded-lg p-5 space-y-5 min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg">{d.id ? "Edycja odcinka" : "Nowy odcinek"}</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onCancel}>
                Anuluj
              </Button>
              <Button
                onClick={() => onSave({ episode: d, chapters, quotes, resources, people })}
                disabled={saving}
              >
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

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel tip="Seria (program), do której należy odcinek. Program grupuje odcinki w sezony i ma własną stronę oraz kanał RSS.">
                Program
              </FieldLabel>
              <select
                className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                value={d.show_id ?? ""}
                onChange={(e) => upd({ show_id: e.target.value || null })}
              >
                <option value="">— bez programu —</option>
                {shows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title_pl || s.title_en || s.slug}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel tip="Specjalizacja (kategoria) tematyczna. Odcinek pojawi się też w sekcji „Podcasty” na stronie tej kategorii.">
                Specjalizacja
              </FieldLabel>
              <select
                className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                value={d.category_id ?? ""}
                onChange={(e) => upd({ category_id: e.target.value || null })}
              >
                <option value="">— brak —</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_pl || c.name_en}
                  </option>
                ))}
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
              <FieldLabel
                htmlFor="pod-audio"
                tip="Wgraj plik audio (mp3/m4a/wav…) z dysku lub wybierz z biblioteki mediów, albo wklej zewnętrzny URL. Czas trwania zostanie wykryty automatycznie po wgraniu."
              >
                Plik audio
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="pod-audio"
                  value={d.audio_url}
                  onChange={(e) => upd({ audio_url: e.target.value })}
                  onBlur={(e) => {
                    // Ręcznie wklejony URL też wyzwala wykrycie czasu, jeśli brak.
                    if (e.target.value && !d.duration_seconds) void onAudioPicked(e.target.value);
                  }}
                  placeholder="https://… lub wgraj plik"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAudioPickerOpen(true)}
                  title="Wgraj / wybierz z biblioteki mediów"
                >
                  <Upload className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div>
              <FieldLabel
                htmlFor="pod-dur"
                tip="Format MM:SS lub H:MM:SS. Wypełnia się automatycznie po wgraniu pliku audio; możesz nadpisać ręcznie."
              >
                Czas trwania
              </FieldLabel>
              <div className="relative">
                <Input
                  id="pod-dur"
                  value={durStr}
                  onChange={(e) => {
                    setDurStr(e.target.value);
                    upd({ duration_seconds: parseDuration(e.target.value) });
                  }}
                  placeholder="MM:SS lub H:MM:SS"
                />
                {detectingDuration && (
                  <Loader2 className="w-4 h-4 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                )}
              </div>
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
              <Label>Okładka</Label>
              <div className="flex gap-2">
                <Input
                  value={d.cover_image_url ?? ""}
                  onChange={(e) => upd({ cover_image_url: e.target.value || null })}
                  placeholder="https://… lub wgraj obraz"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCoverPickerOpen(true)}
                  title="Wgraj / wybierz okładkę z biblioteki mediów"
                >
                  <Upload className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          <PeopleEditor people={people} setPeople={setPeople} profiles={profiles ?? []} />
          <ChaptersEditor chapters={chapters} setChapters={setChapters} />
          <QuotesEditor quotes={quotes} setQuotes={setQuotes} />
          <ResourcesEditor resources={resources} setResources={setResources} />

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

        <MediaPickerDialog
          open={audioPickerOpen}
          onOpenChange={setAudioPickerOpen}
          onPick={(url) => void onAudioPicked(url)}
          accept="all"
          title="Wybierz lub wgraj plik audio"
        />
        <MediaPickerDialog
          open={coverPickerOpen}
          onOpenChange={setCoverPickerOpen}
          onPick={(url) => upd({ cover_image_url: url })}
          accept="image"
          title="Wybierz lub wgraj okładkę"
        />
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// Powtarzalne edytory warstw odcinka
// ============================================================================

function SectionCard({
  title,
  hint,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  hint: string;
  onAdd: () => void;
  addLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          {addLabel}
        </Button>
      </div>
      {children}
    </div>
  );
}

function RowShell({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-muted/20 p-2">
      <GripVertical className="w-4 h-4 text-muted-foreground/50 mt-2 shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">{children}</div>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive p-1 mt-1"
        aria-label="Usuń wiersz"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function PeopleEditor({
  people,
  setPeople,
  profiles,
}: {
  people: PersonDraft[];
  setPeople: React.Dispatch<React.SetStateAction<PersonDraft[]>>;
  profiles: ProfileOption[];
}) {
  const update = (i: number, patch: Partial<PersonDraft>) =>
    setPeople((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setPeople((prev) => prev.filter((_, idx) => idx !== i));
  const add = () =>
    setPeople((prev) => [...prev, { profile_id: null, display_name: "", role: "guest", url: "" }]);

  return (
    <SectionCard
      title="Prowadzący i goście"
      hint="Powiąż z profilem eksperta (agregacja na jego stronie) lub dodaj gościa zewnętrznego."
      onAdd={add}
      addLabel="Dodaj osobę"
    >
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          Brak osób. Dodaj prowadzącego lub gościa.
        </p>
      ) : (
        <div className="space-y-2">
          {people.map((person, i) => (
            <RowShell key={person.id ?? i} onRemove={() => remove(i)}>
              <div className="grid sm:grid-cols-[110px_1fr] gap-2">
                <select
                  className="px-2 py-1.5 rounded border border-input bg-background text-sm"
                  value={person.role}
                  onChange={(e) => update(i, { role: e.target.value as "host" | "guest" })}
                >
                  <option value="host">Prowadzący</option>
                  <option value="guest">Gość</option>
                </select>
                <select
                  className="px-2 py-1.5 rounded border border-input bg-background text-sm"
                  value={person.profile_id ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    const prof = profiles.find((x) => x.id === id);
                    // Auto-uzupełnij nazwisko z profilu, gdy pole puste.
                    update(i, {
                      profile_id: id,
                      display_name:
                        !person.display_name && prof?.display_name
                          ? prof.display_name
                          : person.display_name,
                    });
                  }}
                >
                  <option value="">— gość zewnętrzny (bez profilu) —</option>
                  {profiles.map((prof) => (
                    <option key={prof.id} value={prof.id}>
                      {prof.display_name || prof.slug || prof.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Input
                  value={person.display_name}
                  onChange={(e) => update(i, { display_name: e.target.value })}
                  placeholder="Wyświetlane nazwisko"
                />
                <Input
                  value={person.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder="Link (opcjonalny, dla gościa bez profilu)"
                />
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ChaptersEditor({
  chapters,
  setChapters,
}: {
  chapters: PodcastChapter[];
  setChapters: React.Dispatch<React.SetStateAction<PodcastChapter[]>>;
}) {
  const update = (i: number, patch: Partial<PodcastChapter>) =>
    setChapters((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setChapters((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setChapters((prev) => [...prev, { start: 0, title_pl: "", title_en: "" }]);

  return (
    <SectionCard
      title="Rozdziały"
      hint="Znaczniki czasu z tytułami. Na stronie odcinka klik przeskakuje odtwarzacz do rozdziału."
      onAdd={add}
      addLabel="Dodaj rozdział"
    >
      {chapters.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Brak rozdziałów.</p>
      ) : (
        <div className="space-y-2">
          {chapters.map((c, i) => (
            <RowShell key={i} onRemove={() => remove(i)}>
              <div className="grid sm:grid-cols-[120px_1fr_1fr] gap-2">
                <Input
                  value={formatDuration(c.start)}
                  onChange={(e) => update(i, { start: parseDuration(e.target.value) })}
                  placeholder="MM:SS"
                  aria-label="Czas startu"
                />
                <Input
                  value={c.title_pl}
                  onChange={(e) => update(i, { title_pl: e.target.value })}
                  placeholder="Tytuł (PL)"
                />
                <Input
                  value={c.title_en}
                  onChange={(e) => update(i, { title_en: e.target.value })}
                  placeholder="Title (EN)"
                />
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function QuotesEditor({
  quotes,
  setQuotes,
}: {
  quotes: PodcastQuote[];
  setQuotes: React.Dispatch<React.SetStateAction<PodcastQuote[]>>;
}) {
  const update = (i: number, patch: Partial<PodcastQuote>) =>
    setQuotes((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setQuotes((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setQuotes((prev) => [...prev, { text_pl: "", text_en: "", attribution: "" }]);

  return (
    <SectionCard
      title="Cytaty do udostępnienia"
      hint="Wyróżnione fragmenty z przyciskiem kopiowania na stronie odcinka."
      onAdd={add}
      addLabel="Dodaj cytat"
    >
      {quotes.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Brak cytatów.</p>
      ) : (
        <div className="space-y-2">
          {quotes.map((q, i) => (
            <RowShell key={i} onRemove={() => remove(i)}>
              <Textarea
                rows={2}
                value={q.text_pl}
                onChange={(e) => update(i, { text_pl: e.target.value })}
                placeholder="Cytat (PL)"
              />
              <Textarea
                rows={2}
                value={q.text_en}
                onChange={(e) => update(i, { text_en: e.target.value })}
                placeholder="Quote (EN)"
              />
              <Input
                value={q.attribution}
                onChange={(e) => update(i, { attribution: e.target.value })}
                placeholder="Autor cytatu (np. gen. Skrzypczak)"
              />
            </RowShell>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ResourcesEditor({
  resources,
  setResources,
}: {
  resources: PodcastResource[];
  setResources: React.Dispatch<React.SetStateAction<PodcastResource[]>>;
}) {
  const update = (i: number, patch: Partial<PodcastResource>) =>
    setResources((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setResources((prev) => prev.filter((_, idx) => idx !== i));
  const add = () =>
    setResources((prev) => [...prev, { label_pl: "", label_en: "", url: "", kind: "source" }]);

  return (
    <SectionCard
      title="Źródła i materiały dodatkowe"
      hint="Bibliografia i powiązane analizy. „Źródło” i „Materiał powiązany” trafiają do osobnych kolumn."
      onAdd={add}
      addLabel="Dodaj pozycję"
    >
      {resources.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Brak źródeł.</p>
      ) : (
        <div className="space-y-2">
          {resources.map((r, i) => (
            <RowShell key={i} onRemove={() => remove(i)}>
              <div className="grid sm:grid-cols-[150px_1fr] gap-2">
                <select
                  className="px-2 py-1.5 rounded border border-input bg-background text-sm"
                  value={r.kind}
                  onChange={(e) =>
                    update(i, { kind: e.target.value === "related" ? "related" : "source" })
                  }
                >
                  <option value="source">Źródło</option>
                  <option value="related">Materiał powiązany</option>
                </select>
                <Input
                  value={r.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Input
                  value={r.label_pl}
                  onChange={(e) => update(i, { label_pl: e.target.value })}
                  placeholder="Etykieta (PL)"
                />
                <Input
                  value={r.label_en}
                  onChange={(e) => update(i, { label_en: e.target.value })}
                  placeholder="Label (EN)"
                />
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
