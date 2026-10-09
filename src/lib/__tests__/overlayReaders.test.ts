// KAŻDA NAKŁADKA I KAŻDY KLUCZ MA CZYTELNIKA W KODZIE PRODUKCYJNYM.
//
// Bramki i18n patrzą na słowniki z dwóch stron, ale żadna nie pyta, czy ktoś
// w ogóle CZYTA to, co słownik wnosi:
//   * parytet porównuje PL z EN - martwy klucz jest w obu, więc jest zielony;
//   * bramka rozjazdu (`i18nKeyDrift`) idzie od kodu do słownika - klucz bez
//     wywołania nie istnieje dla niej wcale.
// Stąd całe martwe słowniki: `i18n-admin-event-sessions.ts` (1131 linii,
// korzenie `eventSessions` i `adminEventSessions`) przeżył ekran, który go
// czytał - agenda przeszła na `i18n-admin-event-agenda` - i dalej był
// tłumaczony, poprawiany i liczony w parytecie, choć żaden użytkownik nie mógł
// zobaczyć ani jednego jego zdania. Poprawka wniesiona tam zamiast w żywym
// słowniku przechodzi KAŻDĄ bramkę i nie zmienia na ekranie nic.
//
// TRZY POZIOMY:
//   1. KORZEŃ nakładki bez żadnego czytelnika = martwy słownik. Wyjątkiem są
//      wyłącznie nakładki-zasiewy F1-F5 (spec B.14): foundation zakłada je
//      z góry, żeby tory A/B/C nie konfliktowały na wspólnych plikach - ich
//      kontrakt przypina `participantOverlays.test.ts`.
//   2. `uploadArea` - wspólna kopia obszaru wgrywania: klucz, którego nie czyta
//      żadna powierzchnia, jest tylko kosztem tłumacza i fałszywym tropem przy
//      poprawkach („poprawiłem uploadArea.cta, a przycisk się nie zmienił").
//   3. `eventHead` - jedzie w chunku startowym KAŻDEJ strony. Klucz bez
//      czytelnika jest dopuszczalny wyłącznie jako zasiew tytułu trasy F1-F5,
//      której tor jeszcze nie wniósł.
//
// Lista zasiewów jest JEDNOKIERUNKOWA (jak ratchety `check:i18n-hardcoded`):
// gdy tor doda trasę czytającą zasiew, test nie pada - wpis można wtedy zdjąć.
//
// CZYTELNIK to plik spoza testów (`__tests__`, `*.test.*`, `src/test`) i spoza
// samych nakładek, który - po zdjęciu komentarzy - zawiera klucz jako literał,
// odwołanie w mapie albo prefiks klucza sklejanego (`uploadArea.devices.${d}`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import { maskComments, scanKeyUsage, type KeyUsage } from "@/lib/ci/i18nKeyUsage";
import type { ResourceTree } from "@/lib/ci/i18nParity";

/**
 * LENIWY glob, nie `eager`: nakładki ładujemy po kolei w teście i po każdej
 * odczytujemy, jakie korzenie DOSZŁY do słownika. Tylko tak korzeń da się
 * przypisać plikowi, który go wnosi (eager wykonałby wszystkie naraz).
 */
const OVERLAY_LOADERS = import.meta.glob("/src/lib/i18n-*.ts");

/**
 * Korzenie nakładek-zasiewów F1-F5 bez importera. Kontrakt zasiewu (nazwy
 * plików, eksporty, `ensureI18n`) przypina `src/lib/__tests__/participantOverlays.test.ts`.
 */
const F1_F5_SEED_ROOTS: ReadonlySet<string> = new Set([
  "eventPlan",
  "eventCalendar",
  "eventTicketActions",
  "adminEventOffers",
  "adminEventFollowUp",
]);

/**
 * Korzenie nakładek-zasiewów PR2 (wykresy i mapy danych w blokach i widgetach).
 * Integrator zakłada je z góry z kanonicznymi nazwami schematów barw i metod
 * podziału, żeby równoległe tory (render mapy, edytor wykresu, edytor mapy)
 * nie konfliktowały na wspólnych plikach słownika. Czytelników wnoszą tory:
 * `chartsMap` - `ChoroplethMap.tsx` i legenda mapy, `chartEditor` - arkusz
 * danych wykresu, `mapEditor` - edytor mapy. Wpis zdejmuje się, gdy korzeń
 * dostanie czytelnika (lista jest jednokierunkowa, jak zasiewy F1-F5).
 */
const PR2_SEED_ROOTS: ReadonlySet<string> = new Set(["chartsMap", "chartEditor", "mapEditor"]);

/**
 * Tytuły tras F1-F5 zasiane w `i18n-event-head` (punkt 5 kontraktu
 * w `participantOverlays.test.ts`): trasa przekazania biletu (tor B),
 * weryfikacji certyfikatu i „Po wydarzeniu" (tor C) jeszcze nie istnieją.
 */
const EVENT_HEAD_SEEDS: ReadonlySet<string> = new Set([
  "eventHead.transferTitle",
  "eventHead.certificateTitle",
  "eventHead.followUpTitle",
]);

