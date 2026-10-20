// Powierzchnie panelu i edytora bloków mówią napisami, nie kluczami - z TYLKO
// tymi słownikami, które same rejestrują.
//
// SKĄD TEN TEST. Do 2026-10-17 `admin.*` i `blocks.*` jechały w rdzeniu języka
// (`locale/pl.ts`, `locale/en.ts`), więc każdy komponent dostawał je „za darmo"
// z samego `useTranslation()`. Po przeniesieniu (rdzeń -> `i18n-admin-core`
// i `i18n-admin-blocks`) klucz rozwiązuje się tylko wtedy, gdy KTOŚ zarejestrował
// nakładkę przed renderem:
//   * panel - `AdminSession` (routes/admin.tsx) woła `ensureI18n()` z obu
//     słowników panelu, zanim wyrenderuje `<Outlet />`;
//   * edytor bloków - każdy moduł czytający `blocks.*` importuje nakładkę sam
//     (efekt uboczny importu), bo edytor bloków montuje się w wielu ekranach.
// Pominięta rejestracja nie oblewa ani parytetu, ani dryfu kluczy (te scalają
// WSZYSTKIE nakładki naraz), a na ekranie daje surowe `admin.bulk.selected`.
//
// JAK DOWODZI. Plik nie importuje statycznie żadnej nakładki - tylko rdzeń obu
// języków (`i18nReal`). Kanarek niżej sprawdza, że w takim magazynie przeniesionych
// kluczy NIE MA (bez tego reszta byłaby zielona i ślepa). Potem:
//   * panel: dokładnie to, co robi `AdminSession`, i render realnych komponentów
//     wspólnych dla wielu ekranów (nawigacja, pasek zapisu, pasek akcji
//     zbiorczych, etykiety ról);
//   * edytor bloków: import SAMEGO komponentu palety (nakładkę wnosi jego
//     import - test nie importuje jej sam; mutacja „bez importu w
//     BlockInserter" oblewa render surowymi `blocks.inserter.*`) i render menu
//     slash. Magazyn jest wspólny dla pliku, więc menu slash renderuje się już
//     przy nakładce wniesionej przez paletę - samodzielność KAŻDEGO modułu
//     dowodzi skan statyczny niżej, nie kolejność testów;
//   * statycznie: każdy plik, który woła `t()` z kluczem `blocks.*`, importuje
//     nakładkę sam albo przez `lib/blocks/i18n` - kanwa, schowek i hook
//     formularza wpisu nie mogą liczyć na to, że nakładkę dociągnął sąsiad;
//   * statycznie: żaden moduł osiągalny importem z trasy spoza `/admin` nie
//     czyta przeniesionego `admin.*` - ani `t()`, ani klucza trzymanego jako
//     dana (`titleKey: "admin.…"`, `i18nKey`), ani `keyPrefix: "admin"`.
//     `admin.*` nie ma odpowiednika „importuj słownik sam": rejestruje go
//     wyłącznie `AdminSession`, więc liczy się OSIĄGALNOŚĆ, nie katalog pliku.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { maskComments, scanTranslationCalls, type KeyUsageKind } from "@/lib/ci/i18nKeyUsage";
import { readKey, type ResourceTree } from "@/lib/ci/i18nParity";

const LANGS = ["pl", "en"] as const;

/** Stan magazynu PRZED jakąkolwiek nakładką: rdzeń obu języków i nic więcej. */
const CANARY = Object.fromEntries(
  LANGS.map((lng) => [
    lng,
    {
      coreLoaded: i18n.exists("common.cancel", { lng }),
      guardDialog: i18n.exists("admin.unsavedChangesTitle", { lng }),
      adminNav: i18n.exists("admin.nav.dashboard", { lng }),
      bulk: i18n.exists("admin.bulk.selected", { lng, count: 2 }),
      blocksSearch: i18n.exists("blocks.search", { lng }),
      blocksTypes: i18n.exists("blocks.types.paragraph", { lng }),
    },
  ]),
);

/** Ślad klucza w napisie: `admin.bulk.selected`, `blocks.types.heading`. */
const RAW_KEY = /\b(?:admin|blocks)\.[A-Za-z][\w.]*/g;

/**
 * Surowe klucze w tekście ORAZ w atrybutach, które czyta człowiek albo czytnik.
 * Węzeł po węźle - `textContent` korzenia skleja sąsiednie napisy i raport
 * zamienia się w jeden nieczytelny ciąg kluczy.
 */
function rawKeys(root: HTMLElement): string[] {
  const found = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    for (const hit of node.nodeValue?.match(RAW_KEY) ?? []) found.add(hit);
  }
  for (const el of root.querySelectorAll("*")) {
    for (const attr of ["placeholder", "aria-label", "title", "alt"]) {
      for (const hit of el.getAttribute(attr)?.match(RAW_KEY) ?? []) found.add(hit);
    }
  }
  return [...found].sort();
}

