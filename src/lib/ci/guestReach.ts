// Osiągalność pliku dla GOŚCIA (bez logowania) - wejście bramki CI kontraktu
// TS <-> SQL (`tsSqlContract.ts`): wiersze `anon` faktów klienta przeglądarki
// idą do pgTAP dla plików osiągalnych dla gościa (klasa `public` i `none`).
//
// PO CO. Kontrakt TS <-> SQL sprawdza fakty klienta przeglądarki także jako
// `anon` (gość, SSR, handler serwera).
// Odmowa uprawnień dla `anon` jest defektem widocznym dla czytelnika TYLKO
// wtedy, gdy gość dociera do tego kodu - a większość klienta przeglądarki to
// ekrany po zalogowaniu (panel, profil, wiadomości). Ten moduł mówi, skąd
// plik wywołania jest osiągalny, z dowodem: najkrótszą ścieżką importów od
// pliku trasy.
//
// KRYTERIA (statyczne, z dowodem):
//   * wejście PUBLICZNE: powłoka `routes/__root.tsx` (każda strona), wejścia
//     serwera (`router.tsx`, `start.ts`, `server.ts`) i każda trasa spoza
//     gałęzi `/admin` bez bramki sesji (także trasa serwerowa bez komponentu
//     i trasa z `ssr: false` - gość otwiera ją tak samo);
//   * wejście ZA BRAMKĄ SESJI: trasa z bramką na poziomie TRASY
//     (`routeGateAnalysis`: `<AuthGate>` obejmujący drzewo zwracane przez
//     komponent trasy - także przez stałą lokalną, wczesne wyjście bez sesji
//     `if (!user) return <Navigate to="/login" />`, nawigacja na `/login`
//     w `useEffect` komponentu trasy, `throw redirect` na `/login`
//     w `beforeLoad`/`loader`) ORAZ wpisem `GATED_ROUTES_REVIEWED` z powodem -
//     sama albo przez przodka w drzewie tras (`<Outlet />` za bramką).
//     Bramka w drzewie komponentu zwalnia WYŁĄCZNIE kod za nią: import użyty
//     poza nią (komponent obok `<AuthGate>`, hook przed bramką, `head`) jest
//     wejściem gościa, a fakty pliku trasy poza zakresami bramki (`gated`) -
//     `public`. Przycisk logowania w handlerze czy bramka wokół jednego
//     widżetu bramką trasy nie są, a nowa bramka bez wpisu (i wpis bez bramki)
//     czerwieni `check:ts-sql-contract` (`gatedRouteDrift`);
//   * wejście PANELU: gałąź `/admin` (przekierowanie bez `isStaff`);
//   * krawędzie: importy wartości, STATYCZNE i `import()` (moduł leniwy też
//     wykonuje się u gościa, tylko później); bez wchodzenia w inne pliki tras
//     i w `routeTree.gen.ts` (on importuje wszystkie trasy).
// Klasa pliku to najlepsze osiągalne wejście: `public` > `session-gate` >
// `admin` > `none`.
//
// CZEGO TO NIE WIE - kierunek błędu jest znany i dlatego bramka sprawdza
// gościa dla `public` i `none`, a zwalnia strukturalnie tylko `admin`
// i `session-gate`:
//   * `public` jest GÓRNYM oszacowaniem: komponent osiągalny z trasy publicznej
//     może renderować się tylko z sesją (`{user && <X/>}`), a zapytanie mieć
//     `enabled: !!user` - takie miejsce trzeba przeczytać i dopiero z dowodem
//     wpisać do `GUEST_LOGIN_ONLY_REVIEWED` (`tsSqlContract.ts`);
//   * kod za bramką liczony jest SKŁADNIOWO (zakresy dzieci `<AuthGate>`,
//     reszta bloku po wyjściu bez sesji, funkcje lokalne wołane tylko
//     stamtąd); element JSX zbudowany w stałej poza bramką, a renderowany za
//     nią, liczy się jako kod gościa (nadmiar sprawdzeń, nie luka);
//   * `none` - plik bez ścieżki z żadnej trasy (martwy kod, wejście spoza
//     drzewa) - niepewne.
//
// Moduł jest CZYSTY (bez I/O): źródła wchodzą parametrem.
import ts from "typescript";

