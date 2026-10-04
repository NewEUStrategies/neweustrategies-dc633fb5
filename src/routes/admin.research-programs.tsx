// Admin: strony programów badawczych w stylu think-tank/RUSI (research_programs
// + members/projects/partners/items). Odrębne od /admin/programs, które
// zarządza uproszczoną tabelą `programs` używaną do tagowania treści i
// przypisań ekspertów. Tutaj: pełny landing (teza, zakres, pytania badawcze,
// zespół z liderem, projekty, partnerzy, wybrane raporty flagowe,
// podcasty i wydarzenia).
//
// UWAGA: od migracji 20260815110844 `research_programs` jest WIDOKIEM na
// `programs`, więc oba panele piszą te same wiersze - wspólne reguły zapisu
// (slug, reakcja na odmowę bazy, unieważniane klucze) żyją w
// `lib/programs/adminForm.ts`.
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, Pencil, Users, Layers, Handshake, Star } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/appDialogs";
import { PROGRAM_ICONS } from "@/lib/programs/icons";
import {
  PROGRAM_SLUG_PATTERN,
  bindDraft,
  invalidateProgramReaders,
  writeOrToast,
  type WriteResult,
} from "@/lib/programs/adminForm";
import { ProgramIcon } from "@/components/programs/ProgramIcon";
import { ensureI18n as ensureProgramsI18n } from "@/lib/i18n-programs";
export const Route = createFileRoute("/admin/research-programs")({
  component: AdminResearchPrograms,
});

type Lang = "pl" | "en";
type Status = "draft" | "published" | "archived";
type ProjectStatus = "planned" | "active" | "completed";
type ItemType = "flagship_post" | "podcast" | "event";

const STATUSES: readonly Status[] = ["draft", "published", "archived"];
const PROJECT_STATUSES: readonly ProjectStatus[] = ["planned", "active", "completed"];
/** Etykieta typu wybranego materiału - klucz w `adminResearchPrograms.items`. */
const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  flagship_post: "items.flagshipPost",
  podcast: "items.podcast",
  event: "items.event",
};
const ICON_NAMES = Object.keys(PROGRAM_ICONS);
/** Wartość listy kategorii oznaczająca „brak" - w kolumnie ląduje `NULL`. */
const NO_CATEGORY = "none";
/** Prefiks landingów publicznych - niosą zespół, projekty, partnerów i materiały. */
const PUBLIC_LANDINGS_KEY = ["programs", "landing"] as const;

interface ProgramRow {
  id: string;
  tenant_id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  tagline_pl: string | null;
  tagline_en: string | null;
  scope_pl: string | null;
  scope_en: string | null;
  research_questions: { pl: string; en: string }[];
  icon: string;
  accent_color: string;
  hero_image_url: string | null;
  category_id: string | null;
  contact_email: string | null;
  sort_order: number;
  status: Status;
}

type ProgramForm = Omit<ProgramRow, "id" | "tenant_id">;

interface MemberRow {
  program_id: string;
  profile_id: string;
  member_role_pl: string | null;
  member_role_en: string | null;
  is_lead: boolean;
  sort_order: number;
  display_name?: string | null;
}

type MemberDraft = Pick<MemberRow, "profile_id" | "member_role_pl" | "member_role_en" | "is_lead">;

interface ProjectRow {
  id: string;
  program_id: string;
  name_pl: string;
  name_en: string;
  summary_pl: string | null;
  summary_en: string | null;
  project_status: ProjectStatus;
  url: string | null;
  sort_order: number;
}

type ProjectDraft = Omit<ProjectRow, "id" | "program_id" | "sort_order">;

interface PartnerRow {
  id: string;
  program_id: string;
  name: string;
  logo_url: string | null;
  url: string | null;
  sort_order: number;
}

type PartnerDraft = Omit<PartnerRow, "id" | "program_id" | "sort_order">;

