// Organizm: hub wątku - powłoka trójkolumnowa.
//
// DLACZEGO TRZY KOLUMNY, A NIE ZAKŁADKI NAD TREŚCIĄ. Pierwsza wersja tego
// ekranu doklejała pasek zakładek nad starą kartą wątku. Działało, ale mówiło
// nieprawdę o produkcie: sugerowało, że dyskusja jest jednym z dziewięciu
// równorzędnych widoków, między którymi się przełącza. Tak nie jest. Dyskusja
// jest treścią, a pozostałe osiem to KONTEKST, który ma stać OBOK niej -
// widoczny bez klikania, dokładnie jak w aplikacji społecznościowej.
//
//   szyna nawigacji  |  strumień rozmowy  |  szyna kontekstu
//        13 rem      |    cała reszta     |      20 rem
//
// Kolumna środkowa to `minmax(0, 1fr)`: bierze CAŁĄ pozostałą szerokość, a nie
// stałą kolumnę czytelniczą. To jest świadome odejście od typografii długiego
// tekstu - tu nie czyta się eseju, tylko pracuje na materiale, a tabela
// harmonogramu, siatka kalendarza i wykres potrzebują miejsca.
//
// PROGI. Poniżej 1024 px znikają obie szyny: nawigacja zamienia się w poziomy
// pas (patrz `ClubHubNav`), kontekst schodzi POD strumień, bo na telefonie
// kolumna obok treści jest kolumną, której nikt nie zobaczy. Między 1024
// a 1279 px zostaje nawigacja + strumień - kontekst nadal pod spodem, bo trzy
// kolumny na 1100 px dają trzy paski po 300 px i żadnego miejsca na rozmowę.
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ClubHubNav, hubPanelId, hubTabId } from "@/components/clubs/molecules/ClubHubNav";
import { ClubThreadContextRail } from "@/components/clubs/organisms/ClubThreadContextRail";
import {
  visiblePanels,
  type ClubWorkspacePanel,
  type ClubWorkspaceSummary,
} from "@/lib/clubs/threadWorkspaceTypes";

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
  return <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />;
}

export function ClubThreadHub({
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
  /** Strumień rozmowy - renderowany przez trasę, bez leniwego ładowania. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const panels = useMemo(() => visiblePanels(summary), [summary]);
  const [active, setActive] = useState<ClubWorkspacePanel>("discussion");

  // Panel może zniknąć z szyny między renderami: ostatnie źródło usunięte przez
  // moderację zabiera pozycję „Dokumenty" czytelnikowi, który akurat w niej
  // stoi. Bez tego zostaje pusty ekran bez zaznaczonej pozycji.
  useEffect(() => {
    if (!panels.includes(active)) setActive("discussion");
  }, [panels, active]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-16 sm:px-5 lg:px-8">
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_20rem]">
        {/* --- szyna nawigacji --- */}
        <div className="lg:sticky lg:top-20 lg:self-start lg:py-6">
          <ClubHubNav panels={panels} active={active} summary={summary} onSelect={setActive} />
        </div>

        {/* --- strumień / panel --- */}
        <main
          role="tabpanel"
          id={hubPanelId(active)}
          aria-labelledby={hubTabId(active)}
          tabIndex={0}
          className="min-w-0 py-4 focus-visible:outline-none lg:py-6"
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
        </main>

        {/* --- szyna kontekstu ---
            Trzecia kolumna od 1280 px; niżej ląduje POD strumieniem, ale nadal
            się renderuje - to jest skrót do sześciu paneli, a nie ozdoba
            dla szerokich ekranów. */}
        <div className="min-w-0 xl:sticky xl:top-20 xl:self-start xl:py-6">
          <ClubThreadContextRail
            threadId={threadId}
            lang={lang}
            summary={summary}
            onOpenPanel={setActive}
          />
        </div>
      </div>

      {/* Zmiana sekcji ogłoszona grzecznie - `role="tabpanel"` sam w sobie nie
          mówi, CO się zmieniło. */}
      <span className="sr-only" aria-live="polite">
        {t(`club.threadHub.panel.${active}`)}
      </span>
    </div>
  );
}