import { buildImportGraph, resolveImport } from "./moduleImportGraph";
import { routeTreeEntries } from "./publicRouteLoaders";
import { type GuardSpan, sessionCondition, sessionGuardRegions } from "./sessionGuard";

export type GuestReachClass = "public" | "session-gate" | "admin" | "none";

export interface GuestReach {
  readonly cls: GuestReachClass;
  /**
   * Najkrótsza ścieżka importów od wejścia do pliku (pierwszy element - plik
   * wejścia, ostatni - sam plik); `[]` przy `none`.
   */
  readonly path: readonly string[];
  /** Ścieżka URL wejścia (`/podcast/$slug`, `(powłoka)`, `(serwer)`); `null` przy `none`. */
  readonly entry: string | null;
  /**
   * Plik trasy z WŁASNĄ bramką w drzewie komponentu (`routeGateAnalysis`):
   * zakresy kodu `[start, end)` za bramką (dzieci `<AuthGate>`, reszta
   * komponentu po `if (!user) return`, funkcje lokalne wołane wyłącznie stamtąd).
   * Klasa `session-gate` dotyczy WYŁĄCZNIE tych zakresów - kod pliku poza nimi
   * (hook przed bramką, komponent obok niej) wykonuje się u gościa (`public`).
   * Brak pola - klasa obejmuje cały plik.
   */
  readonly gated?: readonly GuardSpan[];
}

export const ROUTE_TREE_FILE = "src/routeTree.gen.ts";
export const SHELL_FILE = "src/routes/__root.tsx";
/** Wejścia serwera i routera spoza drzewa tras - działają dla każdego żądania. */
export const SERVER_ENTRY_FILES: readonly string[] = [
  "src/router.tsx",
  "src/start.ts",
  "src/server.ts",
];

const RANK: Readonly<Record<GuestReachClass, number>> = {
  public: 0,
  "session-gate": 1,
  admin: 2,
  none: 3,
};

/**
 * Trasy (plik trasy -> powód), których bramka sesji ZWALNIA ich poddrzewo
 * z wierszy gościa w kontrakcie TS <-> SQL. Wpis działa wyłącznie razem
 * z bramką widoczną w kodzie (`routeSessionGate`); lista musi być równa
 * zbiorowi tras z bramką (bez panelu `/admin`, który ma własną klasę) -
 * `gatedRouteDrift` w `check:ts-sql-contract`. Przegląd listopad 2026.
 */
export const GATED_ROUTES_REVIEWED: Readonly<Record<string, string>> = {
  "src/routes/contributors.tsx":
    "tablica współtwórców tylko dla zalogowanych - cały ekran pod `<AuthGate>` (fallback: CTA logowania)",
  "src/routes/events.saved.tsx": "zapisane wydarzenia użytkownika - cały ekran pod `<AuthGate>`",
  "src/routes/meetings.$eventSlug.tsx":
    "spotkania uczestnika wydarzenia - cały ekran pod `<AuthGate>`",
  "src/routes/messages.tsx": "skrzynka wiadomości - cały ekran pod `<AuthGate>`",
  "src/routes/network.mutual.$userId.tsx": "wspólne kontakty - cały ekran pod `<AuthGate>`",
  "src/routes/network.tsx": "sieć kontaktów - cały ekran pod `<AuthGate>`",
  "src/routes/people.$slug.tsx":
    "profil członka (noindex) - treść pod `<AuthGate>`, gość widzi CTA logowania",
  "src/routes/people.index.tsx": "katalog członków - cały ekran pod `<AuthGate>`",
  "src/routes/profile.organization.tsx": "profil organizacji - cały ekran pod `<AuthGate>`",
  "src/routes/profile.edit.tsx":
    "edycja profilu - `if (loading || !user) return null` w komponencie trasy (gość nie widzi nic), także pod `<AuthGate>` układu `/profile`",
  "src/routes/profile.personality.tsx": "profil osobowości - cały ekran pod `<AuthGate>`",
  "src/routes/profile.tsx":
    "układ `/profile` - `<AuthGate>` wokół `<Outlet />` obejmuje 21 tras potomnych",
  "src/routes/welcome.tsx":
    "ekran po aktywacji - `useEffect` komponentu przekierowuje gościa na `/login`",
};

