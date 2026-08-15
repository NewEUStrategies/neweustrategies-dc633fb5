import { describe, expect, it } from "vitest";
import {
  isScannable,
  layerOf,
  renderContentLayeringReport,
  resolveSpecifier,
  scanContentLayering,
  type ScannedSource,
} from "../contentLayering";

function source(file: string, ...lines: string[]): ScannedSource {
  return { file, source: lines.join("\n") };
}

describe("layerOf", () => {
  it("rozpoznaje wszystkie trzy piętra i warstwę tras", () => {
    expect(layerOf("src/lib/content-model/json.ts")).toBe("content-model");
    expect(layerOf("src/lib/blocks/types.ts")).toBe("blocks");
    expect(layerOf("src/components/blocks/BlocksRenderer.tsx")).toBe("blocks");
    expect(layerOf("src/components/admin/blocks/AdminColorPicker.tsx")).toBe("blocks");
    expect(layerOf("src/lib/builder/types.ts")).toBe("builder");
    expect(layerOf("src/components/admin/builder/Builder.tsx")).toBe("builder");
    expect(layerOf("src/routes/$.tsx")).toBe("routes");
  });

  it("zwraca null poza zasięgiem inwariantu - adapter wp-import zna oba silniki", () => {
    expect(layerOf("src/lib/wp-import/convert.ts")).toBeNull();
    expect(layerOf("src/components/ui/button.tsx")).toBeNull();
    expect(layerOf("src/lib/queries/public.ts")).toBeNull();
  });

  it("nie myli `admin/builder` z `admin/blocks` - prefiksy różnią się jedną literą", () => {
    expect(layerOf("src/components/admin/builder/ui/atoms/ColorField.tsx")).toBe("builder");
    expect(layerOf("src/components/admin/blocks/edit/Faq.tsx")).toBe("blocks");
  });
});

describe("resolveSpecifier", () => {
  it("rozwija alias @/ do ścieżki względnej repo", () => {
    expect(resolveSpecifier("@/lib/builder/types", "src/lib/blocks/x.ts")).toBe(
      "src/lib/builder/types",
    );
  });

  it("rozwija ścieżki relatywne z wyjściem w górę", () => {
    expect(resolveSpecifier("../builder/types", "src/lib/blocks/x.ts")).toBe(
      "src/lib/builder/types",
    );
    expect(resolveSpecifier("./types", "src/lib/blocks/x.ts")).toBe("src/lib/blocks/types");
    expect(resolveSpecifier("../../lib/builder/types", "src/components/blocks/x.tsx")).toBe(
      "src/lib/builder/types",
    );
  });

  it("zwraca null dla importów pakietowych", () => {
    expect(resolveSpecifier("react", "src/lib/blocks/x.ts")).toBeNull();
    expect(resolveSpecifier("@tanstack/react-query", "src/lib/blocks/x.ts")).toBeNull();
  });
});

describe("isScannable", () => {
  it("pomija testy i moduł samej bramki", () => {
    expect(isScannable("src/lib/blocks/types.ts")).toBe(true);
    expect(isScannable("src/lib/blocks/__tests__/types.test.ts")).toBe(false);
    expect(isScannable("src/lib/blocks/types.test.ts")).toBe(false);
    expect(isScannable("src/lib/ci/contentLayering.ts")).toBe(false);
    expect(isScannable("src/lib/blocks/styles.css")).toBe(false);
  });
});

