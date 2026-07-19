// Admin: strony programów badawczych w stylu think-tank/RUSI (research_programs
// + members/projects/partners/items). Odrębne od /admin/programs, które
// zarządza uproszczoną tabelą `programs` używaną do tagowania treści i
// przypisań ekspertów. Tutaj: pełny landing (teza, zakres, pytania badawcze,
// zespół z liderem, projekty, partnerzy, kuratorowane raporty flagowe,
// podcasty i wydarzenia).
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  DialogTrigger,
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
import { PROGRAM_ICONS, DEFAULT_PROGRAM_ICON } from "@/lib/programs/icons";
import { ProgramIcon } from "@/components/programs/ProgramIcon";
import "@/lib/i18n-programs";

export const Route = createFileRoute("/admin/research-programs")({
  component: AdminResearchPrograms,
});

type Status = "draft" | "published" | "archived";
type ProjectStatus = "planned" | "active" | "completed";
type ItemType = "flagship_post" | "podcast" | "event";

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

interface MemberRow {
  program_id: string;
  profile_id: string;
  member_role_pl: string | null;
  member_role_en: string | null;
  is_lead: boolean;
  sort_order: number;
  display_name?: string | null;
}

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

interface PartnerRow {
  id: string;
  program_id: string;
  name: string;
  logo_url: string | null;
  url: string | null;
  sort_order: number;
}

interface ItemRow {
  id: string;
  program_id: string;
  item_type: ItemType;
  post_id: string | null;
  podcast_id: string | null;
  event_id: string | null;
  sort_order: number;
}