interface ItemRow {
  id: string;
  program_id: string;
  item_type: ItemType;
  post_id: string | null;
  podcast_id: string | null;
  event_id: string | null;
  sort_order: number;
}

interface ItemDraft {
  item_type: ItemType;
  /** UUID rekordu - ląduje w kolumnie odpowiadającej `item_type`. */
  target: string;
}

const EMPTY: ProgramForm = {
  slug: "",
  name_pl: "",
  name_en: "",
  tagline_pl: null,
  tagline_en: null,
  scope_pl: null,
  scope_en: null,
  research_questions: [],
  icon: "Compass",
  accent_color: "#0F172A",
  hero_image_url: null,
  category_id: null,
  contact_email: null,
  sort_order: 0,
  status: "draft",
};
const EMPTY_MEMBER: MemberDraft = {
  profile_id: "",
  member_role_pl: null,
  member_role_en: null,
  is_lead: false,
};
const EMPTY_PROJECT: ProjectDraft = {
  name_pl: "",
  name_en: "",
  summary_pl: null,
  summary_en: null,
  project_status: "active",
  url: null,
};
const EMPTY_PARTNER: PartnerDraft = { name: "", logo_url: null, url: null };
const EMPTY_ITEM: ItemDraft = { item_type: "flagship_post", target: "" };

/** Tłumaczenia panelu: `t`, język treści i skrót do przestrzeni panelu. */
function usePanelT() {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  return { t, lang, tp: (k: string) => t(`adminResearchPrograms.${k}`) };
}

