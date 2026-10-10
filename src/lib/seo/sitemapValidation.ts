// WALIDATOR PLIKÓW MAPY STRONY - te same reguły, którymi Search Console ocenia
// sitemapę, liczone u nas, zanim zrobi to Google.
//
// PO CO. Kokpit SEO raportował „Mapa strony: OK - indeks: 6 plików sekcji",
// a w tym samym czasie Search Console pokazywał dla dwóch z tych sześciu
// plików błędy: `news-sitemap.xml` - „Brak tagu XML: url (wiersz 3)", bo
// dokument był PUSTYM `<urlset>` (schemat sitemaps.org wymaga co najmniej
// jednego `<url>`), a `sitemaps/core.xml` - „Ogólny błąd HTTP". Karta czytała
// wyłącznie indeks i liczyła w nim znaczniki `<sitemap>`, więc nie miała jak
// zobaczyć, że plik, na który indeks wskazuje, jest pusty albo nie odpowiada.
//
// CO SPRAWDZA (dla KAŻDEGO pliku osobno - indeksu i każdego pliku sekcji):
//   * odpowiedź: status 200, typ treści XML, niepuste ciało;
//   * poprawność XML: domknięte znaczniki, jeden korzeń, encje (`&` musi być
//     `&amp;`), zadeklarowane prefiksy przestrzeni nazw (`xhtml:`, `news:`);
//   * schemat sitemaps.org 0.9: korzeń `urlset` / `sitemapindex` z właściwą
//     przestrzenią nazw, CO NAJMNIEJ jeden `<url>` / `<sitemap>`, w każdym
//     dokładnie jeden `<loc>`, poprawne `lastmod` (W3C Datetime),
//     `changefreq`, `priority`;
//   * reguły Google: adres bezwzględny http(s) na hoście pliku, limit 50 000
//     adresów i 50 MB, duplikaty;
//   * Google News: komplet `news:publication` (`news:name`, `news:language`),
//     `news:publication_date`, `news:title`, limit 1000 wpisów, świeżość 48 h
//     metadanych (adres bez `news:news` - kotwica w dzień bez publikacji -
//     jest poprawny).
//
// Komunikat „brak tagu" niesie RODZICA, ZNACZNIK i NUMER WIERSZA - w tym samym
// kształcie, w jakim podaje go Search Console („Tag nadrzędny: urlset, Tag:
// url, Wiersz 3"), żeby redakcja mogła położyć oba raporty obok siebie.
//
// MODUŁ JEST CZYSTY: bez `fetch`, bez DOM (`DOMParser` nie istnieje w Workers
// i w części środowisk testowych). Parser niżej jest celowo minimalny - zna
// dokładnie tyle XML-a, ile mają sitemapy - i właśnie dlatego jest
// deterministyczny po obu stronach: kokpit sprawdza nim pliki na żywo, a testy
// jednostkowe przepuszczają przez niego WYJŚCIE naszych generatorów
// (`sitemapXml.ts`, `sitemapIndex.ts`, `newsSitemap.ts`).

/** Przestrzeń nazw protokołu sitemaps.org 0.9 - wymagana na korzeniu. */
export const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
/** Przestrzeń nazw rozszerzenia Google News. */
export const NEWS_SITEMAP_NS = "http://www.google.com/schemas/sitemap-news/0.9";

/** Twarde limity protokołu (sitemaps.org + Google). */
export const SITEMAP_MAX_ENTRIES = 50_000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
export const NEWS_SITEMAP_MAX_ARTICLES = 1_000;
/** Google News bierze pod uwagę artykuły z ostatnich dwóch dni. */
export const NEWS_FRESHNESS_MS = 48 * 60 * 60 * 1000;
/** Najdłuższy adres, jaki przyjmuje Google w `<loc>`. */
const MAX_LOC_LENGTH = 2048;

export type SitemapKind = "index" | "urlset" | "news" | "unknown";
export type SitemapIssueSeverity = "error" | "warning" | "info";
export type SitemapFileState = "ok" | "warn" | "fail";

