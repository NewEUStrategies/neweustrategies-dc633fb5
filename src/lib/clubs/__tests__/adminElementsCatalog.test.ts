// Katalog elementów Klubu - REGUŁY katalogu operacyjnego bez ani jednego renderu.
//
// CO TEN PLIK DOWODZI.
//
//   1. KATALOG POKAZUJE PEŁNE SŁOWNIKI, A WARTOŚCI POCHODZĄ ZE STAŁYCH. Nie
//      „tyle samo wartości”, a TA SAMA tablica (`toBe`): katalog, który pokazuje
//      pięć z siedmiu kodów odmowy, jest gorszy niż jego brak, bo wygląda na
//      kompletny - a lokalna kopia słownika w pliku widoku to dokładnie ten
//      sposób, w jaki taki rozjazd powstaje.
//   2. LICZNIK SEKCJI JEST POLICZONY Z TYCH SAMYCH ZBIORÓW, które sekcja
//      renderuje. Licznik wpisany z ręki kłamie dokładnie tam, gdzie operator
//      patrzy, ŻEBY sprawdzić, czy szukanie coś znalazło.
//   3. KAŻDA SEKCJA NALEŻY DO DOKŁADNIE JEDNEJ ZAKŁADKI, a licznik zakładki
//      jest sumą jej sekcji. Sekcja bez zakładki byłaby nieosiągalna, a sekcja
//      w dwóch - policzona podwójnie.
//   4. SZUKANIE DZIAŁA PO SUROWEJ WARTOŚCI I PO TŁUMACZENIU, bez akcentów
//      i bez wielkości liter, a trafienie w ETYKIETĘ OSI zostawia CAŁĄ oś.
//   5. POD FILTREM ZNIKAJĄ ZBIORY, ALE NIE NARZĘDZIA. Podgląd dostępu, galeria
//      i macierz zostają widoczne zawsze - narzędzie, które znika po wpisaniu
//      litery, wygląda jak awaria.
//   6. PRZEŁĄCZENIE REAKCJI NIE ZJEŻDŻA NA MINUS i nie rusza pozostałych.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tonów i etykiet znaczników - są w atomie
// `ClubBadges` i mają własny plik. (2) Zawartości macierzy uprawnień
// (`capabilityValue`) - to `capabilityMatrix` i test kontraktowy z bazą; tutaj
// sprawdzamy wyłącznie FILTR po nazwie zdolności. (3) Renderu katalogu (karty,
// zakładki, kopiowanie do schowka) - to `ClubElementsCatalog.test.tsx`.
// (4) Istnienia kluczy i18n - pilnuje `adminClubsI18nLoading.gate.test.ts`.
import { describe, expect, it } from "vitest";
import {
  CATALOG_BADGE_DICTS,
  CATALOG_CODE_SOURCES,
  CATALOG_GROUPS,
  CATALOG_INITIAL_DRAFT,
  CATALOG_INITIAL_TALLIES,
  CATALOG_SECTION_SIZE,
  CATALOG_UNFILTERABLE,
  CATALOG_VOCAB_CARDS,
  catalogBadgesVisible,
  catalogCodeKey,
  catalogCodeMatches,
  catalogCodeRows,
  catalogGroupSections,
  catalogGroupSize,
  catalogNothingFound,
  catalogQuery,
  catalogSectionHidden,
  filterCapabilityKeys,
  normalizeCatalogQuery,
  toggleReactionTally,
  visibleVocabValues,
  type CatalogSectionId,
} from "@/lib/clubs/adminElementsCatalog";
import { CAPABILITY_KEYS } from "@/lib/clubs/capabilityMatrix";
import {
  CLUB_ACCESS_REASONS,
  CLUB_ATTRIBUTION_MODES,
  CLUB_GROUP_STATUSES,
  CLUB_INVITE_ERRORS,
  CLUB_JOIN_POLICIES,
  CLUB_LAYOUTS,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_MODERATION_MODES,
  CLUB_NOTIFY_LEVELS,
  CLUB_POST_POLICIES,
  CLUB_QUALITY_REACTIONS,
  CLUB_REACTION_KINDS,
  CLUB_SAVE_ERRORS,
  CLUB_STANCE_REACTIONS,
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
  type ClubReactionTally,
} from "@/lib/clubs/types";

