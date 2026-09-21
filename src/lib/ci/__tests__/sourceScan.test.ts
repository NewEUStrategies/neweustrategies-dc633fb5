// Testy pomocnika bramek `bezKomentarzy`. Pomocnik bramki bez testu jest tą
// samą pułapką, co bramka bez testu: może przestać cokolwiek widzieć i nikt
// tego nie zauważy, bo cicho zielona bramka wygląda dokładnie jak spełniony
// inwariant.
import { describe, expect, it } from "vitest";
import { bezKomentarzy } from "@/lib/ci/sourceScan";

describe("bezKomentarzy - maskowanie komentarzy przed skanowaniem źródła", () => {
  it("wymazuje komentarz liniowy, ZACHOWUJĄC długość i numerację linii", () => {
    // Bez zachowania długości numer linii i przesunięcie liczone na wyniku
    // przestają pasować do pliku na dysku, czyli komunikat bramki przestaje
    // wskazywać miejsce, które człowiek otworzy w edytorze.
    const src = "const a = 1; // komentarz\nconst b = 2;\n";
    const out = bezKomentarzy(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("komentarz");
  });

  it("wymazuje komentarz blokowy wielolinijkowy, zostawiając nowe linie", () => {
    const src = "a;\n/* jeden\n   dwa */\nb;\n";
    const out = bezKomentarzy(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).not.toContain("jeden");
    expect(out).not.toContain("dwa");
    expect(out).toContain("a;");
    expect(out).toContain("b;");
  });

  it("NIE rusza napisu, który wygląda jak komentarz", () => {
    // `"// nie komentarz"` jest TREŚCIĄ. Bramka szukająca w źródle napisu
    // musi go nadal znaleźć - inaczej maskowanie kupuje jeden fałszywy alarm
    // za cenę drugiego.
    const src = 'const s = "// nie komentarz";\nconst t = "/* też nie */";\n';
    expect(bezKomentarzy(src)).toBe(src);
  });

  it("NIE rusza napisu szablonowego ani apostrofowego", () => {
    const src = "const a = `// szablon`;\nconst b = '/* apostrof */';\n";
    expect(bezKomentarzy(src)).toBe(src);
  });

  it("przepuszcza cudzysłów prosty STOJĄCY W KOMENTARZU bez gubienia reszty pliku", () => {
    // To jest defekt, dla którego maskowanie w ogóle powstało: komentarze w tym
    // repozytorium cytują treść słownika, a w cytacie trafia się pojedynczy
    // cudzysłów prosty (polska para to „ i ”, ale zamknięcie bywa pisane
    // prosto). Parser liczący napisy bez pomijania komentarzy wchodził na taki
    // znak w stan „jestem w napisie" i gubił domknięcie CAŁEGO bloku.
    const src = 'a; // cytat: „coś"\nconst po = "widoczny";\n';
    const out = bezKomentarzy(src);
    expect(out).toContain('const po = "widoczny";');
    expect(out).not.toContain("cytat");
  });

  it("NIE POŻERA pliku przez wyrażenie regularne zawierające ukośniki", () => {
    // NAJGROŹNIEJSZY TRYB AWARII: wyrażenie `/\\/\\//` wyglądałoby jak początek
    // komentarza i wymazałoby resztę pliku, czyli bramka zrobiłaby się CICHO
    // ZIELONA. Cicha zieleń jest gorsza od fałszywego alarmu, bo nikt jej nie
    // zgłasza.
    const src = 'const r = /\\/\\//;\nconst potem = "musi zostać";\n';
    const out = bezKomentarzy(src);
    expect(out).toContain('const potem = "musi zostać";');
    expect(out.length).toBe(src.length);
  });

  it("odróżnia DZIELENIE od wyrażenia regularnego", () => {
    // `a / b` to nie początek wyrażenia. Gdyby heurystyka uznała ukośnik za
    // wyrażenie, przepisałaby jako „wyrażenie" wszystko do następnego ukośnika
    // i komentarz w środku przestałby być maskowany.
    const src = "const x = a / b; // ogon\nconst y = 1;\n";
    const out = bezKomentarzy(src);
    expect(out).toContain("const x = a / b;");
    expect(out).not.toContain("ogon");
    expect(out).toContain("const y = 1;");
  });

  it("wyrażenie po słowie kluczowym jest wyrażeniem, nie dzieleniem", () => {
    const src = "function f(s) { return /x\\/y/.test(s); } // ogon\n";
    const out = bezKomentarzy(src);
    expect(out).toContain("return /x\\/y/.test(s);");
    expect(out).not.toContain("ogon");
  });

  it("niedomknięty ukośnik nie pożera pliku poza koniec linii", () => {
    // Heurystyka ma prawo się pomylić; nie ma prawa zgubić przy tym reszty
    // pliku. Granicą jest nowa linia.
    const src = "const a = (1 / 2\nconst b = 3; // ogon\n";
    const out = bezKomentarzy(src);
    expect(out).toContain("const b = 3;");
    expect(out).not.toContain("ogon");
  });

  it("zachowuje znak w znak źródło bez komentarzy", () => {
    const src = 'export const A = { b: "c", d: [1, 2] };\n';
    expect(bezKomentarzy(src)).toBe(src);
  });

  it("OGRANICZENIE, świadome: komentarz we wstawce napisu szablonowego zostaje", () => {
    // Zapięte jawnie, żeby granica pomocnika była widoczna, a nie odkrywana
    // przez kogoś, kto uzna maskowanie za pełne parsowanie. W tym repozytorium
    // takiego zapisu nie ma, a pełne parsowanie zagnieżdżeń kosztuje więcej,
    // niż daje.
    const src = "const a = `x${/* w środku */ y}z`;\n";
    expect(bezKomentarzy(src)).toBe(src);
  });
});