/**
 * Komponenty-komunikaty bez danych, które komponent trasy może zwrócić
 * zamiast bramki (wcześniejszy `return`), nie odbierając trasie bramki.
 * Dopisanie wymaga przeglądu: komunikat widzi gość.
 */
export const STATIC_ROUTE_NOTICES: ReadonlySet<string> = new Set(["CommunityDisabled"]);

/** Bramka sesji z miejscem w kodzie (`plik:linia`). */
function gateAt(sf: ts.SourceFile, node: ts.Node, what: string): string {
  return `${what} (${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1})`;
}

/** `navigate({ to: "/login" ... })` / `redirect({ to: "/login" ... })` - wywołanie z celem logowania. */
function isLoginNavigation(node: ts.Node, callee: "navigate" | "redirect"): boolean {
  if (!ts.isCallExpression(node)) return false;
  const fn = node.expression;
  const name = ts.isIdentifier(fn)
    ? fn.text
    : ts.isPropertyAccessExpression(fn)
      ? fn.name.text
      : null;
  const arg = node.arguments[0];
  return (
    name === callee &&
    arg !== undefined &&
    ts.isObjectLiteralExpression(arg) &&
    arg.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "to" &&
        ts.isStringLiteralLike(p.initializer) &&
        p.initializer.text === "/login",
    )
  );
}

function containsNode(root: ts.Node, test: (node: ts.Node) => boolean): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (test(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** Wyrażenia `return` funkcji (bez funkcji zagnieżdżonych); ciało wyrażeniowe - ono samo. */
function returnsOf(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (fn.body === undefined) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return out;
}

/** `<AuthGate>` osiągalny z korzenia drzewa JSX przez same elementy JSX (nie przez wyrażenia). */
function jsxGate(expr: ts.Expression): ts.Node | null {
  let node: ts.Node = expr;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  const tag = (el: ts.JsxElement | ts.JsxSelfClosingElement): string =>
    (ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName).getText();
  if (ts.isJsxSelfClosingElement(node)) return tag(node) === "AuthGate" ? node : null;
  if (ts.isJsxElement(node) && tag(node) === "AuthGate") return node;
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    for (const child of node.children) {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        const found = jsxGate(child as unknown as ts.Expression);
        if (found !== null) return found;
      }
    }
  }
  return null;
}

/** Nazwa tagu elementu JSX. */
function jsxTag(el: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return (ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName).getText();
}

/**
 * Statyczny znacznik bez danych (np. `<div aria-busy />` na czas ładowania):
 * same elementy wbudowane (tag małą literą), tekst i wyrażenia bez funkcji
 * i wywołań (poza `t(...)` tłumaczenia) - gość nie wykona przez niego zapytania.
 */
function staticMarkup(node: ts.Node): boolean {
  if (ts.isParenthesizedExpression(node)) return staticMarkup(node.expression);
  if (ts.isJsxText(node)) return true;
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    if (!/^[a-z]/.test(jsxTag(node))) return false;
    const attrs = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
    if (!attrs.properties.every((a) => staticMarkup(a))) return false;
    return ts.isJsxSelfClosingElement(node) || node.children.every((c) => staticMarkup(c));
  }
  if (ts.isJsxFragment(node)) return node.children.every((c) => staticMarkup(c));
  if (ts.isJsxAttribute(node))
    return node.initializer === undefined || staticMarkup(node.initializer);
  if (ts.isJsxExpression(node))
    return node.expression === undefined || staticMarkup(node.expression);
  if (ts.isCallExpression(node)) {
    return (
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments.every((a) => staticMarkup(a))
    );
  }
  if (ts.isFunctionLike(node) || ts.isJsxSpreadAttribute(node)) return false;
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isTemplateExpression(node) && node.templateSpans.every((x) => staticMarkup(x.expression)))
  );
}

