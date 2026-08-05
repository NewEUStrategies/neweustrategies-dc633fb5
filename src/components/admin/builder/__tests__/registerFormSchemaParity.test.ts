// REGRESJA: panel widgetu "register-form" musi oferować każde pole, które
// czyta renderer.
//
// Bramka `settingsFidelity` łapie tę klasę defektu przez pomiar odczytów przy
// renderze, ale mierzy tylko gałęzie, które faktycznie się wyrenderowały.
// Pola domyślnie ukryte (job, LinkedIn) potrafią przez to przejść niezauważone
// aż do momentu, gdy ktoś je włączy. Ten test porównuje rejestr
// `REGISTER_FIELDS` ze schematem panelu wprost - statycznie, bez renderu -
// więc dokłada pole do rejestru bez kontrolki = czerwone CI od razu.
import { describe, it, expect } from "vitest";
import { REGISTER_FIELDS } from "@/components/blocks/AuthFormBlocks";
import { WIDGET_SCHEMAS, type SchemaField } from "@/lib/builder/schemas";

const capitalize = (key: string): string => `${key.charAt(0).toUpperCase()}${key.slice(1)}`;

interface FieldLike {
  key: string;
  structural?: boolean;
}

/**
 * Klucze, których renderer wymaga dla danego pola: etykieta i placeholder
 * zawsze, przełączniki widoczności i wymagalności tylko dla pól, które da się
 * ukryć (strukturalne wymusza Supabase `signUp`).
 */
function expectedKeys(field: FieldLike): string[] {
  const base = [`${field.key}Label`, `${field.key}Placeholder`];
  if (field.structural) return base;
  return [`show${capitalize(field.key)}`, `require${capitalize(field.key)}`, ...base];
}

/** Zwraca klucze wymagane przez rejestr, których brakuje w schemacie panelu. */
export function missingSchemaKeys(
  fields: ReadonlyArray<FieldLike>,
  schema: ReadonlyArray<SchemaField>,
): string[] {
  const offered = new Set(schema.map((entry) => entry.key));
  return fields
    .flatMap(expectedKeys)
    .filter((key) => !offered.has(key))
    .sort();
}

const REGISTER_SCHEMA = WIDGET_SCHEMAS["register-form"] ?? [];

describe("parytet panelu i renderera: register-form", () => {
  it("schemat panelu istnieje i nie jest pusty", () => {
    expect(REGISTER_SCHEMA.length).toBeGreaterThan(0);
  });

  it("każde pole rejestru ma w panelu widoczność, wymagalność, etykietę i placeholder", () => {
    expect(missingSchemaKeys(REGISTER_FIELDS, REGISTER_SCHEMA)).toEqual([]);
  });

  it("etykiety i placeholdery są dwujęzyczne (i18nText), nie zwykłym tekstem", () => {
    const byKey = new Map(REGISTER_SCHEMA.map((entry) => [entry.key, entry]));
    const wrongType = REGISTER_FIELDS.flatMap((field) =>
      [`${field.key}Label`, `${field.key}Placeholder`].filter(
        (key) => byKey.get(key)?.type !== "i18nText",
      ),
    );
    expect(wrongType).toEqual([]);
  });

  it("pola ukryte domyślnie (job, LinkedIn) też są edytowalne", () => {
    const offered = new Set(REGISTER_SCHEMA.map((entry) => entry.key));
    for (const key of ["job", "linkedin"]) {
      expect(REGISTER_FIELDS.some((field) => field.key === key)).toBe(true);
      expect(offered.has(`show${capitalize(key)}`)).toBe(true);
      expect(offered.has(`require${capitalize(key)}`)).toBe(true);
      expect(offered.has(`${key}Label`)).toBe(true);
      expect(offered.has(`${key}Placeholder`)).toBe(true);
    }
  });

  it("detektor faktycznie failuje, gdy panel gubi pole", () => {
    const stripped = REGISTER_SCHEMA.filter((entry) => !entry.key.startsWith("linkedin"));
    expect(missingSchemaKeys(REGISTER_FIELDS, stripped)).toEqual([
      "linkedinLabel",
      "linkedinPlaceholder",
    ]);
  });
});
