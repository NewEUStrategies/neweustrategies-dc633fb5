// Katalogi taksonomii klubów - REGUŁY wyprowadzone z dwóch organizmów CRUD.
//
// CO TO DOWODZI. Pięć rzeczy, które przed wyprowadzeniem dały się sprawdzić
// wyłącznie przez zamontowanie managera z dialogiem, przełącznikiem i trzema
// atrapami mutacji - i to OSOBNO dla obszarów tematycznych i osobno dla
// specjalizacji, bo każdy z nich miał własną kopię tej samej reguły:
//
//   1. KASOWANIE JEST ODCIĘTE DWOMA NIEZALEŻNYMI POWODAMI: wpis SYSTEMOWY nie
//      kasuje się nigdy (nawet nieużywany), a wpis w UŻYCIU nie kasuje się,
//      dopóki ktokolwiek go używa. Użycie liczy się INACZEJ w każdym katalogu:
//      obszar sumuje kluby i wątki (oba trzymają etykietę), specjalizacja
//      liczy tylko kluby. Pomyłka w tę stronę usuwa wiersz, do którego
//      odwołuje się archiwum.
//   2. OBA JĘZYKI SĄ WYMAGANE, a granica („co najmniej dwa znaki”) jest trafiana
//      dokładnie - razem ze spacjami, bo nazwa ze spacji to nie nazwa.
//   3. KLUCZ I ADRES SĄ NIEZMIENNE PO ZAPISIE i podążają za nazwą polską tylko
//      DO PIERWSZEGO tknięcia pola. Przy edycji walidacja klucza/adresu nie
//      biegnie wcale - wpis w bazie już przeszedł CHECK-a, a normalizacja
//      istniejącego klucza osierociłaby wiersze, które go używają.
//   4. ODMOWA BAZY MA DWIE DROGI: rozpoznany kod (`duplicate key`, `topic_in_use`,
//      `in_use`) jedzie KLUCZEM słownika, a każdy inny błąd SUROWYM tekstem.
//      Zamiana surowego tekstu na ogólne zdanie kasuje jedyną diagnostykę, jaką
//      administrator dostaje z bazy.
//   5. KOLEJNOŚĆ NOWEGO WPISU wynika z OSTATNIEGO wiersza listy (+10), a nie ze
//      stałej - dwa nowe wpisy z tą samą kolejnością rozstrzygałyby się losowo.
//
// Plus przepisanie wiersza RPC na wersję roboczą (kolumny NULL-owalne schodzą
// na pusty napis, żeby pole tekstowe nie stało się niesterowane) i payload
// zapisu z PRZYCIĘTYMI etykietami.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Normalizacji klucza i adresu -
// `slugifyTopicKey`/`isValidTopicKey` mają test w `topics.test.ts`,
// a `clubSlugFromName` w `clubTypes.test.ts`. (2) Tego, czy RPC przyjmie
// payload - to `admin_club_topic_upsert`/`admin_club_specialization_upsert`
// i pgTAP. (3) Renderu katalogów - `ClubTopicsManager.test.tsx`
// i `ClubSpecializationsManager.test.tsx` dowodzą SKLEJENIA, nie reguł od nowa.
import { describe, expect, it } from "vitest";
import {
  CATALOG_MIN_LABEL,
  EMPTY_CLUB_SPECIALIZATION_DRAFT,
  EMPTY_CLUB_TOPIC_DRAFT,
  SPECIALIZATION_MIN_SLUG,
  catalogActiveCount,
  catalogDeleteBlocked,
  catalogLabelsComplete,
  catalogSortOrderValue,
  clubSpecializationDeleteFailure,
  clubSpecializationDraftFromRow,
  clubSpecializationDraftIssue,
  clubSpecializationDraftWithLabelPl,
  clubSpecializationSaveFailure,
  clubSpecializationSaveSlug,
  clubSpecializationUpsertPayload,
  clubSpecializationUsage,
  clubTopicDeleteFailure,
  clubTopicDraftFromRow,
  clubTopicDraftIssue,
  clubTopicDraftWithLabelPl,
  clubTopicSaveFailure,
  clubTopicSaveKey,
  clubTopicUpsertPayload,
  clubTopicUsage,
  nextCatalogSortOrder,
  newClubSpecializationDraft,
  newClubTopicDraft,
  type ClubSpecializationDraft,
  type ClubTopicDraft,
} from "@/lib/clubs/adminTaxonomyCatalog";
import { clubSpecializationAdminRow, clubTopicAdminRow } from "@/test/clubs/catalogFixtures";

