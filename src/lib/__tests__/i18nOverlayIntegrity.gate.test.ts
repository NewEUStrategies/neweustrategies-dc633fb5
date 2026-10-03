// @vitest-environment node
//
// BRAMKA: integralność nakładek słownikowych (`src/lib/i18n-*.ts`) - rejestracja
// przy imporcie, idempotentne `ensure…I18n()` i ZERO kolizji kluczy.
//
// PO CO. Nakładek jest ponad 160 i każda wpisuje swój fragment PL/EN do JEDNEGO
// magazynu i18next przez `addResourceBundle(lang, "translation", drzewo, deep,
// overwrite)`. Gdy dwa źródła piszą RÓŻNE zdania pod ten sam klucz, napis
// widziany przez użytkownika zależy od tego, który chunk załadował się
// ostatni - a to jest historia nawigacji w karcie albo (na serwerze, gdzie
// magazyn jest WSPÓLNY dla wszystkich żądań isolate'u) historia tego, co
// isolate renderował wcześniej. Tak było z `eventMeetings.errors.forbidden`
// i `.unknown`: panel organizatora i giełda uczestnika miały własne kopie,
// obie z `overwrite=true`, więc uczestnik dostawał zdanie panelu, jeśli tylko
// ktoś wcześniej otworzył panel (audyt 2026-08-18, rozdz. 15.15.1).
//
// Żadna inna bramka tego nie widzi: parytet porównuje PL z EN (obie kopie są
// kompletne), dryf kluczy pyta o istnienie klucza (istnieje - dwa razy),
// a testy per nakładka mierzą JEDNĄ nakładkę naraz.
//
// DLACZEGO RDZEŃ JEST KOPIOWANY PRZED IMPORTEM NAKŁADEK. i18next trzyma zasoby
// z `init({ resources })` PRZEZ REFERENCJĘ, a `addResourceBundle(..., deep)`
// scala w miejscu (`deepExtend(pack, ...)` na obiekcie z magazynu). Eksport
// `pl`/`en` z `src/lib/locale/*.ts` jest więc po imporcie nakładek już
// SCALONYM słownikiem, a porównanie „rdzeń kontra nakładka" na żywym
// eksporcie nie widzi żadnej podmiany - nakładka porównywałaby się sama ze
// sobą. Dokładnie dlatego siedem polskich podmian w `i18n-notifications.ts`
// przeżyło ratchet w `i18nNotifications.test.ts`. `structuredClone` niżej
// robi zdjęcie rdzenia ZANIM jakakolwiek nakładka się zarejestruje.
//
// ŚRODOWISKO NODE celowo: `import.meta.env.SSR` jest wtedy prawdą, więc
// `@/lib/i18n` ładuje OBA rdzenie przy starcie - jak serwer, czyli tam, gdzie
// kolizja kosztuje najwięcej (wspólny magazyn wielu żądań).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";

/** Zdjęcie rdzenia SPRZED rejestracji nakładek - patrz nagłówek pliku. */
const CORE = structuredClone({ pl: corePl, en: coreEn });

const LANGS = ["pl", "en"] as const;
const CORE_SOURCE = "core";

/** Ramka stosu pliku nakładki; pierwsza od góry to wołający `addResourceBundle`. */
const OVERLAY_FRAME = /\/src\/lib\/(i18n-[\w-]+)\.ts\b/;

/** Nazwa eksportu, którą moduły wołają przed pierwszym renderem. */
const ENSURE_EXPORT = /^ensure\w*I18n$/;

interface Registration {
  readonly source: string;
  readonly lang: string;
  readonly ns: string;
  readonly deep: boolean | undefined;
  readonly overwrite: boolean | undefined;
  readonly tree: unknown;
}

interface Conflict {
  readonly id: string;
  readonly writes: ReadonlyArray<{ readonly source: string; readonly value: string }>;
}

function isEnsure(value: unknown): value is () => void {
  return typeof value === "function";
}

