// Prawa szyna huba - kontekst, w którym toczy się rozmowa.
//
// ZASADA DOBORU. W szynie stoi WYŁĄCZNIE to, co zmienia decyzję czytelnika
// o tym, co zrobić w ciągu najbliższej minuty: czy klub żyje, co go czeka,
// na jakim etapie są prace, jakie materiały doszły i kto jest po drugiej
// stronie. Wszystko inne (pełna biblioteka, pełny kalendarz, pełny pomiar)
// ma własny ekran i tam zostaje - szyna linkuje, a nie kopiuje.
//
// KAŻDY PANEL ZNIKA, gdy nie ma treści. Panel "Nadchodzące" z napisem "brak"
// zajmuje tyle samo miejsca co panel z terminem i nie niesie nic - a pięć
// takich pustych paneli zamienia szynę w listę wymówek.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Award,
  CalendarClock,
  FileText,
  ListChecks,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubRailPanel, ClubSparkline } from "@/components/clubs/atoms/ClubHubPrimitives";
import {
  ClubDocumentKindIcon,
  ClubEventKindIcon,
  clubEventToneClass,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import {
  documentHref,
  isMilestoneOverdue,
  toDocumentKind,
  toEventKind,
  toMilestoneState,
  type ClubActivityPoint,
  type ClubContributorSlice,
  type ClubDocumentRow,
  type ClubEventRow,
  type ClubMilestoneRow,
  type ClubWorkspaceStatsRow,
} from "@/lib/clubs/workspaceTypes";
import { formatDate, formatNumber } from "@/lib/i18n/format";

/** Skrót "do sekcji" w rogu panelu - jeden kształt dla wszystkich pięciu. */
function MoreLink({
  to,
  clubSlug,
  label,
}: {
  to:
    | "/club/$clubSlug/documents"
    | "/club/$clubSlug/calendar"
    | "/club/$clubSlug/schedule"
    | "/club/$clubSlug/insights"
    | "/club/$clubSlug/members";
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

function Metric({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </p>
      <p className="text-base font-semibold leading-tight tabular-nums">{value}</p>
    </div>
  );
}

/** Puls: iskra 30 dni + trzy liczby, które mówią, czy klub żyje. */
export function ClubPulsePanel({
  clubSlug,
  series,
  stats,
  locale,
}: {
  clubSlug: string;
  series: readonly ClubActivityPoint[];
  stats: ClubWorkspaceStatsRow | null;
  locale: string;
}) {
  const { t } = useTranslation();
  if (stats === null) return null;

  // Iskra pokazuje SUMĘ ruchu (wątki + odpowiedzi) - w kolumnie tej szerokości
  // dwie serie zlałyby się w plamę, a pytanie brzmi "czy tu się coś dzieje",
  // nie "co dokładnie".
  const spark = series.slice(-30).map((point) => point.threads + point.replies);

  return (
    <ClubRailPanel
      title={t("club.hub.pulse.title")}
      icon={Activity}
      action={
        <MoreLink to="/club/$clubSlug/insights" clubSlug={clubSlug} label={t("club.hub.more")} />
      }
    >
      {spark.length > 1 ? (
        <ClubSparkline values={spark} label={t("club.hub.pulse.chartLabel")} className="mb-3" />
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <Metric
          icon={Activity}
          value={formatNumber(stats.replies_window, locale)}
          label={t("club.hub.pulse.replies")}
        />
        <Metric
          icon={Users2}
          value={formatNumber(stats.active_participants, locale)}
          label={t("club.hub.pulse.active")}
        />
        <Metric
          icon={ListChecks}
          value={formatNumber(stats.unanswered, locale)}
          label={t("club.hub.pulse.unanswered")}
        />
      </div>
    </ClubRailPanel>
  );
}

/** Nadchodzące terminy - dwa najbliższe, reszta w kalendarzu. */
export function ClubUpNextPanel({
  clubSlug,
  events,
  isPl,
}: {
  clubSlug: string;
  events: readonly ClubEventRow[];
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const lang = isPl ? "pl" : "en";
  const take = events.slice(0, 2);
  if (take.length === 0) return null;

  return (
    <ClubRailPanel
      title={t("club.hub.upNext.title")}
      icon={CalendarClock}
      action={
        <MoreLink to="/club/$clubSlug/calendar" clubSlug={clubSlug} label={t("club.hub.more")} />
      }
    >
      <ul className="flex flex-col gap-2">
        {take.map((event) => {
          const kind = toEventKind(event.kind);
          return (
            <li key={event.id} className="flex gap-2.5">
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                  clubEventToneClass(kind),
                )}
              >
                <ClubEventKindIcon kind={kind} className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-tight">
                  {isPl ? event.title_pl : event.title_en}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(event.starts_at, lang, {
                    day: "numeric",
                    month: "short",
                    hour: event.all_day ? undefined : "2-digit",
                    minute: event.all_day ? undefined : "2-digit",
                  })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </ClubRailPanel>
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
 * DOROBEK KLUBU - pierwszy panel prawej kolumny.
 *
 * PO CO STOI NAD PULSEM. Puls odpowiada na pytanie "czy tu się coś dzieje"
 * i w młodym klubie otwiera się liczbą w rodzaju "3 odpowiedzi, 1 aktywny" -
 * co czyta się jak martwe forum niezależnie od tego, ile analiz ten klub
 * naprawdę wyprodukował. Dorobek odpowiada na pytanie "co z tego wynikło",
 * czyli na to jedno, które odróżnia think tank od miejsca, gdzie się rozmawia.
 *
 * Panel NIE ZNIKA przy zerze - w odróżnieniu od "świeżych materiałów".
 * Klub bez ani jednego produktu ma to zobaczyć, bo to jest informacja
 * o klubie, a nie brak danych do ukrycia.
 */
export function ClubOutputPanel({
  clubSlug,
  products,
  total,
  isPl,
}: {
  clubSlug: string;
  products: readonly ClubDocumentRow[];
  total: number;
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const take = products.slice(0, 3);

  return (
    <ClubRailPanel
      title={t("club.hub.output.title")}
      icon={Award}
      action={
        <MoreLink to="/club/$clubSlug/documents" clubSlug={clubSlug} label={t("club.hub.more")} />
      }
    >
      {take.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">
          {t("club.docs.scope.emptyProducts")}
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm font-semibold tabular-nums">
            {t("club.hub.output.count", { count: total })}
          </p>
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

/**
 * Kto tu rozmawia. Panel MILCZY w klubie pod regułą Chatham House - RPC nie
 * odda rankingu, a nagłówek "Najaktywniejsi" nad pustą listą sugerowałby, że
 * nikt nie pisze.
 */
export function ClubPeoplePanel({
  clubSlug,
  contributors,
  canSeeMembers,
  locale,
}: {
  clubSlug: string;
  contributors: readonly ClubContributorSlice[];
  canSeeMembers: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const take = contributors.slice(0, 5);
  if (take.length === 0) return null;

  return (
    <ClubRailPanel
      title={t("club.hub.people.title")}
      icon={Users2}
      action={
        canSeeMembers ? (
          <MoreLink to="/club/$clubSlug/members" clubSlug={clubSlug} label={t("club.hub.more")} />
        ) : undefined
      }
    >
      <ul className="flex flex-col gap-2">
        {take.map((person, index) => (
          <li key={`${person.name}-${index}`} className="flex items-center gap-2.5">
            {/* Ten sam awatar, co w strumieniu - dwa kształty awatara na jednym
                ekranie czytają się jak dwa różne rodzaje osoby. */}
            <ClubAuthorAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatNumber(person.count, locale)}
            </span>
          </li>
        ))}
      </ul>
    </ClubRailPanel>
  );
}
