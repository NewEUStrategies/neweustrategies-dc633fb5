// Prawa szyna huba - kontekst, w którym toczy się rozmowa.
//
// ZASADA DOBORU. W szynie stoi WYŁĄCZNIE to, co zmienia decyzję czytelnika
// o tym, co zrobić w ciągu najbliższej minuty: z kim się odezwać, kto tu jest,
// co go czeka, na jakim etapie są prace i co z tych rozmów wyszło. Wszystko
// inne (pełna biblioteka, pełny kalendarz, pełny pomiar) ma własny ekran i tam
// zostaje - szyna linkuje, a nie kopiuje.
//
// KAŻDY PANEL ZNIKA, gdy nie ma treści. Panel "Nadchodzące" z napisem "brak"
// zajmuje tyle samo miejsca co panel z terminem i nie niesie nic - a pięć
// takich pustych paneli zamienia szynę w listę wymówek. Wyjątkiem jest dorobek
// (patrz niżej) i tablica ogłoszeń: tam pustka JEST informacją o klubie.
//
// CO STĄD ZNIKNĘŁO I DLACZEGO (A32):
//
//   * "Wątki i ich źródła" - funkcja zdublowana. Drzewo działów z licznikami
//     stoi w LEWEJ szynie, a każda karta strumienia niesie chip działu,
//     którym można zawęzić listę. Trzeci byt mówiący to samo nie dodawał
//     informacji, tylko wysokości.
//
//   * "Najaktywniejsi" i "Puls klubu" w starej postaci - obie powierzchnie
//     liczyły TREŚĆ (odpowiedzi w oknie, wątki bez odpowiedzi, suma wpisów
//     na iskrze). Zastąpił je jeden panel składu z sygnałem obecności, którego
//     iskra liczy RÓŻNE OSOBY, a nie wpisy: jedna osoba pisząca dziesięć razy
//     i dziesięć osób po razie dawały wcześniej identyczny wykres, mimo że to
//     są dwa zupełnie różne kluby.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Award, FileText, ListChecks, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubFaceStack } from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { ClubDocumentKindIcon } from "@/components/clubs/atoms/ClubWorkspaceBadges";
import type { ClubOutputEntry } from "@/lib/clubs/networkApi";
import {
  documentHref,
  isMilestoneOverdue,
  toDocumentKind,
  toMilestoneState,
  type ClubDocumentRow,
  type ClubMilestoneRow,
} from "@/lib/clubs/workspaceTypes";
import { formatDate } from "@/lib/i18n/format";

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
    | "/club/$clubSlug/output"
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
  isPl,
  today,
}: {
  clubSlug: string;
  milestones: readonly ClubMilestoneRow[];
  isPl: boolean;
  today: string;
}) {
  const { t } = useTranslation();
  const lang = isPl ? "pl" : "en";
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
      <p className="text-sm font-medium leading-tight">{isPl ? stage.title_pl : stage.title_en}</p>
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

/**
 * DOROBEK KLUBU - co powstało ze wspólnych rozmów.
 *
 * CO SIĘ ZMIENIŁO (A32). Panel pokazywał wcześniej listę PRODUKTÓW: tytuł,
 * ikona rodzaju, licznik. To jest opis biblioteki, a nie dorobku - a te dwie
 * rzeczy odpowiadają na różne pytania. "Co ten klub opublikował" ma własny
 * ekran. Tutaj pytanie brzmi: co powstało z tego, że CI LUDZIE ze sobą
 * rozmawiali - więc każdy produkt niesie ROZMOWĘ, z której wyrósł, i twarze
 * osób, które ją prowadziły. To jest jedyny dowód, że networking daje wynik.
 *
 * Współautorstwo nie ma własnej tabeli: źródłem prawdy jest dyskusja podpięta
 * pod dokument. Osobna lista autorów rozjechałaby się z wątkiem w pierwszym
 * miesiącu, a utrzymywałby ją ręcznie ten sam człowiek, który wgrywa plik.
 *
 * Panel NIE ZNIKA przy zerze - w odróżnieniu od "świeżych materiałów". Klub
 * bez ani jednego wspólnego wyniku ma to zobaczyć, bo to jest informacja
 * o klubie, a nie brak danych do ukrycia.
 */
export function ClubOutputPanel({
  clubSlug,
  entries,
  total,
  isPl,
}: {
  clubSlug: string;
  entries: readonly ClubOutputEntry[];
  total: number;
  isPl: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ClubRailPanel
      title={t("club.network.output.title")}
      icon={Award}
      action={
        <MoreLink to="/club/$clubSlug/output" clubSlug={clubSlug} label={t("club.hub.more")} />
      }
    >
      {entries.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">
          {t("club.network.output.empty")}
        </p>
      ) : (
        <>
          <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
            {t("club.network.output.count", { count: total })}
          </p>
          <ul className="flex flex-col gap-2.5">
            {entries.map(({ row, contributors }) => {
              const href = documentHref(row);
              const title = isPl ? row.title_pl : row.title_en;
              const inner = (
                <>
                  <ClubDocumentKindIcon
                    kind={toDocumentKind(row.kind)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="line-clamp-2 leading-snug">{title}</span>
                </>
              );
              return (
                <li key={row.id}>
                  {href !== null ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-2 text-sm font-medium hover:text-primary"
                    >
                      {inner}
                    </a>
                  ) : (
                    <span className="flex items-start gap-2 text-sm font-medium">{inner}</span>
                  )}

                  {/* PROWENIENCJA. Bez niej to jest lista plików; z nią - dowód,
                      że z rozmowy coś wyszło. Wątek jest linkiem, bo pierwsze
                      pytanie po przeczytaniu tytułu brzmi "skąd to się wzięło". */}
                  {row.thread_slug !== null && row.thread_title !== null ? (
                    <Link
                      to="/club/$clubSlug/t/$threadSlug"
                      params={{ clubSlug, threadSlug: row.thread_slug }}
                      className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                    >
                      <MessagesSquare className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{row.thread_title}</span>
                    </Link>
                  ) : null}

                  {contributors.length > 0 ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <ClubFaceStack
                        faces={contributors.map((person) => ({
                          userId: person.userId,
                          name: person.name,
                          avatarUrl: person.avatarUrl,
                        }))}
                        total={row.contributor_count}
                        max={4}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {t("club.network.output.contributors", { count: row.contributor_count })}
                      </span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ClubRailPanel>
  );
}

/** Świeże materiały - trzy pozycje, reszta w bibliotece. */
export function ClubFreshDocsPanel({
  clubSlug,
  documents,
  isPl,
}: {
  clubSlug: string;
  documents: readonly ClubDocumentRow[];
  isPl: boolean;
}) {
  const { t } = useTranslation();
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
          const title = isPl ? document.title_pl : document.title_en;
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
