// Słownik CV autora (PL/EN) - sekcje profilu publicznego i arkusz wydruku PDF.
// Import jako efekt uboczny tam, gdzie CV się montuje:
//   import "@/lib/i18n-author-cv";
//
// PO CO POWSTAŁ. Cała powierzchnia szła przez ręczne `isPl ? "..." : "..."`
// (24 wystąpienia w dwóch plikach), więc żaden napis CV nie istniał w słowniku,
// bramka parytetu PL/EN nie miała czego porównać, a licznik poparć odmieniał
// się wyłącznie po angielsku (`endorsement${count === 1 ? "" : "s"}`) - polski
// dostawał tę samą formę dla 1, 2 i 5. Formy mnogie i18next (`_one`, `_few`,
// `_many`, `_other`) rozstrzygają to poprawnie w obu językach.
import i18n from "./i18n";

export const authorCvPl = {
  authorCv: {
    experience: "Doświadczenie zawodowe",
    education: "Edukacja",
    skills: "Umiejętności",
    interests: "Zainteresowania",
    awards: "Wyróżnienia i certyfikaty",
    roleFallback: "Stanowisko",
    schoolFallback: "Uczelnia",
    /** Otwarty zakres dat („2019 - obecnie"). */
    present: "obecnie",
    endorse: {
      signIn: "Zaloguj się, aby poprzeć",
      ownSkill: "Nie możesz poprzeć własnej umiejętności",
      needConnection: "Aby poprzeć, musisz być połączony w sieci kontaktów",
      remove: "Cofnij poparcie",
      add: "Poprzyj tę umiejętność",
      count_one: "{{count}} osoba poparła",
      count_few: "{{count}} osoby poparły",
      count_many: "{{count}} osób poparło",
      count_other: "{{count}} osób poparło",
    },
    print: {
      buttonTitle: "Pobierz CV jako PDF (drukowanie do pliku)",
      buttonLabel: "Pobierz CV (PDF)",
      fullProfile: "Pełny profil: ",
    },
  },
} as const;

export const authorCvEn = {
  authorCv: {
    experience: "Experience",
    education: "Education",
    skills: "Skills",
    interests: "Interests",
    awards: "Awards & certifications",
    roleFallback: "Role",
    schoolFallback: "School",
    present: "present",
    endorse: {
      signIn: "Sign in to endorse",
      ownSkill: "You can't endorse your own skill",
      needConnection: "Connect first to endorse this skill",
      remove: "Remove endorsement",
      add: "Endorse this skill",
      count_one: "{{count}} endorsement",
      count_other: "{{count}} endorsements",
    },
    print: {
      buttonTitle: "Download CV as PDF (print to file)",
      buttonLabel: "Download CV (PDF)",
      fullProfile: "Full profile: ",
    },
  },
} as const;

i18n.addResourceBundle("pl", "translation", authorCvPl, true, true);
i18n.addResourceBundle("en", "translation", authorCvEn, true, true);
