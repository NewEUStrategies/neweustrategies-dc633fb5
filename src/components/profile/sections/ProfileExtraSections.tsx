import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Briefcase, GraduationCap, Wrench, Award, FileText, Heart, Sparkles,
  Plus, Trash2, ExternalLink, Download, Eye, Upload, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/* ------------------------------------------------------------------ */
/* Generic section card                                                */
/* ------------------------------------------------------------------ */

interface SectionCardProps {
  icon: ReactNode;
  title: string;
  empty?: string;
  action?: ReactNode;
  children?: ReactNode;
  isEmpty?: boolean;
}

function SectionCard({ icon, title, empty, action, children, isEmpty }: SectionCardProps) {
  return (
    <section className="rounded-[6px] border border-border bg-card p-4 sm:p-5">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span className="text-primary">{icon}</span>
          <span>{title}</span>
        </h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {isEmpty ? (
        <p className="text-sm italic text-muted-foreground">{empty}</p>
      ) : (
        children
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Data hooks (per-table)                                              */
/* ------------------------------------------------------------------ */

function useUserList<T>(
  table:
    | "profile_experiences"
    | "profile_education"
    | "profile_skills"
    | "profile_awards"
    | "profile_hobbies"
    | "profile_cv_files",
  orderCol: string,
  ascending: boolean,
  userId: string | undefined,
) {
  return useQuery({
    queryKey: [table, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("user_id", userId!)
        .order(orderCol, { ascending });
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Tiny add-form scaffold                                              */
/* ------------------------------------------------------------------ */

function AddToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      className="h-7 px-2 text-xs"
    >
      <Plus className={`mr-1 h-3.5 w-3.5 transition-transform ${open ? "rotate-45" : ""}`} />
      {label}
    </Button>
  );
}

function DeleteBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Experience                                                          */
/* ------------------------------------------------------------------ */

type Experience = {
  id: string;
  role_title: string;
  company: string | null;
  location: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
};

export function ExperienceSection({ userId, tenantId, editable }: { userId: string; tenantId: string; editable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useUserList<Experience>("profile_experiences", "sort_order", true, userId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    role_title: "", company: "", description: "", start_date: "", end_date: "", is_current: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["profile_experiences", userId] });

  async function add() {
    if (!form.role_title.trim()) return;
    const { error } = await supabase.from("profile_experiences").insert({
      user_id: userId,
      tenant_id: tenantId,
      role_title: form.role_title.trim(),
      company: form.company.trim() || null,
      description: form.description.trim() || null,
      start_date: form.start_date || null,
      end_date: form.is_current ? null : (form.end_date || null),
      is_current: form.is_current,
    });
    if (error) return toast.error(error.message);
    toast.success(t("profile.actions.saved"));
    setForm({ role_title: "", company: "", description: "", start_date: "", end_date: "", is_current: false });
    setOpen(false);
    invalidate();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("profile_experiences").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }

  const items = q.data ?? [];
  const isEmpty = !q.isLoading && items.length === 0 && !open;

  return (
    <SectionCard
      icon={<Briefcase className="h-4 w-4" />}
      title={t("profile.sections.experience")}
      empty={t("profile.sections.experienceEmpty")}
      isEmpty={isEmpty}
      action={editable ? <AddToggle open={open} onClick={() => setOpen((v) => !v)} label={t("profile.forms.addExperience")} /> : undefined}
    >
      <ul className="space-y-3">
        {items.map((e) => (
          <li key={e.id} className="flex items-start gap-3 rounded border border-border/60 bg-background/40 p-3">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-muted">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{e.role_title}</p>
              {e.company ? <p className="truncate text-xs text-muted-foreground">{e.company}</p> : null}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatRange(e.start_date, e.is_current ? null : e.end_date, e.is_current, t)}
              </p>
              {e.description ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/80">{e.description}</p>
              ) : null}
            </div>
            {editable ? <DeleteBtn onClick={() => remove(e.id)} label={t("profile.actions.remove")} /> : null}
          </li>
        ))}
      </ul>
      {open ? (
        <div className="mt-3 space-y-2 rounded border border-dashed border-border bg-background/40 p-3">
          <MiniField label={t("profile.forms.roleTitle")} value={form.role_title} onChange={(v) => setForm({ ...form, role_title: v })} />
          <MiniField label={t("profile.forms.company")} value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
          <div className="grid grid-cols-2 gap-2">
            <MiniField type="date" label={t("profile.forms.startDate")} value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} />
            <MiniField type="date" label={t("profile.forms.endDate")} value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} disabled={form.is_current} />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.is_current} onChange={(e) => setForm({ ...form, is_current: e.target.checked })} />
            {t("profile.forms.current")}
          </label>
          <MiniArea label={t("profile.forms.description")} value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7 px-2 text-xs">{t("profile.actions.cancel")}</Button>
            <Button type="button" size="sm" onClick={add} className="h-7 px-3 text-xs">{t("profile.actions.save")}</Button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Education                                                           */
/* ------------------------------------------------------------------ */

type Education = {
  id: string; school: string; degree: string | null; field: string | null;
  start_date: string | null; end_date: string | null; description: string | null;
};

export function EducationSection({ userId, tenantId, editable }: { userId: string; tenantId: string; editable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useUserList<Education>("profile_education", "sort_order", true, userId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ school: "", degree: "", field: "", start_date: "", end_date: "" });
  const items = q.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["profile_education", userId] });

  async function add() {
    if (!form.school.trim()) return;
    const { error } = await supabase.from("profile_education").insert({
      user_id: userId, tenant_id: tenantId,
      school: form.school.trim(),
      degree: form.degree.trim() || null,
      field: form.field.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    });
    if (error) return toast.error(error.message);
    setOpen(false);
    setForm({ school: "", degree: "", field: "", start_date: "", end_date: "" });
    invalidate();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("profile_education").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }

  return (
    <SectionCard
      icon={<GraduationCap className="h-4 w-4" />}
      title={t("profile.sections.education")}
      empty={t("profile.sections.educationEmpty")}
      isEmpty={!q.isLoading && items.length === 0 && !open}
      action={editable ? <AddToggle open={open} onClick={() => setOpen((v) => !v)} label={t("profile.forms.addEducation")} /> : undefined}
    >
      <ul className="space-y-3">
        {items.map((e) => (
          <li key={e.id} className="flex items-start gap-3 rounded border border-border/60 bg-background/40 p-3">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-muted">
              <GraduationCap className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{e.school}</p>
              {(e.degree || e.field) ? (
                <p className="truncate text-xs text-muted-foreground">{[e.degree, e.field].filter(Boolean).join(" · ")}</p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-muted-foreground">{formatRange(e.start_date, e.end_date, false, t)}</p>
            </div>
            {editable ? <DeleteBtn onClick={() => remove(e.id)} label={t("profile.actions.remove")} /> : null}
          </li>
        ))}
      </ul>
      {open ? (
        <div className="mt-3 space-y-2 rounded border border-dashed border-border bg-background/40 p-3">
          <MiniField label={t("profile.forms.school")} value={form.school} onChange={(v) => setForm({ ...form, school: v })} />
          <div className="grid grid-cols-2 gap-2">
            <MiniField label={t("profile.forms.degree")} value={form.degree} onChange={(v) => setForm({ ...form, degree: v })} />
            <MiniField label={t("profile.forms.field")} value={form.field} onChange={(v) => setForm({ ...form, field: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniField type="date" label={t("profile.forms.startDate")} value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} />
            <MiniField type="date" label={t("profile.forms.endDate")} value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7 px-2 text-xs">{t("profile.actions.cancel")}</Button>
            <Button size="sm" onClick={add} className="h-7 px-3 text-xs">{t("profile.actions.save")}</Button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Skills (chips)                                                      */
/* ------------------------------------------------------------------ */

type Skill = { id: string; label: string; level: number; category: string | null };

export function SkillsSection({ userId, tenantId, editable }: { userId: string; tenantId: string; editable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useUserList<Skill>("profile_skills", "sort_order", true, userId);
  const [value, setValue] = useState("");
  const items = q.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["profile_skills", userId] });

  async function add() {
    const label = value.trim();
    if (!label) return;
    const { error } = await supabase.from("profile_skills").insert({
      user_id: userId, tenant_id: tenantId, label, level: 3,
    });
    if (error) return toast.error(error.message);
    setValue("");
    invalidate();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("profile_skills").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }

  return (
    <SectionCard
      icon={<Wrench className="h-4 w-4" />}
      title={t("profile.sections.skills")}
      empty={t("profile.sections.skillsEmpty")}
      isEmpty={!q.isLoading && items.length === 0 && !editable}
    >
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5 rounded-[6px] border border-border bg-muted/60 px-2 py-1 text-xs">
            {s.label}
            {editable ? (
              <button type="button" onClick={() => remove(s.id)} aria-label={t("profile.actions.remove")} className="rounded text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {editable ? (
        <div className="mt-3 flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
            placeholder={t("profile.forms.addSkill")}
            className="h-8 text-xs"
          />
          <Button size="sm" onClick={add} className="h-8 px-3 text-xs"><Plus className="mr-1 h-3.5 w-3.5" />{t("profile.actions.add")}</Button>
        </div>
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Awards                                                              */
/* ------------------------------------------------------------------ */

type Award = {
  id: string; title: string; issuer: string | null; awarded_at: string | null;
  description: string | null; kind: string; url: string | null;
};

export function AwardsSection({ userId, tenantId, editable, kind }: { userId: string; tenantId: string; editable: boolean; kind: "award" | "recognition" | "mention" }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useUserList<Award>("profile_awards", "sort_order", true, userId);
  const items = (q.data ?? []).filter((a) => a.kind === kind);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", issuer: "", awarded_at: "", description: "", url: "" });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["profile_awards", userId] });

  async function add() {
    if (!form.title.trim()) return;
    const { error } = await supabase.from("profile_awards").insert({
      user_id: userId, tenant_id: tenantId, kind,
      title: form.title.trim(),
      issuer: form.issuer.trim() || null,
      awarded_at: form.awarded_at || null,
      description: form.description.trim() || null,
      url: form.url.trim() || null,
    });
    if (error) return toast.error(error.message);
    setOpen(false);
    setForm({ title: "", issuer: "", awarded_at: "", description: "", url: "" });
    invalidate();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("profile_awards").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }

  const title = kind === "award" ? t("profile.sections.awards") : kind === "recognition" ? t("profile.sections.recognitions") : t("profile.sections.mentions");
  const empty = kind === "award" ? t("profile.sections.awardsEmpty") : kind === "recognition" ? t("profile.sections.recognitionsEmpty") : t("profile.sections.mentionsEmpty");

  return (
    <SectionCard
      icon={<Award className="h-4 w-4" />}
      title={title}
      empty={empty}
      isEmpty={!q.isLoading && items.length === 0 && !open}
      action={editable ? <AddToggle open={open} onClick={() => setOpen((v) => !v)} label={t("profile.forms.addAward")} /> : undefined}
    >
      <ul className="space-y-3">
        {items.map((a) => (
          <li key={a.id} className="flex items-start gap-3 rounded border border-border/60 bg-background/40 p-3">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-muted">
              <Award className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{a.title}</p>
              {a.issuer ? <p className="truncate text-xs text-muted-foreground">{a.issuer}</p> : null}
              {a.awarded_at ? <p className="text-[11px] text-muted-foreground">{a.awarded_at}</p> : null}
              {a.description ? <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/80">{a.description}</p> : null}
              {a.url ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" /> {a.url}
                </a>
              ) : null}
            </div>
            {editable ? <DeleteBtn onClick={() => remove(a.id)} label={t("profile.actions.remove")} /> : null}
          </li>
        ))}
      </ul>
      {open ? (
        <div className="mt-3 space-y-2 rounded border border-dashed border-border bg-background/40 p-3">
          <MiniField label={t("profile.forms.title")} value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <MiniField label={t("profile.forms.issuer")} value={form.issuer} onChange={(v) => setForm({ ...form, issuer: v })} />
          <div className="grid grid-cols-2 gap-2">
            <MiniField type="date" label={t("profile.forms.awardedAt")} value={form.awarded_at} onChange={(v) => setForm({ ...form, awarded_at: v })} />
            <MiniField label={t("profile.forms.url")} value={form.url} onChange={(v) => setForm({ ...form, url: v })} />
          </div>
          <MiniArea label={t("profile.forms.description")} value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7 px-2 text-xs">{t("profile.actions.cancel")}</Button>
            <Button size="sm" onClick={add} className="h-7 px-3 text-xs">{t("profile.actions.save")}</Button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* CV                                                                  */
/* ------------------------------------------------------------------ */

type CvFile = {
  id: string; file_name: string; file_url: string; mime_type: string | null;
  size_bytes: number; version: number; is_current: boolean; uploaded_at: string;
};

export function CvSection({ userId, tenantId, editable }: { userId: string; tenantId: string; editable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useUserList<CvFile>("profile_cv_files", "uploaded_at", false, userId);
  const [uploading, setUploading] = useState(false);
  const items = q.data ?? [];
  const current = items.find((f) => f.is_current) ?? items[0];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["profile_cv_files", userId] });

  async function onUpload(file: File) {
    if (file.size > 10 * 1024 * 1024) return toast.error("Max 10MB");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const path = `${tenantId}/users/${userId}/cv-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, file, {
        upsert: true, contentType: file.type || "application/pdf",
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      // unset previous current
      await supabase.from("profile_cv_files").update({ is_current: false }).eq("user_id", userId).eq("is_current", true);
      const nextVersion = (items[0]?.version ?? 0) + 1;
      const { error: insErr } = await supabase.from("profile_cv_files").insert({
        user_id: userId, tenant_id: tenantId,
        file_name: file.name, file_url: pub.publicUrl, mime_type: file.type || null,
        size_bytes: file.size, version: nextVersion, is_current: true,
      });
      if (insErr) throw insErr;
      toast.success(t("profile.actions.saved"));
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("profile_cv_files").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }

  async function markCurrent(id: string) {
    await supabase.from("profile_cv_files").update({ is_current: false }).eq("user_id", userId).eq("is_current", true);
    await supabase.from("profile_cv_files").update({ is_current: true }).eq("id", id);
    invalidate();
  }

  return (
    <SectionCard
      icon={<FileText className="h-4 w-4" />}
      title={t("profile.sections.cv")}
      action={editable ? (
        <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[6px] border border-border bg-card px-2 text-xs hover:bg-muted">
          <Upload className="h-3.5 w-3.5" />
          {uploading ? t("profile.actions.uploading") : t("profile.sections.cvUpload")}
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
      ) : undefined}
    >
      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 bg-background/40 p-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm">{current.file_name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a href={current.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-border px-2 text-xs hover:bg-muted">
              <Eye className="h-3.5 w-3.5" /> {t("profile.sections.cvPreview")}
            </a>
            <a href={current.file_url} download={current.file_name} className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-border px-2 text-xs hover:bg-muted">
              <Download className="h-3.5 w-3.5" /> {t("profile.sections.cvDownload")}
            </a>
            {editable ? (
              <button type="button" onClick={() => remove(current.id)} className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-border px-2 text-xs text-destructive hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5" /> {t("profile.sections.cvDelete")}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">{t("profile.sections.cvEmpty")}</p>
      )}

      {items.length > 1 ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("profile.sections.cvHistory")}
          </p>
          <ul className="space-y-1.5">
            {items.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded border border-border/40 bg-background/30 p-2 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.file_name}</span>
                  {f.is_current ? (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                      {t("profile.sections.cvCurrent")}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  v{f.version} · {formatBytes(f.size_bytes)}
                  {editable && !f.is_current ? (
                    <button type="button" onClick={() => markCurrent(f.id)} aria-label={t("profile.sidebar.retakeTest")} className="rounded p-1 hover:bg-muted">
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  ) : null}
                  {editable ? <DeleteBtn onClick={() => remove(f.id)} label={t("profile.actions.remove")} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Personality (sidebar)                                               */
/* ------------------------------------------------------------------ */

type PersonalityRow = {
  openness: number; conscientiousness: number; extraversion: number;
  agreeableness: number; neuroticism: number; taken_at: string;
};

const AXIS_COLOR: Record<string, string> = {
  openness: "bg-violet-500",
  conscientiousness: "bg-sky-500",
  extraversion: "bg-emerald-500",
  agreeableness: "bg-amber-500",
  neuroticism: "bg-rose-500",
};

export function PersonalityCard({ userId, editable }: { userId: string; editable: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["personality_results", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personality_results")
        .select("openness,conscientiousness,extraversion,agreeableness,neuroticism,taken_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as PersonalityRow | null) ?? null;
    },
  });

  return (
    <SectionCard
      icon={<Sparkles className="h-4 w-4" />}
      title={t("profile.sidebar.personality")}
      action={
        editable ? (
          <Link to="/profile/personality" className="text-xs text-primary hover:underline">
            {q.data ? t("profile.sidebar.retakeTest") : t("profile.sidebar.takeTest")}
          </Link>
        ) : undefined
      }
    >
      {q.data ? (
        <div className="space-y-2.5">
          {(["openness","conscientiousness","extraversion","agreeableness","neuroticism"] as const).map((axis) => {
            const value = q.data![axis] ?? 0;
            const [low, high] = t(`profile.personality.lowHigh.${axis}`, { returnObjects: true }) as [string, string];
            return (
              <div key={axis}>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{low}</span>
                  <span className="font-medium">{high}</span>
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${AXIS_COLOR[axis]} transition-all`} style={{ width: `${value}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("profile.sidebar.testNote")}</p>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Hobbies                                                             */
/* ------------------------------------------------------------------ */

type Hobby = { id: string; label: string; icon: string | null };

export function HobbiesCard({ userId, tenantId, editable }: { userId: string; tenantId: string; editable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useUserList<Hobby>("profile_hobbies", "sort_order", true, userId);
  const [value, setValue] = useState("");
  const items = q.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["profile_hobbies", userId] });

  async function add() {
    const label = value.trim();
    if (!label) return;
    const { error } = await supabase.from("profile_hobbies").insert({
      user_id: userId, tenant_id: tenantId, label,
    });
    if (error) return toast.error(error.message);
    setValue("");
    invalidate();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("profile_hobbies").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }

  return (
    <SectionCard
      icon={<Heart className="h-4 w-4" />}
      title={t("profile.sidebar.hobbies")}
    >
      <div className="flex flex-wrap gap-1.5">
        {items.map((h) => (
          <span key={h.id} className="inline-flex items-center gap-1.5 rounded-[6px] border border-border bg-muted/60 px-2 py-1 text-xs">
            {h.label}
            {editable ? (
              <button type="button" onClick={() => remove(h.id)} aria-label={t("profile.actions.remove")} className="rounded text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        {!items.length ? <span className="text-xs italic text-muted-foreground">{t("profile.actions.empty")}</span> : null}
      </div>
      {editable ? (
        <div className="mt-3 flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
            placeholder={t("profile.forms.addHobby")}
            className="h-8 text-xs"
          />
          <Button size="sm" onClick={add} className="h-8 px-3 text-xs"><Plus className="mr-1 h-3.5 w-3.5" /></Button>
        </div>
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

export interface ProfileExtraSectionsProps {
  userId: string;
  tenantId: string;
  editable: boolean;
}

/** Two-column extra sections: left = experience/edu/skills/awards/cv, right = sticky meta. */
export function ProfileExtraSections({ userId, tenantId, editable }: ProfileExtraSectionsProps) {
  if (!userId || !tenantId) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <ExperienceSection userId={userId} tenantId={tenantId} editable={editable} />
        <EducationSection userId={userId} tenantId={tenantId} editable={editable} />
        <SkillsSection userId={userId} tenantId={tenantId} editable={editable} />
        <AwardsSection userId={userId} tenantId={tenantId} editable={editable} kind="award" />
        <AwardsSection userId={userId} tenantId={tenantId} editable={editable} kind="recognition" />
        <AwardsSection userId={userId} tenantId={tenantId} editable={editable} kind="mention" />
        <CvSection userId={userId} tenantId={tenantId} editable={editable} />
      </div>
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <PersonalityCard userId={userId} editable={editable} />
        <HobbiesCard userId={userId} tenantId={tenantId} editable={editable} />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mini form helpers                                                   */
/* ------------------------------------------------------------------ */

function MiniField({
  label, value, onChange, type = "text", disabled,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-7 text-xs" />
    </div>
  );
}

function MiniArea({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="text-xs" />
    </div>
  );
}

function formatRange(start: string | null, end: string | null, isCurrent: boolean, t: (k: string) => string): string {
  const s = start ? new Date(start).toLocaleDateString(undefined, { year: "numeric", month: "short" }) : "";
  const e = isCurrent ? t("profile.forms.datePresent") : (end ? new Date(end).toLocaleDateString(undefined, { year: "numeric", month: "short" }) : "");
  if (!s && !e) return "";
  return `${s}${s && e ? " – " : ""}${e}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/* Re-exports for tests */
export { formatBytes, formatRange };
