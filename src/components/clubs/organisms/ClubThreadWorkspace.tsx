// Organizm: powłoka przestrzeni roboczej wątku.
//
// SZKIELET, KTÓRY DOSTAJE KAŻDY WĄTEK. Do A27 wątek był postem z odpowiedziami;
// od A28 jest jednostką pracy, wokół której stoją ludzie, źródła, terminy,
// pytania, głosowania, powiązania i dane. Ta powłoka nie zna żadnego z tych
// paneli z osobna - trzyma belkę zakładek, stan wyboru i granicę leniwego
// ładowania.
//
// TRZY DECYZJE:
//
// 1) PANEL, KTÓREGO NIE WIDAĆ, NIE ISTNIEJE W GRAFIE. Każdy panel to osobny
//    `lazy()`, więc wejście w wątek pobiera kod dyskusji i belki, a nie
//    dziewięciu widoków. Ta sama konwencja, co `lazyBlockViews` i sondaż
//    z A20 - i ten sam powód: budżety bundla są dziś czerwone.
//
// 2) PANEL PUSTY I NIEZAPISYWALNY NIE STOI NA BELCE. Zakładka, która prowadzi
//    do „brak pozycji" bez możliwości dodania czegokolwiek, jest ślepą uliczką.
//    Regułę trzyma `visiblePanels()` - czysta funkcja, nie warunki rozsypane
//    po JSX.
//
// 3) DYSKUSJA ZOSTAJE W TRASIE, nie wjeżdża do powłoki. Post otwierający,
//    odpowiedzi i kompozytor są tym, po co czytelnik przyszedł, i mają się
//    renderować bez czekania na cokolwiek z A28 - dlatego powłoka przyjmuje je
//    jako `children`, a nie importuje.
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceTabs, panelId, tabId } from "@/components/clubs/molecules/ClubWorkspaceTabs";
import {
  visiblePanels,
  type ClubWorkspacePanel,
  type ClubWorkspaceSummary,
} from "@/lib/clubs/workspaceTypes";

const ParticipantsPanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadParticipantsPanel").then((m) => ({
    default: m.ClubThreadParticipantsPanel,
  })),
);
const DocumentsPanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadDocumentsPanel").then((m) => ({
    default: m.ClubThreadDocumentsPanel,
  })),
);
const SchedulePanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadSchedulePanel").then((m) => ({
    default: m.ClubThreadSchedulePanel,
  })),
);
const QuestionsPanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadQuestionsPanel").then((m) => ({
    default: m.ClubThreadQuestionsPanel,
  })),
);
const PollsPanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadPollsPanel").then((m) => ({
    default: m.ClubThreadPollsPanel,
  })),
);
const LinksPanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadLinksPanel").then((m) => ({
    default: m.ClubThreadLinksPanel,
  })),
);
const InsightsPanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadInsightsPanel").then((m) => ({
    default: m.ClubThreadInsightsPanel,
  })),
);
const FinderPanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadFinderPanel").then((m) => ({
    default: m.ClubThreadFinderPanel,
  })),
);

function PanelFallback() {
  return <div className="h-48 animate-pulse rounded-xl bg-muted/50" aria-busy="true" />;
}

export function ClubThreadWorkspace({
  threadId,
  lang,
  userId,
  summary,
  canGoAnonymous,
  children,
}: {
  threadId: string;
  lang: "pl" | "en";
  userId: string | null;
  summary: ClubWorkspaceSummary;
  canGoAnonymous: boolean;
  /** Panel dyskusji - renderowany przez trasę, bez leniwego ładowania. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const panels = useMemo(() => visiblePanels(summary), [summary]);
  const [active, setActive] = useState<ClubWorkspacePanel>("discussion");

  // Panel może zniknąć z belki między renderami: ostatnie źródło usunięte
  // przez moderację zabiera zakładkę „Dokumenty" czytelnikowi, który akurat
  // w niej stoi. Bez tego wróciłby do pustego ekranu bez zaznaczonej zakładki.
  useEffect(() => {
    if (!panels.includes(active)) setActive("discussion");
  }, [panels, active]);

  return (
    // `--club-ws-stack` = dolna krawędź belki zakładek (top-16 + jej wysokość).
    // Każdy pasek przyklejony WEWNĄTRZ panelu przykleja się do tej wartości,
    // a nie do własnej liczby - `position: sticky` nie układa się w stos sam
    // z siebie, więc bez jednego źródła prawdy dwa paski nachodzą na siebie
    // przy pierwszej zmianie wysokości którejkolwiek z nich.
    <div className="mt-6 [--club-ws-stack:6.75rem] sm:[--club-ws-stack:7rem]">
      <ClubWorkspaceTabs panels={panels} active={active} summary={summary} onSelect={setActive} />

      <div
        role="tabpanel"
        id={panelId(active)}
        aria-labelledby={tabId(active)}
        // Panel jest kontenerem przewijalnym z własnym fokusem: bez `tabIndex`
        // treść dostępna tylko przez przewijanie byłaby nieosiągalna
        // z klawiatury po przejściu z belki.
        tabIndex={0}
        className="mt-5 focus-visible:outline-none"
      >
        {active === "discussion" ? (
          children
        ) : (
          <Suspense fallback={<PanelFallback />}>
            {active === "participants" ? (
              <ParticipantsPanel threadId={threadId} lang={lang} />
            ) : active === "documents" ? (
              <DocumentsPanel
                threadId={threadId}
                lang={lang}
                canContribute={summary.canContribute}
                canCurate={summary.canCurate}
              />
            ) : active === "schedule" ? (
              <SchedulePanel threadId={threadId} lang={lang} canCurate={summary.canCurate} />
            ) : active === "questions" ? (
              <QuestionsPanel
                threadId={threadId}
                lang={lang}
                canContribute={summary.canContribute}
                canGoAnonymous={canGoAnonymous}
              />
            ) : active === "polls" ? (
              <PollsPanel
                threadId={threadId}
                lang={lang}
                userId={userId}
                canCurate={summary.canCurate}
              />
            ) : active === "links" ? (
              <LinksPanel threadId={threadId} lang={lang} />
            ) : active === "insights" ? (
              <InsightsPanel threadId={threadId} lang={lang} />
            ) : (
              <FinderPanel threadId={threadId} lang={lang} />
            )}
          </Suspense>
        )}
      </div>

      {/* Nazwa panelu dla czytnika ekranu przy zmianie zakładki - `role="tabpanel"`
          sam w sobie nie ogłasza, CO się zmieniło. */}
      <span className="sr-only" aria-live="polite">
        {t(`club.workspace.panel.${active}`)}
      </span>
    </div>
  );
}
