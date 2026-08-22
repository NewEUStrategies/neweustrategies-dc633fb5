// Atomy listy czytelniczej: siatka, tytuł, powód rekomendacji, kafelki
// obserwowanych, zakładki.
//
// CO TO DOWODZI. Pięć czystych decyzji wyprowadzonych z 636-linijkowej trasy
// `/reading-list`. Każda ma konsekwencję, którą czytelnik widzi:
//   * `gridColsClass` - liczba kolumn przychodzi z panelu administratora, więc
//     funkcja MUSI mieć sensowne wyjście dla wartości, której nie zna;
//   * `savedPageTitle` - pozycja bez tytułu w żadnym języku musi zostać
//     KLIKALNA, bo czytelnik sam ją zapisał; ostatnim zapasem jest slug;
//   * `reasonBadgeKey` - „dlaczego to widzę": jeden powód, najbardziej osobisty,
//     i KLUCZ zamiast tekstu (inaczej bramka parytetu PL/EN nie ma czego
//     porównywać);
//   * `buildFollowChips` - kolejność i identyfikatory kafelków obserwowanych;
//   * `readingListTabs` - wyłączona sekcja NIE MOŻE zostawić zakładki, która
//     prowadzi do pustki.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Renderu sekcji (organizmy `SavedSection`,
// `FollowedSection`, `GuestSavedSection`), odczytu magazynu gościa
// (`src/lib/readingList/__tests__/guestSaved.test.ts`) i personalizacji
// ustawień (`usePersonalizedSettings` ma własne testy).
import { describe, expect, it } from "vitest";

import type { PersonalizedSectionConfig } from "@/hooks/usePersonalizedSettings";

import { buildFollowChips } from "../followChips";
import { gridColsClass } from "../gridColsClass";
import { REASON_PRIORITY, reasonBadgeKey } from "../reasonBadge";
import { readingListTabs } from "../readingListTabs";
import { localizedTitle, savedPageTitle } from "../savedTitle";

