// Admin: pełny widok pojedynczej osoby CRM w stylu HubSpot (3 kolumny):
//  - lewy rail: dane osoby (edycja inline), etap, score;
//  - główny obszar: zakładki Przegląd / Aktywność / Analityka;
//  - prawy sidebar: powiązana Firma, Zadania, Follow-up, Integracje.
// Widoczne dla staff (`requireStaff` w server-fn); RLS zawęża po tenancie.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  User,
  Save,
  Pencil,
  Mail,
  Phone,
  Building2,
  Briefcase,
  MapPin,
  Linkedin,
  Activity,
  BarChart3,
  StickyNote,
  Send,
  Copy,
  Calendar,
  ChevronRight,
  ShieldCheck,
  Tag,
} from "lucide-react";

import {
  getCrmLead,
  updateCrmLead,
  addCrmNote,
  deleteCrmNote,
  getCrmLeadTimeline,
  pushLeadToMerydian,
} from "@/lib/crm.functions";
import { newIdempotencyKey } from "@/lib/http/idempotency";
import { LeadScoreBadge } from "@/components/admin/crm/LeadScoreBadge";
import { ScoreBreakdownCard } from "@/components/admin/crm/ScoreBreakdownCard";
import { LeadTasksPanel } from "@/components/admin/crm/LeadTasksPanel";
import { ProfileSyncCard } from "@/components/admin/crm/ProfileSyncCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ScoreBand } from "@/lib/crm/scoring";

type Stage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "archived";

type Lead = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  position: string | null;
  company: string | null;
  company_id: string | null;
  country: string | null;
  linkedin_url: string | null;
  stage: Stage;
  tags: string[] | null;
  marketing_consent: boolean;
  newsletter_status: string | null;
  source_count: number | null;
  follow_up_at: string | null;
  last_activity_at: string;
  created_at: string;
  score: number;
  score_band: ScoreBand;
  score_breakdown: unknown;
  score_updated_at: string | null;
};
type NoteRow = { id: string; body: string; author_id: string | null; created_at: string };
type MsgRow = {
  id: string;
  form_type: string | null;
  form_name: string | null;
  subject: string | null;
  message: string;
  lang: string;
  page_url: string | null;
  created_at: string;
};
type SubRow = {
  id: string;
  status: string;
  source: string | null;
  source_form_name: string | null;
  language: string;
  confirmed_at: string | null;
  created_at: string;
};
type ConsentRow = {
  id: string;
  form_id: string | null;
  form_name: string | null;
  consent_key: string;
  granted: boolean;
  version: string | null;
  created_at: string;
};
type LeadDetail = {
  lead: Lead;
  messages: MsgRow[];
  subscriptions: SubRow[];
  consents: ConsentRow[];
  notes: NoteRow[];
  profile_avatar_url?: string | null;
};

const STAGE_STYLE: Record<Stage, string> = {
  new: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  contacted: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  qualified: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  proposal: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  won: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  lost: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  archived: "bg-muted text-muted-foreground",
};
const STAGES: Stage[] = ["new", "contacted", "qualified", "proposal", "won", "lost", "archived"];

