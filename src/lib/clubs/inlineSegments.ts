// Parser inline treści klubowej: adresy URL, @wzmianki i #tagi.
//
// PO CO. Treść wpisu klubowego jest zwykłym tekstem (świadomie - zero HTML-a
// od użytkownika). Ale trzy rzeczy w tym tekście są NOŚNIKAMI KONTEKSTU i mają
// prawo do własnego węzła:
//   * URL      -> link + podgląd karty (OpenGraph) po najechaniu,
//   * @slug    -> link do profilu + podgląd osoby po najechaniu,
//   * #tag     -> segmentacja wątków (filtr strumienia klubu).
//
// JEDNO PRZEJŚCIE, ZERO HTML-a. Zwracamy tablicę segmentów; warstwa widoku
// buduje z nich węzły React. Konkatenacja `text`/`raw` wszystkich segmentów
// odtwarza wejście 1:1 (znak graniczny przed @ / # wraca do strumienia jako
// tekst), więc parser nie gubi ani nie dokłada znaków.
//
// Wzorzec @wzmianki jest LUSTREM `src/lib/mentions/parse.ts` (a ten - lustrem
// triggera `process_mentions` w bazie): linkujemy wyłącznie to, co realnie
// generuje powiadomienie. Bez lookbehind - starsze Safari go nie parsuje.

export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; slug: string; raw: string }
  | { kind: "hashtag"; tag: string; raw: string }
  | { kind: "url"; href: string; raw: string };

/** Maks. długość tagu (bez „#"). */
export const MAX_TAG_LEN = 50;

// 1: URL | 2: granica + 3: slug wzmianki | 4: granica + 5: tag
const INLINE_RE =
  /(https?:\/\/[^\s<>"'`)\]]+)|(^|[^A-Za-z0-9@._-])@([A-Za-z0-9][A-Za-z0-9_-]{1,63})|(^|[^\p{L}\p{N}#/&_-])#([\p{L}\p{N}][\p{L}\p{N}_-]{1,49})/gu;

// Znaki interpunkcyjne, które w zdaniu przylegają do adresu, ale do niego nie należą.
const TRAILING_PUNCT = /[.,;:!?»"'”]+$/;

function trimUrl(raw: string): string {
  let out = raw.replace(TRAILING_PUNCT, "");
  // Domknięcie nawiasu bierzemy tylko wtedy, gdy w adresie jest jego otwarcie.
  while (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) {
    out = out.slice(0, -1);
  }
  return out;
}

/** Kanoniczna postać tagu: małe litery, bez „#" (klucz filtra i porównań). */
export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").toLocaleLowerCase("pl-PL").slice(0, MAX_TAG_LEN);
}

/**
 * Dzieli treść na segmenty tekstu, linków, wzmianek i tagów. Czysta funkcja,
 * bez I/O - bezpieczna do wołania per akapit na długiej liście.
 */
export function splitInline(body: string | null | undefined): InlineSegment[] {
  const out: InlineSegment[] = [];
  if (!body) return out;
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(body)) !== null) {
    const url = m[1];
    const mentionBoundary = m[2];
    const slug = m[3];
    const tagBoundary = m[4];
    const tag = m[5];

    const boundary = url !== undefined ? "" : (mentionBoundary ?? tagBoundary ?? "");
    const textEnd = m.index + boundary.length;
    if (textEnd > last) out.push({ kind: "text", text: body.slice(last, textEnd) });

    if (url !== undefined) {
      const href = trimUrl(url);
      out.push({ kind: "url", href, raw: href });
      last = m.index + boundary.length + href.length;
      INLINE_RE.lastIndex = last;
      continue;
    }

    if (slug !== undefined) {
      out.push({ kind: "mention", slug: slug.toLowerCase(), raw: `@${slug}` });
    } else if (tag !== undefined) {
      out.push({ kind: "hashtag", tag: normalizeTag(tag), raw: `#${tag}` });
    }
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

/** Unikalne tagi w kolejności wystąpienia - do segmentacji wątków. */
export function extractHashtags(body: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const seg of splitInline(body)) {
    if (seg.kind === "hashtag" && !seen.has(seg.tag)) seen.add(seg.tag);
  }
  return [...seen];
}

/** Pierwszy adres w treści - kandydat do „dużej" karty podglądu pod wpisem. */
export function firstUrl(body: string | null | undefined): string | null {
  for (const seg of splitInline(body)) {
    if (seg.kind === "url") return seg.href;
  }
  return null;
}
