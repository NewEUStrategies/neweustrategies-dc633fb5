// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputBundle, NormalizedOutputOptions, PluginContext } from "rollup";
const h = vi.hoisted(() => ({ write: vi.fn(), mkdir: vi.fn() }));
vi.mock("node:fs", () => ({ writeFileSync: h.write, mkdirSync: h.mkdir }));
import { chunkInventoryPlugin } from "../../../../scripts/lib/chunkInventoryPlugin";

function emit(enabled: boolean | undefined, outDir = "dist/client") {
  const plugin = enabled === undefined ? chunkInventoryPlugin() : chunkInventoryPlugin(enabled);
  const hook = plugin.generateBundle;
  if (typeof hook !== "function") throw new Error("missing generateBundle hook");
  const bundle = {
    "assets/entry.js": {
      type: "chunk",
      isEntry: true,
      isDynamicEntry: false,
      imports: ["assets/vendor.js"],
      dynamicImports: ["assets/lazy.js"],
      modules: { "src/entry.ts": { renderedLength: 30 }, "src/removed.ts": { renderedLength: 0 } },
    },
    "assets/vendor.js": {
      type: "chunk",
      isEntry: false,
      isDynamicEntry: false,
      imports: [],
      dynamicImports: [],
      modules: { "vendor/b": { renderedLength: 10 }, "vendor/a": { renderedLength: 20 } },
    },
    "style.css": { type: "asset", source: "body{}" },
  } as unknown as OutputBundle;
  hook.call(
    { warn: vi.fn() } as unknown as PluginContext,
    { dir: outDir } as NormalizedOutputOptions,
    bundle,
    false,
  );
  return bundle;
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe("smoke inventory comes from the build being measured", () => {
  it("emits the actual static and dynamic edges even without the optional diagnostics variable", () => {
    vi.stubEnv("BUNDLE_INVENTORY", "");
    const bundle = emit(true);
    const report = JSON.parse(h.write.mock.calls[0][1]);
    expect(report.outDir).toBe("dist/client");
    expect(report.chunks).toHaveLength(2);
    expect(report.chunks[0]).toMatchObject({
      file: "assets/entry.js",
      imports: ["assets/vendor.js"],
      dynamicImports: ["assets/lazy.js"],
      bytes: 30,
      modules: [{ id: "src/entry.ts", bytes: 30 }],
    });
    expect(report.chunks[1].modules.map((m: { id: string }) => m.id)).toEqual([
      "vendor/a",
      "vendor/b",
    ]);
    expect(Object.keys(bundle)).toHaveLength(3);
  });
  it("keeps ordinary builds opt-in and excludes server output", () => {
    vi.stubEnv("BUNDLE_INVENTORY", "");
    emit(undefined);
    emit(true, "dist/server");
    expect(h.write).not.toHaveBeenCalled();
    vi.stubEnv("BUNDLE_INVENTORY", "1");
    emit(undefined);
    expect(h.write).toHaveBeenCalledTimes(1);
  });
});
