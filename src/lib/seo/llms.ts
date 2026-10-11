// Pure llms.txt builder - the llmstxt.org convention: a concise, markdown site
// guide served at /llms.txt for AI assistants and answer engines (GEO). It
// tells models what the site is, what its authoritative sections are and where
// the machine-readable surfaces live, so AI answers cite the canonical URLs
// instead of scraping arbitrary pages.
//
// GRAMATYKA PLIKU (2026-10 audyt powierzchni maszynowych - parser referencyjny
// `llms-txt` 0.0.7 odrzucał produkcyjny plik):
//   * `# Nazwa`, potem JEDNA linia cytatu `> streszczenie` (parser bierze tylko
//     pierwszą linię cytatu - druga, angielska, wpadała do treści swobodnej
//     jako „> ..."); streszczenie EN stoi więc zwykłym akapitem pod cytatem;
//   * blok swobodny (akapity, listy, BEZ nagłówków) aż do pierwszego `##` -
//     tu mieszkają języki, warunki wykorzystania i kontakt;
//   * pod KAŻDYM `##` wyłącznie lista plików: `- [tytuł](url)` i opcjonalnie
//     `: notatka`. Wcześniej zasoby maszynowe szły jako `- Etykieta: https://...`,
//     warunki cytowania jako zdania pod własnym `##`, a artykuł bez zajawki
//     kończył się „ (2026-07-01)" bez dwukropka - każda z tych linii łamała
//     gramatykę, więc parser odrzucał cały dokument. Test w `llms.test.ts`
//     przykłada wyrażenie specyfikacji do każdej linii pod każdym `##`.
import { plainText } from "@/lib/seo/rss";
import type { RobotsUsagePolicy } from "@/lib/seo/robots";

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

/**
 * Zgody redakcji na wykorzystanie treści przez AI - TE SAME pola, z których
 * robots.txt składa `Content-Signal` (`ai-input=`, `ai-train=`). Typ jest
 * wycinkiem `RobotsUsagePolicy`, więc trasa podaje tu wprost wynik
 * `robotsUsagePolicy(settings)` i oba pliki jednego hosta nie mogą wyrazić
 * dwóch różnych polityk.
 */
export type LlmsTxtUsageGrant = Pick<RobotsUsagePolicy, "aiInputAllowed" | "trainingAllowed">;

/**
 * Tytuł bloku warunków. NIE jest nagłówkiem `##`: llmstxt.org rezerwuje
 * sekcje `##` na listy odnośników, a warunki to zdania - stoją więc w bloku
 * swobodnym nad pierwszym `##`, gdzie model czyta je przed jakąkolwiek treścią.
 */
export const LLMS_TXT_USAGE_TERMS_LABEL =
  "**Warunki wykorzystania i cytowania / Usage and citation terms**";

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
  /**
   * Sekcje główne w zaplanowanej kolejności (`lib/seo/primaryNavigation.ts`) -
   * ta sama lista, którą strona główna deklaruje jako nawigację w JSON-LD.
   * Stoi PRZED kategoriami, bo to ona mówi modelowi, czym serwis jest.
   */
  primarySections?: readonly LlmsTxtSection[];
  /** Archiwa kategorii z treścią (`llmsTxtTaxonomy`). */
  sections: readonly LlmsTxtSection[];
  /** Profile organizacji (`kind = 'organization'`) pod adresem kanonicznym. */
  organizations?: readonly LlmsTxtSection[];
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

// ---------------------------------------------------------------------------
// Kategorie -> sekcje llms.txt
// ---------------------------------------------------------------------------

/** Wartość `categories.kind` dla profilu organizacji (lustro mapy strony). */
export const ORGANIZATION_CATEGORY_KIND = "organization";

/** Wiersz kategorii w kształcie, w jakim podaje go czytnik `fetchPublicCategories`. */
export interface LlmsTxtCategory {
  slug: string;
  kind?: string | null;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  /** Opublikowane, indeksowalne wpisy przypięte do kategorii (`post_categories`). */
  published_post_count?: number | null;
}

export interface LlmsTxtTaxonomy {
  sections: LlmsTxtSection[];
  organizations: LlmsTxtSection[];
}

const CATEGORY_HREF_PREFIX = "/category/";

function categoryName(category: LlmsTxtCategory): string {
  const pl = category.name_pl?.trim() ?? "";
  const en = category.name_en?.trim() ?? "";
  if (pl && en && pl !== en) return `${pl} / ${en}`;
  return pl || en || category.slug;
}

