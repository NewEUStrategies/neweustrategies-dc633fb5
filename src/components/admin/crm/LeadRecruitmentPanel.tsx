// Moduł „Rekrutacja" na karcie kontaktu CRM (/admin/crm/$id).
//
// Do tej pory zgłoszenie z /zatrudniamy było widoczne WYŁĄCZNIE w skrzynce
// /admin/careers: karta kontaktu pokazywała je jako zwykłą „wiadomość z
// formularza" (temat + obcięta treść), bez roli, poziomu, terminu startu i - co
// najważniejsze - bez CV. `aliases.custom` i `contact_messages.custom` były
// zapisywane, ale nigdy przez nikogo nie czytane.
//
// Panel jest rozwijalny (jak „dane podstawowe"), domyślnie otwarty, gdy kontakt
// ma historię rekrutacyjną. Renderuje się także dla kontaktu bez zgłoszeń - z
// pustym stanem - żeby moduł był odnajdywalny, a nie pojawiał się „z niczego".
//
// CV: plik z prywatnego bucketu `career-cv` otwieramy podpisanym linkiem (5 min,
// `signCvUrl`), link zewnętrzny prowadzi wprost. Ścieżkę pliku waliduje
// `isCareerCvPath` już przy zapisie, więc tu podpisujemy tylko znany kształt.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  BriefcaseBusiness,
  ChevronDown,
  ExternalLink,
  FileText,
  Linkedin,
  Loader2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signCvUrl } from "@/lib/careers/cvUpload";
import {
  CAREER_STAGE_STYLE,
  buildRecruitmentLayer,
  departmentLabel,
  seniorityLabel,
  stageLabel,
  startLabel,
  type CareerAdminLang,
  type RecruitmentApplication,
  type RecruitmentMessageRow,
} from "@/lib/careers/recruitmentLayer";

interface Dict {
  title: string;
  empty: string;
  applications: string;
  first: string;
  last: string;
  role: string;
  department: string;
  seniority: string;
  start: string;
  linkedin: string;
  cv: string;
  cvOpen: string;
  cvLink: string;
  cvMissing: string;
  cvPurged: string;
  cvError: string;
  note: string;
  openInbox: string;
  spontaneous: string;
  history: string;
  none: string;
}

const PL: Dict = {
  title: "Rekrutacja",
  empty: "Ten kontakt nie aplikował przez stronę /zatrudniamy.",
  applications: "Zgłoszenia",
  first: "Pierwsze",
  last: "Ostatnie",
  role: "Rola",
  department: "Dział",
  seniority: "Poziom",
  start: "Dostępność",
  linkedin: "LinkedIn",
  cv: "CV",
  cvOpen: "Otwórz CV",
  cvLink: "CV (link zewnętrzny)",
  cvMissing: "Brak CV",
  cvPurged: "CV usunięte (retencja)",
  cvError: "Nie udało się wygenerować linku do CV.",
  note: "Uzasadnienie kandydata",
  openInbox: "Otwórz w skrzynce rekrutacyjnej",
  spontaneous: "Zgłoszenie spontaniczne",
  history: "Historia dopasowań",
  none: "-",
};

const EN: Dict = {
  title: "Recruitment",
  empty: "This contact has not applied through the /zatrudniamy page.",
  applications: "Applications",
  first: "First",
  last: "Latest",
  role: "Role",
  department: "Department",
  seniority: "Seniority",
  start: "Availability",
  linkedin: "LinkedIn",
  cv: "CV",
  cvOpen: "Open CV",
  cvLink: "CV (external link)",
  cvMissing: "No CV",
  cvPurged: "CV deleted (retention)",
  cvError: "Could not generate the CV link.",
  note: "Candidate's note",
  openInbox: "Open in the recruitment inbox",
  spontaneous: "Spontaneous application",
  history: "Match history",
  none: "-",
};

