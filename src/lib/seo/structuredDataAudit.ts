// Audyt JSON-LD tymi samymi regułami, których Search Console używa dla wyniku
// z okruszkami (https://developers.google.com/search/docs/appearance/structured-data/breadcrumb).
//
// PO CO OSOBNY MODUŁ, SKORO `breadcrumbListJsonLd` JUŻ GWARANTUJE `item`.
// Builder pilnuje grafów, które przez niego przechodzą. Błąd z października
// 2026 („Brakujące pole item (w itemListElement)" na 10 adresach
// /organization/*) i zepsute adresy `https://host/https://host/blog` powstały
// w TRASACH - w argumentach buildera i w ręcznie sklejanych węzłach obok niego.
// Ten moduł sprawdza GOTOWY dokument: wynik `head()` w testach, HTML z serwera
// w e2e i produkcję w `scripts/seo/check-structured-data.ts`.
//
// BEZ IMPORTÓW I BEZ SKŁADNI SPOZA „type stripping": skrypt uruchamia ten plik
// gołym `node` (jak `scripts/performance/*`), bez bundlera i aliasu `@/`.

/** Jedna niezgodność z wymaganiami Google, z adresem węzła w grafie. */
export interface StructuredDataIssue {
  /** Ścieżka w grafie, np. `$[1].itemListElement[2]`. */
  path: string;
  message: string;
}

/** Pole adresowe, w którym origin został doklejony do pełnego adresu. */
const DOUBLED_ORIGIN = /^https?:\/\/[^?#]*?https?:/i;
const ABSOLUTE_HTTP_URL = /^https?:\/\/[^/?#\s]+/i;
const URL_KEYS = new Set(["@id", "url", "item"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node["@type"];
  return t === type || (Array.isArray(t) && t.includes(type));
}

/** Adres pozycji okruszków: tekst albo węzeł `Thing` z `@id`/`url`. */
function listItemUrl(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (isRecord(item)) {
    const ref = item["@id"] ?? item.url;
    return typeof ref === "string" ? ref : null;
  }
  return null;
}

function breadcrumbIssues(
  node: Record<string, unknown>,
  path: string,
  issues: StructuredDataIssue[],
): void {
  const elements = node.itemListElement;
  if (!Array.isArray(elements)) {
    issues.push({ path, message: "Brakujące pole „itemListElement”" });
    return;
  }
  if (elements.length < 2) {
    issues.push({
      path: `${path}.itemListElement`,
      message: `BreadcrumbList wymaga co najmniej dwóch ListItem (jest ${elements.length})`,
    });
  }
  elements.forEach((el, i) => {
    const at = `${path}.itemListElement[${i}]`;
    if (!isRecord(el)) {
      issues.push({ path: at, message: "Pozycja okruszków nie jest obiektem ListItem" });
      return;
    }
    if (!hasType(el, "ListItem")) {
      issues.push({ path: at, message: "Pozycja okruszków nie ma typu „ListItem”" });
    }
    if (el.position !== i + 1) {
      issues.push({
        path: `${at}.position`,
        message: `Pozycja ${JSON.stringify(el.position)} zamiast ${i + 1} - numeracja od 1 bez dziur`,
      });
    }
    const named =
      (typeof el.name === "string" && el.name.trim() !== "") ||
      (isRecord(el.item) && typeof el.item.name === "string" && el.item.name.trim() !== "");
    if (!named) issues.push({ path: `${at}.name`, message: "Brakujące pole „name”" });
    // Google dopuszcza brak `item` na ostatniej pozycji, ale Search Console
    // i tak zgłaszał go jako błąd krytyczny - kontrakt serwisu jest ostrzejszy
    // niż dokumentacja: `item` na KAŻDEJ pozycji.
    const url = listItemUrl(el.item);
    if (url === null) {
      issues.push({
        path: `${at}.item`,
        message: "Brakujące pole „item” (w „itemListElement”)",
      });
    } else if (!ABSOLUTE_HTTP_URL.test(url)) {
      issues.push({
        path: `${at}.item`,
        message: `„item” nie jest absolutnym adresem http(s): ${JSON.stringify(url)}`,
      });
    }
  });
}

function walk(value: unknown, path: string, issues: StructuredDataIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, i) => walk(child, `${path}[${i}]`, issues));
    return;
  }
  if (!isRecord(value)) return;
  if (hasType(value, "BreadcrumbList")) breadcrumbIssues(value, path, issues);
  for (const [key, child] of Object.entries(value)) {
    if (URL_KEYS.has(key) && typeof child === "string" && DOUBLED_ORIGIN.test(child)) {
      issues.push({
        path: `${path}.${key}`,
        message: `Adres z podwójnym originem: ${JSON.stringify(child)}`,
      });
    }
    walk(child, `${path}.${key}`, issues);
  }
}

/**
 * Niezgodności w jednym lub kilku grafach JSON-LD (np. wszystkie bloki
 * `<script type="application/ld+json">` jednej strony jako tablica).
 * Pusta tablica = graf spełnia kontrakt.
 */
export function structuredDataIssues(graphs: unknown): StructuredDataIssue[] {
  const issues: StructuredDataIssue[] = [];
  walk(graphs, "$", issues);
  return issues;
}

/** Wszystkie węzły danego typu - do asercji „strona w ogóle emituje X". */
export function findJsonLdNodes(graphs: unknown, type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (hasType(value, type)) found.push(value);
    Object.values(value).forEach(visit);
  };
  visit(graphs);
  return found;
}

const LD_JSON_SCRIPT =
  /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * Bloki JSON-LD wyjęte z HTML-a. Blok, który się nie parsuje, jest
 * niezgodnością (Search Console: „Nieprawidłowy obiekt"), a nie ciszą.
 */
export function extractJsonLd(html: string): { graphs: unknown[]; issues: StructuredDataIssue[] } {
  const graphs: unknown[] = [];
  const issues: StructuredDataIssue[] = [];
  let index = 0;
  for (const match of html.matchAll(LD_JSON_SCRIPT)) {
    try {
      graphs.push(JSON.parse(match[1] ?? ""));
    } catch (error) {
      issues.push({
        path: `script[${index}]`,
        message: `JSON-LD się nie parsuje: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    index += 1;
  }
  return { graphs, issues };
}