/** `<Navigate to="/login" ... />` - przekierowanie gościa na logowanie zamiast treści. */
function loginNavigate(node: ts.Node): boolean {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText() === "Navigate" &&
    node.attributes.properties.some(
      (a) =>
        ts.isJsxAttribute(a) &&
        a.name.getText() === "to" &&
        a.initializer !== undefined &&
        ts.isStringLiteral(a.initializer) &&
        a.initializer.text === "/login",
    )
  );
}

/** Opis bramki trasy i zakresy kodu, które obejmuje. */
export interface RouteGateAnalysis {
  /** Opis bramki z `plik:linia`. */
  readonly gate: string;
  /**
   * `null` - bramka obejmuje CAŁY plik (`throw redirect` w `beforeLoad`/`loader`,
   * nawigacja w `useEffect`); inaczej - zakresy kodu za bramką.
   */
  readonly gated: readonly GuardSpan[] | null;
  /** Specyfikatory importów użytych w kodzie wykonywanym u gościa (poza bramką). */
  readonly publicImports: ReadonlySet<string>;
  /** `<Outlet />` (trasy potomne) poza bramką - potomkowie nie dziedziczą bramki. */
  readonly outletOutside: boolean;
}

/**
 * Bramka sesji na poziomie TRASY (węższa niż `hasSessionGate` spisu SSR,
 * która łapie `navigate({ to: "/login" })` gdziekolwiek w pliku):
 *   * `throw redirect({ to: "/login" })` w `beforeLoad`/`loader` opcji trasy;
 *   * komponent trasy (`component: X`, funkcja w tym pliku albo wprost),
 *     którego KAŻDE `return` to `null`, statyczny komunikat bez atrybutów
 *     z `STATIC_ROUTE_NOTICES`, statyczny znacznik bez komponentów i wywołań
 *     (`<div aria-busy />` na czas ładowania), `<Navigate to="/login" />`,
 *     drzewo JSX z `<AuthGate>` osiągalnym przez same elementy JSX (także
 *     przez stałą lokalną: `const content = (...); return content;`) albo
 *     `return` za wczesnym wyjściem bez sesji (`if (!user) return
 *     <Navigate to="/login" />` w ciele komponentu) - i co najmniej jedno
 *     z bramką albo takie wyjście;
 *   * `useEffect` wprost w ciele komponentu trasy z nawigacją na `/login`.
 * Zakresy kodu za bramką (`gated`): dzieci `<AuthGate>` i reszta bloku po
 * wyjściu bez sesji (`sessionGuardRegions`) oraz funkcje i stałe lokalne
 * pliku wołane WYŁĄCZNIE stamtąd; kod poza nimi (hook przed bramką, komponent
 * obok niej, `head`) i jego importy wykonują się u gościa.
 */
