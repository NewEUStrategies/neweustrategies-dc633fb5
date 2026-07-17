// Admin: zarządzanie programami/projektami/departamentami huba eksperta oraz
// przypisywaniem ekspertów (członków) z funkcją PL/EN. Zapisy idą wprost do
// tabel programs / program_members - RLS wymaga roli admin/editor tenanta.
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
import { Plus, Trash2, Pencil, Users, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/appDialogs";
import "@/lib/i18n-experts";

export const Route = createFileRoute("/admin/programs")({
  component: AdminPrograms,
});

type ProgramKind = "program" | "project" | "department";

interface ProgramRow {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  kind: ProgramKind;
  description_pl: string | null;
  description_en: string | null;
  is_active: boolean;
  sort_order: number;
}

interface MemberRow {
  user_id: string;
  role_pl: string | null;
  role_en: string | null;
  sort_order: number;
  display_name: string | null;
  avatar_url: string | null;
}

interface UserOption {
  id: string;
  display_name: string | null;
  email: string | null;
}

const EMPTY_PROGRAM: Omit<ProgramRow, "id"> = {
  slug: "",
  name_pl: "",
  name_en: "",
  kind: "program",
  description_pl: null,
  description_en: null,
  is_active: true,
  sort_order: 0,
};

function AdminPrograms() {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const tenantId = useRequiredTenant();
  const qc = useQueryClient();

  const programsQ = useQuery({
    queryKey: ["admin-programs", tenantId],
    queryFn: async (): Promise<ProgramRow[]> => {
      const { data, error } = await supabase
        .from("programs")
        .select(
          "id, slug, name_pl, name_en, kind, description_pl, description_en, is_active, sort_order",
        )
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProgramRow[];
    },
  });

  const [editing, setEditing] = useState<ProgramRow | null>(null);
  const [form, setForm] = useState<Omit<ProgramRow, "id">>(EMPTY_PROGRAM);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [membersFor, setMembersFor] = useState<ProgramRow | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_PROGRAM);
    setDialogOpen(true);
  };
  const openEdit = (p: ProgramRow) => {
    setEditing(p);
    const { id: _id, ...rest } = p;
    setForm(rest);
    setDialogOpen(true);
  };

  const saveProgram = async () => {
    if (!/^[a-z0-9-]{2,80}$/.test(form.slug)) {
      toast.error(
        lang === "pl" ? "Slug: małe litery, cyfry i myślniki." : "Slug: lowercase, digits, dashes.",
      );
      return;
    }
    if (!form.name_pl.trim() || !form.name_en.trim()) {
      toast.error(lang === "pl" ? "Nazwa PL i EN są wymagane." : "PL and EN name required.");
      return;
    }
    const payload = { ...form, tenant_id: tenantId };
    const res = editing
      ? await supabase.from("programs").update(payload).eq("id", editing.id)
      : await supabase.from("programs").insert(payload);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success(t("expert.saved"));
    setDialogOpen(false);
    qc.invalidateQueries({ queryKey: ["admin-programs"] });
    qc.invalidateQueries({ queryKey: ["public", "experts-directory"] });
  };

  const removeProgram = async (p: ProgramRow) => {
    const ok = await confirmDialog({
      title: lang === "pl" ? "Usunąć program?" : "Delete program?",
      description:
        lang === "pl"
          ? `„${p.name_pl}” i przypisania członków zostaną usunięte.`
          : `"${p.name_en}" and member assignments will be removed.`,
    });
    if (!ok) return;
    const { error } = await supabase.from("programs").delete().eq("id", p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("expert.saved"));
    qc.invalidateQueries({ queryKey: ["admin-programs"] });
  };

  const KIND_LABEL: Record<ProgramKind, string> = {
    program: lang === "pl" ? "Program" : "Program",
    project: lang === "pl" ? "Projekt" : "Project",
    department: lang === "pl" ? "Departament" : "Department",
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Briefcase className="h-5 w-5" />
            {t("admin.nav.programs", { defaultValue: lang === "pl" ? "Programy" : "Programs" })}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {lang === "pl"
              ? "Programy, projekty i departamenty oraz przypisani eksperci."
              : "Programs, projects and departments, and their assigned experts."}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {lang === "pl" ? "Nowy program" : "New program"}
        </Button>
      </div>

      {programsQ.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted/60" />
          ))}
        </div>
      ) : (programsQ.data ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {lang === "pl"
            ? "Brak programów. Dodaj pierwszy."
            : "No programs yet. Add the first one."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {(programsQ.data ?? []).map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {lang === "en" ? p.name_en : p.name_pl}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {KIND_LABEL[p.kind]}
                  </span>
                  {!p.is_active && (
                    <span className="text-[10px] text-muted-foreground">
                      ({lang === "pl" ? "nieaktywny" : "inactive"})
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">/{p.slug}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setMembersFor(p)}>
                <Users className="mr-1 h-4 w-4" />
                {lang === "pl" ? "Członkowie" : "Members"}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => openEdit(p)} aria-label="edit">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void removeProgram(p)}
                aria-label="delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Dialog: tworzenie / edycja programu */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? lang === "pl"
                  ? "Edytuj program"
                  : "Edit program"
                : lang === "pl"
                  ? "Nowy program"
                  : "New program"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-slug">Slug</Label>
              <Input
                id="p-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="np. bezpieczenstwo-europejskie"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="p-name-pl">{lang === "pl" ? "Nazwa (PL)" : "Name (PL)"}</Label>
                <Input
                  id="p-name-pl"
                  value={form.name_pl}
                  onChange={(e) => setForm({ ...form, name_pl: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-name-en">{lang === "pl" ? "Nazwa (EN)" : "Name (EN)"}</Label>
                <Input
                  id="p-name-en"
                  value={form.name_en}
                  onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{lang === "pl" ? "Rodzaj" : "Kind"}</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => setForm({ ...form, kind: v as ProgramKind })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="program">{KIND_LABEL.program}</SelectItem>
                    <SelectItem value="project">{KIND_LABEL.project}</SelectItem>
                    <SelectItem value="department">{KIND_LABEL.department}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-order">{lang === "pl" ? "Kolejność" : "Sort order"}</Label>
                <Input
                  id="p-order"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-desc-pl">{lang === "pl" ? "Opis (PL)" : "Description (PL)"}</Label>
              <Textarea
                id="p-desc-pl"
                rows={2}
                value={form.description_pl ?? ""}
                onChange={(e) => setForm({ ...form, description_pl: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-desc-en">{lang === "pl" ? "Opis (EN)" : "Description (EN)"}</Label>
              <Textarea
                id="p-desc-en"
                rows={2}
                value={form.description_en ?? ""}
                onChange={(e) => setForm({ ...form, description_en: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              {lang === "pl" ? "Aktywny" : "Active"}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {lang === "pl" ? "Anuluj" : "Cancel"}
            </Button>
            <Button onClick={() => void saveProgram()}>{lang === "pl" ? "Zapisz" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {membersFor && (
        <ProgramMembersDialog
          program={membersFor}
          lang={lang}
          onClose={() => setMembersFor(null)}
        />
      )}
    </div>
  );
}

function ProgramMembersDialog({
  program,
  lang,
  onClose,
}: {
  program: ProgramRow;
  lang: "pl" | "en";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [addUserId, setAddUserId] = useState<string>("");
  const [rolePl, setRolePl] = useState("");
  const [roleEn, setRoleEn] = useState("");

  const membersQ = useQuery({
    queryKey: ["admin-program-members", program.id],
    queryFn: async (): Promise<MemberRow[]> => {
      // program_members.user_id → auth.users (brak FK do profiles), więc
      // pobieramy profile osobnym zapytaniem zamiast zagnieżdżonego selecta.
      const { data, error } = await supabase
        .from("program_members")
        .select("user_id, role_pl, role_en, sort_order")
        .eq("program_id", program.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        user_id: string;
        role_pl: string | null;
        role_en: string | null;
        sort_order: number;
      }>;
      const ids = rows.map((r) => r.user_id);
      type ProfLite = { display_name: string | null; avatar_url: string | null };
      const profById = new Map<string, ProfLite>();
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", ids);
        for (const p of (profs ?? []) as Record<string, unknown>[]) {
          profById.set(p.id as string, {
            display_name: (p.display_name as string | null) ?? null,
            avatar_url: (p.avatar_url as string | null) ?? null,
          });
        }
      }
      return rows.map((r) => ({
        user_id: r.user_id,
        role_pl: r.role_pl,
        role_en: r.role_en,
        sort_order: r.sort_order,
        display_name: profById.get(r.user_id)?.display_name ?? null,
        avatar_url: profById.get(r.user_id)?.avatar_url ?? null,
      }));
    },
  });

  // Kandydaci: użytkownicy tenanta (RPC admin_list_users), bez już przypisanych.
  const candidatesQ = useQuery({
    queryKey: ["admin-users-for-programs"],
    queryFn: async (): Promise<UserOption[]> => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: row.id as string,
          display_name: (row.display_name as string | null) ?? null,
          email: (row.email as string | null) ?? null,
        };
      });
    },
  });

  const assignedIds = useMemo(
    () => new Set((membersQ.data ?? []).map((m) => m.user_id)),
    [membersQ.data],
  );
  const candidates = (candidatesQ.data ?? []).filter((u) => !assignedIds.has(u.id));

  const addMember = async () => {
    if (!addUserId) return;
    const { error } = await supabase.from("program_members").insert({
      program_id: program.id,
      user_id: addUserId,
      role_pl: rolePl.trim() || null,
      role_en: roleEn.trim() || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAddUserId("");
    setRolePl("");
    setRoleEn("");
    qc.invalidateQueries({ queryKey: ["admin-program-members", program.id] });
    qc.invalidateQueries({ queryKey: ["public", "expert"] });
    qc.invalidateQueries({ queryKey: ["public", "experts-directory"] });
  };

  const removeMember = async (userId: string) => {
    const { error } = await supabase
      .from("program_members")
      .delete()
      .eq("program_id", program.id)
      .eq("user_id", userId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-program-members", program.id] });
    qc.invalidateQueries({ queryKey: ["public", "expert"] });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {lang === "en" ? program.name_en : program.name_pl} —{" "}
            {lang === "pl" ? "członkowie" : "members"}
          </DialogTitle>
        </DialogHeader>

        <ul className="grid gap-2">
          {(membersQ.data ?? []).length === 0 && (
            <li className="text-sm text-muted-foreground">
              {lang === "pl" ? "Brak przypisanych ekspertów." : "No experts assigned."}
            </li>
          )}
          {(membersQ.data ?? []).map((m) => (
            <li
              key={m.user_id}
              className="flex items-center gap-3 rounded-md border border-border p-2"
            >
              {m.avatar_url ? (
                <img src={m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.display_name ?? m.user_id}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[m.role_pl, m.role_en].filter(Boolean).join(" / ") || "—"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void removeMember(m.user_id)}
                aria-label="remove"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>

        <div className="mt-2 grid gap-2 rounded-md border border-dashed border-border p-3">
          <Label className="text-sm font-medium">
            {lang === "pl" ? "Dodaj eksperta" : "Add expert"}
          </Label>
          <Select value={addUserId} onValueChange={setAddUserId}>
            <SelectTrigger>
              <SelectValue placeholder={lang === "pl" ? "Wybierz użytkownika" : "Select a user"} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.display_name ?? u.email ?? u.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder={lang === "pl" ? "Funkcja (PL)" : "Role (PL)"}
              value={rolePl}
              onChange={(e) => setRolePl(e.target.value)}
            />
            <Input
              placeholder={lang === "pl" ? "Funkcja (EN)" : "Role (EN)"}
              value={roleEn}
              onChange={(e) => setRoleEn(e.target.value)}
            />
          </div>
          <Button size="sm" disabled={!addUserId} onClick={() => void addMember()}>
            <Plus className="mr-1 h-4 w-4" />
            {lang === "pl" ? "Przypisz" : "Assign"}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {lang === "pl" ? "Zamknij" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
