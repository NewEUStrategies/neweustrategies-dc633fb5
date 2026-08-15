// Słownik ekranu trackera legislacyjnego w administracji (PL/EN) - źródła,
// harmonogram pobrań, diagnostyka ticka i kolejka powiadomień push.
//
// PO CO POWSTAŁ. Ekran niósł TRZY kopie bliźniaka
// `const L = (pl, en) => (lang === "pl" ? pl : en)` - po jednej na komponent.
// 52 napisy istniały wyłącznie w kodzie, w tym komunikaty diagnostyczne
// mówiące operatorowi, czy pobranie się powiodło i ile powiadomień poszło
// w świat. Bramka parytetu nie miała czego z czym porównać.
import i18n from "./i18n";

const pl = {
  adminTracker: {
    tickComplete_one: "Tick uruchomiony. Wysłano {{count}} powiadomienie.",
    tickComplete_few: "Tick uruchomiony. Wysłano {{count}} powiadomienia.",
    tickComplete_many: "Tick uruchomiony. Wysłano {{count}} powiadomień.",
    tickComplete_other: "Tick uruchomiony. Wysłano {{count}} powiadomień.",
    dossierSaved: "Zapisano dossier",
    euLegislativeTracker: "Tracker legislacyjny UE",
    dossiersTheirStagesUpdateTimeline:
      "Dossier, ich etapy i oś czasu aktualizacji. Aktualizacja z etapem powiadamia obserwujących.",
    howWorks: "Jak to działa?",
    runTickNow: "Uruchom tick teraz",
    newDossier: "Nowe dossier",
    editDossier: "Edycja dossier",
    reference: "Referencja",
    area: "Obszar",
    stage: "Etap",
    importance: "Waga",
    low: "niska",
    medium: "średnia",
    key: "kluczowa",
    rapporteur: "Sprawozdawca",
    leadCommittee: "Komisja wiodąca",
    commissionDg: "DG Komisji",
    nextMilestonePl: "Nast. kamień PL",
    nextMilestoneEn: "Nast. kamień EN",
    milestoneDate: "Data kamienia",
    sourceUrl: "Źródło (URL)",
    save: "Zapisz",
    cancel: "Anuluj",
    edit: "Edytuj",
    positions: "Stanowiska",
    links: "Powiązania",
    update: "Aktualizacja",
    positionsSaved: "Zapisano stanowiska",
    memberStatePositions: "Stanowiska państw członkowskich",
    rowWithoutStancePublishedNote:
      "Wiersz bez stanowiska nie jest publikowany. Nota jest opcjonalna (max 500 znaków).",
    loading: "Wczytywanie...",
    stance: "stanowisko",
    none: "— brak —",
    notePl: "Nota PL",
    savePositions: "Zapisz stanowiska",
    relatedFiles: "Powiązane akty",
    remove: "Usuń",
    linksYet: "Brak powiązań.",
    dossier: "Dossier",
    chooseDossier: "Wybierz dossier",
    relation: "Relacja",
    addLink: "Dodaj powiązanie",
    close: "Zamknij",
    updatePublishedFollowersWereNotified:
      "Aktualizacja opublikowana — obserwujący dostali powiadomienie",
    addUpdate: "Dodaj aktualizację",
    stageChangeOptional: "Zmiana etapu (opcjonalnie)",
    stageChange: "— bez zmiany etapu —",
    publish: "Opublikuj",
  },
};

const en = {
  adminTracker: {
    tickComplete_one: "Tick complete. {{count}} notification sent.",
    tickComplete_other: "Tick complete. {{count}} notifications sent.",
    dossierSaved: "Dossier saved",
    euLegislativeTracker: "EU legislative tracker",
    dossiersTheirStagesUpdateTimeline:
      "Dossiers, their stages and update timeline. A staged update notifies followers.",
    howWorks: "How it works?",
    runTickNow: "Run tick now",
    newDossier: "New dossier",
    editDossier: "Edit dossier",
    reference: "Reference",
    area: "Area",
    stage: "Stage",
    importance: "Importance",
    low: "low",
    medium: "medium",
    key: "key",
    rapporteur: "Rapporteur",
    leadCommittee: "Lead committee",
    commissionDg: "Commission DG",
    nextMilestonePl: "Next milestone PL",
    nextMilestoneEn: "Next milestone EN",
    milestoneDate: "Milestone date",
    sourceUrl: "Source (URL)",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    positions: "Positions",
    links: "Links",
    update: "Update",
    positionsSaved: "Positions saved",
    memberStatePositions: "Member state positions",
    rowWithoutStancePublishedNote:
      "A row without a stance is not published. The note is optional (max 500 chars).",
    loading: "Loading...",
    stance: "stance",
    none: "— none —",
    notePl: "Note PL",
    savePositions: "Save positions",
    relatedFiles: "Related files",
    remove: "Remove",
    linksYet: "No links yet.",
    dossier: "Dossier",
    chooseDossier: "Choose a dossier",
    relation: "Relation",
    addLink: "Add link",
    close: "Close",
    updatePublishedFollowersWereNotified: "Update published — followers were notified",
    addUpdate: "Add update",
    stageChangeOptional: "Stage change (optional)",
    stageChange: "— no stage change —",
    publish: "Publish",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
