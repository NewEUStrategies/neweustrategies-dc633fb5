// `htmlToPlainText` - tekst z HTML dla bio ekspertów i opisów w blokach.
//
// Przegląd 2026-10: encja liczbowa spoza Unicode (`&#9999999;`, `&#x110000;`)
// szła prosto do `String.fromCodePoint`, który rzuca RangeError - jedno takie
// bio wywracało render całej strony eksperta albo wpisu z blokiem.
import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "@/lib/sanitizePure";

describe("htmlToPlainText - encje liczbowe spoza zakresu nie wywracają renderu", () => {
  it("kod spoza Unicode, NUL i surogat dają U+FFFD zamiast RangeError", () => {
    expect(() => htmlToPlainText("<p>Bio &#9999999; dalej</p>")).not.toThrow();
    expect(htmlToPlainText("<p>a &#9999999; b</p>")).toBe("a � b");
    expect(htmlToPlainText("&#x110000;&#0;&#xD800;")).toBe("���");
  });

  it("poprawne encje i struktura tekstu bez zmian", () => {
    expect(htmlToPlainText("<p>&#8222;cytat&#8221; &amp; &#x2014; ok</p>")).toBe("„cytat” & — ok");
    expect(htmlToPlainText("<ul><li>jeden</li><li>dwa</li></ul>")).toBe("• jeden\n• dwa");
    expect(htmlToPlainText("linia<br>druga")).toBe("linia\ndruga");
  });
});
