// Bramki SESJI w kodzie (warunki prawdziwe wyłącznie z sesją albo wyłącznie
// bez niej) i regiony kodu, które obejmują - wspólne dla dowodu wpisu
// GUEST_LOGIN_ONLY_REVIEWED (`tsSqlContract.ts`) i bramki trasy
// (`guestReach.ts`). Analiza statyczna drzewa składniowego, bez I/O.
//
// Bramka, nie tekst: `enabled: !!user` w opcjach zapytania, `user && X`,
// `user ? A : B`, `if (!user) return|throw` (reszta bloku), `if (user) S`,
// `<AuthGate>` (dzieci, nie `fallback*`). Komentarz z tekstem bramki,
// `typeof window`, `user?.id` w kluczu zapytania i `enabled: !user` - nie.
// Wartość warunku ze ŹRÓDŁA sesji (`useAuth()`, `auth.getSession()`/`getUser()`,
// `context` handlera funkcji serwera), nie z samej nazwy: `userId` autora
// z adresu strony albo `user` z właściwości komponentu to nie sesja.
import ts from "typescript";

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function propName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
    ? name.text
    : null;
}

/**
 * Nazwy wartości sesji w warunku bramki (`user`, `session?.user`, `userId`,
 * `auth.isAuthenticated`) - identyfikator, korzeń łańcucha właściwości albo
 * nazwa właściwości. Sama nazwa nie wystarcza: wartość musi pochodzić ze
 * źródła sesji (`sessionRooted`) - `userId` autora z adresu strony to nie sesja.
 */
const SESSION_NAME_RE =
  /^(?:user|session|isAuthenticated|isLoggedIn|isSignedIn|userId|currentUser|authUser|uid)$/;

/** Hooki zwracające sesję zalogowanego (jedyny `AuthProvider` - `useAuth()`). */
const SESSION_HOOKS: ReadonlySet<string> = new Set(["useAuth", "useSession"]);

/** `useAuth()`, `supabase.auth.getSession()` / `.getUser()` (także `await`). */
function sessionSourceCall(e: ts.Expression): boolean {
  const node = unwrap(e);
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrap(node.expression);
  if (ts.isIdentifier(callee)) return SESSION_HOOKS.has(callee.text);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const owner = unwrap(callee.expression);
  return (
    (callee.name.text === "getSession" || callee.name.text === "getUser") &&
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === "auth"
  );
}

/** Wiązanie nazwy w pliku: deklaracja zmiennej, element rozkładu albo parametr (najbliższy zasięg). */
function declarationOf(id: ts.Identifier): ts.Node | null {
  const name = id.text;
  const binds = (n: ts.BindingName): ts.Node | null => {
    if (ts.isIdentifier(n)) return n.text === name ? n : null;
    for (const el of n.elements) {
      if (ts.isOmittedExpression(el)) continue;
      const hit = binds(el.name);
      if (hit !== null) return ts.isIdentifier(el.name) ? el : hit;
    }
    return null;
  };
  for (let node: ts.Node = id; node.parent !== undefined; node = node.parent) {
    const scope = node.parent;
    if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)) {
      for (const stmt of scope.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const d of stmt.declarationList.declarations) {
          const hit = binds(d.name);
          if (hit !== null) return ts.isIdentifier(d.name) ? d : hit;
        }
      }
    } else if (ts.isFunctionLike(scope)) {
      for (const p of scope.parameters) {
        const hit = binds(p.name);
        if (hit !== null) return ts.isIdentifier(p.name) ? p : hit;
      }
    }
  }
  return null;
}

/** Pierwszy parametr funkcji podanej wprost do `.handler(...)` / `.server(...)` (kontekst `requireSupabaseAuth`). */
function serverContextParam(p: ts.ParameterDeclaration): boolean {
  const fn = p.parent;
  const call = fn.parent;
  if (fn.parameters[0] !== p || call === undefined || !ts.isCallExpression(call)) return false;
  const callee = unwrap(call.expression);
  return (
    call.arguments.some((a) => a === fn) &&
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === "handler" || callee.name.text === "server")
  );
}

/**
 * Wartość ze źródła sesji: wynik `useAuth()`/`auth.getSession()`, jego pole
 * (`user?.id`), stała z nich wyliczona (`const userId = user?.id ?? null`)
 * albo `context` handlera funkcji serwera. Parametr komponentu (`{ user }`
 * z właściwości) - wołający może podać cokolwiek, więc nie.
 */
