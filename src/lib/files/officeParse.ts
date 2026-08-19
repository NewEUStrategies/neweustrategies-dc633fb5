// Parsowanie dokumentów biurowych PO STRONIE PRZEGLĄDARKI.
//
// DLACZEGO NIE ZEWNĘTRZNY PODGLĄD (Office Online / Google Docs viewer):
// kubełek jest prywatny, a te usługi wymagają publicznie osiągalnego adresu.
// Wysłanie tam podpisanego URL-a oznaczałoby oddanie materiału członkowskiego
// obcemu serwerowi - dlatego plik nigdy nie opuszcza sesji użytkownika.
//
// WSZYSTKIE BIBLIOTEKI SĄ ŁADOWANE LENIWIE. mammoth/xlsx/jszip to razem
// kilkaset kilobajtów; ktoś, kto nigdy nie otworzy .docx, nie ma prawa ich
// pobrać. Import żyje więc wewnątrz funkcji, nie na górze modułu.
import DOMPurify from "dompurify";
import type JSZipType from "jszip";

export interface DocxResult {
  /** Bezpieczny HTML (już po sanityzacji). */
  html: string;
  warnings: readonly string[];
}

export interface SheetResult {
  name: string;
  html: string;
  rows: number;
}

export interface SlideResult {
  index: number;
  title: string | null;
  paragraphs: readonly string[];
  notes: string | null;
  images: readonly string[];
}

/** Wspólna sanityzacja: dokument z zewnątrz nigdy nie trafia do DOM surowy. */
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "form", "object", "embed"],
    FORBID_ATTR: ["style", "onerror", "onload"],
  });
}

export async function parseDocx(buffer: ArrayBuffer): Promise<DocxResult> {
  // `mammoth` mapuje w package.json wejścia node -> browser, więc zwykły
  // import wystarcza; obrazy osadzone w pliku zostają jako data URI, bo bez
  // nich podgląd raportu gubi wykresy i zrzuty.
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    { styleMap: ["p[style-name='Quote'] => blockquote:fresh"] },
  );
  return { html: sanitize(result.value), warnings: result.messages.map((m) => m.message) };
}

export async function parseSpreadsheet(buffer: ArrayBuffer): Promise<SheetResult[]> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(buffer, { type: "array" });
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    if (sheet === undefined) return { name, html: "", rows: 0 };
    const html = XLSX.utils.sheet_to_html(sheet, { editable: false });
    const range = sheet["!ref"];
    const rows = range === undefined ? 0 : XLSX.utils.decode_range(range).e.r + 1;
    return { name, html: sanitize(html), rows };
  });
}

/**
 * Przebiegi tekstu w węźle, po NAZWIE KWALIFIKOWANEJ.
 *
 * Było tu `querySelectorAll(selector)` z gołą nazwą lokalną („t"), co jest
 * niespójne z resztą pliku - `parsePptx` i `slideNotes` sięgają po
 * `getElementsByTagName("a:p")` / `("a:t")`. Selektor typu bez prefiksu
 * dopasowuje po nazwie lokalnej tylko w implementacji zgodnej ze specyfikacją
 * Selectors; przeglądarki to robią, ale nie każdy silnik DOM (np. happy-dom
 * zwraca zero trafień), więc funkcja po cichu spadała na `textContent` całego
 * akapitu. Dla prostych slajdów wynik jest ten sam, ale przy akapicie
 * z tekstem spoza przebiegów `a:t` - już nie.
 */
function textOf(node: Element, tagName: string): string[] {
  return Array.from(node.getElementsByTagName(tagName))
    .map((el) => el.textContent ?? "")
    .filter((value) => value.trim() !== "");
}

/**
 * PPTX bez zewnętrznego renderera: slajd to XML z akapitami `a:p`, a każdy
 * akapit to ciąg przebiegów `a:t`. Odtwarzamy strukturę tekstową i osadzone
 * obrazy - to pokrywa realną potrzebę "co jest na tym slajdzie", bez
 * ciągnięcia silnika układu prezentacji do przeglądarki.
 */
export async function parsePptx(buffer: ArrayBuffer): Promise<SlideResult[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser();

  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides: SlideResult[] = [];
  for (const path of slidePaths) {
    const file = zip.file(path);
    if (file === null) continue;
    const xml = await file.async("string");
    const doc = parser.parseFromString(xml, "application/xml");

    const paragraphs = Array.from(doc.getElementsByTagName("a:p"))
      .map((p) => textOf(p, "a:t").join("") || (p.textContent ?? ""))
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line !== "");

    const images = await slideImages(zip, path, doc);
    const notes = await slideNotes(zip, slideNumber(path), parser);

    slides.push({
      index: slideNumber(path),
      title: paragraphs[0] ?? null,
      paragraphs: paragraphs.slice(1),
      notes,
      images,
    });
  }
  return slides;
}

function slideNumber(path: string): number {
  const match = /(\d+)\.xml$/.exec(path);
  return match === null ? 0 : Number(match[1]);
}

async function slideNotes(
  zip: JSZipType,
  index: number,
  parser: DOMParser,
): Promise<string | null> {
  const file = zip.file(`ppt/notesSlides/notesSlide${index}.xml`);
  if (file === null) return null;
  const doc = parser.parseFromString(await file.async("string"), "application/xml");
  const text = Array.from(doc.getElementsByTagName("a:t"))
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : text;
}

async function slideImages(zip: JSZipType, slidePath: string, doc: Document): Promise<string[]> {
  const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, "slides/_rels/$1.xml.rels");
  const relsFile = zip.file(relsPath);
  if (relsFile === null) return [];
  const rels = new DOMParser().parseFromString(await relsFile.async("string"), "application/xml");
  const map = new Map<string, string>();
  for (const rel of Array.from(rels.getElementsByTagName("Relationship"))) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id !== null && target !== null) map.set(id, target.replace(/^\.\.\//, "ppt/"));
  }

  const out: string[] = [];
  for (const blip of Array.from(doc.getElementsByTagName("a:blip"))) {
    const id = blip.getAttribute("r:embed");
    const target = id === null ? undefined : map.get(id);
    if (target === undefined) continue;
    const media = zip.file(target);
    if (media === null) continue;
    out.push(URL.createObjectURL(await media.async("blob")));
  }
  return out;
}
