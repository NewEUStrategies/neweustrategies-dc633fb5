// Tagi Highwire Press (citation_*) dla wpisów - czytane przez Google Scholar,
// Zotero, Mendeley i inne menedżery bibliografii. Emitowane w <head> obok OG.
//
// Zestaw minimalny wg wytycznych Scholar (inclusion guidelines):
//   - citation_title,
//   - citation_author (po jednym tagu na autora, "Nazwisko, Imię"),
//   - citation_publication_date + citation_online_date (YYYY/MM/DD),
//   - citation_journal_title (serwis w roli wydawnictwa - konwencja przyjęta
//     przez think-tanki: Brookings/Bruegel emitują dokładnie tak),
//   - citation_language, citation_fulltext_html_url, citation_public_url.
//
// Formatowanie tekstów cytowań dla czytelnika mieszka w
// src/lib/citations/format.ts - ten moduł buduje wyłącznie meta do <head>.
import type { CitationAuthor } from "@/lib/citations/format";
import type { Lang } from "@/lib/seo/meta";

export interface CitationMetaInput {
  title: string;
  authors: readonly CitationAuthor[];
  publishedAt: string | null;
  siteName: string;
  language: Lang;
  /** Kanoniczny, absolutny URL pełnej treści. */
  url: string;
}

/** Data w formacie Scholar (YYYY/MM/DD, UTC); null dla nieparsowalnych. */
function scholarDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}/${mm}/${dd}`;
}

/** "Nazwisko, Imię" (preferowane przez Scholar); fallback: displayName. */
function authorName(author: CitationAuthor): string | null {
  const first = author.firstName?.trim() ?? "";
  const last = author.lastName?.trim() ?? "";
  if (last) return first ? `${last}, ${first}` : last;
  const display = author.displayName?.trim() ?? "";
  return display || null;
}

/** Buduje listę meta citation_* w formacie head() TanStack Start. */
export function citationMetaTags(input: CitationMetaInput): Array<Record<string, string>> {
  const meta: Array<Record<string, string>> = [{ name: "citation_title", content: input.title }];
  for (const author of input.authors) {
    const name = authorName(author);
    if (name) meta.push({ name: "citation_author", content: name });
  }
  const date = input.publishedAt ? scholarDate(input.publishedAt) : null;
  if (date) {
    meta.push({ name: "citation_publication_date", content: date });
    meta.push({ name: "citation_online_date", content: date });
  }
  meta.push({ name: "citation_journal_title", content: input.siteName });
  meta.push({ name: "citation_language", content: input.language });
  if (input.url) {
    meta.push({ name: "citation_fulltext_html_url", content: input.url });
    meta.push({ name: "citation_public_url", content: input.url });
  }
  return meta;
}