function sessionRooted(e: ts.Expression, depth = 0): boolean {
  if (depth > 8) return false;
  const node = unwrap(e);
  if (sessionSourceCall(node)) return true;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return sessionRooted(node.expression, depth + 1);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      const r = unwrap(node.right);
      const constant =
        r.kind === ts.SyntaxKind.NullKeyword ||
        r.kind === ts.SyntaxKind.FalseKeyword ||
        ts.isLiteralExpression(r) ||
        (ts.isIdentifier(r) && r.text === "undefined");
      return constant && sessionRooted(node.left, depth + 1);
    }
    return false;
  }
  if (!ts.isIdentifier(node)) return false;
  const decl = declarationOf(node);
  if (decl === null) return false;
  if (ts.isVariableDeclaration(decl)) {
    return (
      decl.initializer !== undefined &&
      !!(decl.parent.flags & ts.NodeFlags.Const) &&
      sessionRooted(decl.initializer, depth + 1)
    );
  }
  if (ts.isBindingElement(decl)) {
    let root: ts.Node = decl;
    while (
      ts.isBindingElement(root) ||
      ts.isObjectBindingPattern(root) ||
      ts.isArrayBindingPattern(root)
    ) {
      root = root.parent;
    }
    if (ts.isVariableDeclaration(root)) {
      return (
        root.initializer !== undefined &&
        !!(root.parent.flags & ts.NodeFlags.Const) &&
        sessionRooted(root.initializer, depth + 1)
      );
    }
    // `({ context }) => ...` handlera: `context.userId` - sesja z middleware.
    return (
      ts.isParameter(root) &&
      serverContextParam(root) &&
      ts.isObjectBindingPattern(root.name) &&
      (decl.propertyName === undefined ? decl.name : decl.propertyName).getText() === "context"
    );
  }
  return false;
}

/** Nazwa sesji (`SESSION_NAME_RE`) w łańcuchu wartości. */
function sessionNamed(e: ts.Expression): boolean {
  const node = unwrap(e);
  if (ts.isIdentifier(node)) return SESSION_NAME_RE.test(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    return SESSION_NAME_RE.test(node.name.text) || sessionNamed(node.expression);
  }
  if (ts.isElementAccessExpression(node)) return sessionNamed(node.expression);
  return false;
}

function sessionValue(e: ts.Expression): boolean {
  const node = unwrap(e);
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    // `Boolean(user)` - wartość argumentu.
    if (ts.isIdentifier(callee) && callee.text === "Boolean" && node.arguments.length === 1) {
      return sessionValue(node.arguments[0]);
    }
    // `auth.isAuthenticated()` - nazwa i źródło wywoływanej metody.
    return sessionNamed(callee) && sessionRooted(callee);
  }
  return sessionNamed(node) && sessionRooted(node);
}

const NULLISH = (e: ts.Expression): boolean => {
  const n = unwrap(e);
  return n.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(n) && n.text === "undefined");
};

/**
 * Warunek prawdziwy WYŁĄCZNIE z sesją (`user`, `!!user?.id`, `Boolean(session)`,
 * `user != null`, `a && user`, `user && open`); `negated` - prawdziwy wyłącznie
 * BEZ sesji (`!user`, `!user || !open`, `session == null`). `typeof window`,
 * `user?.id` w kluczu zapytania, `!user` jako `enabled` - nie.
 */
export function sessionCondition(e: ts.Expression, negated: boolean): boolean {
  const node = unwrap(e);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return sessionCondition(node.operand, !negated);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      // Koniunkcja wymaga sesji, gdy wymaga jej JEDEN człon; alternatywa -
      // gdy oba (prawa De Morgana dla zaprzeczenia).
      const any = (op === ts.SyntaxKind.AmpersandAmpersandToken) !== negated;
      const l = sessionCondition(node.left, negated);
      const r = sessionCondition(node.right, negated);
      return any ? l || r : l && r;
    }
    const eq =
      op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken;
    const ne =
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    if ((eq || ne) && (NULLISH(node.left) || NULLISH(node.right))) {
      const value = NULLISH(node.left) ? node.right : node.left;
      return ne !== negated && sessionValue(value);
    }
    return false;
  }
  return !negated && sessionValue(node);
}

/** Instrukcja kończąca gałąź (`return`, `throw`, blok z nimi). */
function exitsBranch(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  return (
    ts.isBlock(stmt) &&
    stmt.statements.some((x) => ts.isReturnStatement(x) || ts.isThrowStatement(x))
  );
}

const QUERY_OPTION_CALLS: ReadonlySet<string> = new Set([
  "useQuery",
  "useInfiniteQuery",
  "queryOptions",
  "infiniteQueryOptions",
]);

/** Region kodu `[start, end)` objęty bramką sesji. */
export type GuardSpan = readonly [number, number];

/** Warunek węzła bramki (`enabled:`, lewa strona `&&`, warunek `?:`/`if`, otwarcie `<AuthGate>`). */
function conditionOf(node: ts.Node): ts.Node | null {
  if (ts.isPropertyAssignment(node) && propName(node.name) === "enabled") return node.initializer;
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return node.left;
  }
  if (ts.isConditionalExpression(node)) return node.condition;
  if (ts.isIfStatement(node)) return node.expression;
  if (ts.isJsxElement(node)) return node.openingElement;
  return null;
}

/**
 * Region kodu objęty węzłem bramki sesji: `enabled:` opcji zapytania
 * (`useQuery`, `queryOptions`) - cały obiekt opcji; `warunek && X` - X;
 * `warunek ? A : B` - gałąź z sesją; `if (warunek) S` - S;
 * `if (!warunek) return|throw` - reszta bloku; `<AuthGate>` - dzieci (nie
 * `fallback*`). `null` - węzeł nie jest bramką sesji.
 */
