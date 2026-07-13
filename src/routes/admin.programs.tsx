import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Save, Trash2, Search, ChevronUp, ChevronDown, X } from "@/lib/lucide-shim";
import { Upload, Loader2, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { ProgramIcon } from "@/components/programs/ProgramIcon";
import { PROGRAM_ICONS } from "@/lib/programs/icons";
import { safeAccent, accentRgba } from "@/lib/programs/visual";
import { confirmDialog } from "@/lib/appDialogs";

export const Route = createFileRoute("/admin/programs")({
  component: AdminPrograms,
});

// ---------- types ----------------------------------------------------------

interface ProgramListRow {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  status: string;
  accent_color: string;
  icon: string;
  sort_order: number;
}

interface QuestionDraft {
  key: string;
  pl: string;
  en: string;
}
interface MemberDraft {
  key: string;
  profile_id: string;
  member_role_pl: string;
  member_role_en: string;
  is_lead: boolean;
}
interface ProjectDraft {
  key: string;
  name_pl: string;
  name_en: string;
  summary_pl: string;
  summary_en: string;
  project_status: "planned" | "active" | "completed";
  url: string;
}
interface PartnerDraft {
  key: string;
  name: string;
  logo_url: string;
  url: string;
}
interface CuratedDraft {
  key: string;
  item_type: "flagship_post" | "podcast" | "event";
  ref_id: string;
}

interface ProgramDraft {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  tagline_pl: string;
  tagline_en: string;
  scope_pl: string;
  scope_en: string;
  icon: string;
  accent_color: string;
  hero_image_url: string;
  category_id: string | null;
  contact_email: string;
  sort_order: number;
  published: boolean;
  questions: QuestionDraft[];
  team: MemberDraft[];
  projects: ProjectDraft[];
  partners: PartnerDraft[];
  curated: CuratedDraft[];
}

// A stable-ish key generator that does not rely on crypto (SSR-safe) - draft
// rows only need row identity within a single editing session.
let keySeq = 0;
const nextKey = () => `k${keySeq++}`;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function emptyDraft(): ProgramDraft {
  return {
    id: "",
    slug: "",
    name_pl: "Nowy program",
    name_en: "New program",
    tagline_pl: "",
    tagline_en: "",
    scope_pl: "",
    scope_en: "",
    icon: "Compass",
    accent_color: "#1e3a8a",
    hero_image_url: "",
    category_id: null,
    contact_email: "",
    sort_order: 0,
    published: false,
    questions: [],
    team: [],
    projects: [],
    partners: [],
    curated: [],
  };
}

const ICON_CHOICES = Object.keys(PROGRAM_ICONS);

// ---------- reference-data queries (for selects) ---------------------------

interface RefRow {
  id: string;
  label: string;
}

function useRefData() {
  const categories = useQuery({
    queryKey: ["admin", "programs", "ref", "categories"],
    queryFn: async (): Promise<RefRow[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name_pl,name_en,slug")
        .order("name_pl");
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id as string,
        label: `${c.name_pl as string} / ${c.name_en as string}`,
      }));
    },
    staleTime: 5 * 60_000,
  });

  const profiles = useQuery({
    queryKey: ["admin", "programs", "ref", "profiles"],
    queryFn: async (): Promise<RefRow[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name,first_name,last_name,slug")
        .order("display_name")
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((p) => {
        const name =
          (p.display_name as string | null) ||
          [p.first_name, p.last_name].filter(Boolean).join(" ") ||
          (p.slug as string | null) ||
          (p.id as string);
        return { id: p.id as string, label: name };
      });
    },
    staleTime: 5 * 60_000,
  });

  const posts = useQuery({
    queryKey: ["admin", "programs", "ref", "posts"],
    queryFn: async (): Promise<RefRow[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("id,title_pl,title_en,published_at")
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id as string,
        label: (p.title_pl as string) || (p.title_en as string) || (p.id as string),
      }));
    },
    staleTime: 60_000,
  });

  const podcasts = useQuery({
    queryKey: ["admin", "programs", "ref", "podcasts"],
    queryFn: async (): Promise<RefRow[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select("id,title_pl,title_en,published_at")
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id as string,
        label: (p.title_pl as string) || (p.title_en as string) || (p.id as string),
      }));
    },
    staleTime: 60_000,
  });

  const events = useQuery({
    queryKey: ["admin", "programs", "ref", "events"],
    queryFn: async (): Promise<RefRow[]> => {
      const { data, error } = await supabase
        .from("events")
        .select("id,title_pl,title_en,starts_at")
        .order("starts_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((e) => ({
        id: e.id as string,
        label: (e.title_pl as string) || (e.title_en as string) || (e.id as string),
      }));
    },
    staleTime: 60_000,
  });

  return { categories, profiles, posts, podcasts, events };
}

