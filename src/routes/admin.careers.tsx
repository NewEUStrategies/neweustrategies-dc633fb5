// Admin "Rekrutacja": skrzynka zgłoszeń ze strony /zatrudniamy.
// Zgłoszenia trafiają do `contact_messages` (form_id = "careers") razem z
// polami rekrutacyjnymi w kolumnie `custom`, a równolegle są synchronizowane
// do CRM (`crm_upsert_from_form`) - tutaj pokazujemy status tej synchronizacji
// i link do karty leada.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  BriefcaseBusiness,
  Check,
  ExternalLink,
  FileText,
  Mail,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signCvUrl } from "@/lib/careers/cvUpload";
import {
  CAREERS_FORM_ID,
  CAREER_STAGES,
  CAREER_STAGE_STYLE,
  asCustomRecord,
  departmentLabel,
  isCareerCvPath,
  normalizeCvUrl,
  parseRecruitmentPipeline,
  seniorityLabel,
  stageLabel,
  startLabel,
  type CareerAdminLang,
  type CareerStage,
  type RecruitmentMessageRow,
  type RecruitmentPipeline,
} from "@/lib/careers/recruitmentLayer";

export const Route = createFileRoute("/admin/careers")({
  head: () => ({
    meta: [{ title: "Rekrutacja | Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminCareersPage,
});

interface CareersDict {
  title: string;
  subtitle: string;
  filter: { open: string; all: string; archived: string };
  search: string;
  empty: string;
  pickOne: string;
  role: string;
  department: string;
  seniority: string;
  start: string;
  linkedin: string;
  message: string;
  crm: string;
  crmSynced: string;
  crmMissing: string;
  crmOpen: string;
  reply: string;
  markRead: string;
  archive: string;
  unarchive: string;
  archived: string;
  none: string;
  cv: string;
  cvOpen: string;
  cvMissing: string;
  cvError: string;
  cvPurged: string;
  stage: string;
  stageSaved: string;
  stageNote: string;
  stageNotePh: string;
  rating: string;
  ratingClear: string;
  rejectionReason: string;
  nextStep: string;
  history: string;
  historyEmpty: string;
  noPipeline: string;
  remove: string;
  removeConfirm: string;
  removed: string;
  stageFilterAll: string;
  stageFilterOpen: string;
  stageFilterClosed: string;
}

const PL: CareersDict = {
  title: "Rekrutacja",
  subtitle: "Zgłoszenia ze strony „Dołącz do zespołu” (/zatrudniamy).",
  filter: { open: "Nowe", all: "Wszystkie", archived: "Archiwum" },
  search: "Szukaj: imię, e-mail, rola…",
  empty: "Brak zgłoszeń.",
  pickOne: "Wybierz zgłoszenie z listy.",
  role: "Rola",
  department: "Dział",
  seniority: "Poziom",
  start: "Dostępność",
  linkedin: "LinkedIn",
  message: "Wiadomość",
  crm: "CRM",
  crmSynced: "Zsynchronizowano z CRM",
  crmMissing: "Brak leada w CRM",
  crmOpen: "Otwórz w CRM",
  reply: "Odpowiedz",
  markRead: "Oznacz jako przeczytane",
  archive: "Archiwizuj",
  unarchive: "Przywróć",
  archived: "Zarchiwizowano",
  cv: "CV",
  cvOpen: "Otwórz CV",
  cvMissing: "Brak CV",
  cvError: "Nie udało się wygenerować linku do CV.",
  cvPurged: "CV usunięte (retencja)",
  stage: "Etap procesu",
  stageSaved: "Etap zmieniony.",
  stageNote: "Notatka do zmiany etapu",
  stageNotePh: "Dlaczego ta decyzja? Trafi do dziennika…",
  rating: "Ocena",
  ratingClear: "Bez oceny",
  rejectionReason: "Powód odrzucenia",
  nextStep: "Następny krok",
  history: "Dziennik decyzji",
  historyEmpty: "Brak zmian etapu.",
  noPipeline: "Brak wiersza procesu dla tego zgłoszenia.",
  remove: "Usuń zgłoszenie",
  removeConfirm: "Usunąć zgłoszenie wraz z CV i historią procesu? Tego nie da się cofnąć.",
  removed: "Zgłoszenie usunięte. Plik CV trafił do kolejki usunięć.",
  stageFilterAll: "Wszystkie etapy",
  stageFilterOpen: "W toku",
  stageFilterClosed: "Domknięte",
  none: "-",
};

const EN: CareersDict = {
  title: "Recruitment",
  subtitle: "Applications from the “Join the team” page (/zatrudniamy).",
  filter: { open: "New", all: "All", archived: "Archive" },
  search: "Search: name, e-mail, role…",
  empty: "No applications.",
  pickOne: "Pick an application from the list.",
  role: "Role",
  department: "Department",
  seniority: "Seniority",
  start: "Availability",
  linkedin: "LinkedIn",
  message: "Message",
  crm: "CRM",
  crmSynced: "Synced with CRM",
  crmMissing: "No CRM lead",
  crmOpen: "Open in CRM",
  reply: "Reply",
  markRead: "Mark as read",
  archive: "Archive",
  unarchive: "Restore",
  archived: "Archived",
  cv: "CV",
  cvOpen: "Open CV",
  cvMissing: "No CV",
  cvError: "Could not generate the CV link.",
  cvPurged: "CV deleted (retention)",
  stage: "Pipeline stage",
  stageSaved: "Stage changed.",
  stageNote: "Note for this stage change",
  stageNotePh: "Why this decision? Goes into the log…",
  rating: "Rating",
  ratingClear: "No rating",
  rejectionReason: "Rejection reason",
  nextStep: "Next step",
  history: "Decision log",
  historyEmpty: "No stage changes yet.",
  noPipeline: "No pipeline row for this application.",
  remove: "Delete application",
  removeConfirm:
    "Delete the application together with its CV and pipeline history? This cannot be undone.",
  removed: "Application deleted. Its CV was queued for removal.",
  stageFilterAll: "All stages",
  stageFilterOpen: "In progress",
  stageFilterClosed: "Closed",
  none: "-",
};

interface CareerApplication {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  lang: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  custom: Record<string, string>;
  /** Warstwa procesu z `career_applications` (trigger zakłada ją przy wpływie). */
  pipeline: RecruitmentPipeline | null;
}

/** Wpis z dziennika decyzji (`career_application_events`). */
interface StageEvent {
  id: string;
  from_stage: string | null;
  to_stage: string;
  note: string;
  created_at: string;
}

/**
 * CV kandydata: plik z prywatnego bucketu `career-cv` (podpisany link ważny
 * 5 minut) albo zewnętrzny link podany w formularzu.
 */
function CvAccess({
  custom,
  labels,
}: {
  custom: Record<string, string>;
  labels: Pick<CareersDict, "cv" | "cvOpen" | "cvMissing" | "cvError" | "cvPurged">;
}) {
  const [busy, setBusy] = useState(false);
  // Ścieżka pliku jest sanityzowana już przy zapisie, ale zgłoszenia sprzed tej
  // zmiany mogą mieć w bazie dowolny string - podpisujemy tylko znany kształt.
  const path = isCareerCvPath(custom.cv_path) ? custom.cv_path : "";
  // Link bez schematu ("linkedin.com/in/x") w <a href> jest URL-em RELATYWNYM
  // i prowadziłby wewnątrz panelu admina.
  const url = normalizeCvUrl(custom.cv_url) ?? "";
  const fileName = custom.cv_file_name ?? "";

  if (!path && !url) {
    // Retencja zdejmuje `cv_path` i zostawia `cv_purged_at`. Bez tego
    // rozróżnienia operator widziałby "Brak CV" i szukałby błędu w formularzu,
    // a plik został skasowany zgodnie z polityką.
    const purged = (custom.cv_purged_at ?? "").trim();
    return (
      <span className="text-xs text-muted-foreground">
        {labels.cv}: {purged ? `${labels.cvPurged} · ${purged}` : labels.cvMissing}
      </span>
    );
  }

  if (path) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const signed = await signCvUrl(path);
          setBusy(false);
          if (!signed) {
            toast.error(labels.cvError);
            return;
          }
          window.open(signed, "_blank", "noopener,noreferrer");
        }}
      >
        <FileText className="mr-1.5 h-3.5 w-3.5" />
        {fileName || labels.cvOpen}
      </Button>
    );
  }

  return (
    <Button size="sm" variant="outline" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <FileText className="mr-1.5 h-3.5 w-3.5" />
        {labels.cvOpen}
      </a>
    </Button>
  );
}

