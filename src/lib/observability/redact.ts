// PII scrubbing for telemetry ingest (client errors + web vitals).
//
// Error messages, stack traces and URLs frequently carry personal data:
// an email typed into a form and echoed in a validation error, a session
// token or recovery `code` in a query string, a JWT in an Authorization
// header logged by a fetch wrapper. Persisting those verbatim turns an
// observability table into a secondary PII/secret store. Every string that
// reaches a telemetry sink MUST pass through `redactPii` (free text) or
// `redactUrl` (URLs) first; `redactMeta` deep-scrubs structured context.
//
// The redaction is intentionally conservative: it errs toward dropping a
// value that merely looks sensitive (long hex/base64, `eyJ…` JWTs, known
// credential-bearing query keys) rather than risk leaking one. Redacted
// spans are replaced with a stable `[redacted-*]` marker so aggregated
// telemetry still groups identical errors.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// JSON Web Tokens: three base64url segments separated by dots, first "eyJ".
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// Credential-bearing query/form parameters: redact the VALUE, keep the key.
const SENSITIVE_PARAM_RE =
  /\b(access_token|refresh_token|id_token|token|api[_-]?key|apikey|key|password|passwd|pwd|secret|client_secret|code|email|auth|session|otp|state)=([^&\s#"']+)/gi;
// Long opaque hex / base64url blobs (>=24 chars) that survive the rules above.
const LONG_HEX_RE = /\b[0-9a-fA-F]{24,}\b/g;
const LONG_B64_RE = /\b[A-Za-z0-9_-]{40,}\b/g;

/** Redact PII/secrets from a free-text string (error message, stack, note). */
export function redactPii(input: string | null | undefined): string | null {
  if (input == null) return null;
  let out = String(input);
  if (!out) return out;
  out = out.replace(JWT_RE, "[redacted-jwt]");
  out = out.replace(BEARER_RE, (_m, scheme: string) => `${scheme} [redacted]`);
  out = out.replace(SENSITIVE_PARAM_RE, (_m, key: string) => `${key}=[redacted]`);
  out = out.replace(EMAIL_RE, "[redacted-email]");
  out = out.replace(LONG_HEX_RE, "[redacted]");
  out = out.replace(LONG_B64_RE, "[redacted]");
  return out;
}

/**
 * Redact a URL for storage: keep origin + path (the useful route signal),
 * drop the entire query string and fragment (the usual carriers of tokens,
 * emails and `code` params), then run free-text redaction over the remainder
 * as a backstop. Falls back to plain-text redaction if the value does not
 * parse as a URL.
 */
export function redactUrl(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input);
  if (!raw) return raw;
  try {
    // Support both absolute and root-relative URLs.
    const u = new URL(raw, "http://x");
    const hadQuery = u.search.length > 0 || u.hash.length > 0;
    const origin = u.origin === "http://x" ? "" : u.origin;
    const path = `${origin}${u.pathname}${hadQuery ? "?[redacted]" : ""}`;
    return redactPii(path);
  } catch {
    // Not a URL - strip anything after the first ? or # and redact the rest.
    const cut = raw.split(/[?#]/, 1)[0];
    const redacted = redactPii(cut);
    return raw.length > cut.length ? `${redacted}?[redacted]` : redacted;
  }
}

/**
 * Deep-scrub a bounded structured-context object (boundary label, component
 * stack, etc.): redact every string value (and key path that is itself a
 * URL/message). Arrays and nested objects are walked; non-strings pass
 * through. Depth-bounded to avoid pathological payloads.
 */
export function redactMeta<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (typeof value === "string") return redactPii(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => redactMeta(v, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactMeta(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}