/** Źródła aplikacji (bez testów) - ścieżki względne `src/...`, jak w raportach. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) ? [path] : [];
  });
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("kanarek: sam rdzeń języka nie niesie słowników panelu", () => {
  it.each(LANGS)("%s: rdzeń jest w magazynie, przeniesionych gałęzi w nim nie ma", (lng) => {
    expect(CANARY[lng]).toEqual({
      coreLoaded: true,
      // Cztery klucze dialogu niezapisanych zmian ZOSTAŁY w rdzeniu - dialog
      // montuje się także poza panelem.
      guardDialog: true,
      adminNav: false,
      bulk: false,
      blocksSearch: false,
      blocksTypes: false,
    });
  });
});

describe("panel: słowniki rejestrowane przez `AdminSession`", () => {
  // Dokładnie dwie kotwice z `AdminSession` - ani jednej nakładki ekranu.
  async function registerAdminSessionDictionaries(): Promise<void> {
    const [core, extras] = await Promise.all([
      import("@/lib/i18n-admin-core"),
      import("@/lib/i18n-admin-extras"),
    ]);
    core.ensureI18n();
    extras.ensureI18n();
  }

  it.each(LANGS)("%s: nawigacja panelu - każda grupa i pozycja to napis", async (lng) => {
    await registerAdminSessionDictionaries();
    const { buildAdminNavGroups } = await import("@/lib/admin/adminNav");
    const groups = buildAdminNavGroups({
      t: realT(lng),
      isAdmin: true,
      isSuperAdmin: true,
      clubPending: 0,
      // Wiersz `admin` - widać hub „Przychód i lejek" i jego skróty ⌘K (I9a).
      roles: ["super_admin", "admin"],
    });
    const labels = groups.flatMap((g) => [
      g.label ?? "",
      ...g.items.flatMap((item) => [
        item.label,
        ...("to" in item ? (item.searchEntries ?? []).map((entry) => entry.label) : []),
      ]),
    ]);
    expect(labels.length).toBeGreaterThan(40);
    expect(labels.flatMap((label) => label.match(RAW_KEY) ?? [])).toEqual([]);
    expect(labels).toContain(lng === "pl" ? "Kokpit" : "Dashboard");
    expect(labels).toContain(lng === "pl" ? "Przychód i lejek" : "Revenue and funnel");
    expect(labels).toContain(lng === "pl" ? "Dane wejściowe" : "Inputs");
  });

  it.each(LANGS)("%s: etykiety ról redakcji (ekrany użytkowników)", async (lng) => {
    await registerAdminSessionDictionaries();
    const { roleLabel } = await import("@/lib/authz/roleLabels");
    // `super_admin` wnosi nakładka ekranu (`i18n-admin-users`) - tu go nie ma.
    for (const role of ["admin", "editor", "author", "user"] as const) {
      const label = roleLabel(realT(lng), role);
      expect(label, role).not.toMatch(RAW_KEY);
      expect(label, role).not.toBe(role);
    }
  });

  it.each(LANGS)("%s: pasek zapisu i pasek akcji zbiorczych", async (lng) => {
    await registerAdminSessionDictionaries();
    await i18n.changeLanguage(lng);
    const [{ SaveBar }, { BulkActionsBar }] = await Promise.all([
      import("@/components/admin/settings/fields"),
      import("@/components/admin/BulkActionsBar"),
    ]);
    const { container } = render(
      <div>
        <SaveBar saving={false} onSave={vi.fn()} />
        <BulkActionsBar count={3} onClear={vi.fn()} onApplyStatus={vi.fn()} onDelete={vi.fn()} />
      </div>,
    );
    expect(rawKeys(container)).toEqual([]);
    expect(screen.getByText(lng === "pl" ? "3 zaznaczone" : "3 selected")).toBeInTheDocument();
  });
});

describe("edytor bloków: komponent wnosi słownik własnym importem", () => {
  it.each(LANGS)("%s: paleta wstawiania (pełna biblioteka)", async (lng) => {
    await i18n.changeLanguage(lng);
    const [{ BlockInserter }, { BlockEditorProvider }] = await Promise.all([
      import("@/components/admin/blocks/BlockInserter"),
      import("@/components/admin/blocks/BlockEditorContext"),
    ]);
    const { container } = render(
      <BlockEditorProvider lang={lng}>
        <BlockInserter variant="controlled" open onInsert={vi.fn()} onInsertBlocks={vi.fn()} />
      </BlockEditorProvider>,
    );
    fireEvent.click(screen.getByText(realT(lng)("blocks.inserter.browseAll")));
    expect(rawKeys(container)).toEqual([]);
    expect(
      screen.getByPlaceholderText(lng === "pl" ? "Szukaj bloku..." : "Search block..."),
    ).toBeInTheDocument();
  });

  it.each(LANGS)("%s: menu slash", async (lng) => {
    await i18n.changeLanguage(lng);
    const [{ SlashMenu }, { BLOCK_LIST }] = await Promise.all([
      import("@/components/admin/blocks/molecules/SlashMenu"),
      import("@/lib/blocks/registry"),
    ]);
    const { container } = render(
      <SlashMenu
        specs={BLOCK_LIST.slice(0, 12)}
        activeIndex={0}
        onPick={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[role="option"]').length).toBe(12);
    expect(rawKeys(container)).toEqual([]);
  });
});

describe("statycznie: każdy czytelnik `blocks.*` importuje słownik edytora bloków", () => {
  /** Import nakładki wprost albo przez hak `useBlocksI18n` (który ją importuje). */
  const REGISTERS = /["']@\/lib\/(?:blocks\/i18n|i18n-admin-blocks)["']/;

  it('moduł z `t("blocks.…")` rejestruje nakładkę sam - nie liczy na sąsiada', () => {
    const readers = sourceFiles("src")
      // Słowniki same są źródłem kluczy, a skaner `lib/ci` ma klucze-atrapy.
      .filter((file) => !/^src\/lib\/(locale\/|i18n-|ci\/)/.test(file))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        const reads = scanTranslationCalls(file, source).some((u) => u.key.startsWith("blocks."));
        return reads ? [{ file, registers: REGISTERS.test(source) }] : [];
      });
    // Kontrola narzędzia: czytelników `blocks.*` jest kilkadziesiąt.
    expect(readers.length).toBeGreaterThan(20);
    expect(readers.filter((r) => !r.registers).map((r) => r.file)).toEqual([]);
  });
});