function CvButton({ app, L }: { app: RecruitmentApplication; L: Dict }) {
  const [busy, setBusy] = useState(false);

  if (app.cvPath) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        className="h-7 gap-1 text-[11px]"
        onClick={async () => {
          setBusy(true);
          const signed = await signCvUrl(app.cvPath);
          setBusy(false);
          if (!signed) {
            toast.error(L.cvError);
            return;
          }
          window.open(signed, "_blank", "noopener,noreferrer");
        }}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <FileText className="h-3 w-3" aria-hidden />
        )}
        <span className="max-w-[180px] truncate">{app.cvFileName || L.cvOpen}</span>
      </Button>
    );
  }

  if (app.cvUrl) {
    return (
      <Button size="sm" variant="outline" asChild className="h-7 gap-1 text-[11px]">
        <a href={app.cvUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-3 w-3" aria-hidden />
          {L.cvLink}
        </a>
      </Button>
    );
  }

  // Retencja zdejmuje `cv_path` i zostawia `cv_purged_at` - bez tego
  // rozróżnienia operator widziałby „Brak CV" i szukałby błędu w formularzu.
  return (
    <span className="text-[11px] text-muted-foreground">
      {app.cvPurgedAt ? `${L.cvPurged} · ${app.cvPurgedAt}` : L.cvMissing}
    </span>
  );
}

export function LeadRecruitmentPanel({
  aliases,
  messages,
  lang,
}: {
  /** `crm_leads.aliases` - historia append-only z `crm_upsert_from_form`. */
  aliases: unknown;
  /** Wiadomości kontaktu; panel sam wybiera zgłoszenia rekrutacyjne. */
  messages: readonly RecruitmentMessageRow[] | null | undefined;
  lang: CareerAdminLang;
}) {
  const L = lang === "en" ? EN : PL;
  const layer = buildRecruitmentLayer({ aliases, messages });
  const [open, setOpen] = useState(layer.hasHistory);

  const stat = (label: string, value: string) => (
    <div key={label}>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[12px] text-foreground">{value || L.none}</dd>
    </div>
  );

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : L.none);

  return (
    <section className="rounded-md border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 border-b px-3 py-2 text-left text-[12px] font-medium hover:bg-muted/40"
      >
        <BriefcaseBusiness className="h-3.5 w-3.5 text-brand" aria-hidden />
        {L.title}
        {layer.applicationCount > 0 && (
          <Badge variant="secondary" className="ml-1 text-[10px]">
            {layer.applicationCount}
          </Badge>
        )}
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-3 p-3">
          {!layer.hasHistory ? (
            <p className="text-[11px] text-muted-foreground">{L.empty}</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3 rounded border border-border/70 bg-muted/20 p-2.5">
                {stat(L.applications, String(layer.applicationCount))}
                {stat(L.first, fmtDate(layer.firstAppliedAt))}
                {stat(L.last, fmtDate(layer.lastAppliedAt))}
              </dl>

              {layer.applications.length === 0 && layer.roleLabels.length > 0 && (
                // Zgłoszenia mogły zostać usunięte ze skrzynki, a lead został -
                // aliasy są wtedy jedynym śladem dopasowania.
                <div className="rounded border p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {L.history}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {layer.roleLabels.map((role) => (
                      <Badge key={role} variant="outline" className="text-[10px]">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <ul className="space-y-2">
                {layer.applications.map((app) => (
                  <li key={app.id} className="rounded border p-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium">
                          {app.roleLabel || (app.role === "open" ? L.spontaneous : app.role)}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {app.pipeline && (
                            <span
                              className={`inline-flex h-4 items-center rounded px-1.5 text-[10px] font-medium ${
                                CAREER_STAGE_STYLE[app.pipeline.stage]
                              }`}
                            >
                              {stageLabel(app.pipeline.stage, lang)}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(app.createdAt).toLocaleString()} · {app.lang.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <CvButton app={app} L={L} />
                    </div>

                    <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                      {stat(L.department, departmentLabel(app.department, lang))}
                      {stat(L.seniority, seniorityLabel(app.seniority, lang))}
                      {stat(L.start, startLabel(app.start, lang))}
                    </dl>

                    {app.linkedin && (
                      <a
                        href={
                          app.linkedin.startsWith("http") ? app.linkedin : `https://${app.linkedin}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <Linkedin className="h-3 w-3" aria-hidden />
                        {L.linkedin}
                      </a>
                    )}

                    {app.message && (
                      <div className="mt-2">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {L.note}
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                          {app.message}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <Button size="sm" variant="outline" asChild className="h-7 w-full gap-1 text-[11px]">
                <Link to="/admin/careers">
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  {L.openInbox}
                </Link>
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
