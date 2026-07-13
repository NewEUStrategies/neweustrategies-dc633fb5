// Supplementary i18n bundle for research programs / specializations (PL/EN).
// Side-effect import this module wherever the feature mounts:
//   import "@/lib/i18n-programs";
// The pl/en objects are exported so a parity test can verify both trees stay
// structurally identical (same rule as the core locale files).
import i18n from "./i18n";

export const programsPl = {
  programs: {
    indexTitle: "Programy badawcze",
    indexIntro:
      "Nasze specjalizacje to trwałe kierunki badań, a nie kategorie treści. Każdy program prowadzi własny zespół, projekty, publikacje, wydarzenia i partnerów.",
    thesis: "Teza i zakres badań",
    scope: "Zakres badań",
    researchQuestions: "Główne pytania badawcze",
    lead: "Lider programu",
    team: "Zespół",
    projects: "Projekty",
    projectStatus: {
      planned: "Planowany",
      active: "W toku",
      completed: "Zakończony",
    },
    latestPublications: "Najnowsze publikacje",
    flagshipReports: "Raporty flagowe",
    podcasts: "Podcasty i wideo",
    events: "Wydarzenia",
    partners: "Partnerzy",
    newsletter: "Newsletter programu",
    newsletterIntro: "Zapisz się, aby otrzymywać analizy i zaproszenia z tego programu.",
    contact: "Kontakt",
    contactIntro: "Masz pytanie do zespołu tego programu? Napisz do nas.",
    contactCta: "Napisz do nas",
    backToPrograms: "Wróć do programów",
    explore: "Poznaj program",
    empty: "Brak opublikowanych programów.",
    sectionEmpty: "Wkrótce.",
    loadError: "Nie udało się wczytać programów. Spróbuj ponownie później.",
    programsCount_one: "{{count}} program",
    programsCount_few: "{{count}} programy",
    programsCount_many: "{{count}} programów",
    programsCount_other: "{{count}} programów",
  },
};

export const programsEn = {
  programs: {
    indexTitle: "Research programs",
    indexIntro:
      "Our specializations are long-running lines of research, not content categories. Each program runs its own team, projects, publications, events and partners.",
    thesis: "Thesis & research scope",
    scope: "Research scope",
    researchQuestions: "Key research questions",
    lead: "Program lead",
    team: "Team",
    projects: "Projects",
    projectStatus: {
      planned: "Planned",
      active: "Active",
      completed: "Completed",
    },
    latestPublications: "Latest publications",
    flagshipReports: "Flagship reports",
    podcasts: "Podcasts & video",
    events: "Events",
    partners: "Partners",
    newsletter: "Program newsletter",
    newsletterIntro: "Subscribe to get analysis and invitations from this program.",
    contact: "Contact",
    contactIntro: "Have a question for this program's team? Get in touch.",
    contactCta: "Contact us",
    backToPrograms: "Back to programs",
    explore: "Explore the program",
    empty: "No programs published yet.",
    sectionEmpty: "Coming soon.",
    loadError: "Failed to load programs. Please try again later.",
    programsCount_one: "{{count}} program",
    programsCount_few: "{{count}} programs",
    programsCount_many: "{{count}} programs",
    programsCount_other: "{{count}} programs",
  },
};

i18n.addResourceBundle("pl", "translation", programsPl, true, true);
i18n.addResourceBundle("en", "translation", programsEn, true, true);
