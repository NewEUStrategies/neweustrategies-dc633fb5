/**
 * Klasyfikacja modułów vendorowych wg osiągalności przy boocie
 * (scripts/lib/bootVendorSplit.ts) - podstawa podziału `vendor-radix(-boot)`
 * i `vendor-lucide(-boot)` w manualChunks. Graf poniżej jest miniaturą
 * prawdziwego: entry TanStacka -> router -> __root -> button -> react-slot;
 * trasa leniwa (tylko `import()`) ciągnie react-dialog i inną ikonę; barrel
 * lucide re-eksportuje KAŻDĄ ikonę (pułapka opisana w nagłówku helpera).
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */
import { describe, expect, it } from "vitest";
import {
  bootModuleIds,
  isBootLucideModule,
  isBootModule,
  lucideBootIds,
  parseLucideImports,
  type BootGraphMeta,
  type BootGraphModule,
} from "../../../../scripts/lib/bootVendorSplit";

const NM = "/repo/node_modules";
const ENTRY = `${NM}/@tanstack/react-start/dist/plugin/default-entry/client.tsx`;
const ROUTER = "/repo/src/router.tsx";
const ROOT = "/repo/src/routes/__root.tsx";
const BUTTON = "/repo/src/components/ui/button.tsx";
const SHIM = "/repo/src/lib/lucide-shim.tsx";
const LAZY = "/repo/src/routes/lazy.tsx";
const CSS = "/repo/src/index.css";
const VIRTUAL = "\0vite/preload-helper.js";
const REACT = `${NM}/react/index.js`;
const SLOT = `${NM}/@radix-ui/react-slot/dist/index.mjs`;
const COMPOSE_REFS = `${NM}/@radix-ui/react-compose-refs/dist/index.mjs`;
const DIALOG = `${NM}/@radix-ui/react-dialog/dist/index.mjs`;
const PRIMITIVE = `${NM}/@radix-ui/react-primitive/dist/index.mjs`;
const LUCIDE = `${NM}/lucide-react/dist/esm`;
const BARREL = `${LUCIDE}/lucide-react.js`;
const ICONS_INDEX = `${LUCIDE}/icons/index.js`;
const CHECK = `${LUCIDE}/icons/check.js`;
const CHEVRON = `${LUCIDE}/icons/chevron-down.js`;
const TRASH = `${LUCIDE}/icons/trash-2.js`;
const CREATE_ICON = `${LUCIDE}/createLucideIcon.js`;
const ICON = `${LUCIDE}/Icon.js`;
const DEFAULTS = `${LUCIDE}/defaultAttributes.js`;
const ALL_ICONS = [CHECK, CHEVRON, TRASH];

type Node = Partial<BootGraphModule>;

function graph(overrides: Record<string, Node> = {}): Record<string, Node> {
  const base: Record<string, Node> = {
    [ENTRY]: { isEntry: true, importedIds: [ROUTER, REACT] },
    [ROUTER]: { importedIds: [ROOT, ENTRY] }, // cykl entry <-> router (realny)
    [ROOT]: { importedIds: [BUTTON, SHIM, CSS, VIRTUAL] },
    [BUTTON]: { importedIds: [SLOT, REACT] },
    [SHIM]: {
      importedIds: [BARREL, REACT],
      code: 'import { Check as LCheck, ChevronDown } from "lucide-react";\nexport const X = 1;',
    },
    [LAZY]: {
      importedIds: [DIALOG, BARREL],
      code: 'import { Trash2 } from "lucide-react";',
    },
    [REACT]: { importedIds: [] },
    [SLOT]: { importedIds: [COMPOSE_REFS, REACT] },
    [COMPOSE_REFS]: { importedIds: [REACT] },
    [DIALOG]: { importedIds: [SLOT, PRIMITIVE, COMPOSE_REFS, REACT] },
    [PRIMITIVE]: { importedIds: [SLOT, REACT] },
    [BARREL]: {
      importedIds: [ICONS_INDEX, ...ALL_ICONS],
      exportedBindings: {
        ".": ["icons"],
        "./icons/check.js": ["Check", "CheckIcon", "LucideCheck"],
        "./icons/chevron-down.js": ["ChevronDown", "ChevronDownIcon", "LucideChevronDown"],
        "./icons/trash-2.js": ["Trash2", "Trash2Icon", "LucideTrash2"],
      },
    },
    [ICONS_INDEX]: { importedIds: ALL_ICONS },
    [CHECK]: { importedIds: [CREATE_ICON] },
    [CHEVRON]: { importedIds: [CREATE_ICON] },
    [TRASH]: { importedIds: [CREATE_ICON] },
    [CREATE_ICON]: { importedIds: [ICON, REACT] },
    [ICON]: { importedIds: [DEFAULTS, REACT] },
    [DEFAULTS]: { importedIds: [] },
  };
  return { ...base, ...overrides };
}

