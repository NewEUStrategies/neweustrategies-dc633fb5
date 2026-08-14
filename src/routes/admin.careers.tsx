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
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signCvUrl } from "@/lib/careers/cvUpload";
import {
  CAREERS_FORM_ID,
  asCustomRecord,
  departmentLabel,
  isCareerCvPath,
  normalizeCvUrl,
  seniorityLabel,
  startLabel,
  type CareerAdminLang,
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
  labels: Pick<CareersDict, "cv" | "cvOpen" | "cvMissing" | "cvError">;
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
    return (
      <span className="text-xs text-muted-foreground">
        {labels.cv}: {labels.cvMissing}
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
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const {
    data: rows = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-career-applications", filter],
    queryFn: async () => {
      let qb = supabase
        .from("contact_messages")
        .select(
          "id,name,email,phone,subject,message,lang,created_at,read_at,archived_at,custom",
        )
        .eq("form_id", CAREERS_FORM_ID)
        .order("created_at", { ascending: false })
        .limit(500);
      if (filter === "open") qb = qb.is("archived_at", null);
      else if (filter === "archived") qb = qb.not("archived_at", "is", null);
      const { data, error } = await qb;
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        custom: asCustomRecord((row as { custom: unknown }).custom),
      })) as CareerApplication[];
    },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
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
  }, [rows, q]);

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
          <div className="border-b border-border p-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L.search}
              className="h-8 text-xs"
            />
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