export function routeGateAnalysis(file: string, source: string): RouteGateAnalysis | null {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const options = containsNode(sf, (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false;
    const arg = node.arguments[0];
    if (!ts.isObjectLiteralExpression(arg)) return false;
    let callee: ts.Expression = node.expression;
    while (ts.isCallExpression(callee)) callee = callee.expression;
    return (
      ts.isIdentifier(callee) && /^create(?:File|Root|)Route(?:WithContext)?$/.test(callee.text)
    );
  }) as ts.CallExpression | null;
  if (options === null) return null;
  const whole = (gate: string): RouteGateAnalysis => ({
    gate,
    gated: null,
    publicImports: new Set(),
    outletOutside: false,
  });
  const obj = options.arguments[0] as ts.ObjectLiteralExpression;
  const prop = (name: string): ts.Node | null => {
    for (const p of obj.properties) {
      if (p.name === undefined || !ts.isIdentifier(p.name) || p.name.text !== name) continue;
      if (ts.isPropertyAssignment(p)) return p.initializer;
      if (ts.isMethodDeclaration(p)) return p;
      if (ts.isShorthandPropertyAssignment(p)) return p.name;
    }
    return null;
  };
  for (const name of ["beforeLoad", "loader"]) {
    const value = prop(name);
    const hit =
      value === null
        ? null
        : containsNode(
            value,
            (n) => ts.isThrowStatement(n) && isLoginNavigation(n.expression, "redirect"),
          );
    if (hit !== null) return whole(gateAt(sf, hit, `throw redirect na /login w ${name}`));
  }
  let component = prop("component");
  if (component !== null && ts.isIdentifier(component)) {
    const id = component.text;
    component = null;
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === id) component = stmt;
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === id && d.initializer !== undefined) {
            component = d.initializer;
          }
        }
      }
    }
  }
  if (
    component === null ||
    !(
      ts.isFunctionDeclaration(component) ||
      ts.isArrowFunction(component) ||
      ts.isFunctionExpression(component)
    )
  ) {
    return null;
  }
  const fn = component;
  const body = fn.body !== undefined && ts.isBlock(fn.body) ? fn.body : null;
  for (const stmt of body?.statements ?? []) {
    if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) continue;
    const call = stmt.expression;
    if (!ts.isIdentifier(call.expression) || call.expression.text !== "useEffect") continue;
    const hit = containsNode(call, (n) => isLoginNavigation(n, "navigate"));
    if (hit !== null)
      return whole(gateAt(sf, hit, "nawigacja na /login w useEffect komponentu trasy"));
  }
  // Stałe ciała komponentu (`const content = (<main>...</main>)`) - `return content`.
  const locals = new Map<string, ts.Expression>();
  for (const stmt of body?.statements ?? []) {
    if (!ts.isVariableStatement(stmt) || !(stmt.declarationList.flags & ts.NodeFlags.Const))
      continue;
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer !== undefined)
        locals.set(d.name.text, d.initializer);
    }
  }
  // Wczesne wyjście bez sesji wprost w ciele komponentu: reszta ciała za bramką.
  const exits = (body?.statements ?? []).filter(
    (st): st is ts.IfStatement =>
      ts.isIfStatement(st) &&
      st.elseStatement === undefined &&
      sessionCondition(st.expression, true) &&
      (ts.isReturnStatement(st.thenStatement) ||
        (ts.isBlock(st.thenStatement) &&
          st.thenStatement.statements.some((x) => ts.isReturnStatement(x)))),
  );
  const exitAfter = exits.length === 0 ? null : Math.min(...exits.map((x) => x.getEnd()));
  const preserving = (r: ts.Expression): boolean => {
    let node: ts.Node = r;
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return (
      node.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isJsxSelfClosingElement(node) &&
        node.attributes.properties.length === 0 &&
        STATIC_ROUTE_NOTICES.has(node.tagName.getText())) ||
      staticMarkup(node) ||
      loginNavigate(node)
    );
  };
  const returns = returnsOf(fn);
  let gateNode: ts.Node | null = null;
  for (const r of returns) {
    if (exitAfter !== null && r.getStart(sf) >= exitAfter) continue;
    const resolved = ts.isIdentifier(r) ? (locals.get(r.text) ?? r) : r;
    const found = jsxGate(resolved);
    if (found !== null) {
      gateNode ??= found;
      continue;
    }
    if (!preserving(r)) return null;
  }
  if (gateNode === null && exits.length === 0) return null;
  const gate =
    gateNode !== null
      ? gateAt(sf, gateNode, "<AuthGate> obejmuje drzewo komponentu trasy")
      : gateAt(sf, exits[0], "wczesne wyjście bez sesji w komponencie trasy");
  return { gate, ...gatedCode(sf) };
}

/**
 * Kod pliku trasy wykonywany u gościa: kod modułu, a w nim odwołania do
 * funkcji i stałych lokalnych (te - w całości) i importów; zakresy bramek
 * sesji (`sessionGuardRegions`) są pomijane. Wynik: zakresy za bramką
 * (bramki i ciała deklaracji lokalnych bez odwołania z kodu gościa)
 * i specyfikatory importów użytych przez gościa.
 */
