/**
 * Czyszczenie zajawek (excerpt) importowanych m.in. z WordPressa.
 * - dekoduje encje HTML (&hellip;, &amp;, &#8230;, ...)
 * - usuwa końcowe znaczniki skrócenia typu "[…]", "[...]", "(...)"
 */

const NAMED_ENTITIES: Record<string, string> = {
  hellip: "\u2026",
  nbsp: "\u00a0",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "-",
  mdash: "-",
  laquo: "\u00ab",
  raquo: "\u00bb",
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
  bdquo: "\u201e",
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

const TRAILING_ELLIPSIS_MARKER = /[\s\u00a0]*[[(](?:\u2026|\.{2,})[\])][\s\u00a0]*$/;

export function cleanExcerpt(input?: string | null): string | undefined {
  if (!input) return undefined;
  let out = decodeHtmlEntities(input);
  // powtarzamy, gdy zostało kilka znaczników po sobie
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(TRAILING_ELLIPSIS_MARKER, "");
  }
  out = out.replace(/[\s\u00a0]+/g, " ").trim();
  return out.length > 0 ? out : undefined;
}
