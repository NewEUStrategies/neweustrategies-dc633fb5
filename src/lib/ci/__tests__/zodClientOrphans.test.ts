// Zapadka J2 (`zodClientOrphans.ts`): schemat zod bez odczytu wartości
// w kliencie nie wraca do chunków przeglądarki jako gołe wywołanie.
//
// Wycinki niżej odtwarzają kształty z partii 1 roadmapy ładowania (§9.5):
// schemat czytany tylko w `z.infer`, tylko w walidatorze funkcji serwerowej
// albo tylko wewnątrz innej sieroty - oraz kształty, które sierotą NIE są
// (odczyt wartości w kliencie, owijka `@__PURE__`, moduł serwerowy,
// deklaracja usuwana przez kompilator Start). Stan repozytorium: zbiór sierot
// jest RÓWNY przejrzanej liście - nowa sierota albo naprawiona, a niezdjęta
// z listy, czerwieni test.
import { describe, expect, it } from "vitest";

import {
  CLIENT_ROOTS,
  ZOD_CLIENT_ORPHANS_REVIEWED,
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

  it("reeksport, import przestrzeni nazw i `import()` - liczone jako żywe (dalej nie śledzimy)", () => {
    expect(
      orphans({
        "src/router.tsx": `
          import { Re } from "@/lib/barrel";
          import * as ns from "@/lib/ns";
          export const lazy = () => import("@/lib/dyn");
          export const x = [Re, ns];
        `,
        "src/lib/barrel.ts": `export { Re } from "@/lib/re";`,
        "src/lib/re.ts": `${ZOD}\nexport const Re = z.string();`,
        "src/lib/ns.ts": `${ZOD}\nexport const N = z.string();`,
        "src/lib/dyn.ts": `${ZOD}\nexport const D = z.string();`,
      }),
    ).toEqual([]);
  });
});

describe("stan repozytorium", () => {
  // Jedno parsowanie wszystkich plików produkcyjnych (kilka sekund) - przy
  // zbieraniu testów, jak `tsSqlContract.test.ts`.
  const { reachable, orphans: repo } = zodClientReport(loadProductionSources());

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
});
