// @vitest-environment node
//
// `nes:dev-build-keep-names` (scripts/lib/devBuildKeepNames.ts): `output.keepNames` Rolldowna
// WYŁĄCZNIE dla `vite build --mode development` - odpowiednik `esbuild.keepNames`, które
// @lovable.dev/vite-tanstack-config ustawia buildowi deweloperskiemu, a którego Vite 8 przy
// minifikacji Oxc-iem już nie czyta. Drugi przypadek buduje maleńki moduł PRAWDZIWYM `vite
// build` z tą wtyczką i minifikacją Oxc: dowodzi, że wynik hooka dociera do Rolldowna i że
// opcja naprawdę zachowuje nazwy przy minifikacji (bez tego wtyczka byłaby pustym gestem).
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { build, type ConfigEnv, type Plugin, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";

import { devBuildKeepNamesPlugin } from "../../../../scripts/lib/devBuildKeepNames";

function configFor(mode: string): unknown {
  const hook = devBuildKeepNamesPlugin().config;
  const handler = typeof hook === "function" ? hook : hook?.handler;
  if (!handler) throw new Error("wtyczka bez hooka `config`");
  const env: ConfigEnv = { command: "build", mode, isSsrBuild: false, isPreview: false };
  return handler.call({} as ThisParameterType<typeof handler>, {}, env);
}

const SOURCE = [
  "function MyComponent() { return 1; }",
  "class MyService {}",
  "globalThis.__names = [MyComponent.name, MyService.name];",
].join("\n");

/** Wejście wirtualne - test nie dotyka dysku. */
function entryPlugin(): Plugin {
  return {
    name: "entry",
    resolveId: (id) => (id === "virtual:entry" ? "\0virtual:entry" : null),
    load: (id) => (id === "\0virtual:entry" ? SOURCE : null),
  };
}

async function bundle(mode: string): Promise<string> {
  const result = await build({
    configFile: false,
    envFile: false,
    root: process.cwd(),
    publicDir: false,
    logLevel: "silent",
    mode,
    plugins: [entryPlugin(), devBuildKeepNamesPlugin()],
    build: {
      write: false,
      minify: "oxc",
      rolldownOptions: { input: "virtual:entry" },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunk = outputs.flatMap((o) => o.output).find((o) => o.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("build bez chunku");
  return chunk.code;
}

describe("nes:dev-build-keep-names", () => {
  it("włącza `keepNames` wyłącznie w trybie development i tylko dla `build`", () => {
    expect(devBuildKeepNamesPlugin().apply).toBe("build");
    expect(configFor("development")).toEqual({
      build: { rolldownOptions: { output: { keepNames: true } } },
    });
    expect(configFor("production")).toBeNull();
    expect(configFor("staging")).toBeNull();
  });

  it("build deweloperski zachowuje `.name` funkcji i klas po minifikacji Oxc", async () => {
    const dev = await bundle("development");
    expect(dev).toContain("function MyComponent(");
    expect(dev).toContain("MyService=class");
    // Kontrola: build produkcyjny skraca nazwy - inaczej przypadek wyżej nic by nie mówił.
    expect(await bundle("production")).not.toContain("MyComponent");
  });
});
