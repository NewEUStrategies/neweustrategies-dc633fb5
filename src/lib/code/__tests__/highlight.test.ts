// Highlighter bloku kodu: gramatyki per język + twardy inwariant lossless
// (konkatenacja tokenów == wejście), bo tokeny renderują się w <pre> 1:1.
import { describe, expect, it } from "vitest";
import { highlightCode, isHighlightableLang, type HighlightToken } from "../highlight";

function joined(tokens: HighlightToken[]): string {
  return tokens.map((t) => t.text).join("");
}

function kindsOf(tokens: HighlightToken[], text: string): Array<string | null> {
  return tokens.filter((t) => t.text === text).map((t) => t.kind);
}

describe("highlightCode - lossless", () => {
  const samples: Array<[string, string]> = [
    ["ts", "const x = 42; // licznik\nfunction hej() { return `a${x}b`; }"],
    ["python", 'def f(x):\n    """doc"""\n    return x + 1  # suma'],
    ["sql", "SELECT id, name FROM users WHERE id = 1 -- filtr\n/* blok */"],
    ["bash", 'echo "$HOME" # katalog\nexport FOO=${BAR}'],
    ["json", '{"key": "value", "n": -1.5e3, "ok": true}'],
    ["css", "/* c */ .a { color: #fff; margin: 4px; }"],
    ["yaml", "name: test # komentarz\ncount: 3\nflag: true"],
    ["html", "<!-- c --><a href=\"/x\" data-id='1'>tekst</a>"],
    ["brak-takiego", "cokolwiek <div> 'x' 42"],
    ["ts", ""],
  ];
  it.each(samples)("odtwarza wejście 1:1 (%s)", (lang, code) => {
    expect(joined(highlightCode(code, lang))).toBe(code);
  });
});

describe("highlightCode - gramatyki", () => {
  it("ts: keywordy, stringi, komentarze, liczby, typy", () => {
    const tokens = highlightCode(
      'const n = 10; // note\nconst s = "ala";\ninterface Foo {}\n',
      "ts",
    );
    expect(kindsOf(tokens, "const")).toEqual(["keyword", "keyword"]);
    expect(kindsOf(tokens, "// note")).toEqual(["comment"]);
    expect(kindsOf(tokens, '"ala"')).toEqual(["string"]);
    expect(kindsOf(tokens, "10")).toEqual(["number"]);
    expect(kindsOf(tokens, "Foo")).toEqual(["type"]);
  });

  it("ts: template literal ze znakami nowej linii jest jednym stringiem", () => {
    const code = "const t = `linia1\nlinia2`;";
    const tokens = highlightCode(code, "tsx");
    expect(kindsOf(tokens, "`linia1\nlinia2`")).toEqual(["string"]);
  });

  it("sql: keywordy niezależnie od wielkości liter", () => {
    const tokens = highlightCode("select * from t where a = 'x'", "sql");
    expect(kindsOf(tokens, "select")).toEqual(["keyword"]);
    expect(kindsOf(tokens, "where")).toEqual(["keyword"]);
    expect(kindsOf(tokens, "'x'")).toEqual(["string"]);
  });

  it("json: klucz obiektu to property, wartość to string", () => {
    const tokens = highlightCode('{"key": "value"}', "json");
    expect(kindsOf(tokens, '"key"')).toEqual(["property"]);
    expect(kindsOf(tokens, '"value"')).toEqual(["string"]);
  });

  it("bash: zmienne $VAR i ${VAR} oraz komentarz", () => {
    const tokens = highlightCode('echo "$HOME" ${FOO} # done', "sh");
    expect(kindsOf(tokens, "${FOO}")).toEqual(["variable"]);
    expect(kindsOf(tokens, "# done")).toEqual(["comment"]);
  });

  it("html: nazwa tagu = keyword, atrybut = property, wartość = string", () => {
    const tokens = highlightCode('<a href="/x">t</a>', "html");
    expect(kindsOf(tokens, "a")).toEqual(["keyword", "keyword"]);
    expect(kindsOf(tokens, "href")).toEqual(["property"]);
    expect(kindsOf(tokens, '"/x"')).toEqual(["string"]);
  });

  it("nieznany język: jeden token bez wyróżnienia", () => {
    const tokens = highlightCode("just text", "cobol");
    expect(tokens).toEqual([{ text: "just text", kind: null }]);
  });

  it("komentarz ma pierwszeństwo przed stringiem i keywordem", () => {
    const tokens = highlightCode('// const "x"', "js");
    expect(tokens).toEqual([{ text: '// const "x"', kind: "comment" }]);
  });
});

describe("isHighlightableLang", () => {
  it("rozpoznaje aliasy i odrzuca nieznane", () => {
    expect(isHighlightableLang("TS")).toBe(true);
    expect(isHighlightableLang("shell")).toBe(true);
    expect(isHighlightableLang("html")).toBe(true);
    expect(isHighlightableLang("cobol")).toBe(false);
    expect(isHighlightableLang("")).toBe(false);
  });
});
