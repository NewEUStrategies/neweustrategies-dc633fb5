// Supplementary i18n bundle for the EU legislative tracker (PL/EN).
// Side-effect import this module wherever the feature mounts:
//   import "@/lib/i18n-tracker";
// The pl/en objects are exported so a parity test can verify both trees stay
// structurally identical (same rule as the core locale files).
import i18n from "./i18n";

export const trackerPl = {
  tracker: {
    title: "Tracker legislacyjny UE",
    intro:
      "Śledź kluczowe dossier legislacyjne Unii Europejskiej: etap procedury, oś czasu wydarzeń i następne kamienie milowe. Obserwuj dossier, aby dostawać powiadomienie o każdej aktualizacji.",
    filters: {
      area: "Obszar polityki",
      stage: "Etap procedury",
      allAreas: "Wszystkie obszary",
      allStages: "Wszystkie etapy",
    },
    keyFile: "Kluczowe",
    nextMilestone: "Następny kamień milowy",
    followers_one: "{{count}} obserwujący",
    followers_few: "{{count}} obserwujących",
    followers_many: "{{count}} obserwujących",
    followers_other: "{{count}} obserwujących",
    follow: "Obserwuj",
    following: "Obserwujesz",
    followHint: "Otrzymasz powiadomienie o każdej aktualizacji",
    signInToFollow: "Zaloguj się, aby obserwować",
    followError: "Nie udało się zmienić obserwowania. Spróbuj ponownie.",
    reference: "Referencja",
    source: "Źródło",
    timeline: "Oś czasu",
    timelineEmpty: "Brak aktualizacji - oś czasu pojawi się po pierwszym wpisie.",
    stageChange: "Zmiana etapu: {{from}} → {{to}}",
    stageSet: "Etap: {{to}}",
    procedureEnded: "Procedura zakończona",
    empty: "Brak dossier dla wybranych filtrów.",
    loading: "Wczytywanie...",
    loadMore: "Pokaż więcej dossier",
    loadError: "Nie udało się wczytać trackera. Spróbuj ponownie później.",
    notFound: "Nie znaleziono dossier.",
    backToIndex: "Wróć do trackera",
    progressLabel: "Postęp procedury legislacyjnej",
    rapporteur: "Sprawozdawca",
    committee: "Komisja wiodąca",
    leadDg: "DG Komisji",
    positions: {
      title: "Stanowiska państw członkowskich",
      description:
        "Zadeklarowane lub raportowane stanowiska rządów wobec tego dossier. Najedź na kraj lub otwórz tabelę danych.",
    },
    related: {
      title: "Powiązane akty",
      relation: {
        related: "Powiązane",
        amends: "Nowelizuje",
        implements: "Wdraża",
        supersedes: "Zastępuje",
      },
    },
    changes: {
      title: "Co się zmieniło",
      intro:
        "Najnowsze aktualizacje wszystkich śledzonych dossier legislacyjnych UE - zmiany etapów i wpisy do osi czasu.",
      empty: "Brak aktualizacji.",
      loadMore: "Pokaż więcej",
      today: "Dzisiaj",
      yesterday: "Wczoraj",
      viewDossier: "Zobacz dossier",
    },
    explorer: {
      title: "Explorer stanowisk i koalicji",
      intro:
        "Przekrój stanowisk państw członkowskich wobec kluczowych dossier. Filtruj po obszarze polityki; kliknij dossier, aby zobaczyć mapę i oś czasu.",
      allAreas: "Wszystkie obszary",
      dossier: "Dossier",
      noData: "Brak dossier ze stanowiskami dla wybranego filtra.",
      stats: {
        total: "Śledzone dossier",
        byStage: "Wg etapu procedury",
        byArea: "Wg obszaru polityki",
      },
      link: "Otwórz explorer",
      changesLink: "Co się zmieniło",
    },
  },
};

export const trackerEn = {
  tracker: {
    title: "EU legislative tracker",
    intro:
      "Follow key European Union legislative files: procedure stage, a timeline of events and upcoming milestones. Follow a file to get a notification about every update.",
    filters: {
      area: "Policy area",
      stage: "Procedure stage",
      allAreas: "All areas",
      allStages: "All stages",
    },
    keyFile: "Key file",
    nextMilestone: "Next milestone",
    followers_one: "{{count}} follower",
    followers_other: "{{count}} followers",
    follow: "Follow",
    following: "Following",
    followHint: "You will get a notification about every update",
    signInToFollow: "Sign in to follow",
    followError: "Could not update the follow. Please try again.",
    reference: "Reference",
    source: "Source",
    timeline: "Timeline",
    timelineEmpty: "No updates yet - the timeline will appear after the first entry.",
    stageChange: "Stage change: {{from}} → {{to}}",
    stageSet: "Stage: {{to}}",
    procedureEnded: "Procedure closed",
    empty: "No files match the selected filters.",
    loading: "Loading...",
    loadMore: "Show more files",
    loadError: "Could not load the tracker. Please try again later.",
    notFound: "File not found.",
    backToIndex: "Back to the tracker",
    progressLabel: "Legislative procedure progress",
    rapporteur: "Rapporteur",
    committee: "Lead committee",
    leadDg: "Commission DG",
    positions: {
      title: "Member state positions",
      description:
        "Declared or reported government positions on this file. Hover a country or open the data table.",
    },
    related: {
      title: "Related files",
      relation: {
        related: "Related",
        amends: "Amends",
        implements: "Implements",
        supersedes: "Supersedes",
      },
    },
    changes: {
      title: "What changed",
      intro:
        "The latest updates across all tracked EU legislative files - stage changes and timeline entries.",
      empty: "No updates yet.",
      loadMore: "Show more",
      today: "Today",
      yesterday: "Yesterday",
      viewDossier: "View dossier",
    },
    explorer: {
      title: "Positions & coalitions explorer",
      intro:
        "A cross-section of member state positions on key files. Filter by policy area; open a file for its map and timeline.",
      allAreas: "All areas",
      dossier: "Dossier",
      noData: "No files with positions for the selected filter.",
      stats: {
        total: "Tracked files",
        byStage: "By procedure stage",
        byArea: "By policy area",
      },
      link: "Open explorer",
      changesLink: "What changed",
    },
  },
};

i18n.addResourceBundle("pl", "translation", trackerPl, true, true);
i18n.addResourceBundle("en", "translation", trackerEn, true, true);
