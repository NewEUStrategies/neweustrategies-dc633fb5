// Atomy przestrzeni roboczej: rodzaj dokumentu, rodzaj wpisu w kalendarzu,
// stan etapu.
//
// JEDNO miejsce, w którym zapada decyzja "jak wygląda rodzaj dokumentu".
// Ta sama lekcja, co przy `ClubTopicChip`: zanim chip stał się wspólny, ten
// sam obszar tematyczny wyglądał na trzy sposoby na trzech ekranach i nie
// dawał się rozpoznać jako ten sam byt. Biblioteka, kalendarz i harmonogram
// pokazują swoje rodzaje w czterech miejscach każdy (lista, karta, filtr,
// formularz), więc ryzyko rozjazdu jest tu jeszcze większe.
//
// Ikony niosą ZNACZENIE, nie dekorację: termin ustawowy wygląda inaczej niż
// posiedzenie, bo to są dwie różne rzeczy w kalendarzu jednego klubu.
import {
  AlarmClock,
  BarChart3,
  BookOpen,
  CalendarDays,
  CircleDot,
  FileSpreadsheet,
  FileText,
  Gavel,
  Landmark,
  MessagesSquare,
  Mic,
  Newspaper,
  Presentation,
  Scale,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  ClubDocumentKind,
  ClubEventKind,
  ClubMilestoneState,
} from "@/lib/clubs/workspaceTypes";

const CHIP =
  "inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium leading-none sm:text-xs";

// ---------------------------------------------------------------------------
// Dokumenty
// ---------------------------------------------------------------------------

const DOCUMENT_ICONS: Record<ClubDocumentKind, LucideIcon> = {
  brief: FileText,
  analysis: BarChart3,
  minutes: BookOpen,
  dataset: FileSpreadsheet,
  position: Scale,
  legal: Gavel,
  presentation: Presentation,
  other: FileText,
};

export function ClubDocumentKindIcon({
  kind,
  className,
}: {
  kind: ClubDocumentKind;
  className?: string;
}) {
  const Icon = DOCUMENT_ICONS[kind];
  return <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
}

export function ClubDocumentKindChip({
  kind,
  className,
}: {
  kind: ClubDocumentKind;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(CHIP, "border-border/60 bg-muted/40 text-muted-foreground", className)}
      data-club-document-kind={kind}
    >
      <ClubDocumentKindIcon kind={kind} className="h-3 w-3" />
      <span className="truncate">{t(`club.docs.kind.${kind}`)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Kalendarz
// ---------------------------------------------------------------------------

const EVENT_ICONS: Record<ClubEventKind, LucideIcon> = {
  meeting: Users,
  briefing: Mic,
  deadline: AlarmClock,
  consultation: MessagesSquare,
  publication: Newspaper,
  vote: Vote,
  workshop: Landmark,
  other: CalendarDays,
};

/**
 * Tony rodzajów wpisu. TERMIN jest czerwony nie dla ozdoby - w kalendarzu
 * klubu, który towarzyszy procesowi legislacyjnemu, przegapiony termin
 * konsultacji jest jedyną rzeczą nie do odrobienia.
 */
const EVENT_TONES: Record<ClubEventKind, string> = {
  meeting: "border-primary/40 bg-primary/10 text-primary",
  briefing: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  deadline: "border-destructive/40 bg-destructive/10 text-destructive",
  consultation: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  publication: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  vote: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  workshop: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  other: "border-border/60 bg-muted/40 text-muted-foreground",
};

export function clubEventToneClass(kind: ClubEventKind): string {
  return EVENT_TONES[kind];
}

export function ClubEventKindIcon({
  kind,
  className,
}: {
  kind: ClubEventKind;
  className?: string;
}) {
  const Icon = EVENT_ICONS[kind];
  return <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
}

export function ClubEventKindChip({
  kind,
  className,
}: {
  kind: ClubEventKind;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn(CHIP, EVENT_TONES[kind], className)} data-club-event-kind={kind}>
      <ClubEventKindIcon kind={kind} className="h-3 w-3" />
      <span className="truncate">{t(`club.calendar.kind.${kind}`)}</span>
    </span>
  );
}

/** Kropka w siatce miesiąca. Sam kolor, bez etykiety - w komórce dnia nie ma
 *  miejsca na napis, a `title`/`aria-label` niesie treść dla czytnika. */
export function ClubEventDot({ kind, label }: { kind: ClubEventKind; label: string }) {
  return (
    <span
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full border", EVENT_TONES[kind])}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

// ---------------------------------------------------------------------------
// Harmonogram
// ---------------------------------------------------------------------------

const MILESTONE_TONES: Record<ClubMilestoneState, string> = {
  planned: "border-border/60 bg-muted/40 text-muted-foreground",
  active: "border-primary/40 bg-primary/10 text-primary",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-border/60 bg-muted/30 text-muted-foreground line-through",
};

export function ClubMilestoneStateChip({
  state,
  className,
}: {
  state: ClubMilestoneState;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn(CHIP, MILESTONE_TONES[state], className)} data-club-milestone-state={state}>
      <CircleDot className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{t(`club.schedule.state.${state}`)}</span>
    </span>
  );
}

/** Kropka osi czasu. Wypełniona = etap zamknięty, pusta = jeszcze przed nami. */
export function ClubMilestoneMarker({ state }: { state: ClubMilestoneState }) {
  const done = state === "done";
  const blocked = state === "blocked";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1 h-3 w-3 shrink-0 rounded-full border-2",
        done && "border-emerald-500 bg-emerald-500",
        blocked && "border-destructive bg-destructive",
        state === "active" && "border-primary bg-primary",
        (state === "planned" || state === "cancelled") && "border-border bg-background",
      )}
    />
  );
}