function isTree(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Liście drzewa jako [ścieżka, wartość-JSON]; tablica jest liściem (tak scala ją i18next). */
function leaves(node: unknown, prefix = ""): Array<[string, string]> {
  if (isTree(node)) {
    return Object.entries(node).flatMap(([key, child]) =>
      leaves(child, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return prefix === "" ? [] : [[prefix, JSON.stringify(node)]];
}

/** Każdy klucz `lang:ścieżka`, pod który co najmniej dwa zapisy niosą RÓŻNE wartości. */
function findConflicts(
  writes: ReadonlyArray<Pick<Registration, "source" | "lang" | "tree">>,
): Conflict[] {
  const byKey = new Map<string, Array<{ source: string; value: string }>>();
  for (const write of writes) {
    for (const [path, value] of leaves(write.tree)) {
      const id = `${write.lang}:${path}`;
      const list = byKey.get(id) ?? [];
      list.push({ source: write.source, value });
      byKey.set(id, list);
    }
  }
  const conflicts: Conflict[] = [];
  for (const [id, list] of byKey) {
    if (new Set(list.map((entry) => entry.value)).size > 1) conflicts.push({ id, writes: list });
  }
  return conflicts.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Klucze, które są jednocześnie LIŚCIEM w jednym zapisie i GAŁĘZIĄ w innym.
 * `deepExtend` zastąpiłby wtedy całe poddrzewo napisem (albo odwrotnie)
 * i wynik znowu zależałby od kolejności importu.
 */
function findShapeClashes(writes: ReadonlyArray<Pick<Registration, "lang" | "tree">>): string[] {
  const leafIds = new Set(
    writes.flatMap((write) => leaves(write.tree).map(([path]) => `${write.lang}:${path}`)),
  );
  const clashes: string[] = [];
  for (const id of leafIds) {
    const parts = id.split(".");
    for (let i = 1; i < parts.length; i += 1) {
      const prefix = parts.slice(0, i).join(".");
      if (leafIds.has(prefix)) clashes.push(`${prefix} <> ${id}`);
    }
  }
  return clashes.sort();
}

function render(conflicts: readonly Conflict[]): string {
  return conflicts
    .map(
      (conflict) =>
        `${conflict.id}\n${conflict.writes.map((w) => `    ${w.source}: ${w.value}`).join("\n")}`,
    )
    .join("\n");
}

/** Rozjazd z rdzeniem: rdzeń ma ten klucz, a któraś nakładka niesie pod nim inną wartość. */
function coreDiffers(conflict: Conflict): boolean {
  const core = conflict.writes.find((w) => w.source === CORE_SOURCE);
  return core !== undefined && conflict.writes.some((w) => w.value !== core.value);
}

/** Konflikt wyłącznie między nakładkami: rdzeń pominięty, liczą się różne wartości. */
function overlayOnly(conflict: Conflict): boolean {
  const values = new Set(
    conflict.writes.filter((w) => w.source !== CORE_SOURCE).map((w) => w.value),
  );
  return values.size > 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// DŁUG ZASTANY: rozjazdy RDZEŃ <-> NAKŁADKA, których nie da się zamknąć w samych
// nakładkach. Lista może tylko MALEĆ (test „nieaktualne wpisy" niżej).
// Kolizja NAKŁADKA <-> NAKŁADKA nie ma i mieć nie może żadnego wyjątku.
// ─────────────────────────────────────────────────────────────────────────────
const KNOWN_CORE_CONFLICTS: ReadonlyMap<string, string> = new Map([
  // Panel ustawień i skrzynka powiadomień (`NotificationsCenter`) renderują się
  // także na /messages, które nakładki NIE importuje - przed wejściem na
  // /profile/notifications widać tam zdanie rdzenia, po nim zdanie nakładki.
  // Te same 24 klucze są zamrożone w `i18nNotifications.test.ts`
  // (KNOWN_OVERLAY_OVERRIDES) z testem „lista nie zawiera pozycji już
  // naprawionych", więc ich usunięcie z nakładki musi iść razem ze zmianą tamtej
  // listy - to plik spoza zakresu tej bramki. Polskie odpowiedniki są już
  // zrównane z rdzeniem.
  ...[
    "consents.given",
    "consents.saveError",
    "consents.subtitle",
    "consents.title",
    "consents.versionOutdated",
    "consents.withdrawn",
    "deleteGroup",
    "inboxSubtitle",
    "markAllRead",
    "markGroupRead",
    "markGroupUnread",
    "noMatches",
    "searchPlaceholder",
    "settings.autoMarkOnOpen",
    "settings.autoMarkOnOpenHint",
    "settings.channelsSubtitle",
    "settings.chatBell",
    "settings.chatBellHint",
    "settings.digest",
    "settings.digestHint",
    "settings.groupByConversationHint",
    "settings.pushDenied",
    "settings.pushHint",
    "settings.subtitle",
  ].map((key): [string, string] => [
    `en:notifications.${key}`,
    "nakładka powiadomień podmienia EN rdzenia; zamrożone także w i18nNotifications.test.ts",
  ]),
  // `rolesAndLabels.test.ts` przypina EN „Admin" (nakładka) i wymaga, by różnił
  // się od PL „Administrator". Rdzeń EN ma „Administrator" - do poprawy w
  // `locale/en.ts`, nie w nakładce.
  ["en:admin.users.roles.admin", "rdzeń EN „Administrator”, test ról przypina nakładkowe „Admin”"],
  // `Cover.tsx` używa `blocks.editors.cover.title` jako PLACEHOLDERA pola tytułu,
  // a rdzeń trzyma pod nim NAGŁÓWEK edytora („Tło / okładka"), zgodnie z umową
  // `editors.<blok>.title`. Nakładka ma właściwy tekst („Wpisz tytuł…"), ale
  // rejestruje się z `overwrite=false`, więc wygrywa tylko wtedy, gdy rdzeń
  // danego języka dociąga się PÓŹNIEJ (leniwy drugi język na kliencie).
  // Naprawa: osobny klucz placeholdera w `Cover.tsx` + nakładce.
  ["pl:blocks.editors.cover.title", "placeholder Cover.tsx czyta klucz nagłówka z rdzenia"],
  ["en:blocks.editors.cover.title", "placeholder Cover.tsx czyta klucz nagłówka z rdzenia"],
]);

const LOADERS = import.meta.glob<Record<string, unknown>>("/src/lib/i18n-*.ts");
const OVERLAY_PATHS = Object.keys(LOADERS).sort();
const overlayName = (path: string): string => path.replace(/^.*\/(i18n-[\w-]+)\.ts$/, "$1");

const registrations: Registration[] = [];
const modules = new Map<string, Record<string, unknown>>();
const unattributed: string[] = [];

beforeAll(async () => {
  const original = i18n.addResourceBundle.bind(i18n);
  const previousLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const spy = vi
    .spyOn(i18n, "addResourceBundle")
    .mockImplementation((lng, ns, resources, deep, overwrite) => {
      const stack = new Error().stack ?? "";
      const source = OVERLAY_FRAME.exec(stack)?.[1];
      if (source === undefined) unattributed.push(stack);
      registrations.push({
        source: source ?? "?",
        lang: lng,
        ns,
        deep,
        overwrite,
        tree: resources,
      });
      return original(lng, ns, resources, deep, overwrite);
    });
  try {
    // Kolejność alfabetyczna - deterministyczna; sam wynik bramki od niej nie
    // zależy, bo kolizję liczymy po wartościach, nie po zwycięzcy.
    for (const path of OVERLAY_PATHS) modules.set(path, await LOADERS[path]());
  } finally {
    spy.mockRestore();
    Error.stackTraceLimit = previousLimit;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("narzędzie bramki (kontrole dodatnie i ujemne)", () => {
  it("findConflicts widzi różne wartości pod jednym kluczem i pomija identyczne kopie", () => {
    const conflicts = findConflicts([
      { source: "a", lang: "pl", tree: { x: { y: "jeden", same: "to samo" }, z: ["a"] } },
      { source: "b", lang: "pl", tree: { x: { y: "dwa", same: "to samo" }, z: ["b"] } },
      { source: "c", lang: "en", tree: { x: { y: "three" } } },
    ]);
    expect(conflicts.map((c) => c.id)).toEqual(["pl:x.y", "pl:z"]);
    expect(conflicts[0]?.writes).toEqual([
      { source: "a", value: '"jeden"' },
      { source: "b", value: '"dwa"' },
    ]);
    expect(overlayOnly(conflicts[0] as Conflict)).toBe(true);
    expect(coreDiffers(conflicts[0] as Conflict)).toBe(false);
  });

  it("overlayOnly nie bierze rozjazdu z rdzeniem za kolizję nakładek", () => {
    const [conflict] = findConflicts([
      { source: CORE_SOURCE, lang: "pl", tree: { k: "rdzeń" } },
      { source: "i18n-a", lang: "pl", tree: { k: "nakładka" } },
      { source: "i18n-b", lang: "pl", tree: { k: "nakładka" } },
    ]);
    expect(conflict?.id).toBe("pl:k");
    expect(overlayOnly(conflict as Conflict)).toBe(false);
    expect(coreDiffers(conflict as Conflict)).toBe(true);
  });

  it("findShapeClashes widzi liść, który w innym zapisie jest gałęzią", () => {
    expect(
      findShapeClashes([
        { lang: "en", tree: { a: "liść" } },
        { lang: "en", tree: { a: { b: "gałąź" } } },
        { lang: "pl", tree: { a: { b: "bez kolizji" } } },
      ]),
    ).toEqual(["en:a <> en:a.b"]);
  });

  it("render wypisuje klucz i każde źródło z wartością", () => {
    const text = render(
      findConflicts([
        { source: "i18n-x", lang: "en", tree: { k: "A" } },
        { source: "i18n-y", lang: "en", tree: { k: "B" } },
      ]),
    );
    expect(text).toBe('en:k\n    i18n-x: "A"\n    i18n-y: "B"');
  });

  it("skan obejmuje WSZYSTKIE nakładki, a każdy zapis ma przypisane źródło", () => {
    expect(OVERLAY_PATHS.length, "nakładek musi być ponad sto").toBeGreaterThan(150);
    expect(OVERLAY_PATHS).toContain("/src/lib/i18n-admin-event-meetings.ts");
    expect(OVERLAY_PATHS).toContain("/src/lib/i18n-event-meetings.ts");
    expect(OVERLAY_PATHS).toContain("/src/lib/i18n-notifications.ts");
    expect(modules.size).toBe(OVERLAY_PATHS.length);
    expect(unattributed, "zapis bez ramki pliku nakładki na stosie").toEqual([]);
  });

  it("zdjęcie rdzenia jest sprzed nakładek - nie zawiera kluczy, które wnoszą tylko one", () => {
    // `eventMeetings` i `club` istnieją WYŁĄCZNIE w nakładkach. Gdyby zdjęcie
    // powstało po ich rejestracji, porównanie rdzeń-nakładka byłoby ślepe.
    for (const lang of LANGS) {
      expect(CORE[lang]).not.toHaveProperty("eventMeetings");
      expect(CORE[lang]).not.toHaveProperty("club");
      expect(CORE[lang]).toHaveProperty("notifications.title");
    }
  });
});

describe("rejestracja nakładek", () => {
  it("KAŻDA nakładka rejestruje PL i EN już przy imporcie, bez wołania ensure…()", () => {
    // Audyt 2026-08-18 (15.15.2): pięć nakładek rejestrowało się dopiero
    // w `ensureI18n()`, więc ich klucze stały poza bramkami parytetu, które
    // czytają magazyn po samym imporcie. Ta asercja trzyma naprawę.
    const registered = new Set(registrations.map((r) => `${r.source}:${r.lang}`));
    const missing = OVERLAY_PATHS.map(overlayName).flatMap((name) =>
      LANGS.filter((lang) => !registered.has(`${name}:${lang}`)).map((lang) => `${name}:${lang}`),
    );
    expect(missing, "nakładka nie zarejestrowała się przy imporcie").toEqual([]);
  });

  it("każdy zapis idzie do przestrzeni translation i scala GŁĘBOKO", () => {
    // `deep=false` robi płytki spread na całym `translation`: nakładka
    // z gałęzią `admin` zastąpiłaby CAŁE `admin.*` rdzenia swoim fragmentem.
    const bad = registrations
      .filter((r) => r.ns !== "translation" || r.deep !== true)
      .map((r) => `${r.source}:${r.lang} ns=${r.ns} deep=${String(r.deep)}`);
    expect(bad).toEqual([]);
    expect(registrations.every((r) => typeof r.overwrite === "boolean")).toBe(true);
  });

  it("każde ensure…I18n() jest idempotentne: po imporcie dwa wywołania nic nie zmieniają", () => {
    const ensures = [...modules].flatMap(([path, mod]) =>
      Object.entries(mod).flatMap(([name, value]) =>
        ENSURE_EXPORT.test(name) && isEnsure(value)
          ? [{ id: `${overlayName(path)}#${name}`, fn: value }]
          : [],
      ),
    );
    // Kontrola narzędzia: wzorzec eksportu nie może po cichu przestać łapać.
    expect(ensures.length, "ensure…I18n eksportuje ponad sto nakładek").toBeGreaterThan(100);
    expect(ensures.every((entry) => entry.fn.length === 0)).toBe(true);

    const before = JSON.stringify(i18n.store.data);
    const writers = [
      vi.spyOn(i18n, "addResourceBundle"),
      vi.spyOn(i18n, "addResources"),
      vi.spyOn(i18n, "addResource"),
    ];
    const notIdempotent: string[] = [];
    for (const { id, fn } of ensures) {
      fn();
      fn();
      if (writers.some((writer) => writer.mock.calls.length > 0)) notIdempotent.push(id);
      for (const writer of writers) writer.mockClear();
    }
    expect(notIdempotent, "ensure…I18n() zapisuje do magazynu po rejestracji").toEqual([]);
    expect(JSON.stringify(i18n.store.data) === before, "magazyn zmienił się po ensure…").toBe(true);
  });
});

describe("kolizje kluczy (bramka)", () => {
  const allWrites = () => [
    ...LANGS.map((lang) => ({ source: CORE_SOURCE, lang, tree: CORE[lang] })),
    ...registrations,
  ];

  it("ŻADNE dwie nakładki nie piszą różnych napisów pod ten sam klucz - bez wyjątków", () => {
    const clashes = findConflicts(allWrites()).filter(overlayOnly);
    expect(
      clashes.map((c) => c.id),
      `napis zależy od kolejności ładowania chunków:\n${render(clashes)}`,
    ).toEqual([]);
  });

  it("nakładka nie dokłada NOWEGO rozjazdu z rdzeniem (ratchet)", () => {
    const fresh = findConflicts(allWrites()).filter(
      (c) => coreDiffers(c) && !KNOWN_CORE_CONFLICTS.has(c.id),
    );
    expect(
      fresh.map((c) => c.id),
      `nakładka i rdzeń mają różne napisy pod jednym kluczem - jedno źródło prawdy:\n${render(fresh)}`,
    ).toEqual([]);
  });

  it("lista znanego długu nie zawiera pozycji już naprawionych", () => {
    const current = new Set(
      findConflicts(allWrites())
        .filter(coreDiffers)
        .map((c) => c.id),
    );
    const stale = [...KNOWN_CORE_CONFLICTS.keys()].filter((id) => !current.has(id));
    expect(stale, "wpis na liście długu, którego już nie ma - usuń go z listy").toEqual([]);
  });

  it("żaden klucz nie jest liściem w jednym źródle i gałęzią w innym", () => {
    expect(findShapeClashes(allWrites())).toEqual([]);
  });
});
