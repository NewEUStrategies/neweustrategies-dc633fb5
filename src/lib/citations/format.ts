// Formatowanie cytowań akademickich dla publicznych analiz (box "Cytuj tę
// analizę" pod wpisem + tagi Highwire w <head>).
//
// Czyste funkcje - zero React/Supabase - bo dokładnie te łańcuchy trafiają do
// schowka czytelnika i do prac naukowych; muszą być testowalne jednostkowo.
//
// Obsługiwane style (warianty "źródło online"):
//   - Chicago 17 (bibliografia, wpis "website content"),
//   - APA 7 (strona internetowa z datą dzienną),
//   - BibTeX/biblatex (@online) - klucz z nazwiska pierwszego autora + rok.
//
// Zasady dat:
//   - Chicago/APA podają datę publikacji w języku cytowania (PL: "20 lipca
//     2026", EN: "July 20, 2026" - styl amerykański jest normą obu manuali).
//   - Data dostępu (accessedOn) jest OPCJONALNA: Chicago/APA wymagają jej
//     tylko dla źródeł bez daty publikacji; biblatex zaleca `urldate` zawsze.
//     Komponent podaje ją dopiero po montażu (patrz CitationBox) - strony są
//     edge-cache'owane i data "wypieczona" w SSR byłaby stara.

export type CitationLang = "pl" | "en";

export interface CitationAuthor {
  firstName: string | null;
  lastName: string | null;
  /** Fallback gdy imię/nazwisko nie są rozdzielone (konta organizacji). */
  displayName: string | null;
}

export interface CitationSource {
  authors: readonly CitationAuthor[];
  title: string;
  /** Nazwa wydawcy/serwisu (SITE_NAME). */
  siteName: string;
  /** ISO timestamp publikacji; null = źródło niedatowane. */
  publishedAt: string | null;
  /** Kanoniczny, absolutny URL analizy. */
  url: string;
  lang: CitationLang;
  /** Data dostępu czytelnika (YYYY-MM-DD); null = pomiń pola dostępu. */
  accessedOn?: string | null;
}

export interface FormattedCitations {
  chicago: string;
  apa: string;
  bibtex: string;
}

interface NameParts {
  given: string;
  family: string;
}

/**
 * Rozbija autora na imię/nazwisko. Gdy dostępny jest tylko displayName,
 * ostatni wyraz traktujemy jako nazwisko (konwencja zachodnia - zgodna z
 * danymi profili NES). Zwraca null dla pustych rekordów, które pomijamy.
 */
function nameParts(author: CitationAuthor): NameParts | null {
  const first = author.firstName?.trim() ?? "";
  const last = author.lastName?.trim() ?? "";
  if (last) return { given: first, family: last };
  const display = author.displayName?.trim() ?? "";
  if (!display) return null;
  const words = display.split(/\s+/);
  if (words.length === 1) return { given: "", family: words[0] };
  return { given: words.slice(0, -1).join(" "), family: words[words.length - 1] };
}

function resolveAuthors(source: CitationSource): NameParts[] {
  const parts: NameParts[] = [];
  for (const author of source.authors) {
    const p = nameParts(author);
    if (p) parts.push(p);
  }
  return parts;
}

/** "Nazwisko, Imię" (inwersja bibliograficzna). */
function invertedName(p: NameParts): string {
  return p.given ? `${p.family}, ${p.given}` : p.family;
}

/** "Imię Nazwisko" (szyk naturalny). */
function naturalName(p: NameParts): string {
  return p.given ? `${p.given} ${p.family}` : p.family;
}

