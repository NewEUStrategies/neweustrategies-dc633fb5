// Admin: zarządzanie programami/projektami/departamentami huba eksperta oraz
// przypisywaniem ekspertów (członków) z funkcją PL/EN. Zapisy idą wprost do
// tabel programs / program_members - RLS wymaga roli admin/editor tenanta.
//
// UWAGA: `research_programs` (panel /admin/research-programs) jest od migracji
// 20260815110844 WIDOKIEM na `programs` - wspólne reguły zapisu obu paneli
// mieszkają w `lib/programs/adminForm.ts`.
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
import {
  PROGRAM_SLUG_PATTERN,
  bindDraft,
  invalidateProgramReaders,
  writeOrToast,
} from "@/lib/programs/adminForm";
import { ensureI18n as ensureExpertsI18n } from "@/lib/i18n-experts";
import { ensureI18n as ensureAdminProgramsI18n } from "@/lib/i18n-admin-programs";
// `programs.loadError` - komunikat nieudanego odczytu listy programów (ten sam
// wiersz `programs` czyta panel landingów; bez dublowania klucza w słowniku).
import { ensureI18n as ensureProgramsI18n } from "@/lib/i18n-programs";
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

/** Wersja robocza przypisania; role przycinane przy zapisie, puste -> NULL. */
interface MemberDraft {
  user_id: string;
  role_pl: string;
  role_en: string;
}

