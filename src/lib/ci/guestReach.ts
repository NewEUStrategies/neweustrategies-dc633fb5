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
//     (`routeSessionGate`: `<AuthGate>` obejmujący drzewo zwracane przez
//     komponent trasy, nawigacja na `/login` w `useEffect` komponentu trasy,
//     `throw redirect` na `/login` w `beforeLoad`/`loader`) ORAZ wpisem
//     `GATED_ROUTES_REVIEWED` z powodem - sama albo przez przodka w drzewie
//     tras. Przycisk logowania w handlerze czy bramka wokół jednego widżetu
//     bramką trasy nie są, a nowa bramka bez wpisu (i wpis bez bramki)
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
//   * `session-gate` nie jest dowodem logowania dla kodu PLIKU TRASY poza
//     `<AuthGate>` (hook wołany przed bramką wykonuje się u gościa) - plik
//     trasy z bramką i hooki wołane przed nią trzeba przeczytać;
//   * `none` - plik bez ścieżki z żadnej trasy (martwy kod, wejście spoza
//     drzewa) - niepewne.
//
// Moduł jest CZYSTY (bez I/O): źródła wchodzą parametrem.
import ts from "typescript";

import { buildImportGraph } from "./moduleImportGraph";
import { routeTreeEntries } from "./publicRouteLoaders";

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

/**
 * Bramka sesji na poziomie TRASY (węższa niż `hasSessionGate` spisu SSR,
 * która łapie `navigate({ to: "/login" })` gdziekolwiek w pliku):
 *   * `throw redirect({ to: "/login" })` w `beforeLoad`/`loader` opcji trasy;
 *   * komponent trasy (`component: X`, funkcja w tym pliku albo wprost),
 *     którego KAŻDE `return` to `null`, statyczny komunikat bez atrybutów
 *     z `STATIC_ROUTE_NOTICES` (`<CommunityDisabled />` - moduł wyłączony,
 *     bez zapytań) albo drzewo JSX
 *     z `<AuthGate>` osiągalnym przez same elementy JSX (co najmniej jedno
 *     z bramką);
 *   * `useEffect` wprost w ciele komponentu trasy z nawigacją na `/login`.
 * Wynik - opis z `plik:linia`; `null` - brak bramki trasy.
 */
export function routeSessionGate(file: string, source: string): string | null {
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
    if (hit !== null) return gateAt(sf, hit, `throw redirect na /login w ${name}`);
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
  if (fn.body !== undefined && ts.isBlock(fn.body)) {
    for (const stmt of fn.body.statements) {
      if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) continue;
      const call = stmt.expression;
      if (!ts.isIdentifier(call.expression) || call.expression.text !== "useEffect") continue;
      const hit = containsNode(call, (n) => isLoginNavigation(n, "navigate"));
      if (hit !== null) return gateAt(sf, hit, "nawigacja na /login w useEffect komponentu trasy");
    }
  }
  const returns = returnsOf(fn);
  const bare = (r: ts.Expression): boolean => {
    let node: ts.Node = r;
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return (
      ts.isJsxSelfClosingElement(node) &&
      node.attributes.properties.length === 0 &&
      STATIC_ROUTE_NOTICES.has(node.tagName.getText())
    );
  };
  const gates = returns.map((r) =>
    r.kind === ts.SyntaxKind.NullKeyword || bare(r) ? ("null" as const) : jsxGate(r),
  );
  const first = gates.find((g): g is ts.Node => g !== null && g !== "null");
  return first !== undefined && gates.every((g) => g !== null)
    ? gateAt(sf, first, "<AuthGate> obejmuje drzewo komponentu trasy")
    : null;
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
  // Bramka trasy zwalnia poddrzewo wyłącznie z wpisem i z bramką w kodzie.
  const routes = routeTreeEntries(
    { routeTree, sources: byFile },
    (file, source) => gatedRoutes[file] !== undefined && routeSessionGate(file, source) !== null,
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

  const out = new Map<string, GuestReach>();
  // BFS wielu źródeł - osobno dla każdej klasy, od najlepszej: plik dostaje
  // klasę pierwszego przebiegu, który go osiąga, i najkrótszą ścieżkę w nim.
  for (const cls of ["public", "session-gate", "admin"] as const) {
    const parent = new Map<string, string | null>();
    const label = new Map<string, string>();
    let frontier: string[] = [];
    for (const e of entries
      .filter((x) => x.cls === cls)
      .sort((a, b) => a.file.localeCompare(b.file))) {
      if (parent.has(e.file)) continue;
      parent.set(e.file, null);
      label.set(e.file, e.label);
      frontier.push(e.file);
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
      for (let at: string | null | undefined = file; at != null; at = parent.get(at)) path.push(at);
      out.set(file, { cls, path: path.reverse(), entry: label.get(file) ?? null });
    }
  }
  for (const { file } of sources) {
    if (!out.has(file)) out.set(file, { cls: "none", path: [], entry: null });
  }
  return out;
}
