// @vitest-environment node
//
// `scripts/i18n-translate-widgets.ts` - skrypt, który zamyka pętlę panelu
// /admin/i18n: zbiera teksty PL wymagające tłumaczenia, tłumaczy je i zapisuje
// `_en` z powrotem do `builder_data`.
//
// PRZEDMIOT DOWODU - SZABLONY PALETY. Panel liczy `stale_default` (EN
// zostawione na szablonie palety przy ZMIENIONYM PL) jako BŁĄD, z szablonów
// `WIDGETS` (`registry.tsx`). Skrypt nie przekazywał `getDefaults` do
// `widgetTranslationFill`, więc taki widget dawał „Segmentów do tłumaczenia: 0"
// - błąd z panelu nie miał jak zniknąć. Zmierzone na kodzie sprzed poprawki:
// sonda z widgetem `animated-heading` (`textBefore_pl: "Poznaj nas"`,
// `textBefore_en: "Join"`) - do tłumaczenia wysłano `[]`.
//
// CO JEST ATRAPOWANE I DLACZEGO (zero sieci, zero bazy):
//   * `@supabase/supabase-js` - klient zwraca atrapę łańcucha
//     (`supabaseFromStub`), więc test czyta odczyty i zapisy;
//   * `translateSegmentsPlToEn` - bramka AI (sieć, koszt); `chunkSegments`
//     zostaje prawdziwe;
//   * `node:fs` WYŁĄCZNIE dla pliku cache (`reports/…`) - pamięć zamiast dysku,
//     reszta ścieżek idzie do prawdziwego modułu;
//   * `process.exit` - rzuca, żeby `fail()` dało się asertować.
// PRAWDZIWE biegną: rejestr widgetów (szablony palety), `widgetTranslationFill`,
// cały `main()` skryptu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WIDGETS } from "@/lib/builder/registry";
import { collectTranslatableTexts } from "@/lib/i18n/widgetTranslationFill";
import { fail, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const CACHE_PATH = "reports/i18n-widget-translations.json";

const h = vi.hoisted(() => ({
  from: (_table: string): unknown => ({}),
  translate: async (batch: string[]): Promise<string[]> => batch.map((s) => `EN ${s}`),
  files: new Map<string, string>(),
  createClientArgs: [] as unknown[][],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    h.createClientArgs.push(args);
    return { from: (table: string) => h.from(table) };
  },
}));
vi.mock("@/lib/server/aiTranslate.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/aiTranslate.server")>()),
  translateSegmentsPlToEn: (batch: string[]) => h.translate(batch),
}));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const ours = (path: unknown) => typeof path === "string" && path.startsWith("reports");
  return {
    ...real,
    existsSync: (path: string) => (ours(path) ? h.files.has(path) : real.existsSync(path)),
    readFileSync: (path: string, enc: BufferEncoding) =>
      ours(path) ? (h.files.get(path) ?? "") : real.readFileSync(path, enc),
    mkdirSync: (path: string, opts: { recursive: boolean }) =>
      ours(path) ? undefined : real.mkdirSync(path, opts),
    writeFileSync: (path: string, data: string) =>
      ours(path) ? void h.files.set(path, data) : real.writeFileSync(path, data),
  };
});

type Script = typeof import("../../../../scripts/i18n-translate-widgets");

const db = supabaseFromStub();
const ENV_KEYS = ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const savedArgv = process.argv;

let logs: string[];
let warnings: string[];
let errors: string[];
let sent: string[][];

/** Świeży moduł skryptu - stałe CLI (`--write`, `--slug=`) czyta przy imporcie. */
async function loadScript(...argv: string[]): Promise<Script> {
  vi.resetModules();
  process.argv = ["bun", "scripts/i18n-translate-widgets.ts", ...argv];
  return import("../../../../scripts/i18n-translate-widgets");
}

async function run(...argv: string[]): Promise<void> {
  await (await loadScript(...argv)).main();
}

const doc = (...widgets: unknown[]) => ({ sections: [{ columns: [{ widgets }] }] });

/** `animated-heading` palety: `textBefore_pl` „Dołącz" / `_en` „Join". */
const animated = (content: Record<string, unknown>) => ({
  id: "ah",
  type: "animated-heading",
  content,
});

