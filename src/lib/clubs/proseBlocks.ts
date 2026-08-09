// Parser treści klubowej na bloki semantyczne: akapit, lista numerowana,
// lista punktowana.
//
// PO CO. Do tej pory wyliczenie "1. ..." było zwykłym tekstem w `<p>` - bez
// wcięcia, bez wyrównania numerów, bez oddechu. Wyliczenia to w deliberacji
// najczęstsza forma (argumenty, kroki, źródła), więc muszą mieć własny element
// i własną typografię: numer w kółku, treść na jednej osi.
//
// TREŚĆ POZOSTAJE TEKSTEM - parsujemy tylko znaczniki list, żadnego HTML-a.

export type ProseBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "ordered"; items: string[]; start: number }
  | { kind: "bullet"; items: string[] };

const BULLET_RE = /^\s*[-*•]\s+(.+)$/;
const ORDERED_RE = /^\s*(\d{1,3})[.)]\s+(.+)$/;

function flushParagraph(lines: string[], out: ProseBlock[]): void {
  const text = lines.join("\n").trim();
  if (text !== "") out.push({ kind: "paragraph", text });
  lines.length = 0;
}

/**
 * Rozbija surowy tekst na bloki. Pusta linia zamyka blok; linie z punktorem
 * tworzą listę nawet bez pustej linii przed nimi (tak ludzie piszą).
 */
export function parseProseBlocks(body: string): ProseBlock[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: ProseBlock[] = [];
  const buffer: string[] = [];
  let list: { kind: "ordered" | "bullet"; items: string[]; start: number } | null = null;

  const flushList = (): void => {
    if (list === null) return;
    out.push(
      list.kind === "ordered"
        ? { kind: "ordered", items: list.items, start: list.start }
        : { kind: "bullet", items: list.items },
    );
    list = null;
  };

  for (const line of lines) {
    const ordered = ORDERED_RE.exec(line);
    const bullet = ordered === null ? BULLET_RE.exec(line) : null;

    if (ordered !== null) {
      flushParagraph(buffer, out);
      if (list === null || list.kind !== "ordered") {
        flushList();
        list = { kind: "ordered", items: [], start: Number(ordered[1]) };
      }
      list.items.push(ordered[2].trim());
      continue;
    }

    if (bullet !== null) {
      flushParagraph(buffer, out);
      if (list === null || list.kind !== "bullet") {
        flushList();
        list = { kind: "bullet", items: [], start: 1 };
      }
      list.items.push(bullet[1].trim());
      continue;
    }

    if (line.trim() === "") {
      flushList();
      flushParagraph(buffer, out);
      continue;
    }

    flushList();
    buffer.push(line);
  }

  flushList();
  flushParagraph(buffer, out);
  return out;
}
