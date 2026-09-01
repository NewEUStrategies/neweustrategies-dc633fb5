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
import { transformSync } from "esbuild";
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
  enforce?: "pre" | "post";
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
    // WSAD ZMIENIONY 2026-09-01: stał tu literał jednolinijkowy, który po
    // zdjęciu sprzężenia z formatowaniem PRZECHODZI (i słusznie - patrz ostatni
    // przypadek w tym pliku). Rozjazdem, który musi krzyczeć, jest zmiana
    // KSZTAŁTU DANYCH, nie szerokości linii: brakujące pole, inna nazwa pola,
    // wartość inna niż `null`.
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const warn = vi.fn();
    const out = p.transform.call(
      { warn },
      'export const LOCALE_CHUNK_URLS = { pl: "", en: null };',
      TARGET,
    );
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("modulepreload");
  });
});

// ── TO, CO DOSTAJE BUILD, A CO DOSTAWAŁ TEN TEST ──────────────────────────────
//
// TU BYŁA DZIURA I KOSZTOWAŁA CAŁY HINT. Przypadki wyżej karmią hook TREŚCIĄ
// PLIKU ŹRÓDŁOWEGO. Build karmił go czymś innym: wtyczka nie deklarowała
// `enforce`, więc trafiała do koszyka „normal", czyli ZA rdzeniowy
// `vite:esbuild`, i widziała kod PO transpilacji TS - a esbuild usuwa PRZECINEK
// KOŃCOWY, którego szukał literał. Skutek na buildzie 2026-09-01: ostrzeżenie
// wtyczki, artefakt z `null`, hint MARTWY. Test był zielony przez cały ten czas,
// bo mierzył WEJŚCIE, KTÓREGO NIE MA W PRODUKCJI.
//
// Dlatego niżej transpilujemy plik PRAWDZIWYM esbuildem (tym samym, którego
// używa Vite), zamiast wpisywać oczekiwany kształt z ręki: gdyby esbuild
// kiedykolwiek zmienił formatowanie, ten przypadek zapali się sam.
describe("nes:locale-chunks - wejście, które NAPRAWDĘ dostaje build", () => {
  /** Dokładnie to, co widziałaby wtyczka bez `enforce: "pre"`. */
  const TRANSPILED = transformSync(SOURCE, { loader: "ts", target: "esnext" }).code;

  it("esbuild ZDEJMUJE przecinek końcowy - dowód przyczyny, nie domysł", () => {
    expect(SOURCE).toContain("en: null,");
    expect(TRANSPILED).toContain("en: null\n}");
    expect(TRANSPILED).not.toContain("en: null,");
  });

  it("podmiana działa TAKŻE na kodzie po transpilacji", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const out = p.transform.call(noopCtx, TRANSPILED, TARGET);
    expect(out, "wzorzec znowu sprzęgł się z formatowaniem").not.toBeNull();
    expect(out!.code).toContain('"pl":"/assets/pl-DEZyBPCt.js"');
    expect(out!.code).not.toContain("pl: null");
  });

  it('wtyczka deklaruje `enforce: "pre"`, więc widzi ŹRÓDŁO, nie wynik esbuilda', () => {
    // Bez tego pola wejście testu i wejście builda znowu byłyby dwiema różnymi
    // rzeczami - a to jest dokładnie ta różnica, która unieważniła hint.
    expect(plugin().enforce).toBe("pre");
  });

  it("nazwa pliku z `$` nie jest interpretowana jako grupa wsteczna", () => {
    // `String.prototype.replace` z łańcuchem traktuje `$&` i `$1` jako sterujące,
    // a nazwa chunku pochodzi z Rollupa. Wstawiamy więc wartość funkcją.
    const p = plugin();
    p.generateBundle(
      { dir: "/repo/.output/public" },
      {
        "assets/pl-$&x_1234.js": chunk("assets/pl-$&x_1234.js", "/repo/src/lib/locale/pl.ts"),
        "assets/en-CE_0LNFU.js": chunk("assets/en-CE_0LNFU.js", "/repo/src/lib/locale/en.ts"),
      },
    );
    const out = p.transform.call(noopCtx, SOURCE, TARGET);
    expect(out).not.toBeNull();
    expect(out!.code).toContain('"pl":"/assets/pl-$&x_1234.js"');
  });

  it("przemianowanie pola NADAL jest ostrzeżeniem - wzorzec został wąski", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const warn = vi.fn();
    const out = p.transform.call(
      { warn },
      "export const LOCALE_CHUNK_URLS = {\n  polski: null,\n  en: null,\n};\n",
      TARGET,
    );
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reformat na jedną linię PRZECHODZI - sprzężenie z formatowaniem zdjęte", () => {
    // Ten sam wsad, który w poprzedniej wersji wtyczki był ostrzeżeniem. Zmiana
    // jest zamierzona: szerokość linii nie ma prawa decydować o istnieniu hintu.
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const out = p.transform.call(
      noopCtx,
      "export const LOCALE_CHUNK_URLS = { pl: null, en: null };",
      TARGET,
    );
    expect(out).not.toBeNull();
    expect(out!.code).toContain('"en":"/assets/en-CE_0LNFU.js"');
  });
});