/** "Nazwisko, I." - inicjały do APA (wieloczłonowe imiona -> "J. M."). */
function apaName(p: NameParts): string {
  if (!p.given) return p.family;
  const initials = p.given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}.`)
    .join(" ");
  return `${p.family}, ${initials}`;
}

const MONTHS_PL_GENITIVE = [
  "stycznia",
  "lutego",
  "marca",
  "kwietnia",
  "maja",
  "czerwca",
  "lipca",
  "sierpnia",
  "września",
  "października",
  "listopada",
  "grudnia",
] as const;

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Deterministyczny rozbiór ISO timestampu na Y/M/D w UTC. Świadomie nie
 * używamy Intl: identyczny łańcuch na serwerze (edge cache) i kliencie
 * niezależnie od wersji ICU, bez ryzyka niezgodności hydratacji.
 */
function dateParts(iso: string): DateParts | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function longDate(parts: DateParts, lang: CitationLang): string {
  return lang === "pl"
    ? `${parts.day} ${MONTHS_PL_GENITIVE[parts.month]} ${parts.year}`
    : `${MONTHS_EN[parts.month]} ${parts.day}, ${parts.year}`;
}

function isoDate(parts: DateParts): string {
  const mm = String(parts.month + 1).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

/** Kropka na końcu segmentu - bez dublowania po skrócie/inicjale. */
function endSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Chicago 17, wpis bibliograficzny dla treści online:
 *   Kowalska, Anna, i Jan Nowak. "Tytuł". New European Strategies,
 *   20 lipca 2026. https://...
 * EN używa "and"/cudzysłowów typograficznych angielskich, PL "i"/polskich.
 */
export function formatChicago(source: CitationSource): string {
  const authors = resolveAuthors(source);
  const lang = source.lang;
  const and = lang === "pl" ? "i" : "and";

  let authorSegment = "";
  if (authors.length === 1) {
    authorSegment = invertedName(authors[0]);
  } else if (authors.length > 1) {
    // Chicago: tylko pierwszy autor w inwersji, kolejni w szyku naturalnym.
    const rest = authors.slice(1).map(naturalName);
    const lastName = rest.pop();
    const head = [invertedName(authors[0]), ...rest].join(", ");
    authorSegment = lang === "pl" ? `${head} ${and} ${lastName}` : `${head}, ${and} ${lastName}`;
  }

  // Kropka po tytule: konwencja amerykańska (EN) trzyma ją WEWNĄTRZ
  // cudzysłowu, polska na zewnątrz - stąd dwa warianty, nie jeden szablon.
  const quotedTitle = lang === "pl" ? `„${source.title}”.` : `“${source.title}.”`;
  const published = source.publishedAt ? dateParts(source.publishedAt) : null;
  const dateSegment = published ? longDate(published, lang) : null;
  const accessed = source.accessedOn ? dateParts(source.accessedOn) : null;

  const pieces: string[] = [];
  if (authorSegment) pieces.push(endSentence(authorSegment));
  pieces.push(quotedTitle);
  if (dateSegment) {
    pieces.push(`${source.siteName}, ${dateSegment}.`);
  } else {
    pieces.push(`${source.siteName}.`);
    // Chicago: data dostępu obowiązkowa tylko przy braku daty publikacji.
    if (accessed) {
      pieces.push(
        lang === "pl"
          ? `Udostępniono ${longDate(accessed, lang)}.`
          : `Accessed ${longDate(accessed, lang)}.`,
      );
    }
  }
  pieces.push(`${source.url}.`);
  return pieces.join(" ");
}

/**
 * APA 7, strona internetowa:
 *   Kowalska, A., & Nowak, J. (2026, 20 lipca). Tytuł. New European
 *   Strategies. https://...
 * Brak daty -> "(b.d.)" / "(n.d.)"; data dostępu tylko wtedy (reguła APA
 * dla treści zmiennych bez daty).
 */
export function formatApa(source: CitationSource): string {
  const authors = resolveAuthors(source);
  const lang = source.lang;

  let authorSegment = "";
  if (authors.length === 1) {
    authorSegment = apaName(authors[0]);
  } else if (authors.length > 1) {
    const names = authors.map(apaName);
    const last = names.pop();
    authorSegment = `${names.join(", ")}, & ${last}`;
  }

  const published = source.publishedAt ? dateParts(source.publishedAt) : null;
  const dateSegment = published
    ? lang === "pl"
      ? `(${published.year}, ${published.day} ${MONTHS_PL_GENITIVE[published.month]})`
      : `(${published.year}, ${MONTHS_EN[published.month]} ${published.day})`
    : lang === "pl"
      ? "(b.d.)"
      : "(n.d.)";
  const accessed = source.accessedOn ? dateParts(source.accessedOn) : null;

  const pieces: string[] = [];
  if (authorSegment) pieces.push(endSentence(authorSegment));
  pieces.push(`${dateSegment}.`);
  pieces.push(endSentence(source.title));
  pieces.push(`${source.siteName}.`);
  if (!published && accessed) {
    pieces.push(
      lang === "pl"
        ? `Pobrano ${longDate(accessed, lang)}, z ${source.url}`
        : `Retrieved ${longDate(accessed, lang)}, from ${source.url}`,
    );
  } else {
    pieces.push(source.url);
  }
  return pieces.join(" ");
}

/**
 * Transliteracja polskich znaków do ASCII na potrzeby klucza BibTeX
 * (klucze muszą być czystym ASCII, inaczej część silników LaTeX-a je odrzuca).
 */
const ASCII_FOLD: Readonly<Record<string, string>> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

function foldAscii(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => ASCII_FOLD[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Escapowanie wartości pól BibTeX: znaki sterujące LaTeX-a neutralizujemy,
 * nawiasy klamrowe usuwamy (zagnieżdżone klamry łamią parsery), reszta
 * zostaje - tytuły w klamrach zachowują wielkość liter.
 */
function bibtexEscape(text: string): string {
  return text
    .replace(/[{}\\]/g, "")
    .replace(/([&%$#_])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/** biblatex @online - pełny wpis z organization/langid/urldate. */
export function formatBibtex(source: CitationSource): string {
  const authors = resolveAuthors(source);
  const published = source.publishedAt ? dateParts(source.publishedAt) : null;
  const accessed = source.accessedOn ? dateParts(source.accessedOn) : null;

  const keyBase = authors.length > 0 ? foldAscii(authors[0].family) : "nes";
  const citeKey = `${keyBase || "nes"}${published ? published.year : ""}`;

  const lines: string[] = [`@online{${citeKey},`];
  if (authors.length > 0) {
    const joined = authors.map((p) => bibtexEscape(invertedName(p))).join(" and ");
    lines.push(`  author       = {${joined}},`);
  }
  lines.push(`  title        = {${bibtexEscape(source.title)}},`);
  lines.push(`  organization = {${bibtexEscape(source.siteName)}},`);
  if (published) lines.push(`  date         = {${isoDate(published)}},`);
  lines.push(`  url          = {${source.url}},`);
  if (accessed) lines.push(`  urldate      = {${isoDate(accessed)}},`);
  lines.push(`  langid       = {${source.lang === "pl" ? "polish" : "english"}},`);
  lines.push("}");
  return lines.join("\n");
}

/** Komplet trzech formatów - jedno wejście, spójne dane we wszystkich. */
export function buildCitations(source: CitationSource): FormattedCitations {
  return {
    chicago: formatChicago(source),
    apa: formatApa(source),
    bibtex: formatBibtex(source),
  };
}