function gatedCode(sf: ts.SourceFile): {
  gated: GuardSpan[];
  publicImports: Set<string>;
  outletOutside: boolean;
} {
  const regions = sessionGuardRegions(sf);
  const imports = new Map<string, string>();
  const publicImports = new Set<string>();
  const decls = new Map<string, ts.Node[]>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (clause === undefined) {
        publicImports.add(spec);
        continue;
      }
      if (clause.isTypeOnly) continue;
      if (clause.name !== undefined) imports.set(clause.name.text, spec);
      const named = clause.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named)) imports.set(named.name.text, spec);
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const el of named.elements) if (!el.isTypeOnly) imports.set(el.name.text, spec);
      }
      continue;
    }
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(stmt.moduleSpecifier)) publicImports.add(stmt.moduleSpecifier.text);
      continue;
    }
    // Funkcja, klasa i stała z funkcją - wykonuje się dopiero przez odwołanie.
    const deferred = (name: string | undefined, node: ts.Node): void => {
      if (name === undefined) return;
      decls.set(name, [...(decls.get(name) ?? []), node]);
    };
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt))
      deferred(stmt.name?.text, stmt);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        let init: ts.Node | undefined = d.initializer;
        // `memo(() => ...)`, `forwardRef(function X() {...})` - wciąż funkcja.
        while (init !== undefined && ts.isCallExpression(init) && init.arguments.length > 0) {
          const first: ts.Expression = init.arguments[0];
          if (!ts.isArrowFunction(first) && !ts.isFunctionExpression(first)) break;
          init = first;
        }
        if (
          ts.isIdentifier(d.name) &&
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init))
        ) {
          deferred(d.name.text, d.initializer ?? init);
        }
      }
    }
  }
  const deferredNodes = new Set([...decls.values()].flat());
  const reached = new Set<ts.Node>();
  let outletOutside = false;
  const queue: ts.Node[] = [sf];
  const visit = (node: ts.Node): void => {
    if (node !== sf && deferredNodes.has(node) && !reached.has(node)) return;
    const start = node.getStart(sf);
    if (regions.some(([a, b]) => a <= start && node.getEnd() <= b)) return;
    if (ts.isIdentifier(node) && valueReference(node)) {
      const spec = imports.get(node.text);
      if (spec !== undefined) publicImports.add(spec);
      if (node.text === "Outlet") outletOutside = true;
      for (const d of decls.get(node.text) ?? []) {
        if (reached.has(d)) continue;
        reached.add(d);
        queue.push(d);
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      publicImports.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  while (queue.length > 0) {
    const next = queue.shift() as ts.Node;
    if (ts.isSourceFile(next)) ts.forEachChild(next, visit);
    else visit(next);
  }
  const unreached = [...deferredNodes].filter((d) => !reached.has(d));
  return {
    gated: [...regions, ...unreached.map((d) => [d.getStart(sf), d.getEnd()] as const)],
    publicImports,
    outletOutside,
  };
}

/** Identyfikator jako odwołanie do wartości (nie nazwa deklaracji, klucz obiektu ani `.pole`). */
function valueReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  if (ts.isJsxAttribute(parent) && parent.name === id) return false;
  if (
    (ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent)) &&
    parent.name === id
  ) {
    return false;
  }
  if (ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent)) return false;
  return true;
}

/**
 * Bramka sesji na poziomie TRASY (`routeGateAnalysis`) - opis z `plik:linia`;
 * `null` - brak bramki trasy.
 */
export function routeSessionGate(file: string, source: string): string | null {
  return routeGateAnalysis(file, source)?.gate ?? null;
}

/**
 * Rozjazd listy tras z bramką: `fresh` - trasa (spoza `/admin`) z bramką
 * w kodzie bez wpisu; `stale` - wpis bez bramki w kodzie (albo bez pliku
 * trasy). Oba czerwienią `check:ts-sql-contract`: bramka zwalnia całe
 * poddrzewo z wierszy gościa, więc każda nowa wymaga przeglądu.
 */
