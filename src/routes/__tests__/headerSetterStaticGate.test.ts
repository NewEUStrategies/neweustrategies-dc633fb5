// STATYCZNA BRAMKA SERWERA PRZY NAGŁÓWKACH TRAS - zapadka (roadmapa ładowania
// 2026-11-14, sekcja 9.1, pozycja J1).
//
// CO TU JEST ZAPISANE. `setCacheControlHeader` i `appendLinkHeader` są
// w przeglądarce pustymi funkcjami (`createIsomorphicFn`), ale JavaScript liczy
// argument wywołania, zanim wejdzie do funkcji. Wywołanie
// `setCacheControlHeader(resilientCacheControl(degraded))` trzymało więc
// w bundlu klienta wszystkie czyste buildery polityki cache'u i wartości
// `Link` - także w chunku startowym - i wykonywało je przy każdej nawigacji.
// Każde wywołanie w `src/routes` stoi dlatego za warunkiem
// `import.meta.env.SSR || import.meta.env.DEV`: Vite podmienia go na stałą
// w czasie transformacji, więc w produkcyjnym bundlu przeglądarki wywołanie
// znika RAZEM Z ARGUMENTEM, a na serwerze i w dev kod biegnie jak dotąd.
//
// PO CO ZAPADKA. Bo regres jest cichy z obu stron:
//   * JEDNO wywołanie bez bramki przywraca buildery do chunku startowego
//     (bramka `overall` w `check:bundle` stoi 0,3 KB pod progiem) - a żaden
//     test zachowania tego nie zauważy, bo w przeglądarce to pusta funkcja;
//   * bramka o INNYM zapisie (stała z innego modułu, `!import.meta.env.SSR`
//     po złej stronie, gałąź `else`) mogłaby wyciąć nagłówek NA SERWERZE -
//     a wtedy prywatny albo zdegradowany dokument dostaje domyślną politykę
//     publiczną i zamarza na brzegu.
// Pierwsza część pliku pilnuje zapisu w źródłach, druga wykonuje loadery pod
// stałymi BUILDU PRODUKCYJNEGO (testy zachowania tras biegną pod vitestem,
// gdzie `DEV` jest prawdą, więc o tej kombinacji nie mówią nic).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";

const h = vi.hoisted(() => ({
  /** Nagłówki, jakie loadery ustawiły na odpowiedzi. */
  cacheControl: [] as string[],
  linkHeaders: [] as string[],
  /** Mapa `site_settings` widziana przez bramkę modułu Q&A. */
  settings: {} as Record<string, unknown>,
  settingsThrow: false,
  seriesThrows: false,
  series: null as Record<string, unknown> | null,
  qaSessionsThrow: false,
  qaSessions: [] as Record<string, unknown>[],
  qaSessionThrows: false,
  qaSession: null as Record<string, unknown> | null,
  qaQuestionsThrow: false,
  /** Oferta cennika i zapisu: jeden przełącznik awarii katalogu planów. */
  plansThrow: false,
  /** Historia `/web-stories/$slug` i karta klubu `/club/$clubSlug`. */
  story: null as Record<string, unknown> | null,
  storyThrows: false,
  club: null as Record<string, unknown> | null,
  clubThrows: false,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  readRouteCacheDirective: () => null,
  // Pod stałą `SSR` builda serwera `loadResilient` zgłasza etykietę degradacji.
  noteDocumentDegradation: () => {},
}));

// ── GRANICE DANYCH ─────────────────────────────────────────────────────────
// Atrapy CZĄSTKOWE (doktryna `degradedLoaderContracts.test.ts`): podmienione
// są wyłącznie fabryki, które woła loader; klucze i selektory biegną prawdziwe.
vi.mock("@/lib/useSiteSetting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useSiteSetting")>()),
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"] as const,
    queryFn: () =>
      h.settingsThrow
        ? Promise.reject(new Error("test: ustawienia niedostępne"))
        : Promise.resolve(h.settings),
  },
}));

