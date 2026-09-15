import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Wysokość WSZYSTKICH pól formularzy na platformie pochodzi z jednego tokenu.
// Wzorcem jest droplist wyboru tematów (35px), więc floating-label inputy
// (`--input-group-height`) i zwykłe kontrolki (`--form-input-height`) muszą
// czerpać z `--form-field-height`, a nie mieć własnych wartości.
const css = readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");

describe("tokeny wysokości pól formularzy", () => {
  it("definiuje jeden wzorzec wysokości równy droplistcie tematów", () => {
    expect(css).toContain("--form-field-height: 35px;");
  });

  it("spina wysokość zwykłych kontrolek i floating-label inputów z tym wzorcem", () => {
    expect(css).toContain("--form-input-height: var(--form-field-height);");
    expect(css).toContain("--input-group-height: var(--form-field-height);");
  });
});
