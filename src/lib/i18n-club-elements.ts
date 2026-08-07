// Tłumaczenia strony-katalogu elementów Klubu dyskusyjnego (/club/elements).
//
// Osobny plik, bo to powierzchnia POGLĄDOWA - nie chcemy nią puchnąć chunka
// produktowego klubu, który ładuje każdy członek. Struktura pl/en jest
// identyczna (pilnuje tego test parytetu języków).
import i18n from "./i18n";

export const clubElementsPl = {
  clubElements: {
    title: "Klub dyskusyjny - katalog elementów",
    subtitle:
      "Wszystkie elementy interfejsu Klubu dyskusyjnego w jednym miejscu: słowniki, znaczniki, macierz uprawnień, zdanie dostępu i reakcje semantyczne.",
    note: "Strona poglądowa. Dane są przykładowe - nic tu nie zapisuje się do bazy.",
    section: {
      vocab: "Słowniki domenowe",
      vocabHint: "Zbiory wartości wyprowadzone z CHECK-ów w bazie - jedyne źródło dropList.",
      badges: "Znaczniki stanu",
      badgesHint: "Kolor niesie znaczenie: czerwony = odcięte, bursztynowy = czeka na decyzję.",
      access: "Ustawienia dostępu i żywy podgląd",
      accessHint: "Zmień droplisty - zdanie i ostrzeżenia przeliczają się natychmiast.",
      matrix: "Macierz uprawnień",
      matrixHint:
        "Dokumentacja zachowania club_capabilities(). Prawdą rozstrzygającą pozostaje baza.",
      reactions: "Reakcje semantyczne",
      reactionsHint:
        "Po lewej ocena wypowiedzi, po prawej deklaracja własnego zdania. Kliknij, aby przełączyć.",
      reasons: "Powody odmowy dostępu",
      reasonsHint: "Domknięty słownik kodów zwracanych przez club_capabilities().reason.",
      threadVocab: "Słowniki wątku i interakcji",
      threadVocabHint:
        "Rodzaj wątku zmienia jego cykl życia, nie tylko etykietę. Reakcje dzielą się na dwie rozłączne grupy - stanowisko wyklucza poprzednie, ocena jakości nie.",
      opsVocab: "Słowniki operacyjne",
      opsVocabHint:
        "Zapraszanie, moderacja i dziennik. Dziennik notuje więcej rodzajów zdarzeń, niż da się wywołać jako akcję moderacyjną.",
      gallery: "Żywe elementy interfejsu",
      galleryHint:
        "Prawdziwe komponenty produktu z przykładowymi danymi - nie zrzuty ekranu. Zmiana tokenów motywu widać tu natychmiast.",
      errors: "Słowniki odmów",
      errorsHint:
        'Domknięte zbiory kodów. Każdy kod ma własne zdanie, bo każdy ma inny następny krok - dlatego panel nie mówi już jednego "Nie udało się zapisać".',
      routes: "Trasy modułu",
      routesHint: "Realne widoki produkcyjne Klubu dyskusyjnego.",
    },
    vocab: {
      visibility: "Widoczność klubu",
      joinPolicy: "Polityka wstępu",
      attribution: "Tryb atrybucji",
      whoCanPost: "Kto zakłada temat",
      moderation: "Tryb moderacji",
      status: "Status klubu",
      groupStatus: "Status grupy",
      role: "Rola w klubie",
      memberStatus: "Status członkostwa",
      notifyLevel: "Poziom powiadomień",
      reaction: "Rodzaje reakcji",
      layout: "Układ strony klubu",
      threadKind: "Rodzaj wątku",
      threadStatus: "Status wątku",
      threadSort: "Sortowanie tematów",
      replySort: "Sortowanie odpowiedzi",
      activitySort: "Sortowanie strumienia",
      stance: "Stanowisko",
      subscription: "Obserwowanie wątku",
      qualityReaction: "Reakcje - ocena wypowiedzi",
      stanceReaction: "Reakcje - deklaracja zdania",
      inviteChannel: "Kanał zaproszenia",
      invitationStatus: "Status zaproszenia",
      moderationAction: "Akcje moderacyjne",
      logAction: "Zdarzenia w dzienniku",
      logTarget: "Cel wpisu w dzienniku",
    },
    gallery: {
      layouts: "Układy listy tematów",
      layoutsHint: "Przełącz układ - lista poniżej przerysowuje się tak, jak zrobi to klub.",
      layoutWhy: {
        list: "Lista niczego nie wyróżnia. Każdy temat ma tę samą wagę - to jest właściwe dla bieżącej debaty.",
        cards:
          "Karty pokazują fragment treści. Bez fragmentu siatka jest tylko listą w dwóch kolumnach.",
        magazine:
          "Magazyn wyróżnia PIERWSZY wątek listy, czyli ten przypięty przez redakcję - a bez przypięcia po prostu najgorętszy.",
      },
      cover: "Okładka klubu",
      coverHint: "Ten sam komponent w trzech sytuacjach.",
      coverBanner: "Pas na stronie klubu (3:1, od sm 4:1)",
      coverCard: "Kafel w katalogu (16:9)",
      coverFallback: "Kafel bez okładki",
      coverRule:
        "Reguła: bez okładki pas NIE rysuje się wcale (pusty pas nad tytułem jest gorszy niż jego brak), a kafel dostaje zastępnik, żeby siatka nie rozjechała się wysokościami.",
      stance: "Pasek stanowisk",
      stanceHint:
        'Tylko dla wątku typu "stanowisko". Kliknij - stanowiska wykluczają się wzajemnie, więc poprzednie znika.',
      follow: "Obserwowanie wątku",
      followHint: "Trzy stany, nie dwa: brak własnego ustawienia to NIE to samo, co wyciszenie.",
      followDefault: "brak ustawienia",
      followLive: "działający",
      hubAccess: "Stan dostępu na stronie głównej",
      hubAccessHint:
        "Bramka miękka - rozstrzyga wyłącznie, jaki panel narysować. Twardą trzyma club_capabilities w bazie.",
    },
    errors: {
      invite: "Zapraszanie i dołączanie",
      save: "Zapis klubu w panelu",
    },
    matrix: {
      capability: "Zdolność",
      legendYes: "zawsze wolno",
      legendCond: "zależy od ustawień klubu lub grupy",
      legendNo: "nigdy",
    },
    reactions: {
      full: "Wariant pełny (temat)",
      compact: "Wariant zwinięty (odpowiedź)",
    },
    routes: {
      index: "Strona główna klubów",
      elements: "Katalog elementów (ta strona)",
      about: "O klubie",
      thread: "Wątek dyskusji",
      newThread: "Nowy temat",
      join: "Realizacja zaproszenia",
      admin: "Panel administracyjny klubów",
    },
  },
};

