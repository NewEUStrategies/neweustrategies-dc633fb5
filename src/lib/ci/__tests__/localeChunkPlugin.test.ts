// Wtyczka `nes:locale-chunks` - hint `modulepreload` dla rdzenia słownika.
//
// CZEGO TEN PLIK PILNUJE I DLACZEGO WŁAŚNIE TEGO. Wtyczka podmienia treść
// `src/lib/seo/localeChunks.ts` DOPASOWANIEM TEKSTOWYM, więc jej najsłabszym
// punktem jest SPRZĘŻENIE KSZTAŁTU: gdyby ktoś przeformatował literał w pliku
// docelowym (albo prettier zmienił szerokość linii), podmiana przestałaby
// pasować, a hint zniknąłby BEZ ŻADNEGO OBJAWU - dokładnie ta klasa cichej
// straty, którą naprawia całe to zadanie. Ten test wiąże jedno z drugim.
//
// Testujemy hooki wtyczki bezpośrednio, bez uruchamiania builda: to ten sam kod,
// który wykona Rollup, tylko bez pięciu minut kompilacji.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { localeChunkPlugin } from "../../../../scripts/lib/localeChunkPlugin";

/** Minimalny kształt chunku, od którego zależy decyzja wtyczki. */
function chunk(fileName: string, facadeModuleId: string | null, modules: string[] = []) {
  return {
    type: "chunk" as const,
    fileName,
    facadeModuleId,
    modules: Object.fromEntries(modules.map((m) => [m, { renderedLength: 1 }])),
  };
}

const TARGET = "/repo/src/lib/seo/localeChunks.ts";
const SOURCE = readFileSync("src/lib/seo/localeChunks.ts", "utf8");

type PluginWithHooks = {
  transform: (
    this: { warn: (m: string) => void },
    code: string,
    id: string,
  ) => { code: string } | null;
  generateBundle: (
    options: { dir?: string },
    bundle: Record<string, ReturnType<typeof chunk>>,
  ) => void;
};

function plugin(): PluginWithHooks {
  return localeChunkPlugin() as unknown as PluginWithHooks;
}

const CLIENT_BUNDLE = {
  "assets/pl-DEZyBPCt.js": chunk("assets/pl-DEZyBPCt.js", "/repo/src/lib/locale/pl.ts"),
  "assets/en-CE_0LNFU.js": chunk("assets/en-CE_0LNFU.js", "/repo/src/lib/locale/en.ts"),
  "assets/index-RQbuiFhe.js": chunk("assets/index-RQbuiFhe.js", "/repo/src/client.tsx"),
};

const noopCtx = { warn: () => {} };

describe("nes:locale-chunks - odkrywanie nazw chunków", () => {
  it("odczytuje nazwy z bundla PRZEGLĄDARKI i wstawia je do pliku źródłowego", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const out = p.transform.call(noopCtx, SOURCE, TARGET);
    expect(out).not.toBeNull();
    expect(out!.code).toContain('"pl":"/assets/pl-DEZyBPCt.js"');
    expect(out!.code).toContain('"en":"/assets/en-CE_0LNFU.js"');
    // Fallback musi zniknąć - inaczej podmiana zadziałała tylko pozornie.
    expect(out!.code).not.toContain("pl: null");
  });

  it("IGNORUJE bundel serwera - nazwy klienckie nie mogą przyjść z workera", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/server" }, CLIENT_BUNDLE);
    // Nic nie odkryto, więc plik zostaje ze swoim jawnym fallbackiem.
    expect(p.transform.call(noopCtx, SOURCE, TARGET)).toBeNull();
  });

  it("bierze WYŁĄCZNIE chunk, którego wejściem jest sam rdzeń słownika", () => {
    // Gdyby rdzeń wpadł do wspólnego chunku, hint ciągnąłby niepowiązany kod
    // i przestałby być hintem - lepiej nie wysłać nic.
    const p = plugin();
    p.generateBundle(
      { dir: "/repo/.output/public" },
      {
        "assets/wspolny-XYZ.js": chunk("assets/wspolny-XYZ.js", "/repo/src/lib/inne.ts", [
          "/repo/src/lib/locale/pl.ts",
          "/repo/src/lib/inne.ts",
        ]),
      },
    );
    expect(p.transform.call(noopCtx, SOURCE, TARGET)).toBeNull();
  });

  it("nie rusza żadnego innego modułu", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    expect(p.transform.call(noopCtx, SOURCE, "/repo/src/lib/seo/rootHead.ts")).toBeNull();
  });
});

describe("nes:locale-chunks - sprzężenie kształtu literału", () => {
  it("plik źródłowy niesie DOKŁADNIE ten literał, którego szuka wtyczka", () => {
    // TO JEST NAJWAŻNIEJSZY PRZYPADEK W TYM PLIKU. Reformat pliku docelowego
    // (ręczny albo przez prettiera) zerwałby podmianę, a hint zniknąłby bez
    // żadnego objawu - build byłby zielony, bramki zielone, a jeden szeregowy
    // round-trip wróciłby po cichu.
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const out = p.transform.call(noopCtx, SOURCE, TARGET);
    expect(out, "kształt literału w localeChunks.ts rozjechał się z wtyczką").not.toBeNull();
  });

  it("rozjazd kształtu jest ZGŁASZANY ostrzeżeniem, nie przemilczany", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const warn = vi.fn();
    const out = p.transform.call(
      { warn },
      "export const LOCALE_CHUNK_URLS = { pl: null, en: null };",
      TARGET,
    );
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("modulepreload");
  });
});
