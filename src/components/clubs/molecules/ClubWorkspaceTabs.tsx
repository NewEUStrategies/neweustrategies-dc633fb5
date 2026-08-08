// Molekuła: belka zakładek przestrzeni roboczej wątku.
//
// TRZY DECYZJE:
//
// 1) PRZEWIJANIE POZIOME NA MOBILE, nie zawijanie do trzech rzędów. Dziewięć
//    zakładek zawiniętych na telefonie zjada pół ekranu ZANIM zacznie się
//    treść - a treść jest tym, po co czytelnik przyszedł. Pasek przewijany
//    z `snap` trzyma stałą wysokość niezależnie od liczby paneli.
//
// 2) STRZAŁKI PRZENOSZĄ FOKUS, klik i Enter aktywują (WAI-ARIA "manual
//    activation"). Automatyczna aktywacja przy przejściu strzałką ładowałaby
//    po drodze każdy mijany panel - osiem zapytań, żeby dojść do dziewiątego.
//
// 3) Belka jest `sticky` pod nagłówkiem strony: przy trzydziestu odpowiedziach
//    powrót do zakładek nie może wymagać przewinięcia do góry.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarDays,
  FileText,
  Link2,
  MessageSquare,
  Search,
  Users2,
  Vote,
  HelpCircle,
} from "lucide-react";
import { ClubWorkspaceTab } from "@/components/clubs/atoms/ClubWorkspaceTab";
import {
  panelBadge,
  type ClubWorkspacePanel,
  type ClubWorkspaceSummary,
} from "@/lib/clubs/workspaceTypes";

const PANEL_ICONS: Record<ClubWorkspacePanel, typeof FileText> = {
  discussion: MessageSquare,
  participants: Users2,
  documents: FileText,
  schedule: CalendarDays,
  questions: HelpCircle,
  polls: Vote,
  links: Link2,
  insights: BarChart3,
  search: Search,
};

export function tabId(panel: ClubWorkspacePanel): string {
  return `club-ws-tab-${panel}`;
}

export function panelId(panel: ClubWorkspacePanel): string {
  return `club-ws-panel-${panel}`;
}

export function ClubWorkspaceTabs({
  panels,
  active,
  summary,
  onSelect,
}: {
  panels: readonly ClubWorkspacePanel[];
  active: ClubWorkspacePanel;
  summary: ClubWorkspaceSummary;
  onSelect: (panel: ClubWorkspacePanel) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  const move = (delta: number) => {
    const index = panels.indexOf(active);
    if (index < 0) return;
    // Zawijanie na obu końcach: belka jest pierścieniem, więc z ostatniej
    // zakładki strzałka w prawo wraca na pierwszą zamiast nie robić nic.
    const next = panels[(index + delta + panels.length) % panels.length];
    onSelect(next);
    // Fokus musi POJŚĆ za zaznaczeniem, inaczej kolejna strzałka liczy się
    // względem elementu, którego użytkownik już nie widzi jako aktywnego.
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`#${tabId(next)}`)?.focus();
    });
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={t("club.workspace.tabsLabel")}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          onSelect(panels[0]);
        } else if (event.key === "End") {
          event.preventDefault();
          onSelect(panels[panels.length - 1]);
        }
      }}
      className={
        // WYSOKOŚĆ JEST STAŁA I TO JEST CELOWE. Wewnątrz panelu dyskusji stoi
        // DRUGI pasek przyklejony (sortowanie odpowiedzi), a `position: sticky`
        // nie układa się w stos sam z siebie - dwa paski przyklejone do tej
        // samej krawędzi po prostu na siebie nachodzą. Panel odczytuje
        // `--club-ws-stack` (ustawiane przez powłokę) i przykleja się PONIŻEJ,
        // więc jedna liczba opisuje oba paski i nie ma jak się rozjechać.
        "sticky top-16 z-20 -mx-3 flex h-11 snap-x snap-mandatory items-center gap-1 " +
        "overflow-x-auto border-b border-border/60 bg-background/85 px-3 backdrop-blur " +
        "supports-[backdrop-filter]:bg-background/70 sm:-mx-5 sm:h-12 sm:px-5 lg:-mx-8 lg:px-8 " +
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      }
    >
      {panels.map((panel) => {
        const Icon = PANEL_ICONS[panel];
        return (
          <ClubWorkspaceTab
            key={panel}
            id={tabId(panel)}
            panelId={panelId(panel)}
            label={t(`club.workspace.panel.${panel}`)}
            count={panelBadge(panel, summary)}
            icon={<Icon className="h-3.5 w-3.5" />}
            active={panel === active}
            onSelect={() => onSelect(panel)}
          />
        );
      })}
    </div>
  );
}
