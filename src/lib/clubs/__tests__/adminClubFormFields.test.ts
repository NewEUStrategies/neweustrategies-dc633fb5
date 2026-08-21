// Tabela pól tekstowych zakładki „Ogólne" i łatka z pola do wersji roboczej.
//
// CO TEN PLIK DOWODZI. Tabela `CLUB_GENERAL_TEXT_FIELDS` zastąpiła dziewięć
// przeklejonych bloków JSX-a, więc dowodu wymagają dokładnie te rzeczy, które
// w blokach były niewidoczne dla `tsc` i dla recenzji:
//   1. KOMPLETNOŚĆ I ROZŁĄCZNOŚĆ - każdy klucz wersji roboczej obsługiwany
//      polem tekstowym ma DOKŁADNIE jeden wpis, żaden `id` się nie powtarza
//      (dwa pola o tym samym `id` psują wiązanie etykiety, czyli dostępność).
//   2. LIMITY ZNAKÓW - 120 dla nazw, 200 dla haseł, brak dla kolumn `text`.
//      Limit jest odwzorowaniem kolumny w bazie; jego zgubienie oznacza zapis
//      odrzucony przez serwer po wpisaniu długiej treści.
//   3. ŁATKA TRAFIA W SWÓJ KLUCZ i niesie DOKŁADNIE JEDEN klucz - pomyłka
//      `namePl` / `nameEn` przechodzi przez kompilator, bo oba są napisami.
//   4. SLUG JEST JEDYNYM POLEM NORMALIZOWANYM w drodze do wersji roboczej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tabeli przypadków samej normalizacji sluga
// (`normalizeClubSlugInput`) ani wykrycia jego zmiany (`isClubSlugChanged`) -
// jedno i drugie ma test w `adminClubEditor.test.ts`. Tutaj sprawdzamy tylko,
// że łatka sluga TĘ funkcję woła. Nie ma tu też renderu - kolejność pól
// w interfejsie dowodzi `ClubGeneralTab.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  CLUB_GENERAL_TEXT_FIELDS,
  CLUB_SLUG_CHANGED_WARNING_KEY,
  clubGeneralFieldsIn,
  clubGeneralTextPatch,
  type ClubGeneralFieldGroup,
  type ClubGeneralTextKey,
} from "../adminClubFormFields";

/** Wszystkie klucze, których zakładka obsługuje polem tekstowym. */
const TEXT_KEYS: readonly ClubGeneralTextKey[] = [
  "namePl",
  "nameEn",
  "slug",
  "taglinePl",
  "taglineEn",
  "descriptionPl",
  "descriptionEn",
  "rulesPl",
  "rulesEn",
];

