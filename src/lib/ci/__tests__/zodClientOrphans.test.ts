// Zapadka J2 (`zodClientOrphans.ts`): schemat zod bez odczytu wartości
// w kliencie nie wraca do chunków przeglądarki jako gołe wywołanie.
//
// Wycinki niżej odtwarzają kształty z partii 1 roadmapy ładowania (§9.5):
// schemat czytany tylko w `z.infer`, tylko w walidatorze funkcji serwerowej
// albo tylko wewnątrz innej sieroty - oraz kształty, które sierotą NIE są
// (odczyt wartości w kliencie, owijka `@__PURE__`, moduł serwerowy,
// deklaracja usuwana przez kompilator Start), a także odczyty PO NAZWIE przez
// `import()`, reeksporty i przestrzenie nazw (przegląd partii 5). Stan
// repozytorium: zbiór sierot jest RÓWNY przejrzanej liście - nowa sierota albo
// naprawiona, a niezdjęta z listy, czerwieni test; to samo z ucieczkami
// przestrzeni nazw (`ZOD_NAMESPACE_ESCAPES_REVIEWED`).
import { describe, expect, it } from "vitest";

import {
  CLIENT_ROOTS,
  ZOD_CLIENT_ORPHANS_REVIEWED,
  ZOD_NAMESPACE_ESCAPES_REVIEWED,
  findZodClientOrphans,
  zodClientReport,
} from "../zodClientOrphans";
import { loadProductionSources } from "../../../../scripts/lib/onConflictArbitersInputs";

/** Wejście klienta ładujące podane moduły (import efektu, bez wiązań). */
function router(...modules: string[]): string {
  return modules.map((m) => `import "${m}";`).join("\n");
}

function orphans(files: Record<string, string>): string[] {
  return findZodClientOrphans(
    Object.entries(files).map(([file, code]) => ({ file, code })),
    ["src/router.tsx"],
    {},
  ).map((o) => `${o.reason} ${o.file}:${o.name}`);
}

const ZOD = `import { z } from "zod";`;
const START = `import { createServerFn } from "@tanstack/react-start";`;