function topicDraft(overrides: Partial<ClubTopicDraft> = {}): ClubTopicDraft {
  return { ...EMPTY_CLUB_TOPIC_DRAFT, labelPl: "Energetyka", labelEn: "Energy", ...overrides };
}

function specDraft(overrides: Partial<ClubSpecializationDraft> = {}): ClubSpecializationDraft {
  return {
    ...EMPTY_CLUB_SPECIALIZATION_DRAFT,
    labelPl: "Energetyka",
    labelEn: "Energy",
    slug: "energetyka",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reguły wspólne
// ---------------------------------------------------------------------------

describe("kolejność nowego wpisu", () => {
  it("bierze OSTATNI wiersz listy i dokłada dziesięć", () => {
    expect(nextCatalogSortOrder([{ sort_order: 10 }, { sort_order: 250 }])).toBe(260);
  });

  it("pusta lista startuje od stu - nie od zera i nie od NaN", () => {
    expect(nextCatalogSortOrder([])).toBe(100);
  });

  it("nowa wersja robocza obu katalogów dziedziczy tę kolejność", () => {
    const rows = [{ sort_order: 60 }];

    expect(newClubTopicDraft(rows).sortOrder).toBe(70);
    expect(newClubSpecializationDraft(rows).sortOrder).toBe(70);
  });

  it("nowy wpis jest WŁĄCZONY, bez identyfikatora i niesystemowy", () => {
    const draft = newClubTopicDraft([]);
    const spec = newClubSpecializationDraft([]);

    expect(draft).toMatchObject({ id: null, isActive: true, isSystem: false, key: "" });
    expect(spec).toMatchObject({ id: null, isActive: true, isSystem: false, icon: "Globe2" });
  });
});

describe("licznik nad listą", () => {
  it("liczy WŁĄCZONE wpisy, a nie długość listy", () => {
    const rows = [
      clubTopicAdminRow({ id: "a", is_active: true }),
      clubTopicAdminRow({ id: "b", is_active: false }),
      clubTopicAdminRow({ id: "c", is_active: true }),
    ];

    expect(catalogActiveCount(rows)).toBe(2);
    expect(catalogActiveCount([])).toBe(0);
  });
});

describe("odcięcie kosza - reguła danych, nie kosmetyka przycisku", () => {
  const CASES: readonly [string, boolean, number, boolean][] = [
    ["wpis własny i nieużywany kasuje się", false, 0, false],
    ["wpis SYSTEMOWY nie kasuje się, choć nikt go nie używa", true, 0, true],
    ["wpis w UŻYCIU nie kasuje się, choć nie jest systemowy", false, 1, true],
    ["wpis systemowy I w użyciu nie kasuje się z dwóch powodów", true, 4, true],
  ];

  it.each(CASES)("%s", (_opis, isSystem, usage, blocked) => {
    expect(catalogDeleteBlocked({ is_system: isSystem }, usage)).toBe(blocked);
  });

  it("użycie OBSZARU sumuje kluby i wątki - oba trzymają etykietę", () => {
    expect(clubTopicUsage(clubTopicAdminRow({ clubs_count: 0, threads_count: 3 }))).toBe(3);
    expect(clubTopicUsage(clubTopicAdminRow({ clubs_count: 2, threads_count: 3 }))).toBe(5);
  });

  it("użycie SPECJALIZACJI liczy tylko kluby - wątek nie ma specjalizacji", () => {
    expect(clubSpecializationUsage(clubSpecializationAdminRow({ clubs_count: 7 }))).toBe(7);
  });

  it("obszar używany TYLKO przez wątki też jest odcięty od kasowania", () => {
    const row = clubTopicAdminRow({ clubs_count: 0, threads_count: 1 });

    expect(catalogDeleteBlocked(row, clubTopicUsage(row))).toBe(true);
  });
});

describe("granica dwóch znaków w obu kolumnach", () => {
  const CASES: readonly [string, string, boolean][] = [
    ["Aa", "Bb", true],
    ["A", "Bb", false],
    ["Aa", "B", false],
    ["", "", false],
    ["  ", "Bb", false],
    ["  Aa  ", "  Bb  ", true],
  ];

  it.each(CASES)("PL %s + EN %s => %s", (labelPl, labelEn, complete) => {
    expect(catalogLabelsComplete(labelPl, labelEn)).toBe(complete);
  });

  it("granica jest jedna i jest stałą modułu", () => {
    expect(CATALOG_MIN_LABEL).toBe(2);
  });
});

describe("pole kolejności przyjmuje wyłącznie liczby", () => {
  const CASES: readonly [string, number][] = [
    ["120", 120],
    ["", 0],
    ["abc", 0],
    ["0", 0],
    ["-30", -30],
  ];

  it.each(CASES)("treść %s daje %s", (raw, value) => {
    expect(catalogSortOrderValue(raw)).toBe(value);
  });
});

// ---------------------------------------------------------------------------
// Obszary tematyczne
// ---------------------------------------------------------------------------

describe("wersja robocza obszaru", () => {
  it("przepisuje wiersz RPC pole w pole", () => {
    const row = clubTopicAdminRow({
      id: "topic-9",
      key: "transport",
      label_pl: "Transport",
      label_en: "Transport",
      sort_order: 20,
      is_active: false,
      is_system: true,
    });

    expect(clubTopicDraftFromRow(row)).toEqual({
      id: "topic-9",
      key: "transport",
      labelPl: "Transport",
      labelEn: "Transport",
      sortOrder: 20,
      isActive: false,
      isSystem: true,
    });
  });

  it("klucz PODĄŻA za nazwą polską, dopóki nikt go nie tknął", () => {
    const next = clubTopicDraftWithLabelPl(topicDraft(), "Energetyka jądrowa", false);

    expect(next.key).toBe("energetyka_jadrowa");
    expect(next.labelPl).toBe("Energetyka jądrowa");
  });

  it("klucz TKNIĘTY zostaje na miejscu przy każdej kolejnej literze nazwy", () => {
    const next = clubTopicDraftWithLabelPl(topicDraft({ key: "wlasny" }), "Cokolwiek", true);

    expect(next.key).toBe("wlasny");
    expect(next.labelPl).toBe("Cokolwiek");
  });

  it("klucz ZAPISU jest normalizowany dla nowego wpisu, a przy edycji zamrożony", () => {
    expect(clubTopicSaveKey(topicDraft({ id: null, key: "Energia Jądrowa" }))).toBe(
      "energia_jadrowa",
    );
    expect(clubTopicSaveKey(topicDraft({ id: "topic-1", key: "Energia Jądrowa" }))).toBe(
      "Energia Jądrowa",
    );
  });
});

describe("walidacja obszaru", () => {
  it("brak nazwy w JEDNYM języku wystarcza do odrzucenia", () => {
    expect(clubTopicDraftIssue(topicDraft({ labelEn: "" }))).toBe(
      "adminClubs.topics.errors.labels",
    );
    expect(clubTopicDraftIssue(topicDraft({ labelPl: " " }))).toBe(
      "adminClubs.topics.errors.labels",
    );
  });

  it("nazwy bije klucz: przy pustych nazwach nie mówimy o kluczu", () => {
    // Kolejność komunikatów nie jest kosmetyką - administrator naprawia to,
    // co przeczytał, a nie to, co było pierwszym błędem w kodzie.
    expect(clubTopicDraftIssue(topicDraft({ labelPl: "", key: "x" }))).toBe(
      "adminClubs.topics.errors.labels",
    );
  });

  it("klucz niezgodny z CHECK-iem bazy odrzuca NOWY wpis", () => {
    expect(clubTopicDraftIssue(topicDraft({ id: null, key: "x" }))).toBe(
      "adminClubs.topics.errors.key",
    );
  });

  it("EDYCJA nie waliduje klucza - wpis w bazie już przeszedł CHECK-a", () => {
    expect(clubTopicDraftIssue(topicDraft({ id: "topic-1", key: "x" }))).toBeNull();
  });

  it("kompletna wersja robocza nie ma zastrzeżeń", () => {
    expect(clubTopicDraftIssue(topicDraft({ key: "energetyka" }))).toBeNull();
  });
});

describe("payload zapisu obszaru", () => {
  it("etykiety jadą PRZYCIĘTE, a klucz znormalizowany", () => {
    const payload = clubTopicUpsertPayload(
      topicDraft({
        key: "Energia Odnawialna",
        labelPl: "  Energetyka  ",
        labelEn: "  Energy  ",
        sortOrder: 55,
        isActive: false,
      }),
    );

    expect(payload).toEqual({
      id: null,
      key: "energia_odnawialna",
      labelPl: "Energetyka",
      labelEn: "Energy",
      sortOrder: 55,
      isActive: false,
    });
  });

  it("edycja niesie identyfikator i NIETKNIĘTY klucz", () => {
    const payload = clubTopicUpsertPayload(topicDraft({ id: "topic-3", key: "transport" }));

    expect(payload.id).toBe("topic-3");
    expect(payload.key).toBe("transport");
  });
});

describe("odmowa bazy przy obszarach", () => {
  it("duplikat klucza jedzie ZDANIEM ze słownika", () => {
    expect(
      clubTopicSaveFailure(new Error('duplicate key value violates "club_topics_key"')),
    ).toEqual({
      key: "adminClubs.topics.errors.duplicate",
      text: 'duplicate key value violates "club_topics_key"',
    });
  });

  it("każdy inny błąd zapisu jedzie SUROWYM tekstem z bazy", () => {
    expect(clubTopicSaveFailure(new Error("permission denied for function"))).toEqual({
      key: null,
      text: "permission denied for function",
    });
  });

  it("obszar w użyciu ma własne zdanie, awaria połączenia - surowy tekst", () => {
    expect(clubTopicDeleteFailure(new Error("topic_in_use")).key).toBe(
      "adminClubs.topics.errors.inUse",
    );
    expect(clubTopicDeleteFailure(new Error("network error")).key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Specjalizacje
// ---------------------------------------------------------------------------

describe("wersja robocza specjalizacji", () => {
  it("przepisuje wiersz RPC pole w pole", () => {
    const row = clubSpecializationAdminRow({
      id: "spec-7",
      slug: "transport",
      label_pl: "Transport",
      label_en: "Transport",
      lead_pl: "Zajawka",
      lead_en: "Lead",
      desc_pl: "Opis",
      desc_en: "Description",
      icon: "Ship",
      sort_order: 30,
      is_active: false,
      is_system: true,
    });

    expect(clubSpecializationDraftFromRow(row)).toEqual({
      id: "spec-7",
      slug: "transport",
      labelPl: "Transport",
      labelEn: "Transport",
      leadPl: "Zajawka",
      leadEn: "Lead",
      descPl: "Opis",
      descEn: "Description",
      icon: "Ship",
      sortOrder: 30,
      isActive: false,
      isSystem: true,
    });
  });

  it("dane CZĘŚCIOWE: kolumny NULL-owalne schodzą na PUSTY NAPIS", () => {
    // `null` w polu tekstowym Reacta znaczy pole NIESTEROWANE - pierwsza litera
    // wpisana przez administratora przestałaby się zapisywać w wersji roboczej.
    const draft = clubSpecializationDraftFromRow(
      clubSpecializationAdminRow({
        lead_pl: null,
        lead_en: null,
        desc_pl: null,
        desc_en: null,
      }),
    );

    expect(draft.leadPl).toBe("");
    expect(draft.leadEn).toBe("");
    expect(draft.descPl).toBe("");
    expect(draft.descEn).toBe("");
  });

  it("adres PODĄŻA za nazwą polską, dopóki nikt go nie tknął", () => {
    const next = clubSpecializationDraftWithLabelPl(specDraft(), "Transport i logistyka", false);

    expect(next.slug).toBe("transport-i-logistyka");
  });

  it("adres TKNIĘTY zostaje na miejscu", () => {
    const next = clubSpecializationDraftWithLabelPl(
      specDraft({ slug: "wlasny-adres" }),
      "Cokolwiek",
      true,
    );

    expect(next.slug).toBe("wlasny-adres");
  });

  it("adres ZAPISU jest normalizowany dla nowego wpisu, a przy edycji zamrożony", () => {
    expect(clubSpecializationSaveSlug(specDraft({ id: null, slug: "Transport Morski" }))).toBe(
      "transport-morski",
    );
    expect(clubSpecializationSaveSlug(specDraft({ id: "spec-1", slug: "Transport Morski" }))).toBe(
      "Transport Morski",
    );
  });
});

describe("walidacja specjalizacji", () => {
  it("brak nazwy w JEDNYM języku wystarcza do odrzucenia", () => {
    expect(clubSpecializationDraftIssue(specDraft({ labelEn: "" }))).toBe(
      "adminClubs.specializations.errors.labels",
    );
  });

  it("adres krótszy niż trzy znaki odrzuca NOWY wpis - adres jest w URL-u", () => {
    expect(clubSpecializationDraftIssue(specDraft({ id: null, slug: "ab" }))).toBe(
      "adminClubs.specializations.errors.slug",
    );
    expect(SPECIALIZATION_MIN_SLUG).toBe(3);
  });

  it("adres złożony z samej interpunkcji znika po normalizacji i też odrzuca", () => {
    expect(clubSpecializationDraftIssue(specDraft({ id: null, slug: "!!!" }))).toBe(
      "adminClubs.specializations.errors.slug",
    );
  });

  it("EDYCJA nie waliduje adresu - jest publicznym kontraktem, nie polem", () => {
    expect(clubSpecializationDraftIssue(specDraft({ id: "spec-1", slug: "ab" }))).toBeNull();
  });

  it("kompletna wersja robocza nie ma zastrzeżeń", () => {
    expect(clubSpecializationDraftIssue(specDraft())).toBeNull();
  });
});

describe("payload zapisu specjalizacji", () => {
  it("wszystkie teksty jadą PRZYCIĘTE, a klucz startuje jako adres", () => {
    const payload = clubSpecializationUpsertPayload(
      specDraft({
        slug: "Transport Morski",
        labelPl: "  Transport  ",
        labelEn: "  Transport  ",
        leadPl: "  Zajawka  ",
        leadEn: "  Lead  ",
        descPl: "  Opis  ",
        descEn: "  Description  ",
        icon: "Ship",
        sortOrder: 15,
        isActive: false,
      }),
    );

    expect(payload).toEqual({
      id: null,
      slug: "transport-morski",
      key: "transport-morski",
      labelPl: "Transport",
      labelEn: "Transport",
      leadPl: "Zajawka",
      leadEn: "Lead",
      descPl: "Opis",
      descEn: "Description",
      icon: "Ship",
      sortOrder: 15,
      isActive: false,
    });
  });

  it("edycja niesie identyfikator i NIETKNIĘTY adres", () => {
    const payload = clubSpecializationUpsertPayload(
      specDraft({ id: "spec-4", slug: "energy-market" }),
    );

    expect(payload.id).toBe("spec-4");
    expect(payload.slug).toBe("energy-market");
    expect(payload.key).toBe("energy-market");
  });
});

describe("odmowa bazy przy specjalizacjach", () => {
  it("duplikat adresu jedzie ZDANIEM ze słownika", () => {
    expect(clubSpecializationSaveFailure(new Error("duplicate key on slug")).key).toBe(
      "adminClubs.specializations.errors.duplicate",
    );
  });

  it("każdy inny błąd zapisu jedzie SUROWYM tekstem z bazy", () => {
    expect(clubSpecializationSaveFailure(new Error("statement timeout"))).toEqual({
      key: null,
      text: "statement timeout",
    });
  });

  it("specjalizacja przypisana do klubów ma własne zdanie", () => {
    expect(clubSpecializationDeleteFailure(new Error("specialization_in_use")).key).toBe(
      "adminClubs.specializations.errors.inUse",
    );
    expect(clubSpecializationDeleteFailure(new Error("timeout")).key).toBeNull();
  });
});
