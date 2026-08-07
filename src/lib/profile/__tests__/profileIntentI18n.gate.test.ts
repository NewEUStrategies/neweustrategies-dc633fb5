// Bramka CI: KAŻDY klucz i18n WYLICZANY Z KODU ma tłumaczenie w PL i EN.
//
// Dlaczego osobna bramka obok parytetu PL/EN: parytet porównuje słowniki ze
// sobą, więc klucz nieobecny w OBU jest dla niego niewidzialny - a warstwa
// intencji i miernik kompletności składają klucze DYNAMICZNIE z katalogów
// domenowych (`profileIntent.openTo.<kod>`, `profileCompleteness.fields.<pole>`,
// `network.degree.short.<stopień>`). Dopisanie kodu intencji w
// src/lib/profile/intents.ts albo wagi w completeness.ts bez etykiety kończy
// się surowym kluczem na ekranie - i żadna bramka poza tą tego nie zobaczy.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { profileIntentEn, profileIntentPl } from "@/lib/i18n-profile-intent";
import { networkEn, networkPl } from "@/lib/i18n-network";
import {
  PROFILE_INTENT_CODES,
  profileIntentLabelKey,
  normalizeProfileIntents,
  serializeProfileIntents,
  isProfileIntentCode,
  PROFILE_INTENT_MAX,
} from "@/lib/profile/intents";
import {
  PROFILE_COMPLETENESS_FIELDS,
  profileCompletenessFieldKey,
} from "@/lib/profile/completeness";
import { networkDegreeLabelKey, networkDegreeShortKey } from "@/lib/network/degree";

type Tree = Record<string, unknown>;

function lookup(tree: Tree, key: string): unknown {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Tree)[part];
  }
  return node;
}

/** Klucz jest przetłumaczony, gdy istnieje i jest niepustym stringiem. */
function isTranslated(tree: Tree, key: string): boolean {
  const value = lookup(tree, key);
  return typeof value === "string" && value.trim().length > 0;
}

const BUNDLES: ReadonlyArray<{ lang: "pl" | "en"; tree: Tree }> = [
  { lang: "pl", tree: { ...profileIntentPl, ...networkPl } as Tree },
  { lang: "en", tree: { ...profileIntentEn, ...networkEn } as Tree },
];

describe("klucze wyliczane z katalogu intencji", () => {
  for (const { lang, tree } of BUNDLES) {
    it(`ma pełną etykietę i skrót dla każdego kodu (${lang})`, () => {
      const missing = PROFILE_INTENT_CODES.flatMap((code) => {
        const keys = [profileIntentLabelKey(code), `profileIntent.openToShort.${code}`];
        return keys.filter((key) => !isTranslated(tree, key));
      });
      expect(missing, `brakujące klucze (${lang}): ${missing.join(", ")}`).toEqual([]);
    });
  }
});

describe("klucze wyliczane z tabeli wag kompletności", () => {
  for (const { lang, tree } of BUNDLES) {
    it(`ma etykietę dla każdego pola i każdej oceny (${lang})`, () => {
      const fieldKeys = PROFILE_COMPLETENESS_FIELDS.map(profileCompletenessFieldKey);
      const gradeKeys = ["strong", "partial", "thin"].map(
        (grade) => `profileCompleteness.grade.${grade}`,
      );
      const missing = [...fieldKeys, ...gradeKeys].filter((key) => !isTranslated(tree, key));
      expect(missing, `brakujące klucze (${lang}): ${missing.join(", ")}`).toEqual([]);
    });
  }
});

describe("klucze stopnia sieci", () => {
  for (const { lang, tree } of BUNDLES) {
    it(`ma skrót i pełny opis dla stopni 1/2/3 (${lang})`, () => {
      const keys = ([1, 2, 3] as const).flatMap((degree) => [
        networkDegreeShortKey(degree),
        networkDegreeLabelKey(degree),
      ]);
      const missing = keys.filter((key) => !isTranslated(tree, key));
      expect(missing, `brakujące klucze (${lang}): ${missing.join(", ")}`).toEqual([]);
    });
  }
});

describe("rejestracja nakładki w instancji i18next", () => {
  it("udostępnia etykiety intencji przez t() w obu językach", () => {
    for (const lang of ["pl", "en"] as const) {
      const bundle = i18n.getResourceBundle(lang, "translation") as Tree | undefined;
      expect(bundle, `brak zasobów dla ${lang}`).toBeTruthy();
      expect(isTranslated(bundle ?? {}, "profileIntent.openTo.consortium")).toBe(true);
      expect(isTranslated(bundle ?? {}, "profileCompleteness.fields.bio")).toBe(true);
    }
  });
});

describe("normalizacja kodów intencji", () => {
  it("odsiewa kody spoza katalogu i porządkuje wg katalogu", () => {
    expect(normalizeProfileIntents(["media", "nie_ma", "consortium"])).toEqual([
      "consortium",
      "media",
    ]);
  });

  it("deduplikuje i przycina do sufitu", () => {
    const all = [...PROFILE_INTENT_CODES, ...PROFILE_INTENT_CODES];
    expect(normalizeProfileIntents(all)).toHaveLength(PROFILE_INTENT_MAX);
  });

  it("czyta CSV z URL-a i serializuje w tę samą postać", () => {
    expect(normalizeProfileIntents(" consortium , advisory ")).toEqual(["consortium", "advisory"]);
    expect(serializeProfileIntents(["advisory", "consortium"])).toBe("consortium,advisory");
  });

  it("pusta i nieznana wartość dają pustą listę (brak filtra)", () => {
    expect(normalizeProfileIntents("")).toEqual([]);
    expect(normalizeProfileIntents(null)).toEqual([]);
    expect(normalizeProfileIntents(undefined)).toEqual([]);
    expect(normalizeProfileIntents(["banana"])).toEqual([]);
  });

  it("type guard nie przepuszcza wartości nie-stringowych", () => {
    expect(isProfileIntentCode("consortium")).toBe(true);
    expect(isProfileIntentCode(42)).toBe(false);
    expect(isProfileIntentCode(null)).toBe(false);
  });
});
