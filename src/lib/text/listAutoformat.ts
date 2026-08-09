// Autoformatowanie list w zwykłym `textarea` (bez edytora WYSIWYG).
//
// PO CO. Użytkownik pisze "1." albo "-" i oczekuje, że kolejny Enter sam poda
// następny punktor - tak działa każdy edytor, do którego jest przyzwyczajony.
// Bez tego wyliczenia w wątkach powstają ręcznie i rozjeżdżają się numeracją.
//
// ZASADA. Nie zmieniamy modelu danych: treść zostaje tekstem, a znaczniki
// ("- ", "1. ") są jednocześnie zapisem i składnią, którą renderer
// (`parseProseBlocks`) zamienia na prawdziwe `<ul>` / `<ol>`.

export interface ListAutoformatResult {
  value: string;
  /** Pozycja karetki po zmianie (start === end). */
  cursor: number;
}

const BULLET_RE = /^(\s*)([-*•])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,3})([.)])\s+(.*)$/;

/** Normalizuje "*" i "•" do jednego znacznika listy punktowej. */
export const BULLET_MARKER = "-";

function lineBounds(value: string, index: number): { start: number; end: number } {
  const start = value.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nextBreak = value.indexOf("\n", index);
  return { start, end: nextBreak === -1 ? value.length : nextBreak };
}

/**
 * Enter wewnątrz listy: kontynuuje punktor (numer +1), a na pustym punktorze
 * kończy listę (usuwa znacznik) - dokładnie jak w Wordzie / Docs.
 * Zwraca `null`, gdy nie ma czego robić: wtedy zdarzenie leci dalej.
 */
export function applyListAutoformat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
): ListAutoformatResult | null {
  if (key !== "Enter" || selectionStart !== selectionEnd) return null;

  const { start, end } = lineBounds(value, selectionStart);
  if (selectionStart !== end) return null; // karetka w środku linii - nie wtrącamy się
  const line = value.slice(start, end);

  const ordered = ORDERED_RE.exec(line);
  if (ordered) {
    const [, indent, num, dot, rest] = ordered;
    if (rest.trim() === "") {
      const next = value.slice(0, start) + indent + value.slice(end);
      return { value: next, cursor: start + indent.length };
    }
    const marker = `${indent}${Number(num) + 1}${dot} `;
    const next = value.slice(0, end) + "\n" + marker + value.slice(end);
    return { value: next, cursor: end + 1 + marker.length };
  }

  const bullet = BULLET_RE.exec(line);
  if (bullet) {
    const [, indent, , rest] = bullet;
    if (rest.trim() === "") {
      const next = value.slice(0, start) + indent + value.slice(end);
      return { value: next, cursor: start + indent.length };
    }
    const marker = `${indent}${BULLET_MARKER} `;
    const next = value.slice(0, end) + "\n" + marker + value.slice(end);
    return { value: next, cursor: end + 1 + marker.length };
  }

  return null;
}
