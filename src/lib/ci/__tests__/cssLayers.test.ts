import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findUnlayeredZeroSpecificityRules, hasZeroSpecificity } from "@/lib/ci/cssLayers";

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

describe("kaskada src/styles.css", () => {
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

  it("baseline pól formularza faktycznie siedzi w @layer components", () => {
    const baseline = CSS.indexOf("padding-inline: var(--form-input-padding-x)");
    expect(baseline).toBeGreaterThan(-1);
    const layerOpen = CSS.lastIndexOf("@layer components {", baseline);
    expect(layerOpen).toBeGreaterThan(-1);
    // Warstwa nie może się domknąć przed baseline'em.
    const between = CSS.slice(layerOpen, baseline);
    let depth = 0;
    for (const ch of between) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    expect(depth).toBeGreaterThan(0);
  });
});