describe("scanContentLayering", () => {
  it("zgłasza import bloki -> builder, bo to była krawędź rosnącego cyklu", () => {
    const { violations } = scanContentLayering([
      source(
        "src/lib/blocks/wordPaste.ts",
        "// nagłówek",
        'import type { Block } from "./types";',
        'import { toJson } from "@/lib/builder/types";',
      ),
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.from).toBe("blocks");
    expect(violations[0]?.to).toBe("builder");
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.specifier).toBe("@/lib/builder/types");
    expect(violations[0]?.remedy).toContain("@/lib/content-model/json");
  });

  it("przepuszcza builder -> bloki i liczy te krawędzie informacyjnie", () => {
    const { violations, stats } = scanContentLayering([
      source(
        "src/components/admin/builder/ui/organisms/widget-view/RichTextView.tsx",
        'import type { BlocksDoc } from "@/lib/blocks/types";',
        'import { BlocksRenderer } from "@/components/blocks/BlocksRenderer";',
      ),
    ]);

    expect(violations).toEqual([]);
    expect(stats.allowedBuilderToBlocks).toBe(2);
  });

  it("zgłasza każdy import z warstwy wspólnej do silnika lub tras", () => {
    const { violations } = scanContentLayering([
      source(
        "src/lib/content-model/postContext.tsx",
        'import { x } from "@/lib/builder/registry";',
        'import { y } from "@/components/blocks/BlocksRenderer";',
        'import { z } from "@/routes/$";',
      ),
    ]);

    expect(violations.map((v) => v.to).sort()).toEqual(["blocks", "builder", "routes"]);
  });

  it("przepuszcza to, co warstwie wspólnej wolno: react i design system", () => {
    const { violations } = scanContentLayering([
      source(
        "src/lib/content-model/profileCardStyle.ts",
        'import { createContext } from "react";',
        'import type { ProfileCardStyle } from "@/components/ui/profile-card";',
        'import { pickLocalized } from "@/lib/i18n/pickLocalized";',
      ),
    ]);

    expect(violations).toEqual([]);
  });

  it("widzi import dynamiczny i re-eksport, nie tylko statyczne `import … from`", () => {
    const { violations } = scanContentLayering([
      source(
        "src/lib/blocks/registry.tsx",
        'export type { WidgetType } from "@/lib/builder/types";',
        'const lazy = () => import("@/components/admin/builder/WidgetView");',
        'import "@/lib/builder/designTokens";',
      ),
    ]);

    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.line)).toEqual([1, 2, 3]);
  });

  it("nie zgłasza importów wewnątrz jednej warstwy", () => {
    const { violations } = scanContentLayering([
      source(
        "src/components/blocks/BlocksRenderer.tsx",
        'import type { Block } from "@/lib/blocks/types";',
        'import { FaqBlockView } from "./FaqBlockView";',
      ),
    ]);

    expect(violations).toEqual([]);
  });

  it("nie zgłasza adaptera wp-import, któremu wolno znać oba silniki", () => {
    const { violations } = scanContentLayering([
      source(
        "src/lib/wp-import/elementor.ts",
        'import type { BuilderDocument } from "@/lib/builder/types";',
        'import type { BlocksDoc } from "@/lib/blocks/types";',
      ),
    ]);

    expect(violations).toEqual([]);
  });
});

describe("renderContentLayeringReport", () => {
  it("zielony log podaje zasięg i obie zerowe krawędzie", () => {
    const rendered = renderContentLayeringReport({
      violations: [],
      stats: { scannedFiles: 2499, allowedBuilderToBlocks: 18 },
    });

    expect(rendered).toContain("✓");
    expect(rendered).toContain("2499 plików");
    expect(rendered).toContain("bloki -> builder: 0");
  });

  it("czerwony log grupuje po krawędzi, podaje linię i prowadzi do naprawy", () => {
    const report = scanContentLayering([
      source("src/lib/blocks/a.ts", 'import { toJson } from "@/lib/builder/types";'),
      source("src/lib/blocks/b.ts", 'import { newId } from "@/lib/builder/types";'),
    ]);
    const rendered = renderContentLayeringReport(report);

    expect(rendered).toContain("✗ 2 krawędzi");
    expect(rendered).toContain("blocks -> builder (2)");
    expect(rendered).toContain("src/lib/blocks/a.ts:1");
    expect(rendered).toContain("src/lib/content-model/README.md");
  });
});