vi.mock("@/lib/queries/series", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/series")>()),
  seriesPageQueryOptions: (slug: string) => ({
    queryKey: ["public", "series-page", slug] as const,
    queryFn: async () => {
      if (h.seriesThrows) throw new Error("test: baza cykli niedostępna");
      return h.series;
    },
  }),
}));

vi.mock("@/lib/community/publicQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/community/publicQueries")>()),
  publicQaSessionsQueryOptions: () => ({
    queryKey: ["public-qa-sessions"],
    queryFn: async () => {
      if (h.qaSessionsThrow) throw new Error("test: lista sesji niedostępna");
      return h.qaSessions;
    },
  }),
  publicQaSessionQueryOptions: (slug: string) => ({
    queryKey: ["public-qa-session", slug],
    queryFn: async () => {
      if (h.qaSessionThrows) throw new Error("test: sesja niedostępna");
      return h.qaSession;
    },
  }),
  publicQaQuestionsQueryOptions: (sessionId: string) => ({
    queryKey: ["public-qa-questions", sessionId],
    queryFn: async () => {
      if (h.qaQuestionsThrow) throw new Error("test: pytania niedostępne");
      return [];
    },
  }),
}));

vi.mock("@/lib/queries/staticPageSeo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/staticPageSeo")>()),
  staticPageSeoQueryOptions: (slug: string) => ({
    queryKey: ["static-page-seo", slug],
    queryFn: async () => null,
  }),
}));

vi.mock("@/lib/pricing/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pricing/queries")>()),
  pricingAudiencesQueryOptions: () => ({
    queryKey: ["test", "pricing-audiences"],
    queryFn: async () => [],
  }),
  pricingFaqQueryOptions: () => ({
    queryKey: ["test", "pricing-faq"],
    queryFn: async () => [],
  }),
}));

vi.mock("@/lib/billing/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/queries")>()),
  fetchActivePlans: async () => {
    if (h.plansThrow) throw new Error("test: katalog planów niedostępny");
    return [];
  },
}));

vi.mock("@/lib/queries/webStories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/webStories")>()),
  webStoryBySlugQueryOptions: (slug: string) => ({
    queryKey: ["web-stories", "slug", slug] as const,
    queryFn: async () => {
      if (h.storyThrows) throw new Error("test: baza historii niedostępna");
      return h.story;
    },
  }),
}));

vi.mock("@/lib/clubs/publicClub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clubs/publicClub")>()),
  fetchClubBySlug: async () => {
    if (h.clubThrows) throw new Error("test: karta klubu niedostępna");
    return h.club;
  },
}));

vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  fetchMembershipTiers: async () => [],
}));

import { QueryClient } from "@tanstack/react-query";
import { COMMUNITY_MODULES_DEFAULTS, COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { Route as MembershipJoinRoute } from "@/routes/membership-join";
import { Route as PricingRoute } from "@/routes/pricing";
import { Route as QaListRoute } from "@/routes/qa";
import { Route as QaSessionRoute } from "@/routes/qa.$slug";
import { Route as SeriesRoute } from "@/routes/series.$slug";
import { Route as ClubLayoutRoute } from "@/routes/club.$clubSlug";
import { Route as WebStoryRoute } from "@/routes/web-stories.$slug";

// ── CZĘŚĆ 1: ZAPIS W ŹRÓDŁACH ──────────────────────────────────────────────

const ROUTES_DIR = join(process.cwd(), "src/routes");
const SETTERS = new Set(["setCacheControlHeader", "appendLinkHeader"]);
/** Jedyny dopuszczony zapis bramki - dokładnie ten, który Vite zwija do stałej. */
const STATIC_SERVER_GATE = "import.meta.env.SSR || import.meta.env.DEV";

function routeSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") routeSourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Skrajnie lewy operand łańcucha `&&`, bez nawiasów. */
function leftmostConjunct(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      current = current.left;
      continue;
    }
    return current;
  }
}