describe("CLUB_GENERAL_TEXT_FIELDS - kompletność tabeli", () => {
  it("ma wpis na KAŻDY klucz tekstowy wersji roboczej i ani jednego więcej", () => {
    expect(CLUB_GENERAL_TEXT_FIELDS.map((field) => field.key)).toEqual(TEXT_KEYS);
  });

  it("każdy `id` jest unikalny - dwa pola o tym samym `id` psują etykietę", () => {
    const ids = CLUB_GENERAL_TEXT_FIELDS.map((field) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CLUB_GENERAL_TEXT_FIELDS)("pole $key ma klucz etykiety z rodziny pól", (field) => {
    expect(field.labelKey).toBe(`adminClubs.fields.${field.key}`);
    expect(field.id.startsWith("club-")).toBe(true);
  });

  it("limity znaków odwzorowują kolumny: nazwy 120, hasła 200, treści bez limitu", () => {
    const limits = new Map(CLUB_GENERAL_TEXT_FIELDS.map((field) => [field.key, field.maxLength]));
    expect(limits.get("namePl")).toBe(120);
    expect(limits.get("nameEn")).toBe(120);
    expect(limits.get("taglinePl")).toBe(200);
    expect(limits.get("taglineEn")).toBe(200);
    expect(limits.get("slug")).toBeUndefined();
    expect(limits.get("descriptionPl")).toBeUndefined();
    expect(limits.get("rulesEn")).toBeUndefined();
  });

  it("wielolinijkowe są WYŁĄCZNIE opisy i zasady - i mają zadaną wysokość", () => {
    const multiline = CLUB_GENERAL_TEXT_FIELDS.filter((field) => field.rows !== undefined);
    expect(multiline.map((field) => [field.key, field.rows])).toEqual([
      ["descriptionPl", 4],
      ["descriptionEn", 4],
      ["rulesPl", 3],
      ["rulesEn", 3],
    ]);
  });

  it("podpowiedź mają DWA pola: slug (psuje linki) i zasady angielskie", () => {
    const hinted = CLUB_GENERAL_TEXT_FIELDS.filter((field) => field.hintKey !== undefined);
    expect(hinted.map((field) => [field.key, field.hintKey])).toEqual([
      ["slug", "adminClubs.fields.slugHint"],
      ["rulesEn", "adminClubs.fields.rulesHint"],
    ]);
  });
});

/** Grupa układu i pola, które MUSZĄ w niej stać, w kolejności formularza. */
const GROUP_CASES: [ClubGeneralFieldGroup, ClubGeneralTextKey[]][] = [
  ["identity", ["namePl", "nameEn"]],
  ["slug", ["slug"]],
  ["tagline", ["taglinePl", "taglineEn"]],
  ["body", ["descriptionPl", "descriptionEn", "rulesPl", "rulesEn"]],
];

describe("clubGeneralFieldsIn - grupy układu", () => {
  it.each(GROUP_CASES)(
    "grupa %s niesie dokładnie swoje pola, w kolejności tabeli",
    (group, expected) => {
      expect(clubGeneralFieldsIn(group).map((field) => field.key)).toEqual(expected);
    },
  );

  it("grupy sumują się do CAŁEJ tabeli - żadne pole nie wypada z formularza", () => {
    const groups: ClubGeneralFieldGroup[] = ["identity", "slug", "tagline", "body"];
    const seen = groups.flatMap((group) => clubGeneralFieldsIn(group).map((field) => field.key));
    expect(seen.slice().sort()).toEqual(TEXT_KEYS.slice().sort());
  });
});

describe("clubGeneralTextPatch - klucz łatki", () => {
  it.each(TEXT_KEYS.filter((key) => key !== "slug"))(
    "pole %s przepisuje treść 1:1 pod swój klucz",
    (key) => {
      const patch = clubGeneralTextPatch(key, "  Klub Energetyczny  ");
      expect(Object.keys(patch)).toEqual([key]);
      // Bez przycinania: przycięcie należy do payloadu zapisu
      // (`clubEditorPayload`), nie do pisania w polu - inaczej nie da się
      // wpisać spacji między wyrazami.
      expect(patch[key]).toBe("  Klub Energetyczny  ");
    },
  );

  it("slug jedzie przez normalizację i nadal niesie tylko swój klucz", () => {
    const patch = clubGeneralTextPatch("slug", "Klub  ENERGII!!");
    expect(Object.keys(patch)).toEqual(["slug"]);
    expect(patch.slug).toBe("klub-energii-");
  });

  it("pusta treść jest łatką, a nie brakiem łatki - wyczyszczenie pola musi dojść", () => {
    const patch = clubGeneralTextPatch("taglinePl", "");
    expect(patch).toEqual({ taglinePl: "" });
  });
});

describe("ostrzeżenie o zmianie sluga", () => {
  it("klucz ostrzeżenia jest kluczem z rodziny pól klubu", () => {
    // Wartość jest DZISIAJ tożsama z podpowiedzią pod polem - to znany defekt
    // treściowy, zgłoszony testem `it.fails` w `ClubGeneralTab.test.tsx`.
    // Tutaj pilnujemy tylko, że nie jest to gotowy tekst ani puste napisanie.
    expect(CLUB_SLUG_CHANGED_WARNING_KEY.startsWith("adminClubs.fields.")).toBe(true);
  });
});
