// Pure redirect-manager core: path normalization, rule matching (exact,
// query-aware and wildcard), chain resolution and CSV import/export. Framework-
// free so the server middleware, the admin UI and the unit tests share one
// implementation and the matching semantics can never drift between layers.
//
// Matching semantics (in priority order):
//   1. exact "path?query" match (WP shortlinks like "/?p=123"),
//   2. exact "path" match,
//   3. longest-prefix wildcard match ("/old-section/*" -> "/new-section/*").
// After the first hit, exact-path chains are followed up to MAX_CHAIN_HOPS so
// stale multi-step redirects still land on the final URL in a single 301.

export const REDIRECT_STATUS_CODES = [301, 302, 307, 308, 410] as const;
export type RedirectStatusCode = (typeof REDIRECT_STATUS_CODES)[number];

export function isRedirectStatusCode(value: number): value is RedirectStatusCode {
  return (REDIRECT_STATUS_CODES as readonly number[]).includes(value);
}

export interface RedirectRule {
  id: string;
  /** Normalized source: "/old-path", "/old-path?p=1" or wildcard "/old/*". */
  source_path: string;
  /** Absolute path ("/new"), absolute URL, or wildcard target ("/new/*"). */
  target_path: string;
  status_code: number;
}

export interface RedirectMatch {
  rule: RedirectRule;
  /** Final destination (path + preserved query, or an absolute URL). */
  target: string;
  /** True when the terminal rule is a 410 Gone. */
  gone: boolean;
  statusCode: RedirectStatusCode;
}

/** System surfaces a redirect rule must never shadow. */
const PROTECTED_PREFIXES: readonly string[] = ["/admin", "/api", "/_"];

export function isProtectedPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return PROTECTED_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

const WILDCARD_SUFFIX = "/*";

export function isWildcardSource(sourcePath: string): boolean {
  return sourcePath.endsWith(WILDCARD_SUFFIX) && sourcePath.length > WILDCARD_SUFFIX.length;
}

/** Lowercase a pathname and drop the trailing slash (except for the root). */
function cleanPathname(pathname: string): string {
  let p = pathname.trim().toLowerCase();
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/") && !p.endsWith(WILDCARD_SUFFIX)) p = p.slice(0, -1);
  return p || "/";
}

/**
 * Normalize a raw source input (path, path?query, or full URL) into the
 * canonical stored form. Returns null when nothing usable remains. The hash is
 * dropped (never sent to the server), the query is kept verbatim (order
 * matters for WP-style "?p=123" shortlinks), and the pathname is lowercased.
 */