// ---------- page -----------------------------------------------------------

function AdminPrograms() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const tr = (pl: string, en: string) => (isPl ? pl : en);
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<ProgramDraft | null>(null);
  const [search, setSearch] = useState("");

  const list = useQuery({
    queryKey: ["admin", "programs", "list"],
    queryFn: async (): Promise<ProgramListRow[]> => {
      const { data, error } = await supabase
        .from("research_programs")
        .select("id,slug,name_pl,name_en,status,accent_color,icon,sort_order")
        .order("sort_order", { ascending: true })
        .order("name_pl", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProgramListRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter(
      (r) =>
        !q ||
        r.name_pl.toLowerCase().includes(q) ||
        r.name_en.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q),
    );
  }, [list.data, search]);

  const loadOne = useMutation({
    mutationFn: async (id: string): Promise<ProgramDraft> => {
      const [progRes, membersRes, projectsRes, partnersRes, itemsRes] = await Promise.all([
        supabase.from("research_programs").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("research_program_members")
          .select("*")
          .eq("program_id", id)
          .order("sort_order"),
        supabase
          .from("research_program_projects")
          .select("*")
          .eq("program_id", id)
          .order("sort_order"),
        supabase
          .from("research_program_partners")
          .select("*")
          .eq("program_id", id)
          .order("sort_order"),
        supabase
          .from("research_program_items")
          .select("*")
          .eq("program_id", id)
          .order("sort_order"),
      ]);
      if (progRes.error || !progRes.data) throw progRes.error ?? new Error("not found");
      const p = progRes.data as Record<string, unknown>;
      const rawQuestions = Array.isArray(p.research_questions)
        ? (p.research_questions as Array<Record<string, unknown>>)
        : [];
      return {
        id: p.id as string,
        slug: p.slug as string,
        name_pl: (p.name_pl as string) ?? "",
        name_en: (p.name_en as string) ?? "",
        tagline_pl: (p.tagline_pl as string) ?? "",
        tagline_en: (p.tagline_en as string) ?? "",
        scope_pl: (p.scope_pl as string) ?? "",
        scope_en: (p.scope_en as string) ?? "",
        icon: (p.icon as string) ?? "Compass",
        accent_color: (p.accent_color as string) ?? "#1e3a8a",
        hero_image_url: (p.hero_image_url as string) ?? "",
        category_id: (p.category_id as string | null) ?? null,
        contact_email: (p.contact_email as string) ?? "",
        sort_order: (p.sort_order as number) ?? 0,
        published: (p.status as string) === "published",
        questions: rawQuestions.map((q) => ({
          key: nextKey(),
          pl: typeof q.pl === "string" ? q.pl : "",
          en: typeof q.en === "string" ? q.en : "",
        })),
        team: ((membersRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
          key: nextKey(),
          profile_id: m.profile_id as string,
          member_role_pl: (m.member_role_pl as string) ?? "",
          member_role_en: (m.member_role_en as string) ?? "",
          is_lead: Boolean(m.is_lead),
        })),
        projects: ((projectsRes.data ?? []) as Array<Record<string, unknown>>).map((pr) => ({
          key: nextKey(),
          name_pl: (pr.name_pl as string) ?? "",
          name_en: (pr.name_en as string) ?? "",
          summary_pl: (pr.summary_pl as string) ?? "",
          summary_en: (pr.summary_en as string) ?? "",
          project_status: (pr.project_status as ProjectDraft["project_status"]) ?? "active",
          url: (pr.url as string) ?? "",
        })),
        partners: ((partnersRes.data ?? []) as Array<Record<string, unknown>>).map((pa) => ({
          key: nextKey(),
          name: (pa.name as string) ?? "",
          logo_url: (pa.logo_url as string) ?? "",
          url: (pa.url as string) ?? "",
        })),
        curated: ((itemsRes.data ?? []) as Array<Record<string, unknown>>).map((it) => ({
          key: nextKey(),
          item_type: it.item_type as CuratedDraft["item_type"],
          ref_id:
            (it.post_id as string) || (it.podcast_id as string) || (it.event_id as string) || "",
        })),
      };
    },
    onSuccess: (d) => setEditing(d),
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async (d: ProgramDraft) => {
      const slug = d.slug.trim() ? slugify(d.slug) : slugify(d.name_pl || d.name_en);
      if (!slug || slug.length < 3)
        throw new Error(tr("Slug musi mieć min. 3 znaki", "Slug needs ≥3 chars"));
      if (!d.name_pl.trim() || !d.name_en.trim())
        throw new Error(tr("Nazwa PL i EN są wymagane", "PL and EN name are required"));

      const questions = d.questions
        .map((q) => ({ pl: q.pl.trim(), en: q.en.trim() }))
        .filter((q) => q.pl !== "" || q.en !== "");

      const payload = {
        slug,
        name_pl: d.name_pl.trim(),
        name_en: d.name_en.trim(),
        tagline_pl: d.tagline_pl.trim() || null,
        tagline_en: d.tagline_en.trim() || null,
        scope_pl: d.scope_pl.trim() || null,
        scope_en: d.scope_en.trim() || null,
        research_questions: questions,
        icon: d.icon || "Compass",
        accent_color: safeAccent(d.accent_color),
        hero_image_url: d.hero_image_url.trim() || null,
        category_id: d.category_id,
        contact_email: d.contact_email.trim() || null,
        sort_order: Number.isFinite(d.sort_order) ? d.sort_order : 0,
        status: d.published ? "published" : "draft",
      };

      let programId = d.id;
      if (programId) {
        const { error } = await supabase
          .from("research_programs")
          .update(payload)
          .eq("id", programId);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error(tr("Brak kontekstu tenanta", "No tenant context"));
        const { data, error } = await supabase
          .from("research_programs")
          .insert({ ...payload, tenant_id: tenantId })
          .select("id")
          .single();
        if (error) throw error;
        programId = (data as { id: string }).id;
      }

      // Reconcile child collections: clear then re-insert with sort_order = index.
      // tenant_id on children is pinned by a BEFORE INSERT trigger from the program.
      await Promise.all([
        supabase.from("research_program_members").delete().eq("program_id", programId),
        supabase.from("research_program_projects").delete().eq("program_id", programId),
        supabase.from("research_program_partners").delete().eq("program_id", programId),
        supabase.from("research_program_items").delete().eq("program_id", programId),
      ]);

      const memberRows = d.team
        .filter((m) => m.profile_id)
        .map((m, i) => ({
          program_id: programId,
          profile_id: m.profile_id,
          member_role_pl: m.member_role_pl.trim() || null,
          member_role_en: m.member_role_en.trim() || null,
          is_lead: m.is_lead,
          sort_order: i,
        }));
      const projectRows = d.projects
        .filter((p) => p.name_pl.trim() || p.name_en.trim())
        .map((p, i) => ({
          program_id: programId,
          name_pl: p.name_pl.trim() || p.name_en.trim(),
          name_en: p.name_en.trim() || p.name_pl.trim(),
          summary_pl: p.summary_pl.trim() || null,
          summary_en: p.summary_en.trim() || null,
          project_status: p.project_status,
          url: p.url.trim() || null,
          sort_order: i,
        }));
      const partnerRows = d.partners
        .filter((p) => p.name.trim())
        .map((p, i) => ({
          program_id: programId,
          name: p.name.trim(),
          logo_url: p.logo_url.trim() || null,
          url: p.url.trim() || null,
          sort_order: i,
        }));
      const curatedRows = d.curated
        .filter((c) => c.ref_id)
        .map((c, i) => ({
          program_id: programId,
          item_type: c.item_type,
          post_id: c.item_type === "flagship_post" ? c.ref_id : null,
          podcast_id: c.item_type === "podcast" ? c.ref_id : null,
          event_id: c.item_type === "event" ? c.ref_id : null,
          sort_order: i,
        }));

      if (memberRows.length) {
        const { error } = await supabase.from("research_program_members").insert(memberRows);
        if (error) throw error;
      }
      if (projectRows.length) {
        const { error } = await supabase.from("research_program_projects").insert(projectRows);
        if (error) throw error;
      }
      if (partnerRows.length) {
        const { error } = await supabase.from("research_program_partners").insert(partnerRows);
        if (error) throw error;
      }
      if (curatedRows.length) {
        const { error } = await supabase.from("research_program_items").insert(curatedRows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "programs"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
      toast.success(tr("Zapisano program", "Program saved"));
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("research_programs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "programs"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
      toast.success(tr("Usunięto program", "Program deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing) {
    return (
      <EditorPane
        draft={editing}
        setDraft={setEditing}
        onCancel={() => setEditing(null)}
        onSave={() => save.mutate(editing)}
        saving={save.isPending}
        tr={tr}
        isPl={isPl}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl">{tr("Programy badawcze", "Research programs")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr(
              "Specjalizacje jako nadrzędne kontenery: zespół, projekty, publikacje, treści i partnerzy.",
              "Specializations as top-level containers: team, projects, publications, content and partners.",
            )}
          </p>
        </div>
        <Button onClick={() => setEditing(emptyDraft())}>
          <Plus className="w-4 h-4 mr-2" />
          {tr("Nowy program", "New program")}
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr("Szukaj programu…", "Search programs…")}
          className="pl-9"
        />
      </div>

      {list.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          {tr("Wczytywanie…", "Loading…")}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {tr("Brak programów. Utwórz pierwszy.", "No programs yet. Create the first one.")}
        </p>
      ) : (
        <div className="bg-card border border-border rounded-lg divide-y divide-border">
          {filtered.map((r) => {
            const accent = safeAccent(r.accent_color);
            return (
              <div key={r.id} className="flex items-center gap-3 p-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: accentRgba(accent, 0.12), color: accent }}
                >
                  <ProgramIcon name={r.icon} className="w-4 h-4" />
                </div>
                <button
                  className="flex-1 text-left min-w-0"
                  onClick={() => loadOne.mutate(r.id)}
                  disabled={loadOne.isPending}
                >
                  <span className="font-medium block truncate">{isPl ? r.name_pl : r.name_en}</span>
                  <span className="text-xs text-muted-foreground">/{r.slug}</span>
                </button>
                <span
                  className={
                    "text-xs px-2 py-0.5 rounded-full shrink-0 " +
                    (r.status === "published"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {r.status === "published"
                    ? tr("Opublikowany", "Published")
                    : tr("Szkic", "Draft")}
                </span>
                <button
                  className="text-destructive p-2 hover:bg-destructive/10 rounded-md shrink-0"
                  aria-label={tr("Usuń", "Delete")}
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: tr("Usunąć program?", "Delete program?"),
                      description: tr(
                        "Ta operacja usunie też zespół, projekty, partnerów i przypisane treści.",
                        "This also removes the team, projects, partners and curated items.",
                      ),
                    });
                    if (ok) remove.mutate(r.id);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- editor ---------------------------------------------------------

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = arr.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function ReorderButtons({
  index,
  length,
  onMove,
}: {
  index: number;
  length: number;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label="Move up"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        disabled={index === length - 1}
        onClick={() => onMove(1)}
        aria-label="Move down"
      >
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );
}

function EditorPane({
  draft,
  setDraft,
  onCancel,
  onSave,
  saving,
  tr,
  isPl,
}: {
  draft: ProgramDraft;
  setDraft: (d: ProgramDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  tr: (pl: string, en: string) => string;
  isPl: boolean;
}) {
  const upd = (patch: Partial<ProgramDraft>) => setDraft({ ...draft, ...patch });
  const [heroPicker, setHeroPicker] = useState(false);
  const [logoPickerFor, setLogoPickerFor] = useState<string | null>(null);
  const ref = useRefData();
  const accent = safeAccent(draft.accent_color);

  const curatedRefOptions = (type: CuratedDraft["item_type"]): RefRow[] =>
    type === "flagship_post"
      ? (ref.posts.data ?? [])
      : type === "podcast"
        ? (ref.podcasts.data ?? [])
        : (ref.events.data ?? []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 sticky top-0 bg-background/95 backdrop-blur py-2 z-10">
        <h1 className="font-display text-xl">
          {draft.id ? tr("Edycja programu", "Edit program") : tr("Nowy program", "New program")}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {tr("Anuluj", "Cancel")}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {tr("Zapisz", "Save")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="space-y-6">
          {/* Podstawa */}
          <section className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>{tr("Slug", "Slug")}</Label>
                <Input
                  value={draft.slug}
                  onChange={(e) => upd({ slug: e.target.value })}
                  placeholder="geopolityka-i-dyplomacja"
                />
              </div>
              <div>
                <Label>{tr("Kolejność", "Sort order")}</Label>
                <Input
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) => upd({ sort_order: Number(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>{tr("Ikona", "Icon")}</Label>
                <Select value={draft.icon} onValueChange={(v) => upd({ icon: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICON_CHOICES.map((ic) => (
                      <SelectItem key={ic} value={ic}>
                        {ic}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tr("Kolor akcentu", "Accent colour")}</Label>
                <AdminColorPicker
                  value={draft.accent_color}
                  onChange={(v) => upd({ accent_color: safeAccent(v) })}
                  allowTransparent={false}
                  allowReset={false}
                  ariaLabel={tr("Kolor akcentu", "Accent colour")}
                />
              </div>
            </div>

            <div>
              <Label>{tr("Obraz nagłówka (hero)", "Hero image")}</Label>
              <div className="flex gap-2">
                <Input
                  value={draft.hero_image_url}
                  onChange={(e) => upd({ hero_image_url: e.target.value })}
                  placeholder="https://…"
                />
                <Button type="button" variant="outline" onClick={() => setHeroPicker(true)}>
                  <Upload className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>{tr("Kategoria (publikacje)", "Category (publications)")}</Label>
                <Select
                  value={draft.category_id ?? "none"}
                  onValueChange={(v) => upd({ category_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={tr("Brak", "None")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tr("Brak", "None")}</SelectItem>
                    {(ref.categories.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {tr(
                    "Najnowsze publikacje pobierane są automatycznie z tej kategorii.",
                    "“Latest publications” are pulled automatically from this category.",
                  )}
                </p>
              </div>
              <div>
                <Label>{tr("E-mail kontaktowy", "Contact email")}</Label>
                <Input
                  type="email"
                  value={draft.contact_email}
                  onChange={(e) => upd({ contact_email: e.target.value })}
                  placeholder="program@neweuropeanstrategies.com"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
              <span className="text-sm font-medium">{tr("Opublikowany", "Published")}</span>
              <Switch checked={draft.published} onCheckedChange={(v) => upd({ published: v })} />
            </div>
          </section>

          {/* Treść dwujęzyczna */}
          <section className="bg-card border border-border rounded-lg p-5">
            <Tabs defaultValue="pl">
              <TabsList>
                <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
                <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
              </TabsList>
              <TabsContent value="pl" className="space-y-3 mt-4">
                <div>
                  <Label>{tr("Nazwa", "Name")}</Label>
                  <Input value={draft.name_pl} onChange={(e) => upd({ name_pl: e.target.value })} />
                </div>
                <div>
                  <Label>{tr("Teza (tagline)", "Tagline")}</Label>
                  <Textarea
                    rows={2}
                    value={draft.tagline_pl}
                    onChange={(e) => upd({ tagline_pl: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{tr("Zakres badań", "Research scope")}</Label>
                  <Textarea
                    rows={5}
                    value={draft.scope_pl}
                    onChange={(e) => upd({ scope_pl: e.target.value })}
                  />
                </div>
              </TabsContent>
              <TabsContent value="en" className="space-y-3 mt-4">
                <div>
                  <Label>{tr("Nazwa", "Name")}</Label>
                  <Input value={draft.name_en} onChange={(e) => upd({ name_en: e.target.value })} />
                </div>
                <div>
                  <Label>{tr("Teza (tagline)", "Tagline")}</Label>
                  <Textarea
                    rows={2}
                    value={draft.tagline_en}
                    onChange={(e) => upd({ tagline_en: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{tr("Zakres badań", "Research scope")}</Label>
                  <Textarea
                    rows={5}
                    value={draft.scope_en}
                    onChange={(e) => upd({ scope_en: e.target.value })}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </section>

          {/* Pytania badawcze */}
          <CollectionSection
            title={tr("Główne pytania badawcze", "Key research questions")}
            onAdd={() =>
              upd({ questions: [...draft.questions, { key: nextKey(), pl: "", en: "" }] })
            }
            addLabel={tr("Dodaj pytanie", "Add question")}
            empty={draft.questions.length === 0}
          >
            {draft.questions.map((q, i) => (
              <div
                key={q.key}
                className="flex gap-2 items-start p-3 rounded-md border border-border"
              >
                <ReorderButtons
                  index={i}
                  length={draft.questions.length}
                  onMove={(dir) => upd({ questions: move(draft.questions, i, dir) })}
                />
                <div className="flex-1 grid sm:grid-cols-2 gap-2">
                  <Input
                    value={q.pl}
                    placeholder={tr("Pytanie (PL)", "Question (PL)")}
                    onChange={(e) =>
                      upd({
                        questions: draft.questions.map((x) =>
                          x.key === q.key ? { ...x, pl: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Input
                    value={q.en}
                    placeholder={tr("Pytanie (EN)", "Question (EN)")}
                    onChange={(e) =>
                      upd({
                        questions: draft.questions.map((x) =>
                          x.key === q.key ? { ...x, en: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </div>
                <RemoveButton
                  onClick={() => upd({ questions: draft.questions.filter((x) => x.key !== q.key) })}
                />
              </div>
            ))}
          </CollectionSection>

          {/* Zespół */}
          <CollectionSection
            title={tr("Lider i zespół", "Lead & team")}
            onAdd={() =>
              upd({
                team: [
                  ...draft.team,
                  {
                    key: nextKey(),
                    profile_id: "",
                    member_role_pl: "",
                    member_role_en: "",
                    is_lead: draft.team.length === 0,
                  },
                ],
              })
            }
            addLabel={tr("Dodaj osobę", "Add person")}
            empty={draft.team.length === 0}
          >
            {draft.team.map((m, i) => (
              <div
                key={m.key}
                className="flex gap-2 items-start p-3 rounded-md border border-border"
              >
                <ReorderButtons
                  index={i}
                  length={draft.team.length}
                  onMove={(dir) => upd({ team: move(draft.team, i, dir) })}
                />
                <div className="flex-1 space-y-2">
                  <Select
                    value={m.profile_id || "none"}
                    onValueChange={(v) =>
                      upd({
                        team: draft.team.map((x) =>
                          x.key === m.key ? { ...x, profile_id: v === "none" ? "" : v } : x,
                        ),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tr("Wybierz osobę", "Select person")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tr("— wybierz —", "— select —")}</SelectItem>
                      {(ref.profiles.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Input
                      value={m.member_role_pl}
                      placeholder={tr("Rola (PL)", "Role (PL)")}
                      onChange={(e) =>
                        upd({
                          team: draft.team.map((x) =>
                            x.key === m.key ? { ...x, member_role_pl: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      value={m.member_role_en}
                      placeholder={tr("Rola (EN)", "Role (EN)")}
                      onChange={(e) =>
                        upd({
                          team: draft.team.map((x) =>
                            x.key === m.key ? { ...x, member_role_en: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={m.is_lead}
                      onCheckedChange={(v) =>
                        upd({
                          // Only one lead: setting this one clears the others.
                          team: draft.team.map((x) =>
                            x.key === m.key
                              ? { ...x, is_lead: v }
                              : { ...x, is_lead: v ? false : x.is_lead },
                          ),
                        })
                      }
                    />
                    {tr("Lider programu", "Program lead")}
                  </label>
                </div>
                <RemoveButton
                  onClick={() => upd({ team: draft.team.filter((x) => x.key !== m.key) })}
                />
              </div>
            ))}
          </CollectionSection>

          {/* Projekty */}
          <CollectionSection
            title={tr("Projekty", "Projects")}
            onAdd={() =>
              upd({
                projects: [
                  ...draft.projects,
                  {
                    key: nextKey(),
                    name_pl: "",
                    name_en: "",
                    summary_pl: "",
                    summary_en: "",
                    project_status: "active",
                    url: "",
                  },
                ],
              })
            }
            addLabel={tr("Dodaj projekt", "Add project")}
            empty={draft.projects.length === 0}
          >
            {draft.projects.map((p, i) => (
              <div
                key={p.key}
                className="flex gap-2 items-start p-3 rounded-md border border-border"
              >
                <ReorderButtons
                  index={i}
                  length={draft.projects.length}
                  onMove={(dir) => upd({ projects: move(draft.projects, i, dir) })}
                />
                <div className="flex-1 space-y-2">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Input
                      value={p.name_pl}
                      placeholder={tr("Nazwa (PL)", "Name (PL)")}
                      onChange={(e) =>
                        upd({
                          projects: draft.projects.map((x) =>
                            x.key === p.key ? { ...x, name_pl: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      value={p.name_en}
                      placeholder={tr("Nazwa (EN)", "Name (EN)")}
                      onChange={(e) =>
                        upd({
                          projects: draft.projects.map((x) =>
                            x.key === p.key ? { ...x, name_en: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Textarea
                      rows={2}
                      value={p.summary_pl}
                      placeholder={tr("Opis (PL)", "Summary (PL)")}
                      onChange={(e) =>
                        upd({
                          projects: draft.projects.map((x) =>
                            x.key === p.key ? { ...x, summary_pl: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Textarea
                      rows={2}
                      value={p.summary_en}
                      placeholder={tr("Opis (EN)", "Summary (EN)")}
                      onChange={(e) =>
                        upd({
                          projects: draft.projects.map((x) =>
                            x.key === p.key ? { ...x, summary_en: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Select
                      value={p.project_status}
                      onValueChange={(v) =>
                        upd({
                          projects: draft.projects.map((x) =>
                            x.key === p.key
                              ? { ...x, project_status: v as ProjectDraft["project_status"] }
                              : x,
                          ),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="planned">{tr("Planowany", "Planned")}</SelectItem>
                        <SelectItem value="active">{tr("W toku", "Active")}</SelectItem>
                        <SelectItem value="completed">{tr("Zakończony", "Completed")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={p.url}
                      placeholder="https://… (opcjonalnie)"
                      onChange={(e) =>
                        upd({
                          projects: draft.projects.map((x) =>
                            x.key === p.key ? { ...x, url: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
                <RemoveButton
                  onClick={() => upd({ projects: draft.projects.filter((x) => x.key !== p.key) })}
                />
              </div>
            ))}
          </CollectionSection>

          {/* Kuratorowane treści */}
          <CollectionSection
            title={tr(
              "Treści (raporty flagowe, podcasty, wydarzenia)",
              "Content (flagship reports, podcasts, events)",
            )}
            onAdd={() =>
              upd({
                curated: [
                  ...draft.curated,
                  { key: nextKey(), item_type: "flagship_post", ref_id: "" },
                ],
              })
            }
            addLabel={tr("Dodaj treść", "Add content")}
            empty={draft.curated.length === 0}
          >
            {draft.curated.map((c, i) => (
              <div
                key={c.key}
                className="flex gap-2 items-start p-3 rounded-md border border-border"
              >
                <ReorderButtons
                  index={i}
                  length={draft.curated.length}
                  onMove={(dir) => upd({ curated: move(draft.curated, i, dir) })}
                />
                <div className="flex-1 grid sm:grid-cols-[160px_minmax(0,1fr)] gap-2">
                  <Select
                    value={c.item_type}
                    onValueChange={(v) =>
                      upd({
                        curated: draft.curated.map((x) =>
                          x.key === c.key
                            ? { ...x, item_type: v as CuratedDraft["item_type"], ref_id: "" }
                            : x,
                        ),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flagship_post">
                        {tr("Raport flagowy", "Flagship report")}
                      </SelectItem>
                      <SelectItem value="podcast">{tr("Podcast", "Podcast")}</SelectItem>
                      <SelectItem value="event">{tr("Wydarzenie", "Event")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={c.ref_id || "none"}
                    onValueChange={(v) =>
                      upd({
                        curated: draft.curated.map((x) =>
                          x.key === c.key ? { ...x, ref_id: v === "none" ? "" : v } : x,
                        ),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tr("Wybierz…", "Select…")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tr("— wybierz —", "— select —")}</SelectItem>
                      {curatedRefOptions(c.item_type).map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <RemoveButton
                  onClick={() => upd({ curated: draft.curated.filter((x) => x.key !== c.key) })}
                />
              </div>
            ))}
          </CollectionSection>

          {/* Partnerzy */}
          <CollectionSection
            title={tr("Partnerzy", "Partners")}
            onAdd={() =>
              upd({
                partners: [...draft.partners, { key: nextKey(), name: "", logo_url: "", url: "" }],
              })
            }
            addLabel={tr("Dodaj partnera", "Add partner")}
            empty={draft.partners.length === 0}
          >
            {draft.partners.map((p, i) => (
              <div
                key={p.key}
                className="flex gap-2 items-start p-3 rounded-md border border-border"
              >
                <ReorderButtons
                  index={i}
                  length={draft.partners.length}
                  onMove={(dir) => upd({ partners: move(draft.partners, i, dir) })}
                />
                <div className="flex-1 space-y-2">
                  <Input
                    value={p.name}
                    placeholder={tr("Nazwa partnera", "Partner name")}
                    onChange={(e) =>
                      upd({
                        partners: draft.partners.map((x) =>
                          x.key === p.key ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="flex gap-2">
                      <Input
                        value={p.logo_url}
                        placeholder={tr("Logo URL", "Logo URL")}
                        onChange={(e) =>
                          upd({
                            partners: draft.partners.map((x) =>
                              x.key === p.key ? { ...x, logo_url: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setLogoPickerFor(p.key)}
                      >
                        <Upload className="w-4 h-4" />
                      </Button>
                    </div>
                    <Input
                      value={p.url}
                      placeholder="https://…"
                      onChange={(e) =>
                        upd({
                          partners: draft.partners.map((x) =>
                            x.key === p.key ? { ...x, url: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
                <RemoveButton
                  onClick={() => upd({ partners: draft.partners.filter((x) => x.key !== p.key) })}
                />
              </div>
            ))}
          </CollectionSection>
        </div>

        {/* Podgląd */}
        <aside
          className="xl:sticky xl:top-16 rounded-lg border border-border overflow-hidden"
          style={{ ["--accent" as string]: accent }}
        >
          <div className="h-2" style={{ backgroundColor: accent }} />
          <div className="p-5 space-y-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: accentRgba(accent, 0.12), color: accent }}
            >
              <ProgramIcon name={draft.icon} className="w-6 h-6" />
            </div>
            <h3 className="font-display text-lg">
              {(isPl ? draft.name_pl : draft.name_en) || tr("Nazwa programu", "Program name")}
            </h3>
            {(isPl ? draft.tagline_pl : draft.tagline_en) && (
              <p className="text-sm text-muted-foreground">
                {isPl ? draft.tagline_pl : draft.tagline_en}
              </p>
            )}
            <div className="text-xs text-muted-foreground pt-2 border-t border-border space-y-1">
              <p>
                {tr("Pytania", "Questions")}: {draft.questions.length} · {tr("Zespół", "Team")}:{" "}
                {draft.team.length}
              </p>
              <p>
                {tr("Projekty", "Projects")}: {draft.projects.length} · {tr("Treści", "Content")}:{" "}
                {draft.curated.length} · {tr("Partnerzy", "Partners")}: {draft.partners.length}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <MediaPickerDialog
        open={heroPicker}
        onOpenChange={setHeroPicker}
        onPick={(url) => upd({ hero_image_url: url })}
        accept="image"
        title={tr("Wybierz obraz nagłówka", "Choose hero image")}
      />
      <MediaPickerDialog
        open={logoPickerFor !== null}
        onOpenChange={(o) => !o && setLogoPickerFor(null)}
        onPick={(url) => {
          if (logoPickerFor) {
            upd({
              partners: draft.partners.map((x) =>
                x.key === logoPickerFor ? { ...x, logo_url: url } : x,
              ),
            });
          }
          setLogoPickerFor(null);
        }}
        accept="image"
        title={tr("Wybierz logo partnera", "Choose partner logo")}
      />
    </div>
  );
}

function CollectionSection({
  title,
  onAdd,
  addLabel,
  empty,
  children,
}: {
  title: string;
  onAdd: () => void;
  addLabel: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{title}</h2>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          {addLabel}
        </Button>
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground py-2">—</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-destructive p-1.5 hover:bg-destructive/10 rounded-md shrink-0"
      onClick={onClick}
      aria-label="Remove"
    >
      <X className="w-4 h-4" />
    </button>
  );
}