/** Wszystkie osie wszystkich kart - w kolejności renderowania. */
const ALL_AXES = [
  ...CATALOG_VOCAB_CARDS.vocab.flat(),
  ...CATALOG_VOCAB_CARDS.threadVocab.flat(),
  ...CATALOG_VOCAB_CARDS.opsVocab.flat(),
];

describe("słowniki katalogu - wartości pochodzą ze STAŁYCH, nie z kopii", () => {
  it("oś widoczności trzyma DOKŁADNIE tablicę CLUB_VISIBILITIES", () => {
    const axis = ALL_AXES.find((entry) => entry.labelKey === "clubElements.vocab.visibility");
    expect(axis?.values).toBe(CLUB_VISIBILITIES);
    expect(axis?.prefix).toBe("club.visibility");
  });

  it("każda oś ma NIEPUSTY zbiór wartości i prefiks tłumaczeń", () => {
    for (const axis of ALL_AXES) {
      expect(axis.values.length).toBeGreaterThan(0);
      expect(axis.prefix.length).toBeGreaterThan(0);
      expect(axis.labelKey.startsWith("clubElements.vocab.")).toBe(true);
    }
  });

  it("żadna oś nie powtarza się między kartami", () => {
    const keys = ALL_AXES.map((axis) => axis.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reakcje jakości i stanowiska stoją na OSOBNEJ karcie niż reszta wątku", () => {
    const [pierwsza, druga] = CATALOG_VOCAB_CARDS.threadVocab;
    expect(pierwsza.map((axis) => axis.labelKey)).not.toContain(
      "clubElements.vocab.qualityReaction",
    );
    expect(druga.map((axis) => axis.values)).toEqual([
      CLUB_QUALITY_REACTIONS,
      CLUB_STANCE_REACTIONS,
    ]);
  });

  it("osie słowników klubu wskazują stałe z types.ts", () => {
    const byKey = new Map(ALL_AXES.map((axis) => [axis.labelKey, axis.values]));
    expect(byKey.get("clubElements.vocab.joinPolicy")).toBe(CLUB_JOIN_POLICIES);
    expect(byKey.get("clubElements.vocab.attribution")).toBe(CLUB_ATTRIBUTION_MODES);
    expect(byKey.get("clubElements.vocab.whoCanPost")).toBe(CLUB_POST_POLICIES);
    expect(byKey.get("clubElements.vocab.moderation")).toBe(CLUB_MODERATION_MODES);
    expect(byKey.get("clubElements.vocab.notifyLevel")).toBe(CLUB_NOTIFY_LEVELS);
    expect(byKey.get("clubElements.vocab.reaction")).toBe(CLUB_REACTION_KINDS);
    expect(byKey.get("clubElements.vocab.layout")).toBe(CLUB_LAYOUTS);
  });

  it("sekcja znaczników niesie PEŁNE pięć słowników stanu", () => {
    expect(CATALOG_BADGE_DICTS).toEqual([
      CLUB_STATUSES,
      CLUB_GROUP_STATUSES,
      CLUB_VISIBILITIES,
      CLUB_MEMBER_ROLES,
      CLUB_MEMBER_STATUSES,
    ]);
  });

  it("kody odmów mają PEŁNE zbiory i właściwe przestrzenie kluczy", () => {
    expect(CATALOG_CODE_SOURCES.reasons.codes).toBe(CLUB_ACCESS_REASONS);
    expect(CATALOG_CODE_SOURCES.invite.codes).toBe(CLUB_INVITE_ERRORS);
    expect(CATALOG_CODE_SOURCES.save.codes).toBe(CLUB_SAVE_ERRORS);
    expect(catalogCodeKey(CATALOG_CODE_SOURCES.reasons, "tier_too_low")).toBe(
      "club.reason.tier_too_low",
    );
    expect(catalogCodeKey(CATALOG_CODE_SOURCES.invite, "link_expired")).toBe(
      "adminClubs.invitations.error.link_expired",
    );
    expect(catalogCodeKey(CATALOG_CODE_SOURCES.save, "slug_taken")).toBe(
      "adminClubs.create.error.slug_taken",
    );
  });
});

describe("liczniki sekcji - policzone, nie wpisane", () => {
  it("licznik słowników klubu równa się sumie długości ich zbiorów", () => {
    const suma =
      CLUB_VISIBILITIES.length +
      CLUB_JOIN_POLICIES.length +
      CLUB_ATTRIBUTION_MODES.length +
      CLUB_POST_POLICIES.length +
      CLUB_MODERATION_MODES.length +
      CLUB_NOTIFY_LEVELS.length +
      CLUB_REACTION_KINDS.length +
      CLUB_LAYOUTS.length;
    expect(CATALOG_SECTION_SIZE.vocab).toBe(suma);
  });

  it("licznik znaczników równa się sumie pięciu słowników stanu", () => {
    expect(CATALOG_SECTION_SIZE.badges).toBe(
      CLUB_STATUSES.length +
        CLUB_GROUP_STATUSES.length +
        CLUB_VISIBILITIES.length +
        CLUB_MEMBER_ROLES.length +
        CLUB_MEMBER_STATUSES.length,
    );
  });

  it("licznik kodów błędów obejmuje OBA zbiory - zaproszeń i zapisu", () => {
    expect(CATALOG_SECTION_SIZE.errors).toBe(CLUB_INVITE_ERRORS.length + CLUB_SAVE_ERRORS.length);
    expect(CATALOG_SECTION_SIZE.reasons).toBe(CLUB_ACCESS_REASONS.length);
  });

  it("licznik macierzy to liczba zdolności, a reakcji - pełny zbiór rodzajów", () => {
    expect(CATALOG_SECTION_SIZE.matrix).toBe(CAPABILITY_KEYS.length);
    expect(CATALOG_SECTION_SIZE.reactions).toBe(CLUB_REACTION_KINDS.length);
  });

  it("każdy licznik jest dodatni - sekcja z zerem nie miałaby po co istnieć", () => {
    for (const [id, size] of Object.entries(CATALOG_SECTION_SIZE)) {
      expect(size, id).toBeGreaterThan(0);
    }
  });
});

describe("zakładki katalogu", () => {
  it("każda sekcja należy do DOKŁADNIE jednej zakładki", () => {
    const przypisane = CATALOG_GROUPS.flatMap((entry) => entry.sections);
    expect(new Set(przypisane).size).toBe(przypisane.length);
    expect([...przypisane].sort()).toEqual(Object.keys(CATALOG_SECTION_SIZE).sort());
  });

  it("licznik zakładki jest sumą liczników jej sekcji", () => {
    for (const entry of CATALOG_GROUPS) {
      const suma = entry.sections.reduce((sum, id) => sum + CATALOG_SECTION_SIZE[id], 0);
      expect(catalogGroupSize(entry.id), entry.id).toBe(suma);
    }
  });

  it("identyfikator spoza zbioru oddaje pustą listę i zero, a nie wyjątek", () => {
    expect(catalogGroupSections("nie-ma-takiej")).toEqual([]);
    expect(catalogGroupSize("nie-ma-takiej")).toBe(0);
  });
});

describe("normalizacja szukania", () => {
  it("zdejmuje wielkość liter i akcenty", () => {
    expect(normalizeCatalogQuery("Widoczność")).toBe("widocznosc");
    expect(normalizeCatalogQuery("PRÓG")).toBe("prog");
  });

  it("podmienia ł, którego NFD nie rozkłada", () => {
    expect(normalizeCatalogQuery("Zgłoszenie")).toBe("zgloszenie");
  });

  it("obcina spacje brzegowe wpisanego szukania", () => {
    expect(catalogQuery("  Chatham  ")).toBe("chatham");
    expect(catalogQuery("   ")).toBe("");
  });
});

describe("filtr wartości słownika", () => {
  const rows = [
    { value: "chatham", label: "Reguła Chatham House" },
    { value: "attributed", label: "Z podpisem" },
    { value: "anonymous_allowed", label: "Anonim dozwolony" },
  ];

  it("bez szukania zostają WSZYSTKIE wartości", () => {
    expect(visibleVocabValues("Tryb atrybucji", rows, "")).toBe(rows);
  });

  it("trafienie w etykietę osi zostawia CAŁĄ oś", () => {
    expect(visibleVocabValues("Tryb atrybucji", rows, "atrybucji")).toBe(rows);
  });

  it("trafienie w SUROWĄ wartość zostawia tylko ją", () => {
    expect(visibleVocabValues("Tryb atrybucji", rows, "chatham")).toEqual([rows[0]]);
  });

  it("trafienie w TŁUMACZENIE działa bez akcentów", () => {
    expect(visibleVocabValues("Tryb atrybucji", rows, "regula")).toEqual([rows[0]]);
  });

  it("brak trafienia zostawia pustą oś - wiersz się wtedy nie renderuje", () => {
    expect(visibleVocabValues("Tryb atrybucji", rows, "zzz")).toEqual([]);
  });
});

describe("filtr kodów odmowy", () => {
  const translate = (key: string): string =>
    key === "club.reason.tier_too_low" ? "Za niska warstwa planu" : key;

  it("bez szukania wychodzi PEŁNY zbiór kodów źródła", () => {
    const rows = catalogCodeRows(CATALOG_CODE_SOURCES.reasons, translate, "");
    expect(rows.map((row) => row.code)).toEqual([...CLUB_ACCESS_REASONS]);
  });

  it("dopasowuje po SAMYM kodzie", () => {
    const rows = catalogCodeRows(CATALOG_CODE_SOURCES.invite, translate, "link");
    expect(rows.map((row) => row.code)).toEqual(["link_expired", "link_revoked", "link_exhausted"]);
  });

  it("dopasowuje po ZDANIU, gdy operator nie pamięta kodu", () => {
    const rows = catalogCodeRows(CATALOG_CODE_SOURCES.reasons, translate, "warstwa");
    expect(rows).toEqual([{ code: "tier_too_low", sentence: "Za niska warstwa planu" }]);
  });

  it("brak trafienia daje zbiór pusty", () => {
    expect(catalogCodeRows(CATALOG_CODE_SOURCES.save, translate, "zzz")).toEqual([]);
  });

  it("pojedyncze dopasowanie kodu i zdania rozstrzyga catalogCodeMatches", () => {
    expect(catalogCodeMatches("slug_taken", "Adres zajęty", "")).toBe(true);
    expect(catalogCodeMatches("slug_taken", "Adres zajęty", "slug")).toBe(true);
    expect(catalogCodeMatches("slug_taken", "Adres zajęty", "zajety")).toBe(true);
    expect(catalogCodeMatches("slug_taken", "Adres zajęty", "zzz")).toBe(false);
  });
});

describe("filtr macierzy uprawnień", () => {
  it("bez szukania wychodzą WSZYSTKIE zdolności", () => {
    expect(filterCapabilityKeys("")).toEqual([...CAPABILITY_KEYS]);
  });

  it("dopasowuje po fragmencie nazwy zdolności", () => {
    expect(filterCapabilityKeys("moderate")).toEqual(["can_moderate"]);
  });

  it("brak trafienia daje pustą macierz", () => {
    expect(filterCapabilityKeys("zzz")).toEqual([]);
  });
});

describe("co znika pod filtrem", () => {
  it("bez szukania nie znika NIC", () => {
    expect(catalogSectionHidden("reasons", "", false)).toBe(false);
  });

  it("sekcja ze zbiorem znika, gdy filtr nic w niej nie zostawił", () => {
    expect(catalogSectionHidden("reasons", "zzz", false)).toBe(true);
    expect(catalogSectionHidden("errors", "zzz", true)).toBe(false);
  });

  it("narzędzia (dostęp, galeria, macierz) NIE znikają pod filtrem", () => {
    for (const id of ["access", "gallery", "matrix"] as const) {
      expect(CATALOG_UNFILTERABLE.has(id), id).toBe(true);
      expect(catalogSectionHidden(id, "zzz", false), id).toBe(false);
    }
  });

  it("sekcje ze słownikami NIE są na liście narzędzi", () => {
    const zbiory: CatalogSectionId[] = ["vocab", "threadVocab", "opsVocab", "reasons", "errors"];
    for (const id of zbiory) expect(CATALOG_UNFILTERABLE.has(id), id).toBe(false);
  });

  it("sekcja znaczników odpowiada wyłącznie na trafienie w TYTUŁ", () => {
    expect(catalogBadgesVisible("Znaczniki stanu", "")).toBe(true);
    expect(catalogBadgesVisible("Znaczniki stanu", "znaczniki")).toBe(true);
    expect(catalogBadgesVisible("Znaczniki stanu", "moderator")).toBe(false);
  });

  it("„nic nie znaleziono” wymaga filtra I pustki we WSZYSTKICH zbiorach", () => {
    expect(catalogNothingFound("", [0, 0, 0, 0])).toBe(false);
    expect(catalogNothingFound("zzz", [0, 0, 0, 0])).toBe(true);
    expect(catalogNothingFound("zzz", [0, 1, 0, 0])).toBe(false);
  });
});

describe("poglądowy pasek reakcji", () => {
  const tallies: ClubReactionTally[] = [
    { kind: "insightful", total: 7, mine: true },
    { kind: "agree", total: 0, mine: false },
  ];

  it("postawienie reakcji podnosi licznik i zaznacza własną", () => {
    const next = toggleReactionTally(tallies, "agree", false);
    expect(next[1]).toEqual({ kind: "agree", total: 1, mine: true });
  });

  it("cofnięcie reakcji obniża licznik i zdejmuje własną", () => {
    const next = toggleReactionTally(tallies, "insightful", true);
    expect(next[0]).toEqual({ kind: "insightful", total: 6, mine: false });
  });

  it("cofnięcie przy zerowym liczniku NIE zjeżdża na minus", () => {
    const next = toggleReactionTally(tallies, "agree", true);
    expect(next[1].total).toBe(0);
  });

  it("pozostałe reakcje zostają nietknięte (ta sama referencja)", () => {
    const next = toggleReactionTally(tallies, "agree", false);
    expect(next[0]).toBe(tallies[0]);
  });

  it("stan startowy paska ma WSZYSTKIE rodzaje reakcji", () => {
    expect(CATALOG_INITIAL_TALLIES.map((tally) => tally.kind)).toEqual([...CLUB_REACTION_KINDS]);
  });
});

describe("stan startowy podglądu dostępu", () => {
  it("wszystkie wartości należą do słowników bazy", () => {
    expect(CLUB_VISIBILITIES).toContain(CATALOG_INITIAL_DRAFT.visibility);
    expect(CLUB_JOIN_POLICIES).toContain(CATALOG_INITIAL_DRAFT.joinPolicy);
    expect(CLUB_ATTRIBUTION_MODES).toContain(CATALOG_INITIAL_DRAFT.attributionMode);
    expect(CLUB_POST_POLICIES).toContain(CATALOG_INITIAL_DRAFT.whoCanPost);
    expect(CLUB_MODERATION_MODES).toContain(CATALOG_INITIAL_DRAFT.moderationMode);
  });

  it("startowy podgląd nie jest najbardziej OTWARTYM klubem, jaki się da", () => {
    expect(CATALOG_INITIAL_DRAFT.visibility).not.toBe("public");
    expect(CATALOG_INITIAL_DRAFT.joinPolicy).not.toBe("open");
    expect(CATALOG_INITIAL_DRAFT.minTierRank).toBe(0);
  });
});