describe("findZodClientOrphans - wycinki", () => {
  it("schemat czytany tylko w typie w module klienta - sierota", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a"),
        "src/lib/a.ts": `${ZOD}
          const Settings = z.object({ a: z.string() });
          export type SettingsT = z.infer<typeof Settings>;
          export const DEFAULTS: SettingsT = { a: "x" };
        `,
      }),
    ).toEqual(["tylko-typy src/lib/a.ts:Settings"]);
  });

  it("odczyt wartości w kliencie (także w pliku importującym) - nie sierota", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a", "@/components/b"),
        "src/lib/a.ts": `${ZOD}
          const Local = z.string();
          export const parseLocal = (v: unknown) => Local.parse(v);
          export const Shared = z.object({ a: z.string() });
        `,
        "src/components/b.tsx": `
          import { Shared } from "@/lib/a";
          export const ok = Shared.safeParse({}).success;
        `,
      }),
    ).toEqual([]);
  });

  it("eksport czytany w innym module tylko w typie - sierota w module eksportującym", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/components/b"),
        "src/lib/a.ts": `${ZOD}
          export const Shared = z.object({ a: z.string() });
        `,
        "src/components/b.tsx": `
          import { Shared } from "@/lib/a";
          import type { z } from "zod";
          export type B = z.infer<typeof Shared>;
          export const marker = 1;
        `,
      }),
    ).toEqual(["tylko-typy src/lib/a.ts:Shared"]);
  });

  it("owijka `/* @__PURE__ */ (() => ...)()` - nie sierota, a schemat w niej trzymany żyje razem z nią", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a"),
        "src/lib/a.ts": `${ZOD}
          const Inner = /* @__PURE__ */ (() => z.string().uuid())();
          const Outer = /* @__PURE__ */ (() => z.object({ id: Inner }))();
          export type O = z.infer<typeof Outer>;
          export const marker = 1;
        `,
      }),
    ).toEqual([]);
  });

  it("schemat czytany tylko wewnątrz innej sieroty - sierota razem z nią; żywa sierota - nie", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a"),
        "src/lib/a.ts": `${ZOD}
          const Id = z.string().uuid();
          const Dead = z.object({ id: Id });
          export type DeadT = z.infer<typeof Dead>;
          const Tag = z.string();
          const Live = z.object({ tag: Tag });
          export const check = (v: unknown) => Live.parse(v);
        `,
      }),
    ).toEqual(["tylko-typy src/lib/a.ts:Dead", "w-sierocie src/lib/a.ts:Id"]);
  });

  it("łańcuch od schematu z importu (`Base.extend`) to też schemat", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/b"),
        "src/lib/a.ts": `${ZOD}
          export const Base = z.object({ a: z.string() });
          export const useBase = (v: unknown) => Base.parse(v);
        `,
        "src/lib/b.ts": `${ZOD}
          import { Base } from "@/lib/a";
          const Extended = Base.extend({ b: z.number() });
          type E = z.infer<typeof Extended>;
          export const e: E | null = null;
        `,
      }),
    ).toEqual(["tylko-typy src/lib/b.ts:Extended"]);
  });

  it("plik Start: walidator + typ NIEeksportowany albo eksport schematu - sierota; typ eksportowany - usuwa kompilator", () => {
    // `export type` zdejmuje `stripTypeExports` przed eliminacją martwego kodu,
    // więc `Removed` znika z klienta; `type Kept` zostaje i trzyma deklarację.
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a.functions"),
        "src/lib/a.functions.ts": `${ZOD}
          ${START}
          const Removed = z.object({ a: z.string() });
          export type RemovedT = z.infer<typeof Removed>;
          const Kept = z.object({ b: z.string() });
          type KeptT = z.infer<typeof Kept>;
          export const ExportedInput = z.object({ c: z.string() });
          export const one = createServerFn({ method: "POST" })
            .inputValidator((d: unknown) => Removed.parse(d))
            .handler(async ({ data }) => data);
          export const two = createServerFn({ method: "POST" })
            .validator((d: unknown): KeptT => Kept.parse(d))
            .handler(async ({ data }) => data);
          export const three = createServerFn({ method: "POST" })
            .inputValidator(ExportedInput)
            .handler(async () => ExportedInput.parse({}));
        `,
      }),
    ).toEqual([
      "tylko-serwer src/lib/a.functions.ts:ExportedInput",
      "tylko-typy src/lib/a.functions.ts:Kept",
    ]);
  });

  it("plik Start: samoodwołanie `z.lazy` i schemat w usuwanym schemacie - usuwa kompilator", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a.functions"),
        "src/lib/a.functions.ts": `${ZOD}
          ${START}
          const Json: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.array(Json)]));
          const Input = z.object({ data: Json });
          export const save = createServerFn({ method: "POST" })
            .inputValidator((d: unknown) => Input.parse(d))
            .handler(async ({ data }) => data);
        `,
      }),
    ).toEqual([]);
  });

  it("schemat bez żadnego odczytu - sierota także w pliku Start (kompilator rusza tylko odczytane)", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a", "@/lib/b.functions"),
        "src/lib/a.ts": `${ZOD}\nconst Unused = z.string();\nexport const marker = 1;`,
        "src/lib/b.functions.ts": `${ZOD}\n${START}\nconst Unused = z.number();\nexport const f = createServerFn().handler(async () => 1);`,
      }),
    ).toEqual(["brak-odczytu src/lib/a.ts:Unused", "brak-odczytu src/lib/b.functions.ts:Unused"]);
  });

  it("moduł `*.server.*` i moduł nieosiągalny z wejścia klienta - poza zapadką", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a.server", "@/lib/b"),
        "src/lib/a.server.ts": `${ZOD}\nconst S = z.string();\nexport type T = z.infer<typeof S>;`,
        "src/lib/b.ts": `export const b = 1;`,
        "src/lib/unreached.ts": `${ZOD}\nconst U = z.string();\nexport type T = z.infer<typeof U>;`,
      }),
    ).toEqual([]);
  });
});