export function gatedRouteDrift(
  sources: readonly { readonly file: string; readonly code: string }[],
  reviewed: Readonly<Record<string, string>> = GATED_ROUTES_REVIEWED,
): { fresh: string[]; stale: string[] } {
  const byFile = new Map(sources.map((s) => [s.file, s.code]));
  const routes = routeTreeEntries({
    routeTree: byFile.get(ROUTE_TREE_FILE) ?? "",
    sources: byFile,
  });
  const fresh: string[] = [];
  const gated = new Set<string>();
  for (const r of routes) {
    if (r.admin) continue;
    const gate = routeSessionGate(r.file, byFile.get(r.file) ?? "");
    if (gate === null) continue;
    gated.add(r.file);
    if (reviewed[r.file] === undefined) fresh.push(`${r.file} (${r.fullPath}): ${gate}`);
  }
  const stale = Object.keys(reviewed)
    .filter((file) => !gated.has(file))
    .map((file) => `${file} (brak bramki trasy w kodzie)`);
  return { fresh: fresh.sort(), stale: stale.sort() };
}

/** Problemy listy tras z bramką dla `check:ts-sql-contract` (pusta - bez rozjazdu). */
export function gatedRouteProblems(
  sources: readonly { readonly file: string; readonly code: string }[],
  reviewed: Readonly<Record<string, string>> = GATED_ROUTES_REVIEWED,
): string[] {
  const { fresh, stale } = gatedRouteDrift(sources, reviewed);
  const out: string[] = [];
  if (fresh.length > 0) {
    out.push(
      `${fresh.length} tras z bramką sesji spoza GATED_ROUTES_REVIEWED (bramka zwalnia poddrzewo z wierszy gościa - wpis z powodem po przeglądzie):\n` +
        fresh.map((x) => `        ${x}`).join("\n"),
    );
  }
  if (stale.length > 0) {
    out.push(
      `${stale.length} wpisów GATED_ROUTES_REVIEWED bez bramki trasy w kodzie (zdejmij wpis):\n` +
        stale.map((x) => `        ${x}`).join("\n"),
    );
  }
  return out;
}

