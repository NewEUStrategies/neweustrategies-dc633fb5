// Prawa szyna huba - kontekst, w którym toczy się rozmowa.
//
// ZASADA DOBORU. W szynie stoi WYŁĄCZNIE to, co zmienia decyzję czytelnika
// o tym, co zrobić w ciągu najbliższej minuty: z kim się odezwać, kto tu jest,
// co go czeka i na jakim etapie są prace. Wszystko inne (pełna biblioteka,
// pełny kalendarz, pełny pomiar) ma własny ekran i tam zostaje - szyna
// linkuje, a nie kopiuje.
//
// KAŻDY PANEL ZNIKA, gdy nie ma treści. Panel "Nadchodzące" z napisem "brak"
// zajmuje tyle samo miejsca co panel z terminem i nie niesie nic - a pięć
// takich pustych paneli zamienia szynę w listę wymówek. Wyjątkiem jest tablica
// ogłoszeń: tam pustka JEST informacją o klubie.
//
// CO STĄD ZNIKNĘŁO I DLACZEGO:
//
//   * "Wątki i ich źródła" (A32) - funkcja zdublowana. Drzewo działów
//     z licznikami stoi w LEWEJ szynie, a każda karta strumienia niesie chip
//     działu, którym można zawęzić listę. Trzeci byt mówiący to samo nie
//     dodawał informacji, tylko wysokości.
//
//   * "Najaktywniejsi" i "Puls klubu" (A32) - obie powierzchnie liczyły TREŚĆ
//     (odpowiedzi w oknie, wątki bez odpowiedzi, suma wpisów na iskrze).
//     Zastąpił je jeden panel składu z sygnałem obecności.
//
//   * "Dorobek klubu" (A34) - panel mówił o MATERIAŁACH, a szyna po
//     przebudowie mówi o ludziach: tablica, spotkanie, skład, poznaj członka.
//     Lista plików między nimi rozbijała ten ciąg i powtarzała pytanie, na
//     które odpowiada biblioteka. Zniknął cały moduł, razem z trasą i RPC.
import { Link } from "@tanstack/react-router";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useTranslation } from "react-i18next";
import { FileText, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubDocumentKindIcon } from "@/components/clubs/atoms/ClubWorkspaceBadges";
import {
  documentHref,
  isMilestoneOverdue,
  toDocumentKind,
  toMilestoneState,
  type ClubDocumentRow,
  type ClubMilestoneRow,
} from "@/lib/clubs/workspaceTypes";
import { formatDate, uiLang } from "@/lib/i18n/format";

/** Skrót "do sekcji" w rogu panelu - jeden kształt dla wszystkich paneli szyny. */
export function MoreLink({
  to,
  clubSlug,
  label,
}: {
  // Unia LITERAŁÓW, nie `string`: literówka w adresie panelu szyny byłaby
  // martwym linkiem, którego nie widać, dopóki ktoś w niego nie kliknie.
  to:
    | "/club/$clubSlug/documents"
    | "/club/$clubSlug/calendar"
    | "/club/$clubSlug/schedule"
    | "/club/$clubSlug/insights"
    | "/club/$clubSlug/members"
    | "/club/$clubSlug/board"
    | "/club/$clubSlug/experts"
    | "/club/$clubSlug/spotlight";
  clubSlug: string;
  label: string;
}) {
  return (
    <Link
      to={to}
      params={{ clubSlug }}
      className="rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-primary"
    >
      {label}
    </Link>
  );
}

/** Bieżący etap prac - rama, w której toczy się cała rozmowa klubu. */
export function ClubStagePanel({
  clubSlug,
  milestones,
  today,
}: {
  clubSlug: string;
  milestones: readonly ClubMilestoneRow[];
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const stage =
    milestones.find((m) => toMilestoneState(m.state) === "active") ??
    milestones.find((m) => toMilestoneState(m.state) === "planned") ??
    null;
  if (stage === null) return null;

  const overdue = isMilestoneOverdue(stage, today);
  const done = milestones.filter((m) => toMilestoneState(m.state) === "done").length;

  return (
    <ClubRailPanel
      title={t("club.hub.stage.title")}
      icon={ListChecks}
      action={
        <MoreLink to="/club/$clubSlug/schedule" clubSlug={clubSlug} label={t("club.hub.more")} />
      }
    >
      <p className="text-sm font-medium leading-tight">{pickLocalized(stage, "title", lang)}</p>
      {stage.due_on !== null ? (
        <p
          className={cn(
            "mt-0.5 text-[11px]",
            overdue ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {overdue
            ? t("club.schedule.overdue")
            : t("club.hub.stage.due", {
                date: formatDate(stage.due_on, lang, { day: "numeric", month: "short" }),
              })}
        </p>
      ) : null}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-lg bg-muted"
        role="progressbar"
        aria-valuenow={stage.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("club.schedule.progress")}
      >
        <span
          className="block h-full rounded-lg bg-primary"
          style={{ width: `${Math.min(100, Math.max(0, stage.progress))}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
        {t("club.hub.stage.doneOf", { done, total: milestones.length })}
      </p>
    </ClubRailPanel>
  );
}

/** Świeże materiały - trzy pozycje, reszta w bibliotece. */
export function ClubFreshDocsPanel({
  clubSlug,
  documents,
}: {
  clubSlug: string;
  documents: readonly ClubDocumentRow[];
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const take = documents.slice(0, 3);
  if (take.length === 0) return null;

  return (
    <ClubRailPanel
      title={t("club.hub.freshDocs.title")}
      icon={FileText}
      action={
        <MoreLink to="/club/$clubSlug/documents" clubSlug={clubSlug} label={t("club.hub.more")} />
      }
    >
      <ul className="flex flex-col gap-1.5">
        {take.map((document) => {
          const href = documentHref(document);
          const title = pickLocalized(document, "title", lang);
          const inner = (
            <>
              <ClubDocumentKindIcon
                kind={toDocumentKind(document.kind)}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
              <span className="truncate">{title}</span>
            </>
          );
          return (
            <li key={document.id}>
              {href !== null ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-sm hover:text-primary"
                >
                  {inner}
                </a>
              ) : (
                <span className="flex items-center gap-2 px-1 py-0.5 text-sm">{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </ClubRailPanel>
  );
}