export type SitemapIssueCode =
  /** Status HTTP inny niż 200 (0 = brak odpowiedzi). */
  | "http"
  /** Typ treści nie jest XML-em. */
  | "contentType"
  /** Puste ciało odpowiedzi. */
  | "emptyBody"
  /** Dokument nie jest poprawnym XML-em. */
  | "malformed"
  /** Korzeń nie jest `urlset` ani `sitemapindex`. */
  | "root"
  /** Korzeń bez przestrzeni nazw sitemaps.org 0.9. */
  | "namespace"
  /** Prefiks (`xhtml:`, `news:`) użyty bez deklaracji `xmlns:`. */
  | "undeclaredPrefix"
  /** Brak wymaganego znacznika (GSC: „Brak tagu XML"). */
  | "missingTag"
  /** Znacznik powtórzony tam, gdzie wolno mu wystąpić raz. */
  | "duplicateTag"
  /** `<loc>` nie jest bezwzględnym adresem http(s) albo jest za długi. */
  | "invalidLoc"
  /** `<loc>` na innym hoście niż sam plik (GSC: „Adres URL niedozwolony"). */
  | "foreignHost"
  /** `lastmod` / data publikacji poza formatem W3C Datetime. */
  | "invalidDate"
  /** `lastmod` w przyszłości. */
  | "futureDate"
  /** Wartość `changefreq` spoza słownika protokołu. */
  | "invalidChangefreq"
  /** `priority` spoza przedziału 0.0-1.0. */
  | "invalidPriority"
  /** Ponad 50 000 wpisów w jednym pliku. */
  | "tooManyEntries"
  /** Plik większy niż 50 MB. */
  | "tooLarge"
  /** Ten sam adres więcej niż raz. */
  | "duplicateLoc"
  /** Ponad 1000 artykułów w mapie Google News. */
  | "newsTooMany"
  /** Kod języka spoza ISO 639. */
  | "newsLanguage"
  /**
   * Metadane `news:news` przy artykule starszym niż 48 h - Google każe je po
   * dwóch dniach zdjąć (albo usunąć adres).
   */
  | "newsStale"
  /** Mapa News bez artykułu z okna 48 h - niesie kotwicę bez metadanych. */
  | "newsAnchor";

export interface SitemapIssue {
  code: SitemapIssueCode;
  severity: SitemapIssueSeverity;
  /** Wiersz pierwszego wystąpienia (1-indeksowany), jeśli dotyczy. */
  line?: number;
  /** Znacznik, którego dotyczy problem (np. brakujący `url`). */
  tag?: string;
  /** Znacznik nadrzędny (np. `urlset`). */
  parent?: string;
  /** Wartość, która nie przeszła (adres, data, status, komunikat parsera). */
  value?: string;
  /** Liczba wystąpień tego samego problemu w pliku. */
  count: number;
}

export interface SitemapFileReport {
  /** Adres pliku, tak jak go sprawdzano. */
  url: string;
  status: number;
  kind: SitemapKind;
  state: SitemapFileState;
  /** `<url>` w mapie albo `<sitemap>` w indeksie. */
  entries: number;
  /** Wpisy z `news:news` (0 poza mapą Google News). */
  newsEntries: number;
  /** Najnowszy `lastmod` (albo data publikacji News) w pliku. */
  newestLastmod: string | null;
  /** Rozmiar ciała w bajtach UTF-8. */
  bytes: number;
  /** Adresy plików wskazanych przez indeks (pusta lista poza indeksem). */
  children: string[];
  issues: SitemapIssue[];
}

export interface SitemapProbeInput {
  /** Adres pliku (bezwzględny albo ścieżka). */
  url: string;
  status: number;
  body: string;
  contentType?: string | null;
  /**
   * Host, na którym MUSZĄ leżeć adresy z pliku. Domyślnie host z `url`
   * (Google przyjmuje w sitemapie wyłącznie adresy z hosta, który ją podaje).
   */
  expectedHost?: string | null;
  /** Zegar dla testów. */
  now?: number;
}

// ---------------------------------------------------------------------------
// Minimalny parser XML
// ---------------------------------------------------------------------------

interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  line: number;
  endLine: number;
  children: XmlElement[];
  text: string;
  /** Prefiksy przestrzeni nazw widoczne w tym elemencie (z przodków też). */
  prefixes: ReadonlySet<string>;
}

interface ParseResult {
  root: XmlElement | null;
  error: { message: string; line: number } | null;
  undeclared: Array<{ prefix: string; line: number }>;
}

const NAME = "[A-Za-z_][\\w.:-]*";
// Wyrażenia „przyklejone" (`y`): dopasowanie zaczyna się DOKŁADNIE na
// `lastIndex`, więc parser nie kopiuje ogona dokumentu przy każdym znaczniku
// (plik sekcji ma ich setki tysięcy).
const OPEN_TAG = new RegExp(
  `<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"]*"|'[^']*'))*)\\s*(/?)>`,
  "y",
);
const CLOSE_TAG = new RegExp(`</(${NAME})\\s*>`, "y");
const ATTR = new RegExp(`(${NAME})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "g");
const ENTITY = /&(#\d+|#x[0-9a-fA-F]+|[A-Za-z][\w.-]*);/y;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function countNewlines(text: string, from: number, to: number): number {
  let lines = 0;
  for (let i = from; i < to; i += 1) if (text.charCodeAt(i) === 10) lines += 1;
  return lines;
}

/** Dekoduje encje; `null` = goły `&` albo nieznana encja (XML niepoprawny). */
function decodeEntities(raw: string): string | null {
  if (!raw.includes("&")) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const amp = raw.indexOf("&", i);
    if (amp === -1) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, amp);
    ENTITY.lastIndex = amp;
    const match = ENTITY.exec(raw);
    if (!match) return null;
    const body = match[1];
    if (body.startsWith("#")) {
      const code = body.startsWith("#x")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return null;
      out += String.fromCodePoint(code);
    } else if (body in NAMED_ENTITIES) out += NAMED_ENTITIES[body];
    else return null;
    i = amp + match[0].length;
  }
  return out;
}

function prefixOf(name: string): string | null {
  const colon = name.indexOf(":");
  return colon > 0 ? name.slice(0, colon) : null;
}

function parseXml(source: string): ParseResult {
  const undeclared: Array<{ prefix: string; line: number }> = [];
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let pos = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  const fail = (message: string): ParseResult => ({
    root: null,
    error: { message, line },
    undeclared,
  });
  const advance = (to: number) => {
    line += countNewlines(source, pos, to);
    pos = to;
  };

  while (pos < source.length) {
    const lt = source.indexOf("<", pos);
    const textEnd = lt === -1 ? source.length : lt;
    if (textEnd > pos) {
      const raw = source.slice(pos, textEnd);
      const current = stack[stack.length - 1];
      if (current) {
        const decoded = decodeEntities(raw);
        if (decoded === null) {
          advance(pos + raw.indexOf("&"));
          return fail("unescaped &");
        }
        current.text += decoded;
      } else if (raw.trim()) {
        advance(pos + raw.search(/\S/));
        return fail("text outside the root element");
      }
      advance(textEnd);
      if (lt === -1) break;
    }

    const rest = source.slice(pos, pos + 9);
    if (rest.startsWith("<?")) {
      const end = source.indexOf("?>", pos + 2);
      if (end === -1) return fail("unterminated processing instruction");
      advance(end + 2);
      continue;
    }
    if (rest.startsWith("<!--")) {
      const end = source.indexOf("-->", pos + 4);
      if (end === -1) return fail("unterminated comment");
      advance(end + 3);
      continue;
    }
    if (rest.startsWith("<![CDATA[")) {
      const end = source.indexOf("]]>", pos + 9);
      if (end === -1) return fail("unterminated CDATA section");
      const current = stack[stack.length - 1];
      if (!current) return fail("CDATA outside the root element");
      current.text += source.slice(pos + 9, end);
      advance(end + 3);
      continue;
    }
    if (rest.startsWith("<!")) {
      if (root || stack.length > 0) return fail("DOCTYPE inside the document");
      const end = source.indexOf(">", pos + 2);
      if (end === -1) return fail("unterminated DOCTYPE");
      advance(end + 1);
      continue;
    }

    CLOSE_TAG.lastIndex = pos;
    const close = CLOSE_TAG.exec(source);
    if (close) {
      const current = stack.pop();
      if (!current) return fail(`unexpected </${close[1]}>`);
      if (current.name !== close[1]) {
        return fail(`</${close[1]}> closes <${current.name}> opened on line ${current.line}`);
      }
      current.endLine = line;
      advance(pos + close[0].length);
      continue;
    }

    OPEN_TAG.lastIndex = pos;
    const open = OPEN_TAG.exec(source);
    if (!open) return fail("malformed tag");
    if (root && stack.length === 0) return fail(`second root element <${open[1]}>`);
    const attrs: Record<string, string> = {};
    for (const attr of open[2].matchAll(ATTR)) {
      const value = decodeEntities(attr[2] ?? attr[3] ?? "");
      if (value === null) return fail(`unescaped & in attribute ${attr[1]}`);
      if (attr[1] in attrs) return fail(`duplicate attribute ${attr[1]}`);
      attrs[attr[1]] = value;
    }
    const parent = stack[stack.length - 1];
    let prefixes: ReadonlySet<string> = parent?.prefixes ?? new Set(["xml"]);
    const declared = Object.keys(attrs)
      .filter((key) => key.startsWith("xmlns:"))
      .map((key) => key.slice("xmlns:".length));
    if (declared.length > 0) prefixes = new Set([...prefixes, ...declared]);
    const element: XmlElement = {
      name: open[1],
      attrs,
      line,
      endLine: line,
      children: [],
      text: "",
      prefixes,
    };
    for (const name of [element.name, ...Object.keys(attrs)]) {
      const prefix = prefixOf(name);
      if (prefix && prefix !== "xmlns" && !prefixes.has(prefix)) {
        undeclared.push({ prefix, line });
      }
    }
    if (parent) parent.children.push(element);
    else root = element;
    if (open[3] !== "/") stack.push(element);
    advance(pos + open[0].length);
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return fail(`<${unclosed.name}> opened on line ${unclosed.line} is never closed`);
  }
  if (!root) return fail("no root element");
  return { root, error: null, undeclared };
}

/**
 * Czy dokument jest poprawnym XML-em (domknięte znaczniki, encje, jeden
 * korzeń, zadeklarowane prefiksy). Ten sam parser, którym walidator czyta
 * pliki mapy - używany też przez test arkusza XSL.
 */
export function checkXmlWellFormed(
  source: string,
): { ok: true } | { ok: false; message: string; line: number } {
  const parsed = parseXml(source);
  if (parsed.error) return { ok: false, ...parsed.error };
  const undeclared = parsed.undeclared[0];
  if (undeclared) {
    return { ok: false, message: `undeclared prefix ${undeclared.prefix}`, line: undeclared.line };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reguły
// ---------------------------------------------------------------------------

/** W3C Datetime (profil ISO 8601 używany przez sitemaps.org i Google). */
const W3C_DATETIME =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

/** Czy wartość jest poprawną datą W3C Datetime (z realnym dniem i godziną). */
export function isW3cDatetime(value: string): boolean {
  const match = W3C_DATETIME.exec(value);
  if (!match) return false;
  const [, , month, day, hour, minute, second] = match;
  if (month !== undefined && (Number(month) < 1 || Number(month) > 12)) return false;
  if (day !== undefined) {
    const parsed = new Date(`${match[1]}-${month}-${day}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== Number(day)) return false;
  }
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59)) return false;
  if (second !== undefined && Number(second) > 59) return false;
  return true;
}