/** PL zmienione, EN zostawione na szablonie - w panelu `stale_default` (błąd). */
const STALE = animated({ textBefore_pl: "Poznaj nas", textBefore_en: "Join" });
/** Szablon palety nietknięty - poprawne tłumaczenie, nie wolno go nadpisać. */
const UNTOUCHED = animated({ textBefore_pl: "Dołącz", textBefore_en: "Join" });

const row = (slug: string, builderData: unknown) => ({
  id: `id-${slug}`,
  slug,
  builder_data: builderData,
});

/** Odczyt (`select`) dostaje wiersze, zapis (`update`) - wynik zapisu. */
function respond(
  table: "pages" | "posts",
  read: SupabaseResult,
  write: SupabaseResult = { data: null, error: null },
) {
  db.setResponse(table, (chain) => (chain.has("update") ? write : read));
}

const rows = (...list: unknown[]): SupabaseResult => ({ data: list, error: null });

function updates(table: string) {
  return db.chainsFor(table).filter((chain) => chain.has("update"));
}

beforeEach(() => {
  db.reset();
  h.from = db.from;
  h.files.clear();
  h.createClientArgs = [];
  sent = [];
  h.translate = async (batch) => {
    sent.push(batch);
    return batch.map((s) => `EN ${s}`);
  };
  process.env["SUPABASE_URL"] = "https://db.test";
  delete process.env["VITE_SUPABASE_URL"];
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-key";
  logs = [];
  warnings = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  vi.spyOn(console, "warn").mockImplementation(
    (...a: unknown[]) => void warnings.push(a.join(" ")),
  );
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${String(code)}`);
  });
  respond("pages", rows());
  respond("posts", rows());
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = savedArgv;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("widgetFillOptions - szablony palety dla zbierania i zapisu", () => {
  it("daje szablon widgetu z rejestru, a dla nieznanego typu nic", async () => {
    const { widgetFillOptions } = await loadScript();
    const opts = widgetFillOptions(WIDGETS, 1234);

    expect(opts.maxFieldChars).toBe(1234);
    expect(opts.getDefaults?.("animated-heading")).toMatchObject({
      textBefore_pl: "Dołącz",
      textBefore_en: "Join",
    });
    expect(opts.getDefaults?.("nie-ma-takiego-widgetu")).toBeUndefined();
  });

  it("szablon liczony raz na typ, nie przy każdym zapytaniu", async () => {
    const { widgetFillOptions } = await loadScript();
    const defaults = vi.fn(() => ({ text_pl: "A", text_en: "B" }));
    const opts = widgetFillOptions([{ type: "x", defaults }], 10);

    opts.getDefaults?.("x");
    opts.getDefaults?.("x");
    expect(defaults).toHaveBeenCalledTimes(1);
  });

  it("z szablonami: EN na szablonie przy zmienionym PL idzie do tłumaczenia, nietknięty szablon nie", async () => {
    const { widgetFillOptions } = await loadScript();
    const opts = widgetFillOptions(WIDGETS, 20_000);
    // Lista: tylko element ze zmienionym PL („prosto"), reszta to szablon.
    const list = animated({
      rotateWords_pl: ["szybko", "prosto", "skutecznie"],
      rotateWords_en: ["fast", "easy", "effective"],
    });

    expect(collectTranslatableTexts(doc(STALE, UNTOUCHED, list), opts)).toEqual([
      "Poznaj nas",
      "prosto",
    ]);
    // Kontrola: bez szablonów (stan sprzed poprawki) nic z tego nie wychodzi.
    expect(
      collectTranslatableTexts(doc(STALE, UNTOUCHED, list), { maxFieldChars: 20_000 }),
    ).toEqual([]);
  });
});

describe("main() - przebieg skryptu z szablonami palety", () => {
  it("podgląd: tłumaczy stale_default, nie rusza nietkniętego szablonu i niczego nie zapisuje", async () => {
    respond("pages", rows(row("o-nas", doc(STALE)), row("szablon", doc(UNTOUCHED))));
    await run();

    expect(sent).toEqual([["Poznaj nas"]]);
    expect(updates("pages")).toEqual([]);
    expect(JSON.parse(h.files.get(CACHE_PATH) ?? "{}")).toEqual({ "Poznaj nas": "EN Poznaj nas" });
    expect(logs).toContain("  · pages/o-nas: 1 pól");
    expect(logs.join("\n")).not.toContain("pages/szablon");
    expect(logs).toContain("\nDo zapisu (dry-run): 1 pól w 1 wierszach.");
    expect(logs).toContain("Uruchom ponownie z --write, żeby zapisać.");
    expect(h.createClientArgs).toEqual([
      ["https://db.test", "service-key", { auth: { persistSession: false } }],
    ]);
  });

  it("--write: zapisuje przetłumaczone EN tylko w wierszu, który go potrzebował", async () => {
    respond("pages", rows(row("o-nas", doc(STALE)), row("szablon", doc(UNTOUCHED))));
    respond(
      "posts",
      rows(
        row(
          "raport",
          doc(
            animated({
              rotateWords_pl: ["szybko", "prosto", "skutecznie"],
              rotateWords_en: ["fast", "easy", "effective"],
            }),
          ),
        ),
      ),
    );
    await run("--write");

    const [page] = updates("pages");
    expect(updates("pages")).toHaveLength(1);
    expect(page.argsOf("eq")).toEqual(["id", "id-o-nas"]);
    expect(page.argsOf("update")?.[0]).toEqual({
      builder_data: doc(animated({ textBefore_pl: "Poznaj nas", textBefore_en: "EN Poznaj nas" })),
    });
    const [post] = updates("posts");
    expect(post.argsOf("update")?.[0]).toEqual({
      builder_data: doc(
        animated({
          rotateWords_pl: ["szybko", "prosto", "skutecznie"],
          rotateWords_en: ["fast", "EN prosto", "effective"],
        }),
      ),
    });
    expect(logs).toContain("  → pages/o-nas: 1 pól");
    expect(logs).toContain("\nZapisano: 2 pól w 2 wierszach.");
    expect(logs).not.toContain("Uruchom ponownie z --write, żeby zapisać.");
  });

  it("odczyt zawężony do buildera i nieusuniętych; --slug= dokłada filtr", async () => {
    await run("--slug=o-nas");

    for (const table of ["pages", "posts"]) {
      const chain = db.lastChain(table);
      expect(chain?.argsOf("select")).toEqual(["id, slug, builder_data"]);
      const eqs = chain?.calls.filter((c) => c.method === "eq").map((c) => c.args);
      expect(eqs).toEqual([
        ["editor", "builder"],
        ["slug", "o-nas"],
      ]);
      expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    }
    expect(sent).toEqual([]);
    expect(logs[0]).toBe("Segmentów do tłumaczenia: 0 (nowych: 0, 0 znaków; z cache: 0).");
  });

  it("odczyt bez wierszy (`data: null`) to pusta tabela, nie wyjątek", async () => {
    respond("pages", { data: null, error: null });
    respond("posts", rows(row("raport", doc(STALE))));
    await run();

    expect(sent).toEqual([["Poznaj nas"]]);
    expect(logs).toContain("  · posts/raport: 1 pól");
  });

  it("VITE_SUPABASE_URL wystarcza zamiast SUPABASE_URL", async () => {
    delete process.env["SUPABASE_URL"];
    process.env["VITE_SUPABASE_URL"] = "https://vite.test";
    await run();
    expect(h.createClientArgs[0]?.[0]).toBe("https://vite.test");
  });
});

describe("main() - cache słownika", () => {
  it("segment z cache nie idzie drugi raz do modelu, a zapis go używa", async () => {
    h.files.set(CACHE_PATH, JSON.stringify({ "Poznaj nas": "Meet us" }));
    respond("pages", rows(row("o-nas", doc(STALE))));
    await run("--write");

    expect(sent).toEqual([]);
    expect(logs[0]).toBe("Segmentów do tłumaczenia: 1 (nowych: 0, 0 znaków; z cache: 1).");
    expect(updates("pages")[0]?.argsOf("update")?.[0]).toEqual({
      builder_data: doc(animated({ textBefore_pl: "Poznaj nas", textBefore_en: "Meet us" })),
    });
  });

  it.each([
    ["uszkodzony JSON", "{nie-json"],
    ["tablica zamiast obiektu", JSON.stringify(["Poznaj nas"])],
    ["null", "null"],
    ["wartość nietekstowa", JSON.stringify({ "Poznaj nas": 7 })],
  ])("cache: %s - ignorowany, segment tłumaczony od nowa", async (_name, content) => {
    h.files.set(CACHE_PATH, content);
    respond("pages", rows(row("o-nas", doc(STALE))));
    await run();

    expect(sent).toEqual([["Poznaj nas"]]);
  });
});

describe("main() - porcje i oporne segmenty", () => {
  const headings = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `h${i}`,
      type: "heading",
      content: { text_pl: `Nagłówek numer ${i}`, text_en: "" },
    }));

  it("dzieli korpus na porcje po 20 segmentów, a ten sam tekst tłumaczy raz", async () => {
    respond("pages", rows(row("a", doc(...headings(45))), row("b", doc(...headings(3)))));
    await run();

    expect(sent.map((batch) => batch.length)).toEqual([20, 20, 5]);
    expect(logs).toContain("  ✓ przetłumaczono 45/45 segmentów");
  });

  it("porcja, która padła, dzieli się na pół; oporny segment trafia do pominiętych", async () => {
    h.translate = async (batch) => {
      sent.push(batch);
      if (batch.includes("Nagłówek numer 2")) throw new Error("model obciął JSON");
      return batch.map((s) => `EN ${s}`);
    };
    respond("pages", rows(row("a", doc(...headings(4)))));
    await run("--write");

    expect(sent).toEqual([
      ["Nagłówek numer 0", "Nagłówek numer 1", "Nagłówek numer 2", "Nagłówek numer 3"],
      ["Nagłówek numer 0", "Nagłówek numer 1"],
      ["Nagłówek numer 2", "Nagłówek numer 3"],
      ["Nagłówek numer 2"],
      ["Nagłówek numer 3"],
    ]);
    expect(warnings).toContain("  ⚠ pominięto segment (16 zn.): model obciął JSON");
    expect(warnings).toContain("⚠ Segmentów bez tłumaczenia: 1.");
    expect(logs).toContain("\nZapisano: 3 pól w 1 wierszach. Bez tłumaczenia: 1.");
  });

  it("błąd nie-Error z modelu też jest opisany", async () => {
    h.translate = () => Promise.reject("timeout");
    respond("pages", rows(row("a", doc(...headings(1)))));
    await run();

    expect(warnings).toContain("  ⚠ pominięto segment (16 zn.): timeout");
  });

  it("--max-chars= pomija pola dłuższe niż limit", async () => {
    respond("pages", rows(row("a", doc(...headings(1)))));
    await run("--max-chars=5");

    expect(sent).toEqual([]);
  });
});

describe("main() - awarie kończą przebieg kodem 1", () => {
  it.each([
    ["SUPABASE_URL", "✗ Brak SUPABASE_URL / VITE_SUPABASE_URL."],
    [
      "SUPABASE_SERVICE_ROLE_KEY",
      "✗ Brak SUPABASE_SERVICE_ROLE_KEY - zapis treści wymaga klucza serwisowego.",
    ],
  ])("brak %s: komunikat i wyjście, bez łączenia z bazą", async (key, message) => {
    delete process.env[key];
    await expect(run()).rejects.toThrow("exit 1");

    expect(errors).toEqual([message]);
    expect(h.createClientArgs).toEqual([]);
  });

  it("odczyt tabeli, który padł", async () => {
    respond("posts", fail("permission denied for table posts"));
    await expect(run()).rejects.toThrow("exit 1");

    expect(errors).toEqual(["✗ Odczyt posts: permission denied for table posts"]);
  });

  it("zapis wiersza, który padł", async () => {
    respond("pages", rows(row("o-nas", doc(STALE))), fail("row-level security"));
    await expect(run("--write")).rejects.toThrow("exit 1");

    expect(errors).toEqual(["✗ Zapis pages/o-nas: row-level security"]);
  });

  it("import modułu niczego nie uruchamia (przebieg tylko pod `bun run`)", async () => {
    await loadScript("--write");
    expect(h.createClientArgs).toEqual([]);
    expect(db.chains).toEqual([]);
    expect(logs).toEqual([]);
  });
});
