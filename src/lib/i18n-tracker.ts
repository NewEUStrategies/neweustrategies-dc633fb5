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
    loadError: "Nie udało się wczytać trackera. Spróbuj ponownie później.",
    notFound: "Nie znaleziono dossier.",
    backToIndex: "Wróć do trackera",
    progressLabel: "Postęp procedury legislacyjnej",
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
    loadError: "Could not load the tracker. Please try again later.",
    notFound: "File not found.",
    backToIndex: "Back to the tracker",
    progressLabel: "Legislative procedure progress",
  },
};

i18n.addResourceBundle("pl", "translation", trackerPl, true, true);
i18n.addResourceBundle("en", "translation", trackerEn, true, true);