describe("statycznie: kod osiągalny z tras spoza `/admin` nie czyta przeniesionego `admin.*`", () => {
  // DLACZEGO OSIĄGALNOŚĆ, A NIE KATALOG. `admin.*` rejestruje tylko `AdminSession`
  // (układ `/admin`). Klucz przeczytany w module, który montuje się poza tym
  // układem - publiczna trasa, inline-edytor dla redakcji na stronie wpisu,
  // handler serwera - daje na ekranie surowe `admin.save`, a bramki dryfu
  // i parytetu świecą na zielono, bo scalają WSZYSTKIE nakładki naraz. Reguła
  // „tylko `components/admin/**`" byłaby i za ciasna (`lib/admin/adminNav`,
  // `lib/onboarding/tours` trzymają klucze panelu, a importuje je tylko panel),
  // i za luźna (`ImpersonationBanner` z `components/admin` montuje się w
  // publicznym `SiteChrome`). Liczy się więc graf importów: korzenie to
  // wszystkie pliki `src/routes/**` poza `admin.tsx`/`admin.*` plus wejścia
  // `router`/`server`/`start`, krawędzie - importy wartości, statyczne
  // i dynamiczne (chunk ładowany leniwie na trasie publicznej to dalej trasa
  // publiczna). `import type` krawędzią nie jest. `routeTree.gen.ts` jest
  // klejem WSZYSTKICH tras (także panelu) - przez niego graf nie przechodzi,
  // tak jak bundler dzieli trasy panelu na osobne chunki.
  const ADMIN_ROUTE = /^src\/routes\/admin(?:\.|$)/;
  const ENTRY = /^src\/(?:router|server|start)\.tsx?$/;
  const ROUTE_TREE = "src/routeTree.gen.ts";
  const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
  /**
   * `import … from "x"`, `export … from "x"`, `import "x"`, `import("x")`.
   * Grupa 1 = `type` (krawędzi nie ma), grupa 2/3 = specyfikator.
   */
  const IMPORT_RE =
    /\b(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  /** Literał (albo głowa template literala) w kształcie klucza panelu. */
  const ADMIN_LITERAL = /(["'`])(admin\.(?:[A-Za-z][\w.]*)?)(\$\{|\1)/g;
  /**
   * `useTranslation(…, { keyPrefix: "admin" })` niezależnie od nazwy funkcji -
   * skaner `t()` widzi tylko `t(`, a `const { t: tr } = …` też czyta panel.
   */
  const ADMIN_KEY_PREFIX = /\bkeyPrefix\s*:\s*(["'`])(admin(?:\.[\w.]*)?)\1/g;

  function resolveImport(from: string, spec: string, known: ReadonlySet<string>): string | null {
    const bare = spec.replace(/\?.*$/, "");
    let base: string;
    if (bare.startsWith("@/")) base = `src/${bare.slice(2)}`;
    else if (bare.startsWith(".")) base = join(dirname(from), bare);
    else return null;
    return RESOLVE_SUFFIXES.map((suffix) => base + suffix).find((path) => known.has(path)) ?? null;
  }

  /** Pliki osiągalne z korzeni publicznych (+ rodzic, do czytelnej ścieżki w raporcie). */
  function publicReach(files: readonly string[]): Map<string, string | null> {
    const known = new Set(files);
    const parent = new Map<string, string | null>();
    const queue = files.filter(
      (file) => (file.startsWith("src/routes/") && !ADMIN_ROUTE.test(file)) || ENTRY.test(file),
    );
    for (const root of queue) parent.set(root, null);
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (file === ROUTE_TREE) continue;
      // Bez komentarzy: zakomentowany import to nie krawędź.
      const source = maskComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(IMPORT_RE)) {
        if (match[1] !== undefined) continue;
        const target = resolveImport(file, match[2] ?? match[3], known);
        if (target !== null && !parent.has(target)) {
          parent.set(target, file);
          queue.push(target);
        }
      }
    }
    return parent;
  }

  function trail(parent: ReadonlyMap<string, string | null>, file: string): string {
    const chain = [file];
    for (let up = parent.get(file); up != null; up = parent.get(up)) chain.push(up);
    return chain.join(" <- ");
  }

  it("ani `t()`, ani klucz jako dana, ani `keyPrefix` - tylko 4 klucze dialogu zostały w rdzeniu", async () => {
    // Zbiór przeniesionych kluczy = drzewa nakładki panelu (oba języki). Import
    // dynamiczny: kanarek pliku policzył stan magazynu już przy ładowaniu.
    const { adminCorePl, adminCoreEn } = await import("@/lib/i18n-admin-core");
    const trees = [adminCorePl, adminCoreEn] as unknown as ResourceTree[];
    const moved = (kind: KeyUsageKind, key: string): boolean => {
      if (!key.startsWith("admin.") && key !== "admin") return false;
      if (kind !== "partial") return trees.some((tree) => readKey(tree, key) !== null);
      // `admin.foo_${x}` - rodzic istnieje i ma liść zaczynający się od `foo_`.
      const cut = key.lastIndexOf(".");
      const head = key.slice(cut + 1);
      return trees.some((tree) => {
        const node = readKey(tree, key.slice(0, cut));
        return (
          node !== null &&
          typeof node === "object" &&
          Object.keys(node).some((k) => k.startsWith(head))
        );
      });
    };

    const files = sourceFiles("src");
    const reach = publicReach(files);
    // Kontrola narzędzia - pusty albo przecieknięty graf dawałby zieloną ślepotę:
    // graf obejmuje publiczny szkielet strony, wchodzi do `components/admin`
    // tam, gdzie robi to aplikacja (baner impersonacji w `SiteChrome`),
    // i nie dochodzi do żadnej trasy panelu.
    expect(reach.size).toBeGreaterThan(1000);
    expect(reach.has("src/components/SiteChrome.tsx")).toBe(true);
    expect(reach.has("src/components/admin/ImpersonationBanner.tsx")).toBe(true);
    expect([...reach.keys()].filter((file) => ADMIN_ROUTE.test(file))).toEqual([]);

    const offenders: string[] = [];
    for (const file of reach.keys()) {
      // Słowniki same są źródłem kluczy, a skaner `lib/ci` ma klucze-atrapy.
      if (file === ROUTE_TREE || /^src\/lib\/(?:locale\/|i18n-|ci\/)/.test(file)) continue;
      const raw = readFileSync(file, "utf8");
      const where = trail(reach, file);
      // `t("admin.x")`, `t(`admin.x.${y}`)`, `t("x")` pod `keyPrefix: "admin"`.
      for (const use of scanTranslationCalls(file, raw)) {
        if (moved(use.kind, use.key)) offenders.push(`t(${use.key}) ${where}`);
      }
      // Klucz jako dana: `titleKey: "admin.…"`, `i18nKey="admin.…"`, `` `admin.${x}` ``.
      // Komentarze wycięte - nazwy plików `admin.events.tsx` w opisach to nie klucze.
      const code = maskComments(raw);
      for (const [, , prefix] of code.matchAll(ADMIN_KEY_PREFIX)) {
        if (moved("prefix", prefix)) offenders.push(`keyPrefix ${prefix} ${where}`);
      }
      for (const [, , literal, close] of code.matchAll(ADMIN_LITERAL)) {
        const kind: KeyUsageKind =
          close !== "${" ? "literal" : literal.endsWith(".") ? "prefix" : "partial";
        const key = kind === "prefix" ? literal.replace(/\.+$/, "") : literal;
        if (moved(kind, key)) offenders.push(`"${literal}" ${where}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
