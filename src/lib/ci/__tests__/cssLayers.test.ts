import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findUnlayeredZeroSpecificityRules,
  hasZeroSpecificity,
  splitSelectorList,
} from "@/lib/ci/cssLayers";

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("hasZeroSpecificity", () => {
  it("rozpoznaje selektory w całości owinięte w :where()", () => {
    expect(hasZeroSpecificity(":where(select)")).toBe(true);
    expect(hasZeroSpecificity(":where(input, textarea, select)")).toBe(true);
    expect(hasZeroSpecificity(":where(.cf-shell, .nl-shell) :where(input[type='file'])")).toBe(
      true,
    );
    expect(hasZeroSpecificity(':where(input:not([type="checkbox"]):not([type="radio"]))')).toBe(
      true,
    );
  });

  it("nie uznaje za zerowe selektorów z realną wagą poza :where()", () => {
    expect(hasZeroSpecificity(".join-us-shell :where(input, select)")).toBe(false);
    expect(hasZeroSpecificity(":where([data-w-id]) .widget-align-row")).toBe(false);
    expect(hasZeroSpecificity(":where(input, textarea)::placeholder")).toBe(false);
    expect(hasZeroSpecificity(":where(input):-webkit-autofill:focus")).toBe(false);
    expect(hasZeroSpecificity(":where(input, textarea, select):focus")).toBe(false);
  });
});

describe("splitSelectorList", () => {
  it("dzieli tylko po przecinkach najwyższego poziomu", () => {
    expect(splitSelectorList(":where(input, textarea), .custom")).toEqual([
      ":where(input, textarea)",
      ".custom",
    ]);
    expect(splitSelectorList(':where(input:not([type="a"]):not([type="b"]))')).toEqual([
      ':where(input:not([type="a"]):not([type="b"]))',
    ]);
  });
});

describe("kaskada src/styles.css", () => {
  // Regresja: mieszana lista `:where(input), .custom-input` jako CAŁOŚĆ nie ma
  // zerowej specyficzności, ale jej pierwszy człon owszem - i to on odtwarza
  // problem z kaskadą. Każdy człon musi być sprawdzany osobno.
  it("wykrywa zerowy człon w mieszanej liście selektorów", () => {
    const offenders = findUnlayeredZeroSpecificityRules(
      ":where(input), .custom-input { padding-inline: 1rem; }",
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].selector).toBe(":where(input)");
  });

  it("nie zgłasza listy złożonej wyłącznie z selektorów z wagą", () => {
    expect(
      findUnlayeredZeroSpecificityRules(".a input, .b select { padding-inline: 1rem; }"),
    ).toEqual([]);
  });

  it("nie zgłasza reguł o zerowej specyficzności zamkniętych w @layer", () => {
    expect(
      findUnlayeredZeroSpecificityRules("@layer components { :where(input) { height: 2rem; } }"),
    ).toEqual([]);
  });

  // Reguła o zerowej specyficzności zapisana poza `@layer` kłamie: deklaruje
  // „jestem najsłabszy", a bije KAŻDĄ regułę z `@layer utilities`, bo warstwy
  // mają pierwszeństwo przed specyficznością. Tak umarło `pl-9` na polu kraju
  // w widgecie „Dołącz do nas" (flaga nachodziła na nazwę kraju).
  it("nie zawiera bezwarstwowych reguł o zerowej specyficzności", () => {
    const offenders = findUnlayeredZeroSpecificityRules(CSS);
    const report = offenders.map((o) => `  styles.css:${o.line}  ${o.selector}`).join("\n");
    expect(
      offenders,
      offenders.length
        ? `Reguły :where() poza @layer biją każde utility Tailwinda.\n` +
            `Przenieś je do @layer components (NIE do base - preflight ` +
            `„input { font: inherit }" ma tam wyższą specyficzność):\n${report}`
        : "",
    ).toEqual([]);
  });

  /** Czy deklaracja pod danym offsetem leży wewnątrz otwartego `@layer components`. */
  function insideComponentsLayer(offset: number): boolean {
    const layerOpen = CSS.lastIndexOf("@layer components {", offset);
    if (layerOpen === -1) return false;
    let depth = 0;
    for (const ch of CSS.slice(layerOpen, offset)) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    return depth > 0;
  }

  const at = (needle: string): number => {
    const i = CSS.indexOf(needle);
    expect(i, `nie znaleziono w styles.css: ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it.each([
    ["baseline geometrii pól", "padding-inline: var(--form-input-padding-x)"],
    ["shell-owy baseline tekstu pól", "font-size: var(--gc-input-font-size, 14px)"],
    ["atom .input-group", ".input-group {"],
    ["atom .input (standalone)", "\n  .input {"],
  ])("%s siedzi w @layer components", (_label, needle) => {
    expect(insideComponentsLayer(at(needle))).toBe(true);
  });

  // Obie reguły mają specyficzność (0,1,0), więc o wyniku decyduje kolejność
  // w pliku - ale TYLKO gdy są w tej samej warstwie. Gdyby ktoś przeniósł do
  // warstwy sam atom `.input`, zostawiając shell-owy baseline bez warstwy,
  // baseline (bezwarstwowy) zacząłby wygrywać i font pól w widgetach skoczyłby
  // z 0.875rem na 14px. Zmierzone: 12 kontrolek. Stąd ten test kolejności.
  it("atom .input jest w pliku PONIŻEJ shell-owego baseline'u tekstu", () => {
    expect(at("\n  .input {")).toBeGreaterThan(at("font-size: var(--gc-input-font-size, 14px)"));
  });
});