/**
 * Czy węzeł leży w gałęzi PRAWDY instrukcji `if`, której warunek ZACZYNA SIĘ
 * od bramki. Lewy skraj łańcucha `&&`, bo tylko wtedy reszta warunku nie
 * liczy się w przeglądarce; gałąź `else` się nie liczy, bo na serwerze
 * (bramka prawdziwa) nigdy by się nie wykonała.
 */
function behindStaticServerGate(node: ts.Node, source: ts.SourceFile): boolean {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (!ts.isIfStatement(parent) || parent.thenStatement !== child) continue;
    const head = leftmostConjunct(parent.expression).getText(source).replace(/\s+/g, " ");
    if (head === STATIC_SERVER_GATE) return true;
  }
  return false;
}

interface SetterCall {
  readonly where: string;
  readonly gated: boolean;
}

function setterCalls(fileName: string, text: string): SetterCall[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls: SetterCall[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      SETTERS.has(node.expression.text)
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      calls.push({ where: `${fileName}:${line}`, gated: behindStaticServerGate(node, source) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** Instrukcje `if (bramka …)`, w których gałęzi prawdy stoi wywołanie settera. */
function gatedSetterIfs(source: ts.SourceFile): ts.IfStatement[] {
  const ifs: ts.IfStatement[] = [];
  const containsSetter = (node: ts.Node): boolean =>
    (ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      SETTERS.has(node.expression.text)) ||
    (ts.forEachChild(node, (child) => containsSetter(child) || undefined) ?? false);
  const visit = (node: ts.Node): void => {
    if (
      ts.isIfStatement(node) &&
      leftmostConjunct(node.expression).getText(source).replace(/\s+/g, " ") ===
        STATIC_SERVER_GATE &&
      containsSetter(node.thenStatement)
    ) {
      ifs.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return ifs;
}

/** Czy wyrażenie zaczyna się od bramki: `bramka && x` albo `bramka && x ? a : b`. */
function startsWithGate(expression: ts.Expression, source: ts.SourceFile): boolean {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  const condition = ts.isConditionalExpression(node) ? node.condition : node;
  return leftmostConjunct(condition).getText(source).replace(/\s+/g, " ") === STATIC_SERVER_GATE;
}

/** Czy w wyrażeniu (poza funkcjami zagnieżdżonymi) jest węzeł spełniający `test`. */
function containsOutsideFunctions(node: ts.Node, test: (node: ts.Node) => boolean): boolean {
  if (test(node)) return true;
  if (ts.isFunctionLike(node)) return false;
  return (
    ts.forEachChild(node, (child) => containsOutsideFunctions(child, test) || undefined) ?? false
  );
}

/**
 * Inicjalizator, którego reguła nie rusza: bez żadnego wywołania (literał,
 * odczyt pola - nic do liczenia), funkcja (sama wartość funkcji niczego nie
 * liczy), wywołanie oznaczone `@__PURE__` (bundler usuwa je razem
 * z nieużywaną stałą), wyrażenie zaczynające się od bramki - oraz `await`:
 * odczyt danych ma skutki (zasiew cache'u, z którego czyta komponent), więc
 * zostaje także w przeglądarce, nawet gdy jego WYNIK czyta tylko nagłówek.
 */
function exemptInitializer(init: ts.Expression, source: ts.SourceFile): boolean {
  let node = init;
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) node = node.expression;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  if (containsOutsideFunctions(node, ts.isAwaitExpression)) return true;
  const computes = containsOutsideFunctions(
    node,
    (n) => ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n),
  );
  if (!computes) return true;
  if (/[@#]__PURE__/.test(source.text.slice(init.pos, init.getStart(source)))) return true;
  return startsWithGate(node, source);
}

/**
 * Zmienne liczone POZA bramką, choć czyta je WYŁĄCZNIE kod za bramką (warunek
 * `if (bramka && x)` albo argument settera w jego gałęzi). Bramka zdejmuje
 * z bundla przeglądarki samo wywołanie, a deklaracja przed nią zostaje: wartość
 * nagłówka (np. deskryptor preloadu `Link`) liczy się wtedy przy każdej
 * nawigacji, a jej moduły jadą w chunku trasy. Deklaracja należy do gałęzi
 * bramki - na serwerze wartość jest ta sama, bo bramka jest tam prawdą.
 */
function valuesComputedOutsideGate(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const gated = gatedSetterIfs(source);
  if (gated.length === 0) return [];
  // Części, których przeglądarka nie liczy: warunek i gałąź prawdy `if`
  // z setterem oraz reszta wyrażenia zaczynającego się od bramki (bez gałęzi
  // `: b` - ta liczy się właśnie wtedy, gdy bramka jest fałszem).
  const ranges: Array<readonly [number, number]> = gated.map(
    (stmt) => [stmt.expression.pos, stmt.thenStatement.end] as const,
  );
  const collectGateLed = (node: ts.Node): void => {
    if (ts.isConditionalExpression(node) && startsWithGate(node, source)) {
      ranges.push([node.condition.pos, node.whenTrue.end]);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      startsWithGate(node, source)
    ) {
      ranges.push([node.pos, node.end]);
    }
    ts.forEachChild(node, collectGateLed);
  };
  collectGateLed(source);
  const inGate = (node: ts.Node): boolean =>
    ranges.some(([start, end]) => node.pos >= start && node.end <= end);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      !exemptInitializer(node.initializer, source) &&
      !inGate(node)
    ) {
      const name = node.name.text;
      const scope = ts.isVariableDeclarationList(node.parent) ? node.parent.parent.parent : source;
      const refs: ts.Identifier[] = [];
      const collect = (child: ts.Node): void => {
        if (
          ts.isIdentifier(child) &&
          child.text === name &&
          child !== node.name &&
          !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) &&
          !(ts.isPropertyAssignment(child.parent) && child.parent.name === child)
        ) {
          refs.push(child);
        }
        ts.forEachChild(child, collect);
      };
      collect(scope);
      if (refs.length > 0 && refs.every(inGate)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push(`${fileName}:${line} ${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("nagłówki tras - statyczna bramka serwera w źródłach", () => {
  it("każde wywołanie settera w src/routes stoi za `import.meta.env.SSR || import.meta.env.DEV`", () => {
    const calls = routeSourceFiles(ROUTES_DIR).flatMap((path) =>
      setterCalls(relative(process.cwd(), path), readFileSync(path, "utf8")),
    );
    expect(calls.filter((call) => !call.gated).map((call) => call.where)).toEqual([]);
    // Kontrola, że skan cokolwiek zmierzył: w chwili wprowadzenia zapadki
    // tras z nagłówkami było 53, a wywołań 92.
    expect(calls.length).toBeGreaterThan(80);
    expect(new Set(calls.map((call) => call.where.split(":")[0])).size).toBeGreaterThan(45);
  });

  it("wejście settera (np. deskryptor preloadu `Link`) liczy się ZA bramką, nie przed nią", () => {
    // Roadmapa §9.5 (J1, reszta): `web-stories.$slug` i układ klubu liczyły
    // deskryptor preloadu okładki w przeglądarce, choć czytał go tylko
    // `appendLinkHeader` za bramką.
    const found = routeSourceFiles(ROUTES_DIR).flatMap((path) =>
      valuesComputedOutsideGate(relative(process.cwd(), path), readFileSync(path, "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("detektor wejścia settera: wartość tylko dla nagłówka - czerwono; używana też poza bramką - zielono", () => {
    const G = STATIC_SERVER_GATE;
    const probe = (body: string) =>
      valuesComputedOutsideGate("probe.ts", `async function loader(x: string) {\n${body}\n}`);
    // Kształt sprzed poprawki: deskryptor przed bramką, czytany w warunku i argumencie.
    expect(
      probe(`const preload = cover(x);\nif ((${G}) && preload) appendLinkHeader(link(preload));`),
    ).toEqual(["probe.ts:2 preload"]);
    // Tylko argument settera w bloku bramki.
    expect(probe(`const v = policy(x);\nif (${G}) { setCacheControlHeader(v); }`)).toEqual([
      "probe.ts:2 v",
    ]);
    // Poprawnie: deklaracja w gałęzi bramki.
    expect(
      probe(
        `if (${G}) {\n  const preload = cover(x);\n  if (preload) appendLinkHeader(link(preload));\n}`,
      ),
    ).toEqual([]);
    // Wartość potrzebna i tak (dane loadera) - liczy się w przeglądarce z innego powodu.
    expect(
      probe(
        `const identity = load(x);\nif (${G}) setCacheControlHeader(policy(identity));\nreturn identity;`,
      ),
    ).toEqual([]);
    // `await` zostaje: odczyt danych ma skutki (zasiew cache'u komponentu).
    expect(
      probe(`const people = await load(x);\nif (${G}) setCacheControlHeader(policy(people));`),
    ).toEqual([]);
    // Odczyt pola bez wywołania nic nie liczy; deskryptor zaczynający się od
    // bramki to poprawny zapis (`bramka && x ? a : b`).
    expect(
      probe(
        `const hero = x.field;\nconst pre = (${G}) && hero ? f(hero) : null;\nif ((${G}) && pre) appendLinkHeader(pre);`,
      ),
    ).toEqual([]);
    // Wejście przechodnie: czyta je tylko wyrażenie za bramką - też czerwono.
    expect(
      probe(
        `const cold = check(x);\nconst degraded = (${G}) && (cold || x === "");\nif (${G}) setCacheControlHeader(policy(degraded));`,
      ),
    ).toEqual(["probe.ts:2 cold"]);
    // Gałąź `: b` wyrażenia z bramką liczy się w przeglądarce - wartość w niej potrzebna.
    expect(
      probe(
        `const v = f(x);\nconst w = (${G}) && x ? "a" : v;\nif (${G}) setCacheControlHeader(w);\nreturn w;`,
      ),
    ).toEqual([]);
    // Literał to nie obliczenie; bramka innego zapisu nie jest bramką settera.
    expect(probe(`const sizes = "100vw";\nif (${G}) appendLinkHeader(sizes);`)).toEqual([]);
    expect(
      probe(`const v = policy(x);\nif (import.meta.env.SSR) setCacheControlHeader(v);`),
    ).toEqual([]);
  });

  it("detektor odróżnia bramkę od zapisów, które jej nie dają", () => {
    const verdicts = (body: string) =>
      setterCalls("probe.ts", `function loader(x: boolean) {\n${body}\n}`).map((c) => c.gated);
    const G = STATIC_SERVER_GATE;
    // Dopuszczone: goła bramka, bramka na lewym skraju `&&`, blok, pętla w bloku.
    expect(verdicts(`if (${G}) setCacheControlHeader("a");`)).toEqual([true]);
    expect(verdicts(`if ((${G}) && x) appendLinkHeader("a");`)).toEqual([true]);
    expect(verdicts(`if ((${G}) && x && !x) { appendLinkHeader("a"); }`)).toEqual([true]);
    expect(verdicts(`if (${G}) { for (const v of ["a"]) appendLinkHeader(v); }`)).toEqual([true]);
    // Niedopuszczone: brak bramki, bramka po prawej, gałąź `else`, inny zapis.
    expect(verdicts(`setCacheControlHeader("a");`)).toEqual([false]);
    expect(verdicts(`if (x) setCacheControlHeader("a");`)).toEqual([false]);
    expect(verdicts(`if (x && (${G})) setCacheControlHeader("a");`)).toEqual([false]);
    expect(verdicts(`if (${G}) {} else setCacheControlHeader("a");`)).toEqual([false]);
    expect(verdicts(`if (import.meta.env.SSR) setCacheControlHeader("a");`)).toEqual([false]);
    expect(verdicts(`if (!import.meta.env.SSR || x) setCacheControlHeader("a");`)).toEqual([false]);
    expect(verdicts(`if ((${G}) || x) setCacheControlHeader("a");`)).toEqual([false]);
  });
});

// ── CZĘŚĆ 2: LOADERY POD STAŁYMI BUILDU PRODUKCYJNEGO ──────────────────────
//
// Pięć tras, których wywołań nagłówka nie obserwował dotąd ŻADEN test
// (`/series/$slug`, `/qa`, `/qa/$slug`, `/membership-join`, `/pricing` - ich
// pliki sprawdzają render i dane, nie politykę cache'u). Wartości są wpisane
// DOSŁOWNIE, nie przez buildery: to one stoją na drucie.

const CLEAN = "public, max-age=60, s-maxage=900, stale-while-revalidate=86400";
const NO_STORE = "private, no-store";

type Loader<TContext> = (ctx: TContext) => Promise<unknown>;

function loaderOf<TContext>(route: { options: { loader?: unknown } }, name: string) {
  const loader: unknown = route.options.loader;
  if (typeof loader !== "function") throw new Error(`test: trasa ${name} nie ma loadera`);
  return loader as Loader<TContext>;
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

type SlugContext = { context: { queryClient: QueryClient }; params: { slug: string } };
type PlainContext = { context: { queryClient: QueryClient } };

const series = (slug: string) =>
  loaderOf<SlugContext>(
    SeriesRoute,
    "/series/$slug",
  )({
    context: { queryClient: client() },
    params: { slug },
  });
const qaList = () =>
  loaderOf<PlainContext>(QaListRoute, "/qa")({ context: { queryClient: client() } });
const qaSession = (slug: string) =>
  loaderOf<SlugContext>(
    QaSessionRoute,
    "/qa/$slug",
  )({
    context: { queryClient: client() },
    params: { slug },
  });
const membershipJoin = () =>
  loaderOf<PlainContext>(
    MembershipJoinRoute,
    "/membership-join",
  )({
    context: { queryClient: client() },
  });
const pricing = () =>
  loaderOf<PlainContext>(PricingRoute, "/pricing")({ context: { queryClient: client() } });
const webStory = (slug: string) =>
  loaderOf<SlugContext>(
    WebStoryRoute,
    "/web-stories/$slug",
  )({
    context: { queryClient: client() },
    params: { slug },
  });
type ClubContext = {
  context: { queryClient: QueryClient };
  location: { pathname: string };
  params: { clubSlug: string };
};
const clubLayout = (pathname: string) =>
  loaderOf<ClubContext>(
    ClubLayoutRoute,
    "/club/$clubSlug",
  )({
    context: { queryClient: client() },
    location: { pathname },
    params: { clubSlug: "klub" },
  });

/** `imagesrcset` okładki z magazynu Supabase - wpisany dosłownie, nie przez builder. */
function storageSrcSet(objectUrl: string): string {
  const render = objectUrl.replace("/storage/v1/object/", "/storage/v1/render/image/");
  return [
    [480, 76],
    [640, 76],
    [768, 80],
    [1280, 80],
    [1920, 80],
  ]
    .map(
      ([width, quality]) => `${render}?width=${width}&resize=contain&quality=${quality} ${width}w`,
    )
    .join(", ");
}

// Okładki z magazynu Supabase - preload niesie wtedy `imagesrcset`/`imagesizes`
// (parytet z `<img>`), a nie sam `href`.
const STORY_COVER =
  "https://projekt.supabase.co/storage/v1/object/public/media/historia/okladka.jpg";
const CLUB_COVER = "https://projekt.supabase.co/storage/v1/object/public/media/klub/okladka.jpg";
const STORY_ROW = { id: "ws-1", slug: "historia", title_pl: "Historia", cover_url: STORY_COVER };
const CLUB_ROW = {
  name_pl: "Klub",
  name_en: "Club",
  tagline_pl: null,
  tagline_en: null,
  cover_image_url: CLUB_COVER,
  visibility: "members",
  can_read: false,
};

const SERIES_ROW = {
  series: { id: "s-1", slug: "cykl", name_pl: "Cykl", name_en: null, description_pl: null },
  parts: [],
};
const QA_SESSION_ROW = { id: "qa-1", slug: "sesja", title_pl: "Sesja", title_en: "Session" };

function resetState(): void {
  h.cacheControl.length = 0;
  h.linkHeaders.length = 0;
  h.settings = { [COMMUNITY_MODULES_KEY]: { ...COMMUNITY_MODULES_DEFAULTS, qa_enabled: true } };
  h.settingsThrow = false;
  h.seriesThrows = false;
  h.series = SERIES_ROW;
  h.qaSessionsThrow = false;
  h.qaSessions = [QA_SESSION_ROW];
  h.qaSessionThrows = false;
  h.qaSession = QA_SESSION_ROW;
  h.qaQuestionsThrow = false;
  h.plansThrow = false;
  h.story = STORY_ROW;
  h.storyThrows = false;
  h.club = CLUB_ROW;
  h.clubThrows = false;
}

/** Stałe, które Vite wstawia do danego buildu; `null` = środowisko vitesta. */
const SERVER_BUILDS: ReadonlyArray<readonly [string, { DEV: boolean; SSR: boolean } | null]> = [
  ["serwer produkcyjny (PROD, SSR)", { DEV: false, SSR: true }],
  ["serwer dev (DEV, SSR)", { DEV: true, SSR: true }],
  ["vitest (DEV bez SSR)", null],
];

describe.each(SERVER_BUILDS)("nagłówki tras bez własnego testu polityki - %s", (_name, env) => {
  beforeEach(() => {
    resetState();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    if (env) {
      vi.stubEnv("DEV", env.DEV);
      vi.stubEnv("PROD", !env.DEV);
      vi.stubEnv("SSR", env.SSR);
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("/series/$slug: czysty odczyt -> polityka treści, awaria -> no-store", async () => {
    await series("cykl");
    expect(h.cacheControl).toEqual([CLEAN]);
    h.cacheControl.length = 0;
    h.seriesThrows = true;
    await series("cykl");
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("/qa: lista, wyłączony moduł i awaria listy niosą właściwą politykę", async () => {
    await qaList();
    expect(h.cacheControl).toEqual([CLEAN]);
    h.cacheControl.length = 0;
    // Moduł wyłączony w ustawieniach: osobne wywołanie settera, czysta polityka.
    h.settings = { [COMMUNITY_MODULES_KEY]: { ...COMMUNITY_MODULES_DEFAULTS, qa_enabled: false } };
    await qaList();
    expect(h.cacheControl).toEqual([CLEAN]);
    h.cacheControl.length = 0;
    h.settings = { [COMMUNITY_MODULES_KEY]: { ...COMMUNITY_MODULES_DEFAULTS, qa_enabled: true } };
    h.qaSessionsThrow = true;
    await qaList();
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("/qa/$slug: sesja z pytaniami, awaria pytań i awaria tożsamości", async () => {
    await qaSession("sesja");
    expect(h.cacheControl).toEqual([CLEAN]);
    h.cacheControl.length = 0;
    h.qaQuestionsThrow = true;
    await qaSession("sesja");
    expect(h.cacheControl).toEqual([NO_STORE]);
    h.cacheControl.length = 0;
    // Awaria odczytu TOŻSAMOŚCI: wcześniejsze wyjście z własnym wywołaniem.
    h.qaQuestionsThrow = false;
    h.qaSessionThrows = true;
    await expect(qaSession("sesja")).resolves.toBeNull();
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("/web-stories/$slug: okładka -> `Link` z preloadem, bez okładki -> bez `Link`, awaria -> no-store", async () => {
    // Deskryptor preloadu liczy się w gałęzi bramki (roadmapa §9.5, J1) -
    // wartość na drucie ta sama co przed przeniesieniem.
    await expect(webStory("historia")).resolves.toMatchObject({ degraded: false });
    expect(h.cacheControl).toEqual([CLEAN]);
    expect(h.linkHeaders).toEqual([
      `<${STORY_COVER}>; rel="preload"; as="image"; fetchpriority=high; imagesrcset="${storageSrcSet(STORY_COVER)}"; imagesizes="(max-width: 896px) 100vw, 896px"`,
    ]);
    resetState();
    h.story = { ...STORY_ROW, cover_url: null };
    await webStory("historia");
    expect(h.cacheControl).toEqual([CLEAN]);
    expect(h.linkHeaders).toEqual([]);
    resetState();
    h.storyThrows = true;
    await expect(webStory("historia")).resolves.toEqual({ story: null, degraded: true });
    expect(h.cacheControl).toEqual([NO_STORE]);
    expect(h.linkHeaders).toEqual([]);
  });

  it("/club/$clubSlug: hub za bramką dostępu -> `Link` okładki, poza tym bez `Link`; awaria -> no-store", async () => {
    await clubLayout("/club/klub");
    expect(h.cacheControl).toEqual([CLEAN]);
    expect(h.linkHeaders).toEqual([
      `<${CLUB_COVER}>; rel="preload"; as="image"; fetchpriority=high; imagesrcset="${storageSrcSet(CLUB_COVER)}"; imagesizes="(min-width: 1024px) 64rem, 100vw"`,
    ]);
    resetState();
    // Podstrona klubu i klub czytelny nie malują okładki jako LCP.
    await clubLayout("/club/klub/members");
    h.club = { ...CLUB_ROW, can_read: true };
    await clubLayout("/club/klub");
    expect(h.cacheControl).toEqual([CLEAN, CLEAN]);
    expect(h.linkHeaders).toEqual([]);
    resetState();
    h.clubThrows = true;
    await expect(clubLayout("/club/klub")).resolves.toEqual({ club: null });
    expect(h.cacheControl).toEqual([NO_STORE]);
    expect(h.linkHeaders).toEqual([]);
  });

  it("/membership-join i /pricing: pełna oferta -> polityka treści, awaria planów -> no-store", async () => {
    await membershipJoin();
    await pricing();
    expect(h.cacheControl).toEqual([CLEAN, CLEAN]);
    h.cacheControl.length = 0;
    h.plansThrow = true;
    await membershipJoin();
    await pricing();
    expect(h.cacheControl).toEqual([NO_STORE, NO_STORE]);
  });
});

describe("nagłówki tras - produkcyjny bundel przeglądarki (PROD bez SSR)", () => {
  beforeEach(() => {
    resetState();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", false);
    vi.stubEnv("PROD", true);
    vi.stubEnv("SSR", false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loadery oddają te same dane i nie dotykają setterów (tam i tak są puste)", async () => {
    h.seriesThrows = true;
    h.plansThrow = true;
    await expect(series("cykl")).resolves.toMatchObject({ degraded: true, headSeries: null });
    await expect(qaList()).resolves.toMatchObject({
      degraded: false,
      sessions: [{ slug: "sesja", titlePl: "Sesja", titleEn: "Session" }],
    });
    await expect(qaSession("sesja")).resolves.toMatchObject({ titlePl: "Sesja" });
    await expect(membershipJoin()).resolves.toEqual({ seo: null });
    await expect(pricing()).resolves.toEqual({ seo: null });
    // Trasy z deskryptorem preloadu: dane loadera bez zmian, `Link` niewołany.
    await expect(webStory("historia")).resolves.toEqual({ story: STORY_ROW, degraded: false });
    await expect(clubLayout("/club/klub")).resolves.toEqual({
      club: {
        namePl: "Klub",
        nameEn: "Club",
        taglinePl: null,
        taglineEn: null,
        coverImageUrl: CLUB_COVER,
        visibility: "members",
      },
    });
    expect(h.cacheControl).toEqual([]);
    expect(h.linkHeaders).toEqual([]);
  });
});