export const Route = createFileRoute("/admin/crm/$id")({
  head: () => ({ meta: [{ title: "CRM: kontakt | Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminCrmDetailPage,
});

function AdminCrmDetailPage() {
  const { id } = Route.useParams();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["crm-lead", id],
    queryFn: async () => {
      const r = await getCrmLead({ data: { id } });
      return JSON.parse((r as { json: string }).json) as LeadDetail;
    },
  });
  const timelineQ = useQuery({
    queryKey: ["crm-lead-timeline", id],
    queryFn: async () => {
      const r = await getCrmLeadTimeline({ data: { id, limit: 200 } });
      return JSON.parse((r as { json: string }).json) as Array<{
        kind: string;
        at: string;
        title?: string;
        body?: string;
        meta?: Record<string, unknown>;
      }>;
    },
  });

  const updateMut = useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      updateCrmLead({ data: { id, ...patch } as { id: string; stage?: Stage } }),
    onSuccess: () => {
      toast.success(t("Zapisano", "Saved"));
      qc.invalidateQueries({ queryKey: ["crm-lead", id] });
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const noteMut = useMutation({
    mutationFn: async (body: string) =>
      addCrmNote({
        data: { lead_id: id, body, idempotency_key: newIdempotencyKey("crm.add_note") },
      }),
    onSuccess: () => {
      toast.success(t("Notatka dodana", "Note added"));
      setNoteDraft("");
      qc.invalidateQueries({ queryKey: ["crm-lead", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const noteDelMut = useMutation({
    mutationFn: async (nid: string) => deleteCrmNote({ data: { id: nid } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-lead", id] }),
  });

  const pushMut = useMutation({
    mutationFn: async () => pushLeadToMerydian({ data: { lead_id: id } }),
    onSuccess: (r: unknown) => {
      const x = r as { ok: boolean; error?: string; via?: string };
      if (x.ok) toast.success(`Merydian: ${x.via}`);
      else toast.error(`Merydian: ${x.error}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Lead>>({});
  const [noteDraft, setNoteDraft] = useState("");
  const [tab, setTab] = useState<"overview" | "activity" | "analytics">("overview");

  const lead = detail.data?.lead;
  const activity = timelineQ.data ?? [];

  const displayName = useMemo(() => {
    if (!lead) return "";
    return [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || lead.email;
  }, [lead]);
  const initials = useMemo(() => {
    if (!lead) return "?";
    const s = ((lead.first_name?.[0] ?? "") + (lead.last_name?.[0] ?? "")).toUpperCase();
    return s || (lead.email[0] ?? "?").toUpperCase();
  }, [lead]);

  const startEdit = () => {
    if (!lead) return;
    setForm({
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      position: lead.position,
      company: lead.company,
      country: lead.country,
      linkedin_url: lead.linkedin_url,
    });
    setEditing(true);
  };
  const saveEdit = () => {
    const patch: Record<string, unknown> = {};
    (["first_name", "last_name", "phone", "company", "position", "country", "linkedin_url"] as const).forEach((k) => {
      if (form[k] !== undefined && form[k] !== (lead ? lead[k] : undefined)) patch[k] = form[k] ?? null;
    });
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    updateMut.mutate(patch);
    setEditing(false);
  };

  const copyToClipboard = (v: string, label: string) => {
    void navigator.clipboard.writeText(v).then(() => toast.success(`${label} ✓`));
  };

  if (detail.isLoading) {
    return (
      <div className="p-6 text-[13px] text-muted-foreground">{t("Wczytywanie…", "Loading…")}</div>
    );
  }
  if (detail.isError || !lead) {
    return (
      <div className="p-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/admin/crm" })}
          className="mb-3 gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t("Wróć do listy", "Back to list")}
        </Button>
        <div className="rounded-md border p-4 text-[13px]">
          {t("Nie znaleziono kontaktu.", "Contact not found.")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/admin/crm" })}
          className="gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t("Kontakty", "Contacts")}
        </Button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium">{displayName}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-flex h-6 items-center rounded px-2 text-[11px] font-medium ${STAGE_STYLE[lead.stage]}`}>
            {lead.stage}
          </span>
          <LeadScoreBadge score={lead.score ?? 0} band={lead.score_band ?? "cold"} lang={lang} />
        </div>
      </div>

      {/* 3-column layout */}
      <div className="grid gap-3 lg:grid-cols-[280px_1fr_320px]">
        {/* Left rail */}
        <aside className="space-y-3">
          <section className="rounded-md border bg-card">
            <div className="flex items-center gap-3 p-4 pb-3">
              <FaceAwareAvatar
                url={detail.data?.profile_avatar_url ?? null}
                name={displayName}
                initials={initials}
                className="h-14 w-14"
                fallbackClassName="text-[15px] text-primary bg-primary/10"
              />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold leading-tight">{displayName}</div>
                <div className="truncate text-[11px] text-muted-foreground">{lead.position ?? t("Brak stanowiska", "No position")}</div>
              </div>
            </div>
            <div className="border-t px-4 py-3 space-y-2 text-[12px]">
              {editing ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label={t("Imię", "First")}>
                      <Input value={form.first_name ?? ""} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="h-7 text-[12px]" />
                    </Field>
                    <Field label={t("Nazwisko", "Last")}>
                      <Input value={form.last_name ?? ""} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="h-7 text-[12px]" />
                    </Field>
                  </div>
                  <Field label={t("Telefon", "Phone")}>
                    <Input value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="h-7 text-[12px]" />
                  </Field>
                  <Field label={t("Stanowisko", "Position")}>
                    <Input value={form.position ?? ""} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} className="h-7 text-[12px]" />
                  </Field>
                  <Field label={t("Firma", "Company")}>
                    <Input value={form.company ?? ""} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} className="h-7 text-[12px]" />
                  </Field>
                  <Field label={t("Kraj", "Country")}>
                    <Input value={form.country ?? ""} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} className="h-7 text-[12px]" />
                  </Field>
                  <Field label="LinkedIn URL">
                    <Input
                      type="url"
                      placeholder="https://linkedin.com/in/..."
                      value={form.linkedin_url ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))}
                      className="h-7 text-[12px]"
                    />
                  </Field>
                  <div className="flex justify-end gap-1.5 pt-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 text-[11px]">{t("Anuluj", "Cancel")}</Button>
                    <Button size="sm" onClick={saveEdit} disabled={updateMut.isPending} className="h-7 gap-1 text-[11px]">
                      <Save className="h-3 w-3" /> {t("Zapisz", "Save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <InfoRow icon={<Mail className="h-3.5 w-3.5" />} value={lead.email} onCopy={() => copyToClipboard(lead.email, "Email")} />
                  <InfoRow icon={<Phone className="h-3.5 w-3.5" />} value={lead.phone ?? "-"} onCopy={lead.phone ? () => copyToClipboard(lead.phone!, "Phone") : undefined} />
                  <InfoRow icon={<Briefcase className="h-3.5 w-3.5" />} value={lead.position ?? "-"} />
                  <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} value={lead.company ?? "-"} />
                  <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} value={lead.country ?? "-"} />
                  {lead.linkedin_url && (
                    <a href={lead.linkedin_url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 text-primary hover:underline">
                      <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                    </a>
                  )}
                  <div className="flex justify-end pt-1">
                    <Button size="sm" variant="outline" onClick={startEdit} className="h-7 gap-1 text-[11px]">
                      <Pencil className="h-3 w-3" /> {t("Edytuj", "Edit")}
                    </Button>
                  </div>
                </>
              )}
            </div>
            <div className="border-t px-4 py-3 space-y-2">
              <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("Etap", "Stage")}</Label>
              <Select value={lead.stage} onValueChange={(v) => updateMut.mutate({ stage: v as Stage })}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="border-t px-4 py-3 space-y-2">
              <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" /> {t("Tagi", "Tags")}
              </Label>
              <div className="flex flex-wrap gap-1">
                {(lead.tags ?? []).length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">{t("Brak tagów", "No tags")}</span>
                ) : (lead.tags ?? []).map((tg) => (
                  <Badge key={tg} variant="secondary" className="text-[10px]">{tg}</Badge>
                ))}
              </div>
            </div>
            <div className="border-t px-4 py-3 space-y-1 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                {t("Utworzono:", "Created:")} {new Date(lead.created_at).toLocaleDateString()}
              </div>
              <div className="flex items-center gap-1.5">
                <Activity className="h-3 w-3" />
                {t("Aktywność:", "Activity:")} {new Date(lead.last_activity_at).toLocaleDateString()}
              </div>
              {lead.marketing_consent && (
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-3 w-3" />
                  {t("Zgoda marketingowa", "Marketing consent")}
                </div>
              )}
            </div>
          </section>
        </aside>

        {/* Main tabs */}
        <main className="min-w-0 space-y-3">
          <div className="flex items-center gap-1 border-b">
            {[
              { id: "overview" as const, label: t("Przegląd", "Overview"), icon: User },
              { id: "activity" as const, label: t("Aktywność", "Activity"), icon: Activity },
              { id: "analytics" as const, label: t("Analityka", "Analytics"), icon: BarChart3 },
            ].map((it) => {
              const Icon = it.icon;
              const active = tab === it.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setTab(it.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {it.label}
                  {active && (<span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />)}
                </button>
              );
            })}
          </div>

          {tab === "overview" && (
            <div className="space-y-3">
              {/* Quick note */}
              <section className="rounded-md border bg-card p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-[12px] font-medium">
                  <StickyNote className="h-3.5 w-3.5 text-primary" />
                  {t("Notatka wewnętrzna", "Internal note")}
                </div>
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder={t("Napisz notatkę…", "Write a note…")}
                  className="min-h-[70px] text-[12px]"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!noteDraft.trim() || noteMut.isPending}
                    onClick={() => noteMut.mutate(noteDraft.trim())}
                    className="h-7 text-[11px]"
                  >
                    {t("Dodaj notatkę", "Add note")}
                  </Button>
                </div>
              </section>

              {/* Recent notes */}
              <section className="rounded-md border bg-card p-3 space-y-2">
                <div className="text-[12px] font-medium">{t("Ostatnie notatki", "Recent notes")}</div>
                {(detail.data?.notes ?? []).length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">{t("Brak notatek.", "No notes yet.")}</div>
                ) : (
                  <ul className="space-y-2">
                    {(detail.data?.notes ?? []).slice(0, 5).map((n) => (
                      <li key={n.id} className="rounded border p-2">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{new Date(n.created_at).toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={() => noteDelMut.mutate(n.id)}
                            className="text-destructive hover:underline"
                          >
                            {t("Usuń", "Delete")}
                          </button>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-[12px]">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Latest messages */}
              <section className="rounded-md border bg-card p-3 space-y-2">
                <div className="text-[12px] font-medium">{t("Wiadomości z formularzy", "Form messages")}</div>
                {(detail.data?.messages ?? []).length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">{t("Brak wiadomości.", "No messages.")}</div>
                ) : (
                  <ul className="space-y-2">
                    {(detail.data?.messages ?? []).slice(0, 6).map((m) => (
                      <li key={m.id} className="rounded border p-2 text-[12px]">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{m.form_name ?? m.form_type ?? "form"}</span>
                          <span>{new Date(m.created_at).toLocaleString()}</span>
                        </div>
                        {m.subject && <div className="mt-1 font-medium">{m.subject}</div>}
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{m.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {tab === "activity" && (
            <section className="rounded-md border bg-card p-3">
              <div className="mb-2 text-[12px] font-medium">{t("Oś czasu", "Timeline")}</div>
              {activity.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">{t("Brak zdarzeń.", "No events yet.")}</div>
              ) : (
                <ol className="space-y-2">
                  {activity.map((e, i) => (
                    <li key={i} className="flex gap-2 rounded border p-2">
                      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium">{e.title ?? e.kind}</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                        </div>
                        {e.body && <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">{e.body}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {tab === "analytics" && (
            <div className="space-y-3">
              <ScoreBreakdownCard
                leadId={lead.id}
                lang={lang}
                score={lead.score ?? 0}
                band={lead.score_band ?? "cold"}
                breakdown={lead.score_breakdown}
                updatedAt={lead.score_updated_at}
              />
              <section className="rounded-md border bg-card p-3">
                <div className="mb-2 text-[12px] font-medium">{t("Statystyki", "Stats")}</div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Stat label={t("Wiadomości", "Messages")} value={(detail.data?.messages ?? []).length} />
                  <Stat label={t("Subskrypcje", "Subs")} value={(detail.data?.subscriptions ?? []).length} />
                  <Stat label={t("Notatki", "Notes")} value={(detail.data?.notes ?? []).length} />
                </div>
              </section>
            </div>
          )}
        </main>

        {/* Right sidebar */}
        <aside className="space-y-3">
          {/* Related company */}
          <SidebarCard
            title={t("Firma", "Company")}
            icon={<Building2 className="h-3.5 w-3.5" />}
          >
            {lead.company_id ? (
              <Link
                to="/admin/companies/$id"
                params={{ id: lead.company_id }}
                className="flex items-center justify-between rounded border p-2 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium">{lead.company ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{t("Otwórz kartę firmy", "Open company")}</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ) : lead.company ? (
              <div className="rounded border p-2 text-[12px]">
                <div className="font-medium">{lead.company}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">{t("Nie powiązano z CRM firm", "Not linked to CRM company")}</div>
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">{t("Brak firmy.", "No company.")}</div>
            )}
          </SidebarCard>

          <SidebarCard
            title={t("Powiązany profil", "Linked profile")}
            icon={<User className="h-3.5 w-3.5" />}
          >
            <ProfileSyncCard leadId={lead.id} lang={lang} />
          </SidebarCard>


          <SidebarCard
            title={t("Zadania", "Tasks")}
            icon={<Calendar className="h-3.5 w-3.5" />}
          >
            <LeadTasksPanel leadId={lead.id} lang={lang} highlightTaskId={null} />
          </SidebarCard>

          <SidebarCard
            title={t("Integracje", "Integrations")}
            icon={<Send className="h-3.5 w-3.5" />}
          >
            <Button
              size="sm"
              variant="outline"
              disabled={pushMut.isPending}
              onClick={() => pushMut.mutate()}
              className="w-full h-8 gap-1 text-[12px]"
            >
              <Send className="h-3 w-3" />
              {t("Wyślij do Merydiana", "Send to Merydian")}
            </Button>
          </SidebarCard>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function InfoRow({
  icon,
  value,
  onCopy,
}: {
  icon: React.ReactNode;
  value: string;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Copy"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border py-2">
      <div className="text-[16px] font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function SidebarCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center gap-1.5 border-b px-3 py-2 text-[12px] font-medium">
        {icon}
        {title}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}
