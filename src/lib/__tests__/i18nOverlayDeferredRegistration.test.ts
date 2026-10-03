// @vitest-environment node
//
// Nakładki na NAGIM singletonie i18next: rejestracja odroczona do zdarzenia
// `initialized`.
//
// Pięć nakładek (`i18n-public`, `i18n-sponsored`, `i18n-public-auth`,
// `i18n-public-search-overlay`, `i18n-admin-mobile-drawer`) importuje
// `i18next` wprost, a nie `./i18n` - wchodzą w graf komponentów publicznych,
// których testy mockują `react-i18next` (patrz nagłówek `i18n-public.ts`).
// Mogą się więc wykonać, ZANIM `@/lib/i18n` zawoła `init()`, i wtedy jedyną
// drogą rejestracji jest słuchacz `initialized`. Ta gałąź nie wykonała się
// dotąd w żadnym teście (pokrycie gałęzi 1/2 i 2/6), bo każdy test ładuje
// prawdziwy, już zainicjalizowany singleton.
//
// Atrapa niżej to minimalny emiter z flagą `isInitialized` - dokładnie ta
// powierzchnia, której te moduły dotykają. Fabryka `vi.mock` nie importuje
// żadnego modułu produkcyjnego (zakleszczenie opisane w `src/test/i18nStub.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    isInitialized: false,
    addResourceBundle: vi.fn(),
    on: vi.fn((event: string, fn: () => void) => {
      const set = listeners.get(event) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(event, set);
    }),
    off: vi.fn((event: string, fn: () => void) => {
      listeners.get(event)?.delete(fn);
    }),
    /** Symulacja `init()`: flaga, potem zdarzenie - w tej kolejności, jak w i18next. */
    initialize(): void {
      this.isInitialized = true;
      for (const fn of [...(listeners.get("initialized") ?? [])]) fn();
    },
    listenerCount(event: string): number {
      return listeners.get(event)?.size ?? 0;
    },
    reset(initialized: boolean): void {
      listeners.clear();
      this.isInitialized = initialized;
      this.addResourceBundle.mockClear();
      this.on.mockClear();
      this.off.mockClear();
    },
  };
});

vi.mock("i18next", () => ({ default: fake }));

/** Zapisy jako [język, pierwsze klucze drzewa, deep, overwrite]. */
function registrations(): Array<[unknown, string[], unknown, unknown]> {
  return fake.addResourceBundle.mock.calls.map(([lang, ns, tree, deep, overwrite]) => {
    expect(ns).toBe("translation");
    return [lang, Object.keys(tree as object).sort(), deep, overwrite];
  });
}

const GUARDED = [
  {
    name: "i18n-public-auth",
    load: () => import("@/lib/i18n-public-auth"),
    roots: ["authForms"],
  },
  {
    name: "i18n-public-search-overlay",
    load: () => import("@/lib/i18n-public-search-overlay"),
    roots: ["searchOverlay"],
  },
  {
    name: "i18n-admin-mobile-drawer",
    load: () => import("@/lib/i18n-admin-mobile-drawer"),
    roots: ["mobileDrawer"],
  },
] as const;

const PLAIN = [
  {
    name: "i18n-public",
    load: () => import("@/lib/i18n-public"),
    roots: [
      "blocksUi",
      "inlineEntity",
      "megaMenu",
      "newsletterForm",
      "newsletterStatus",
      "postFooter",
    ],
  },
  {
    name: "i18n-sponsored",
    load: () => import("@/lib/i18n-sponsored"),
    roots: ["postOrganization", "sponsored"],
  },
] as const;

beforeEach(() => {
  vi.resetModules();
});

describe.each(GUARDED)("$name - ensureI18n() z odroczeniem i strażnikiem", ({ load, roots }) => {
  it("singleton gotowy przy imporcie: rejestruje PL i EN od razu, bez słuchacza", async () => {
    fake.reset(true);
    const mod = await load();

    expect(registrations()).toEqual([
      ["pl", [...roots], true, true],
      ["en", [...roots], true, true],
    ]);
    expect(fake.on).not.toHaveBeenCalled();

    // Drugie i trzecie wołanie po rejestracji: strażnik `registered`.
    mod.ensureI18n();
    mod.ensureI18n();
    expect(fake.addResourceBundle).toHaveBeenCalledTimes(2);
  });

  it("singleton NIEgotowy: jeden słuchacz `initialized`, rejestracja dopiero po init", async () => {
    fake.reset(false);
    const mod = await load();

    expect(fake.addResourceBundle).not.toHaveBeenCalled();
    expect(fake.on).toHaveBeenCalledTimes(1);
    expect(fake.on).toHaveBeenCalledWith("initialized", expect.any(Function));

    // Kolejne ensure przed init NIE dokładają drugiego słuchacza (`scheduled`).
    mod.ensureI18n();
    mod.ensureI18n();
    expect(fake.on).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount("initialized")).toBe(1);

    fake.initialize();
    expect(registrations()).toEqual([
      ["pl", [...roots], true, true],
      ["en", [...roots], true, true],
    ]);
    // Słuchacz zdejmuje się sam - ponowne `initialized` nie scala drugi raz.
    expect(fake.off).toHaveBeenCalledWith("initialized", fake.on.mock.calls[0]?.[1]);
    expect(fake.listenerCount("initialized")).toBe(0);

    mod.ensureI18n();
    expect(fake.addResourceBundle).toHaveBeenCalledTimes(2);
  });
});

describe.each(PLAIN)(
  "$name - rejestracja przy imporcie lub po `initialized`",
  ({ load, roots }) => {
    it("singleton gotowy przy imporcie: rejestruje PL i EN od razu", async () => {
      fake.reset(true);
      await load();

      expect(registrations()).toEqual([
        ["pl", [...roots], true, true],
        ["en", [...roots], true, true],
      ]);
      expect(fake.on).not.toHaveBeenCalled();
    });

    it("singleton NIEgotowy: nic nie pisze do init, potem rejestruje PL i EN raz", async () => {
      fake.reset(false);
      await load();

      expect(fake.addResourceBundle).not.toHaveBeenCalled();
      expect(fake.on).toHaveBeenCalledTimes(1);
      expect(fake.on).toHaveBeenCalledWith("initialized", expect.any(Function));

      fake.initialize();
      expect(registrations()).toEqual([
        ["pl", [...roots], true, true],
        ["en", [...roots], true, true],
      ]);
    });
  },
);

describe("drzewa PL i EN rejestrowane przez nakładki odroczone", () => {
  it.each([...GUARDED, ...PLAIN])(
    "$name: PL i EN mają ten sam zestaw kluczy i różną treść",
    async ({ load }) => {
      fake.reset(true);
      await load();
      const [plTree, enTree] = fake.addResourceBundle.mock.calls.map((call) => call[2]);
      const paths = (node: unknown, prefix = ""): string[] =>
        node !== null && typeof node === "object"
          ? Object.entries(node).flatMap(([key, child]) =>
              paths(child, prefix === "" ? key : `${prefix}.${key}`),
            )
          : [prefix];
      expect(paths(plTree).sort()).toEqual(paths(enTree).sort());
      expect(JSON.stringify(plTree)).not.toBe(JSON.stringify(enTree));
    },
  );
});