export const clubElementsEn = {
  clubElements: {
    title: "Discussion Club - element catalogue",
    subtitle:
      "Every Discussion Club interface element in one place: vocabularies, state badges, the capability matrix, the access sentence and semantic reactions.",
    note: "Reference page. All data is sample data - nothing is written to the database.",
    section: {
      vocab: "Domain vocabularies",
      vocabHint:
        "Value sets derived from database CHECK constraints - the only source of dropdowns.",
      badges: "State badges",
      badgesHint: "Colour carries meaning: red = cut off, amber = awaiting a human decision.",
      access: "Access settings and live preview",
      accessHint: "Change the dropdowns - the sentence and warnings recompute instantly.",
      matrix: "Capability matrix",
      matrixHint: "Documentation of club_capabilities() behaviour. The database remains the truth.",
      reactions: "Semantic reactions",
      reactionsHint:
        "Quality judgement on the left, your own stance on the right. Click to toggle.",
      reasons: "Access denial reasons",
      reasonsHint: "Closed vocabulary of codes returned by club_capabilities().reason.",
      threadVocab: "Thread and interaction vocabularies",
      threadVocabHint:
        "A thread kind changes its life cycle, not just its label. Reactions split into two disjoint groups - a stance replaces the previous one, a quality judgement does not.",
      opsVocab: "Operational vocabularies",
      opsVocabHint:
        "Inviting, moderation and the log. The log records more kinds of event than can be triggered as a moderation action.",
      gallery: "Live interface elements",
      galleryHint:
        "Real product components with sample data - not screenshots. A change of theme tokens shows here immediately.",
      errors: "Refusal vocabularies",
      errorsHint:
        'Closed sets of codes. Every code has its own sentence because every one has a different next step - which is why the panel no longer says a single "Failed to save".',
      routes: "Module routes",
      routesHint: "The real production views of the Discussion Club.",
    },
    vocab: {
      visibility: "Club visibility",
      joinPolicy: "Join policy",
      attribution: "Attribution mode",
      whoCanPost: "Who can start a topic",
      moderation: "Moderation mode",
      status: "Club status",
      groupStatus: "Group status",
      role: "Club role",
      memberStatus: "Membership status",
      notifyLevel: "Notification level",
      reaction: "Reaction kinds",
      layout: "Club page layout",
      threadKind: "Thread kind",
      threadStatus: "Thread status",
      threadSort: "Topic sorting",
      replySort: "Reply sorting",
      activitySort: "Activity feed sorting",
      stance: "Position",
      subscription: "Thread following",
      qualityReaction: "Reactions - judging a contribution",
      stanceReaction: "Reactions - declaring your view",
      inviteChannel: "Invitation channel",
      invitationStatus: "Invitation status",
      moderationAction: "Moderation actions",
      logAction: "Events in the log",
      logTarget: "Log entry target",
    },
    gallery: {
      layouts: "Topic list layouts",
      layoutsHint: "Switch the layout - the list below redraws exactly as the club will.",
      layoutWhy: {
        list: "A list singles out nothing. Every topic carries the same weight - right for a live debate.",
        cards: "Cards show an excerpt. Without it the grid is just a list in two columns.",
        magazine:
          "Magazine features the FIRST thread in the list, i.e. the one the editors pinned - and without a pin, simply the hottest.",
      },
      cover: "Club cover",
      coverHint: "The same component in three situations.",
      coverBanner: "Banner on the club page (3:1, 4:1 from sm)",
      coverCard: "Directory tile (16:9)",
      coverFallback: "Tile without a cover",
      coverRule:
        "The rule: with no cover the banner is NOT drawn at all (an empty band above the title is worse than none), while a tile gets a placeholder so the grid does not go ragged.",
      stance: "Position bar",
      stanceHint:
        'Only for threads of kind "position". Click - positions are mutually exclusive, so the previous one disappears.',
      follow: "Thread following",
      followHint: "Three states, not two: having no setting of your own is NOT the same as muting.",
      followDefault: "no setting",
      followLive: "interactive",
      hubAccess: "Access state on the hub",
      hubAccessHint:
        "A soft gate - it decides only which panel to draw. The hard one is club_capabilities in the database.",
    },
    errors: {
      invite: "Inviting and joining",
      save: "Saving a club in the panel",
    },
    matrix: {
      capability: "Capability",
      legendYes: "always allowed",
      legendCond: "depends on club or group settings",
      legendNo: "never",
    },
    reactions: {
      full: "Full variant (topic)",
      compact: "Collapsed variant (reply)",
    },
    routes: {
      index: "Clubs home",
      elements: "Element catalogue (this page)",
      about: "About the club",
      thread: "Discussion thread",
      newThread: "New topic",
      join: "Invite redemption",
      admin: "Clubs admin panel",
    },
  },
};

i18n.addResourceBundle("pl", "translation", clubElementsPl, true, true);
i18n.addResourceBundle("en", "translation", clubElementsEn, true, true);

/** No-op wołany w komponencie trasy - patrz komentarz w i18n-club.ts. */
export function ensureClubElementsI18n(): void {}
