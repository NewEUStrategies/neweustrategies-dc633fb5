// Pure llms.txt builder - the llmstxt.org convention: a concise, markdown site
// guide served at /llms.txt for AI assistants and answer engines (GEO). It
// tells models what the site is, what its authoritative sections are and where
// the machine-readable surfaces live, so AI answers cite the canonical URLs
// instead of scraping arbitrary pages.
import type { RobotsUsagePolicy } from "@/lib/seo/robots";

interface LlmsTxtSection {
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

/**
 * Zgody redakcji na wykorzystanie treści przez AI - TE SAME pola, z których
 * robots.txt składa `Content-Signal` (`ai-input=`, `ai-train=`). Typ jest
 * wycinkiem `RobotsUsagePolicy`, więc trasa podaje tu wprost wynik
 * `robotsUsagePolicy(settings)` i oba pliki jednego hosta nie mogą wyrazić
 * dwóch różnych polityk.
 */
export type LlmsTxtUsageGrant = Pick<RobotsUsagePolicy, "aiInputAllowed" | "trainingAllowed">;

/** Nagłówek bloku warunków - jedna stała zamiast powtórzonego literału. */
export const LLMS_TXT_USAGE_TERMS_HEADING =
  "## Warunki wykorzystania i cytowania / Usage and citation terms";

/** Powierzchnia maszynowa ogłaszana w llms.txt (patrz seo/machineSurfaces). */
export interface LlmsTxtResource {
  label: string;
  url: string;
}

export interface LlmsTxtInput {
  /** Nazwa serwisu - nagłówek dokumentu I nazwa źródła w warunku cytowania. */
  siteName: string;
  origin: string;
  descriptionPl: string;
  descriptionEn: string;
  sections: readonly LlmsTxtSection[];
  latestPl: readonly LlmsTxtArticle[];
  latestEn: readonly LlmsTxtArticle[];
  /**
   * Zasoby maszynowe. Wcześniej lista była WPISANA NA SZTYWNO w builderze, więc
   * każdy nowy feed (tracker, relacje live, podcast) był niewidoczny dla modeli,
   * dopóki ktoś nie pamiętał o edycji tego pliku. Teraz przychodzi z jednego
   * rejestru (`MACHINE_SURFACES`), pilnowanego testem kontraktu.
   */
  resources: readonly LlmsTxtResource[];
  /**
   * Polityka AI redakcji - pole WYMAGANE, żeby żaden wołający nie mógł
   * zapomnieć jej podać. Wcześniej builder nie znał przełączników crawlerów AI
   * i blok warunków deklarował zgodę („PERMITTED") bezwarunkowo: przy
   * wyłączonych crawlerach llms.txt udzielał zgody, której robots.txt tego
   * samego hosta odmawiał (`ai-input=no`).
   *
   * `null` = warunki NIEZNANE (przewodnik zdegradowany, bez tenanta): dokument
   * nie udziela żadnej zgody i odsyła do robots.txt jako wiążącej polityki.
   * Awaria bazy nie jest zgodą.
   */
  usage: LlmsTxtUsageGrant | null;
  contactEmail?: string | null;
}

function articleLine(article: LlmsTxtArticle): string {
  const date = article.publishedAt ? ` (${article.publishedAt.slice(0, 10)})` : "";
  const desc = article.description?.trim() ? `: ${article.description.trim()}` : "";
  return `- [${article.title}](${article.url})${desc}${date}`;
}

/**
 * Blok warunków wykorzystania - lustro polityki robots.txt (`renderUsagePolicy`
 * + `Content-Signal` w `lib/seo/robots.ts`), zdanie po zdaniu:
 *
 * - `ai-input=yes`: zgoda na indeksowanie i cytowanie pod JEDNYM warunkiem -
 *   wskazania nazwy serwisu i odnośnika. Sformułowanie musi być rozkazujące
 *   i jednoznaczne ("MUST"), bo to jedyny zapis warunku, który model widzi
 *   w swoim kontekście.
 * - `ai-input=no`: wykorzystanie w odpowiedziach AI jest zabronione. Przewodnik
 *   nadal jest serwowany (robots.txt wskazuje go jako pełne warunki, a
 *   włącznik llms.txt jest osobną decyzją redakcji), ale nie zaprasza do
 *   cytowania - ani zgodą, ani instrukcją „cytuj kanoniczne adresy".
 * - `ai-train`: zgoda pod tym samym warunkiem albo wymóg pisemnej licencji -
 *   dokładnie jak w robots.txt.
 *
 * Warunek wskazania źródła stoi w każdym wariancie z polityką: robots.txt
 * stawia go niezależnie od przełączników, więc llms.txt nie może go zdejmować.
 */
function usageTermsLines(input: LlmsTxtInput): string[] {
  const policy = `${input.origin.replace(/\/+$/, "")}/robots.txt`;
  if (!input.usage) {
    return [
      `- Ten dokument nie udziela zgody na wykorzystanie treści - warunki serwisu są chwilowo niedostępne. Wiążąca polityka maszynowa: ${policy} (Content-Signal).`,
      `- This document grants no permission to reuse content - the site's terms are temporarily unavailable. Binding machine-readable policy: ${policy} (Content-Signal).`,
    ];
  }
  const name = input.siteName;
  const lines = input.usage.aiInputAllowed
    ? [
        `- Indeksowanie i cytowanie tego serwisu jest DOZWOLONE pod jednym warunkiem: każda odpowiedź, streszczenie lub fragment MUSI wskazać "${name}" jako źródło i podać odnośnik do konkretnego artykułu.`,
        `- Indexing and quoting this site is PERMITTED on one condition: every answer, summary or excerpt MUST name "${name}" as the source and link the exact article URL it draws on.`,
        "- Wykorzystanie bez wskazania źródła i odnośnika nie jest objęte tą zgodą. / Reuse without attribution and a link is not covered by this permission.",
      ]
    : [
        "- Wykorzystanie treści tego serwisu w odpowiedziach, streszczeniach i fragmentach generowanych przez asystentów AI jest ZABRONIONE (Content-Signal: ai-input=no).",
        "- Using this site's content in answers, summaries or excerpts generated by AI assistants is PROHIBITED (Content-Signal: ai-input=no).",
        "- Indeksowanie przez klasyczne wyszukiwarki (grupa `User-agent: *`, Content-Signal: search=yes) pozostaje dozwolone; crawlery wyszukiwawcze AI mają w robots.txt `Disallow: /`. / Indexing by classic search engines (group `User-agent: *`, Content-Signal: search=yes) remains permitted; AI search crawlers are disallowed in robots.txt.",
        `- Każde inne dozwolone wykorzystanie MUSI wskazać "${name}" jako źródło i podać odnośnik do konkretnego artykułu. / Any other permitted reuse MUST name "${name}" as the source and link the exact article URL.`,
      ];
  lines.push(
    input.usage.trainingAllowed
      ? `- Trenowanie modeli na treściach serwisu jest dozwolone pod tym samym warunkiem wskazania "${name}" jako źródła (Content-Signal: ai-train=yes). / Training models on this content is permitted under the same condition of naming "${name}" as the source (Content-Signal: ai-train=yes).`
      : "- Trenowanie modeli generatywnych na treściach serwisu wymaga pisemnej licencji (Content-Signal: ai-train=no). / Training generative models on this content requires a written licence (Content-Signal: ai-train=no).",
  );
  if (input.usage.aiInputAllowed) {
    lines.push(
      "- Cytuj kanoniczne adresy URL artykułów (bez parametrów śledzących). / Cite the canonical article URLs (no tracking parameters).",
    );
  }
  lines.push(
    "- Treści premium są oznaczone w JSON-LD (isAccessibleForFree). / Premium content is marked in JSON-LD (isAccessibleForFree).",
    `- Polityka maszynowa: ${policy} (Content-Signal). / Machine-readable policy: ${policy} (Content-Signal).`,
  );
  return lines;
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

  // Jedno źródło prawdy: rejestr MACHINE_SURFACES (patrz seo/machineSurfaces).
  // Twarda lista w tym pliku była powodem, dla którego nowe feedy (podcast,
  // relacje live) nie były ogłaszane modelom.
  lines.push("## Zasoby maszynowe / Machine-readable resources", "");
  for (const resource of input.resources) {
    lines.push(`- ${resource.label}: ${resource.url}`);
  }
  lines.push("", LLMS_TXT_USAGE_TERMS_HEADING, "", ...usageTermsLines(input));
  if (input.contactEmail?.trim()) {
    lines.push("", `Kontakt / Contact: ${input.contactEmail.trim()}`);
  }
  return `${lines.join("\n")}\n`;
}