describe("findZodClientOrphans - odczyty po nazwie (`import()`, reeksporty, przestrzenie nazw)", () => {
  // Żywy jest eksport, który ktoś CZYTA - nie cały moduł, do którego prowadzi
  // `import()` albo `export … from` (przegląd partii 5: 498 z 4417 modułów
  // klienta było celem takiej krawędzi, a każdy ich eksportowany schemat
  // uchodził za żywy).
  it("eksport tylko-typy w module ładowanym przez `import()` - sierota (kształt `paywallOffer.ts`)", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/components/Paywall"),
        "src/components/Paywall.tsx": `
          export function load() {
            return import("@/lib/access/offer").then((m) => m.loadOffer());
          }
        `,
        "src/lib/access/offer.ts": `${ZOD}
          export const OfferSchema = z.object({ plan: z.string() });
          export type Offer = z.infer<typeof OfferSchema>;
          export async function loadOffer(): Promise<Offer | null> { return null; }
        `,
      }),
    ).toEqual(["tylko-typy src/lib/access/offer.ts:OfferSchema"]);
  });

  it('kształty odczytu `import()`: `.then`, `await`, rozkład, `m["x"]`, `Promise.all`, `lazy` - żywe tylko czytane nazwy', () => {
    const schemas = (...names: string[]) =>
      names.map((n) => `export const ${n} = z.string();`).join("\n");
    const report = zodClientReport(
      Object.entries({
        "src/router.tsx": `
          import { lazy } from "react";
          export const Page = lazy(() => import("@/lib/page"));
          export async function run() {
            await import("@/lib/m").then(({ A }) => A.parse(""));
            (await import("@/lib/m")).B.parse("");
            const m = await import("@/lib/m");
            m.C.parse("");
            m["D"].parse("");
            const { E: renamed } = await import("@/lib/m");
            renamed.parse("");
            const [{ F }, other] = await Promise.all([import("@/lib/m"), import("@/lib/m2")]);
            F.parse(other.G.parse(""));
            void import("@/lib/m2");
            void Promise.allSettled([import("@/lib/m2")]);
            return Promise.all([import("@/lib/m2"), import("@/lib/m")]).then(([, n]) => n.H);
          }
        `,
        "src/lib/m.ts": `${ZOD}\n${schemas("A", "B", "C", "D", "E", "F", "H", "Unread")}`,
        "src/lib/m2.ts": `${ZOD}\n${schemas("G", "Unread2")}`,
        "src/lib/page.ts": `${ZOD}\nconst PageSchema = z.object({});\nexport default PageSchema;\nexport const NotDefault = z.string();`,
      }).map(([file, code]) => ({ file, code })),
      ["src/router.tsx"],
      {},
    );
    expect(report.orphans.map((o) => `${o.reason} ${o.file}:${o.name}`)).toEqual([
      "brak-odczytu src/lib/m.ts:Unread",
      "brak-odczytu src/lib/m2.ts:Unread2",
      "brak-odczytu src/lib/page.ts:NotDefault",
    ]);
    // Każdy kształt rozpoznany - żadnej ucieczki (także samo `void import()`).
    expect(report.escapes).toEqual([]);
  });

  it("`import()` w części zdejmowanej przez Start - odczyt serwerowy, nie żywy", () => {
    expect(
      orphans({
        "src/router.tsx": router("@/lib/a.functions", "@/lib/m"),
        "src/lib/a.functions.ts": `
          ${START}
          export const f = createServerFn().handler(async () => {
            const { Input } = await import("@/lib/m");
            return Input.parse("");
          });
        `,
        "src/lib/m.ts": `${ZOD}\nexport const Input = z.string();`,
      }),
    ).toEqual(["tylko-serwer src/lib/m.ts:Input"]);
  });

  it("`export { X } from` i `export *` - żywe tylko nazwy importowane (także z aliasem) i czytane jako wartość", () => {
    expect(
      orphans({
        "src/router.tsx": `
          import { A, BB, N1 } from "@/lib/barrel";
          import type { z } from "zod";
          export type B = z.infer<typeof BB>;
          export const ok = [A.parse(""), N1.parse("")];
        `,
        "src/lib/barrel.ts": `
          export { A, B as BB, C } from "@/lib/m";
          export * from "@/lib/n";
        `,
        "src/lib/m.ts": `${ZOD}\nexport const A = z.string();\nexport const B = z.string();\nexport const C = z.string();`,
        "src/lib/n.ts": `${ZOD}\nexport const N1 = z.string();\nexport const N2 = z.string();`,
      }),
    ).toEqual([
      "tylko-typy src/lib/m.ts:B",
      "brak-odczytu src/lib/m.ts:C",
      "brak-odczytu src/lib/n.ts:N2",
    ]);
  });

  it("`import * as ns` - `ns.X` żywy, `typeof ns.Y` tylko typ", () => {
    expect(
      orphans({
        "src/router.tsx": `
          import * as ns from "@/lib/m";
          import type { z } from "zod";
          export type Y = z.infer<typeof ns.Y>;
          export const ok = ns.X.parse("");
        `,
        "src/lib/m.ts": `${ZOD}\nexport const X = z.string();\nexport const Y = z.string();`,
      }),
    ).toEqual(["tylko-typy src/lib/m.ts:Y"]);
  });

  it("ucieczka przestrzeni nazw (oddana jako wartość, zwrócona, przesłonięta) - nieprzejrzana nie daje odczytu i jest zgłaszana; przejrzana - schematy żyją", () => {
    const files = Object.entries({
      "src/router.tsx": `
        import * as ns from "@/lib/ns";
        export const registry = [ns];
        export const loadDyn = () => import("@/lib/dyn");
        export const loadNoSchema = () => import("@/lib/plain");
      `,
      "src/lib/ns.ts": `${ZOD}\nexport const N = z.string();`,
      "src/lib/dyn.ts": `${ZOD}\nexport const D = z.string();`,
      "src/lib/plain.ts": `export const plain = 1;`,
    }).map(([file, code]) => ({ file, code }));
    const open = zodClientReport(files, ["src/router.tsx"], {});
    expect(open.orphans.map((o) => `${o.reason} ${o.file}:${o.name}`)).toEqual([
      "brak-odczytu src/lib/dyn.ts:D",
      "brak-odczytu src/lib/ns.ts:N",
    ]);
    // Ucieczka modułu bez schematów (`plain.ts`) nie jest zgłaszana.
    expect(open.escapes).toEqual([
      {
        key: "src/router.tsx -> src/lib/dyn.ts",
        sites: ['4: import("@/lib/dyn")'],
        schemas: ["src/lib/dyn.ts:D"],
        reviewed: false,
      },
      {
        key: "src/router.tsx -> src/lib/ns.ts",
        sites: ["3: ns"],
        schemas: ["src/lib/ns.ts:N"],
        reviewed: false,
      },
    ]);
    const reviewed = zodClientReport(files, ["src/router.tsx"], {
      "src/router.tsx -> src/lib/dyn.ts": "powód",
      "src/router.tsx -> src/lib/ns.ts": "powód",
    });
    expect(reviewed.orphans).toEqual([]);
    expect(reviewed.escapes.map((e) => e.reviewed)).toEqual([true, true]);
  });

  it("`const m = await import()` w bloku: odczyt `m.X` POZA blokiem to inne wiązanie, nie odczyt modułu (`var` - cała funkcja)", () => {
    // Zewnętrzne `m` jest wiązane poza funkcją (parametr funkcji zewnętrznej),
    // więc w funkcji jest JEDNO wiązanie `m` - dawniej to wystarczało, żeby
    // `m.TypeOnly` spoza bloku liczył się jako odczyt `@/lib/a`.
    const report = zodClientReport(
      Object.entries({
        "src/router.tsx": `
          export function outer(m: { TypeOnly: unknown }) {
            return async function inner(flag: boolean) {
              if (flag) {
                const m = await import("@/lib/a");
                m.Read.parse("");
              }
              return m.TypeOnly;
            };
          }
          export async function hoisted(flag: boolean) {
            if (flag) {
              var v = await import("@/lib/b");
            }
            return v.Hoisted.parse("");
          }
          export async function sibling(flag: boolean) {
            if (flag) {
              const s = await import("@/lib/c");
              return s.InBlock.parse("");
            }
            return import("@/lib/c").then((s) => s.ViaThen.parse(""));
          }
        `,
        "src/lib/a.ts": `${ZOD}\nexport const Read = z.string();\nexport const TypeOnly = z.string();`,
        "src/lib/b.ts": `${ZOD}\nexport const Hoisted = z.string();`,
        "src/lib/c.ts": `${ZOD}\nexport const InBlock = z.string();\nexport const ViaThen = z.string();\nexport const Unread = z.string();`,
      }).map(([file, code]) => ({ file, code })),
      ["src/router.tsx"],
      {},
    );
    expect(report.orphans.map((o) => `${o.reason} ${o.file}:${o.name}`)).toEqual([
      "brak-odczytu src/lib/a.ts:TypeOnly",
      "brak-odczytu src/lib/c.ts:Unread",
    ]);
    expect(report.escapes).toEqual([]);
  });

  it("nazwa przestrzeni przesłonięta albo rozkład `...rest` - ucieczka, nie zgadywanie", () => {
    const report = zodClientReport(
      [
        {
          file: "src/router.tsx",
          code: `
            export async function f() {
              const m = await import("@/lib/a");
              const g = (m: { X: unknown }) => m.X;
              const { ...rest } = await import("@/lib/b");
              return [m.X, g, rest];
            }
          `,
        },
        { file: "src/lib/a.ts", code: `${ZOD}\nexport const X = z.string();` },
        { file: "src/lib/b.ts", code: `${ZOD}\nexport const Y = z.string();` },
      ],
      ["src/router.tsx"],
      {},
    );
    expect(report.escapes.map((e) => [e.key, e.sites])).toEqual([
      ["src/router.tsx -> src/lib/a.ts", ["3: m"]],
      ["src/router.tsx -> src/lib/b.ts", ["5: ...rest"]],
    ]);
  });
});

