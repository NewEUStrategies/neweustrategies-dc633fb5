// Admin CRM: unified lead inbox aggregating contact-form submissions and
// newsletter subscriptions. Shows consent history (form name, version, text),
// pipeline stages, notes, and multi-partner push controls (crm_webhook_endpoints
// over the integration_deliveries outbox). Saved views (saved_views, entity
// "lead") drive columns/filters/sort; the list is server-paginated with an
// exact total. Super Admins can switch to a cross-tenant view via the scope
// toggle.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listCrmLeads,
  getCrmLead,
  updateCrmLead,
  exportCrmLeadsCsv,
  getCrmLeadTimeline,
  exportCrmLeadTimelineCsv,
  bulkUpdateCrmLeads,
  bulkDeleteCrmLeads,
} from "@/lib/crm.functions";
import { dispatchIntegrationDeliveries } from "@/lib/integrations/dispatch.functions";
import { listSavedViews, upsertSavedView, deleteSavedView } from "@/lib/crm-saved-views.functions";
import { BulkActionBar } from "@/components/molecules/BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLeadNoteMutations, usePartnerPush } from "@/lib/crm/leadMutations";
import type { ConsentLogRow } from "@/lib/crm/consentLog";
import {
  buildLeadTimelineHtml,
  parseLeadTimelinePayload,
  type LeadTimelineEvent,
} from "@/lib/crm/leadTimeline";
import { useModuleRealtime } from "@/lib/realtime/useModuleRealtime";
import { LinkedItemsCard } from "@/components/molecules/LinkedItemsCard";
import { PresenceIndicator } from "@/components/molecules/PresenceIndicator";
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import { LeadScoreBadge } from "@/components/admin/crm/LeadScoreBadge";
import { ScoreBreakdownCard } from "@/components/admin/crm/ScoreBreakdownCard";
import { ScoringSettingsDialog } from "@/components/admin/crm/ScoringSettingsDialog";
import { FollowUpsPanel } from "@/components/admin/crm/FollowUpsPanel";
import { ImportLeadsCsvDialog } from "@/components/admin/crm/ImportLeadsCsvDialog";
import { LeadTasksPanel } from "@/components/admin/crm/LeadTasksPanel";
import { LeadViewTabs, type LeadSavedViewRow } from "@/components/admin/crm/LeadViewTabs";
import { LeadColumnManager } from "@/components/admin/crm/LeadColumnManager";
import { LeadFilterChips } from "@/components/admin/crm/LeadFilterChips";
import { CrmPartnerEndpointsPanel } from "@/components/admin/crm/CrmPartnerEndpointsPanel";
import { SCORE_BAND_LABELS, type ScoreBand } from "@/lib/crm/scoring";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Users,
  Download,
  Send,
  Search,
  FileText,
  ShieldCheck,
  Mail,
  Trash2,
  Plus,
} from "@/lib/lucide-shim";
import {
  RefreshCw,
  Tag as TagIcon,
  Clock,
  FileDown,
  Printer,
  Upload,
  AlarmClock,
  ArrowUpDown,
  ExternalLink,
  Users as UsersIcon,
} from "lucide-react";
import {
  BUILTIN_LEAD_VIEWS,
  DEFAULT_LEAD_VIEW_CONFIG,
  LEAD_COLUMNS,
  leadViewToServerParams,
  parseLeadViewConfig,
  type LeadColumnKey,
  type LeadFilter,
  type LeadSort,
  type LeadViewConfig,
} from "@/lib/crm/leadViews";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { FaceAwareAvatar } from "@/components/admin/crm/FaceAwareAvatar";

interface CrmSearch {
  /** Deep-link z notyfikacji/powiązań: /admin/crm?lead=<id>&task=<id>. */
  lead?: string;
  task?: string;
  /** Deep-link zapisanego widoku listy: /admin/crm?view=<builtin:...|uuid>. */
  view?: string;
}

