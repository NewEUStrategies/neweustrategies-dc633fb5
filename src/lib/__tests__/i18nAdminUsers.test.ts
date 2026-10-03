// Nakładka karty i listy użytkowników (`i18n-admin-users`) kontra rdzeń:
// etykiety ról `admin.users.roles.*`.
//
// CO BYŁO ŹLE. Rdzeń (`src/lib/locale/*.ts`) ma `admin.users.roles.{admin,
// editor,author,user}`, a nakładka trzymała KOPIĘ całej gałęzi z
// overwrite=true - i angielskie `admin` rozjechało się: rdzeń „Administrator",
// nakładka „Admin" (to drugie przypina `rolesAndLabels.test.ts`). Napis roli
// zależał więc od tego, czy nakładka zdążyła się już zarejestrować, a na
// serwerze (jeden magazyn i18next na isolate) - od tego, czy isolate
// renderował wcześniej panel użytkowników.
//
// JEDNO ŹRÓDŁO PRAWDY: klucze, które rdzeń ma, należą do rdzenia; nakładka
// DOKŁADA wyłącznie to, czego rdzeń nie ma (`super_admin`).
//
// Kolejność importów jest częścią testu: rdzeń (oba języki, przez `i18nReal`)
// i odczyt etykiet PRZED nakładką, potem nakładka importem dynamicznym.
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import { realT } from "@/test/i18nReal";
import { APP_ROLES } from "@/lib/authz/roles";
import { ROLE_LABEL_KEYS, roleLabel } from "@/lib/authz/roleLabels";

const LANGS = ["pl", "en"] as const;

/**
 * Zdjęcie rdzenia sprzed nakładki. Eksport jest nietykalny od `storeCopy`
 * w `i18n.ts` (`i18nCoreExportsPristine.test.ts`); zdjęcie to bezpiecznik.
 */
const CORE = structuredClone({ pl: corePl, en: coreEn });

const LABELS_BEFORE = LANGS.flatMap((lang) =>
  APP_ROLES.map((role) => ({ lang, role, label: roleLabel(realT(lang), role) })),
);

/** Drzewa, które nakładka wpisuje do magazynu - przechwycone przy rejestracji. */
const writes: Array<{ lang: string; tree: unknown }> = [];
const original = i18n.addResourceBundle.bind(i18n);
const spy = vi
  .spyOn(i18n, "addResourceBundle")
  .mockImplementation((lng, ns, resources, deep, overwrite) => {
    writes.push({ lang: lng, tree: resources });
    return original(lng, ns, resources, deep, overwrite);
  });
await import("@/lib/i18n-admin-users");
spy.mockRestore();

function leafKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return prefix === "" ? [] : [prefix];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    leafKeys(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("i18n-admin-users - etykiety ról kontra rdzeń", () => {
  it("nakładka zarejestrowała się w obu językach (kontrola narzędzia)", () => {
    expect(writes.map((write) => write.lang).sort()).toEqual(["en", "pl"]);
  });

  it.each(LANGS)("%s: nakładka sama wnosi `super_admin` w tym języku", (lang) => {
    // „Super admin" brzmi tak samo w PL i EN, więc brak wpisu EN chowa się za
    // fallbackiem na polski - asercja na napisie (`roleLabel` niżej) go nie widzi.
    const trees = writes.filter((write) => write.lang === lang).map((write) => write.tree);
    expect(trees.flatMap((tree) => leafKeys(tree))).toContain(ROLE_LABEL_KEYS.super_admin);
  });

  it("nakładka nie powtarza kluczy rdzenia - dokłada tylko brakujące", () => {
    const duplicated = writes.flatMap(({ lang, tree }) => {
      const core = new Set(leafKeys(lang === "en" ? CORE.en : CORE.pl));
      return leafKeys(tree)
        .filter((key) => core.has(key))
        .map((key) => `${lang}:${key}`);
    });
    expect(duplicated, "klucz należy do rdzenia - zmiana brzmienia idzie do locale/*.ts").toEqual(
      [],
    );
  });

  it("etykieta roli jest ta sama przed i po załadowaniu nakładki", () => {
    // Rola bez klucza w rdzeniu (`super_admin`) przed nakładką nie ma czego
    // pokazać - tę porównujemy osobno niżej.
    const changed = LABELS_BEFORE.filter(({ role }) => role !== "super_admin")
      .filter(({ lang, role, label }) => roleLabel(realT(lang), role) !== label)
      .map(
        ({ lang, role, label }) => `${lang}:${role} ${label} -> ${roleLabel(realT(lang), role)}`,
      );
    expect(changed).toEqual([]);
  });

  it("super_admin wnosi WYŁĄCZNIE nakładka - i robi to w obu językach", () => {
    for (const lang of LANGS) {
      expect(leafKeys(CORE[lang])).not.toContain(ROLE_LABEL_KEYS.super_admin);
      expect(roleLabel(realT(lang), "super_admin")).toBe("Super admin");
    }
  });

  it.each([
    ["pl", "Administrator"],
    ["en", "Admin"],
  ] as const)("rdzeń %s niesie etykietę administratora, którą widzi panel", (lang, label) => {
    expect(roleLabel(realT(lang), "admin")).toBe(label);
    expect(CORE[lang].admin.users.roles.admin).toBe(label);
  });
});
