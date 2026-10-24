/**
 * Lead wpisu (zajawka pod tytułem) z surowej zajawki.
 *
 * PO CO. WordPress, gdy autor nie wpisał zajawki, buduje ją sam: pierwsze ~55
 * słów treści + znacznik `[&hellip;]`. `cleanExcerpt` zdejmuje znacznik, ale
 * zostawia zdanie urwane w pół słowa („Niemcy natomiast były zadłużone”),
 * a czytelnik widzi te same zdania drugi raz zaraz pod nagłówkiem.
 *
 * ZASADA.
 * - `truncated`: surowa zajawka kończy się znacznikiem skrócenia (`[…]`,
 *   `[...]`, `[&hellip;]`, `&#8230;`, `…`). Wtedy lead kończy się na ostatnim
 *   pełnym zdaniu, jeśli zostaje z niego ≥ 60% tekstu albo ≥ 120 znaków;
 *   inaczej tekst urywa się na granicy słowa z „…”.
 * - `duplicatesBody`: znormalizowany lead jest początkiem tekstu pierwszych
 *   bloków treści - nagłówek go wtedy nie renderuje.
 * - zajawka bez znacznika (ręczna) wychodzi dokładnie tak jak z `cleanExcerpt`.
 *
 * Czysta funkcja bez DOM: SSR i hydratacja liczą ten sam wynik. SEO, RSS
 * i `llms.txt` nadal czytają `cleanExcerpt` - ten moduł dotyczy tylko widoku.
 */
import { cleanExcerpt, decodeHtmlEntities } from "./cleanExcerpt";

export interface ExcerptLead {
  /** Lead do wyświetlenia; `undefined`, gdy zajawka jest pusta. */
  text: string | undefined;
  /** Surowa zajawka kończyła się znacznikiem skrócenia. */
  truncated: boolean;
  /** Lead powtarza początek treści wpisu. */
  duplicatesBody: boolean;
}

/** Znacznik w nawiasie (`[…]`, `[...]`, `(…)`) - ten sam co w `cleanExcerpt`. */
const BRACKET_MARKER = /[\s\u00a0]*[[(](?:…|\.{2,})[\])][\s\u00a0]*$/;
/** Goły wielokropek na końcu (`…`, `&#8230;` po dekodowaniu, `...`). */
const BARE_MARKER = /[\s\u00a0]*(?:…|\.{3,})[\s\u00a0]*$/;

/**
 * Koniec zdania: `.`, `!`, `?` albo `…`, opcjonalnie przed zamykającym
 * cudzysłowem lub nawiasem (`.”`, `?»`, `.)`), a za nim odstęp albo koniec.
 */
const SENTENCE_END = /[.!?…]+["'”’»)\]]*(?=[\s\u00a0]|$)/gu;

/**
 * Skróty, po których kropka nie kończy zdania. Jednoliterowe tokeny (inicjały,
 * „r.”, „w.”) obsługuje osobny warunek.
 */
const ABBREVIATIONS = new Set([
  "al",
  "ang",
  "cyt",
  "dr",
  "ds",
  "e.g",
  "godz",
  "gr",
  "i.e",
  "inż",
  "m.in",
  "mgr",
  "mld",
  "mln",
  "mr",
  "mrs",
  "nr",
  "ok",
  "pkt",
  "por",
  "prof",
  "św",
  "tj",
  "tys",
  "tzw",
  "ul",
  "vs",
  "wg",
  "zob",
]);

const MIN_SENTENCE_SHARE = 0.6;
const MIN_SENTENCE_CHARS = 120;
/** Krótszy lead nie jest uznawany za kopię treści (np. jedno słowo „Wstęp”). */
const MIN_DUPLICATE_CHARS = 40;

const ELLIPSIS = "…";

function isAbbreviationBefore(text: string, punctIndex: number): boolean {
  const token = /(\S+)$/u.exec(text.slice(0, punctIndex))?.[1] ?? "";
  const bare = token.replace(/^["'„“«([]+/u, "").toLowerCase();
  if (bare.length === 0) return false;
  if (/^\p{L}$/u.test(bare)) return true;
  return ABBREVIATIONS.has(bare);
}

/** Pozycja tuż za ostatnim pełnym zdaniem albo -1. */
function lastSentenceEnd(text: string): number {
  let best = -1;
  for (const m of text.matchAll(SENTENCE_END)) {
    const start = m.index;
    const end = start + m[0].length;
    const rest = text.slice(end).trimStart();
    // „np. ten”, „w 1925 r. rząd” - po końcu zdania nie stoi mała litera.
    if (rest.length > 0 && /^\p{Ll}/u.test(rest)) continue;
    if (m[0].startsWith(".") && isAbbreviationBefore(text, start)) continue;
    best = end;
  }
  return best;
}

function cutToLead(text: string): string {
  const end = lastSentenceEnd(text);
  if (end > 0) {
    const kept = text.slice(0, end).trim();
    if (kept.length >= text.length * MIN_SENTENCE_SHARE || kept.length >= MIN_SENTENCE_CHARS) {
      return kept;
    }
  }
  const words = text.replace(/[\s\u00a0,;:\-–—(„"«]+$/u, "");
  return words.length > 0 ? `${words}${ELLIPSIS}` : "";
}

/**
 * Wspólna postać do porównania leadu z treścią: encje zdekodowane, bez
 * cudzysłowów (`”“″„«»` i proste), myślniki i wielokropek ujednolicone, bez
 * odstępów - WordPress skleja bloki spacją, a tekst bloków bywa sklejony bez niej.
 */
function compactForCompare(input: string): string {
  return decodeHtmlEntities(input)
    .normalize("NFC")
    .replace(/["'`‘’‚‛“”„‟′″«»‹›]/gu, "")
    .replace(/…/gu, "...")
    .replace(/[‐-―−]/gu, "-")
    .replace(/[\s\u00a0]+/gu, "")
    .toLowerCase();
}

function duplicatesBodyStart(lead: string, bodyStartText: string | null | undefined): boolean {
  if (!bodyStartText) return false;
  const withoutEllipsis = lead.endsWith(ELLIPSIS) ? lead.slice(0, -ELLIPSIS.length) : lead;
  const needle = compactForCompare(withoutEllipsis).replace(/\.+$/u, "");
  if (needle.length < MIN_DUPLICATE_CHARS) return false;
  return compactForCompare(bodyStartText).startsWith(needle);
}

export function excerptToLead(
  rawExcerpt: string | null | undefined,
  bodyStartText?: string | null,
): ExcerptLead {
  const clean = cleanExcerpt(rawExcerpt);
  if (!clean) return { text: undefined, truncated: false, duplicatesBody: false };

  const decoded = decodeHtmlEntities(rawExcerpt ?? "")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
  const truncated = BRACKET_MARKER.test(decoded) || BARE_MARKER.test(decoded);
  const text = truncated ? cutToLead(clean.replace(BARE_MARKER, "")) || undefined : clean;
  return {
    text,
    truncated,
    duplicatesBody: text ? duplicatesBodyStart(text, bodyStartText) : false,
  };
}