/** Atrapa `Rollup.ManualChunkMeta`; CSS i id wirtualne zwracają null jak w Rollupie. */
function meta(nodes: Record<string, Node>): BootGraphMeta & { lookups: () => number } {
  let lookups = 0;
  return {
    getModuleIds: () => Object.keys(nodes),
    getModuleInfo: (id) => {
      lookups++;
      const node = nodes[id];
      if (!node || id === CSS || id.startsWith("\0")) return null;
      return {
        isEntry: node.isEntry ?? false,
        importedIds: node.importedIds ?? [],
        code: node.code ?? null,
        exportedBindings: node.exportedBindings ?? { ".": [] },
      };
    },
    lookups: () => lookups,
  };
}

describe("bootModuleIds: domknięcie statyczne z modułów wejściowych", () => {
  it("zawiera entry, powłokę i react-slot z zależnościami, pomija trasę leniwą i dialog", () => {
    const m = meta(graph());
    const boot = bootModuleIds(m);
    for (const id of [ENTRY, ROUTER, ROOT, BUTTON, SHIM, SLOT, COMPOSE_REFS, REACT, CSS, VIRTUAL])
      expect(boot.has(id), id).toBe(true);
    for (const id of [LAZY, DIALOG, PRIMITIVE]) expect(boot.has(id), id).toBe(false);
    expect(isBootModule(SLOT, m)).toBe(true);
    expect(isBootModule(DIALOG, m)).toBe(false);
  });

  it("jest zamknięte na zależności (żaden chunk -boot nie importuje z reszty)", () => {
    const nodes = graph();
    const m = meta(nodes);
    for (const id of bootModuleIds(m)) {
      for (const dep of nodes[id]?.importedIds ?? [])
        expect(isBootModule(dep, m), `${id} -> ${dep}`).toBe(true);
    }
  });

  it("bez modułu wejściowego nic nie jest bootowe (zachowanie jak przed podziałem)", () => {
    const nodes = graph({ [ENTRY]: { isEntry: false, importedIds: [ROUTER] } });
    expect(bootModuleIds(meta(nodes)).size).toBe(0);
  });

  it("liczy domknięcie RAZ na obiekt meta (Rollup woła manualChunks per moduł)", () => {
    const m = meta(graph());
    isBootModule(SLOT, m);
    const after = m.lookups();
    isBootModule(DIALOG, m);
    isBootModule(COMPOSE_REFS, m);
    expect(m.lookups()).toBe(after);
    // Inny obiekt meta = inny build = świeże domknięcie.
    expect(bootModuleIds(meta(graph()))).not.toBe(bootModuleIds(m));
  });
});