describe("gridColsClass", () => {
  it.each([
    { cols: 2, klasa: "grid-cols-1 md:grid-cols-2" },
    { cols: 4, klasa: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4" },
    { cols: 3, klasa: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" },
  ])("$cols kolumn -> $klasa", ({ cols, klasa }) => {
    expect(gridColsClass(cols)).toBe(klasa);
  });

  it.each([0, 1, 5, 12, -1, 2.5, Number.NaN])(
    "nieznana wartość %s spada na układ trzykolumnowy",
    (cols) => {
      // Wartość przychodzi z panelu administratora, więc „nieznana" nie jest
      // hipotezą - to każda liczba poza 2 i 4.
      expect(gridColsClass(cols)).toBe("grid-cols-1 md:grid-cols-2 lg:grid-cols-3");
    },
  );

  it("klasy są PEŁNYMI literałami - skaner Tailwinda czyta literały", () => {
    // `lg:grid-cols-${cols}` nie wygenerowałoby CSS-u, więc siatka rozjechałaby
    // się w produkcji, a w teście jednostkowym nic by tego nie pokazało.
    for (const cols of [2, 3, 4]) {
      expect(gridColsClass(cols)).toMatch(/^grid-cols-1( md:grid-cols-2)?( lg:grid-cols-\d)?$/);
    }
  });
});

describe("localizedTitle i savedPageTitle", () => {
  it.each([
    {
      nazwa: "PL dla interfejsu PL",
      row: { title_pl: "Polski", title_en: "English" },
      lang: "pl" as const,
      oczekiwane: "Polski",
    },
    {
      nazwa: "EN dla interfejsu EN",
      row: { title_pl: "Polski", title_en: "English" },
      lang: "en" as const,
      oczekiwane: "English",
    },
    {
      nazwa: "brak EN - spadek na PL",
      row: { title_pl: "Polski", title_en: null },
      lang: "en" as const,
      oczekiwane: "Polski",
    },
    {
      nazwa: "brak PL - spadek na EN",
      row: { title_pl: null, title_en: "English" },
      lang: "pl" as const,
      oczekiwane: "English",
    },
    {
      nazwa: "pusty ciąg traktowany jak brak",
      row: { title_pl: "", title_en: "English" },
      lang: "pl" as const,
      oczekiwane: "English",
    },
    {
      nazwa: "brak obu wersji",
      row: { title_pl: null, title_en: null },
      lang: "pl" as const,
      oczekiwane: null,
    },
  ])("$nazwa", ({ row, lang, oczekiwane }) => {
    expect(localizedTitle(row, lang)).toBe(oczekiwane);
  });

  it("ciąg z samych spacji JEST wartością niepustą - reguła zastana", () => {
    // Kanoniczny `pickLocalized` z `lib/i18n` uznałby to za pustkę. Tutaj
    // obowiązuje starsza, słabsza reguła (`title_pl || title_en`), w której
    // " " przechodzi. Podmiana zmieniłaby to, co czytelnik widzi na liście -
    // więc jest przypięta, nie poprawiona.
    expect(localizedTitle({ title_pl: " ", title_en: "English" }, "pl")).toBe(" ");
  });

  it("strona bez tytułu w żadnym języku dostaje slug - musi zostać klikalna", () => {
    expect(savedPageTitle({ title_pl: null, title_en: null, slug: "o-nas" }, "pl")).toBe("o-nas");
  });

  it("tytuł wygrywa ze slugiem, gdy istnieje", () => {
    expect(savedPageTitle({ title_pl: "O nas", title_en: null, slug: "o-nas" }, "pl")).toBe(
      "O nas",
    );
  });
});

describe("reasonBadgeKey - jeden powód, najbardziej osobisty", () => {
  it("kolejność priorytetu jest kontraktem", () => {
    // RPC zwraca `reasons` jako tablicę BEZ gwarancji kolejności, więc
    // priorytet musi stać po stronie klienta - i musi być przypięty.
    expect([...REASON_PRIORITY]).toEqual(["author", "category", "tag", "history", "fresh"]);
  });

  it.each([
    { reasons: ["author"], klucz: "readingList.reasons.author" },
    { reasons: ["category"], klucz: "readingList.reasons.category" },
    { reasons: ["tag"], klucz: "readingList.reasons.tag" },
    { reasons: ["history"], klucz: "readingList.reasons.history" },
    { reasons: ["fresh"], klucz: "readingList.reasons.fresh" },
  ])("pojedynczy powód $reasons -> $klucz", ({ reasons, klucz }) => {
    expect(reasonBadgeKey(reasons)).toBe(klucz);
  });

  it("obserwowany AUTOR bije obserwowaną kategorię i tag", () => {
    expect(reasonBadgeKey(["fresh", "tag", "category", "author"])).toBe(
      "readingList.reasons.author",
    );
  });

  it("kategoria bije tag", () => {
    expect(reasonBadgeKey(["tag", "category"])).toBe("readingList.reasons.category");
  });

  it("kolejność w tablicy z RPC nie ma znaczenia", () => {
    expect(reasonBadgeKey(["category", "author"])).toBe(reasonBadgeKey(["author", "category"]));
  });

  it.each([
    { nazwa: "brak argumentu", reasons: undefined },
    { nazwa: "pusta tablica", reasons: [] },
    { nazwa: "wyłącznie nieznane kody", reasons: ["nowy-kod-z-nowszego-rpc"] },
  ])("$nazwa daje null - pusty badge się nie renderuje", ({ reasons }) => {
    expect(reasonBadgeKey(reasons)).toBeNull();
  });

  it("nieznany kod nie zasłania znanego", () => {
    expect(reasonBadgeKey(["nieznany", "tag"])).toBe("readingList.reasons.tag");
  });

  it("zwraca KLUCZ, nie gotowy tekst", () => {
    expect(reasonBadgeKey(["author"])).toMatch(/^readingList\.reasons\.[a-z]+$/);
  });
});

describe("buildFollowChips", () => {
  const sources = {
    authors: [
      { id: "a1", display_name: "Anna Kowalska", avatar_url: "/a.jpg", slug: "anna-kowalska" },
    ],
    cats: [{ id: "c1", name_pl: "Energetyka", name_en: "Energy", slug: "energetyka" }],
    tags: [{ id: "t1", name: "atom", slug: "atom" }],
  };

  it("zachowuje kolejność: autorzy, kategorie, tagi", () => {
    expect(buildFollowChips(sources, "pl").map((c) => c.type)).toEqual([
      "author",
      "category",
      "tag",
    ]);
  });

  it("kafelek autora prowadzi na jego profil", () => {
    const [autor] = buildFollowChips(sources, "pl");
    expect(autor).toMatchObject({
      id: "a1",
      label: "Anna Kowalska",
      href: { to: "/author/$slug", params: { slug: "anna-kowalska" } },
      avatarUrl: "/a.jpg",
    });
  });

  it("autor BEZ sluga nie dostaje odnośnika, ale zostaje na liście", () => {
    // Odnośnik na `/author/null` byłby 404; kafelek nadal ma pokazać, kogo
    // czytelnik obserwuje.
    const bezSluga = {
      ...sources,
      authors: [{ id: "a2", display_name: "Bez sluga", avatar_url: null, slug: null }],
    };
    expect(buildFollowChips(bezSluga, "pl")[0].href).toBeNull();
  });

  it("autor bez nazwy dostaje KLUCZ zapasowy, nie polski literał", () => {
    const anonim = {
      ...sources,
      authors: [{ id: "a3", display_name: null, avatar_url: null, slug: "x" }],
    };
    const [kafelek] = buildFollowChips(anonim, "pl");
    expect(kafelek.label).toBeNull();
    expect(kafelek.fallbackKey).toBe("readingList.anonymousAuthor");
  });

  it("kategoria bierze nazwę w języku interfejsu", () => {
    expect(buildFollowChips(sources, "en")[1].label).toBe("Energy");
    expect(buildFollowChips(sources, "pl")[1].label).toBe("Energetyka");
  });

  it("kategoria bez nazwy angielskiej spada na polską", () => {
    const bezEn = {
      ...sources,
      cats: [{ id: "c2", name_pl: "Tylko PL", name_en: "", slug: "pl" }],
    };
    expect(buildFollowChips(bezEn, "en")[1].label).toBe("Tylko PL");
  });

  it("tag dostaje krzyżyk w etykiecie", () => {
    expect(buildFollowChips(sources, "pl")[2]).toMatchObject({
      label: "#atom",
      href: { to: "/tag/$slug", params: { slug: "atom" } },
    });
  });

  it("puste źródła dają pustą listę kafelków", () => {
    expect(buildFollowChips({ authors: [], cats: [], tags: [] }, "pl")).toEqual([]);
  });
});

describe("readingListTabs", () => {
  /** Sekcja w PEŁNYM kształcie konfiguracji personalizacji. */
  function section(enabled: boolean, heading: string): PersonalizedSectionConfig {
    return { enabled, heading, description: "", columns: 3 };
  }

  function sections(enabled: { saved: boolean; followed: boolean; recommended: boolean }) {
    return {
      saved: section(enabled.saved, "Zapisane"),
      followed: section(enabled.followed, "Obserwowane"),
      recommended: section(enabled.recommended, "Polecane"),
    };
  }

  it("wszystkie włączone sekcje dają trzy zakładki w stałej kolejności", () => {
    const tabs = readingListTabs(sections({ saved: true, followed: true, recommended: true }));
    expect(tabs.map((t) => t.id)).toEqual(["saved", "followed", "recommended"]);
    expect(tabs.map((t) => t.label)).toEqual(["Zapisane", "Obserwowane", "Polecane"]);
  });

  it("wyłączona sekcja NIE zostawia zakładki", () => {
    // Zakładka bez sekcji prowadzi czytelnika do pustki bez wyjaśnienia.
    const tabs = readingListTabs(sections({ saved: true, followed: false, recommended: true }));
    expect(tabs.map((t) => t.id)).toEqual(["saved", "recommended"]);
  });

  it("wszystkie sekcje wyłączone dają zero zakładek", () => {
    expect(
      readingListTabs(sections({ saved: false, followed: false, recommended: false })),
    ).toEqual([]);
  });

  it("kolejność nie zależy od tego, które sekcje są włączone", () => {
    const tabs = readingListTabs(sections({ saved: false, followed: true, recommended: true }));
    expect(tabs.map((t) => t.id)).toEqual(["followed", "recommended"]);
  });
});