const EMPTY_MEMBER: MemberDraft = { user_id: "", role_pl: "", role_en: "" };

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
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureExpertsI18n();
  ensureAdminProgramsI18n();
  ensureProgramsI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const tp = (k: string, opts?: Record<string, unknown>) => t(`adminPrograms.${k}`, opts);
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
        // Klucz cache niesie `tenantId` - zapytanie mówi to samo jawnie.
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProgramRow[];
    },
  });

  const [editing, setEditing] = useState<ProgramRow | null>(null);
  const [form, setForm] = useState<Omit<ProgramRow, "id">>(EMPTY_PROGRAM);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [membersFor, setMembersFor] = useState<ProgramRow | null>(null);
  const field = bindDraft(form, setForm, "p");

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
    if (!PROGRAM_SLUG_PATTERN.test(form.slug)) {
      toast.error(tp("validation.slug"));
      return;
    }
    if (!form.name_pl.trim() || !form.name_en.trim()) {
      toast.error(tp("validation.names"));
      return;
    }
    const payload = { ...form, tenant_id: tenantId };
    const saved = await writeOrToast(
      editing
        ? supabase.from("programs").update(payload).eq("id", editing.id)
        : supabase.from("programs").insert(payload),
    );
    if (!saved) return;
    toast.success(t("expert.saved"));
    setDialogOpen(false);
    invalidateProgramReaders(qc);
  };

  const removeProgram = async (p: ProgramRow) => {
    const ok = await confirmDialog({
      title: tp("remove.title"),
      description: tp("remove.description", { name: lang === "en" ? p.name_en : p.name_pl }),
      // Usunięcie kaskaduje: przypisania ekspertów ORAZ landing programu
      // (zespół, projekty, partnerzy, materiały) - ten sam wiersz `programs`.
      destructive: true,
    });
    if (!ok) return;
    if (!(await writeOrToast(supabase.from("programs").delete().eq("id", p.id)))) return;
    toast.success(t("expert.saved"));
    // Ten sam zestaw co przy zapisie: usunięty program znika też z filtra
    // katalogu ekspertów i z listy tagowania w edytorze wpisu.
    invalidateProgramReaders(qc);
  };

  const KIND_LABEL: Record<ProgramKind, string> = {
    program: tp("kind.program"),
    project: tp("kind.project"),
    department: tp("kind.department"),
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Briefcase className="h-5 w-5" />
            {t("admin.nav.programs")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{tp("subtitle")}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {tp("newProgram")}
        </Button>
      </div>

      {programsQ.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted/60" />
          ))}
        </div>
      ) : programsQ.isError ? (
        // Odmowa odczytu to nie „brak programów" - stan pusty kazałby redakcji
        // dodać program, który już istnieje (konflikt slugu).
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          {t("programs.loadError")}
        </p>
      ) : (programsQ.data ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {tp("empty")}
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
                    <span className="text-[10px] text-muted-foreground">({tp("inactive")})</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">/{p.slug}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setMembersFor(p)}>
                <Users className="mr-1 h-4 w-4" />
                {tp("members")}
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
            <DialogTitle>{editing ? tp("dialog.editTitle") : tp("dialog.newTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={field.id("slug")}>Slug</Label>
              <Input {...field.text("slug")} placeholder="np. bezpieczenstwo-europejskie" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={field.id("name_pl")}>{tp("dialog.namePl")}</Label>
                <Input {...field.text("name_pl")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={field.id("name_en")}>{tp("dialog.nameEn")}</Label>
                <Input {...field.text("name_en")} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={field.id("kind")}>{tp("dialog.kindLabel")}</Label>
                <Select {...field.choice("kind")}>
                  <SelectTrigger id={field.id("kind")}>
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
                <Label htmlFor={field.id("sort_order")}>{tp("dialog.order")}</Label>
                <Input type="number" {...field.number("sort_order")} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={field.id("description_pl")}>{tp("dialog.descPl")}</Label>
              <Textarea rows={2} {...field.text("description_pl")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={field.id("description_en")}>{tp("dialog.descEn")}</Label>
              <Textarea rows={2} {...field.text("description_en")} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch {...field.flag("is_active")} />
              {tp("dialog.active")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tp("dialog.cancel")}
            </Button>
            <Button onClick={() => void saveProgram()}>{tp("dialog.save")}</Button>
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
  const { t } = useTranslation();
  const tp = (k: string) => t(`adminPrograms.${k}`);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<MemberDraft>(EMPTY_MEMBER);
  const field = bindDraft(draft, setDraft, "pm");

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

  // Przypisanie eksperta zmienia DWIE powierzchnie publiczne: jego stronę
  // i katalog (filtr po programie) - dodanie i wypisanie unieważniają to samo.
  const invalidateMemberReaders = () => {
    void qc.invalidateQueries({ queryKey: ["admin-program-members", program.id] });
    void qc.invalidateQueries({ queryKey: ["public", "expert"] });
    void qc.invalidateQueries({ queryKey: ["public", "experts-directory"] });
  };

  const addMember = async () => {
    if (!draft.user_id) return;
    const request = supabase.from("program_members").insert({
      program_id: program.id,
      user_id: draft.user_id,
      role_pl: draft.role_pl.trim() || null,
      role_en: draft.role_en.trim() || null,
    });
    if (!(await writeOrToast(request))) return;
    setDraft(EMPTY_MEMBER);
    invalidateMemberReaders();
  };

  const removeMember = async (userId: string) => {
    const request = supabase
      .from("program_members")
      .delete()
      .eq("program_id", program.id)
      .eq("user_id", userId);
    if (!(await writeOrToast(request))) return;
    invalidateMemberReaders();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {lang === "en" ? program.name_en : program.name_pl} - {tp("membersDialog.title")}
          </DialogTitle>
        </DialogHeader>

        <ul className="grid gap-2">
          {(membersQ.data ?? []).length === 0 && (
            <li className="text-sm text-muted-foreground">{tp("membersDialog.empty")}</li>
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
                  {[m.role_pl, m.role_en].filter(Boolean).join(" / ") || "-"}
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
          <Label className="text-sm font-medium">{tp("membersDialog.addExpert")}</Label>
          <Select {...field.choice("user_id")}>
            <SelectTrigger>
              <SelectValue placeholder={tp("membersDialog.selectUser")} />
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
            <Input placeholder={tp("membersDialog.rolePl")} {...field.text("role_pl")} />
            <Input placeholder={tp("membersDialog.roleEn")} {...field.text("role_en")} />
          </div>
          <Button size="sm" disabled={!draft.user_id} onClick={() => void addMember()}>
            <Plus className="mr-1 h-4 w-4" />
            {tp("membersDialog.assign")}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tp("membersDialog.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