interface Source {
  readonly file: string;
  readonly text: string;
}

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...productionFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Źródła produkcyjne bez testowej infrastruktury i bez samych nakładek. */
function readers(): Source[] {
  return productionFiles("src")
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.startsWith("src/test/"))
    .filter((file) => !/^src\/lib\/i18n-[^/]+\.ts$/.test(file))
    .map((file) => ({ file, text: readFileSync(file, "utf8") }));
}

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rootsOf(lang: "pl" | "en"): string[] {
  const bundle: unknown = i18n.getResourceBundle(lang, "translation");
  return isTree(bundle) ? Object.keys(bundle) : [];
}

/** Pełne ścieżki liści drzewa (`uploadArea.csv.title`). */
function leaves(tree: ResourceTree, prefix: string): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = `${prefix}.${key}`;
    return isTree(value) ? leaves(value, path) : [path];
  });
}

/** Gałąź słownika PL po zarejestrowaniu nakładek. */
function branch(root: string): ResourceTree {
  const bundle: unknown = i18n.getResourceBundle("pl", "translation");
  const node = isTree(bundle) ? bundle[root] : undefined;
  if (!isTree(node)) throw new Error(`test: brak gałęzi \`${root}\` w słowniku PL`);
  return node;
}

/** Czy użycie z kodu sięga liścia `leaf` (wprost, prefiksem albo końcówką nazwy). */
function reaches(usage: KeyUsage, leaf: string): boolean {
  const bare = leaf.replace(/_(zero|one|two|few|many|other)$/, "");
  if (usage.kind === "prefix") return leaf.startsWith(`${usage.key}.`);
  if (usage.kind === "partial") return leaf.startsWith(usage.key);
  return usage.key === leaf || usage.key === bare;
}

let sources: Source[] = [];
/** Skan całego `src` trwa sekundy - jeden na korzeń, nie jeden na asercję. */
const unreadCache = new Map<string, string[]>();

function unreadLeaves(root: string): string[] {
  const cached = unreadCache.get(root);
  if (cached) return cached;
  const usages = sources.flatMap(({ file, text }) =>
    scanKeyUsage(file, text, { referencePrefixes: [root] }),
  );
  const unread = leaves(branch(root), root).filter((leaf) => !usages.some((u) => reaches(u, leaf)));
  unreadCache.set(root, unread);
  return unread;
}

/** Korzeń -> plik nakładki, która go wniosła. */
const rootOwner = new Map<string, string>();

beforeAll(async () => {
  for (const [file, load] of Object.entries(OVERLAY_LOADERS)) {
    const before = new Set(rootsOf("pl"));
    await load();
    for (const root of rootsOf("pl")) if (!before.has(root)) rootOwner.set(root, file);
  }
  sources = readers();
}, 120_000);

describe("korzenie nakładek mają czytelnika", () => {
  it("skan widzi nakładki i źródła - inaczej reszta byłaby zielona i ślepa", () => {
    // Kanarek: korzeń, który ISTNIEJE wyłącznie w nakładce i na pewno jest
    // czytany. Gdyby glob nie wykonał nakładek, mapa byłaby pusta.
    expect(rootOwner.get("uploadArea")).toBe("/src/lib/i18n-upload-area.ts");
    expect(rootOwner.size).toBeGreaterThan(100);
    expect(sources.length).toBeGreaterThan(1000);
  });

  it("żadna nakładka nie rejestruje korzenia, którego nikt nie czyta (poza zasiewami F1-F5 i PR2)", () => {
    const masked = sources.map(({ text }) => maskComments(text)).join("\n");
    const unread = [...rootOwner.entries()]
      .filter(([root]) => !F1_F5_SEED_ROOTS.has(root))
      .filter(([root]) => !PR2_SEED_ROOTS.has(root))
      .filter(([root]) => !new RegExp(`["'\`]${root}(?=["'\`.])`).test(masked))
      .map(([root, file]) => `${root} (${file})`);

    expect(unread, "martwy słownik - usuń nakładkę albo podepnij ekran, który ją czyta").toEqual(
      [],
    );
  });
});

describe("`uploadArea` - wspólna kopia obszaru wgrywania", () => {
  it("każdy klucz ma powierzchnię, która go czyta", () => {
    expect(unreadLeaves("uploadArea")).toEqual([]);
  });

  it("klucze sklejane liczą się po prefiksie: etykiety urządzeń są czytane", () => {
    // `CoverImagePicker` woła `t(\`uploadArea.devices.${d}\`)` - bez obsługi
    // prefiksu te trzy liście wyglądałyby na martwe.
    const unread = unreadLeaves("uploadArea");
    expect(leaves(branch("uploadArea"), "uploadArea")).toContain("uploadArea.devices.tablet");
    expect(unread).not.toContain("uploadArea.devices.tablet");
  });
});

describe("`eventHead` - słownik chunku startowego", () => {
  it("klucz bez czytelnika jest wyłącznie zasianym tytułem trasy F1-F5", () => {
    const unread = unreadLeaves("eventHead");
    expect(unread.filter((leaf) => !EVENT_HEAD_SEEDS.has(leaf))).toEqual([]);
  });

  it("tytuły zakładek i paneli mają czytelników (mapa w `eventTabHead`, trasa „Moje”)", () => {
    const unread = unreadLeaves("eventHead");
    for (const leaf of ["eventHead.agendaTitle", "eventHead.cfpSubmitTitle", "eventHead.meTitle"]) {
      expect(unread).not.toContain(leaf);
    }
  });
});
