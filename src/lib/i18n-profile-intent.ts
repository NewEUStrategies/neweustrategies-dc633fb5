// Nakładka i18n warstwy INTENCJI i KOMPLETNOŚCI profilu (PL/EN).
//
// Rejestruj przez `ensureI18n()` w komponencie trasy (nie side-effectowym
// importem w pliku trasy) - patrz komentarz na końcu pliku i lib/i18n-*.
// Drzewa `pl`/`en` są eksportowane, żeby bramka parytetu mogła sprawdzić, że
// pozostają strukturalnie identyczne.
//
// Dwa korzenie:
//   * `profileIntent`      - katalog "na co jesteś otwarty" + pola swobodne,
//   * `profileCompleteness` - miernik 0-100 z listą braków.
// Etykiety kodów intencji SĄ TŁUMACZENIEM, nie danymi: baza trzyma kody
// (`consortium`), interfejs pokazuje "Konsorcja projektowe (Horizon, Interreg)".
import i18n from "./i18n";

export const profileIntentPl = {
  profileIntent: {
    title: "Czego szukasz",
    subtitle:
      "Katalog mówi, kim jesteś. Ta sekcja mówi, po co ktoś ma się z Tobą skontaktować - i to ona decyduje o dopasowaniu.",
    openToLabel: "Jestem otwarty na",
    openToHint: "Wybierz do {{max}} intencji. Pojawią się jako filtr w katalogu osób.",
    openToLimit: "Maksymalnie {{max}} intencje - odznacz jedną, żeby dodać inną.",
    openToEmpty: "Nie wybrano żadnej intencji.",
    openTo: {
      consortium: "Konsorcja projektowe (Horizon, Interreg, LIFE)",
      partnership: "Partnerstwo instytucjonalne lub biznesowe",
      advisory: "Rada doradcza, ekspertyza, opinia",
      speaking: "Panel, keynote, wystąpienie",
      co_authoring: "Współautorstwo publikacji lub policy paper",
      mentoring: "Mentoring",
      hiring: "Rekrutuję",
      job_change: "Rozważam zmianę roli",
      investment: "Kapitał (pozyskanie albo lokowanie)",
      media: "Kontakt dla dziennikarzy",
    },
    openToShort: {
      consortium: "Konsorcja",
      partnership: "Partnerstwo",
      advisory: "Doradztwo",
      speaking: "Wystąpienia",
      co_authoring: "Współautorstwo",
      mentoring: "Mentoring",
      hiring: "Rekrutacja",
      job_change: "Zmiana roli",
      investment: "Kapitał",
      media: "Media",
    },
    seekingLabel: "Czego szukam",
    seekingLabelPl: "Czego szukam (PL)",
    seekingLabelEn: "Czego szukam (EN)",
    seekingPlaceholder:
      "np. Szukam partnerów do konsorcjum Horizon w obszarze CBAM - potrzebny partner z Europy Południowej.",
    seekingHint:
      "Konkret znajduje się sam: nazwy programów, instrumentów i regionów działają najlepiej. Minimum {{min}} znaków, żeby ten wpis liczył się do kompletności.",
    offeringLabel: "Co oferuję",
    offeringLabelPl: "Co oferuję (PL)",
    offeringLabelEn: "Co oferuję (EN)",
    offeringPlaceholder:
      "np. Dostęp do sieci regulacyjnej w Brukseli, doświadczenie w prowadzeniu WP2 w projektach H2020.",
    charsLeft: "Pozostało {{count}} znaków",
    updatedAt: "Zaktualizowano {{date}}",
    stale:
      "Intencja nie była aktualizowana od {{months}} mies. - odśwież ją, żeby wróciła do rankingu.",
    saved: "Zapisano intencję",
    saveError: "Nie udało się zapisać intencji",
    save: "Zapisz",
    cancel: "Anuluj",
    emptyPublic: "Ta osoba nie opisała jeszcze, czego szuka.",
    semanticHint:
      "Od {{score}} pkt kompletności Twój profil jest znajdowany także semantycznie - po znaczeniu, nie po dosłownej frazie.",
  },
  profileCompleteness: {
    title: "Kompletność profilu",
    score: "{{score}} / 100",
    grade: {
      strong: "Kompletny",
      partial: "Częściowy",
      thin: "Szkicowy",
    },
    meterLabel: "Kompletność profilu: {{score}} na 100",
    nextGain: "+{{gain}} pkt: {{field}}",
    allDone: "Profil jest kompletny - nic nie brakuje.",
    missingHeader: "Do uzupełnienia",
    doneHeader: "Uzupełnione",
    semanticGate: "Semantyczne wyszukiwanie od {{score}} pkt",
    semanticGateReached: "Twój profil jest indeksowany semantycznie",
    fields: {
      avatar: "Zdjęcie profilowe",
      name: "Imię i nazwisko",
      jobTitle: "Stanowisko",
      company: "Organizacja",
      location: "Lokalizacja",
      specialization: "Specjalizacja",
      bio: "Opis (min. {{min}} znaków)",
      openTo: "Na co jesteś otwarty",
      seeking: "Czego szukasz (min. {{min}} znaków)",
      skills: "Umiejętności (min. {{min}})",
      experience: "Doświadczenie zawodowe",
      education: "Wykształcenie",
    },
  },
};