export const Route = createFileRoute("/admin/crm/")({
  validateSearch: (search: Record<string, unknown>): CrmSearch => ({
    lead: typeof search.lead === "string" && search.lead.length > 0 ? search.lead : undefined,
    task: typeof search.task === "string" && search.task.length > 0 ? search.task : undefined,
    view:
      typeof search.view === "string" && search.view.length > 0 && search.view.length < 80
        ? search.view
        : undefined,
  }),
  head: () => ({ meta: [{ title: "CRM | Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminCrmPage,
});

type Stage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "archived";
const STAGES: Stage[] = ["new", "contacted", "qualified", "proposal", "won", "lost", "archived"];

type Lead = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  position?: string | null;
  company: string | null;
  country?: string | null;
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

type ConsentRow = ConsentLogRow;
type MsgRow = {
  id: string;
  form_type: string | null;
  form_name: string | null;
  subject: string | null;
  message: string;
  lang: string;
  page_url: string | null;
  created_at: string;
  consents: Record<string, unknown> | null;
  newsletter_opt_in: boolean | null;
};
type SubRow = {
  id: string;
  status: string;
  source: string | null;
  source_form_name: string | null;
  language: string;
  confirmed_at: string | null;
  created_at: string;
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
  subtitle: "Kontakty z formularzy kontaktowych i newslettera",
  search: "Szukaj po e-mailu, imieniu, firmie…",
  scopeTenant: "Mój tenant",
  scopeAll: "Wszystkie tenanty (super admin)",
  refresh: "Odśwież",
  export: "Eksport CSV",
  importCsv: "Import CSV",
  integrations: "Integracje",
  pipeline: "Pipeline",
  list: "Lista",
  empty: "Brak kontaktów dla wybranych filtrów.",
  stage: {
    new: "Nowy",
    contacted: "Skontaktowano",
    qualified: "Kwalifikowany",
    proposal: "Oferta",
    won: "Wygrana",
    lost: "Przegrana",
    archived: "Archiwum",
  } as Record<Stage, string>,
  detail: {
    title: "Karta kontaktu",
    overview: "Profil",
    tasks: "Zadania",
    consents: "Zgody",
    history: "Historia formularzy",
    notes: "Notatki",
    integ: "Integracje",
    timeline: "Oś czasu",
    firstName: "Imię",
    lastName: "Nazwisko",
    phone: "Telefon",
    company: "Firma",
    tags: "Tagi (oddziel przecinkiem)",
    save: "Zapisz",
    stage: "Etap pipeline",
    nlStatus: "Status newslettera",
    marketing: "Zgoda marketingowa",
    lastActivity: "Ostatnia aktywność",
    sources: "Liczba interakcji",
    consentEmpty: "Brak zarejestrowanych zgód.",
    consentVersion: "Wersja",
    consentForm: "Formularz",
    consentText: "Treść zgody",
    historyEmpty: "Brak zgłoszeń.",
    noteAdd: "Dodaj notatkę",
    notePlaceholder: "Notatka widoczna tylko dla zespołu…",
    noteSave: "Dodaj",
    noteEmpty: "Brak notatek.",
    noteDelete: "Usuń",
    push: "Wyślij do partnerów CRM",
    tlEmpty: "Brak zdarzeń na osi czasu.",
    tlExportCsv: "Eksport CSV",
    tlExportPdf: "Eksport PDF",
    tlTypes: {
      submit: "Zgłoszenie",
      consent: "Zgoda",
      note: "Notatka",
      stage_change: "Zmiana etapu",
      webhook: "Webhook",
      newsletter: "Newsletter",
    } as Record<string, string>,
  },
  integ: {
    docs: "Lead trafia do każdego aktywnego partnera CRM przez kolejkę z automatycznym retry. Webhook odbiera POST JSON z podpisem HMAC (X-Signature), API używa Bearer. Sekrety żyją w Vault.",
  },
};

const EN = {
  title: "CRM",
  subtitle: "Contacts from contact forms and newsletter",
  search: "Search by email, name, company…",
  scopeTenant: "My tenant",
  scopeAll: "All tenants (super admin)",
  refresh: "Refresh",
  export: "Export CSV",
  importCsv: "Import CSV",
  integrations: "Integrations",
  pipeline: "Pipeline",
  list: "List",
  empty: "No contacts for the selected filters.",
  stage: {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    proposal: "Proposal",
    won: "Won",
    lost: "Lost",
    archived: "Archived",
  } as Record<Stage, string>,
  detail: {
    title: "Contact card",
    overview: "Profile",
    tasks: "Tasks",
    consents: "Consents",
    history: "Form history",
    notes: "Notes",
    integ: "Integrations",
    timeline: "Timeline",
    firstName: "First name",
    lastName: "Last name",
    phone: "Phone",
    company: "Company",
    tags: "Tags (comma separated)",
    save: "Save",
    stage: "Pipeline stage",
    nlStatus: "Newsletter status",
    marketing: "Marketing consent",
    lastActivity: "Last activity",
    sources: "Interactions",
    consentEmpty: "No consents recorded.",
    consentVersion: "Version",
    consentForm: "Form",
    consentText: "Consent text",
    historyEmpty: "No submissions.",
    noteAdd: "Add note",
    notePlaceholder: "Note visible to the team only…",
    noteSave: "Add",
    noteEmpty: "No notes.",
    noteDelete: "Delete",
    push: "Send to CRM partners",
    tlEmpty: "No timeline events yet.",
    tlExportCsv: "Export CSV",
    tlExportPdf: "Export PDF",
    tlTypes: {
      submit: "Submission",
      consent: "Consent",
      note: "Note",
      stage_change: "Stage change",
      webhook: "Webhook",
      newsletter: "Newsletter",
    } as Record<string, string>,
  },
  integ: {
    docs: "Leads reach every active CRM partner through a queue with automatic retries. Webhooks receive POST JSON signed with HMAC (X-Signature), APIs use Bearer auth. Secrets live in Vault.",
  },
};

function AdminCrmPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = lang === "pl" ? PL : EN;
  const { isSuperAdmin } = useAuth();

  // Opportunistyczny tick dispatchera integracji (ta sama doktryna co
  // publish_due_posts): wejście staffu do CRM zdejmuje zaległe dostawy z
  // kolejki integration_deliveries. Best-effort - błąd nie psuje panelu.
  useEffect(() => {
    void dispatchIntegrationDeliveries({ data: { limit: 20 } }).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Users className="w-5 h-5 text-brand" />
        <div>
          <h1 className="text-xl font-semibold leading-tight">{L.title}</h1>
          <p className="text-[12px] text-muted-foreground">{L.subtitle}</p>
        </div>
      </header>
      <div className="flex items-center gap-1 border-b border-border/60">
        <span
          aria-current="page"
          className="rounded-t-[6px] border-b-2 border-brand px-3 py-2 text-[13px] font-semibold text-foreground"
        >
          {lang === "pl" ? "Kontakty" : "Contacts"}
        </span>
        <Link
          to="/admin/crm/funnel"
          className="rounded-t-[6px] px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          {lang === "pl" ? "Lejek marketingowy" : "Marketing funnel"}
        </Link>
      </div>
      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            {L.list}
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Send className="w-3.5 h-3.5 mr-1.5" />
            {L.integrations}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="leads" className="mt-3">
          <LeadsTab L={L} canSeeAll={isSuperAdmin} />
        </TabsContent>
        <TabsContent value="integrations" className="mt-3">
          <CrmPartnerEndpointsPanel lang={lang} stageLabels={L.stage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LeadsTab({ L, canSeeAll }: { L: typeof PL; canSeeAll: boolean }) {
  const urlSearch = Route.useSearch();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"tenant" | "all">("tenant");
  // Konfiguracja widoku (kolumny + filtry + sort) - ten sam kontrakt co
  // saved_views (entity "lead"), więc bieżący stan można zapisać jako widok.
  const [config, setConfig] = useState<LeadViewConfig>(DEFAULT_LEAD_VIEW_CONFIG);
  const [activeViewId, setActiveViewId] = useState<string>(urlSearch.view ?? "builtin:all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [openId, setOpenId] = useState<string | null>(urlSearch.lead ?? null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(urlSearch.task ?? null);
  const [importOpen, setImportOpen] = useState(false);
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null);
  // Zbiorcze zaznaczenie leadów (bulk edit / delete). Zestaw ID trzymamy w
  // stanie, żeby przetrwał refetch po mutacji (dopóki użytkownik nie wyczyści).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const lang: "pl" | "en" = L === PL ? "pl" : "en";

  // Deep-link z notyfikacji przypomnienia (/admin/crm?lead=…&task=…) otwiera
  // kartę leada na zakładce zadań - także przy nawigacji w już otwartej karcie.
  useEffect(() => {
    if (urlSearch.lead) {
      setOpenId(urlSearch.lead);
      setOpenTaskId(urlSearch.task ?? null);
    }
  }, [urlSearch.lead, urlSearch.task]);

  const closeDrawer = () => {
    setOpenId(null);
    setOpenTaskId(null);
    if (urlSearch.lead || urlSearch.task) {
      void navigate({
        to: "/admin/crm",
        search: (prev: CrmSearch) => ({ ...prev, lead: undefined, task: undefined }),
        replace: true,
      });
    }
  };

  // ---- Zapisane widoki (saved_views, entity "lead") ----------------------
  const savedQuery = useQuery({
    queryKey: ["admin", "saved-views", "lead"],
    queryFn: async () => {
      const res = await listSavedViews({ data: { entity: "lead" } });
      return JSON.parse((res as { json: string }).json) as LeadSavedViewRow[];
    },
    staleTime: 60_000,
  });
  const saved = useMemo(() => savedQuery.data ?? [], [savedQuery.data]);

  const setActive = (id: string, cfg: LeadViewConfig) => {
    setActiveViewId(id);
    setConfig(cfg);
    setPage(1);
    void navigate({
      to: "/admin/crm",
      search: (prev: CrmSearch) => ({ ...prev, view: id }),
      replace: true,
    });
  };

  // Podnieś aktywny widok z URL, jeśli udostępniony link zawiera zapisany id.
  useEffect(() => {
    if (!urlSearch.view) return;
    const builtin = BUILTIN_LEAD_VIEWS.find((v) => v.id === urlSearch.view);
    if (builtin) {
      setActiveViewId(builtin.id);
      setConfig(builtin.config);
      return;
    }
    const s = saved.find((v) => v.id === urlSearch.view);
    if (s) {
      setActiveViewId(s.id);
      setConfig(parseLeadViewConfig(s.config));
    }
  }, [urlSearch.view, saved]);

  const createView = useMutation({
    mutationFn: async ({ name, isShared }: { name: string; isShared: boolean }) =>
      upsertSavedView({ data: { entity: "lead", name, config, is_shared: isShared } }),
    onSuccess: async (res) => {
      toast.success(lang === "pl" ? "Widok zapisany" : "View saved");
      await qc.invalidateQueries({ queryKey: ["admin", "saved-views", "lead"] });
      const id = (res as { id: string | null }).id;
      if (id) setActiveViewId(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameView = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const v = saved.find((s) => s.id === id);
      if (!v) throw new Error("not_found");
      return upsertSavedView({
        data: { id, entity: "lead", name, config: v.config, is_shared: v.is_shared },
      });
    },
    onSuccess: async () => {
      toast.success(lang === "pl" ? "Nazwa zmieniona" : "Renamed");
      await qc.invalidateQueries({ queryKey: ["admin", "saved-views", "lead"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSharedView = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const v = saved.find((s) => s.id === id);
      if (!v) throw new Error("not_found");
      return upsertSavedView({
        data: { id, entity: "lead", name: v.name, config: v.config, is_shared: next },
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "saved-views", "lead"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeView = useMutation({
    mutationFn: async (id: string) => deleteSavedView({ data: { id } }),
    onSuccess: async () => {
      toast.success(lang === "pl" ? "Widok usunięty" : "View deleted");
      await qc.invalidateQueries({ queryKey: ["admin", "saved-views", "lead"] });
      setActive("builtin:all", DEFAULT_LEAD_VIEW_CONFIG);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Lista: filtry/sort liczone w SQL + paginacja z totalem -------------
  const serverParams = useMemo(() => leadViewToServerParams(config), [config]);

  // Zmiana filtrów/wyszukiwania/zakresu wraca na stronę 1 (okno paginacji
  // liczone od nowego zbioru).
  useEffect(() => {
    setPage(1);
  }, [search, scope, serverParams]);

  const q = useQuery({
    queryKey: ["crm-leads", { search, scope, serverParams, page, pageSize }],
    queryFn: async () => {
      const r = await listCrmLeads({
        data: {
          search: search || undefined,
          scope,
          page,
          limit: pageSize,
          ...serverParams,
        },
      });
      return {
        rows: JSON.parse((r as { json: string }).json) as Lead[],
        total: (r as { total: number }).total,
      };
    },
    placeholderData: (prev) => prev,
  });
  const total = q.data?.total ?? 0;

  // Realtime przez szynę zdarzeń domenowych: zamiast osobnego kanału na każdą
  // z 4 tabel źródłowych (leady, notatki, subskrybenci, formularz kontaktowy),
  // jeden strumień domain_events per agregat CRM; mapa inwalidacji
  // (eventInvalidationMap) odświeża listę i otwarty szczegół. Zapisy z
  // formularza kontaktowego przechodzą przez crm_upsert_lead, więc lądują na
  // szynie jako crm_lead.created/updated - nic nie ginie.
  useModuleRealtime("crm", { onEvent: () => setLastLiveAt(Date.now()) });

  const onExport = async () => {
    // Eksport dziedziczy KOMPLET aktywnych filtrów i sortowanie widoku -
    // plik odpowiada dokładnie temu, co admin widzi na liście (bez paginacji).
    const r = await exportCrmLeadsCsv({
      data: {
        search: search || undefined,
        scope,
        ...serverParams,
      },
    });
    const blob = new Blob([(r as { csv: string }).csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `crm-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const leads = useMemo(() => q.data?.rows ?? [], [q.data?.rows]);

  const setFilter = (f: LeadFilter) => setConfig((c) => ({ ...c, filter: f }));
  const setColumns = (cols: LeadColumnKey[]) => setConfig((c) => ({ ...c, columns: cols }));
  const toggleSort = (key: LeadSort["key"]) => {
    setConfig((c) => {
      if (c.sort.key === key) {
        return { ...c, sort: { key, dir: c.sort.dir === "asc" ? "desc" : "asc" } };
      }
      const dir: "asc" | "desc" =
        key === "name" || key === "company" || key === "country" ? "asc" : "desc";
      return { ...c, sort: { key, dir } };
    });
  };

  // Kraje do chipa filtra - z bieżącej strony wyników (jak na liście firm).
  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.country) set.add(l.country);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const visibleCols = LEAD_COLUMNS.filter((c) => config.columns.includes(c.key));

  // ---- Zbiorcze operacje na leadach --------------------------------------
  const bulkUpdate = useMutation({
    mutationFn: async (patch: {
      stage?: Stage;
      owner_id?: string | null;
      add_tags?: string[];
      remove_tags?: string[];
      marketing_consent?: boolean;
    }) => {
      const ids = Array.from(selected);
      return bulkUpdateCrmLeads({ data: { ids, ...patch } });
    },
    onSuccess: async () => {
      toast.success(lang === "pl" ? "Zapisano zmiany" : "Changes saved");
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["crm-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDelete = useMutation({
    mutationFn: async () => bulkDeleteCrmLeads({ data: { ids: Array.from(selected) } }),
    onSuccess: async () => {
      toast.success(lang === "pl" ? "Usunięto kontakty" : "Contacts deleted");
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["crm-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allChecked = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const toggleAll = () => {
    setSelected((prev) => {
      if (allChecked) return new Set();
      const s = new Set(prev);
      for (const l of leads) s.add(l.id);
      return s;
    });
  };
  const toggleOne = (id: string, next: boolean) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  };

  // Podciągamy avatar_url z profiles po e-mailu widocznych leadów, żeby w
  // tabeli CRM (osoby + firmy) od razu było widać zdjęcie profilowe.
  const leadEmails = useMemo(
    () =>
      Array.from(
        new Set(leads.map((l) => l.email?.toLowerCase().trim()).filter((e): e is string => !!e)),
      ),
    [leads],
  );
  const avatarsQ = useQuery({
    queryKey: ["crm-lead-avatars", leadEmails],
    enabled: leadEmails.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const map = new Map<string, string>();
      const chunkSize = 100;
      for (let i = 0; i < leadEmails.length; i += chunkSize) {
        const chunk = leadEmails.slice(i, i + chunkSize);
        const { data } = await supabase
          .from("profiles")
          .select("email, contact_email, avatar_url")
          .or(chunk.map((e) => `email.eq.${e},contact_email.eq.${e}`).join(","));
        for (const row of (data ?? []) as Array<{
          email: string | null;
          contact_email: string | null;
          avatar_url: string | null;
        }>) {
          if (!row.avatar_url) continue;
          const keys = [row.email, row.contact_email]
            .filter((e): e is string => !!e)
            .map((e) => e.toLowerCase().trim());
          for (const k of keys) if (!map.has(k)) map.set(k, row.avatar_url);
        }
      }
      return map;
    },
  });
  const avatarByEmail = avatarsQ.data ?? new Map<string, string>();

  return (
    <div className="space-y-3">
      <LeadViewTabs
        lang={lang}
        activeId={activeViewId}
        onSelect={setActive}
        saved={saved}
        currentConfig={config}
        onCreate={async (name, isShared) => {
          await createView.mutateAsync({ name, isShared });
        }}
        onRename={async (id, name) => {
          await renameView.mutateAsync({ id, name });
        }}
        onDelete={async (id) => {
          await removeView.mutateAsync(id);
        }}
        onToggleShared={async (id, next) => {
          await toggleSharedView.mutateAsync({ id, next });
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L.search}
            className="pl-8 h-8 text-[13px]"
          />
        </div>
        <LeadColumnManager lang={lang} active={config.columns} onChange={setColumns} />
        {canSeeAll && (
          <Select value={scope} onValueChange={(v) => setScope(v as "tenant" | "all")}>
            <SelectTrigger className="h-8 w-[210px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tenant">{L.scopeTenant}</SelectItem>
              <SelectItem value="all">{L.scopeAll}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && <ScoringSettingsDialog lang={lang} />}
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
            aria-live="polite"
            title={lastLiveAt ? new Date(lastLiveAt).toLocaleTimeString() : undefined}
          >
            <span
              className={
                "inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 " +
                (lastLiveAt && Date.now() - lastLiveAt < 2500 ? "animate-ping" : "")
              }
            />
            Live
          </span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            {L.refresh}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="w-3.5 h-3.5 mr-1" />
            {L.importCsv}
          </Button>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="w-3.5 h-3.5 mr-1" />
            {L.export}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const { data, error } = await supabase.rpc("crm_backfill_all_leads");
              if (error) {
                toast.error(error.message);
                return;
              }
              const row = Array.isArray(data) ? data[0] : data;
              toast.success(
                lang === "pl"
                  ? `Zsynchronizowano ${row?.profiles_synced ?? 0} użytkowników i ${row?.subscribers_synced ?? 0} subskrybentów`
                  : `Synced ${row?.profiles_synced ?? 0} users and ${row?.subscribers_synced ?? 0} subscribers`,
              );
              void q.refetch();
            }}
          >
            <UsersIcon className="w-3.5 h-3.5 mr-1" />
            {lang === "pl" ? "Synchronizuj z bazy" : "Sync from DB"}
          </Button>
        </div>
      </div>

      <LeadFilterChips
        lang={lang}
        value={config.filter}
        onChange={setFilter}
        stageLabels={L.stage}
        countries={countries}
      />

      <FollowUpsPanel
        lang={lang}
        onOpenLead={(leadId, taskId) => {
          setOpenId(leadId);
          setOpenTaskId(taskId);
        }}
      />

      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-2 w-8">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    aria-label={lang === "pl" ? "Zaznacz wszystkie" : "Select all"}
                  />
                </th>
                {visibleCols.map((c) => (
                  <th
                    key={c.key}
                    className={`p-2 ${c.align === "right" ? "text-right" : "text-left"}`}
                    style={c.minWidth ? { minWidth: c.minWidth } : undefined}
                  >
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key as LeadSort["key"])}
                        className={`inline-flex items-center gap-1 hover:text-foreground ${
                          config.sort.key === c.key ? "text-foreground" : ""
                        }`}
                      >
                        {lang === "pl" ? c.labelPl : c.labelEn}
                        <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden />
                      </button>
                    ) : lang === "pl" ? (
                      c.labelPl
                    ) : (
                      c.labelEn
                    )}
                  </th>
                ))}
                <th className="p-2 w-8" aria-label="" />
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleCols.length + 2}
                    className="p-4 text-center text-muted-foreground"
                  >
                    {L.empty}
                  </td>
                </tr>
              )}
              {leads.map((l) => (
                <tr
                  key={l.id}
                  data-selected={selected.has(l.id) || undefined}
                  className="border-t hover:bg-muted/40 cursor-pointer data-[selected=true]:bg-primary/5"
                  onClick={() => void navigate({ to: "/admin/crm/$id", params: { id: l.id } })}
                >
                  <td className="p-2 w-8" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(l.id)}
                      onCheckedChange={(v) => toggleOne(l.id, v === true)}
                      aria-label={l.email ?? l.id}
                    />
                  </td>
                  {visibleCols.map((c) => (
                    <LeadCell
                      key={c.key}
                      col={c.key}
                      lead={l}
                      lang={lang}
                      L={L}
                      avatarUrl={
                        c.key === "name"
                          ? avatarByEmail.get(l.email?.toLowerCase().trim() ?? "")
                          : undefined
                      }
                    />
                  ))}
                  <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setOpenId(l.id)}
                      className="inline-grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={lang === "pl" ? "Szybki podgląd" : "Quick preview"}
                      title={lang === "pl" ? "Szybki podgląd" : "Quick preview"}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AdminPagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={[25, 50, 100, 200]}
        />
      </div>

      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        lang={lang}
        itemLabel={{ pl: "kontaktów zaznaczonych", en: "contacts selected" }}
      >
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]">
              {lang === "pl" ? "Etap" : "Stage"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2" align="start">
            <div className="grid gap-0.5">
              {STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => bulkUpdate.mutate({ stage: s })}
                  className="flex items-center justify-between rounded px-2 py-1.5 text-left text-[12px] hover:bg-muted"
                >
                  <span>{L.stage[s]}</span>
                  <StageBadge stage={s} L={L} />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]">
              <TagIcon className="h-3 w-3" aria-hidden />
              {lang === "pl" ? "Tagi" : "Tags"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {lang === "pl"
                ? "Dodaj / usuń tagi (przecinkami)"
                : "Add / remove tags (comma separated)"}
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget as HTMLFormElement;
                const addRaw = (form.elements.namedItem("add") as HTMLInputElement).value;
                const rmRaw = (form.elements.namedItem("remove") as HTMLInputElement).value;
                const add_tags = addRaw
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                const remove_tags = rmRaw
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (add_tags.length === 0 && remove_tags.length === 0) return;
                bulkUpdate.mutate({ add_tags, remove_tags });
                form.reset();
              }}
              className="space-y-2"
            >
              <Input
                name="add"
                placeholder={lang === "pl" ? "Dodaj" : "Add"}
                className="h-8 text-[12px]"
              />
              <Input
                name="remove"
                placeholder={lang === "pl" ? "Usuń" : "Remove"}
                className="h-8 text-[12px]"
              />
              <Button type="submit" size="sm" className="h-7 w-full text-[11px]">
                {lang === "pl" ? "Zastosuj" : "Apply"}
              </Button>
            </form>
          </PopoverContent>
        </Popover>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => bulkUpdate.mutate({ marketing_consent: true })}
        >
          {lang === "pl" ? "Zgoda: TAK" : "Consent: YES"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => bulkUpdate.mutate({ marketing_consent: false })}
        >
          {lang === "pl" ? "Zgoda: NIE" : "Consent: NO"}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-destructive/40 text-[11px] text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              {lang === "pl" ? "Usuń" : "Delete"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {lang === "pl" ? "Usunąć zaznaczone kontakty?" : "Delete selected contacts?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {lang === "pl"
                  ? `Ta operacja jest nieodwracalna. Wybrane rekordy (${selected.size}) zostaną trwale usunięte.`
                  : `This cannot be undone. The selected records (${selected.size}) will be permanently deleted.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{lang === "pl" ? "Anuluj" : "Cancel"}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => bulkDelete.mutate()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {lang === "pl" ? "Usuń" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </BulkActionBar>

      <LeadDrawer leadId={openId} highlightTaskId={openTaskId} onClose={closeDrawer} L={L} />
      <ImportLeadsCsvDialog open={importOpen} onOpenChange={setImportOpen} lang={lang} />
    </div>
  );
}

/** Komórka tabeli leadów per klucz kolumny (LEAD_COLUMNS / saved views). */
function LeadCell({
  col,
  lead,
  lang,
  L,
  avatarUrl,
}: {
  col: LeadColumnKey;
  lead: Lead;
  lang: "pl" | "en";
  L: typeof PL;
  avatarUrl?: string;
}) {
  switch (col) {
    case "name": {
      const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email;
      const initials =
        (lead.first_name?.[0] ?? "") + (lead.last_name?.[0] ?? "") ||
        (lead.email?.[0] ?? "?").toUpperCase();
      return (
        <td className="p-2">
          <div className="flex items-center gap-2">
            <FaceAwareAvatar url={avatarUrl} name={name} initials={initials} />
            <div className="min-w-0">
              <div className="font-medium truncate">{name}</div>
              <div className="text-[11px] text-muted-foreground truncate">{lead.email}</div>
            </div>
          </div>
        </td>
      );
    }
    case "email":
      return <td className="p-2 text-[12px] truncate">{lead.email}</td>;
    case "phone":
      return <td className="p-2 text-[12px]">{lead.phone ?? "-"}</td>;
    case "position":
      return <td className="p-2 text-[12px]">{lead.position ?? "-"}</td>;
    case "company":
      return <td className="p-2 text-[12px]">{lead.company ?? "-"}</td>;
    case "country":
      return <td className="p-2 text-[12px]">{lead.country ?? "-"}</td>;
    case "stage":
      return (
        <td className="p-2">
          <StageBadge stage={lead.stage} L={L} />
        </td>
      );
    case "score":
      return (
        <td className="p-2 text-right">
          <LeadScoreBadge score={lead.score ?? 0} band={lead.score_band ?? "cold"} lang={lang} />
        </td>
      );
    case "band":
      return (
        <td className="p-2 text-[12px]">{SCORE_BAND_LABELS[lang][lead.score_band ?? "cold"]}</td>
      );
    case "source": {
      const source = lead.newsletter_status
        ? "newsletter"
        : (lead.source_count ?? 0) > 0
          ? lang === "pl"
            ? "formularz"
            : "form"
          : "import";
      return <td className="p-2 text-[12px] text-muted-foreground">{source}</td>;
    }
    case "tags":
      return (
        <td className="p-2">
          <div className="flex max-w-[220px] flex-wrap gap-1">
            {(lead.tags ?? []).slice(0, 4).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
            {(lead.tags?.length ?? 0) > 4 && (
              <span className="text-[10px] text-muted-foreground">
                +{(lead.tags?.length ?? 0) - 4}
              </span>
            )}
            {(lead.tags?.length ?? 0) === 0 && (
              <span className="text-[11px] text-muted-foreground">-</span>
            )}
          </div>
        </td>
      );
    case "consent":
      return (
        <td className="p-2">
          {lead.newsletter_status ? (
            <Badge variant="outline" className="text-[10px]">
              {lead.newsletter_status}
            </Badge>
          ) : lead.marketing_consent ? (
            <span className="text-[11px]">✓</span>
          ) : (
            <span className="text-muted-foreground text-[11px]">-</span>
          )}
        </td>
      );
    case "lastActivity":
      return (
        <td className="p-2 text-right text-[11px] text-muted-foreground">
          {new Date(lead.last_activity_at).toLocaleString()}
        </td>
      );
    case "created":
      return (
        <td className="p-2 text-right text-[11px] text-muted-foreground">
          {new Date(lead.created_at).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB")}
        </td>
      );
    case "followUp":
      return (
        <td className="p-2 text-right text-[11px] text-muted-foreground">
          {lead.follow_up_at
            ? new Date(lead.follow_up_at).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB")
            : "-"}
        </td>
      );
    default:
      return <td className="p-2" />;
  }
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
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${map[stage]}`}
    >
      {L.stage[stage]}
    </span>
  );
}

function LeadDrawer({
  leadId,
  highlightTaskId,
  onClose,
  L,
}: {
  leadId: string | null;
  highlightTaskId?: string | null;
  onClose: () => void;
  L: typeof PL;
}) {
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
    mutationFn: async (patch: Record<string, unknown>) =>
      updateCrmLead({ data: { id: leadId!, ...patch } as { id: string; stage?: Stage } }),
    onSuccess: () => {
      toast.success("✓");
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
      qc.invalidateQueries({ queryKey: ["crm-lead", leadId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [note, setNote] = useState("");
  // Wspólna warstwa logiki mutacji (współdzielona z pełną kartą /admin/crm/$id):
  // notatki (dodaj z idempotencją / usuń) + push Merydian. Drawer zachowuje
  // swoje zachowanie - dodanie notatki tu NIE toastuje, tylko czyści pole.
  const { addNote: noteMut, deleteNote: noteDelMut } = useLeadNoteMutations(leadId ?? "", {
    onAdded: () => setNote(""),
  });
  const pushMut = usePartnerPush(leadId ?? "", L === PL ? "pl" : "en");

  const lead = detail.data?.lead;

  return (
    <Sheet
      open={!!leadId}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full max-w-full p-0 sm:max-w-[560px] lg:max-w-[720px] xl:max-w-[820px]"
        aria-describedby={undefined}
      >
        <div className="flex h-full flex-col">
          {/* Sticky header */}
          <SheetHeader className="space-y-3 border-b p-4">
            {!lead ? (
              <SheetTitle className="text-sm text-muted-foreground">{L.detail.title}</SheetTitle>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  {(() => {
                    const inits =
                      (lead.first_name?.[0] ?? "") + (lead.last_name?.[0] ?? "") ||
                      (lead.email?.[0] ?? "?").toUpperCase();
                    return (
                      <Avatar className="h-11 w-11 shrink-0 rounded-full border border-border/60">
                        <AvatarFallback className="text-[12px] font-semibold bg-muted text-muted-foreground">
                          {inits.toUpperCase().slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                    );
                  })()}
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="truncate text-base font-semibold flex items-center gap-2">
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">
                        {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email}
                      </span>
                    </SheetTitle>
                    <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span className="truncate">{lead.email}</span>
                      <StageBadge stage={lead.stage} L={L} />
                      <LeadScoreBadge
                        score={lead.score ?? 0}
                        band={lead.score_band ?? "cold"}
                        lang={L === PL ? "pl" : "en"}
                      />
                    </SheetDescription>
                  </div>
                  <PresenceIndicator entityType="crm_lead" entityId={leadId} className="shrink-0" />
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-3 gap-2">
                  <Stat label={L.detail.nlStatus} value={lead.newsletter_status ?? "-"} />
                  <Stat label={L.detail.marketing} value={lead.marketing_consent ? "✓" : "-"} />
                  <Stat label={L.detail.sources} value={String(lead.source_count ?? 0)} />
                </div>
              </>
            )}
          </SheetHeader>

          {!lead ? (
            <div className="py-10 text-center text-muted-foreground text-sm">…</div>
          ) : (
            <Tabs
              key={lead.id}
              defaultValue={highlightTaskId ? "tasks" : "overview"}
              className="flex min-h-0 flex-1 flex-col"
            >
              {/* Sticky tabs (horizontal scroll, no wrap) */}
              <div className="border-b bg-background px-4 pt-3">
                <div className="-mx-4 overflow-x-auto">
                  <TabsList className="mx-4 inline-flex h-auto w-max flex-nowrap gap-1 rounded-md bg-muted/50 p-1">
                    <TabsTrigger value="overview" className="text-[12px] whitespace-nowrap">
                      {L.detail.overview}
                    </TabsTrigger>
                    <TabsTrigger value="tasks" className="text-[12px] whitespace-nowrap">
                      <AlarmClock className="w-3 h-3 mr-1" aria-hidden />
                      {L.detail.tasks}
                    </TabsTrigger>
                    <TabsTrigger value="timeline" className="text-[12px] whitespace-nowrap">
                      <Clock className="w-3 h-3 mr-1" aria-hidden />
                      {L.detail.timeline}
                    </TabsTrigger>
                    <TabsTrigger value="consents" className="text-[12px] whitespace-nowrap">
                      <ShieldCheck className="w-3 h-3 mr-1" aria-hidden />
                      {L.detail.consents}
                    </TabsTrigger>
                    <TabsTrigger value="history" className="text-[12px] whitespace-nowrap">
                      {L.detail.history}
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="text-[12px] whitespace-nowrap">
                      {L.detail.notes}
                    </TabsTrigger>
                    <TabsTrigger value="integ" className="text-[12px] whitespace-nowrap">
                      {L.detail.integ}
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="p-4">
                  <TabsContent value="tasks" className="mt-0">
                    <LeadTasksPanel
                      leadId={lead.id}
                      lang={L === PL ? "pl" : "en"}
                      highlightTaskId={highlightTaskId}
                    />
                  </TabsContent>
                  <TabsContent value="timeline" className="mt-0">
                    <LeadTimeline leadId={leadId!} L={L} />
                  </TabsContent>

                  <TabsContent value="overview" className="mt-0 space-y-4">
                    <OverviewForm
                      lead={lead}
                      L={L}
                      onSave={(p) => updateMut.mutate(p)}
                      saving={updateMut.isPending}
                    />
                    <div className="grid grid-cols-2 gap-2 text-[12px] pt-2 border-t">
                      <Stat
                        label={L.detail.lastActivity}
                        value={new Date(lead.last_activity_at).toLocaleString()}
                      />
                    </div>
                    <ScoreBreakdownCard
                      leadId={leadId!}
                      score={lead.score ?? 0}
                      band={lead.score_band ?? "cold"}
                      breakdown={lead.score_breakdown}
                      updatedAt={lead.score_updated_at ?? null}
                      lang={L === PL ? "pl" : "en"}
                    />
                    <LinkedItemsCard itemType="crm_lead" itemId={leadId} />
                  </TabsContent>

                  <TabsContent value="consents" className="mt-0 space-y-2">
                    {detail.data!.consents.length === 0 && (
                      <p className="text-[12px] text-muted-foreground">{L.detail.consentEmpty}</p>
                    )}
                    {detail.data!.consents.map((c) => (
                      <div key={c.id} className="rounded border p-2 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap text-[12px]">
                          <Badge variant={c.given ? "default" : "outline"} className="text-[10px]">
                            {c.consent_key}
                          </Badge>
                          {c.form_name && (
                            <span className="text-muted-foreground">
                              {L.detail.consentForm}: <b>{c.form_name}</b>
                            </span>
                          )}
                          {c.consent_version && (
                            <span className="text-muted-foreground">
                              {L.detail.consentVersion}: {c.consent_version}
                            </span>
                          )}
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {new Date(c.created_at).toLocaleString()}
                          </span>
                        </div>
                        {c.consent_text && (
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            <span className="font-medium">{L.detail.consentText}:</span>{" "}
                            {c.consent_text}
                          </p>
                        )}
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="history" className="mt-0 space-y-2">
                    {detail.data!.messages.length === 0 &&
                      detail.data!.subscriptions.length === 0 && (
                        <p className="text-[12px] text-muted-foreground">{L.detail.historyEmpty}</p>
                      )}
                    {detail.data!.messages.map((m) => (
                      <div key={m.id} className="rounded border p-2 text-[12px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Mail className="w-3 h-3" aria-hidden />
                          <b>{m.form_name ?? m.form_type ?? "contact"}</b>
                          {m.subject && (
                            <span className="text-muted-foreground">- {m.subject}</span>
                          )}
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {new Date(m.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-[12px]">
                          {m.message.slice(0, 400)}
                        </p>
                      </div>
                    ))}
                    {detail.data!.subscriptions.map((s) => (
                      <div key={s.id} className="rounded border p-2 text-[12px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Mail className="w-3 h-3" aria-hidden />
                          <b>newsletter</b>
                          <Badge variant="outline" className="text-[10px]">
                            {s.status}
                          </Badge>
                          {s.source_form_name && (
                            <span className="text-muted-foreground">- {s.source_form_name}</span>
                          )}
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {new Date(s.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="notes" className="mt-0 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-[12px]">{L.detail.noteAdd}</Label>
                      <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={L.detail.notePlaceholder}
                        rows={2}
                        className="text-[13px]"
                      />
                      <Button
                        size="sm"
                        disabled={!note.trim() || noteMut.isPending}
                        onClick={() => noteMut.mutate(note.trim())}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" aria-hidden />
                        {L.detail.noteSave}
                      </Button>
                    </div>
                    <div className="space-y-1 pt-1">
                      {detail.data!.notes.length === 0 && (
                        <p className="text-[12px] text-muted-foreground">{L.detail.noteEmpty}</p>
                      )}
                      {detail.data!.notes.map((n) => (
                        <div
                          key={n.id}
                          className="rounded border p-2 text-[12px] flex gap-2 items-start"
                        >
                          <p className="flex-1 whitespace-pre-wrap">{n.body}</p>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(n.created_at).toLocaleDateString()}
                            </span>
                            <button
                              onClick={() => noteDelMut.mutate(n.id)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={L.detail.noteDelete}
                            >
                              <Trash2 className="w-3 h-3" aria-hidden />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="integ" className="mt-0 space-y-2">
                    <p className="text-[12px] text-muted-foreground">{L.integ.docs}</p>
                    <Button size="sm" onClick={() => pushMut.mutate()} disabled={pushMut.isPending}>
                      <Send className="w-3.5 h-3.5 mr-1" aria-hidden />
                      {L.detail.push}
                    </Button>
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LeadTimeline({ leadId, L }: { leadId: string; L: typeof PL }) {
  const q = useQuery({
    queryKey: ["crm-lead-timeline", leadId],
    queryFn: async () => {
      const r = await getCrmLeadTimeline({ data: { id: leadId } });
      return parseLeadTimelinePayload((r as { json: string }).json);
    },
  });

  const downloadCsv = async () => {
    try {
      const r = await exportCrmLeadTimelineCsv({ data: { id: leadId } });
      const x = r as { csv: string; email: string };
      const blob = new Blob(["\uFEFF" + x.csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `crm-timeline-${x.email.replace(/[^a-z0-9._-]/gi, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const printPdf = () => {
    if (!q.data) return;
    const html = buildLeadTimelineHtml({
      lead: q.data.lead,
      events: q.data.events,
      typeLabels: L.detail.tlTypes,
    });
    const w = window.open("", "_blank", "width=900,height=900");
    if (!w) {
      toast.error("Popup blocked");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const ICONS: Record<LeadTimelineEvent["type"], string> = {
    submit: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
    consent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    note: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    stage_change: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    webhook: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
    newsletter: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={downloadCsv}
          disabled={!q.data || q.data.events.length === 0}
        >
          <FileDown className="w-3.5 h-3.5 mr-1" />
          {L.detail.tlExportCsv}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={printPdf}
          disabled={!q.data || q.data.events.length === 0}
        >
          <Printer className="w-3.5 h-3.5 mr-1" />
          {L.detail.tlExportPdf}
        </Button>
      </div>
      {!q.data ? (
        <p className="text-[12px] text-muted-foreground">…</p>
      ) : q.data.events.length === 0 ? (
        <p className="text-[12px] text-muted-foreground italic">{L.detail.tlEmpty}</p>
      ) : (
        <ol className="relative border-l border-border ml-2 space-y-3 pt-1">
          {q.data.events.map((e) => (
            <li key={e.id} className="ml-3">
              <span
                className={`absolute -left-[6px] mt-1.5 w-3 h-3 rounded-full ring-2 ring-background ${ICONS[e.type].split(" ")[0]}`}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-[10px] ${ICONS[e.type]}`}>
                  {L.detail.tlTypes[e.type] ?? e.type}
                </Badge>
                <span className="text-[12px] font-medium break-all">{e.title}</span>
                <time className="ml-auto text-[10px] text-muted-foreground">
                  {new Date(e.at).toLocaleString()}
                </time>
              </div>
              {e.detail && (
                <p className="mt-1 text-[12px] text-muted-foreground whitespace-pre-wrap leading-snug">
                  {e.detail}
                </p>
              )}
              {e.meta && Object.keys(e.meta).length > 0 && (
                <pre className="mt-1 text-[10px] text-muted-foreground bg-muted/40 rounded p-1.5 overflow-x-auto">
                  {JSON.stringify(e.meta)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
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
  lead,
  L,
  onSave,
  saving,
}: {
  lead: Lead;
  L: typeof PL;
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
      <Field label={L.detail.firstName}>
        <Input
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          className="h-8 text-[13px]"
        />
      </Field>
      <Field label={L.detail.lastName}>
        <Input value={last} onChange={(e) => setLast(e.target.value)} className="h-8 text-[13px]" />
      </Field>
      <Field label={L.detail.phone}>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="h-8 text-[13px]"
        />
      </Field>
      <Field label={L.detail.company}>
        <Input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="h-8 text-[13px]"
        />
      </Field>
      <Field label={L.detail.stage}>
        <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
          <SelectTrigger className="h-8 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {L.stage[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={L.detail.tags}>
        <div className="flex items-center gap-1">
          <TagIcon className="w-3 h-3 text-muted-foreground" />
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="h-8 text-[13px]"
          />
        </div>
      </Field>
      <div className="col-span-2 flex justify-end pt-1">
        <Button
          size="sm"
          disabled={saving}
          onClick={() =>
            onSave({
              first_name: first || null,
              last_name: last || null,
              phone: phone || null,
              company: company || null,
              stage,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
        >
          {L.detail.save}
        </Button>
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