function AdminCareersPage() {
  const { i18n } = useTranslation();
  const adminLang: CareerAdminLang = i18n.language === "en" ? "en" : "pl";
  const L = adminLang === "en" ? EN : PL;
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"open" | "all" | "archived">("open");
  const [stageFilter, setStageFilter] = useState<"all" | "open" | "closed" | CareerStage>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const {
    data: rows = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-career-applications", filter],
    queryFn: async () => {
      // Join na `career_applications` daje etap procesu w jednym zapytaniu -
      // wiersz zaklada trigger przy wplywie zgloszenia, wiec relacja jest 1:1.
      let qb = supabase
        .from("contact_messages")
        // Lista kolumn MUSI byc jednym literalem - supabase-js parsuje ja na
        // poziomie typow, a konkatenacja daje `string` i cofa wynik do
        // GenericStringError (embed przestaje sie typowac).
        .select(
          "id,name,email,phone,subject,message,lang,created_at,read_at,archived_at,custom,career_applications(id,stage,stage_changed_at,stage_note,rating,rejection_reason,next_step_at,owner_id)",
        )
        .eq("form_id", CAREERS_FORM_ID)
        .order("created_at", { ascending: false })
        .limit(500);
      if (filter === "open") qb = qb.is("archived_at", null);
      else if (filter === "archived") qb = qb.not("archived_at", "is", null);
      const { data, error } = await qb;
      if (error) throw error;
      return (data ?? []).map((row) => {
        const raw = row as { custom: unknown; career_applications?: unknown };
        return {
          ...row,
          custom: asCustomRecord(raw.custom),
          pipeline: parseRecruitmentPipeline(
            raw.career_applications as RecruitmentMessageRow["career_applications"],
          ),
        };
      }) as CareerApplication[];
    },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byStage = rows.filter((r) => {
      const stage = r.pipeline?.stage;
      if (stageFilter === "all") return true;
      if (stageFilter === "open") return !r.pipeline || !r.pipeline.closed;
      if (stageFilter === "closed") return Boolean(r.pipeline?.closed);
      return stage === stageFilter;
    });
    if (!needle) return byStage;
    return byStage.filter((r) =>
      [
        r.name,
        r.email,
        r.subject ?? "",
        r.message,
        r.custom.role_label ?? "",
        r.custom.department ?? "",
        r.custom.seniority ?? "",
        r.custom.linkedin ?? "",
        r.custom.cv_file_name ?? "",
      ].some((v) => v.toLowerCase().includes(needle)),
    );
  }, [rows, q, stageFilter]);

  const current = filtered.find((r) => r.id === selected) ?? null;

  const { data: lead } = useQuery({
    queryKey: ["admin-career-lead", current?.email ?? ""],
    enabled: Boolean(current?.email),
    queryFn: async () => {
      // Dopasowanie MUSI iść po `email_norm`: `crm_leads.email` przechowuje
      // adres tak, jak go wpisał kandydat, więc porównanie zlowercase'owanego
      // wejścia z tą kolumną nie trafiało w nikogo, kto użył wielkiej litery -
      // panel pokazywał „Brak leada w CRM" i ukrywał przycisk „Otwórz w CRM"
      // mimo poprawnie zsynchronizowanego kontaktu.
      //
      // `limit(1)` zamiast `maybeSingle()`: super admin widzi leady wielu
      // tenantów, a ten sam adres może istnieć w każdym z nich - `maybeSingle`
      // rzucało wtedy błędem zamiast pokazać kartę.
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id,stage,updated_at")
        .eq("email_norm", (current?.email ?? "").trim().toLowerCase())
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const patch = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Record<string, unknown> }) => {
      const { error } = await supabase
        .from("contact_messages")
        .update(values as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-career-applications"] });
      // Zgłoszenia rekrutacyjne widać także w Contact Center (ta sama tabela,
      // bez filtra po `form_id`). Bez tej inwalidacji „przeczytane"/„archiwum"
      // rozjeżdżało się między dwiema skrzynkami do końca sesji.
      qc.invalidateQueries({ queryKey: ["admin-contact-messages"] });
    },
  });

  useEffect(() => {
    if (current && !current.read_at) {
      patch.mutate({
        id: current.id,
        values: { read_at: new Date().toISOString(), status: "read" },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Notatka jest szkicem PER ZGLOSZENIE - bez resetu opis decyzji o jednym
  // kandydacie wjechalby do dziennika nastepnego.
  useEffect(() => {
    setNoteDraft("");
  }, [current?.id]);

  /** Dziennik decyzji - tabela jest read-only dla klienta, wpisy robi trigger. */
  const { data: events = [] } = useQuery({
    queryKey: ["admin-career-events", current?.pipeline?.id ?? ""],
    enabled: Boolean(current?.pipeline?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("career_application_events")
        .select("id,from_stage,to_stage,note,created_at")
        .eq("application_id", current?.pipeline?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as StageEvent[];
    },
  });

  /**
   * Zapis warstwy procesu. `stage_note` jedzie w TYM SAMYM UPDATE co `stage` -
   * trigger `career_application_log_stage` przepisuje ja do dziennika, wiec
   * audyt powstaje bez osobnego RPC i bez drugiej rundy do bazy.
   */
  const savePipeline = useMutation({
    mutationFn: async (values: {
      stage?: CareerStage;
      stage_note?: string;
      rating?: number | null;
      rejection_reason?: string;
      next_step_at?: string | null;
    }) => {
      const id = current?.pipeline?.id;
      if (!id) throw new Error("no_pipeline_row");
      const { error } = await supabase.from("career_applications").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, values) => {
      if (values.stage) toast.success(L.stageSaved);
      setNoteDraft("");
      qc.invalidateQueries({ queryKey: ["admin-career-applications"] });
      qc.invalidateQueries({ queryKey: ["admin-career-events"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * Usuniecie zgloszenia. Kaskada zabiera wiersz procesu i dziennik, a trigger
   * `career_cv_enqueue_on_message_delete` kolejkuje plik CV do usuniecia z
   * magazynu - inaczej kasowanie zgloszenia zostawialoby osierocone dane osobowe.
   */
  const removeApplication = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contact_messages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(L.removed);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["admin-career-applications"] });
      qc.invalidateQueries({ queryKey: ["admin-contact-messages"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Kandydat wybiera slug ("analysis", "mid", "immediately") - operator musi
  // zobaczyć tekst, a nie kod enuma. Słowniki żyją w `recruitmentLayer`, wspólne
  // z modułem „Rekrutacja" na karcie kontaktu CRM.
  const rowsFor = (app: CareerApplication): ReadonlyArray<[string, string]> => [
    [L.role, app.custom.role_label || app.custom.role || L.none],
    [L.department, departmentLabel(app.custom.department, adminLang) || L.none],
    [L.seniority, seniorityLabel(app.custom.seniority, adminLang) || L.none],
    [L.start, startLabel(app.custom.start, adminLang) || L.none],
    [L.linkedin, app.custom.linkedin || L.none],
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <BriefcaseBusiness className="h-5 w-5 text-brand" />
        <div>
          <h1 className="text-xl font-semibold">{L.title}</h1>
          <p className="text-xs text-muted-foreground">{L.subtitle}</p>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-[320px_1fr]">
        <aside className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="flex items-center gap-1 border-b border-border p-2">
            {(["open", "all", "archived"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded px-2 py-1 text-[11px] ${
                  filter === f ? "bg-brand text-brand-foreground" : "hover:bg-muted"
                }`}
              >
                {L.filter[f]}
              </button>
            ))}
            <button
              type="button"
              className="ml-auto p-1 text-muted-foreground hover:text-foreground"
              onClick={() => void refetch()}
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2 border-b border-border p-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L.search}
              className="h-8 text-xs"
            />
            <select
              aria-label={L.stage}
              value={stageFilter}
              onChange={(e) =>
                setStageFilter(e.target.value as "all" | "open" | "closed" | CareerStage)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">{L.stageFilterAll}</option>
              <option value="open">{L.stageFilterOpen}</option>
              <option value="closed">{L.stageFilterClosed}</option>
              {CAREER_STAGES.map((st) => (
                <option key={st} value={st}>
                  {stageLabel(st, adminLang)}
                </option>
              ))}
            </select>
          </div>
          <ul className="max-h-[70vh] flex-1 divide-y divide-border overflow-y-auto">
            {isLoading && <li className="p-3 text-xs text-muted-foreground">…</li>}
            {!isLoading && filtered.length === 0 && (
              <li className="p-3 text-xs italic text-muted-foreground">{L.empty}</li>
            )}
            {filtered.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelected(m.id)}
                  className={`w-full px-3 py-2 text-left hover:bg-muted/60 ${
                    selected === m.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {!m.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
                    <span className="flex-1 truncate text-xs font-medium">{m.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(m.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {m.custom.role_label || m.subject || m.email}
                  </p>
                  {m.pipeline && (
                    <span
                      className={`mt-1 inline-flex h-4 items-center rounded px-1.5 text-[10px] font-medium ${
                        CAREER_STAGE_STYLE[m.pipeline.stage]
                      }`}
                    >
                      {stageLabel(m.pipeline.stage, adminLang)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-h-[60vh] rounded-md border border-border bg-card p-4">
          {!current && <p className="text-sm text-muted-foreground">{L.pickOne}</p>}
          {current && (
            <div className="space-y-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{current.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {current.email}
                    {current.phone ? ` · ${current.phone}` : ""} ·{" "}
                    {new Date(current.created_at).toLocaleString()}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {current.lang.toUpperCase()}
                    </Badge>
                    {lead ? (
                      <Badge className="text-[10px]">{L.crmSynced}</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        {L.crmMissing}
                      </Badge>
                    )}
                    {current.pipeline && (
                      <span
                        className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium ${
                          CAREER_STAGE_STYLE[current.pipeline.stage]
                        }`}
                      >
                        {stageLabel(current.pipeline.stage, adminLang)}
                      </span>
                    )}
                    {current.archived_at && (
                      <Badge variant="outline" className="text-[10px]">
                        {L.archived}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <CvAccess custom={current.custom} labels={L} />
                  <Button size="sm" variant="outline" asChild>
                    <a
                      href={`mailto:${current.email}?subject=${encodeURIComponent(current.subject ?? L.title)}`}
                    >
                      <Mail className="mr-1.5 h-3.5 w-3.5" />
                      {L.reply}
                    </a>
                  </Button>
                  {lead ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/admin/crm/$id" params={{ id: lead.id }}>
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        {L.crmOpen}
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      patch.mutate(
                        {
                          id: current.id,
                          values: {
                            archived_at: current.archived_at ? null : new Date().toISOString(),
                          },
                        },
                        { onSuccess: () => toast.success(L.archived) },
                      );
                    }}
                  >
                    {current.archived_at ? (
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <Archive className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {current.archived_at ? L.unarchive : L.archive}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={removeApplication.isPending}
                    onClick={() => {
                      if (!window.confirm(L.removeConfirm)) return;
                      removeApplication.mutate(current.id);
                    }}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {L.remove}
                  </Button>
                </div>
              </header>

              <dl className="grid gap-2 rounded-md border border-border/70 bg-muted/20 p-3 sm:grid-cols-2">
                {rowsFor(current).map(([label, value]) => (
                  <div key={label} className="text-xs">
                    <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-0.5 break-words text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>

              {/* Warstwa procesu. Wiersz zaklada trigger przy wplywie zgloszenia,
                  wiec brak wiersza to sygnal awarii, a nie normalny stan. */}
              {current.pipeline ? (
                <section className="space-y-3 rounded-md border border-border/70 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[180px] flex-1">
                      <label
                        htmlFor="career-stage"
                        className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground"
                      >
                        {L.stage}
                      </label>
                      <select
                        id="career-stage"
                        value={current.pipeline.stage}
                        disabled={savePipeline.isPending}
                        onChange={(e) =>
                          savePipeline.mutate({
                            stage: e.target.value as CareerStage,
                            stage_note: noteDraft.trim(),
                          })
                        }
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {CAREER_STAGES.map((st) => (
                          <option key={st} value={st}>
                            {stageLabel(st, adminLang)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-28">
                      <label
                        htmlFor="career-rating"
                        className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground"
                      >
                        {L.rating}
                      </label>
                      <select
                        id="career-rating"
                        value={current.pipeline.rating ?? ""}
                        disabled={savePipeline.isPending}
                        onChange={(e) =>
                          savePipeline.mutate({
                            rating: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="">{L.ratingClear}</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {"★".repeat(n)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Notatka jedzie tym samym UPDATE-em co etap - trigger
                      przepisuje ja do dziennika, wiec audyt nie wymaga RPC. */}
                  <div>
                    <label
                      htmlFor="career-note"
                      className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      {L.stageNote}
                    </label>
                    <Input
                      id="career-note"
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder={L.stageNotePh}
                      className="h-8 text-xs"
                    />
                  </div>

                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {L.history}
                    </h3>
                    {events.length === 0 ? (
                      <p className="mt-1 text-[11px] italic text-muted-foreground">
                        {L.historyEmpty}
                      </p>
                    ) : (
                      <ol className="mt-1 space-y-1">
                        {events.map((ev) => (
                          <li key={ev.id} className="text-[11px] text-muted-foreground">
                            <span className="text-foreground">
                              {stageLabel(ev.from_stage, adminLang) || L.none} →{" "}
                              {stageLabel(ev.to_stage, adminLang)}
                            </span>{" "}
                            · {new Date(ev.created_at).toLocaleString()}
                            {ev.note ? ` · ${ev.note}` : ""}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </section>
              ) : (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
                  {L.noPipeline}
                </p>
              )}

              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {L.message}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {current.message}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