const CHANGEFREQ = new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]);
/** ISO 639-1/639-2 (2-3 litery) plus dwa warianty chińskiego, które Google wymienia wprost. */
const NEWS_LANGUAGE = /^(?:[a-z]{2,3}|zh-cn|zh-tw)$/;

function utf8Length(text: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Zbiera problemy, łącząc powtórzenia tego samego problemu w jeden wpis z licznikiem. */
class IssueLog {
  private readonly byKey = new Map<string, SitemapIssue>();

  add(issue: Omit<SitemapIssue, "count">): void {
    const key = `${issue.code}|${issue.tag ?? ""}|${issue.parent ?? ""}`;
    const existing = this.byKey.get(key);
    if (existing) existing.count += 1;
    else this.byKey.set(key, { ...issue, count: 1 });
  }

  list(): SitemapIssue[] {
    const rank: Record<SitemapIssueSeverity, number> = { error: 0, warning: 1, info: 2 };
    return [...this.byKey.values()].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }
}

function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** Jeden wymagany, niepowtarzalny element-dziecko. */
function requireSingle(parent: XmlElement, name: string, log: IssueLog): XmlElement | null {
  const found = childrenNamed(parent, name);
  if (found.length === 0) {
    log.add({
      code: "missingTag",
      severity: "error",
      tag: name,
      parent: parent.name,
      line: parent.endLine,
    });
    return null;
  }
  if (found.length > 1) {
    log.add({
      code: "duplicateTag",
      severity: "error",
      tag: name,
      parent: parent.name,
      line: found[1].line,
    });
  }
  return found[0];
}

interface EntryContext {
  log: IssueLog;
  expectedHost: string | null;
  now: number;
  seen: Set<string>;
  newest: { value: string | null; at: number };
}

function noteNewest(ctx: EntryContext, value: string): void {
  const at = Date.parse(value.length === 4 ? `${value}-01-01` : value);
  if (Number.isNaN(at)) return;
  if (ctx.newest.value === null || at > ctx.newest.at) {
    ctx.newest.value = value;
    ctx.newest.at = at;
  }
}

function checkDate(element: XmlElement, ctx: EntryContext): string | null {
  const value = element.text.trim();
  if (!isW3cDatetime(value)) {
    ctx.log.add({
      code: "invalidDate",
      severity: "error",
      tag: element.name,
      line: element.line,
      value,
    });
    return null;
  }
  const at = Date.parse(value.length === 4 ? `${value}-01-01` : value);
  // Dzień zapasu na strefy czasowe: data bez godziny to północ UTC, a wpis
  // opublikowany wieczorem w Warszawie ma już „jutrzejszą" datę w UTC-ach.
  if (!Number.isNaN(at) && at > ctx.now + 24 * 60 * 60 * 1000) {
    ctx.log.add({
      code: "futureDate",
      severity: "warning",
      tag: element.name,
      line: element.line,
      value,
    });
  }
  return value;
}

function checkLoc(locEl: XmlElement, ctx: EntryContext): string | null {
  const loc = locEl.text.trim();
  const host = hostOf(loc);
  if (!loc || !host || !/^https?:\/\//i.test(loc) || loc.length > MAX_LOC_LENGTH) {
    ctx.log.add({ code: "invalidLoc", severity: "error", line: locEl.line, value: loc });
    return null;
  }
  if (ctx.expectedHost && host !== ctx.expectedHost) {
    ctx.log.add({ code: "foreignHost", severity: "error", line: locEl.line, value: loc });
  }
  if (ctx.seen.has(loc)) {
    ctx.log.add({ code: "duplicateLoc", severity: "warning", line: locEl.line, value: loc });
  }
  ctx.seen.add(loc);
  return loc;
}

/** Wpis Google News - zwraca datę publikacji (do oceny świeżości) albo null. */
function checkNewsBlock(news: XmlElement, ctx: EntryContext): string | null {
  const publication = requireSingle(news, "news:publication", ctx.log);
  if (publication) {
    const name = requireSingle(publication, "news:name", ctx.log);
    if (name && !name.text.trim()) {
      ctx.log.add({
        code: "missingTag",
        severity: "error",
        tag: "news:name",
        parent: "news:publication",
        line: name.line,
      });
    }
    const language = requireSingle(publication, "news:language", ctx.log);
    if (language && !NEWS_LANGUAGE.test(language.text.trim())) {
      ctx.log.add({
        code: "newsLanguage",
        severity: "error",
        tag: "news:language",
        line: language.line,
        value: language.text.trim(),
      });
    }
  }
  const title = requireSingle(news, "news:title", ctx.log);
  if (title && !title.text.trim()) {
    ctx.log.add({
      code: "missingTag",
      severity: "error",
      tag: "news:title",
      parent: "news:news",
      line: title.line,
    });
  }
  const date = requireSingle(news, "news:publication_date", ctx.log);
  return date ? checkDate(date, ctx) : null;
}

function emptyReport(input: SitemapProbeInput, bytes: number): SitemapFileReport {
  return {
    url: input.url,
    status: input.status,
    kind: "unknown",
    state: "fail",
    entries: 0,
    newsEntries: 0,
    newestLastmod: null,
    bytes,
    children: [],
    issues: [],
  };
}

function stateOf(issues: readonly SitemapIssue[]): SitemapFileState {
  if (issues.some((issue) => issue.severity === "error")) return "fail";
  if (issues.some((issue) => issue.severity === "warning")) return "warn";
  return "ok";
}

/**
 * Pełna ocena JEDNEGO pliku mapy strony - indeksu, mapy adresów albo mapy
 * Google News. Nigdy nie rzuca: każdy problem (także brak odpowiedzi) jest
 * wpisem w `issues`, a `state` to najcięższy z nich.
 */
export function validateSitemapDocument(input: SitemapProbeInput): SitemapFileReport {
  const body = input.body ?? "";
  const bytes = utf8Length(body);
  const report = emptyReport(input, bytes);
  const log = new IssueLog();
  const finish = (): SitemapFileReport => {
    report.issues = log.list();
    report.state = stateOf(report.issues);
    return report;
  };

  if (input.status !== 200) {
    log.add({ code: "http", severity: "error", value: String(input.status) });
    return finish();
  }
  if (!body.trim()) {
    log.add({ code: "emptyBody", severity: "error" });
    return finish();
  }
  const contentType = (input.contentType ?? "").toLowerCase();
  if (contentType && !contentType.includes("xml")) {
    log.add({ code: "contentType", severity: "warning", value: input.contentType ?? "" });
  }
  if (bytes > SITEMAP_MAX_BYTES) {
    log.add({ code: "tooLarge", severity: "error", value: String(bytes) });
  }

  const parsed = parseXml(body);
  if (parsed.error || !parsed.root) {
    log.add({
      code: "malformed",
      severity: "error",
      line: parsed.error?.line,
      value: parsed.error?.message,
    });
    return finish();
  }
  for (const { prefix, line } of parsed.undeclared) {
    log.add({ code: "undeclaredPrefix", severity: "error", line, value: prefix });
  }

  const root = parsed.root;
  if (root.name !== "urlset" && root.name !== "sitemapindex") {
    log.add({ code: "root", severity: "error", line: root.line, value: root.name });
    return finish();
  }
  if (root.attrs.xmlns !== SITEMAP_NS) {
    log.add({
      code: "namespace",
      severity: "error",
      line: root.line,
      value: root.attrs.xmlns ?? "",
    });
  }

  let expectedHost = input.expectedHost?.toLowerCase() ?? null;
  if (expectedHost === null) expectedHost = hostOf(input.url);
  const ctx: EntryContext = {
    log,
    expectedHost,
    now: input.now ?? Date.now(),
    seen: new Set(),
    newest: { value: null, at: Number.NEGATIVE_INFINITY },
  };

  if (root.name === "sitemapindex") {
    report.kind = "index";
    const sitemaps = childrenNamed(root, "sitemap");
    report.entries = sitemaps.length;
    if (sitemaps.length === 0) {
      log.add({
        code: "missingTag",
        severity: "error",
        tag: "sitemap",
        parent: "sitemapindex",
        line: root.endLine,
      });
    }
    for (const sitemap of sitemaps) {
      const locEl = requireSingle(sitemap, "loc", log);
      const loc = locEl ? checkLoc(locEl, ctx) : null;
      if (loc) report.children.push(loc);
      const lastmod = childrenNamed(sitemap, "lastmod")[0];
      if (lastmod) {
        const value = checkDate(lastmod, ctx);
        if (value) noteNewest(ctx, value);
      }
    }
  } else {
    const declaresNews = root.attrs["xmlns:news"] === NEWS_SITEMAP_NS;
    const urls = childrenNamed(root, "url");
    report.entries = urls.length;
    if (urls.length === 0) {
      log.add({
        code: "missingTag",
        severity: "error",
        tag: "url",
        parent: "urlset",
        line: root.endLine,
      });
    }
    let newestPublication = Number.NEGATIVE_INFINITY;
    for (const url of urls) {
      const locEl = requireSingle(url, "loc", log);
      if (locEl) checkLoc(locEl, ctx);
      const lastmod = childrenNamed(url, "lastmod")[0];
      if (lastmod) {
        const value = checkDate(lastmod, ctx);
        if (value) noteNewest(ctx, value);
      }
      const changefreq = childrenNamed(url, "changefreq")[0];
      if (changefreq && !CHANGEFREQ.has(changefreq.text.trim())) {
        log.add({
          code: "invalidChangefreq",
          severity: "warning",
          line: changefreq.line,
          value: changefreq.text.trim(),
        });
      }
      const priority = childrenNamed(url, "priority")[0];
      if (priority) {
        const raw = priority.text.trim();
        const value = Number(raw);
        if (!/^\d(?:\.\d+)?$/.test(raw) || value < 0 || value > 1) {
          log.add({
            code: "invalidPriority",
            severity: "warning",
            line: priority.line,
            value: raw,
          });
        }
      }
      for (const link of childrenNamed(url, "xhtml:link")) {
        const href = link.attrs.href ?? "";
        if (!link.attrs.hreflang || !hostOf(href)) {
          log.add({ code: "invalidLoc", severity: "error", line: link.line, value: href });
        }
      }
      const news = childrenNamed(url, "news:news");
      if (news.length > 0) {
        report.newsEntries += 1;
        const published = checkNewsBlock(news[0], ctx);
        if (published) {
          noteNewest(ctx, published);
          const at = Date.parse(published);
          if (!Number.isNaN(at)) newestPublication = Math.max(newestPublication, at);
        }
      }
      // `<url>` BEZ `news:news` w mapie News jest poprawny: to druga droga,
      // którą Google podaje dla artykułów starszych niż dwa dni („remove the
      // <news:news> metadata... from the older URLs").
    }
    report.kind = declaresNews || report.newsEntries > 0 ? "news" : "urlset";
    if (report.kind === "news") {
      if (report.newsEntries > NEWS_SITEMAP_MAX_ARTICLES) {
        log.add({
          code: "newsTooMany",
          severity: "error",
          value: String(report.newsEntries),
        });
      }
      if (Number.isFinite(newestPublication) && ctx.now - newestPublication > NEWS_FRESHNESS_MS) {
        log.add({ code: "newsStale", severity: "warning", value: ctx.newest.value ?? "" });
      }
      if (report.newsEntries === 0 && report.entries > 0) {
        log.add({ code: "newsAnchor", severity: "info", value: ctx.newest.value ?? "" });
      }
    }
  }

  if (report.entries > SITEMAP_MAX_ENTRIES) {
    log.add({ code: "tooManyEntries", severity: "error", value: String(report.entries) });
  }
  report.newestLastmod = ctx.newest.value;
  return finish();
}

/** Najcięższy stan z listy raportów. */
export function worstSitemapState(reports: readonly SitemapFileReport[]): SitemapFileState {
  if (reports.some((report) => report.state === "fail")) return "fail";
  if (reports.some((report) => report.state === "warn")) return "warn";
  return "ok";
}

/**
 * Ścieżka pliku wskazanego przez indeks - kokpit pobiera pliki sekcji
 * względem originu, który sonduje, a nie pod adresem z indeksu (ten jest
 * zawsze na originie kanonicznym, także gdy panel działa na hoście podglądu).
 */
export function sitemapChildPath(loc: string): string | null {
  try {
    const url = new URL(loc);
    return `${url.pathname}${url.search}`;
  } catch {
    return loc.startsWith("/") ? loc : null;
  }
}