/** Osiągalność każdego pliku źródeł (klucz - ścieżka repo). */
export function guestReach(
  sources: readonly { readonly file: string; readonly code: string }[],
  gatedRoutes: Readonly<Record<string, string>> = GATED_ROUTES_REVIEWED,
): Map<string, GuestReach> {
  const byFile = new Map(sources.map((s) => [s.file, s.code]));
  const routeTree = byFile.get(ROUTE_TREE_FILE) ?? "";
  // Bramka trasy zwalnia poddrzewo wyłącznie z wpisem i z bramką w kodzie;
  // trasy potomne - tylko gdy `<Outlet />` leży za bramką.
  const analyses = new Map<string, RouteGateAnalysis | null>();
  const analysis = (file: string, source: string): RouteGateAnalysis | null => {
    if (gatedRoutes[file] === undefined) return null;
    if (!analyses.has(file)) analyses.set(file, routeGateAnalysis(file, source));
    return analyses.get(file) ?? null;
  };
  const childGate = (file: string, source: string): boolean => {
    const a = analysis(file, source);
    return a !== null && !a.outletOutside;
  };
  const routes = routeTreeEntries(
    { routeTree, sources: byFile },
    (file, source) => analysis(file, source) !== null,
    childGate,
  );
  // Trasa pod bramką przodka (`<Outlet />` za nią) jest za bramką CAŁA -
  // jej własna bramka nie zawęża zwolnienia do zakresów.
  const inherited = new Set(
    routeTreeEntries({ routeTree, sources: byFile }, () => false, childGate)
      .filter((r) => r.sessionGateFrom !== null)
      .map((r) => r.file),
  );
  const routeFiles = new Set([...routes.map((r) => r.file), SHELL_FILE]);

  const edges = buildImportGraph(
    sources.map((s) => s.file),
    (file) => byFile.get(file) ?? "",
  );
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (e.to === ROUTE_TREE_FILE || routeFiles.has(e.to)) continue;
    const list = next.get(e.from) ?? [];
    list.push(e.to);
    next.set(e.from, list);
  }
  for (const list of next.values()) list.sort();

  const entries: { file: string; cls: GuestReachClass; label: string }[] = [
    { file: SHELL_FILE, cls: "public", label: "(powłoka)" },
    ...SERVER_ENTRY_FILES.filter((f) => byFile.has(f)).map((file) => ({
      file,
      cls: "public" as const,
      label: "(serwer)",
    })),
    ...routes.map((r) => ({
      file: r.file,
      cls: (r.admin
        ? "admin"
        : r.sessionGateFrom !== null
          ? "session-gate"
          : "public") as GuestReachClass,
      label: r.fullPath,
    })),
  ];

  // Trasa z własną bramką w drzewie komponentu: importy użyte w kodzie poza
  // bramką (komponent obok `<AuthGate>`, hook przed nią) są wejściami GOŚCIA.
  const known = new Set(byFile.keys());
  const outside: { route: string; label: string; to: string }[] = [];
  const gatedSpans = new Map<string, readonly GuardSpan[]>();
  for (const r of routes) {
    if (r.admin || r.sessionGateFrom !== r.fullPath || inherited.has(r.file)) continue;
    const a = analyses.get(r.file) ?? null;
    if (a === null || a.gated === null) continue;
    gatedSpans.set(r.file, a.gated);
    for (const spec of [...a.publicImports].sort()) {
      const to = resolveImport(r.file, spec, (path) => known.has(path));
      if (to === null || to === r.file || to === ROUTE_TREE_FILE || routeFiles.has(to)) continue;
      outside.push({ route: r.file, label: `${r.fullPath} (poza bramką)`, to });
    }
  }

  const out = new Map<string, GuestReach>();
  // BFS wielu źródeł - osobno dla każdej klasy, od najlepszej: plik dostaje
  // klasę pierwszego przebiegu, który go osiąga, i najkrótszą ścieżkę w nim.
  for (const cls of ["public", "session-gate", "admin"] as const) {
    const parent = new Map<string, string | null>();
    const label = new Map<string, string>();
    // Rodzic importu spoza bramki - plik trasy (sam plik zostaje za bramką).
    const via = new Map<string, string>();
    let frontier: string[] = [];
    for (const e of entries
      .filter((x) => x.cls === cls)
      .sort((a, b) => a.file.localeCompare(b.file))) {
      if (parent.has(e.file)) continue;
      parent.set(e.file, null);
      label.set(e.file, e.label);
      frontier.push(e.file);
    }
    if (cls === "public") {
      for (const o of outside) {
        if (parent.has(o.to)) continue;
        parent.set(o.to, null);
        via.set(o.to, o.route);
        label.set(o.to, o.label);
        frontier.push(o.to);
      }
    }
    while (frontier.length > 0) {
      const after: string[] = [];
      for (const file of frontier) {
        for (const to of next.get(file) ?? []) {
          if (parent.has(to)) continue;
          parent.set(to, file);
          label.set(to, label.get(file) ?? "");
          after.push(to);
        }
      }
      frontier = after;
    }
    for (const file of parent.keys()) {
      const known = out.get(file);
      if (known !== undefined && RANK[known.cls] <= RANK[cls]) continue;
      const path: string[] = [];
      for (let at: string | null | undefined = file; at != null; at = parent.get(at)) {
        path.push(at);
        const route = parent.get(at) === null ? via.get(at) : undefined;
        if (route !== undefined) path.push(route);
      }
      const spans = cls === "session-gate" ? gatedSpans.get(file) : undefined;
      out.set(file, {
        cls,
        path: path.reverse(),
        entry: label.get(file) ?? null,
        ...(spans === undefined ? {} : { gated: spans }),
      });
    }
  }
  for (const { file } of sources) {
    if (!out.has(file)) out.set(file, { cls: "none", path: [], entry: null });
  }
  return out;
}