export const profileIntentEn = {
  profileIntent: {
    title: "What you are looking for",
    subtitle:
      "The directory says who you are. This section says why anyone should reach out - and that is what drives matching.",
    openToLabel: "I am open to",
    openToHint: "Pick up to {{max}} intents. They become a filter in the people directory.",
    openToLimit: "Up to {{max}} intents - unselect one to add another.",
    openToEmpty: "No intent selected.",
    openTo: {
      consortium: "Project consortia (Horizon, Interreg, LIFE)",
      partnership: "Institutional or business partnership",
      advisory: "Advisory board, expertise, opinion",
      speaking: "Panel, keynote, speaking slot",
      co_authoring: "Co-authoring a publication or policy paper",
      mentoring: "Mentoring",
      hiring: "Hiring",
      job_change: "Considering a new role",
      investment: "Capital (raising or deploying)",
      media: "Press contact",
    },
    openToShort: {
      consortium: "Consortia",
      partnership: "Partnership",
      advisory: "Advisory",
      speaking: "Speaking",
      co_authoring: "Co-authoring",
      mentoring: "Mentoring",
      hiring: "Hiring",
      job_change: "New role",
      investment: "Capital",
      media: "Press",
    },
    seekingLabel: "What I am looking for",
    seekingLabelPl: "What I am looking for (PL)",
    seekingLabelEn: "What I am looking for (EN)",
    seekingPlaceholder:
      "e.g. Looking for Horizon consortium partners on CBAM - need a partner from Southern Europe.",
    seekingHint:
      "Specifics find themselves: programme names, instruments and regions work best. At least {{min}} characters for this to count towards completeness.",
    offeringLabel: "What I offer",
    offeringLabelPl: "What I offer (PL)",
    offeringLabelEn: "What I offer (EN)",
    offeringPlaceholder:
      "e.g. Access to the Brussels regulatory network, experience leading WP2 in H2020 projects.",
    charsLeft: "{{count}} characters left",
    updatedAt: "Updated {{date}}",
    stale:
      "Your intent has not been updated for {{months}} months - refresh it to bring it back into ranking.",
    saved: "Intent saved",
    saveError: "Could not save your intent",
    save: "Save",
    cancel: "Cancel",
    emptyPublic: "This person has not described what they are looking for yet.",
    semanticHint:
      "From {{score}} completeness points your profile is also found semantically - by meaning, not by a literal phrase.",
  },
  profileCompleteness: {
    title: "Profile completeness",
    score: "{{score}} / 100",
    grade: {
      strong: "Complete",
      partial: "Partial",
      thin: "Sketch",
    },
    meterLabel: "Profile completeness: {{score}} out of 100",
    nextGain: "+{{gain}} pts: {{field}}",
    allDone: "Your profile is complete - nothing missing.",
    missingHeader: "To complete",
    doneHeader: "Completed",
    semanticGate: "Semantic search from {{score}} pts",
    semanticGateReached: "Your profile is indexed semantically",
    fields: {
      avatar: "Profile photo",
      name: "Full name",
      jobTitle: "Job title",
      company: "Organisation",
      location: "Location",
      specialization: "Specialisation",
      bio: "Bio (min. {{min}} characters)",
      openTo: "What you are open to",
      seeking: "What you are looking for (min. {{min}} characters)",
      skills: "Skills (min. {{min}})",
      experience: "Work experience",
      education: "Education",
    },
  },
};

i18n.addResourceBundle("pl", "translation", profileIntentPl, true, true);
i18n.addResourceBundle("en", "translation", profileIntentEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu -
 * nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy. Rejestracja dzieje się przy ewaluacji modułu.
 */
export function ensureI18n(): void {}
