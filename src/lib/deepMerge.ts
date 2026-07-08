// Deep merge plain objects. Arrays and non-object values from `source` overwrite `target`.
// Used to guarantee that partial values stored in site_settings never leave
// required nested keys undefined (defensive against schema drift).

type Plain = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Plain =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;

export function deepMerge<T>(target: T, source: unknown): T {
  if (!isPlainObject(target) || !isPlainObject(source)) return target;
  const out: Plain = { ...(target as Plain) };
  for (const [k, v] of Object.entries(source)) {
    // Guard against prototype pollution: a `source` parsed from stored JSON can
    // carry an own "__proto__"/"constructor"/"prototype" key, and `out[k] = v`
    // for "__proto__" invokes the prototype setter - corrupting `out` (its keys
    // become inherited and vanish on JSON.stringify, and later merges no-op
    // because it is no longer a plain object).
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const current = out[k];
    out[k] = isPlainObject(current) && isPlainObject(v) ? deepMerge(current, v) : v;
  }
  return out as T;
}