function regionOf(sf: ts.SourceFile, at: ts.Node): GuardSpan | null {
  const span = (n: ts.Node): GuardSpan => [n.getStart(sf), n.getEnd()];
  if (ts.isPropertyAssignment(at) && propName(at.name) === "enabled") {
    if (
      !sessionCondition(at.initializer, false) ||
      !ts.isObjectLiteralExpression(at.parent) ||
      !ts.isCallExpression(at.parent.parent) ||
      !at.parent.parent.arguments.some((a) => a === at.parent)
    ) {
      return null;
    }
    const callee = unwrap(at.parent.parent.expression);
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : "";
    return QUERY_OPTION_CALLS.has(name) ? span(at.parent) : null;
  }
  if (
    ts.isBinaryExpression(at) &&
    at.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return sessionCondition(at.left, false) ? span(at.right) : null;
  }
  if (ts.isConditionalExpression(at)) {
    if (sessionCondition(at.condition, false)) return span(at.whenTrue);
    return sessionCondition(at.condition, true) ? span(at.whenFalse) : null;
  }
  if (ts.isIfStatement(at)) {
    if (sessionCondition(at.expression, false)) return span(at.thenStatement);
    if (!sessionCondition(at.expression, true)) return null;
    if (at.elseStatement !== undefined) return span(at.elseStatement);
    return exitsBranch(at.thenStatement) && (ts.isBlock(at.parent) || ts.isSourceFile(at.parent))
      ? [at.getEnd(), at.parent.getEnd()]
      : null;
  }
  if (ts.isJsxElement(at) && at.openingElement.tagName.getText(sf) === "AuthGate") {
    return [at.openingElement.getEnd(), at.closingElement.getStart(sf)];
  }
  return null;
}

/**
 * Region bramki sesji, której WARUNEK zawiera fragment dowodu [start, end)
 * (fragment leży w węźle bramki i zahacza o jego warunek) - najbliższy taki
 * węzeł nad fragmentem. `null` - fragment nie leży w warunku bramki sesji.
 */
export function guardRegion(sf: ts.SourceFile, start: number, end: number): GuardSpan | null {
  return guardAt(sf, start, end)?.region ?? null;
}

/** Jak `guardRegion`, z węzłem bramki (`enabled:`, `&&`, `?:`, `if`, `<AuthGate>`). */
export function guardAt(
  sf: ts.SourceFile,
  start: number,
  end: number,
): { readonly region: GuardSpan; readonly node: ts.Node } | null {
  let node: ts.Node = sf;
  for (;;) {
    const child: ts.Node | undefined = ts.forEachChild(node, (c) =>
      c.getStart(sf) <= start && start < c.getEnd() ? c : undefined,
    );
    if (child === undefined) break;
    node = child;
  }
  const within = (n: ts.Node): boolean => n.getStart(sf) <= start && end <= n.getEnd();
  const touches = (n: ts.Node): boolean => start < n.getEnd() && n.getStart(sf) < end;
  for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
    if (!within(at)) continue;
    const cond = conditionOf(at);
    if (cond === null || !touches(cond)) continue;
    const region = regionOf(sf, at);
    if (region !== null) return { region, node: at };
  }
  return null;
}

/**
 * Fabryka opcji (`queryOptions(...)`, `infiniteQueryOptions(...)`), której
 * `enabled:` jest węzłem bramki - `null` dla innych bramek (także `enabled:`
 * w `useQuery`, który flagę respektuje). `prefetchQuery`, `fetchQuery`,
 * `ensureQueryData` i `useSuspenseQuery` tej flagi NIE znają, więc taka
 * bramka chroni tylko wtedy, gdy opcje trafiają wyłącznie do `useQuery`.
 */
export function queryOptionsFactoryOf(node: ts.Node): ts.CallExpression | null {
  if (!ts.isPropertyAssignment(node) || propName(node.name) !== "enabled") return null;
  const call = node.parent.parent;
  if (call === undefined || !ts.isCallExpression(call)) return null;
  const callee = unwrap(call.expression);
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : "";
  return name === "queryOptions" || name === "infiniteQueryOptions" ? call : null;
}

/**
 * Wszystkie regiony bramek sesji w pliku (`regionOf` każdego węzła). Kod
 * w regionie wykonuje się wyłącznie z sesją.
 */
export function sessionGuardRegions(sf: ts.SourceFile): GuardSpan[] {
  const out: GuardSpan[] = [];
  const visit = (node: ts.Node): void => {
    const region = conditionOf(node) === null ? null : regionOf(sf, node);
    if (region !== null && region[0] < region[1]) out.push(region);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Czy pozycja leży w którymś regionie. */
export function inSpans(at: number, spans: readonly GuardSpan[]): boolean {
  return spans.some(([a, b]) => a <= at && at < b);
}
