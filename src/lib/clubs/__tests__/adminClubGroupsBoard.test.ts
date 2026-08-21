// Reguły tablicy działów klubu - tabela przypadków na czystych funkcjach.
//
// CO TEN PLIK DOWODZI.
//   1. PRZECIĄGNIĘCIE, KTÓREGO NIE MA CO ZAPISYWAĆ, zwraca `null` - i to
//      w czterech odmianach: upuszczenie poza listą, upuszczenie na sobie,
//      nieznany element przeciągany, nieznany cel. Bez tej reguły upuszczenie
//      na sobie wysyłało mutację, która nic nie zmienia, a jej błąd COFAŁ widok
//      do odpowiedzi serwera - czyli „nic nie zrobiłem" wyglądało jak awaria.
//   2. NOWA KOLEJNOŚĆ jest przestawieniem, nie zamianą: element wchodzi na
//      pozycję celu, a reszta się przesuwa. Lista identyfikatorów do RPC jedzie
//      w TEJ SAMEJ kolejności co wiersze - to ona jest zapisem.
//   3. ZAWĘŻENIE kolumn CHECK-owych działu w obie strony (wartość ze słownika
//      i wartość spoza) plus odczyt DZIEDZICZENIA z wiersza.
//   4. TRZY STANY tablicy z zachowaną KOLEJNOŚCIĄ sprawdzeń: „w locie" wygrywa
//      z „pusto", bo lokalna kopia kolejności jest pusta, dopóki odpowiedź nie
//      przyjdzie - i szkielet nie może wyglądać jak „brak działów".
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) `toGroupSettings` i `narrowClubEnum`
// z `types.ts` mają własne testy - tu sprawdzamy DOBÓR słownika i to, że
// dziedziczenie dochodzi do wiersza. (2) Hierarchii działów po slugu (to
// `groupTree.ts` i jego test) ta lista nie rysuje. (3) Mechaniki dnd-kit ani
// mutacji RPC - to `ClubGroupsTab.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  clubGroupReorder,
  clubGroupRowStatus,
  clubGroupRowView,
  clubGroupRowVisibility,
  clubGroupsBoardMode,
} from "@/lib/clubs/adminClubGroupsBoard";
import { CLUB_GROUP_STATUSES, CLUB_VISIBILITIES } from "@/lib/clubs/types";
import { CLUB_IDS } from "@/test/clubs/fixtures";
import { adminClubGroupRow } from "@/test/clubs/clubTableFixtures";

const TRZY = [
  adminClubGroupRow({ id: "g1", slug: "pierwszy" }),
  adminClubGroupRow({ id: "g2", slug: "drugi" }),
  adminClubGroupRow({ id: "g3", slug: "trzeci" }),
];

describe("zawężenie kolumn działu", () => {
  it.each(CLUB_GROUP_STATUSES)("status ze słownika zostaje sobą: %s", (status) => {
    expect(clubGroupRowStatus(status)).toBe(status);
  });

  it.each(CLUB_VISIBILITIES)("widoczność ze słownika zostaje sobą: %s", (visibility) => {
    expect(clubGroupRowVisibility(visibility)).toBe(visibility);
  });

  it("wartość spoza słownika degraduje się zachowawczo", () => {
    // „published" jest statusem innej projekcji - w tej kolumnie znaczy
    // „nie wiem", a „nie wiem" ma wyglądać jak wersja robocza.
    expect(clubGroupRowStatus("published")).toBe("draft");
    expect(clubGroupRowStatus("")).toBe("draft");
    expect(clubGroupRowVisibility("world")).toBe("members");
    expect(clubGroupRowVisibility("")).toBe("members");
  });
});

describe("projekcja wiersza działu", () => {
  it("pełny wiersz niesie nazwę, adres, znaczniki i licznik wątków", () => {
    const view = clubGroupRowView(
      adminClubGroupRow({ status: "frozen", visibility: "private", visibility_inherited: false }),
      "pl",
    );

    expect(view).toEqual({
      id: CLUB_IDS.group,
      name: "Dyskusje",
      slug: "dyskusje",
      slugPath: "/dyskusje",
      status: "frozen",
      visibility: "private",
      visibilityInherited: false,
      threadCount: 4,
    });
  });

  it("dziedziczenie z klubu dochodzi do wiersza", () => {
    const view = clubGroupRowView(
      adminClubGroupRow({ visibility: "secret", visibility_inherited: true }),
      "pl",
    );

    expect(view.visibilityInherited).toBe(true);
    expect(view.visibility).toBe("secret");
  });

  it("wiersz CZĘŚCIOWY: pusta nazwa polska sięga po angielską", () => {
    expect(clubGroupRowView(adminClubGroupRow({ name_pl: "" }), "pl").name).toBe("Discussions");
  });

  it("wiersz PUSTY: dział bez wątków pokazuje zero, nie pustkę", () => {
    expect(clubGroupRowView(adminClubGroupRow({ thread_count: 0 }), "en").threadCount).toBe(0);
  });

  it("angielski interfejs bierze nazwę z kolumny angielskiej", () => {
    expect(clubGroupRowView(adminClubGroupRow(), "en-GB").name).toBe("Discussions");
  });
});

describe("trzy stany tablicy działów", () => {
  it("zapytanie w locie wygrywa z pustką", () => {
    expect(clubGroupsBoardMode({ isPending: true, count: 0 })).toBe("pending");
    expect(clubGroupsBoardMode({ isPending: true, count: 3 })).toBe("pending");
  });

  it("brak działów to osobny stan, nie szkielet", () => {
    expect(clubGroupsBoardMode({ isPending: false, count: 0 })).toBe("empty");
  });

  it("lista działów to trzeci stan", () => {
    expect(clubGroupsBoardMode({ isPending: false, count: 1 })).toBe("list");
  });
});

describe("nowa kolejność po przeciągnięciu", () => {
  it("element wchodzi na pozycję celu, a reszta się przesuwa", () => {
    const next = clubGroupReorder(TRZY, "g3", "g1");

    expect(next?.ids).toEqual(["g3", "g1", "g2"]);
    expect(next?.rows.map((g) => g.slug)).toEqual(["trzeci", "pierwszy", "drugi"]);
  });

  it("przeciągnięcie w dół przestawia, a nie zamienia", () => {
    const next = clubGroupReorder(TRZY, "g1", "g3");

    expect(next?.ids).toEqual(["g2", "g3", "g1"]);
  });

  it("wejściowa tablica zostaje nietknięta", () => {
    clubGroupReorder(TRZY, "g1", "g3");

    expect(TRZY.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
  });

  it.each([
    ["upuszczenie poza listą", "g1", null],
    ["upuszczenie na sobie", "g1", "g1"],
    ["nieznany element przeciągany", "brak", "g1"],
    ["nieznany cel", "g1", "brak"],
  ])("%s nie daje czego zapisywać", (_opis, activeId, overId) => {
    expect(clubGroupReorder(TRZY, activeId, overId)).toBeNull();
  });

  it("identyfikator liczbowy z dnd-kit nie trafia w wiersz o identyfikatorze tekstowym", () => {
    // Zachowanie 1:1 z handlerem: porównanie jest bez konwersji, więc liczba
    // nigdy nie „prawie pasuje" do napisu.
    expect(clubGroupReorder(TRZY, 1, "g2")).toBeNull();
  });
});
