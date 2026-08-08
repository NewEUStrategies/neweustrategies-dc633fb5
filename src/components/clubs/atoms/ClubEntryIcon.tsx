// Atom: ikona rodzaju wpisu w przestrzeni roboczej.
//
// JEDNO miejsce, w którym zapada decyzja "jak wygląda zbiór danych, a jak
// nagranie". Rozsypane po panelach mapowanie rodzaj -> ikona rozjeżdża się
// przy pierwszym nowym rodzaju: lista pokazuje jedno, formularz drugie,
// wyszukiwarka trzecie, a czytelnik przestaje ufać ikonom w ogóle.
//
// Ikony niosą znaczenie POMOCNICZO, nigdy samodzielnie - przy każdej z nich
// stoi etykieta tekstowa, więc same są `aria-hidden`.
import {
  CalendarClock,
  CalendarDays,
  Database,
  FileText,
  Gavel,
  Link2,
  MessageSquare,
  Mic,
  Milestone,
  Newspaper,
  NotebookPen,
  Users2,
} from "lucide-react";
import type {
  ClubDocumentKind,
  ClubMilestoneKind,
  ClubWorkspaceSection,
} from "@/lib/clubs/workspaceTypes";

const DOCUMENT_ICONS: Record<ClubDocumentKind, typeof FileText> = {
  document: FileText,
  dataset: Database,
  link: Link2,
  note: NotebookPen,
  recording: Mic,
};

const MILESTONE_ICONS: Record<ClubMilestoneKind, typeof FileText> = {
  milestone: Milestone,
  meeting: Users2,
  deadline: CalendarClock,
  publication: Newspaper,
  vote: Gavel,
  consultation: MessageSquare,
};

const SECTION_ICONS: Record<ClubWorkspaceSection, typeof FileText> = {
  reply: MessageSquare,
  document: FileText,
  milestone: CalendarDays,
  question: MessageSquare,
};

export function ClubDocumentIcon({
  kind,
  className = "h-4 w-4",
}: {
  kind: ClubDocumentKind;
  className?: string;
}) {
  const Icon = DOCUMENT_ICONS[kind];
  return <Icon className={className} aria-hidden="true" />;
}

export function ClubMilestoneIcon({
  kind,
  className = "h-4 w-4",
}: {
  kind: ClubMilestoneKind;
  className?: string;
}) {
  const Icon = MILESTONE_ICONS[kind];
  return <Icon className={className} aria-hidden="true" />;
}

export function ClubSectionIcon({
  section,
  className = "h-4 w-4",
}: {
  section: ClubWorkspaceSection;
  className?: string;
}) {
  const Icon = SECTION_ICONS[section];
  return <Icon className={className} aria-hidden="true" />;
}
