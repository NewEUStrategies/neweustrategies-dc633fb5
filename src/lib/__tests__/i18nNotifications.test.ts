// Parzystosc PL/EN slownika powiadomien + pokrycie kluczy uzywanych w kodzie.
//
// Druga i TRZECIA czesc tego pliku sa wazniejsze od pierwszej. Ta powierzchnia
// stala na `t(key, { defaultValue: "<polski tekst>" })` bez wpisu w zadnym
// bundlu, czyli EN dostawal polskie napisy - i ZADNA bramka tego nie widziala,
// bo `check:i18n-parity` porownuje drzewa kluczy, a brak wpisu to nie rozjazd.
// Dlatego mierzymy od strony KODU: kazdy klucz `notifications.*` faktycznie
// wolany w komponentach musi istniec w obu jezykach.
//
// CZEGO NIE WIDZIALA POPRZEDNIA WERSJA TEGO TESTU (i dlatego doszla czesc 3):
// skanowanie regexem lapie wylacznie klucze DOSLOWNE. Panel ustawien renderuje
// etykiety przez `t(`notifications.settings.kinds.${kind}`)`, a panel zgod przez
// `t(`notifications.consents.items.${key}.title`)` - klucze SKLEJANE z katalogu.
// Brak wpisu nie byl wiec rozjazdem PL/EN, tylko cisza w obu jezykach naraz:
// siedemnascie z osiemnastu przelacznikow rodzaju pokazywalo surowy slug z bazy
// („crm_task", „profile_view"), a kazda zgoda RODO - swoj klucz rejestru
// („marketing_email") zamiast nazwy oswiadczenia, na ktore uzytkownik odpowiada.
// Czesc 3 mierzy te klucze od strony KATALOGU, ktory je generuje.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { notificationsResources } from "@/lib/i18n-notifications";
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_GROUPS } from "@/lib/notifications/preferences";
import { CONSENT_CATALOG } from "@/lib/notifications/consentCatalog";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

// Polszczyzna ma cztery formy liczby mnogiej, angielszczyzna dwie - `_few`
// i `_many` NIE MAJA odpowiednika w EN i ich brak nie jest rozjazdem. Ta sama
// regula co w `src/lib/ci/i18nParity.ts` (PL_ONLY_PLURAL), powtorzona tu
// dlatego, ze ten test porownuje drzewa BEZPOSREDNIO, bez tamtej warstwy.
const PL_ONLY_PLURAL = /_(few|many)$/;

function comparableKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => !PL_ONLY_PLURAL.test(key)).sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" ? [] : walk(full);
    }
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Klucze `notifications.*` realnie wolane w kodzie powierzchni powiadomien.
 *
 * `src/lib/notifications` doszlo do korzeni razem z wydzieleniem czystych
 * selektorow z komponentow: po ekstrakcji czesc napisow ma szanse trafic do
 * warstwy danych, a skan, ktory jej nie widzi, milczalby o brakujacym kluczu.
 */
function usedKeys(): string[] {
  const roots = [
    "src/components/notifications",
    "src/lib/notifications",
    "src/routes/profile.notifications.tsx",
  ];
  const files = roots.flatMap((root) => (statSync(root).isDirectory() ? walk(root) : [root]));
  const keys = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*"(notifications\.[A-Za-z0-9_.]+)"/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

/**
 * Zwezenie zasobu i18next do `Tree` BEZ rzutowania.
 *
 * Rzutowanie przez `unknown` przeszloby kompilacje, ale przepuscilo by tez
 * wartosc, ktora drzewem NIE jest (liczba, tablica, null w srodku) - a wtedy
 * `flatten` zwrocilby niepelna liste kluczy i test parytetu bylby zielony na
 * niekompletnym drzewie. Ta funkcja SPRAWDZA ksztalt w czasie wykonania i przy
 * okazji jest asercja: slownik ma byc drzewem napisow, nic innego.
 */
function asTree(value: unknown, path = "notificationsResources"): Tree {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`test: ${path} nie jest drzewem zasobow i18next`);
  }
  const out: Tree = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = typeof child === "string" ? child : asTree(child, `${path}.${key}`);
  }
  return out;
}

/** Odczyt wartosci spod sciezki z kropkami; `undefined`, gdy klucza nie ma. */
function readKey(tree: Tree, path: string): string | undefined {
  const value = path.split(".").reduce<string | Tree | undefined>((node, part) => {
    if (typeof node !== "object" || node === null) return undefined;
    return node[part];
  }, tree);
  return typeof value === "string" ? value : undefined;
}