const EMPTY: Omit<ProgramRow, "id" | "tenant_id"> = {
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

function AdminResearchPrograms() {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const tp = (k: string) => t(`adminPrograms.${k}`);

  const tenantId = useRequiredTenant();
  const qc = useQueryClient();

  const programsQ = useQuery({
    queryKey: ["admin-research-programs", tenantId],
    queryFn: async (): Promise<ProgramRow[]> => {
      const { data, error } = await supabase
        .from("research_programs")
        .select(
          "id, tenant_id, slug, name_pl, name_en, tagline_pl, tagline_en, scope_pl, scope_en, research_questions, icon, accent_color, hero_image_url, category_id, contact_email, sort_order, status",
        )
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
        .order("name_pl", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; slug: string; name_pl: string; name_en: string }[];
    },
  });

  const [editing, setEditing] = useState<ProgramRow | null>(null);
  const [form, setForm] = useState<Omit<ProgramRow, "id" | "tenant_id">>(EMPTY);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manageFor, setManageFor] = useState<ProgramRow | null>(null);

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
    if (!/^[a-z0-9-]{2,80}$/.test(form.slug)) {
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

    const { error } = editing
      ? await supabase.from("research_programs").update(payload).eq("id", editing.id)
      : await supabase.from("research_programs").insert(payload);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tp("saved"));
    setDialogOpen(false);
    qc.invalidateQueries({ queryKey: ["admin-research-programs"] });
  };

  const deleteProgram = async (p: ProgramRow) => {
    const ok = await confirmDialog({
      title: tp("deleteConfirm"),
      description: `${p.name_pl} / ${p.name_en}`,
      confirmLabel: tp("delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("research_programs").delete().eq("id", p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tp("deleted"));

    qc.invalidateQueries({ queryKey: ["admin-research-programs"] });
  };

  const rows = programsQ.data ?? [];
  const iconNames = Object.keys(PROGRAM_ICONS);

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
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-300")
                }
              >
                {p.status}
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
              <div className="grid gap-1.5">
                <Label>Slug</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="np. bezpieczenstwo-europy"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as Status }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">draft</SelectItem>
                    <SelectItem value="published">published</SelectItem>
                    <SelectItem value="archived">archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Nazwa (PL)</Label>
                <Input
                  value={form.name_pl}
                  onChange={(e) => setForm((f) => ({ ...f, name_pl: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Name (EN)</Label>
                <Input
                  value={form.name_en}
                  onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{tp("field.taglinePl")}</Label>
                <Textarea
                  rows={2}
                  value={form.tagline_pl ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, tagline_pl: e.target.value || null }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Tagline (EN)</Label>
                <Textarea
                  rows={2}
                  value={form.tagline_en ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, tagline_en: e.target.value || null }))}
                />
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{tp("field.scopePl")}</Label>
                <Textarea
                  rows={4}
                  value={form.scope_pl ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, scope_pl: e.target.value || null }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Scope (EN)</Label>
                <Textarea
                  rows={4}
                  value={form.scope_en ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, scope_en: e.target.value || null }))}
                />
              </div>
            </div>

            <ResearchQuestionsEditor
              value={form.research_questions}
              onChange={(next) => setForm((f) => ({ ...f, research_questions: next }))}
              lang={lang}
            />

            <div className="grid gap-2 md:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>{tp("field.icon")}</Label>
                <Select
                  value={form.icon}
                  onValueChange={(v) => setForm((f) => ({ ...f, icon: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {iconNames.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{tp("field.accent")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={form.accent_color}
                    onChange={(e) => setForm((f) => ({ ...f, accent_color: e.target.value }))}
                    className="h-9 w-16 p-1"
                  />
                  <Input
                    value={form.accent_color}
                    onChange={(e) => setForm((f) => ({ ...f, accent_color: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>{tp("field.sort")}</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{tp("field.hero")}</Label>
                <Input
                  value={form.hero_image_url ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, hero_image_url: e.target.value || null }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{tp("field.contactEmail")}</Label>
                <Input
                  type="email"
                  value={form.contact_email ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contact_email: e.target.value || null }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>{tp("field.contentCategory")}</Label>

              <Select
                value={form.category_id ?? "none"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, category_id: v === "none" ? null : v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tp("field.none")}</SelectItem>
                  {(categoriesQ.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {lang === "pl" ? c.name_pl : c.name_en}{" "}
                      <span className="opacity-60">/{c.slug}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {tp("cancel")}
            </Button>
            <Button onClick={saveProgram}>{tp("save")}</Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      {manageFor && (
        <ManageContentDialog program={manageFor} onClose={() => setManageFor(null)} lang={lang} />
      )}
    </div>
  );
}

/* -------------------- Research questions editor (jsonb) -------------------- */

function ResearchQuestionsEditor({
  value,
  onChange,
  lang,
}: {
  value: { pl: string; en: string }[];
  onChange: (next: { pl: string; en: string }[]) => void;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const tp = (k: string) => t(`adminPrograms.${k}`);
  const add = () => onChange([...(value ?? []), { pl: "", en: "" }]);
  const update = (i: number, key: "pl" | "en", v: string) => {
    const next = [...value];
    next[i] = { ...next[i], [key]: v };
    onChange(next);
  };
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

function ManageContentDialog({
  program,
  onClose,
  lang,
}: {
  program: ProgramRow;
  onClose: () => void;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const tp = (k: string) => t(`adminPrograms.${k}`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tp("programContent")}: {program.name_pl}
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
            <MembersTab programId={program.id} lang={lang} />
          </TabsContent>
          <TabsContent value="projects">
            <ProjectsTab programId={program.id} lang={lang} />
          </TabsContent>
          <TabsContent value="partners">
            <PartnersTab programId={program.id} lang={lang} />
          </TabsContent>
          <TabsContent value="items">
            <ItemsTab programId={program.id} lang={lang} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ----- Team members ----- */

function MembersTab({ programId, lang }: { programId: string; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const tp = (k: string) => t(`adminPrograms.${k}`);
  const qc = useQueryClient();

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

  const [selectedUser, setSelectedUser] = useState<string>("");
  const [rolePl, setRolePl] = useState("");
  const [roleEn, setRoleEn] = useState("");
  const [isLead, setIsLead] = useState(false);

  const addMember = async () => {
    if (!selectedUser) return;
    const { error } = await supabase.from("research_program_members").insert({
      program_id: programId,
      profile_id: selectedUser,
      member_role_pl: rolePl || null,
      member_role_en: roleEn || null,
      is_lead: isLead,
      sort_order: (membersQ.data?.length ?? 0) + 1,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setSelectedUser("");
    setRolePl("");
    setRoleEn("");
    setIsLead(false);
    qc.invalidateQueries({ queryKey: ["admin-rp-members", programId] });
  };

  const removeMember = async (profileId: string) => {
    const { error } = await supabase
      .from("research_program_members")
      .delete()
      .eq("program_id", programId)
      .eq("profile_id", profileId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-rp-members", programId] });
  };

  const toggleLead = async (profileId: string, next: boolean) => {
    const { error } = await supabase
      .from("research_program_members")
      .update({ is_lead: next })
      .eq("program_id", programId)
      .eq("profile_id", profileId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-rp-members", programId] });
  };

  const users = usersQ.data ?? [];
  const alreadyIds = new Set((membersQ.data ?? []).map((m) => m.profile_id));
  const available = useMemo(() => users.filter((u) => !alreadyIds.has(u.id)), [users, alreadyIds]);

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 md:grid-cols-2">
          <Select value={selectedUser} onValueChange={setSelectedUser}>
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
            <Switch checked={isLead} onCheckedChange={setIsLead} id="is-lead" />
            <Label htmlFor="is-lead">{tp("members.lead")}</Label>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            placeholder={tp("members.rolePl")}
            value={rolePl}
            onChange={(e) => setRolePl(e.target.value)}
          />
          <Input
            placeholder={tp("members.roleEn")}
            value={roleEn}
            onChange={(e) => setRoleEn(e.target.value)}
          />
        </div>
        <Button onClick={addMember} disabled={!selectedUser}>
          <Plus className="mr-1 h-4 w-4" /> {tp("members.addMember")}
        </Button>

      </div>

      <ul className="grid gap-2">
        {(membersQ.data ?? []).map((m) => (
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
        {(membersQ.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">{tp("members.empty")}</p>
        )}

      </ul>
    </div>
  );
}

/* ----- Projects ----- */

function ProjectsTab({ programId, lang }: { programId: string; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const tp = (k: string) => t(`adminPrograms.${k}`);
  const qc = useQueryClient();

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

  const [draft, setDraft] = useState<Omit<ProjectRow, "id" | "program_id">>({
    name_pl: "",
    name_en: "",
    summary_pl: null,
    summary_en: null,
    project_status: "active",
    url: null,
    sort_order: 0,
  });

  const addProject = async () => {
    if (!draft.name_pl.trim() || !draft.name_en.trim()) {
      toast.error(tp("projects.nameRequired"));
      return;
    }
    const { error } = await supabase.from("research_program_projects").insert({
      ...draft,
      program_id: programId,
      sort_order: (q.data?.length ?? 0) + 1,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft({
      name_pl: "",
      name_en: "",
      summary_pl: null,
      summary_en: null,
      project_status: "active",
      url: null,
      sort_order: 0,
    });
    qc.invalidateQueries({ queryKey: ["admin-rp-projects", programId] });
  };

  const removeProject = async (id: string) => {
    const { error } = await supabase.from("research_program_projects").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-rp-projects", programId] });
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            placeholder={tp("projects.namePl")}
            value={draft.name_pl}
            onChange={(e) => setDraft((d) => ({ ...d, name_pl: e.target.value }))}
          />
          <Input
            placeholder={tp("projects.nameEn")}
            value={draft.name_en}
            onChange={(e) => setDraft((d) => ({ ...d, name_en: e.target.value }))}
          />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Textarea
            rows={2}
            placeholder={tp("projects.summaryPl")}
            value={draft.summary_pl ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, summary_pl: e.target.value || null }))}
          />
          <Textarea
            rows={2}
            placeholder="Summary (EN)"
            value={draft.summary_en ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, summary_en: e.target.value || null }))}
          />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Select
            value={draft.project_status}
            onValueChange={(v) => setDraft((d) => ({ ...d, project_status: v as ProjectStatus }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="planned">planned</SelectItem>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="completed">completed</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="URL"
            value={draft.url ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value || null }))}
          />
        </div>
        <Button onClick={addProject}>
          <Plus className="mr-1 h-4 w-4" /> {lang === "pl" ? "Dodaj projekt" : "Add project"}
        </Button>
      </div>

      <ul className="grid gap-2">
        {(q.data ?? []).map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-md border border-border p-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {lang === "pl" ? p.name_pl : p.name_en}{" "}
                <span className="text-xs text-muted-foreground">[{p.project_status}]</span>
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

function PartnersTab({ programId, lang }: { programId: string; lang: "pl" | "en" }) {
  const qc = useQueryClient();
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

  const [draft, setDraft] = useState<Omit<PartnerRow, "id" | "program_id">>({
    name: "",
    logo_url: null,
    url: null,
    sort_order: 0,
  });

  const add = async () => {
    if (!draft.name.trim()) return;
    const { error } = await supabase.from("research_program_partners").insert({
      ...draft,
      program_id: programId,
      sort_order: (q.data?.length ?? 0) + 1,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft({ name: "", logo_url: null, url: null, sort_order: 0 });
    qc.invalidateQueries({ queryKey: ["admin-rp-partners", programId] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("research_program_partners").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-rp-partners", programId] });
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 md:grid-cols-3">
          <Input
            placeholder={lang === "pl" ? "Nazwa partnera" : "Partner name"}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <Input
            placeholder={lang === "pl" ? "URL logo" : "Logo URL"}
            value={draft.logo_url ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, logo_url: e.target.value || null }))}
          />
          <Input
            placeholder="URL"
            value={draft.url ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value || null }))}
          />
        </div>
        <Button onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> {lang === "pl" ? "Dodaj partnera" : "Add partner"}
        </Button>
      </div>
      <ul className="grid gap-2">
        {(q.data ?? []).map((p) => (
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

function ItemsTab({ programId, lang }: { programId: string; lang: "pl" | "en" }) {
  const qc = useQueryClient();
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

  const [type, setType] = useState<ItemType>("flagship_post");
  const [targetId, setTargetId] = useState("");

  const add = async () => {
    if (!targetId.trim()) return;
    const payload: Partial<ItemRow> & { program_id: string; item_type: ItemType } = {
      program_id: programId,
      item_type: type,
      post_id: type === "flagship_post" ? targetId : null,
      podcast_id: type === "podcast" ? targetId : null,
      event_id: type === "event" ? targetId : null,
      sort_order: (q.data?.length ?? 0) + 1,
    };
    const { error } = await supabase.from("research_program_items").insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    setTargetId("");
    qc.invalidateQueries({ queryKey: ["admin-rp-items", programId] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("research_program_items").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-rp-items", programId] });
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
          <Select value={type} onValueChange={(v) => setType(v as ItemType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flagship_post">
                {lang === "pl" ? "Raport / wpis" : "Flagship post"}
              </SelectItem>
              <SelectItem value="podcast">{lang === "pl" ? "Podcast" : "Podcast"}</SelectItem>
              <SelectItem value="event">{lang === "pl" ? "Wydarzenie" : "Event"}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder={lang === "pl" ? "UUID rekordu" : "Record UUID"}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          />
          <Button onClick={add}>
            <Plus className="mr-1 h-4 w-4" /> {lang === "pl" ? "Dodaj" : "Add"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "pl"
            ? "Wklej UUID posta / podcastu / wydarzenia. Kolejność wg pola sort_order."
            : "Paste the post / podcast / event UUID. Ordered by sort_order."}
        </p>
      </div>
      <ul className="grid gap-2">
        {(q.data ?? []).map((it) => (
          <li key={it.id} className="flex items-center gap-3 rounded-md border border-border p-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{it.item_type}</span>
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