/**
 * Kategorie jako sekcje llms.txt - ta sama reguła co sekcja `taxonomy` mapy
 * strony (`sitemapEntries.server.ts`).
 *
 * 2026-10 audyt na produkcji: przewodnik wypisywał WSZYSTKIE 44 termy jako
 * „Sekcje", choć 18 wpisów z importu WordPressa nie ma ani jednego wiersza
 * w `post_categories` - każde archiwum renderowało „Brak opublikowanych
 * wpisów.", a terminy organizacji szły pod niekanonicznym `/category/<slug>`.
 * Teraz:
 *   * archiwum kategorii trafia do sekcji tylko z co najmniej jednym wpisem
 *     opublikowanym i indeksowalnym - pusta lista to dla modelu żadne źródło;
 *   * organizacja (`kind = 'organization'`) idzie pod `/organization/<slug>`,
 *     swoim adresem kanonicznym, także bez wpisów - to strona bytu (opis,
 *     logo), nie lista wpisów, więc mapa strony też ją zostawia.
 */
export function llmsTxtTaxonomy(
  origin: string,
  categories: readonly LlmsTxtCategory[],
): LlmsTxtTaxonomy {
  const out: LlmsTxtTaxonomy = { sections: [], organizations: [] };
  for (const category of categories) {
    const entry: LlmsTxtSection = {
      name: categoryName(category),
      url: "",
      description: category.description_pl || category.description_en,
    };
    if (category.kind === ORGANIZATION_CATEGORY_KIND) {
      out.organizations.push({ ...entry, url: `${origin}/organization/${category.slug}` });
    } else if ((category.published_post_count ?? 0) > 0) {
      out.sections.push({ ...entry, url: `${origin}${CATEGORY_HREF_PREFIX}${category.slug}` });
    }
  }
  return out;
}

/**
 * Adres sekcji głównej po sprawdzeniu celu - `null`, gdy prowadziłby na pustkę.
 *
 * Sekcje główne są statyczną listą marki (`primaryNavigation.ts`), a dwie
 * z nich to archiwa kategorii (`/category/wywiady`, `/category/policy-papers`)
 * - na produkcji puste z tego samego powodu co reszta archiwów. Przewodnik
 * nie może kierować modelu na stronę „Brak opublikowanych wpisów.", więc:
 * archiwum bez wpisu wypada, term organizacji dostaje adres kanoniczny,
 * a term nieistniejący wypada. Pusta lista kategorii to stan NIEZNANY
 * (czytnik `resilient` po awarii oddaje `[]`) - wtedy sekcja zostaje taka,
 * jaką zadeklarowała redakcja, a przewodnik i tak dostaje TTL zdegradowany.
 *
 * `emptyTargets` (przegląd 2026-10): adresy SPOZA kategorii, o których trasa
 * wie, że prowadzą dziś na pustą listę. Na produkcji `/podcasts` renderuje
 * „Brak opublikowanych odcinków." - ta sama klasa co puste archiwum, której
 * pierwsza wersja poprawki nie objęła, bo patrzyła tylko na `/category/`.
 */
export function resolvePrimarySectionHref(
  href: string,
  categories: readonly LlmsTxtCategory[],
  emptyTargets: ReadonlySet<string> = new Set(),
): string | null {
  if (emptyTargets.has(href)) return null;
  if (!href.startsWith(CATEGORY_HREF_PREFIX) || categories.length === 0) return href;
  const slug = href.slice(CATEGORY_HREF_PREFIX.length);
  const category = categories.find((c) => c.slug === slug);
  if (!category) return null;
  if (category.kind === ORGANIZATION_CATEGORY_KIND) return `/organization/${category.slug}`;
  return (category.published_post_count ?? 0) > 0 ? href : null;
}

// ---------------------------------------------------------------------------
// Linie dokumentu
// ---------------------------------------------------------------------------

/** Jedna linia: gramatyka llms.txt jest liniowa, więc złamanie wiersza ją psuje. */
function oneLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Tekst odnośnika zgodny z wyrażeniem parsera referencyjnego
 * (`\[(?P<title>[^\]]+)\]`). Ucieczka `\]` NIE wystarcza: klasa `[^\]]` kończy
 * tytuł na pierwszym `]` niezależnie od poprzedzającego ukośnika, więc tytuł
 * „Raport [PDF]" zrywał dopasowanie całej linii. Nawiasy kwadratowe stają się
 * okrągłymi - te są dozwolone w tekście odnośnika zarówno w CommonMark, jak
 * i w gramatyce llms.txt. Pusty tytuł (klasa wymaga min. jednego znaku)
 * zastępuje adres.
 */