/** Pole formularza z etykietą powiązaną z kontrolką (`htmlFor` = `id` pola). */
function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function AdminResearchPrograms() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProgramsI18n();
  const { t, lang, tp } = usePanelT();

  const tenantId = useRequiredTenant();
  const qc = useQueryClient();

  const programsQ = useQuery({
    queryKey: ["admin-research-programs", tenantId],
    queryFn: async (): Promise<ProgramRow[]> => {
      // Filtr po tenancie jest JAWNY, a nie zostawiony RLS: klucz cache niesie
      // `tenantId`, więc zapytanie musi mówić to samo - polityka „public read"
      // przepuszcza też opublikowane programy obszaru z adresu hosta.
      const { data, error } = await supabase
        .from("research_programs")
        .select(
          "id, tenant_id, slug, name_pl, name_en, tagline_pl, tagline_en, scope_pl, scope_en, research_questions, icon, accent_color, hero_image_url, category_id, contact_email, sort_order, status",
        )
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .order("name_pl", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => {
        const rec = r as unknown as Record<string, unknown>;
        const rq = rec.research_questions;
        return {
          ...(rec as unknown as ProgramRow),
          research_questions: Array.isArray(rq) ? (rq as { pl: string; en: string }[]) : [],
        };
      });
    },
  });

  const categoriesQ = useQuery({
    queryKey: ["admin-research-programs-categories", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, slug, name_pl, name_en")
        .eq("tenant_id", tenantId)
        .order("name_pl", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; slug: string; name_pl: string; name_en: string }[];
    },
  });

  const [editing, setEditing] = useState<ProgramRow | null>(null);
  const [form, setForm] = useState<ProgramForm>(EMPTY);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manageFor, setManageFor] = useState<ProgramRow | null>(null);
  const field = bindDraft(form, setForm, "rp");
  const accent = field.text("accent_color");

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };
  const openEdit = (p: ProgramRow) => {
    setEditing(p);
    const { id: _id, tenant_id: _tid, ...rest } = p;
    setForm(rest);
    setDialogOpen(true);
  };

  const saveProgram = async () => {
    if (!PROGRAM_SLUG_PATTERN.test(form.slug)) {
      toast.error(tp("errSlug"));
      return;
    }
    if (!form.name_pl.trim() || !form.name_en.trim()) {
      toast.error(tp("errNames"));
      return;
    }

    const payload = {
      ...form,
      tenant_id: tenantId,
      research_questions: form.research_questions.filter(
        (q) => (q.pl ?? "").trim() || (q.en ?? "").trim(),
      ),
    };

    const saved = await writeOrToast(
      editing
        ? supabase.from("research_programs").update(payload).eq("id", editing.id)
        : supabase.from("research_programs").insert(payload),
    );
    if (!saved) return;
    toast.success(tp("saved"));
    setDialogOpen(false);
    invalidateProgramReaders(qc);
  };

  const deleteProgram = async (p: ProgramRow) => {
    const ok = await confirmDialog({
      title: tp("deleteConfirm"),
      description: `${p.name_pl} / ${p.name_en}`,
      confirmLabel: tp("delete"),
      destructive: true,
    });
    if (!ok) return;
    if (!(await writeOrToast(supabase.from("research_programs").delete().eq("id", p.id)))) return;
    toast.success(tp("deleted"));
    invalidateProgramReaders(qc);
  };

  const rows = programsQ.data ?? [];

  return (
    <div className="mx-auto max-w-[1200px] p-4 lg:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">{tp("title")}</h1>
          <p className="text-sm text-muted-foreground">{tp("subtitle")}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {tp("newProgram")}
        </Button>
      </header>

      {programsQ.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : programsQ.isError ? (
        // „Nie udało się odczytać" to nie „brak programów": stan pusty po
        // odmowie RLS kazałby redakcji tworzyć program, który już istnieje.
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          {t("programs.loadError")}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          {tp("empty")}
        </div>
      ) : (
        <ul className="grid gap-2">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <span
                className="inline-flex h-9 w-9 items-center justify-center rounded-md"
                style={{ backgroundColor: `${p.accent_color}22`, color: p.accent_color }}
              >
                <ProgramIcon name={p.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {lang === "pl" ? p.name_pl : p.name_en}
                  <span className="ml-2 text-xs text-muted-foreground">/{p.slug}</span>
                </p>
                {(p.tagline_pl || p.tagline_en) && (
                  <p className="truncate text-xs text-muted-foreground">
                    {lang === "pl" ? p.tagline_pl : p.tagline_en}
                  </p>
                )}
              </div>
              <span
                className={
                  "rounded-full px-2 py-0.5 text-xs " +
                  (p.status === "published"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : p.status === "archived"
                      ? "bg-muted text-muted-foreground"
                      : "bg-brand/100/10 text-brand-ink dark:text-brand")
                }
              >
                {t(`admin.status.${p.status}`)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setManageFor(p)}>
                <Users className="mr-1 h-4 w-4" />
                {tp("content")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => deleteProgram(p)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? tp("editProgram") : tp("newProgram")}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2 md:grid-cols-2">
              <Field htmlFor={field.id("slug")} label="Slug">
                <Input {...field.text("slug")} placeholder="np. bezpieczenstwo-europy" />
              </Field>
              <Field htmlFor={field.id("status")} label="Status">
                <Select {...field.choice("status")}>
                  <SelectTrigger id={field.id("status")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`admin.status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <Field htmlFor={field.id("name_pl")} label="Nazwa (PL)">
                <Input {...field.text("name_pl")} />
              </Field>
              <Field htmlFor={field.id("name_en")} label="Name (EN)">
                <Input {...field.text("name_en")} />
              </Field>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <Field htmlFor={field.id("tagline_pl")} label={tp("field.taglinePl")}>
                <Textarea rows={2} {...field.optionalText("tagline_pl")} />
              </Field>
              <Field htmlFor={field.id("tagline_en")} label="Tagline (EN)">
                <Textarea rows={2} {...field.optionalText("tagline_en")} />
              </Field>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <Field htmlFor={field.id("scope_pl")} label={tp("field.scopePl")}>
                <Textarea rows={4} {...field.optionalText("scope_pl")} />
              </Field>
              <Field htmlFor={field.id("scope_en")} label="Scope (EN)">
                <Textarea rows={4} {...field.optionalText("scope_en")} />
              </Field>
            </div>

            <ResearchQuestionsEditor
              value={form.research_questions}
              onChange={(next) => setForm((f) => ({ ...f, research_questions: next }))}
            />

            <div className="grid gap-2 md:grid-cols-3">
              <Field htmlFor={field.id("icon")} label={tp("field.icon")}>
                <Select {...field.choice("icon")}>
                  <SelectTrigger id={field.id("icon")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {ICON_NAMES.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field htmlFor={accent.id} label={tp("field.accent")}>
                <div className="flex items-center gap-2">
                  {/* Próbnik koloru i pole tekstowe piszą TĘ SAMĄ kolumnę;
                      etykieta wskazuje pole tekstowe (ono ma `id`). */}
                  <Input
                    type="color"
                    value={accent.value}
                    onChange={accent.onChange}
                    className="h-9 w-16 p-1"
                  />
                  <Input {...accent} />
                </div>
              </Field>
              <Field htmlFor={field.id("sort_order")} label={tp("field.sort")}>
                <Input type="number" {...field.number("sort_order")} />
              </Field>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <Field htmlFor={field.id("hero_image_url")} label={tp("field.hero")}>
                <Input {...field.optionalText("hero_image_url")} />
              </Field>
              <Field htmlFor={field.id("contact_email")} label={tp("field.contactEmail")}>
                <Input type="email" {...field.optionalText("contact_email")} />
              </Field>
            </div>

            <Field htmlFor={field.id("category_id")} label={tp("field.contentCategory")}>
              <Select
                value={form.category_id ?? NO_CATEGORY}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, category_id: v === NO_CATEGORY ? null : v }))
                }
              >
                <SelectTrigger id={field.id("category_id")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>{tp("field.none")}</SelectItem>
                  {(categoriesQ.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {lang === "pl" ? c.name_pl : c.name_en}{" "}
                      <span className="opacity-60">/{c.slug}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {tp("cancel")}
            </Button>
            <Button onClick={saveProgram}>{tp("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {manageFor && <ManageContentDialog program={manageFor} onClose={() => setManageFor(null)} />}
    </div>
  );
}

/* -------------------- Research questions editor (jsonb) -------------------- */

function ResearchQuestionsEditor({
  value,
  onChange,
}: {
  value: { pl: string; en: string }[];
  onChange: (next: { pl: string; en: string }[]) => void;
}) {
  const { tp } = usePanelT();
  const add = () => onChange([...value, { pl: "", en: "" }]);
  const update = (i: number, key: "pl" | "en", v: string) =>
    onChange(value.map((q, idx) => (idx === i ? { ...q, [key]: v } : q)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <Label>{tp("field.researchQuestions")}</Label>
        <Button size="sm" variant="ghost" onClick={add}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {tp("add")}
        </Button>
      </div>
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">{tp("field.noQuestions")}</p>
      )}
      {value.map((q, i) => (
        <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <Input
            placeholder={tp("field.questionPl")}
            value={q.pl}
            onChange={(e) => update(i, "pl", e.target.value)}
          />
          <Input
            placeholder={tp("field.questionEn")}
            value={q.en}
            onChange={(e) => update(i, "en", e.target.value)}
          />
          <Button size="sm" variant="ghost" onClick={() => remove(i)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/* -------------------- Manage sub-resources (members / projects / partners / items) -------------------- */

/**
 * Zapis zasobu podrzędnego programu. Odmowa bazy - toast i NIC więcej (wersja
 * robocza zostaje). Sukces - `onSaved`, potem unieważnienie klucza ZAKŁADKI
 * (zawężonego programem) i landingów publicznych, które niosą ten sam zespół,
 * projekty, partnerów i materiały.
 */
function useChildWrite(cacheKey: string, programId: string) {
  const qc = useQueryClient();
  return async (request: PromiseLike<WriteResult>, onSaved?: () => void): Promise<void> => {
    if (!(await writeOrToast(request))) return;
    onSaved?.();
    void qc.invalidateQueries({ queryKey: [cacheKey, programId] });
    void qc.invalidateQueries({ queryKey: PUBLIC_LANDINGS_KEY });
  };
}

function ManageContentDialog({ program, onClose }: { program: ProgramRow; onClose: () => void }) {
  const { tp, lang } = usePanelT();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tp("programContent")}: {lang === "pl" ? program.name_pl : program.name_en}
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="members" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="members">
              <Users className="mr-1 h-4 w-4" /> {tp("tabs.team")}
            </TabsTrigger>
            <TabsTrigger value="projects">
              <Layers className="mr-1 h-4 w-4" /> {tp("tabs.projects")}
            </TabsTrigger>
            <TabsTrigger value="partners">
              <Handshake className="mr-1 h-4 w-4" /> {tp("tabs.partners")}
            </TabsTrigger>
            <TabsTrigger value="items">
              <Star className="mr-1 h-4 w-4" /> {tp("tabs.curated")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members">
            <MembersTab programId={program.id} />
          </TabsContent>
          <TabsContent value="projects">
            <ProjectsTab programId={program.id} />
          </TabsContent>
          <TabsContent value="partners">
            <PartnersTab programId={program.id} />
          </TabsContent>
          <TabsContent value="items">
            <ItemsTab programId={program.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ----- Team members ----- */

function MembersTab({ programId }: { programId: string }) {
  const { tp, lang } = usePanelT();
  const write = useChildWrite("admin-rp-members", programId);

  const membersQ = useQuery({
    queryKey: ["admin-rp-members", programId],
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from("research_program_members")
        .select("program_id, profile_id, member_role_pl, member_role_en, is_lead, sort_order")
        .eq("program_id", programId)
        .order("is_lead", { ascending: false })
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as MemberRow[];
      if (rows.length === 0) return rows;
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, first_name, last_name")
        .in(
          "id",
          rows.map((r) => r.profile_id),
        );
      const nameById = new Map<string, string>();
      for (const p of profiles ?? []) {
        const pRec = p as {
          id: string;
          display_name: string | null;
          first_name: string | null;
          last_name: string | null;
        };
        const name =
          pRec.display_name ||
          [pRec.first_name, pRec.last_name].filter(Boolean).join(" ") ||
          pRec.id;
        nameById.set(pRec.id, name);
      }
      return rows.map((r) => ({ ...r, display_name: nameById.get(r.profile_id) ?? r.profile_id }));
    },
  });

  const usersQ = useQuery({
    queryKey: ["admin-rp-user-options"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (data ?? []) as { id: string; display_name: string | null; email: string | null }[];
    },
  });

  const [draft, setDraft] = useState<MemberDraft>(EMPTY_MEMBER);
  const field = bindDraft(draft, setDraft, "rp-member");

  const members = membersQ.data ?? [];
  const memberIds = new Set(members.map((m) => m.profile_id));
  const available = (usersQ.data ?? []).filter((u) => !memberIds.has(u.id));

  const addMember = () => {
    if (!draft.profile_id) return;
    void write(
      supabase.from("research_program_members").insert({
        ...draft,
        program_id: programId,
        sort_order: members.length + 1,
      }),
      () => setDraft(EMPTY_MEMBER),
    );
  };

  // Klucz złożony (`program_id`, `profile_id`): filtr po samym profilu
  // dotknąłby tej osoby we WSZYSTKICH programach obszaru.
  const removeMember = (profileId: string) =>
    void write(
      supabase
        .from("research_program_members")
        .delete()
        .eq("program_id", programId)
        .eq("profile_id", profileId),
    );

  const toggleLead = (profileId: string, next: boolean) =>
    void write(
      supabase
        .from("research_program_members")
        .update({ is_lead: next })
        .eq("program_id", programId)
        .eq("profile_id", profileId),
    );

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 md:grid-cols-2">
          <Select {...field.choice("profile_id")}>
            <SelectTrigger>
              <SelectValue placeholder={tp("members.selectUser")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {available.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.display_name || u.email || u.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch {...field.flag("is_lead")} />
            <Label htmlFor={field.id("is_lead")}>{tp("members.lead")}</Label>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder={tp("members.rolePl")} {...field.optionalText("member_role_pl")} />
          <Input placeholder={tp("members.roleEn")} {...field.optionalText("member_role_en")} />
        </div>
        <Button onClick={addMember} disabled={!draft.profile_id}>
          <Plus className="mr-1 h-4 w-4" /> {tp("members.addMember")}
        </Button>
      </div>

      <ul className="grid gap-2">
        {members.map((m) => (
          <li
            key={m.profile_id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2"
          >
            <span className="font-medium">{m.display_name}</span>
            {(m.member_role_pl || m.member_role_en) && (
              <span className="text-xs text-muted-foreground">
                {lang === "pl" ? m.member_role_pl : m.member_role_en}
              </span>
            )}
            <span className="flex-1" />
            <div className="flex items-center gap-2">
              <Switch checked={m.is_lead} onCheckedChange={(v) => toggleLead(m.profile_id, v)} />
              <span className="text-xs">{tp("members.lead")}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => removeMember(m.profile_id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
        {members.length === 0 && (
          <p className="text-sm text-muted-foreground">{tp("members.empty")}</p>
        )}
      </ul>
    </div>
  );
}

/* ----- Projects ----- */

function ProjectsTab({ programId }: { programId: string }) {
  const { t, tp, lang } = usePanelT();
  const write = useChildWrite("admin-rp-projects", programId);

  const q = useQuery({
    queryKey: ["admin-rp-projects", programId],
    queryFn: async (): Promise<ProjectRow[]> => {
      const { data, error } = await supabase
        .from("research_program_projects")
        .select(
          "id, program_id, name_pl, name_en, summary_pl, summary_en, project_status, url, sort_order",
        )
        .eq("program_id", programId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProjectRow[];
    },
  });

  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_PROJECT);
  const field = bindDraft(draft, setDraft, "rp-project");
  const rows = q.data ?? [];

  const addProject = () => {
    if (!draft.name_pl.trim() || !draft.name_en.trim()) {
      toast.error(tp("projects.nameRequired"));
      return;
    }
    void write(
      supabase.from("research_program_projects").insert({
        ...draft,
        program_id: programId,
        sort_order: rows.length + 1,
      }),
      () => setDraft(EMPTY_PROJECT),
    );
  };

  const removeProject = (id: string) =>
    void write(supabase.from("research_program_projects").delete().eq("id", id));

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder={tp("projects.namePl")} {...field.text("name_pl")} />
          <Input placeholder={tp("projects.nameEn")} {...field.text("name_en")} />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Textarea
            rows={2}
            placeholder={tp("projects.summaryPl")}
            {...field.optionalText("summary_pl")}
          />
          <Textarea
            rows={2}
            placeholder={tp("projects.summaryEn")}
            {...field.optionalText("summary_en")}
          />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Select {...field.choice("project_status")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`programs.projectStatus.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="URL" {...field.optionalText("url")} />
        </div>
        <Button onClick={addProject}>
          <Plus className="mr-1 h-4 w-4" /> {tp("projects.addProject")}
        </Button>
      </div>

      <ul className="grid gap-2">
        {rows.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-md border border-border p-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {lang === "pl" ? p.name_pl : p.name_en}{" "}
                <span className="text-xs text-muted-foreground">
                  [{t(`programs.projectStatus.${p.project_status}`)}]
                </span>
              </p>
              {(p.summary_pl || p.summary_en) && (
                <p className="truncate text-xs text-muted-foreground">
                  {lang === "pl" ? p.summary_pl : p.summary_en}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => removeProject(p.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----- Partners ----- */

function PartnersTab({ programId }: { programId: string }) {
  const { tp } = usePanelT();
  const write = useChildWrite("admin-rp-partners", programId);

  const q = useQuery({
    queryKey: ["admin-rp-partners", programId],
    queryFn: async (): Promise<PartnerRow[]> => {
      const { data, error } = await supabase
        .from("research_program_partners")
        .select("id, program_id, name, logo_url, url, sort_order")
        .eq("program_id", programId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PartnerRow[];
    },
  });

  const [draft, setDraft] = useState<PartnerDraft>(EMPTY_PARTNER);
  const field = bindDraft(draft, setDraft, "rp-partner");
  const rows = q.data ?? [];

  const add = () => {
    if (!draft.name.trim()) return;
    void write(
      supabase.from("research_program_partners").insert({
        ...draft,
        program_id: programId,
        sort_order: rows.length + 1,
      }),
      () => setDraft(EMPTY_PARTNER),
    );
  };

  const remove = (id: string) =>
    void write(supabase.from("research_program_partners").delete().eq("id", id));

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 md:grid-cols-3">
          <Input placeholder={tp("partners.name")} {...field.text("name")} />
          <Input placeholder={tp("partners.logoUrl")} {...field.optionalText("logo_url")} />
          <Input placeholder="URL" {...field.optionalText("url")} />
        </div>
        <Button onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> {tp("partners.addPartner")}
        </Button>
      </div>

      <ul className="grid gap-2">
        {rows.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-md border border-border p-2">
            {p.logo_url && (
              <img src={p.logo_url} alt="" className="h-8 w-8 rounded object-contain" />
            )}
            <span className="flex-1 truncate">{p.name}</span>
            <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----- Curated items (flagship posts / podcasts / events) ----- */

function ItemsTab({ programId }: { programId: string }) {
  const { tp } = usePanelT();
  const write = useChildWrite("admin-rp-items", programId);

  const q = useQuery({
    queryKey: ["admin-rp-items", programId],
    queryFn: async (): Promise<ItemRow[]> => {
      const { data, error } = await supabase
        .from("research_program_items")
        .select("id, program_id, item_type, post_id, podcast_id, event_id, sort_order")
        .eq("program_id", programId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ItemRow[];
    },
  });

  const [draft, setDraft] = useState<ItemDraft>(EMPTY_ITEM);
  const field = bindDraft(draft, setDraft, "rp-item");
  const rows = q.data ?? [];

  const add = () => {
    // UUID wklejony ze spacją na brzegu to błąd składni typu `uuid` w bazie -
    // do kolumny jedzie wartość PRZYCIĘTA, ta sama, którą sprawdza warunek.
    const target = draft.target.trim();
    if (!target) return;
    const type = draft.item_type;
    void write(
      supabase.from("research_program_items").insert({
        program_id: programId,
        item_type: type,
        post_id: type === "flagship_post" ? target : null,
        podcast_id: type === "podcast" ? target : null,
        event_id: type === "event" ? target : null,
        sort_order: rows.length + 1,
      }),
      () => setDraft((d) => ({ ...d, target: "" })),
    );
  };

  const remove = (id: string) =>
    void write(supabase.from("research_program_items").delete().eq("id", id));

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
          <Select {...field.choice("item_type")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flagship_post">{tp(ITEM_TYPE_LABEL.flagship_post)}</SelectItem>
              <SelectItem value="podcast">{tp(ITEM_TYPE_LABEL.podcast)}</SelectItem>
              <SelectItem value="event">{tp(ITEM_TYPE_LABEL.event)}</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={tp("items.recordUuid")} {...field.text("target")} />
          <Button onClick={add}>
            <Plus className="mr-1 h-4 w-4" /> {tp("add")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{tp("items.hint")}</p>
      </div>

      <ul className="grid gap-2">
        {rows.map((it) => (
          <li key={it.id} className="flex items-center gap-3 rounded-md border border-border p-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {tp(ITEM_TYPE_LABEL[it.item_type])}
            </span>
            <code className="flex-1 truncate text-xs">
              {it.post_id ?? it.podcast_id ?? it.event_id}
            </code>
            <Button variant="ghost" size="sm" onClick={() => remove(it.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