describe("stan repozytorium", () => {
  // Jedno parsowanie wszystkich plików produkcyjnych (kilka sekund) - przy
  // zbieraniu testów, jak `tsSqlContract.test.ts`.
  const { reachable, orphans: repo, escapes } = zodClientReport(loadProductionSources());

  it("wejście klienta istnieje i obejmuje drzewo tras, bez modułów `*.server.*`", () => {
    for (const root of CLIENT_ROOTS) expect(reachable.has(root), root).toBe(true);
    expect(reachable.has("src/routes/__root.tsx")).toBe(true);
    expect(reachable.has("src/routeTree.gen.ts")).toBe(true);
    expect([...reachable].filter((file) => /\.server\.[cm]?[jt]sx?$/.test(file))).toEqual([]);
  });

  it("sieroty to DOKŁADNIE przejrzana lista (nowa - czerwono; naprawiona - zdejmij z listy)", () => {
    // Nowy schemat bez odczytu wartości w kliencie: zamień go w typ TS albo
    // owiń w `/* @__PURE__ */ (() => ...)()` (`lib/menus/types.ts`). Lista
    // może TYLKO maleć.
    expect(repo.map((o) => `${o.file}:${o.name}`)).toEqual(
      Object.keys(ZOD_CLIENT_ORPHANS_REVIEWED).sort(),
    );
    for (const o of repo) {
      expect(ZOD_CLIENT_ORPHANS_REVIEWED[`${o.file}:${o.name}`], `${o.file}:${o.name}`).toMatch(
        new RegExp(`^${o.reason}:`),
      );
    }
  });

  it("ucieczki przestrzeni nazw modułów ze schematami to DOKŁADNIE przejrzana lista (fail closed)", () => {
    // Nowa ucieczka: czytaj po nazwie (`m.x`, `const { x } = await import(...)`)
    // albo dopisz `importer -> moduł` z powodem do
    // `ZOD_NAMESPACE_ESCAPES_REVIEWED`. Lista może TYLKO maleć.
    expect(escapes.filter((e) => !e.reviewed)).toEqual([]);
    expect(escapes.map((e) => e.key)).toEqual(Object.keys(ZOD_NAMESPACE_ESCAPES_REVIEWED).sort());
  });
});