describe("i18n-notifications", () => {
  const plTree = asTree(notificationsResources.pl);
  const enTree = asTree(notificationsResources.en);
  const pl = flatten(plTree).sort();
  const en = flatten(enTree).sort();

  it("ma identyczny zestaw kluczy w PL i EN (poza formami mnogimi wylacznie polskimi)", () => {
    expect(comparableKeys(pl)).toEqual(comparableKeys(en));
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = [notificationsResources.pl, notificationsResources.en]
      .map((tree) => JSON.stringify(tree))
      .join(" ");
    expect(values).not.toContain("—");
    expect(values).not.toContain('""');
  });

  it("pokrywa KAZDY klucz notifications.* wolany w kodzie", () => {
    const missing = usedKeys().filter((key) => !pl.includes(key));
    expect(missing).toEqual([]);
  });

  it("PL i EN roznia sie trescia - inaczej jeden z jezykow jest kopia drugiego", () => {
    // Regresja na sedno tej luki: bundle mogly powstac przez skopiowanie
    // polskiego drzewa i podmiane samych kluczy. Porownujemy WARTOSCI kilku
    // napisow, ktore w obu jezykach musza byc rozne.
    const probes = [
      ["notifications.title", "Powiadomienia", "Notifications"],
      ["notifications.settings.digestOff", "Wyłączony", "Off"],
      ["notifications.filters.unread", "Nieprzeczytane", "Unread"],
      [
        "notifications.settings.kinds.crm_task",
        "Zadania i follow-upy CRM",
        "CRM tasks and follow-ups",
      ],
      [
        "notifications.consents.items.marketing_email.title",
        "E-maile marketingowe",
        "Marketing emails",
      ],
    ] as const;
    for (const [key, expectedPl, expectedEn] of probes) {
      expect(readKey(plTree, key)).toBe(expectedPl);
      expect(readKey(enTree, key)).toBe(expectedEn);
    }
  });

  // ---------------------------------------------------------------------------
  // Czesc 3: klucze SKLEJANE z katalogow. Regex ich nie widzi, wiec ich brak nie
  // jest ani rozjazdem parytetu, ani niepokrytym kluczem - jest surowym slugiem
  // na ekranie w obu jezykach naraz.
  // ---------------------------------------------------------------------------
  describe("klucze dynamiczne wyprowadzone z katalogow", () => {
    it("kazdy rodzaj powiadomienia ma etykiete w PL i EN", () => {
      const missing = NOTIFICATION_KINDS.flatMap((kind) => {
        const path = `notifications.settings.kinds.${kind}`;
        return [
          readKey(plTree, path) ? [] : [`pl:${path}`],
          readKey(enTree, path) ? [] : [`en:${path}`],
        ].flat();
      });
      expect(missing).toEqual([]);
    });

    it("etykieta rodzaju nie jest surowym slugiem z bazy", () => {
      // Wpis `crm_task: "crm_task"` przeszedlby test obecnosci wyzej i nadal
      // pokazywalby uzytkownikowi nazwe kolumny.
      const slugs = NOTIFICATION_KINDS.filter(
        (kind) =>
          readKey(plTree, `notifications.settings.kinds.${kind}`) === kind ||
          readKey(enTree, `notifications.settings.kinds.${kind}`) === kind,
      );
      expect(slugs).toEqual([]);
    });

    it("kazda sekcja ustawien ma nazwe i podpowiedz w PL i EN", () => {
      const missing = NOTIFICATION_KIND_GROUPS.flatMap((group) =>
        [
          `notifications.settings.kindGroups.${group.id}`,
          `notifications.settings.kindGroups.${group.id}Hint`,
        ].flatMap((path) =>
          [
            readKey(plTree, path) ? [] : [`pl:${path}`],
            readKey(enTree, path) ? [] : [`en:${path}`],
          ].flat(),
        ),
      );
      expect(missing).toEqual([]);
    });

    it("kazda zgoda z katalogu RODO ma nazwe i opis w PL i EN", () => {
      const missing = CONSENT_CATALOG.flatMap((definition) =>
        [
          `notifications.consents.items.${definition.key}.title`,
          `notifications.consents.items.${definition.key}.description`,
        ].flatMap((path) =>
          [
            readKey(plTree, path) ? [] : [`pl:${path}`],
            readKey(enTree, path) ? [] : [`en:${path}`],
          ].flat(),
        ),
      );
      expect(missing).toEqual([]);
    });

    it("kazda kategoria zgod ma nazwe w PL i EN", () => {
      const categories = [...new Set(CONSENT_CATALOG.map((definition) => definition.category))];
      const missing = categories.flatMap((category) => {
        const path = `notifications.consents.categories.${category}`;
        return [
          readKey(plTree, path) ? [] : [`pl:${path}`],
          readKey(enTree, path) ? [] : [`en:${path}`],
        ].flat();
      });
      expect(missing).toEqual([]);
    });

    it("nazwa zgody nie jest surowym kluczem rejestru", () => {
      const slugs = CONSENT_CATALOG.filter(
        (definition) =>
          readKey(plTree, `notifications.consents.items.${definition.key}.title`) ===
            definition.key ||
          readKey(enTree, `notifications.consents.items.${definition.key}.title`) ===
            definition.key,
      ).map((definition) => definition.key);
      expect(slugs).toEqual([]);
    });
  });
});
