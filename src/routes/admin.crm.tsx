// Admin CRM: unified lead inbox aggregating contact-form submissions and
// newsletter subscriptions. Shows consent history (form name, version, text),
// pipeline stages, notes, and Merydian push controls. Super Admins can switch
// to a cross-tenant view via the scope toggle.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listCrmLeads, getCrmLead, updateCrmLead, addCrmNote, deleteCrmNote,
  exportCrmLeadsCsv, getCrmIntegrations, upsertCrmIntegrations, pushLeadToMerydian,
} from "@/lib/crm.functions";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Users, Download, Send, Search, FileText, ShieldCheck,
  Mail, Trash2, Plus,
} from "@/lib/lucide-shim";
import { RefreshCw, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/crm")({
  head: () => ({ meta: [{ title: "CRM | Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminCrmPage,
});

type Stage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "archived";
const STAGES: Stage[] = ["new","contacted","qualified","proposal","won","lost","archived"];

type Lead = {
  id: string; tenant_id: string; email: string;
  first_name: string | null; last_name: string | null;
  phone: string | null; company: string | null;
  stage: Stage; tags: string[] | null;
  marketing_consent: boolean;
  newsletter_status: string | null;
  source_count: number | null;
  follow_up_at: string | null;
  last_activity_at: string;
  created_at: string;
};

type ConsentRow = {
  id: string; email: string; form_id: string | null; form_name: string | null;
  consent_key: string; granted: boolean; version: string | null;
  text_excerpt: string | null; created_at: string; lang: string | null;
};
type MsgRow = {
  id: string; form_type: string | null; form_name: string | null;
  subject: string | null; message: string; lang: string;
  page_url: string | null; created_at: string;
  consents: Record<string, unknown> | null; newsletter_opt_in: boolean | null;
};
type SubRow = {
  id: string; status: string; source: string | null; source_form_name: string | null;
  language: string; confirmed_at: string | null; created_at: string;
  consents: Record<string, unknown> | null;
};
type NoteRow = { id: string; body: string; author_id: string | null; created_at: string };

type LeadDetail = {
  lead: Lead;
  messages: MsgRow[];
  subscriptions: SubRow[];
  consents: ConsentRow[];
  notes: NoteRow[];
};

const PL = {
  title: "CRM",
  subtitle: "Leady z formularzy kontaktowych i newslettera",
  search: "Szukaj po e-mailu, imieniu, firmie…",
  scopeTenant: "Mój tenant", scopeAll: "Wszystkie tenanty (super admin)",
  stageAll: "Wszystkie etapy",
  refresh: "Odśwież", export: "Eksport CSV", integrations: "Integracje",
  pipeline: "Pipeline", list: "Lista",
  cols: { who: "Osoba", contact: "Kontakt", company: "Firma", stage: "Etap", consent: "Newsletter", activity: "Aktywność" },
  empty: "Brak leadów dla wybranych filtrów.",
  stage: {
    new: "Nowy", contacted: "Skontaktowano", qualified: "Kwalifikowany",
    proposal: "Oferta", won: "Wygrana", lost: "Przegrana", archived: "Archiwum",
  } as Record<Stage,string>,
  detail: {
    title: "Karta leada", overview: "Profil", consents: "Zgody", history: "Historia formularzy", notes: "Notatki", integ: "Integracje",
    firstName: "Imię", lastName: "Nazwisko", phone: "Telefon", company: "Firma", tags: "Tagi (oddziel przecinkiem)",
    save: "Zapisz", stage: "Etap pipeline",
    nlStatus: "Status newslettera", marketing: "Zgoda marketingowa", lastActivity: "Ostatnia aktywność", sources: "Liczba interakcji",
    consentEmpty: "Brak zarejestrowanych zgód.",
    consentVersion: "Wersja", consentForm: "Formularz", consentText: "Treść zgody",
    historyEmpty: "Brak zgłoszeń.",
    noteAdd: "Dodaj notatkę", notePlaceholder: "Notatka widoczna tylko dla zespołu…",
    noteSave: "Dodaj", noteEmpty: "Brak notatek.", noteDelete: "Usuń",
    push: "Wyślij do Merydian",
  },
  integ: {
    title: "Integracja Merydian", enabled: "Włącz integrację",
    mode: "Tryb", modeWebhook: "Tylko webhook", modeApi: "Tylko API", modeBoth: "Webhook + API",
    webhookUrl: "Webhook URL", webhookSecret: "Sekret webhooka (HMAC SHA-256)",
    apiBase: "Bazowy URL API", apiKey: "Klucz API", workspaceId: "ID przestrzeni roboczej",
    forwardStages: "Etapy do automatycznej wysyłki",
    lastSync: "Ostatnia synchronizacja", save: "Zapisz konfigurację",
    docs: "Webhook odbiera POST JSON z nagłówkiem X-Signature (HMAC). API używa Bearer.",
  },
};

const EN = {
  title: "CRM",
  subtitle: "Leads from contact forms and newsletter",
  search: "Search by email, name, company…",
  scopeTenant: "My tenant", scopeAll: "All tenants (super admin)",
  stageAll: "All stages",
  refresh: "Refresh", export: "Export CSV", integrations: "Integrations",
  pipeline: "Pipeline", list: "List",
  cols: { who: "Person", contact: "Contact", company: "Company", stage: "Stage", consent: "Newsletter", activity: "Activity" },
  empty: "No leads for the selected filters.",
  stage: {
    new: "New", contacted: "Contacted", qualified: "Qualified",
    proposal: "Proposal", won: "Won", lost: "Lost", archived: "Archived",
  } as Record<Stage,string>,
  detail: {
    title: "Lead card", overview: "Profile", consents: "Consents", history: "Form history", notes: "Notes", integ: "Integrations",
    firstName: "First name", lastName: "Last name", phone: "Phone", company: "Company", tags: "Tags (comma separated)",
    save: "Save", stage: "Pipeline stage",
    nlStatus: "Newsletter status", marketing: "Marketing consent", lastActivity: "Last activity", sources: "Interactions",
    consentEmpty: "No consents recorded.",
    consentVersion: "Version", consentForm: "Form", consentText: "Consent text",
    historyEmpty: "No submissions.",
    noteAdd: "Add note", notePlaceholder: "Note visible to the team only…",
    noteSave: "Add", noteEmpty: "No notes.", noteDelete: "Delete",
    push: "Push to Merydian",
  },
  integ: {
    title: "Merydian integration", enabled: "Enable integration",
    mode: "Mode", modeWebhook: "Webhook only", modeApi: "API only", modeBoth: "Webhook + API",
    webhookUrl: "Webhook URL", webhookSecret: "Webhook secret (HMAC SHA-256)",
    apiBase: "API base URL", apiKey: "API key", workspaceId: "Workspace ID",
    forwardStages: "Auto-forward stages",
    lastSync: "Last sync", save: "Save configuration",
    docs: "Webhook receives POST JSON with X-Signature (HMAC) header. API uses Bearer auth.",
  },
};

function AdminCrmPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = lang === "pl" ? PL : EN;
  const { isSuperAdmin } = useAuth();

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <header className="flex items-center gap-2">
        <Users className="w-5 h-5 text-brand" />
        <div>
          <h1 className="text-xl font-semibold leading-tight">{L.title}</h1>
          <p className="text-[12px] text-muted-foreground">{L.subtitle}</p>
        </div>
      </header>
      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads"><FileText className="w-3.5 h-3.5 mr-1.5" />{L.list}</TabsTrigger>
          <TabsTrigger value="integrations"><Send className="w-3.5 h-3.5 mr-1.5" />{L.integrations}</TabsTrigger>
        </TabsList>
        <TabsContent value="leads" className="mt-3">
          <LeadsTab L={L} canSeeAll={isSuperAdmin} />
        </TabsContent>
        <TabsContent value="integrations" className="mt-3">
          <IntegrationsTab L={L} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LeadsTab({ L, canSeeAll }: { L: typeof PL; canSeeAll: boolean }) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<Stage | "all">("all");
  const [scope, setScope] = useState<"tenant" | "all">("tenant");
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["crm-leads", { search, stage, scope }],
    queryFn: async () => {
      const r = await listCrmLeads({ data: {
        search: search || undefined,
        stage: stage === "all" ? undefined : stage,
        scope, limit: 200,
      }});
      return JSON.parse((r as { json: string }).json) as Lead[];
    },
  });

  const onExport = async () => {
    const r = await exportCrmLeadsCsv({ data: { search: search || undefined, stage: stage === "all" ? undefined : stage, scope, limit: 500 }});
    const blob = new Blob([(r as { csv: string }).csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `crm-leads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const leads = q.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L.search} className="pl-7 h-8 text-[13px]" />
        </div>
        <Select value={stage} onValueChange={(v) => setStage(v as Stage | "all")}>
          <SelectTrigger className="h-8 w-[170px] text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{L.stageAll}</SelectItem>
            {STAGES.map((s) => <SelectItem key={s} value={s}>{L.stage[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        {canSeeAll && (
          <Select value={scope} onValueChange={(v) => setScope(v as "tenant" | "all")}>
            <SelectTrigger className="h-8 w-[210px] text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tenant">{L.scopeTenant}</SelectItem>
              <SelectItem value="all">{L.scopeAll}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()}><RefreshCw className="w-3.5 h-3.5 mr-1" />{L.refresh}</Button>
          <Button variant="outline" size="sm" onClick={onExport}><Download className="w-3.5 h-3.5 mr-1" />{L.export}</Button>
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left p-2">{L.cols.who}</th>
              <th className="text-left p-2 hidden md:table-cell">{L.cols.contact}</th>
              <th className="text-left p-2 hidden lg:table-cell">{L.cols.company}</th>
              <th className="text-left p-2">{L.cols.stage}</th>
              <th className="text-left p-2 hidden sm:table-cell">{L.cols.consent}</th>
              <th className="text-left p-2 hidden md:table-cell">{L.cols.activity}</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">{L.empty}</td></tr>
            )}
            {leads.map((l) => (
              <tr key={l.id} className="border-t hover:bg-muted/40 cursor-pointer" onClick={() => setOpenId(l.id)}>
                <td className="p-2">
                  <div className="font-medium">{[l.first_name, l.last_name].filter(Boolean).join(" ") || l.email}</div>
                  <div className="text-[11px] text-muted-foreground">{l.email}</div>
                </td>
                <td className="p-2 hidden md:table-cell text-[12px]">{l.phone ?? "—"}</td>
                <td className="p-2 hidden lg:table-cell text-[12px]">{l.company ?? "—"}</td>
                <td className="p-2"><StageBadge stage={l.stage} L={L} /></td>
                <td className="p-2 hidden sm:table-cell">
                  {l.newsletter_status
                    ? <Badge variant="outline" className="text-[10px]">{l.newsletter_status}</Badge>
                    : <span className="text-muted-foreground text-[11px]">—</span>}
                </td>
                <td className="p-2 hidden md:table-cell text-[11px] text-muted-foreground">
                  {new Date(l.last_activity_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <LeadDrawer leadId={openId} onClose={() => setOpenId(null)} L={L} />
    </div>
  );

  function lang() { return "pl"; }
}

function StageBadge({ stage, L }: { stage: Stage; L: typeof PL }) {
  const map: Record<Stage, string> = {
    new: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    contacted: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    qualified: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    proposal: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    won: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    lost: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    archived: "bg-muted text-muted-foreground",
  };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${map[stage]}`}>{L.stage[stage]}</span>;
}

function LeadDrawer({ leadId, onClose, L }: { leadId: string | null; onClose: () => void; L: typeof PL }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["crm-lead", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const r = await getCrmLead({ data: { id: leadId! } });
      return JSON.parse((r as { json: string }).json) as LeadDetail;
    },
  });

  const updateMut = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => updateCrmLead({ data: { id: leadId!, ...patch } as { id: string; stage?: Stage } }),
    onSuccess: () => {
      toast.success("✓");
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
      qc.invalidateQueries({ queryKey: ["crm-lead", leadId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const noteMut = useMutation({
    mutationFn: async (body: string) => addCrmNote({ data: { lead_id: leadId!, body } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-lead", leadId] });
      setNote("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const noteDelMut = useMutation({
    mutationFn: async (id: string) => deleteCrmNote({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-lead", leadId] }),
  });

  const pushMut = useMutation({
    mutationFn: async () => pushLeadToMerydian({ data: { lead_id: leadId! } }),
    onSuccess: (r: unknown) => {
      const x = r as { ok: boolean; error?: string; via?: string };
      x.ok ? toast.success(`Merydian: ${x.via}`) : toast.error(`Merydian: ${x.error}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [note, setNote] = useState("");
  const lead = detail.data?.lead;

  return (
    <Sheet open={!!leadId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            {lead ? ([lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email) : L.detail.title}
          </SheetTitle>
          <SheetDescription className="text-[12px]">{lead?.email}</SheetDescription>
        </SheetHeader>

        {!lead ? (
          <div className="py-10 text-center text-muted-foreground text-sm">…</div>
        ) : (
          <Tabs defaultValue="overview" className="mt-3">
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="overview" className="text-[12px]">{L.detail.overview}</TabsTrigger>
              <TabsTrigger value="consents" className="text-[12px]">
                <ShieldCheck className="w-3 h-3 mr-1" />{L.detail.consents}
              </TabsTrigger>
              <TabsTrigger value="history" className="text-[12px]">{L.detail.history}</TabsTrigger>
              <TabsTrigger value="notes" className="text-[12px]">{L.detail.notes}</TabsTrigger>
              <TabsTrigger value="integ" className="text-[12px]">{L.detail.integ}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-3 pt-3">
              <OverviewForm lead={lead} L={L} onSave={(p) => updateMut.mutate(p)} saving={updateMut.isPending} />
              <div className="grid grid-cols-2 gap-2 text-[12px] pt-2 border-t">
                <Stat label={L.detail.nlStatus} value={lead.newsletter_status ?? "—"} />
                <Stat label={L.detail.marketing} value={lead.marketing_consent ? "✓" : "—"} />
                <Stat label={L.detail.sources} value={String(lead.source_count ?? 0)} />
                <Stat label={L.detail.lastActivity} value={new Date(lead.last_activity_at).toLocaleString()} />
              </div>
            </TabsContent>

            <TabsContent value="consents" className="pt-3 space-y-2">
              {detail.data!.consents.length === 0 && <p className="text-[12px] text-muted-foreground">{L.detail.consentEmpty}</p>}
              {detail.data!.consents.map((c) => (
                <div key={c.id} className="rounded border p-2 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap text-[12px]">
                    <Badge variant={c.granted ? "default" : "outline"} className="text-[10px]">{c.consent_key}</Badge>
                    {c.form_name && <span className="text-muted-foreground">{L.detail.consentForm}: <b>{c.form_name}</b></span>}
                    {c.version && <span className="text-muted-foreground">{L.detail.consentVersion}: {c.version}</span>}
                    <span className="ml-auto text-[11px] text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  {c.text_excerpt && (
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      <span className="font-medium">{L.detail.consentText}:</span> {c.text_excerpt}
                    </p>
                  )}
                </div>
              ))}
            </TabsContent>

            <TabsContent value="history" className="pt-3 space-y-2">
              {detail.data!.messages.length === 0 && detail.data!.subscriptions.length === 0 && (
                <p className="text-[12px] text-muted-foreground">{L.detail.historyEmpty}</p>
              )}
              {detail.data!.messages.map((m) => (
                <div key={m.id} className="rounded border p-2 text-[12px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Mail className="w-3 h-3" />
                    <b>{m.form_name ?? m.form_type ?? "contact"}</b>
                    {m.subject && <span className="text-muted-foreground">— {m.subject}</span>}
                    <span className="ml-auto text-[11px] text-muted-foreground">{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[12px]">{m.message.slice(0, 400)}</p>
                </div>
              ))}
              {detail.data!.subscriptions.map((s) => (
                <div key={s.id} className="rounded border p-2 text-[12px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Mail className="w-3 h-3" />
                    <b>newsletter</b>
                    <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                    {s.source_form_name && <span className="text-muted-foreground">— {s.source_form_name}</span>}
                    <span className="ml-auto text-[11px] text-muted-foreground">{new Date(s.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="notes" className="pt-3 space-y-2">
              <div className="space-y-1">
                <Label className="text-[12px]">{L.detail.noteAdd}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={L.detail.notePlaceholder} rows={2} className="text-[13px]" />
                <Button size="sm" disabled={!note.trim() || noteMut.isPending} onClick={() => noteMut.mutate(note.trim())}>
                  <Plus className="w-3.5 h-3.5 mr-1" />{L.detail.noteSave}
                </Button>
              </div>
              <div className="space-y-1 pt-1">
                {detail.data!.notes.length === 0 && <p className="text-[12px] text-muted-foreground">{L.detail.noteEmpty}</p>}
                {detail.data!.notes.map((n) => (
                  <div key={n.id} className="rounded border p-2 text-[12px] flex gap-2 items-start">
                    <p className="flex-1 whitespace-pre-wrap">{n.body}</p>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleDateString()}</span>
                      <button onClick={() => noteDelMut.mutate(n.id)} className="text-muted-foreground hover:text-destructive" aria-label={L.detail.noteDelete}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="integ" className="pt-3 space-y-2">
              <p className="text-[12px] text-muted-foreground">{L.integ.docs}</p>
              <Button size="sm" onClick={() => pushMut.mutate()} disabled={pushMut.isPending}>
                <Send className="w-3.5 h-3.5 mr-1" />{L.detail.push}
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-[13px] font-medium">{value}</div>
    </div>
  );
}

function OverviewForm({
  lead, L, onSave, saving,
}: {
  lead: Lead; L: typeof PL;
  onSave: (p: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [first, setFirst] = useState(lead.first_name ?? "");
  const [last, setLast] = useState(lead.last_name ?? "");
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [company, setCompany] = useState(lead.company ?? "");
  const [stage, setStage] = useState<Stage>(lead.stage);
  const [tags, setTags] = useState((lead.tags ?? []).join(", "));

  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={L.detail.firstName}><Input value={first} onChange={(e) => setFirst(e.target.value)} className="h-8 text-[13px]" /></Field>
      <Field label={L.detail.lastName}><Input value={last} onChange={(e) => setLast(e.target.value)} className="h-8 text-[13px]" /></Field>
      <Field label={L.detail.phone}><Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-8 text-[13px]" /></Field>
      <Field label={L.detail.company}><Input value={company} onChange={(e) => setCompany(e.target.value)} className="h-8 text-[13px]" /></Field>
      <Field label={L.detail.stage}>
        <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
          <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => <SelectItem key={s} value={s}>{L.stage[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label={L.detail.tags}>
        <div className="flex items-center gap-1">
          <TagIcon className="w-3 h-3 text-muted-foreground" />
          <Input value={tags} onChange={(e) => setTags(e.target.value)} className="h-8 text-[13px]" />
        </div>
      </Field>
      <div className="col-span-2 flex justify-end pt-1">
        <Button size="sm" disabled={saving} onClick={() => onSave({
          first_name: first || null, last_name: last || null,
          phone: phone || null, company: company || null, stage,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        })}>{L.detail.save}</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

type IntegrationSettings = {
  merydian_enabled: boolean;
  merydian_mode: "webhook" | "api" | "both";
  merydian_webhook_url: string | null;
  merydian_webhook_secret: string | null;
  merydian_api_base: string | null;
  merydian_api_key: string | null;
  merydian_workspace_id: string | null;
  forward_stages: Stage[];
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
};

function IntegrationsTab({ L }: { L: typeof PL }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["crm-integrations"],
    queryFn: async () => {
      const r = await getCrmIntegrations();
      const parsed = JSON.parse((r as { json: string }).json);
      return parsed as IntegrationSettings | null;
    },
  });

  const [s, setS] = useState<IntegrationSettings | null>(null);
  useMemo(() => {
    if (q.data && !s) {
      setS({
        merydian_enabled: q.data.merydian_enabled ?? false,
        merydian_mode: q.data.merydian_mode ?? "webhook",
        merydian_webhook_url: q.data.merydian_webhook_url ?? "",
        merydian_webhook_secret: q.data.merydian_webhook_secret ?? "",
        merydian_api_base: q.data.merydian_api_base ?? "",
        merydian_api_key: q.data.merydian_api_key ?? "",
        merydian_workspace_id: q.data.merydian_workspace_id ?? "",
        forward_stages: q.data.forward_stages ?? ["new"],
        last_sync_at: q.data.last_sync_at, last_sync_status: q.data.last_sync_status, last_sync_error: q.data.last_sync_error,
      });
    } else if (!q.data && !s && !q.isLoading) {
      setS({
        merydian_enabled: false, merydian_mode: "webhook",
        merydian_webhook_url: "", merydian_webhook_secret: "",
        merydian_api_base: "", merydian_api_key: "", merydian_workspace_id: "",
        forward_stages: ["new"], last_sync_at: null, last_sync_status: null, last_sync_error: null,
      });
    }
  }, [q.data, q.isLoading, s]);

  const save = useMutation({
    mutationFn: async () => upsertCrmIntegrations({ data: {
      merydian_enabled: s!.merydian_enabled,
      merydian_mode: s!.merydian_mode,
      merydian_webhook_url: s!.merydian_webhook_url || null,
      merydian_webhook_secret: s!.merydian_webhook_secret || null,
      merydian_api_base: s!.merydian_api_base || null,
      merydian_api_key: s!.merydian_api_key || null,
      merydian_workspace_id: s!.merydian_workspace_id || null,
      forward_stages: s!.forward_stages,
    }}),
    onSuccess: () => { toast.success("✓"); qc.invalidateQueries({ queryKey: ["crm-integrations"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!s) return <div className="py-10 text-center text-muted-foreground text-sm">…</div>;

  const upd = <K extends keyof IntegrationSettings>(k: K, v: IntegrationSettings[K]) => setS({ ...s, [k]: v });
  const toggleStage = (st: Stage) => {
    upd("forward_stages", s.forward_stages.includes(st) ? s.forward_stages.filter((x) => x !== st) : [...s.forward_stages, st]);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-2 p-3 rounded-md border bg-card">
        <Switch checked={s.merydian_enabled} onCheckedChange={(v) => upd("merydian_enabled", v)} />
        <div className="flex-1">
          <h3 className="text-sm font-medium">{L.integ.title}</h3>
          <p className="text-[11px] text-muted-foreground">{L.integ.enabled}</p>
        </div>
        {s.last_sync_at && (
          <Badge variant={s.last_sync_status === "ok" ? "default" : "destructive"} className="text-[10px]">
            {L.integ.lastSync}: {new Date(s.last_sync_at).toLocaleString()}
          </Badge>
        )}
      </div>

      <Field label={L.integ.mode}>
        <Select value={s.merydian_mode} onValueChange={(v) => upd("merydian_mode", v as "webhook" | "api" | "both")}>
          <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="webhook">{L.integ.modeWebhook}</SelectItem>
            <SelectItem value="api">{L.integ.modeApi}</SelectItem>
            <SelectItem value="both">{L.integ.modeBoth}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {(s.merydian_mode === "webhook" || s.merydian_mode === "both") && (
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label={L.integ.webhookUrl}><Input value={s.merydian_webhook_url ?? ""} onChange={(e) => upd("merydian_webhook_url", e.target.value)} className="h-8 text-[13px]" placeholder="https://merydian.app/api/webhooks/…" /></Field>
          <Field label={L.integ.webhookSecret}><Input type="password" value={s.merydian_webhook_secret ?? ""} onChange={(e) => upd("merydian_webhook_secret", e.target.value)} className="h-8 text-[13px]" /></Field>
        </div>
      )}

      {(s.merydian_mode === "api" || s.merydian_mode === "both") && (
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label={L.integ.apiBase}><Input value={s.merydian_api_base ?? ""} onChange={(e) => upd("merydian_api_base", e.target.value)} className="h-8 text-[13px]" placeholder="https://merydian.app/api/v1" /></Field>
          <Field label={L.integ.apiKey}><Input type="password" value={s.merydian_api_key ?? ""} onChange={(e) => upd("merydian_api_key", e.target.value)} className="h-8 text-[13px]" /></Field>
          <Field label={L.integ.workspaceId}><Input value={s.merydian_workspace_id ?? ""} onChange={(e) => upd("merydian_workspace_id", e.target.value)} className="h-8 text-[13px]" /></Field>
        </div>
      )}

      <Field label={L.integ.forwardStages}>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((st) => (
            <button key={st} type="button" onClick={() => toggleStage(st)}
              className={`px-2 py-1 rounded-md text-[11px] border ${s.forward_stages.includes(st) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
              {L.stage[st]}
            </button>
          ))}
        </div>
      </Field>

      <p className="text-[11px] text-muted-foreground">{L.integ.docs}</p>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          <Send className="w-3.5 h-3.5 mr-1" />{L.integ.save}
        </Button>
      </div>
    </div>
  );
}