describe("lucideBootIds: osiągalność po NAZWACH, nie po krawędziach barrela", () => {
  it("bootowe są tylko ikony importowane przez bootowe moduły aplikacji + runtime", () => {
    const m = meta(graph());
    const boot = lucideBootIds(m);
    for (const id of [CHECK, CHEVRON, CREATE_ICON, ICON, DEFAULTS])
      expect(boot.has(id), id).toBe(true);
    // Ikona trasy leniwej - mimo że barrel (statycznie osiągalny) ją re-eksportuje.
    expect(isBootLucideModule(TRASH, m)).toBe(false);
    expect(isBootModule(TRASH, m), "czysta osiągalność oznaczyłaby ją jako boot").toBe(true);
    // Barrel bez własnego kodu nie jest potrzebny przy boocie.
    expect(boot.has(BARREL)).toBe(false);
    // Spoza pakietu nic nie wchodzi (react zostaje w vendor-react).
    expect(boot.has(REACT)).toBe(false);
  });

  it("jest zamknięte na zależności wewnątrz pakietu", () => {
    const nodes = graph();
    const m = meta(nodes);
    for (const id of lucideBootIds(m)) {
      for (const dep of nodes[id]?.importedIds ?? []) {
        if (!dep.includes("/lucide-react/")) continue;
        expect(isBootLucideModule(dep, m), `${id} -> ${dep}`).toBe(true);
      }
    }
  });

  it.each([
    ["import przestrzeni nazw", 'import * as L from "lucide-react";'],
    ["eksport własny `icons` (obiekt wszystkich ikon)", 'import { icons } from "lucide-react";'],
    ["re-eksport gwiazdką", 'export * from "lucide-react";'],
    ["brak kodu (null)", null],
  ])("fallback przy niejednoznacznej detekcji: %s -> cały pakiet jak dotąd", (_label, code) => {
    const m = meta(graph({ [SHIM]: { importedIds: [BARREL], code } }));
    const boot = lucideBootIds(m);
    for (const id of [...ALL_ICONS, BARREL, CREATE_ICON]) expect(boot.has(id), id).toBe(true);
  });

  it("ignoruje nazwy nieznane barrelowi (typy wymazane przez esbuild nie ściągają ikon)", () => {
    const m = meta(
      graph({
        [SHIM]: {
          importedIds: [BARREL],
          code: 'import { LucideIcon, Check } from "lucide-react";',
        },
      }),
    );
    const boot = lucideBootIds(m);
    expect(boot.has(CHECK)).toBe(true);
    expect(boot.has(TRASH)).toBe(false);
    expect(boot.has(BARREL)).toBe(false);
  });

  it("głęboki import pliku ikony seeduje ją bezpośrednio", () => {
    const m = meta(
      graph({
        [SHIM]: {
          importedIds: [TRASH],
          code: 'import Trash from "lucide-react/dist/esm/icons/trash-2.js";',
        },
      }),
    );
    expect(lucideBootIds(m).has(TRASH)).toBe(true);
    expect(lucideBootIds(m).has(CHECK)).toBe(false);
  });

  it("gdy entry nie dotyka lucide, nic nie jest bootowe", () => {
    const m = meta(graph({ [SHIM]: { importedIds: [REACT], code: "export const X = 1;" } }));
    expect(lucideBootIds(m).size).toBe(0);
  });
});

describe("parseLucideImports: składnia po transformacji Vite", () => {
  it("zbiera nazwy z aliasami, wieloma liniami i komentarzami, pomija typy", () => {
    const code = `
      import { ArrowLeft as LArrowLeft,
        // komentarz w klauzuli
        type LucideProps, Check /* inline */ } from "lucide-react";
      import { useState } from "react";
      export { Globe } from 'lucide-react';
    `;
    expect(parseLucideImports(code)).toEqual([
      { specifier: "lucide-react", names: ["ArrowLeft", "LucideProps", "Check"] },
      { specifier: "lucide-react", names: ["Globe"] },
    ]);
  });

  it("formy całomodułowe dają names=null", () => {
    const code = [
      'import * as L from "lucide-react";',
      'import D from "lucide-react/dynamic";',
      'import D2, { X } from "lucide-react";',
      'export * from "lucide-react";',
      'export * as all from "lucide-react";',
      'import "lucide-react";',
    ].join("\n");
    const parsed = parseLucideImports(code);
    expect(parsed).toHaveLength(6);
    expect(parsed.every((entry) => entry.names === null)).toBe(true);
  });

  it("import() i inne pakiety nie są krawędziami lucide", () => {
    const code =
      'const m = import("lucide-react");\nimport { Slot } from "@radix-ui/react-slot";\nimport { x } from "lucide-reactish";';
    expect(parseLucideImports(code)).toEqual([]);
  });
});
