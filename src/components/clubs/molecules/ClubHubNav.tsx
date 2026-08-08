// Molekuła: nawigacja huba wątku.
//
// DWIE POSTACIE, JEDEN STAN. Na desktopie to PIONOWA szyna po lewej - lista
// sekcji z licznikami, widoczna w całości bez przewijania i bez chowania
// czegokolwiek pod „więcej". Poniżej 1024 px szyna zamienia się w poziomy pas
// przewijany, bo pionowa nawigacja na telefonie zjadłaby ekran, na którym ma
// się mieścić rozmowa.
//
// To nie są zakładki nad treścią - to nawigacja OBOK treści, jak w aplikacji
// społecznościowej. Różnica jest praktyczna: pasek nad treścią przy przewijaniu
// albo znika, albo trzeba go przyklejać (i wtedy zabiera 3 rem wysokości na
// każdym ekranie). Szyna z boku nie zabiera niczego.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarDays,
  FileText,
  HelpCircle,
  Link2,
  MessageSquare,
  Search,
  Users2,
  Vote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  panelBadge,
  type ClubWorkspacePanel,
  type ClubWorkspaceSummary,
} from "@/lib/clubs/threadWorkspaceTypes";

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

export function hubTabId(panel: ClubWorkspacePanel): string {
  return `club-hub-tab-${panel}`;
}

export function hubPanelId(panel: ClubWorkspacePanel): string {
  return `club-hub-panel-${panel}`;
}

export function ClubHubNav({
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

  // Strzałki przenoszą FOKUS i zaznaczenie (wzorzec WAI-ARIA dla tablisty).
  // Zawijanie na obu końcach, bo szyna jest pierścieniem - z ostatniej pozycji
  // strzałka w dół wraca na pierwszą zamiast nie robić nic.
  const move = (delta: number) => {
    const index = panels.indexOf(active);
    if (index < 0) return;
    const next = panels[(index + delta + panels.length) % panels.length];
    onSelect(next);
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`#${hubTabId(next)}`)?.focus();
    });
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="vertical"
      aria-label={t("club.threadHub.tabsLabel")}
      onKeyDown={(event) => {
        const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
        const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
        if (forward || back) {
          event.preventDefault();
          move(forward ? 1 : -1);
        } else if (event.key === "Home") {
          event.preventDefault();
          onSelect(panels[0]);
        } else if (event.key === "End") {
          event.preventDefault();
          onSelect(panels[panels.length - 1]);
        }
      }}
      className={cn(
        // Mobile: poziomy pas przewijany, przyklejony pod nagłówkiem strony.
        "-mx-3 flex snap-x gap-1 overflow-x-auto px-3 py-2",
        "sticky top-16 z-20 border-b border-border/60 bg-background/90 backdrop-blur",
        "supports-[backdrop-filter]:bg-background/70",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // Desktop: pionowa szyna, bez tła, bez przyklejania na poziomie
        // elementu (przykleja ją kolumna siatki).
        "lg:mx-0 lg:static lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-b-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none",
        "lg:supports-[backdrop-filter]:bg-transparent",
      )}
    >
      {panels.map((panel) => {
        const Icon = PANEL_ICONS[panel];
        const count = panelBadge(panel, summary);
        const isActive = panel === active;
        const label = t(`club.threadHub.panel.${panel}`);
        return (
          <button
            key={panel}
            type="button"
            role="tab"
            id={hubTabId(panel)}
            aria-selected={isActive}
            aria-controls={hubPanelId(panel)}
            tabIndex={isActive ? 0 : -1}
            aria-label={count === null ? label : `${label} (${count})`}
            onClick={() => onSelect(panel)}
            className={cn(
              "group inline-flex shrink-0 snap-start items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "lg:w-full lg:justify-start lg:px-3 lg:py-2 lg:text-sm",
              isActive
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon
              className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "")}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap lg:flex-1 lg:text-left">{label}</span>
            {count !== null ? (
              <span
                aria-hidden="true"
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
