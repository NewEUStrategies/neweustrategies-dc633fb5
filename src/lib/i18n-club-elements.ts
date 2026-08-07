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
      index: "Lista klubów",
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
      vocabHint: "Value sets derived from database CHECK constraints - the only source of dropdowns.",
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
      index: "Club list",
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
