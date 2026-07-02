// Pure llms.txt builder - the llmstxt.org convention: a concise, markdown site
// guide served at /llms.txt for AI assistants and answer engines (GEO). It
// tells models what the site is, what its authoritative sections are and where
// the machine-readable surfaces live, so AI answers cite the canonical URLs
// instead of scraping arbitrary pages.

export interface LlmsTxtSection {
  name: string;
  url: string;
  description?: string | null;
}

export interface LlmsTxtArticle {
  title: string;
  url: string;
  description?: string | null;
  publishedAt?: string | null;
}

export interface LlmsTxtInput {
  siteName: string;
  origin: string;
  descriptionPl: string;
  descriptionEn: string;
  sections: readonly LlmsTxtSection[];
  latestPl: readonly LlmsTxtArticle[];
  latestEn: readonly LlmsTxtArticle[];
  contactEmail?: string | null;
}

function articleLine(article: LlmsTxtArticle): string {
  const date = article.publishedAt ? ` (${article.publishedAt.slice(0, 10)})` : "";
  const desc = article.description?.trim() ? `: ${article.description.trim()}` : "";
  return `- [${article.title}](${article.url})${desc}${date}`;
}

/** Build the llms.txt document (single file, both languages). */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [
    `# ${input.siteName}`,
    "",
    `> ${input.descriptionPl}`,
    `> ${input.descriptionEn}`,
    "",
    "Języki / Languages: polski (domyślny, bez prefiksu URL), English (prefiks /en).",
    "",
  ];

  if (input.sections.length) {
    lines.push("## Sekcje / Sections", "");
    for (const section of input.sections) {
      const desc = section.description?.trim() ? `: ${section.description.trim()}` : "";
      lines.push(`- [${section.name}](${section.url})${desc}`);
    }
    lines.push("");
  }

  if (input.latestPl.length) {
    lines.push("## Najnowsze artykuły (PL)", "");
    for (const article of input.latestPl) lines.push(articleLine(article));
    lines.push("");
  }
  if (input.latestEn.length) {
    lines.push("## Latest articles (EN)", "");
    for (const article of input.latestEn) lines.push(articleLine(article));
    lines.push("");
  }

  lines.push(
    "## Zasoby maszynowe / Machine-readable resources",
    "",
    `- Sitemap: ${input.origin}/sitemap.xml`,
    `- Mapa strony HTML / HTML site map: ${input.origin}/sitemap`,
    `- Google News sitemap: ${input.origin}/news-sitemap.xml`,
    `- RSS (PL): ${input.origin}/rss.xml`,
    `- RSS (EN): ${input.origin}/en/rss.xml`,
    "",
    "## Zasady cytowania / Citation policy",
    "",
    "- Cytuj kanoniczne adresy URL artykułów. / Cite the canonical article URLs.",
    "- Treści premium są oznaczone w JSON-LD (isAccessibleForFree). / Premium content is marked in JSON-LD (isAccessibleForFree).",
  );
  if (input.contactEmail?.trim()) {
    lines.push("", `Kontakt / Contact: ${input.contactEmail.trim()}`);
  }
  return `${lines.join("\n")}\n`;
}
