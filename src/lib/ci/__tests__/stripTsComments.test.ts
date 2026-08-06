// `stripTsComments` jest zależnością BLOKUJĄCEJ bramki `check:sql-app-role`
// (i testu granicy leniwego checkoutu), a jego błąd jest cichy: zgubiony stan
// cudzysłowu wycina pół pliku i bramka przestaje cokolwiek widzieć. Stąd
// osobne, punktowe próby na każdej klasie konstrukcji.
import { describe, expect, it } from "vitest";
import { stripTsComments } from "../../../../scripts/lib/stripTsComments";

describe("stripTsComments", () => {
  it("usuwa komentarz liniowy, zachowując numerację linii", () => {
    // app-role-literal-exempt: PRÓBKA WEJŚCIOWA strippera - literał żyje w
    // stringu testu i nigdy nie dociera do bazy. To dokładnie ten kształt,
    // który bramka `check:sql-app-role` ma po tej zmianie odsiewać.
    const out = stripTsComments("const a = 1; // has_role(uid, 'tenant_admin')\nconst b = 2;\n");
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("tenant_admin");
    expect(out.split("\n")).toHaveLength(3);
  });

  it("usuwa komentarz blokowy wielolinijkowy, nie zmieniając liczby linii", () => {
    const src = "a;\n/**\n * has_role(uid, 'X')\n */\nb;\n"; // app-role-literal-exempt
    const out = stripTsComments(src);
    expect(out).not.toContain("has_role");
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).toContain("a;");
    expect(out).toContain("b;");
  });

  it("nie tyka `//` wewnątrz stringów (URL-e)", () => {
    const out = stripTsComments('const u = "https://js.stripe.com/v3";\nconst v = 1;\n');
    expect(out).toContain('"https://js.stripe.com/v3"');
    expect(out).toContain("const v = 1;");
  });

  it("nie gubi stanu na literale regexpa z cudzysłowami", () => {
    // Bez obsługi regexpów apostrof w klasie znaków otwierałby string i zjadał
    // resztę pliku - łącznie z prawdziwym wywołaniem poniżej.
    const src = "const re = /['\"]/g;\nconst call = \"has_role(auth.uid(), 'admin')\";\n";
    const out = stripTsComments(src);
    expect(out).toContain("has_role(auth.uid(), 'admin')");
  });

  it("zachowuje szablony wielolinijkowe", () => {
    const src = "const t = `linia 1\nlinia 2`;\nconst z = 3;\n";
    expect(stripTsComments(src)).toBe(src);
  });

  it("nie myli dzielenia z początkiem regexpa", () => {
    const src = "const x = a / b; // koniec\nconst y = c / d;\n";
    const out = stripTsComments(src);
    expect(out).toContain("const x = a / b;");
    expect(out).toContain("const y = c / d;");
    expect(out).not.toContain("koniec");
  });

  it("znosi niedomknięty komentarz blokowy bez zapętlenia", () => {
    expect(stripTsComments("a;\n/* dalej już nic").trimEnd()).toBe("a;");
  });
});