function linkText(value: string, fallback: string): string {
  const text = oneLine(value).replace(/\[/g, "(").replace(/\]/g, ")");
  return text || fallback;
}

/** Adres odnośnika: `)` kończy go w gramatyce (`\((?P<url>[^\)]+)\)`) i w CommonMark. */
function linkUrl(url: string): string {
  return oneLine(url).replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** `- [tytuł](url)` + opcjonalna notatka - jedyny kształt linii pod `##`. */
function linkLine(title: string, url: string, notes?: string | null): string {
  const href = linkUrl(url);
  const note = oneLine(notes);
  return `- [${linkText(title, href)}](${href})${note ? `: ${note}` : ""}`;
}

/**
 * Artykuł: zajawka przez TEN SAM sanitarny `plainText` co opisy w RSS (tagi,
 * encje, znacznik „[…]" z WordPressa), data na końcu notatki. Artykuł bez
 * zajawki dostaje notatkę z samą datą - wcześniej linia kończyła się
 * „ (2026-07-01)" bez dwukropka, czego gramatyka nie dopuszcza.
 */
function articleLine(article: LlmsTxtArticle): string {
  const date = article.publishedAt ? `(${article.publishedAt.slice(0, 10)})` : "";
  const desc = plainText(article.description);
  return linkLine(article.title, article.url, [desc, date].filter(Boolean).join(" "));
}

function sectionLine(section: LlmsTxtSection): string {
  return linkLine(section.name, section.url, plainText(section.description));
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
  // Nazwa w jednej linii - ta sama, co w nagłówku `#` (złamanie wiersza
  // z pola redakcji rozcinałoby warunek cytowania na dwie linie).
  const name = oneLine(input.siteName);
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
  const summaryPl = oneLine(input.descriptionPl);
  const summaryEn = oneLine(input.descriptionEn);
  const lines: string[] = [`# ${oneLine(input.siteName)}`, "", `> ${summaryPl}`, ""];
  if (summaryEn && summaryEn !== summaryPl) lines.push(summaryEn, "");
  lines.push(
    "Języki / Languages: polski (domyślny, bez prefiksu URL), English (prefiks /en).",
    "",
    // Warunki stoją w bloku swobodnym, PRZED listami - patrz nagłówek pliku.
    LLMS_TXT_USAGE_TERMS_LABEL,
    "",
    ...usageTermsLines(input),
    "",
  );
  if (input.contactEmail?.trim()) {
    lines.push(`Kontakt / Contact: ${oneLine(input.contactEmail)}`, "");
  }

  // Jeden adres = jedna pozycja w całym przewodniku. „Wywiady" stały dotąd
  // i w sekcjach głównych, i w kategoriach - model dostawał ten sam adres
  // dwa razy, pod dwiema nazwami. Pierwsze wystąpienie wygrywa, więc sekcja
  // główna (kolejność redakcji) ma pierwszeństwo przed listą kategorii.
  const listed = new Set<string>();
  const once = <T extends { url: string }>(items: readonly T[] | undefined): T[] =>
    (items ?? []).filter((item) => {
      const key = linkUrl(item.url);
      if (listed.has(key)) return false;
      listed.add(key);
      return true;
    });
  const pushSection = (heading: string, items: readonly string[]): void => {
    if (items.length) lines.push(heading, "", ...items, "");
  };

  pushSection(
    "## Najważniejsze sekcje / Key sections",
    once(input.primarySections).map((section) => linkLine(section.name, section.url)),
  );
  pushSection("## Sekcje / Sections", once(input.sections).map(sectionLine));
  pushSection("## Organizacje / Organizations", once(input.organizations).map(sectionLine));
  pushSection("## Najnowsze artykuły (PL)", input.latestPl.map(articleLine));
  pushSection("## Latest articles (EN)", input.latestEn.map(articleLine));

  // Jedno źródło prawdy: rejestr MACHINE_SURFACES (patrz seo/machineSurfaces).
  // Twarda lista w tym pliku była powodem, dla którego nowe feedy (podcast,
  // relacje live) nie były ogłaszane modelom. Nagłówek stoi zawsze - sekcja
  // bez pozycji jest poprawna gramatycznie (pusta lista plików).
  lines.push(
    "## Zasoby maszynowe / Machine-readable resources",
    "",
    ...input.resources.map((resource) => linkLine(resource.label, resource.url)),
  );
  while (lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}