export function normalizeSourcePath(raw: string): string | null {
  let input = raw.trim();
  if (!input) return null;
  // "//a/b" would parse as a protocol-relative URL (host "a") - collapse the
  // leading slashes so it is treated as the path it was meant to be.
  if (/^\/\//.test(input)) input = `/${input.replace(/^\/+/, "")}`;
  let pathname = input;
  let search = "";
  try {
    const u = new URL(input, "https://x.invalid");
    pathname = u.pathname;
    search = u.search;
  } catch {
    return null;
  }
  const cleaned = cleanPathname(pathname);
  if (cleaned.includes("*") && !isWildcardSource(cleaned)) return null;
  const normalized = `${cleaned}${search}`;
  return normalized.length > 2048 ? null : normalized;
}

/**
 * Normalize a target: absolute URLs pass through, anything else becomes an
 * absolute path. Wildcard targets keep their "/*" suffix. Null when empty or
 * not a safe destination (only http/https URLs are allowed).
 */
export function normalizeTargetPath(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    if (!/^https?:\/\//i.test(input)) return null;
    try {
      return new URL(input).toString().slice(0, 2048);
    } catch {
      return null;
    }
  }
  const [pathPart, ...queryParts] = input.split("?");
  const search = queryParts.length ? `?${queryParts.join("?")}` : "";
  return `${cleanPathname(pathPart)}${search}`.slice(0, 2048);
}

/** Compiled lookup structure - built once per cache refresh, matched per request. */
export interface RedirectIndex {
  exact: ReadonlyMap<string, RedirectRule>;
  /** Wildcard rules sorted by prefix length, longest first. */
  wildcards: readonly RedirectRule[];
}

export function buildRedirectIndex(rules: readonly RedirectRule[]): RedirectIndex {
  const exact = new Map<string, RedirectRule>();
  const wildcards: RedirectRule[] = [];
  for (const rule of rules) {
    if (isWildcardSource(rule.source_path)) wildcards.push(rule);
    else exact.set(rule.source_path, rule);
  }
  wildcards.sort((a, b) => b.source_path.length - a.source_path.length);
  return { exact, wildcards };
}

function wildcardTarget(rule: RedirectRule, pathname: string): string {
  const prefix = rule.source_path.slice(0, -WILDCARD_SUFFIX.length);
  const remainder = pathname.slice(prefix.length).replace(/^\//, "");
  if (rule.target_path.endsWith(WILDCARD_SUFFIX)) {
    const base = rule.target_path.slice(0, -WILDCARD_SUFFIX.length) || "/";
    return remainder ? `${base}/${remainder}`.replace(/\/{2,}/g, "/") : base || "/";
  }
  return rule.target_path;
}

function matchWildcard(
  index: RedirectIndex,
  pathname: string,
): { rule: RedirectRule; target: string } | null {
  for (const rule of index.wildcards) {
    const prefix = rule.source_path.slice(0, -WILDCARD_SUFFIX.length);
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { rule, target: wildcardTarget(rule, pathname) };
    }
  }
  return null;
}

const MAX_CHAIN_HOPS = 5;

function isAbsoluteUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

/** Follow exact-path chains so one visible redirect lands on the final URL. */
function resolveChain(
  index: RedirectIndex,
  first: { rule: RedirectRule; target: string },
): RedirectMatch {
  let rule = first.rule;
  let target = first.target;
  const seen = new Set<string>([rule.source_path]);
  for (let hop = 0; hop < MAX_CHAIN_HOPS; hop++) {
    if (rule.status_code === 410) break;
    if (isAbsoluteUrl(target)) break;
    const nextKey = cleanPathname(target.split("?")[0]);
    if (seen.has(nextKey)) break;
    const next = index.exact.get(nextKey);
    if (!next || isWildcardSource(next.target_path)) break;
    seen.add(nextKey);
    rule = next;
    target = next.target_path;
  }
  const gone = rule.status_code === 410;
  const statusCode: RedirectStatusCode = isRedirectStatusCode(rule.status_code)
    ? rule.status_code
    : 301;
  return { rule, target, gone, statusCode };
}

/**
 * Match an incoming request path against the index. `search` is the raw query
 * string ("?a=1" or ""). The original query is preserved on the destination
 * unless the matched target carries its own query or the match consumed it.
 */
export function matchRedirect(
  index: RedirectIndex,
  rawPathname: string,
  search = "",
): RedirectMatch | null {
  const pathname = cleanPathname(rawPathname);
  if (isProtectedPath(pathname)) return null;

  let hit: { rule: RedirectRule; target: string } | null = null;
  let queryConsumed = false;

  if (search) {
    const withQuery = index.exact.get(`${pathname}${search}`);
    if (withQuery) {
      hit = { rule: withQuery, target: withQuery.target_path };
      queryConsumed = true;
    }
  }
  if (!hit) {
    const exact = index.exact.get(pathname);
    if (exact) hit = { rule: exact, target: exact.target_path };
  }
  if (!hit) hit = matchWildcard(index, pathname);
  if (!hit) return null;

  const resolved = resolveChain(index, hit);
  if (resolved.gone) return resolved;

  let target = resolved.target;
  if (search && !queryConsumed && !target.includes("?")) target = `${target}${search}`;
  // A redirect landing on its own source would loop forever - drop it.
  if (!isAbsoluteUrl(target) && cleanPathname(target.split("?")[0]) === pathname) return null;
  return { ...resolved, target };
}

// ---------------------------------------------------------------------------
// CSV import/export (admin UI + WP migration tooling)
// ---------------------------------------------------------------------------

export interface RedirectCsvRow {
  source_path: string;
  target_path: string;
  status_code: RedirectStatusCode;
  note: string | null;
}

export interface RedirectCsvIssue {
  line: number;
  reason: "invalid_source" | "invalid_target" | "invalid_status" | "self_redirect";
}

export interface RedirectCsvResult {
  rows: RedirectCsvRow[];
  issues: RedirectCsvIssue[];
}

/** Minimal CSV field splitter with double-quote support (no external dep). */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * Parse a "source,target,status,note" CSV (status and note optional; header
 * row detected and skipped). Duplicate sources keep the LAST occurrence so a
 * re-exported file round-trips cleanly.
 */
export function parseRedirectsCsv(text: string): RedirectCsvResult {
  const rows = new Map<string, RedirectCsvRow>();
  const issues: RedirectCsvIssue[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const fields = splitCsvLine(line);
    const [rawSource, rawTarget, rawStatus, rawNote] = fields;
    if (i === 0 && /^(source|source_path|from|old)/i.test(rawSource ?? "")) return;
    const source = normalizeSourcePath(rawSource ?? "");
    if (!source) {
      issues.push({ line: i + 1, reason: "invalid_source" });
      return;
    }
    const status = rawStatus?.trim() ? Number(rawStatus) : 301;
    if (!Number.isInteger(status) || !isRedirectStatusCode(status)) {
      issues.push({ line: i + 1, reason: "invalid_status" });
      return;
    }
    const target =
      status === 410
        ? (normalizeTargetPath(rawTarget ?? "") ?? "/")
        : normalizeTargetPath(rawTarget ?? "");
    if (!target) {
      issues.push({ line: i + 1, reason: "invalid_target" });
      return;
    }
    if (target === source) {
      issues.push({ line: i + 1, reason: "self_redirect" });
      return;
    }
    rows.set(source, {
      source_path: source,
      target_path: target,
      status_code: status,
      note: rawNote?.trim() || null,
    });
  });
  return { rows: [...rows.values()], issues };
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeRedirectsCsv(
  rows: readonly {
    source_path: string;
    target_path: string;
    status_code: number;
    note?: string | null;
  }[],
): string {
  const lines = ["source,target,status,note"];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.source_path),
        csvField(row.target_path),
        String(row.status_code),
        csvField(row.note ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
